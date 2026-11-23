//! Kixo AI's second look (ai/train_checkpoint.py): every coin still trading is looked at
//! again 5, 15 and 30 minutes after its first trade. The question there: from this price,
//! does it reach +50% before it falls 25% within the next hour?
//!
//! After a coin's 2-minute score (ai_risk.rs) its trades keep being collected up to 30
//! minutes. At each checkpoint the AI service (`POST /checkpoint`) answers with the
//! chances and the pick line its test chose. A coin is picked once, at the first
//! checkpoint at or above the line, and then followed for an hour: whether it hit +50%
//! or -25% first is its real result, saved for the record. A coin that went quiet is
//! never looked at again. Without the service or its models nothing is picked.

use monexa_ingest::pumpfun::Trade;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// Seconds after the first trade (features.py CHECKPOINTS).
const CHECKPOINTS: [i64; 3] = [300, 900, 1800];
/// A coin that has not traded for this long before a checkpoint has gone quiet (CK_ALIVE).
const ALIVE: i64 = 120;
/// The trade the picks are judged on (CK_TP, CK_SL, CK_HOLD; 1% cost each side).
const TP: f64 = 1.5;
const SL: f64 = 0.75;
const HOLD: i64 = 3600;
const COST: f64 = 0.01;
/// Trades kept per coin; a very busy coin is judged on these.
const MAX_TRADES: usize = 8_000;
/// Coins followed at once.
const MAX_FOLLOW: usize = 3_000;
/// Results kept: picks are shown for an hour and recorded after it.
const KEEP_SECS: i64 = 2 * 3600;
const RECORD_SECS: i64 = 48 * 3600;
const PICKS_FILE: &str = "data/ai_ck_picks.json";
const RECORD_FILE: &str = "data/ai_ck_outcomes.jsonl";

struct Follow {
    creator: String,
    launchpad: String,
    first_ts: i64,
    last_ts: i64,
    next: usize,
    trades: Vec<Value>,
}

/// A coin's latest second look; once `passed`, the look that picked it.
#[derive(Clone, Serialize, Deserialize)]
pub struct Look {
    pub ck: i64,
    pub win: f64,
    pub crash: f64,
    pub line: Option<f64>,
    pub passed: bool,
    pub at: i64,
    pub p0: f64,
    pub lo: f64,
    pub hi: f64,
    pub last: f64,
    /// Some(true) when +50% came first, Some(false) when -25% came first.
    pub hit: Option<bool>,
    pub resolved: bool,
    #[serde(default)]
    pub symbol: String,
    #[serde(default)]
    pub holders: u64,
    #[serde(default)]
    pub early_still: f64,
    #[serde(default)]
    pub top10_held: f64,
    #[serde(default)]
    pub dev_sold_frac: f64,
}

impl Look {
    /// What the pick's trade returned after costs, once its hour is over or a side was hit.
    fn result(&self) -> f64 {
        let x = match self.hit {
            Some(true) => TP,
            Some(false) => SL,
            None if self.p0 > 0.0 => self.last / self.p0,
            None => 1.0,
        };
        x * (1.0 - COST) / (1.0 + COST) - 1.0
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Outcome {
    at: i64,
    mint: String,
    symbol: String,
    ck: i64,
    win: f64,
    hit: Option<bool>,
    result: f64,
}

#[derive(Default)]
struct Store {
    follow: HashMap<String, Follow>,
    looks: HashMap<String, Look>,
    outcomes: Vec<Outcome>,
    /// Whether the service has checkpoint models (false: 503).
    ready: bool,
}

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();

fn store() -> &'static Mutex<Store> {
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// A coin's 2-minute score is done: keep collecting its trades for the later looks.
pub fn follow(mint: &str, creator: &str, launchpad: &str, trades: Vec<Value>) {
    let Some(first) = trades.first().and_then(|t| t["ts"].as_i64()) else { return };
    let last = trades.last().and_then(|t| t["ts"].as_i64()).unwrap_or(first);
    let mut s = store().lock().expect("ck store lock");
    if s.follow.len() >= MAX_FOLLOW || s.follow.contains_key(mint) {
        return;
    }
    s.follow.insert(mint.to_string(), Follow { creator: creator.to_string(), launchpad: launchpad.to_string(), first_ts: first, last_ts: last, next: 0, trades });
}

/// A trade on any coin: collected while its coin is followed, and priced for its pick.
pub fn trade(t: &Trade, slot: Option<u64>) {
    if t.virtual_token_reserves == 0 {
        return;
    }
    let price = t.virtual_sol_reserves as f64 / t.virtual_token_reserves as f64;
    let mut s = store().lock().expect("ck store lock");
    if let Some(l) = s.looks.get_mut(&t.mint) {
        if l.p0 > 0.0 {
            l.last = price;
            if !l.resolved {
                l.lo = l.lo.min(price);
                l.hi = l.hi.max(price);
                if l.passed && l.hit.is_none() {
                    if price >= TP * l.p0 {
                        l.hit = Some(true);
                    } else if price <= SL * l.p0 {
                        l.hit = Some(false);
                    }
                }
            }
        }
    }
    let Some(f) = s.follow.get_mut(&t.mint) else { return };
    if t.timestamp > f.first_ts + CHECKPOINTS[CHECKPOINTS.len() - 1] || f.trades.len() >= MAX_TRADES {
        return;
    }
    f.last_ts = f.last_ts.max(t.timestamp);
    f.trades.push(json!({
        "ts": t.timestamp,
        "slot": slot.unwrap_or(0),
        "sol_lamports": t.sol_amount,
        "v_sol": t.virtual_sol_reserves,
        "v_tokens": t.virtual_token_reserves,
        "side": if t.is_buy { "buy" } else { "sell" },
        "wallet": t.user,
    }));
}

/// Every few seconds: the coins due a checkpoint are asked about, the quiet ones dropped.
pub async fn run(ctx: crate::ai_risk::AiCtx) {
    let http = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().expect("ck http client");
    load();
    let mut round = 0u64;
    loop {
        tokio::time::sleep(Duration::from_secs(3)).await;
        round += 1;
        let t = now();
        if round % 10 == 3 {
            resolve(t);
        }
        if round % 10 == 8 {
            save();
        }
        let on = ctx.admin.ai_risk();
        // Due: (mint, checkpoint, trades so far, creator, launchpad).
        let due: Vec<(String, i64, Vec<Value>, String, String)> = {
            let mut s = store().lock().expect("ck store lock");
            let mut out = Vec::new();
            let mut drop = Vec::new();
            for (m, f) in s.follow.iter_mut() {
                let Some(&ck) = CHECKPOINTS.get(f.next) else {
                    drop.push(m.clone());
                    continue;
                };
                if t < f.first_ts + ck + 3 {
                    continue;
                }
                if f.last_ts < f.first_ts + ck - ALIVE || !on {
                    drop.push(m.clone());
                    continue;
                }
                f.next += 1;
                out.push((m.clone(), ck, f.trades.clone(), f.creator.clone(), f.launchpad.clone()));
                if f.next >= CHECKPOINTS.len() {
                    drop.push(m.clone());
                }
            }
            for m in drop {
                s.follow.remove(&m);
            }
            out
        };
        for (mint, ck, trades, creator, launchpad) in due {
            let (card, symbol) = {
                let board = ctx.app.board.lock().expect("board lock");
                let ft = board.tokens.get(&mint);
                (ft.map(|ft| json!({ "meta": ft.meta, "dev_report": ft.dev_report })), ft.map(|f| f.token.symbol.clone()).unwrap_or_default())
            };
            let p0 = trades.last().map_or(0.0, |l| {
                let (a, b) = (l["v_sol"].as_f64().unwrap_or(0.0), l["v_tokens"].as_f64().unwrap_or(0.0));
                if b > 0.0 { a / b } else { 0.0 }
            });
            let body = json!({ "ck": ck, "trades": trades, "creator": creator, "launchpad": launchpad, "card": card });
            let res = http.post(format!("{}/checkpoint", crate::ai_risk::service_url())).json(&body).send().await;
            let v = match res {
                Ok(r) if r.status().is_success() => r.json::<Value>().await.ok(),
                Ok(r) => {
                    store().lock().expect("ck store lock").ready = r.status().as_u16() != 503;
                    None
                }
                Err(_) => None,
            };
            let Some(v) = v else { continue };
            let win = v["win"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
            let line = v["line"].as_f64();
            let passed = line.is_some_and(|l| win >= l) && p0 > 0.0;
            let look = Look {
                ck,
                win,
                crash: v["crash"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0),
                line,
                passed,
                at: now(),
                p0,
                lo: p0,
                hi: p0,
                last: p0,
                hit: None,
                resolved: false,
                symbol,
                holders: v["holders"].as_u64().unwrap_or(0),
                early_still: v["early_still"].as_f64().unwrap_or(0.0),
                top10_held: v["top10_held"].as_f64().unwrap_or(0.0),
                dev_sold_frac: v["dev_sold_frac"].as_f64().unwrap_or(0.0),
            };
            let mut s = store().lock().expect("ck store lock");
            s.ready = true;
            // A picked coin keeps the look that picked it: that is the trade on record.
            if s.looks.get(&mint).is_some_and(|l| l.passed) {
                continue;
            }
            s.looks.insert(mint, look);
        }
    }
}

/// Picks whose hour is over: their real result joins the record.
fn resolve(t: i64) {
    let mut s = store().lock().expect("ck store lock");
    let mut done = Vec::new();
    for (mint, l) in s.looks.iter_mut() {
        if !l.resolved && (t >= l.at + HOLD || (l.passed && l.hit.is_some())) {
            l.resolved = true;
            if l.passed {
                done.push(Outcome { at: l.at, mint: mint.clone(), symbol: l.symbol.clone(), ck: l.ck, win: l.win, hit: l.hit, result: l.result() });
            }
        }
    }
    if !done.is_empty() {
        use std::io::Write;
        let _ = std::fs::create_dir_all("data");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(RECORD_FILE) {
            for o in &done {
                if let Ok(line) = serde_json::to_string(o) {
                    let _ = writeln!(f, "{line}");
                }
            }
        }
    }
    s.outcomes.extend(done);
    s.outcomes.retain(|o| o.at >= t - RECORD_SECS);
    s.looks.retain(|_, l| l.at >= t - KEEP_SECS);
}

fn save() {
    let list: Vec<(String, Look)> = store().lock().expect("ck store lock").looks.iter().map(|(m, l)| (m.clone(), l.clone())).collect();
    let Ok(body) = serde_json::to_vec(&list) else { return };
    let tmp = format!("{PICKS_FILE}.tmp");
    let _ = std::fs::create_dir_all("data").and_then(|_| std::fs::write(&tmp, body)).and_then(|_| std::fs::rename(&tmp, PICKS_FILE));
}

/// At start: the last two hours of looks and two days of results back from disk. The
/// price now is unknown after a restart until the coin trades again.
fn load() {
    let t = now();
    let mut s = store().lock().expect("ck store lock");
    if let Ok(text) = std::fs::read_to_string(PICKS_FILE) {
        if let Ok(list) = serde_json::from_str::<Vec<(String, Look)>>(&text) {
            for (m, mut l) in list.into_iter().filter(|(_, l)| l.at >= t - KEEP_SECS) {
                l.last = 0.0;
                s.looks.insert(m, l);
            }
        }
    }
    if let Ok(text) = std::fs::read_to_string(RECORD_FILE) {
        let kept: Vec<Outcome> = text.lines().filter_map(|l| serde_json::from_str::<Outcome>(l).ok()).filter(|o| o.at >= t - RECORD_SECS).collect();
        let body: String = kept.iter().filter_map(|o| serde_json::to_string(o).ok()).map(|l| l + "\n").collect();
        let _ = std::fs::write(RECORD_FILE, body);
        s.outcomes = kept;
    }
}

/// The picks of the last hour that are still worth showing (not stopped out, not crude
/// names, still on the board), best first, plus the live record of the last 24 hours.
pub fn picks(board: &crate::Board, t: i64) -> (Vec<(String, Look)>, Value) {
    let s = store().lock().expect("ck store lock");
    let mut list: Vec<(String, Look)> = s
        .looks
        .iter()
        .filter(|(m, l)| {
            l.passed
                && l.at >= t - HOLD
                && l.hit != Some(false)
                && board.tokens.get(*m).is_some_and(|ft| !crate::ai_chat::crude(&ft.token.symbol, &ft.token.name))
        })
        .map(|(m, l)| (m.clone(), l.clone()))
        .collect();
    list.sort_by(|a, b| b.1.win.total_cmp(&a.1.win));
    let day: Vec<&Outcome> = s.outcomes.iter().filter(|o| o.at >= t - 24 * 3600).collect();
    let n = day.len();
    let won = day.iter().filter(|o| o.hit == Some(true)).count();
    let stopped = day.iter().filter(|o| o.hit == Some(false)).count();
    let avg = if n > 0 { Some(day.iter().map(|o| o.result).sum::<f64>() / n as f64) } else { None };
    let record = json!({ "picks": n, "hit_target": won, "hit_stop": stopped, "avg_result": avg, "ready": s.ready });
    (list, record)
}

/// The latest look at one coin (for the chat).
pub fn look_of(mint: &str) -> Option<Look> {
    store().lock().expect("ck store lock").looks.get(mint).cloned()
}

/// For the admin's System page.
pub fn status() -> Value {
    let s = store().lock().expect("ck store lock");
    json!({ "ready": s.ready, "following": s.follow.len(), "looks": s.looks.len(), "picks": s.looks.values().filter(|l| l.passed).count() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tr(mint: &str, ts: i64, v_sol: u64) -> Trade {
        Trade {
            mint: mint.into(),
            sol_amount: 1_000_000_000,
            token_amount: 1,
            is_buy: true,
            user: "w".into(),
            timestamp: ts,
            virtual_sol_reserves: v_sol,
            virtual_token_reserves: 1_000_000_000,
            real_token_reserves: 0,
        }
    }

    fn look(p0: f64) -> Look {
        Look { ck: 900, win: 0.4, crash: 0.1, line: Some(0.3), passed: true, at: now(), p0, lo: p0, hi: p0, last: p0, hit: None, resolved: false, symbol: "S".into(), holders: 50, early_still: 0.4, top10_held: 0.3, dev_sold_frac: 0.0 }
    }

    #[test]
    fn collects_trades_up_to_the_last_checkpoint_only() {
        follow("ckA", "dev", "pump.fun", vec![json!({ "ts": 1000, "v_sol": 30, "v_tokens": 1 })]);
        trade(&tr("ckA", 1500, 30), None);
        trade(&tr("ckA", 1000 + 1800, 30), None);
        trade(&tr("ckA", 1000 + 1801, 30), None); // past 30 minutes
        trade(&tr("ckZ", 1500, 30), None); // never followed
        let s = store().lock().unwrap();
        assert_eq!(s.follow["ckA"].trades.len(), 3);
        assert_eq!(s.follow["ckA"].last_ts, 2800);
        assert!(!s.follow.contains_key("ckZ"));
    }

    #[test]
    fn a_pick_records_which_side_came_first() {
        store().lock().unwrap().looks.insert("ckB".into(), look(1.0));
        trade(&tr("ckB", 1, 1_300_000_000), None); // +30%: nothing yet
        assert_eq!(store().lock().unwrap().looks["ckB"].hit, None);
        trade(&tr("ckB", 2, 700_000_000), None); // -30%: the stop came first
        trade(&tr("ckB", 3, 1_600_000_000), None); // +60% later does not change it
        let l = store().lock().unwrap().looks["ckB"].clone();
        assert_eq!(l.hit, Some(false));
        assert!((l.result() - (SL * 0.99 / 1.01 - 1.0)).abs() < 1e-9);
    }

    #[test]
    fn result_counts_costs_on_both_sides() {
        let mut l = look(1.0);
        l.hit = Some(true);
        assert!((l.result() - (1.5 * 0.99 / 1.01 - 1.0)).abs() < 1e-9);
        l.hit = None;
        l.last = 1.0;
        assert!(l.result() < 0.0, "flat after an hour still loses the fees");
    }
}
