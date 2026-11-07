//! Customer support: the Transaction Doctor, tickets and the admin inbox.
//!
//! The Transaction Doctor reads any Solana transaction and explains in plain words what
//! happened: whether it landed, what the wallet paid and received, and, if it failed,
//! why and what to do (the same diagnosis the trading engine uses). Tickets are stored
//! in `support_tickets` / `support_messages` (migration 0007). Users only ever see
//! their own tickets and never internal notes.
//!
//! Live chat is a ticket with `channel = live`. One WebSocket per open page carries the
//! real-time events (new message, typing, seen, status, team online). Events only say
//! *what* changed; the page then reads the thread through the normal endpoints, so the
//! socket never carries message text and the same access rules apply.
//! The team counts as online while the switch in the admin is on and an agent's inbox
//! has sent a heartbeat recently (the inbox only beats while the agent is active).

use crate::account::AccountState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct SupportCtx {
    pub app: Arc<crate::AppState>,
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub live: Arc<Live>,
}

/* ---------------- Live events and presence ---------------- */

/// Who an event is for.
#[derive(Clone, Debug, PartialEq)]
enum To {
    /// One user (all of their open pages).
    User(String),
    /// The support team.
    Team,
    /// A user and the team.
    Both(String),
    /// Everyone connected.
    All,
}

#[derive(Clone, Debug)]
pub struct Event {
    to: To,
    body: String,
}

#[derive(Default)]
struct Presence {
    /// The Online switch in the admin inbox.
    switch: bool,
    /// Last heartbeat from an active agent.
    beat: Option<Instant>,
    /// What we last told everyone.
    announced: bool,
}

/// A heartbeat keeps the team online this long. The inbox beats every 30 s, and only
/// while the agent used it in the last 10 minutes, so an idle agent goes offline.
const BEAT_TTL: Duration = Duration::from_secs(90);

pub struct Live {
    tx: broadcast::Sender<Event>,
    presence: Mutex<Presence>,
}

impl Live {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(512);
        Arc::new(Self { tx, presence: Mutex::new(Presence::default()) })
    }

    fn send(&self, to: To, body: Value) {
        let _ = self.tx.send(Event { to, body: body.to_string() });
    }

    fn agents_active(p: &Presence) -> bool {
        p.switch && p.beat.is_some_and(|b| b.elapsed() < BEAT_TTL)
    }

    /// Tell everyone when the team goes online or offline.
    fn announce(&self, enabled: bool) {
        let mut p = self.presence.lock().expect("presence lock");
        let on = enabled && Self::agents_active(&p);
        if p.announced != on {
            p.announced = on;
            drop(p);
            self.send(To::All, json!({ "type": "presence", "online": on }));
        }
    }

    fn beat(&self) {
        self.presence.lock().expect("presence lock").beat = Some(Instant::now());
    }
}

impl SupportCtx {
    fn online(&self) -> bool {
        self.admin.live_chat() && Live::agents_active(&self.live.presence.lock().expect("presence lock"))
    }
}

/// Re-checks presence so an idle team goes offline without anyone acting.
pub async fn presence_loop(c: SupportCtx) {
    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;
        c.live.announce(c.admin.live_chat());
    }
}

/* ---------------- Secrets never leave the browser in a message ---------------- */

static BIP39: OnceLock<std::collections::HashSet<&'static str>> = OnceLock::new();

/// A Solana keypair as 64 bytes: the last 32 are the public key of the first 32.
fn is_keypair(b: &[u8]) -> bool {
    if b.len() != 64 {
        return false;
    }
    let seed: [u8; 32] = b[..32].try_into().expect("32 bytes");
    ed25519_dalek::SigningKey::from_bytes(&seed).verifying_key().to_bytes() == b[32..]
}

/// Whether a message contains a recovery phrase or a private key. Support never needs
/// either, and anyone who asks for one is a scammer, so such a message is not stored.
fn contains_secret(text: &str) -> bool {
    let words = BIP39.get_or_init(|| include_str!("bip39_english.txt").lines().map(str::trim).filter(|w| !w.is_empty()).collect());
    // 12 or more recovery words in a row (any separators, numbering allowed).
    let mut run = 0;
    for w in text.split(|c: char| !c.is_ascii_alphabetic()).filter(|w| !w.is_empty()) {
        if words.contains(w.to_ascii_lowercase().as_str()) {
            run += 1;
            if run >= 12 {
                return true;
            }
        } else {
            run = 0;
        }
    }
    // A base58 private key (a signature has the same length but is not a keypair).
    if text.split(|c: char| !c.is_ascii_alphanumeric()).any(|t| (80..=90).contains(&t.len()) && bs58::decode(t).into_vec().is_ok_and(|b| is_keypair(&b))) {
        return true;
    }
    // A keypair file: a list of 64 numbers.
    let nums: Vec<u8> = text.split(|c: char| !c.is_ascii_digit()).filter(|t| !t.is_empty()).filter_map(|t| t.parse::<u8>().ok()).collect();
    nums.len() >= 64 && nums.windows(64).any(is_keypair)
}

const SECRET_REFUSED: &str = "This looks like a recovery phrase or private key, so it was not sent. Never share it with anyone, Kixo support included. If you already shared it, move your funds to a new wallet now";


type ApiErr = (StatusCode, String);

const CATEGORIES: [&str; 5] = ["trade", "wallet", "account", "bug", "other"];
const STATUSES: [&str; 4] = ["open", "in_progress", "waiting", "resolved"];
const PRIORITIES: [&str; 4] = ["low", "normal", "high", "urgent"];
/// Open tickets one user may have at once.
const MAX_OPEN: usize = 5;

fn now_iso() -> String {
    crate::account::chrono_iso(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64))
}

fn is_signature(s: &str) -> bool {
    (64..=90).contains(&s.len()) && bs58::decode(s).into_vec().is_ok_and(|b| b.len() == 64)
}

type Limits = Mutex<Option<HashMap<String, Vec<Instant>>>>;

/// At most `n` actions per user per `window`.
fn limited(map: &Limits, user: &str, n: usize, window: Duration) -> bool {
    let mut g = map.lock().expect("limit lock");
    let m = g.get_or_insert_with(HashMap::new);
    if m.len() > 10_000 {
        m.clear();
    }
    let v = m.entry(user.to_string()).or_default();
    v.retain(|t| t.elapsed() < window);
    if v.len() >= n {
        return true;
    }
    v.push(Instant::now());
    false
}

/* ---------------- Transaction Doctor ---------------- */

#[derive(Deserialize)]
pub struct DiagnoseIn {
    signature: String,
}

/// `POST /support/diagnose {signature}`: what happened to a transaction, in plain words.
pub async fn diagnose(State(c): State<SupportCtx>, headers: HeaderMap, Json(i): Json<DiagnoseIn>) -> Result<Json<Value>, ApiErr> {
    static LIMIT: Limits = Mutex::new(None);
    let u = c.acct.user(&headers).await?;
    let sig = i.signature.trim().to_string();
    if !is_signature(&sig) {
        return Err((StatusCode::BAD_REQUEST, "That is not a transaction signature. Copy it from Solscan or your wallet".into()));
    }
    if limited(&LIMIT, &u.id, 12, Duration::from_secs(60)) {
            return Err((StatusCode::TOO_MANY_REQUESTS, "Too many checks, wait a minute".into()));
    }
    // Shared RPC helper: retries the free plan's 429 bursts. An RPC failure must never be
    // read as "no such transaction", or we would tell someone a landed trade is safe to repeat.
    let r = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
    let unreachable = || (StatusCode::SERVICE_UNAVAILABLE, "Could not reach the Solana network just now. Check again in a few seconds".to_string());
    let ours_path = format!("real_trades?signature=eq.{sig}&user_id=eq.{}&select=side,symbol,mint,status,platform_fee_lamports,priority_fee_lamports,tip_lamports,error_code,created_at", u.id);
    let (tx, ours) = tokio::join!(
        crate::trade::rpc(&r, "getTransaction", json!([sig, { "encoding": "jsonParsed", "maxSupportedTransactionVersion": 1, "commitment": "confirmed" }])),
        c.acct.rest(reqwest::Method::GET, &ours_path, None),
    );
    let ours = ours.ok().and_then(|v| v.as_array().and_then(|a| a.first().cloned()));
    let explorer = format!("https://solscan.io/tx/{sig}");

    let tx = tx.map_err(|e| {
        tracing::warn!(%e, "diagnose: getTransaction failed");
        unreachable()
    })?;
    if tx.is_null() {
        // Not in confirmed history: still pending, dropped, or never sent.
        let st = crate::trade::rpc(&r, "getSignatureStatuses", json!([[sig], { "searchTransactionHistory": true }])).await.map_err(|_| unreachable())?;
        let pending = !st["value"][0].is_null();
        return Ok(Json(json!({
            "signature": sig, "explorer": explorer, "ours": ours,
            "status": if pending { "pending" } else { "not_found" },
            "title": if pending { "Still processing" } else { "The network has no record of this transaction" },
            "explain": if pending { "It reached the network but is not confirmed yet. Wait a few seconds and check again" } else { "It never landed, usually because it expired before a validator took it. Nothing was spent, not even the network fee. A transaction sent in the last two minutes can still land, so check again before repeating it" },
            "next": if pending { "Do not send the same trade again until this one settles" } else { "If you sent it more than two minutes ago it has expired and it is safe to try again" },
        })));
    }

    let meta = &tx["meta"];
    let keys: Vec<String> = tx["transaction"]["message"]["accountKeys"].as_array().map(|a| a.iter().filter_map(|k| k["pubkey"].as_str().or(k.as_str()).map(String::from)).collect()).unwrap_or_default();
    let payer = keys.first().cloned().unwrap_or_default();
    let fee = meta["fee"].as_u64().unwrap_or(0);
    let sol_change = match (meta["preBalances"][0].as_i64(), meta["postBalances"][0].as_i64()) {
        (Some(a), Some(b)) => Some(b - a),
        _ => None,
    };
    // Token changes of the fee payer.
    let mut tokens: HashMap<String, (f64, f64, u64)> = HashMap::new();
    for (which, list) in [(0, &meta["preTokenBalances"]), (1, &meta["postTokenBalances"])] {
        for b in list.as_array().cloned().unwrap_or_default() {
            if b["owner"].as_str() != Some(payer.as_str()) {
                continue;
            }
            let mint = b["mint"].as_str().unwrap_or("").to_string();
            let amt = b["uiTokenAmount"]["uiAmount"].as_f64().unwrap_or(0.0);
            let dec = b["uiTokenAmount"]["decimals"].as_u64().unwrap_or(0);
            let e = tokens.entry(mint).or_insert((0.0, 0.0, dec));
            if which == 0 {
                e.0 += amt;
            } else {
                e.1 += amt;
            }
        }
    }
    let token_changes: Vec<Value> = tokens
        .into_iter()
        .filter(|(m, (a, b, _))| (b - a).abs() > 0.0 && m != crate::trade::WSOL)
        .map(|(m, (a, b, _))| json!({ "mint": m, "change": b - a }))
        .collect();
    let when = tx["blockTime"].as_i64();
    let slot = tx["slot"].as_u64();
    let base = json!({ "signature": sig, "explorer": explorer, "ours": ours, "payer": payer, "time": when, "slot": slot, "fee_lamports": fee, "sol_change_lamports": sol_change, "token_changes": token_changes });
    let mut out = base;
    if meta["err"].is_null() {
        out["status"] = json!("confirmed");
        out["title"] = json!("This transaction went through");
        out["explain"] = json!(if token_changes.is_empty() { "It is confirmed on chain. No token balance of the paying wallet changed" } else { "It is confirmed on chain. The changes to the paying wallet are below" });
        out["next"] = json!("If a balance looks wrong in Kixo, refresh the page: wallet balances can take a few seconds to update");
    } else {
        let logs: Vec<String> = meta["logMessages"].as_array().map(|l| l.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
        let (code, message, hint) = crate::trade::diagnose(&meta["err"], &logs);
        out["status"] = json!("failed");
        out["code"] = json!(code);
        out["title"] = json!(message);
        out["explain"] = json!(format!("The trade did not happen and no tokens moved. Only the network fee of {} SOL was spent; failed transactions still pay it, and nobody can refund it", fee as f64 / 1e9));
        out["next"] = json!(hint);
        out["logs"] = json!(logs.iter().rev().take(6).collect::<Vec<_>>());
    }
    Ok(Json(out))
}

/* ---------------- Tickets ---------------- */

#[derive(Deserialize)]
pub struct NewTicket {
    category: String,
    subject: String,
    body: String,
    signature: Option<String>,
    #[serde(default)]
    context: Value,
    /// "ticket" (the form) or "live" (the chat).
    #[serde(default)]
    channel: Option<String>,
}

fn clean_context(v: &Value) -> Value {
    let s = |k: &str, n: usize| v[k].as_str().map(|x| x.chars().take(n).collect::<String>());
    json!({ "page": s("page", 200), "browser": s("browser", 300), "mode": s("mode", 10), "wallet": s("wallet", 44), "screen": s("screen", 20) })
}

/// `POST /support/tickets`: opens a ticket with its first message.
pub async fn create(State(c): State<SupportCtx>, headers: HeaderMap, Json(t): Json<NewTicket>) -> Result<Json<Value>, ApiErr> {
    static LIMIT: Limits = Mutex::new(None);
    let u = c.acct.user(&headers).await?;
    if !CATEGORIES.contains(&t.category.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "choose a topic".into()));
    }
    let live = t.channel.as_deref() == Some("live");
    if live && !c.admin.live_chat() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Live chat is off right now. Open a ticket on the Support page".into()));
    }
    let body = t.body.trim();
    // A chat starts with its first message; its subject is that message, shortened.
    let first_line: String = body.lines().next().unwrap_or("").chars().take(80).collect();
    let subject = if live {
        if first_line.trim().chars().count() >= 3 { first_line.trim().to_string() } else { "Live chat".to_string() }
    } else {
        t.subject.trim().to_string()
    };
    let subject = subject.as_str();
    if subject.chars().count() < 3 || subject.chars().count() > 140 {
        return Err((StatusCode::BAD_REQUEST, "the subject needs 3 to 140 characters".into()));
    }
    let min = if live { 1 } else { 10 };
    if body.chars().count() < min || body.chars().count() > 5_000 {
        return Err((StatusCode::BAD_REQUEST, "describe the problem in 10 to 5000 characters".into()));
    }
    if contains_secret(body) || contains_secret(subject) {
        return Err((StatusCode::BAD_REQUEST, SECRET_REFUSED.into()));
    }
    let signature = t.signature.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if signature.is_some_and(|s| !is_signature(s)) {
        return Err((StatusCode::BAD_REQUEST, "the transaction signature is not valid".into()));
    }
    if limited(&LIMIT, &u.id, 3, Duration::from_secs(600)) {
            return Err((StatusCode::TOO_MANY_REQUESTS, "You opened several tickets just now. Add to an open one instead".into()));
    }
    let open = c.acct.rest(reqwest::Method::GET, &format!("support_tickets?user_id=eq.{}&status=neq.resolved&select=id,channel", u.id), None).await?;
    // One live chat at a time: a second "start" continues the open one.
    if live {
        if let Some(id) = open.as_array().and_then(|a| a.iter().find(|t| t["channel"] == "live")).and_then(|t| t["id"].as_i64()) {
            c.acct.rest(reqwest::Method::POST, "support_messages", Some(json!({ "ticket_id": id, "author": "user", "body": body }))).await?;
            c.acct.rest(reqwest::Method::PATCH, &format!("support_tickets?id=eq.{id}"), Some(json!({ "admin_unread": true, "updated_at": now_iso() }))).await?;
            c.live.send(To::Both(u.id.clone()), json!({ "type": "message", "ticket": id }));
            return Ok(Json(json!({ "id": id })));
        }
    }
    if open.as_array().map_or(0, Vec::len) >= MAX_OPEN {
        return Err((StatusCode::BAD_REQUEST, format!("You have {MAX_OPEN} open tickets. Reply in one of them, or wait for them to be resolved")));
    }
    let row = c
        .acct
        .rest(
            reqwest::Method::POST,
            "support_tickets",
            Some(json!({ "user_id": u.id, "email": u.email, "category": t.category, "subject": subject, "signature": signature, "context": clean_context(&t.context), "channel": if live { "live" } else { "ticket" } })),
        )
        .await?;
    let id = row.as_array().and_then(|a| a.first()).and_then(|r| r["id"].as_i64()).ok_or((StatusCode::BAD_GATEWAY, "could not open the ticket".into()))?;
    c.acct.rest(reqwest::Method::POST, "support_messages", Some(json!({ "ticket_id": id, "author": "user", "body": body }))).await?;
    tracing::info!(id, category = t.category, live, "support ticket opened");
    c.live.send(To::Both(u.id.clone()), json!({ "type": "new", "ticket": id, "live": live }));
    Ok(Json(json!({ "id": id })))
}

const TICKET_FIELDS: &str = "id,category,subject,status,priority,signature,user_unread,admin_unread,channel,agent,created_at,updated_at";

/// `GET /support/tickets`: the user's tickets, newest activity first.
pub async fn list(State(c): State<SupportCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let u = c.acct.user(&headers).await?;
    let v = c.acct.rest(reqwest::Method::GET, &format!("support_tickets?user_id=eq.{}&select={TICKET_FIELDS}&order=updated_at.desc&limit=100", u.id), None).await?;
    Ok(Json(v))
}

/// `GET /support/unread`: replies the user has not read yet (for the badge).
pub async fn unread(State(c): State<SupportCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let u = c.acct.user(&headers).await?;
    let v = c.acct.rest(reqwest::Method::GET, &format!("support_tickets?user_id=eq.{}&user_unread=eq.true&select=id", u.id), None).await.unwrap_or(Value::Null);
    Ok(Json(json!({ "unread": v.as_array().map_or(0, Vec::len) })))
}

async fn owned(c: &SupportCtx, user: &str, id: i64) -> Result<Value, ApiErr> {
    let v = c.acct.rest(reqwest::Method::GET, &format!("support_tickets?id=eq.{id}&user_id=eq.{user}&select={TICKET_FIELDS},context"), None).await?;
    v.as_array().and_then(|a| a.first().cloned()).ok_or((StatusCode::NOT_FOUND, "ticket not found".into()))
}

/// `GET /support/tickets/{id}`: one of the user's tickets with its messages (no
/// internal notes). Opening it marks the replies as read.
pub async fn get_ticket(State(c): State<SupportCtx>, headers: HeaderMap, Path(id): Path<i64>) -> Result<Json<Value>, ApiErr> {
    let u = c.acct.user(&headers).await?;
    let ticket = owned(&c, &u.id, id).await?;
    Ok(Json(thread_for_user(&c, &u.id, ticket, true).await?))
}

async fn thread_for_user(c: &SupportCtx, user: &str, ticket: Value, mark_read: bool) -> Result<Value, ApiErr> {
    let id = ticket["id"].as_i64().unwrap_or(0);
    let messages = c.acct.rest(reqwest::Method::GET, &format!("support_messages?ticket_id=eq.{id}&internal=eq.false&select=id,author,agent,body,created_at&order=created_at.asc"), None).await?;
    if mark_read && ticket["user_unread"].as_bool() == Some(true) {
        let _ = c.acct.rest(reqwest::Method::PATCH, &format!("support_tickets?id=eq.{id}"), Some(json!({ "user_unread": false }))).await;
        c.live.send(To::Both(user.to_string()), json!({ "type": "read", "ticket": id, "by": "user" }));
    }
    Ok(json!({ "ticket": ticket, "messages": messages }))
}

#[derive(Deserialize)]
pub struct LiveQuery {
    /// Read without marking replies as seen (the chat window is closed).
    #[serde(default)]
    peek: bool,
}

/// `GET /support/live?peek=`: whether the team is online, and the user's open live chat
/// with its messages (null when there is none).
pub async fn live_current(State(c): State<SupportCtx>, headers: HeaderMap, Query(q): Query<LiveQuery>) -> Result<Json<Value>, ApiErr> {
    let u = c.acct.user(&headers).await?;
    let v = c.acct.rest(reqwest::Method::GET, &format!("support_tickets?user_id=eq.{}&channel=eq.live&status=neq.resolved&select={TICKET_FIELDS},context&order=updated_at.desc&limit=1", u.id), None).await?;
    let chat = match v.as_array().and_then(|a| a.first().cloned()) {
        Some(t) => thread_for_user(&c, &u.id, t, !q.peek).await?,
        None => Value::Null,
    };
    Ok(Json(json!({ "enabled": c.admin.live_chat(), "online": c.online(), "chat": chat })))
}

/// `GET /support/presence`: whether live chat is on and the team is online (public).
pub async fn presence(State(c): State<SupportCtx>) -> Json<Value> {
    Json(json!({ "enabled": c.admin.live_chat(), "online": c.online() }))
}

#[derive(Deserialize)]
pub struct Reply {
    body: String,
    #[serde(default)]
    internal: bool,
    /// The agent's first name, shown to the user ("Sara from Kixo support").
    #[serde(default)]
    agent: Option<String>,
}

fn agent_name(a: Option<&str>) -> Option<String> {
    let n: String = a?.trim().chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').take(24).collect();
    Some(n.trim().to_string()).filter(|n| !n.is_empty())
}

/// The owner of a ticket from a PATCH result (the database returns the updated row).
fn owner_of(rows: &Value) -> Option<String> {
    rows.as_array()?.first()?["user_id"].as_str().map(String::from)
}

/// `POST /support/tickets/{id}/messages`: the user replies. A reply reopens a resolved
/// ticket.
pub async fn reply(State(c): State<SupportCtx>, headers: HeaderMap, Path(id): Path<i64>, Json(r): Json<Reply>) -> Result<Json<Value>, ApiErr> {
    static LIMIT: Limits = Mutex::new(None);
    let u = c.acct.user(&headers).await?;
    let ticket = owned(&c, &u.id, id).await?;
    let body = r.body.trim();
    if body.is_empty() || body.chars().count() > 5_000 {
        return Err((StatusCode::BAD_REQUEST, "write 1 to 5000 characters".into()));
    }
    if contains_secret(body) {
        return Err((StatusCode::BAD_REQUEST, SECRET_REFUSED.into()));
    }
    // Chat is quicker than tickets, so it gets a larger allowance.
    let per_minute = if ticket["channel"] == "live" { 20 } else { 10 };
    if limited(&LIMIT, &u.id, per_minute, Duration::from_secs(60)) {
            return Err((StatusCode::TOO_MANY_REQUESTS, "Too many messages, wait a minute".into()));
    }
    c.acct.rest(reqwest::Method::POST, "support_messages", Some(json!({ "ticket_id": id, "author": "user", "body": body }))).await?;
    // An agent already on the case keeps it in progress; otherwise it goes back to open.
    let status = match ticket["status"].as_str() {
        Some("in_progress") => "in_progress",
        Some("waiting") if !ticket["agent"].is_null() => "in_progress",
        _ => "open",
    };
    c.acct.rest(reqwest::Method::PATCH, &format!("support_tickets?id=eq.{id}"), Some(json!({ "status": status, "admin_unread": true, "updated_at": now_iso() }))).await?;
    c.live.send(To::Both(u.id.clone()), json!({ "type": "message", "ticket": id }));
    Ok(Json(json!({ "ok": true })))
}

/* ---------------- Admin inbox ---------------- */

fn admin(headers: &HeaderMap) -> Result<(), ApiErr> {
    if crate::admin::is_admin(headers) {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, "admin key required".into()))
    }
}

#[derive(Deserialize)]
pub struct InboxQuery {
    status: Option<String>,
}

/// `GET /admin/support/tickets?status=`: the inbox, unread and newest first.
pub async fn admin_list(State(c): State<SupportCtx>, headers: HeaderMap, Query(q): Query<InboxQuery>) -> Result<Json<Value>, ApiErr> {
    admin(&headers)?;
    let filter = match q.status.as_deref() {
        Some(s) if STATUSES.contains(&s) => format!("&status=eq.{s}"),
        Some("active") | None => "&status=neq.resolved".to_string(),
        _ => String::new(),
    };
    let v = c
        .acct
        .rest(reqwest::Method::GET, &format!("support_tickets?select=id,email,category,subject,status,priority,signature,admin_unread,user_unread,channel,agent,created_at,updated_at{filter}&order=admin_unread.desc,updated_at.desc&limit=200"), None)
        .await?;
    Ok(Json(v))
}

/// `GET /admin/support/tickets/{id}`: a ticket with every message, internal notes too.
pub async fn admin_get(State(c): State<SupportCtx>, headers: HeaderMap, Path(id): Path<i64>) -> Result<Json<Value>, ApiErr> {
    admin(&headers)?;
    let t = c.acct.rest(reqwest::Method::GET, &format!("support_tickets?id=eq.{id}&select=*"), None).await?;
    let ticket = t.as_array().and_then(|a| a.first().cloned()).ok_or((StatusCode::NOT_FOUND, "ticket not found".into()))?;
    let messages = c.acct.rest(reqwest::Method::GET, &format!("support_messages?ticket_id=eq.{id}&select=*&order=created_at.asc"), None).await?;
    if ticket["admin_unread"].as_bool() == Some(true) {
        let _ = c.acct.rest(reqwest::Method::PATCH, &format!("support_tickets?id=eq.{id}"), Some(json!({ "admin_unread": false }))).await;
        if let Some(owner) = ticket["user_id"].as_str() {
            c.live.send(To::Both(owner.to_string()), json!({ "type": "read", "ticket": id, "by": "support" }));
        }
    }
    Ok(Json(json!({ "ticket": ticket, "messages": messages })))
}

/// `POST /admin/support/tickets/{id}/messages {body, internal}`: a reply to the user,
/// or an internal note the user never sees.
pub async fn admin_reply(State(c): State<SupportCtx>, headers: HeaderMap, Path(id): Path<i64>, Json(r): Json<Reply>) -> Result<Json<Value>, ApiErr> {
    admin(&headers)?;
    let body = r.body.trim();
    if body.is_empty() || body.chars().count() > 5_000 {
        return Err((StatusCode::BAD_REQUEST, "write 1 to 5000 characters".into()));
    }
    let agent = agent_name(r.agent.as_deref());
    c.acct.rest(reqwest::Method::POST, "support_messages", Some(json!({ "ticket_id": id, "author": "support", "agent": agent, "body": body, "internal": r.internal }))).await?;
    c.live.beat();
    let mut patch = if r.internal { json!({ "updated_at": now_iso() }) } else { json!({ "user_unread": true, "status": "waiting", "updated_at": now_iso() }) };
    // Replying takes an unclaimed chat.
    let path = if agent.is_some() && !r.internal {
        patch["agent"] = json!(agent);
        format!("support_tickets?id=eq.{id}&agent=is.null")
    } else {
        format!("support_tickets?id=eq.{id}")
    };
    let mut rows = c.acct.rest(reqwest::Method::PATCH, &path, Some(patch.clone())).await?;
    if rows.as_array().is_some_and(Vec::is_empty) {
        patch.as_object_mut().expect("object").remove("agent");
        rows = c.acct.rest(reqwest::Method::PATCH, &format!("support_tickets?id=eq.{id}"), Some(patch)).await?;
    }
    match owner_of(&rows) {
        Some(owner) if !r.internal => c.live.send(To::Both(owner), json!({ "type": "message", "ticket": id })),
        _ => c.live.send(To::Team, json!({ "type": "message", "ticket": id })),
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct Claim {
    agent: String,
    #[serde(default)]
    force: bool,
}

/// `POST /admin/support/tickets/{id}/claim {agent, force?}`: one agent per chat, so two
/// people never answer the same user. Taking over someone else's chat needs `force`.
pub async fn admin_claim(State(c): State<SupportCtx>, headers: HeaderMap, Path(id): Path<i64>, Json(cl): Json<Claim>) -> Result<Json<Value>, ApiErr> {
    admin(&headers)?;
    let agent = agent_name(Some(&cl.agent)).ok_or((StatusCode::BAD_REQUEST, "type your name first".into()))?;
    let t = c.acct.rest(reqwest::Method::GET, &format!("support_tickets?id=eq.{id}&select=agent,status"), None).await?;
    let t = t.as_array().and_then(|a| a.first().cloned()).ok_or((StatusCode::NOT_FOUND, "ticket not found".into()))?;
    if let Some(other) = t["agent"].as_str().filter(|a| *a != agent) {
        if !cl.force {
            return Err((StatusCode::CONFLICT, format!("{other} is already on this one")));
        }
    }
    let mut patch = json!({ "agent": agent });
    if t["status"] == "open" {
        patch["status"] = json!("in_progress");
    }
    let rows = c.acct.rest(reqwest::Method::PATCH, &format!("support_tickets?id=eq.{id}"), Some(patch)).await?;
    c.live.beat();
    match owner_of(&rows) {
        Some(owner) => c.live.send(To::Both(owner), json!({ "type": "status", "ticket": id })),
        None => c.live.send(To::Team, json!({ "type": "status", "ticket": id })),
    }
    Ok(Json(json!({ "ok": true, "agent": agent })))
}

#[derive(Deserialize)]
pub struct PresenceIn {
    online: bool,
}

/// `POST /admin/support/presence {online}`: the team's Online switch.
pub async fn admin_set_presence(State(c): State<SupportCtx>, headers: HeaderMap, Json(p): Json<PresenceIn>) -> Result<Json<Value>, ApiErr> {
    admin(&headers)?;
    {
        let mut g = c.live.presence.lock().expect("presence lock");
        g.switch = p.online;
        g.beat = p.online.then(Instant::now);
    }
    c.live.announce(c.admin.live_chat());
    Ok(Json(team_presence(&c)))
}

/// `GET /admin/support/presence`.
pub async fn admin_presence(State(c): State<SupportCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    admin(&headers)?;
    Ok(Json(team_presence(&c)))
}

fn team_presence(c: &SupportCtx) -> Value {
    let switch = c.live.presence.lock().expect("presence lock").switch;
    json!({ "switch": switch, "online": c.online(), "enabled": c.admin.live_chat() })
}

#[derive(Deserialize)]
pub struct Update {
    status: Option<String>,
    priority: Option<String>,
}

/// `POST /admin/support/tickets/{id}/status {status?, priority?}`.
pub async fn admin_update(State(c): State<SupportCtx>, headers: HeaderMap, Path(id): Path<i64>, Json(u): Json<Update>) -> Result<Json<Value>, ApiErr> {
    admin(&headers)?;
    let mut patch = json!({ "updated_at": now_iso() });
    if let Some(s) = u.status {
        if !STATUSES.contains(&s.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "unknown status".into()));
        }
        patch["status"] = json!(s);
        if s == "resolved" {
            patch["user_unread"] = json!(true);
        }
    }
    if let Some(p) = u.priority {
        if !PRIORITIES.contains(&p.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "unknown priority".into()));
        }
        patch["priority"] = json!(p);
    }
    let rows = c.acct.rest(reqwest::Method::PATCH, &format!("support_tickets?id=eq.{id}"), Some(patch)).await?;
    match owner_of(&rows) {
        Some(owner) => c.live.send(To::Both(owner), json!({ "type": "status", "ticket": id })),
        None => c.live.send(To::Team, json!({ "type": "status", "ticket": id })),
    }
    Ok(Json(json!({ "ok": true })))
}

/* ---------------- The live socket ---------------- */

#[derive(Clone, PartialEq)]
enum Who {
    User(String),
    Team,
}

fn wants(who: &Who, to: &To) -> bool {
    match (who, to) {
        (_, To::All) => true,
        (Who::Team, To::Team | To::Both(_)) => true,
        (Who::User(u), To::User(v) | To::Both(v)) => u == v,
        _ => false,
    }
}

/// `GET /support/ws`: real-time support events. The first frame proves who is
/// connecting: `{"token": "<session>"}` for a user or `{"admin": "<key>"}` for the team,
/// so no secret ever goes in the URL.
pub async fn ws(ws: WebSocketUpgrade, State(c): State<SupportCtx>) -> Response {
    ws.on_upgrade(move |socket| run_socket(socket, c))
}

async fn run_socket(mut socket: WebSocket, c: SupportCtx) {
    let Ok(Some(Ok(Message::Text(first)))) = tokio::time::timeout(Duration::from_secs(10), socket.recv()).await else { return };
    let hello: Value = serde_json::from_str(first.as_str()).unwrap_or_default();
    let mut h = HeaderMap::new();
    let who = if let Some(k) = hello["admin"].as_str() {
        if let Ok(v) = k.parse() {
            h.insert("x-admin-token", v);
        }
        if !crate::admin::is_admin(&h) {
            let _ = socket.send(Message::Text(json!({ "type": "error", "error": "wrong admin key" }).to_string().into())).await;
            return;
        }
        Who::Team
    } else if let Some(t) = hello["token"].as_str() {
        if let Ok(v) = format!("Bearer {t}").parse() {
            h.insert("authorization", v);
        }
        match c.acct.user(&h).await {
            Ok(u) => Who::User(u.id),
            Err((_, e)) => {
                let _ = socket.send(Message::Text(json!({ "type": "error", "error": e }).to_string().into())).await;
                return;
            }
        }
    } else {
        return;
    };
    let mut rx = c.live.tx.subscribe();
    let first = json!({ "type": "hello", "online": c.online(), "enabled": c.admin.live_chat() });
    if socket.send(Message::Text(first.to_string().into())).await.is_err() {
        return;
    }
    // Who owns a ticket (checked once per socket, for typing).
    let mut owners: HashMap<i64, Option<String>> = HashMap::new();
    let mut last_typing = Instant::now() - Duration::from_secs(10);
    let mut ping = tokio::time::interval(Duration::from_secs(25));
    loop {
        tokio::select! {
            _ = ping.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    return;
                }
            }
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(t))) => {
                    let m: Value = serde_json::from_str(t.as_str()).unwrap_or_default();
                    match (m["type"].as_str(), &who) {
                        // The inbox beats only while the agent is active.
                        (Some("beat"), Who::Team) => {
                            c.live.beat();
                            c.live.announce(c.admin.live_chat());
                        }
                        (Some("typing"), _) if last_typing.elapsed() > Duration::from_millis(1500) => {
                            let Some(id) = m["ticket"].as_i64() else { continue };
                            last_typing = Instant::now();
                            if !owners.contains_key(&id) {
                                let q = match &who {
                                    Who::User(u) => format!("support_tickets?id=eq.{id}&user_id=eq.{u}&select=user_id"),
                                    Who::Team => format!("support_tickets?id=eq.{id}&select=user_id"),
                                };
                                let owner = c.acct.rest(reqwest::Method::GET, &q, None).await.ok().and_then(|v| v.as_array()?.first()?["user_id"].as_str().map(String::from));
                                if owners.len() > 200 {
                                    owners.clear();
                                }
                                owners.insert(id, owner);
                            }
                            let Some(Some(owner)) = owners.get(&id).cloned() else { continue };
                            match &who {
                                Who::User(_) => c.live.send(To::Team, json!({ "type": "typing", "ticket": id, "who": "user" })),
                                Who::Team => c.live.send(To::User(owner), json!({ "type": "typing", "ticket": id, "who": "support", "agent": agent_name(m["agent"].as_str()) })),
                            }
                        }
                        _ => {}
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {}
            },
            event = rx.recv() => match event {
                Ok(e) if wants(&who, &e.to) => {
                    if socket.send(Message::Text(e.body.into())).await.is_err() {
                        return;
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures_and_context_are_checked() {
        assert!(is_signature(&bs58::encode([7u8; 64]).into_string()));
        assert!(!is_signature("not-a-signature"));
        assert!(!is_signature("D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ"), "an address is not a signature");
        let c = clean_context(&json!({ "page": "x".repeat(500), "browser": "Chrome", "evil": "drop me", "wallet": 5 }));
        assert_eq!(c["page"].as_str().unwrap().len(), 200);
        assert_eq!(c["browser"], "Chrome");
        assert!(c.get("evil").is_none());
        assert!(c["wallet"].is_null());
    }

    #[test]
    fn secrets_are_refused_and_normal_messages_pass() {
        // The standard BIP39 test phrases, with numbering and line breaks.
        assert!(contains_secret("my words: 1. abandon 2. abandon 3. abandon abandon abandon abandon\nabandon abandon abandon abandon abandon about"));
        assert!(contains_secret("legal winner thank year wave sausage worth useful legal winner thank yellow"));
        // A private key in base58 and as a keypair file.
        let sk = ed25519_dalek::SigningKey::from_bytes(&[9u8; 32]);
        let mut kp = [0u8; 64];
        kp[..32].copy_from_slice(&[9u8; 32]);
        kp[32..].copy_from_slice(&sk.verifying_key().to_bytes());
        assert!(contains_secret(&format!("here is my key {}", bs58::encode(kp).into_string())));
        assert!(contains_secret(&format!("{:?}", kp.to_vec())));
        // A transaction signature has the same length but is not a key.
        assert!(!contains_secret(&format!("my trade {} failed", bs58::encode([7u8; 64]).into_string())));
        // Ordinary messages, even long ones made of common words.
        assert!(!contains_secret("Hi, my buy failed twice today and I lost the fee. Can you check what happened with the trade please"));
        assert!(!contains_secret("I want to know about the cost of a trade and the slippage you use for new coins"));
    }

    #[test]
    fn events_reach_the_right_people() {
        let alice = Who::User("a".into());
        assert!(wants(&alice, &To::User("a".into())));
        assert!(!wants(&alice, &To::User("b".into())));
        assert!(!wants(&alice, &To::Team));
        assert!(wants(&alice, &To::All));
        assert!(wants(&Who::Team, &To::Both("a".into())));
        assert!(!wants(&Who::Team, &To::User("a".into())));
        assert_eq!(agent_name(Some("  Sara<script> ")).as_deref(), Some("Sarascript"));
        assert_eq!(agent_name(Some("   ")), None);
    }
}
