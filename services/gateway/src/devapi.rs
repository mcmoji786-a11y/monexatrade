//! The Kixo AI developer API (migration 0017).
//!
//! Signed-in users make API keys in Settings (Developer API). A key is `kixo_` plus 40
//! random hex characters; only its SHA-256 hash is stored, and the key itself is shown
//! once. Calls send it as `x-api-key` (or `Authorization: Bearer kixo_...`).
//!
//! Public API, read only:
//!   GET /v1/ai/risk?mints=a,b     Kixo AI's two chances per coin (up to 50 coins)
//!   GET /v1/ai/recent?minutes=10  coins scored lately, newest first
//!   GET /v1/kols/coins            coins KOLs bought in the last 24 hours
//!   GET /v1/usage                 this key's calls today and its limits
//!
//! Limits per key: 60 calls a minute and 10,000 a day (counted in memory, so a restart
//! starts them over). A user may have 5 live keys. The admin switch "dev_api" stops it.

use crate::account::AccountState;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

type ApiErr = (StatusCode, Json<Value>);
const PER_MINUTE: usize = 60;
const PER_DAY: u64 = 10_000;
const MAX_KEYS: usize = 5;
const KEY_CACHE: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct DevCtx {
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
}

fn err(status: StatusCode, message: &str) -> ApiErr {
    (status, Json(json!({ "error": message })))
}

pub fn hash(key: &str) -> String {
    Sha256::digest(key.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Default)]
struct Mem {
    /// key hash -> (key id, found at), or None when the key is unknown or revoked.
    keys: HashMap<String, (Option<i64>, Instant)>,
    minute: HashMap<i64, VecDeque<Instant>>,
    day: HashMap<i64, (i64, u64)>,
    touched: HashMap<i64, Instant>,
}

fn mem() -> &'static Mutex<Mem> {
    static M: OnceLock<Mutex<Mem>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(Mem::default()))
}

fn day_now() -> i64 {
    crate::now_unix() / 86_400
}

/// The key id behind a request's API key, within its limits, or the reason it is refused.
async fn authorize(c: &DevCtx, headers: &HeaderMap) -> Result<i64, ApiErr> {
    if !c.admin.dev_api() {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "The Kixo API is switched off right now"));
    }
    let key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .or_else(|| headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")))
        .map(str::trim)
        .filter(|k| k.starts_with("kixo_") && k.len() == 45)
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Send your API key in the x-api-key header"))?;
    let h = hash(key);
    let cached = { mem().lock().expect("devapi lock").keys.get(&h).filter(|(_, at)| at.elapsed() < KEY_CACHE).map(|(id, _)| *id) };
    let id = match cached {
        Some(id) => id,
        None => {
            let v = c.acct.rest(reqwest::Method::GET, &format!("api_keys?key_hash=eq.{h}&revoked=eq.false&select=id"), None).await.map_err(|_| err(StatusCode::SERVICE_UNAVAILABLE, "Try again in a moment"))?;
            let id = v.as_array().and_then(|r| r.first()).and_then(|r| r["id"].as_i64());
            let mut m = mem().lock().expect("devapi lock");
            if m.keys.len() > 10_000 {
                m.keys.clear();
            }
            m.keys.insert(h, (id, Instant::now()));
            id
        }
    };
    let id = id.ok_or_else(|| err(StatusCode::UNAUTHORIZED, "This API key is not valid or was revoked"))?;
    let touch = {
        let mut m = mem().lock().expect("devapi lock");
        let q = m.minute.entry(id).or_default();
        while q.front().is_some_and(|t| t.elapsed() > Duration::from_secs(60)) {
            q.pop_front();
        }
        if q.len() >= PER_MINUTE {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "60 calls a minute per key; slow down"));
        }
        q.push_back(Instant::now());
        let today = day_now();
        let d = m.day.entry(id).or_insert((today, 0));
        if d.0 != today {
            *d = (today, 0);
        }
        if d.1 >= PER_DAY {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "10,000 calls a day per key; it resets at 00:00 UTC"));
        }
        d.1 += 1;
        // Last-used time goes to the database at most once a minute per key.
        let due = m.touched.get(&id).is_none_or(|t| t.elapsed() > Duration::from_secs(60));
        if due {
            m.touched.insert(id, Instant::now());
        }
        due
    };
    if touch {
        let acct = c.acct.clone();
        tokio::spawn(async move {
            let _ = acct.rest(reqwest::Method::PATCH, &format!("api_keys?id=eq.{id}"), Some(json!({ "last_used_at": crate::account::chrono_iso(crate::now_unix()) }))).await;
        });
    }
    Ok(id)
}

fn risk_view(r: &crate::ai_risk::Risk) -> Value {
    let verdict = if r.dump >= 0.4 { "danger" } else if r.dump >= 0.2 { "careful" } else if r.pump >= 0.15 { "good_odds" } else { "calm" };
    json!({ "dump_chance": (r.dump * 1000.0).round() / 1000.0, "double_chance": (r.pump * 1000.0).round() / 1000.0, "verdict": verdict, "trades_seen": r.trades, "scored_at": r.at })
}

#[derive(Deserialize)]
pub struct MintsQuery {
    mints: Option<String>,
}

/// `GET /v1/ai/risk?mints=a,b`
pub async fn v1_risk(State(c): State<DevCtx>, headers: HeaderMap, Query(q): Query<MintsQuery>) -> Result<Json<Value>, ApiErr> {
    authorize(&c, &headers).await?;
    let mints: Vec<&str> = q.mints.as_deref().unwrap_or("").split(',').map(str::trim).filter(|m| crate::is_mint(m)).take(50).collect();
    if mints.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Pass ?mints= with up to 50 coin addresses, comma separated"));
    }
    let mut out = serde_json::Map::new();
    for m in mints {
        out.insert(m.to_string(), crate::ai_risk::score_of(m).map(|r| risk_view(&r)).unwrap_or(Value::Null));
    }
    Ok(Json(json!({ "risk": out, "note": "null: not scored (the model scores new launches 2 minutes after their first trade)" })))
}

#[derive(Deserialize)]
pub struct RecentQuery {
    minutes: Option<i64>,
}

/// `GET /v1/ai/recent?minutes=10`
pub async fn v1_recent(State(c): State<DevCtx>, headers: HeaderMap, Query(q): Query<RecentQuery>) -> Result<Json<Value>, ApiErr> {
    authorize(&c, &headers).await?;
    let mins = q.minutes.unwrap_or(10).clamp(1, 60);
    let coins: Vec<Value> = crate::ai_risk::recent(mins * 60).into_iter().take(500).map(|(m, r)| {
        let mut v = risk_view(&r);
        v["mint"] = json!(m);
        v
    }).collect();
    Ok(Json(json!({ "minutes": mins, "coins": coins })))
}

/// `GET /v1/kols/coins`
pub async fn v1_kols(State(c): State<DevCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    authorize(&c, &headers).await?;
    Ok(Json(json!({ "coins": crate::kols::coins_now() })))
}

/// `GET /v1/usage`
pub async fn v1_usage(State(c): State<DevCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let id = authorize(&c, &headers).await?;
    let m = mem().lock().expect("devapi lock");
    let today = m.day.get(&id).filter(|d| d.0 == day_now()).map_or(0, |d| d.1);
    Ok(Json(json!({ "calls_today": today, "per_day": PER_DAY, "per_minute": PER_MINUTE })))
}

/* ---------------- Keys (signed-in users) ---------------- */

fn user_err(e: (StatusCode, String)) -> ApiErr {
    err(e.0, &e.1)
}

/// `GET /developer/keys`
pub async fn list(State(c): State<DevCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let u = c.acct.user(&headers).await.map_err(user_err)?;
    let v = c.acct.rest(reqwest::Method::GET, &format!("api_keys?user_id=eq.{}&revoked=eq.false&select=id,name,prefix,created_at,last_used_at&order=created_at.desc", u.id), None).await.map_err(user_err)?;
    Ok(Json(json!({ "keys": v, "per_minute": PER_MINUTE, "per_day": PER_DAY, "max_keys": MAX_KEYS, "on": c.admin.dev_api() })))
}

#[derive(Deserialize)]
pub struct NewKey {
    #[serde(default)]
    name: String,
}

/// `POST /developer/keys`: makes a key and returns it once.
pub async fn create(State(c): State<DevCtx>, headers: HeaderMap, Json(n): Json<NewKey>) -> Result<Json<Value>, ApiErr> {
    if !c.admin.dev_api() {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "The Kixo API is switched off right now"));
    }
    let u = c.acct.user(&headers).await.map_err(user_err)?;
    let live = c.acct.rest(reqwest::Method::GET, &format!("api_keys?user_id=eq.{}&revoked=eq.false&select=id", u.id), None).await.map_err(user_err)?;
    if live.as_array().map_or(0, |r| r.len()) >= MAX_KEYS {
        return Err(err(StatusCode::BAD_REQUEST, "Up to 5 keys; revoke one first"));
    }
    let mut raw = [0u8; 20];
    SystemRandom::new().fill(&mut raw).map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Try again"))?;
    let key = format!("kixo_{}", raw.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let name: String = n.name.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(40).collect();
    let row = json!({ "user_id": u.id, "name": name, "prefix": &key[..12], "key_hash": hash(&key) });
    let v = c.acct.rest(reqwest::Method::POST, "api_keys", Some(row)).await.map_err(user_err)?;
    let saved = v.as_array().and_then(|r| r.first()).cloned().unwrap_or(Value::Null);
    Ok(Json(json!({ "key": key, "id": saved["id"], "prefix": &key[..12], "name": name, "note": "Copy it now: Kixo keeps only a hash and cannot show it again" })))
}

/// `DELETE /developer/keys/{id}`: revokes one of the caller's keys.
pub async fn revoke(State(c): State<DevCtx>, headers: HeaderMap, Path(id): Path<i64>) -> Result<Json<Value>, ApiErr> {
    let u = c.acct.user(&headers).await.map_err(user_err)?;
    let v = c.acct.rest(reqwest::Method::PATCH, &format!("api_keys?id=eq.{id}&user_id=eq.{}", u.id), Some(json!({ "revoked": true }))).await.map_err(user_err)?;
    if v.as_array().is_none_or(|r| r.is_empty()) {
        return Err(err(StatusCode::NOT_FOUND, "No such key"));
    }
    // Forget any cached copy so the key stops at once.
    mem().lock().expect("devapi lock").keys.clear();
    Ok(Json(json!({ "revoked": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_hex_sha256() {
        let h = hash("kixo_0000000000000000000000000000000000000000");
        assert_eq!(h.len(), 64);
        assert!(h.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(h, hash("kixo_0000000000000000000000000000000000000001"));
    }
}
