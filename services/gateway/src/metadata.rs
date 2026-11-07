//! Off-chain token metadata (the JSON file at a token's `uri`): logo and social links.
//! This is creator-supplied, unverified content, so it is fetched defensively:
//! https only, small size cap, short timeout, and every URL is validated.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const MAX_BYTES: usize = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(3);

/// IPFS gateways tried in order. ipfs.io answers 429 (rate limited) to most of our
/// requests; pump.fun's Pinata gateway answered in ~0.5s (measured 2026-11-05).
/// TODO(before launch): run our own dedicated Pinata gateway instead of relying on
/// pump.fun's.
const IPFS_GATEWAYS: [&str; 2] = ["https://pump.mypinata.cloud/ipfs/", "https://ipfs.io/ipfs/"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TokenMeta {
    pub image: Option<String>,
    pub description: Option<String>,
    pub twitter: Option<String>,
    pub telegram: Option<String>,
    pub website: Option<String>,
}

#[derive(Deserialize)]
struct Raw {
    image: Option<String>,
    description: Option<String>,
    twitter: Option<String>,
    telegram: Option<String>,
    website: Option<String>,
}

pub async fn fetch(http: &reqwest::Client, uri: &str) -> Option<TokenMeta> {
    let url = safe_url(uri)?;
    for candidate in candidates(&url) {
        if let Some(meta) = fetch_one(http, &candidate).await {
            return Some(meta);
        }
    }
    None
}

/// For an IPFS URL on any gateway, the same content path on each known gateway.
fn candidates(url: &str) -> Vec<String> {
    match ipfs_path(url) {
        Some(path) => IPFS_GATEWAYS.iter().map(|g| format!("{g}{path}")).collect(),
        None => vec![url.to_string()],
    }
}

/// The content path of an IPFS URL, in either gateway style:
/// - path style:      `https://any.host/ipfs/<cid>[/...]`  -> `<cid>[/...]`
/// - subdomain style: `https://<cid>.ipfs.any.host[/...]`  -> `<cid>[/...]`
fn ipfs_path(url: &str) -> Option<String> {
    if let Some((_, path)) = url.split_once("/ipfs/") {
        return (!path.is_empty()).then(|| path.to_string());
    }
    let rest = url.strip_prefix("https://")?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (cid, _) = host.split_once(".ipfs.")?;
    let path = path.trim_end_matches('/');
    (!cid.is_empty()).then(|| {
        if path.is_empty() {
            cid.to_string()
        } else {
            format!("{cid}/{path}")
        }
    })
}

/// Image URLs on slow or cross-origin-blocking IPFS gateways are rewritten to the
/// fastest one, since every visitor's browser loads them.
pub fn rewrite_image(url: String) -> String {
    match ipfs_path(&url) {
        Some(path) => format!("{}{path}", IPFS_GATEWAYS[0]),
        None => url,
    }
}

async fn fetch_one(http: &reqwest::Client, url: &str) -> Option<TokenMeta> {
    let res = http.get(url).timeout(TIMEOUT).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    if res
        .content_length()
        .is_some_and(|len| len as usize > MAX_BYTES)
    {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    if bytes.len() > MAX_BYTES {
        return None;
    }
    let raw: Raw = serde_json::from_slice(&bytes).ok()?;
    Some(clean(raw))
}

fn clean(raw: Raw) -> TokenMeta {
    TokenMeta {
        image: raw.image.as_deref().and_then(safe_url).map(rewrite_image),
        description: raw
            .description
            .map(|d| d.trim().chars().take(280).collect::<String>())
            .filter(|d| !d.is_empty()),
        twitter: raw.twitter.as_deref().and_then(twitter_url),
        telegram: raw.telegram.as_deref().and_then(telegram_url),
        website: raw.website.as_deref().and_then(website_url),
    }
}

/// Trading terminals, screeners, explorers and launchpads. A "website" on one of these
/// is somebody else's page for the coin (often with a referral code), not the project's.
const NOT_A_PROJECT_SITE: &[&str] = &[
    "axiom.trade", "gmgn.ai", "photon-sol.tinyastro.io", "tinyastro.io", "bullx.io", "padre.gg", "otcdesks.cash",
    "dexscreener.com", "dextools.io", "birdeye.so", "geckoterminal.com", "coingecko.com", "coinmarketcap.com",
    "jup.ag", "raydium.io", "meteora.ag", "orca.so", "solscan.io", "solana.fm", "explorer.solana.com", "solanabeach.io",
    "pump.fun", "bonk.fun", "letsbonk.fun", "believe.app", "moonshot.cc", "moonshot.money", "floatlaunch.xyz",
    "bags.fm", "boop.fun", "launchlab.raydium.io", "trojan.app", "bonkbot.io", "maestrobots.com", "bloombot.app",
    "nova.trade", "tradewithnova.com", "fomo.family", "vector.fun", "moby.fun", "rugcheck.xyz", "defined.fi",
];

fn host_of(url: &str) -> String {
    url.trim_start_matches("https://").split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase()
}

fn on(host: &str, domains: &[&str]) -> bool {
    domains.iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// A Solana address in the path: a page about one coin on some other site.
fn has_address(url: &str) -> bool {
    url.split(['/', '?', '#', '=', '&']).any(|p| (32..=44).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric() && !b"0OIl".contains(&b)))
}

/// The coin's X account or post: x.com or twitter.com only.
pub fn twitter_url(s: &str) -> Option<String> {
    safe_url(s).filter(|u| on(&host_of(u), &["x.com", "twitter.com"]) && has_handle(u))
}

/// The link names an account or group: "/name", not a bare host or "#fragment".
fn has_handle(url: &str) -> bool {
    let path = url.trim_start_matches("https://").split_once('/').map_or("", |(_, p)| p);
    let first = path.split(['/', '?', '#']).next().unwrap_or("");
    !first.is_empty() && first.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'+' || b == b'-')
}

/// The coin's Telegram group: t.me or telegram.me only.
pub fn telegram_url(s: &str) -> Option<String> {
    safe_url(s).filter(|u| on(&host_of(u), &["t.me", "telegram.me"]) && has_handle(u))
}

/// The project's own site: never a trading terminal, screener or another site's page
/// for the coin.
pub fn website_url(s: &str) -> Option<String> {
    safe_url(s).filter(|u| !on(&host_of(u), NOT_A_PROJECT_SITE) && !has_address(u))
}

/// Accept only absolute https URLs. Rejects javascript:, data:, http: and garbage.
pub fn safe_url(s: &str) -> Option<String> {
    let s = s.trim();
    if s.len() > 512
        || !s.starts_with("https://")
        || s.chars().any(|c| c.is_whitespace() || c == '"')
    {
        return None;
    }
    let host = s["https://".len()..].split(['/', '?', '#']).next()?;
    if host.is_empty() || !host.contains('.') {
        return None;
    }
    Some(s.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn socials_are_the_projects_own() {
        assert!(twitter_url("https://x.com/coin").is_some());
        assert!(twitter_url("https://twitter.com/coin/status/1").is_some());
        assert!(twitter_url("https://thehill.com/news/x").is_none());
        assert!(twitter_url("https://x.com.evil.io/coin").is_none());
        assert!(telegram_url("https://t.me/coin").is_some());
        assert!(telegram_url("https://discord.gg/coin").is_none());
        assert!(telegram_url("https://t.me/#0xaB6bC6dCf578a8A79F05AbabC17269dF93257777").is_none());
        assert!(telegram_url("https://t.me/+AbCd123").is_some());
        assert!(twitter_url("https://x.com/").is_none());
        assert!(website_url("https://mycoin.fun").is_some());
        assert!(website_url("https://www.mycoin.fun/about").is_some());
        assert!(website_url("https://axiom.trade/token/SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb?chain=sol").is_none());
        assert!(website_url("https://otcdesks.cash/coin/E4SnV39be1N9uY36eNo1Q5XAUAbhVAfzLUaLp7ghuPpY").is_none());
        assert!(website_url("https://pump.fun/coin/B6dcfkWBPE261THqCprWhLCTtx4keW2znsSEEngkcLmP").is_none());
        assert!(website_url("https://neo.bullx.io/terminal?chainId=1").is_none());
        assert!(website_url("https://dexscreener.com/solana/abc").is_none());
        assert!(website_url("https://someterminal.xyz/tokens/DBPTU2oKLDHXQjAEJ3rZi8bUGmt2uxUbipgg6xmXoMqr").is_none());
    }

    use super::*;

    #[test]
    fn safe_url_accepts_https_only() {
        assert!(safe_url("https://ipfs.io/ipfs/abc").is_some());
        assert!(safe_url("http://ipfs.io/ipfs/abc").is_none());
        assert!(safe_url("javascript:alert(1)").is_none());
        assert!(safe_url("data:image/png;base64,xx").is_none());
        assert!(safe_url("https://").is_none());
        assert!(safe_url("https://localhost/x").is_none());
        assert!(safe_url("https://a.com/\"onerror=").is_none());
    }

    #[test]
    fn ipfs_urls_try_fast_gateway_first() {
        let c = candidates("https://ipfs.io/ipfs/QmABC");
        assert_eq!(c[0], "https://pump.mypinata.cloud/ipfs/QmABC");
        assert_eq!(c.len(), 2);
        assert_eq!(
            candidates("https://meta.example.com/x.json"),
            vec!["https://meta.example.com/x.json"]
        );
        assert_eq!(
            rewrite_image("https://ipfs.io/ipfs/QmImg".into()),
            "https://pump.mypinata.cloud/ipfs/QmImg"
        );
        // subdomain-style gateway, seen blocked by the browser (ERR_BLOCKED_BY_ORB)
        assert_eq!(
            rewrite_image("https://bafkreihztk.ipfs.dweb.link/".into()),
            "https://pump.mypinata.cloud/ipfs/bafkreihztk"
        );
        assert_eq!(
            rewrite_image("https://bafyabc.ipfs.w3s.link/logo.png".into()),
            "https://pump.mypinata.cloud/ipfs/bafyabc/logo.png"
        );
        assert_eq!(
            rewrite_image("https://arweave.net/x".into()),
            "https://arweave.net/x"
        );
    }

    #[test]
    fn clean_drops_unsafe_fields() {
        let m = clean(Raw {
            image: Some("https://cdn.example.com/a.png".into()),
            description: Some("   ".into()),
            twitter: Some("javascript:x".into()),
            telegram: None,
            website: Some("https://site.example".into()),
        });
        assert_eq!(m.image.as_deref(), Some("https://cdn.example.com/a.png"));
        assert!(m.description.is_none());
        assert!(m.twitter.is_none());
        assert_eq!(m.website.as_deref(), Some("https://site.example"));
    }
}
