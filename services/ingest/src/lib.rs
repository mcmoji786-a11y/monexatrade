//! Kixo ingest: real-time Solana data engine, built on our own decoders.
//!
//! One Helius WebSocket connection carries:
//! - one subscription to pump.fun's mint authority (new tokens only), and
//! - one subscription per tracked token's bonding curve (its trades only).
//! Dead tokens are dropped and unsubscribed, so data usage follows what Sol Radar
//! actually shows (ADR 0003, ADR 0004). Nothing is persisted.

pub mod launches;
pub mod launchlab;
pub mod logs;
pub mod market;
pub mod moonshot;
pub mod pumpfun;
pub mod pumpswap;
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
use tokio::{
    net::TcpStream,
    sync::{broadcast, mpsc},
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

const PING_EVERY: Duration = Duration::from_secs(30);
/// If no message arrives in this window the connection is treated as dead.
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const FLUSH_EVERY: Duration = Duration::from_secs(1);
const PRUNE_EVERY: Duration = Duration::from_secs(15);
const DEDUP_CAPACITY: usize = 100_000;
const CREATES_REQUEST_ID: u64 = 1;
/// On fallback nodes: one subscription to every pump.fun trade (see `program_wide`).
const PUMP_TRADES_REQUEST_ID: u64 = 1_000_000;
/// Request ids 2.. subscribe to the other launchpads (launches::SOURCES).
const LAUNCH_REQUEST_ID: u64 = 2;
/// Parallel transaction reads for new non-pump.fun coins (2 Helius calls each).
const RESOLVE_CONCURRENCY: usize = 3;

type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

/// What the gateway receives.
#[derive(Debug, Clone)]
pub enum IngestEvent {
    Created(NewToken),
    /// A coin created outside pump.fun (launches.rs). No curve is tracked for it; its
    /// market figures come from the gateway's market provider.
    Launched(NewToken),
    Market { sol_usd: Option<f64>, items: Vec<MarketSnapshot> },
    Removed(Vec<String>),
    /// Every decoded, successful trade on a tracked curve, with its transaction.
    /// `slot`: the block it landed in, when the stream reports it (bundle detection).
    Trade { signature: String, trade: pumpfun::Trade, slot: Option<u64> },
    /// A successful transaction on a watched pool whose program does not log its
    /// trades (Raydium, Orca, Meteora...): the gateway fetches and decodes it.
    PoolTx { mint: String, signature: String },
}

/// Requests from the gateway. Pools are watched only while someone has the coin's trade
/// page open, so Helius streams just the pools people are looking at.
#[derive(Debug, Clone)]
pub enum IngestCommand {
    /// Stream a pool's transactions for `mint`. `decode_logs`: the pool is PumpSwap,
    /// whose trades are decoded straight from the logs; otherwise each transaction is
    /// reported as `PoolTx` for the gateway to fetch.
    WatchPool { pool: String, mint: String, decode_logs: bool },
    UnwatchPool { pool: String },
}

/// Prefix that marks a pending subscription as a pool rather than a curve.
const POOL_KEY: &str = "pool:";

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
///
/// `ws_urls` lists the live-stream nodes in order of preference (Helius first, then our
/// fallbacks). When a node cannot be reached the next one is used; while on a fallback,
/// the engine returns to the first node as soon as Helius answers again.
pub async fn run_forever(
    ws_urls: Vec<String>,
    rpc_url: String,
    out: broadcast::Sender<IngestEvent>,
    stats: Arc<IngestStats>,
    mut commands: mpsc::UnboundedReceiver<IngestCommand>,
) {
    let sol_usd: sol_price::SolPrice = Arc::default();
    tokio::spawn(sol_price::run(rpc_url.clone(), sol_usd.clone()));

    let http = reqwest::Client::new();
    let (launched_tx, launched_rx) = mpsc::unbounded_channel();
    let mut engine = Engine {
        tracker: Tracker::default(),
        seen: Dedup::new(DEDUP_CAPACITY),
        sol_usd,
        pools: HashMap::new(),
        rpc_url,
        http,
        resolving: Arc::new(tokio::sync::Semaphore::new(RESOLVE_CONCURRENCY)),
        launched_tx,
        launched_rx,
        lab_pools: HashMap::new(),
        moon_curves: HashMap::new(),
        program_wide: false,
    };
    let mut backoff = Duration::from_secs(1);
    let nodes = ws_urls.len().max(1);
    let mut idx = 0usize;
    loop {
        let mut subscribed = false;
        let on_fallback = idx % nodes != 0;
        let url = ws_urls.get(idx % nodes).cloned().unwrap_or_default();
        if on_fallback {
            tracing::warn!(node = idx % nodes, "live stream on a fallback node");
        }
        let started = std::time::Instant::now();
        let result = engine.run_once(&url, on_fallback, &out, &stats, &mut subscribed, &mut commands).await;
        stats.connected.store(false, Ordering::Relaxed);
        stats.reconnects.fetch_add(1, Ordering::Relaxed);
        engine.tracker.clear_subs();
        for w in engine.pools.values_mut() {
            w.sub_id = None;
        }
        // Only a connection that held for a while counts as healthy: one the node closes
        // right after subscribing must back off, or we would hammer it (and get banned).
        if subscribed && started.elapsed() > Duration::from_secs(30) {
            backoff = Duration::from_secs(1);
        }
        let unsupported = matches!(&result, Err(e) if e.to_string().contains("does not support"));
        // A node that drops us seconds after subscribing (out of quota, "upstream went
        // away") is as good as down: try the next one.
        let dropped_fast = subscribed && started.elapsed() < Duration::from_secs(10);
        match result {
            Ok(()) => tracing::warn!(?backoff, "stream ended, reconnecting"),
            Err(err) => tracing::error!(error = %err, ?backoff, "stream error, reconnecting"),
        }
        if on_fallback && monexa_common::primary_up() {
            // Helius answers again: go back to it.
            idx = 0;
            backoff = Duration::from_secs(1);
        } else if (!subscribed || unsupported || dropped_fast) && nodes > 1 {
            // This node could not be reached, or cannot stream logs: the next one now.
            idx += 1;
            backoff = Duration::from_secs(1);
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

struct Engine {
    tracker: Tracker,
    seen: Dedup,
    sol_usd: sol_price::SolPrice,
    /// Watched PumpSwap pools: pool address -> coin and subscription.
    pools: HashMap<String, PoolWatch>,
    rpc_url: String,
    http: reqwest::Client,
    /// Bounds RPC reads for non-pump.fun creates during a launch burst.
    resolving: Arc<tokio::sync::Semaphore>,
    /// Resolved non-pump.fun coins, handed back from their RPC tasks.
    launched_tx: mpsc::UnboundedSender<NewToken>,
    launched_rx: mpsc::UnboundedReceiver<NewToken>,
    /// LaunchLab curve -> coin, for the coins we track.
    lab_pools: HashMap<String, String>,
    /// Moonshot curve -> coin.
    moon_curves: HashMap<String, String>,
    /// On a fallback node: one subscription to the whole pump.fun program instead of one
    /// per coin (Solana's public node closes a connection after 100 subscriptions), with
    /// trades kept only for the coins we track.
    program_wide: bool,
}

struct PoolWatch {
    mint: String,
    decode_logs: bool,
    sub_id: Option<u64>,
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
        on_fallback: bool,
        out: &broadcast::Sender<IngestEvent>,
        stats: &IngestStats,
        subscribed: &mut bool,
        commands: &mut mpsc::UnboundedReceiver<IngestCommand>,
    ) -> Result<()> {
        let (ws, _) = connect_async(url).await.context("websocket connect failed")?;
        let (mut tx, mut rx) = ws.split();

        send_logs_subscribe(&mut tx, CREATES_REQUEST_ID, pumpfun::MINT_AUTHORITY).await?;
        for (i, program) in launches::SOURCES.iter().enumerate() {
            send_logs_subscribe(&mut tx, LAUNCH_REQUEST_ID + i as u64, program).await?;
        }
        let mut subs = Subs { next_id: LAUNCH_REQUEST_ID + launches::SOURCES.len() as u64, pending: HashMap::new() };
        // Fallback nodes limit subscriptions: one program-wide stream there, one per coin
        // on Helius.
        self.program_wide = on_fallback;
        let gap = if on_fallback { Some(Duration::from_millis(250)) } else { None };
        if on_fallback {
            send_logs_subscribe(&mut tx, PUMP_TRADES_REQUEST_ID, pumpfun::PROGRAM_ID).await?;
        } else {
            for (mint, curve) in self.tracker.targets() {
                subs.subscribe(&mut tx, mint, &curve).await?;
            }
        }
        for pool in self.pools.keys() {
            subs.subscribe(&mut tx, format!("{POOL_KEY}{pool}"), pool).await?;
            if let Some(g) = gap {
                tokio::time::sleep(g).await;
            }
        }
        tracing::info!(resubscribed = self.tracker.len(), "subscribed to pump.fun creates");
        *subscribed = true;
        stats.connected.store(true, Ordering::Relaxed);

        let mut ping = tokio::time::interval(PING_EVERY);
        let mut flush = tokio::time::interval(FLUSH_EVERY);
        let mut prune = tokio::time::interval(PRUNE_EVERY);
        let mut primary_check = tokio::time::interval(Duration::from_secs(60));
        primary_check.tick().await;

        loop {
            tokio::select! {
                _ = ping.tick() => tx.send(Message::Ping(Vec::new().into())).await?,

                // On a fallback node, hand back to Helius once it answers again.
                _ = primary_check.tick(), if on_fallback => {
                    if monexa_common::primary_up() {
                        tracing::info!("Helius is back: moving the live stream to it");
                        return Ok(());
                    }
                },

                Some(cmd) = commands.recv() => match cmd {
                    IngestCommand::WatchPool { pool, mint, decode_logs } => {
                        if !self.pools.contains_key(&pool) {
                            subs.subscribe(&mut tx, format!("{POOL_KEY}{pool}"), &pool).await?;
                            self.pools.insert(pool, PoolWatch { mint, decode_logs, sub_id: None });
                        }
                    }
                    IngestCommand::UnwatchPool { pool } => {
                        if let Some(PoolWatch { sub_id: Some(id), .. }) = self.pools.remove(&pool) {
                            subs.unsubscribe(&mut tx, id).await?;
                        }
                    }
                },

                Some(mut token) = self.launched_rx.recv() => {
                    stats.tokens_detected.fetch_add(1, Ordering::Relaxed);
                    // LaunchLab curves are decoded from logs like pump.fun's, so the coin
                    // is tracked live. Others list with provider data for now.
                    let curve = match token.launchpad.as_str() {
                        "letsbonk.fun" | "raydium-launchlab" => launchlab::pool_of(&token.mint).map(|c| (c, true)),
                        "moonshot" => moonshot::curve_of(&token.mint).map(|c| (c, false)),
                        _ => None,
                    };
                    match curve {
                        Some((curve, lab)) => {
                            token.bonding_curve = curve.clone();
                            if self.tracker.add(token.clone()) {
                                let map = if lab { &mut self.lab_pools } else { &mut self.moon_curves };
                                map.insert(curve, token.mint.clone());
                                let _ = out.send(IngestEvent::Created(token));
                            }
                        }
                        None => {
                            let _ = out.send(IngestEvent::Launched(token));
                        }
                    }
                }

                _ = flush.tick() => {
                    let items = self.tracker.take_dirty(now_secs(), sol_price::read(&self.sol_usd));
                    if !items.is_empty() {
                        let _ = out.send(IngestEvent::Market { sol_usd: sol_price::read(&self.sol_usd), items });
                    }
                }

                _ = prune.tick() => {
                    let removed = self.tracker.prune(now_secs());
                    if !removed.is_empty() {
                        let gone: HashSet<&String> = removed.iter().map(|(m, _)| m).collect();
                        self.lab_pools.retain(|_, m| !gone.contains(m));
                        self.moon_curves.retain(|_, m| !gone.contains(m));
                    }
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
                // A node without logsSubscribe (some providers) streams nothing: leave it.
                if err.get("code").and_then(Value::as_i64) == Some(-32601) {
                    anyhow::bail!("node does not support logsSubscribe");
                }
                subs.pending.remove(&id);
            } else if let (Some(key), Some(sub_id)) = (subs.pending.remove(&id), v.get("result").and_then(Value::as_u64)) {
                match key.strip_prefix(POOL_KEY) {
                    Some(pool) => match self.pools.get_mut(pool) {
                        Some(w) => w.sub_id = Some(sub_id),
                        // Unwatched while the subscribe was in flight.
                        None => subs.unsubscribe(tx, sub_id).await?,
                    },
                    None => self.tracker.set_sub(&key, sub_id),
                }
            }
            return Ok(());
        }

        let Some(value) = v.pointer("/params/result/value") else { return Ok(()) };
        let slot = v.pointer("/params/result/context/slot").and_then(Value::as_u64);
        // Failed transactions still emit logs; never treat them as real activity.
        if !value.get("err").is_some_and(Value::is_null) {
            stats.failed_txs.fetch_add(1, Ordering::Relaxed);
            stats.failed_bytes.fetch_add(text.len() as u64, Ordering::Relaxed);
            return Ok(());
        }
        let Some(sig) = value.get("signature").and_then(Value::as_str) else { return Ok(()) };
        let Some(logs) = value.get("logs").and_then(Value::as_array) else { return Ok(()) };
        let logs: Vec<String> = logs.iter().filter_map(|l| l.as_str().map(String::from)).collect();

        // New coins from other launchpads: read the transaction off the hot path.
        if launches::is_candidate(&logs) && self.seen.insert(&format!("{sig}:launch")) {
            let (http, url, back, sem) = (self.http.clone(), self.rpc_url.clone(), self.launched_tx.clone(), self.resolving.clone());
            let (sig, logs) = (sig.to_string(), logs.clone());
            tokio::spawn(async move {
                let Ok(_permit) = sem.acquire().await else { return };
                if let Some(token) = launches::resolve(&http, &url, &sig, &logs).await {
                    tracing::info!(mint = %token.mint, launchpad = %token.launchpad, symbol = %token.symbol, "new launch");
                    let _ = back.send(token);
                }
            });
            return Ok(());
        }

        // A create with a dev buy arrives on two subscriptions; dedupe per event.
        for (i, event) in pumpfun::parse_events(sig, &logs).into_iter().enumerate() {
            if !self.seen.insert(&format!("{sig}:{i}")) {
                continue;
            }
            match event {
                Event::Create(token) => {
                    stats.tokens_detected.fetch_add(1, Ordering::Relaxed);
                    if self.tracker.add(token.clone()) {
                        if !self.program_wide {
                            subs.subscribe(tx, token.mint.clone(), &token.bonding_curve).await?;
                        }
                        let _ = out.send(IngestEvent::Created(token));
                    }
                }
                // The program-wide stream carries every pump.fun trade: keep tracked coins.
                Event::Trade(trade) if self.program_wide && !self.tracker.contains(&trade.mint) => {}
                Event::Trade(trade) => {
                    stats.trades_decoded.fetch_add(1, Ordering::Relaxed);
                    self.tracker.apply_trade_in_slot(&trade, slot);
                    let _ = out.send(IngestEvent::Trade { signature: sig.to_string(), trade, slot });
                }
                Event::Complete { mint } => self.tracker.complete(&mint, now_secs()),
            }
        }

        // Watched pools whose program does not log trades: hand the transaction over.
        // A notification belongs to a pool subscription when its id matches one.
        if let Some(sub) = v.pointer("/params/subscription").and_then(Value::as_u64) {
            if let Some(w) = self.pools.values().find(|w| !w.decode_logs && w.sub_id == Some(sub)) {
                if self.seen.insert(&format!("{sig}:tx")) {
                    let _ = out.send(IngestEvent::PoolTx { mint: w.mint.clone(), signature: sig.to_string() });
                }
                return Ok(());
            }
        }

        // Raydium LaunchLab curve trades (letsbonk.fun and others) for coins we track.
        if !self.lab_pools.is_empty() && logs.iter().any(|l| l.contains(launchlab::PROGRAM_ID)) {
            for (i, t) in launchlab::parse_trades(&logs).into_iter().enumerate() {
                let Some(mint) = self.lab_pools.get(&t.pool).cloned() else { continue };
                if !self.seen.insert(&format!("{sig}:lab{i}")) {
                    continue;
                }
                stats.trades_decoded.fetch_add(1, Ordering::Relaxed);
                self.tracker.set_curve_total(&mint, t.total_base_sell);
                let complete = t.complete;
                let trade = t.into_trade(&mint, now_secs());
                self.tracker.apply_trade_in_slot(&trade, slot);
                if complete {
                    self.tracker.complete(&mint, now_secs());
                }
                let _ = out.send(IngestEvent::Trade { signature: sig.to_string(), trade, slot });
            }
        }

        // Moonshot curve trades for coins we track.
        if !self.moon_curves.is_empty() && logs.iter().any(|l| l.contains(moonshot::PROGRAM_ID)) {
            for (i, t) in moonshot::parse_trades(&logs).into_iter().enumerate() {
                let Some(mint) = self.moon_curves.get(&t.curve).cloned() else { continue };
                if !self.seen.insert(&format!("{sig}:moon{i}")) {
                    continue;
                }
                stats.trades_decoded.fetch_add(1, Ordering::Relaxed);
                let trade = t.into_trade(&mint, now_secs());
                self.tracker.apply_trade_in_slot(&trade, slot);
                let _ = out.send(IngestEvent::Trade { signature: sig.to_string(), trade, slot });
            }
        }

        // PumpSwap trades on watched pools, reported in the same shape as curve trades
        // (pool reserves play the role of the curve's virtual reserves).
        if !self.pools.is_empty() && logs.iter().any(|l| l.contains(pumpswap::PROGRAM_ID)) {
            for (i, s) in pumpswap::parse_swaps(&logs).into_iter().enumerate() {
                let Some(w) = self.pools.get(&s.pool) else { continue };
                if !self.seen.insert(&format!("{sig}:ps{i}")) {
                    continue;
                }
                stats.trades_decoded.fetch_add(1, Ordering::Relaxed);
                let trade = pumpfun::Trade {
                    mint: w.mint.clone(),
                    sol_amount: s.quote_amount,
                    token_amount: s.base_amount,
                    is_buy: s.is_buy,
                    user: s.user,
                    timestamp: s.timestamp,
                    virtual_sol_reserves: s.pool_quote_reserves,
                    virtual_token_reserves: s.pool_base_reserves,
                    real_token_reserves: 0,
                };
                let _ = out.send(IngestEvent::Trade { signature: sig.to_string(), trade, slot });
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
