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
//! Files are flushed every 5 seconds and each run adds a new gzip member, so a power cut
//! loses at most those seconds and never breaks a file (gzip readers read all members).

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
    if fresh {
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
                    };
                    let key = (day(if ts > 0 { ts } else { now() }), part, kind);
                    if !files.contains_key(&key) {
                        // Keep only today's and yesterday's live files open; history can span many days.
                        if files.len() > 16 {
                            for (_, mut o) in files.drain() {
                                let _ = o.enc.flush();
                                let _ = o.enc.try_finish();
                            }
                        }
                        let path = base.join(part).join(&key.0).join(format!("{kind}.csv.gz"));
                        match open(&path, if kind == "coins" { COINS_HEADER } else { TRADES_HEADER }) {
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
                                ("live", _) => c.live_coins.fetch_add(1, Ordering::Relaxed),
                                (_, "trades") => c.history_trades.fetch_add(1, Ordering::Relaxed),
                                _ => c.history_coins.fetch_add(1, Ordering::Relaxed),
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
    let url = state.config.helius_rpc_url();
    tracing::info!(tps, resume = before.is_some(), "history backfill on");
    // Let the live app start first.
    tokio::time::sleep(Duration::from_secs(30)).await;
    loop {
        let Some(page) = crate::rpc::signatures_page(&state.http, &url, pumpfun::PROGRAM_ID, before.as_deref(), 200).await else {
            tokio::time::sleep(Duration::from_secs(20)).await;
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
            let txs = crate::rpc::transactions(&state.http, &url, &sigs).await;
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

#[cfg(test)]
mod tests {
    use super::*;

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
