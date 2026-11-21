//! X Tracker (migration 0017): users choose X accounts; when one of them posts a Solana
//! contract address, the post shows in the X Tracker feed and an alert goes to each
//! follower's channels (Email, Telegram, Discord: alerts.rs).
//!
//! It reads X through X's own API with Kixo's key (X_BEARER_TOKEN, also used by the
//! news feed). Reading accounts' posts needs a paid X API plan; without the key the page
//! says so and keeps the user's list. To stay inside the plan's monthly reads, at most
//! MAX_ACCOUNTS accounts (across all users) are read, one request each every POLL.

use crate::{account::AccountState, alerts::AlertsCtx};
use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

const POLL: Duration = Duration::from_secs(120);
const MAX_ACCOUNTS: usize = 40;
const PER_USER: usize = 10;
const FEED: usize = 200;

#[derive(Clone)]
pub struct XCtx {
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub alerts: AlertsCtx,
    pub http: reqwest::Client,
}

#[derive(Default)]
struct Mem {
    /// handle -> X user id.
    ids: HashMap<String, String>,
    /// handle -> newest post id seen.
    since: HashMap<String, String>,
    /// Recent posts that carried a contract address, newest first.
    feed: VecDeque<Value>,
    /// handle -> users following it.
    followers: HashMap<String, Vec<String>>,
    last_error: Option<String>,
    last_poll: i64,
}

fn mem() -> &'static Mutex<Mem> {
    static M: OnceLock<Mutex<Mem>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(Mem::default()))
}

fn token() -> Option<String> {
    monexa_common::secret("X_BEARER_TOKEN").filter(|t| t.len() > 20)
}

pub fn valid_handle(h: &str) -> bool {
    (1..=15).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Solana addresses in a post: base58, 32 to 44 characters, standing on their own (a
/// pump.fun or Kixo link counts too). Words that only look long are not addresses.
pub fn addresses_in(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.split(|c: char| !c.is_ascii_alphanumeric()) {
        if (32..=44).contains(&raw.len())
            && raw.bytes().all(|b| b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(&b))
            && bs58::decode(raw).into_vec().is_ok_and(|v| v.len() == 32)
            && !out.iter().any(|o| o == raw)
        {
            out.push(raw.to_string());
        }
    }
    out
}

/// Who follows which account, from user_alerts (every minute or so).
async fn load_followers(acct: &AccountState) {
    let Ok(v) = acct.rest(reqwest::Method::GET, "user_alerts?select=user_id,x_accounts&limit=20000", None).await else { return };
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for r in v.as_array().into_iter().flatten() {
        let Some(user) = r["user_id"].as_str() else { continue };
        for h in r["x_accounts"].as_array().into_iter().flatten().filter_map(|h| h.as_str()) {
            map.entry(h.to_lowercase()).or_default().push(user.to_string());
        }
    }
    mem().lock().expect("x lock").followers = map;
}

pub async fn run(c: XCtx) {
    loop {
        if c.admin.x_tracker() {
            load_followers(&c.acct).await;
            if let Some(tok) = token() {
                poll(&c, &tok).await;
            }
        }
        tokio::time::sleep(POLL).await;
    }
}

async fn poll(c: &XCtx, tok: &str) {
    // The most followed accounts first, up to the cap.
    let handles: Vec<String> = {
        let m = mem().lock().expect("x lock");
        let mut v: Vec<(String, usize)> = m.followers.iter().map(|(h, f)| (h.clone(), f.len())).collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        v.into_iter().take(MAX_ACCOUNTS).map(|(h, _)| h).collect()
    };
    for h in handles {
        let id = { mem().lock().expect("x lock").ids.get(&h).cloned() };
        let id = match id {
            Some(id) => id,
            None => {
                let r = c.http.get(format!("https://api.twitter.com/2/users/by/username/{h}")).bearer_auth(tok).timeout(Duration::from_secs(10)).send().await;
                let Ok(r) = r else { continue };
                if !r.status().is_success() {
                    mem().lock().expect("x lock").last_error = Some(format!("X answered {} for @{h}", r.status()));
                    continue;
                }
                let Some(id) = r.json::<Value>().await.ok().and_then(|v| v["data"]["id"].as_str().map(String::from)) else { continue };
                mem().lock().expect("x lock").ids.insert(h.clone(), id.clone());
                id
            }
        };
        let since = { mem().lock().expect("x lock").since.get(&h).cloned() };
        let mut q: Vec<(&str, String)> = vec![("max_results", "5".into()), ("tweet.fields", "created_at".into()), ("exclude", "retweets".into())];
        if let Some(s) = &since {
            q.push(("since_id", s.clone()));
        }
        let r = c.http.get(format!("https://api.twitter.com/2/users/{id}/tweets")).bearer_auth(tok).query(&q).timeout(Duration::from_secs(10)).send().await;
        let Ok(r) = r else { continue };
        if !r.status().is_success() {
            mem().lock().expect("x lock").last_error = Some(format!("X answered {} reading @{h}", r.status()));
            continue;
        }
        let Ok(v) = r.json::<Value>().await else { continue };
        let posts = v["data"].as_array().cloned().unwrap_or_default();
        if let Some(newest) = v["meta"]["newest_id"].as_str() {
            mem().lock().expect("x lock").since.insert(h.clone(), newest.to_string());
        }
        // The first read of an account only sets the starting point: no alerts for old posts.
        if since.is_none() {
            continue;
        }
        for p in posts {
            let (Some(pid), Some(text)) = (p["id"].as_str(), p["text"].as_str()) else { continue };
            let mints = addresses_in(text);
            if mints.is_empty() {
                continue;
            }
            let item = json!({ "handle": h, "id": pid, "text": text.chars().take(280).collect::<String>(), "mints": mints, "at": p["created_at"], "url": format!("https://x.com/{h}/status/{pid}") });
            let followers = {
                let mut m = mem().lock().expect("x lock");
                m.feed.push_front(item);
                m.feed.truncate(FEED);
                m.followers.get(&h).cloned().unwrap_or_default()
            };
            let link = format!("{}/token/{}", crate::alerts::site(), mints[0]);
            for user in followers {
                crate::alerts::notify(&c.alerts, &user, format!("@{h} posted a coin"), format!("@{h} on X: {}", text.chars().take(200).collect::<String>()), Some(link.clone()), crate::alerts::Mail::new("alert_x", vec![("handle", h.to_string()), ("text", text.chars().take(400).collect())]));
            }
        }
    }
    let mut m = mem().lock().expect("x lock");
    m.last_poll = crate::now_unix();
}

/* ---------------- Routes ---------------- */

fn on(c: &XCtx) -> Result<(), (StatusCode, String)> {
    if c.admin.x_tracker() {
        Ok(())
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, "The X Tracker is switched off right now".into()))
    }
}

/// `GET /x-tracker/status`
pub async fn status(State(c): State<XCtx>) -> Result<Json<Value>, (StatusCode, String)> {
    on(&c)?;
    let m = mem().lock().expect("x lock");
    Ok(Json(json!({ "x_api": token().is_some(), "accounts": m.followers.len().min(MAX_ACCOUNTS), "cap": MAX_ACCOUNTS, "per_user": PER_USER, "last_poll": m.last_poll, "error": m.last_error })))
}

/// `GET /x-tracker/me`: the caller's accounts and the posts from them.
pub async fn me(State(c): State<XCtx>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let v = c.acct.rest(reqwest::Method::GET, &format!("user_alerts?user_id=eq.{}&select=x_accounts", u.id), None).await?;
    let mine: Vec<String> = v.as_array().and_then(|r| r.first()).and_then(|r| serde_json::from_value(r["x_accounts"].clone()).ok()).unwrap_or_default();
    let set: HashSet<String> = mine.iter().map(|h| h.to_lowercase()).collect();
    let feed: Vec<Value> = mem().lock().expect("x lock").feed.iter().filter(|p| p["handle"].as_str().is_some_and(|h| set.contains(h))).cloned().collect();
    Ok(Json(json!({ "accounts": mine, "feed": feed })))
}

#[derive(Deserialize)]
pub struct SaveIn {
    accounts: Vec<String>,
}

/// `PUT /x-tracker/me`: the caller's accounts (up to PER_USER).
pub async fn save(State(c): State<XCtx>, headers: HeaderMap, Json(i): Json<SaveIn>) -> Result<Json<Value>, (StatusCode, String)> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let mut seen = HashSet::new();
    let mut clean = Vec::new();
    for h in i.accounts {
        let h = h.trim().trim_start_matches('@').trim_start_matches("https://x.com/").trim_start_matches("https://twitter.com/").to_lowercase();
        if h.is_empty() {
            continue;
        }
        if !valid_handle(&h) {
            return Err((StatusCode::BAD_REQUEST, format!("@{h} is not an X handle")));
        }
        if seen.insert(h.clone()) {
            clean.push(h);
        }
    }
    if clean.len() > PER_USER {
        return Err((StatusCode::BAD_REQUEST, format!("Up to {PER_USER} accounts")));
    }
    c.acct.rest(reqwest::Method::POST, "user_alerts?on_conflict=user_id", Some(json!({ "user_id": u.id, "x_accounts": clean }))).await?;
    load_followers(&c.acct).await;
    Ok(Json(json!({ "accounts": clean })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_contract_addresses() {
        let t = "New gem: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 check pump.fun/coin/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr wow";
        let a = addresses_in(t);
        assert_eq!(a.len(), 2);
        assert!(addresses_in("hello world, no coins here, thisisaverylongwordbutnotbase58000000").is_empty());
        assert!(valid_handle("blknoiz06") && !valid_handle("way_too_long_name_x") && !valid_handle("bad-dash"));
    }
}
