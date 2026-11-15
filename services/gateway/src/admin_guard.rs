//! The guard in front of every `/admin/...` route, on top of each route's own ADMIN_TOKEN
//! check (admin.rs `is_admin`):
//!
//! - ADMIN_ALLOWED_IPS (comma separated): admin answers only from these addresses. Any
//!   other address gets 404, as if there were no admin at all. Unset: any address, so
//!   the token and the lockout below are the only guards.
//! - Lockout: 5 wrong admin keys from one address within 15 minutes lock that address
//!   out of the admin for 30 minutes (429), and the attempt is logged and audited. A
//!   right key clears the count.
//!
//! Behind Kixo's own proxy, TRUST_PROXY=1 reads the visitor from X-Forwarded-For;
//! without it the forwarded header is ignored, so it cannot be faked.

use axum::{
    extract::{ConnectInfo, Request},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_FAILS: usize = 5;
const FAIL_WINDOW: Duration = Duration::from_secs(15 * 60);
const LOCK_FOR: Duration = Duration::from_secs(30 * 60);

#[derive(Default)]
struct Guard {
    fails: HashMap<IpAddr, VecDeque<Instant>>,
    locked: HashMap<IpAddr, Instant>,
}

static GUARD: OnceLock<Mutex<Guard>> = OnceLock::new();
fn guard() -> &'static Mutex<Guard> {
    GUARD.get_or_init(|| Mutex::new(Guard::default()))
}

fn allowed_ips() -> Option<Vec<IpAddr>> {
    let v = std::env::var("ADMIN_ALLOWED_IPS").ok()?;
    let list: Vec<IpAddr> = v.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    (!list.is_empty()).then_some(list)
}

fn visitor(addr: SocketAddr, req: &Request) -> IpAddr {
    if std::env::var("TRUST_PROXY").is_ok_and(|v| v.trim() == "1") {
        if let Some(ip) = req.headers().get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).and_then(|v| v.trim().parse().ok()) {
            return ip;
        }
    }
    addr.ip()
}

/// Whether this address may reach the admin now: allowed, and not locked out.
fn blocked(ip: IpAddr) -> Option<StatusCode> {
    if allowed_ips().is_some_and(|list| !list.contains(&ip)) {
        return Some(StatusCode::NOT_FOUND);
    }
    let mut g = guard().lock().expect("admin guard lock");
    match g.locked.get(&ip) {
        Some(t) if t.elapsed() < LOCK_FOR => Some(StatusCode::TOO_MANY_REQUESTS),
        Some(_) => {
            g.locked.remove(&ip);
            None
        }
        None => None,
    }
}

/// A wrong admin key from this address; locks it out after too many.
fn failed(ip: IpAddr) {
    let mut g = guard().lock().expect("admin guard lock");
    let q = g.fails.entry(ip).or_default();
    while q.front().is_some_and(|t| t.elapsed() > FAIL_WINDOW) {
        q.pop_front();
    }
    q.push_back(Instant::now());
    let n = q.len();
    tracing::warn!(%ip, attempts = n, "admin: wrong admin key");
    if n >= MAX_FAILS {
        g.fails.remove(&ip);
        g.locked.insert(ip, Instant::now());
        tracing::warn!(%ip, minutes = LOCK_FOR.as_secs() / 60, "admin: address locked out after repeated wrong keys");
        // Not from unit tests, which would leave a stray data/audit.jsonl in the crate folder.
        #[cfg(not(test))]
        crate::platform::audit(Some(SocketAddr::new(ip, 0)), "admin_lockout", serde_json::json!({ "attempts": n }));
    }
    if g.fails.len() > 10_000 {
        g.fails.retain(|_, q| q.back().is_some_and(|t| t.elapsed() < FAIL_WINDOW));
    }
}

fn succeeded(ip: IpAddr) {
    guard().lock().expect("admin guard lock").fails.remove(&ip);
}

pub async fn guard_admin(ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request, next: Next) -> Response {
    if !req.uri().path().starts_with("/admin/") || req.method() == Method::OPTIONS {
        return next.run(req).await;
    }
    let ip = visitor(addr, &req);
    if let Some(code) = blocked(ip) {
        return match code {
            StatusCode::TOO_MANY_REQUESTS => (code, "Too many wrong admin keys. Try again later").into_response(),
            _ => code.into_response(),
        };
    }
    let res = next.run(req).await;
    if res.status() == StatusCode::FORBIDDEN {
        failed(ip);
    } else if res.status().is_success() {
        succeeded(ip);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn five_wrong_keys_lock_an_address_and_others_stay_open() {
        let bad: IpAddr = "10.9.8.7".parse().unwrap();
        let other: IpAddr = "10.9.8.6".parse().unwrap();
        for _ in 0..4 {
            failed(bad);
        }
        assert_eq!(blocked(bad), None);
        failed(bad);
        assert_eq!(blocked(bad), Some(StatusCode::TOO_MANY_REQUESTS));
        assert_eq!(blocked(other), None);
    }
}
