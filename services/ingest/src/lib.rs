//! MONEXA ingest: real-time Solana data engine, built on our own decoders.
//!
//! One Helius WebSocket connection carries:
//! - one subscription to pump.fun's mint authority (new tokens only), and
//! - one subscription per tracked token's bonding curve (its trades only).
//! Dead tokens are dropped and unsubscribed, so data usage follows what Sol Radar
//! actually shows (ADR 0003, ADR 0004). Nothing is persisted.

pub mod market;
pub mod pumpfun;
pub mod sol_price;

use anyhow::{bail, Context, Result};
use futures_util::{stream::SplitSink, SinkExt, StreamExt};
use market::{MarketSnapshot, Tracker};
use pumpfun::{Event, NewToken};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{net::TcpStream, sync::broadcast};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

const PING_EVERY: Duration = Duration::from_secs(30);
/// If no message arrives in this window the connection is treated as dead.
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const FLUSH_EVERY: Duration = Duration::from_secs(1);
const PRUNE_EVERY: Duration = Duration::from_secs(15);
const DEDUP_CAPACITY: usize = 100_000;
const CREATES_REQUEST_ID: u64 = 1;

type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

/// What the gateway receives.
#[derive(Debug, Clone)]
pub enum IngestEvent {
    Created(NewToken),
    Market { sol_usd: Option<f64>, items: Vec<MarketSnapshot> },
    Removed(Vec<String>),
}

/// Live counters used to measure Helius data usage (credits are billed per MB streamed).
#[derive(Default)]
pub struct IngestStats {
    pub bytes_received: AtomicU64,
    pub messages_received: AtomicU64,
    pub tokens_detected: AtomicU64,
    pub trades_decoded: AtomicU64,
    pub tracked: AtomicU64,
    pub reconnects: AtomicU64,
    pub connected: AtomicBool,
    /// Failed transactions are streamed (logsSubscribe cannot filter them) and dropped.
    pub failed_txs: AtomicU64,
    pub failed_bytes: AtomicU64,
}

#[derive(Serialize)]
pub struct StatsSnapshot {
    pub connected: bool,
    pub bytes_received: u64,
    pub messages_received: u64,
    pub tokens_detected: u64,
    pub trades_decoded: u64,
    pub tracked: u64,
    pub reconnects: u64,
    pub failed_txs: u64,
    pub failed_bytes: u64,
}

impl IngestStats {
    pub fn snapshot(&self) -> StatsSnapshot {
        let l = |a: &AtomicU64| a.load(Ordering::Relaxed);
        StatsSnapshot {
            connected: self.connected.load(Ordering::Relaxed),
            bytes_received: l(&self.bytes_received),
            messages_received: l(&self.messages_received),
            tokens_detected: l(&self.tokens_detected),
            trades_decoded: l(&self.trades_decoded),
            tracked: l(&self.tracked),
            reconnects: l(&self.reconnects),
            failed_txs: l(&self.failed_txs),
            failed_bytes: l(&self.failed_bytes),
        }
    }
}

/// Run the engine forever, reconnecting with exponential backoff.
/// Tracked tokens survive reconnects and are re-subscribed.
pub async fn run_forever(
    ws_url: String,
    rpc_url: String,
    out: broadcast::Sender<IngestEvent>,
    stats: Arc<IngestStats>,
) {
    let sol_usd: sol_price::SolPrice = Arc::default();
    tokio::spawn(sol_price::run(rpc_url, sol_usd.clone()));

    let mut engine = Engine { tracker: Tracker::default(), seen: Dedup::new(DEDUP_CAPACITY), sol_usd };
    let mut backoff = Duration::from_secs(1);
    loop {
        let mut subscribed = false;
        let result = engine.run_once(&ws_url, &out, &stats, &mut subscribed).await;
        stats.connected.store(false, Ordering::Relaxed);
        stats.reconnects.fetch_add(1, Ordering::Relaxed);
        engine.tracker.clear_subs();
        if subscribed {
            backoff = Duration::from_secs(1);
        }
        match result {
            Ok(()) => tracing::warn!(?backoff, "stream ended, reconnecting"),
            Err(err) => tracing::error!(error = %err, ?backoff, "stream error, reconnecting"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

struct Engine {
    tracker: Tracker,
    seen: Dedup,
    sol_usd: sol_price::SolPrice,
}

/// Per-connection subscription bookkeeping.
struct Subs {
    next_id: u64,
    /// request id -> mint, until the server answers with a subscription id
    pending: HashMap<u64, String>,
}

impl Subs {
    async fn subscribe(&mut self, tx: &mut WsSink, mint: String, account: &str) -> Result<()> {
        let id = self.next_id;
        self.next_id += 1;
        self.pending.insert(id, mint);
        send_logs_subscribe(tx, id, account).await
    }

    async fn unsubscribe(&mut self, tx: &mut WsSink, sub_id: u64) -> Result<()> {
        let id = self.next_id;
        self.next_id += 1;
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": "logsUnsubscribe", "params": [sub_id] });
        tx.send(Message::Text(msg.to_string().into())).await?;
        Ok(())
    }
}

async fn send_logs_subscribe(tx: &mut WsSink, id: u64, account: &str) -> Result<()> {
    let msg = json!({
        "jsonrpc": "2.0", "id": id, "method": "logsSubscribe",
        "params": [{ "mentions": [account] }, { "commitment": "confirmed" }]
    });
    tx.send(Message::Text(msg.to_string().into())).await?;
    Ok(())
}

impl Engine {
    async fn run_once(
        &mut self,
        url: &str,
        out: &broadcast::Sender<IngestEvent>,
        stats: &IngestStats,
        subscribed: &mut bool,
    ) -> Result<()> {
        let (ws, _) = connect_async(url).await.context("websocket connect failed")?;
        let (mut tx, mut rx) = ws.split();

        send_logs_subscribe(&mut tx, CREATES_REQUEST_ID, pumpfun::MINT_AUTHORITY).await?;
        let mut subs = Subs { next_id: CREATES_REQUEST_ID + 1, pending: HashMap::new() };
        for (mint, curve) in self.tracker.targets() {
            subs.subscribe(&mut tx, mint, &curve).await?;
        }
        tracing::info!(resubscribed = self.tracker.len(), "subscribed to pump.fun creates");
        *subscribed = true;
        stats.connected.store(true, Ordering::Relaxed);

        let mut ping = tokio::time::interval(PING_EVERY);
        let mut flush = tokio::time::interval(FLUSH_EVERY);
        let mut prune = tokio::time::interval(PRUNE_EVERY);

        loop {
            tokio::select! {
                _ = ping.tick() => tx.send(Message::Ping(Vec::new().into())).await?,

                _ = flush.tick() => {
                    let items = self.tracker.take_dirty(now_secs(), sol_price::read(&self.sol_usd));
                    if !items.is_empty() {
                        let _ = out.send(IngestEvent::Market { sol_usd: sol_price::read(&self.sol_usd), items });
                    }
                }

                _ = prune.tick() => {
                    let removed = self.tracker.prune(now_secs());
                    for (_, sub) in &removed {
                        if let Some(id) = sub {
                            subs.unsubscribe(&mut tx, *id).await?;
                        }
                    }
                    stats.tracked.store(self.tracker.len() as u64, Ordering::Relaxed);
                    if !removed.is_empty() {
                        let _ = out.send(IngestEvent::Removed(removed.into_iter().map(|(m, _)| m).collect()));
                    }
                }

                msg = tokio::time::timeout(IDLE_TIMEOUT, rx.next()) => {
                    let msg = match msg {
                        Err(_) => bail!("no data for {IDLE_TIMEOUT:?}"),
                        Ok(None) => return Ok(()),
                        Ok(Some(m)) => m?,
                    };
                    match msg {
                        Message::Text(text) => {
                            stats.bytes_received.fetch_add(text.len() as u64, Ordering::Relaxed);
                            stats.messages_received.fetch_add(1, Ordering::Relaxed);
                            self.handle(&text, &mut tx, &mut subs, out, stats).await?;
                        }
                        Message::Close(frame) => bail!("server closed connection: {frame:?}"),
                        _ => {}
                    }
                }
            }
        }
    }

    async fn handle(
        &mut self,
        text: &str,
        tx: &mut WsSink,
        subs: &mut Subs,
        out: &broadcast::Sender<IngestEvent>,
        stats: &IngestStats,
    ) -> Result<()> {
        let Ok(v) = serde_json::from_str::<Value>(text) else { return Ok(()) };

        // Replies to our subscribe/unsubscribe requests.
        if let Some(id) = v.get("id").and_then(Value::as_u64) {
            if let Some(err) = v.get("error") {
                tracing::error!(id, %err, "rpc error");
                subs.pending.remove(&id);
            } else if let (Some(mint), Some(sub_id)) = (subs.pending.remove(&id), v.get("result").and_then(Value::as_u64)) {
                self.tracker.set_sub(&mint, sub_id);
            }
            return Ok(());
        }

        let Some(value) = v.pointer("/params/result/value") else { return Ok(()) };
        // Failed transactions still emit logs; never treat them as real activity.
        if !value.get("err").is_some_and(Value::is_null) {
            stats.failed_txs.fetch_add(1, Ordering::Relaxed);
            stats.failed_bytes.fetch_add(text.len() as u64, Ordering::Relaxed);
            return Ok(());
        }
        let Some(sig) = value.get("signature").and_then(Value::as_str) else { return Ok(()) };
        let Some(logs) = value.get("logs").and_then(Value::as_array) else { return Ok(()) };
        let logs: Vec<String> = logs.iter().filter_map(|l| l.as_str().map(String::from)).collect();

        // A create with a dev buy arrives on two subscriptions; dedupe per event.
        for (i, event) in pumpfun::parse_events(sig, &logs).into_iter().enumerate() {
            if !self.seen.insert(&format!("{sig}:{i}")) {
                continue;
            }
            match event {
                Event::Create(token) => {
                    stats.tokens_detected.fetch_add(1, Ordering::Relaxed);
                    if self.tracker.add(token.clone()) {
                        subs.subscribe(tx, token.mint.clone(), &token.bonding_curve).await?;
                        let _ = out.send(IngestEvent::Created(token));
                    }
                }
                Event::Trade(trade) => {
                    stats.trades_decoded.fetch_add(1, Ordering::Relaxed);
                    self.tracker.apply_trade(&trade);
                }
                Event::Complete { mint } => self.tracker.complete(&mint, now_secs()),
            }
        }
        Ok(())
    }
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Bounded set of recently seen keys (duplicate event handling across subscriptions).
struct Dedup {
    set: HashSet<String>,
    order: VecDeque<String>,
    cap: usize,
}

impl Dedup {
    fn new(cap: usize) -> Self {
        Self { set: HashSet::new(), order: VecDeque::new(), cap }
    }
    fn insert(&mut self, key: &str) -> bool {
        if !self.set.insert(key.to_string()) {
            return false;
        }
        self.order.push_back(key.to_string());
        if self.order.len() > self.cap {
            if let Some(old) = self.order.pop_front() {
                self.set.remove(&old);
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_rejects_repeats_and_evicts_oldest() {
        let mut d = Dedup::new(2);
        assert!(d.insert("a"));
        assert!(!d.insert("a"));
        assert!(d.insert("b"));
        assert!(d.insert("c")); // evicts "a"
        assert!(d.insert("a"));
    }
}
