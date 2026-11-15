//! Kixo demo perps (migration 0013): long or short with leverage on Hyperliquid's live
//! prices, paid from the demo balance.
//!
//! - Prices: Hyperliquid's public market data (`metaAndAssetCtxs`), every 3 seconds: mark
//!   price, 24 h change, the hourly funding rate, open interest and the max leverage.
//! - Fills at the mark price. Fee: Hyperliquid's base taker fee, 0.045% of the size, on
//!   opening and on closing, the same a real trade there would pay.
//! - Isolated margin: liquidation when the mark reaches the liquidation price, where the
//!   margin left equals Hyperliquid's maintenance margin (half the initial margin at the
//!   coin's max leverage). A liquidated position loses its margin, never more.
//! - Funding: charged on close as size x the funding rate x hours held (longs pay when the
//!   rate is positive, shorts receive), using the rate at closing: an estimate of the
//!   hourly payments a real position would have made.
//!
//! Demo only: real perps need a separate legal and security review. Admin switch "perps".

use crate::account::AccountState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

type ApiErr = (StatusCode, String);

const INFO_URL: &str = "https://api.hyperliquid.xyz/info";
const TAKER_FEE: f64 = 0.000_45;
const MIN_MARGIN_USD: f64 = 1.0;

#[derive(Clone, Debug)]
pub struct Market {
    pub coin: String,
    pub mark: f64,
    pub prev_day: f64,
    /// Hourly funding rate (0.0000125 = 0.00125% an hour).
    pub funding: f64,
    pub max_leverage: f64,
    pub volume_24h: f64,
    pub open_interest: f64,
}

#[derive(Default)]
struct Book {
    markets: HashMap<String, Market>,
    order: Vec<String>,
    at: Option<Instant>,
}

static BOOK: OnceLock<Mutex<Book>> = OnceLock::new();
fn book() -> &'static Mutex<Book> {
    BOOK.get_or_init(|| Mutex::new(Book::default()))
}

#[derive(Clone)]
pub struct PerpsCtx {
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub http: reqwest::Client,
}

fn num(v: &Value) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0)
}

fn on(c: &PerpsCtx) -> Result<(), ApiErr> {
    if c.admin.perps() {
        Ok(())
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, "Perps are switched off right now".into()))
    }
}

/// Maintenance margin fraction: half the initial margin at the coin's max leverage.
fn maintenance(max_leverage: f64) -> f64 {
    1.0 / (2.0 * max_leverage.max(1.0))
}

/// The price where an isolated position's margin falls to the maintenance margin.
pub fn liq_price(side: &str, entry: f64, leverage: f64, max_leverage: f64) -> f64 {
    let mm = maintenance(max_leverage);
    if side == "long" {
        entry * (1.0 - 1.0 / leverage + mm)
    } else {
        entry * (1.0 + 1.0 / leverage - mm)
    }
}

fn pnl(side: &str, entry: f64, exit: f64, size: f64) -> f64 {
    (exit - entry) * size * if side == "long" { 1.0 } else { -1.0 }
}

/// Funding over the hours held, at the given hourly rate: longs pay a positive rate.
fn funding(side: &str, size: f64, mark: f64, rate: f64, hours: f64) -> f64 {
    size * mark * rate * hours * if side == "long" { 1.0 } else { -1.0 }
}

async fn refresh(http: &reqwest::Client) -> bool {
    let Ok(res) = http.post(INFO_URL).json(&json!({ "type": "metaAndAssetCtxs" })).timeout(Duration::from_secs(8)).send().await else { return false };
    let Ok(v) = res.json::<Value>().await else { return false };
    let (Some(meta), Some(ctxs)) = (v[0]["universe"].as_array(), v[1].as_array()) else { return false };
    let mut markets = HashMap::new();
    let mut order: Vec<(f64, String)> = Vec::new();
    for (u, c) in meta.iter().zip(ctxs) {
        if u["isDelisted"].as_bool() == Some(true) {
            continue;
        }
        let Some(coin) = u["name"].as_str() else { continue };
        let mark = num(&c["markPx"]);
        if !(mark > 0.0) {
            continue;
        }
        let m = Market {
            coin: coin.to_string(),
            mark,
            prev_day: num(&c["prevDayPx"]),
            funding: num(&c["funding"]),
            max_leverage: num(&u["maxLeverage"]).max(1.0),
            volume_24h: num(&c["dayNtlVlm"]),
            open_interest: num(&c["openInterest"]) * mark,
        };
        order.push((m.volume_24h, m.coin.clone()));
        markets.insert(m.coin.clone(), m);
    }
    order.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut b = book().lock().expect("perps book");
    b.markets = markets;
    b.order = order.into_iter().map(|(_, c)| c).collect();
    b.at = Some(Instant::now());
    true
}

fn market(coin: &str) -> Option<Market> {
    let b = book().lock().expect("perps book");
    if b.at.is_none_or(|t| t.elapsed() > Duration::from_secs(30)) {
        return None;
    }
    b.markets.get(coin).cloned()
}

/// Every 3 seconds: fresh prices; every 5 seconds: liquidate positions past their price.
pub async fn run(ctx: PerpsCtx) {
    let mut round = 0u64;
    loop {
        if ctx.admin.perps() {
            let _ = refresh(&ctx.http).await;
            if round % 2 == 0 {
                liquidate(&ctx).await;
            }
        }
        round += 1;
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn liquidate(ctx: &PerpsCtx) {
    let Ok(v) = ctx.acct.rest(reqwest::Method::GET, "demo_perps?status=eq.open&select=id,user_id,coin,side,liq_px&limit=5000", None).await else { return };
    for p in v.as_array().into_iter().flatten() {
        let (Some(coin), Some(side), Some(user)) = (p["coin"].as_str(), p["side"].as_str(), p["user_id"].as_str()) else { continue };
        let Some(m) = market(coin) else { continue };
        let liq = num(&p["liq_px"]);
        let hit = if side == "long" { m.mark <= liq } else { m.mark >= liq };
        if hit {
            let body = json!({ "p_user": user, "p_id": p["id"], "p_exit": liq, "p_fee": 0, "p_funding": 0, "p_status": "liquidated" });
            if ctx.acct.rest(reqwest::Method::POST, "rpc/demo_perp_close", Some(body)).await.is_ok() {
                tracing::info!(coin, side, "demo perp liquidated");
            }
        }
    }
}

fn market_view(m: &Market) -> Value {
    json!({
        "coin": m.coin, "mark": m.mark,
        "change_24h_pct": if m.prev_day > 0.0 { (m.mark / m.prev_day - 1.0) * 100.0 } else { 0.0 },
        "funding_hourly": m.funding, "max_leverage": m.max_leverage,
        "volume_24h": m.volume_24h, "open_interest_usd": m.open_interest,
    })
}

/// `GET /perps/markets`: the 60 busiest markets.
pub async fn markets(State(c): State<PerpsCtx>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let b = book().lock().expect("perps book");
    if b.at.is_none() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Perp prices are loading".into()));
    }
    let list: Vec<Value> = b.order.iter().take(60).filter_map(|c| b.markets.get(c)).map(market_view).collect();
    Ok(Json(json!({ "markets": list, "taker_fee": TAKER_FEE })))
}

fn hours_since(iso: &str) -> f64 {
    crate::growth::parse_iso(iso).map_or(0.0, |t| ((crate::now_unix() - t).max(0) as f64) / 3600.0)
}

/// `GET /perps/positions`: open positions with live profit, and the last 30 closed.
pub async fn positions(State(c): State<PerpsCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let v = c.acct.rest(reqwest::Method::GET, &format!("demo_perps?user_id=eq.{}&order=id.desc&limit=60", u.id), None).await?;
    let mut open = Vec::new();
    let mut closed = Vec::new();
    for p in v.as_array().into_iter().flatten() {
        let coin = p["coin"].as_str().unwrap_or_default();
        let side = p["side"].as_str().unwrap_or("long");
        let (entry, size, margin) = (num(&p["entry_px"]), num(&p["size"]), num(&p["margin_usd"]));
        if p["status"] == json!("open") {
            let m = market(coin);
            let mark = m.as_ref().map_or(entry, |m| m.mark);
            let fund = m.as_ref().map_or(0.0, |m| funding(side, size, mark, m.funding, hours_since(p["opened_at"].as_str().unwrap_or(""))));
            let close_fee = size * mark * TAKER_FEE;
            let upnl = pnl(side, entry, mark, size);
            open.push(json!({
                "id": p["id"], "coin": coin, "side": side, "leverage": num(&p["leverage"]), "margin_usd": margin, "size": size,
                "entry_px": entry, "mark": mark, "liq_px": num(&p["liq_px"]), "opened_at": p["opened_at"],
                "pnl_usd": upnl, "pnl_after_costs_usd": upnl - close_fee - fund - num(&p["open_fee_usd"]),
                "roe_pct": if margin > 0.0 { upnl / margin * 100.0 } else { 0.0 },
                "funding_usd": fund,
            }));
        } else if closed.len() < 30 {
            closed.push(json!({
                "id": p["id"], "coin": coin, "side": side, "leverage": num(&p["leverage"]), "margin_usd": margin, "size": size,
                "entry_px": entry, "exit_px": num(&p["exit_px"]), "status": p["status"], "pnl_usd": num(&p["pnl_usd"]),
                "fees_usd": num(&p["open_fee_usd"]) + num(&p["close_fee_usd"]), "funding_usd": num(&p["funding_usd"]),
                "opened_at": p["opened_at"], "closed_at": p["closed_at"],
            }));
        }
    }
    Ok(Json(json!({ "open": open, "closed": closed })))
}

/// What a user's open demo perps are worth now (margin plus profit, at least zero each),
/// for the demo account's equity. Zero when the table is not there yet.
pub async fn open_value(acct: &AccountState, user: &str) -> f64 {
    let Ok(v) = acct.rest(reqwest::Method::GET, &format!("demo_perps?user_id=eq.{user}&status=eq.open&select=coin,side,size,entry_px,margin_usd"), None).await else { return 0.0 };
    v.as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            let entry = num(&p["entry_px"]);
            let mark = market(p["coin"].as_str().unwrap_or_default()).map_or(entry, |m| m.mark);
            (num(&p["margin_usd"]) + pnl(p["side"].as_str().unwrap_or("long"), entry, mark, num(&p["size"]))).max(0.0)
        })
        .sum()
}

#[derive(Deserialize)]
pub struct OpenIn {
    coin: String,
    side: String,
    margin_usd: f64,
    leverage: f64,
}

/// `POST /perps/open`: a market order at the mark price.
pub async fn open(State(c): State<PerpsCtx>, headers: HeaderMap, Json(o): Json<OpenIn>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    if o.side != "long" && o.side != "short" {
        return Err((StatusCode::BAD_REQUEST, "Long or short".into()));
    }
    let m = market(&o.coin).ok_or((StatusCode::BAD_REQUEST, "This market is not available right now".into()))?;
    if !(o.margin_usd.is_finite() && o.margin_usd >= MIN_MARGIN_USD) {
        return Err((StatusCode::BAD_REQUEST, "Minimum margin is $1".into()));
    }
    if !(o.leverage.is_finite() && o.leverage >= 1.0 && o.leverage <= m.max_leverage) {
        return Err((StatusCode::BAD_REQUEST, format!("Leverage from 1x to {}x on {}", m.max_leverage, m.coin)));
    }
    let lev = (o.leverage * 10.0).round() / 10.0;
    let notional = o.margin_usd * lev;
    let size = notional / m.mark;
    let fee = notional * TAKER_FEE;
    let liq = liq_price(&o.side, m.mark, lev, m.max_leverage);
    let body = json!({
        "p_user": u.id, "p_coin": m.coin, "p_side": o.side, "p_leverage": lev, "p_margin": o.margin_usd, "p_size": size,
        "p_entry": m.mark, "p_liq": liq, "p_fee": fee, "p_start": crate::demo::START_USD,
    });
    let r = c.acct.rest(reqwest::Method::POST, "rpc/demo_perp_open", Some(body)).await.map_err(|e| if e.1.contains("database error") { (StatusCode::BAD_REQUEST, "Not enough demo balance".into()) } else { e })?;
    Ok(Json(json!({ "id": r["id"], "entry_px": m.mark, "liq_px": liq, "size": size, "fee_usd": fee, "cash_usd": r["cash_usd"] })))
}

#[derive(Deserialize)]
pub struct CloseIn {
    id: i64,
}

/// `POST /perps/close`: closes at the mark price, with the closing fee and funding.
pub async fn close(State(c): State<PerpsCtx>, headers: HeaderMap, Json(i): Json<CloseIn>) -> Result<Json<Value>, ApiErr> {
    on(&c)?;
    let u = c.acct.user(&headers).await?;
    let v = c.acct.rest(reqwest::Method::GET, &format!("demo_perps?id=eq.{}&user_id=eq.{}&status=eq.open&select=coin,side,size,opened_at", i.id, u.id), None).await?;
    let p = v.as_array().and_then(|a| a.first()).cloned().ok_or((StatusCode::NOT_FOUND, "Position not open".into()))?;
    let coin = p["coin"].as_str().unwrap_or_default();
    let side = p["side"].as_str().unwrap_or("long");
    let size = num(&p["size"]);
    let m = market(coin).ok_or((StatusCode::SERVICE_UNAVAILABLE, "No live price right now, try again".into()))?;
    let fee = size * m.mark * TAKER_FEE;
    let fund = funding(side, size, m.mark, m.funding, hours_since(p["opened_at"].as_str().unwrap_or("")));
    let body = json!({ "p_user": u.id, "p_id": i.id, "p_exit": m.mark, "p_fee": fee, "p_funding": fund, "p_status": "closed" });
    let r = c.acct.rest(reqwest::Method::POST, "rpc/demo_perp_close", Some(body)).await?;
    Ok(Json(json!({ "exit_px": m.mark, "pnl_usd": r["pnl_usd"], "returned_usd": r["returned_usd"] })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liquidation_and_profit() {
        // 10x long on a coin with 20x max: liquidation 7.5% below entry.
        assert!((liq_price("long", 100.0, 10.0, 20.0) - 92.5).abs() < 1e-9);
        assert!((liq_price("short", 100.0, 10.0, 20.0) - 107.5).abs() < 1e-9);
        assert!(liq_price("long", 100.0, 1.0, 20.0) > 0.0);
        assert!((pnl("short", 100.0, 90.0, 2.0) - 20.0).abs() < 1e-9);
        // Longs pay a positive rate, shorts receive it.
        assert!(funding("long", 1.0, 100.0, 0.0001, 10.0) > 0.0);
        assert!(funding("short", 1.0, 100.0, 0.0001, 10.0) < 0.0);
    }
}
