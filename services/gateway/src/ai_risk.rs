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
    /// Price when scored, and the lowest and highest since: the real outcome the AI's
    /// track record is measured against.
    #[serde(skip)]
    p0: f64,
    #[serde(skip)]
    lo: f64,
    #[serde(skip)]
    hi: f64,
    #[serde(skip)]
    resolved: bool,
}

/// The model's horizon: an outcome is known one hour after the score (train_rug.py).
const HORIZON: i64 = 3600;
/// Outcomes kept for the track record.
const TRACK_SECS: i64 = 48 * 3600;

/// What happened to a scored coin within the hour after its score.
#[derive(Clone, Copy)]
struct Outcome {
    at: i64,
    dump: f64,
    pump: f64,
    dumped: bool,
    doubled: bool,
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
    outcomes: std::collections::VecDeque<Outcome>,
    /// The model's test results from the AI service (/health), refreshed every few minutes.
    model: Option<Value>,
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
    // A scored coin in its hour: follow its price for the track record.
    if let Some(r) = s.scores.get_mut(&t.mint) {
        if !r.resolved && t.virtual_token_reserves > 0 && r.p0 > 0.0 {
            let price = t.virtual_sol_reserves as f64 / t.virtual_token_reserves as f64;
            r.lo = r.lo.min(price);
            r.hi = r.hi.max(price);
        }
        return;
    }
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
    let mut round = 0u64;
    loop {
        tokio::time::sleep(Duration::from_secs(3)).await;
        round += 1;
        let on = ctx.admin.ai_risk();
        let t = now();
        if round % 10 == 1 {
            resolve(t);
        }
        if round % 100 == 1 {
            if let Ok(r) = http.get(format!("{}/health", url())).send().await {
                if let Ok(v) = r.json::<Value>().await {
                    store().lock().expect("ai store lock").model = Some(v);
                }
            }
        }
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
            // The price the model judged at: the last trade of the window.
            let p0 = p.trades.last().map_or(0.0, |l| {
                let (s, k) = (l["v_sol"].as_f64().unwrap_or(0.0), l["v_tokens"].as_f64().unwrap_or(0.0));
                if k > 0.0 { s / k } else { 0.0 }
            });
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
                            p0,
                            lo: p0,
                            hi: p0,
                            resolved: p0 <= 0.0,
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

/// For the admin's System page: is the AI service answering, and how much has it scored.
pub fn status() -> Value {
    let s = store().lock().expect("ai store lock");
    json!({ "service": s.service_up, "scored": s.scores.len(), "waiting": s.pending.len() })
}

/// Coins whose hour is over: record what really happened.
fn resolve(t: i64) {
    let mut s = store().lock().expect("ai store lock");
    let mut done = Vec::new();
    for r in s.scores.values_mut() {
        if !r.resolved && t >= r.at + HORIZON {
            r.resolved = true;
            done.push(Outcome { at: r.at, dump: r.dump, pump: r.pump, dumped: r.lo <= 0.3 * r.p0, doubled: r.hi >= 2.0 * r.p0 });
        }
    }
    done.sort_by_key(|o| o.at);
    s.outcomes.extend(done);
    while s.outcomes.front().is_some_and(|o| o.at < t - TRACK_SECS) {
        s.outcomes.pop_front();
    }
}

/// One group of the track record: how many coins, and how often they really dumped and doubled.
fn group<'a>(it: impl Iterator<Item = &'a Outcome>) -> Value {
    let (mut n, mut d, mut p) = (0u32, 0u32, 0u32);
    for o in it {
        n += 1;
        d += o.dumped as u32;
        p += o.doubled as u32;
    }
    let rate = |k: u32| if n > 0 { Some(k as f64 / n as f64) } else { None };
    json!({ "coins": n, "dumped": rate(d), "doubled": rate(p) })
}

/// `GET /ai/overview`: the AI page. Live lists of the newest scores, the track record
/// (scores against what really happened within the hour), and the model's test results.
pub async fn overview(State(ctx): State<AiCtx>) -> Json<Value> {
    if !ctx.admin.ai_risk() {
        return Json(json!({ "on": false }));
    }
    let t = now();
    let (recent, track, model, service, waiting, scored_1h) = {
        let s = store().lock().expect("ai store lock");
        let recent: Vec<(String, Risk)> = s
            .order
            .iter()
            .rev()
            .filter_map(|m| s.scores.get(m).map(|r| (m.clone(), r.clone())))
            .take_while(|(_, r)| r.at >= t - 1800)
            .collect();
        let o: Vec<Outcome> = s.outcomes.iter().copied().filter(|o| o.at >= t - 24 * 3600).collect();
        let track = json!({
            "window_h": 24,
            "all": group(o.iter()),
            "high_dump": group(o.iter().filter(|o| o.dump >= 0.4)),
            "low_dump": group(o.iter().filter(|o| o.dump < 0.1)),
            "high_pump": group(o.iter().filter(|o| o.pump >= 0.2)),
        });
        let scored_1h = s.scores.values().filter(|r| r.at >= t - 3600).count();
        (recent, track, s.model.clone(), s.service_up, s.pending.len(), scored_1h)
    };
    let card = |m: &str, r: &Risk, board: &crate::Board| {
        let ft = board.tokens.get(m);
        json!({
            "mint": m,
            "symbol": ft.map(|f| f.token.symbol.clone()),
            "name": ft.map(|f| f.token.name.clone()),
            "image": ft.and_then(|f| f.meta.as_ref()).and_then(|x| x.image.clone()),
            "mc_usd": ft.and_then(|f| f.market.as_ref()).and_then(|x| x.mc_usd),
            "dump": r.dump,
            "pump": r.pump,
            "at": r.at,
        })
    };
    let (riskiest, best) = {
        let board = ctx.app.board.lock().expect("board lock");
        let mut by_dump: Vec<&(String, Risk)> = recent.iter().collect();
        by_dump.sort_by(|a, b| b.1.dump.total_cmp(&a.1.dump));
        let mut by_pump: Vec<&(String, Risk)> = recent.iter().filter(|(_, r)| r.dump < 0.2).collect();
        by_pump.sort_by(|a, b| b.1.pump.total_cmp(&a.1.pump));
        (
            by_dump.iter().take(8).map(|(m, r)| card(m, r, &board)).collect::<Vec<_>>(),
            by_pump.iter().take(8).map(|(m, r)| card(m, r, &board)).collect::<Vec<_>>(),
        )
    };
    Json(json!({
        "on": true,
        "service": service,
        "window_s": WINDOW,
        "horizon_s": HORIZON,
        "scored_30m": recent.len(),
        "scored_1h": scored_1h,
        "waiting": waiting,
        "riskiest": riskiest,
        "best": best,
        "track": track,
        "model": model.map(|m| json!({ "trained": m["trained"], "coins": m["coins"], "targets": m["targets"], "backtest": m["backtest"] })),
    }))
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
