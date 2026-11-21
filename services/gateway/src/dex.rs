//! Chart candles and recent trades for Solana tokens outside our own pump.fun decoder
//! (Raydium, Meteora, Orca, PumpSwap and other DEX pools), from GeckoTerminal's free
//! public API. Solana network only. Free tier allows about 30 calls a minute, so
//! everything is cached and shared between viewers.

use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const BASE: &str = "https://api.geckoterminal.com/api/v2/networks/solana";
const POOL_TTL: Duration = Duration::from_secs(30 * 60);
const CANDLES_TTL: Duration = Duration::from_secs(30);
const TRADES_TTL: Duration = Duration::from_secs(10);
const MAX_ENTRIES: usize = 500;
/// Calls allowed per minute: under the free tier's 30, leaving headroom.
const CALLS_PER_MINUTE: usize = 25;

#[derive(Debug, Clone, Serialize)]
pub struct Pool {
    pub address: String,
    /// e.g. "TRUMP / USDC"
    pub name: String,
    pub dex: Option<String>,
    /// Quote token mint, e.g. wrapped SOL.
    pub quote: Option<String>,
}

/// One minute candle of the token's USD price; volume in USD.
#[derive(Debug, Clone, Serialize)]
pub struct DexCandle {
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DexTrade {
    pub signature: String,
    pub ts: i64,
    pub wallet: String,
    pub is_buy: bool,
    pub usd: f64,
    pub tokens: f64,
    pub price_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DexHistory {
    pub pool: Pool,
    pub candle_secs: i64,
    pub candles: Vec<DexCandle>,
    pub trades: Vec<DexTrade>,
}

type Slot<T> = Mutex<HashMap<String, (Instant, T)>>;

#[derive(Default)]
pub struct DexCache {
    pools: Slot<Option<Pool>>,
    candles: Slot<Vec<DexCandle>>,
    trades: Slot<Vec<DexTrade>>,
    big: Slot<Vec<DexTrade>>,
    /// When the last calls went out, to stay inside the rate limit.
    calls: Mutex<std::collections::VecDeque<Instant>>,
    /// After a 429 no call goes out until this time: retrying while blocked only
    /// extends the block.
    paused_until: Mutex<Option<Instant>>,
    /// When the last call went out: calls are spaced, since a burst in one second is
    /// what the indexer answers with 429 even inside the minute's budget.
    gate: tokio::sync::Mutex<Option<Instant>>,
    /// One history load per coin at a time: the page and the gateway ask together when
    /// a coin opens, and the second one is served from the first one's cache.
    flights: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

/// Shortest time between two calls.
const MIN_GAP: Duration = Duration::from_millis(700);
/// Calls that can wait (whale lists) use at most this share of the minute, so a chart's
/// history always finds room.
const LOW_CALLS_PER_MINUTE: usize = 12;

/// Quiet period after the indexer answers 429.
const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(60);

impl DexCache {
    fn paused(&self) -> bool {
        self.paused_until.lock().expect("dex pause lock").is_some_and(|t| Instant::now() < t)
    }

    /// Takes one call from the per-minute budget; false when it is spent or paused.
    /// `low`: a call that can wait, held to a smaller share of the budget.
    fn take_call(&self, low: bool) -> bool {
        if self.paused() {
            return false;
        }
        let mut calls = self.calls.lock().expect("dex calls lock");
        while calls
            .front()
            .is_some_and(|t| t.elapsed() > Duration::from_secs(60))
        {
            calls.pop_front();
        }
        if calls.len() >= if low { LOW_CALLS_PER_MINUTE } else { CALLS_PER_MINUTE } {
            return false;
        }
        calls.push_back(Instant::now());
        true
    }
}

/// The last value stored, however old: shown when a refresh fails or the budget is
/// spent, so a rate limit never blanks a chart that already had data.
fn stale<T: Clone>(slot: &Slot<T>, key: &str) -> Option<T> {
    slot.lock()
        .expect("dex cache lock")
        .get(key)
        .map(|(_, v)| v.clone())
}

fn cached<T: Clone>(slot: &Slot<T>, key: &str, ttl: Duration) -> Option<T> {
    let map = slot.lock().expect("dex cache lock");
    map.get(key)
        .filter(|(at, _)| at.elapsed() < ttl)
        .map(|(_, v)| v.clone())
}

fn store<T>(slot: &Slot<T>, key: &str, v: T, ttl: Duration) {
    let mut map = slot.lock().expect("dex cache lock");
    if map.len() >= MAX_ENTRIES {
        // Keep anything from the last ten minutes as a fallback.
        map.retain(|_, (at, _)| at.elapsed() < ttl.max(Duration::from_secs(600)));
    }
    map.insert(key.to_string(), (Instant::now(), v));
}

async fn get_json(http: &reqwest::Client, cache: &DexCache, url: &str) -> Option<Value> {
    get_json_as(http, cache, url, false).await
}

async fn get_json_as(http: &reqwest::Client, cache: &DexCache, url: &str, low: bool) -> Option<Value> {
    if !cache.take_call(low) {
        return None;
    }
    {
        let mut last = cache.gate.lock().await;
        if let Some(wait) = last.map(|t| MIN_GAP.saturating_sub(t.elapsed())).filter(|w| !w.is_zero()) {
            tokio::time::sleep(wait).await;
        }
        *last = Some(Instant::now());
    }
    // A 429 while this call waited its turn: going out now would only extend the block.
    if cache.paused() {
        return None;
    }
    let res = http
        .get(url)
        .header("accept", "application/json")
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .ok()?;
    if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        *cache.paused_until.lock().expect("dex pause lock") =
            Some(Instant::now() + RATE_LIMIT_PAUSE);
        tracing::warn!(pause = ?RATE_LIMIT_PAUSE, "geckoterminal rate limited, pausing");
        return None;
    }
    if !res.status().is_success() {
        tracing::warn!(status = %res.status(), "geckoterminal error status");
        return None;
    }
    res.json().await.ok()
}

fn num(v: &Value) -> f64 {
    v.as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| v.as_f64())
        .unwrap_or(0.0)
}

/// The token's most liquid Solana pool (GeckoTerminal lists the top pool first).
async fn pool(http: &reqwest::Client, cache: &DexCache, mint: &str) -> Option<Pool> {
    if let Some(p) = cached(&cache.pools, mint, POOL_TTL) {
        return p;
    }
    let Some(v) = get_json(http, cache, &format!("{BASE}/tokens/{mint}/pools?page=1")).await else {
        return stale(&cache.pools, mint).flatten();
    };
    let first = v["data"].as_array().and_then(|a| a.first());
    let pool = first.map(|p| Pool {
        address: p["attributes"]["address"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        name: p["attributes"]["name"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        dex: p["relationships"]["dex"]["data"]["id"]
            .as_str()
            .map(String::from),
        quote: p["relationships"]["quote_token"]["data"]["id"]
            .as_str()
            .and_then(|id| id.strip_prefix("solana_"))
            .map(String::from),
    });
    let pool = pool.filter(|p| !p.address.is_empty());
    store(&cache.pools, mint, pool.clone(), POOL_TTL);
    pool
}

async fn candles(
    http: &reqwest::Client,
    cache: &DexCache,
    pool: &str,
    mint: &str,
) -> Vec<DexCandle> {
    let key = format!("{pool}:{mint}");
    if let Some(c) = cached(&cache.candles, &key, CANDLES_TTL) {
        return c;
    }
    let url = format!(
        "{BASE}/pools/{pool}/ohlcv/minute?aggregate=1&limit=1000&currency=usd&token={mint}"
    );
    let Some(v) = get_json(http, cache, &url).await else {
        return stale(&cache.candles, &key).unwrap_or_default();
    };
    let mut list: Vec<DexCandle> = v["data"]["attributes"]["ohlcv_list"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    let r = r.as_array()?;
                    Some(DexCandle {
                        t: r.first()?.as_i64()?,
                        o: num(r.get(1)?),
                        h: num(r.get(2)?),
                        l: num(r.get(3)?),
                        c: num(r.get(4)?),
                        v: num(r.get(5)?),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    list.sort_by_key(|c| c.t); // the API returns newest first
    store(&cache.candles, &key, list.clone(), CANDLES_TTL);
    list
}

async fn trades(http: &reqwest::Client, cache: &DexCache, pool: &str, mint: &str) -> Vec<DexTrade> {
    let key = format!("{pool}:{mint}");
    if let Some(t) = cached(&cache.trades, &key, TRADES_TTL) {
        return t;
    }
    let Some(v) = get_json(http, cache, &format!("{BASE}/pools/{pool}/trades")).await else {
        return stale(&cache.trades, &key).unwrap_or_default();
    };
    let list: Vec<DexTrade> = v["data"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| trade_of(&r["attributes"], mint))
                .collect()
        })
        .unwrap_or_default();
    let list = merge_trades(list, stale(&cache.trades, &key).unwrap_or_default());
    store(&cache.trades, &key, list.clone(), TRADES_TTL);
    list
}

/// Most trades kept per pool. The indexer returns only its latest 300 per call, so
/// each refresh is merged into what we already have and the history grows while the
/// coin is being watched.
const MAX_TRADES: usize = 1_000;

/// New trades on top of earlier ones, newest first, without duplicates.
fn merge_trades(fresh: Vec<DexTrade>, earlier: Vec<DexTrade>) -> Vec<DexTrade> {
    let mut seen = std::collections::HashSet::new();
    let mut all: Vec<DexTrade> = fresh
        .into_iter()
        .chain(earlier)
        .filter(|t| seen.insert((t.signature.clone(), t.wallet.clone(), t.is_buy)))
        .collect();
    all.sort_by(|a, b| b.ts.cmp(&a.ts));
    all.truncate(MAX_TRADES);
    all
}

/// A swap from this token's side: buying it when it is the output, selling when it is
/// the input, whichever side of the pool it sits on.
fn trade_of(a: &Value, mint: &str) -> Option<DexTrade> {
    let (is_buy, tokens, price_usd) = if a["to_token_address"].as_str() == Some(mint) {
        (true, num(&a["to_token_amount"]), num(&a["price_to_in_usd"]))
    } else if a["from_token_address"].as_str() == Some(mint) {
        (
            false,
            num(&a["from_token_amount"]),
            num(&a["price_from_in_usd"]),
        )
    } else {
        return None;
    };
    let ts = a["block_timestamp"]
        .as_str()
        .and_then(|s| chrono_like_parse(s))?;
    Some(DexTrade {
        signature: a["tx_hash"].as_str()?.to_string(),
        ts,
        wallet: a["tx_from_address"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        is_buy,
        usd: num(&a["volume_in_usd"]),
        tokens,
        price_usd,
    })
}

/// Parses `2026-11-05T21:10:04Z` to unix seconds without pulling in a date crate.
fn chrono_like_parse(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (
        n(0..4)?,
        n(5..7)?,
        n(8..10)?,
        n(11..13)?,
        n(14..16)?,
        n(17..19)?,
    );
    // Days from civil (Howard Hinnant's algorithm).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3_600 + mi * 60 + se)
}

/// Pool, candles and trades for one token. None when no Solana pool is known.
/// Trades of `min_usd` or more on the coin's main pool in the last day (the provider
/// returns up to 300), newest first. One call, cached two minutes.
pub async fn big_trades(http: &reqwest::Client, cache: &Arc<DexCache>, mint: &str, min_usd: u32) -> Option<(Pool, Vec<DexTrade>)> {
    let pool = pool(http, cache, mint).await?;
    let key = format!("{}:{mint}:{min_usd}", pool.address);
    if let Some(t) = cached(&cache.big, &key, Duration::from_secs(120)) {
        return Some((pool, t));
    }
    let Some(v) = get_json_as(http, cache, &format!("{BASE}/pools/{}/trades?trade_volume_in_usd_greater_than={min_usd}", pool.address), true).await else {
        return stale(&cache.big, &key).map(|t| (pool, t));
    };
    let list: Vec<DexTrade> = v["data"].as_array().map(|rows| rows.iter().filter_map(|r| trade_of(&r["attributes"], mint)).collect()).unwrap_or_default();
    store(&cache.big, &key, list.clone(), Duration::from_secs(120));
    Some((pool, list))
}

/// The coin's latest pool trades already loaded for its chart, without a new call.
pub fn recent_cached(cache: &DexCache, mint: &str) -> Vec<DexTrade> {
    let Some(Some(p)) = stale(&cache.pools, mint) else {
        return Vec::new();
    };
    stale(&cache.trades, &format!("{}:{mint}", p.address)).unwrap_or_default()
}

/* ---------------- Jupiter charts (first choice for candles) ---------------- */

/// Jupiter's chart data (what jup.ag draws): a coin's 1 minute candles in USD from its
/// first trade, on curves and pools alike, without a key. Measured 2026-11-22: 18 calls in
/// 11 s answered, against GeckoTerminal's free plan blocking Kixo for minutes at a time.
const JUP_CHARTS: &str = "https://datapi.jup.ag/v2/charts";
/// Its latest trades on the coin (30, newest first; it pages no further).
const JUP_TXS: &str = "https://datapi.jup.ag/v1/txs";

/// Jupiter calls pause this long after a 429, like GeckoTerminal's.
static JUP_PAUSED: Mutex<Option<Instant>> = Mutex::new(None);

async fn jup_json(http: &reqwest::Client, url: &str) -> Option<Value> {
    if JUP_PAUSED.lock().expect("jup pause lock").is_some_and(|t| Instant::now() < t) {
        return None;
    }
    let res = http.get(url).header("accept", "application/json").timeout(Duration::from_secs(8)).send().await.ok()?;
    if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        *JUP_PAUSED.lock().expect("jup pause lock") = Some(Instant::now() + Duration::from_secs(30));
        tracing::warn!("jupiter charts rate limited, pausing 30s");
        return None;
    }
    if !res.status().is_success() {
        return None;
    }
    res.json().await.ok()
}

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// The coin's last 1,000 one-minute candles from Jupiter, oldest first (cached 30 s).
async fn jup_candles(http: &reqwest::Client, cache: &DexCache, mint: &str) -> Option<Vec<DexCandle>> {
    let key = format!("jup:{mint}");
    if let Some(c) = cached(&cache.candles, &key, CANDLES_TTL) {
        return Some(c);
    }
    let url = format!("{JUP_CHARTS}/{mint}?interval=1_MINUTE&to={}&candles=1000&type=price&quote=usd", unix_now() * 1000);
    let Some(v) = jup_json(http, &url).await else {
        return stale(&cache.candles, &key);
    };
    let mut list = jup_candles_of(&v);
    list.sort_by_key(|c| c.t);
    store(&cache.candles, &key, list.clone(), CANDLES_TTL);
    Some(list)
}

fn jup_candles_of(v: &Value) -> Vec<DexCandle> {
    v["candles"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    let c = DexCandle { t: r["time"].as_i64()?, o: num(&r["open"]), h: num(&r["high"]), l: num(&r["low"]), c: num(&r["close"]), v: num(&r["volume"]) };
                    (c.o > 0.0 && c.c > 0.0).then_some(c)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The coin's latest trades from Jupiter (cached ten seconds, merged as they grow).
async fn jup_trades(http: &reqwest::Client, cache: &DexCache, mint: &str) -> Vec<DexTrade> {
    let key = format!("jup:{mint}");
    if let Some(t) = cached(&cache.trades, &key, TRADES_TTL) {
        return t;
    }
    let Some(v) = jup_json(http, &format!("{JUP_TXS}/{mint}?dir=desc")).await else {
        return stale(&cache.trades, &key).unwrap_or_default();
    };
    let list = merge_trades(jup_trades_of(&v, mint), stale(&cache.trades, &key).unwrap_or_default());
    store(&cache.trades, &key, list.clone(), TRADES_TTL);
    list
}

fn jup_trades_of(v: &Value, mint: &str) -> Vec<DexTrade> {
    v["txs"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter(|r| r["asset"].as_str() == Some(mint))
                .filter_map(|r| {
                    Some(DexTrade {
                        signature: r["txHash"].as_str()?.to_string(),
                        ts: chrono_like_parse(r["timestamp"].as_str()?)?,
                        wallet: r["traderAddress"].as_str().unwrap_or_default().to_string(),
                        is_buy: match r["type"].as_str()? {
                            "buy" => true,
                            "sell" => false,
                            _ => return None,
                        },
                        usd: num(&r["usdVolume"]),
                        tokens: num(&r["amount"]),
                        price_usd: num(&r["usdPrice"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The coin's chart history and latest trades. Candles come from Jupiter first (fast, no
/// key, from the first trade), GeckoTerminal when Jupiter has none; trades from
/// GeckoTerminal (up to 300) when it answers, Jupiter's latest 30 otherwise. None when
/// neither knows the coin.
pub async fn history(
    http: &reqwest::Client,
    cache: &Arc<DexCache>,
    mint: &str,
) -> Option<DexHistory> {
    let flight = {
        let mut f = cache.flights.lock().expect("dex flights lock");
        if f.len() > 1_000 {
            f.retain(|_, l| Arc::strong_count(l) > 1);
        }
        f.entry(mint.to_string()).or_default().clone()
    };
    let _one = flight.lock().await;
    let (pool, jup) = tokio::join!(pool(http, cache, mint), jup_candles(http, cache, mint));
    let candles = match (jup, &pool) {
        (Some(c), _) if !c.is_empty() => c,
        (_, Some(p)) => candles(http, cache, &p.address, mint).await,
        _ => Vec::new(),
    };
    let mut trades = match &pool {
        Some(p) => trades(http, cache, &p.address, mint).await,
        None => Vec::new(),
    };
    if trades.is_empty() {
        trades = jup_trades(http, cache, mint).await;
    }
    if pool.is_none() && candles.is_empty() && trades.is_empty() {
        return None;
    }
    let pool = pool.unwrap_or_else(|| Pool { address: String::new(), name: "Jupiter".into(), dex: None, quote: None });
    Some(DexHistory {
        pool,
        candle_secs: 60,
        candles,
        trades,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_jupiter_candles_and_trades() {
        let v = json!({ "candles": [
            { "time": 1795231980, "open": 0.0013, "high": 0.0014, "low": 0.0012, "close": 0.00132, "volume": 47.4 },
            { "time": 1795231920, "open": 0.0, "high": 0.0, "low": 0.0, "close": 0.0, "volume": 0.0 }
        ]});
        let c = jup_candles_of(&v);
        assert_eq!(c.len(), 1, "an empty candle is dropped");
        assert_eq!(c[0].t, 1795231980);
        assert!((c[0].c - 0.00132).abs() < 1e-12 && (c[0].v - 47.4).abs() < 1e-9);

        let v = json!({ "txs": [
            { "asset": "M", "type": "buy", "usdVolume": 14.4, "traderAddress": "W1", "txHash": "S1", "timestamp": "2026-11-21T20:32:13.000Z", "usdPrice": 0.0017, "amount": 8470.0 },
            { "asset": "M", "type": "sell", "usdVolume": 2.0, "traderAddress": "W2", "txHash": "S2", "timestamp": "2026-11-21T20:32:10.000Z", "usdPrice": 0.0017, "amount": 1176.0 },
            { "asset": "M", "type": "add", "usdVolume": 9.0, "traderAddress": "W3", "txHash": "S3", "timestamp": "2026-11-21T20:32:09.000Z" },
            { "asset": "OTHER", "type": "buy", "usdVolume": 1.0, "traderAddress": "W4", "txHash": "S4", "timestamp": "2026-11-21T20:32:08.000Z" }
        ]});
        let t = jup_trades_of(&v, "M");
        assert_eq!(t.len(), 2, "only this coin's buys and sells");
        assert!(t[0].is_buy && !t[1].is_buy);
        assert_eq!(t[0].ts, chrono_like_parse("2026-11-21T20:32:13Z").unwrap());
        assert_eq!(t[1].wallet, "W2");
    }

    fn t(sig: &str, ts: i64) -> DexTrade {
        DexTrade {
            signature: sig.into(),
            ts,
            wallet: "W".into(),
            is_buy: true,
            usd: 1.0,
            tokens: 1.0,
            price_usd: 1.0,
        }
    }

    #[test]
    fn merged_trades_grow_without_duplicates() {
        let merged = merge_trades(vec![t("c", 30), t("b", 20)], vec![t("b", 20), t("a", 10)]);
        let sigs: Vec<&str> = merged.iter().map(|x| x.signature.as_str()).collect();
        assert_eq!(sigs, ["c", "b", "a"]);
    }

    #[test]
    fn parses_utc_timestamps() {
        assert_eq!(chrono_like_parse("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            chrono_like_parse("2026-11-05T21:10:04Z"),
            Some(1_793_913_004)
        );
        assert_eq!(chrono_like_parse("bad"), None);
    }

    #[test]
    fn trade_side_follows_the_token() {
        let sell = json!({
            "tx_hash": "sig", "tx_from_address": "W", "block_timestamp": "2026-11-05T21:10:04Z",
            "from_token_address": "MINT", "to_token_address": "USDC",
            "from_token_amount": "1000", "to_token_amount": "1236",
            "price_from_in_usd": "1.21", "price_to_in_usd": "1.0", "volume_in_usd": "1236"
        });
        let t = trade_of(&sell, "MINT").unwrap();
        assert!(!t.is_buy);
        assert_eq!(t.tokens, 1000.0);
        assert_eq!(t.price_usd, 1.21);
        let t = trade_of(&sell, "USDC").unwrap();
        assert!(t.is_buy, "the same swap is a buy of the output token");
        assert!(trade_of(&sell, "OTHER").is_none());
    }
}
