//! Kixo AI risk: the trained model's chance that a new coin dumps (falls 70%+) or doubles
//! within the next hour, from its first 2 minutes (ai/train_rug.py).
//!
//! The gateway keeps the first 2 minutes of trades of every coin it saw launch, then asks
//! the local AI service (ai/serve.py, AI_URL, default http://127.0.0.1:8090) once per
//! coin and keeps the answer. Browsers read it with `GET /ai/risk?mints=a,b`.
//! Off when the admin switch "ai_risk" is off; without the service, coins get no score
//! (never a made-up one).

use axum::{
    extract::{Query, State},
    Json,
};
use monexa_ingest::pumpfun::{NewToken, Trade};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// What the model looks at: the coin's first 2 minutes (features.py WINDOW).
const WINDOW: i64 = 120;
/// Trades kept per coin while it waits; a busy launch past this is scored on these.
const MAX_TRADES: usize = 3_000;
/// Coins waiting at once; launches past this are skipped until room frees up.
const MAX_PENDING: usize = 5_000;
/// Scores kept (newest coins); older ones are dropped.
const MAX_SCORES: usize = 20_000;

#[derive(Clone, Serialize)]
pub struct Risk {
    /// Chance (0-1) the price falls to 30% or less within the next hour.
    pub dump: f64,
    /// Chance (0-1) the price doubles within the next hour.
    pub pump: f64,
    /// Trades the model saw.
    pub trades: u32,
    /// When it was scored (unix seconds).
    pub at: i64,
}

struct Pending {
    creator: String,
    launchpad: String,
    first_ts: Option<i64>,
    trades: Vec<Value>,
}

#[derive(Default)]
struct Store {
    pending: HashMap<String, Pending>,
    scores: HashMap<String, Risk>,
    order: std::collections::VecDeque<String>,
    /// Whether the last call to the AI service worked, for /ai/risk and the admin.
    service_up: bool,
}

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();

fn store() -> &'static Mutex<Store> {
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// A coin launched: start keeping its first 2 minutes.
pub fn coin(t: &NewToken) {
    // The model learned on SOL-quoted curves; other quotes would read wrong.
    if t.quote_mint.is_some() {
        return;
    }
    let mut s = store().lock().expect("ai store lock");
    if s.pending.len() >= MAX_PENDING || s.scores.contains_key(&t.mint) || s.pending.contains_key(&t.mint) {
        return;
    }
    s.pending.insert(
        t.mint.clone(),
        Pending { creator: t.creator.clone(), launchpad: t.launchpad.clone(), first_ts: None, trades: Vec::new() },
    );
}

/// A trade on any coin: kept when its coin is waiting and it falls in the first 2 minutes.
pub fn trade(t: &Trade, slot: Option<u64>) {
    let mut s = store().lock().expect("ai store lock");
    let Some(p) = s.pending.get_mut(&t.mint) else { return };
    let first = *p.first_ts.get_or_insert(t.timestamp);
    if t.timestamp > first + WINDOW || p.trades.len() >= MAX_TRADES {
        return;
    }
    p.trades.push(json!({
        "ts": t.timestamp,
        "slot": slot.unwrap_or(0),
        "sol_lamports": t.sol_amount,
        "v_sol": t.virtual_sol_reserves,
        "v_tokens": t.virtual_token_reserves,
        "side": if t.is_buy { "buy" } else { "sell" },
        "wallet": t.user,
    }));
}

#[derive(Clone)]
pub struct AiCtx {
    pub app: Arc<crate::AppState>,
    pub admin: Arc<crate::admin::AdminState>,
}

fn url() -> String {
    std::env::var("AI_URL").ok().filter(|u| !u.trim().is_empty()).unwrap_or_else(|| "http://127.0.0.1:8090".into())
}

/// Every few seconds: score the coins whose first 2 minutes are over.
pub async fn run(ctx: AiCtx) {
    let http = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().expect("ai http client");
    let mut last_warn: Option<Instant> = None;
    loop {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let on = ctx.admin.ai_risk();
        let t = now();
        // Coins whose window closed (a few seconds of grace for late trades), and coins
        // that never traded: dropped after 10 minutes.
        let ready: Vec<(String, Pending)> = {
            let mut s = store().lock().expect("ai store lock");
            let done: Vec<String> = s
                .pending
                .iter()
                .filter(|(_, p)| match p.first_ts {
                    Some(f) => t >= f + WINDOW + 5,
                    None => false,
                })
                .map(|(m, _)| m.clone())
                .collect();
            let stale: Vec<String> = s.pending.iter().filter(|(_, p)| p.first_ts.is_none() && p.trades.is_empty()).map(|(m, _)| m.clone()).collect();
            let mut out = Vec::new();
            for m in done {
                if let Some(p) = s.pending.remove(&m) {
                    out.push((m, p));
                }
            }
            // Never-traded coins: the board drops them; drop them here too when gone.
            let board = ctx.app.board.lock().expect("board lock");
            for m in stale {
                if !board.tokens.contains_key(&m) {
                    s.pending.remove(&m);
                }
            }
            out
        };
        if !on || ready.is_empty() {
            continue;
        }
        for (mint, p) in ready {
            if p.trades.len() < 3 {
                continue;
            }
            let card = {
                let board = ctx.app.board.lock().expect("board lock");
                board.tokens.get(&mint).map(|ft| json!({ "meta": ft.meta, "dev_report": ft.dev_report }))
            };
            let body = json!({ "trades": p.trades, "creator": p.creator, "launchpad": p.launchpad, "card": card });
            let res = http.post(format!("{}/predict", url())).json(&body).send().await;
            let ok = match res {
                Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                    Ok(v) => {
                        let risk = Risk {
                            dump: v["dump"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0),
                            pump: v["pump"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0),
                            trades: v["trades"].as_u64().unwrap_or(0) as u32,
                            at: now(),
                        };
                        let mut s = store().lock().expect("ai store lock");
                        s.scores.insert(mint.clone(), risk);
                        s.order.push_back(mint);
                        while s.order.len() > MAX_SCORES {
                            if let Some(old) = s.order.pop_front() {
                                s.scores.remove(&old);
                            }
                        }
                        true
                    }
                    Err(_) => false,
                },
                // 422: too few usable trades; the service is fine.
                Ok(r) => r.status().as_u16() == 422,
                Err(_) => false,
            };
            store().lock().expect("ai store lock").service_up = ok;
            if !ok {
                if last_warn.is_none_or(|w| w.elapsed() > Duration::from_secs(300)) {
                    tracing::warn!(url = %url(), "AI risk: the AI service did not answer (start ai/serve.py)");
                    last_warn = Some(Instant::now());
                }
                break;
            }
        }
    }
}

#[derive(Deserialize)]
pub struct RiskQuery {
    mints: Option<String>,
}

/// `GET /ai/risk?mints=a,b` -> `{ on, service, risk: { mint: {dump, pump, trades, at} } }`.
pub async fn get_risk(State(ctx): State<AiCtx>, Query(q): Query<RiskQuery>) -> Json<Value> {
    if !ctx.admin.ai_risk() {
        return Json(json!({ "on": false, "risk": {} }));
    }
    let s = store().lock().expect("ai store lock");
    let risk: HashMap<&str, &Risk> = q
        .mints
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .take(200)
        .filter_map(|m| s.scores.get(m).map(|r| (m, r)))
        .collect();
    let waiting = q.mints.as_deref().unwrap_or("").split(',').map(str::trim).filter(|m| s.pending.contains_key(*m)).count();
    Json(json!({ "on": true, "service": s.service_up, "window_s": WINDOW, "risk": risk, "waiting": waiting }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tok(mint: &str) -> NewToken {
        NewToken {
            signature: "s".into(),
            name: "n".into(),
            symbol: "S".into(),
            uri: String::new(),
            mint: mint.into(),
            bonding_curve: String::new(),
            creator: "dev".into(),
            timestamp: 1000,
            reserves: None,
            standard: monexa_ingest::pumpfun::TokenStandard::Spl,
            quote_mint: None,
            launchpad: "pump.fun".into(),
        }
    }

    fn tr(mint: &str, ts: i64) -> Trade {
        Trade {
            mint: mint.into(),
            sol_amount: 1_000_000_000,
            token_amount: 1,
            is_buy: true,
            user: "w".into(),
            timestamp: ts,
            virtual_sol_reserves: 30_000_000_000,
            virtual_token_reserves: 1_000_000_000_000_000,
            real_token_reserves: 0,
        }
    }

    #[test]
    fn keeps_only_the_first_two_minutes_of_launched_coins() {
        coin(&tok("aiA"));
        trade(&tr("aiA", 1000), Some(1));
        trade(&tr("aiA", 1100), Some(2));
        trade(&tr("aiA", 1121), Some(3)); // past the window
        trade(&tr("aiB", 1000), Some(1)); // never seen launching
        let s = store().lock().unwrap();
        assert_eq!(s.pending["aiA"].trades.len(), 2);
        assert!(!s.pending.contains_key("aiB"));
    }
}
