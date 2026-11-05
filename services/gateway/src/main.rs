//! MONEXA gateway: the public HTTP/WebSocket entry point for the frontend.
//! Runs the ingest engine in-process: one Helius connection serves all users.
//! Tracked tokens live only in memory (no database), per ADR 0003.

mod metadata;

use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::HeaderValue,
    response::Response,
    routing::get,
    Json, Router,
};
use metadata::TokenMeta;
use monexa_common::Config;
use monexa_ingest::{market::MarketSnapshot, pumpfun::NewToken, IngestEvent, IngestStats};
use serde::Serialize;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, Semaphore};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

/// Max concurrent metadata fetches, so a launch burst cannot flood outbound requests.
const META_CONCURRENCY: usize = 8;

/// A token as the frontend sees it: on-chain data, creator metadata and live market data.
#[derive(Clone, Serialize)]
struct FeedToken {
    #[serde(flatten)]
    token: NewToken,
    meta: Option<TokenMeta>,
    market: Option<MarketSnapshot>,
}

/// Events pushed to browsers.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum FeedEvent {
    Token { token: FeedToken },
    Meta { mint: String, meta: TokenMeta },
    Market { sol_usd: Option<f64>, items: Vec<MarketSnapshot> },
    Removed { mints: Vec<String> },
}

#[derive(Default)]
struct Board {
    tokens: HashMap<String, FeedToken>,
    sol_usd: Option<f64>,
}

struct AppState {
    config: Config,
    http: reqwest::Client,
    feed: broadcast::Sender<FeedEvent>,
    board: Mutex<Board>,
    stats: Arc<IngestStats>,
    started: Instant,
    meta_slots: Semaphore,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    supabase: bool,
    helius: bool,
    solana_slot: Option<u64>,
    stream_connected: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    monexa_common::init_tracing();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let config = Config::from_env()?;
    tracing::info!(?config, "starting gateway");

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("monexa-gateway/0.1")
        .build()?;

    let (ingest_tx, ingest_rx) = broadcast::channel(1024);
    let (feed, _) = broadcast::channel(1024);
    let stats = Arc::new(IngestStats::default());
    let state = Arc::new(AppState {
        http,
        feed,
        board: Mutex::new(Board::default()),
        stats: stats.clone(),
        started: Instant::now(),
        meta_slots: Semaphore::new(META_CONCURRENCY),
        config: config.clone(),
    });

    tokio::spawn(monexa_ingest::run_forever(config.helius_ws_url(), config.helius_rpc_url(), ingest_tx, stats));
    tokio::spawn(process_events(state.clone(), ingest_rx));

    let cors = CorsLayer::new()
        .allow_origin(config.allowed_origin.parse::<HeaderValue>()?)
        .allow_methods([axum::http::Method::GET]);

    let app = Router::new()
        .route("/health", get(health))
        .route("/stats", get(stats_handler))
        .route("/ws/new-tokens", get(ws_new_tokens))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = config.gateway_port;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("gateway listening on http://localhost:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Apply engine events to the in-memory board and fan them out to browsers.
/// New tokens are published immediately; metadata follows in the background.
async fn process_events(state: Arc<AppState>, mut rx: broadcast::Receiver<IngestEvent>) {
    loop {
        let event = match rx.recv().await {
            Ok(e) => e,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(n, "event processor lagged");
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => return,
        };

        match event {
            IngestEvent::Created(token) => {
                let item = FeedToken { token: token.clone(), meta: None, market: None };
                state.board.lock().expect("board lock").tokens.insert(token.mint.clone(), item.clone());
                let _ = state.feed.send(FeedEvent::Token { token: item });
                spawn_metadata(state.clone(), token);
            }
            IngestEvent::Market { sol_usd, items } => {
                {
                    let mut board = state.board.lock().expect("board lock");
                    board.sol_usd = sol_usd.or(board.sol_usd);
                    for m in &items {
                        if let Some(t) = board.tokens.get_mut(&m.mint) {
                            t.market = Some(m.clone());
                        }
                    }
                }
                let _ = state.feed.send(FeedEvent::Market { sol_usd, items });
            }
            IngestEvent::Removed(mints) => {
                {
                    let mut board = state.board.lock().expect("board lock");
                    for m in &mints {
                        board.tokens.remove(m);
                    }
                }
                let _ = state.feed.send(FeedEvent::Removed { mints });
            }
        }
    }
}

fn spawn_metadata(state: Arc<AppState>, token: NewToken) {
    tokio::spawn(async move {
        let Ok(_permit) = state.meta_slots.acquire().await else { return };
        let Some(meta) = metadata::fetch(&state.http, &token.uri).await else { return };
        {
            let mut board = state.board.lock().expect("board lock");
            match board.tokens.get_mut(&token.mint) {
                Some(t) => t.meta = Some(meta.clone()),
                None => return, // pruned meanwhile
            }
        }
        let _ = state.feed.send(FeedEvent::Meta { mint: token.mint, meta });
    });
}

async fn ws_new_tokens(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| stream_tokens(socket, state))
}

/// Send the board snapshot (newest first), then every feed event as it happens.
async fn stream_tokens(mut socket: WebSocket, state: Arc<AppState>) {
    // Subscribe before taking the snapshot so no event falls in the gap.
    let mut rx = state.feed.subscribe();
    let msg = {
        let board = state.board.lock().expect("board lock");
        let mut tokens: Vec<&FeedToken> = board.tokens.values().collect();
        tokens.sort_by(|a, b| b.token.timestamp.cmp(&a.token.timestamp));
        json!({ "type": "snapshot", "sol_usd": board.sol_usd, "tokens": tokens }).to_string()
    };
    if socket.send(Message::Text(msg.into())).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {} // ignore client messages
            },
            event = rx.recv() => match event {
                Ok(event) => {
                    let Ok(msg) = serde_json::to_string(&event) else { continue };
                    if socket.send(Message::Text(msg.into())).await.is_err() {
                        return;
                    }
                }
                // Slow client: skip what it missed rather than disconnect it.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

/// Helius usage measurement. Credit rate (20 credits per MB) is from Helius's
/// LaserStream/WebSockets blog post; confirm against the dashboard.
async fn stats_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let s = state.stats.snapshot();
    let uptime = state.started.elapsed().as_secs_f64().max(1.0);
    let mb = s.bytes_received as f64 / 1_048_576.0;
    let mb_per_day = mb / uptime * 86_400.0;
    let sol_usd = state.board.lock().expect("board lock").sol_usd;
    Json(json!({
        "uptime_secs": uptime as u64,
        "stream": s,
        "sol_usd": sol_usd,
        "mb_received": (mb * 100.0).round() / 100.0,
        "estimated_mb_per_day": mb_per_day.round(),
        "estimated_credits_per_day": (mb_per_day * 20.0).round(),
        "note": "estimate: 20 credits/MB (unverified for this plan), raw JSON bytes only",
    }))
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Health> {
    let (supabase, slot) = tokio::join!(check_supabase(&state), solana_slot(&state));
    let helius = slot.is_some();
    Json(Health {
        status: if supabase && helius { "ok" } else { "degraded" },
        supabase,
        helius,
        solana_slot: slot,
        stream_connected: state.stats.connected.load(std::sync::atomic::Ordering::Relaxed),
    })
}

async fn check_supabase(state: &AppState) -> bool {
    let url = format!("{}/auth/v1/settings", state.config.supabase_url);
    match state.http.get(url).header("apikey", &state.config.supabase_anon_key).send().await {
        Ok(res) => res.status().is_success(),
        Err(err) => {
            tracing::warn!(%err, "supabase health check failed");
            false
        }
    }
}

async fn solana_slot(state: &AppState) -> Option<u64> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSlot" });
    let res = state
        .http
        .post(state.config.helius_rpc_url())
        .json(&body)
        .send()
        .await
        .map_err(|err| tracing::warn!(err = %err.without_url(), "helius health check failed"))
        .ok()?;
    let value: serde_json::Value = res.json().await.ok()?;
    value.get("result")?.as_u64()
}
