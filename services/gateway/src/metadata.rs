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

/// `https://any.host/ipfs/<cid>[/...]` -> `<cid>[/...]`
fn ipfs_path(url: &str) -> Option<&str> {
    let (_, path) = url.split_once("/ipfs/")?;
    (!path.is_empty()).then_some(path)
}

/// Image URLs on slow IPFS gateways are rewritten to the fastest one, since every
/// visitor's browser loads them.
fn rewrite_image(url: String) -> String {
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
    if res.content_length().is_some_and(|len| len as usize > MAX_BYTES) {
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
        twitter: raw.twitter.as_deref().and_then(safe_url),
        telegram: raw.telegram.as_deref().and_then(safe_url),
        website: raw.website.as_deref().and_then(safe_url),
    }
}

/// Accept only absolute https URLs. Rejects javascript:, data:, http: and garbage.
fn safe_url(s: &str) -> Option<String> {
    let s = s.trim();
    if s.len() > 512 || !s.starts_with("https://") || s.chars().any(|c| c.is_whitespace() || c == '"') {
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
        assert_eq!(candidates("https://meta.example.com/x.json"), vec!["https://meta.example.com/x.json"]);
        assert_eq!(rewrite_image("https://ipfs.io/ipfs/QmImg".into()), "https://pump.mypinata.cloud/ipfs/QmImg");
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
