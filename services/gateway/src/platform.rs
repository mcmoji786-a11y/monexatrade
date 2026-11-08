//! Platform settings the founder changes from the admin instead of the code: fees,
//! limits, the trading allowlist, Sender tips, Sol Radar's Lower risk rules and the API
//! keys. Also the owner check for money and key changes, and the audit log.
//!
//! - Settings live in `data/platform.json`, keys in `data/secrets.json` (both gitignored,
//!   on the server only, like `.env`). A key set here wins over `.env`.
//! - Admin calls need the admin token. Money and key changes also need an owner session:
//!   a 6-digit code emailed to OWNER_EMAIL (from `.env`, so a stolen admin token alone
//!   cannot change where the money goes). The session lasts 15 minutes.
//! - Every change is appended to `data/audit.jsonl` with before and after (keys redacted).

use crate::account::AccountState;
use axum::{
    extract::{ConnectInfo, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, Write},
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const PLATFORM_FILE: &str = "data/platform.json";
const SECRETS_FILE: &str = "data/secrets.json";
const AUDIT_FILE: &str = "data/audit.jsonl";
const OWNER_SESSION: Duration = Duration::from_secs(15 * 60);

/// API keys the admin may set, with what each one is for.
pub const SECRET_NAMES: [(&str, &str); 6] = [
    ("HELIUS_API_KEY", "Helius: main Solana data and the fast Sender path"),
    ("JUPITER_API_KEY", "Jupiter: swap routes for coins outside the launchpads"),
    ("X_BEARER_TOKEN", "X (Twitter): posts in the news feed"),
    ("REDDIT_CLIENT_ID", "Reddit: posts in the news feed (with the secret below)"),
    ("REDDIT_CLIENT_SECRET", "Reddit: client secret"),
    ("TELEGRAM_BOT_TOKEN", "Telegram bot: alerts to users"),
];

/// Every number the admin can change. Ranges are checked on save.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct PlatformConfig {
    /// Kixo's fee on each buy and sell, in basis points (50 = 0.5%).
    pub trade_fee_bps: u64,
    /// Kixo's fee on deposits, in basis points (0 = free).
    pub deposit_fee_bps: u64,
    /// Kixo's fee on withdrawals, in basis points (50 = 0.5%).
    pub withdraw_fee_bps: u64,
    /// Largest trade, in SOL.
    pub max_trade_sol: f64,
    pub min_deposit_sol: f64,
    pub max_deposit_sol: f64,
    /// When not empty, only these wallets may trade with real money.
    pub trading_allowlist: Vec<String>,
    /// Tips for the fast sending paths, in lamports.
    pub fast_tip_lamports: u64,
    pub turbo_tip_lamports: u64,
    /// Sol Radar's Lower risk tab: minimum safety score, and how long a coin stays listed.
    pub lower_risk_min_safety: u32,
    pub lower_risk_hold_secs: u32,
}

impl Default for PlatformConfig {
    fn default() -> Self {
        Self {
            trade_fee_bps: 50,
            deposit_fee_bps: 0,
            withdraw_fee_bps: 50,
            max_trade_sol: 3.0,
            min_deposit_sol: 0.001,
            max_deposit_sol: 100.0,
            trading_allowlist: Vec::new(),
            fast_tip_lamports: 5_000,
            turbo_tip_lamports: 1_000_000,
            lower_risk_min_safety: 80,
            lower_risk_hold_secs: 180,
        }
    }
}

impl PlatformConfig {
    pub fn validate(&self) -> Result<(), String> {
        let range = |ok: bool, what: &str| if ok { Ok(()) } else { Err(what.to_string()) };
        range(self.trade_fee_bps <= 300, "trade fee: 0% to 3%")?;
        range(self.deposit_fee_bps <= 300, "deposit fee: 0% to 3%")?;
        range(self.withdraw_fee_bps <= 300, "withdrawal fee: 0% to 3%")?;
        range((0.01..=100.0).contains(&self.max_trade_sol), "largest trade: 0.01 to 100 SOL")?;
        range((0.001..=10.0).contains(&self.min_deposit_sol), "smallest deposit: 0.001 to 10 SOL")?;
        range(self.max_deposit_sol >= self.min_deposit_sol && self.max_deposit_sol <= 10_000.0, "largest deposit: above the smallest, up to 10,000 SOL")?;
        range(self.trading_allowlist.len() <= 500, "allowlist: up to 500 wallets")?;
        for w in &self.trading_allowlist {
            if crate::solana_tx::pubkey(w.trim()).is_err() {
                return Err(format!("allowlist: {w} is not a Solana address"));
            }
        }
        range((1_000..=10_000_000).contains(&self.fast_tip_lamports), "Fast tip: 0.000001 to 0.01 SOL")?;
        range((1_000..=10_000_000).contains(&self.turbo_tip_lamports), "Turbo tip: 0.000001 to 0.01 SOL")?;
        range((50..=100).contains(&self.lower_risk_min_safety), "Lower risk score: 50 to 100")?;
        range(self.lower_risk_hold_secs <= 1_800, "Lower risk hold: up to 30 minutes")?;
        Ok(())
    }

    /// The values any visitor may see (no allowlist).
    fn public(&self) -> Value {
        json!({
            "trade_fee_bps": self.trade_fee_bps,
            "deposit_fee_bps": self.deposit_fee_bps,
            "withdraw_fee_bps": self.withdraw_fee_bps,
            "max_trade_sol": self.max_trade_sol,
            "min_deposit_sol": self.min_deposit_sol,
            "max_deposit_sol": self.max_deposit_sol,
            "lower_risk_min_safety": self.lower_risk_min_safety,
            "lower_risk_hold_secs": self.lower_risk_hold_secs,
        })
    }
}

/* ---------------- The live settings, readable from anywhere ---------------- */

static CONFIG: OnceLock<RwLock<PlatformConfig>> = OnceLock::new();

fn cell() -> &'static RwLock<PlatformConfig> {
    CONFIG.get_or_init(Default::default)
}

pub fn get() -> PlatformConfig {
    cell().read().expect("platform lock").clone()
}
pub fn trade_fee_bps() -> u64 {
    cell().read().expect("platform lock").trade_fee_bps
}
pub fn deposit_fee_bps() -> u64 {
    cell().read().expect("platform lock").deposit_fee_bps
}
pub fn withdraw_fee_bps() -> u64 {
    cell().read().expect("platform lock").withdraw_fee_bps
}
pub fn max_trade_lamports() -> u64 {
    (cell().read().expect("platform lock").max_trade_sol * 1e9) as u64
}
pub fn deposit_range_lamports() -> (u64, u64) {
    let c = cell().read().expect("platform lock");
    ((c.min_deposit_sol * 1e9) as u64, (c.max_deposit_sol * 1e9) as u64)
}
pub fn allowlist() -> Vec<String> {
    cell().read().expect("platform lock").trading_allowlist.clone()
}
pub fn tips() -> (u64, u64) {
    let c = cell().read().expect("platform lock");
    (c.fast_tip_lamports, c.turbo_tip_lamports)
}

/// Loads the saved settings and keys at start.
pub fn load() {
    if let Some(cfg) = std::fs::read(PLATFORM_FILE).ok().and_then(|b| serde_json::from_slice::<PlatformConfig>(&b).ok()) {
        if cfg.validate().is_ok() {
            *cell().write().expect("platform lock") = cfg;
        } else {
            tracing::warn!("data/platform.json is out of range; using defaults");
        }
    }
    let keys: HashMap<String, String> = std::fs::read(SECRETS_FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    for (k, v) in keys {
        if SECRET_NAMES.iter().any(|(n, _)| *n == k) {
            monexa_common::set_secret(&k, &v);
        }
    }
}

fn save(path: &str, value: &impl Serialize) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let tmp = format!("{path}.tmp");
    std::fs::create_dir_all("data").and_then(|_| std::fs::write(&tmp, json)).and_then(|_| std::fs::rename(&tmp, path)).map_err(|e| e.to_string())
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/* ---------------- Audit log ---------------- */

static AUDIT: Mutex<()> = Mutex::new(());

/// Appends one change to the audit log. Never pass key values here.
pub fn audit(ip: Option<SocketAddr>, action: &str, detail: Value) {
    let _g = AUDIT.lock().expect("audit lock");
    let line = json!({ "ts": now(), "ip": ip.map(|a| a.ip().to_string()), "action": action, "detail": detail });
    let res = std::fs::create_dir_all("data").and_then(|_| std::fs::OpenOptions::new().create(true).append(true).open(AUDIT_FILE)).and_then(|mut f| f.write_all(format!("{line}\n").as_bytes()));
    if let Err(e) = res {
        tracing::error!(%e, "audit log could not be written");
    }
}

/// The fields that differ between two JSON objects: {field: [before, after]}.
pub fn diff(before: &Value, after: &Value) -> Value {
    let mut out = serde_json::Map::new();
    if let (Some(a), Some(b)) = (before.as_object(), after.as_object()) {
        for (k, v) in b {
            if a.get(k) != Some(v) {
                out.insert(k.clone(), json!([a.get(k).cloned().unwrap_or(Value::Null), v]));
            }
        }
    }
    Value::Object(out)
}

/* ---------------- Owner sessions (emailed code) ---------------- */

static OWNER: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static OWNER_TRIES: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
static OWNER_CODES: Mutex<Vec<Instant>> = Mutex::new(Vec::new());

fn owner_sessions() -> &'static Mutex<HashMap<String, Instant>> {
    OWNER.get_or_init(Default::default)
}

/// The owner's email, from `.env` only.
pub fn owner_email() -> Option<String> {
    std::env::var("OWNER_EMAIL").ok().map(|e| e.trim().to_string()).filter(|e| e.contains('@'))
}

/// Whether the request carries a live owner session (from a verified email code).
pub fn owner_ok(headers: &HeaderMap) -> bool {
    let Some(t) = headers.get("x-owner-session").and_then(|v| v.to_str().ok()) else { return false };
    let mut m = owner_sessions().lock().expect("owner lock");
    m.retain(|_, at| at.elapsed() < OWNER_SESSION);
    m.contains_key(t)
}

fn limited(list: &Mutex<Vec<Instant>>, max: usize, window: Duration) -> bool {
    let mut l = list.lock().expect("limit lock");
    l.retain(|t| t.elapsed() < window);
    if l.len() >= max {
        return true;
    }
    l.push(Instant::now());
    false
}

fn random_hex() -> String {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut b = [0u8; 24];
    SystemRandom::new().fill(&mut b).expect("os random");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/* ---------------- Handlers ---------------- */

#[derive(Clone)]
pub struct PlatformCtx {
    pub acct: Arc<AccountState>,
    pub router: crate::rpc_router::RouterState,
    pub app: Arc<crate::AppState>,
}

type ApiErr = (StatusCode, Json<Value>);

fn err(status: StatusCode, message: &str) -> ApiErr {
    (status, Json(json!({ "message": message })))
}

fn need_admin(headers: &HeaderMap) -> Result<(), ApiErr> {
    if crate::admin::is_admin(headers) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Wrong admin key"))
    }
}

fn need_owner(headers: &HeaderMap) -> Result<(), ApiErr> {
    need_admin(headers)?;
    if owner_ok(headers) {
        Ok(())
    } else {
        Err(err(StatusCode::UNAUTHORIZED, "owner_code_required"))
    }
}

/// `GET /platform`: the public settings (fees, limits, Lower risk rules).
pub async fn public() -> Json<Value> {
    Json(get().public())
}

/// "abcd1234efgh" -> "…efgh".
fn hint(v: &str) -> String {
    let tail: String = v.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

/// `GET /admin/platform`: settings, which keys are set (never their values) and the owner.
pub async fn admin_get(headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let keys: Vec<Value> = SECRET_NAMES
        .iter()
        .map(|(name, label)| json!({ "name": name, "label": label, "source": monexa_common::secret_source(name), "hint": monexa_common::secret(name).map(|v| hint(&v)) }))
        .collect();
    Ok(Json(json!({
        "config": get(),
        "keys": keys,
        "owner_email": owner_email().map(|e| crate::wallet::mask(&e)),
        "owner_session": owner_ok(&headers),
    })))
}

/// `POST /admin/owner/code`: emails the owner a 6-digit code.
pub async fn owner_code(State(c): State<PlatformCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let email = owner_email().ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "Set OWNER_EMAIL in the gateway .env (the founder's Kixo account email) once, then restart"))?;
    if limited(&OWNER_CODES, 3, Duration::from_secs(600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many codes sent, wait 10 minutes"));
    }
    c.acct.send_email_code(&email).await.map_err(|e| err(e.0, &e.1))?;
    Ok(Json(json!({ "sent_to": crate::wallet::mask(&email) })))
}

#[derive(Deserialize)]
pub struct CodeIn {
    code: String,
}

/// `POST /admin/owner/verify`: checks the code and opens a 15-minute owner session.
pub async fn owner_verify(State(c): State<PlatformCtx>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(b): Json<CodeIn>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let email = owner_email().ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "OWNER_EMAIL is not set"))?;
    if limited(&OWNER_TRIES, 8, Duration::from_secs(900)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many tries, wait 15 minutes"));
    }
    if !c.acct.check_email_code(&email, b.code.trim()).await {
        audit(Some(addr), "owner_code_failed", json!({}));
        return Err(err(StatusCode::UNAUTHORIZED, "That code is wrong or expired"));
    }
    let token = random_hex();
    owner_sessions().lock().expect("owner lock").insert(token.clone(), Instant::now());
    audit(Some(addr), "owner_session_opened", json!({}));
    Ok(Json(json!({ "session": token, "expires_in": OWNER_SESSION.as_secs() })))
}

/// `PUT /admin/platform`: saves new settings (owner session needed).
pub async fn admin_put(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(mut cfg): Json<PlatformConfig>) -> Result<Json<Value>, ApiErr> {
    need_owner(&headers)?;
    cfg.trading_allowlist = cfg.trading_allowlist.iter().map(|w| w.trim().to_string()).filter(|w| !w.is_empty()).collect();
    cfg.validate().map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
    let before = serde_json::to_value(get()).unwrap_or(Value::Null);
    save(PLATFORM_FILE, &cfg).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    *cell().write().expect("platform lock") = cfg.clone();
    let after = serde_json::to_value(&cfg).unwrap_or(Value::Null);
    audit(Some(addr), "platform_settings", diff(&before, &after));
    tracing::info!("platform settings updated by the owner");
    Ok(Json(json!({ "config": cfg })))
}

#[derive(Deserialize)]
pub struct SecretIn {
    name: String,
    /// Empty clears the admin key (the `.env` one, if any, applies again).
    value: String,
}

/// `PUT /admin/secrets`: sets or clears one API key (owner session needed).
pub async fn secret_put(State(c): State<PlatformCtx>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(b): Json<SecretIn>) -> Result<Json<Value>, ApiErr> {
    need_owner(&headers)?;
    if !SECRET_NAMES.iter().any(|(n, _)| *n == b.name) {
        return Err(err(StatusCode::BAD_REQUEST, "unknown key"));
    }
    let value = b.value.trim();
    if value.len() > 512 || value.chars().any(char::is_whitespace) {
        return Err(err(StatusCode::BAD_REQUEST, "a key is one line with no spaces, up to 512 characters"));
    }
    let mut keys: HashMap<String, String> = std::fs::read(SECRETS_FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if value.is_empty() {
        keys.remove(&b.name);
    } else {
        keys.insert(b.name.clone(), value.to_string());
    }
    save(SECRETS_FILE, &keys).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    monexa_common::set_secret(&b.name, value);
    if b.name == "HELIUS_API_KEY" {
        // The router goes back to Helius with the new key straight away.
        c.router.set_primary_url(c.app.config.helius_direct_rpc_url());
    }
    audit(Some(addr), "api_key", json!({ "name": b.name, "change": if value.is_empty() { "cleared".to_string() } else { format!("set {}", hint(value)) } }));
    Ok(Json(json!({ "name": b.name, "source": monexa_common::secret_source(&b.name), "hint": monexa_common::secret(&b.name).map(|v| hint(&v)) })))
}

#[derive(Deserialize)]
pub struct AuditQuery {
    limit: Option<usize>,
}

/// `GET /admin/audit`: the latest changes, newest first.
pub async fn audit_list(headers: HeaderMap, Query(q): Query<AuditQuery>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let limit = q.limit.unwrap_or(200).min(1_000);
    let Ok(f) = std::fs::File::open(AUDIT_FILE) else { return Ok(Json(json!([]))) };
    let lines: Vec<Value> = std::io::BufReader::new(f).lines().map_while(Result::ok).filter_map(|l| serde_json::from_str(&l).ok()).collect();
    Ok(Json(Value::Array(lines.into_iter().rev().take(limit).collect())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid_and_ranges_hold() {
        assert!(PlatformConfig::default().validate().is_ok());
        let bad = |f: fn(&mut PlatformConfig)| {
            let mut c = PlatformConfig::default();
            f(&mut c);
            c.validate().is_err()
        };
        assert!(bad(|c| c.trade_fee_bps = 400));
        assert!(bad(|c| c.withdraw_fee_bps = 1_000));
        assert!(bad(|c| c.deposit_fee_bps = 1_000));
        assert!(bad(|c| c.max_trade_sol = 0.0));
        assert!(bad(|c| c.max_deposit_sol = 0.0001));
        assert!(bad(|c| c.trading_allowlist = vec!["not-a-wallet".into()]));
        assert!(bad(|c| c.lower_risk_min_safety = 10));
        assert!(bad(|c| c.fast_tip_lamports = 0));
    }

    #[test]
    fn diff_lists_only_changes() {
        let d = diff(&json!({ "a": 1, "b": 2 }), &json!({ "a": 1, "b": 3 }));
        assert_eq!(d, json!({ "b": [2, 3] }));
    }

    #[test]
    fn key_hints_show_only_the_end() {
        assert_eq!(hint("abcdef123456"), "…3456");
    }
}
