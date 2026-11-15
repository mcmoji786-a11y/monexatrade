//! Alerts that reach a user when Kixo is closed (migration 0015): Email, Telegram and
//! Discord.
//!
//! What is watched, per user:
//! - market-cap alerts (fire once, then they are removed),
//! - Wallet Monitor wallets (buys of at least N SOL, and sells if asked),
//! - starred coins whose dev starts selling.
//!
//! The rules live in `user_alerts`, saved by the browser through `PUT /alerts/me`. The
//! gateway keeps them in memory (reloaded every 30 s), reads every decoded trade and the
//! live market caps, and sends a short message to each channel the user turned on.
//!
//! Channels:
//! - Telegram: Kixo's bot (`TELEGRAM_BOT_TOKEN`). The user opens a one-time link, presses
//!   Start, and the bot saves that chat. `/stop` in the chat turns it off.
//! - Discord: the user's own channel webhook.
//! - Email: Resend (`RESEND_API_KEY`, sender `ALERTS_EMAIL_FROM`) to the account email.
//!
//! Limits: 30 messages per user per hour (10 of them email), so a busy wallet cannot
//! flood anyone or use up the free email quota. The admin switch "alert_delivery" stops
//! it all.

use crate::{account::AccountState, AppState};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::broadcast;

type ApiErr = (StatusCode, String);

#[derive(Clone)]
pub struct AlertsCtx {
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub state: Arc<AppState>,
    pub http: reqwest::Client,
}

const MAX_PRICE: usize = 100;
const MAX_WALLETS: usize = 50;
const MAX_WATCH: usize = 200;
const PER_HOUR: usize = 30;
const EMAIL_PER_HOUR: usize = 10;
const LINK_TTL: Duration = Duration::from_secs(15 * 60);
const DEV_REPEAT: Duration = Duration::from_secs(30 * 60);
const RELOAD_EVERY: Duration = Duration::from_secs(30);
/// Market caps fetched from Jupiter for coins outside the live board stay this fresh.
const OUTSIDE_PRICE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PriceRule {
    pub id: String,
    pub mint: String,
    #[serde(default)]
    pub symbol: String,
    pub above: bool,
    pub mc_usd: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WalletRule {
    pub address: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub min_buy_sol: f64,
    #[serde(default)]
    pub sells: bool,
}

#[derive(Clone, Debug, Default)]
struct Row {
    user: String,
    email: Option<String>,
    email_on: bool,
    telegram: Option<i64>,
    discord: String,
    price: Vec<PriceRule>,
    wallets: Vec<WalletRule>,
    watch: Vec<String>,
    dev_sells: bool,
}

impl Row {
    fn from(v: &Value) -> Option<Row> {
        Some(Row {
            user: v["user_id"].as_str()?.to_string(),
            email: v["email"].as_str().map(String::from),
            email_on: v["email_on"].as_bool().unwrap_or(false),
            telegram: v["telegram_chat_id"].as_i64(),
            discord: v["discord_webhook"].as_str().unwrap_or("").to_string(),
            price: serde_json::from_value(v["price"].clone()).unwrap_or_default(),
            wallets: serde_json::from_value(v["wallets"].clone()).unwrap_or_default(),
            watch: serde_json::from_value(v["watch"].clone()).unwrap_or_default(),
            dev_sells: v["dev_sells"].as_bool().unwrap_or(true),
        })
    }

    /// Whether any channel can reach this user right now.
    fn reachable(&self) -> bool {
        (self.telegram.is_some() && telegram_token().is_some()) || valid_webhook(&self.discord) || (self.email_on && self.email.is_some() && email_ready())
    }
}

#[derive(Default)]
struct Mem {
    rows: HashMap<String, Row>,
    by_wallet: HashMap<String, Vec<(String, WalletRule)>>,
    by_watch: HashMap<String, Vec<String>>,
    /// Price alerts already sent, until the saved list drops them.
    fired: HashSet<String>,
    sent: HashMap<String, VecDeque<Instant>>,
    emails: HashMap<String, VecDeque<Instant>>,
    /// Telegram link codes: code -> (user, made at).
    links: HashMap<String, (String, Instant)>,
    dev_seen: HashMap<(String, String), Instant>,
    outside: HashMap<String, (f64, Instant)>,
    bot: Option<String>,
    tests: HashMap<String, Instant>,
}

fn mem() -> &'static Mutex<Mem> {
    static M: OnceLock<Mutex<Mem>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(Mem::default()))
}

impl Mem {
    fn reindex(&mut self) {
        self.by_wallet.clear();
        self.by_watch.clear();
        for r in self.rows.values() {
            for w in &r.wallets {
                self.by_wallet.entry(w.address.clone()).or_default().push((r.user.clone(), w.clone()));
            }
            if r.dev_sells {
                for m in &r.watch {
                    self.by_watch.entry(m.clone()).or_default().push(r.user.clone());
                }
            }
        }
        let live: HashSet<&String> = self.rows.values().flat_map(|r| r.price.iter().map(|p| &p.id)).collect();
        self.fired.retain(|id| live.contains(id));
    }

    fn put(&mut self, row: Row) {
        if row.reachable() {
            self.rows.insert(row.user.clone(), row);
        } else {
            self.rows.remove(&row.user);
        }
        self.reindex();
    }

    /// Room for one more message (and whether email may go too) in this user's hour.
    fn allow(&mut self, user: &str) -> (bool, bool) {
        let hour = Duration::from_secs(3600);
        let sent = self.sent.entry(user.to_string()).or_default();
        while sent.front().is_some_and(|t| t.elapsed() > hour) {
            sent.pop_front();
        }
        if sent.len() >= PER_HOUR {
            return (false, false);
        }
        sent.push_back(Instant::now());
        let emails = self.emails.entry(user.to_string()).or_default();
        while emails.front().is_some_and(|t| t.elapsed() > hour) {
            emails.pop_front();
        }
        let email = emails.len() < EMAIL_PER_HOUR;
        if email {
            emails.push_back(Instant::now());
        }
        (true, email)
    }
}

fn telegram_token() -> Option<String> {
    monexa_common::secret("TELEGRAM_BOT_TOKEN")
}

fn email_ready() -> bool {
    monexa_common::secret("RESEND_API_KEY").is_some()
}

fn site() -> String {
    std::env::var("SITE_URL").ok().map(|s| s.trim().trim_end_matches('/').to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "http://localhost:3000".into())
}

pub fn valid_webhook(u: &str) -> bool {
    let Some(rest) = u.strip_prefix("https://discord.com/api/webhooks/").or_else(|| u.strip_prefix("https://discordapp.com/api/webhooks/")) else { return false };
    let mut parts = rest.split('/');
    let (Some(id), Some(token), None) = (parts.next(), parts.next(), parts.next()) else { return false };
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) && (20..=100).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(max).collect()
}

fn short(a: &str) -> String {
    if a.len() > 10 {
        format!("{}…{}", &a[..4], &a[a.len() - 4..])
    } else {
        a.to_string()
    }
}

fn usd(v: f64) -> String {
    if v >= 1e9 {
        format!("${:.2}B", v / 1e9)
    } else if v >= 1e6 {
        format!("${:.2}M", v / 1e6)
    } else if v >= 1e3 {
        format!("${:.1}K", v / 1e3)
    } else {
        format!("${v:.0}")
    }
}

fn on(c: &AlertsCtx) -> Result<(), ApiErr> {
    if c.admin.alert_delivery() {
        Ok(())
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, "Alerts outside Kixo are switched off right now".into()))
    }
}

/* ---------------- Sending ---------------- */

/// One message to every channel this user has; what each channel answered.
async fn send(c: &AlertsCtx, row: &Row, title: &str, body: &str, link: Option<String>, email_ok: bool) -> Value {
    let link_line = link.clone().map(|l| format!("\n{l}")).unwrap_or_default();
    let mut out = json!({});
    if let (Some(chat), Some(tok)) = (row.telegram, telegram_token()) {
        let text = format!("{title}\n{body}{link_line}");
        let r = c.http.post(format!("https://api.telegram.org/bot{tok}/sendMessage")).json(&json!({ "chat_id": chat, "text": text, "disable_web_page_preview": true })).timeout(Duration::from_secs(10)).send().await;
        let ok = r.as_ref().is_ok_and(|r| r.status().is_success());
        if !ok {
            tracing::warn!(status = ?r.as_ref().map(|r| r.status()).ok(), "telegram alert not sent");
        }
        out["telegram"] = json!(ok);
    }
    if valid_webhook(&row.discord) {
        let text = format!("**{title}**\n{body}{link_line}");
        let r = c.http.post(&row.discord).json(&json!({ "username": "Kixo", "content": text, "allowed_mentions": { "parse": [] } })).timeout(Duration::from_secs(10)).send().await;
        out["discord"] = json!(r.is_ok_and(|r| r.status().is_success()));
    }
    if row.email_on && email_ok {
        if let (Some(to), Some(key)) = (row.email.as_deref(), monexa_common::secret("RESEND_API_KEY")) {
            let from = monexa_common::secret("ALERTS_EMAIL_FROM").unwrap_or_else(|| "Kixo <onboarding@resend.dev>".into());
            let text = format!("{body}{link_line}\n\nYou get this because email alerts are on in Kixo (Settings, Notifications).");
            let r = c.http.post("https://api.resend.com/emails").bearer_auth(key).json(&json!({ "from": from, "to": [to], "subject": title, "text": text })).timeout(Duration::from_secs(10)).send().await;
            let ok = r.as_ref().is_ok_and(|r| r.status().is_success());
            if !ok {
                tracing::warn!(status = ?r.as_ref().map(|r| r.status()).ok(), "email alert not sent");
            }
            out["email"] = json!(ok);
        }
    }
    out
}

/// An alert, within the user's hourly limit, sent in the background.
fn alert(c: &AlertsCtx, row: Row, title: String, body: String, link: Option<String>) {
    let (ok, email_ok) = mem().lock().expect("alerts lock").allow(&row.user);
    if !ok {
        return;
    }
    let c = c.clone();
    tokio::spawn(async move {
        send(&c, &row, &title, &body, link, email_ok).await;
    });
}

fn symbol_of(state: &AppState, mint: &str) -> String {
    let b = state.board.lock().expect("board lock");
    b.tokens.get(mint).map(|t| t.token.symbol.clone()).or_else(|| b.markets.get(mint).map(|m| m.symbol)).filter(|s| !s.is_empty()).unwrap_or_else(|| short(mint))
}

/// The live market cap in USD: our own engine first, then the market board.
fn mc_of(state: &AppState, mint: &str) -> Option<f64> {
    let b = state.board.lock().expect("board lock");
    b.tokens.get(mint).and_then(|t| t.market.as_ref()).filter(|m| m.sol_quoted).and_then(|m| m.mc_usd).or_else(|| b.markets.get(mint).and_then(|m| m.mc_usd))
}

/* ---------------- Watching ---------------- */

/// Starts the loops: rules reload, trades, prices and the Telegram bot.
pub fn spawn(c: AlertsCtx) {
    tokio::spawn(reload_loop(c.clone()));
    tokio::spawn(trades_loop(c.clone()));
    tokio::spawn(prices_loop(c.clone()));
    tokio::spawn(telegram_loop(c));
}

async fn load(c: &AlertsCtx) -> bool {
    let Ok(v) = c.acct.rest(reqwest::Method::GET, "user_alerts?select=*&limit=20000", None).await else { return false };
    let rows: HashMap<String, Row> = v.as_array().into_iter().flatten().filter_map(Row::from).filter(Row::reachable).map(|r| (r.user.clone(), r)).collect();
    let mut m = mem().lock().expect("alerts lock");
    m.rows = rows;
    m.reindex();
    true
}

async fn reload_loop(c: AlertsCtx) {
    let mut warned = false;
    loop {
        if c.admin.alert_delivery() && !load(&c).await && !warned {
            tracing::info!("alerts: user_alerts not readable yet (run migration 0015)");
            warned = true;
        }
        tokio::time::sleep(RELOAD_EVERY).await;
    }
}

async fn trades_loop(c: AlertsCtx) {
    let mut rx = c.state.trades.subscribe();
    loop {
        match rx.recv().await {
            Ok((mint, t)) => {
                if c.admin.alert_delivery() {
                    on_trade(&c, &mint, &t);
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

fn on_trade(c: &AlertsCtx, mint: &str, t: &crate::book::TradeRow) {
    let mut hits: Vec<(Row, String, String)> = Vec::new();
    {
        let mut m = mem().lock().expect("alerts lock");
        if let Some(list) = m.by_wallet.get(&t.wallet) {
            for (user, w) in list {
                let wanted = if t.is_buy { t.sol >= w.min_buy_sol } else { w.sells };
                if wanted {
                    if let Some(r) = m.rows.get(user) {
                        let who = if w.label.is_empty() { short(&w.address) } else { w.label.clone() };
                        hits.push((r.clone(), who, String::new()));
                    }
                }
            }
        }
        if t.dev && !t.is_buy {
            let users = m.by_watch.get(mint).cloned().unwrap_or_default();
            for user in users {
                let key = (user.clone(), mint.to_string());
                if m.dev_seen.get(&key).is_some_and(|at| at.elapsed() < DEV_REPEAT) {
                    continue;
                }
                m.dev_seen.insert(key, Instant::now());
                if let Some(r) = m.rows.get(&user) {
                    hits.push((r.clone(), String::new(), "dev".into()));
                }
            }
            if m.dev_seen.len() > 20_000 {
                m.dev_seen.retain(|_, at| at.elapsed() < DEV_REPEAT);
            }
        }
    }
    if hits.is_empty() {
        return;
    }
    let sym = symbol_of(&c.state, mint);
    let sol_usd = c.state.board.lock().expect("board lock").sol_usd;
    let link = Some(format!("{}/token/{mint}", site()));
    let worth = sol_usd.map(|p| format!(" (about {})", usd(t.sol * p))).unwrap_or_default();
    for (row, who, kind) in hits {
        let (title, body) = if kind == "dev" {
            (format!("Dev is selling {sym}"), format!("The creator of {sym}, a coin you starred, just sold {:.2} SOL{worth}", t.sol))
        } else if t.is_buy {
            (format!("{who} bought {sym}"), format!("{who} bought {sym} for {:.2} SOL{worth}", t.sol))
        } else {
            (format!("{who} sold {sym}"), format!("{who} sold {sym} for {:.2} SOL{worth}", t.sol))
        };
        alert(c, row, title, body, link.clone());
    }
}

async fn prices_loop(c: AlertsCtx) {
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        if !c.admin.alert_delivery() {
            continue;
        }
        let rules: Vec<(String, PriceRule)> = {
            let m = mem().lock().expect("alerts lock");
            m.rows.values().flat_map(|r| r.price.iter().filter(|p| !m.fired.contains(&p.id)).map(|p| (r.user.clone(), p.clone()))).collect()
        };
        if rules.is_empty() {
            continue;
        }
        // Coins outside the live board: ask Jupiter, at most once a minute each.
        let missing: Vec<String> = {
            let m = mem().lock().expect("alerts lock");
            let mut seen = HashSet::new();
            rules
                .iter()
                .map(|(_, p)| p.mint.clone())
                .filter(|mint| seen.insert(mint.clone()) && mc_of(&c.state, mint).is_none() && m.outside.get(mint).is_none_or(|(_, at)| at.elapsed() > OUTSIDE_PRICE_TTL))
                .take(20)
                .collect()
        };
        if !missing.is_empty() {
            if let crate::jupiter::PollResult::Ok(list) = crate::jupiter::fetch_mints(&c.http, &missing).await {
                let mut m = mem().lock().expect("alerts lock");
                for t in list {
                    if let Some(mc) = t.mc_usd {
                        m.outside.insert(t.mint.clone(), (mc, Instant::now()));
                    }
                }
                m.outside.retain(|_, (_, at)| at.elapsed() < OUTSIDE_PRICE_TTL * 10);
            }
        }
        for (user, p) in rules {
            let mc = mc_of(&c.state, &p.mint).or_else(|| mem().lock().expect("alerts lock").outside.get(&p.mint).filter(|(_, at)| at.elapsed() < OUTSIDE_PRICE_TTL * 2).map(|(v, _)| *v));
            let Some(mc) = mc else { continue };
            if !(if p.above { mc >= p.mc_usd } else { mc <= p.mc_usd }) {
                continue;
            }
            let row = {
                let mut m = mem().lock().expect("alerts lock");
                m.fired.insert(p.id.clone());
                let Some(r) = m.rows.get_mut(&user) else { continue };
                r.price.retain(|x| x.id != p.id);
                r.clone()
            };
            let sym = if p.symbol.is_empty() { symbol_of(&c.state, &p.mint) } else { p.symbol.clone() };
            let title = format!("{sym} market cap {} {}", if p.above { "above" } else { "below" }, usd(p.mc_usd));
            let body = format!("{sym} is at {} market cap now. This alert is done and removed", usd(mc));
            alert(&c, row.clone(), title, body, Some(format!("{}/token/{}", site(), p.mint)));
            let _ = c.acct.rest(reqwest::Method::PATCH, &format!("user_alerts?user_id=eq.{user}"), Some(json!({ "price": row.price }))).await;
        }
    }
}

/* ---------------- Telegram bot ---------------- */

async fn telegram_loop(c: AlertsCtx) {
    let mut offset: i64 = 0;
    let mut named_for: Option<String> = None;
    loop {
        let Some(tok) = telegram_token().filter(|_| c.admin.alert_delivery()) else {
            tokio::time::sleep(Duration::from_secs(30)).await;
            continue;
        };
        let api = format!("https://api.telegram.org/bot{tok}");
        if named_for.as_deref() != Some(tok.as_str()) {
            let name = match c.http.get(format!("{api}/getMe")).timeout(Duration::from_secs(10)).send().await {
                Ok(r) => r.json::<Value>().await.ok().and_then(|v| v["result"]["username"].as_str().map(String::from)),
                Err(_) => None,
            };
            if name.is_none() {
                tracing::warn!("telegram: the bot token was not accepted");
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }
            mem().lock().expect("alerts lock").bot = name;
            named_for = Some(tok.clone());
        }
        let res = c.http.post(format!("{api}/getUpdates")).json(&json!({ "offset": offset, "timeout": 25, "allowed_updates": ["message"] })).timeout(Duration::from_secs(35)).send().await;
        let Ok(v) = (match res {
            Ok(r) => r.json::<Value>().await,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        }) else {
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        };
        for u in v["result"].as_array().into_iter().flatten() {
            offset = offset.max(u["update_id"].as_i64().unwrap_or(0) + 1);
            let msg = &u["message"];
            if msg["chat"]["type"].as_str() != Some("private") {
                continue;
            }
            let (Some(chat), Some(text)) = (msg["chat"]["id"].as_i64(), msg["text"].as_str()) else { continue };
            let reply = bot_command(&c, chat, text.trim()).await;
            let _ = c.http.post(format!("{api}/sendMessage")).json(&json!({ "chat_id": chat, "text": reply })).timeout(Duration::from_secs(10)).send().await;
        }
    }
}

async fn bot_command(c: &AlertsCtx, chat: i64, text: &str) -> String {
    if let Some(code) = text.strip_prefix("/start ").map(str::trim) {
        let user = {
            let mut m = mem().lock().expect("alerts lock");
            m.links.retain(|_, (_, at)| at.elapsed() < LINK_TTL);
            m.links.remove(code).map(|(u, _)| u)
        };
        let Some(user) = user else {
            return "This link has expired. Open Kixo, go to Settings, Notifications, and press Connect Telegram again.".into();
        };
        let saved = c.acct.rest(reqwest::Method::POST, "user_alerts?on_conflict=user_id", Some(json!({ "user_id": user, "telegram_chat_id": chat }))).await;
        return match saved {
            Ok(v) => {
                if let Some(row) = v.as_array().and_then(|a| a.first()).and_then(Row::from) {
                    mem().lock().expect("alerts lock").put(row);
                }
                "Kixo alerts are on for this chat. You will get your price alerts, Wallet Monitor trades and dev sells on starred coins here, even when Kixo is closed. Send /stop to turn them off.".into()
            }
            Err(_) => "Kixo could not save this right now. Please try again in a minute.".into(),
        };
    }
    if text == "/stop" {
        let v = c.acct.rest(reqwest::Method::PATCH, &format!("user_alerts?telegram_chat_id=eq.{chat}"), Some(json!({ "telegram_chat_id": null }))).await;
        if let Ok(v) = v {
            let mut m = mem().lock().expect("alerts lock");
            for row in v.as_array().into_iter().flatten().filter_map(Row::from) {
                m.put(row);
            }
        }
        return "Kixo alerts are off for this chat. Connect again any time from Kixo, Settings, Notifications.".into();
    }
    "This is Kixo's alert bot. To connect it, open Kixo, go to Settings, Notifications, and press Connect Telegram.".into()
}

/* ---------------- Routes ---------------- */

/// `GET /alerts/status`: which channels this gateway can send on.
pub async fn status(State(c): State<AlertsCtx>) -> Json<Value> {
    let bot = mem().lock().expect("alerts lock").bot.clone();
    Json(json!({
        "server_delivery": c.admin.alert_delivery(),
        "telegram": telegram_token().is_some() && bot.is_some(),
        "telegram_bot": bot,
        "email": email_ready(),
        "discord": true,
    }))
}

async fn row_of(c: &AlertsCtx, user: &str) -> Result<Option<Value>, ApiErr> {
    let v = c.acct.rest(reqwest::Method::GET, &format!("user_alerts?user_id=eq.{user}&select=*"), None).await?;
    Ok(v.as_array().and_then(|a| a.first()).cloned())
}

fn view(row: Option<&Value>, email: Option<&str>) -> Value {
    let r = row.cloned().unwrap_or(Value::Null);
    json!({
        "saved": row.is_some(),
        "account_email": email,
        "email_on": r["email_on"].as_bool().unwrap_or(false),
        "telegram": r["telegram_chat_id"].is_i64(),
        "discord_webhook": r["discord_webhook"].as_str().unwrap_or(""),
        "price": if r["price"].is_array() { r["price"].clone() } else { json!([]) },
        "wallets": if r["wallets"].is_array() { r["wallets"].clone() } else { json!([]) },
        "watch": if r["watch"].is_array() { r["watch"].clone() } else { json!([]) },
        "dev_sells": r["dev_sells"].as_bool().unwrap_or(true),
    })
}

/// `GET /alerts/me`: the caller's channels and rules.
pub async fn me(State(c): State<AlertsCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let row = row_of(&c, &u.id).await?;
    Ok(Json(view(row.as_ref(), u.email.as_deref())))
}

#[derive(Deserialize)]
pub struct AlertsIn {
    email_on: bool,
    #[serde(default)]
    discord_webhook: String,
    #[serde(default)]
    price: Vec<PriceRule>,
    #[serde(default)]
    wallets: Vec<WalletRule>,
    #[serde(default)]
    watch: Vec<String>,
    #[serde(default = "yes")]
    dev_sells: bool,
}

fn yes() -> bool {
    true
}

/// `PUT /alerts/me`: saves the caller's channels and rules (the whole set).
pub async fn save(State(c): State<AlertsCtx>, headers: HeaderMap, Json(i): Json<AlertsIn>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let hook = i.discord_webhook.trim().to_string();
    if !hook.is_empty() && !valid_webhook(&hook) {
        return Err((StatusCode::BAD_REQUEST, "That is not a Discord webhook link".into()));
    }
    if i.email_on && u.email.is_none() {
        return Err((StatusCode::BAD_REQUEST, "Your account has no email address".into()));
    }
    let mut seen = HashSet::new();
    let price: Vec<PriceRule> = i
        .price
        .into_iter()
        .filter(|p| crate::is_mint(&p.mint) && p.mc_usd.is_finite() && p.mc_usd > 0.0 && seen.insert(p.id.clone()))
        .take(MAX_PRICE)
        .map(|p| PriceRule { id: clean(&p.id, 120), mint: p.mint, symbol: clean(&p.symbol, 20), above: p.above, mc_usd: p.mc_usd })
        .collect();
    let mut seen = HashSet::new();
    let wallets: Vec<WalletRule> = i
        .wallets
        .into_iter()
        .filter(|w| crate::is_mint(&w.address) && seen.insert(w.address.clone()))
        .take(MAX_WALLETS)
        .map(|w| WalletRule { label: clean(&w.label, 40), min_buy_sol: if w.min_buy_sol.is_finite() { w.min_buy_sol.clamp(0.0, 100_000.0) } else { 1.0 }, ..w })
        .collect();
    let mut seen = HashSet::new();
    let watch: Vec<String> = i.watch.into_iter().filter(|m| crate::is_mint(m) && seen.insert(m.clone())).take(MAX_WATCH).collect();
    let body = json!({
        "user_id": u.id,
        "email": u.email,
        "email_on": i.email_on,
        "discord_webhook": hook,
        "price": price,
        "wallets": wallets,
        "watch": watch,
        "dev_sells": i.dev_sells,
    });
    let v = c.acct.rest(reqwest::Method::POST, "user_alerts?on_conflict=user_id", Some(body)).await?;
    let saved = v.as_array().and_then(|a| a.first()).cloned();
    if let Some(row) = saved.as_ref().and_then(Row::from) {
        mem().lock().expect("alerts lock").put(row);
    }
    Ok(Json(view(saved.as_ref(), u.email.as_deref())))
}

/// `POST /alerts/telegram/link`: a one-time link to Kixo's bot that connects this chat.
pub async fn telegram_link(State(c): State<AlertsCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let Some(bot) = mem().lock().expect("alerts lock").bot.clone().filter(|_| telegram_token().is_some()) else {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Kixo's Telegram bot is not set up yet".into()));
    };
    let mut raw = [0u8; 16];
    SystemRandom::new().fill(&mut raw).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "try again".into()))?;
    let code: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    {
        let mut m = mem().lock().expect("alerts lock");
        m.links.retain(|_, (owner, at)| at.elapsed() < LINK_TTL && owner != &u.id);
        m.links.insert(code.clone(), (u.id, Instant::now()));
    }
    Ok(Json(json!({ "url": format!("https://t.me/{bot}?start={code}") })))
}

/// `POST /alerts/telegram/unlink`: stops Telegram alerts for the caller.
pub async fn telegram_unlink(State(c): State<AlertsCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let v = c.acct.rest(reqwest::Method::PATCH, &format!("user_alerts?user_id=eq.{}", u.id), Some(json!({ "telegram_chat_id": null }))).await?;
    if let Some(row) = v.as_array().and_then(|a| a.first()).and_then(Row::from) {
        mem().lock().expect("alerts lock").put(row);
    }
    Ok(Json(json!({ "ok": true })))
}

/// `POST /alerts/test`: a test message to each channel the caller has, once a minute.
pub async fn test(State(c): State<AlertsCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    {
        let mut m = mem().lock().expect("alerts lock");
        if m.tests.get(&u.id).is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
            return Err((StatusCode::TOO_MANY_REQUESTS, "One test a minute. Try again shortly".into()));
        }
        m.tests.insert(u.id.clone(), Instant::now());
    }
    let row = row_of(&c, &u.id).await?.as_ref().and_then(Row::from).ok_or((StatusCode::BAD_REQUEST, "Turn on a channel first".into()))?;
    let email_ok = mem().lock().expect("alerts lock").allow(&u.id).1;
    let out = send(&c, &row, "Kixo test alert", "Alerts reach you here, even when Kixo is closed", Some(site()), email_ok).await;
    Ok(Json(json!({ "sent": out })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhooks() {
        assert!(valid_webhook("https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz_-0123"));
        assert!(!valid_webhook("https://evil.com/api/webhooks/123/abcdefghijklmnopqrstuvwxyz"));
        assert!(!valid_webhook("https://discord.com/api/webhooks/abc/abcdefghijklmnopqrstuvwxyz"));
        assert!(!valid_webhook("https://discord.com/api/webhooks/123/abcdefghijklmnopqrstuvwxyz/extra"));
        assert!(!valid_webhook("http://discord.com/api/webhooks/123/abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn hourly_limit() {
        let mut m = Mem::default();
        for _ in 0..EMAIL_PER_HOUR {
            assert_eq!(m.allow("u"), (true, true));
        }
        assert_eq!(m.allow("u"), (true, false));
        for _ in EMAIL_PER_HOUR + 1..PER_HOUR {
            assert!(m.allow("u").0);
        }
        assert_eq!(m.allow("u"), (false, false));
        assert!(m.allow("other").0);
    }
}
