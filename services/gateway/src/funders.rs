//! Who funded a coin's early wallets: bundle and cluster detection beyond one block.
//!
//! Bundlers usually make fresh wallets and send each its first SOL from one wallet, then
//! buy across several blocks. Kixo looks up, for a coin's dev and first 40 buyers, the
//! wallet that sent each one its first SOL (the oldest transaction of a fresh wallet), and
//! groups wallets with the same funder into a cluster. A wallet with 100+ transactions is
//! not fresh and is skipped; a funder with 1,000+ transactions is an exchange or a busy hot
//! wallet that pays many unrelated people, and is never a cluster.
//!
//! Lookups run in the background when a coin's groups are asked for (its trade page, the AI
//! analysis or chat), four at a time, and every answer is cached in memory and on disk
//! (`data/funders.jsonl`), since a wallet's first funder never changes.
//!
//! `GET /token/{mint}/groups` -> bundles (same block) and clusters (same funder), each with
//! its wallets and the share of supply they still hold.

use crate::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

const FILE: &str = "data/funders.jsonl";
/// Early wallets looked up per coin (besides the dev).
const EARLY: usize = 40;
/// A wallet with this many transactions or more is not a fresh bundle wallet.
const FRESH_MAX_TXS: usize = 100;
/// A funder with this many transactions or more pays many people: an exchange.
const BUSY_TXS: usize = 1000;

#[derive(Default)]
struct Cache {
    loaded: bool,
    /// wallet -> its first funder (None: not fresh, or no SOL transfer found).
    funder: HashMap<String, Option<String>>,
    /// funder -> is it a busy wallet (exchange).
    busy: HashMap<String, bool>,
    /// Coins being looked up now.
    scanning: HashSet<String>,
}

#[derive(Serialize, Deserialize)]
struct Line {
    w: String,
    #[serde(default)]
    f: Option<String>,
    #[serde(default)]
    busy: Option<bool>,
}

fn cache() -> &'static Mutex<Cache> {
    static C: OnceLock<Mutex<Cache>> = OnceLock::new();
    let c = C.get_or_init(Default::default);
    let mut g = c.lock().expect("funders lock");
    if !g.loaded {
        g.loaded = true;
        if let Ok(text) = std::fs::read_to_string(FILE) {
            for l in text.lines().filter_map(|l| serde_json::from_str::<Line>(l).ok()) {
                match l.busy {
                    Some(b) => {
                        g.busy.insert(l.w, b);
                    }
                    None => {
                        g.funder.insert(l.w, l.f);
                    }
                }
            }
        }
    }
    drop(g);
    c
}

fn persist(line: &Line) {
    use std::io::Write;
    let _ = std::fs::create_dir_all("data");
    if let (Ok(mut f), Ok(s)) = (std::fs::OpenOptions::new().create(true).append(true).open(FILE), serde_json::to_string(line)) {
        let _ = writeln!(f, "{s}");
    }
}

/// One lookup at a time, at least GAP apart: these calls share Helius with the live engine
/// (the free plan answers 429 when pushed), so they stay well under its limit.
const GAP: Duration = Duration::from_millis(300);

fn gate() -> &'static tokio::sync::Mutex<std::time::Instant> {
    static G: OnceLock<tokio::sync::Mutex<std::time::Instant>> = OnceLock::new();
    G.get_or_init(|| tokio::sync::Mutex::new(std::time::Instant::now()))
}

async fn rpc(state: &AppState, method: &str, params: Value) -> Option<Value> {
    {
        let mut last = gate().lock().await;
        let wait = GAP.saturating_sub(last.elapsed());
        tokio::time::sleep(wait).await;
        *last = std::time::Instant::now();
    }
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let v: Value = state.http.post(state.config.helius_rpc_url()).json(&body).timeout(Duration::from_secs(10)).send().await.ok()?.json().await.ok()?;
    v.get("result").cloned()
}

/// The wallet that sent `wallet` SOL in transaction `tx` (jsonParsed), if any.
pub fn sender_in(tx: &Value, wallet: &str) -> Option<String> {
    let outer = tx["transaction"]["message"]["instructions"].as_array().cloned().unwrap_or_default();
    let inner: Vec<Value> = tx["meta"]["innerInstructions"].as_array().into_iter().flatten().flat_map(|i| i["instructions"].as_array().cloned().unwrap_or_default()).collect();
    outer.iter().chain(inner.iter()).find_map(|ix| {
        if ix["program"].as_str() != Some("system") {
            return None;
        }
        let kind = ix["parsed"]["type"].as_str()?;
        let info = &ix["parsed"]["info"];
        let to = match kind {
            "transfer" | "transferWithSeed" => info["destination"].as_str(),
            "createAccount" | "createAccountWithSeed" => info["newAccount"].as_str(),
            _ => None,
        }?;
        let from = info["source"].as_str()?;
        (to == wallet && from != wallet).then(|| from.to_string())
    })
}

/// Looks up and caches the first funder of a fresh wallet.
async fn funder_of(state: &AppState, wallet: &str) -> Option<String> {
    if let Some(f) = cache().lock().expect("funders lock").funder.get(wallet) {
        return f.clone();
    }
    let sigs = rpc(state, "getSignaturesForAddress", json!([wallet, { "limit": FRESH_MAX_TXS }])).await?;
    let list = sigs.as_array()?;
    // No history at all: a node that does not keep it, or a limit hit. Try again later.
    if list.is_empty() {
        return None;
    }
    let found = if list.len() >= FRESH_MAX_TXS {
        None
    } else {
        let oldest = list.last()?["signature"].as_str()?.to_string();
        let tx = rpc(state, "getTransaction", json!([oldest, { "encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "confirmed" }])).await?;
        sender_in(&tx, wallet)
    };
    cache().lock().expect("funders lock").funder.insert(wallet.to_string(), found.clone());
    persist(&Line { w: wallet.to_string(), f: found.clone(), busy: None });
    found
}

async fn is_busy(state: &AppState, funder: &str) -> bool {
    if let Some(b) = cache().lock().expect("funders lock").busy.get(funder) {
        return *b;
    }
    let Some(sigs) = rpc(state, "getSignaturesForAddress", json!([funder, { "limit": BUSY_TXS }])).await else { return true };
    let busy = sigs.as_array().map_or(true, |a| a.len() >= BUSY_TXS);
    cache().lock().expect("funders lock").busy.insert(funder.to_string(), busy);
    persist(&Line { w: funder.to_string(), f: None, busy: Some(busy) });
    busy
}

/// The dev and the first buyers of a coin, in buying order.
fn early_wallets(state: &AppState, mint: &str) -> Vec<String> {
    let books = state.books.lock().expect("books lock");
    let mut ps = books.positions_of(mint);
    drop(books);
    ps.sort_by_key(|p| p.first_ts);
    let dev = ps.iter().find(|p| p.dev).map(|p| p.wallet.clone());
    let mut out: Vec<String> = dev.into_iter().collect();
    out.extend(ps.iter().filter(|p| !p.dev && p.buys > 0 && !p.wallet.is_empty()).take(EARLY).map(|p| p.wallet.clone()));
    out
}

/// Looks up the funders of a coin's early wallets in the background (once at a time).
fn scan(state: Arc<AppState>, mint: String) {
    {
        let mut c = cache().lock().expect("funders lock");
        if !c.scanning.insert(mint.clone()) {
            return;
        }
    }
    tokio::spawn(async move {
        for w in early_wallets(&state, &mint) {
            if let Some(f) = funder_of(&state, &w).await {
                is_busy(&state, &f).await;
            }
        }
        cache().lock().expect("funders lock").scanning.remove(&mint);
    });
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Bundles and clusters of a coin from what is known now; starts lookups for the rest.
pub fn groups(state: &Arc<AppState>, mint: &str) -> Value {
    let (bundles, positions) = {
        let b = state.books.lock().expect("books lock");
        (b.bundles(mint), b.positions_of(mint))
    };
    let by_wallet: HashMap<&str, &crate::book::Position> = positions.iter().map(|p| (p.wallet.as_str(), p)).collect();
    let hold = |ws: &[String]| round2(ws.iter().filter_map(|w| by_wallet.get(w.as_str())).filter(|p| p.balance > 0.0).map(|p| p.pct).sum());
    let holding = |ws: &[String]| ws.iter().filter_map(|w| by_wallet.get(w.as_str())).filter(|p| p.balance > 0.0).count();

    let bundles: Vec<Value> = bundles
        .iter()
        .enumerate()
        .map(|(i, (slot, ps))| {
            let ws: Vec<String> = ps.iter().map(|p| p.wallet.clone()).collect();
            json!({ "id": format!("b{}", i + 1), "slot": slot, "size": ws.len(), "hold_pct": hold(&ws), "still_holding": holding(&ws), "wallets": ws })
        })
        .collect();

    let early = early_wallets(state, mint);
    let dev = early.first().filter(|w| by_wallet.get(w.as_str()).is_some_and(|p| p.dev)).cloned();
    let (clusters, pending) = {
        let c = cache().lock().expect("funders lock");
        let pending = early.iter().filter(|w| !c.funder.contains_key(*w)).count();
        let mut groups: HashMap<String, Vec<String>> = HashMap::new();
        for w in &early {
            if let Some(Some(f)) = c.funder.get(w) {
                if c.busy.get(f) == Some(&false) {
                    groups.entry(f.clone()).or_default().push(w.clone());
                }
            }
        }
        // The funder itself, when it is one of the coin's early wallets (often the dev).
        for (f, ws) in groups.iter_mut() {
            if early.contains(f) && !ws.contains(f) {
                ws.push(f.clone());
            }
        }
        let mut list: Vec<(String, Vec<String>)> = groups.into_iter().filter(|(_, ws)| ws.len() >= 2).collect();
        list.sort_by(|a, b| b.1.len().cmp(&a.1.len()));
        (list, pending)
    };
    let clusters: Vec<Value> = clusters
        .iter()
        .enumerate()
        .map(|(i, (f, ws))| {
            let with_dev = dev.as_ref().is_some_and(|d| d == f || ws.contains(d));
            json!({ "id": format!("c{}", i + 1), "funder": f, "size": ws.len(), "dev": with_dev, "hold_pct": hold(ws), "still_holding": holding(ws), "wallets": ws })
        })
        .collect();
    if pending > 0 {
        scan(state.clone(), mint.to_string());
    }
    json!({ "bundles": bundles, "clusters": clusters, "checked": early.len() - pending, "of": early.len(), "scanning": pending > 0 })
}

/// `GET /token/{mint}/groups`.
pub async fn groups_handler(State(state): State<Arc<AppState>>, Path(mint): Path<String>) -> Json<Value> {
    if !crate::account::is_solana_address(&mint) {
        return Json(json!({ "bundles": [], "clusters": [] }));
    }
    Json(groups(&state, &mint))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_sender_of_the_first_sol() {
        let tx = json!({
            "transaction": { "message": { "instructions": [
                { "program": "spl-token", "parsed": { "type": "transfer", "info": { "destination": "W", "source": "X" } } },
                { "program": "system", "parsed": { "type": "transfer", "info": { "destination": "OTHER", "source": "F1" } } }
            ] } },
            "meta": { "innerInstructions": [ { "instructions": [
                { "program": "system", "parsed": { "type": "createAccount", "info": { "newAccount": "W", "source": "FUNDER" } } }
            ] } ] }
        });
        assert_eq!(sender_in(&tx, "W").as_deref(), Some("FUNDER"));
        assert_eq!(sender_in(&tx, "NOPE"), None);
        let self_send = json!({ "transaction": { "message": { "instructions": [ { "program": "system", "parsed": { "type": "transfer", "info": { "destination": "W", "source": "W" } } } ] } }, "meta": {} });
        assert_eq!(sender_in(&self_send, "W"), None, "a wallet does not fund itself");
    }
}
