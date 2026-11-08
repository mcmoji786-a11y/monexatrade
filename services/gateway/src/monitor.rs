//! Watching Kixo after launch: errors and uptime, for the admin's System page.
//!
//! - Every warning and error the gateway logs is grouped (same level, module and message
//!   shape) with a count and first/last time, so a flood of the same warning is one row.
//! - Browsers report their own uncaught errors to `POST /ops/client-error` (rate limited,
//!   truncated, no personal data asked for), grouped the same way.
//! - Once a minute the gateway checks its parts (database, Solana RPC, live stream) and
//!   keeps 24 hours of results: uptime per part and the moments one went down or came back.
//!
//! All of it lives in memory and starts empty when the gateway restarts; the page shows
//! since when. An outside uptime check on `/health` is still the way to notice a crash.

use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tracing::{field::Visit, Event, Level, Subscriber};
use tracing_subscriber::{layer::Context, Layer};

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/* ---------------- Grouped errors ---------------- */

/// Distinct error groups kept; the oldest is dropped beyond this.
const MAX_GROUPS: usize = 300;
const MAX_TEXT: usize = 400;

#[derive(Clone, Serialize)]
pub struct Group {
    pub source: &'static str,
    pub level: &'static str,
    pub target: String,
    pub message: String,
    pub count: u64,
    pub first: i64,
    pub last: i64,
}

#[derive(Default)]
struct Store {
    groups: HashMap<String, Group>,
}

fn store() -> &'static Mutex<Store> {
    static S: OnceLock<Mutex<Store>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Store::default()))
}

/// Numbers, addresses and ids vary between otherwise identical messages: the group key
/// turns each run of digits into "#" and long base58/hex words into "<id>".
pub fn shape(msg: &str) -> String {
    msg.split_whitespace()
        .map(|w| {
            if w.len() >= 24 && w.chars().all(|c| c.is_ascii_alphanumeric()) {
                return "<id>".to_string();
            }
            // Each run of digits becomes one "#": "status=429" and "status=503" match.
            let mut out = String::with_capacity(w.len());
            let mut in_num = false;
            for c in w.chars() {
                if c.is_ascii_digit() {
                    if !in_num {
                        out.push('#');
                    }
                    in_num = true;
                } else {
                    out.push(c);
                    in_num = false;
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate(s: &str) -> String {
    if s.len() <= MAX_TEXT {
        return s.to_string();
    }
    let mut end = MAX_TEXT;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

pub fn record(source: &'static str, level: &'static str, target: &str, message: &str) {
    let message = truncate(message.trim());
    let key = format!("{source}|{level}|{target}|{}", shape(&message));
    let t = now();
    let mut s = store().lock().expect("monitor lock");
    if let Some(g) = s.groups.get_mut(&key) {
        g.count += 1;
        g.last = t;
        g.message = message;
        return;
    }
    if s.groups.len() >= MAX_GROUPS {
        if let Some(old) = s.groups.iter().min_by_key(|(_, g)| g.last).map(|(k, _)| k.clone()) {
            s.groups.remove(&old);
        }
    }
    s.groups.insert(key, Group { source, level, target: truncate(target), message, count: 1, first: t, last: t });
}

fn groups() -> Vec<Group> {
    let mut v: Vec<Group> = store().lock().expect("monitor lock").groups.values().cloned().collect();
    v.sort_by(|a, b| b.last.cmp(&a.last));
    v
}

/// A tracing layer that records every WARN and ERROR the gateway logs.
pub struct ErrorLayer;

struct MessageVisitor(String);

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.0.insert_str(0, &format!("{value:?} "));
        } else {
            self.0.push_str(&format!("{}={value:?} ", field.name()));
        }
    }
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.0.insert_str(0, &format!("{value} "));
        } else {
            self.0.push_str(&format!("{}={value} ", field.name()));
        }
    }
}

impl<S: Subscriber> Layer<S> for ErrorLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let level = match *event.metadata().level() {
            Level::ERROR => "error",
            Level::WARN => "warn",
            _ => return,
        };
        let mut v = MessageVisitor(String::new());
        event.record(&mut v);
        record("gateway", level, event.metadata().target(), &v.0);
    }
}

/// The gateway's logging: the usual console output plus the error recorder.
pub fn init_tracing() {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info".into());
    tracing_subscriber::registry().with(filter).with(tracing_subscriber::fmt::layer()).with(ErrorLayer).init();
}

/* ---------------- Browser errors ---------------- */

#[derive(Deserialize)]
pub struct ClientError {
    message: String,
    #[serde(default)]
    page: String,
    #[serde(default)]
    kind: String,
}

/// Reports per address per minute, and in total per minute.
const CLIENT_PER_IP: usize = 10;
const CLIENT_TOTAL: usize = 300;

fn client_allowed(ip: &str) -> bool {
    static RECENT: Mutex<Vec<(Instant, String)>> = Mutex::new(Vec::new());
    let mut r = RECENT.lock().expect("client lock");
    r.retain(|(t, _)| t.elapsed() < Duration::from_secs(60));
    if r.len() >= CLIENT_TOTAL || r.iter().filter(|(_, i)| i == ip).count() >= CLIENT_PER_IP {
        return false;
    }
    r.push((Instant::now(), ip.to_string()));
    true
}

/// `POST /ops/client-error`: an uncaught error in someone's browser.
pub async fn client_error(ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(e): Json<ClientError>) -> StatusCode {
    if e.message.trim().is_empty() || !client_allowed(&addr.ip().to_string()) {
        return StatusCode::NO_CONTENT;
    }
    // The page path only, never its query (it could carry a code or an address).
    let page: String = e.page.split(['?', '#']).next().unwrap_or("").chars().take(80).collect();
    let kind = if e.kind == "promise" { "unhandled promise" } else { "error" };
    record("browser", "error", &format!("{kind} on {}", if page.is_empty() { "/" } else { &page }), &e.message);
    StatusCode::NO_CONTENT
}

/* ---------------- Uptime ---------------- */

const SAMPLE_EVERY: Duration = Duration::from_secs(60);
const KEEP_SAMPLES: usize = 24 * 60;

#[derive(Clone, Copy, Serialize)]
pub struct Sample {
    pub t: i64,
    pub database: bool,
    pub rpc: bool,
    pub stream: bool,
}

impl Sample {
    pub fn ok(&self) -> bool {
        self.database && self.rpc && self.stream
    }
}

fn samples() -> &'static Mutex<VecDeque<Sample>> {
    static S: OnceLock<Mutex<VecDeque<Sample>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(VecDeque::new()))
}

pub fn push_sample(s: Sample) {
    let mut q = samples().lock().expect("samples lock");
    q.push_back(s);
    while q.len() > KEEP_SAMPLES {
        q.pop_front();
    }
}

/// Share of samples where a part was up, in % (None without samples).
pub fn uptime(list: &[Sample], part: impl Fn(&Sample) -> bool) -> Option<f64> {
    (!list.is_empty()).then(|| (list.iter().filter(|s| part(s)).count() as f64 / list.len() as f64 * 1000.0).round() / 10.0)
}

/// Moments a part went down or came back, newest first.
pub fn incidents(list: &[Sample]) -> Vec<Value> {
    let mut out = Vec::new();
    let parts: [(&str, fn(&Sample) -> bool); 3] = [("database", |s| s.database), ("rpc", |s| s.rpc), ("stream", |s| s.stream)];
    for (name, f) in parts {
        let mut down_since: Option<i64> = None;
        for s in list {
            match (f(s), down_since) {
                (false, None) => down_since = Some(s.t),
                (true, Some(from)) => {
                    out.push(json!({ "part": name, "from": from, "to": s.t }));
                    down_since = None;
                }
                _ => {}
            }
        }
        if let Some(from) = down_since {
            out.push(json!({ "part": name, "from": from, "to": null }));
        }
    }
    out.sort_by(|a, b| b["from"].as_i64().cmp(&a["from"].as_i64()));
    out
}

/// Once a minute: check each part and keep the result.
pub async fn sample_loop(state: Arc<crate::AppState>) {
    let mut tick = tokio::time::interval(SAMPLE_EVERY);
    loop {
        tick.tick().await;
        let (database, slot) = tokio::join!(crate::check_supabase(&state), crate::solana_slot(&state));
        let stream = state.stats.connected.load(std::sync::atomic::Ordering::Relaxed);
        push_sample(Sample { t: now(), database, rpc: slot.is_some(), stream });
    }
}

/// `GET /admin/system`: uptime, incidents and grouped errors (admin only).
pub async fn admin_system(State(state): State<Arc<crate::AppState>>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    if !crate::admin::is_admin(&headers) {
        return Err(StatusCode::FORBIDDEN);
    }
    let list: Vec<Sample> = samples().lock().expect("samples lock").iter().copied().collect();
    let started = now() - state.started.elapsed().as_secs() as i64;
    Ok(Json(json!({
        "now": now(),
        "started": started,
        "uptime": {
            "all": uptime(&list, Sample::ok),
            "database": uptime(&list, |s| s.database),
            "rpc": uptime(&list, |s| s.rpc),
            "stream": uptime(&list, |s| s.stream),
        },
        "samples": list,
        "incidents": incidents(&list),
        "rpc": crate::rpc_router::status(&state.router),
        "errors": groups(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varying_numbers_and_addresses_fold_into_one_group() {
        assert_eq!(shape("rpc error status=429 after 1200ms"), shape("rpc error status=503 after 80ms"));
        assert_eq!(shape("swap failed for 9Zxif9DTTtbfCW8iHzDbVquPXza1C5Tc7k2Hataq2hue"), shape("swap failed for C8qCb6smwarmisb89kUejVsd8uHHj96AXWT2Ex1XD33i"));
        assert_ne!(shape("database down"), shape("stream down"));
        record("test", "warn", "t", "dropped=12 backlog over pace");
        record("test", "warn", "t", "dropped=3 backlog over pace");
        let g: Vec<Group> = groups().into_iter().filter(|g| g.source == "test").collect();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].count, 2);
    }

    #[test]
    fn uptime_and_incidents_from_samples() {
        let s = |t, database| Sample { t, database, rpc: true, stream: true };
        let list = vec![s(0, true), s(60, false), s(120, false), s(180, true), s(240, false)];
        assert_eq!(uptime(&list, |x| x.database), Some(40.0));
        assert_eq!(uptime(&list, |x| x.rpc), Some(100.0));
        let inc = incidents(&list);
        assert_eq!(inc.len(), 2);
        assert_eq!(inc[0]["from"], 240);
        assert!(inc[0]["to"].is_null());
        assert_eq!((inc[1]["from"].as_i64(), inc[1]["to"].as_i64()), (Some(60), Some(180)));
        assert_eq!(uptime(&[], |x| x.rpc), None);
    }
}
