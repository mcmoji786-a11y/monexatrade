//! Daily loss limit (settings.safety.daily_loss_limit_usd). Once a user's realized loss
//! for their day reaches the limit, buying stops until their next local midnight; selling
//! always works, so nobody is ever stuck in a position. Demo and real are counted apart.
//!
//! "Lost today" is the net realized result of the day's sells: a win earlier in the day
//! offsets a later loss. Demo uses each sell's recorded profit. Real compares each sell's
//! SOL with the average SOL paid per token over the last 30 days of confirmed buys.

use crate::account::AccountState;
use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};

#[derive(Clone)]
pub struct LimitsCtx {
    pub acct: Arc<AccountState>,
    pub app: Arc<crate::AppState>,
}

fn num(v: &Value) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0)
}

/// The user's day: (start, next start) in unix seconds, for minutes east of UTC.
pub fn day_bounds(now: i64, offset_min: i32) -> (i64, i64) {
    let off = offset_min as i64 * 60;
    let local = now + off;
    let start = local - local.rem_euclid(86_400) - off;
    (start, start + 86_400)
}

async fn demo_lost(a: &AccountState, user: &str, from: i64) -> f64 {
    let path = format!("demo_trades?user_id=eq.{user}&side=eq.sell&ts=gte.{}&select=realized_usd&limit=10000", crate::account::chrono_iso(from));
    let net: f64 = a.rest(reqwest::Method::GET, &path, None).await.ok().and_then(|v| v.as_array().map(|r| r.iter().map(|x| num(&x["realized_usd"])).sum())).unwrap_or(0.0);
    (-net).max(0.0)
}

/// Realized SOL of the day's confirmed real sells, against 30 days of buys.
async fn real_lost_sol(a: &AccountState, user: &str, from: i64) -> f64 {
    let since = crate::account::chrono_iso(from - 30 * 86_400);
    let path = format!("real_trades?user_id=eq.{user}&status=eq.confirmed&created_at=gte.{since}&select=mint,side,sol_change_lamports,token_change,created_at&order=created_at.asc&limit=10000");
    let Ok(v) = a.rest(reqwest::Method::GET, &path, None).await else { return 0.0 };
    let rows = v.as_array().cloned().unwrap_or_default();
    // Average SOL paid per token, per coin: (lamports paid, tokens got).
    let mut cost: HashMap<String, (f64, f64)> = HashMap::new();
    let mut net = 0.0;
    for r in &rows {
        let mint = r["mint"].as_str().unwrap_or_default().to_string();
        let sol = num(&r["sol_change_lamports"]) / 1e9;
        let tokens = num(&r["token_change"]).abs();
        if r["side"].as_str() == Some("buy") {
            let e = cost.entry(mint).or_default();
            e.0 += (-sol).max(0.0);
            e.1 += tokens;
        } else {
            let at = r["created_at"].as_str().and_then(crate::growth::parse_iso).unwrap_or(0);
            let (paid, got) = cost.get(&mint).copied().unwrap_or_default();
            if at >= from && got > 0.0 {
                net += sol.max(0.0) - paid / got * tokens;
            }
        }
    }
    (-net).max(0.0)
}

pub struct Today {
    pub limit: f64,
    pub demo_lost: f64,
    pub real_lost: f64,
    pub resets_at: i64,
}

pub async fn today(a: &AccountState, app: &crate::AppState, user: &str) -> Today {
    let s = crate::settings::load(a, user).await.safety;
    let (from, next) = day_bounds(crate::now_unix(), s.day_offset_min);
    if s.daily_loss_limit_usd <= 0.0 {
        return Today { limit: 0.0, demo_lost: 0.0, real_lost: 0.0, resets_at: next };
    }
    let sol_usd = app.board.lock().expect("board lock").sol_usd.unwrap_or(0.0);
    let (d, r) = tokio::join!(demo_lost(a, user, from), real_lost_sol(a, user, from));
    Today { limit: s.daily_loss_limit_usd, demo_lost: d, real_lost: r * sol_usd, resets_at: next }
}

/// Err with the user-facing reason when buying is paused for the day.
pub async fn check_buy(a: &AccountState, app: &crate::AppState, user: &str, demo: bool) -> Result<(), String> {
    let t = today(a, app, user).await;
    let lost = if demo { t.demo_lost } else { t.real_lost };
    if t.limit > 0.0 && lost >= t.limit {
        let hours = ((t.resets_at - crate::now_unix()).max(0) as f64 / 3600.0).ceil() as i64;
        return Err(format!(
            "Daily loss limit reached: ${lost:.2} lost today against your ${:.0} limit. Buying is paused for about {hours} more hour{}; selling still works. You can change the limit in Settings",
            t.limit,
            if hours == 1 { "" } else { "s" }
        ));
    }
    Ok(())
}

/// `GET /account/limits`: today's loss against the limit, for the banner and Settings.
pub async fn get(State(c): State<LimitsCtx>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let t = today(&c.acct, &c.app, &u.id).await;
    Ok(Json(json!({
        "limit_usd": t.limit,
        "demo_lost_usd": (t.demo_lost * 100.0).round() / 100.0,
        "real_lost_usd": (t.real_lost * 100.0).round() / 100.0,
        "demo_blocked": t.limit > 0.0 && t.demo_lost >= t.limit,
        "real_blocked": t.limit > 0.0 && t.real_lost >= t.limit,
        "resets_at": t.resets_at,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_starts_at_local_midnight() {
        // 2026-11-15 20:00 UTC is 01:00 on the 16th in Pakistan (UTC+5).
        let now = 1_794_772_800; // 2026-11-15T20:00:00Z
        let (start, next) = day_bounds(now, 300);
        assert_eq!(start, 1_794_769_200); // 2026-11-15T19:00:00Z = 00:00 PKT on the 16th
        assert_eq!(next - start, 86_400);
        let (s0, _) = day_bounds(now, 0);
        assert_eq!(s0, 1_794_700_800); // 2026-11-15T00:00:00Z
        assert!(start <= now && now < next);
    }
}
