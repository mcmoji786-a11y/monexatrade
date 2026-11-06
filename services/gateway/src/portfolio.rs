//! A wallet's portfolio: SOL, every token it holds with live prices, and its recent
//! swaps for profit and loss. Holdings come from the chain (Helius DAS), prices from
//! Jupiter, swaps from the wallet's own transactions. Read-only; no keys involved.

use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};

#[derive(Debug, Clone, Serialize)]
pub struct Holding {
    pub mint: String,
    pub symbol: String,
    pub name: String,
    pub image: Option<String>,
    pub decimals: u32,
    /// Whole tokens.
    pub amount: f64,
    /// Raw units, for exact cost-basis math against swaps.
    pub raw: String,
    pub price_usd: Option<f64>,
    pub value_usd: Option<f64>,
    pub change_24h: Option<f64>,
    pub mcap: Option<f64>,
    pub liquidity: Option<f64>,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Portfolio {
    pub wallet: String,
    pub sol: f64,
    pub sol_usd: Option<f64>,
    pub tokens: Vec<Holding>,
    pub updated: i64,
}

/// All fungible tokens a wallet holds, plus its SOL, in one DAS call.
pub async fn holdings(http: &reqwest::Client, rpc_url: &str, wallet: &str) -> Option<(f64, Option<f64>, Vec<Holding>)> {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "searchAssets",
        "params": { "ownerAddress": wallet, "tokenType": "fungible", "limit": 1000,
                    "displayOptions": { "showNativeBalance": true, "showZeroBalance": false } }
    });
    let v: Value = http.post(rpc_url).json(&body).timeout(Duration::from_secs(12)).send().await.ok()?.json().await.ok()?;
    Some(parse_assets(&v["result"]))
}

pub fn parse_assets(r: &Value) -> (f64, Option<f64>, Vec<Holding>) {
    let sol = r["nativeBalance"]["lamports"].as_u64().unwrap_or(0) as f64 / 1e9;
    let sol_usd = r["nativeBalance"]["price_per_sol"].as_f64().filter(|p| *p > 0.0);
    let tokens = r["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| {
            let ti = &a["token_info"];
            let decimals = ti["decimals"].as_u64()? as u32;
            let raw = ti["balance"].as_u64().map(|b| b.to_string()).or_else(|| ti["balance"].as_str().map(String::from))?;
            let amount = raw.parse::<f64>().ok()? / 10f64.powi(decimals as i32);
            if amount <= 0.0 {
                return None;
            }
            let meta = &a["content"]["metadata"];
            let price = ti["price_info"]["price_per_token"].as_f64().filter(|p| *p > 0.0);
            Some(Holding {
                mint: a["id"].as_str()?.to_string(),
                symbol: meta["symbol"].as_str().or(ti["symbol"].as_str()).unwrap_or("").trim().to_string(),
                name: meta["name"].as_str().unwrap_or("").trim().to_string(),
                image: a["content"]["links"]["image"].as_str().and_then(crate::metadata::safe_url).map(crate::metadata::rewrite_image),
                decimals,
                amount,
                raw,
                price_usd: price,
                value_usd: price.map(|p| p * amount),
                change_24h: None,
                mcap: None,
                liquidity: None,
                verified: false,
            })
        })
        .collect();
    (sol, sol_usd, tokens)
}

/// Live prices and market data from Jupiter for up to 100 mints.
pub async fn enrich(http: &reqwest::Client, tokens: &mut [Holding]) {
    let mints: Vec<String> = tokens.iter().take(100).map(|t| t.mint.clone()).collect();
    for chunk in mints.chunks(50) {
        let url = format!("https://lite-api.jup.ag/tokens/v2/search?query={}", chunk.join(","));
        let Some(list) = jupiter_list(http, &url).await else { continue };
        let by: HashMap<&str, &Value> = list.iter().filter_map(|t| Some((t["id"].as_str()?, t))).collect();
        for h in tokens.iter_mut() {
            if let Some(t) = by.get(h.mint.as_str()) {
                apply_jupiter(h, t);
            }
        }
    }
}

/// One Jupiter search, retried twice when rate limited or failing.
async fn jupiter_list(http: &reqwest::Client, url: &str) -> Option<Vec<Value>> {
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(600 * attempt)).await;
        }
        let Ok(res) = http.get(url).timeout(Duration::from_secs(8)).send().await else { continue };
        if !res.status().is_success() {
            continue;
        }
        if let Ok(list) = res.json::<Vec<Value>>().await {
            return Some(list);
        }
    }
    None
}

pub fn apply_jupiter(h: &mut Holding, t: &Value) {
    if let Some(p) = t["usdPrice"].as_f64().filter(|p| *p > 0.0) {
        h.price_usd = Some(p);
        h.value_usd = Some(p * h.amount);
    }
    h.change_24h = t["stats24h"]["priceChange"].as_f64();
    h.mcap = t["mcap"].as_f64();
    h.liquidity = t["liquidity"].as_f64();
    h.verified = t["isVerified"].as_bool().unwrap_or(false);
    if h.symbol.is_empty() {
        h.symbol = t["symbol"].as_str().unwrap_or("").to_string();
    }
    if h.name.is_empty() {
        h.name = t["name"].as_str().unwrap_or("").to_string();
    }
    if h.image.is_none() {
        h.image = t["icon"].as_str().and_then(crate::metadata::safe_url).map(crate::metadata::rewrite_image);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Trade {
    pub mint: String,
    pub buy: bool,
    /// SOL spent (buy) or received (sell), fees included.
    pub sol: f64,
    /// Raw token units.
    pub raw: String,
    pub time: i64,
    pub sig: String,
    /// Ticker, filled from Jupiter after parsing.
    pub symbol: String,
}

const WSOL: &str = "So11111111111111111111111111111111111111112";
const STABLES: [&str; 2] = ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"];

/// The wallet's swaps among its latest 100 transactions, from Helius' parsed history
/// (one request). A swap is one coin in or out against SOL out or in.
pub async fn history(http: &reqwest::Client, api_key: &str, wallet: &str) -> Option<Vec<Trade>> {
    let url = format!("https://api.helius.xyz/v0/addresses/{wallet}/transactions?api-key={api_key}&limit=100");
    let res = http.get(&url).timeout(Duration::from_secs(15)).send().await.ok()?;
    if !res.status().is_success() {
        tracing::warn!(status = %res.status(), "wallet history failed");
        return None;
    }
    let list: Vec<Value> = res.json().await.ok()?;
    Some(list.iter().filter_map(|t| swap_of(t, wallet)).collect())
}

/// Tickers for the traded coins (up to 100), so coins no longer held still read by name.
pub async fn name_trades(http: &reqwest::Client, trades: &mut [Trade]) {
    let mut mints: Vec<String> = trades.iter().map(|t| t.mint.clone()).collect();
    mints.sort();
    mints.dedup();
    let mut names: HashMap<String, String> = HashMap::new();
    for chunk in mints.chunks(50).take(2) {
        let url = format!("https://lite-api.jup.ag/tokens/v2/search?query={}", chunk.join(","));
        let Some(list) = jupiter_list(http, &url).await else { continue };
        for t in &list {
            if let (Some(id), Some(sym)) = (t["id"].as_str(), t["symbol"].as_str()) {
                names.insert(id.to_string(), sym.to_string());
            }
        }
    }
    for t in trades.iter_mut() {
        if let Some(s) = names.get(&t.mint) {
            t.symbol = s.clone();
        }
    }
}

pub fn swap_of(t: &Value, wallet: &str) -> Option<Trade> {
    if !t["transactionError"].is_null() {
        return None;
    }
    let mut lamports: i128 = 0;
    let mut coins: HashMap<String, i128> = HashMap::new();
    for a in t["accountData"].as_array()? {
        if a["account"].as_str() == Some(wallet) {
            lamports += a["nativeBalanceChange"].as_i64().unwrap_or(0) as i128;
        }
        for c in a["tokenBalanceChanges"].as_array().into_iter().flatten() {
            if c["userAccount"].as_str() != Some(wallet) {
                continue;
            }
            let raw: i128 = c["rawTokenAmount"]["tokenAmount"].as_str().and_then(|x| x.parse().ok()).unwrap_or(0);
            *coins.entry(c["mint"].as_str()?.to_string()).or_default() += raw;
        }
    }
    lamports += coins.remove(WSOL).unwrap_or(0);
    let list: Vec<(String, i128)> = coins.into_iter().filter(|(m, d)| *d != 0 && !STABLES.contains(&m.as_str())).collect();
    let [(mint, delta)] = list.as_slice() else { return None };
    let buy = *delta > 0;
    if (buy && lamports >= 0) || (!buy && lamports <= 0) {
        return None;
    }
    Some(Trade {
        mint: mint.clone(),
        buy,
        sol: lamports.unsigned_abs() as f64 / 1e9,
        raw: delta.unsigned_abs().to_string(),
        time: t["timestamp"].as_i64()?,
        sig: t["signature"].as_str()?.to_string(),
        symbol: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_das_holdings_and_skips_empty() {
        let r = json!({
            "nativeBalance": { "lamports": 2_500_000_000u64, "price_per_sol": 150.0 },
            "items": [
                { "id": "MintA", "content": { "metadata": { "symbol": "AAA", "name": "Alpha" } },
                  "token_info": { "decimals": 6, "balance": 1_500_000u64, "price_info": { "price_per_token": 2.0 } } },
                { "id": "MintB", "content": { "metadata": { "symbol": "BBB" } }, "token_info": { "decimals": 6, "balance": 0 } }
            ]
        });
        let (sol, usd, t) = parse_assets(&r);
        assert_eq!(sol, 2.5);
        assert_eq!(usd, Some(150.0));
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].amount, 1.5);
        assert_eq!(t[0].value_usd, Some(3.0));
    }

    #[test]
    fn reads_a_swap_from_parsed_history() {
        let t = json!({ "transactionError": null, "timestamp": 5, "signature": "S",
            "accountData": [
                { "account": "W", "nativeBalanceChange": -1_000_000_000i64, "tokenBalanceChanges": [] },
                { "account": "ata", "nativeBalanceChange": 0, "tokenBalanceChanges": [
                    { "userAccount": "W", "mint": "COIN", "rawTokenAmount": { "tokenAmount": "500", "decimals": 6 } } ] }
            ] });
        let s = swap_of(&t, "W").expect("swap");
        assert!(s.buy);
        assert_eq!(s.sol, 1.0);
        assert_eq!(s.raw, "500");
        // A plain transfer in is not a buy.
        let gift = json!({ "transactionError": null, "timestamp": 5, "signature": "S", "accountData": [
            { "account": "ata", "nativeBalanceChange": 0, "tokenBalanceChanges": [
                { "userAccount": "W", "mint": "COIN", "rawTokenAmount": { "tokenAmount": "500", "decimals": 6 } } ] } ] });
        assert!(swap_of(&gift, "W").is_none());
    }

    #[test]
    fn jupiter_price_overrides_and_fills() {
        let (_, _, mut t) = parse_assets(&json!({ "items": [{ "id": "M", "token_info": { "decimals": 0, "balance": 10 } }] }));
        apply_jupiter(&mut t[0], &json!({ "usdPrice": 0.5, "symbol": "M1", "stats24h": { "priceChange": -12.5 }, "isVerified": true }));
        assert_eq!(t[0].value_usd, Some(5.0));
        assert_eq!(t[0].symbol, "M1");
        assert_eq!(t[0].change_24h, Some(-12.5));
        assert!(t[0].verified);
    }
}
