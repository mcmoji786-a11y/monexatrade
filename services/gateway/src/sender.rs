//! Kixo Sender: sends a signed transaction straight to the validators that will build
//! the next blocks, over QUIC (Solana's own TPU protocol), with no provider in between.
//!
//! How it works:
//! - The leader schedule comes from `getSlotLeaders` (one call covers about 30 minutes),
//!   validator addresses from `getClusterNodes` (every 10 minutes), and the current slot
//!   from `getSlot` every 2 s while someone is trading, extrapolated at 400 ms a slot in
//!   between. These are three cheap calls through our RPC router, not a sending service.
//! - While a trade ticket is open, QUIC connections to the next leaders are opened ahead
//!   of time, so a click goes out on an already open connection (no handshake).
//! - A transaction goes to the current leader and the next few, the same fanout Solana's
//!   own client uses, and the tracker re-sends it directly every 400 ms until it lands.
//!
//! Our connections are unstaked, so in a congested slot validators give them less room
//! than staked ones. This path runs next to Helius Sender, Jito and the RPC, never alone.

use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// Solana's nominal slot time.
const SLOT_MS: u64 = 400;
/// Slots ahead a transaction is sent for: 12 slots is 3 leaders of 4 slots each.
const FANOUT_SLOTS: u64 = 12;
/// Slots ahead connections are opened while someone is trading.
const WARM_SLOTS: u64 = 20;
/// How long the sender stays warm after the last trade activity.
const ACTIVE_FOR: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const SEND_TIMEOUT: Duration = Duration::from_millis(1500);
/// Solana validators listen for QUIC transactions on their TPU port plus 6 when the
/// node list does not say.
const QUIC_PORT_OFFSET: u16 = 6;
const ALPN: &[u8] = b"solana-tpu";
/// Connections per leader: 2 while someone is trading, up to 4 under load. A validator
/// lets an unstaked connection carry only so many streams at once (about 128), so
/// a burst of trades spreads over several connections instead of queueing on one.
/// Solana's own client keeps a pool of the same size.
const POOL_BASE: usize = 2;
const POOL_MAX: usize = 4;
/// Transactions sent in the last 10 s that count as "under load".
const BUSY_SENDS: usize = 50;

/// One QUIC connection and how many streams it is carrying right now.
#[derive(Clone)]
struct Pooled {
    conn: quinn::Connection,
    inflight: Arc<std::sync::atomic::AtomicUsize>,
}

#[derive(Default)]
struct Clock {
    slot: u64,
    at: Option<Instant>,
}

#[derive(Default)]
struct Leaders {
    start: u64,
    list: Vec<String>,
}

#[derive(Default, Clone)]
struct Stats {
    sends: u64,
    reached: u64,
    targets: u64,
    connects_ok: u64,
    connects_failed: u64,
    connect_ms_total: u64,
    last_error: Option<String>,
}

/// What one direct send did, for the trade's receipt.
#[derive(Debug, Clone, Default)]
pub struct DirectReport {
    pub slot: u64,
    pub leaders: usize,
    pub reached: usize,
    pub warm: usize,
    pub ms: u64,
    /// Microseconds from the request reaching Kixo to the first copy handed to the network.
    pub first_us: Option<u64>,
}

impl DirectReport {
    pub fn json(&self) -> Value {
        json!({ "slot": self.slot, "leaders": self.leaders, "reached": self.reached, "warm": self.warm, "ms": self.ms, "first_us": self.first_us })
    }
}

pub struct Sender {
    http: reqwest::Client,
    rpc_url: String,
    endpoint: Option<quinn::Endpoint>,
    clock: Mutex<Clock>,
    leaders: Mutex<Leaders>,
    nodes: Mutex<(Option<Instant>, HashMap<String, SocketAddr>)>,
    conns: Mutex<HashMap<SocketAddr, Vec<Pooled>>>,
    /// When recent transactions were sent, to size the pools.
    recent: Mutex<std::collections::VecDeque<Instant>>,
    stats: Mutex<Stats>,
    active_until: Mutex<Option<Instant>>,
    refreshing: tokio::sync::Mutex<()>,
}

pub type SenderState = Arc<Sender>;

impl Sender {
    pub fn new(http: reqwest::Client, rpc_url: String) -> SenderState {
        let endpoint = match endpoint() {
            Ok(e) => Some(e),
            Err(e) => {
                tracing::error!(%e, "kixo sender: QUIC endpoint could not start, direct sends are off");
                None
            }
        };
        Arc::new(Self {
            http,
            rpc_url,
            endpoint,
            clock: Mutex::new(Clock::default()),
            leaders: Mutex::new(Leaders::default()),
            nodes: Mutex::new((None, HashMap::new())),
            conns: Mutex::new(HashMap::new()),
            recent: Mutex::new(std::collections::VecDeque::new()),
            stats: Mutex::new(Stats::default()),
            active_until: Mutex::new(None),
            refreshing: tokio::sync::Mutex::new(()),
        })
    }

    /// Someone is about to trade: keep the schedule fresh and the connections open.
    pub fn touch(&self) {
        *self.active_until.lock().expect("active lock") = Some(Instant::now() + ACTIVE_FOR);
    }

    fn active(&self) -> bool {
        self.active_until.lock().expect("active lock").is_some_and(|t| Instant::now() < t)
    }

    /// The current slot: the last one read, moved on by the time since.
    fn slot_now(&self) -> Option<u64> {
        let c = self.clock.lock().expect("clock lock");
        let at = c.at?;
        if at.elapsed() > Duration::from_secs(30) {
            return None;
        }
        Some(c.slot + at.elapsed().as_millis() as u64 / SLOT_MS)
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let v: Value = self.http.post(&self.rpc_url).json(&body).timeout(Duration::from_secs(10)).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        match v.get("error") {
            Some(e) => Err(e.to_string()),
            None => Ok(v["result"].clone()),
        }
    }

    /// Reads the slot, and the leaders and validator addresses when they run out or age.
    async fn refresh(&self, force_slot: bool) {
        let _one = self.refreshing.lock().await;
        let stale = self.clock.lock().expect("clock lock").at.is_none_or(|a| a.elapsed() > Duration::from_millis(1800));
        if stale || force_slot {
            match self.rpc("getSlot", json!([{ "commitment": "processed" }])).await {
                Ok(v) => {
                    if let Some(s) = v.as_u64() {
                        *self.clock.lock().expect("clock lock") = Clock { slot: s, at: Some(Instant::now()) };
                    }
                }
                Err(e) => self.note_error(format!("getSlot: {e}")),
            }
        }
        let Some(now) = self.slot_now() else { return };
        let need_leaders = {
            let l = self.leaders.lock().expect("leaders lock");
            l.list.is_empty() || now < l.start || now + WARM_SLOTS + 100 >= l.start + l.list.len() as u64
        };
        if need_leaders {
            // Start a few slots back so a slow clock still finds the current leader.
            let start = now.saturating_sub(8);
            match self.rpc("getSlotLeaders", json!([start, 5000])).await {
                Ok(v) => {
                    let list: Vec<String> = v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                    if !list.is_empty() {
                        *self.leaders.lock().expect("leaders lock") = Leaders { start, list };
                    }
                }
                Err(e) => self.note_error(format!("getSlotLeaders: {e}")),
            }
        }
        let need_nodes = self.nodes.lock().expect("nodes lock").0.is_none_or(|a| a.elapsed() > Duration::from_secs(600));
        if need_nodes {
            match self.rpc("getClusterNodes", json!([])).await {
                Ok(v) => {
                    let map = parse_nodes(&v);
                    if !map.is_empty() {
                        *self.nodes.lock().expect("nodes lock") = (Some(Instant::now()), map);
                    }
                }
                Err(e) => self.note_error(format!("getClusterNodes: {e}")),
            }
        }
    }

    fn note_error(&self, e: String) {
        tracing::debug!(error = %e, "kixo sender");
        self.stats.lock().expect("stats lock").last_error = Some(e.chars().take(200).collect());
    }

    /// The TPU addresses of the leaders from `from` for `slots` slots, current first.
    fn targets(&self, from: u64, slots: u64) -> Vec<(String, SocketAddr)> {
        let l = self.leaders.lock().expect("leaders lock");
        let nodes = self.nodes.lock().expect("nodes lock");
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for slot in from..from + slots {
            let Some(i) = slot.checked_sub(l.start) else { continue };
            let Some(id) = l.list.get(i as usize) else { break };
            if seen.insert(id.clone()) {
                if let Some(addr) = nodes.1.get(id) {
                    out.push((id.clone(), *addr));
                }
            }
        }
        out
    }

    /// The least busy open connection to `addr`, counting the stream it is about to
    /// carry.
    fn pick(&self, addr: SocketAddr) -> Option<Pooled> {
        let mut m = self.conns.lock().expect("conns lock");
        let v = m.get_mut(&addr)?;
        v.retain(|p| p.conn.close_reason().is_none());
        let p = v.iter().min_by_key(|p| p.inflight.load(std::sync::atomic::Ordering::Relaxed))?.clone();
        p.inflight.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Some(p)
    }

    /// Opens one more connection to `addr` and adds it to the pool.
    async fn connect(&self, addr: SocketAddr) -> bool {
        let Some(ep) = self.endpoint.as_ref() else { return false };
        let started = Instant::now();
        let res = match ep.connect(addr, "connect") {
            Ok(connecting) => tokio::time::timeout(CONNECT_TIMEOUT, connecting).await.map_err(|_| "timeout".to_string()).and_then(|r| r.map_err(|e| e.to_string())),
            Err(e) => Err(e.to_string()),
        };
        let mut s = self.stats.lock().expect("stats lock");
        match res {
            Ok(c) => {
                s.connects_ok += 1;
                s.connect_ms_total += started.elapsed().as_millis() as u64;
                drop(s);
                self.conns.lock().expect("conns lock").entry(addr).or_default().push(Pooled { conn: c, inflight: Arc::new(0.into()) });
                true
            }
            Err(e) => {
                s.connects_failed += 1;
                s.last_error = Some(format!("connect {addr}: {e}"));
                false
            }
        }
    }

    /// How many connections each upcoming leader should have now.
    fn pool_size(&self) -> usize {
        let mut r = self.recent.lock().expect("recent lock");
        while r.front().is_some_and(|t| t.elapsed() > Duration::from_secs(10)) {
            r.pop_front();
        }
        if r.len() >= BUSY_SENDS {
            POOL_MAX
        } else {
            POOL_BASE
        }
    }

    /// Opens connections to the upcoming leaders (topping each pool up to its size) and
    /// closes the ones whose turn has passed.
    async fn warm(&self) {
        let Some(now) = self.slot_now() else { return };
        let upcoming = self.targets(now.saturating_sub(1), WARM_SLOTS);
        let keep: HashSet<SocketAddr> = upcoming.iter().map(|(_, a)| *a).collect();
        let want = self.pool_size();
        let missing: Vec<SocketAddr> = {
            let mut m = self.conns.lock().expect("conns lock");
            m.retain(|a, v| {
                v.retain(|p| p.conn.close_reason().is_none());
                let k = keep.contains(a) && !v.is_empty();
                if !k {
                    v.iter().for_each(|p| p.conn.close(0u32.into(), b"done"));
                }
                k
            });
            upcoming.iter().flat_map(|(_, a)| std::iter::repeat_n(*a, want.saturating_sub(m.get(a).map_or(0, Vec::len)))).collect()
        };
        futures_util::future::join_all(missing.into_iter().map(|a| self.connect(a))).await;
    }

    /// Sends several signed transactions to the current and next leaders, one QUIC
    /// stream each, spread over each leader's pooled connections. `since` is when the
    /// request reached Kixo, so `first_us` measures Kixo's own time until the first copy
    /// was handed to the network.
    pub async fn send_many(&self, txs: &[&[u8]], since: Instant) -> DirectReport {
        let started = Instant::now();
        self.touch();
        if self.endpoint.is_none() || txs.is_empty() {
            return DirectReport::default();
        }
        {
            let mut r = self.recent.lock().expect("recent lock");
            r.extend(std::iter::repeat_n(started, txs.len().min(BUSY_SENDS)));
            while r.len() > 4 * BUSY_SENDS {
                r.pop_front();
            }
        }
        if self.slot_now().is_none() || self.leaders.lock().expect("leaders lock").list.is_empty() || self.nodes.lock().expect("nodes lock").1.is_empty() {
            self.refresh(true).await;
        }
        let Some(now) = self.slot_now() else { return DirectReport::default() };
        // One slot back as well, in case our clock runs a little ahead of the chain.
        let targets = self.targets(now.saturating_sub(1), FANOUT_SLOTS + 1);
        let first = std::sync::atomic::AtomicU64::new(u64::MAX);
        let first = &first;
        let jobs = targets.iter().map(|(_, addr)| async move {
            let addr = *addr;
            // No warm connection (a cold start, or a leader we did not expect): open one.
            let warm = self.conns.lock().expect("conns lock").get(&addr).is_some_and(|v| v.iter().any(|p| p.conn.close_reason().is_none()));
            if !warm && !self.connect(addr).await {
                return (false, false);
            }
            let streams = txs.iter().map(|tx| async move {
                let Some(p) = self.pick(addr) else { return Err("no connection".to_string()) };
                let r = tokio::time::timeout(SEND_TIMEOUT, async {
                    let mut s = p.conn.open_uni().await.map_err(|e| e.to_string())?;
                    s.write_all(tx).await.map_err(|e| e.to_string())?;
                    s.finish().map_err(|e| e.to_string())?;
                    Ok::<_, String>(())
                })
                .await
                .unwrap_or_else(|_| Err("timeout".to_string()));
                p.inflight.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                if r.is_ok() {
                    first.fetch_min(since.elapsed().as_micros() as u64, std::sync::atomic::Ordering::Relaxed);
                }
                r
            });
            let results = futures_util::future::join_all(streams).await;
            let ok = results.iter().any(Result::is_ok);
            if let Some(Err(e)) = results.iter().find(|r| r.is_err()) {
                self.note_error(format!("send {addr}: {e}"));
            }
            (ok, warm)
        });
        let results = futures_util::future::join_all(jobs).await;
        let reached = results.iter().filter(|r| r.0).count();
        let warm = results.iter().filter(|r| r.0 && r.1).count();
        {
            let mut s = self.stats.lock().expect("stats lock");
            s.sends += txs.len() as u64;
            s.targets += targets.len() as u64;
            s.reached += reached as u64;
        }
        let f = first.load(std::sync::atomic::Ordering::Relaxed);
        DirectReport { slot: now, leaders: targets.len(), reached, warm, ms: started.elapsed().as_millis() as u64, first_us: (f != u64::MAX).then_some(f) }
    }

    /// Health for the admin and `/trade/sender`.
    pub fn status(&self) -> Value {
        let s = self.stats.lock().expect("stats lock").clone();
        let now = self.slot_now();
        let upcoming: Vec<Value> = now.map(|n| self.targets(n, FANOUT_SLOTS)).unwrap_or_default().into_iter().map(|(id, a)| json!({ "leader": id, "addr": a.to_string() })).collect();
        let warm = self.conns.lock().expect("conns lock").values().flatten().filter(|p| p.conn.close_reason().is_none()).count();
        json!({
            "ready": self.endpoint.is_some(),
            "active": self.active(),
            "slot": now,
            "leaders_known": self.leaders.lock().expect("leaders lock").list.len(),
            "validators_known": self.nodes.lock().expect("nodes lock").1.len(),
            "upcoming": upcoming,
            "warm_connections": warm,
            "sends": s.sends,
            "reach_rate": if s.targets == 0 { Value::Null } else { json!((s.reached as f64 / s.targets as f64 * 100.0).round()) },
            "connects_ok": s.connects_ok,
            "connects_failed": s.connects_failed,
            "avg_connect_ms": s.connect_ms_total.checked_div(s.connects_ok),
            "last_error": s.last_error,
        })
    }
}

/// Keeps the sender ready while someone is trading: the slot every 2 s, connections to
/// the next leaders every 400 ms. Idle otherwise, so it costs nothing between trades.
pub async fn run(s: SenderState) {
    let mut tick = tokio::time::interval(Duration::from_millis(SLOT_MS));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        if !s.active() {
            let idle = !s.conns.lock().expect("conns lock").is_empty();
            if idle {
                s.conns.lock().expect("conns lock").drain().flat_map(|(_, v)| v).for_each(|p| p.conn.close(0u32.into(), b"idle"));
            }
            continue;
        }
        s.refresh(false).await;
        s.warm().await;
    }
}

/// Validator identity to its QUIC transaction address, from `getClusterNodes`.
pub fn parse_nodes(v: &Value) -> HashMap<String, SocketAddr> {
    let mut out = HashMap::new();
    for n in v.as_array().into_iter().flatten() {
        let Some(id) = n["pubkey"].as_str() else { continue };
        let quic = n["tpuQuic"].as_str().and_then(|a| a.parse::<SocketAddr>().ok());
        let derived = || {
            let mut a = n["tpu"].as_str()?.parse::<SocketAddr>().ok()?;
            a.set_port(a.port().checked_add(QUIC_PORT_OFFSET)?);
            Some(a)
        };
        if let Some(a) = quic.or_else(derived) {
            out.insert(id.to_string(), a);
        }
    }
    out
}

/* ---------------- QUIC client set up like Solana's own ---------------- */

fn endpoint() -> anyhow::Result<quinn::Endpoint> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    // Validators read a client certificate to look up its stake; ours is a throwaway
    // Ed25519 key, so we are treated as unstaked, which is what we are.
    let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ED25519)?;
    let cert = rcgen::CertificateParams::new(vec!["solana".to_string()])?.self_signed(&key)?;
    let cert_der = rustls::pki_types::CertificateDer::from(cert.der().to_vec());
    let key_der = rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der()).map_err(|e| anyhow::anyhow!(e))?;
    let mut tls = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AnyServer(provider)))
        .with_client_auth_cert(vec![cert_der], key_der)?;
    tls.alpn_protocols = vec![ALPN.to_vec()];
    tls.enable_early_data = true;
    let mut cfg = quinn::ClientConfig::new(Arc::new(quinn::crypto::rustls::QuicClientConfig::try_from(tls)?));
    let mut transport = quinn::TransportConfig::default();
    transport.max_idle_timeout(Some(Duration::from_secs(10).try_into()?));
    transport.keep_alive_interval(Some(Duration::from_secs(2)));
    cfg.transport_config(Arc::new(transport));
    let mut ep = quinn::Endpoint::client("0.0.0.0:0".parse()?)?;
    ep.set_default_client_config(cfg);
    Ok(ep)
}

/// Validators present self-signed certificates tied to their identity, so there is no
/// certificate authority to check against (Solana's own client does the same). The
/// transaction is signed by the user; the connection carries nothing secret.
#[derive(Debug)]
struct AnyServer(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for AnyServer {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &rustls::pki_types::CertificateDer<'_>, dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &rustls::pki_types::CertificateDer<'_>, dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nodes_prefer_the_quic_address_and_derive_it_otherwise() {
        let v = json!([
            { "pubkey": "A", "tpu": "1.2.3.4:8003", "tpuQuic": "1.2.3.4:8009" },
            { "pubkey": "B", "tpu": "5.6.7.8:8000" },
            { "pubkey": "C" }
        ]);
        let m = parse_nodes(&v);
        assert_eq!(m["A"].to_string(), "1.2.3.4:8009");
        assert_eq!(m["B"].to_string(), "5.6.7.8:8006");
        assert!(!m.contains_key("C"));
    }

    #[test]
    fn targets_are_distinct_leaders_in_slot_order() {
        let s = Sender::new(reqwest::Client::new(), String::new());
        *s.leaders.lock().unwrap() = Leaders { start: 100, list: ["X", "X", "X", "X", "Y", "Y", "Y", "Y", "Z", "Z", "Z", "Z", "W"].iter().map(|x| x.to_string()).collect() };
        let addrs: HashMap<String, SocketAddr> = ["X", "Y", "Z", "W"].iter().enumerate().map(|(i, k)| (k.to_string(), format!("10.0.0.{}:8009", i + 1).parse().unwrap())).collect();
        *s.nodes.lock().unwrap() = (Some(Instant::now()), addrs);
        let t: Vec<String> = s.targets(102, FANOUT_SLOTS).into_iter().map(|(id, _)| id).collect();
        assert_eq!(t, ["X", "Y", "Z", "W"]);
        // Before the known range nothing is guessed.
        assert!(s.targets(10, 4).is_empty());
    }

    #[test]
    fn the_clock_moves_on_between_reads() {
        let s = Sender::new(reqwest::Client::new(), String::new());
        *s.clock.lock().unwrap() = Clock { slot: 1000, at: Some(Instant::now() - Duration::from_millis(1250)) };
        assert_eq!(s.slot_now(), Some(1003));
    }

    /// Live check from this machine: reads the schedule from Solana's public node, opens
    /// QUIC connections to the next leaders and reports handshake times. Sends nothing.
    /// Run with: cargo test -p monexa-gateway sender::tests::live_leaders -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_leaders() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let s = Sender::new(reqwest::Client::new(), monexa_common::PUBLIC_RPC.to_string());
        s.touch();
        s.refresh(true).await;
        println!("slot {:?}, leaders {}, validators {}", s.slot_now(), s.leaders.lock().unwrap().list.len(), s.nodes.lock().unwrap().1.len());
        for round in 0..3 {
            s.warm().await;
            println!("round {round}: {}", serde_json::to_string_pretty(&s.status()).unwrap());
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        assert!(s.stats.lock().unwrap().connects_ok > 0, "no leader accepted a QUIC connection");
    }

    /// A local stand-in for a validator's TPU: accepts QUIC with ALPN solana-tpu and
    /// counts the transactions it receives. Like a real validator it allows a limited
    /// number of concurrent streams per connection (128 here).
    async fn mock_validator(received: Arc<std::sync::atomic::AtomicU64>) -> SocketAddr {
        let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ED25519).unwrap();
        let cert = rcgen::CertificateParams::new(vec!["localhost".into()]).unwrap().self_signed(&key).unwrap();
        let mut tls = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_protocol_versions(&[&rustls::version::TLS13])
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![cert.der().to_vec().into()], rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der()).unwrap())
            .unwrap();
        tls.alpn_protocols = vec![ALPN.to_vec()];
        let mut cfg = quinn::ServerConfig::with_crypto(Arc::new(quinn::crypto::rustls::QuicServerConfig::try_from(tls).unwrap()));
        let mut transport = quinn::TransportConfig::default();
        transport.max_concurrent_uni_streams(std::env::var("KIXO_MOCK_STREAMS").ok().and_then(|v| v.parse::<u32>().ok()).unwrap_or(128).into());
        cfg.transport_config(Arc::new(transport));
        let ep = quinn::Endpoint::server(cfg, "127.0.0.1:0".parse().unwrap()).unwrap();
        let addr = ep.local_addr().unwrap();
        tokio::spawn(async move {
            while let Some(inc) = ep.accept().await {
                let received = received.clone();
                tokio::spawn(async move {
                    let Ok(conn) = inc.await else { return };
                    while let Ok(mut s) = conn.accept_uni().await {
                        let received = received.clone();
                        tokio::spawn(async move {
                            if s.read_to_end(2048).await.is_ok() {
                                received.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            }
                        });
                    }
                });
            }
        });
        addr
    }

    /// Load test: 1,000 traders press buy at the same moment. Each trade goes through
    /// what the gateway does on the hot path (signature check, journal write, direct send
    /// to 4 leaders on warm connections), and Kixo's own time is measured per trade.
    /// Run with: cargo test --release -p monexa-gateway sender::tests::load_1000_traders -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn load_1000_traders() {
        use ed25519_dalek::{Signer, SigningKey};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let received = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let mut addrs = HashMap::new();
        for id in ["L1", "L2", "L3", "L4"] {
            addrs.insert(id.to_string(), mock_validator(received.clone()).await);
        }
        let s = Sender::new(reqwest::Client::new(), String::new());
        *s.clock.lock().unwrap() = Clock { slot: 1000, at: Some(Instant::now()) };
        *s.leaders.lock().unwrap() = Leaders { start: 990, list: (0..200).map(|i| ["L1", "L2", "L3", "L4"][(i / 4) % 4].to_string()).collect() };
        *s.nodes.lock().unwrap() = (Some(Instant::now()), addrs);
        s.touch();
        if std::env::var("KIXO_LOAD_BUSY").is_ok() {
            // Trading was already busy, so the pools have grown to their full size.
            s.recent.lock().unwrap().extend(std::iter::repeat_n(Instant::now(), BUSY_SENDS));
        }
        s.warm().await;
        let journal_path = std::env::temp_dir().join(format!("kixo-load-{}.jsonl", std::process::id()));
        let journal = Arc::new(crate::journal::Journal::open(journal_path.to_str().unwrap()));

        // 1,000 traders, each with their own key and a signed transaction (~600 bytes,
        // a typical swap size).
        let n: u32 = std::env::var("KIXO_LOAD_N").ok().and_then(|v| v.parse().ok()).unwrap_or(1000);
        let trades: Vec<(Vec<u8>, Vec<u8>, [u8; 32])> = (0..n)
            .map(|i| {
                let mut seed = [0u8; 32];
                seed[..4].copy_from_slice(&i.to_le_bytes());
                let key = SigningKey::from_bytes(&seed);
                let pk = key.verifying_key().to_bytes();
                let mut msg = vec![0x80u8, 1, 0, 0, 1];
                msg.extend_from_slice(&pk);
                msg.extend_from_slice(&[9u8; 32]);
                msg.push(0);
                msg.resize(530, 0);
                let sig = key.sign(&msg).to_bytes();
                let mut tx = vec![1u8];
                tx.extend_from_slice(&sig);
                tx.extend_from_slice(&msg);
                (tx, msg, pk)
            })
            .collect();

        let gate = Arc::new(tokio::sync::Barrier::new(trades.len()));
        let started = Instant::now();
        let jobs: Vec<_> = trades
            .into_iter()
            .enumerate()
            .map(|(i, (tx, msg, pk))| {
                let (s, gate, journal) = (s.clone(), gate.clone(), journal.clone());
                tokio::spawn(async move {
                    gate.wait().await;
                    // Optionally spread the traders over a window instead of one instant.
                    let spread: u64 = std::env::var("KIXO_LOAD_SPREAD_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
                    if spread > 0 {
                        tokio::time::sleep(Duration::from_micros(i as u64 * spread * 1000 / n as u64)).await;
                    }
                    let t0 = Instant::now();
                    assert!(crate::solana_tx::verify_signed(&tx, &msg, &pk));
                    journal.sent(&json!({ "signature": format!("sig{i}"), "wallet": "w", "mint": "m" })).unwrap();
                    let r = s.send_many(&[&tx], t0).await;
                    (r.first_us, r.reached)
                })
            })
            .collect();
        let mut us: Vec<u64> = Vec::new();
        let mut not_sent = 0;
        for j in jobs {
            let (first, reached) = j.await.unwrap();
            match first {
                Some(f) if reached > 0 => us.push(f),
                _ => not_sent += 1,
            }
        }
        let wall = started.elapsed();
        tokio::time::sleep(Duration::from_millis(500)).await;
        us.sort_unstable();
        let pct = |p: f64| us[((us.len() as f64 * p) as usize).min(us.len() - 1)];
        println!(
            "{n} traders: sent {} (not sent {not_sent}) in {:?}\n  Kixo time per trade: p50 {} us, p90 {} us, p99 {} us, max {} us\n  copies received by the 4 mock leaders: {}",
            us.len(),
            wall,
            pct(0.5),
            pct(0.9),
            pct(0.99),
            us.last().unwrap(),
            received.load(std::sync::atomic::Ordering::Relaxed)
        );
        let _ = std::fs::remove_file(journal_path);
        assert_eq!(not_sent, 0);
    }
}
