//! Rug exit: sells a user's demo position by itself on a rug sign, around the clock.
//!
//! Signs (each one the user turns on in Settings, Safety):
//! - Dev sells: the coin's creator sells at least `DEV_MIN_SOL` (decoded trades).
//! - AI Danger: Kixo AI gives the coin a crash chance of `AI_DANGER` or more (ai_risk.rs),
//!   the same line the site calls "Danger".
//!
//! The whole position is sold at the live market with the demo engine's real costs
//! (demo::sell_all) and recorded as source "rug_exit". One exit per user and coin; a
//! position bought again later is watched again. Real positions are not touched: real
//! trading has its own review. The admin switch "rug_exit" stops it all.
//!
//! Users with rug exit on are read from `user_settings` every 30 s; their open demo
//! positions every 10 s, and a new buy is watched the moment it fills (`note_buy`), so a
//! dev who dumps seconds after the buy is still caught. A sale that fails is tried again
//! after `RETRY`.

use crate::demo::DemoCtx;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};
use std::sync::OnceLock;
use tokio::sync::{broadcast, Mutex};

/// A creator sale smaller than this is ignored (dust, fee top-ups).
const DEV_MIN_SOL: f64 = 0.05;
/// The AI's crash chance from which a coin is "Danger" (web lib/ai-risk.ts).
pub const AI_DANGER: f64 = 0.4;
const USERS_EVERY: Duration = Duration::from_secs(30);
const POSITIONS_EVERY: Duration = Duration::from_secs(10);
/// An exit is not tried again for the same position within this time.
const REPEAT: Duration = Duration::from_secs(600);
/// A sale that failed (no price at that moment) is tried again after this.
const RETRY: Duration = Duration::from_secs(20);

/// The running watcher's state, so a demo buy can register itself at once.
static LIVE: OnceLock<Arc<Mutex<State>>> = OnceLock::new();

/// A demo buy just filled: watch the position now instead of at the next refresh, if
/// this user has rug exit on.
pub fn note_buy(user: &str, mint: &str) {
    let Some(st) = LIVE.get().cloned() else { return };
    let (user, mint) = (user.to_string(), mint.to_string());
    tokio::spawn(async move { watch(&st, &user, &mint).await });
}

async fn watch(st: &Mutex<State>, user: &str, mint: &str) {
    let mut s = st.lock().await;
    if s.users.contains_key(user) {
        s.holders.entry(mint.to_string()).or_default().insert(user.to_string());
        s.fresh.insert((user.to_string(), mint.to_string()), Instant::now());
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rules {
    dev: bool,
    ai: bool,
}

#[derive(Default)]
struct State {
    users: HashMap<String, Rules>,
    /// mint -> users holding it (only users with rug exit on).
    holders: HashMap<String, HashSet<String>>,
    /// (user, mint) -> when an exit was last tried.
    tried: HashMap<(String, String), Instant>,
    /// (user, mint) -> when a buy registered it (kept through the next refresh).
    fresh: HashMap<(String, String), Instant>,
}

#[derive(Clone)]
pub struct RugCtx {
    pub demo: DemoCtx,
    pub admin: Arc<crate::admin::AdminState>,
}

pub fn spawn(c: RugCtx) {
    let st = Arc::new(Mutex::new(State::default()));
    let _ = LIVE.set(st.clone());
    tokio::spawn(refresh_loop(c.clone(), st.clone()));
    tokio::spawn(trades_loop(c.clone(), st.clone()));
    tokio::spawn(ai_loop(c, st));
}

fn rules_of(settings: &Value) -> Option<Rules> {
    let s = &settings["safety"];
    if s["rug_exit"].as_bool() != Some(true) {
        return None;
    }
    let r = Rules { dev: s["rug_exit_dev"].as_bool().unwrap_or(true), ai: s["rug_exit_ai"].as_bool().unwrap_or(true) };
    (r.dev || r.ai).then_some(r)
}

async fn refresh_loop(c: RugCtx, st: Arc<Mutex<State>>) {
    let mut last_users: Option<Instant> = None;
    loop {
        if c.admin.rug_exit() {
            if last_users.is_none_or(|t| t.elapsed() >= USERS_EVERY) {
                if let Ok(v) = c.demo.acct.rest(reqwest::Method::GET, "user_settings?settings->safety->>rug_exit=eq.true&select=user_id,settings&limit=20000", None).await {
                    let users: HashMap<String, Rules> = v
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|r| Some((r["user_id"].as_str()?.to_string(), rules_of(&r["settings"])?)))
                        .collect();
                    st.lock().await.users = users;
                    last_users = Some(Instant::now());
                }
            }
            let ids: Vec<String> = st.lock().await.users.keys().cloned().collect();
            let mut holders: HashMap<String, HashSet<String>> = HashMap::new();
            let mut ok = true;
            for chunk in ids.chunks(100) {
                let path = format!("demo_positions?tokens=gt.0&user_id=in.({})&select=user_id,mint&limit=10000", chunk.join(","));
                match c.demo.acct.rest(reqwest::Method::GET, &path, None).await {
                    Ok(v) => {
                        for r in v.as_array().into_iter().flatten() {
                            if let (Some(u), Some(m)) = (r["user_id"].as_str(), r["mint"].as_str()) {
                                holders.entry(m.to_string()).or_default().insert(u.to_string());
                            }
                        }
                    }
                    Err(_) => ok = false,
                }
            }
            if ok {
                let mut s = st.lock().await;
                // Positions registered by a buy in the last moments may not be in this read yet.
                let recent: Vec<(String, String)> = s.fresh.iter().filter(|(_, at)| at.elapsed() < POSITIONS_EVERY * 2).map(|(k, _)| k.clone()).collect();
                s.fresh.retain(|_, at| at.elapsed() < POSITIONS_EVERY * 2);
                for (u, m) in recent {
                    holders.entry(m).or_default().insert(u);
                }
                // A position that is gone (sold, or bought again later) can be exited again.
                s.tried.retain(|(u, m), at| at.elapsed() < REPEAT && holders.get(m).is_some_and(|h| h.contains(u)));
                s.holders = holders;
            }
        }
        tokio::time::sleep(POSITIONS_EVERY).await;
    }
}

/// Users to exit from `mint` for a sign, marked as tried.
async fn due(st: &Mutex<State>, mint: &str, ai: bool) -> Vec<String> {
    let mut s = st.lock().await;
    let Some(h) = s.holders.get(mint).cloned() else { return Vec::new() };
    let mut out = Vec::new();
    for u in h {
        let Some(r) = s.users.get(&u).copied() else { continue };
        if !(if ai { r.ai } else { r.dev }) {
            continue;
        }
        let key = (u.clone(), mint.to_string());
        if s.tried.get(&key).is_some_and(|at| at.elapsed() < REPEAT) {
            continue;
        }
        s.tried.insert(key, Instant::now());
        out.push(u);
    }
    out
}

async fn exit(c: &RugCtx, st: &Mutex<State>, user: &str, mint: &str, why: &str) {
    match crate::demo::sell_all(&c.demo, user, mint, "rug_exit").await {
        Ok(Some((fill, symbol, realized))) => tracing::info!(user, mint, symbol, usd = fill.usd, realized, why, "rug exit sold a demo position"),
        Ok(None) => {}
        Err(e) => {
            tracing::warn!(user, mint, error = %e.1, "rug exit could not sell, trying again shortly");
            retry_soon(st, user, mint).await;
        }
    }
}

/// Lets `due` pick this position again after `RETRY` instead of `REPEAT`.
async fn retry_soon(st: &Mutex<State>, user: &str, mint: &str) {
    if let Some(at) = st.lock().await.tried.get_mut(&(user.to_string(), mint.to_string())) {
        *at = Instant::now().checked_sub(REPEAT - RETRY).unwrap_or(*at);
    }
}

async fn trades_loop(c: RugCtx, st: Arc<Mutex<State>>) {
    let mut rx = c.demo.app.trades.subscribe();
    loop {
        match rx.recv().await {
            Ok((mint, t)) => {
                if !(t.dev && !t.is_buy && t.sol >= DEV_MIN_SOL) || !c.admin.rug_exit() {
                    continue;
                }
                for user in due(&st, &mint, false).await {
                    let (c, st, mint) = (c.clone(), st.clone(), mint.clone());
                    tokio::spawn(async move { exit(&c, &st, &user, &mint, "dev sold").await });
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

async fn ai_loop(c: RugCtx, st: Arc<Mutex<State>>) {
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        if !c.admin.rug_exit() || !c.admin.ai_risk() {
            continue;
        }
        let mints: Vec<String> = st.lock().await.holders.keys().cloned().collect();
        for mint in mints {
            if !crate::ai_risk::score_of(&mint).is_some_and(|r| r.dump >= AI_DANGER) {
                continue;
            }
            for user in due(&st, &mint, true).await {
                let (c, st, mint) = (c.clone(), st.clone(), mint.clone());
                tokio::spawn(async move { exit(&c, &st, &user, &mint, "AI danger").await });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rules_follow_the_settings() {
        assert_eq!(rules_of(&json!({ "safety": { "rug_exit": false } })), None);
        assert_eq!(rules_of(&json!({})), None);
        assert_eq!(rules_of(&json!({ "safety": { "rug_exit": true } })), Some(Rules { dev: true, ai: true }));
        assert_eq!(rules_of(&json!({ "safety": { "rug_exit": true, "rug_exit_ai": false } })), Some(Rules { dev: true, ai: false }));
        assert_eq!(rules_of(&json!({ "safety": { "rug_exit": true, "rug_exit_ai": false, "rug_exit_dev": false } })), None);
    }

    #[tokio::test]
    async fn one_exit_per_position_and_only_for_chosen_signs() {
        let st = Mutex::new(State::default());
        {
            let mut s = st.lock().await;
            s.users.insert("a".into(), Rules { dev: true, ai: false });
            s.users.insert("b".into(), Rules { dev: true, ai: true });
            s.holders.insert("M".into(), HashSet::from(["a".to_string(), "b".to_string(), "c".to_string()]));
        }
        let mut ai = due(&st, "M", true).await;
        ai.sort();
        assert_eq!(ai, vec!["b"], "only b wants AI exits; c has rug exit off");
        let mut dev = due(&st, "M", false).await;
        dev.sort();
        assert_eq!(dev, vec!["a"], "b was already exited from M");
        assert!(due(&st, "M", false).await.is_empty(), "never twice");
        assert!(due(&st, "OTHER", false).await.is_empty());
    }

    #[tokio::test]
    async fn a_new_buy_is_watched_at_once_and_a_failed_sale_comes_back_soon() {
        let st = Mutex::new(State::default());
        st.lock().await.users.insert("a".into(), Rules { dev: true, ai: true });
        watch(&st, "a", "NEW").await;
        watch(&st, "off", "NEW").await;
        assert_eq!(due(&st, "NEW", false).await, vec!["a"], "watched before any refresh; users without rug exit are not");
        assert!(due(&st, "NEW", false).await.is_empty());
        retry_soon(&st, "a", "NEW").await;
        let at = st.lock().await.tried[&("a".to_string(), "NEW".to_string())];
        assert!(at.elapsed() >= REPEAT - RETRY, "a failed sale is due again after RETRY");
    }
}
