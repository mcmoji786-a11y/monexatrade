//! Keeps the database small (Supabase's free plan holds 500 MB). Every 6 hours:
//!
//! - Demo trades made by the automatic tools (sniper, copy, grid) older than
//!   DEMO_AUTO_KEEP_DAYS (default 60) are deleted. They are the bulk: a paper sniper can
//!   make hundreds a day. Manual and Quick Buy demo trades are kept, and so is every
//!   balance (stored on the account, not summed from trades).
//! - Closed demo orders (filled or cancelled) older than 30 days.
//! - Support live-chat presence and other short-lived rows are not touched here.
//!
//! Real trades are never deleted: they are money records. The admin switch "db_cleanup"
//! turns it off; each run is logged with how many rows went.

use crate::account::AccountState;
use std::{sync::Arc, time::Duration};

const EVERY: Duration = Duration::from_secs(6 * 3600);

fn keep_days() -> i64 {
    std::env::var("DEMO_AUTO_KEEP_DAYS").ok().and_then(|v| v.trim().parse().ok()).filter(|d: &i64| *d >= 7).unwrap_or(60)
}

pub async fn run(acct: Arc<AccountState>, admin: Arc<crate::admin::AdminState>) {
    // Not right at start: let the gateway settle first.
    tokio::time::sleep(Duration::from_secs(10 * 60)).await;
    loop {
        if admin.db_cleanup() {
            once(&acct).await;
        }
        tokio::time::sleep(EVERY).await;
    }
}

pub async fn once(acct: &AccountState) {
    let now = crate::now_unix();
    let trades_before = crate::account::chrono_iso(now - keep_days() * 86_400);
    let rules_before = crate::account::chrono_iso(now - 30 * 86_400);
    let trades = acct.delete_count(&format!("demo_trades?source=in.(sniper,copy,grid)&ts=lt.{trades_before}")).await;
    let orders = acct.delete_count(&format!("demo_orders?status=neq.open&created_at=lt.{rules_before}")).await;
    match (&trades, &orders) {
        (Ok(t), Ok(r)) => tracing::info!(demo_trades = t, demo_orders = r, "database clean-up done"),
        _ => tracing::warn!(trades = ?trades.err(), orders = ?orders.err(), "database clean-up incomplete"),
    }
}
