//! One shared tracker for every real trade in flight, so a thousand traders cost about
//! the same RPC as ten.
//!
//! Every 400 ms it asks for the status of all pending signatures at once
//! (`getSignatureStatuses` takes 256 per call), so 1,000 open trades cost 4 calls a tick
//! instead of 1,000. The block height is read once every 2 s for all of them. Re-sends go
//! straight to the leaders through Kixo Sender, many transactions on the same
//! connections, within a budget so validators never see a flood from us. The RPC is
//! used for re-sends only when the direct path could not reach anyone.

use crate::sender::SenderState;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicU64, Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

pub const TICK: Duration = Duration::from_millis(400);
/// `getSignatureStatuses` accepts up to 256 signatures per call.
const STATUS_BATCH: usize = 256;
/// Direct re-sends every other tick (800 ms), at most this many transactions each time.
const DIRECT_BUDGET: usize = 300;
/// RPC re-sends every 5 ticks (2 s), at most this many, and only for trades the direct
/// path could not deliver.
const RPC_BUDGET: usize = 20;
/// A trade not settled after this long is left as sent.
const GIVE_UP: Duration = Duration::from_secs(120);

pub struct Item {
    pub sig: String,
    /// The signed transaction, base64 (for RPC) and raw (for QUIC).
    pub raw: String,
    pub tx: Vec<u8>,
    pub last_valid: u64,
    pub started: Instant,
    resends: u32,
    direct_ok: bool,
}

impl Item {
    pub fn new(sig: String, raw: String, tx: Vec<u8>, last_valid: u64, started: Instant, direct_ok: bool) -> Self {
        Self { sig, raw, tx, last_valid, started, resends: 0, direct_ok }
    }
}

#[derive(Debug)]
pub enum Outcome {
    /// Landed (successfully or not: `err` is null on success).
    Landed { sig: String, slot: Option<u64>, err: Value, latency_ms: u64, resends: u32 },
    /// The blockhash expired and the chain never saw it: nothing was spent.
    Expired { sig: String },
    /// Still unknown after two minutes.
    GaveUp { sig: String },
}

pub struct Tracker {
    http: reqwest::Client,
    rpc_url: String,
    sender: SenderState,
    direct_on: Box<dyn Fn() -> bool + Send + Sync>,
    items: Mutex<HashMap<String, Item>>,
    out: mpsc::UnboundedSender<Outcome>,
    /// RPC calls made, for health and the load test.
    pub rpc_calls: AtomicU64,
}

pub type TrackerState = Arc<Tracker>;

impl Tracker {
    pub fn new(http: reqwest::Client, rpc_url: String, sender: SenderState, direct_on: Box<dyn Fn() -> bool + Send + Sync>) -> (TrackerState, mpsc::UnboundedReceiver<Outcome>) {
        let (out, rx) = mpsc::unbounded_channel();
        (Arc::new(Self { http, rpc_url, sender, direct_on, items: Mutex::new(HashMap::new()), out, rpc_calls: 0.into() }), rx)
    }

    pub fn add(&self, item: Item) {
        self.items.lock().expect("items lock").insert(item.sig.clone(), item);
    }

    pub fn pending(&self) -> usize {
        self.items.lock().expect("items lock").len()
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        self.rpc_calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let v: Value = self.http.post(&self.rpc_url).json(&body).timeout(Duration::from_secs(6)).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        match v.get("error") {
            Some(e) => Err(e.to_string()),
            None => Ok(v["result"].clone()),
        }
    }

    /// Statuses for `sigs`, in order (null where unknown or when a batch failed).
    async fn statuses(&self, sigs: &[String], history: bool) -> Vec<Value> {
        let calls = sigs.chunks(STATUS_BATCH).map(|chunk| async move {
            match self.rpc("getSignatureStatuses", json!([chunk, { "searchTransactionHistory": history }])).await {
                Ok(v) => v["value"].as_array().cloned().unwrap_or_default(),
                Err(_) => vec![Value::Null; chunk.len()],
            }
        });
        futures_util::future::join_all(calls).await.into_iter().flatten().collect()
    }

    fn take(&self, sig: &str) -> Option<Item> {
        self.items.lock().expect("items lock").remove(sig)
    }

    pub async fn tick(&self, n: u64) {
        let sigs: Vec<String> = self.items.lock().expect("items lock").keys().cloned().collect();
        if sigs.is_empty() {
            return;
        }
        // 1. Who landed.
        let st = self.statuses(&sigs, false).await;
        for (sig, s) in sigs.iter().zip(st.iter()) {
            if matches!(s["confirmationStatus"].as_str(), Some("confirmed" | "finalized")) {
                if let Some(it) = self.take(sig) {
                    let _ = self.out.send(Outcome::Landed { sig: sig.clone(), slot: s["slot"].as_u64(), err: s["err"].clone(), latency_ms: it.started.elapsed().as_millis() as u64, resends: it.resends });
                }
            }
        }
        // 2. Who expired (one height read for all), after one last look at the history.
        if n.is_multiple_of(5) {
            let height = self.rpc("getBlockHeight", json!([{ "commitment": "confirmed" }])).await.ok().and_then(|v| v.as_u64());
            if let Some(h) = height {
                let old: Vec<String> = self.items.lock().expect("items lock").values().filter(|i| h > i.last_valid).map(|i| i.sig.clone()).collect();
                if !old.is_empty() {
                    let again = self.statuses(&old, true).await;
                    for (sig, s) in old.iter().zip(again.iter()) {
                        if s.is_null() && self.take(sig).is_some() {
                            let _ = self.out.send(Outcome::Expired { sig: sig.clone() });
                        }
                    }
                }
            }
            let stale: Vec<String> = self.items.lock().expect("items lock").values().filter(|i| i.started.elapsed() > GIVE_UP).map(|i| i.sig.clone()).collect();
            for sig in stale {
                if self.take(&sig).is_some() {
                    let _ = self.out.send(Outcome::GaveUp { sig });
                }
            }
        }
        // 3. Re-send straight to the leaders, least re-sent first, within the budget.
        let direct = (self.direct_on)();
        if direct && n.is_multiple_of(2) {
            let batch: Vec<(String, Vec<u8>)> = {
                let mut items = self.items.lock().expect("items lock");
                let mut v: Vec<&mut Item> = items.values_mut().collect();
                v.sort_by_key(|i| i.resends);
                v.into_iter()
                    .take(DIRECT_BUDGET)
                    .map(|i| {
                        i.resends += 1;
                        (i.sig.clone(), i.tx.clone())
                    })
                    .collect()
            };
            if !batch.is_empty() {
                let txs: Vec<&[u8]> = batch.iter().map(|(_, t)| t.as_slice()).collect();
                let r = self.sender.send_many(&txs, Instant::now()).await;
                let ok = r.reached > 0;
                let mut items = self.items.lock().expect("items lock");
                for (sig, _) in &batch {
                    if let Some(i) = items.get_mut(sig) {
                        i.direct_ok = ok;
                    }
                }
            }
        }
        // 4. The RPC only for what the direct path could not deliver.
        if n.is_multiple_of(5) {
            let fallback: Vec<String> = self.items.lock().expect("items lock").values().filter(|i| !direct || !i.direct_ok).take(RPC_BUDGET).map(|i| i.raw.clone()).collect();
            let sends = fallback.iter().map(|raw| self.rpc("sendTransaction", json!([raw, { "encoding": "base64", "skipPreflight": true, "maxRetries": 0 }])));
            futures_util::future::join_all(sends).await;
        }
    }
}

pub async fn run(t: TrackerState) {
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut n = 0u64;
    loop {
        tick.tick().await;
        n += 1;
        t.tick(n).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, routing::post, Json, Router};

    /// A fake RPC: every signature is confirmed from the third status check on.
    async fn fake_rpc(State(seen): State<Arc<Mutex<HashMap<String, u32>>>>, Json(req): Json<Value>) -> Json<Value> {
        let result = match req["method"].as_str() {
            Some("getSignatureStatuses") => {
                let mut seen = seen.lock().unwrap();
                let v: Vec<Value> = req["params"][0]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| {
                        let n = seen.entry(s.as_str().unwrap().to_string()).or_insert(0);
                        *n += 1;
                        if *n >= 3 {
                            json!({ "slot": 100, "confirmationStatus": "confirmed", "err": null })
                        } else {
                            Value::Null
                        }
                    })
                    .collect();
                json!({ "value": v })
            }
            Some("getBlockHeight") => json!(1),
            _ => json!("ok"),
        };
        Json(json!({ "jsonrpc": "2.0", "id": 1, "result": result }))
    }

    /// 1,000 trades in flight at once: each settles, and the RPC calls stay batched.
    #[tokio::test]
    async fn a_thousand_trades_cost_a_handful_of_calls() {
        let seen = Arc::new(Mutex::new(HashMap::new()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, Router::new().route("/", post(fake_rpc)).with_state(seen)).await.unwrap() });
        let sender = crate::sender::Sender::new(reqwest::Client::new(), url.clone());
        let (t, mut rx) = Tracker::new(reqwest::Client::new(), url, sender, Box::new(|| false));
        for i in 0..1000 {
            t.add(Item::new(format!("sig{i}"), String::new(), vec![], 10, Instant::now(), false));
        }
        for n in 1..=3 {
            t.tick(n).await;
        }
        assert_eq!(t.pending(), 0);
        let mut landed = 0;
        while let Ok(o) = rx.try_recv() {
            assert!(matches!(o, Outcome::Landed { .. }));
            landed += 1;
        }
        assert_eq!(landed, 1000);
        // 3 ticks x 4 batches of 256: 12 calls for 1,000 trades.
        let calls = t.rpc_calls.load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(calls, 12, "status calls must be batched");
    }
}
