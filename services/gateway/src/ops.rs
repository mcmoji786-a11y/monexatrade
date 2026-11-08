//! Admin operations: find a user, pause their trading, see what Kixo earned, export CSV.
//!
//! - Users come from Supabase Auth, joined with their Kixo wallet. The list is cached
//!   for a minute.
//! - A paused user cannot trade or deposit. Withdrawals stay open: a user can always
//!   take their own SOL out. Pauses live in `data/paused.json`.
//! - Earnings are read from Kixo's own records, never estimated:
//!   - trade fees from confirmed rows in `real_trades`;
//!   - deposit and withdrawal fees from `data/transfers.jsonl`, which the wallet writes
//!     when it sends a transfer and again once Solana confirms or rejects it.
//!
//! The fee wallet's live on-chain balance is shown next to them as a cross-check.

use crate::account::AccountState;
use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, Write},
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const PAUSED_FILE: &str = "data/paused.json";
const TRANSFERS_FILE: &str = "data/transfers.jsonl";

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/* ---------------- Paused users ---------------- */

static PAUSED: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();

fn paused_map() -> &'static Mutex<HashMap<String, Value>> {
    PAUSED.get_or_init(|| Mutex::new(std::fs::read(PAUSED_FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()))
}

/// Why a user's trading is paused, if it is.
pub fn paused(user: &str) -> Option<String> {
    paused_map().lock().expect("paused lock").get(user).map(|v| v["reason"].as_str().unwrap_or("").to_string())
}

/* ---------------- Transfer log ---------------- */

static TRANSFERS: Mutex<()> = Mutex::new(());

/// Records a deposit or withdrawal when it is sent (`status` "sent") and again when it
/// settles ("confirmed" or "failed"). Amounts in lamports: `amount` is what reached the
/// destination, `fee` what went to Kixo.
pub fn log_transfer(row: Value) {
    let _g = TRANSFERS.lock().expect("transfers lock");
    let res = std::fs::create_dir_all("data").and_then(|_| std::fs::OpenOptions::new().create(true).append(true).open(TRANSFERS_FILE)).and_then(|mut f| f.write_all(format!("{row}\n").as_bytes()));
    if let Err(e) = res {
        tracing::error!(%e, "transfer log could not be written");
    }
}

/// Every transfer with its latest status, newest first.
pub fn transfers() -> Vec<Value> {
    let Ok(f) = std::fs::File::open(TRANSFERS_FILE) else { return vec![] };
    let mut by_sig: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for v in std::io::BufReader::new(f).lines().map_while(Result::ok).filter_map(|l| serde_json::from_str::<Value>(&l).ok()) {
        let Some(sig) = v["sig"].as_str().map(String::from) else { continue };
        match by_sig.get_mut(&sig) {
            // A later line updates the status of the first.
            Some(first) => {
                if let Some(s) = v.get("status") {
                    first["status"] = s.clone();
                }
            }
            None => {
                order.push(sig.clone());
                by_sig.insert(sig, v);
            }
        }
    }
    order.into_iter().rev().filter_map(|s| by_sig.remove(&s)).collect()
}

/* ---------------- Handlers ---------------- */

#[derive(Clone)]
pub struct OpsCtx {
    pub acct: Arc<AccountState>,
    pub app: Arc<crate::AppState>,
    pub admin: Arc<crate::admin::AdminState>,
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

static USERS: Mutex<Option<(Instant, Vec<Value>)>> = Mutex::new(None);

/// Every account (up to 20,000), joined with its Kixo wallet; cached for a minute.
pub(crate) async fn all_users(c: &OpsCtx) -> Result<Vec<Value>, ApiErr> {
    if let Some((at, v)) = USERS.lock().expect("users lock").as_ref() {
        if at.elapsed() < Duration::from_secs(60) {
            return Ok(v.clone());
        }
    }
    let mut raw = Vec::new();
    for page in 1..=20 {
        let batch = c.acct.list_auth_users(page, 1000).await.map_err(|e| err(e.0, &e.1))?;
        let done = batch.len() < 1000;
        raw.extend(batch);
        if done {
            break;
        }
    }
    let wallets = c.acct.rest(reqwest::Method::GET, "kixo_wallets?select=user_id,pubkey,two_fa,created_at&limit=20000", None).await.unwrap_or(Value::Null);
    let by_user: HashMap<String, Value> = wallets.as_array().into_iter().flatten().filter_map(|w| Some((w["user_id"].as_str()?.to_string(), w.clone()))).collect();
    let users: Vec<Value> = raw
        .iter()
        .map(|u| {
            let id = u["id"].as_str().unwrap_or("").to_string();
            let w = by_user.get(&id);
            json!({
                "id": id,
                "email": u["email"],
                "provider": u["app_metadata"]["provider"],
                "created_at": u["created_at"],
                "last_sign_in_at": u["last_sign_in_at"],
                "wallet": w.map(|w| w["pubkey"].clone()),
                "wallet_created_at": w.map(|w| w["created_at"].clone()),
                "two_fa": w.is_some_and(|w| w["two_fa"].as_bool() == Some(true)),
            })
        })
        .collect();
    *USERS.lock().expect("users lock") = Some((Instant::now(), users.clone()));
    Ok(users)
}

#[derive(Deserialize)]
pub struct UsersQuery {
    q: Option<String>,
    limit: Option<usize>,
}

/// `GET /admin/users?q=`: accounts matching an email, wallet or id; newest first.
pub async fn users(State(c): State<OpsCtx>, headers: HeaderMap, Query(q): Query<UsersQuery>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let all = all_users(&c).await?;
    let needle = q.q.unwrap_or_default().trim().to_lowercase();
    let mut rows: Vec<Value> = all
        .iter()
        .filter(|u| needle.is_empty() || [&u["email"], &u["wallet"], &u["id"]].iter().any(|v| v.as_str().is_some_and(|s| s.to_lowercase().contains(&needle))))
        .cloned()
        .collect();
    rows.sort_by(|a, b| b["created_at"].as_str().cmp(&a["created_at"].as_str()));
    let total = rows.len();
    rows.truncate(q.limit.unwrap_or(100).min(500));
    for r in rows.iter_mut() {
        let id = r["id"].as_str().unwrap_or("").to_string();
        r["paused"] = json!(paused(&id));
    }
    let with_wallet = all.iter().filter(|u| !u["wallet"].is_null()).count();
    Ok(Json(json!({ "total": all.len(), "matches": total, "with_wallet": with_wallet, "users": rows })))
}

/// `GET /admin/users/{id}`: one account with its wallet balance, trades, transfers and
/// tickets.
pub async fn user(State(c): State<OpsCtx>, headers: HeaderMap, Path(id): Path<String>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err(err(StatusCode::BAD_REQUEST, "not a user id"));
    }
    let all = all_users(&c).await?;
    let u = all.iter().find(|u| u["id"] == id).cloned().ok_or_else(|| err(StatusCode::NOT_FOUND, "No such user"))?;
    let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
    let balance = async {
        match u["wallet"].as_str() {
            Some(w) => crate::trade::rpc(&rpc, "getBalance", json!([w, { "commitment": "confirmed" }])).await.ok().and_then(|v| v["value"].as_u64()),
            None => None,
        }
    };
    let (tq, kq, dq) = (
        format!("real_trades?user_id=eq.{id}&select=created_at,side,symbol,mint,sol_lamports,platform_fee_lamports,status,signature&order=created_at.desc&limit=50"),
        format!("support_tickets?user_id=eq.{id}&select=id,subject,status,created_at&order=created_at.desc&limit=20"),
        format!("demo_accounts?user_id=eq.{id}&select=*"),
    );
    let trades = c.acct.rest(reqwest::Method::GET, &tq, None);
    let tickets = c.acct.rest(reqwest::Method::GET, &kq, None);
    let demo = c.acct.rest(reqwest::Method::GET, &dq, None);
    let (balance, trades, tickets, demo) = tokio::join!(balance, trades, tickets, demo);
    let transfers: Vec<Value> = transfers().into_iter().filter(|t| t["user"] == id).take(50).collect();
    Ok(Json(json!({
        "user": u,
        "paused": paused(&id),
        "balance_lamports": balance,
        "trades": trades.unwrap_or(Value::Array(vec![])),
        "tickets": tickets.unwrap_or(Value::Array(vec![])),
        "demo": demo.ok().and_then(|v| v.as_array().and_then(|a| a.first().cloned())),
        "transfers": transfers,
    })))
}

#[derive(Deserialize)]
pub struct PauseIn {
    paused: bool,
    #[serde(default)]
    reason: String,
}

/// `POST /admin/users/{id}/pause`: pauses or resumes a user's trading and deposits.
/// Withdrawals are never paused.
pub async fn pause(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Path(id): Path<String>, Json(b): Json<PauseIn>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err(err(StatusCode::BAD_REQUEST, "not a user id"));
    }
    let reason = b.reason.trim().chars().take(200).collect::<String>();
    let snapshot = {
        let mut m = paused_map().lock().expect("paused lock");
        if b.paused {
            m.insert(id.clone(), json!({ "reason": reason, "ts": now() }));
        } else {
            m.remove(&id);
        }
        m.clone()
    };
    let json = serde_json::to_vec_pretty(&snapshot).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    std::fs::create_dir_all("data").and_then(|_| std::fs::write(PAUSED_FILE, json)).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    crate::platform::audit(Some(addr), if b.paused { "user_paused" } else { "user_resumed" }, json!({ "user": id, "reason": reason }));
    Ok(Json(json!({ "paused": b.paused })))
}

/// Sums fees into today / 7 days / 30 days / all time.
fn buckets(items: &[(i64, u64)], now: i64) -> Value {
    let sum = |secs: i64| items.iter().filter(|(t, _)| now - t < secs).map(|(_, f)| *f).sum::<u64>();
    json!({ "today": sum(86_400), "d7": sum(7 * 86_400), "d30": sum(30 * 86_400), "all": items.iter().map(|(_, f)| *f).sum::<u64>(), "count": items.len() })
}

fn parse_ts(s: &str) -> i64 {
    // "2026-11-08T05:24:23.123+00:00" -> seconds; good enough for day buckets.
    let d = |a: usize, b: usize| s.get(a..b).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
    let (y, mo, da, h, mi, se) = (d(0, 4), d(5, 7), d(8, 10), d(11, 13), d(14, 16), d(17, 19));
    if y == 0 {
        return 0;
    }
    // Days from civil (Howard Hinnant).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + da - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) * 86_400 + h * 3600 + mi * 60 + se
}

/// `GET /admin/earnings`: what Kixo earned from fees, from its own records.
pub async fn earnings(State(c): State<OpsCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let now = now();
    let rows = c.acct.rest(reqwest::Method::GET, "real_trades?status=eq.confirmed&select=created_at,platform_fee_lamports&order=created_at.desc&limit=100000", None).await.unwrap_or(Value::Array(vec![]));
    let trades: Vec<(i64, u64)> = rows.as_array().into_iter().flatten().map(|r| (parse_ts(r["created_at"].as_str().unwrap_or("")), r["platform_fee_lamports"].as_u64().unwrap_or(0))).collect();
    let all = transfers();
    let pick = |kind: &str| -> Vec<(i64, u64)> { all.iter().filter(|t| t["kind"] == kind && t["status"] == "confirmed").map(|t| (t["ts"].as_i64().unwrap_or(0), t["fee"].as_u64().unwrap_or(0))).collect() };
    let (deposits, withdrawals) = (pick("deposit"), pick("withdraw"));
    // Daily totals for the last 30 days, all kinds together.
    let mut days = vec![0u64; 30];
    for (t, f) in trades.iter().chain(deposits.iter()).chain(withdrawals.iter()) {
        let age = (now - t) / 86_400;
        if (0..30).contains(&age) {
            days[29 - age as usize] += f;
        }
    }
    let fee_wallet = c.admin.fee_wallet().or_else(|| std::env::var("FEE_WALLET").ok().filter(|s| !s.trim().is_empty()));
    let balance = match &fee_wallet {
        Some(w) => {
            let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
            crate::trade::rpc(&rpc, "getBalance", json!([w.trim(), { "commitment": "confirmed" }])).await.ok().and_then(|v| v["value"].as_u64())
        }
        None => None,
    };
    Ok(Json(json!({
        "trades": buckets(&trades, now),
        "deposits": buckets(&deposits, now),
        "withdrawals": buckets(&withdrawals, now),
        "days": days,
        "fee_wallet": fee_wallet,
        "fee_wallet_balance": balance,
        "pending_transfers": all.iter().filter(|t| t["status"] == "sent").count(),
    })))
}

fn csv_cell(v: &Value) -> String {
    let s = match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    // Quote every cell; double inner quotes; a leading = + - @ is neutralised so a
    // spreadsheet never runs it as a formula.
    let safe = if s.starts_with(['=', '+', '-', '@']) { format!("'{s}") } else { s };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

fn csv(columns: &[&str], rows: &[Value]) -> String {
    let mut out = columns.join(",");
    out.push('\n');
    for r in rows {
        out.push_str(&columns.iter().map(|c| csv_cell(&r[*c])).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    out
}

/// `GET /admin/export/{kind}`: users, trades or transfers as CSV.
pub async fn export(State(c): State<OpsCtx>, headers: HeaderMap, Path(kind): Path<String>) -> Result<impl IntoResponse, ApiErr> {
    need_admin(&headers)?;
    let body = match kind.as_str() {
        "users" => csv(&["id", "email", "provider", "created_at", "last_sign_in_at", "wallet", "two_fa"], &all_users(&c).await?),
        "trades" => {
            let v = c
                .acct
                .rest(reqwest::Method::GET, "real_trades?select=created_at,user_id,wallet,side,symbol,mint,sol_lamports,platform_fee_lamports,status,signature&order=created_at.desc&limit=100000", None)
                .await
                .map_err(|e| err(e.0, &e.1))?;
            csv(&["created_at", "user_id", "wallet", "side", "symbol", "mint", "sol_lamports", "platform_fee_lamports", "status", "signature"], v.as_array().map_or(&[][..], |a| a.as_slice()))
        }
        "transfers" => csv(&["ts", "user", "kind", "amount", "fee", "status", "sig"], &transfers()),
        _ => return Err(err(StatusCode::NOT_FOUND, "unknown export")),
    };
    crate::platform::audit(None, "export", json!({ "kind": kind }));
    Ok(([(header::CONTENT_TYPE, "text/csv; charset=utf-8"), (header::CONTENT_DISPOSITION, "attachment")], body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_parse_to_unix_seconds() {
        assert_eq!(parse_ts("1970-01-01T00:00:00+00:00"), 0);
        assert_eq!(parse_ts("2026-11-08T00:00:00.123+00:00"), 1_794_096_000);
        assert_eq!(parse_ts(""), 0);
    }

    #[test]
    fn csv_quotes_and_defuses_formulas() {
        let rows = vec![json!({ "a": "x,\"y\"", "b": "=HYPERLINK(1)" })];
        assert_eq!(csv(&["a", "b"], &rows), "a,b\n\"x,\"\"y\"\"\",\"'=HYPERLINK(1)\"\n");
    }

    #[test]
    fn buckets_split_by_age() {
        let now = 1_000_000;
        let b = buckets(&[(now - 10, 5), (now - 3 * 86_400, 7), (now - 40 * 86_400, 11)], now);
        assert_eq!(b, json!({ "today": 5, "d7": 12, "d30": 12, "all": 23, "count": 3 }));
    }
}
