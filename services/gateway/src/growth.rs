//! Growth features: referral codes and the weekly demo trading competition.
//!
//! Every account gets a short public code. A link with `?ref=<code>` that leads to a new
//! sign-up records the referrer. The same code is the trader's public name on the
//! weekly leaderboard, so no email or wallet ever appears there.

use crate::account::AccountState;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// Code letters: no 0/o, 1/l/i, so a code read aloud is not mistyped.
const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LEN: usize = 7;
/// A new account can name its referrer within this time of signing up.
const CLAIM_WINDOW_SECS: i64 = 24 * 3600;
const WEEK_SECS: i64 = 7 * 86_400;
const BOARD_TTL: Duration = Duration::from_secs(30);
const START_USD: f64 = crate::demo::START_USD;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// A code derived from the account id and a salt (bumped on the rare clash).
pub fn make_code(user: &str, salt: u32) -> String {
    let h = Sha256::digest(format!("monexa-ref:{user}:{salt}"));
    h.iter().take(CODE_LEN).map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect()
}

pub fn valid_code(c: &str) -> bool {
    (6..=12).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// Monday 00:00 UTC of the week holding `ts`.
pub fn week_start(ts: i64) -> i64 {
    let days = ts.div_euclid(86_400);
    // 1970-01-01 was a Thursday: the Monday-based weekday is (days + 3) % 7.
    (days - (days + 3).rem_euclid(7)) * 86_400
}

/// The caller's code, created on first use.
pub(crate) async fn own_code(a: &AccountState, user: &str) -> Result<String, (StatusCode, String)> {
    let v = a.rest(reqwest::Method::GET, &format!("profiles?id=eq.{user}&select=ref_code"), None).await?;
    let row = v.as_array().and_then(|r| r.first()).cloned();
    if let Some(code) = row.as_ref().and_then(|r| r["ref_code"].as_str()) {
        return Ok(code.to_string());
    }
    for salt in 0..5 {
        let code = make_code(user, salt);
        let res = if row.is_some() {
            a.rest(reqwest::Method::PATCH, &format!("profiles?id=eq.{user}"), Some(json!({ "ref_code": code }))).await
        } else {
            a.rest(reqwest::Method::POST, "profiles?on_conflict=id", Some(json!({ "id": user, "ref_code": code }))).await
        };
        match res {
            Ok(_) => return Ok(code),
            Err((StatusCode::CONFLICT, _)) => continue,
            Err(e) => return Err(e),
        }
    }
    Err((StatusCode::SERVICE_UNAVAILABLE, "could not create a referral code".into()))
}

/// `GET /account/referral`: the caller's code and the accounts it brought in.
pub async fn referral(State(a): State<Arc<AccountState>>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    let u = a.user(&headers).await?;
    let code = own_code(&a, &u.id).await?;
    let v = a
        .rest(reqwest::Method::GET, &format!("profiles?referred_by=eq.{}&select=referred_at&order=referred_at.desc&limit=500", u.id), None)
        .await?;
    let joined: Vec<Value> = v.as_array().cloned().unwrap_or_default().into_iter().map(|r| r["referred_at"].clone()).collect();
    Ok(Json(json!({ "code": code, "invited": joined.len(), "recent": joined.into_iter().take(20).collect::<Vec<_>>() })))
}

#[derive(Deserialize)]
pub struct ClaimIn {
    code: String,
}

/// `POST /account/referral {code}`: a new account names who referred it. Only once,
/// only within a day of signing up, and never itself.
pub async fn claim(State(a): State<Arc<AccountState>>, headers: HeaderMap, Json(i): Json<ClaimIn>) -> Result<Json<Value>, (StatusCode, String)> {
    let u = a.user(&headers).await?;
    let code = i.code.trim().to_ascii_lowercase();
    if !valid_code(&code) {
        return Err((StatusCode::BAD_REQUEST, "not a referral code".into()));
    }
    let owner = a.rest(reqwest::Method::GET, &format!("profiles?ref_code=eq.{code}&select=id"), None).await?;
    let owner = owner
        .as_array()
        .and_then(|r| r.first())
        .and_then(|r| r["id"].as_str())
        .map(String::from)
        .ok_or((StatusCode::NOT_FOUND, "unknown referral code".into()))?;
    if owner == u.id {
        return Err((StatusCode::BAD_REQUEST, "you cannot refer yourself".into()));
    }
    let me = a.rest(reqwest::Method::GET, &format!("profiles?id=eq.{}&select=referred_by,created_at", u.id), None).await?;
    let me = me.as_array().and_then(|r| r.first()).cloned().ok_or((StatusCode::CONFLICT, "account not set up yet".into()))?;
    if !me["referred_by"].is_null() {
        return Ok(Json(json!({ "ok": false, "reason": "already referred" })));
    }
    let created = me["created_at"].as_str().and_then(parse_iso).unwrap_or(0);
    if now() - created > CLAIM_WINDOW_SECS {
        return Ok(Json(json!({ "ok": false, "reason": "only new accounts can use a referral" })));
    }
    a.rest(
        reqwest::Method::PATCH,
        &format!("profiles?id=eq.{}&referred_by=is.null", u.id),
        Some(json!({ "referred_by": owner, "referred_at": crate::account::chrono_iso(now()) })),
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

/// "2026-11-07T10:20:30.123+00:00" to unix seconds (UTC, as Postgres sends it).
fn parse_iso(s: &str) -> Option<i64> {
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, dd) = (d.next()??, d.next()??, d.next()??);
    let t: Vec<i64> = time.get(..8)?.split(':').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    // Days from a civil date (Howard Hinnant).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + dd - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + t[0] * 3600 + t[1] * 60 + t[2])
}

#[derive(Deserialize)]
pub struct BoardQuery {
    /// "current" (default) or "last".
    week: Option<String>,
}

type BoardCache = HashMap<i64, (Instant, Vec<Value>)>;
static BOARDS: Mutex<Option<BoardCache>> = Mutex::new(None);

/// `GET /demo/leaderboard?week=current|last`: the weekly demo competition. Public; a
/// signed-in caller sees their own row marked.
pub async fn leaderboard(State(a): State<Arc<AccountState>>, headers: HeaderMap, Query(q): Query<BoardQuery>) -> Result<Json<Value>, (StatusCode, String)> {
    let this = week_start(now());
    let from = if q.week.as_deref() == Some("last") { this - WEEK_SECS } else { this };
    let to = from + WEEK_SECS;
    let cached = BOARDS
        .lock()
        .expect("boards")
        .as_ref()
        .and_then(|m| m.get(&from).filter(|(at, _)| at.elapsed() < BOARD_TTL).map(|(_, v)| v.clone()));
    let rows = match cached {
        Some(r) => r,
        None => {
            let v = a
                .rest(
                    reqwest::Method::POST,
                    "rpc/demo_leaderboard",
                    Some(json!({ "p_from": crate::account::chrono_iso(from), "p_to": crate::account::chrono_iso(to), "p_limit": 100 })),
                )
                .await?;
            let rows = v.as_array().cloned().unwrap_or_default();
            BOARDS.lock().expect("boards").get_or_insert_with(HashMap::new).insert(from, (Instant::now(), rows.clone()));
            rows
        }
    };
    let me = if headers.contains_key("authorization") { a.user(&headers).await.ok().map(|u| u.id) } else { None };
    let num = |v: &Value| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0);
    let list: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let realized = num(&r["realized_usd"]);
            let trades = num(&r["trades"]);
            json!({
                "rank": i + 1,
                // Accounts made before codes existed get the code they will be given.
                "name": r["ref_code"].as_str().map(String::from).unwrap_or_else(|| make_code(r["user_id"].as_str().unwrap_or(""), 0)),
                "pct": (realized / START_USD * 10_000.0).round() / 100.0,
                "realized_usd": (realized * 100.0).round() / 100.0,
                "trades": trades,
                "win_rate": if trades > 0.0 { (num(&r["wins"]) / trades * 1000.0).round() / 10.0 } else { 0.0 },
                "best_usd": (num(&r["best_usd"]) * 100.0).round() / 100.0,
                "you": me.as_deref().is_some_and(|m| r["user_id"].as_str() == Some(m)),
            })
        })
        .collect();
    Ok(Json(json!({ "from": from, "to": to, "now": now(), "start_usd": START_USD, "min_trades": 3, "leaders": list })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_short_stable_and_valid() {
        let a = make_code("user-1", 0);
        assert_eq!(a.len(), CODE_LEN);
        assert!(valid_code(&a));
        assert_eq!(a, make_code("user-1", 0));
        assert_ne!(a, make_code("user-1", 1));
        assert!(!valid_code("AB12CD") && !valid_code("abc") && !valid_code("abc-123"));
    }

    #[test]
    fn weeks_start_on_monday_utc() {
        // 2026-11-07 is a Saturday; its week began on Monday 2026-11-02.
        let sat = parse_iso("2026-11-07T15:30:00.000+00:00").unwrap();
        let mon = parse_iso("2026-11-02T00:00:00+00:00").unwrap();
        assert_eq!(week_start(sat), mon);
        assert_eq!(week_start(mon), mon);
        assert_eq!(crate::account::chrono_iso(mon), "2026-11-02T00:00:00Z");
    }
}
