//! Every transaction of the wallets people follow, on any coin and any DEX.
//!
//! The trade engine only decodes coins it watches (launch curves, coins open on a trade
//! page), so a followed wallet buying a graduated coin on PumpSwap, Raydium or through
//! Jupiter went unseen. This module subscribes to each followed wallet itself
//! (`logsSubscribe` with `mentions`, Helius first, then the fallback nodes), reads each new
//! transaction once and works out the swap from the wallet's own balance changes: SOL
//! (and wrapped SOL) out and a token in is a buy, the reverse a sell. That works the same
//! on every DEX and aggregator.
//!
//! Followed wallets: Wallet Monitor wallets with alerts (alerts.rs), the KOL list
//! (kols.rs) and the wallets of every open Wallet Monitor page (`/ws/wallets`).
//!
//! A found swap goes out on `state.trades`, the same channel the engine uses, so alerts
//! (Telegram, Discord, email), the KOL feed and the Wallet Monitor pick it up unchanged.
//! Coins the engine already decodes are left to the engine, so nothing is counted twice.

use crate::{book::TradeRow, AppState};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Most wallets subscribed at once (public nodes limit subscriptions per connection).
const MAX_WALLETS: usize = 500;
/// How often the followed set is compared with the subscriptions.
const SYNC_EVERY: Duration = Duration::from_secs(10);
/// No message for this long means the connection is dead.
const SILENT_FOR: Duration = Duration::from_secs(120);
/// A node must accept a subscription this soon, or the next node is tried.
const ACCEPT_WITHIN: Duration = Duration::from_secs(15);
/// Swaps kept for the Wallet Monitor's history (coins the engine does not keep).
const RECENT: usize = 3_000;
/// A transaction is often not readable for a moment after its log arrives.
const READ_TRIES: usize = 4;
const READ_GAP: Duration = Duration::from_millis(1_200);
/// Smallest swap reported, in SOL (filters dust and fee-only transactions).
const MIN_SOL: f64 = 0.005;
/// A node that refused a wallet is asked again after this long.
const RETRY_REFUSED: Duration = Duration::from_secs(60);
/// New subscriptions sent per check, so a node is not flooded at once.
const SUBSCRIBE_BURST: usize = 25;
/// Transactions read per wallet per minute. Bots that send hundreds a minute (arbitrage,
/// market making) would otherwise fill the queue and delay everyone else's alerts.
const PER_WALLET_PER_MIN: usize = 60;
/// A wallet opened in the Wallet Tracker stays followed this long after its last look.
const TOUCH_FOR: Duration = Duration::from_secs(120);
/// Transactions read at the same time.
const READ_AT_ONCE: usize = 8;

/// Counters for /metrics/public: is the watcher following, reading and finding swaps.
#[derive(Default)]
struct Counts {
    following: std::sync::atomic::AtomicU64,
    notified: std::sync::atomic::AtomicU64,
    read: std::sync::atomic::AtomicU64,
    unreadable: std::sync::atomic::AtomicU64,
    swaps: std::sync::atomic::AtomicU64,
    engine: std::sync::atomic::AtomicU64,
    busy: std::sync::atomic::AtomicU64,
}
static COUNTS: OnceLock<Counts> = OnceLock::new();
fn counts() -> &'static Counts {
    COUNTS.get_or_init(Counts::default)
}
fn bump(c: &std::sync::atomic::AtomicU64) {
    c.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

/// Wallets followed, transactions seen and read, and swaps found since the start.
pub fn stats() -> Value {
    let c = counts();
    let g = |a: &std::sync::atomic::AtomicU64| a.load(std::sync::atomic::Ordering::Relaxed);
    json!({ "following": g(&c.following), "transactions": g(&c.notified), "read": g(&c.read), "unreadable": g(&c.unreadable), "swaps": g(&c.swaps), "left_to_engine": g(&c.engine), "skipped_busy_wallets": g(&c.busy) })
}

const WSOL: &str = "So11111111111111111111111111111111111111112";
/// Quote coins that are never "the coin" of a swap.
const QUOTES: [&str; 3] = [
    WSOL,
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCecLjMAE7", // USDT
];

#[derive(Default)]
struct Shared {
    /// Wallets of open Wallet Monitor pages, with how many pages hold each.
    clients: HashMap<String, usize>,
    /// Wallets open in a Wallet Tracker drawer, with when it last asked.
    touched: HashMap<String, Instant>,
    recent: VecDeque<(String, TradeRow)>,
    symbols: HashMap<String, String>,
}

fn shared() -> &'static Mutex<Shared> {
    static S: OnceLock<Mutex<Shared>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Shared::default()))
}

/// Keeps `wallets` followed while the returned guard lives (an open Wallet Monitor page).
pub fn hold(wallets: &HashSet<String>) -> Hold {
    let mut s = shared().lock().expect("wallet watch lock");
    for w in wallets {
        *s.clients.entry(w.clone()).or_default() += 1;
    }
    Hold(wallets.clone())
}

pub struct Hold(HashSet<String>);
impl Drop for Hold {
    fn drop(&mut self) {
        let mut s = shared().lock().expect("wallet watch lock");
        for w in &self.0 {
            if let Some(n) = s.clients.get_mut(w) {
                *n -= 1;
                if *n == 0 {
                    s.clients.remove(w);
                }
            }
        }
    }
}

/// Keeps a wallet followed for TOUCH_FOR (the Wallet Tracker asks every few seconds).
pub fn touch(wallet: &str) {
    let mut s = shared().lock().expect("wallet watch lock");
    s.touched.retain(|_, at| at.elapsed() < TOUCH_FOR);
    if s.touched.len() < MAX_WALLETS {
        s.touched.insert(wallet.to_string(), Instant::now());
    }
}

/// Recent swaps found here by any of `wallets`, newest first.
pub fn recent_by(wallets: &HashSet<String>, limit: usize) -> Vec<(String, TradeRow)> {
    let s = shared().lock().expect("wallet watch lock");
    s.recent.iter().rev().filter(|(_, t)| wallets.contains(&t.wallet)).take(limit).cloned().collect()
}

/// The symbol of a coin seen here (looked up once when its first swap was found).
pub fn symbol(mint: &str) -> Option<String> {
    shared().lock().expect("wallet watch lock").symbols.get(mint).cloned()
}

fn followed() -> HashSet<String> {
    let mut out: HashSet<String> = crate::alerts::watched_wallets();
    out.extend(crate::kols::addresses());
    {
        let s = shared().lock().expect("wallet watch lock");
        out.extend(s.clients.keys().cloned());
        out.extend(s.touched.iter().filter(|(_, at)| at.elapsed() < TOUCH_FOR).map(|(w, _)| w.clone()));
    }
    out.retain(|w| crate::account::is_solana_address(w));
    if out.len() > MAX_WALLETS {
        out = out.into_iter().take(MAX_WALLETS).collect();
    }
    out
}

pub async fn run(state: Arc<AppState>) {
    let (tx, rx) = mpsc::unbounded_channel::<(String, String)>();
    tokio::spawn(read_loop(state.clone(), rx));
    // Shyft first (unlimited on its free plan), then Helius and the free nodes.
    let base = state.config.ws_urls();
    let mut turn = 0usize;
    loop {
        if followed().is_empty() {
            tokio::time::sleep(SYNC_EVERY).await;
            continue;
        }
        let urls: Vec<String> = crate::rpc_router::shyft_ws_url().into_iter().chain(base.iter().cloned()).collect();
        let url = &urls[turn % urls.len()];
        if let Err(err) = stream(url, &tx).await {
            tracing::info!(%err, node = %node_name(url), "wallet watch stream ended, trying the next node");
        }
        turn += 1;
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

/// A node's host for the log, never its key (Helius URLs carry the API key).
fn node_name(url: &str) -> String {
    url.split("://").nth(1).unwrap_or(url).split(['/', '?']).next().unwrap_or("").to_string()
}

/// One websocket: keeps a subscription per followed wallet and forwards each new
/// successful transaction as (wallet, signature).
async fn stream(url: &str, out: &mpsc::UnboundedSender<(String, String)>) -> anyhow::Result<()> {
    let (ws, _) = tokio::time::timeout(Duration::from_secs(10), connect_async(url)).await??;
    let (mut tx, mut rx) = ws.split();
    let mut next_id = 1u64;
    let mut pending: HashMap<u64, String> = HashMap::new();
    let mut subs: HashMap<String, u64> = HashMap::new();
    let mut by_sub: HashMap<u64, String> = HashMap::new();
    let mut refused: HashMap<String, Instant> = HashMap::new();
    let mut sync = tokio::time::interval(Duration::from_secs(5));
    let mut ping = tokio::time::interval(Duration::from_secs(30));
    let mut last = Instant::now();
    let opened = Instant::now();
    let mut told = false;
    loop {
        tokio::select! {
            _ = sync.tick() => {
                if last.elapsed() > SILENT_FOR {
                    anyhow::bail!("silent");
                }
                // A node that takes no subscription (quota used up, method blocked) is
                // left for the next one.
                if subs.is_empty() && opened.elapsed() > ACCEPT_WITHIN {
                    anyhow::bail!("no subscription accepted");
                }
                if !told && !subs.is_empty() {
                    told = true;
                    tracing::info!(wallets = subs.len(), node = %node_name(url), "wallet watch following wallets");
                }
                if !subs.is_empty() {
                    counts().following.store(subs.len() as u64, std::sync::atomic::Ordering::Relaxed);
                }
                let want = followed();
                if want.is_empty() {
                    return Ok(());
                }
                let asking: HashSet<String> = pending.values().cloned().collect();
                let new: Vec<String> = want.iter().filter(|w| !subs.contains_key(*w) && !asking.contains(*w) && !refused.contains_key(*w)).take(SUBSCRIBE_BURST).cloned().collect();
                for w in new {
                    let id = next_id;
                    next_id += 1;
                    pending.insert(id, w.clone());
                    let msg = json!({ "jsonrpc": "2.0", "id": id, "method": "logsSubscribe", "params": [{ "mentions": [w] }, { "commitment": "confirmed" }] });
                    tx.send(Message::Text(msg.to_string().into())).await?;
                }
                let gone: Vec<String> = subs.keys().filter(|w| !want.contains(*w)).cloned().collect();
                for w in gone {
                    if let Some(sub) = subs.remove(&w) {
                        by_sub.remove(&sub);
                        let id = next_id;
                        next_id += 1;
                        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": "logsUnsubscribe", "params": [sub] });
                        tx.send(Message::Text(msg.to_string().into())).await?;
                    }
                }
                refused.retain(|w, at| want.contains(w) && at.elapsed() < RETRY_REFUSED);
            }
            _ = ping.tick() => {
                tx.send(Message::Ping(Vec::new().into())).await?;
            }
            msg = rx.next() => {
                let Some(msg) = msg else { anyhow::bail!("closed") };
                last = Instant::now();
                let text = match msg? {
                    Message::Text(t) => t,
                    Message::Close(_) => anyhow::bail!("closed by node"),
                    _ => continue,
                };
                let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                if let Some(id) = v["id"].as_u64() {
                    if let Some(w) = pending.remove(&id) {
                        match v["result"].as_u64() {
                            Some(sub) => {
                                by_sub.insert(sub, w.clone());
                                subs.insert(w, sub);
                            }
                            None => {
                                tracing::debug!(wallet = %w, error = %v["error"], "wallet subscription refused");
                                refused.insert(w, Instant::now());
                            }
                        }
                    }
                    continue;
                }
                if v["method"] == "logsNotification" {
                    let p = &v["params"];
                    let Some(w) = p["subscription"].as_u64().and_then(|s| by_sub.get(&s)) else { continue };
                    let value = &p["result"]["value"];
                    if !value["err"].is_null() {
                        continue;
                    }
                    if let Some(sig) = value["signature"].as_str() {
                        bump(&counts().notified);
                        let _ = out.send((w.clone(), sig.to_string()));
                    }
                }
            }
        }
    }
}

/// Reads each signature once and sends the swap it holds, if any.
async fn read_loop(state: Arc<AppState>, mut rx: mpsc::UnboundedReceiver<(String, String)>) {
    let mut seen: VecDeque<String> = VecDeque::new();
    let mut seen_set: HashSet<String> = HashSet::new();
    let mut budget: HashMap<String, VecDeque<Instant>> = HashMap::new();
    let gate = Arc::new(tokio::sync::Semaphore::new(READ_AT_ONCE));
    while let Some((wallet, sig)) = rx.recv().await {
        if !seen_set.insert(sig.clone()) {
            continue;
        }
        seen.push_back(sig.clone());
        if seen.len() > 10_000 {
            if let Some(old) = seen.pop_front() {
                seen_set.remove(&old);
            }
        }
        let used = budget.entry(wallet.clone()).or_default();
        while used.front().is_some_and(|t| t.elapsed() > Duration::from_secs(60)) {
            used.pop_front();
        }
        if used.len() >= PER_WALLET_PER_MIN {
            bump(&counts().busy);
            continue;
        }
        used.push_back(Instant::now());
        if budget.len() > 5_000 {
            budget.retain(|_, q| q.back().is_some_and(|t| t.elapsed() < Duration::from_secs(60)));
        }
        let state = state.clone();
        let gate = gate.clone();
        tokio::spawn(async move {
            let url = state.config.helius_rpc_url();
            for _ in 0..READ_TRIES {
                tokio::time::sleep(READ_GAP).await;
                // Only the read itself holds a slot, not the wait before it.
                let got = {
                    let Ok(_slot) = gate.acquire().await else { return };
                    // Background lane: Shyft and the free nodes before Helius.
                    crate::rpc::background(crate::rpc::transactions(&state.http, &url, std::slice::from_ref(&sig))).await
                };
                if let Some(Some(tx)) = got.into_iter().next() {
                    bump(&counts().read);
                    if let Some(s) = swap_of(&tx, &wallet) {
                        emit(&state, &wallet, &sig, s).await;
                    }
                    return;
                }
            }
            bump(&counts().unreadable);
        });
    }
}

#[derive(Debug, PartialEq)]
struct Swap {
    mint: String,
    is_buy: bool,
    sol: f64,
    tokens: f64,
    ts: i64,
}

/// The swap `wallet` made in this transaction, from its own balance changes.
fn swap_of(tx: &Value, wallet: &str) -> Option<Swap> {
    let meta = &tx["meta"];
    if !meta["err"].is_null() {
        return None;
    }
    let mut keys: Vec<&str> = tx["transaction"]["message"]["accountKeys"].as_array()?.iter().filter_map(|k| k.as_str().or_else(|| k["pubkey"].as_str())).collect();
    for part in ["writable", "readonly"] {
        if let Some(a) = meta["loadedAddresses"][part].as_array() {
            keys.extend(a.iter().filter_map(|k| k.as_str()));
        }
    }
    let idx = keys.iter().position(|k| *k == wallet)?;
    let pre = meta["preBalances"].as_array()?.get(idx)?.as_i64()?;
    let post = meta["postBalances"].as_array()?.get(idx)?.as_i64()?;
    // The network fee is not part of the trade.
    let fee = if idx == 0 { meta["fee"].as_i64().unwrap_or(0) } else { 0 };
    let mut sol = (post - pre + fee) as f64 / 1e9;

    let mut deltas: HashMap<String, f64> = HashMap::new();
    for (part, sign) in [("preTokenBalances", -1.0), ("postTokenBalances", 1.0)] {
        for b in meta[part].as_array().into_iter().flatten() {
            if b["owner"].as_str() != Some(wallet) {
                continue;
            }
            let Some(mint) = b["mint"].as_str() else { continue };
            let amount = b["uiTokenAmount"]["uiAmountString"].as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| b["uiTokenAmount"]["uiAmount"].as_f64()).unwrap_or(0.0);
            *deltas.entry(mint.to_string()).or_default() += sign * amount;
        }
    }
    sol += deltas.get(WSOL).copied().unwrap_or(0.0);
    if sol.abs() < MIN_SOL {
        return None;
    }
    let is_buy = sol < 0.0;
    // The coin: the largest token change against the SOL change (in when SOL went out).
    let (mint, tokens) = deltas
        .into_iter()
        .filter(|(m, d)| !QUOTES.contains(&m.as_str()) && d.abs() > 0.0 && (*d > 0.0) == is_buy)
        .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))?;
    Some(Swap { mint, is_buy, sol: sol.abs(), tokens: tokens.abs(), ts: tx["blockTime"].as_i64().unwrap_or_else(crate::now_unix) })
}

async fn emit(state: &AppState, wallet: &str, sig: &str, s: Swap) {
    // Coins the engine decodes reach `trades` from there.
    if state.books.lock().expect("books lock").contains(&s.mint) {
        bump(&counts().engine);
        return;
    }
    let (known, mc_sol) = {
        let b = state.board.lock().expect("board lock");
        let m = b.markets.get(&s.mint);
        let known = b.tokens.get(&s.mint).map(|t| t.token.symbol.clone()).or_else(|| m.as_ref().map(|m| m.symbol.clone())).filter(|x| !x.is_empty());
        let mc_sol = match (m.and_then(|m| m.mc_usd), b.sol_usd) {
            (Some(mc), Some(p)) if p > 0.0 => mc / p,
            _ => 0.0,
        };
        (known, mc_sol)
    };
    if known.is_none() && symbol(&s.mint).is_none() {
        let found = tokio::time::timeout(Duration::from_secs(3), crate::jupiter::search_any(&state.http, &s.mint)).await.ok().flatten();
        if let Some(t) = found.and_then(|l| l.into_iter().find(|t| t.mint == s.mint)) {
            shared().lock().expect("wallet watch lock").symbols.insert(s.mint.clone(), t.symbol);
        }
    }
    let row = TradeRow {
        signature: sig.to_string(),
        ts: s.ts,
        wallet: wallet.to_string(),
        is_buy: s.is_buy,
        sol: s.sol,
        tokens: s.tokens,
        price_sol: if s.tokens > 0.0 { s.sol / s.tokens } else { 0.0 },
        mc_sol,
        whale: s.sol >= 5.0,
        dev: false,
        sniper: false,
        bundler: false,
    };
    {
        let mut sh = shared().lock().expect("wallet watch lock");
        sh.recent.push_back((s.mint.clone(), row.clone()));
        while sh.recent.len() > RECENT {
            sh.recent.pop_front();
        }
        if sh.symbols.len() > 20_000 {
            sh.symbols.clear();
        }
    }
    bump(&counts().swaps);
    let _ = state.trades.send((s.mint, row));
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = "Wa11et1111111111111111111111111111111111111";

    fn tx(sol_pre: i64, sol_post: i64, tokens: Value) -> Value {
        json!({
            "blockTime": 1_700_000_000,
            "meta": {
                "err": null, "fee": 5000,
                "preBalances": [sol_pre, 1], "postBalances": [sol_post, 1],
                "preTokenBalances": tokens["pre"], "postTokenBalances": tokens["post"],
                "loadedAddresses": { "writable": [], "readonly": [] }
            },
            "transaction": { "message": { "accountKeys": [W, "Other"] } }
        })
    }

    fn bal(mint: &str, owner: &str, amount: &str) -> Value {
        json!({ "mint": mint, "owner": owner, "uiTokenAmount": { "uiAmountString": amount } })
    }

    #[test]
    fn sol_out_token_in_is_a_buy() {
        let t = tx(2_000_000_000, 1_499_995_000, json!({ "pre": [], "post": [bal("CoinMint", W, "1000000")] }));
        let s = swap_of(&t, W).unwrap();
        assert!(s.is_buy);
        assert_eq!(s.mint, "CoinMint");
        assert!((s.sol - 0.5).abs() < 1e-9, "fee left out: {}", s.sol);
        assert_eq!(s.tokens, 1_000_000.0);
    }

    #[test]
    fn token_out_wrapped_sol_in_is_a_sell() {
        let t = tx(
            1_000_000_000,
            999_995_000,
            json!({
                "pre": [bal("CoinMint", W, "500"), bal(WSOL, W, "0")],
                "post": [bal("CoinMint", W, "0"), bal(WSOL, W, "1.25"), bal("CoinMint", "Pool", "999")]
            }),
        );
        let s = swap_of(&t, W).unwrap();
        assert!(!s.is_buy);
        assert!((s.sol - 1.25).abs() < 1e-9);
        assert_eq!(s.tokens, 500.0);
    }

    #[test]
    fn transfers_and_failed_transactions_are_not_swaps() {
        // SOL sent away with no token in.
        assert!(swap_of(&tx(2_000_000_000, 1_000_000_000, json!({ "pre": [], "post": [] })), W).is_none());
        // Only the fee moved.
        assert!(swap_of(&tx(1_000_000_000, 999_995_000, json!({ "pre": [], "post": [] })), W).is_none());
        let mut failed = tx(2_000_000_000, 1_500_000_000, json!({ "pre": [], "post": [bal("CoinMint", W, "10")] }));
        failed["meta"]["err"] = json!({ "InstructionError": [0, "Custom"] });
        assert!(swap_of(&failed, W).is_none());
        // A wallet not in the transaction.
        assert!(swap_of(&tx(2_000_000_000, 1_500_000_000, json!({ "pre": [], "post": [] })), "Nobody").is_none());
    }
}
