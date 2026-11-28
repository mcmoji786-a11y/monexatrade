//! Account settings, data export and account deletion.
//!
//! Settings are validated and clamped here before they are stored, so a hand-made
//! request can never set, say, a 99% slippage or 50 presets. They live in
//! `user_settings` (migration 0006) and follow the user to every device.

use crate::account::AccountState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Trading {
    /// Default slippage for real trades, basis points.
    pub slippage_bps: u64,
    /// "fast" or "turbo".
    pub speed: String,
    pub mev: bool,
    /// Buy buttons, in SOL.
    pub buy_presets: Vec<f64>,
    /// Sell buttons, in % of the position.
    pub sell_presets: Vec<f64>,
    /// Ask once more before buying at least this much SOL (0: never).
    pub confirm_above_sol: f64,
    /// The Quick Buy button on Discover and Sol Radar rows, in SOL.
    pub quick_buy_sol: f64,
    /// Three fee presets for buying and three for selling (P1, P2, P3), and which is in use.
    pub buy_fees: Vec<FeePreset>,
    pub sell_fees: Vec<FeePreset>,
    pub buy_fee: usize,
    pub sell_fee: usize,
}

/// How a real trade pays to land: Kixo picks the fee from the network (`auto`), or the
/// user's own priority fee and tip, in SOL.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct FeePreset {
    pub auto: bool,
    pub priority_sol: f64,
    pub tip_sol: f64,
    pub slippage_bps: u64,
    pub mev: bool,
}

impl Default for FeePreset {
    fn default() -> Self {
        Self { auto: true, priority_sol: 0.0002, tip_sol: 0.00001, slippage_bps: 1_000, mev: true }
    }
}

/// P1: Kixo picks a low fee from the network. P2: faster. P3: for the first seconds of a launch.
pub fn default_fees() -> Vec<FeePreset> {
    vec![
        FeePreset::default(),
        FeePreset { auto: false, priority_sol: 0.001, tip_sol: 0.001, slippage_bps: 1_500, mev: true },
        FeePreset { auto: false, priority_sol: 0.005, tip_sol: 0.003, slippage_bps: 2_000, mev: false },
    ]
}

impl Default for Trading {
    fn default() -> Self {
        Self {
            slippage_bps: 1_000,
            speed: "fast".into(),
            mev: true,
            buy_presets: vec![0.05, 0.1, 0.25, 0.5, 1.0],
            sell_presets: vec![25.0, 50.0, 75.0, 100.0],
            confirm_above_sol: 1.0,
            quick_buy_sol: 0.1,
            buy_fees: default_fees(),
            sell_fees: default_fees(),
            buy_fee: 0,
            sell_fee: 0,
        }
    }
}

/// Exactly three presets, every value inside Kixo's fee limits.
fn fee_presets(v: &[FeePreset]) -> Vec<FeePreset> {
    let min_p = crate::trade::MIN_PRIORITY as f64 / 1e9;
    let min_t = crate::trade::MIN_TIP as f64 / 1e9;
    let max = crate::trade::MAX_CUSTOM_FEE as f64 / 1e9;
    let fit = |x: f64, lo: f64, d: f64| if x.is_finite() { x.clamp(lo, max) } else { d };
    default_fees()
        .into_iter()
        .enumerate()
        .map(|(i, d)| match v.get(i) {
            Some(p) => FeePreset {
                auto: p.auto,
                priority_sol: fit(p.priority_sol, min_p, d.priority_sol),
                tip_sol: fit(p.tip_sol, min_t, d.tip_sol),
                slippage_bps: p.slippage_bps.clamp(10, 5_000),
                mev: p.mev,
            },
            None => d,
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Demo {
    /// Demo buy buttons, in USD.
    pub buy_presets_usd: Vec<f64>,
    /// The Quick Buy button on demo, in USD.
    pub quick_buy_usd: f64,
}

impl Default for Demo {
    fn default() -> Self {
        Self { buy_presets_usd: vec![10.0, 50.0, 100.0, 500.0], quick_buy_usd: 25.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Notifications {
    /// Pop-ups for filled trades.
    pub trades: bool,
    /// Pop-ups when a take profit or stop loss fires.
    pub exits: bool,
    /// Pop-ups from the paper sniper.
    pub sniper: bool,
    /// A short sound with trade and exit pop-ups.
    pub sound: bool,
}

impl Default for Notifications {
    fn default() -> Self {
        Self { trades: true, exits: true, sniper: true, sound: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct General {
    /// Account mode after signing in: "last", "demo" or "real".
    pub start_mode: String,
}

impl Default for General {
    fn default() -> Self {
        Self { start_mode: "last".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Safety {
    /// Buying stops for the rest of the day after losing this many USD (0: off). Demo and
    /// real are counted apart; selling always works (limits.rs).
    pub daily_loss_limit_usd: f64,
    /// Where the user's day starts: minutes east of UTC, from the browser.
    pub day_offset_min: i32,
    /// Warn (never block) when buying a coin Kixo AI calls Danger.
    pub warn_danger: bool,
    /// Rug exit (rug_exit.rs): sell a demo position by itself on a rug sign. Off by default.
    pub rug_exit: bool,
    /// ...when the coin's creator sells.
    pub rug_exit_dev: bool,
    /// ...when Kixo AI calls the coin Danger.
    pub rug_exit_ai: bool,
}

impl Default for Safety {
    fn default() -> Self {
        Self { daily_loss_limit_usd: 0.0, day_offset_min: 0, warn_danger: true, rug_exit: false, rug_exit_dev: true, rug_exit_ai: true }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub trading: Trading,
    pub demo: Demo,
    pub notifications: Notifications,
    pub general: General,
    pub safety: Safety,
}

fn presets(v: &[f64], min: f64, max: f64, most: usize, fallback: &[f64]) -> Vec<f64> {
    let mut out: Vec<f64> = v.iter().copied().filter(|x| x.is_finite() && *x >= min && *x <= max).map(|x| (x * 1_000.0).round() / 1_000.0).take(most).collect();
    out.dedup();
    if out.is_empty() {
        fallback.to_vec()
    } else {
        out
    }
}

impl Settings {
    /// Keeps every value inside its allowed range; unknown choices fall back to defaults.
    pub fn clamp(mut self) -> Self {
        let d = Settings::default();
        let t = &mut self.trading;
        t.slippage_bps = t.slippage_bps.clamp(10, 5_000);
        if t.speed != "fast" && t.speed != "turbo" {
            t.speed = d.trading.speed.clone();
        }
        t.buy_presets = presets(&t.buy_presets, 0.001, crate::trade::MAX_LAMPORTS as f64 / 1e9, 5, &d.trading.buy_presets);
        t.sell_presets = presets(&t.sell_presets, 1.0, 100.0, 4, &d.trading.sell_presets);
        t.confirm_above_sol = if t.confirm_above_sol.is_finite() { t.confirm_above_sol.clamp(0.0, 3.0) } else { d.trading.confirm_above_sol };
        t.quick_buy_sol = if t.quick_buy_sol.is_finite() { t.quick_buy_sol.clamp(0.001, crate::trade::MAX_LAMPORTS as f64 / 1e9) } else { d.trading.quick_buy_sol };
        t.buy_fees = fee_presets(&t.buy_fees);
        t.sell_fees = fee_presets(&t.sell_fees);
        t.buy_fee = t.buy_fee.min(2);
        t.sell_fee = t.sell_fee.min(2);
        self.demo.quick_buy_usd = if self.demo.quick_buy_usd.is_finite() { self.demo.quick_buy_usd.clamp(1.0, 10_000.0) } else { d.demo.quick_buy_usd };
        self.demo.buy_presets_usd = presets(&self.demo.buy_presets_usd, 1.0, 10_000.0, 4, &d.demo.buy_presets_usd);
        let lim = self.safety.daily_loss_limit_usd;
        self.safety.daily_loss_limit_usd = if lim.is_finite() { (lim.clamp(0.0, 1_000_000.0) * 100.0).round() / 100.0 } else { 0.0 };
        self.safety.day_offset_min = self.safety.day_offset_min.clamp(-720, 840);
        if !matches!(self.general.start_mode.as_str(), "last" | "demo" | "real") {
            self.general.start_mode = d.general.start_mode;
        }
        self
    }
}

type ApiErr = (StatusCode, String);

/// A user's saved settings, defaults filled in (defaults if none or unreadable).
pub async fn load(a: &AccountState, user: &str) -> Settings {
    a.rest(reqwest::Method::GET, &format!("user_settings?user_id=eq.{user}&select=settings"), None)
        .await
        .ok()
        .and_then(|v| v.as_array().and_then(|r| r.first()).and_then(|r| serde_json::from_value::<Settings>(r["settings"].clone()).ok()))
        .unwrap_or_default()
}

/// `GET /account/settings`: the user's settings, defaults filled in.
pub async fn get(State(a): State<Arc<AccountState>>, headers: HeaderMap) -> Result<Json<Settings>, ApiErr> {
    let u = a.user(&headers).await?;
    let v = a.rest(reqwest::Method::GET, &format!("user_settings?user_id=eq.{}&select=settings", u.id), None).await?;
    let s = v.as_array().and_then(|r| r.first()).and_then(|r| serde_json::from_value::<Settings>(r["settings"].clone()).ok()).unwrap_or_default();
    Ok(Json(s.clamp()))
}

/// `PUT /account/settings`: saves the settings, clamped to their allowed ranges.
pub async fn put(State(a): State<Arc<AccountState>>, headers: HeaderMap, Json(s): Json<Settings>) -> Result<Json<Settings>, ApiErr> {
    let u = a.user(&headers).await?;
    let s = s.clamp();
    a.rest(
        reqwest::Method::POST,
        "user_settings?on_conflict=user_id",
        Some(json!({ "user_id": u.id, "settings": s, "updated_at": crate::account::chrono_iso(now()) })),
    )
    .await?;
    Ok(Json(s))
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// `GET /account/export`: everything Kixo stores about the user, as one JSON file.
pub async fn export(State(a): State<Arc<AccountState>>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let u = a.user(&headers).await?;
    let id = &u.id;
    let get = |path: String| {
        let a = a.clone();
        async move { a.rest(reqwest::Method::GET, &path, None).await.unwrap_or(Value::Null) }
    };
    let (profile, settings, demo_account, demo_positions, demo_trades, demo_orders, real_trades) = tokio::join!(
        get(format!("profiles?id=eq.{id}&select=login_method,wallet,ref_code,referred_at,created_at")),
        get(format!("user_settings?user_id=eq.{id}&select=settings,updated_at")),
        get(format!("demo_accounts?user_id=eq.{id}&select=*")),
        get(format!("demo_positions?user_id=eq.{id}&select=*")),
        get(format!("demo_trades?user_id=eq.{id}&select=*&order=ts.desc")),
        get(format!("demo_orders?user_id=eq.{id}&select=*&order=created_at.desc")),
        get(format!("real_trades?user_id=eq.{id}&select=*&order=created_at.desc")),
    );
    let first = |v: Value| v.as_array().and_then(|r| r.first().cloned()).unwrap_or(Value::Null);
    Ok(Json(json!({
        "exported_at": crate::account::chrono_iso(now()),
        "account": { "id": id, "email": u.email, "profile": first(profile) },
        "settings": first(settings),
        "demo": { "account": first(demo_account), "positions": demo_positions, "trades": demo_trades, "orders": demo_orders },
        "real_trades": real_trades,
    })))
}

#[derive(Deserialize)]
pub struct DeleteIn {
    confirm: String,
}

/// `POST /account/delete {confirm: "DELETE"}`: deletes the account. Profile, settings
/// and demo data go with it; real trade records stay without the user, as on-chain
/// history and fee accounting require.
pub async fn delete(State(a): State<Arc<AccountState>>, headers: HeaderMap, Json(i): Json<DeleteIn>) -> Result<Json<Value>, ApiErr> {
    let u = a.user(&headers).await?;
    if i.confirm != "DELETE" {
        return Err((StatusCode::BAD_REQUEST, "type DELETE to confirm".into()));
    }
    a.delete_user(&u.id).await?;
    tracing::info!(user = u.id, "account deleted by its owner");
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_are_kept_in_range() {
        let wild = Settings {
            trading: Trading { slippage_bps: 99_000, speed: "warp".into(), mev: false, buy_presets: vec![0.0, 0.5, 9.0, f64::NAN, 1.0, 2.0, 0.2, 0.3], sell_presets: vec![0.0, 150.0], confirm_above_sol: 40.0, quick_buy_sol: 99.0, buy_fees: vec![FeePreset { auto: false, priority_sol: 5.0, tip_sol: 0.0, slippage_bps: 99_000, mev: true }], sell_fees: vec![], buy_fee: 9, sell_fee: 1 },
            demo: Demo { buy_presets_usd: vec![], quick_buy_usd: f64::NAN },
            notifications: Notifications::default(),
            general: General { start_mode: "moon".into() },
            safety: Safety { daily_loss_limit_usd: -50.0, day_offset_min: 5_000, warn_danger: false, ..Safety::default() },
        }
        .clamp();
        assert_eq!(wild.safety.daily_loss_limit_usd, 0.0, "a negative limit is off");
        assert_eq!(wild.safety.day_offset_min, 840);
        assert_eq!(wild.trading.slippage_bps, 5_000);
        assert_eq!(wild.trading.speed, "fast");
        assert_eq!(wild.trading.buy_fees.len(), 3, "always three presets");
        let p = &wild.trading.buy_fees[0];
        assert_eq!((p.priority_sol, p.tip_sol, p.slippage_bps), (0.1, 0.000005, 5_000), "fees inside the limits");
        assert_eq!(wild.trading.buy_fees[1], default_fees()[1]);
        assert_eq!((wild.trading.buy_fee, wild.trading.sell_fee), (2, 1));
        assert!(!wild.trading.mev, "a valid choice is kept");
        assert_eq!(wild.trading.buy_presets, vec![0.5, 1.0, 2.0, 0.2, 0.3], "out-of-range values dropped, at most five");
        assert_eq!(wild.trading.sell_presets, Trading::default().sell_presets, "nothing valid left: defaults");
        assert_eq!(wild.trading.confirm_above_sol, 3.0);
        assert_eq!(wild.demo.buy_presets_usd, Demo::default().buy_presets_usd);
        assert_eq!(wild.trading.quick_buy_sol, crate::trade::MAX_LAMPORTS as f64 / 1e9, "Quick Buy capped at the trade limit");
        assert_eq!(wild.demo.quick_buy_usd, Demo::default().quick_buy_usd, "not a number: default");
        assert_eq!(wild.general.start_mode, "last");
        // Missing fields read as defaults.
        let partial: Settings = serde_json::from_value(json!({ "trading": { "slippage_bps": 500 } })).unwrap();
        assert_eq!(partial.clamp().trading.speed, "fast");
        assert_eq!(Settings::default().clamp(), Settings::default());
    }
}
