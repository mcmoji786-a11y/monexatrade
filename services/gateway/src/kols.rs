//! KOL Tracker: well-known traders' wallets, named with their X accounts.
//!
//! The list is the admin's (data/kols.json, Admin, KOLs); nothing is guessed or made up.
//! From the live trade stream the gateway keeps, for the last 24 hours, which KOLs bought
//! each coin and how many buys and sells each KOL made, so the site can show "3 KOLs
//! bought" on a coin and a live feed of KOL trades.
//!
//! Routes: GET /kols, GET /kols/coins, GET /kols/coin/{mint}, WS /ws/kols, and for the
//! admin GET/PUT /admin/kols. The admin switch "kol_tracker" turns the public ones off.

use crate::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{HeaderMap, StatusCode},
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex, OnceLock, RwLock},
};
use tokio::sync::broadcast;

const FILE: &str = "data/kols.json";
const MAX_KOLS: usize = 500;
const DAY: i64 = 86_400;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Kol {
    pub address: String,
    pub name: String,
    /// X handle, without the @.
    #[serde(default)]
    pub x: String,
}

#[derive(Clone)]
pub struct KolCtx {
    pub app: Arc<AppState>,
    pub admin: Arc<crate::admin::AdminState>,
}

fn list() -> &'static RwLock<Vec<Kol>> {
    static L: OnceLock<RwLock<Vec<Kol>>> = OnceLock::new();
    L.get_or_init(|| RwLock::new(std::fs::read(FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()))
}

/// What each KOL did in the last 24 hours, from the live stream.
#[derive(Default)]
struct Seen {
    /// mint -> KOL address -> last buy time.
    bought: HashMap<String, HashMap<String, i64>>,
    /// KOL address -> buy times and sell times.
    activity: HashMap<String, (VecDeque<i64>, VecDeque<i64>)>,
}

fn seen() -> &'static Mutex<Seen> {
    static S: OnceLock<Mutex<Seen>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Seen::default()))
}

fn addresses() -> HashSet<String> {
    list().read().expect("kols lock").iter().map(|k| k.address.clone()).collect()
}

fn by_address() -> HashMap<String, Kol> {
    list().read().expect("kols lock").iter().map(|k| (k.address.clone(), k.clone())).collect()
}

/// Reads every decoded trade and remembers the KOLs' ones.
pub async fn run(app: Arc<AppState>) {
    let mut rx = app.trades.subscribe();
    let mut last_prune = crate::now_unix();
    loop {
        match rx.recv().await {
            Ok((mint, t)) => {
                let is_kol = list().read().expect("kols lock").iter().any(|k| k.address == t.wallet);
                let now = crate::now_unix();
                let mut s = seen().lock().expect("kols seen lock");
                if is_kol {
                    if t.is_buy {
                        s.bought.entry(mint).or_default().insert(t.wallet.clone(), t.ts);
                    }
                    let a = s.activity.entry(t.wallet.clone()).or_default();
                    if t.is_buy { a.0.push_back(t.ts) } else { a.1.push_back(t.ts) }
                }
                if now - last_prune > 300 {
                    last_prune = now;
                    s.bought.retain(|_, m| {
                        m.retain(|_, at| now - *at < DAY);
                        !m.is_empty()
                    });
                    for (b, sl) in s.activity.values_mut() {
                        while b.front().is_some_and(|t| now - t > DAY) {
                            b.pop_front();
                        }
                        while sl.front().is_some_and(|t| now - t > DAY) {
                            sl.pop_front();
                        }
                    }
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

fn on(c: &KolCtx) -> Result<(), (StatusCode, String)> {
    if c.admin.kol_tracker() {
        Ok(())
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, "The KOL Tracker is switched off right now".into()))
    }
}

/// `GET /kols`: the KOLs and their last 24 hours.
pub async fn kols(State(c): State<KolCtx>) -> Result<Json<Value>, (StatusCode, String)> {
    on(&c)?;
    let s = seen().lock().expect("kols seen lock");
    let out: Vec<Value> = list()
        .read()
        .expect("kols lock")
        .iter()
        .map(|k| {
            let (b, sl) = s.activity.get(&k.address).map(|(b, sl)| (b.len(), sl.len())).unwrap_or((0, 0));
            let last = s.activity.get(&k.address).and_then(|(b, sl)| b.back().copied().max(sl.back().copied()));
            json!({ "address": k.address, "name": k.name, "x": k.x, "buys_24h": b, "sells_24h": sl, "last_trade": last })
        })
        .collect();
    Ok(Json(json!({ "kols": out })))
}

/// `GET /kols/coins`: for each coin a KOL bought in the last 24 hours, which KOLs.
pub async fn coins(State(c): State<KolCtx>) -> Result<Json<Value>, (StatusCode, String)> {
    on(&c)?;
    let names = by_address();
    let s = seen().lock().expect("kols seen lock");
    let mut out = serde_json::Map::new();
    for (mint, who) in &s.bought {
        let list: Vec<Value> = who.keys().filter_map(|a| names.get(a)).map(|k| json!({ "name": k.name, "x": k.x })).collect();
        if !list.is_empty() {
            out.insert(mint.clone(), Value::Array(list));
        }
    }
    Ok(Json(json!({ "coins": out })))
}

/// `GET /kols/coin/{mint}`: the KOLs who bought this coin in the last 24 hours.
pub async fn coin(State(c): State<KolCtx>, Path(mint): Path<String>) -> Result<Json<Value>, (StatusCode, String)> {
    on(&c)?;
    if !crate::is_mint(&mint) {
        return Err((StatusCode::BAD_REQUEST, "not a coin address".into()));
    }
    let names = by_address();
    let s = seen().lock().expect("kols seen lock");
    let mut out: Vec<Value> = s
        .bought
        .get(&mint)
        .map(|m| m.iter().filter_map(|(a, at)| names.get(a).map(|k| json!({ "address": k.address, "name": k.name, "x": k.x, "bought_at": at }))).collect())
        .unwrap_or_default();
    out.sort_by_key(|v| -v["bought_at"].as_i64().unwrap_or(0));
    Ok(Json(json!({ "kols": out })))
}

/// `WS /ws/kols`: the KOLs' recent trades, then each new one, named.
pub async fn ws(ws: WebSocketUpgrade, State(c): State<KolCtx>) -> Response {
    ws.on_upgrade(move |socket| stream(socket, c))
}

async fn stream(mut socket: WebSocket, c: KolCtx) {
    if !c.admin.kol_tracker() {
        return;
    }
    let mut rx = c.app.trades.subscribe();
    let wallets = addresses();
    let names = by_address();
    let row_json = |mint: &str, row: &crate::book::TradeRow| {
        let (symbol, image, sol_usd) = {
            let b = c.app.board.lock().expect("board lock");
            let t = b.tokens.get(mint);
            (t.map(|t| t.token.symbol.clone()).or_else(|| b.markets.get(mint).map(|m| m.symbol)), t.and_then(|t| t.meta.as_ref()).and_then(|m| m.image.clone()), b.sol_usd)
        };
        let k = names.get(&row.wallet);
        json!({ "mint": mint, "symbol": symbol, "image": image, "trade": row, "sol_usd": sol_usd, "kol": k.map(|k| json!({ "name": k.name, "x": k.x })) })
    };
    let history: Vec<Value> = c.app.books.lock().expect("books lock").trades_by(&wallets, 200).into_iter().map(|(mint, row)| row_json(&mint, &row)).collect();
    if socket.send(Message::Text(json!({ "type": "history", "trades": history }).to_string().into())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {}
            },
            event = rx.recv() => match event {
                Ok((mint, row)) if wallets.contains(&row.wallet) => {
                    let mut msg = row_json(&mint, &row);
                    msg["type"] = json!("trade");
                    if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
                        return;
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

/* ---------------- Admin ---------------- */

pub async fn admin_get(headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    if !crate::admin::is_admin(&headers) {
        return Err((StatusCode::FORBIDDEN, "admin only".into()));
    }
    Ok(Json(json!({ "kols": *list().read().expect("kols lock") })))
}

fn valid_x(h: &str) -> bool {
    h.is_empty() || ((1..=15).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
}

/// `PUT /admin/kols`: the whole list.
pub async fn admin_put(headers: HeaderMap, Json(body): Json<Value>) -> Result<Json<Value>, (StatusCode, String)> {
    if !crate::admin::is_admin(&headers) {
        return Err((StatusCode::FORBIDDEN, "admin only".into()));
    }
    let incoming: Vec<Kol> = serde_json::from_value(body["kols"].clone()).map_err(|_| (StatusCode::BAD_REQUEST, "expected { kols: [{ address, name, x }] }".to_string()))?;
    if incoming.len() > MAX_KOLS {
        return Err((StatusCode::BAD_REQUEST, format!("at most {MAX_KOLS} KOLs")));
    }
    let mut seen_addr = HashSet::new();
    let mut clean = Vec::new();
    for k in incoming {
        let address = k.address.trim().to_string();
        let x = k.x.trim().trim_start_matches('@').to_string();
        let name: String = k.name.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(40).collect();
        if !crate::is_mint(&address) {
            return Err((StatusCode::BAD_REQUEST, format!("{address} is not a Solana address")));
        }
        if name.is_empty() {
            return Err((StatusCode::BAD_REQUEST, format!("{address} needs a name")));
        }
        if !valid_x(&x) {
            return Err((StatusCode::BAD_REQUEST, format!("@{x} is not an X handle")));
        }
        if seen_addr.insert(address.clone()) {
            clean.push(Kol { address, name, x });
        }
    }
    let _ = std::fs::create_dir_all("data");
    std::fs::write(FILE, serde_json::to_vec_pretty(&clean).unwrap_or_default()).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "could not save".to_string()))?;
    tracing::info!(count = clean.len(), "KOL list saved");
    *list().write().expect("kols lock") = clean.clone();
    Ok(Json(json!({ "kols": clean })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x_handles() {
        assert!(valid_x(""));
        assert!(valid_x("ansem_123"));
        assert!(!valid_x("way_too_long_handle_x"));
        assert!(!valid_x("bad-dash"));
    }
}
