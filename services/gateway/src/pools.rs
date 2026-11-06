//! Finding a coin's trading pools and pricing their quote token.
//! Pools come from DexScreener's free pair list (about 300 calls a minute, far more
//! than GeckoTerminal's 30), cached for 10 minutes. Quote prices come from Jupiter.

use serde_json::Value;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

const PAIRS_TTL: Duration = Duration::from_secs(600);
const PRICE_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub struct Pair {
    /// "pumpswap", "raydium", "meteora", "orca", ...
    pub dex: String,
    pub address: String,
    pub quote: String,
    /// e.g. "BTC / WBTC"
    pub name: String,
    pub liquidity_usd: f64,
    /// Traded in the last hour (falls back to 24 h / 24 when the hour is missing).
    pub volume_1h_usd: f64,
}

#[derive(Default)]
pub struct Pools {
    pairs: Mutex<HashMap<String, (Instant, Vec<Pair>)>>,
    prices: Mutex<HashMap<String, (Instant, (f64, u32))>>,
}

impl Pools {
    /// Solana pairs for a coin where it is the base token, most traded first.
    pub async fn pairs(&self, http: &reqwest::Client, mint: &str) -> Vec<Pair> {
        if let Some((at, p)) = self.pairs.lock().expect("pairs lock").get(mint) {
            if at.elapsed() < PAIRS_TTL {
                return p.clone();
            }
        }
        let url = format!("https://api.dexscreener.com/token-pairs/v1/solana/{mint}");
        let Some(Value::Array(rows)) = get(http, &url).await else {
            return Vec::new();
        };
        let mut list: Vec<Pair> = rows
            .iter()
            .filter(|p| p["chainId"] == "solana" && p["baseToken"]["address"] == mint)
            .filter_map(|p| {
                Some(Pair {
                    dex: p["dexId"].as_str()?.to_string(),
                    address: p["pairAddress"].as_str()?.to_string(),
                    quote: p["quoteToken"]["address"].as_str()?.to_string(),
                    name: format!(
                        "{} / {}",
                        p["baseToken"]["symbol"].as_str().unwrap_or("?"),
                        p["quoteToken"]["symbol"].as_str().unwrap_or("?")
                    ),
                    liquidity_usd: p["liquidity"]["usd"].as_f64().unwrap_or(0.0),
                    volume_1h_usd: p["volume"]["h1"]
                        .as_f64()
                        .or_else(|| p["volume"]["h24"].as_f64().map(|v| v / 24.0))
                        .unwrap_or(0.0),
                })
            })
            .collect();
        // The pool where the coin actually trades, not the deepest one: a large pool can
        // sit idle (seen 2026-11-06: Fartcoin's $4M Raydium pool had no swaps while its
        // Orca pools traded). Liquidity breaks ties.
        list.sort_by(|a, b| {
            b.volume_1h_usd
                .total_cmp(&a.volume_1h_usd)
                .then(b.liquidity_usd.total_cmp(&a.liquidity_usd))
        });
        self.pairs
            .lock()
            .expect("pairs lock")
            .insert(mint.to_string(), (Instant::now(), list.clone()));
        list
    }

    /// USD price and decimals of a token (the quote side of a pool).
    pub async fn price(&self, http: &reqwest::Client, mint: &str) -> Option<(f64, u32)> {
        if let Some((at, p)) = self.prices.lock().expect("prices lock").get(mint) {
            if at.elapsed() < PRICE_TTL {
                return Some(*p);
            }
        }
        let v = get(
            http,
            &format!("https://lite-api.jup.ag/price/v3?ids={mint}"),
        )
        .await?;
        let e = &v[mint];
        let p = (e["usdPrice"].as_f64()?, e["decimals"].as_u64()? as u32);
        self.prices
            .lock()
            .expect("prices lock")
            .insert(mint.to_string(), (Instant::now(), p));
        Some(p)
    }
}

async fn get(http: &reqwest::Client, url: &str) -> Option<Value> {
    let res = http
        .get(url)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        tracing::warn!(status = %res.status(), url = %url.split('?').next().unwrap_or(""), "pool lookup error status");
        return None;
    }
    res.json().await.ok()
}

/// Multiplier from a quote token's raw units to lamports of equal value, so trades in
/// any quote currency fit the book's SOL units. 1.0 for wrapped SOL.
pub fn lamports_per_raw(quote_usd: f64, quote_decimals: u32, sol_usd: f64) -> f64 {
    quote_usd / sol_usd * 1e9 / 10f64.powi(quote_decimals as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_quote_units_to_lamports() {
        // 1 WBTC (8 decimals) at $76,000 with SOL at $90 is worth 844.4 SOL.
        let k = lamports_per_raw(76_000.0, 8, 90.0);
        let lamports = 100_000_000.0 * k;
        assert!((lamports / 1e9 - 844.44).abs() < 0.01);
        // USDC (6 decimals): $1 at SOL $100 is 0.01 SOL.
        assert!((1_000_000.0 * lamports_per_raw(1.0, 6, 100.0) - 10_000_000.0).abs() < 1.0);
    }
}
