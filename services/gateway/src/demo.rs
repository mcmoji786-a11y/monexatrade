//! Demo trading: a virtual $10,000 account that trades every coin at live market prices.
//!
//! Nothing touches the chain. The gateway prices each order the way the real market
//! would fill it: the live price ~1 second after the click (real orders are not
//! instant), a 1% platform fee, a network fee, and price impact from the coin's real
//! liquidity (exact bonding-curve math for pump.fun curves, constant-product pools for
//! the rest). A coin that rugs takes the demo position down with it.
//!
//! The browser never sends a price; it sends what to buy or sell and the gateway fills
//! it. Fills are written atomically by the `demo_fill` SQL function.

use crate::account::AccountState;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub const START_USD: f64 = 10_000.0;
/// Kixo's trade fee, the same as real trading (an admin setting, 0.5% by default).
fn fee_rate() -> f64 {
    crate::platform::trade_fee_bps() as f64 / 10_000.0
}
/// Network and priority fee per transaction, in SOL.
const NETWORK_SOL: f64 = 0.0001;
/// pump.fun curves: virtual SOL x virtual tokens is constant (30 SOL x 1.073B tokens).
const PUMP_K: f64 = 30.0 * 1_073_000_000.0;
const MIN_ORDER_USD: f64 = 1.0;

#[derive(Clone)]
pub struct DemoCtx {
    pub app: Arc<crate::AppState>,
    pub acct: Arc<AccountState>,
}

/// How a coin's price moves when someone trades it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Depth {
    /// Bonding curve with virtual reserves (SOL, whole tokens).
    Curve { v_sol: f64, v_tok: f64 },
    /// Pool with this much USD on each side.
    Pool { reserve_usd: f64 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Quote {
    pub symbol: String,
    pub price_usd: f64,
    pub sol_usd: f64,
    pub depth: Depth,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Fill {
    pub side: &'static str,
    pub tokens: f64,
    /// Cash spent (buy) or received (sell), fees included.
    pub usd: f64,
    pub sol: f64,
    /// Average price per token actually paid or received.
    pub price_usd: f64,
    /// Market price before the order.
    pub market_usd: f64,
    pub fee_usd: f64,
    /// How much worse than the market price the fill was, in %.
    pub impact_pct: f64,
}

impl Quote {
    pub fn from_curve(symbol: String, price_sol: f64, sol_usd: f64) -> Option<Self> {
        (price_sol > 0.0 && sol_usd > 0.0).then(|| Quote {
            symbol,
            price_usd: price_sol * sol_usd,
            sol_usd,
            depth: Depth::Curve { v_sol: (price_sol * PUMP_K).sqrt(), v_tok: (PUMP_K / price_sol).sqrt() },
        })
    }

    /// The market as it stands with the user's own position in it. The live price comes
    /// from real trades only, so it never contains the demo user's buys; on chain, those
    /// buys would have pushed the price up, and selling would walk it back down. Pricing
    /// the user's position, sales and further buys on this state makes a buy-then-sell
    /// cost what it costs on chain (two fees), instead of paying the price impact twice.
    pub fn held(&self, tokens: f64) -> Quote {
        if tokens <= 0.0 {
            return self.clone();
        }
        match self.depth {
            Depth::Curve { v_tok, .. } if tokens < v_tok * 0.9 => {
                let v_tok2 = v_tok - tokens;
                let v_sol2 = PUMP_K / v_tok2;
                Quote { price_usd: v_sol2 / v_tok2 * self.sol_usd, depth: Depth::Curve { v_sol: v_sol2, v_tok: v_tok2 }, ..self.clone() }
            }
            Depth::Pool { reserve_usd } => {
                let t = reserve_usd / self.price_usd;
                if tokens >= t * 0.9 {
                    return self.clone();
                }
                let t2 = t - tokens;
                let q2 = reserve_usd * t / t2;
                Quote { price_usd: q2 / t2, depth: Depth::Pool { reserve_usd: q2 }, ..self.clone() }
            }
            _ => self.clone(),
        }
    }

    /// Buy with `usd` cash. Fees come off first, the rest moves the price.
    pub fn buy(&self, usd: f64) -> Option<Fill> {
        let fee = usd * fee_rate() + NETWORK_SOL * self.sol_usd;
        let net = usd - fee;
        if net <= 0.0 {
            return None;
        }
        let tokens = match self.depth {
            Depth::Curve { v_sol, v_tok } => {
                let sol_in = net / self.sol_usd;
                v_tok - PUMP_K / (v_sol + sol_in)
            }
            Depth::Pool { reserve_usd } => (net / self.price_usd) * reserve_usd / (reserve_usd + net),
        };
        (tokens > 0.0 && tokens.is_finite()).then(|| self.fill("buy", tokens, usd, fee))
    }

    /// Sell `tokens`. The price moves first, then fees come off the proceeds.
    pub fn sell(&self, tokens: f64) -> Option<Fill> {
        if tokens <= 0.0 {
            return None;
        }
        let gross = match self.depth {
            Depth::Curve { v_sol, v_tok } => (v_sol - PUMP_K / (v_tok + tokens)) * self.sol_usd,
            Depth::Pool { reserve_usd } => {
                let at_market = tokens * self.price_usd;
                at_market * reserve_usd / (reserve_usd + at_market)
            }
        };
        let fee = gross * fee_rate() + NETWORK_SOL * self.sol_usd;
        let usd = (gross - fee).max(0.0);
        Some(self.fill("sell", tokens, usd, fee.min(gross.max(0.0))))
    }

    fn fill(&self, side: &'static str, tokens: f64, usd: f64, fee: f64) -> Fill {
        let price = usd / tokens;
        let impact = if side == "buy" { price / self.price_usd - 1.0 } else { 1.0 - price / self.price_usd };
        Fill {
            side,
            tokens,
            usd,
            sol: usd / self.sol_usd,
            price_usd: price,
            market_usd: self.price_usd,
            fee_usd: fee,
            impact_pct: (impact * 100.0).max(0.0),
        }
    }
}

/// The live price and depth of a coin: our own curve feed first, then the market board,
/// then a direct Jupiter lookup.
pub async fn quote(app: &crate::AppState, mint: &str) -> Result<Quote, (StatusCode, String)> {
    let (curve, market, sol_usd) = {
        let b = app.board.lock().expect("board lock");
        let curve = b.tokens.get(mint).and_then(|t| {
            let m = t.market.as_ref()?;
            (m.sol_quoted && !m.complete && t.token.launchpad == "pump.fun").then(|| (t.token.symbol.clone(), m.price_sol))
        });
        (curve, b.markets.get(mint), b.sol_usd)
    };
    let sol_usd = sol_usd.ok_or((StatusCode::SERVICE_UNAVAILABLE, "SOL price not loaded yet, try again".into()))?;
    if let Some((symbol, price_sol)) = curve {
        if let Some(q) = Quote::from_curve(symbol, price_sol, sol_usd) {
            return Ok(q);
        }
    }
    let (symbol, price, liquidity) = match market {
        Some(m) => (m.symbol, m.price_usd, m.liquidity_usd),
        None => jupiter_market(app, mint).await?,
    };
    // A coin whose pool we stream trades at the price on its chart: use the latest
    // decoded trade (under a minute old) so fills match what the user sees.
    let live = app.books.lock().expect("books lock").last_pool_price(mint);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    let price = match live {
        Some((p_sol, ts)) if now - ts <= LIVE_PRICE_MAX_AGE => Some(p_sol * sol_usd),
        _ => price,
    };
    let price_usd = price.filter(|p| *p > 0.0).ok_or((StatusCode::NOT_FOUND, "no live price for this coin".into()))?;
    let reserve_usd = liquidity.filter(|l| *l > 0.0).map(|l| l / 2.0).ok_or((StatusCode::NOT_FOUND, "this coin has no liquidity to trade".into()))?;
    Ok(Quote { symbol, price_usd, sol_usd, depth: Depth::Pool { reserve_usd } })
}

/// A streamed trade older than this no longer stands for the market price.
const LIVE_PRICE_MAX_AGE: i64 = 60;
/// Jupiter lookups are shared for a few seconds: demo accounts refresh every 3 s.
const JUP_TTL: Duration = Duration::from_secs(5);
type JupEntry = (Instant, (String, Option<f64>, Option<f64>));
static JUP_CACHE: Mutex<Option<HashMap<String, JupEntry>>> = Mutex::new(None);

/// Symbol, USD price and liquidity of a coin not on our board, from Jupiter (cached).
async fn jupiter_market(app: &crate::AppState, mint: &str) -> Result<(String, Option<f64>, Option<f64>), (StatusCode, String)> {
    if let Some((at, v)) = JUP_CACHE.lock().expect("jup cache").as_ref().and_then(|m| m.get(mint).cloned()) {
        if at.elapsed() < JUP_TTL {
            return Ok(v);
        }
    }
    let url = format!("https://lite-api.jup.ag/tokens/v2/search?query={mint}");
    let list: Vec<Value> = app.http.get(&url).timeout(Duration::from_secs(8)).send().await.ok().and_then(|r| r.error_for_status().ok()).ok_or((StatusCode::BAD_GATEWAY, "price service busy, try again".into()))?.json().await.unwrap_or_default();
    let t = list.into_iter().find(|t| t["id"].as_str() == Some(mint)).ok_or((StatusCode::NOT_FOUND, "no live market for this coin".into()))?;
    let v = (t["symbol"].as_str().unwrap_or("").to_string(), t["usdPrice"].as_f64(), t["liquidity"].as_f64());
    let mut cache = JUP_CACHE.lock().expect("jup cache");
    let map = cache.get_or_insert_with(HashMap::new);
    if map.len() > 2000 {
        map.retain(|_, (at, _)| at.elapsed() < JUP_TTL);
    }
    map.insert(mint.to_string(), (Instant::now(), v.clone()));
    Ok(v)
}

/* ---------------- Per-user order lock ---------------- */

static LOCKS: Mutex<Option<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = Mutex::new(None);
fn user_lock(id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut l = LOCKS.lock().expect("demo locks");
    let m = l.get_or_insert_with(HashMap::new);
    if m.len() > 10_000 {
        m.retain(|_, v| Arc::strong_count(v) > 1);
    }
    m.entry(id.to_string()).or_default().clone()
}

/* ---------------- Handlers ---------------- */

#[derive(Serialize)]
pub struct Position {
    pub mint: String,
    pub symbol: String,
    pub tokens: f64,
    pub cost_usd: f64,
    pub price_usd: Option<f64>,
    /// What the position is worth to the user: what selling it all now would bring,
    /// after the sale's fee and price impact. The P&L shown everywhere comes from this, so
    /// selling never brings a surprise; only the market moving in between can change it.
    pub value_usd: Option<f64>,
    /// The same as `value_usd` (kept for older pages).
    pub exit_usd: Option<f64>,
    /// Tokens x the live market price, before selling costs (for reference only).
    pub market_value_usd: Option<f64>,
    /// The live market price these figures were computed at (scales them between refreshes).
    pub market_usd: Option<f64>,
    pub opened_at: String,
}

#[derive(Serialize)]
pub struct Account {
    pub cash_usd: f64,
    pub start_usd: f64,
    pub round: i64,
    pub positions: Vec<Position>,
    /// Cash plus positions at live prices (positions without a price count at zero).
    pub equity_usd: f64,
}

async fn account_rows(c: &DemoCtx, user: &str) -> Result<(f64, f64, i64, Vec<Value>), (StatusCode, String)> {
    // Balance and positions load side by side.
    let (acc_q, pos_q) = (
        format!("demo_accounts?user_id=eq.{user}&select=cash_usd,start_usd,resets"),
        format!("demo_positions?user_id=eq.{user}&select=mint,symbol,tokens,cost_usd,opened_at&order=opened_at.desc"),
    );
    let (acc, pos) = tokio::join!(c.acct.rest(reqwest::Method::GET, &acc_q, None), c.acct.rest(reqwest::Method::GET, &pos_q, None));
    let (acc, pos) = (acc?, pos?);
    let (cash, start, round) = acc
        .as_array()
        .and_then(|a| a.first())
        .map(|a| (num(&a["cash_usd"]), num(&a["start_usd"]), a["resets"].as_i64().unwrap_or(0)))
        .unwrap_or((START_USD, START_USD, 0));
    Ok((cash, start, round, pos.as_array().cloned().unwrap_or_default()))
}

/// An open position at the live market price.
pub fn mark_value(tokens: f64, q: &Quote) -> f64 {
    tokens * q.price_usd
}

/// Postgres numerics arrive as numbers or strings.
fn num(v: &Value) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0)
}

/// `GET /demo/account`: balance, open positions at live prices, and equity.
pub async fn get_account(State(c): State<DemoCtx>, headers: HeaderMap) -> Result<Json<Account>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let (cash, start, round, rows) = account_rows(&c, &u.id).await?;
    let mut positions = Vec::new();
    for p in rows {
        let mint = p["mint"].as_str().unwrap_or("").to_string();
        let tokens = num(&p["tokens"]);
        // Valued at what selling now would bring (fee and impact included), so the P&L the
        // user watches is the P&L they get. Founder decision 2026-11-08, after marking at
        // the market price made every sale look like a sudden loss.
        // A coin with no price any more (rugged, delisted) is worth nothing.
        let q = quote(&c.app, &mint).await.ok();
        let held = q.as_ref().map(|q| q.held(tokens));
        let market = Some(held.as_ref().map_or(0.0, |h| mark_value(tokens, h)));
        let exit = Some(held.as_ref().and_then(|h| h.sell(tokens)).map_or(0.0, |f| f.usd));
        let value = exit;
        positions.push(Position {
            symbol: p["symbol"].as_str().filter(|s| !s.is_empty()).map(String::from).or_else(|| q.as_ref().map(|q| q.symbol.clone())).unwrap_or_default(),
            mint,
            tokens,
            cost_usd: num(&p["cost_usd"]),
            price_usd: held.as_ref().map(|h| h.price_usd),
            value_usd: value,
            exit_usd: exit,
            market_value_usd: market,
            market_usd: q.as_ref().map(|q| q.price_usd),
            opened_at: p["opened_at"].as_str().unwrap_or("").to_string(),
        });
    }
    let equity = cash + positions.iter().map(|p| p.value_usd.unwrap_or(0.0)).sum::<f64>();
    Ok(Json(Account { cash_usd: cash, start_usd: start, round, positions, equity_usd: equity }))
}

#[derive(Deserialize)]
pub struct OrderIn {
    mint: String,
    side: String,
    /// Buy: cash to spend.
    usd: Option<f64>,
    /// Sell: share of the position, 0 to 1.
    fraction: Option<f64>,
    #[serde(default)]
    source: Option<String>,
    /// true: price it without trading.
    #[serde(default)]
    preview: bool,
}

/// `POST /demo/order`: buy or sell at the live market, or preview the fill.
pub async fn order(State(c): State<DemoCtx>, headers: HeaderMap, Json(o): Json<OrderIn>) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    if !crate::account::is_solana_address(&o.mint) {
        return Err((StatusCode::BAD_REQUEST, "not a coin address".into()));
    }
    let source = match o.source.as_deref() {
        None | Some("manual") => "manual",
        Some("sniper") => "sniper",
        _ => return Err((StatusCode::BAD_REQUEST, "unknown order source".into())),
    };
    let lock = user_lock(&u.id);
    let _guard = if o.preview { None } else { Some(lock.lock().await) };
    // The fill is priced the moment the order arrives: balance, positions and the live
    // quote load side by side, so a demo order answers in one database round trip.
    let (acct, q) = tokio::join!(account_rows(&c, &u.id), quote(&c.app, &o.mint));
    let (cash, _, _, rows) = acct?;
    let held = rows.iter().find(|p| p["mint"].as_str() == Some(&o.mint)).map(|p| num(&p["tokens"])).unwrap_or(0.0);
    let q = q?.held(held);
    let fill = match o.side.as_str() {
        "buy" => {
            let usd = o.usd.filter(|v| v.is_finite()).ok_or((StatusCode::BAD_REQUEST, "enter an amount".into()))?;
            if usd < MIN_ORDER_USD {
                return Err((StatusCode::BAD_REQUEST, "minimum order is $1".into()));
            }
            if usd > cash + 1e-9 {
                return Err((StatusCode::BAD_REQUEST, format!("not enough demo balance (${cash:.2} available)")));
            }
            q.buy(usd).ok_or((StatusCode::BAD_REQUEST, "amount too small after fees".into()))?
        }
        "sell" => {
            let f = o.fraction.filter(|f| *f > 0.0 && *f <= 1.0).ok_or((StatusCode::BAD_REQUEST, "choose how much to sell".into()))?;
            if held <= 0.0 {
                return Err((StatusCode::BAD_REQUEST, "you hold none of this coin".into()));
            }
            q.sell(held * f).ok_or((StatusCode::BAD_REQUEST, "nothing to sell".into()))?
        }
        _ => return Err((StatusCode::BAD_REQUEST, "side must be buy or sell".into())),
    };
    if o.preview {
        return Ok(Json(json!({ "fill": fill, "symbol": q.symbol })));
    }
    let res = c
        .acct
        .rest(
            reqwest::Method::POST,
            "rpc/demo_fill",
            Some(json!({
                "p_user": u.id, "p_mint": o.mint, "p_symbol": q.symbol, "p_side": fill.side, "p_tokens": fill.tokens,
                "p_usd": fill.usd, "p_sol": fill.sol, "p_price_usd": fill.price_usd, "p_fee_usd": fill.fee_usd,
                "p_impact": fill.impact_pct, "p_source": source, "p_start": START_USD
            })),
        )
        .await?;
    if fill.side == "sell" && o.fraction.unwrap_or(0.0) >= 0.999 {
        // Closing the position cancels its sell orders; the answer does not wait for it.
        let (c2, uid, mint) = (c.clone(), u.id.clone(), o.mint.clone());
        tokio::spawn(async move { cancel_open(&c2, &uid, Some(&mint), "position closed").await });
    }
    Ok(Json(json!({ "fill": fill, "symbol": q.symbol, "cash_usd": num(&res["cash_usd"]), "realized_usd": res["realized_usd"] })))
}

/// `POST /demo/reset`: back to the starting balance; trade history is kept.
pub async fn reset(State(c): State<DemoCtx>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let lock = user_lock(&u.id);
    let _guard = lock.lock().await;
    c.acct.rest(reqwest::Method::POST, "rpc/demo_reset", Some(json!({ "p_user": u.id, "p_start": START_USD }))).await?;
    cancel_open(&c, &u.id, None, "account reset").await;
    Ok(Json(json!({ "cash_usd": START_USD })))
}

#[derive(Deserialize)]
pub struct TradesQuery {
    limit: Option<u32>,
}

/// `GET /demo/trades`: every demo trade, newest first, for analysis.
pub async fn trades(State(c): State<DemoCtx>, headers: HeaderMap, Query(q): Query<TradesQuery>) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let limit = q.limit.unwrap_or(500).clamp(1, 2000);
    let v = c
        .acct
        .rest(
            reqwest::Method::GET,
            &format!("demo_trades?user_id=eq.{}&select=id,mint,symbol,side,tokens,usd,sol,price_usd,fee_usd,impact_pct,source,realized_usd,round,ts&order=ts.desc&limit={limit}", u.id),
            None,
        )
        .await?;
    Ok(Json(v))
}

/* ---------------- Orders: limit, take profit, stop loss, trailing ---------------- */

/// Open orders per account.
const MAX_OPEN_ORDERS: usize = 20;
/// How often the gateway checks open orders against live prices.
const ORDER_CHECK: Duration = Duration::from_secs(2);
/// A trailing stop's highest price is saved when the price beats it by this share, so a
/// rising coin does not cost a database write every two seconds.
const PEAK_STEP: f64 = 0.005;

#[derive(Deserialize)]
pub struct OrderRuleIn {
    mint: String,
    /// "tp", "sl", "limit_buy", "limit_sell" or "trail".
    kind: String,
    /// Take profit / stop loss: move from the average entry price in %.
    pct: Option<f64>,
    /// Limit orders: the price that fires the order, in USD.
    price_usd: Option<f64>,
    /// Sells: share of the position to sell, 0 to 1 (default all).
    fraction: Option<f64>,
    /// Limit buys: cash to spend.
    usd: Option<f64>,
    /// Trailing stops: sell when the price falls this % below its highest since placing.
    trail_pct: Option<f64>,
}

/// Checks a take-profit / stop-loss request; returns (kind, pct, fraction).
pub fn check_rule(kind: &str, pct: f64, fraction: Option<f64>) -> Result<(&'static str, f64, f64), String> {
    let f = fraction.unwrap_or(1.0);
    if !(f > 0.0 && f <= 1.0) {
        return Err("choose how much to sell".into());
    }
    if !pct.is_finite() {
        return Err("enter a percent".into());
    }
    match kind {
        "tp" if (1.0..=10_000.0).contains(&pct) => Ok(("tp", pct, f)),
        "sl" if (-95.0..=-1.0).contains(&pct) => Ok(("sl", pct, f)),
        "tp" => Err("take profit must be between +1% and +10000%".into()),
        "sl" => Err("stop loss must be between -1% and -95%".into()),
        _ => Err("kind must be tp or sl".into()),
    }
}

/// A checked order: what fires it and what it does.
#[derive(Debug, Clone, PartialEq)]
pub struct OrderSpec {
    pub kind: &'static str,
    pub trigger_price: f64,
    pub trigger_pct: f64,
    pub fraction: f64,
    pub usd: Option<f64>,
    pub trail_pct: Option<f64>,
    pub peak: Option<f64>,
}

/// Turns a request into an order, given the live price and (for sells) the average entry
/// price. The same rules the browser's real-order engine follows (lib/orders.ts).
pub fn check_order(o: &OrderRuleIn, price: f64, entry: Option<f64>, cash: f64) -> Result<OrderSpec, String> {
    if !(price.is_finite() && price > 0.0) {
        return Err("this coin has no live price".into());
    }
    let fraction = o.fraction.unwrap_or(1.0);
    if !(fraction > 0.0 && fraction <= 1.0) {
        return Err("choose how much to sell".into());
    }
    let need_entry = || entry.filter(|e| *e > 0.0).ok_or_else(|| "buy the coin first".to_string());
    let target = || o.price_usd.filter(|p| p.is_finite() && *p > 0.0).ok_or_else(|| "enter a price".to_string());
    match o.kind.as_str() {
        // By percent from the entry (the buy ticket's TP/SL fields).
        "tp" | "sl" if o.pct.is_some() => {
            let entry = need_entry()?;
            let (kind, pct, fraction) = check_rule(&o.kind, o.pct.unwrap_or(0.0), Some(fraction))?;
            Ok(OrderSpec { kind, trigger_price: entry * (1.0 + pct / 100.0), trigger_pct: pct, fraction, usd: None, trail_pct: None, peak: None })
        }
        // By price (the Orders card): the same rule as real orders, relative to the market,
        // so a stop loss above the entry (locking in profit) is allowed.
        "tp" | "sl" => {
            let entry = need_entry()?;
            let p = target()?;
            let tp = o.kind == "tp";
            if tp && p <= price {
                return Err("a take profit must be above the current price".into());
            }
            if !tp && p >= price {
                return Err("a stop loss must be below the current price".into());
            }
            Ok(OrderSpec { kind: if tp { "tp" } else { "sl" }, trigger_price: p, trigger_pct: (p / entry - 1.0) * 100.0, fraction, usd: None, trail_pct: None, peak: None })
        }
        "limit_sell" => {
            let entry = need_entry()?;
            let p = target()?;
            if p <= price {
                return Err("a limit sell must be above the current price".into());
            }
            Ok(OrderSpec { kind: "limit_sell", trigger_price: p, trigger_pct: (p / entry - 1.0) * 100.0, fraction, usd: None, trail_pct: None, peak: None })
        }
        "limit_buy" => {
            let p = target()?;
            if p >= price {
                return Err("a limit buy must be below the current price".into());
            }
            let usd = o.usd.filter(|u| u.is_finite()).ok_or("enter an amount")?;
            if usd < MIN_ORDER_USD {
                return Err("minimum order is $1".into());
            }
            if usd > cash + 1e-9 {
                return Err(format!("not enough demo balance (${cash:.2} available)"));
            }
            Ok(OrderSpec { kind: "limit_buy", trigger_price: p, trigger_pct: (p / price - 1.0) * 100.0, fraction: 1.0, usd: Some(usd), trail_pct: None, peak: None })
        }
        "trail" => {
            need_entry()?;
            let t = o.trail_pct.filter(|t| t.is_finite() && (1.0..=90.0).contains(t)).ok_or("trailing stop must be between 1% and 90%")?;
            Ok(OrderSpec { kind: "trail", trigger_price: price * (1.0 - t / 100.0), trigger_pct: -t, fraction, usd: None, trail_pct: Some(t), peak: Some(price) })
        }
        _ => Err("unknown order type".into()),
    }
}

/// Has the market crossed an order's trigger? Trailing stops pass their (updated) trigger.
pub fn triggered(kind: &str, trigger: f64, price: f64) -> bool {
    match kind {
        "tp" | "limit_sell" => price >= trigger,
        "sl" | "limit_buy" | "trail" => price <= trigger,
        _ => false,
    }
}

/// A trailing stop after a new price: (highest price, trigger, whether the peak moved
/// enough to save).
pub fn trail_step(peak: f64, trail_pct: f64, price: f64) -> (f64, f64, bool) {
    let high = peak.max(price);
    (high, high * (1.0 - trail_pct / 100.0), price > peak * (1.0 + PEAK_STEP))
}

/// `POST /demo/orders`: place a limit buy or sell, take profit, stop loss or trailing stop.
pub async fn create_rule(State(c): State<DemoCtx>, headers: HeaderMap, Json(o): Json<OrderRuleIn>) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    if !crate::account::is_solana_address(&o.mint) {
        return Err((StatusCode::BAD_REQUEST, "not a coin address".into()));
    }
    let (cash, _, round, rows) = account_rows(&c, &u.id).await?;
    let pos = rows.iter().find(|p| p["mint"].as_str() == Some(&o.mint));
    let entry = pos.map(|p| (num(&p["tokens"]), num(&p["cost_usd"]))).filter(|(t, c)| *t > 0.0 && *c > 0.0).map(|(t, c)| c / t);
    let q = quote(&c.app, &o.mint).await?;
    let spec = check_order(&o, q.price_usd, entry, cash).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let open = c.acct.rest(reqwest::Method::GET, &format!("demo_orders?user_id=eq.{}&status=eq.open&select=id", u.id), None).await?;
    if open.as_array().map_or(0, Vec::len) >= MAX_OPEN_ORDERS {
        return Err((StatusCode::BAD_REQUEST, format!("at most {MAX_OPEN_ORDERS} open orders")));
    }
    let symbol = pos.and_then(|p| p["symbol"].as_str()).filter(|s| !s.is_empty()).unwrap_or(&q.symbol);
    let mut row = json!({
        "user_id": u.id, "mint": o.mint, "symbol": symbol, "kind": spec.kind,
        "trigger_pct": spec.trigger_pct, "trigger_price_usd": spec.trigger_price, "fraction": spec.fraction, "round": round
    });
    // Only the newer kinds use the newer columns, so take profit and stop loss keep
    // working on a database without migration 0009.
    if let Some(v) = spec.usd {
        row["usd"] = json!(v);
    }
    if let Some(v) = spec.trail_pct {
        row["trail_pct"] = json!(v);
    }
    if let Some(v) = spec.peak {
        row["peak_price_usd"] = json!(v);
    }
    // The database's own error is not passed on; the newer kinds failing means the
    // database has not had update 0009 yet.
    let newer = matches!(spec.kind, "limit_buy" | "limit_sell" | "trail");
    let v = c.acct.rest(reqwest::Method::POST, "demo_orders", Some(row)).await.map_err(|(s, e)| {
        if newer {
            (StatusCode::SERVICE_UNAVAILABLE, "limit buys, limit sells and trailing stops need database update 0009 (supabase/migrations/0009_orders.sql)".to_string())
        } else {
            (s, e)
        }
    })?;
    Ok(Json(v.as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null)))
}

/// `GET /demo/orders`: the latest orders, open and done.
pub async fn list_rules(State(c): State<DemoCtx>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let path = |cols: &str| format!("demo_orders?user_id=eq.{}&select=id,mint,symbol,kind,trigger_pct,trigger_price_usd,fraction,status,note,created_at,done_at{cols}&order=created_at.desc&limit=100", u.id);
    // Before migration 0009 the newer columns do not exist yet.
    let v = match c.acct.rest(reqwest::Method::GET, &path(",usd,trail_pct,peak_price_usd"), None).await {
        Ok(v) => v,
        Err(_) => c.acct.rest(reqwest::Method::GET, &path(""), None).await?,
    };
    Ok(Json(v))
}

/// `POST /demo/orders/{id}/cancel`.
pub async fn cancel_rule(State(c): State<DemoCtx>, headers: HeaderMap, Path(id): Path<i64>) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let v = c
        .acct
        .rest(
            reqwest::Method::PATCH,
            &format!("demo_orders?id=eq.{id}&user_id=eq.{}&status=eq.open", u.id),
            Some(json!({ "status": "cancelled", "note": "cancelled", "done_at": crate::account::chrono_iso(now_secs()) })),
        )
        .await?;
    if v.as_array().is_none_or(Vec::is_empty) {
        return Err((StatusCode::NOT_FOUND, "order not open".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct PriceQuery {
    mints: String,
}

/// `GET /price?mints=a,b`: the live price the demo order engine fills against, so the
/// browser's real-order engine fires on exactly the same price. At most 20 coins.
pub async fn prices(State(c): State<DemoCtx>, Query(q): Query<PriceQuery>) -> Json<Value> {
    let mut out = serde_json::Map::new();
    for mint in q.mints.split(',').map(str::trim).filter(|m| crate::account::is_solana_address(m)).take(20) {
        let p = quote(&c.app, mint).await.ok().map(|q| q.price_usd);
        out.insert(mint.to_string(), json!(p));
    }
    Json(Value::Object(out))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Cancels a user's open orders: all of them (reset) or one coin's sells (position
/// closed; a limit buy on that coin stays, it does not need the position).
async fn cancel_open(c: &DemoCtx, user: &str, mint: Option<&str>, note: &str) {
    let filter = mint.map(|m| format!("&mint=eq.{m}&kind=neq.limit_buy")).unwrap_or_default();
    let _ = c
        .acct
        .rest(
            reqwest::Method::PATCH,
            &format!("demo_orders?user_id=eq.{user}&status=eq.open{filter}"),
            Some(json!({ "status": "cancelled", "note": note, "done_at": crate::account::chrono_iso(now_secs()) })),
        )
        .await;
}

/// Background task: every two seconds, fills at the live market any open demo order whose
/// trigger the price has crossed, and moves trailing stops up. An order is claimed
/// (status set) before it fills, so it can never fire twice.
pub async fn watch_rules(c: DemoCtx) {
    let mut tick = tokio::time::interval(ORDER_CHECK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        let base = "demo_orders?status=eq.open&select=id,user_id,mint,kind,trigger_price_usd,fraction";
        let open = match c.acct.rest(reqwest::Method::GET, &format!("{base},usd,trail_pct,peak_price_usd&order=id.asc&limit=2000"), None).await {
            Ok(v) => v,
            // Database without migration 0009: take profit and stop loss only.
            Err(_) => match c.acct.rest(reqwest::Method::GET, &format!("{base}&order=id.asc&limit=2000"), None).await {
                Ok(v) => v,
                Err(_) => continue,
            },
        };
        let open = open.as_array().cloned().unwrap_or_default();
        let mut prices: HashMap<String, Option<f64>> = HashMap::new();
        for o in open {
            let mint = o["mint"].as_str().unwrap_or("").to_string();
            if !prices.contains_key(&mint) {
                let p = quote(&c.app, &mint).await.ok().map(|q| q.price_usd);
                prices.insert(mint.clone(), p);
            }
            let Some(price) = prices[&mint] else { continue };
            let id = o["id"].as_i64().unwrap_or(0);
            let kind = o["kind"].as_str().unwrap_or("").to_string();
            let mut trigger = num(&o["trigger_price_usd"]);
            if kind == "trail" {
                let (peak, t) = (num(&o["peak_price_usd"]), num(&o["trail_pct"]));
                if peak <= 0.0 || t <= 0.0 {
                    continue;
                }
                let (high, trig, save) = trail_step(peak, t, price);
                trigger = trig;
                if save {
                    let _ = c
                        .acct
                        .rest(reqwest::Method::PATCH, &format!("demo_orders?id=eq.{id}&status=eq.open"), Some(json!({ "peak_price_usd": high, "trigger_price_usd": trig })))
                        .await;
                }
            }
            if !triggered(&kind, trigger, price) {
                continue;
            }
            let user = o["user_id"].as_str().unwrap_or("").to_string();
            let usd = o["usd"].as_f64().or_else(|| o["usd"].as_str().and_then(|s| s.parse().ok()));
            if let Err(e) = fire(&c, id, &user, &mint, &kind, num(&o["fraction"]), usd).await {
                tracing::warn!(id, %mint, error = %e.1, "demo order failed");
            }
        }
    }
}

async fn mark(c: &DemoCtx, id: i64, status: &str, note: String) {
    let _ = c.acct.rest(reqwest::Method::PATCH, &format!("demo_orders?id=eq.{id}"), Some(json!({ "status": status, "note": note }))).await;
}

async fn fire(c: &DemoCtx, id: i64, user: &str, mint: &str, kind: &str, fraction: f64, usd: Option<f64>) -> Result<(), (StatusCode, String)> {
    let lock = user_lock(user);
    let _guard = lock.lock().await;
    // Claim it first: only one fill per order, even if two checks overlap.
    let claimed = c
        .acct
        .rest(
            reqwest::Method::PATCH,
            &format!("demo_orders?id=eq.{id}&status=eq.open"),
            Some(json!({ "status": "filled", "done_at": crate::account::chrono_iso(now_secs()) })),
        )
        .await?;
    if claimed.as_array().is_none_or(Vec::is_empty) {
        return Ok(());
    }
    let (cash, _, _, rows) = account_rows(c, user).await?;
    let held = rows.iter().find(|p| p["mint"].as_str() == Some(mint)).map(|p| num(&p["tokens"])).unwrap_or(0.0);
    let buying = kind == "limit_buy";
    if !buying && held <= 0.0 {
        mark(c, id, "cancelled", "position already closed".into()).await;
        return Ok(());
    }
    let q = match quote(&c.app, mint).await {
        Ok(q) => q,
        Err(e) => {
            mark(c, id, "open", String::new()).await;
            return Err(e);
        }
    };
    let fill = if buying {
        let want = usd.unwrap_or(0.0);
        if want > cash + 1e-9 {
            mark(c, id, "cancelled", format!("not enough demo balance (${cash:.2} available)")).await;
            return Ok(());
        }
        q.held(held).buy(want)
    } else {
        q.held(held).sell(held * fraction)
    };
    let Some(fill) = fill else {
        mark(c, id, "cancelled", if buying { "amount too small after fees" } else { "nothing to sell" }.into()).await;
        return Ok(());
    };
    let res = c
        .acct
        .rest(
            reqwest::Method::POST,
            "rpc/demo_fill",
            Some(json!({
                "p_user": user, "p_mint": mint, "p_symbol": q.symbol, "p_side": fill.side, "p_tokens": fill.tokens,
                "p_usd": fill.usd, "p_sol": fill.sol, "p_price_usd": fill.price_usd, "p_fee_usd": fill.fee_usd,
                "p_impact": fill.impact_pct, "p_source": kind, "p_start": START_USD
            })),
        )
        .await;
    match res {
        Ok(r) => {
            let note = if buying {
                format!("bought ${:.2} at ${}", fill.usd, fill.price_usd)
            } else {
                let size = if fraction >= 0.999 { "all".to_string() } else { format!("{:.0}%", fraction * 100.0) };
                format!("sold {size} for ${:.2}, P&L {:+.2}", fill.usd, num(&r["realized_usd"]))
            };
            mark(c, id, "filled", note).await;
            if !buying && fraction >= 0.999 {
                cancel_open(c, user, Some(mint), "position closed").await;
            }
            tracing::info!(id, mint, kind, usd = fill.usd, "demo order filled");
            Ok(())
        }
        Err(e) => {
            mark(c, id, "cancelled", format!("could not fill: {}", e.1)).await;
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pump(price_sol: f64) -> Quote {
        Quote::from_curve("T".into(), price_sol, 150.0).expect("quote")
    }

    #[test]
    fn a_fresh_pump_curve_matches_its_start_price() {
        // A new pump.fun coin: 30 virtual SOL against 1.073B tokens.
        let p = 30.0 / 1_073_000_000.0;
        let q = pump(p);
        let Depth::Curve { v_sol, v_tok } = q.depth else { panic!("curve") };
        assert!((v_sol - 30.0).abs() < 1e-6);
        assert!((v_tok - 1_073_000_000.0).abs() < 1.0);
    }

    #[test]
    fn buying_costs_fees_and_impact_and_selling_back_loses_money() {
        let q = pump(30.0 / 1_073_000_000.0);
        let buy = q.buy(1_000.0).expect("buy");
        assert!(buy.price_usd > q.price_usd, "a buy pays above the market");
        assert!(buy.impact_pct > 1.0, "fee plus impact");
        // Selling straight back at the same moment never makes money.
        let after = Quote { depth: Depth::Curve { v_sol: 30.0 + (1_000.0 - buy.fee_usd) / 150.0, v_tok: PUMP_K / (30.0 + (1_000.0 - buy.fee_usd) / 150.0) }, ..q.clone() };
        let sell = after.sell(buy.tokens).expect("sell");
        assert!(sell.usd < 1_000.0);
        assert!(sell.usd > 950.0, "round trip costs about 2% fees: {}", sell.usd);
    }

    #[test]
    fn bigger_orders_move_the_price_more() {
        let q = pump(1e-7);
        let small = q.buy(10.0).expect("small");
        let big = q.buy(5_000.0).expect("big");
        assert!(big.impact_pct > small.impact_pct);
    }

    #[test]
    fn thin_pools_hurt_and_deep_pools_barely_move() {
        let thin = Quote { symbol: "A".into(), price_usd: 0.01, sol_usd: 150.0, depth: Depth::Pool { reserve_usd: 2_000.0 } };
        let deep = Quote { depth: Depth::Pool { reserve_usd: 5_000_000.0 }, ..thin.clone() };
        let t = thin.buy(1_000.0).expect("thin");
        let d = deep.buy(1_000.0).expect("deep");
        assert!(t.impact_pct > 30.0, "thin pool: {}", t.impact_pct);
        assert!(d.impact_pct < 1.2, "deep pool: {}", d.impact_pct);
        // A rugged coin (almost no liquidity) sells for almost nothing.
        let rug = Quote { depth: Depth::Pool { reserve_usd: 5.0 }, ..thin };
        assert!(rug.sell(1_000_000.0).expect("rug").usd < 5.0);
    }

    #[test]
    fn buying_then_selling_costs_two_fees_like_on_chain() {
        for (name, q) in [
            ("thin curve", Quote::from_curve("T".into(), 4e-8, 150.0).expect("curve")),
            ("deep pool", Quote { symbol: "D".into(), price_usd: 1.0, sol_usd: 150.0, depth: Depth::Pool { reserve_usd: 5_000_000.0 } }),
            ("thin pool", Quote { symbol: "P".into(), price_usd: 1.0, sol_usd: 150.0, depth: Depth::Pool { reserve_usd: 4_000.0 } }),
        ] {
            let buy = q.buy(100.0).expect("buy");
            let back = q.held(buy.tokens).sell(buy.tokens).expect("sell");
            let round_trip = (back.usd / 100.0 - 1.0) * 100.0;
            assert!(round_trip > -1.2 && round_trip < -0.8, "{name}: round trip {round_trip:.2}% should be about two 0.5% fees");
        }
    }

    #[test]
    fn a_fresh_buy_only_shows_its_entry_costs() {
        // $100 into a deep pool: right after buying, the position is marked at the market
        // price, so the only loss shown is the buy's fee and impact (about 0.5%), not the
        // fee of a sale that has not happened.
        let q = Quote { symbol: "X".into(), price_usd: 1.0, sol_usd: 150.0, depth: Depth::Pool { reserve_usd: 5_000_000.0 } };
        let buy = q.buy(100.0).expect("buy");
        let marked = mark_value(buy.tokens, &q);
        let shown = (marked - 100.0) / 100.0 * 100.0;
        assert!(shown > -0.7 && shown < -0.4, "shown loss {shown:.2}% is the entry cost only");
        let exit = q.sell(buy.tokens).expect("sell").usd;
        assert!(exit < marked, "selling now still costs the sale's fee and impact");
    }

    #[test]
    fn take_profit_and_stop_loss_rules() {
        assert_eq!(check_rule("tp", 50.0, None), Ok(("tp", 50.0, 1.0)));
        assert_eq!(check_rule("sl", -20.0, Some(0.5)), Ok(("sl", -20.0, 0.5)));
        assert!(check_rule("tp", -5.0, None).is_err());
        assert!(check_rule("sl", 10.0, None).is_err());
        assert!(check_rule("sl", -99.0, None).is_err());
        assert!(check_rule("tp", 50.0, Some(0.0)).is_err());
        assert!(check_rule("tp", f64::NAN, None).is_err());
        assert!(check_rule("buy", 5.0, None).is_err());
        assert!(triggered("tp", 1.5, 1.5) && !triggered("tp", 1.5, 1.49));
        assert!(triggered("sl", 0.8, 0.79) && !triggered("sl", 0.8, 0.81));
    }

    fn req(kind: &str) -> OrderRuleIn {
        OrderRuleIn { mint: "M".into(), kind: kind.into(), pct: None, price_usd: None, fraction: None, usd: None, trail_pct: None }
    }

    #[test]
    fn limit_and_trailing_orders() {
        // Live price 1.0, bought at 0.8, $500 cash.
        let (price, entry, cash) = (1.0, Some(0.8), 500.0);
        let buy = check_order(&OrderRuleIn { price_usd: Some(0.7), usd: Some(100.0), ..req("limit_buy") }, price, None, cash).unwrap();
        assert_eq!((buy.kind, buy.trigger_price, buy.usd), ("limit_buy", 0.7, Some(100.0)));
        assert!((buy.trigger_pct + 30.0).abs() < 1e-9, "-30% from the price when placed");
        assert!(check_order(&OrderRuleIn { price_usd: Some(1.2), usd: Some(100.0), ..req("limit_buy") }, price, None, cash).is_err(), "a buy limit above the market");
        assert!(check_order(&OrderRuleIn { price_usd: Some(0.7), usd: Some(900.0), ..req("limit_buy") }, price, None, cash).is_err(), "more than the balance");
        assert!(check_order(&OrderRuleIn { price_usd: Some(0.7), ..req("limit_buy") }, price, None, cash).is_err(), "no amount");

        let sell = check_order(&OrderRuleIn { price_usd: Some(1.6), fraction: Some(0.5), ..req("limit_sell") }, price, entry, cash).unwrap();
        assert_eq!((sell.kind, sell.trigger_price, sell.fraction), ("limit_sell", 1.6, 0.5));
        assert!((sell.trigger_pct - 100.0).abs() < 1e-9, "+100% from the entry");
        assert!(check_order(&OrderRuleIn { price_usd: Some(0.9), ..req("limit_sell") }, price, entry, cash).is_err(), "a sell limit below the market");
        assert!(check_order(&OrderRuleIn { price_usd: Some(1.6), ..req("limit_sell") }, price, None, cash).is_err(), "nothing held");

        // Take profit and stop loss by price follow the market, like real orders.
        let tp = check_order(&OrderRuleIn { price_usd: Some(1.2), ..req("tp") }, price, entry, cash).unwrap();
        assert!((tp.trigger_pct - 50.0).abs() < 1e-9 && (tp.trigger_price - 1.2).abs() < 1e-12);
        let lock_in = check_order(&OrderRuleIn { price_usd: Some(0.9), ..req("sl") }, price, entry, cash).unwrap();
        assert!(lock_in.trigger_pct > 0.0, "a stop above the entry locks in profit");
        assert!(check_order(&OrderRuleIn { price_usd: Some(1.1), ..req("sl") }, price, entry, cash).is_err(), "a stop above the market");
        // By percent, the old rules still apply.
        assert!(check_order(&OrderRuleIn { pct: Some(-20.0), ..req("sl") }, price, entry, cash).is_ok());
        assert!(check_order(&OrderRuleIn { pct: Some(20.0), ..req("sl") }, price, entry, cash).is_err());

        let trail = check_order(&OrderRuleIn { trail_pct: Some(20.0), ..req("trail") }, price, entry, cash).unwrap();
        assert_eq!((trail.peak, trail.trail_pct), (Some(1.0), Some(20.0)));
        assert!((trail.trigger_price - 0.8).abs() < 1e-12);
        assert!(check_order(&OrderRuleIn { trail_pct: Some(95.0), ..req("trail") }, price, entry, cash).is_err());

        // The trail follows the price up and fires on the way down.
        let (high, trig, save) = trail_step(1.0, 20.0, 1.5);
        assert_eq!(high, 1.5);
        assert!((trig - 1.2).abs() < 1e-12 && save);
        let (high, trig, save) = trail_step(1.5, 20.0, 1.3);
        assert_eq!(high, 1.5, "a dip does not lower the peak");
        assert!(!save && !triggered("trail", trig, 1.3) && triggered("trail", trig, 1.19));
        assert!(!trail_step(1.0, 20.0, 1.004).2, "tiny new highs are not saved every tick");

        assert!(triggered("limit_buy", 0.7, 0.69) && !triggered("limit_buy", 0.7, 0.71));
        assert!(triggered("limit_sell", 1.6, 1.6) && !triggered("limit_sell", 1.6, 1.59));
        assert!(check_order(&req("moon"), price, entry, cash).is_err());
    }

    #[test]
    fn tiny_orders_that_fees_eat_are_refused() {
        let q = pump(1e-7);
        assert!(q.buy(0.01).is_none());
    }
}
