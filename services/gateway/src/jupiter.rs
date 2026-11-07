//! Established Solana tokens from Jupiter's Tokens API v2 (ADR 0004).
//!
//! New launches and snipers come from our own decoders; this provider adds the large,
//! already-trading tokens across all Solana DEXes. It sits behind `MarketToken` so it
//! can be replaced by our own indexer later without touching the frontend.
//!
//! Keyless access was measured on 2026-11-06 at about 5 requests per window (a burst of
//! 12 got 11 x 429), so one request goes out every POLL_EVERY, rotating categories,
//! and the result is shared by every connected user.

use crate::metadata;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

const BASE: &str = "https://lite-api.jup.ag/tokens/v2";
pub const POLL_EVERY: Duration = Duration::from_secs(3);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const LIMIT: u32 = 100;
/// A token not returned by any category for this long leaves the board.
const STALE_AFTER: Duration = Duration::from_secs(300);
/// Category endpoints polled in rotation. The 6h lists and organic score widen the pool
/// Top gainers ranks from, so it covers established memecoins and not only this hour's
/// trending ones. A full rotation takes about 25 s, well inside STALE_AFTER.
const CATEGORIES: [&str; 6] = [
    "toptrending/5m",
    "toptraded/1h",
    "toptrending/1h",
    "toporganicscore/1h",
    "toptraded/6h",
    "toptrending/6h",
];
/// Every ENRICH_EVERY-th round enriches our own launches instead of polling a category.
pub const ENRICH_EVERY: usize = 4;
/// Max mints per search call.
pub const ENRICH_BATCH: usize = 50;

/// Memecoin classification, derived from real Jupiter data (2026-11-06): memecoins
/// carry the `meme` tag or come from a memecoin launchpad. Stocks, RWAs and DeFi
/// tokens carry these tags and are excluded even if they came from a launchpad.
const MEME_LAUNCHPADS: [&str; 6] = [
    "pump.fun",
    "letsbonk.fun",
    "raydium-launchlab",
    "met-dbc",
    "moonshot",
    "believe",
];
const NON_MEME_TAGS: [&str; 5] = ["stocks", "rwa", "xstocks", "equities", "defi"];

fn is_memecoin(tags: &[String], launchpad: Option<&str>) -> bool {
    if tags.iter().any(|t| NON_MEME_TAGS.contains(&t.as_str())) {
        return false;
    }
    tags.iter().any(|t| t == "meme") || launchpad.is_some_and(|l| MEME_LAUNCHPADS.contains(&l))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MarketToken {
    pub mint: String,
    pub symbol: String,
    pub name: String,
    pub image: Option<String>,
    pub price_usd: Option<f64>,
    pub mc_usd: Option<f64>,
    pub liquidity_usd: Option<f64>,
    pub holders: Option<u64>,
    pub change_5m_pct: Option<f64>,
    pub change_1h_pct: Option<f64>,
    pub change_24h_pct: Option<f64>,
    pub volume_5m_usd: Option<f64>,
    pub volume_1h_usd: Option<f64>,
    pub volume_24h_usd: Option<f64>,
    pub buys_1h: Option<u64>,
    pub sells_1h: Option<u64>,
    pub traders_1h: Option<u64>,
    pub top_holders_pct: Option<f64>,
    pub mint_authority_disabled: bool,
    pub freeze_authority_disabled: Option<bool>,
    pub verified: bool,
    pub organic_score: Option<f64>,
    pub launchpad: Option<String>,
    pub created_at: Option<String>,
    pub twitter: Option<String>,
    pub telegram: Option<String>,
    pub website: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawToken {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    symbol: String,
    icon: Option<String>,
    usd_price: Option<f64>,
    mcap: Option<f64>,
    liquidity: Option<f64>,
    holder_count: Option<u64>,
    mint_authority: Option<String>,
    stats5m: Option<RawStats>,
    stats1h: Option<RawStats>,
    stats24h: Option<RawStats>,
    audit: Option<RawAudit>,
    #[serde(default)]
    is_verified: Option<bool>,
    organic_score: Option<f64>,
    launchpad: Option<String>,
    created_at: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    twitter: Option<String>,
    telegram: Option<String>,
    website: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawStats {
    price_change: Option<f64>,
    buy_volume: Option<f64>,
    sell_volume: Option<f64>,
    num_buys: Option<u64>,
    num_sells: Option<u64>,
    num_traders: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAudit {
    top_holders_percentage: Option<f64>,
    freeze_authority_disabled: Option<bool>,
}

fn volume(s: &Option<RawStats>) -> Option<f64> {
    let s = s.as_ref()?;
    Some(s.buy_volume.unwrap_or(0.0) + s.sell_volume.unwrap_or(0.0))
}

fn round1(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite())
        .map(|x| (x * 10.0).round() / 10.0)
}

impl From<RawToken> for MarketToken {
    fn from(r: RawToken) -> Self {
        MarketToken {
            // ipfs.io blocks cross-origin image loads (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin,
            // seen in the browser 2026-11-06), so IPFS icons go through the fast gateway.
            image: r
                .icon
                .as_deref()
                .and_then(metadata::safe_url)
                .map(metadata::rewrite_image),
            price_usd: r.usd_price,
            mc_usd: r.mcap,
            liquidity_usd: r.liquidity,
            holders: r.holder_count,
            change_5m_pct: round1(r.stats5m.as_ref().and_then(|s| s.price_change)),
            change_1h_pct: round1(r.stats1h.as_ref().and_then(|s| s.price_change)),
            change_24h_pct: round1(r.stats24h.as_ref().and_then(|s| s.price_change)),
            volume_5m_usd: volume(&r.stats5m),
            volume_1h_usd: volume(&r.stats1h),
            volume_24h_usd: volume(&r.stats24h),
            buys_1h: r.stats1h.as_ref().and_then(|s| s.num_buys),
            sells_1h: r.stats1h.as_ref().and_then(|s| s.num_sells),
            traders_1h: r.stats1h.as_ref().and_then(|s| s.num_traders),
            top_holders_pct: round1(r.audit.as_ref().and_then(|a| a.top_holders_percentage)),
            mint_authority_disabled: r.mint_authority.is_none(),
            freeze_authority_disabled: r.audit.as_ref().and_then(|a| a.freeze_authority_disabled),
            verified: r.is_verified.unwrap_or(false),
            organic_score: round1(r.organic_score),
            launchpad: r.launchpad,
            created_at: r.created_at,
            // Creator-supplied links: https only, like launch metadata.
            twitter: r.twitter.as_deref().and_then(metadata::twitter_url),
            telegram: r.telegram.as_deref().and_then(metadata::telegram_url),
            website: r.website.as_deref().and_then(metadata::website_url),
            mint: r.id,
            symbol: r.symbol.chars().take(24).collect(),
            name: r.name.chars().take(64).collect(),
        }
    }
}

/// Holds the merged board across categories and knows what changed.
#[derive(Default)]
pub struct MarketBoard {
    tokens: HashMap<String, (MarketToken, Instant)>,
}

impl MarketBoard {
    /// Merge one category response. Returns tokens that are new or changed.
    pub fn merge(&mut self, items: Vec<MarketToken>) -> Vec<MarketToken> {
        let now = Instant::now();
        let mut changed = Vec::new();
        for t in items {
            let differs = self.tokens.get(&t.mint).is_none_or(|(old, _)| old != &t);
            if differs {
                changed.push(t.clone());
            }
            self.tokens.insert(t.mint.clone(), (t, now));
        }
        changed
    }

    /// Drop tokens no category has returned recently. Returns their mints.
    pub fn prune(&mut self) -> Vec<String> {
        let stale: Vec<String> = self
            .tokens
            .iter()
            .filter(|(_, (_, seen))| seen.elapsed() > STALE_AFTER)
            .map(|(m, _)| m.clone())
            .collect();
        for m in &stale {
            self.tokens.remove(m);
        }
        stale
    }

    pub fn get(&self, mint: &str) -> Option<MarketToken> {
        self.tokens.get(mint).map(|(t, _)| t.clone())
    }

    pub fn all(&self) -> Vec<MarketToken> {
        self.tokens.values().map(|(t, _)| t.clone()).collect()
    }
}

pub enum PollResult {
    Ok(Vec<MarketToken>),
    RateLimited,
    Failed,
}

/// One category, memecoins only.
pub async fn fetch_category(http: &reqwest::Client, category: &str) -> PollResult {
    fetch(http, &format!("{BASE}/{category}?limit={LIMIT}"), category).await
}

/// Exact holders, liquidity and verification for our own launches (by mint).
/// Our launches are pump.fun memecoins, so they pass the memecoin filter.
pub async fn fetch_mints(http: &reqwest::Client, mints: &[String]) -> PollResult {
    let query = mints
        .iter()
        .take(ENRICH_BATCH)
        .cloned()
        .collect::<Vec<_>>()
        .join(",");
    fetch(http, &format!("{BASE}/search?query={query}"), "search").await
}

async fn fetch(http: &reqwest::Client, url: &str, label: &str) -> PollResult {
    let res = match http.get(url).timeout(Duration::from_secs(8)).send().await {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!(err = %err.without_url(), label, "jupiter request failed");
            return PollResult::Failed;
        }
    };
    if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return PollResult::RateLimited;
    }
    if !res.status().is_success() {
        tracing::warn!(status = %res.status(), label, "jupiter error status");
        return PollResult::Failed;
    }
    match res.json::<Vec<RawToken>>().await {
        Ok(raw) => PollResult::Ok(
            raw.into_iter()
                .filter(|t| is_memecoin(&t.tags, t.launchpad.as_deref()))
                .map(MarketToken::from)
                .collect(),
        ),
        Err(err) => {
            tracing::warn!(%err, label, "jupiter response did not parse");
            PollResult::Failed
        }
    }
}

/// Category to poll on the n-th round.
pub fn category(round: usize) -> &'static str {
    CATEGORIES[round % CATEGORIES.len()]
}

/// Next delay after a result: steady when fine, doubling when rate limited.
pub fn next_delay(current: Duration, result: &PollResult) -> Duration {
    match result {
        PollResult::RateLimited => (current * 2).min(MAX_BACKOFF),
        _ => POLL_EVERY,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[{"id":"MintA","name":"Alpha","symbol":"ALP","icon":"https://arweave.net/x",
      "usdPrice":1.5,"mcap":1000000,"liquidity":50000,"holderCount":1200,"mintAuthority":null,
      "stats5m":{"priceChange":0.44,"buyVolume":100,"sellVolume":50,"numBuys":3,"numSells":2},
      "stats1h":{"priceChange":-2.06,"buyVolume":1000,"sellVolume":500,"numBuys":30,"numSells":20,"numTraders":12},
      "audit":{"topHoldersPercentage":34.06,"freezeAuthorityDisabled":true},
      "isVerified":true,"organicScore":96.94,"unknownField":1}]"#;

    #[test]
    fn parses_and_maps_jupiter_tokens() {
        let raw: Vec<RawToken> = serde_json::from_str(SAMPLE).unwrap();
        let t = MarketToken::from(raw.into_iter().next().unwrap());
        assert_eq!(t.mint, "MintA");
        assert_eq!(t.change_5m_pct, Some(0.4));
        assert_eq!(t.change_1h_pct, Some(-2.1));
        assert_eq!(t.volume_1h_usd, Some(1500.0));
        assert_eq!(
            (t.buys_1h, t.sells_1h, t.traders_1h),
            (Some(30), Some(20), Some(12))
        );
        assert!(t.mint_authority_disabled);
        assert_eq!(t.freeze_authority_disabled, Some(true));
        assert_eq!(t.top_holders_pct, Some(34.1));
        assert!(t.verified);
        assert_eq!(t.image.as_deref(), Some("https://arweave.net/x"));
    }

    #[test]
    fn ipfs_icons_are_rewritten() {
        let json = SAMPLE.replace("https://arweave.net/x", "https://ipfs.io/ipfs/QmIcon");
        let raw: Vec<RawToken> = serde_json::from_str(&json).unwrap();
        let t = MarketToken::from(raw.into_iter().next().unwrap());
        assert_eq!(
            t.image.as_deref(),
            Some("https://pump.mypinata.cloud/ipfs/QmIcon")
        );
    }

    #[test]
    fn board_reports_only_changes() {
        let raw: Vec<RawToken> = serde_json::from_str(SAMPLE).unwrap();
        let t = MarketToken::from(raw.into_iter().next().unwrap());
        let mut b = MarketBoard::default();
        assert_eq!(b.merge(vec![t.clone()]).len(), 1);
        assert!(
            b.merge(vec![t.clone()]).is_empty(),
            "unchanged token is not re-sent"
        );
        let mut moved = t;
        moved.price_usd = Some(1.6);
        assert_eq!(b.merge(vec![moved]).len(), 1);
    }

    #[test]
    fn classifies_memecoins_from_real_tag_patterns() {
        let tags = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        // TRUMP / BOME / SPX: meme tag, no launchpad
        assert!(is_memecoin(&tags(&["verified", "meme", "community"]), None));
        // fresh pump.fun token
        assert!(is_memecoin(
            &tags(&["unknown", "token-2022"]),
            Some("pump.fun")
        ));
        // DNUT: tokenized stock, even though it trended
        assert!(!is_memecoin(
            &tags(&["verified", "stocks", "rwa", "backpack"]),
            None
        ));
        // PUMPCADE: came from pump.fun but tagged defi
        assert!(!is_memecoin(
            &tags(&["defi", "launchpad", "verified"]),
            Some("pump.fun")
        ));
        // cbBTC / ZEC: no meme signal at all
        assert!(!is_memecoin(&tags(&["verified", "community"]), None));
        // metadao launches are not memecoin launchpads
        assert!(!is_memecoin(&tags(&["verified"]), Some("metadao")));
    }

    #[test]
    fn backs_off_on_rate_limit() {
        assert_eq!(
            next_delay(POLL_EVERY, &PollResult::RateLimited),
            POLL_EVERY * 2
        );
        assert_eq!(
            next_delay(Duration::from_secs(50), &PollResult::RateLimited),
            MAX_BACKOFF
        );
        assert_eq!(
            next_delay(Duration::from_secs(50), &PollResult::Ok(vec![])),
            POLL_EVERY
        );
    }
}
