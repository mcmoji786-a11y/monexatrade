//! `GET /token/{mint}/profile`: a coin's public profile from DexScreener: banner, logo,
//! website and social links, and its main pool. Cached ten minutes per coin (a coin with
//! no profile two minutes), and at most `MAX_PER_MIN` provider calls a minute in total so
//! a flood of addresses cannot run up the provider's limit.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::{json, Value};

use crate::AppState;

const TTL: Duration = Duration::from_secs(600);
const MISS_TTL: Duration = Duration::from_secs(120);
const MAX_PER_MIN: u32 = 60;

type Cache = Mutex<HashMap<String, (Instant, Value)>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// One provider call allowed now? A fixed one-minute window.
fn take_call() -> bool {
    static W: OnceLock<Mutex<(Instant, u32)>> = OnceLock::new();
    let mut w = W.get_or_init(|| Mutex::new((Instant::now(), 0))).lock().expect("profile window lock");
    if w.0.elapsed() >= Duration::from_secs(60) {
        *w = (Instant::now(), 0);
    }
    if w.1 >= MAX_PER_MIN {
        return false;
    }
    w.1 += 1;
    true
}

/// Only plain https links, of a sane length, are passed on.
fn link(v: &Value) -> Option<String> {
    let s = v.as_str()?.trim();
    (s.starts_with("https://") && s.len() <= 500 && !s.chars().any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>')).then(|| s.to_string())
}

/// The coin's profile from DexScreener's answer: its deepest Solana pool and that pool's info.
fn parse(v: &Value) -> Value {
    let Some(pairs) = v["pairs"].as_array() else { return Value::Null };
    let best = pairs
        .iter()
        .filter(|p| p["chainId"].as_str() == Some("solana"))
        .max_by(|a, b| a["liquidity"]["usd"].as_f64().unwrap_or(0.0).total_cmp(&b["liquidity"]["usd"].as_f64().unwrap_or(0.0)));
    let Some(p) = best else { return Value::Null };
    let info = &p["info"];
    let websites: Vec<Value> = info["websites"]
        .as_array()
        .map(|w| w.iter().filter_map(|x| link(&x["url"]).map(|u| json!({ "label": x["label"].as_str().unwrap_or("Website").chars().take(24).collect::<String>(), "url": u }))).take(4).collect())
        .unwrap_or_default();
    let socials: Vec<Value> = info["socials"]
        .as_array()
        .map(|w| w.iter().filter_map(|x| link(&x["url"]).map(|u| json!({ "type": x["type"].as_str().unwrap_or("link").chars().take(16).collect::<String>(), "url": u }))).take(6).collect())
        .unwrap_or_default();
    json!({
        "header": link(&info["header"]),
        "image": link(&info["imageUrl"]),
        "websites": websites,
        "socials": socials,
        "dex": p["dexId"].as_str().map(|s| s.chars().take(24).collect::<String>()),
        "pair_url": link(&p["url"]),
        "pair_created_ms": p["pairCreatedAt"].as_i64(),
        "pools": pairs.iter().filter(|p| p["chainId"].as_str() == Some("solana")).count(),
    })
}

pub async fn handler(State(state): State<Arc<AppState>>, Path(mint): Path<String>) -> Result<Json<Value>, StatusCode> {
    if !crate::account::is_solana_address(&mint) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some((at, v)) = cache().lock().expect("profile cache lock").get(&mint) {
        if at.elapsed() < if v.is_null() { MISS_TTL } else { TTL } {
            return Ok(Json(v.clone()));
        }
    }
    if !take_call() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    let res = state
        .http
        .get(format!("https://api.dexscreener.com/latest/dex/tokens/{mint}"))
        .header("accept", "application/json")
        .timeout(Duration::from_secs(6))
        .send()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if !res.status().is_success() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    let body: Value = res.json().await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let out = parse(&body);
    let mut c = cache().lock().expect("profile cache lock");
    if c.len() > 5_000 {
        c.retain(|_, (at, _)| at.elapsed() < TTL);
    }
    c.insert(mint, (Instant::now(), out.clone()));
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_deepest_solana_pool_and_keeps_only_https_links() {
        let v = json!({ "pairs": [
            { "chainId": "solana", "dexId": "raydium", "liquidity": { "usd": 10.0 }, "info": { "header": "https://a/h.png" } },
            { "chainId": "solana", "dexId": "pumpswap", "url": "https://dexscreener.com/solana/x", "liquidity": { "usd": 500.0 },
              "info": { "header": "https://cdn/h.png", "imageUrl": "javascript:alert(1)",
                        "websites": [{ "label": "Site", "url": "https://site.io" }, { "label": "Bad", "url": "http://plain.io" }],
                        "socials": [{ "type": "twitter", "url": "https://x.com/coin" }] } },
            { "chainId": "base", "liquidity": { "usd": 9999.0 } }
        ]});
        let p = parse(&v);
        assert_eq!(p["dex"], "pumpswap");
        assert_eq!(p["header"], "https://cdn/h.png");
        assert!(p["image"].is_null());
        assert_eq!(p["websites"].as_array().unwrap().len(), 1);
        assert_eq!(p["socials"][0]["type"], "twitter");
        assert_eq!(p["pools"], 2);
    }

    #[test]
    fn no_pairs_is_no_profile() {
        assert!(parse(&json!({ "pairs": null })).is_null());
    }
}
