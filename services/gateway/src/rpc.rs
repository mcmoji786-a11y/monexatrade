//! Small Solana RPC helpers (Helius) for the trade page: accounts, supply, recent
//! signatures and full transactions (read by the universal decoder, txdecode.rs).
//! The free plan allows about 10 requests a second, so callers batch and pace.

use serde_json::{json, Value};
use std::time::Duration;

/// Requests per second the gateway sends Helius (free plan: about 10, and the
/// ingest engine's SOL price poller shares the key).
/// Default for the free plan; HELIUS_RPS in the environment raises it on a paid plan.
const DEFAULT_RPS: usize = 8;

fn requests_per_second() -> usize {
    use std::sync::OnceLock;
    static RPS: OnceLock<usize> = OnceLock::new();
    *RPS.get_or_init(|| std::env::var("HELIUS_RPS").ok().and_then(|v| v.parse().ok()).filter(|v| (1..=500).contains(v)).unwrap_or(DEFAULT_RPS))
}

/// Waits until `weight` requests fit in the last second's budget. A batch of n calls
/// costs n. Callers queue instead of failing with 429.
async fn pace(weight: usize) {
    use std::sync::Mutex;
    use std::time::Instant;
    static SENT: Mutex<std::collections::VecDeque<Instant>> =
        Mutex::new(std::collections::VecDeque::new());
    let weight = weight.clamp(1, requests_per_second());
    loop {
        let wait = {
            let mut sent = SENT.lock().expect("rpc pace lock");
            while sent
                .front()
                .is_some_and(|t| t.elapsed() >= Duration::from_secs(1))
            {
                sent.pop_front();
            }
            if sent.len() + weight <= requests_per_second() {
                let now = Instant::now();
                sent.extend(std::iter::repeat_n(now, weight));
                return;
            }
            let oldest = sent[sent.len() + weight - requests_per_second() - 1];
            Duration::from_secs(1).saturating_sub(oldest.elapsed())
        };
        tokio::time::sleep(wait.max(Duration::from_millis(20))).await;
    }
}

async fn call(http: &reqwest::Client, url: &str, body: &Value) -> Option<Value> {
    pace(body.as_array().map_or(1, Vec::len)).await;
    let res = http
        .post(url)
        .json(body)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        tracing::warn!(status = %res.status(), "rpc error status");
        return None;
    }
    res.json().await.ok()
}

/// SOL balance of a wallet, in SOL.
pub async fn sol_balance(http: &reqwest::Client, url: &str, wallet: &str) -> Option<f64> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [wallet, { "commitment": "confirmed" }] });
    let v = call(http, url, &body).await?;
    v["result"]["value"].as_u64().map(|l| l as f64 / 1e9)
}

/// Owner program of an account, or None when it does not exist.
pub async fn account_owner(http: &reqwest::Client, url: &str, pubkey: &str) -> Option<String> {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
        "params": [pubkey, { "encoding": "base64", "dataSlice": { "offset": 0, "length": 0 } }]
    });
    let v = call(http, url, &body).await?;
    v["result"]["value"]["owner"].as_str().map(String::from)
}

/// What an account is: Some(None) when it does not exist yet, Some(Some((owner, parsed
/// type, executable))) when it does ("mint" or "account" for token program accounts), and
/// None when the node could not be asked (so callers never mistake a failure for an answer).
pub async fn account_kind(http: &reqwest::Client, url: &str, pubkey: &str) -> Option<Option<(String, String, bool)>> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo", "params": [pubkey, { "encoding": "jsonParsed" }] });
    let v = call(http, url, &body).await?;
    if v.get("error").is_some() {
        return None;
    }
    let value = v.get("result")?.get("value")?;
    if value.is_null() {
        return Some(None);
    }
    let owner = value["owner"].as_str()?.to_string();
    let kind = value["data"]["parsed"]["type"].as_str().unwrap_or_default().to_string();
    Some(Some((owner, kind, value["executable"].as_bool().unwrap_or(false))))
}

/// A token's current total supply in whole tokens (burns already subtracted) and its
/// decimals, straight from the mint account.
pub async fn token_supply(http: &reqwest::Client, url: &str, mint: &str) -> Option<(f64, u32)> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getTokenSupply", "params": [mint] });
    let v = call(http, url, &body).await?;
    let amount: f64 = v["result"]["value"]["amount"].as_str()?.parse().ok()?;
    let decimals = v["result"]["value"]["decimals"].as_u64()? as u32;
    Some((amount / 10f64.powi(decimals as i32), decimals))
}

/// A pool account's raw data (it holds the pool's vault addresses).
pub async fn account_data(
    http: &reqwest::Client,
    url: &str,
    pubkey: &str,
) -> Option<(String, Vec<u8>)> {
    use base64::Engine;
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo", "params": [pubkey, { "encoding": "base64" }] });
    let v = call(http, url, &body).await?;
    let owner = v["result"]["value"]["owner"].as_str()?.to_string();
    let data = base64::engine::general_purpose::STANDARD
        .decode(v["result"]["value"]["data"][0].as_str()?)
        .ok()?;
    Some((owner, data))
}

/// How many of an account's last 25 transactions succeeded in the last five minutes:
/// a cheap on-chain measure of where a coin really trades.
pub async fn recent_activity(http: &reqwest::Client, url: &str, account: &str) -> usize {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [account, { "limit": 25, "commitment": "confirmed" }] });
    let Some(v) = call(http, url, &body).await else {
        return 0;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    v["result"].as_array().map_or(0, |a| {
        a.iter()
            .filter(|s| {
                s["err"].is_null() && s["blockTime"].as_i64().is_some_and(|t| now - t <= 300)
            })
            .count()
    })
}

/// Latest successful transaction signatures of an account, newest first.
pub async fn recent_signatures(
    http: &reqwest::Client,
    url: &str,
    account: &str,
    limit: usize,
) -> Vec<String> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [account, { "limit": limit, "commitment": "confirmed" }] });
    let Some(v) = call(http, url, &body).await else {
        return Vec::new();
    };
    v["result"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|s| s["err"].is_null())
                .filter_map(|s| s["signature"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// One page of an account's successful transactions, newest first, older than
/// `before` when given: (signature, block time, slot, succeeded). Failed transactions are
/// kept so the caller can page past them. None when the call failed.
pub async fn signatures_page(http: &reqwest::Client, url: &str, account: &str, before: Option<&str>, limit: usize) -> Option<Vec<(String, i64, u64, bool)>> {
    let mut opts = json!({ "limit": limit, "commitment": "confirmed" });
    if let Some(b) = before {
        opts["before"] = json!(b);
    }
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [account, opts] });
    let v = call(http, url, &body).await?;
    Some(
        v["result"]
            .as_array()?
            .iter()
            .filter_map(|s| Some((s["signature"].as_str()?.to_string(), s["blockTime"].as_i64().unwrap_or(0), s["slot"].as_u64().unwrap_or(0), s["err"].is_null())))
            .collect(),
    )
}

/// Full transactions in one batch call (keep batches small on the free plan).
/// Missing ones (not yet visible at "confirmed", or rate limited) come back as None.
pub async fn transactions(
    http: &reqwest::Client,
    url: &str,
    sigs: &[String],
) -> Vec<Option<Value>> {
    let batch: Vec<Value> = sigs
        .iter()
        .enumerate()
        .map(|(i, s)| {
            json!({ "jsonrpc": "2.0", "id": i, "method": "getTransaction",
                    "params": [s, { "maxSupportedTransactionVersion": 1, "encoding": "json", "commitment": "confirmed" }] })
        })
        .collect();
    let mut out = vec![None; sigs.len()];
    if let Some(Value::Array(replies)) = call(http, url, &Value::Array(batch)).await {
        for r in replies {
            if let Some(i) = r["id"].as_u64().map(|i| i as usize) {
                if i < out.len() && r["result"].is_object() {
                    out[i] = Some(r["result"].clone());
                }
            }
        }
    }
    out
}

/// Block times of an account's latest transactions (all of them, failed included),
/// newest first: how fast a wallet really trades across the whole chain.
pub async fn signature_times(http: &reqwest::Client, url: &str, account: &str, limit: usize) -> Option<Vec<i64>> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [account, { "limit": limit, "commitment": "confirmed" }] });
    let v = call(http, url, &body).await?;
    Some(v["result"].as_array()?.iter().filter_map(|s| s["blockTime"].as_i64()).collect())
}

/// An account's latest successful signatures with their block times (newest first),
/// and the block times of all of them (failed too), from one call.
pub async fn signatures_with_times(http: &reqwest::Client, url: &str, account: &str, limit: usize) -> Option<(Vec<String>, Vec<i64>)> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [account, { "limit": limit, "commitment": "confirmed" }] });
    let v = call(http, url, &body).await?;
    let all = v["result"].as_array()?;
    let times = all.iter().filter_map(|s| s["blockTime"].as_i64()).collect();
    let ok = all.iter().filter(|s| s["err"].is_null()).filter_map(|s| s["signature"].as_str().map(String::from)).collect();
    Some((ok, times))
}
