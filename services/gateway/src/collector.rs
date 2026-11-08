//! The data collector for Kixo's AI: every coin launch and every trade the engine sees,
//! saved to disk as gzip CSV, one folder per UTC day. Off unless COLLECT_DIR is set
//! (e.g. `E:\KixoData`).
//!
//! - `live/<day>/coins.csv.gz` and `live/<day>/trades.csv.gz`: what the engine sees now.
//! - `history/<day>/...`: pump.fun's past, read backwards from the chain while
//!   HISTORY_BACKFILL=1, at HISTORY_TPS transactions a second (default 4). Where it got
//!   to is kept in `history/cursor.txt`, so it continues after a restart.
//! - `status.json`: counts, updated every 30 seconds.
//!
//! Each run of the gateway writes its own files (`trades-<run>.csv.gz`), flushed every 5
//! seconds: a power cut leaves that run's file without its gzip ending, which readers
//! still read up to the last flush, and never touches another run's data. Read a day by
//! reading every file in its folder.

use flate2::{write::GzEncoder, Compression};
use monexa_ingest::pumpfun::{self, NewToken};
use serde_json::json;
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;

const TRADES_HEADER: &str = "ts,slot,signature,mint,side,sol_lamports,token_amount,wallet,v_sol,v_tokens,real_tokens\n";
const COINS_HEADER: &str = "ts,signature,mint,symbol,name,creator,launchpad,quote_mint,bonding_curve,uri\n";

enum Rec {
    Coin { part: &'static str, line: String, ts: i64 },
    Trade { part: &'static str, line: String, ts: i64 },
    /// One JSON line of another data set: snapshots, outcomes, smart_money, news.
    Json { kind: &'static str, line: String, ts: i64 },
}

static TX: OnceLock<mpsc::Sender<Rec>> = OnceLock::new();
static COUNTS: OnceLock<Counts> = OnceLock::new();

#[derive(Default)]
struct Counts {
    live_trades: AtomicU64,
    live_coins: AtomicU64,
    history_trades: AtomicU64,
    history_coins: AtomicU64,
    history_oldest: AtomicU64,
    snapshots: AtomicU64,
    outcomes: AtomicU64,
    other: AtomicU64,
    dropped: AtomicU64,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// "2026-11-09" for a unix time (UTC).
pub fn day(ts: i64) -> String {
    let days = ts.div_euclid(86_400);
    // Civil from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

/// A CSV field: quoted when it holds a comma, quote or line break.
fn field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\"").replace(['\n', '\r'], " "))
    } else {
        s.to_string()
    }
}

fn coin_line(t: &NewToken) -> String {
    format!(
        "{},{},{},{},{},{},{},{},{},{}\n",
        t.timestamp,
        t.signature,
        t.mint,
        field(&t.symbol),
        field(&t.name),
        t.creator,
        field(&t.launchpad),
        t.quote_mint.as_deref().unwrap_or(""),
        t.bonding_curve,
        field(&t.uri)
    )
}

fn trade_line(signature: &str, t: &pumpfun::Trade, slot: Option<u64>) -> String {
    format!(
        "{},{},{},{},{},{},{},{},{},{},{}\n",
        t.timestamp,
        slot.map(|s| s.to_string()).unwrap_or_default(),
        signature,
        t.mint,
        if t.is_buy { "buy" } else { "sell" },
        t.sol_amount,
        t.token_amount,
        t.user,
        t.virtual_sol_reserves,
        t.virtual_token_reserves,
        t.real_token_reserves
    )
}

fn send(r: Rec) {
    if let Some(tx) = TX.get() {
        if tx.try_send(r).is_err() {
            if let Some(c) = COUNTS.get() {
                c.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

/// A coin launch the engine saw live.
pub fn coin(t: &NewToken) {
    if TX.get().is_some() {
        send(Rec::Coin { part: "live", line: coin_line(t), ts: t.timestamp });
    }
}

/// A trade the engine saw live.
pub fn trade(signature: &str, t: &pumpfun::Trade, slot: Option<u64>) {
    if TX.get().is_some() {
        send(Rec::Trade { part: "live", line: trade_line(signature, t, slot), ts: t.timestamp });
    }
}

/// One open gzip file.
struct Out {
    enc: GzEncoder<fs::File>,
}

fn open(path: &Path, header: &str) -> std::io::Result<Out> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let fresh = !path.exists();
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let mut enc = GzEncoder::new(file, Compression::default());
    if fresh && !header.is_empty() {
        enc.write_all(header.as_bytes())?;
    }
    Ok(Out { enc })
}

/// Starts the collector when COLLECT_DIR is set. Returns the folder, or None when off.
pub fn start(state: Arc<crate::AppState>) -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var("COLLECT_DIR").ok().filter(|d| !d.trim().is_empty())?.trim());
    if let Err(e) = fs::create_dir_all(&dir) {
        tracing::error!(error = %e, dir = %dir.display(), "data collector: cannot create the folder");
        return None;
    }
    let (tx, mut rx) = mpsc::channel::<Rec>(200_000);
    let _ = TX.set(tx);
    let _ = COUNTS.set(Counts::default());
    let base = dir.clone();
    // This run's files: one set per start, named by the start time (UTC).
    let run = {
        let t = now();
        format!("{}T{:02}{:02}{:02}", day(t), (t % 86_400) / 3600, (t % 3600) / 60, t % 60)
    };
    tokio::spawn(async move {
        let mut files: HashMap<(String, &'static str, &'static str), Out> = HashMap::new();
        let mut tick = tokio::time::interval(Duration::from_secs(5));
        let mut status = tokio::time::interval(Duration::from_secs(30));
        loop {
            tokio::select! {
                r = rx.recv() => {
                    let Some(r) = r else { break };
                    let (part, kind, line, ts) = match r {
                        Rec::Coin { part, line, ts } => (part, "coins", line, ts),
                        Rec::Trade { part, line, ts } => (part, "trades", line, ts),
                        Rec::Json { kind, line, ts } => ("live", kind, line, ts),
                    };
                    let csv = kind == "coins" || kind == "trades";
                    let key = (day(if ts > 0 { ts } else { now() }), part, kind);
                    if !files.contains_key(&key) {
                        // Keep only today's and yesterday's live files open; history can span many days.
                        if files.len() > 16 {
                            for (_, mut o) in files.drain() {
                                let _ = o.enc.flush();
                                let _ = o.enc.try_finish();
                            }
                        }
                        let path = base.join(part).join(&key.0).join(format!("{kind}-{run}.{}.gz", if csv { "csv" } else { "jsonl" }));
                        match open(&path, if kind == "coins" { COINS_HEADER } else if kind == "trades" { TRADES_HEADER } else { "" }) {
                            Ok(o) => {
                                files.insert(key.clone(), o);
                            }
                            Err(e) => {
                                tracing::error!(error = %e, path = %path.display(), "data collector: cannot open file");
                                continue;
                            }
                        }
                    }
                    if let Some(o) = files.get_mut(&key) {
                        if o.enc.write_all(line.as_bytes()).is_ok() {
                            let c = COUNTS.get().expect("counts");
                            match (part, kind) {
                                ("live", "trades") => c.live_trades.fetch_add(1, Ordering::Relaxed),
                                ("live", "coins") => c.live_coins.fetch_add(1, Ordering::Relaxed),
                                (_, "trades") => c.history_trades.fetch_add(1, Ordering::Relaxed),
                                (_, "coins") => c.history_coins.fetch_add(1, Ordering::Relaxed),
                                (_, "snapshots") => c.snapshots.fetch_add(1, Ordering::Relaxed),
                                (_, "outcomes") => c.outcomes.fetch_add(1, Ordering::Relaxed),
                                _ => c.other.fetch_add(1, Ordering::Relaxed),
                            };
                        }
                    }
                }
                _ = tick.tick() => {
                    for o in files.values_mut() {
                        let _ = o.enc.flush();
                    }
                }
                _ = status.tick() => write_status(&base),
            }
        }
    });
    tokio::spawn(snapshot_loop(state.clone()));
    if std::env::var("HISTORY_BACKFILL").is_ok_and(|v| v.trim() == "1") {
        tokio::spawn(history(state, dir.clone()));
    }
    tracing::info!(dir = %dir.display(), "data collector on");
    Some(dir)
}

fn dir_size(p: &Path) -> u64 {
    fs::read_dir(p)
        .map(|rd| rd.flatten().map(|e| e.metadata().map(|m| if m.is_dir() { dir_size(&e.path()) } else { m.len() }).unwrap_or(0)).sum())
        .unwrap_or(0)
}

fn write_status(base: &Path) {
    let Some(c) = COUNTS.get() else { return };
    let oldest = c.history_oldest.load(Ordering::Relaxed) as i64;
    let v = json!({
        "updated": now(),
        "since_start": {
            "live_trades": c.live_trades.load(Ordering::Relaxed),
            "live_coins": c.live_coins.load(Ordering::Relaxed),
            "history_trades": c.history_trades.load(Ordering::Relaxed),
            "history_coins": c.history_coins.load(Ordering::Relaxed),
            "snapshots": c.snapshots.load(Ordering::Relaxed),
            "outcomes": c.outcomes.load(Ordering::Relaxed),
            "smart_and_news": c.other.load(Ordering::Relaxed),
            "dropped": c.dropped.load(Ordering::Relaxed),
        },
        "history_reached": if oldest > 0 { json!(day(oldest)) } else { json!(null) },
        "disk_mb": dir_size(base) / 1_048_576,
    });
    let _ = fs::write(base.join("status.json"), serde_json::to_vec_pretty(&v).unwrap_or_default());
}

/// pump.fun's past, newest to oldest, at a steady pace that leaves the RPC free for the
/// live app. Each successful transaction's logs are decoded with the engine's own parser.
async fn history(state: Arc<crate::AppState>, dir: PathBuf) {
    let tps: f64 = std::env::var("HISTORY_TPS").ok().and_then(|v| v.trim().parse().ok()).filter(|v: &f64| *v > 0.0 && *v <= 50.0).unwrap_or(4.0);
    let cursor_file = dir.join("history").join("cursor.txt");
    let _ = fs::create_dir_all(dir.join("history"));
    let mut before: Option<String> = fs::read_to_string(&cursor_file).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    // History reads go to the data-collection nodes (FALLBACK_RPC_URLS: Alchemy, QuickNode,
    // ...), taking turns, so the live app keeps Helius. The public node and then the
    // app's own router are the last resort.
    let mut urls: Vec<String> = monexa_common::fallback_rpc_urls().into_iter().filter(|u| u != monexa_common::PUBLIC_RPC).collect();
    urls.push(monexa_common::PUBLIC_RPC.to_string());
    urls.push(state.config.helius_rpc_url());
    let nodes = urls.len();
    let mut turn = 0usize;
    tracing::info!(tps, nodes, resume = before.is_some(), "history backfill on");
    // Let the live app start first.
    tokio::time::sleep(Duration::from_secs(30)).await;
    loop {
        let url = urls[turn % nodes].clone();
        let Some(page) = crate::rpc::signatures_page(&state.http, &url, pumpfun::PROGRAM_ID, before.as_deref(), 200).await else {
            // This node failed or is out of quota: the next one.
            turn += 1;
            tokio::time::sleep(Duration::from_secs(if turn % nodes == 0 { 30 } else { 2 })).await;
            continue;
        };
        let Some(last) = page.last().map(|p| p.0.clone()) else {
            tracing::info!("history backfill: reached the start of pump.fun");
            return;
        };
        let ok: Vec<&(String, i64, u64, bool)> = page.iter().filter(|p| p.3).collect();
        for chunk in ok.chunks(10) {
            let started = std::time::Instant::now();
            let sigs: Vec<String> = chunk.iter().map(|p| p.0.clone()).collect();
            turn += 1;
            let mut txs = crate::rpc::transactions(&state.http, &urls[turn % nodes], &sigs).await;
            // A node that answered nothing gets one retry on the next node.
            if txs.iter().all(Option::is_none) {
                turn += 1;
                txs = crate::rpc::transactions(&state.http, &urls[turn % nodes], &sigs).await;
            }
            for ((sig, ts, slot, _), tx) in chunk.iter().map(|p| (&p.0, p.1, p.2, p.3)).zip(txs) {
                let Some(tx) = tx else { continue };
                let logs: Vec<String> = tx["meta"]["logMessages"].as_array().map(|a| a.iter().filter_map(|l| l.as_str().map(String::from)).collect()).unwrap_or_default();
                for ev in pumpfun::parse_events(sig, &logs) {
                    match ev {
                        pumpfun::Event::Create(mut t) => {
                            if t.timestamp == 0 {
                                t.timestamp = ts;
                            }
                            send(Rec::Coin { part: "history", line: coin_line(&t), ts: t.timestamp });
                        }
                        pumpfun::Event::Trade(mut t) => {
                            if t.timestamp == 0 {
                                t.timestamp = ts;
                            }
                            send(Rec::Trade { part: "history", line: trade_line(sig, &t, Some(slot)), ts: t.timestamp });
                        }
                        pumpfun::Event::Complete { .. } => {}
                    }
                }
                if ts > 0 {
                    if let Some(c) = COUNTS.get() {
                        let cur = c.history_oldest.load(Ordering::Relaxed);
                        if cur == 0 || (ts as u64) < cur {
                            c.history_oldest.store(ts as u64, Ordering::Relaxed);
                        }
                    }
                }
            }
            // Pace: `tps` transactions a second.
            let want = Duration::from_secs_f64(chunk.len() as f64 / tps);
            if let Some(rest) = want.checked_sub(started.elapsed()) {
                tokio::time::sleep(rest).await;
            }
        }
        before = Some(last.clone());
        let _ = fs::write(&cursor_file, &last);
    }
}

fn json(kind: &'static str, v: &serde_json::Value) {
    if TX.get().is_some() {
        send(Rec::Json { kind, line: format!("{v}
"), ts: now() });
    }
}

/// Only the parts of a JSON object that change from minute to minute: numbers and
/// booleans (prices, market cap, holders, buys and sells, curve progress), plus the mint.
/// Names, images, links and descriptions are saved once per coin instead.
fn changing(v: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    if let Some(o) = v.as_object() {
        for (k, x) in o {
            match x {
                serde_json::Value::Number(_) | serde_json::Value::Bool(_) => {
                    out.insert(k.clone(), x.clone());
                }
                serde_json::Value::String(_) if k == "mint" => {
                    out.insert(k.clone(), x.clone());
                }
                _ => {}
            }
        }
    }
    serde_json::Value::Object(out)
}

/// Every minute: the changing figures of every live coin (launches with their curve and
/// holder stats; Discover markets) and the SOL price. Once per coin: its card (socials,
/// description, dev report) when first known. Every hour: the smart-money list, and the
/// news stories not saved before. All already in memory: no extra RPC.
async fn snapshot_loop(state: Arc<crate::AppState>) {
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    let mut n: u64 = 0;
    let mut carded: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut seen_news: std::collections::HashSet<String> = std::collections::HashSet::new();
    loop {
        tick.tick().await;
        let t = now();
        let (sol_usd, launches, markets, smart, cards) = {
            let b = state.board.lock().expect("board lock");
            let mut cards = Vec::new();
            let launches: Vec<serde_json::Value> = b
                .tokens
                .values()
                .map(|ft| {
                    let mut row = ft.market.as_ref().map(|m| changing(&json!(m))).unwrap_or_else(|| json!({}));
                    row["mint"] = json!(ft.token.mint);
                    // The card once, when its metadata has loaded.
                    if ft.meta.is_some() && !carded.contains(&ft.token.mint) {
                        carded.insert(ft.token.mint.clone());
                        cards.push(json!({ "t": t, "mint": ft.token.mint, "meta": ft.meta, "dev_report": ft.dev_report }));
                    }
                    row
                })
                .collect();
            let markets: Vec<serde_json::Value> = b.markets.all().iter().map(|m| changing(&json!(m))).collect();
            (b.sol_usd, launches, markets, b.smart.clone(), cards)
        };
        if carded.len() > 200_000 {
            carded.clear();
        }
        for c in &cards {
            json("coin_cards", c);
        }
        // Right after a start the board is still loading: nothing worth saving yet.
        if !launches.is_empty() || !markets.is_empty() {
            json("snapshots", &json!({ "t": t, "sol_usd": sol_usd, "launches": launches, "markets": markets, "smart_holders": smart }));
        }
        // Hourly, from the third minute (once the smart-money list is computed).
        if n % 60 == 2 {
            let leaders = state.leaders.lock().expect("leaders lock").clone();
            if !leaders.is_empty() {
                json("smart_money", &json!({ "t": t, "leaders": leaders }));
            }
            let stories: Vec<serde_json::Value> = fs::read_to_string("data/news.json")
                .ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                .map(|v| v.as_array().cloned().or_else(|| v["stories"].as_array().cloned()).unwrap_or_default())
                .unwrap_or_default();
            for s in stories {
                let id = s["id"].as_str().or(s["url"].as_str()).or(s["title"].as_str()).unwrap_or("").to_string();
                if !id.is_empty() && seen_news.insert(id) {
                    json("news", &s);
                }
            }
            if seen_news.len() > 100_000 {
                seen_news.clear();
            }
        }
        n += 1;
    }
}

/// A coin leaving the live board: how its life went, from our own trade book (peak and
/// last market cap, trades, buyers), with its final card and wallet labels. These are
/// the answers the AI learns from.
pub fn outcome(state: &crate::AppState, mints: &[String]) {
    if TX.get().is_none() {
        return;
    }
    for mint in mints {
        let token = state.board.lock().expect("board lock").tokens.get(mint).cloned();
        let (book, labels) = {
            let books = state.books.lock().expect("books lock");
            (books.snapshot(mint), books.labels(mint))
        };
        let Some(book) = book else { continue };
        let peak = book.candles.iter().map(|c| c.h).fold(0.0_f64, f64::max);
        let first = book.candles.first().map(|c| (c.t, c.o));
        let last = book.candles.last().map(|c| (c.t, c.c));
        let peak_at = book.candles.iter().max_by(|a, b| a.h.total_cmp(&b.h)).map(|c| c.t);
        let mut label_counts: HashMap<&str, usize> = HashMap::new();
        for ls in labels.iter().flat_map(|m| m.values()) {
            for l in ls {
                *label_counts.entry(l).or_default() += 1;
            }
        }
        json(
            "outcomes",
            &json!({
                "t": now(),
                "mint": mint,
                "source": book.source,
                "supply": book.supply,
                "first": first.map(|(t, mc)| json!({ "t": t, "mc_sol": mc })),
                "peak": json!({ "t": peak_at, "mc_sol": peak }),
                "last": last.map(|(t, mc)| json!({ "t": t, "mc_sol": mc })),
                "recent_trades": book.trades.len(),
                "whale_trades": book.whales.len(),
                "labels": label_counts,
                "token": token,
            }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_keep_only_changing_figures() {
        let v = json!({ "mint": "M", "name": "Coin", "image": "https://x", "mc_usd": 5000.5, "holders": 12, "complete": false, "socials": { "x": "y" } });
        assert_eq!(changing(&v), json!({ "mint": "M", "mc_usd": 5000.5, "holders": 12, "complete": false }));
    }

    #[test]
    fn days_and_csv_fields() {
        assert_eq!(day(0), "1970-01-01");
        assert_eq!(day(1_794_182_400), "2026-11-09");
        assert_eq!(day(951_782_400), "2000-02-29");
        assert_eq!(field("plain"), "plain");
        assert_eq!(field("a,b"), "\"a,b\"");
        assert_eq!(field("say \"hi\""), "\"say \"\"hi\"\"\"");
    }

    #[test]
    fn gzip_members_append_and_read_back() {
        use flate2::read::MultiGzDecoder;
        use std::io::Read;
        let p = std::env::temp_dir().join(format!("kixo-collect-test-{}.csv.gz", now()));
        let _ = fs::remove_file(&p);
        for line in ["1,a\n", "2,b\n"] {
            let mut o = open(&p, "ts,x\n").expect("open");
            o.enc.write_all(line.as_bytes()).expect("write");
            o.enc.try_finish().expect("finish");
        }
        let mut s = String::new();
        MultiGzDecoder::new(fs::File::open(&p).expect("read")).read_to_string(&mut s).expect("decode");
        assert_eq!(s, "ts,x\n1,a\n2,b\n");
        let _ = fs::remove_file(&p);
    }
}
