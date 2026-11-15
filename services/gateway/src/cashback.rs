//! Cashback (Rewards settings, "cashback tiers"): a share of the Kixo fees a user paid on
//! real trades this month comes back to them. The tier follows the month's real trading
//! volume. This module only counts: it shows each user what they have earned so far.
//! Paying it out moves money and opens with real trading, after the security review.
//!
//! `GET /account/cashback`.

use crate::account::AccountState;
use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone)]
pub struct CashbackCtx {
    pub acct: Arc<AccountState>,
    pub app: Arc<crate::AppState>,
    pub admin: Arc<crate::admin::AdminState>,
}

fn num(v: &Value) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0)
}

/// The first second of this UTC month.
fn month_start(now: i64) -> i64 {
    // Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm), then back.
    let days = now.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    (days - (d - 1)) * 86_400
}

pub async fn get(State(c): State<CashbackCtx>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let cfg = c.admin.rewards_snapshot();
    let from = month_start(crate::now_unix());
    let path = format!(
        "real_trades?user_id=eq.{}&status=eq.confirmed&created_at=gte.{}&select=sol_lamports,platform_fee_lamports&limit=20000",
        u.id,
        crate::account::chrono_iso(from)
    );
    let rows = c.acct.rest(reqwest::Method::GET, &path, None).await?.as_array().cloned().unwrap_or_default();
    let volume_sol: f64 = rows.iter().map(|r| num(&r["sol_lamports"]) / 1e9).sum::<f64>() + 0.0;
    let fees_sol: f64 = rows.iter().map(|r| num(&r["platform_fee_lamports"]) / 1e9).sum::<f64>() + 0.0;
    let sol_usd = c.app.board.lock().expect("board lock").sol_usd.unwrap_or(0.0);
    let volume_usd = volume_sol * sol_usd;
    let tier = cfg.cashback_tiers.iter().filter(|t| volume_usd >= t.min_usd).max_by(|a, b| a.min_usd.total_cmp(&b.min_usd)).cloned();
    let pct = if cfg.cashback_enabled { tier.as_ref().map_or(0.0, |t| t.pct) } else { 0.0 };
    let next = cfg.cashback_tiers.iter().filter(|t| t.min_usd > volume_usd).min_by(|a, b| a.min_usd.total_cmp(&b.min_usd)).cloned();
    Ok(Json(json!({
        "enabled": cfg.cashback_enabled,
        "month_start": from,
        "trades": rows.len(),
        "volume_usd": (volume_usd * 100.0).round() / 100.0,
        "fees_sol": fees_sol,
        "tier": tier.map(|t| json!({ "name": t.name, "pct": t.pct })),
        "next_tier": next.map(|t| json!({ "name": t.name, "pct": t.pct, "min_usd": t.min_usd })),
        "pct": pct,
        "cashback_sol": fees_sol * pct / 100.0,
        "min_claim_sol": cfg.min_claim_sol,
        "payouts_open": false,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_starts() {
        // 2026-11-15T20:00:00Z -> 2026-11-01T00:00:00Z
        assert_eq!(month_start(1_794_772_800), 1_793_491_200);
        // 2024-02-29T12:00:00Z -> 2024-02-01T00:00:00Z (leap year)
        assert_eq!(month_start(1_709_208_000), 1_706_745_600);
    }
}
