//! Kixo social trading (migration 0012): trader profiles, follows, the trade feed, the
//! leaderboard, and a public trader's trades for copying.
//!
//! A user appears only after making a profile (a handle) and while it is public. Only
//! demo trades are shown; no email or wallet ever leaves the gateway. The admin switch
//! "social" turns it all off.

use crate::account::AccountState;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

type ApiErr = (StatusCode, String);

#[derive(Clone)]
pub struct SocialCtx {
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
    /// Live prices for open positions (the same quotes the demo account uses).
    pub app: Arc<crate::AppState>,
}

/// Words no one may take as a handle (they would look official).
const RESERVED: &[&str] = &["admin", "kixo", "support", "official", "team", "moderator", "mod", "help", "system", "staff", "root", "security", "monexa"];

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

fn on(c: &SocialCtx) -> Result<(), ApiErr> {
    if c.admin.social() {
        Ok(())
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, "Community is switched off right now".into()))
    }
}

pub fn valid_handle(h: &str) -> bool {
    (3..=20).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') && !RESERVED.iter().any(|r| h.contains(r))
}

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(max).collect()
}

fn num(v: &Value) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0)
}

async fn profile_by_user(a: &AccountState, user: &str) -> Result<Option<Value>, ApiErr> {
    let v = a.rest(reqwest::Method::GET, &format!("trader_profiles?user_id=eq.{user}&select=*"), None).await?;
    Ok(v.as_array().and_then(|r| r.first()).cloned())
}

async fn profile_by_handle(a: &AccountState, handle: &str) -> Result<Option<Value>, ApiErr> {
    if !valid_handle(handle) && !(3..=20).contains(&handle.len()) {
        return Ok(None);
    }
    let h: String = handle.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect::<String>().to_lowercase();
    let v = a.rest(reqwest::Method::GET, &format!("trader_profiles?handle=eq.{h}&select=*"), None).await?;
    Ok(v.as_array().and_then(|r| r.first()).cloned())
}

async fn count(a: &AccountState, table_filter: &str) -> u64 {
    a.rest(reqwest::Method::GET, &format!("{table_filter}&select=created_at"), None).await.ok().and_then(|v| v.as_array().map(|r| r.len() as u64)).unwrap_or(0)
}

fn public_view(p: &Value) -> Value {
    let s = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    json!({
        "handle": p["handle"], "display_name": p["display_name"], "bio": p["bio"], "public": p["public"], "created_at": p["created_at"],
        "avatar_url": s("avatar_url"), "banner_url": s("banner_url"), "x_handle": s("x_handle"), "telegram": s("telegram"),
        "hide_amounts": p.get("hide_amounts").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

/// Whether this viewer sees a trader's results as percentages only (migration 0022).
fn amounts_hidden(p: &Value, own: bool) -> bool {
    !own && p.get("hide_amounts").and_then(|v| v.as_bool()).unwrap_or(false)
}

/// A trade with its dollar figures removed; the result stays as a percentage.
fn mask_trade(mut t: Value) -> Value {
    t["usd"] = Value::Null;
    t["realized_usd"] = Value::Null;
    t["tokens"] = Value::Null;
    t["remaining"] = Value::Null;
    t
}

/// A picture URL is kept only when it points into the user's own folder of the
/// "profile-media" bucket (migration 0021); anything else is dropped.
fn own_media(c: &SocialCtx, user: &str, url: &str) -> Result<String, ApiErr> {
    let url = url.trim();
    if url.is_empty() {
        return Ok(String::new());
    }
    let prefix = format!("{}/storage/v1/object/public/profile-media/{user}/", c.acct.supabase_url());
    if url.len() <= 400 && url.starts_with(&prefix) && url[prefix.len()..].chars().all(|ch| ch.is_ascii_alphanumeric() || "-_.".contains(ch)) {
        Ok(url.to_string())
    } else {
        Err((StatusCode::BAD_REQUEST, "That picture was not uploaded to Kixo".into()))
    }
}

/* ---------------- A profile for every account ---------------- */

/// Handle words: none contains a reserved word (valid_handle), longest pair fits 20.
const ADJ: &[&str] = &["swift", "lucky", "quiet", "bold", "sharp", "early", "calm", "rapid", "clever", "steady", "brave", "sunny", "lunar", "solar", "golden", "silver", "green", "frosty", "wild", "prime"];
const NOUN: &[&str] = &["falcon", "otter", "tiger", "whale", "raven", "comet", "fox", "lynx", "panda", "eagle", "shark", "wolf", "hawk", "bison", "koala", "orca", "heron", "cobra", "gecko", "puma"];

fn title(w: &str) -> String {
    let mut c = w.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

/// Gives an account its trader profile if it has none: a random handle such as
/// "swift_falcon_4821", public, which the user can change any time. Returns the profile.
/// No email, name or wallet is used, so nothing personal becomes public.
pub async fn ensure_profile(a: &AccountState, user: &str) -> Option<Value> {
    if let Ok(Some(p)) = profile_by_user(a, user).await {
        return Some(p);
    }
    let rng = ring::rand::SystemRandom::new();
    for _ in 0..6 {
        let mut b = [0u8; 4];
        ring::rand::SecureRandom::fill(&rng, &mut b).ok()?;
        let (adj, noun) = (ADJ[b[0] as usize % ADJ.len()], NOUN[b[1] as usize % NOUN.len()]);
        let n = u16::from_le_bytes([b[2], b[3]]) % 9000 + 1000;
        let handle = format!("{adj}_{noun}_{n}");
        if !valid_handle(&handle) {
            continue;
        }
        let row = json!({ "user_id": user, "handle": handle, "display_name": format!("{} {}", title(adj), title(noun)), "bio": "", "public": true });
        // A plain insert: it never replaces a profile made meanwhile (the user's own edit).
        let saved = a.rest(reqwest::Method::POST, "trader_profiles", Some(row)).await;
        if let Ok(Some(p)) = profile_by_user(a, user).await {
            return Some(p);
        }
        if saved.is_ok() {
            return None;
        }
        // Taken handle: try another.
    }
    None
}

/// At start: every existing account without a profile gets one.
pub async fn backfill(a: Arc<AccountState>) {
    let have: std::collections::HashSet<String> = match a.rest(reqwest::Method::GET, "trader_profiles?select=user_id&limit=100000", None).await {
        Ok(v) => v.as_array().into_iter().flatten().filter_map(|r| r["user_id"].as_str().map(String::from)).collect(),
        Err(_) => return,
    };
    let mut made = 0;
    for page in 1..=200 {
        let Ok(users) = a.list_auth_users(page, 1000).await else { break };
        if users.is_empty() {
            break;
        }
        for u in &users {
            if let Some(id) = u["id"].as_str().filter(|id| !have.contains(*id)) {
                if ensure_profile(&a, id).await.is_some() {
                    made += 1;
                }
            }
        }
        if users.len() < 1000 {
            break;
        }
    }
    if made > 0 {
        tracing::info!(made, "trader profiles made for existing accounts");
    }
}

/// `GET /social/me`: the caller's profile (made on first visit if missing) and follow counts.
pub async fn me(State(c): State<SocialCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let p = match profile_by_user(&c.acct, &u.id).await? {
        Some(p) => Some(p),
        None => ensure_profile(&c.acct, &u.id).await,
    };
    let followers = count(&c.acct, &format!("follows?leader=eq.{}", u.id)).await;
    // Who the caller follows, by handle, so Follow buttons everywhere show the truth.
    let leaders: Vec<String> = c
        .acct
        .rest(reqwest::Method::GET, &format!("follows?follower=eq.{}&select=leader&limit=500", u.id), None)
        .await
        .ok()
        .and_then(|v| v.as_array().map(|r| r.iter().filter_map(|x| x["leader"].as_str().map(String::from)).collect()))
        .unwrap_or_default();
    let handles: Vec<Value> = if leaders.is_empty() {
        Vec::new()
    } else {
        c.acct
            .rest(reqwest::Method::GET, &format!("trader_profiles?user_id=in.({})&select=handle", leaders.join(",")), None)
            .await
            .ok()
            .and_then(|v| v.as_array().map(|r| r.iter().map(|x| x["handle"].clone()).collect()))
            .unwrap_or_default()
    };
    Ok(Json(json!({ "profile": p.as_ref().map(public_view), "followers": followers, "following": leaders.len(), "following_handles": handles })))
}

#[derive(Deserialize)]
pub struct ProfileIn {
    handle: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    bio: String,
    #[serde(default = "yes")]
    public: bool,
    #[serde(default)]
    avatar_url: String,
    #[serde(default)]
    banner_url: String,
    #[serde(default)]
    x_handle: String,
    #[serde(default)]
    telegram: String,
    #[serde(default)]
    hide_amounts: bool,
}
fn yes() -> bool {
    true
}

/// `PUT /social/me`: make or change the caller's profile.
pub async fn save_me(State(c): State<SocialCtx>, headers: HeaderMap, Json(p): Json<ProfileIn>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let handle = p.handle.trim().trim_start_matches('@').to_lowercase();
    if !valid_handle(&handle) {
        return Err((StatusCode::BAD_REQUEST, "Handle: 3 to 20 letters, numbers or _, and not an official-looking word".into()));
    }
    if let Some(other) = profile_by_handle(&c.acct, &handle).await? {
        if other["user_id"].as_str() != Some(u.id.as_str()) {
            return Err((StatusCode::CONFLICT, "That handle is taken".into()));
        }
    }
    let mut row = json!({
        "user_id": u.id,
        "handle": handle,
        "display_name": clean(&p.display_name, 40),
        "bio": clean(&p.bio, 160),
        "public": p.public,
        "updated_at": crate::account::chrono_iso(now()),
    });
    // Pictures and links (migration 0021): written only once the columns exist.
    let x = p.x_handle.trim().trim_start_matches('@').to_string();
    let tg = p.telegram.trim().trim_start_matches('@').trim_start_matches("https://t.me/").to_string();
    if !x.is_empty() && !(x.len() <= 15 && x.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_')) {
        return Err((StatusCode::BAD_REQUEST, "X handle: up to 15 letters, numbers or _".into()));
    }
    if !tg.is_empty() && !((5..=32).contains(&tg.len()) && tg.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_')) {
        return Err((StatusCode::BAD_REQUEST, "Telegram: 5 to 32 letters, numbers or _".into()));
    }
    let avatar = own_media(&c, &u.id, &p.avatar_url)?;
    let banner = own_media(&c, &u.id, &p.banner_url)?;
    let has_media = profile_by_user(&c.acct, &u.id).await?.is_some_and(|v| v.get("avatar_url").is_some());
    if has_media {
        row["avatar_url"] = json!(avatar);
        row["banner_url"] = json!(banner);
        row["x_handle"] = json!(x);
        row["telegram"] = json!(tg);
    } else if !avatar.is_empty() || !banner.is_empty() || !x.is_empty() || !tg.is_empty() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Pictures and links need Kixo's database update (migration 0021)".into()));
    }
    let existing = profile_by_user(&c.acct, &u.id).await?;
    if existing.as_ref().is_some_and(|v| v.get("hide_amounts").is_some()) {
        row["hide_amounts"] = json!(p.hide_amounts);
    } else if p.hide_amounts {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Hiding amounts needs Kixo's database update (migration 0022)".into()));
    }
    let v = c.acct.rest(reqwest::Method::POST, "trader_profiles?on_conflict=user_id", Some(row)).await?;
    let saved = v.as_array().and_then(|r| r.first()).cloned().ok_or((StatusCode::SERVICE_UNAVAILABLE, "could not save".into()))?;
    Ok(Json(json!({ "profile": public_view(&saved) })))
}

fn stats_view(r: &Value) -> Value {
    let trades = num(&r["trades"]);
    json!({
        "realized_usd": (num(&r["realized_usd"]) * 100.0).round() / 100.0,
        "trades": trades,
        "win_rate": if trades > 0.0 { (num(&r["wins"]) / trades * 1000.0).round() / 10.0 } else { 0.0 },
        "best_usd": (num(&r["best_usd"]) * 100.0).round() / 100.0,
        "volume_usd": (num(&r["volume_usd"]) * 100.0).round() / 100.0,
    })
}

async fn stats(a: &AccountState, user: &str, from: i64) -> Value {
    a.rest(reqwest::Method::POST, "rpc/trader_stats", Some(json!({ "p_user": user, "p_from": crate::account::chrono_iso(from) })))
        .await
        .ok()
        .and_then(|v| v.as_array().and_then(|r| r.first()).cloned())
        .map(|r| stats_view(&r))
        .unwrap_or(Value::Null)
}

fn trade_view(t: &Value) -> Value {
    json!({
        "id": t["id"], "handle": t["handle"], "display_name": t["display_name"], "mint": t["mint"], "symbol": t["symbol"], "side": t["side"],
        "usd": (num(&t["usd"]) * 100.0).round() / 100.0, "price_usd": num(&t["price_usd"]),
        "realized_usd": t["realized_usd"].as_f64().or_else(|| t["realized_usd"].as_str().and_then(|s| s.parse().ok())).map(|r| (r * 100.0).round() / 100.0),
        "remaining": t.get("remaining").map(num), "tokens": t.get("tokens").map(num), "source": t["source"], "ts": t["ts"],
        "realized_pct": realized_pct(t),
    })
}

/// A sale's result against what the sold tokens cost: proceeds minus profit is the cost.
fn realized_pct(t: &Value) -> Value {
    let r = t["realized_usd"].as_f64().or_else(|| t["realized_usd"].as_str().and_then(|s| s.parse().ok()));
    let usd = num(&t["usd"]);
    match r {
        Some(r) if t["side"] == "sell" && usd - r > 0.0 => json!(((r / (usd - r)) * 1000.0).round() / 10.0),
        _ => Value::Null,
    }
}

/// `GET /social/u/{handle}`: a public trader (or the caller's own profile, even private).
pub async fn trader(State(c): State<SocialCtx>, headers: HeaderMap, Path(handle): Path<String>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let me = if headers.contains_key("authorization") { c.acct.user(&headers).await.ok().map(|u| u.id) } else { None };
    let p = profile_by_handle(&c.acct, &handle).await?.ok_or((StatusCode::NOT_FOUND, "No trader with that handle".into()))?;
    let uid = p["user_id"].as_str().unwrap_or_default().to_string();
    let own = me.as_deref() == Some(uid.as_str());
    if p["public"] != json!(true) && !own {
        return Err((StatusCode::NOT_FOUND, "No trader with that handle".into()));
    }
    let t = now();
    let (s7, s30, sall) = tokio::join!(stats(&c.acct, &uid, t - 7 * 86_400), stats(&c.acct, &uid, t - 30 * 86_400), stats(&c.acct, &uid, 0));
    let followers = count(&c.acct, &format!("follows?leader=eq.{uid}")).await;
    let following = count(&c.acct, &format!("follows?follower=eq.{uid}")).await;
    let i_follow = match &me {
        Some(m) if !own => count(&c.acct, &format!("follows?follower=eq.{m}&leader=eq.{uid}")).await > 0,
        _ => false,
    };
    let (daily, invites, top) = tokio::join!(
        c.acct.rest(reqwest::Method::POST, "rpc/trader_pnl_daily", Some(json!({ "p_user": uid, "p_from": crate::account::chrono_iso(t - 120 * 86_400) }))),
        c.acct.rest(reqwest::Method::POST, "rpc/invites_of", Some(json!({ "p_user": uid }))),
        c.acct.rest(reqwest::Method::POST, "rpc/social_leaders", Some(json!({ "p_from": crate::account::chrono_iso(t - 7 * 86_400), "p_limit": 10 }))),
    );
    let daily: Vec<Value> = daily
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .map(|d| json!({ "day": d["day"], "realized_usd": (num(&d["realized_usd"]) * 100.0).round() / 100.0, "trades": num(&d["trades"]), "wins": num(&d["wins"]) }))
        .collect();
    // Badges, each earned and checkable: waitlist invites and this week's top 10.
    let invites = invites.ok().map(|v| num(&v)).unwrap_or(0.0);
    // Only a week in profit counts: with few traders a losing week could still rank.
    let rank = top.ok().and_then(|v| v.as_array().and_then(|r| r.iter().position(|x| x["handle"] == p["handle"] && num(&x["realized_usd"]) > 0.0)));
    let mut badges = Vec::new();
    if invites >= 10.0 {
        badges.push(json!({ "key": "founding_trader", "label": "Founding Trader", "why": format!("Invited {invites} people to Kixo") }));
    } else if invites >= 3.0 {
        badges.push(json!({ "key": "founding_member", "label": "Founding Member", "why": format!("Invited {invites} people to Kixo") }));
    }
    if let Some(r) = rank {
        badges.push(json!({ "key": "top10", "label": format!("Top {} this week", r + 1), "why": "Ranked by profit taken in the last 7 days" }));
    }
    let trades = c
        .acct
        .rest(reqwest::Method::POST, "rpc/trader_trades", Some(json!({ "p_handle": p["handle"], "p_after": 0, "p_limit": 30 })))
        .await
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    // Hidden amounts: results as win or loss and percentages only.
    let hide = amounts_hidden(&p, own);
    let (s7, s30, sall, daily) = if hide {
        let m = |mut v: Value| {
            if v.is_object() {
                v["realized_usd"] = Value::Null;
                v["best_usd"] = Value::Null;
                v["volume_usd"] = Value::Null;
            }
            v
        };
        let signs: Vec<Value> = daily
            .into_iter()
            .map(|mut d| {
                let r = num(&d["realized_usd"]);
                d["realized_usd"] = json!(r.signum());
                d
            })
            .collect();
        (m(s7), m(s30), m(sall), signs)
    } else {
        (s7, s30, sall, daily)
    };
    let trades: Vec<Value> = trades.iter().map(trade_view).map(|t| if hide { mask_trade(t) } else { t }).collect();
    Ok(Json(json!({
        "profile": public_view(&p),
        "own": own,
        "i_follow": i_follow,
        "followers": followers,
        "following": following,
        "hidden_amounts": hide,
        "stats": { "d7": s7, "d30": s30, "all": sall },
        "daily": daily,
        "badges": badges,
        "invites": invites,
        "trades": trades,
    })))
}

/// `GET /social/u/{handle}/portfolio`: a public trader's demo portfolio: open
/// positions at what selling now would bring (as the demo account values them), their
/// five best and five worst sales, and their last 100 trades. With hidden amounts,
/// percentages only.
pub async fn portfolio(State(c): State<SocialCtx>, headers: HeaderMap, Path(handle): Path<String>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let me = if headers.contains_key("authorization") { c.acct.user(&headers).await.ok().map(|u| u.id) } else { None };
    let p = profile_by_handle(&c.acct, &handle).await?.ok_or((StatusCode::NOT_FOUND, "No trader with that handle".into()))?;
    let uid = p["user_id"].as_str().unwrap_or_default().to_string();
    let own = me.as_deref() == Some(uid.as_str());
    if p["public"] != json!(true) && !own {
        return Err((StatusCode::NOT_FOUND, "No trader with that handle".into()));
    }
    let hide = amounts_hidden(&p, own);
    let sells = |order: &str| format!("demo_trades?user_id=eq.{uid}&side=eq.sell&realized_usd=not.is.null&order=realized_usd.{order}&limit=5&select=id,mint,symbol,side,usd,price_usd,realized_usd,ts");
    let (q_pos, q_best, q_worst) = (format!("demo_positions?user_id=eq.{uid}&select=mint,symbol,tokens,cost_usd,opened_at&order=opened_at.desc"), sells("desc"), sells("asc"));
    let (rows, best, worst, history) = tokio::join!(
        c.acct.rest(reqwest::Method::GET, &q_pos, None),
        c.acct.rest(reqwest::Method::GET, &q_best, None),
        c.acct.rest(reqwest::Method::GET, &q_worst, None),
        c.acct.rest(reqwest::Method::POST, "rpc/trader_trades", Some(json!({ "p_handle": p["handle"], "p_after": 0, "p_limit": 100 }))),
    );
    let rows = rows.ok().and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let mut positions = Vec::new();
    for r in rows.iter().take(50) {
        let mint = r["mint"].as_str().unwrap_or("").to_string();
        let tokens = num(&r["tokens"]);
        let cost = num(&r["cost_usd"]);
        let q = crate::demo::quote_within(&c.app, &mint, crate::demo::VALUE_QUOTE_GRACE).await.ok();
        let value = q.as_ref().and_then(|q| q.held(tokens).sell(tokens)).map(|f| f.usd);
        let pnl_pct = value.filter(|_| cost > 0.0).map(|v| ((v - cost) / cost * 1000.0).round() / 10.0);
        let image = {
            let b = c.app.board.lock().expect("board lock");
            b.tokens.get(&mint).and_then(|t| t.meta.as_ref().and_then(|m| m.image.clone())).or_else(|| b.markets.get(&mint).and_then(|m| m.image))
        };
        let symbol = r["symbol"].as_str().filter(|s| !s.is_empty()).map(String::from).or_else(|| q.as_ref().map(|q| q.symbol.clone())).unwrap_or_default();
        positions.push(if hide {
            json!({ "mint": mint, "symbol": symbol, "image": image, "pnl_pct": pnl_pct, "opened_at": r["opened_at"] })
        } else {
            json!({
                "mint": mint, "symbol": symbol, "image": image, "tokens": tokens, "cost_usd": (cost * 100.0).round() / 100.0,
                "value_usd": value.map(|v| (v * 100.0).round() / 100.0), "pnl_usd": value.map(|v| ((v - cost) * 100.0).round() / 100.0),
                "pnl_pct": pnl_pct, "opened_at": r["opened_at"],
            })
        });
    }
    let list = |v: Result<Value, ApiErr>| -> Vec<Value> {
        v.ok().and_then(|v| v.as_array().cloned()).unwrap_or_default().iter().map(trade_view).map(|t| if hide { mask_trade(t) } else { t }).collect()
    };
    let best: Vec<Value> = list(best).into_iter().filter(|t| t["realized_pct"].as_f64().unwrap_or(0.0) > 0.0).collect();
    let worst: Vec<Value> = list(worst).into_iter().filter(|t| t["realized_pct"].as_f64().unwrap_or(0.0) < 0.0).collect();
    Ok(Json(json!({ "hidden_amounts": hide, "positions": positions, "best": best, "worst": worst, "history": list(history) })))
}

/// `POST /social/follow/{handle}` and `DELETE` the same: follow or unfollow.
pub async fn follow(State(c): State<SocialCtx>, headers: HeaderMap, Path(handle): Path<String>) -> Result<Json<Value>, ApiErr> {
    set_follow(c, headers, handle, true).await
}
pub async fn unfollow(State(c): State<SocialCtx>, headers: HeaderMap, Path(handle): Path<String>) -> Result<Json<Value>, ApiErr> {
    set_follow(c, headers, handle, false).await
}
async fn set_follow(c: SocialCtx, headers: HeaderMap, handle: String, follow: bool) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let p = profile_by_handle(&c.acct, &handle).await?.filter(|p| p["public"] == json!(true)).ok_or((StatusCode::NOT_FOUND, "No trader with that handle".into()))?;
    let leader = p["user_id"].as_str().unwrap_or_default();
    if leader == u.id {
        return Err((StatusCode::BAD_REQUEST, "You cannot follow yourself".into()));
    }
    if follow {
        // A follower shows in the trader's followers list only with a profile of their own.
        let _ = ensure_profile(&c.acct, &u.id).await;
        if count(&c.acct, &format!("follows?follower=eq.{}", u.id)).await >= 500 {
            return Err((StatusCode::BAD_REQUEST, "You follow 500 traders already".into()));
        }
        c.acct.rest(reqwest::Method::POST, "follows?on_conflict=follower,leader", Some(json!({ "follower": u.id, "leader": leader }))).await?;
    } else {
        c.acct.rest(reqwest::Method::DELETE, &format!("follows?follower=eq.{}&leader=eq.{leader}", u.id), None).await?;
    }
    Ok(Json(json!({ "following": follow })))
}

#[derive(Deserialize)]
pub struct FeedQuery {
    scope: Option<String>,
    before: Option<i64>,
}

/// `GET /social/feed?scope=following|everyone&before=<id>`: trades, newest first.
pub async fn feed(State(c): State<SocialCtx>, headers: HeaderMap, Query(q): Query<FeedQuery>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let following = q.scope.as_deref() == Some("following");
    let follower = if following { Some(c.acct.user(&headers).await?.id) } else { None };
    let v = c
        .acct
        .rest(reqwest::Method::POST, "rpc/social_feed", Some(json!({ "p_follower": follower, "p_limit": 50, "p_before": q.before })))
        .await?;
    let items: Vec<Value> = v.as_array().map(|r| r.iter().map(trade_view).collect()).unwrap_or_default();
    Ok(Json(json!({ "items": items })))
}

#[derive(Deserialize)]
pub struct LeadersQuery {
    period: Option<String>,
}

/// `GET /social/leaders?period=7d|30d|all`: public traders by realized profit.
pub async fn leaders(State(c): State<SocialCtx>, Query(q): Query<LeadersQuery>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let from = match q.period.as_deref() {
        Some("30d") => now() - 30 * 86_400,
        Some("all") => 0,
        _ => now() - 7 * 86_400,
    };
    let v = c.acct.rest(reqwest::Method::POST, "rpc/social_leaders", Some(json!({ "p_from": crate::account::chrono_iso(from), "p_limit": 100 }))).await?;
    let rows: Vec<Value> = v
        .as_array()
        .map(|r| {
            r.iter()
                .enumerate()
                .map(|(i, x)| {
                    let trades = num(&x["trades"]);
                    json!({
                        "rank": i + 1, "handle": x["handle"], "display_name": x["display_name"],
                        "realized_usd": (num(&x["realized_usd"]) * 100.0).round() / 100.0,
                        "trades": trades, "win_rate": if trades > 0.0 { (num(&x["wins"]) / trades * 1000.0).round() / 10.0 } else { 0.0 },
                        "best_usd": (num(&x["best_usd"]) * 100.0).round() / 100.0, "followers": num(&x["followers"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(json!({ "leaders": rows })))
}

/// The caller's id when signed in (optional on public lists).
async fn viewer(c: &SocialCtx, headers: &HeaderMap) -> Option<String> {
    if headers.contains_key("authorization") {
        c.acct.user(headers).await.ok().map(|u| u.id)
    } else {
        None
    }
}

/// Public profiles as list rows: follower counts, and whether the viewer follows each.
async fn trader_rows(c: &SocialCtx, profiles: Vec<Value>, me: Option<&str>) -> Vec<Value> {
    if profiles.is_empty() {
        return Vec::new();
    }
    let ids: Vec<&str> = profiles.iter().filter_map(|p| p["user_id"].as_str()).collect();
    let list = ids.join(",");
    let follows = c.acct.rest(reqwest::Method::GET, &format!("follows?leader=in.({list})&select=leader,follower&limit=50000"), None).await.ok().and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let mut counts: std::collections::HashMap<&str, u64> = std::collections::HashMap::new();
    let mut mine: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for f in &follows {
        if let Some(l) = f["leader"].as_str() {
            *counts.entry(l).or_default() += 1;
            if me.is_some() && f["follower"].as_str() == me {
                mine.insert(l);
            }
        }
    }
    profiles
        .iter()
        .map(|p| {
            let id = p["user_id"].as_str().unwrap_or_default();
            json!({
                "handle": p["handle"], "display_name": p["display_name"], "bio": p["bio"], "created_at": p["created_at"],
                "followers": counts.get(id).copied().unwrap_or(0), "i_follow": mine.contains(id), "me": me == Some(id),
            })
        })
        .collect()
}

#[derive(Deserialize)]
pub struct TradersQuery {
    q: Option<String>,
    sort: Option<String>,
}

/// `GET /social/traders?q=&sort=followers|new`: public traders to find and follow.
/// The 200 newest (or matching) profiles are read; "followers" ranks those by followers.
pub async fn traders(State(c): State<SocialCtx>, headers: HeaderMap, Query(q): Query<TradersQuery>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let me = viewer(&c, &headers).await;
    let term: String = q.q.unwrap_or_default().to_lowercase().chars().filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_').take(20).collect();
    let filter = if term.is_empty() { String::new() } else { format!("&or=(handle.ilike.*{term}*,display_name.ilike.*{term}*)") };
    let v = c.acct.rest(reqwest::Method::GET, &format!("trader_profiles?public=eq.true&select=user_id,handle,display_name,bio,created_at&order=created_at.desc&limit=200{filter}"), None).await?;
    let mut rows = trader_rows(&c, v.as_array().cloned().unwrap_or_default(), me.as_deref()).await;
    if q.sort.as_deref() != Some("new") {
        rows.sort_by(|a, b| num(&b["followers"]).total_cmp(&num(&a["followers"])));
    }
    rows.truncate(50);
    Ok(Json(json!({ "traders": rows })))
}

#[derive(Deserialize)]
pub struct WhoQuery {
    who: Option<String>,
}

/// `GET /social/u/{handle}/people?who=followers|following`: the public profiles on
/// either side of a trader's follows. Private profiles are left out.
pub async fn people(State(c): State<SocialCtx>, headers: HeaderMap, Path(handle): Path<String>, Query(q): Query<WhoQuery>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let me = viewer(&c, &headers).await;
    let p = profile_by_handle(&c.acct, &handle).await?.filter(|p| p["public"] == json!(true) || p["user_id"].as_str() == me.as_deref()).ok_or((StatusCode::NOT_FOUND, "No trader with that handle".into()))?;
    let uid = p["user_id"].as_str().unwrap_or_default();
    let followers = q.who.as_deref() != Some("following");
    let path = if followers { format!("follows?leader=eq.{uid}&select=follower&order=created_at.desc&limit=200") } else { format!("follows?follower=eq.{uid}&select=leader&order=created_at.desc&limit=200") };
    let col = if followers { "follower" } else { "leader" };
    let ids: Vec<String> = c.acct.rest(reqwest::Method::GET, &path, None).await?.as_array().into_iter().flatten().filter_map(|r| r[col].as_str().map(String::from)).collect();
    if ids.is_empty() {
        return Ok(Json(json!({ "people": [] })));
    }
    let v = c.acct.rest(reqwest::Method::GET, &format!("trader_profiles?user_id=in.({})&public=eq.true&select=user_id,handle,display_name,bio,created_at", ids.join(",")), None).await?;
    let mut profiles = v.as_array().cloned().unwrap_or_default();
    // Newest follow first, as the follows were read.
    profiles.sort_by_key(|p| ids.iter().position(|i| Some(i.as_str()) == p["user_id"].as_str()).unwrap_or(usize::MAX));
    Ok(Json(json!({ "people": trader_rows(&c, profiles, me.as_deref()).await })))
}

#[derive(Deserialize)]
pub struct TradesQuery {
    after: Option<i64>,
}

/// `GET /social/trades/{handle}?after=<id>`: a public trader's newest trades, for copying.
pub async fn trades(State(c): State<SocialCtx>, Path(handle): Path<String>, Query(q): Query<TradesQuery>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    // Only a handle's own characters reach the database (a null byte made it fail).
    let handle = handle.trim_start_matches('@').to_lowercase();
    if !(3..=20).contains(&handle.len()) || !handle.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
        return Err((StatusCode::NOT_FOUND, "No trader with that handle".into()));
    }
    let v = c
        .acct
        .rest(reqwest::Method::POST, "rpc/trader_trades", Some(json!({ "p_handle": handle.to_lowercase(), "p_after": q.after.unwrap_or(0), "p_limit": 50 })))
        .await?;
    let items: Vec<Value> = v.as_array().map(|r| r.iter().map(trade_view).collect()).unwrap_or_default();
    Ok(Json(json!({ "items": items })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles() {
        assert!(valid_handle("moon_boy7"));
        assert!(!valid_handle("ab"));
        assert!(!valid_handle("Has-Caps"));
        assert!(!valid_handle("kixo_team"));
        assert!(!valid_handle("realadmin"));
        assert!(!valid_handle("a_very_long_handle_over_twenty"));
    }
}

#[cfg(test)]
mod auto_handle_tests {
    use super::*;

    #[test]
    fn every_generated_handle_is_valid() {
        for a in ADJ {
            for n in NOUN {
                for num in [1000, 9999] {
                    let h = format!("{a}_{n}_{num}");
                    assert!(valid_handle(&h), "{h}");
                }
            }
        }
    }
}
