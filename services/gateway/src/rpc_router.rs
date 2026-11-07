//! Kixo's own Solana RPC router. Every RPC call in the gateway (and the ingest engine it
//! runs) goes through it: Helius first, and when Helius fails or its quota is used up,
//! the same request goes to our fallback nodes (FALLBACK_RPC_URLS, or Solana's public
//! node). Helius-only methods (getAsset, searchAssets, getPriorityFeeEstimate) have their
//! own fallbacks where they are used.
//!
//! The router listens on 127.0.0.1 only, on a random port: nothing outside this machine
//! can reach it. It probes Helius every minute and returns to it as soon as it answers.

use axum::{body::Bytes, extract::State, http::StatusCode, response::IntoResponse, routing::post, Router};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// Benches: how long a node is skipped after a failure.
const QUOTA_BENCH: Duration = Duration::from_secs(15 * 60);
const RATE_BENCH: Duration = Duration::from_secs(3);
const DOWN_BENCH: Duration = Duration::from_secs(20);
/// Requests per second sent to a fallback node (Solana's public node allows about 10).
const FALLBACK_RPS: usize = 8;

pub struct Upstream {
    pub name: String,
    url: String,
    primary: bool,
    bench: Mutex<Option<(Instant, String)>>,
    sent: Mutex<VecDeque<Instant>>,
    served: std::sync::atomic::AtomicU64,
}

pub struct Router_ {
    http: reqwest::Client,
    upstreams: Vec<Upstream>,
}
pub type RouterState = Arc<Router_>;

fn node(name: &str, url: String, primary: bool) -> Upstream {
    Upstream { name: name.to_string(), url, primary, bench: Mutex::new(None), sent: Mutex::new(VecDeque::new()), served: 0.into() }
}

/// Starts the router and returns its local address.
pub async fn start(config: &monexa_common::Config) -> anyhow::Result<(String, RouterState)> {
    let mut upstreams = vec![node("helius", config.helius_direct_rpc_url(), true)];
    for (i, u) in monexa_common::fallback_rpc_urls().into_iter().enumerate() {
        let name = if u == monexa_common::PUBLIC_RPC { "solana-public".to_string() } else { format!("fallback-{}", i + 1) };
        upstreams.push(node(&name, u, false));
    }
    let state = Arc::new(Router_ { http: reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent("kixo-gateway/0.1").build()?, upstreams });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let app = Router::new().route("/", post(forward)).with_state(state.clone());
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(%e, "rpc router stopped");
        }
    });
    tokio::spawn(probe(state.clone()));
    tracing::info!(%addr, nodes = state.upstreams.len(), "rpc router: Helius first, fallback nodes behind it");
    Ok((format!("http://{addr}/"), state))
}

impl Upstream {
    fn benched(&self) -> Option<String> {
        let mut b = self.bench.lock().expect("bench lock");
        match b.as_ref() {
            Some((until, why)) if Instant::now() < *until => Some(why.clone()),
            Some(_) => {
                *b = None;
                None
            }
            None => None,
        }
    }
    fn bench(&self, d: Duration, why: &str) {
        *self.bench.lock().expect("bench lock") = Some((Instant::now() + d, why.to_string()));
        if self.primary {
            monexa_common::set_primary_up(false);
        }
    }

    /// Waits for room under the node's rate (fallback nodes only), at most ~2 s.
    async fn pace(&self, weight: usize) -> bool {
        if self.primary {
            return true;
        }
        let weight = weight.clamp(1, FALLBACK_RPS);
        for _ in 0..40 {
            {
                let mut sent = self.sent.lock().expect("pace lock");
                while sent.front().is_some_and(|t| t.elapsed() >= Duration::from_secs(1)) {
                    sent.pop_front();
                }
                if sent.len() + weight <= FALLBACK_RPS {
                    sent.extend(std::iter::repeat_n(Instant::now(), weight));
                    return true;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        false
    }
}

/// What to do with one node's answer.
#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// Pass it back to the caller.
    Answer,
    /// Skip this node for a while and try the next.
    Bench(Duration, &'static str),
}

/// Reads a node's answer: quota exhausted, rate limited, broken or fine.
pub fn verdict(status: u16, body: &str) -> Verdict {
    let lower = body.to_lowercase();
    if status == 429 && (lower.contains("max usage") || lower.contains("credits")) {
        Verdict::Bench(QUOTA_BENCH, "quota used up")
    } else if status == 429 {
        Verdict::Bench(RATE_BENCH, "rate limited")
    } else if status == 401 || status == 403 {
        Verdict::Bench(QUOTA_BENCH, "refused (key)")
    } else if status >= 500 {
        Verdict::Bench(DOWN_BENCH, "server error")
    } else {
        Verdict::Answer
    }
}

async fn forward(State(r): State<RouterState>, body: Bytes) -> impl IntoResponse {
    let weight = serde_json::from_slice::<Value>(&body).ok().and_then(|v| v.as_array().map(Vec::len)).unwrap_or(1);
    let mut last = (StatusCode::SERVICE_UNAVAILABLE, json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32000, "message": "no Solana node available" } }).to_string());
    // Healthy nodes in order; if every node is benched, try them all anyway.
    let mut order: Vec<&Upstream> = r.upstreams.iter().filter(|u| u.benched().is_none()).collect();
    if order.is_empty() {
        order = r.upstreams.iter().collect();
    }
    for u in order {
        if !u.pace(weight).await {
            continue;
        }
        let res = r.http.post(&u.url).header("content-type", "application/json").body(body.clone()).send().await;
        match res {
            Ok(res) => {
                let status = res.status().as_u16();
                let text = res.text().await.unwrap_or_default();
                match verdict(status, &text) {
                    Verdict::Answer => {
                        u.served.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        return (StatusCode::from_u16(status).unwrap_or(StatusCode::OK), text);
                    }
                    Verdict::Bench(d, why) => {
                        if u.benched().is_none() {
                            tracing::warn!(node = u.name, why, "rpc router: switching node");
                        }
                        u.bench(d, why);
                        last = (StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY), text);
                    }
                }
            }
            Err(_) => u.bench(DOWN_BENCH, "unreachable"),
        }
    }
    last
}

/// Asks Helius for the slot every minute while it is benched, and takes it back as the
/// main node the moment it answers.
async fn probe(r: RouterState) {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSlot" }).to_string();
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        let Some(primary) = r.upstreams.iter().find(|u| u.primary) else { continue };
        if primary.bench.lock().expect("bench lock").is_none() {
            monexa_common::set_primary_up(true);
            continue;
        }
        let ok = match r.http.post(&primary.url).header("content-type", "application/json").body(body.clone()).send().await {
            Ok(res) => {
                let status = res.status().as_u16();
                let text = res.text().await.unwrap_or_default();
                verdict(status, &text) == Verdict::Answer && text.contains("\"result\"")
            }
            Err(_) => false,
        };
        if ok {
            *primary.bench.lock().expect("bench lock") = None;
            monexa_common::set_primary_up(true);
            tracing::info!("rpc router: Helius is back, using it again");
        }
    }
}

/// Which node serves now and why others are skipped, for /health.
pub fn status(r: &RouterState) -> Value {
    let active = r.upstreams.iter().find(|u| u.benched().is_none()).map(|u| u.name.clone());
    json!({
        "active": active,
        "nodes": r.upstreams.iter().map(|u| json!({
            "name": u.name,
            "skipped": u.benched(),
            "served": u.served.load(std::sync::atomic::Ordering::Relaxed),
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_are_read_right() {
        assert_eq!(verdict(429, "max usage reached"), Verdict::Bench(QUOTA_BENCH, "quota used up"));
        assert_eq!(verdict(429, "Too many requests"), Verdict::Bench(RATE_BENCH, "rate limited"));
        assert_eq!(verdict(401, "invalid api key"), Verdict::Bench(QUOTA_BENCH, "refused (key)"));
        assert_eq!(verdict(503, ""), Verdict::Bench(DOWN_BENCH, "server error"));
        // A JSON-RPC error (e.g. a method one node lacks) still goes back to the caller.
        assert_eq!(verdict(200, r#"{"error":{"code":-32601}}"#), Verdict::Answer);
        assert_eq!(verdict(200, r#"{"result":1}"#), Verdict::Answer);
    }
}
