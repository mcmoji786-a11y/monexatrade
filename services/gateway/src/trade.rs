//! Real trading on Solana mainnet, non-custodial.
//!
//! The gateway builds a swap transaction for the user's own wallet, simulates it, and
//! hands it back unsigned. The user signs it in Phantom; the private key never leaves
//! the wallet. The gateway then checks the signed transaction is exactly the one it
//! built, sends it through Helius Sender (and the Helius RPC as a backup), watches it
//! until it lands or its blockhash expires, and records the outcome.
//!
//! Founder decisions (docs/decisions/0005-real-trading.md): Phantom only, 1% platform
//! fee on buys and sells, at most 3 SOL per trade, MEV protection on by default, and
//! the admin switch off until the founder turns it on.

use crate::account::AccountState;
use crate::solana_tx::{self as stx, AccountMeta, Instruction, LookupTable, Pubkey};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub const WSOL: &str = "So11111111111111111111111111111111111111112";
pub const JUPITER_PROGRAM: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/// Platform fee in basis points (founder decision: 1%).
pub const FEE_BPS: u64 = 100;
/// Largest trade in lamports (founder decision: 3 SOL), on the SOL side of the swap.
pub const MAX_LAMPORTS: u64 = 3_000_000_000;
const MIN_LAMPORTS: u64 = 1_000_000;
const MAX_SLIPPAGE_BPS: u64 = 5_000;
/// Base network fee per signature.
const NETWORK_FEE: u64 = 5_000;
/// What a buy needs on top of its amount: a new token account's rent and some fees.
const BUY_RESERVE: u64 = 3_000_000;
/// A built transaction can be sent within this time; its blockhash lasts about 60 s.
const BUILD_TTL: Duration = Duration::from_secs(50);
/// Helius Sender tip accounts (docs, mainnet).
pub const TIP_ACCOUNTS: [&str; 10] = [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
    "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
    "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
    "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
    "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
    "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
    "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
    "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
    "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
];

/// Execution speed: how much priority fee and Sender tip a trade pays.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Speed {
    pub name: &'static str,
    /// Helius priority level used for the fee estimate.
    level: &'static str,
    pub tip: u64,
    /// Priority fee floor and ceiling in micro-lamports per compute unit.
    min_price: u64,
    /// Most the priority fee may cost in total, in lamports.
    max_priority: u64,
    /// Sender's staked-connection-only mode (lower minimum tip, fewer pathways).
    swqos_only: bool,
}

pub const FAST: Speed = Speed { name: "fast", level: "high", tip: 5_000, min_price: 20_000, max_priority: 1_000_000, swqos_only: true };
pub const TURBO: Speed = Speed { name: "turbo", level: "veryHigh", tip: 1_000_000, min_price: 100_000, max_priority: 3_000_000, swqos_only: false };

pub fn speed(name: &str) -> Speed {
    if name == "fast" { FAST } else { TURBO }
}

/// Priority fee in micro-lamports per CU, inside the speed's floor and total cap.
pub fn priority_price(estimate: u64, cu_limit: u32, s: Speed) -> u64 {
    let cap = s.max_priority.saturating_mul(1_000_000) / cu_limit.max(1) as u64;
    estimate.max(s.min_price).min(cap)
}

pub fn fee_of(lamports: u64) -> u64 {
    lamports * FEE_BPS / 10_000
}

/// Why a trade failed, in words a trader understands, from the error and program logs.
/// Programs log their error names (Anchor), so names are matched; a bare error number
/// means different things in different programs, so numbers are only read for Jupiter.
pub fn diagnose(err: &Value, logs: &[String]) -> (&'static str, &'static str, &'static str) {
    let text = format!("{} {}", err, logs.join(" ")).to_ascii_lowercase();
    let has = |s: &str| text.contains(s);
    let jupiter = |code: &str| has(&format!("{} failed: custom program error: {code}", JUPITER_PROGRAM.to_ascii_lowercase()));
    // Every venue names its slippage error differently (ExceededSlippage, TooMuchSolRequired,
    // BuySlippageBelowMinBaseAmountOut, ...), so any Anchor error whose name says slippage counts.
    let anchor_slippage = text.split("error code: ").skip(1).any(|rest| rest.split(|c: char| !c.is_ascii_alphanumeric()).next().is_some_and(|name| name.contains("slippage")));
    if anchor_slippage || has("slippagetoleranceexceeded") || has("exceededslippage") || has("toomuchsolrequired") || has("toolittlesolreceived") || jupiter("0x1771") {
        ("slippage", "The price moved more than your slippage allows", "Raise slippage or try again")
    } else if has("insufficientfundsforfee") || has("insufficient lamports") || has("no record of a prior credit") || has("insufficientfundsforrent") {
        ("no_sol", "Not enough SOL for this trade and its fees", "Lower the amount or add SOL")
    } else if has("notenoughtokenstosell") || has("error: insufficient funds") || jupiter("0x1788") || (has("accountnotinitialized") && has("user_base_token_account")) {
        ("no_tokens", "Not enough balance in the wallet for this trade", "Refresh your balance and trade a smaller amount")
    } else if has("error code: overflow") || has("notenoughsolinpool") || has("insufficientliquidity") {
        ("liquidity", "There is not enough liquidity for a trade this size", "Trade a smaller amount")
    } else if has("computationalbudgetexceeded") || has("exceeded cus") || has("exceeded maximum compute") {
        ("compute", "The trade ran out of compute", "Try again; the route was heavier than expected")
    } else if has("blockhashnotfound") || has("block height exceeded") {
        ("expired", "The network did not take the trade in time", "Nothing was spent. Try again")
    } else if has("accountnotfound") || has("could not find account") {
        ("account", "An account the trade needs is missing", "Try again in a moment")
    } else if has("bondingcurvecomplete") {
        ("migrated", "This coin just left its bonding curve", "Try again in a moment once its pool is live")
    } else {
        ("failed", "The trade failed on chain", "See the technical details, or try again")
    }
}

/* ---------------- Settings and state ---------------- */

pub struct TradeState {
    /// From FEE_WALLET in the environment; the admin setting takes precedence.
    env_fee_wallet: Option<Pubkey>,
    /// Fee wallet balance checks (address, when, lamports).
    fee_balance: Mutex<Option<(Pubkey, Instant, u64)>>,
    jup_key: Option<String>,
    allowlist: HashSet<String>,
    builds: Mutex<HashMap<String, Build>>,
    live: Mutex<HashMap<String, Live>>,
    throttle: Mutex<HashMap<String, Instant>>,
    fees: Mutex<Option<(Instant, HashMap<String, u64>)>>,
    blockhash: Mutex<Option<(Instant, Pubkey, u64)>>,
    decimals: Mutex<HashMap<String, u8>>,
    pump_global: Mutex<Option<(Instant, crate::pumpfun_tx::Global)>>,
    swap_config: Mutex<Option<(Instant, crate::pumpswap_tx::Config)>>,
    /// Until when someone has a trade ticket open: the warm loop runs only then.
    active_until: Mutex<Option<Instant>>,
}

impl TradeState {
    pub fn from_env() -> Arc<Self> {
        let env_fee_wallet = std::env::var("FEE_WALLET").ok().and_then(|w| stx::pubkey(w.trim()).ok());
        let allowlist = std::env::var("TRADING_ALLOWLIST").unwrap_or_default().split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        Arc::new(Self {
            env_fee_wallet,
            fee_balance: Mutex::new(None),
            jup_key: std::env::var("JUPITER_API_KEY").ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty()),
            allowlist,
            builds: Mutex::new(HashMap::new()),
            live: Mutex::new(HashMap::new()),
            throttle: Mutex::new(HashMap::new()),
            fees: Mutex::new(None),
            blockhash: Mutex::new(None),
            decimals: Mutex::new(HashMap::new()),
            pump_global: Mutex::new(None),
            swap_config: Mutex::new(None),
            active_until: Mutex::new(None),
        })
    }
}

#[derive(Clone)]
pub struct TradeCtx {
    pub app: Arc<crate::AppState>,
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub t: Arc<TradeState>,
}

struct Build {
    user: String,
    wallet: Pubkey,
    message: Vec<u8>,
    last_valid: u64,
    created: Instant,
    row: Value,
    mev: bool,
    speed: Speed,
}

#[derive(Clone)]
struct Live {
    user: String,
    status: &'static str,
    error: Option<(String, String, String)>,
    latency_ms: Option<u64>,
    at: Instant,
}

type ApiErr = (StatusCode, Json<Value>);

fn err(status: StatusCode, code: &str, message: &str, hint: &str) -> ApiErr {
    (status, Json(json!({ "code": code, "message": message, "hint": hint })))
}

fn bad(message: &str) -> ApiErr {
    err(StatusCode::BAD_REQUEST, "invalid", message, "")
}

fn auth_err(e: (StatusCode, String)) -> ApiErr {
    err(e.0, "auth", &e.1, "Sign in again")
}

/// A fee transfer to an account holding less than this would leave it below rent and
/// fail; the fee wallet must already hold it.
const RENT_EXEMPT_MIN: u64 = 890_880;

impl TradeCtx {
    fn fee_wallet(&self) -> Option<Pubkey> {
        self.admin.fee_wallet().and_then(|w| stx::pubkey(&w).ok()).or(self.t.env_fee_wallet)
    }

    /// The fee wallet, when it is set and already holds enough SOL to receive fees.
    async fn ready_fee_wallet(&self) -> Result<Pubkey, &'static str> {
        let w = self.fee_wallet().ok_or("Real trading is not set up yet: no fee wallet")?;
        let cached = self.t.fee_balance.lock().expect("fee bal lock").filter(|(k, at, _)| *k == w && at.elapsed() < Duration::from_secs(120)).map(|(_, _, b)| b);
        let bal = match cached {
            Some(b) => b,
            None => {
                let b = rpc(&self.r(), "getBalance", json!([stx::b58(&w), { "commitment": "confirmed" }])).await.ok().and_then(|v| v["value"].as_u64()).ok_or("Could not check the fee wallet")?;
                *self.t.fee_balance.lock().expect("fee bal lock") = Some((w, Instant::now(), b));
                b
            }
        };
        if bal < RENT_EXEMPT_MIN {
            return Err("Real trading is not set up yet: the fee wallet needs at least 0.001 SOL");
        }
        Ok(w)
    }
}

/* ---------------- Solana RPC (unpaced: trades never queue behind analytics) ---------------- */

/// The Solana RPC endpoint and its client.
pub struct Rpc {
    pub http: reqwest::Client,
    pub url: String,
}

impl TradeCtx {
    fn r(&self) -> Rpc {
        Rpc { http: self.app.http.clone(), url: self.app.config.helius_rpc_url() }
    }
}

pub(crate) async fn rpc(r: &Rpc, method: &str, params: Value) -> Result<Value, String> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    // The free plan answers 429 in bursts: back off briefly and try again.
    for attempt in 0..4u64 {
        let res = r.http.post(&r.url).json(&body).timeout(Duration::from_secs(6)).send().await;
        match res {
            Ok(r) if r.status().as_u16() == 429 && attempt < 3 => tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await,
            Ok(r) => {
                let v: Value = r.json().await.map_err(|e| e.to_string())?;
                if let Some(e) = v.get("error") {
                    return Err(e.to_string());
                }
                return Ok(v["result"].clone());
            }
            Err(e) if attempt < 1 => tracing::warn!(%e, method, "rpc retry"),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("rpc unavailable".into())
}

/// A blockhash stays valid for about a minute; one up to 10 s old still leaves 50 s.
const BLOCKHASH_TTL: Duration = Duration::from_secs(10);
/// Trading counts as active this long after the last ticket ping or quote.
const ACTIVE_FOR: Duration = Duration::from_secs(90);

async fn blockhash(c: &TradeCtx) -> Result<(Pubkey, u64), String> {
    if let Some((at, h, lv)) = *c.t.blockhash.lock().expect("bh lock") {
        if at.elapsed() < BLOCKHASH_TTL {
            return Ok((h, lv));
        }
    }
    let v = rpc(&c.r(), "getLatestBlockhash", json!([{ "commitment": "confirmed" }])).await?;
    let h = stx::pubkey(v["value"]["blockhash"].as_str().unwrap_or(""))?;
    let lv = v["value"]["lastValidBlockHeight"].as_u64().ok_or("no block height")?;
    *c.t.blockhash.lock().expect("bh lock") = Some((Instant::now(), h, lv));
    Ok((h, lv))
}

/// Helius priority fee estimate for Jupiter and pump.fun, cached a few seconds.
async fn priority_estimate(c: &TradeCtx, level: &str) -> u64 {
    if let Some((at, m)) = c.t.fees.lock().expect("fee lock").as_ref() {
        if at.elapsed() < Duration::from_secs(3) {
            return m.get(level).copied().unwrap_or(0);
        }
    }
    let v = rpc(&c.r(), "getPriorityFeeEstimate", json!([{ "accountKeys": [JUPITER_PROGRAM, "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"], "options": { "includeAllPriorityFeeLevels": true } }])).await;
    let m: HashMap<String, u64> = v
        .ok()
        .and_then(|v| v["priorityFeeLevels"].as_object().cloned())
        .map(|o| o.into_iter().filter_map(|(k, v)| v.as_f64().map(|f| (k, f as u64))).collect())
        .unwrap_or_default();
    let out = m.get(level).copied().unwrap_or(0);
    *c.t.fees.lock().expect("fee lock") = Some((Instant::now(), m));
    out
}

async fn token_balance(c: &TradeCtx, wallet: &str, mint: &str) -> Result<(u128, u8), String> {
    let v = rpc(&c.r(), "getTokenAccountsByOwner", json!([wallet, { "mint": mint }, { "encoding": "jsonParsed", "commitment": "confirmed" }])).await?;
    let mut total = 0u128;
    let mut decimals = 0u8;
    for a in v["value"].as_array().cloned().unwrap_or_default() {
        let amt = &a["account"]["data"]["parsed"]["info"]["tokenAmount"];
        total += amt["amount"].as_str().and_then(|s| s.parse::<u128>().ok()).unwrap_or(0);
        decimals = amt["decimals"].as_u64().unwrap_or(0) as u8;
    }
    Ok((total, decimals))
}

async fn decimals_of(c: &TradeCtx, mint: &str) -> u8 {
    if let Some(d) = c.t.decimals.lock().expect("dec lock").get(mint) {
        return *d;
    }
    let d = rpc(&c.r(), "getTokenSupply", json!([mint])).await.ok().and_then(|v| v["value"]["decimals"].as_u64()).unwrap_or(6) as u8;
    let mut m = c.t.decimals.lock().expect("dec lock");
    if m.len() > 5_000 {
        m.clear();
    }
    m.insert(mint.to_string(), d);
    d
}

/* ---------------- Jupiter ---------------- */

fn jup_base(c: &TradeCtx) -> &'static str {
    if c.t.jup_key.is_some() { "https://api.jup.ag/swap/v1" } else { "https://lite-api.jup.ag/swap/v1" }
}

async fn jup(c: &TradeCtx, req: reqwest::RequestBuilder) -> Result<Value, ApiErr> {
    let req = match &c.t.jup_key {
        Some(k) => req.header("x-api-key", k),
        None => req,
    };
    let res = req.timeout(Duration::from_secs(8)).send().await.map_err(|_| err(StatusCode::BAD_GATEWAY, "route", "The swap router did not answer", "Try again"))?;
    let status = res.status();
    let v: Value = res.json().await.unwrap_or(Value::Null);
    if status.as_u16() == 429 {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "busy", "Trading is busy right now", "Try again in a second"));
    }
    let msg = v["error"].as_str().or(v["errorCode"].as_str()).unwrap_or("");
    if !status.is_success() || !msg.is_empty() {
        let m = msg.to_ascii_lowercase();
        return Err(if m.contains("missing token program") || m.contains("not tradable") || m.contains("token not found") {
            err(StatusCode::UNPROCESSABLE_ENTITY, "too_new", "This coin is only minutes old and its route is not ready yet", "Try again in a minute or two")
        } else if m.contains("route") || m.contains("could_not_find") || m.contains("no routes") {
            err(StatusCode::UNPROCESSABLE_ENTITY, "no_route", "No market can fill this trade right now", "Try a smaller amount")
        } else {
            tracing::warn!(%status, msg, "jupiter error");
            err(StatusCode::BAD_GATEWAY, "route", "The swap router could not build this trade", "Try again")
        });
    }
    Ok(v)
}

fn ix_from(v: &Value) -> Result<Instruction, String> {
    Ok(Instruction {
        program: stx::pubkey(v["programId"].as_str().ok_or("no program")?)?,
        accounts: v["accounts"]
            .as_array()
            .ok_or("no accounts")?
            .iter()
            .map(|a| Ok(AccountMeta { pubkey: stx::pubkey(a["pubkey"].as_str().ok_or("no key")?)?, signer: a["isSigner"].as_bool().unwrap_or(false), writable: a["isWritable"].as_bool().unwrap_or(false) }))
            .collect::<Result<_, String>>()?,
        data: B64.decode(v["data"].as_str().unwrap_or("")).map_err(|e| e.to_string())?,
    })
}

/* ---------------- Handlers ---------------- */

/// `GET /trade/config`: what the trade ticket needs to know.
pub async fn config(State(c): State<TradeCtx>) -> Json<Value> {
    let ready = c.ready_fee_wallet().await;
    Json(json!({
        "enabled": c.admin.real_trading(),
        "ready": ready.is_ok(),
        "not_ready": ready.err(),
        "fee_bps": FEE_BPS,
        "max_lamports": MAX_LAMPORTS,
        "min_lamports": MIN_LAMPORTS,
        "fee_wallet": c.fee_wallet().map(|w| stx::b58(&w)),
        "tip_accounts": TIP_ACCOUNTS,
        "speeds": { "fast": { "tip": FAST.tip, "max_priority": FAST.max_priority }, "turbo": { "tip": TURBO.tip, "max_priority": TURBO.max_priority } },
        "allowlist": !c.t.allowlist.is_empty(),
    }))
}

impl TradeState {
    fn touch(&self) {
        *self.active_until.lock().expect("active lock") = Some(Instant::now() + ACTIVE_FOR);
    }

    fn active(&self) -> bool {
        self.active_until.lock().expect("active lock").is_some_and(|t| Instant::now() < t)
    }
}

/// `POST /trade/prepare`: a real-money ticket is open. Starts the warm loop so the
/// next quote finds the blockhash, fees and configs ready and the connections open.
pub async fn prepare(State(c): State<TradeCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    // Signed-in users only, so nobody can keep the loop (and its RPC credits) running.
    c.acct.user(&headers).await.map_err(auth_err)?;
    if !c.admin.real_trading() {
        return Ok(Json(json!({ "ok": false })));
    }
    let was = c.t.active();
    c.t.touch();
    if !was {
        // First ticket in a while: warm now rather than on the loop's next tick.
        tokio::spawn(warm_once(c.clone()));
    }
    Ok(Json(json!({ "ok": true })))
}

/// Keeps what every trade needs ready while anyone is trading: the blockhash, the
/// priority fee estimate, pump.fun's and PumpSwap's configs, and warm HTTPS connections
/// to the RPC and to Sender (its /ping endpoint is free). Idle otherwise, so the free
/// plan's credits are only spent when there is trading.
pub async fn warm_loop(c: TradeCtx) {
    // About two light calls every 6 s while active (a cached blockhash is reused for 8 s).
    let mut tick = tokio::time::interval(Duration::from_secs(6));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        if c.t.active() && c.admin.real_trading() {
            warm_once(c.clone()).await;
        }
    }
}

async fn warm_once(c: TradeCtx) {
    let refresh_hash = c.t.blockhash.lock().expect("bh lock").is_none_or(|(at, _, _)| at.elapsed() > Duration::from_secs(8));
    if refresh_hash {
        *c.t.blockhash.lock().expect("bh lock") = None;
    }
    let ping = c.app.http.get("https://sender.helius-rpc.com/ping").timeout(Duration::from_secs(3)).send();
    let _ = tokio::join!(blockhash(&c), priority_estimate(&c, TURBO.level), priority_estimate(&c, FAST.level), pump_global(&c), swap_config(&c), ping);
}

#[derive(Deserialize)]
pub struct QuoteIn {
    wallet: String,
    mint: String,
    side: String,
    /// Buy: SOL to spend, in lamports, fee included.
    lamports: Option<u64>,
    /// Sell: share of the wallet's tokens, 0 to 1.
    fraction: Option<f64>,
    slippage_bps: Option<u64>,
    speed: Option<String>,
    mev: Option<bool>,
    #[serde(default)]
    symbol: String,
}

/// `POST /trade/quote`: builds and simulates the swap for the user's wallet and
/// returns it unsigned, with every cost spelled out before the wallet asks to sign.
pub async fn quote(State(c): State<TradeCtx>, headers: HeaderMap, Json(q): Json<QuoteIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth_err)?;
    if !c.admin.real_trading() {
        return Err(err(StatusCode::FORBIDDEN, "off", "Real trading is not open yet", "Use the demo account meanwhile"));
    }
    let fee_wallet = c.ready_fee_wallet().await.map_err(|m| err(StatusCode::SERVICE_UNAVAILABLE, "off", m, ""))?;
    let wallet = stx::pubkey(&q.wallet).map_err(|_| bad("not a wallet address"))?;
    if stx::pubkey(&q.mint).is_err() || q.mint == WSOL {
        return Err(bad("not a coin address"));
    }
    if !c.t.allowlist.is_empty() && !c.t.allowlist.contains(&q.wallet) {
        return Err(err(StatusCode::FORBIDDEN, "allowlist", "Real trading is open to selected wallets for now", "Use the demo account meanwhile"));
    }
    {
        let mut t = c.t.throttle.lock().expect("throttle lock");
        if t.get(&user.id).is_some_and(|at| at.elapsed() < Duration::from_millis(400)) {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "busy", "Too many requests", "Wait a moment"));
        }
        if t.len() > 10_000 {
            t.clear();
        }
        t.insert(user.id.clone(), Instant::now());
    }
    c.t.touch();
    let slippage = q.slippage_bps.unwrap_or(1_000).clamp(10, MAX_SLIPPAGE_BPS);
    let sp = speed(q.speed.as_deref().unwrap_or("turbo"));
    let mev = q.mev.unwrap_or(true);
    let buy = match q.side.as_str() {
        "buy" => true,
        "sell" => false,
        _ => return Err(bad("side must be buy or sell")),
    };

    if buy {
        let lamports = q.lamports.ok_or_else(|| bad("enter an amount"))?;
        if lamports < MIN_LAMPORTS {
            return Err(bad("minimum trade is 0.001 SOL"));
        }
        if lamports > MAX_LAMPORTS {
            return Err(err(StatusCode::BAD_REQUEST, "max", "At most 3 SOL per trade", "Split it into smaller trades"));
        }
    }

    // 1. Our own builders (pump.fun bonding curves for now): one RPC read, no router.
    //    A user error (not enough SOL or tokens, too little liquidity) is final; any other
    //    failure falls through to the router.
    let built = match native_build(&c, &q, &wallet, &fee_wallet, buy, slippage, sp).await? {
        Some(b) => b,
        None => jupiter_build(&c, &q, &wallet, &fee_wallet, buy, slippage, sp).await?,
    };

    let priority_fee = (built.cu_limit as u64 * built.price).div_ceil(1_000_000);
    let row = json!({
        "user_id": user.id, "wallet": q.wallet, "mint": q.mint, "symbol": q.symbol.chars().take(24).collect::<String>(), "side": q.side,
        "sol_lamports": built.sol_lamports.to_string(), "token_amount": built.token_amount.to_string(), "min_out": built.min_out.to_string(),
        "platform_fee_lamports": built.fee, "priority_fee_lamports": priority_fee, "tip_lamports": sp.tip,
        "slippage_bps": slippage, "speed": sp.name, "mev": mev, "route": built.route.join(" > "),
    });
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos() as usize);
    let id = hex(&Sha256::digest([built.message.as_slice(), &nanos.to_le_bytes(), user.id.as_bytes(), q.wallet.as_bytes()].concat())[..12]);
    let tx = stx::unsigned_tx(&built.message);
    {
        let mut b = c.t.builds.lock().expect("builds lock");
        b.retain(|_, x| x.created.elapsed() < BUILD_TTL);
        b.insert(id.clone(), Build { user: user.id.clone(), wallet, message: built.message, last_valid: built.last_valid, created: Instant::now(), row, mev, speed: sp });
    }
    Ok(Json(json!({
        "build_id": id,
        "tx": B64.encode(&tx),
        "expires_in": BUILD_TTL.as_secs(),
        "side": q.side,
        "decimals": built.decimals,
        "sol_lamports": built.sol_lamports.to_string(),
        "token_amount": built.token_amount.to_string(),
        "min_out": built.min_out.to_string(),
        "price_impact_pct": built.price_impact_pct,
        "platform_fee_lamports": built.fee,
        "priority_fee_lamports": priority_fee,
        "tip_lamports": sp.tip,
        "network_fee_lamports": NETWORK_FEE,
        "slippage_bps": slippage,
        "speed": sp.name,
        "mev": mev,
        "route": built.route,
        "units": built.units,
    })))
}

/// A trade ready to sign.
struct Built {
    message: Vec<u8>,
    last_valid: u64,
    cu_limit: u32,
    price: u64,
    /// Buy: SOL spent (fee included). Sell: SOL expected out.
    sol_lamports: u128,
    /// Buy: tokens expected. Sell: tokens sold.
    token_amount: u128,
    min_out: u128,
    fee: u64,
    decimals: u8,
    route: Vec<String>,
    price_impact_pct: Option<f64>,
    units: Value,
}

/// Errors that are the user's (and the same on any route): never retried elsewhere.
fn user_error(code: &str) -> bool {
    matches!(code, "no_sol" | "no_tokens" | "slippage" | "liquidity")
}

async fn simulate(r: &Rpc, tx: &[u8]) -> Result<Value, ApiErr> {
    rpc(r, "simulateTransaction", json!([B64.encode(tx), { "encoding": "base64", "sigVerify": false, "replaceRecentBlockhash": true, "commitment": "processed" }]))
        .await
        .map(|v| v["value"].clone())
        .map_err(|e| {
            tracing::warn!(e, "simulate failed");
            err(StatusCode::BAD_GATEWAY, "rpc", "Could not check the trade before signing", "Try again")
        })
}

fn sim_logs(sim: &Value) -> Vec<String> {
    sim["logs"].as_array().map(|l| l.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn sim_error(sim: &Value) -> (ApiErr, &'static str) {
    let logs: Vec<String> = sim["logs"].as_array().map(|l| l.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
    let (code, message, hint) = diagnose(&sim["err"], &logs);
    ((StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "code": code, "message": message, "hint": hint, "detail": sim["err"], "logs": logs.iter().rev().take(6).collect::<Vec<_>>() }))), code)
}

fn pick() -> usize {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos() as usize)
}

/// pump.fun's Global account changes rarely: cached for a minute.
async fn pump_global(c: &TradeCtx) -> Option<crate::pumpfun_tx::Global> {
    if let Some((at, g)) = c.t.pump_global.lock().expect("global lock").as_ref() {
        if at.elapsed() < Duration::from_secs(60) {
            return Some(g.clone());
        }
    }
    let v = rpc(&c.r(), "getAccountInfo", json!([stx::b58(&crate::pumpfun_tx::global()), { "encoding": "base64" }])).await.ok()?;
    let g = crate::pumpfun_tx::Global::parse(&B64.decode(v["value"]["data"][0].as_str()?).ok()?)?;
    *c.t.pump_global.lock().expect("global lock") = Some((Instant::now(), g.clone()));
    Some(g)
}

/// Accounts read for a native trade, in this order: pump.fun curve, mint, wallet, the
/// wallet's token account under the classic and the 2022 token programs, and the
/// PumpSwap pool the coin graduates into.
pub fn native_keys(wallet: &Pubkey, mint: &Pubkey, dbc_pool: Option<&str>) -> Vec<String> {
    use crate::pumpfun_tx as pf;
    let token = stx::pubkey(pf::TOKEN).expect("token program");
    let token22 = stx::pubkey(pf::TOKEN_2022).expect("token-2022 program");
    let wsol = stx::pubkey(WSOL).expect("wsol");
    let mut keys: Vec<String> = [pf::bonding_curve(mint), *mint, *wallet, pf::ata(wallet, mint, &token), pf::ata(wallet, mint, &token22)].iter().map(|k| stx::b58(k)).collect();
    keys.push(monexa_ingest::pumpswap::canonical_pool(&stx::b58(mint)).unwrap_or_else(|| stx::SYSTEM_PROGRAM.into()));
    keys.push(stx::b58(&crate::launch_tx::lab_pool(mint, &wsol)));
    keys.push(stx::b58(&pf::ata(wallet, &wsol, &token)));
    keys.push(dbc_pool.filter(|k| stx::pubkey(k).is_ok()).unwrap_or(stx::SYSTEM_PROGRAM).to_string());
    keys
}

/// The board's DBC pool for a coin launched on Meteora DBC (Bags and others).
fn board_dbc_pool(c: &TradeCtx, mint: &str) -> Option<String> {
    let board = c.app.board.lock().expect("board lock");
    let t = board.tokens.get(mint)?;
    (matches!(t.token.launchpad.as_str(), "met-dbc" | "bags") && !t.token.bonding_curve.is_empty()).then(|| t.token.bonding_curve.clone())
}

fn account_data(values: &[Value], i: usize) -> Vec<u8> {
    values.get(i).and_then(|a| a["data"][0].as_str()).and_then(|d| B64.decode(d).ok()).unwrap_or_default()
}

/// The wallet's side of a trade, from `native_keys` accounts.
pub struct Holder {
    pub token_program: Pubkey,
    pub decimals: u8,
    pub lamports: u64,
    pub held: u64,
}

pub fn holder_inputs(values: &[Value]) -> Option<Holder> {
    use crate::pumpfun_tx as pf;
    let owner = values.get(1)?["owner"].as_str()?;
    if owner != pf::TOKEN && owner != pf::TOKEN_2022 {
        return None;
    }
    let ata = account_data(values, if owner == pf::TOKEN { 3 } else { 4 });
    Some(Holder {
        token_program: stx::pubkey(owner).ok()?,
        decimals: account_data(values, 1).get(44).copied().unwrap_or(6),
        lamports: values.get(2).and_then(|a| a["lamports"].as_u64()).unwrap_or(0),
        held: ata.get(64..72).map(|b| u64::from_le_bytes(b.try_into().expect("8"))).unwrap_or(0),
    })
}

/// The coin's pump.fun curve when it is live and quoted in SOL.
pub fn live_curve(values: &[Value]) -> Option<crate::pumpfun_tx::Curve> {
    let c = crate::pumpfun_tx::Curve::parse(&account_data(values, 0))?;
    (!c.complete && c.sol_quoted() && c.virtual_token > 0 && c.virtual_sol > 0).then_some(c)
}

/// The coin's PumpSwap pool when it exists and is quoted in SOL (reserves not yet read).
pub fn sol_pool(values: &[Value], keys: &[String]) -> Option<crate::pumpswap_tx::Pool> {
    let key = stx::pubkey(keys.get(5)?).ok()?;
    let p = crate::pumpswap_tx::Pool::parse(key, &account_data(values, 5))?;
    p.sol_quoted().then_some(p)
}

/// Token amount held in a token account (raw units), from its data.
pub fn token_amount(values: &[Value], i: usize) -> u64 {
    account_data(values, i).get(64..72).map(|b| u64::from_le_bytes(b.try_into().expect("8"))).unwrap_or(0)
}

/// The swap part of a native trade and its figures.
pub struct NativePlan {
    pub program_ixs: Vec<Instruction>,
    pub fee: u64,
    pub sol_lamports: u128,
    pub token_amount: u128,
    pub min_out: u128,
    pub impact: f64,
    pub route: &'static str,
}

/// Where a native trade goes.
pub enum Venue<'a> {
    Curve(&'a crate::pumpfun_tx::Curve, &'a crate::pumpfun_tx::Global),
    Pool(&'a crate::pumpswap_tx::Pool, &'a crate::pumpswap_tx::Config),
}

/// Plans a native trade: `lamports` to spend (fee included) for a buy, `fraction` of
/// the held tokens for a sell. `Ok(None)` hands the trade to the router.
#[allow(clippy::too_many_arguments)]
pub fn native_plan(venue: Venue, h: &Holder, wallet: &Pubkey, mint: &Pubkey, buy: bool, lamports: u64, fraction: f64, slippage: u64, tip: u64, pick: usize) -> Result<Option<NativePlan>, ApiErr> {
    use crate::{pumpfun_tx as pf, pumpswap_tx as ps};
    let keep = |v: u64| (v as u128 * (10_000 - slippage as u128) / 10_000) as u64;
    let (spot, route) = match &venue {
        Venue::Curve(c, _) => (c.virtual_sol as f64 / c.virtual_token as f64, "pump.fun"),
        Venue::Pool(p, _) => {
            if p.base_reserve == 0 || p.quote_reserve == 0 {
                return Ok(None);
            }
            (p.quote_reserve as f64 / p.base_reserve as f64, "PumpSwap")
        }
    };
    if buy {
        if h.lamports < lamports + tip + BUY_RESERVE {
            return Err(err(StatusCode::BAD_REQUEST, "no_sol", "Not enough SOL for this trade and its fees", "Lower the amount or add SOL"));
        }
        let fee = fee_of(lamports);
        let spend = lamports - fee;
        let est = match &venue {
            Venue::Curve(c, _) => c.tokens_for(spend),
            Venue::Pool(p, _) => p.tokens_for(spend),
        };
        if est == 0 {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "liquidity", "There is not enough liquidity for a trade this size", "Trade a smaller amount"));
        }
        let min = keep(est);
        let ixs = match &venue {
            Venue::Curve(c, g) => pf::buy(wallet, mint, &h.token_program, c, g, spend, min, pick),
            Venue::Pool(p, cfg) => ps::buy(wallet, p, &h.token_program, cfg, spend, min, pick),
        };
        let Some(program_ixs) = ixs else { return Ok(None) };
        Ok(Some(NativePlan { program_ixs, fee, sol_lamports: lamports as u128, token_amount: est as u128, min_out: min as u128, impact: (((spend as f64 / est as f64) / spot - 1.0) * 100.0).max(0.0), route }))
    } else {
        if h.held == 0 {
            return Ok(None); // tokens may sit in another account; the router path reads them all
        }
        let amount = if fraction >= 0.9999 { h.held } else { ((h.held as f64) * fraction) as u64 }.max(1);
        let est = match &venue {
            Venue::Curve(c, _) => c.sol_for(amount),
            Venue::Pool(p, _) => p.sol_for(amount),
        };
        if est > MAX_LAMPORTS {
            return Err(err(StatusCode::BAD_REQUEST, "max", "At most 3 SOL per trade", "Sell a smaller part"));
        }
        let min = keep(est);
        let ixs = match &venue {
            Venue::Curve(c, g) => pf::sell(wallet, mint, &h.token_program, c, g, amount, min, pick),
            Venue::Pool(p, cfg) => ps::sell(wallet, p, &h.token_program, cfg, amount, min, pick),
        };
        let Some(program_ixs) = ixs else { return Ok(None) };
        Ok(Some(NativePlan { program_ixs, fee: fee_of(min), sol_lamports: est as u128, token_amount: amount as u128, min_out: min as u128, impact: ((1.0 - (est as f64 / amount as f64) / spot) * 100.0).max(0.0), route }))
    }
}

/// The whole transaction around a swap: compute budget, the platform fee (before a
/// buy, after a sell), the swap, and the Sender tip.
#[allow(clippy::too_many_arguments)]
pub fn compose(wallet: &Pubkey, fee_wallet: &Pubkey, buy: bool, fee: u64, swap: &[Instruction], tip_account: &Pubkey, tip: u64, cu_limit: u32, price: u64, hash: &Pubkey) -> Result<Vec<u8>, String> {
    let mut ixs = vec![stx::compute_unit_limit(cu_limit), stx::compute_unit_price(price)];
    if buy && fee > 0 {
        ixs.push(stx::transfer(wallet, fee_wallet, fee));
    }
    ixs.extend(swap.iter().cloned());
    if !buy && fee > 0 {
        ixs.push(stx::transfer(wallet, fee_wallet, fee));
    }
    if tip > 0 {
        ixs.push(stx::transfer(wallet, tip_account, tip));
    }
    stx::compile_v0(wallet, &ixs, &[], hash)
}

/// Compute limit for a trade that used `units` in simulation: the priority fee is paid
/// per unit of the limit, so a tight limit costs the user less.
pub fn tight_limit(units: u64, ceiling: u32) -> u32 {
    let u = units.min(ceiling as u64) as u32;
    (u + u / 5 + 5_000).clamp(30_000, ceiling)
}

/// PumpSwap's GlobalConfig changes rarely: cached for a minute.
async fn swap_config(c: &TradeCtx) -> Option<crate::pumpswap_tx::Config> {
    if let Some((at, g)) = c.t.swap_config.lock().expect("config lock").as_ref() {
        if at.elapsed() < Duration::from_secs(60) {
            return Some(g.clone());
        }
    }
    let v = rpc(&c.r(), "getAccountInfo", json!([stx::b58(&crate::pumpswap_tx::global_config()), { "encoding": "base64" }])).await.ok()?;
    let g = crate::pumpswap_tx::Config::parse(&B64.decode(v["value"]["data"][0].as_str()?).ok()?)?;
    *c.t.swap_config.lock().expect("config lock") = Some((Instant::now(), g.clone()));
    Some(g)
}

/// A trade built by our own builders: pump.fun while the coin is on its curve,
/// PumpSwap once it has graduated into a SOL pool. `None` hands the trade to the router
/// (another venue, or this route failed for a reason that is not the user's).
#[allow(clippy::too_many_arguments)]
async fn native_build(c: &TradeCtx, q: &QuoteIn, wallet: &Pubkey, fee_wallet: &Pubkey, buy: bool, slippage: u64, sp: Speed) -> Result<Option<Built>, ApiErr> {
    let mint = stx::pubkey(&q.mint).map_err(|_| bad("not a coin address"))?;
    let fraction = q.fraction.unwrap_or(0.0);
    if !buy && !(fraction > 0.0 && fraction <= 1.0) {
        return Err(bad("choose how much to sell"));
    }
    // One read: curve, mint, wallet, its token accounts and the graduated pool.
    let dbc = board_dbc_pool(c, &q.mint);
    let keys = native_keys(wallet, &mint, dbc.as_deref());
    let r = c.r();
    let (accounts, global, estimate, bh) = tokio::join!(
        rpc(&r, "getMultipleAccounts", json!([keys, { "encoding": "base64", "commitment": "processed" }])),
        pump_global(c),
        priority_estimate(c, sp.level),
        blockhash(c),
    );
    let Ok(accounts) = accounts else { return Ok(None) };
    let values = accounts["value"].as_array().cloned().unwrap_or_default();
    let Some(holder) = holder_inputs(&values) else { return Ok(None) };
    let (hash, last_valid) = bh.map_err(|_| err(StatusCode::BAD_GATEWAY, "rpc", "The network did not answer", "Try again"))?;

    let plan = if let Some(curve) = live_curve(&values) {
        let Some(global) = global else { return Ok(None) };
        native_plan(Venue::Curve(&curve, &global), &holder, wallet, &mint, buy, q.lamports.unwrap_or(0), fraction, slippage, sp.tip, pick())?
    } else if let Some(mut pool) = sol_pool(&values, &keys) {
        let (reserves, config) = tokio::join!(
            rpc(&r, "getMultipleAccounts", json!([[stx::b58(&pool.pool_base), stx::b58(&pool.pool_quote)], { "encoding": "base64", "commitment": "processed" }])),
            swap_config(c),
        );
        let (Ok(reserves), Some(config)) = (reserves, config) else { return Ok(None) };
        let r = reserves["value"].as_array().cloned().unwrap_or_default();
        pool.set_reserves(token_amount(&r, 0), token_amount(&r, 1));
        native_plan(Venue::Pool(&pool, &config), &holder, wallet, &mint, buy, q.lamports.unwrap_or(0), fraction, slippage, sp.tip, pick())?
    } else if let Some(venue) = sim_venue(&c.r(), &values, &keys).await {
        return sim_quoted_build(&c.r(), q, wallet, fee_wallet, buy, slippage, sp, &holder, &values, &venue, &hash, last_valid, estimate).await;
    } else {
        return Ok(None);
    };
    let Some(plan) = plan else { return Ok(None) };

    let tip_account = stx::pubkey(TIP_ACCOUNTS[pick() % TIP_ACCOUNTS.len()]).expect("tip account");
    let first_limit = 300_000;
    let build = |limit: u32, price: u64| compose(wallet, fee_wallet, buy, plan.fee, &plan.program_ixs, &tip_account, sp.tip, limit, price, &hash).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "build", &e, ""));
    let sim = simulate(&c.r(), &stx::unsigned_tx(&build(first_limit, priority_price(estimate, first_limit, sp))?)).await?;
    if !sim["err"].is_null() {
        let (e, code) = sim_error(&sim);
        if user_error(code) {
            return Err(e);
        }
        tracing::warn!(code, mint = q.mint, route = plan.route, "own builder failed in simulation; using the router");
        return Ok(None);
    }
    let cu_limit = tight_limit(sim["unitsConsumed"].as_u64().unwrap_or(first_limit as u64), first_limit);
    let price = priority_price(estimate, cu_limit, sp);
    Ok(Some(Built {
        message: build(cu_limit, price)?,
        last_valid,
        cu_limit,
        price,
        sol_lamports: plan.sol_lamports,
        token_amount: plan.token_amount,
        min_out: plan.min_out,
        fee: plan.fee,
        decimals: holder.decimals,
        route: vec![plan.route.into()],
        price_impact_pct: Some(plan.impact),
        units: sim["unitsConsumed"].clone(),
    }))
}

/// Launchpads whose curves are quoted by simulation rather than by a formula.
pub enum SimVenue {
    Dbc(crate::launch_tx::DbcPool, Pubkey),
    Lab(crate::launch_tx::LabPool),
}

impl SimVenue {
    pub fn route(&self) -> &'static str {
        match self {
            SimVenue::Dbc(..) => "Meteora DBC",
            SimVenue::Lab(_) => "Raydium LaunchLab",
        }
    }

    pub fn swap(&self, wallet: &Pubkey, base_program: &Pubkey, buy: bool, amount_in: u64, min_out: u64, close: bool) -> Vec<Instruction> {
        match self {
            SimVenue::Dbc(p, quote) => crate::launch_tx::dbc_swap(wallet, p, quote, base_program, buy, amount_in, min_out, close),
            SimVenue::Lab(p) => crate::launch_tx::lab_swap(wallet, p, base_program, buy, amount_in, min_out, close),
        }
    }
}

/// The coin's LaunchLab pool (SOL quoted, still raising) or its DBC pool (SOL quoted,
/// not migrated), from `native_keys` accounts 6 and 8.
async fn sim_venue(r: &Rpc, values: &[Value], keys: &[String]) -> Option<SimVenue> {
    if let Some(p) = stx::pubkey(keys.get(6)?).ok().and_then(|k| crate::launch_tx::LabPool::parse(k, &account_data(values, 6))) {
        return (stx::b58(&p.quote_mint) == WSOL).then_some(SimVenue::Lab(p));
    }
    let p = crate::launch_tx::DbcPool::parse(stx::pubkey(keys.get(8)?).ok()?, &account_data(values, 8))?;
    let v = rpc(r, "getAccountInfo", json!([stx::b58(&p.config), { "encoding": "base64" }])).await.ok()?;
    let quote = crate::launch_tx::dbc_quote_mint(&B64.decode(v["value"]["data"][0].as_str()?).ok()?)?;
    (stx::b58(&quote) == WSOL).then_some(SimVenue::Dbc(p, quote))
}

/// Simulates a transaction and returns the raw token amount in `account` afterwards.
async fn simulate_reading(r: &Rpc, tx: &[u8], account: &Pubkey) -> Result<(Value, u64), ApiErr> {
    let v = rpc(r, "simulateTransaction", json!([B64.encode(tx), { "encoding": "base64", "sigVerify": false, "replaceRecentBlockhash": true, "commitment": "processed", "accounts": { "encoding": "base64", "addresses": [stx::b58(account)] } }]))
        .await
        .map(|v| v["value"].clone())
        .map_err(|e| {
            tracing::warn!(e, "simulate failed");
            err(StatusCode::BAD_GATEWAY, "rpc", "Could not check the trade before signing", "Try again")
        })?;
    let after = v["accounts"][0]["data"][0].as_str().and_then(|d| B64.decode(d).ok()).and_then(|d| d.get(64..72).map(|b| u64::from_le_bytes(b.try_into().expect("8")))).unwrap_or(0);
    Ok((v, after))
}

/// A trade on a curve quoted by simulation: first a quote-only simulation with no
/// minimum (never offered for signing) reads exactly what the swap returns; then the
/// real transaction is built with that amount less the slippage, simulated again, and
/// its compute limit tightened.
#[allow(clippy::too_many_arguments)]
async fn sim_quoted_build(r: &Rpc, q: &QuoteIn, wallet: &Pubkey, fee_wallet: &Pubkey, buy: bool, slippage: u64, sp: Speed, h: &Holder, values: &[Value], venue: &SimVenue, hash: &Pubkey, last_valid: u64, estimate: u64) -> Result<Option<Built>, ApiErr> {
    use crate::pumpfun_tx as pf;
    let wsol_mint = stx::pubkey(WSOL).expect("wsol");
    let tip_account = stx::pubkey(TIP_ACCOUNTS[pick() % TIP_ACCOUNTS.len()]).expect("tip account");
    let limit = 400_000;
    let price = priority_price(estimate, limit, sp);
    let lamports = q.lamports.unwrap_or(0);
    let fraction = q.fraction.unwrap_or(0.0);
    let (amount_in, fee_in, out_account, before) = if buy {
        if h.lamports < lamports + sp.tip + BUY_RESERVE {
            return Err(err(StatusCode::BAD_REQUEST, "no_sol", "Not enough SOL for this trade and its fees", "Lower the amount or add SOL"));
        }
        let fee = fee_of(lamports);
        (lamports - fee, fee, pf::ata(wallet, &stx::pubkey(&q.mint).expect("mint"), &h.token_program), h.held)
    } else {
        if h.held == 0 {
            return Ok(None);
        }
        let amount = if fraction >= 0.9999 { h.held } else { ((h.held as f64) * fraction) as u64 }.max(1);
        (amount, 0, pf::ata(wallet, &wsol_mint, &stx::pubkey(pf::TOKEN).expect("token")), token_amount(values, 7))
    };
    let compose_with = |fee: u64, min_out: u64, close: bool, limit: u32, price: u64| {
        compose(wallet, fee_wallet, buy, fee, &venue.swap(wallet, &h.token_program, buy, amount_in, min_out, close), &tip_account, sp.tip, limit, price, hash).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, "build", &e, ""))
    };
    // 1. Quote: no minimum, and a sale keeps its wrapped SOL so the amount can be read.
    let (qsim, after) = simulate_reading(r, &stx::unsigned_tx(&compose_with(fee_in, 0, buy, limit, price)?), &out_account).await?;
    if !qsim["err"].is_null() {
        let (e, code) = sim_error(&qsim);
        if user_error(code) {
            return Err(e);
        }
        let all = sim_logs(&qsim);
        let logs: Vec<&str> = all.iter().rev().take(4).map(String::as_str).collect();
        tracing::warn!(code, mint = q.mint, route = venue.route(), ?logs, "own builder failed in simulation; using the router");
        return Ok(None);
    }
    let est = after.saturating_sub(before);
    if est == 0 {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "liquidity", "There is not enough liquidity for a trade this size", "Trade a smaller amount"));
    }
    if !buy && est > MAX_LAMPORTS {
        return Err(err(StatusCode::BAD_REQUEST, "max", "At most 3 SOL per trade", "Sell a smaller part"));
    }
    let min = (est as u128 * (10_000 - slippage as u128) / 10_000) as u64;
    let fee = if buy { fee_in } else { fee_of(min) };
    // 2. The real transaction, with the minimum enforced on chain. A buy is identical to
    //    its quote run except for that minimum, which the quoted amount meets, so it is not
    //    simulated twice. A sale adds the unwrap and the fee, so it is.
    let sim = if buy { qsim.clone() } else { simulate(r, &stx::unsigned_tx(&compose_with(fee, min, true, limit, price)?)).await? };
    if !sim["err"].is_null() {
        let (e, code) = sim_error(&sim);
        if user_error(code) {
            return Err(e);
        }
        let all = sim_logs(&sim);
        let logs: Vec<&str> = all.iter().rev().take(4).map(String::as_str).collect();
        tracing::warn!(code, mint = q.mint, route = venue.route(), ?logs, "own builder failed in simulation; using the router");
        return Ok(None);
    }
    let cu_limit = tight_limit(sim["unitsConsumed"].as_u64().unwrap_or(limit as u64), limit);
    let price = priority_price(estimate, cu_limit, sp);
    Ok(Some(Built {
        message: compose_with(fee, min, true, cu_limit, price)?,
        last_valid,
        cu_limit,
        price,
        sol_lamports: if buy { lamports as u128 } else { est as u128 },
        token_amount: if buy { est as u128 } else { amount_in as u128 },
        min_out: min as u128,
        fee,
        decimals: h.decimals,
        route: vec![venue.route().into()],
        price_impact_pct: None,
        units: sim["unitsConsumed"].clone(),
    }))
}

/// A trade routed by Jupiter, for coins our own builders do not cover.
#[allow(clippy::too_many_arguments)]
async fn jupiter_build(c: &TradeCtx, q: &QuoteIn, wallet: &Pubkey, fee_wallet: &Pubkey, buy: bool, slippage: u64, sp: Speed) -> Result<Built, ApiErr> {
    // Amounts. Buy: the fee comes off the SOL first. Sell: the fee comes off the SOL
    // received, charged on the guaranteed minimum so it is never more than 1%.
    let (input, output, amount, decimals, fee_in) = if buy {
        let lamports = q.lamports.unwrap_or(0);
        let fee = fee_of(lamports);
        (WSOL.to_string(), q.mint.clone(), (lamports - fee) as u128, 0u8, fee)
    } else {
        let f = q.fraction.filter(|f| *f > 0.0 && *f <= 1.0).ok_or_else(|| bad("choose how much to sell"))?;
        let (held, decimals) = token_balance(c, &q.wallet, &q.mint).await.map_err(|_| err(StatusCode::BAD_GATEWAY, "rpc", "Could not read your balance", "Try again"))?;
        if held == 0 {
            return Err(err(StatusCode::BAD_REQUEST, "no_tokens", "This wallet holds none of this coin", ""));
        }
        let amount = if f >= 0.9999 { held } else { ((held as f64) * f) as u128 };
        (q.mint.clone(), WSOL.to_string(), amount.max(1), decimals, 0)
    };
    let balance_check = async {
        if !buy {
            return Ok(());
        }
        let balance = rpc(&c.r(), "getBalance", json!([q.wallet, { "commitment": "confirmed" }])).await.ok().and_then(|v| v["value"].as_u64()).unwrap_or(0);
        if balance < q.lamports.unwrap_or(0) + sp.tip + BUY_RESERVE {
            return Err(err(StatusCode::BAD_REQUEST, "no_sol", "Not enough SOL for this trade and its fees", "Lower the amount or add SOL"));
        }
        Ok(())
    };
    let buy_decimals = async { if buy { decimals_of(c, &q.mint).await } else { decimals } };
    let mut checks = Some((balance_check, buy_decimals));
    let mut decimals = decimals;

    // A route that fails its simulation for a reason that is not the user's (a broken
    // pool, a missing account) is tried once more without the DEXes it used.
    let mut excluded: Vec<String> = Vec::new();
    loop {
        let exclude = if excluded.is_empty() { String::new() } else { format!("&excludeDexes={}", excluded.join(",").replace(' ', "%20")) };
        let quote_url = format!("{}/quote?inputMint={input}&outputMint={output}&amount={amount}&slippageBps={slippage}&maxAccounts=54&restrictIntermediateTokens=true{exclude}", jup_base(c));
        let quote = match checks.take() {
            Some((balance_check, buy_decimals)) => {
                let (quote, checked, d) = tokio::join!(jup(c, c.app.http.get(&quote_url)), balance_check, buy_decimals);
                checked?;
                decimals = d;
                quote?
            }
            None => jup(c, c.app.http.get(&quote_url)).await?,
        };
        let out_amount: u128 = quote["outAmount"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
        let min_out: u128 = quote["otherAmountThreshold"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
        let fee_out = if buy { 0 } else { fee_of(min_out.min(u64::MAX as u128) as u64) };
        if !buy && out_amount > MAX_LAMPORTS as u128 {
            return Err(err(StatusCode::BAD_REQUEST, "max", "At most 3 SOL per trade", "Sell a smaller part"));
        }
        let instr_req = jup(
            c,
            c.app.http.post(format!("{}/swap-instructions", jup_base(c))).json(&json!({
                "quoteResponse": quote, "userPublicKey": q.wallet, "wrapAndUnwrapSol": true, "dynamicComputeUnitLimit": true,
            })),
        );
        let (instr, estimate, bh) = tokio::join!(instr_req, priority_estimate(c, sp.level), blockhash(c));
        let instr = instr?;
        let (hash, last_valid) = bh.map_err(|_| err(StatusCode::BAD_GATEWAY, "rpc", "The network did not answer", "Try again"))?;

        let cu_limit = (instr["computeUnitLimit"].as_u64().unwrap_or(300_000) as u32).saturating_add(3_000).min(1_400_000);
        let price = priority_price(estimate, cu_limit, sp);
        let tip_account = stx::pubkey(TIP_ACCOUNTS[pick() % TIP_ACCOUNTS.len()]).expect("tip account");
        let fee = if buy { fee_in } else { fee_out };
        let ixs = assemble(&instr, wallet, fee_wallet, buy, fee, cu_limit, price, &tip_account, sp.tip).map_err(|e| {
            tracing::warn!(e, "bad jupiter instruction");
            err(StatusCode::BAD_GATEWAY, "route", "The swap router sent an unreadable route", "Try again")
        })?;
        let tables = lookup_tables(c, &instr).await.map_err(|e| {
            tracing::warn!(e, "lookup tables");
            err(StatusCode::BAD_GATEWAY, "rpc", "Could not load the route's lookup tables", "Try again")
        })?;
        let message = stx::compile_v0(wallet, &ixs, &tables, &hash).map_err(|e| {
            tracing::warn!(e, "compile failed");
            err(StatusCode::UNPROCESSABLE_ENTITY, "too_big", "This route is too large for one transaction", "Try a different amount")
        })?;
        let tx = stx::unsigned_tx(&message);
        if tx.len() > stx::MAX_TX_BYTES {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "too_big", "This route is too large for one transaction", "Try a different amount"));
        }
        // Simulate before the user is asked to sign: a trade that would fail is never sent.
        let sim = simulate(&c.r(), &tx).await?;
        let labels: Vec<String> = quote["routePlan"].as_array().map(|r| r.iter().filter_map(|p| p["swapInfo"]["label"].as_str().map(String::from)).collect()).unwrap_or_default();
        if !sim["err"].is_null() {
            let (e, code) = sim_error(&sim);
            if excluded.is_empty() && !user_error(code) && !labels.is_empty() {
                tracing::info!(code, mint = q.mint, ?labels, "route failed in simulation, trying another");
                excluded = labels;
                continue;
            }
            tracing::info!(code, mint = q.mint, "trade simulation failed");
            return Err(e);
        }
        let (sol_lamports, token_amount) = if buy { (q.lamports.unwrap_or(0) as u128, out_amount) } else { (out_amount, amount) };
        return Ok(Built {
            message,
            last_valid,
            cu_limit,
            price,
            sol_lamports,
            token_amount,
            min_out,
            fee,
            decimals,
            route: labels,
            price_impact_pct: quote["priceImpactPct"].as_str().and_then(|s| s.parse::<f64>().ok()).map(|p| p * 100.0),
            units: sim["unitsConsumed"].clone(),
        });
    }
}

/// The full instruction list of a trade, in the order the chain runs them:
/// compute budget; for a buy, the platform fee first; Jupiter's setup, swap, cleanup
/// and other instructions; for a sell, the platform fee from the SOL just received; and
/// last the Sender tip. Shared by the live endpoint and the mainnet simulation test.
#[allow(clippy::too_many_arguments)]
pub fn assemble(instr: &Value, wallet: &Pubkey, fee_wallet: &Pubkey, buy: bool, fee: u64, cu_limit: u32, price: u64, tip_account: &Pubkey, tip: u64) -> Result<Vec<Instruction>, String> {
    let mut ixs = vec![stx::compute_unit_limit(cu_limit), stx::compute_unit_price(price)];
    if buy && fee > 0 {
        ixs.push(stx::transfer(wallet, fee_wallet, fee));
    }
    for v in instr["setupInstructions"].as_array().cloned().unwrap_or_default() {
        ixs.push(ix_from(&v)?);
    }
    ixs.push(ix_from(&instr["swapInstruction"])?);
    if !instr["cleanupInstruction"].is_null() {
        ixs.push(ix_from(&instr["cleanupInstruction"])?);
    }
    for v in instr["otherInstructions"].as_array().cloned().unwrap_or_default() {
        ixs.push(ix_from(&v)?);
    }
    if !buy && fee > 0 {
        ixs.push(stx::transfer(wallet, fee_wallet, fee));
    }
    if tip > 0 {
        ixs.push(stx::transfer(wallet, tip_account, tip));
    }
    // Every signer must be the wallet itself: a route asking for another signer is refused.
    if ixs.iter().flat_map(|i| &i.accounts).any(|a| a.signer && a.pubkey != *wallet) {
        return Err("route needs another signer".into());
    }
    Ok(ixs)
}

/// Size of an address lookup table account's header; addresses follow it.
const LOOKUP_TABLE_META: usize = 56;

/// The route's lookup tables: from Jupiter's response when it includes their contents,
/// otherwise read from chain.
async fn lookup_tables(c: &TradeCtx, instr: &Value) -> Result<Vec<LookupTable>, String> {
    if let Some(o) = instr["addressesByLookupTableAddress"].as_object() {
        return Ok(o
            .iter()
            .filter_map(|(k, v)| Some(LookupTable { key: stx::pubkey(k).ok()?, addresses: v.as_array()?.iter().filter_map(|a| stx::pubkey(a.as_str()?).ok()).collect() }))
            .collect());
    }
    let keys: Vec<String> = instr["addressLookupTableAddresses"].as_array().map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect()).unwrap_or_default();
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let v = rpc(&c.r(), "getMultipleAccounts", json!([keys, { "encoding": "base64", "commitment": "confirmed" }])).await?;
    let mut out = Vec::new();
    for (k, acc) in keys.iter().zip(v["value"].as_array().cloned().unwrap_or_default()) {
        let data = B64.decode(acc["data"][0].as_str().ok_or("lookup table missing")?).map_err(|e| e.to_string())?;
        out.push(LookupTable { key: stx::pubkey(k)?, addresses: parse_lookup_table(&data) });
    }
    Ok(out)
}

pub fn parse_lookup_table(data: &[u8]) -> Vec<Pubkey> {
    data.get(LOOKUP_TABLE_META..).unwrap_or(&[]).chunks_exact(32).map(|c| c.try_into().expect("32 bytes")).collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[derive(Deserialize)]
pub struct SendIn {
    build_id: String,
    /// The transaction signed by the wallet, base64.
    tx: String,
}

/// `POST /trade/send`: checks the signed transaction is exactly the one built for this
/// user and wallet, records it and sends it. Each build can be sent once.
pub async fn send(State(c): State<TradeCtx>, headers: HeaderMap, Json(s): Json<SendIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth_err)?;
    if !c.admin.real_trading() {
        return Err(err(StatusCode::FORBIDDEN, "off", "Real trading is not open", ""));
    }
    let b = {
        let mut builds = c.t.builds.lock().expect("builds lock");
        match builds.get(&s.build_id) {
            Some(b) if b.user != user.id => return Err(bad("not your trade")),
            Some(b) if b.created.elapsed() >= BUILD_TTL => {
                builds.remove(&s.build_id);
                return Err(err(StatusCode::GONE, "expired", "This quote expired", "Get a fresh quote"));
            }
            Some(_) => builds.remove(&s.build_id).expect("present"),
            None => return Err(err(StatusCode::GONE, "expired", "This quote expired or was already sent", "Get a fresh quote")),
        }
    };
    let tx = B64.decode(s.tx.trim()).map_err(|_| bad("unreadable transaction"))?;
    if !stx::verify_signed(&tx, &b.message, &b.wallet) {
        tracing::warn!(user = user.id, "signed transaction does not match its build");
        return Err(err(StatusCode::BAD_REQUEST, "mismatch", "The signed transaction is not the one we built", "Get a fresh quote"));
    }
    let (sigs, _) = stx::split_tx(&tx).expect("verified");
    let signature = stx::b58(&sigs[0]);
    let raw = B64.encode(&tx);

    let mut row = b.row.clone();
    row["signature"] = json!(signature);
    row["status"] = json!("sent");
    if let Err(e) = c.acct.rest(reqwest::Method::POST, "real_trades", Some(row)).await {
        // Never send a trade we could not record.
        tracing::error!(error = %e.1, "could not record trade");
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "db", "Could not record the trade, nothing was sent", "Try again"));
    }
    c.t.live.lock().expect("live lock").insert(signature.clone(), Live { user: user.id.clone(), status: "sent", error: None, latency_ms: None, at: Instant::now() });

    let started = Instant::now();
    let accepted = broadcast(&c, &raw, b.speed, b.mev).await;
    if !accepted {
        // Neither path took it. It may still have reached a validator, so the tracker
        // decides from the chain; nothing is retried blindly.
        tracing::warn!(signature, "send not acknowledged");
    }
    tokio::spawn(track(c.clone(), signature.clone(), raw, b.last_valid, started, user.id, b.wallet, b.row["mint"].as_str().unwrap_or("").to_string()));
    Ok(Json(json!({ "signature": signature })))
}

/// Sends through Helius Sender (fast path) and the Helius RPC (backup) at once. True
/// when either accepted it.
async fn broadcast(c: &TradeCtx, raw: &str, sp: Speed, mev: bool) -> bool {
    let mut sender = format!("https://sender.helius-rpc.com/fast?api-key={}", c.app.config.helius_api_key);
    if sp.swqos_only {
        sender.push_str("&swqos_only=true");
    }
    if mev {
        sender.push_str("&mev-protect=true");
    }
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "sendTransaction", "params": [raw, { "encoding": "base64", "skipPreflight": true, "maxRetries": 0 }] });
    let fast = c.app.http.post(&sender).json(&body).timeout(Duration::from_secs(5)).send();
    let r = c.r();
    let backup = rpc(&r, "sendTransaction", json!([raw, { "encoding": "base64", "skipPreflight": true, "maxRetries": 0 }]));
    let (a, b) = tokio::join!(fast, backup);
    let a_ok = match a {
        Ok(r) => {
            let v: Value = r.json().await.unwrap_or(Value::Null);
            if v.get("error").is_some() {
                tracing::warn!(error = %v["error"], "sender rejected");
            }
            v["result"].is_string()
        }
        Err(e) => {
            tracing::warn!(%e, "sender unreachable");
            false
        }
    };
    a_ok || b.is_ok()
}

/// Follows a sent trade until it lands, fails or its blockhash expires, re-sending it
/// every two seconds meanwhile. Only an expired blockhash makes a retry safe, and the
/// chain is checked once more before calling it expired.
#[allow(clippy::too_many_arguments)]
async fn track(c: TradeCtx, sig: String, raw: String, last_valid: u64, started: Instant, user: String, wallet: Pubkey, mint: String) {
    let mut last_send = Instant::now();
    let mut last_height = Instant::now();
    let finish = |status: &'static str, error: Option<(String, String, String)>, latency: Option<u64>| {
        let mut l = c.t.live.lock().expect("live lock");
        l.retain(|_, x| x.at.elapsed() < Duration::from_secs(600));
        l.insert(sig.clone(), Live { user: user.clone(), status, error, latency_ms: latency, at: Instant::now() });
    };
    loop {
        tokio::time::sleep(Duration::from_millis(400)).await;
        let st = rpc(&c.r(), "getSignatureStatuses", json!([[sig], { "searchTransactionHistory": false }])).await.ok();
        let s = st.as_ref().map(|v| v["value"][0].clone()).unwrap_or(Value::Null);
        let landed = matches!(s["confirmationStatus"].as_str(), Some("confirmed" | "finalized"));
        if landed {
            let latency = started.elapsed().as_millis() as u64;
            let slot = s["slot"].as_u64();
            if s["err"].is_null() {
                finish("confirmed", None, Some(latency));
                let (sol, tok) = result_of(&c, &sig, &wallet, &mint).await;
                patch(&c, &sig, json!({ "status": "confirmed", "slot": slot, "latency_ms": latency, "sol_change_lamports": sol, "token_change": tok.map(|t| t.to_string()), "done_at": now_iso() })).await;
                tracing::info!(sig, latency, "trade confirmed");
            } else {
                let logs = logs_of(&c, &sig).await;
                let (code, message, hint) = diagnose(&s["err"], &logs);
                finish("failed", Some((code.into(), message.into(), hint.into())), Some(latency));
                patch(&c, &sig, json!({ "status": "failed", "slot": slot, "latency_ms": latency, "error_code": code, "error_message": format!("{} | {}", s["err"], logs.iter().rev().take(4).cloned().collect::<Vec<_>>().join(" / ")).chars().take(1000).collect::<String>(), "done_at": now_iso() })).await;
                tracing::info!(sig, code, "trade failed on chain");
            }
            return;
        }
        if last_height.elapsed() > Duration::from_secs(2) {
            last_height = Instant::now();
            let height = rpc(&c.r(), "getBlockHeight", json!([{ "commitment": "confirmed" }])).await.ok().and_then(|v| v.as_u64()).unwrap_or(0);
            if height > last_valid {
                // Expired: one last look at the full history before saying so.
                let again = rpc(&c.r(), "getSignatureStatuses", json!([[sig], { "searchTransactionHistory": true }])).await.ok();
                if again.as_ref().is_some_and(|v| !v["value"][0].is_null()) {
                    continue;
                }
                finish("expired", Some(("expired".into(), "The network did not take the trade in time".into(), "Nothing was spent. Try again".into())), None);
                patch(&c, &sig, json!({ "status": "expired", "error_code": "expired", "done_at": now_iso() })).await;
                tracing::info!(sig, "trade expired");
                return;
            }
        }
        if last_send.elapsed() > Duration::from_secs(2) {
            last_send = Instant::now();
            let _ = rpc(&c.r(), "sendTransaction", json!([raw, { "encoding": "base64", "skipPreflight": true, "maxRetries": 0 }])).await;
        }
        if started.elapsed() > Duration::from_secs(120) {
            tracing::warn!(sig, "trade tracking timed out; left as sent");
            return;
        }
    }
}

async fn patch(c: &TradeCtx, sig: &str, v: Value) {
    if let Err(e) = c.acct.rest(reqwest::Method::PATCH, &format!("real_trades?signature=eq.{sig}"), Some(v)).await {
        tracing::error!(sig, error = %e.1, "could not update trade");
    }
}

fn now_iso() -> String {
    crate::account::chrono_iso(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64))
}

async fn fetch_tx(c: &TradeCtx, sig: &str) -> Option<Value> {
    for _ in 0..5 {
        if let Ok(v) = rpc(&c.r(), "getTransaction", json!([sig, { "encoding": "json", "maxSupportedTransactionVersion": 1, "commitment": "confirmed" }])).await {
            if !v.is_null() {
                return Some(v);
            }
        }
        tokio::time::sleep(Duration::from_millis(600)).await;
    }
    None
}

async fn logs_of(c: &TradeCtx, sig: &str) -> Vec<String> {
    fetch_tx(c, sig).await.and_then(|v| v["meta"]["logMessages"].as_array().cloned()).map(|l| l.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// What the trade actually did to the wallet: SOL change (lamports, fees included)
/// and token change (raw units).
async fn result_of(c: &TradeCtx, sig: &str, wallet: &Pubkey, mint: &str) -> (Option<i64>, Option<i128>) {
    let Some(v) = fetch_tx(c, sig).await else { return (None, None) };
    let meta = &v["meta"];
    let sol = match (meta["preBalances"][0].as_i64(), meta["postBalances"][0].as_i64()) {
        (Some(a), Some(b)) => Some(b - a),
        _ => None,
    };
    let owner = stx::b58(wallet);
    let amount = |list: &Value| -> i128 {
        list.as_array()
            .map(|l| l.iter().filter(|b| b["owner"].as_str() == Some(&owner) && b["mint"].as_str() == Some(mint)).filter_map(|b| b["uiTokenAmount"]["amount"].as_str()?.parse::<i128>().ok()).sum())
            .unwrap_or(0)
    };
    (sol, Some(amount(&meta["postTokenBalances"]) - amount(&meta["preTokenBalances"])))
}

/// `GET /trade/status/{signature}`: where a sent trade stands.
pub async fn status(State(c): State<TradeCtx>, headers: HeaderMap, Path(sig): Path<String>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth_err)?;
    if let Some(l) = c.t.live.lock().expect("live lock").get(&sig).cloned() {
        if l.user != user.id {
            return Err(bad("not your trade"));
        }
        let e = l.error.map(|(code, message, hint)| json!({ "code": code, "message": message, "hint": hint }));
        return Ok(Json(json!({ "signature": sig, "status": l.status, "error": e, "latency_ms": l.latency_ms })));
    }
    if sig.len() > 100 || !sig.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(bad("not a signature"));
    }
    let v = c.acct.rest(reqwest::Method::GET, &format!("real_trades?signature=eq.{sig}&user_id=eq.{}&select=signature,status,error_code,latency_ms", user.id), None).await.map_err(auth_err)?;
    let row = v.as_array().and_then(|a| a.first()).cloned().ok_or_else(|| err(StatusCode::NOT_FOUND, "unknown", "Trade not found", ""))?;
    Ok(Json(row))
}

/// `GET /trade/history`: the user's real trades, newest first.
pub async fn history(State(c): State<TradeCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth_err)?;
    let v = c
        .acct
        .rest(reqwest::Method::GET, &format!("real_trades?user_id=eq.{}&select=*&order=created_at.desc&limit=200", user.id), None)
        .await
        .map_err(auth_err)?;
    Ok(Json(v))
}

#[cfg(test)]
mod tests {

    #[test]
    fn diagnose_any_venue_slippage() {
        // A real PumpSwap failure from mainnet.
        let logs = vec![
            "Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA failed: custom program error: 0x1798".to_string(),
            "Program log: AnchorError thrown in programs/pump-amm/src/instructions/swap/buy.rs:776. Error Code: BuySlippageBelowMinBaseAmountOut. Error Number: 6040. Error Message: buy: slippage - would buy less tokens than expected min_base_amount_out.".to_string(),
        ];
        assert_eq!(diagnose(&serde_json::json!({"InstructionError": [3, {"Custom": 6040}]}), &logs).0, "slippage");
        // A different error that only mentions the word elsewhere is not slippage.
        let other = vec!["Program log: AnchorError occurred. Error Code: AccountNotInitialized. Error Message: max slippage note.".to_string()];
        assert_ne!(diagnose(&serde_json::json!({}), &other).0, "slippage");
        // Selling a coin the wallet has no account for (PumpSwap 3012).
        let none = vec!["Program log: AnchorError caused by account: user_base_token_account. Error Code: AccountNotInitialized. Error Number: 3012.".to_string()];
        assert_eq!(diagnose(&serde_json::json!({}), &none).0, "no_tokens");
    }
    use super::*;

    #[test]
    fn fees_and_limits() {
        assert_eq!(fee_of(1_000_000_000), 10_000_000, "1% of 1 SOL");
        assert_eq!(fee_of(MAX_LAMPORTS), 30_000_000);
        assert_eq!(fee_of(99), 0, "rounds down: never over 1%");
        for t in TIP_ACCOUNTS {
            assert!(stx::pubkey(t).is_ok(), "{t}");
        }
        assert_eq!(speed("fast"), FAST);
        assert_eq!(speed("anything"), TURBO);
    }

    #[test]
    fn priority_fee_stays_inside_floor_and_cap() {
        // Quiet network: the floor applies.
        assert_eq!(priority_price(0, 100_000, TURBO), TURBO.min_price);
        // Normal: the estimate.
        assert_eq!(priority_price(500_000, 100_000, TURBO), 500_000);
        // A spike can never cost more than the speed's cap in total.
        let p = priority_price(900_000_000, 100_000, TURBO);
        assert!(100_000 * p / 1_000_000 <= TURBO.max_priority);
        let p = priority_price(900_000_000, 200_000, FAST);
        assert!(200_000 * p / 1_000_000 <= FAST.max_priority);
    }

    #[test]
    fn failures_are_explained() {
        let logs = |s: &str| vec![s.to_string()];
        assert_eq!(diagnose(&json!({"InstructionError":[3,{"Custom":6001}]}), &logs("Program log: Error: SlippageToleranceExceeded")).0, "slippage");
        assert_eq!(diagnose(&json!({"InstructionError":[3,{"Custom":6001}]}), &logs("Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1771")).0, "slippage");
        // The same number from another program is not a slippage error.
        assert_eq!(diagnose(&json!({"InstructionError":[3,{"Custom":6001}]}), &logs("Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA failed: custom program error: 0x1771")).0, "failed");
        // Every log reports compute used; that alone is not a compute failure.
        assert_eq!(diagnose(&json!({"InstructionError":[3,{"Custom":6038}]}), &logs("Program X consumed 5000 of 200000 compute units")).0, "failed");
        assert_eq!(diagnose(&json!({"InstructionError":[3,{"Custom":6024}]}), &logs("Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1788")).0, "no_tokens");
        assert_eq!(diagnose(&json!({"InstructionError":[3,{"Custom":6023}]}), &logs("Program log: AnchorError occurred. Error Code: NotEnoughTokensToSell.")).0, "no_tokens");
        assert_eq!(diagnose(&json!({"InstructionError":[3,{"Custom":6004}]}), &logs("Program log: AnchorError occurred. Error Code: ExceededSlippage.")).0, "slippage");
        assert_eq!(diagnose(&json!({"InstructionError":[2,{"Custom":6024}]}), &logs("Program log: AnchorError thrown in programs/pump/src/lib.rs:1037. Error Code: Overflow. Error Number: 6024.")).0, "liquidity");
        assert_eq!(diagnose(&json!("InsufficientFundsForFee"), &[]).0, "no_sol");
        assert_eq!(diagnose(&json!({"InstructionError":[2,{"Custom":1}]}), &logs("Program log: Error: insufficient funds")).0, "no_tokens");
        assert_eq!(diagnose(&json!("BlockhashNotFound"), &[]).0, "expired");
        assert_eq!(diagnose(&json!({"InstructionError":[4,"ComputationalBudgetExceeded"]}), &[]).0, "compute");
        assert_eq!(diagnose(&json!({"InstructionError":[1,"Whatever"]}), &[]).0, "failed");
    }
}

/// Read-only checks against mainnet: real Jupiter routes, assembled by `assemble` and
/// compiled by our own v0 compiler exactly as `quote` does, then simulated by the
/// network (no signature; nothing is ever sent). Cases come from SIM_CASES, a JSON file
/// of {mint, kind, sym, seller, sell_raw}. Run with:
/// `SIM_CASES=cases.json cargo test -p monexa-gateway live_matrix -- --ignored --nocapture`
#[cfg(test)]
mod live {
    use super::*;

    /// A wallet holding millions of SOL, used only as the simulated buyer.
    const BUYER: &str = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    /// Stand-in fee wallet for simulation (a funded Sender tip account).
    const FEE_STANDIN: &str = "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ";

    async fn post(http: &reqwest::Client, url: &str, body: Value) -> Value {
        for i in 0..6 {
            let r = http.post(url).json(&body).send().await.unwrap();
            if r.status().as_u16() == 429 {
                tokio::time::sleep(Duration::from_millis(400 * (i + 1))).await;
                continue;
            }
            return r.json().await.unwrap_or(Value::Null);
        }
        Value::Null
    }

    /// Keyless Jupiter allows about 0.5 requests a second: pace and retry on 429.
    async fn jup_call(http: &reqwest::Client, url: &str, body: Option<Value>) -> Value {
        for _ in 0..5 {
            tokio::time::sleep(Duration::from_millis(2_500)).await;
            let req = match &body {
                Some(b) => http.post(url).json(b),
                None => http.get(url),
            };
            let v: Value = req.send().await.unwrap().json().await.unwrap_or(Value::Null);
            if v["code"] != 429 {
                return v;
            }
        }
        Value::Null
    }

    /// Builds the trade like `quote` and simulates it. Returns (bytes, err, units, code).
    async fn run(http: &reqwest::Client, rpc_url: &str, wallet: &str, input: &str, output: &str, amount: u128) -> Result<(usize, Value, Value, &'static str), String> {
        let q = jup_call(http, &format!("https://lite-api.jup.ag/swap/v1/quote?inputMint={input}&outputMint={output}&amount={amount}&slippageBps=1000&maxAccounts=54&restrictIntermediateTokens=true"), None).await;
        if !q["outAmount"].is_string() {
            return Err(format!("no quote: {}", q.to_string().chars().take(120).collect::<String>()));
        }
        let si = jup_call(http, "https://lite-api.jup.ag/swap/v1/swap-instructions", Some(json!({ "quoteResponse": q, "userPublicKey": wallet, "wrapAndUnwrapSol": true, "dynamicComputeUnitLimit": true }))).await;
        if !si["swapInstruction"].is_object() {
            return Err(format!("no instructions: {}", si.to_string().chars().take(120).collect::<String>()));
        }
        let buy = input == WSOL;
        let w = stx::pubkey(wallet).unwrap();
        let fee = if buy { fee_of(amount as u64) } else { fee_of(q["otherAmountThreshold"].as_str().unwrap().parse().unwrap()) };
        let cu = (si["computeUnitLimit"].as_u64().unwrap_or(300_000) as u32).saturating_add(3_000);
        let price = priority_price(50_000, cu, TURBO);
        let ixs = assemble(&si, &w, &stx::pubkey(FEE_STANDIN).unwrap(), buy, fee, cu, price, &stx::pubkey(TIP_ACCOUNTS[0]).unwrap(), TURBO.tip)?;
        let tables: Vec<LookupTable> = match si["addressesByLookupTableAddress"].as_object() {
            Some(o) => o.iter().map(|(k, v)| LookupTable { key: stx::pubkey(k).unwrap(), addresses: v.as_array().unwrap().iter().map(|a| stx::pubkey(a.as_str().unwrap()).unwrap()).collect() }).collect(),
            None => {
                let keys: Vec<String> = si["addressLookupTableAddresses"].as_array().map(|a| a.iter().map(|k| k.as_str().unwrap().to_string()).collect()).unwrap_or_default();
                if keys.is_empty() {
                    vec![]
                } else {
                    let accs = post(http, rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"getMultipleAccounts","params":[keys, {"encoding":"base64"}]})).await;
                    keys.iter().zip(accs["result"]["value"].as_array().unwrap()).map(|(k, a)| LookupTable { key: stx::pubkey(k).unwrap(), addresses: parse_lookup_table(&B64.decode(a["data"][0].as_str().unwrap()).unwrap()) }).collect()
                }
            }
        };
        let bh = post(http, rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]})).await;
        let hash = stx::pubkey(bh["result"]["value"]["blockhash"].as_str().unwrap()).unwrap();
        let msg = stx::compile_v0(&w, &ixs, &tables, &hash)?;
        let tx = stx::unsigned_tx(&msg);
        let sim = post(http, rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"simulateTransaction","params":[B64.encode(&tx), {"encoding":"base64","sigVerify":false,"replaceRecentBlockhash":true,"commitment":"processed"}]})).await;
        let v = sim["result"]["value"].clone();
        let logs: Vec<String> = v["logs"].as_array().map(|l| l.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
        let code = if v["err"].is_null() { "ok" } else { diagnose(&v["err"], &logs).0 };
        if !v["err"].is_null() {
            let route: Vec<&str> = q["routePlan"].as_array().map(|r| r.iter().filter_map(|p| p["swapInfo"]["label"].as_str()).collect()).unwrap_or_default();
            println!("    route {route:?} err {}", v["err"]);
            for l in logs.iter().filter(|l| l.contains("invoke") || l.contains("rror") || l.contains("failed")).rev().take(5).collect::<Vec<_>>().into_iter().rev() {
                println!("    | {l}");
            }
        }
        Ok((tx.len(), v["err"].clone(), v["unitsConsumed"].clone(), code))
    }

    #[tokio::test]
    #[ignore]
    async fn live_matrix() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let _ = dotenvy::from_path("../../.env");
        let rpc_url = format!("https://mainnet.helius-rpc.com/?api-key={}", std::env::var("HELIUS_API_KEY").expect("HELIUS_API_KEY"));
        let http = reqwest::Client::new();
        let cases: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(std::env::var("SIM_CASES").expect("SIM_CASES")).unwrap()).unwrap();
        let mut failures = Vec::new();
        for c in &cases {
            let mint = c["mint"].as_str().unwrap();
            let name = format!("{} {}", c["kind"].as_str().unwrap_or(""), c["sym"].as_str().unwrap_or(""));
            // 1. Buy 0.1 SOL.
            match run(&http, &rpc_url, BUYER, WSOL, mint, 100_000_000).await {
                Ok((bytes, e, units, code)) => {
                    println!("{name:<30} buy  {code:<9} {bytes:>4} bytes {units} CU");
                    if !e.is_null() {
                        failures.push(format!("{name} buy: {e}"));
                    }
                }
                Err(e) => println!("{name:<30} buy  no route ({e})"),
            }
            if let (Some(seller), Some(raw)) = (c["seller"].as_str(), c["sell_raw"].as_str()) {
                // 2. Sell a small part of a real holder's coins.
                match run(&http, &rpc_url, seller, mint, WSOL, raw.parse().unwrap()).await {
                    Ok((bytes, e, units, code)) => {
                        println!("{name:<30} sell {code:<9} {bytes:>4} bytes {units} CU");
                        if !e.is_null() {
                            failures.push(format!("{name} sell: {e}"));
                        }
                    }
                    Err(e) => println!("{name:<30} sell no route ({e})"),
                }
                // 3. Selling far more than the wallet holds must fail and be explained.
                if let Ok((_, e, _, code)) = run(&http, &rpc_url, seller, mint, WSOL, raw.parse::<u128>().unwrap() * 100_000).await {
                    println!("{name:<30} oversell -> {code}");
                    if e.is_null() {
                        failures.push(format!("{name} oversell unexpectedly passed"));
                    }
                }
            }
        }
        // 4. A buy from a wallet without enough SOL fails, explained.
        let empty = stx::b58(&[7u8; 32]);
        if let Ok((_, e, _, code)) = run(&http, &rpc_url, &empty, WSOL, cases[0]["mint"].as_str().unwrap(), 100_000_000).await {
            println!("buy from an empty wallet -> {code} ({e})");
            if e.is_null() {
                failures.push("empty wallet buy unexpectedly passed".into());
            }
        }
        assert!(failures.is_empty(), "failures: {failures:#?}");
    }

    /// Builds a native trade (pump.fun curve or PumpSwap pool) with the production
    /// functions and simulates it, then simulates the tightened version too.
    async fn run_native(http: &reqwest::Client, rpc_url: &str, wallet: &str, mint: &str, buy: bool, amount: u64) -> Result<(usize, Value, Value, &'static str, &'static str), String> {
        use crate::{pumpfun_tx as pf, pumpswap_tx as ps};
        let w = stx::pubkey(wallet)?;
        let m = stx::pubkey(mint)?;
        let keys = native_keys(&w, &m, std::env::var("SIM_DBC_POOL").ok().as_deref());
        let accs = post(http, rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"getMultipleAccounts","params":[keys, {"encoding":"base64"}]})).await;
        let values = accs["result"]["value"].as_array().cloned().ok_or("no accounts")?;
        let h = holder_inputs(&values).ok_or("not a token")?;
        let fraction = if buy { 0.0 } else { (amount as f64 / h.held.max(1) as f64).min(1.0) };
        let read = |key: String| {
            let http = http.clone();
            let rpc_url = rpc_url.to_string();
            async move {
                let v = post(&http, &rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":[key, {"encoding":"base64"}]})).await;
                B64.decode(v["result"]["value"]["data"][0].as_str().unwrap_or("")).unwrap_or_default()
            }
        };
        let plan = if let Some(curve) = live_curve(&values) {
            let global = pf::Global::parse(&read(stx::b58(&pf::global())).await).ok_or("bad global")?;
            native_plan(Venue::Curve(&curve, &global), &h, &w, &m, buy, amount, fraction, 1_000, TURBO.tip, 3)
        } else if let Some(mut pool) = sol_pool(&values, &keys) {
            let r = post(http, rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"getMultipleAccounts","params":[[stx::b58(&pool.pool_base), stx::b58(&pool.pool_quote)], {"encoding":"base64"}]})).await;
            let r = r["result"]["value"].as_array().cloned().unwrap_or_default();
            pool.set_reserves(token_amount(&r, 0), token_amount(&r, 1));
            let cfg = ps::Config::parse(&read(stx::b58(&ps::global_config())).await).ok_or("bad config")?;
            native_plan(Venue::Pool(&pool, &cfg), &h, &w, &m, buy, amount, fraction, 1_000, TURBO.tip, 3)
        } else {
            return Err("no native venue (router path)".into());
        };
        let plan = match plan {
            Ok(Some(p)) => p,
            Ok(None) => return Err("router path".into()),
            Err((_, body)) => return Ok((0, body.0["code"].clone(), Value::Null, "refused", "-")),
        };
        let bh = post(http, rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]})).await;
        let hash = stx::pubkey(bh["result"]["value"]["blockhash"].as_str().unwrap())?;
        let fee_wallet = stx::pubkey(FEE_STANDIN)?;
        let tip = stx::pubkey(TIP_ACCOUNTS[0])?;
        let sim = |msg: Vec<u8>| {
            let http = http.clone();
            let rpc_url = rpc_url.to_string();
            async move {
                let v = post(&http, &rpc_url, json!({"jsonrpc":"2.0","id":1,"method":"simulateTransaction","params":[B64.encode(stx::unsigned_tx(&msg)), {"encoding":"base64","sigVerify":false,"replaceRecentBlockhash":true,"commitment":"processed"}]})).await;
                v["result"]["value"].clone()
            }
        };
        let msg = compose(&w, &fee_wallet, buy, plan.fee, &plan.program_ixs, &tip, TURBO.tip, 300_000, priority_price(50_000, 300_000, TURBO), &hash)?;
        let r = sim(msg.clone()).await;
        let logs: Vec<String> = r["logs"].as_array().map(|l| l.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
        if !r["err"].is_null() {
            for l in logs.iter().filter(|l| l.contains("rror") || l.contains("failed")).take(4) {
                println!("    | {l}");
            }
            return Ok((msg.len(), r["err"].clone(), r["unitsConsumed"].clone(), diagnose(&r["err"], &logs).0, plan.route));
        }
        let limit = tight_limit(r["unitsConsumed"].as_u64().unwrap_or(300_000), 300_000);
        let msg2 = compose(&w, &fee_wallet, buy, plan.fee, &plan.program_ixs, &tip, TURBO.tip, limit, priority_price(50_000, limit, TURBO), &hash)?;
        let r2 = sim(msg2.clone()).await;
        let code = if r2["err"].is_null() { "ok" } else { "tight-fail" };
        if let Ok(dir) = std::env::var("SIM_DUMP") {
            let spent = if buy { amount } else { 0 };
            let _ = std::fs::write(
                format!("{dir}/{}-{}.json", &mint[..8], if buy { "buy" } else { "sell" }),
                json!({ "tx": B64.encode(stx::unsigned_tx(&msg2)), "wallet": wallet, "side": if buy { "buy" } else { "sell" }, "spend": spent.to_string(), "fee_wallet": FEE_STANDIN, "fee": plan.fee.to_string(), "tip": TURBO.tip.to_string(), "priority": ((limit as u64 * priority_price(50_000, limit, TURBO)).div_ceil(1_000_000)).to_string() }).to_string(),
            );
        }
        Ok((stx::unsigned_tx(&msg2).len(), r2["err"].clone(), r2["unitsConsumed"].clone(), code, plan.route))
    }

    /// Our pump.fun builder against mainnet. SIM_PUMP lines: "<mint> <holder> <raw balance>".
    #[tokio::test]
    #[ignore]
    async fn live_pump() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let _ = dotenvy::from_path("../../.env");
        let rpc_url = format!("https://mainnet.helius-rpc.com/?api-key={}", std::env::var("HELIUS_API_KEY").expect("HELIUS_API_KEY"));
        let http = reqwest::Client::new();
        let mut failures = Vec::new();
        for line in std::fs::read_to_string(std::env::var("SIM_PUMP").expect("SIM_PUMP")).unwrap().lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 {
                continue;
            }
            let (mint, holder, raw) = (parts[0], parts[1], parts[2].parse::<u64>().unwrap_or(0));
            for (label, wallet, buy, amount) in [("buy 0.1 SOL", BUYER, true, 100_000_000u64), ("sell 10%", holder, false, raw / 10), ("sell 0.01%", holder, false, raw / 10_000)] {
                match run_native(&http, &rpc_url, wallet, mint, buy, amount).await {
                    Ok((bytes, e, units, code, route)) => {
                        println!("{:<12} {route:<9} {label:<12} {code:<9} {bytes:>4} bytes {units} CU", &mint[..8]);
                        if !e.is_null() && code != "liquidity" && code != "refused" {
                            failures.push(format!("{mint} {label}: {e}"));
                        }
                    }
                    Err(e) => println!("{:<12} {label:<12} skipped ({e})", &mint[..8]),
                }
            }
        }
        assert!(failures.is_empty(), "failures: {failures:#?}");
    }


    /// DBC and LaunchLab trades through the production path: native_keys, holder_inputs,
    /// sim_venue and sim_quoted_build (quote simulation, real build, second simulation).
    /// SIM_LAUNCH lines: "<mint> <dbc pool or -> <holder> <raw balance>".
    #[tokio::test]
    #[ignore]
    async fn live_launch() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let _ = tracing_subscriber::fmt().with_test_writer().try_init();
        let _ = dotenvy::from_path("../../.env");
        let r = Rpc { http: reqwest::Client::new(), url: format!("https://mainnet.helius-rpc.com/?api-key={}", std::env::var("HELIUS_API_KEY").expect("HELIUS_API_KEY")) };
        let mut failures = Vec::new();
        for line in std::fs::read_to_string(std::env::var("SIM_LAUNCH").expect("SIM_LAUNCH")).unwrap().lines() {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() < 4 {
                continue;
            }
            let (mint, dbc, holder, raw) = (p[0], (p[1] != "-").then_some(p[1]), p[2], p[3].parse::<u64>().unwrap_or(0));
            for (label, wallet, buy, fraction) in [("buy 0.1 SOL", BUYER, true, 0.0), ("sell 1%", holder, false, 0.01)] {
                let w = stx::pubkey(wallet).unwrap();
                let m = stx::pubkey(mint).unwrap();
                let keys = native_keys(&w, &m, dbc);
                let accs = rpc(&r, "getMultipleAccounts", json!([keys, { "encoding": "base64" }])).await.unwrap();
                let values = accs["value"].as_array().cloned().unwrap_or_default();
                let Some(h) = holder_inputs(&values) else {
                    println!("{:<10} {label:<12} not a token", &mint[..8]);
                    continue;
                };
                let Some(venue) = sim_venue(&r, &values, &keys).await else {
                    println!("{:<10} {label:<12} no launchpad venue (router path)", &mint[..8]);
                    continue;
                };
                let q = QuoteIn { wallet: wallet.into(), mint: mint.into(), side: if buy { "buy" } else { "sell" }.into(), lamports: Some(100_000_000), fraction: Some(fraction), slippage_bps: Some(1_000), speed: None, mev: None, symbol: String::new() };
                let bh = rpc(&r, "getLatestBlockhash", json!([{ "commitment": "confirmed" }])).await.unwrap();
                let hash = stx::pubkey(bh["value"]["blockhash"].as_str().unwrap()).unwrap();
                match sim_quoted_build(&r, &q, &w, &stx::pubkey(FEE_STANDIN).unwrap(), buy, 1_000, TURBO, &h, &values, &venue, &hash, 0, 50_000).await {
                    Ok(Some(b)) => {
                        // The tightened final transaction must pass as well.
                        let fin = simulate(&r, &stx::unsigned_tx(&b.message)).await.unwrap();
                        let ok = fin["err"].is_null();
                        println!("{:<10} {:<17} {label:<12} {} out {} min {} fee {} limit {} used {} {} bytes", &mint[..8], venue.route(), if ok { "ok" } else { "FINAL-FAIL" }, if buy { b.token_amount } else { b.sol_lamports }, b.min_out, b.fee, b.cu_limit, fin["unitsConsumed"], stx::unsigned_tx(&b.message).len());
                        if !ok {
                            failures.push(format!("{mint} {label}: {}", fin["err"]));
                        }
                        if let Ok(dir) = std::env::var("SIM_DUMP") {
                            let _ = std::fs::write(
                                format!("{dir}/{}-{}.json", &mint[..8], if buy { "buy" } else { "sell" }),
                                json!({ "tx": B64.encode(stx::unsigned_tx(&b.message)), "wallet": wallet, "side": if buy { "buy" } else { "sell" }, "spend": if buy { "100000000" } else { "0" }, "fee_wallet": FEE_STANDIN, "fee": b.fee.to_string(), "tip": TURBO.tip.to_string(), "priority": ((b.cu_limit as u64 * b.price).div_ceil(1_000_000)).to_string() }).to_string(),
                            );
                        }
                    }
                    Ok(None) => println!("{:<10} {:<17} {label:<12} router fallback", &mint[..8], venue.route()),
                    Err((_, body)) => println!("{:<10} {:<17} {label:<12} refused: {}", &mint[..8], venue.route(), body.0["code"]),
                }
                let _ = raw;
            }
        }
        assert!(failures.is_empty(), "failures: {failures:#?}");
    }

}
