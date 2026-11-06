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
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

pub const START_USD: f64 = 10_000.0;
const FEE: f64 = 0.01;
/// Network and priority fee per transaction, in SOL.
const NETWORK_SOL: f64 = 0.0001;
/// Real orders land about a second after the click.
const LATENCY: Duration = Duration::from_millis(1000);
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

    /// Buy with `usd` cash. Fees come off first, the rest moves the price.
    pub fn buy(&self, usd: f64) -> Option<Fill> {
        let fee = usd * FEE + NETWORK_SOL * self.sol_usd;
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
        let fee = gross * FEE + NETWORK_SOL * self.sol_usd;
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
        None => {
            let url = format!("https://lite-api.jup.ag/tokens/v2/search?query={mint}");
            let list: Vec<Value> = app.http.get(&url).timeout(Duration::from_secs(8)).send().await.ok().and_then(|r| r.error_for_status().ok()).ok_or((StatusCode::BAD_GATEWAY, "price service busy, try again".into()))?.json().await.unwrap_or_default();
            let t = list.into_iter().find(|t| t["id"].as_str() == Some(mint)).ok_or((StatusCode::NOT_FOUND, "no live market for this coin".into()))?;
            (t["symbol"].as_str().unwrap_or("").to_string(), t["usdPrice"].as_f64(), t["liquidity"].as_f64())
        }
    };
    let price_usd = price.filter(|p| *p > 0.0).ok_or((StatusCode::NOT_FOUND, "no live price for this coin".into()))?;
    let reserve_usd = liquidity.filter(|l| *l > 0.0).map(|l| l / 2.0).ok_or((StatusCode::NOT_FOUND, "this coin has no liquidity to trade".into()))?;
    Ok(Quote { symbol, price_usd, sol_usd, depth: Depth::Pool { reserve_usd } })
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
    pub value_usd: Option<f64>,
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
    let acc = c.acct.rest(reqwest::Method::GET, &format!("demo_accounts?user_id=eq.{user}&select=cash_usd,start_usd,resets"), None).await?;
    let (cash, start, round) = acc
        .as_array()
        .and_then(|a| a.first())
        .map(|a| (num(&a["cash_usd"]), num(&a["start_usd"]), a["resets"].as_i64().unwrap_or(0)))
        .unwrap_or((START_USD, START_USD, 0));
    let pos = c.acct.rest(reqwest::Method::GET, &format!("demo_positions?user_id=eq.{user}&select=mint,symbol,tokens,cost_usd,opened_at&order=opened_at.desc"), None).await?;
    Ok((cash, start, round, pos.as_array().cloned().unwrap_or_default()))
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
        // What the position would sell for now, after impact and fees: honest equity.
        let q = quote(&c.app, &mint).await.ok();
        let value = q.as_ref().and_then(|q| q.sell(tokens)).map(|f| f.usd).or(Some(0.0).filter(|_| q.is_none()));
        positions.push(Position {
            symbol: p["symbol"].as_str().filter(|s| !s.is_empty()).map(String::from).or_else(|| q.as_ref().map(|q| q.symbol.clone())).unwrap_or_default(),
            mint,
            tokens,
            cost_usd: num(&p["cost_usd"]),
            price_usd: q.as_ref().map(|q| q.price_usd),
            value_usd: value,
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
    let (cash, _, _, rows) = account_rows(&c, &u.id).await?;
    let held = rows.iter().find(|p| p["mint"].as_str() == Some(&o.mint)).map(|p| num(&p["tokens"])).unwrap_or(0.0);

    if !o.preview {
        tokio::time::sleep(LATENCY).await;
    }
    let q = quote(&c.app, &o.mint).await?;
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
    Ok(Json(json!({ "fill": fill, "symbol": q.symbol, "cash_usd": num(&res["cash_usd"]), "realized_usd": res["realized_usd"] })))
}

/// `POST /demo/reset`: back to the starting balance; trade history is kept.
pub async fn reset(State(c): State<DemoCtx>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, String)> {
    let u = c.acct.user(&headers).await?;
    let lock = user_lock(&u.id);
    let _guard = lock.lock().await;
    c.acct.rest(reqwest::Method::POST, "rpc/demo_reset", Some(json!({ "p_user": u.id, "p_start": START_USD }))).await?;
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
    fn tiny_orders_that_fees_eat_are_refused() {
        let q = pump(1e-7);
        assert!(q.buy(0.01).is_none());
    }
}
