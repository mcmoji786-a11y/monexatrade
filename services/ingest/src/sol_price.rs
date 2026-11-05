//! SOL/USD from our own chain reads: the vault balances of Raydium's largest
//! SOL/USDC AMM v4 pool (58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2).
//! Vault addresses were read from that pool account's data at offsets 336 and 368
//! and verified on-chain (mints So111… and EPjFW…) on 2026-11-05.

use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

const SOL_VAULT: &str = "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz";
const USDC_VAULT: &str = "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz";
/// One RPC call per interval keeps us far under the Free plan's 10 req/s.
const INTERVAL: Duration = Duration::from_secs(20);

/// Latest SOL price in micro-USD (0 = unknown yet).
pub type SolPrice = Arc<AtomicU64>;

pub fn read(p: &SolPrice) -> Option<f64> {
    match p.load(Ordering::Relaxed) {
        0 => None,
        v => Some(v as f64 / 1_000_000.0),
    }
}

pub async fn run(rpc_url: String, out: SolPrice) {
    let http = match reqwest::Client::builder().timeout(Duration::from_secs(5)).build() {
        Ok(c) => c,
        Err(err) => return tracing::error!(%err, "sol price client"),
    };
    let mut tick = tokio::time::interval(INTERVAL);
    loop {
        tick.tick().await;
        match fetch(&http, &rpc_url).await {
            Some(price) if (1.0..100_000.0).contains(&price) => {
                out.store((price * 1_000_000.0) as u64, Ordering::Relaxed);
            }
            other => tracing::warn!(?other, "sol price unavailable this round"),
        }
    }
}

async fn fetch(http: &reqwest::Client, rpc_url: &str) -> Option<f64> {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "getMultipleAccounts",
        "params": [[SOL_VAULT, USDC_VAULT], { "encoding": "jsonParsed" }]
    });
    let v: Value = http.post(rpc_url).json(&body).send().await.ok()?.json().await.ok()?;
    let accounts = v.pointer("/result/value")?.as_array()?;
    let amount = |i: usize| {
        accounts.get(i)?.pointer("/data/parsed/info/tokenAmount/uiAmount")?.as_f64()
    };
    let (sol, usdc) = (amount(0)?, amount(1)?);
    (sol > 0.0).then(|| usdc / sol)
}
