//! Rewards settings and creator applications, with a small admin API.
//!
//! Admin calls need the `x-admin-token` header to match `ADMIN_TOKEN` from the
//! environment (16+ characters). Without it every admin route answers 403. Data is
//! kept in `data/` (gitignored) until Supabase accounts replace it.

use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const REWARDS_FILE: &str = "data/rewards.json";
const APPLICATIONS_FILE: &str = "data/creator_applications.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tier {
    pub name: String,
    pub unlock: String,
    pub min_usd: f64,
    pub pct: f64,
}

/// Every rewards number the site shows. Edited from the admin page.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct RewardsConfig {
    /// Shows the "Draft rates" label until the founder confirms the numbers.
    pub draft: bool,
    pub trading_fee_pct: f64,
    /// Invite links on or off for everyone.
    pub referral_enabled: bool,
    pub invitee_discount_pct: f64,
    pub referral_tiers: Vec<Tier>,
    pub cashback_enabled: bool,
    pub cashback_tiers: Vec<Tier>,
    /// Creator applications open or closed.
    pub creator_open: bool,
    pub creator_max_share_pct: f64,
    pub min_claim_sol: f64,
}

fn tier(name: &str, unlock: &str, min_usd: f64, pct: f64) -> Tier {
    Tier { name: name.into(), unlock: unlock.into(), min_usd, pct }
}

impl Default for RewardsConfig {
    fn default() -> Self {
        Self {
            draft: true,
            trading_fee_pct: 1.0,
            referral_enabled: true,
            invitee_discount_pct: 10.0,
            referral_tiers: vec![
                tier("Bronze", "From your first invite", 0.0, 20.0),
                tier("Silver", "$250K traded by your invites", 250_000.0, 25.0),
                tier("Gold", "$1M traded by your invites", 1_000_000.0, 30.0),
                tier("Diamond", "$5M traded by your invites", 5_000_000.0, 35.0),
            ],
            cashback_enabled: true,
            cashback_tiers: vec![
                tier("Starter", "Every trader", 0.0, 5.0),
                tier("Active", "$50K traded this month", 50_000.0, 10.0),
                tier("Pro", "$250K traded this month", 250_000.0, 15.0),
                tier("Whale", "$1M traded this month", 1_000_000.0, 20.0),
            ],
            creator_open: true,
            creator_max_share_pct: 40.0,
            min_claim_sol: 0.05,
        }
    }
}

impl RewardsConfig {
    /// Sane ranges only: percentages 0..=100, tiers in rising order, short names.
    fn validate(&self) -> Result<(), String> {
        let pct = |v: f64, what: &str| if (0.0..=100.0).contains(&v) { Ok(()) } else { Err(format!("{what} must be 0 to 100")) };
        pct(self.trading_fee_pct, "trading fee")?;
        pct(self.invitee_discount_pct, "invitee discount")?;
        pct(self.creator_max_share_pct, "creator share")?;
        if !(0.0..=1_000.0).contains(&self.min_claim_sol) {
            return Err("minimum claim out of range".into());
        }
        for (list, what) in [(&self.referral_tiers, "referral"), (&self.cashback_tiers, "cashback")] {
            if list.is_empty() || list.len() > 8 {
                return Err(format!("{what}: 1 to 8 tiers"));
            }
            for (i, t) in list.iter().enumerate() {
                pct(t.pct, &format!("{what} tier {}", t.name))?;
                if t.name.trim().is_empty() || t.name.len() > 24 || t.unlock.len() > 80 {
                    return Err(format!("{what} tier {}: name 1-24 characters, unlock under 80", i + 1));
                }
                if t.min_usd < 0.0 || (i > 0 && t.min_usd < list[i - 1].min_usd) {
                    return Err(format!("{what} tiers must rise in volume"));
                }
            }
        }
        Ok(())
    }
}

/// Every user-facing feature can be switched off from the admin, plus a site-wide
/// announcement and maintenance mode. New features add their flag here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct FeatureFlags {
    pub maintenance: bool,
    pub maintenance_message: String,
    pub announcement_on: bool,
    pub announcement: String,
    pub discover: bool,
    pub radar: bool,
    pub trade_page: bool,
    pub sniper: bool,
    pub smart_money: bool,
    pub wallet_monitor: bool,
    pub price_alerts: bool,
    pub ai_analysis: bool,
    pub rewards: bool,
    pub safety_score: bool,
    /// Sign-in and accounts (Google, Phantom, email).
    pub accounts: bool,
    /// Portfolio page.
    pub portfolio: bool,
    /// Demo trading account.
    pub demo: bool,
    /// Shareable P&L cards for trades.
    pub share_cards: bool,
    /// Take profit / stop loss on demo positions.
    pub demo_orders: bool,
    /// Weekly demo competition page.
    pub competition: bool,
    /// Referral links and codes.
    pub referrals: bool,
    /// Real-money trading through the user's own wallet. Off until the founder turns it on.
    pub real_trading: bool,
    /// Public address that receives the 1% platform fee (never a private key).
    pub fee_wallet: String,
    /// Settings page.
    pub settings: bool,
    /// Support center: Transaction Doctor, help center and tickets.
    pub support: bool,
    /// Live chat with the support team (shown online only while an agent is active).
    pub live_chat: bool,
    /// Kixo News: the live news feed and its side panel.
    pub news: bool,
    /// Kixo Sender: real trades also go straight to the next leaders over QUIC.
    pub kixo_sender: bool,
    /// Wallet Tracker: any wallet's balance, coins and swaps (page and side panel).
    pub wallet_tracker: bool,
    /// Kixo trading wallet: created and locked in the user's browser.
    pub kixo_wallet: bool,
    /// Deposits into Kixo wallets (real SOL): Phantom deposits and the deposit address.
    pub wallet_deposits: bool,
    /// Wallet labels: dev, smart money, whale, bundler and sniper tags on addresses.
    pub wallet_labels: bool,
    /// Quick Buy: the one-click buy on Discover and Sol Radar rows.
    pub quick_buy: bool,
    /// Grid trading: buy each dip to a level and sell one level up.
    pub grid_trading: bool,
    /// Copy trading: follow Smart Money wallets, demo first.
    pub copy_trading: bool,
    /// Competition page: on-chain top memecoin traders.
    pub onchain_top: bool,
    /// Trade page: share a coin card.
    pub coin_share: bool,
    /// Alerts when a demo position reaches 2x, 5x, 10x.
    pub milestone_alerts: bool,
    /// Portfolio: achievements and streaks.
    pub achievements: bool,
    /// Portfolio: weekly recap card.
    pub weekly_recap: bool,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            maintenance: false,
            maintenance_message: "Kixo is being upgraded. Back shortly".into(),
            announcement_on: false,
            announcement: String::new(),
            discover: true,
            radar: true,
            trade_page: true,
            sniper: true,
            smart_money: true,
            wallet_monitor: true,
            price_alerts: true,
            ai_analysis: true,
            rewards: true,
            safety_score: true,
            accounts: true,
            portfolio: true,
            demo: true,
            share_cards: true,
            demo_orders: true,
            competition: true,
            referrals: true,
            real_trading: false,
            fee_wallet: String::new(),
            settings: true,
            support: true,
            live_chat: true,
            news: true,
            kixo_sender: true,
            wallet_tracker: true,
            kixo_wallet: true,
            wallet_deposits: true,
            wallet_labels: true,
            quick_buy: true,
            grid_trading: true,
            copy_trading: true,
            onchain_top: true,
            coin_share: true,
            milestone_alerts: true,
            achievements: true,
            weekly_recap: true,
        }
    }
}

impl FeatureFlags {
    fn validate(&self) -> Result<(), String> {
        if self.announcement.len() > 200 || self.maintenance_message.len() > 200 {
            return Err("messages: up to 200 characters".into());
        }
        let w = self.fee_wallet.trim();
        if !w.is_empty() && crate::solana_tx::pubkey(w).is_err() {
            return Err("fee wallet: not a Solana address".into());
        }
        if self.real_trading && w.is_empty() && std::env::var("FEE_WALLET").map_or(true, |v| v.trim().is_empty()) {
            return Err("set a fee wallet before turning real trading on".into());
        }
        Ok(())
    }
}

const FEATURES_FILE: &str = "data/features.json";

/// Social platforms a creator can list.
pub const PLATFORMS: [&str; 7] = ["x", "telegram", "youtube", "tiktok", "discord", "twitch", "instagram"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Social {
    pub platform: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApplicationIn {
    pub name: String,
    pub socials: Vec<Social>,
    pub audience: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub contact: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Application {
    pub id: String,
    pub ts: i64,
    pub name: String,
    pub socials: Vec<Social>,
    pub audience: String,
    pub note: String,
    pub contact: String,
    /// "pending", "approved" or "rejected".
    pub status: String,
}

fn https_url(u: &str) -> bool {
    u.len() <= 200 && u.starts_with("https://") && !u.contains(char::is_whitespace) && u[8..].contains('.')
}

impl ApplicationIn {
    fn validate(&self) -> Result<(), String> {
        let name = self.name.trim();
        if name.is_empty() || name.len() > 60 {
            return Err("name: 1 to 60 characters".into());
        }
        if self.socials.is_empty() || self.socials.len() > 7 {
            return Err("add 1 to 7 social links".into());
        }
        for s in &self.socials {
            if !PLATFORMS.contains(&s.platform.as_str()) {
                return Err(format!("unknown platform {}", s.platform));
            }
            if !https_url(&s.url) {
                return Err(format!("{} link must start with https://", s.platform));
            }
        }
        if self.audience.len() > 40 || self.note.len() > 600 || self.contact.len() > 100 {
            return Err("text too long".into());
        }
        Ok(())
    }
}

pub struct AdminState {
    rewards: Mutex<RewardsConfig>,
    features: Mutex<FeatureFlags>,
    applications: Mutex<Vec<Application>>,
    /// Applications per IP in the last hour (spam guard).
    recent: Mutex<HashMap<std::net::IpAddr, Vec<Instant>>>,
}

const APPLY_PER_HOUR: usize = 3;
const MAX_APPLICATIONS: usize = 5_000;

impl AdminState {
    /// Whether real-money trading is switched on in the admin.
    pub fn real_trading(&self) -> bool {
        self.features.lock().expect("features lock").real_trading
    }

    /// Whether the news feed is switched on in the admin.
    pub fn news(&self) -> bool {
        self.features.lock().expect("features lock").news
    }

    /// Whether Kixo Sender (direct QUIC sends to the leaders) is switched on.
    pub fn kixo_sender(&self) -> bool {
        self.features.lock().expect("features lock").kixo_sender
    }

    /// Whether Kixo trading wallets are switched on.
    pub fn kixo_wallet(&self) -> bool {
        self.features.lock().expect("features lock").kixo_wallet
    }

    /// Whether deposits into Kixo wallets are open.
    pub fn wallet_deposits(&self) -> bool {
        let f = self.features.lock().expect("features lock");
        f.kixo_wallet && f.wallet_deposits
    }

    /// Whether live chat is switched on in the admin.
    pub fn live_chat(&self) -> bool {
        let f = self.features.lock().expect("features lock");
        f.support && f.live_chat
    }

    /// The fee wallet set in the admin, if any.
    pub fn fee_wallet(&self) -> Option<String> {
        Some(self.features.lock().expect("features lock").fee_wallet.trim().to_string()).filter(|w| !w.is_empty())
    }

    pub fn load() -> Arc<Self> {
        let rewards = std::fs::read(REWARDS_FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let applications = std::fs::read(APPLICATIONS_FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let features = std::fs::read(FEATURES_FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Arc::new(Self { rewards: Mutex::new(rewards), features: Mutex::new(features), applications: Mutex::new(applications), recent: Mutex::new(HashMap::new()) })
    }
}

fn save(path: &str, value: &impl Serialize) {
    let Ok(json) = serde_json::to_vec_pretty(value) else { return };
    let tmp = format!("{path}.tmp");
    if let Err(err) = std::fs::create_dir_all("data").and_then(|_| std::fs::write(&tmp, json)).and_then(|_| std::fs::rename(&tmp, path)) {
        tracing::warn!(%err, path, "could not save admin data");
    }
}

/// Constant-time comparison against ADMIN_TOKEN; no token configured means no admin.
pub(crate) fn is_admin(headers: &HeaderMap) -> bool {
    let Ok(expected) = std::env::var("ADMIN_TOKEN") else { return false };
    if expected.len() < 16 {
        return false;
    }
    let given = headers.get("x-admin-token").and_then(|v| v.to_str().ok()).unwrap_or("");
    given.len() == expected.len() && given.bytes().zip(expected.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

pub async fn get_features(State(a): State<Arc<AdminState>>) -> Json<FeatureFlags> {
    Json(a.features.lock().expect("features lock").clone())
}

pub async fn put_features(State(a): State<Arc<AdminState>>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(f): Json<FeatureFlags>) -> Result<Json<FeatureFlags>, (StatusCode, String)> {
    if !is_admin(&headers) {
        return Err((StatusCode::FORBIDDEN, "admin token required".into()));
    }
    f.validate().map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let before = a.features.lock().expect("features lock").clone();
    // Where the money goes and whether real money moves: only with the owner's code.
    let money = before.fee_wallet.trim() != f.fee_wallet.trim() || before.real_trading != f.real_trading || before.wallet_deposits != f.wallet_deposits;
    if money && !crate::platform::owner_ok(&headers) {
        return Err((StatusCode::UNAUTHORIZED, "owner_code_required".into()));
    }
    *a.features.lock().expect("features lock") = f.clone();
    save(FEATURES_FILE, &f);
    let d = crate::platform::diff(&serde_json::to_value(&before).unwrap_or_default(), &serde_json::to_value(&f).unwrap_or_default());
    crate::platform::audit(Some(addr), "features", d);
    tracing::info!("feature flags updated by admin");
    Ok(Json(f))
}

pub async fn get_rewards(State(a): State<Arc<AdminState>>) -> Json<RewardsConfig> {
    Json(a.rewards.lock().expect("rewards lock").clone())
}

pub async fn put_rewards(State(a): State<Arc<AdminState>>, headers: HeaderMap, Json(cfg): Json<RewardsConfig>) -> Result<Json<RewardsConfig>, (StatusCode, String)> {
    if !is_admin(&headers) {
        return Err((StatusCode::FORBIDDEN, "admin token required".into()));
    }
    cfg.validate().map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let before = a.rewards.lock().expect("rewards lock").clone();
    *a.rewards.lock().expect("rewards lock") = cfg.clone();
    save(REWARDS_FILE, &cfg);
    crate::platform::audit(None, "rewards", crate::platform::diff(&serde_json::to_value(&before).unwrap_or_default(), &serde_json::to_value(&cfg).unwrap_or_default()));
    tracing::info!("rewards settings updated by admin");
    Ok(Json(cfg))
}

pub async fn apply_creator(
    State(a): State<Arc<AdminState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(input): Json<ApplicationIn>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !a.rewards.lock().expect("rewards lock").creator_open {
        return Err((StatusCode::FORBIDDEN, "creator applications are closed".into()));
    }
    input.validate().map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    {
        let mut recent = a.recent.lock().expect("recent lock");
        let list = recent.entry(addr.ip()).or_default();
        list.retain(|t| t.elapsed() < Duration::from_secs(3600));
        if list.len() >= APPLY_PER_HOUR {
            return Err((StatusCode::TOO_MANY_REQUESTS, "too many applications, try again later".into()));
        }
        list.push(Instant::now());
    }
    let app = Application {
        id: format!("{:x}{:04x}", now(), rand_u16()),
        ts: now(),
        name: input.name.trim().to_string(),
        socials: input.socials,
        audience: input.audience.trim().to_string(),
        note: input.note.trim().to_string(),
        contact: input.contact.trim().to_string(),
        status: "pending".into(),
    };
    let mut list = a.applications.lock().expect("applications lock");
    if list.len() >= MAX_APPLICATIONS {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "applications are full, try later".into()));
    }
    list.insert(0, app.clone());
    save(APPLICATIONS_FILE, &*list);
    tracing::info!(id = app.id, "creator application received");
    Ok(Json(serde_json::json!({ "ok": true, "id": app.id })))
}

/// A little randomness for ids, from the clock's nanoseconds.
fn rand_u16() -> u16 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.subsec_nanos() as u16)
}

pub async fn list_applications(State(a): State<Arc<AdminState>>, headers: HeaderMap) -> Result<Json<Vec<Application>>, StatusCode> {
    if !is_admin(&headers) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Json(a.applications.lock().expect("applications lock").clone()))
}

#[derive(Deserialize)]
pub struct StatusIn {
    status: String,
}

pub async fn set_application(State(a): State<Arc<AdminState>>, headers: HeaderMap, Path(id): Path<String>, Json(s): Json<StatusIn>) -> Result<Json<Application>, StatusCode> {
    if !is_admin(&headers) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !matches!(s.status.as_str(), "pending" | "approved" | "rejected") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut list = a.applications.lock().expect("applications lock");
    let app = list.iter_mut().find(|x| x.id == id).ok_or(StatusCode::NOT_FOUND)?;
    app.status = s.status;
    let out = app.clone();
    save(APPLICATIONS_FILE, &*list);
    Ok(Json(out))
}

/// Lets the admin page check a token before showing anything.
pub async fn check_admin(headers: HeaderMap) -> StatusCode {
    if is_admin(&headers) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::FORBIDDEN
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid_and_bad_values_are_refused() {
        assert!(RewardsConfig::default().validate().is_ok());
        let mut c = RewardsConfig::default();
        c.trading_fee_pct = 150.0;
        assert!(c.validate().is_err());
        let mut c = RewardsConfig::default();
        c.cashback_tiers[2].min_usd = 1.0; // falls below the tier before it
        assert!(c.validate().is_err());
    }

    #[test]
    fn applications_need_real_links() {
        let ok = ApplicationIn { name: "Ali".into(), socials: vec![Social { platform: "x".into(), url: "https://x.com/ali".into() }], audience: "12K".into(), note: String::new(), contact: String::new() };
        assert!(ok.validate().is_ok());
        let bad = ApplicationIn { socials: vec![Social { platform: "x".into(), url: "javascript:alert(1)".into() }], ..ok.clone() };
        assert!(bad.validate().is_err());
        let unknown = ApplicationIn { socials: vec![Social { platform: "myspace".into(), url: "https://myspace.com/a".into() }], ..ok };
        assert!(unknown.validate().is_err());
    }
}

#[cfg(test)]
mod flag_tests {
    use super::*;

    #[test]
    fn fee_wallet_and_real_trading_rules() {
        let mut f = FeatureFlags::default();
        assert!(!f.real_trading, "real trading is off by default");
        assert!(f.validate().is_ok());
        f.fee_wallet = "not-an-address".into();
        assert!(f.validate().is_err());
        f.fee_wallet = "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ".into();
        assert!(f.validate().is_ok());
        f.real_trading = true;
        assert!(f.validate().is_ok(), "on with a fee wallet");
        if std::env::var("FEE_WALLET").is_err() {
            f.fee_wallet.clear();
            assert!(f.validate().is_err(), "on without any fee wallet is refused");
        }
    }
}
