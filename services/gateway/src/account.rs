//! Accounts: who is signed in, and which Solana wallet they proved they own.
//!
//! Sign-in itself is Supabase Auth (Google, email code, or Sign in with Solana). This
//! module only does what the browser must not: it checks the access token with
//! Supabase, verifies wallet signatures, and writes the `profiles` table with the
//! service-role key (which never leaves the gateway).
//!
//! Linking a wallet to a Google or email account:
//! 1. `POST /account/link-nonce {wallet}` returns a one-time message (5 minutes).
//! 2. The user signs it in Phantom.
//! 3. `POST /account/link-wallet {wallet, signature}` checks the ed25519 signature
//!    against that exact message, burns the nonce, and saves the wallet. A wallet can
//!    belong to one account only.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const NONCE_TTL: Duration = Duration::from_secs(300);
/// Link attempts per account per 10 minutes.
const LINK_ATTEMPTS: usize = 10;

pub struct AccountState {
    http: reqwest::Client,
    url: String,
    anon: String,
    service: String,
    /// user id -> pending link challenge.
    pending: Mutex<HashMap<String, Pending>>,
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
    /// Verified access tokens, cached briefly so every page load stays fast.
    users: Mutex<HashMap<String, (Instant, User)>>,
}

struct Pending {
    wallet: String,
    message: String,
    at: Instant,
}

#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub provider: String,
    /// The Solana address of a Sign-in-with-Solana login, already proven by Supabase.
    pub solana: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Profile {
    pub id: String,
    pub wallet: Option<String>,
    pub wallet_verified_at: Option<String>,
    pub login_method: Option<String>,
}

impl AccountState {
    pub fn new(http: reqwest::Client, url: &str, anon: &str, service: &str) -> Arc<Self> {
        Arc::new(Self {
            http,
            url: url.trim_end_matches('/').to_string(),
            anon: anon.to_string(),
            service: service.to_string(),
            pending: Mutex::new(HashMap::new()),
            attempts: Mutex::new(HashMap::new()),
            users: Mutex::new(HashMap::new()),
        })
    }

    /// The signed-in user behind `Authorization: Bearer <token>`, checked with Supabase.
    pub(crate) async fn user(&self, headers: &HeaderMap) -> Result<User, (StatusCode, String)> {
        let token = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| t.len() > 20 && t.len() < 4096)
            .ok_or((StatusCode::UNAUTHORIZED, "sign in first".into()))?;
        if let Some((at, u)) = self.users.lock().expect("users lock").get(token) {
            if at.elapsed() < Duration::from_secs(60) {
                return Ok(u.clone());
            }
        }
        let res = self
            .http
            .get(format!("{}/auth/v1/user", self.url))
            .header("apikey", &self.anon)
            .bearer_auth(token)
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|_| (StatusCode::BAD_GATEWAY, "auth service unreachable".into()))?;
        if !res.status().is_success() {
            return Err((StatusCode::UNAUTHORIZED, "session expired, sign in again".into()));
        }
        let v: Value = res.json().await.map_err(|_| (StatusCode::BAD_GATEWAY, "bad auth reply".into()))?;
        let user = parse_user(&v).ok_or((StatusCode::UNAUTHORIZED, "unknown user".into()))?;
        let mut cache = self.users.lock().expect("users lock");
        if cache.len() > 5_000 {
            cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        }
        cache.insert(token.to_string(), (Instant::now(), user.clone()));
        Ok(user)
    }

    /// Inserts a row and never overwrites one: on a conflict nothing changes and the
    /// result is an empty list.
    pub(crate) async fn insert_new(&self, table: &str, row: Value) -> Result<Value, (StatusCode, String)> {
        let res = self
            .http
            .post(format!("{}/rest/v1/{table}", self.url))
            .header("apikey", &self.service)
            .bearer_auth(&self.service)
            .header("Prefer", "return=representation,resolution=ignore-duplicates")
            .timeout(Duration::from_secs(8))
            .json(&row)
            .send()
            .await
            .map_err(|_| (StatusCode::BAD_GATEWAY, "database unreachable".into()))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            tracing::warn!(%status, table, "database insert failed");
            let msg = if text.contains("PGRST205") || text.contains("does not exist") || text.contains("Could not find the table") { "not set up yet: run the latest migration" } else { "database error" };
            return Err((StatusCode::SERVICE_UNAVAILABLE, msg.into()));
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    /// One page of accounts from Supabase Auth (admin only, service key).
    pub(crate) async fn list_auth_users(&self, page: u32, per_page: u32) -> Result<Vec<Value>, (StatusCode, String)> {
        let res = self
            .http
            .get(format!("{}/auth/v1/admin/users?page={page}&per_page={per_page}", self.url))
            .header("apikey", &self.service)
            .bearer_auth(&self.service)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|_| (StatusCode::BAD_GATEWAY, "auth service unreachable".into()))?;
        if !res.status().is_success() {
            return Err((StatusCode::BAD_GATEWAY, format!("auth service answered {}", res.status())));
        }
        let v: Value = res.json().await.map_err(|_| (StatusCode::BAD_GATEWAY, "bad auth reply".into()))?;
        Ok(v["users"].as_array().cloned().unwrap_or_default())
    }

    /// Emails a 6-digit code to an existing account's address (Supabase Auth).
    pub(crate) async fn send_email_code(&self, email: &str) -> Result<(), (StatusCode, String)> {
        let res = self
            .http
            .post(format!("{}/auth/v1/otp", self.url))
            .header("apikey", &self.anon)
            .json(&json!({ "email": email, "create_user": false }))
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|_| (StatusCode::BAD_GATEWAY, "email service unreachable".into()))?;
        match res.status().as_u16() {
            200..=299 => Ok(()),
            429 => Err((StatusCode::TOO_MANY_REQUESTS, "too many codes sent, wait a few minutes".into())),
            _ => Err((StatusCode::BAD_GATEWAY, "the code could not be sent".into())),
        }
    }

    /// Whether `code` is the valid code just emailed to `email`.
    pub(crate) async fn check_email_code(&self, email: &str, code: &str) -> bool {
        if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
        let res = self.http.post(format!("{}/auth/v1/verify", self.url)).header("apikey", &self.anon).json(&json!({ "type": "email", "email": email, "token": code })).timeout(Duration::from_secs(10)).send().await;
        res.is_ok_and(|r| r.status().is_success())
    }

    pub(crate) async fn rest(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, (StatusCode, String)> {
        let mut req = self
            .http
            .request(method, format!("{}/rest/v1/{path}", self.url))
            .header("apikey", &self.service)
            .bearer_auth(&self.service)
            .header("Prefer", "return=representation,resolution=merge-duplicates")
            .timeout(Duration::from_secs(8));
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.map_err(|_| (StatusCode::BAD_GATEWAY, "database unreachable".into()))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            tracing::warn!(%status, table = path.split('?').next().unwrap_or(""), "database request failed");
            // A migration that has not been run shows up as a missing table (PGRST205).
            let msg = if text.contains("PGRST205") || text.contains("does not exist") || text.contains("Could not find the table") { "not set up yet: run the latest migration" } else { "database error" };
            return Err((StatusCode::SERVICE_UNAVAILABLE, msg.into()));
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    async fn profile(&self, id: &str) -> Result<Option<Profile>, (StatusCode, String)> {
        let v = self.rest(reqwest::Method::GET, &format!("profiles?id=eq.{id}&select=id,wallet,wallet_verified_at,login_method"), None).await?;
        Ok(v.as_array().and_then(|a| a.first()).and_then(|p| serde_json::from_value(p.clone()).ok()))
    }

    async fn upsert(&self, p: Value) -> Result<Profile, (StatusCode, String)> {
        let v = self.rest(reqwest::Method::POST, "profiles?on_conflict=id", Some(p)).await?;
        v.as_array().and_then(|a| a.first()).and_then(|p| serde_json::from_value(p.clone()).ok()).ok_or((StatusCode::SERVICE_UNAVAILABLE, "could not save".into()))
    }

    /// Deletes the auth user (the account owner asked for it). Rows that reference it
    /// cascade or keep their history as their tables define.
    pub(crate) async fn delete_user(&self, id: &str) -> Result<(), (StatusCode, String)> {
        let res = self
            .http
            .delete(format!("{}/auth/v1/admin/users/{id}", self.url))
            .header("apikey", &self.service)
            .bearer_auth(&self.service)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|_| (StatusCode::BAD_GATEWAY, "account service unreachable".into()))?;
        if !res.status().is_success() {
            tracing::warn!(status = %res.status(), "delete user failed");
            return Err((StatusCode::BAD_GATEWAY, "could not delete the account, try again".into()));
        }
        self.users.lock().expect("users lock").retain(|_, (_, u)| u.id != id);
        Ok(())
    }

    /// Is this wallet already on another account?
    async fn wallet_owner(&self, wallet: &str) -> Result<Option<String>, (StatusCode, String)> {
        let v = self.rest(reqwest::Method::GET, &format!("profiles?wallet=eq.{wallet}&select=id"), None).await?;
        Ok(v.as_array().and_then(|a| a.first()).and_then(|p| p["id"].as_str().map(String::from)))
    }
}

fn parse_user(v: &Value) -> Option<User> {
    let id = v["id"].as_str().filter(|s| is_uuid(s))?.to_string();
    let provider = v["app_metadata"]["provider"].as_str().unwrap_or("email").to_string();
    // Sign in with Solana: Supabase has already verified the signature; the address is
    // in the web3 identity.
    let solana = v["identities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| i["provider"].as_str() == Some("web3"))
        .find_map(|i| {
            let d = &i["identity_data"];
            [d["address"].as_str(), d["custom_claims"]["address"].as_str(), d["sub"].as_str().and_then(|s| s.rsplit(':').next())]
                .into_iter()
                .flatten()
                .find(|a| is_solana_address(a))
                .map(String::from)
        });
    Some(User { id, email: v["email"].as_str().map(String::from), provider, solana })
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

pub fn is_solana_address(s: &str) -> bool {
    (32..=44).contains(&s.len()) && bs58::decode(s).into_vec().is_ok_and(|b| b.len() == 32)
}

fn method_of(u: &User) -> &'static str {
    if u.solana.is_some() {
        "phantom"
    } else if u.provider == "google" {
        "google"
    } else {
        "email"
    }
}

fn iso_now() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    format!("{secs}")
}

/// The exact text the wallet signs: names the account and the wallet, so a signature
/// cannot be reused for another account or another wallet.
pub fn link_message(user_id: &str, wallet: &str, nonce: &str) -> String {
    format!("Kixo wallet link\nThis proves you own this wallet. It does not move funds or cost anything.\nAccount: {user_id}\nWallet: {wallet}\nCode: {nonce}")
}

/// ed25519 check of a base58 signature over `message` by `wallet`.
pub fn verify_signature(wallet: &str, message: &str, signature_b58: &str) -> bool {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let Ok(key) = bs58::decode(wallet).into_vec() else { return false };
    let Ok(sig) = bs58::decode(signature_b58).into_vec() else { return false };
    let (Ok(key), Ok(sig)) = (<[u8; 32]>::try_from(key.as_slice()), <[u8; 64]>::try_from(sig.as_slice())) else { return false };
    let Ok(vk) = VerifyingKey::from_bytes(&key) else { return false };
    vk.verify(message.as_bytes(), &Signature::from_bytes(&sig)).is_ok()
}

fn nonce() -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos()).to_le_bytes());
    h.update(std::process::id().to_le_bytes());
    let mut buf = [0u8; 16];
    let _ = getrandom_fill(&mut buf);
    h.update(buf);
    bs58::encode(&h.finalize()[..16]).into_string()
}

/// Extra randomness from the OS when available.
fn getrandom_fill(buf: &mut [u8]) -> std::io::Result<()> {
    use std::io::Read;
    // Windows has no /dev/urandom; the hash of time and pid still makes nonces unique,
    // and each one is bound to one account, one wallet and five minutes.
    std::fs::File::open("/dev/urandom")?.read_exact(buf)
}

/* ---------------- Handlers ---------------- */

#[derive(Serialize)]
pub struct Me {
    pub id: String,
    pub email: Option<String>,
    pub login_method: String,
    pub wallet: Option<String>,
    pub wallet_verified: bool,
}

/// `POST /account/sync`: after any sign-in. Creates the profile, and for a Phantom
/// sign-in records the wallet Supabase verified. Returns the profile.
pub async fn sync(State(a): State<Arc<AccountState>>, headers: HeaderMap) -> Result<Json<Me>, (StatusCode, String)> {
    let u = a.user(&headers).await?;
    let existing = a.profile(&u.id).await?;
    let mut row = json!({ "id": u.id, "login_method": existing.as_ref().and_then(|p| p.login_method.clone()).unwrap_or_else(|| method_of(&u).to_string()) });
    if let (Some(addr), true) = (&u.solana, existing.as_ref().and_then(|p| p.wallet.as_ref()).is_none()) {
        if a.wallet_owner(addr).await?.is_some_and(|owner| owner != u.id) {
            return Err((StatusCode::CONFLICT, "this wallet is linked to another account".into()));
        }
        row["wallet"] = json!(addr);
        row["wallet_verified_at"] = json!("now()");
    }
    // Google and email accounts never keep a wallet (they connect one per visit); clear
    // any saved by the earlier link flow.
    let stale = u.solana.is_none() && existing.as_ref().is_some_and(|p| p.wallet.is_some());
    if stale {
        row["wallet"] = Value::Null;
        row["wallet_verified_at"] = Value::Null;
    }
    let p = if existing.is_none() || row.get("wallet").is_some() { a.upsert(fix_now(row)).await? } else { existing.unwrap_or_default() };
    // Every account gets its referral code (also its leaderboard name) from the start.
    let _ = crate::growth::own_code(&a, &u.id).await;
    Ok(Json(me(&u, &p)))
}

/// `GET /account/me`: the signed-in user's profile.
pub async fn me_handler(State(a): State<Arc<AccountState>>, headers: HeaderMap) -> Result<Json<Me>, (StatusCode, String)> {
    let u = a.user(&headers).await?;
    let p = a.profile(&u.id).await?.unwrap_or(Profile { id: u.id.clone(), ..Default::default() });
    Ok(Json(me(&u, &p)))
}

fn me(u: &User, p: &Profile) -> Me {
    Me {
        id: u.id.clone(),
        email: u.email.clone(),
        login_method: p.login_method.clone().unwrap_or_else(|| method_of(u).to_string()),
        wallet: p.wallet.clone(),
        wallet_verified: p.wallet.is_some() && p.wallet_verified_at.is_some(),
    }
}

/// PostgREST sets timestamps from SQL defaults; "now()" strings become real times there.
fn fix_now(mut row: Value) -> Value {
    if row["wallet_verified_at"] == json!("now()") {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
        row["wallet_verified_at"] = json!(chrono_iso(secs));
    }
    row
}

/// Unix seconds as RFC 3339 UTC, without a date library.
pub(crate) fn chrono_iso(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Days since 1970-01-01 to (year, month, day) (Howard Hinnant's algorithm).
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[derive(Deserialize)]
pub struct NonceIn {
    wallet: String,
}

/// `POST /account/link-nonce {wallet}`: the message to sign. Not routed: Google and email
/// accounts no longer save a wallet. Kept, with its tests, for a future verified link.
#[allow(dead_code)]
pub async fn link_nonce(State(a): State<Arc<AccountState>>, headers: HeaderMap, Json(input): Json<NonceIn>) -> Result<Json<Value>, (StatusCode, String)> {
    let u = a.user(&headers).await?;
    if !is_solana_address(&input.wallet) {
        return Err((StatusCode::BAD_REQUEST, "not a Solana wallet address".into()));
    }
    {
        let mut att = a.attempts.lock().expect("attempts lock");
        let list = att.entry(u.id.clone()).or_default();
        list.retain(|t| t.elapsed() < Duration::from_secs(600));
        if list.len() >= LINK_ATTEMPTS {
            return Err((StatusCode::TOO_MANY_REQUESTS, "too many tries, wait a few minutes".into()));
        }
        list.push(Instant::now());
    }
    let message = link_message(&u.id, &input.wallet, &nonce());
    a.pending.lock().expect("pending lock").insert(u.id, Pending { wallet: input.wallet, message: message.clone(), at: Instant::now() });
    Ok(Json(json!({ "message": message, "expires_in": NONCE_TTL.as_secs(), "issued": iso_now() })))
}

#[derive(Deserialize)]
pub struct LinkIn {
    wallet: String,
    signature: String,
}

/// `POST /account/link-wallet {wallet, signature}`: checks and saves the wallet. Not routed.
#[allow(dead_code)]
pub async fn link_wallet(State(a): State<Arc<AccountState>>, headers: HeaderMap, Json(input): Json<LinkIn>) -> Result<Json<Me>, (StatusCode, String)> {
    let u = a.user(&headers).await?;
    // The challenge is used once, whatever the outcome.
    let pending = a.pending.lock().expect("pending lock").remove(&u.id).ok_or((StatusCode::BAD_REQUEST, "start again: no link request".into()))?;
    if pending.at.elapsed() > NONCE_TTL {
        return Err((StatusCode::BAD_REQUEST, "the request expired, start again".into()));
    }
    if pending.wallet != input.wallet {
        return Err((StatusCode::BAD_REQUEST, "signed with a different wallet".into()));
    }
    if !verify_signature(&input.wallet, &pending.message, &input.signature) {
        return Err((StatusCode::UNAUTHORIZED, "signature check failed".into()));
    }
    if a.wallet_owner(&input.wallet).await?.is_some_and(|owner| owner != u.id) {
        return Err((StatusCode::CONFLICT, "this wallet is linked to another account".into()));
    }
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    let existing = a.profile(&u.id).await?;
    // A Phantom account is its wallet; it cannot be swapped for another one.
    if let Some(addr) = &u.solana {
        if addr != &input.wallet {
            return Err((StatusCode::CONFLICT, "this account signs in with its own wallet".into()));
        }
    }
    let method = existing.and_then(|p| p.login_method).unwrap_or_else(|| method_of(&u).to_string());
    let p = a.upsert(json!({ "id": u.id, "wallet": input.wallet, "wallet_verified_at": chrono_iso(secs), "login_method": method })).await?;
    tracing::info!(user = %u.id, "wallet linked");
    Ok(Json(me(&u, &p)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn key(seed: u8) -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[seed; 32]);
        let addr = bs58::encode(sk.verifying_key().to_bytes()).into_string();
        (sk, addr)
    }

    #[test]
    fn a_real_signature_passes_and_tampering_fails() {
        let (sk, wallet) = key(7);
        let msg = link_message("11111111-2222-3333-4444-555555555555", &wallet, "abc");
        let sig = bs58::encode(sk.sign(msg.as_bytes()).to_bytes()).into_string();
        assert!(verify_signature(&wallet, &msg, &sig));
        // Another account in the message, another wallet, or a forged signature: refused.
        let other_account = link_message("99999999-2222-3333-4444-555555555555", &wallet, "abc");
        assert!(!verify_signature(&wallet, &other_account, &sig));
        let (_, other_wallet) = key(8);
        assert!(!verify_signature(&other_wallet, &msg, &sig));
        assert!(!verify_signature(&wallet, &msg, "1111"));
        assert!(!verify_signature("not-base58!", &msg, &sig));
    }

    #[test]
    fn web3_identity_gives_the_solana_address() {
        let (_, wallet) = key(9);
        let v = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "app_metadata": { "provider": "web3" },
            "identities": [{ "provider": "web3", "identity_data": { "sub": format!("web3:solana:{wallet}") } }]
        });
        let u = parse_user(&v).expect("user");
        assert_eq!(u.solana.as_deref(), Some(wallet.as_str()));
        assert_eq!(method_of(&u), "phantom");
        let email = json!({ "id": "11111111-2222-3333-4444-555555555555", "email": "a@b.co", "app_metadata": { "provider": "email" } });
        let u = parse_user(&email).expect("user");
        assert!(u.solana.is_none());
        assert!(parse_user(&json!({ "id": "x' or 1=1" })).is_none());
    }

    #[test]
    fn dates_are_rfc3339() {
        assert_eq!(chrono_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(chrono_iso(1_793_923_200), "2026-11-06T00:00:00Z");
    }

    #[test]
    fn addresses_are_checked() {
        let (_, wallet) = key(3);
        assert!(is_solana_address(&wallet));
        assert!(!is_solana_address("abc"));
        assert!(!is_solana_address("eq.x&select=*"));
    }
}
