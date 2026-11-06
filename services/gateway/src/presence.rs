//! Who is on MONEXA right now, counted without accounts or cookies.
//!
//! - Live users: open live-feed connections (every MONEXA page holds one).
//! - Trade pages open: open per-coin connections.
//! - Visitors today: distinct visitors since midnight UTC, kept as salted hashes of the
//!   address (never the address itself); the salt changes daily so days cannot be
//!   linked. Daily totals for the last 400 days are saved to data/presence.json.

use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashSet},
    hash::{Hash, Hasher},
    net::IpAddr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const FILE: &str = "data/presence.json";
const KEEP_DAYS: usize = 400;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static NEXT_ID: AtomicUsize = AtomicUsize::new(1);
/// Open sessions: id -> (opened at, current page). No address, no identity.
static SESSIONS: Mutex<Option<std::collections::HashMap<usize, (i64, &'static str)>>> = Mutex::new(None);
/// Live users sampled once a minute for the last 24 hours: (unix secs, live).
static SAMPLES: Mutex<std::collections::VecDeque<(i64, usize)>> = Mutex::new(std::collections::VecDeque::new());
const SAMPLE_SECS: i64 = 60;
const SAMPLE_KEEP: usize = 24 * 60;

/// Pages a session can report; anything else counts as "other".
const PAGES: [&str; 10] = ["discover", "radar", "token", "sniper", "smart-money", "wallets", "rewards", "ai", "home", "other"];

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

fn sample() {
    let now = now_secs();
    let mut s = SAMPLES.lock().expect("presence samples");
    if s.back().is_none_or(|(t, _)| now - t >= SAMPLE_SECS) {
        s.push_back((now, LIVE.load(Ordering::Relaxed)));
        if s.len() > SAMPLE_KEEP {
            s.pop_front();
        }
    }
}

/// The page a live session is on, from the first path segment it reports.
pub fn set_page(id: usize, path: &str) {
    let seg = path.trim_start_matches('/').split(['/', '?', '#']).next().unwrap_or("");
    let page = if seg.is_empty() { "home" } else { PAGES.iter().find(|p| **p == seg).copied().unwrap_or("other") };
    if let Some(m) = SESSIONS.lock().expect("presence sessions").as_mut() {
        if let Some(s) = m.get_mut(&id) {
            s.1 = page;
        }
    }
}
static TRADE_PAGES: AtomicUsize = AtomicUsize::new(0);
static TODAY: Mutex<Option<Today>> = Mutex::new(None);

struct Today {
    day: i64,
    salt: u64,
    seen: HashSet<u64>,
    peak: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Day {
    /// Days since 1970-01-01 (UTC).
    pub day: i64,
    pub visitors: usize,
    pub peak_live: usize,
}

static HISTORY: Mutex<Option<Vec<Day>>> = Mutex::new(None);

fn day_now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64) / 86_400
}

fn history<R>(f: impl FnOnce(&mut Vec<Day>) -> R) -> R {
    let mut h = HISTORY.lock().expect("presence history");
    let list = h.get_or_insert_with(|| std::fs::read(FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    f(list)
}

fn save(list: &[Day]) {
    if let Ok(json) = serde_json::to_vec(list) {
        let tmp = format!("{FILE}.tmp");
        let _ = std::fs::create_dir_all("data").and_then(|_| std::fs::write(&tmp, json)).and_then(|_| std::fs::rename(&tmp, FILE));
    }
}

/// Close yesterday into the history when the day changes, and record a visitor.
fn touch(ip: Option<IpAddr>) {
    let day = day_now();
    let mut t = TODAY.lock().expect("presence today");
    if t.as_ref().is_none_or(|t| t.day != day) {
        if let Some(old) = t.take() {
            history(|h| {
                h.retain(|d| d.day != old.day);
                h.push(Day { day: old.day, visitors: old.seen.len(), peak_live: old.peak });
                if h.len() > KEEP_DAYS {
                    h.remove(0);
                }
                save(h);
            });
        }
        let salt = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
        *t = Some(Today { day, salt, seen: HashSet::new(), peak: 0 });
    }
    let t = t.as_mut().expect("today set");
    if let Some(ip) = ip {
        let mut h = DefaultHasher::new();
        t.salt.hash(&mut h);
        ip.hash(&mut h);
        t.seen.insert(h.finish());
    }
    t.peak = t.peak.max(LIVE.load(Ordering::Relaxed));
}

/// Held for as long as a live-feed connection is open.
pub struct LiveGuard(pub usize);
impl LiveGuard {
    pub fn new(ip: Option<IpAddr>) -> Self {
        LIVE.fetch_add(1, Ordering::Relaxed);
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        SESSIONS.lock().expect("presence sessions").get_or_insert_with(Default::default).insert(id, (now_secs(), "other"));
        touch(ip);
        sample();
        LiveGuard(id)
    }
}
impl Drop for LiveGuard {
    fn drop(&mut self) {
        LIVE.fetch_sub(1, Ordering::Relaxed);
        if let Some(m) = SESSIONS.lock().expect("presence sessions").as_mut() {
            m.remove(&self.0);
        }
        sample();
    }
}

/// Held for as long as a trade page is open.
pub struct TradeGuard;
impl TradeGuard {
    pub fn new() -> Self {
        TRADE_PAGES.fetch_add(1, Ordering::Relaxed);
        TradeGuard
    }
}
impl Drop for TradeGuard {
    fn drop(&mut self) {
        TRADE_PAGES.fetch_sub(1, Ordering::Relaxed);
    }
}

#[derive(Serialize)]
pub struct Session {
    pub page: &'static str,
    pub secs: i64,
}

#[derive(Serialize)]
pub struct Snapshot {
    /// Live sessions, longest first: which page and for how long. Anonymous.
    pub sessions: Vec<Session>,
    /// Live users once a minute, last 24 hours: [unix secs, live].
    pub live_24h: Vec<(i64, usize)>,
    pub live_users: usize,
    pub trade_pages_open: usize,
    pub visitors_today: usize,
    pub peak_live_today: usize,
    /// Earlier days, oldest first, plus today so far as the last entry.
    pub days: Vec<Day>,
}

pub fn snapshot() -> Snapshot {
    touch(None);
    sample();
    let now = now_secs();
    let mut sessions: Vec<Session> = SESSIONS
        .lock()
        .expect("presence sessions")
        .as_ref()
        .map(|m| m.values().map(|(t, p)| Session { page: p, secs: now - t }).collect())
        .unwrap_or_default();
    sessions.sort_by(|a, b| b.secs.cmp(&a.secs));
    let live_24h: Vec<(i64, usize)> = SAMPLES.lock().expect("presence samples").iter().copied().collect();
    let (today, visitors, peak) = {
        let t = TODAY.lock().expect("presence today");
        let t = t.as_ref().expect("today set");
        (t.day, t.seen.len(), t.peak)
    };
    let mut days = history(|h| h.clone());
    days.push(Day { day: today, visitors, peak_live: peak });
    Snapshot { sessions, live_24h, live_users: LIVE.load(Ordering::Relaxed), trade_pages_open: TRADE_PAGES.load(Ordering::Relaxed), visitors_today: visitors, peak_live_today: peak, days }
}
