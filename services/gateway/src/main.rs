//! MONEXA gateway: the public HTTP/WebSocket entry point for the frontend.
//! Runs the ingest engine in-process: one Helius connection serves all users.
//! Tracked tokens live only in memory (no database), per ADR 0003.

mod account;
mod admin;
mod demo;
mod presence;
mod book;
mod devs;
mod dex;
mod jupiter;
mod metadata;
mod pools;
mod portfolio;
mod rpc;
mod txdecode;

use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{HeaderValue, StatusCode},
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
use tokio::sync::{broadcast, mpsc, Semaphore};
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
    /// The creator's earlier coins, as our engine saw them (devs.rs).
    dev_report: Option<devs::DevReport>,
}

/// Events pushed to browsers.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum FeedEvent {
    /// Smart wallets holding each coin (devs.rs), refreshed every minute.
    Smart {
        counts: HashMap<String, u32>,
    },
    Token {
        token: FeedToken,
    },
    Meta {
        mint: String,
        meta: TokenMeta,
    },
    Market {
        sol_usd: Option<f64>,
        items: Vec<MarketSnapshot>,
    },
    Removed {
        mints: Vec<String>,
    },
    /// Established tokens across Solana (Jupiter provider), only those that changed.
    Markets {
        items: Vec<jupiter::MarketToken>,
    },
    MarketsRemoved {
        mints: Vec<String>,
    },
}

#[derive(Default)]
struct Board {
    tokens: HashMap<String, FeedToken>,
    sol_usd: Option<f64>,
    markets: jupiter::MarketBoard,
    /// Smart wallets holding each live coin.
    smart: HashMap<String, u32>,
    /// Recent USD prices per coin for Discover's mini charts, oldest first.
    sparks: HashMap<String, std::collections::VecDeque<(i64, f64)>>,
}

/// One price sample per coin at most this often, keeping this many (30 minutes).
const SPARK_EVERY: i64 = 30;
const SPARK_POINTS: usize = 60;

impl Board {
    fn sample(&mut self, mint: &str, price: Option<f64>, now: i64) {
        let Some(price) = price.filter(|p| p.is_finite() && *p > 0.0) else { return };
        let s = self.sparks.entry(mint.to_string()).or_default();
        match s.back_mut() {
            Some(last) if now - last.0 < SPARK_EVERY => last.1 = price,
            _ => {
                s.push_back((now, price));
                if s.len() > SPARK_POINTS {
                    s.pop_front();
                }
            }
        }
    }

    /// Price series per coin for a new browser connection.
    fn spark_series(&self) -> HashMap<&str, Vec<f64>> {
        self.sparks.iter().filter(|(_, s)| s.len() > 1).map(|(m, s)| (m.as_str(), s.iter().map(|(_, p)| *p).collect())).collect()
    }
}

fn now_unix() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

struct AppState {
    config: Config,
    http: reqwest::Client,
    feed: broadcast::Sender<FeedEvent>,
    board: Mutex<Board>,
    stats: Arc<IngestStats>,
    started: Instant,
    meta_slots: Semaphore,
    creators: Mutex<devs::Creators>,
    smart: Mutex<devs::SmartMoney>,
    /// Smart-money leaderboard, refreshed every minute.
    leaders: Mutex<Vec<devs::Leader>>,
    /// Wallets checked on chain for bot speed: (checked at, looks like a bot).
    bot_checks: Mutex<HashMap<String, (Instant, bool)>>,
    /// Trade history per tracked launch, for the trade page.
    books: Mutex<book::Books>,
    /// GeckoTerminal candles and trades for tokens outside our decoder.
    dex: Arc<dex::DexCache>,
    /// Commands to the ingest engine (watch or unwatch a PumpSwap pool).
    ingest_cmd: mpsc::UnboundedSender<monexa_ingest::IngestCommand>,
    /// Graduated coins whose PumpSwap pool is streamed, by mint.
    watches: Mutex<HashMap<String, Watch>>,
    /// Pool discovery (DexScreener) and quote token prices (Jupiter).
    pools: pools::Pools,
    /// Pool transactions to fetch and decode: (mint, signature, attempts).
    tx_queue: mpsc::UnboundedSender<(String, String, u8)>,
    /// A book changed in bulk (history arrived): open trade pages for this mint resend it.
    refresh: broadcast::Sender<String>,
    /// Every trade on a tracked launch, as (mint, row); trade pages filter by mint.
    trades: broadcast::Sender<(String, book::TradeRow)>,
    /// Single-token lookups for the trade page, cached briefly so many open pages
    /// cost one Jupiter call per token every few seconds.
    token_cache: Mutex<HashMap<String, (Instant, Option<jupiter::MarketToken>)>>,
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

    let (ingest_tx, ingest_rx) = broadcast::channel(8192);
    let (feed, _) = broadcast::channel(1024);
    let stats = Arc::new(IngestStats::default());
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let (tx_queue_tx, tx_queue_rx) = mpsc::unbounded_channel();
    let state = Arc::new(AppState {
        http,
        feed,
        board: Mutex::new(Board::default()),
        stats: stats.clone(),
        started: Instant::now(),
        meta_slots: Semaphore::new(META_CONCURRENCY),
        creators: Mutex::new(devs::Creators::default()),
        // Smart-money records survive restarts (data/smart_money.json).
        smart: Mutex::new(load_smart()),
        leaders: Mutex::new(Vec::new()),
        bot_checks: Mutex::new(HashMap::new()),
        books: Mutex::new(book::Books::default()),
        ingest_cmd: cmd_tx,
        watches: Mutex::new(HashMap::new()),
        pools: pools::Pools::default(),
        tx_queue: tx_queue_tx,
        refresh: broadcast::channel(256).0,
        dex: Arc::new(dex::DexCache::default()),
        trades: broadcast::channel(4096).0,
        token_cache: Mutex::new(HashMap::new()),
        config: config.clone(),
    });

    tokio::spawn(monexa_ingest::run_forever(
        config.helius_ws_url(),
        config.helius_rpc_url(),
        ingest_tx,
        stats,
        cmd_rx,
    ));
    tokio::spawn(expire_watches(state.clone()));
    tokio::spawn(fetch_pool_txs(state.clone(), tx_queue_rx));
    tokio::spawn(process_events(state.clone(), ingest_rx));
    tokio::spawn(poll_markets(state.clone()));
    tokio::spawn(prune_launches(state.clone()));
    tokio::spawn(update_smart(state.clone()));
    tokio::spawn(seed_smart(state.clone()));

    let cors = CorsLayer::new()
        .allow_origin(config.allowed_origin.parse::<HeaderValue>()?)
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::PUT])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::AUTHORIZATION, axum::http::HeaderName::from_static("x-admin-token")]);

    // Rewards settings and creator applications (admin.rs), with their own state.
    let admin_routes: Router<Arc<AppState>> = Router::new()
        .route("/rewards/config", get(admin::get_rewards))
        .route("/features", get(admin::get_features))
        .route("/admin/features", axum::routing::put(admin::put_features))
        .route("/creator/apply", axum::routing::post(admin::apply_creator))
        .route("/admin/check", get(admin::check_admin))
        .route("/admin/rewards", axum::routing::put(admin::put_rewards))
        .route("/admin/creator-applications", get(admin::list_applications))
        .route("/admin/creator-applications/{id}", axum::routing::post(admin::set_application))
        .with_state(admin::AdminState::load());

    let acct = account::AccountState::new(state.http.clone(), &config.supabase_url, &config.supabase_anon_key, &config.supabase_service_role_key);
    // Demo trading (demo.rs): virtual balance filled at live market prices.
    let demo_routes: Router<Arc<AppState>> = Router::new()
        .route("/demo/account", get(demo::get_account))
        .route("/demo/order", axum::routing::post(demo::order))
        .route("/demo/reset", axum::routing::post(demo::reset))
        .route("/demo/trades", get(demo::trades))
        .with_state(demo::DemoCtx { app: state.clone(), acct: acct.clone() });
    // Accounts: profile sync (account.rs).
    let account_routes: Router<Arc<AppState>> = Router::new()
        .route("/account/sync", axum::routing::post(account::sync))
        .route("/account/me", get(account::me_handler))
        .with_state(acct);

    let app = Router::new()
        .route("/health", get(health))
        .route("/stats", get(stats_handler))
        .route("/metrics/public", get(metrics_handler))
        .route("/ws/new-tokens", get(ws_new_tokens))
        .route("/token/{mint}", get(token_handler))
        .route("/token/{mint}/wallets", get(wallets_handler))
        .route("/token/{mint}/dex", get(dex_handler))
        .route("/smart-money", get(smart_handler))
        .route("/wallet/{address}/balance", get(balance_handler))
        .route("/wallet/{address}/portfolio", get(portfolio_handler))
        .route("/wallet/{address}/activity", get(activity_handler))
        .route("/alerts/status", get(alerts_status))
        .route("/ws/wallets", get(ws_wallets))
        .route("/ws/token/{mint}", get(ws_token))
        .merge(admin_routes)
        .merge(account_routes)
        .merge(demo_routes)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = config.gateway_port;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("gateway listening on http://localhost:{port}");
    // Client addresses for the creator-application spam guard.
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await?;
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
                // The trade book counts amounts in SOL. Curves quoted in another
                // currency (USD1 and similar) would read as $0, so those coins use
                // their DEX history instead.
                if token.quote_mint.is_none() {
                    state.books.lock().expect("books lock").add(&token);
                }
                let dev_report = {
                    let mut c = state.creators.lock().expect("creators lock");
                    c.launched(&token.creator, &token.mint, token.timestamp);
                    Some(c.report(&token.creator, &token.mint))
                };
                let item = FeedToken {
                    token: token.clone(),
                    meta: None,
                    market: None,
                    dev_report,
                };
                state
                    .board
                    .lock()
                    .expect("board lock")
                    .tokens
                    .insert(token.mint.clone(), item.clone());
                let _ = state.feed.send(FeedEvent::Token { token: item });
                spawn_metadata(state.clone(), token);
            }
            IngestEvent::Launched(token) => {
                let dev_report = {
                    let mut c = state.creators.lock().expect("creators lock");
                    c.launched(&token.creator, &token.mint, token.timestamp);
                    Some(c.report(&token.creator, &token.mint))
                };
                let item = FeedToken {
                    token: token.clone(),
                    meta: None,
                    market: None,
                    dev_report,
                };
                state
                    .board
                    .lock()
                    .expect("board lock")
                    .tokens
                    .insert(token.mint.clone(), item.clone());
                let _ = state.feed.send(FeedEvent::Token { token: item });
                spawn_metadata(state.clone(), token);
            }
            IngestEvent::Market { sol_usd, items } => {
                {
                    let mut board = state.board.lock().expect("board lock");
                    board.sol_usd = sol_usd.or(board.sol_usd);
                    let now = now_unix();
                    let mut creators = state.creators.lock().expect("creators lock");
                    for m in &items {
                        if let Some(t) = board.tokens.get_mut(&m.mint) {
                            t.market = Some(m.clone());
                        }
                        board.sample(&m.mint, m.price_usd, now);
                        creators.market(&m.mint, m.mc_usd, m.complete, m.dev_sold_all);
                    }
                }
                let _ = state.feed.send(FeedEvent::Market { sol_usd, items });
            }
            IngestEvent::Removed(mints) => {
                {
                    // Copy the watched set first: watch_pool locks watches before books,
                    // so never hold books while waiting for watches.
                    let watched: std::collections::HashSet<String> = state
                        .watches
                        .lock()
                        .expect("watches lock")
                        .keys()
                        .cloned()
                        .collect();
                    let mut board = state.board.lock().expect("board lock");
                    let mut books = state.books.lock().expect("books lock");
                    let mut creators = state.creators.lock().expect("creators lock");
                    let mut smart = state.smart.lock().expect("smart lock");
                    let now = now_unix();
                    for m in &mints {
                        board.tokens.remove(m);
                        board.sparks.remove(m);
                        board.smart.remove(m);
                        creators.ended(m, now);
                        smart.fold(m, books.positions_of(m).iter());
                        // A graduated coin pruned from the launch board keeps its book
                        // while its pool is being watched.
                        if !watched.contains(m) {
                            books.remove(m);
                        }
                    }
                }
                let _ = state.feed.send(FeedEvent::Removed { mints });
            }
            IngestEvent::PoolTx { mint, signature } => {
                let _ = state.tx_queue.send((mint, signature, 0));
            }
            IngestEvent::Trade {
                signature,
                mut trade,
            } => {
                // Pools quoted in another token (WBTC, USDC...) report raw quote units;
                // convert them to lamports of equal value so the book stays in SOL.
                let factor = state
                    .watches
                    .lock()
                    .expect("watches lock")
                    .get(&trade.mint)
                    .map_or(1.0, |w| w.factor);
                if factor != 1.0 {
                    scale_quote(&mut trade, factor);
                }
                let row = state
                    .books
                    .lock()
                    .expect("books lock")
                    .apply(&signature, &trade);
                if let Some(row) = row {
                    let _ = state.trades.send((trade.mint, row));
                }
            }
        }
    }
}

/// Poll one Jupiter category at a time and push only what changed to browsers.
async fn poll_markets(state: Arc<AppState>) {
    let mut delay = jupiter::POLL_EVERY;
    let mut round = 0usize;
    let mut category_round = 0usize;
    loop {
        round += 1;
        // Every few rounds, fetch exact holders/liquidity for our most traded launches.
        let launches = if round % jupiter::ENRICH_EVERY == 0 {
            most_traded_launches(&state)
        } else {
            Vec::new()
        };
        let (category, result) = if !launches.is_empty() {
            (
                "launch enrichment",
                jupiter::fetch_mints(&state.http, &launches).await,
            )
        } else {
            let c = jupiter::category(category_round);
            category_round += 1;
            (c, jupiter::fetch_category(&state.http, c).await)
        };
        delay = jupiter::next_delay(delay, &result);
        match result {
            jupiter::PollResult::Ok(items) => {
                let (changed, removed) = {
                    let mut board = state.board.lock().expect("board lock");
                    let now = now_unix();
                    for t in &items {
                        // Coins our engine prices keep one source for their chart.
                        let own = board.tokens.get(&t.mint).and_then(|f| f.market.as_ref()).is_some_and(|m| m.sol_quoted);
                        if !own {
                            board.sample(&t.mint, t.price_usd, now);
                        }
                    }
                    let changed = board.markets.merge(items);
                    let removed = board.markets.prune();
                    for m in &removed {
                        if !board.tokens.contains_key(m) {
                            board.sparks.remove(m);
                        }
                    }
                    (changed, removed)
                };
                if !changed.is_empty() {
                    let _ = state.feed.send(FeedEvent::Markets { items: changed });
                }
                if !removed.is_empty() {
                    let _ = state
                        .feed
                        .send(FeedEvent::MarketsRemoved { mints: removed });
                }
            }
            jupiter::PollResult::RateLimited => {
                tracing::warn!(category, ?delay, "jupiter rate limited, backing off")
            }
            jupiter::PollResult::Failed => {}
        }
        tokio::time::sleep(delay).await;
    }
}

/// Mints to enrich from the market provider: coins from other launchpads first (we
/// decode no curve for them, so the provider is their only market data), newest
/// first, then pump.fun launches with the most volume in the last hour.
fn most_traded_launches(state: &AppState) -> Vec<String> {
    let board = state.board.lock().expect("board lock");
    let mut others: Vec<(&String, i64)> = board
        .tokens
        .values()
        .filter(|t| t.token.launchpad != "pump.fun")
        .map(|t| (&t.token.mint, t.token.timestamp))
        .collect();
    others.sort_by(|a, b| b.1.cmp(&a.1));
    let mut launches: Vec<(&String, f64)> = board
        .tokens
        .values()
        .filter_map(|t| t.market.as_ref().map(|m| (&t.token.mint, m.volume_1h_sol)))
        .filter(|(_, v)| *v > 0.0)
        .collect();
    launches.sort_by(|a, b| b.1.total_cmp(&a.1));
    let others = others
        .into_iter()
        .take(jupiter::ENRICH_BATCH / 2)
        .map(|(m, _)| m.clone());
    others
        .chain(launches.into_iter().map(|(m, _)| m.clone()))
        .take(jupiter::ENRICH_BATCH)
        .collect()
}

/// Coins from other launchpads leave the board when nothing trades them: after
/// `LAUNCH_QUIET` without a market from the provider, or `LAUNCH_MAX_AGE` in any case
/// (Discover takes over for coins that keep trading). At most `LAUNCH_MAX` are kept.
const LAUNCH_QUIET: i64 = 20 * 60;
const LAUNCH_MAX_AGE: i64 = 6 * 3600;
const LAUNCH_MAX: usize = 300;

async fn prune_launches(state: Arc<AppState>) {
    let mut tick = tokio::time::interval(Duration::from_secs(30));
    loop {
        tick.tick().await;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        let removed: Vec<String> = {
            let mut board = state.board.lock().expect("board lock");
            let trading: std::collections::HashSet<String> = board
                .markets
                .all()
                .into_iter()
                .filter(|m| m.volume_1h_usd.unwrap_or(0.0) > 0.0)
                .map(|m| m.mint)
                .collect();
            let mut others: Vec<(String, i64, bool)> = board
                .tokens
                .values()
                .filter(|t| t.token.launchpad != "pump.fun")
                .map(|t| {
                    (
                        t.token.mint.clone(),
                        t.token.timestamp,
                        trading.contains(&t.token.mint),
                    )
                })
                .collect();
            others.sort_by(|a, b| b.1.cmp(&a.1));
            let gone: Vec<String> = others
                .iter()
                .enumerate()
                .filter(|(i, (_, ts, trading))| {
                    *i >= LAUNCH_MAX
                        || now - ts > LAUNCH_MAX_AGE
                        || (!trading && now - ts > LAUNCH_QUIET)
                })
                .map(|(_, (m, _, _))| m.clone())
                .collect();
            let mut creators = state.creators.lock().expect("creators lock");
            for m in &gone {
                board.tokens.remove(m);
                creators.ended(m, now);
            }
            gone
        };
        if !removed.is_empty() {
            let _ = state.feed.send(FeedEvent::Removed { mints: removed });
        }
    }
}

fn spawn_metadata(state: Arc<AppState>, token: NewToken) {
    tokio::spawn(async move {
        let Ok(_permit) = state.meta_slots.acquire().await else {
            return;
        };
        let Some(meta) = metadata::fetch(&state.http, &token.uri).await else {
            return;
        };
        {
            let mut board = state.board.lock().expect("board lock");
            match board.tokens.get_mut(&token.mint) {
                Some(t) => t.meta = Some(meta.clone()),
                None => return, // pruned meanwhile
            }
        }
        let _ = state.feed.send(FeedEvent::Meta {
            mint: token.mint,
            meta,
        });
    });
}

async fn ws_new_tokens(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> Response {
    // Behind a proxy the visitor is the first forwarded address; it only feeds counts.
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(addr.ip());
    ws.on_upgrade(move |socket| async move {
        let live = presence::LiveGuard::new(Some(ip));
        stream_tokens(socket, state, live.0).await
    })
}

/// Send the board snapshot (newest first), then every feed event as it happens.
async fn stream_tokens(mut socket: WebSocket, state: Arc<AppState>, session: usize) {
    // Subscribe before taking the snapshot so no event falls in the gap.
    let mut rx = state.feed.subscribe();
    let msg = {
        let board = state.board.lock().expect("board lock");
        // Creator records grow while a coin is live: report them as of now.
        let creators = state.creators.lock().expect("creators lock");
        let mut tokens: Vec<FeedToken> = board
            .tokens
            .values()
            .map(|t| FeedToken { dev_report: Some(creators.report(&t.token.creator, &t.token.mint)), ..t.clone() })
            .collect();
        tokens.sort_by(|a, b| b.token.timestamp.cmp(&a.token.timestamp));
        json!({ "type": "snapshot", "sol_usd": board.sol_usd, "tokens": tokens, "markets": board.markets.all(), "sparks": board.spark_series(), "smart": board.smart })
            .to_string()
    };
    if socket.send(Message::Text(msg.into())).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                // The page the visitor is on, for the admin's live view: {"type":"page","path":"/radar"}.
                Some(Ok(Message::Text(t))) if t.len() < 200 => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                        if v["type"] == "page" {
                            if let Some(p) = v["path"].as_str() {
                                presence::set_page(session, p);
                            }
                        }
                    }
                }
                _ => {} // ignore other client messages
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
        stream_connected: state
            .stats
            .connected
            .load(std::sync::atomic::Ordering::Relaxed),
    })
}

async fn check_supabase(state: &AppState) -> bool {
    let url = format!("{}/auth/v1/settings", state.config.supabase_url);
    match state
        .http
        .get(url)
        .header("apikey", &state.config.supabase_anon_key)
        .send()
        .await
    {
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

const TOKEN_CACHE_TTL: Duration = Duration::from_secs(3);
const TOKEN_CACHE_MAX: usize = 2_000;

/// A Solana address: base58, 32 to 44 characters.
fn is_mint(s: &str) -> bool {
    (32..=44).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() && !matches!(b, b'0' | b'O' | b'I' | b'l'))
}

/// `GET /token/{mint}`: one token's market data, for a trade page whose token is not
/// (or no longer) on the live board; `null` when the provider does not know it.
async fn token_handler(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Result<Json<Option<jupiter::MarketToken>>, StatusCode> {
    if !is_mint(&mint) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Json(lookup_token(&state, &mint).await.flatten()))
}

/// A token's market data from the provider, cached. Only Solana memecoins come back:
/// `fetch_mints` applies the memecoin filter, so stocks, stablecoins, wrapped majors
/// and DeFi tokens read as unknown.
/// Outer `None`: the provider is busy and the answer is not known yet.
async fn lookup_token(state: &Arc<AppState>, mint: &str) -> Option<Option<jupiter::MarketToken>> {
    if let Some((at, hit)) = state.token_cache.lock().expect("cache lock").get(mint) {
        if at.elapsed() < TOKEN_CACHE_TTL {
            return Some(hit.clone());
        }
    }
    let found = match jupiter::fetch_mints(&state.http, &[mint.to_string()]).await {
        jupiter::PollResult::Ok(items) => items.into_iter().find(|t| t.mint == mint),
        // Provider busy: unknown for now, not cached.
        _ => return None,
    };
    let mut cache = state.token_cache.lock().expect("cache lock");
    if cache.len() >= TOKEN_CACHE_MAX {
        cache.retain(|_, (at, _)| at.elapsed() < TOKEN_CACHE_TTL);
    }
    cache.insert(mint.to_string(), (Instant::now(), found.clone()));
    Some(found)
}

/// MONEXA shows Solana memecoins only: our own pump.fun launches, or a token the
/// provider classifies as a memecoin. Anything else gets no chart, trades or pool watch.
/// While the provider is rate limited we do not block: a confirmed non-memecoin is
/// cached and blocked on the next answer.
async fn is_memecoin(state: &Arc<AppState>, mint: &str) -> bool {
    if !is_mint(mint) {
        return false;
    }
    let on_board = {
        let board = state.board.lock().expect("board lock");
        board.tokens.contains_key(mint) || board.markets.all().iter().any(|t| t.mint == mint)
    };
    on_board
        || state.books.lock().expect("books lock").contains(mint)
        || lookup_token(state, mint).await.is_none_or(|t| t.is_some())
}

/// `GET /token/{mint}/wallets`: holders, top traders, dev and snipers for a launch
/// we track; `null` for tokens outside our decoder.
/// `?wallet=<address>` also returns that wallet's position (the trade page's
/// Positions tab, before wallet connect exists).
async fn wallets_handler(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Json<Option<book::Wallets>> {
    let focus = q.get("wallet").filter(|w| is_mint(w)).map(String::as_str);
    Json(
        state
            .books
            .lock()
            .expect("books lock")
            .wallets(&mint, focus),
    )
}

async fn ws_token(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Response {
    ws.on_upgrade(move |socket| stream_token(socket, state, mint))
}

/// One token's trade book: a snapshot (recent trades and candles), then each new trade.
/// Tokens we do not decode get `{"type":"untracked"}` and the socket closes.
async fn stream_token(mut socket: WebSocket, state: Arc<AppState>, mint: String) {
    let _page = presence::TradeGuard::new();
    let mut rx = state.trades.subscribe();
    let mut refresh = state.refresh.subscribe();
    // Graduated coins (curve complete, or not on our board at all) trade in a PumpSwap
    // pool: start streaming it before taking the snapshot.
    let graduated = state
        .board
        .lock()
        .expect("board lock")
        .tokens
        .get(&mint)
        .is_some_and(|t| t.market.as_ref().is_some_and(|m| m.complete));
    let known = state.books.lock().expect("books lock").contains(&mint);
    let watching = if (graduated || !known) && is_memecoin(&state, &mint).await {
        watch_pool(&state, &mint).await
    } else {
        false
    };
    let _viewer = watching.then(|| Viewer::new(state.clone(), mint.clone()));
    let snapshot = state.books.lock().expect("books lock").snapshot(&mint);
    let msg = match snapshot {
        Some(s) => json!({ "type": "book", "book": s }),
        None => json!({ "type": "untracked" }),
    };
    if socket
        .send(Message::Text(msg.to_string().into()))
        .await
        .is_err()
        || snapshot_missing(&msg)
    {
        return;
    }
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {}
            },
            changed = refresh.recv() => {
                if matches!(changed, Ok(ref m) if *m == mint) {
                    let snapshot = state.books.lock().expect("books lock").snapshot(&mint);
                    if let Some(b) = snapshot {
                        let msg = json!({ "type": "book", "book": b }).to_string();
                        if socket.send(Message::Text(msg.into())).await.is_err() {
                            return;
                        }
                    }
                }
            },
            event = rx.recv() => match event {
                Ok((m, row)) if m == mint => {
                    let msg = json!({ "type": "trade", "trade": row }).to_string();
                    if socket.send(Message::Text(msg.into())).await.is_err() {
                        return;
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

fn snapshot_missing(msg: &serde_json::Value) -> bool {
    msg["type"] == "untracked"
}

/// `GET /token/{mint}/dex`: candles and recent trades from the token's main Solana DEX
/// pool, for tokens our own decoder does not cover; `null` when no pool is found.
async fn dex_handler(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Result<Json<Option<dex::DexHistory>>, StatusCode> {
    if !is_mint(&mint) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !is_memecoin(&state, &mint).await {
        return Ok(Json(None));
    }
    Ok(Json(dex::history(&state.http, &state.dex, &mint).await))
}

/// How long a pool stays streamed after its last viewer leaves.
const WATCH_GRACE: Duration = Duration::from_secs(120);
/// Pools streamed at once. Busy pools carry thousands of failed bot transactions a
/// minute that logsSubscribe cannot filter (measured 2026-11-06: ~20k in 60 s across
/// three large pools), so the free plan's credits need a hard cap. Raise with the
/// paid plan.
const MAX_WATCHES: usize = 3;

struct Watch {
    pool: String,
    /// Quote token of the pool (wrapped SOL for migrated pump.fun pools).
    quote: String,
    /// Lamports per raw quote unit; 1.0 for wrapped SOL. Refreshed every minute.
    factor: f64,
    /// The pool's account data, to find its vaults in transactions.
    spec: Arc<txdecode::PoolSpec>,
    viewers: usize,
    last_seen: Instant,
}

fn scale_quote(t: &mut monexa_ingest::pumpfun::Trade, factor: f64) {
    t.sol_amount = (t.sol_amount as f64 * factor) as u64;
    t.virtual_sol_reserves = (t.virtual_sol_reserves as f64 * factor) as u64;
}

/// Lamports per raw unit of a quote token at today's prices.
async fn quote_factor(state: &Arc<AppState>, quote: &str) -> Option<f64> {
    if quote == monexa_ingest::pumpswap::WSOL {
        return Some(1.0);
    }
    let sol_usd = state.board.lock().expect("board lock").sol_usd?;
    let (usd, decimals) = state.pools.price(&state.http, quote).await?;
    Some(pools::lamports_per_raw(usd, decimals, sol_usd))
}

/// Counts an open trade page for a watched pool; dropping it records when it left.
struct Viewer {
    state: Arc<AppState>,
    mint: String,
}

impl Viewer {
    fn new(state: Arc<AppState>, mint: String) -> Self {
        if let Some(w) = state.watches.lock().expect("watches lock").get_mut(&mint) {
            w.viewers += 1;
        }
        Self { state, mint }
    }
}

impl Drop for Viewer {
    fn drop(&mut self) {
        if let Some(w) = self
            .state
            .watches
            .lock()
            .expect("watches lock")
            .get_mut(&self.mint)
        {
            w.viewers = w.viewers.saturating_sub(1);
            w.last_seen = Instant::now();
        }
    }
}

/// DEXes whose pools the universal decoder reads (DexScreener ids).
const SUPPORTED_DEXES: [&str; 4] = ["pumpswap", "raydium", "orca", "meteora"];

/// Starts streaming a coin's main pool so every trade arrives live, on any DEX.
/// PumpSwap pools are decoded from their logs; other DEXes do not log trades, so each
/// of their transactions is fetched and read by the universal decoder (txdecode.rs).
/// The page goes live at once; earlier trades and longer candles fill in behind.
/// False when no supported pool exists (the browser then polls indexed history).
async fn watch_pool(state: &Arc<AppState>, mint: &str) -> bool {
    if state
        .watches
        .lock()
        .expect("watches lock")
        .contains_key(mint)
    {
        return true;
    }
    let rpc_url = state.config.helius_rpc_url();
    let amm = monexa_ingest::pumpswap::PROGRAM_ID;

    // 1. The pool pump.fun migrates into (SOL quote), derived without a lookup.
    // 2. Otherwise the coin's most liquid pool on a supported DEX, in any quote token.
    // 0. A Meteora DBC coin still on its curve: the pool we saw it created in.
    let dbc = {
        let board = state.board.lock().expect("board lock");
        board
            .tokens
            .get(mint)
            .filter(|t| {
                matches!(t.token.launchpad.as_str(), "met-dbc" | "bags")
                    && !t.token.bonding_curve.is_empty()
            })
            .map(|t| {
                (
                    t.token.bonding_curve.clone(),
                    t.token
                        .quote_mint
                        .clone()
                        .unwrap_or_else(|| monexa_ingest::pumpswap::WSOL.to_string()),
                )
            })
    };
    let canonical = match (&dbc, monexa_ingest::pumpswap::canonical_pool(mint)) {
        (None, Some(p))
            if rpc::account_owner(&state.http, &rpc_url, &p)
                .await
                .as_deref()
                == Some(amm) =>
        {
            Some(p)
        }
        _ => None,
    };
    let (pool, quote, name, dex) = if let Some((pool, quote)) = dbc {
        (pool, quote, None, "meteora-dbc".to_string())
    } else {
        match canonical {
            Some(p) => (
                p,
                monexa_ingest::pumpswap::WSOL.to_string(),
                None,
                "pumpswap".to_string(),
            ),
            None => {
                // Among the top listed pools, take the one with the most successful swaps in
                // the last five minutes on chain: listing stats can be stale for idle pools.
                let pairs = state.pools.pairs(&state.http, mint).await;
                let candidates: Vec<pools::Pair> = pairs
                    .into_iter()
                    .filter(|p| SUPPORTED_DEXES.contains(&p.dex.as_str()))
                    .take(3)
                    .collect();
                let mut best: Option<(usize, pools::Pair)> = None;
                for p in candidates {
                    let n = rpc::recent_activity(&state.http, &rpc_url, &p.address).await;
                    if best.as_ref().is_none_or(|(b, _)| n > *b) {
                        best = Some((n, p));
                    }
                }
                let Some((_, pair)) = best else { return false };
                (pair.address, pair.quote, Some(pair.name), pair.dex)
            }
        }
    };
    let Some((owner, data)) = rpc::account_data(&state.http, &rpc_url, &pool).await else {
        return false;
    };
    let decode_logs = owner == amm;
    let spec = Arc::new(txdecode::PoolSpec {
        data,
        coin: mint.to_string(),
        quote: quote.clone(),
    });
    let Some(factor) = quote_factor(state, &quote).await else {
        return false;
    };
    // Market cap = trade price x the mint's real supply, read from chain.
    let supply = rpc::token_supply(&state.http, &rpc_url, mint).await;

    {
        let mut watches = state.watches.lock().expect("watches lock");
        if watches.contains_key(mint) {
            return true;
        }
        if watches.len() >= MAX_WATCHES {
            // Make room by dropping a pool nobody is viewing; otherwise fall back.
            let idle = watches
                .iter()
                .filter(|(_, w)| w.viewers == 0)
                .min_by_key(|(_, w)| w.last_seen)
                .map(|(m, _)| m.clone());
            match idle {
                Some(m) => {
                    if let Some(w) = watches.remove(&m) {
                        let _ = state
                            .ingest_cmd
                            .send(monexa_ingest::IngestCommand::UnwatchPool { pool: w.pool });
                    }
                }
                None => {
                    tracing::warn!(mint, "pool watch limit reached, using indexed history");
                    return false;
                }
            }
        }
        state.books.lock().expect("books lock").add_pool(
            mint,
            name.as_deref().unwrap_or(if dex == "meteora-dbc" { "Meteora curve" } else { "PumpSwap" }),
            &dex,
            supply,
            Vec::new(),
            Vec::new(),
        );
        watches.insert(
            mint.to_string(),
            Watch {
                pool: pool.clone(),
                quote,
                factor,
                spec: spec.clone(),
                viewers: 0,
                last_seen: Instant::now(),
            },
        );
    }
    let _ = state
        .ingest_cmd
        .send(monexa_ingest::IngestCommand::WatchPool {
            pool: pool.clone(),
            mint: mint.to_string(),
            decode_logs,
        });
    tracing::info!(mint, %pool, %dex, factor, decode_logs, "watching pool");

    let (state, mint) = (state.clone(), mint.to_string());
    tokio::spawn(async move {
        // 1. Recent trades from the chain, read by the universal decoder.
        let sigs = rpc::recent_signatures(&state.http, &rpc_url, &pool, RECENT_SWAPS).await;
        let mut older = Vec::new();
        for (n, chunk) in sigs.chunks(TX_BATCH).enumerate() {
            if n > 0 {
                tokio::time::sleep(TX_BATCH_GAP).await;
            }
            for (sig, tx) in chunk
                .iter()
                .zip(rpc::transactions(&state.http, &rpc_url, chunk).await)
            {
                if let Some(s) = tx.as_ref().and_then(|t| txdecode::decode(t, &spec)) {
                    older.push((sig.clone(), swap_trade(&mint, s, factor)));
                }
            }
        }
        if !older.is_empty() {
            state
                .books
                .lock()
                .expect("books lock")
                .backfill_trades(&mint, older);
            let _ = state.refresh.send(mint.clone());
        }
        // 2. Longer candle history from the indexer, retried if it is rate limited.
        for attempt in 0..5 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
            let Some(h) = dex::history(&state.http, &state.dex, &mint).await else {
                continue;
            };
            let Some(sol_usd) = state.board.lock().expect("board lock").sol_usd else {
                continue;
            };
            if h.candles.is_empty() {
                continue;
            }
            let supply = state
                .books
                .lock()
                .expect("books lock")
                .supply(&mint)
                .unwrap_or(1_000_000_000.0);
            let k = supply / sol_usd;
            let candles = h
                .candles
                .iter()
                .map(|c| book::Candle {
                    t: c.t,
                    o: c.o * k,
                    h: c.h * k,
                    l: c.l * k,
                    c: c.c * k,
                    v: c.v / sol_usd,
                })
                .collect();
            state
                .books
                .lock()
                .expect("books lock")
                .backfill_candles(&mint, candles);
            let _ = state.refresh.send(mint.clone());
            return;
        }
    });
    true
}

/// A decoded swap as a book trade, its quote converted to lamports of equal value.
fn swap_trade(mint: &str, s: txdecode::Swap, factor: f64) -> monexa_ingest::pumpfun::Trade {
    let mut t = monexa_ingest::pumpfun::Trade {
        mint: mint.to_string(),
        sol_amount: s.quote_amount,
        token_amount: s.coin_amount,
        is_buy: s.is_buy,
        user: s.wallet,
        timestamp: s.timestamp,
        virtual_sol_reserves: 0,
        virtual_token_reserves: 0,
        real_token_reserves: 0,
    };
    if factor != 1.0 {
        scale_quote(&mut t, factor);
    }
    t
}

/// Free-plan pacing for transaction fetches: small batches about once a second
/// (Helius free allows ~10 requests a second, shared with everything else).
const TX_BATCH: usize = 6;
const TX_BATCH_GAP: Duration = Duration::from_millis(800);
/// Pending transactions kept per round; beyond this the oldest are dropped (only a
/// coin trading faster than the free plan can fetch reaches it).
const TX_BACKLOG: usize = 600;

/// Fetches the transactions ingest reports for watched pools and applies their swaps.
async fn fetch_pool_txs(
    state: Arc<AppState>,
    mut queue: mpsc::UnboundedReceiver<(String, String, u8)>,
) {
    let rpc_url = state.config.helius_rpc_url();
    let mut pending: std::collections::VecDeque<(String, String, u8)> =
        std::collections::VecDeque::new();
    loop {
        if pending.is_empty() {
            match queue.recv().await {
                Some(item) => pending.push_back(item),
                None => return,
            }
        }
        while let Ok(item) = queue.try_recv() {
            pending.push_back(item);
        }
        if pending.len() > TX_BACKLOG {
            let drop = pending.len() - TX_BACKLOG;
            pending.drain(..drop);
            tracing::warn!(dropped = drop, "pool tx backlog over the free-plan pace");
        }
        // Newest first: a live page wants the latest trades, the backlog can wait.
        let take = pending.len().min(TX_BATCH);
        let batch: Vec<(String, String, u8)> =
            pending.drain(pending.len() - take..).rev().collect();
        let sigs: Vec<String> = batch.iter().map(|(_, s, _)| s.clone()).collect();
        let txs = rpc::transactions(&state.http, &rpc_url, &sigs).await;
        for ((mint, sig, tries), tx) in batch.into_iter().zip(txs) {
            let Some(tx) = tx else {
                // Not visible yet at "confirmed": try again in a later round.
                if tries < 3 {
                    pending.push_back((mint, sig, tries + 1));
                }
                continue;
            };
            let watch = state
                .watches
                .lock()
                .expect("watches lock")
                .get(&mint)
                .map(|w| (w.spec.clone(), w.factor));
            let Some((spec, factor)) = watch else {
                continue;
            };
            let Some(swap) = txdecode::decode(&tx, &spec) else {
                continue;
            };
            let trade = swap_trade(&mint, swap, factor);
            let row = state.books.lock().expect("books lock").apply(&sig, &trade);
            if let Some(row) = row {
                let _ = state.trades.send((mint, row));
            }
        }
        tokio::time::sleep(TX_BATCH_GAP).await;
    }
}

/// Recent pool transactions fetched when a coin's page opens.
const RECENT_SWAPS: usize = 40;

/// Stops streaming pools nobody has looked at for WATCH_GRACE, and drops their books
/// unless the coin is still on the launch board.
async fn expire_watches(state: Arc<AppState>) {
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    loop {
        tick.tick().await;
        let expired: Vec<(String, String)> = {
            let mut watches = state.watches.lock().expect("watches lock");
            let gone: Vec<String> = watches
                .iter()
                .filter(|(_, w)| w.viewers == 0 && w.last_seen.elapsed() > WATCH_GRACE)
                .map(|(m, _)| m.clone())
                .collect();
            gone.into_iter()
                .filter_map(|m| watches.remove(&m).map(|w| (m, w.pool)))
                .collect()
        };
        let quoted: Vec<(String, String)> = state
            .watches
            .lock()
            .expect("watches lock")
            .iter()
            .filter(|(_, w)| w.quote != monexa_ingest::pumpswap::WSOL)
            .map(|(m, w)| (m.clone(), w.quote.clone()))
            .collect();
        for (mint, quote) in quoted {
            if let Some(f) = quote_factor(&state, &quote).await {
                if let Some(w) = state.watches.lock().expect("watches lock").get_mut(&mint) {
                    w.factor = f;
                }
            }
        }
        for (mint, pool) in expired {
            let _ = state
                .ingest_cmd
                .send(monexa_ingest::IngestCommand::UnwatchPool { pool });
            let on_board = state
                .board
                .lock()
                .expect("board lock")
                .tokens
                .contains_key(&mint);
            if !on_board {
                state.books.lock().expect("books lock").remove(&mint);
            }
            tracing::info!(%mint, "stopped watching pool");
        }
    }
}

/// Every minute: count smart wallets (devs.rs) holding each live coin and push it.
async fn update_smart(state: Arc<AppState>) {
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    loop {
        tick.tick().await;
        let (_, candidates) = {
            let books = state.books.lock().expect("books lock");
            let smart = state.smart.lock().expect("smart lock");
            smart.evaluate(books.all_positions(), now_unix())
        };
        // Last check on the whole chain: our books only see coins we track, so a bot
        // can look calm there. More than BOT_TX_PER_MIN transactions a minute across its
        // latest BOT_SAMPLE is not a person.
        let mut leaders = Vec::new();
        for l in candidates {
            let cached = state.bot_checks.lock().expect("bot lock").get(&l.wallet).filter(|(at, _)| at.elapsed() < BOT_CHECK_TTL).map(|(_, b)| *b);
            let bot = match cached {
                Some(b) => b,
                None => {
                    let times = rpc::signature_times(&state.http, &state.config.helius_rpc_url(), &l.wallet, BOT_SAMPLE).await;
                    let Some(times) = times else { continue };
                    let bot = looks_like_bot(&times);
                    let mut checks = state.bot_checks.lock().expect("bot lock");
                    if checks.len() > 10_000 {
                        checks.retain(|_, (at, _)| at.elapsed() < BOT_CHECK_TTL);
                    }
                    checks.insert(l.wallet.clone(), (Instant::now(), bot));
                    bot
                }
            };
            if !bot {
                leaders.push(l);
            }
        }
        let mut counts: HashMap<String, u32> = HashMap::new();
        for l in &leaders {
            for m in &l.holding {
                *counts.entry(m.clone()).or_default() += 1;
            }
        }
        *state.leaders.lock().expect("leaders lock") = leaders;
        state.board.lock().expect("board lock").smart = counts.clone();
        let _ = state.feed.send(FeedEvent::Smart { counts });
    }
}

/// `GET /smart-money`: the leaderboard of smart wallets (devs.rs), with the age of the
/// record so the page can say how long the gateway has been watching.
async fn smart_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let leaders = state.leaders.lock().expect("leaders lock").clone();
    let symbols: HashMap<String, String> = {
        let board = state.board.lock().expect("board lock");
        leaders.iter().flat_map(|l| l.holding.iter()).filter_map(|m| board.tokens.get(m).map(|t| (m.clone(), t.token.symbol.clone()))).collect()
    };
    Json(json!({ "tracking_secs": state.started.elapsed().as_secs(), "leaders": leaders, "symbols": symbols }))
}

/// `GET /alerts/status`: which outside delivery channels are set up on this gateway.
/// Telegram needs MONEXA's bot token in the environment; Discord uses each user's own
/// webhook, delivered by the gateway once alerts are stored per account.
async fn alerts_status() -> Json<serde_json::Value> {
    let telegram = std::env::var("TELEGRAM_BOT_TOKEN").is_ok_and(|t| !t.trim().is_empty());
    Json(json!({ "telegram": telegram, "discord": false, "server_delivery": false }))
}

/// Wallets one connection may watch, so a page cannot ask for the whole chain.
const MAX_WATCHED_WALLETS: usize = 50;

#[derive(serde::Deserialize)]
struct WalletsQuery {
    w: String,
}

async fn ws_wallets(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>, Query(q): Query<WalletsQuery>) -> Response {
    let wallets: std::collections::HashSet<String> = q.w.split(',').map(str::trim).filter(|w| is_mint(w)).take(MAX_WATCHED_WALLETS).map(String::from).collect();
    ws.on_upgrade(move |socket| stream_wallets(socket, state, wallets))
}

/// Trades by the given wallets on every coin our engine decodes: recent history first,
/// then each new trade as it is decoded. No extra RPC calls: it reads the trade books.
async fn stream_wallets(mut socket: WebSocket, state: Arc<AppState>, wallets: std::collections::HashSet<String>) {
    let mut rx = state.trades.subscribe();
    let symbol = |state: &AppState, mint: &str| state.board.lock().expect("board lock").tokens.get(mint).map(|t| t.token.symbol.clone());
    let history: Vec<serde_json::Value> = state
        .books
        .lock()
        .expect("books lock")
        .trades_by(&wallets, 200)
        .into_iter()
        .map(|(mint, row)| json!({ "mint": mint, "symbol": symbol(&state, &mint), "trade": row }))
        .collect();
    let first = json!({ "type": "history", "trades": history, "sol_usd": state.board.lock().expect("board lock").sol_usd });
    if socket.send(Message::Text(first.to_string().into())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {}
            },
            event = rx.recv() => match event {
                Ok((mint, row)) if wallets.contains(&row.wallet) => {
                    let msg = json!({ "type": "trade", "mint": mint, "symbol": symbol(&state, &mint), "trade": row, "sol_usd": state.board.lock().expect("board lock").sol_usd });
                    if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
                        return;
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

const BOT_SAMPLE: usize = 100;
const BOT_TX_PER_MIN: f64 = 4.0;
const BOT_CHECK_TTL: Duration = Duration::from_secs(30 * 60);

/// `times`: block times, newest first. A full sample packed into a short span means
/// machine speed; a short sample (a quiet wallet) is never called a bot.
fn looks_like_bot(times: &[i64]) -> bool {
    if times.len() < BOT_SAMPLE {
        return false;
    }
    let span_min = ((times[0] - times[times.len() - 1]).max(1) as f64) / 60.0;
    times.len() as f64 / span_min > BOT_TX_PER_MIN
}

#[cfg(test)]
mod bot_tests {
    use super::*;

    #[test]
    fn machine_speed_is_a_bot() {
        // 100 transactions in 14 minutes (the wallet caught on 2026-11-06).
        let fast: Vec<i64> = (0..100).map(|i| 10_000 - i * 8).collect();
        assert!(looks_like_bot(&fast));
        // 100 transactions over two days.
        let slow: Vec<i64> = (0..100).map(|i| 200_000 - i * 1_800).collect();
        assert!(!looks_like_bot(&slow));
        assert!(!looks_like_bot(&[5, 4, 3]));
    }
}

/// Where smart-money records are kept between restarts (gitignored).
const SMART_FILE: &str = "data/smart_money.json";

fn load_smart() -> devs::SmartMoney {
    match std::fs::read(SMART_FILE).map(|b| serde_json::from_slice::<devs::SmartMoney>(&b)) {
        Ok(Ok(s)) => {
            tracing::info!(wallets = s.wallets(), "smart money records loaded");
            s
        }
        _ => devs::SmartMoney::default(),
    }
}

fn save_smart(state: &AppState) {
    let json = {
        let mut smart = state.smart.lock().expect("smart lock");
        smart.prune(now_unix());
        serde_json::to_vec(&*smart)
    };
    let Ok(json) = json else { return };
    let tmp = format!("{SMART_FILE}.tmp");
    let ok = std::fs::create_dir_all("data").and_then(|_| std::fs::write(&tmp, json)).and_then(|_| std::fs::rename(&tmp, SMART_FILE));
    if let Err(err) = ok {
        tracing::warn!(%err, "could not save smart money records");
    }
}

/// How often the top coins are read back from the chain, how many, and how many recent
/// swaps each. Free-plan budget: 10 coins x 300 transactions every 6 hours is about
/// 12,000 Helius calls a day. Raise with the paid plan.
const SEED_EVERY: Duration = Duration::from_secs(6 * 3600);
const SEED_COINS: usize = 10;
const SEED_TXS: usize = 300;
/// Coins busy enough to matter but not so busy that 300 swaps cover only seconds
/// (then only bots both buy and sell inside the window): trades in the last hour.
const SEED_MIN_TRADES_1H: u64 = 100;
const SEED_MAX_TRADES_1H: u64 = 1_500;
const SAVE_EVERY: Duration = Duration::from_secs(300);

/// Smart money from the start: read the latest swaps of the most traded memecoins on
/// chain (our own decoder), find who bought and sold, and record their results. The
/// same rules then decide who is listed. Saved every few minutes.
async fn seed_smart(state: Arc<AppState>) {
    // Let the board fill with market data first.
    tokio::time::sleep(Duration::from_secs(20)).await;
    // A recent seed saved on disk counts: a restart does not spend the budget again.
    let since = now_unix() - state.smart.lock().expect("smart lock").seeded_at;
    let mut last_seed: Option<Instant> = (since >= 0 && (since as u64) < SEED_EVERY.as_secs())
        .then(|| Instant::now().checked_sub(Duration::from_secs(since as u64)))
        .flatten();
    let mut save = tokio::time::interval(SAVE_EVERY);
    loop {
        if last_seed.is_none_or(|t| t.elapsed() >= SEED_EVERY) {
            let coins = seed_coins(&state);
            if coins.is_empty() {
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
            tracing::info!(coins = coins.len(), "seeding smart money from top coins");
            let mut seeded: Vec<book::Position> = Vec::new();
            for mint in coins {
                if let Some(positions) = seed_coin(&state, &mint).await {
                    let n = positions.len();
                    seeded.extend(positions.iter().cloned());
                    state.smart.lock().expect("smart lock").fold(&mint, positions.iter());
                    tracing::info!(mint, traders = n, "smart money: coin read");
                }
            }
            // Then each promising wallet's own recent history, across every coin.
            for wallet in seed_wallets(&state, &seeded) {
                if let Some(results) = wallet_history(&state, &wallet).await {
                    let mut smart = state.smart.lock().expect("smart lock");
                    for (mint, p) in &results {
                        smart.fold(mint, std::iter::once(p));
                    }
                }
            }
            last_seed = Some(Instant::now());
            state.smart.lock().expect("smart lock").seeded_at = now_unix();
            save_smart(&state);
        }
        save.tick().await;
        save_smart(&state);
    }
}

/// The most traded memecoins on Discover in the last 24 hours, at a trade pace a
/// 300-swap window can cover.
fn seed_coins(state: &AppState) -> Vec<String> {
    let board = state.board.lock().expect("board lock");
    let mut all = board.markets.all();
    all.sort_by(|a, b| b.volume_24h_usd.unwrap_or(0.0).total_cmp(&a.volume_24h_usd.unwrap_or(0.0)));
    all.into_iter()
        .filter(|t| {
            let trades = t.buys_1h.unwrap_or(0) + t.sells_1h.unwrap_or(0);
            t.volume_24h_usd.unwrap_or(0.0) > 0.0 && (SEED_MIN_TRADES_1H..=SEED_MAX_TRADES_1H).contains(&trades)
        })
        .take(SEED_COINS)
        .map(|t| t.mint)
        .collect()
}

/// Every trader's result on one coin from its pool's latest swaps (SOL-quoted pools).
async fn seed_coin(state: &Arc<AppState>, mint: &str) -> Option<Vec<book::Position>> {
    let rpc_url = state.config.helius_rpc_url();
    let wsol = monexa_ingest::pumpswap::WSOL;
    let amm = monexa_ingest::pumpswap::PROGRAM_ID;
    let canonical = match monexa_ingest::pumpswap::canonical_pool(mint) {
        Some(p) if rpc::account_owner(&state.http, &rpc_url, &p).await.as_deref() == Some(amm) => Some(p),
        _ => None,
    };
    let pool = match canonical {
        Some(p) => p,
        None => state.pools.pairs(&state.http, mint).await.into_iter().find(|p| SUPPORTED_DEXES.contains(&p.dex.as_str()) && p.quote == wsol)?.address,
    };
    let (_, data) = rpc::account_data(&state.http, &rpc_url, &pool).await?;
    let spec = txdecode::PoolSpec { data, coin: mint.to_string(), quote: wsol.to_string() };
    let sigs = rpc::recent_signatures(&state.http, &rpc_url, &pool, SEED_TXS).await;
    let mut swaps = Vec::new();
    for chunk in sigs.chunks(TX_BATCH) {
        for tx in rpc::transactions(&state.http, &rpc_url, chunk).await.into_iter().flatten() {
            swaps.extend(txdecode::decode(&tx, &spec));
        }
        tokio::time::sleep(TX_BATCH_GAP).await;
    }
    Some(positions_from_swaps(swaps))
}

/// Per-wallet results from swaps (quote amounts in lamports). Only wallets that both
/// bought and sold in the window have a known cost, so only they count.
fn positions_from_swaps(mut swaps: Vec<txdecode::Swap>) -> Vec<book::Position> {
    swaps.sort_by_key(|s| s.timestamp);
    let mut by: HashMap<String, book::Position> = HashMap::new();
    for s in swaps {
        let sol = s.quote_amount as f64 / 1e9;
        let tokens = s.coin_amount as f64;
        let p = by.entry(s.wallet.clone()).or_insert_with(|| book::Position { wallet: s.wallet.clone(), first_ts: s.timestamp, ..Default::default() });
        p.last_ts = p.last_ts.max(s.timestamp);
        if s.is_buy {
            p.buys += 1;
            p.bought_sol += sol;
            p.bought_tokens += tokens;
            p.balance += tokens;
        } else if p.bought_tokens > 0.0 {
            let avg = p.bought_sol / p.bought_tokens;
            let sold = tokens.min(p.balance.max(0.0));
            p.sells += 1;
            p.sold_sol += sol;
            p.sold_tokens += tokens;
            p.realized_sol += sol - avg * sold;
            p.balance = (p.balance - tokens).max(0.0);
        }
    }
    by.into_values().filter(|p| p.buys > 0 && p.sells > 0).collect()
}

#[cfg(test)]
mod seed_tests {
    use super::*;

    fn swap(w: &str, buy: bool, sol: f64, tokens: u64, ts: i64) -> txdecode::Swap {
        txdecode::Swap { wallet: w.into(), is_buy: buy, coin_amount: tokens, quote_amount: (sol * 1e9) as u64, timestamp: ts }
    }

    #[test]
    fn round_trips_give_realised_profit() {
        let p = positions_from_swaps(vec![
            swap("a", true, 1.0, 1_000, 10),
            swap("a", false, 1.5, 500, 200), // half sold for 1.5 SOL: cost 0.5, profit 1.0
            swap("b", false, 3.0, 100, 50),  // a sell with no buy seen: unknown cost, left out
            swap("c", true, 2.0, 100, 60),   // only bought
        ]);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].wallet, "a");
        assert!((p[0].realized_sol - 1.0).abs() < 1e-9);
        assert_eq!((p[0].first_ts, p[0].last_ts), (10, 200));
    }
}

/// Wallets whose own history is worth reading: profitable on a seeded coin or on a
/// live coin right now, best first.
const SEED_WALLETS: usize = 40;
const WALLET_HISTORY_TXS: usize = 100;
const STABLES: [&str; 2] = ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"];

fn seed_wallets(state: &AppState, seeded: &[book::Position]) -> Vec<String> {
    let mut best: HashMap<String, f64> = HashMap::new();
    for p in seeded.iter().filter(|p| p.realized_sol > 0.0) {
        *best.entry(p.wallet.clone()).or_default() += p.realized_sol;
    }
    {
        let books = state.books.lock().expect("books lock");
        for (_, ps) in books.all_positions() {
            for p in ps.into_iter().filter(|p| p.realized_sol > 0.2 && !p.wallet.is_empty()) {
                *best.entry(p.wallet.clone()).or_default() += p.realized_sol;
            }
        }
    }
    let mut v: Vec<(String, f64)> = best.into_iter().collect();
    v.sort_by(|a, b| b.1.total_cmp(&a.1));
    v.into_iter().take(SEED_WALLETS).map(|(w, _)| w).collect()
}

/// A wallet's results per coin over its latest transactions, read on chain. Bots are
/// skipped after one call (their speed shows in the signature list).
async fn wallet_history(state: &Arc<AppState>, wallet: &str) -> Option<Vec<(String, book::Position)>> {
    let rpc_url = state.config.helius_rpc_url();
    let (sigs, times) = rpc::signatures_with_times(&state.http, &rpc_url, wallet, WALLET_HISTORY_TXS).await?;
    let bot = looks_like_bot(&times);
    state.bot_checks.lock().expect("bot lock").insert(wallet.to_string(), (Instant::now(), bot));
    if bot {
        return None;
    }
    let mut per_coin: HashMap<String, Vec<txdecode::Swap>> = HashMap::new();
    for chunk in sigs.chunks(TX_BATCH) {
        for tx in rpc::transactions(&state.http, &rpc_url, chunk).await.into_iter().flatten() {
            if let Some((mint, swap)) = wallet_swap(&tx, wallet) {
                per_coin.entry(mint).or_default().push(swap);
            }
        }
        tokio::time::sleep(TX_BATCH_GAP).await;
    }
    let out: Vec<(String, book::Position)> = per_coin
        .into_iter()
        .flat_map(|(mint, swaps)| positions_from_swaps(swaps).into_iter().map(move |p| (mint.clone(), p)))
        .collect();
    tracing::info!(wallet, coins = out.len(), "smart money: wallet read");
    Some(out)
}

/// One wallet's swap in a transaction, from its own balance changes: exactly one coin
/// in or out, paid or received in SOL (native or wrapped). Works on every DEX.
fn wallet_swap(tx: &serde_json::Value, wallet: &str) -> Option<(String, txdecode::Swap)> {
    let meta = &tx["meta"];
    if !meta["err"].is_null() {
        return None;
    }
    let keys = tx["transaction"]["message"]["accountKeys"].as_array()?;
    let idx = keys.iter().position(|k| k.as_str() == Some(wallet))?;
    let lamports = meta["postBalances"][idx].as_i64()? - meta["preBalances"][idx].as_i64()?;
    let wsol = monexa_ingest::pumpswap::WSOL;
    let amount = |b: &serde_json::Value| b["uiTokenAmount"]["amount"].as_str().and_then(|a| a.parse::<i128>().ok()).unwrap_or(0);
    let mut deltas: HashMap<String, i128> = HashMap::new();
    for (list, sign) in [(&meta["postTokenBalances"], 1i128), (&meta["preTokenBalances"], -1i128)] {
        for b in list.as_array().into_iter().flatten().filter(|b| b["owner"].as_str() == Some(wallet)) {
            if let Some(m) = b["mint"].as_str() {
                *deltas.entry(m.to_string()).or_default() += sign * amount(b);
            }
        }
    }
    let sol = lamports as i128 + deltas.remove(wsol).unwrap_or(0);
    let coins: Vec<(String, i128)> = deltas.into_iter().filter(|(m, d)| *d != 0 && !STABLES.contains(&m.as_str())).collect();
    let [(mint, coin)] = coins.as_slice() else { return None };
    let is_buy = *coin > 0;
    // A buy spends SOL, a sell receives it; anything else is a transfer or airdrop.
    if (is_buy && sol >= 0) || (!is_buy && sol <= 0) {
        return None;
    }
    let ts = tx["blockTime"].as_i64()?;
    Some((
        mint.clone(),
        txdecode::Swap { wallet: wallet.to_string(), is_buy, coin_amount: coin.unsigned_abs() as u64, quote_amount: sol.unsigned_abs() as u64, timestamp: ts },
    ))
}

#[cfg(test)]
mod wallet_swap_tests {
    use super::*;

    #[test]
    fn reads_a_buy_from_balance_changes() {
        let tx = json!({
            "blockTime": 100,
            "transaction": { "message": { "accountKeys": ["W", "X"] } },
            "meta": {
                "err": null,
                "preBalances": [5_000_000_000i64, 0], "postBalances": [4_000_000_000i64, 0],
                "preTokenBalances": [],
                "postTokenBalances": [{ "owner": "W", "mint": "COIN", "uiTokenAmount": { "amount": "1000" } }]
            }
        });
        let (mint, s) = wallet_swap(&tx, "W").expect("swap");
        assert_eq!(mint, "COIN");
        assert!(s.is_buy);
        assert_eq!((s.coin_amount, s.quote_amount), (1000, 1_000_000_000));
        // A transfer in (no SOL spent) is not a buy.
        let mut gift = tx.clone();
        gift["meta"]["postBalances"][0] = json!(5_000_000_000i64);
        assert!(wallet_swap(&gift, "W").is_none());
    }
}

/// `GET /metrics/public`: live users, visitors and engine activity, no personal data.
/// Business figures (traders, volume, fees, revenue) join once trading exists.
async fn metrics_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let p = presence::snapshot();
    let s = state.stats.snapshot();
    let (launches_on_radar, coins_on_discover) = {
        let b = state.board.lock().expect("board lock");
        (b.tokens.len(), b.markets.all().len())
    };
    let smart_wallets = state.leaders.lock().expect("leaders lock").len();
    Json(json!({
        "presence": p,
        "engine": {
            "uptime_secs": state.started.elapsed().as_secs(),
            "launches_detected": s.tokens_detected,
            "trades_decoded": s.trades_decoded,
            "launches_on_radar": launches_on_radar,
            "coins_on_discover": coins_on_discover,
            "smart_wallets": smart_wallets,
            "stream_connected": s.connected,
        },
        "business": { "trading_live": false, "traders": 0, "volume_usd": 0, "fees_usd": 0, "revenue_usd": 0 },
    }))
}

/// `GET /wallet/{address}/balance`: SOL in a wallet, cached 20 seconds per address.
async fn balance_handler(State(state): State<Arc<AppState>>, Path(address): Path<String>) -> Result<Json<serde_json::Value>, StatusCode> {
    use std::sync::Mutex as StdMutex;
    use std::time::{Duration, Instant};
    static CACHE: StdMutex<Option<HashMap<String, (Instant, f64)>>> = StdMutex::new(None);
    if !account::is_solana_address(&address) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some((at, sol)) = CACHE.lock().expect("balance cache").get_or_insert_with(HashMap::new).get(&address) {
        if at.elapsed() < Duration::from_secs(20) {
            return Ok(Json(serde_json::json!({ "sol": sol })));
        }
    }
    let sol = rpc::sol_balance(&state.http, &state.config.helius_rpc_url(), &address).await.ok_or(StatusCode::BAD_GATEWAY)?;
    let mut c = CACHE.lock().expect("balance cache");
    let m = c.get_or_insert_with(HashMap::new);
    if m.len() > 10_000 {
        m.clear();
    }
    m.insert(address, (Instant::now(), sol));
    Ok(Json(serde_json::json!({ "sol": sol })))
}

/// `GET /wallet/{address}/portfolio`: SOL and every token held, with live prices.
/// Cached 20 seconds per wallet.
async fn portfolio_handler(State(state): State<Arc<AppState>>, Path(address): Path<String>) -> Result<Json<portfolio::Portfolio>, StatusCode> {
    static CACHE: Mutex<Option<HashMap<String, (Instant, portfolio::Portfolio)>>> = Mutex::new(None);
    if !account::is_solana_address(&address) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some((at, p)) = CACHE.lock().expect("portfolio cache").get_or_insert_with(HashMap::new).get(&address) {
        if at.elapsed() < Duration::from_secs(20) {
            return Ok(Json(p.clone()));
        }
    }
    let (sol, das_sol_usd, mut tokens) = portfolio::holdings(&state.http, &state.config.helius_rpc_url(), &address).await.ok_or(StatusCode::BAD_GATEWAY)?;
    portfolio::enrich(&state.http, &mut tokens).await;
    tokens.sort_by(|a, b| b.value_usd.unwrap_or(0.0).total_cmp(&a.value_usd.unwrap_or(0.0)));
    let sol_usd = state.board.lock().expect("board lock").sol_usd.or(das_sol_usd);
    let p = portfolio::Portfolio { wallet: address.clone(), sol, sol_usd, tokens, updated: now_unix() };
    let mut c = CACHE.lock().expect("portfolio cache");
    let m = c.get_or_insert_with(HashMap::new);
    if m.len() > 2_000 {
        m.clear();
    }
    m.insert(address, (Instant::now(), p.clone()));
    Ok(Json(p))
}

/// `GET /wallet/{address}/activity`: the wallet's swaps among its latest 100
/// transactions, newest first. Cached 60 seconds per wallet.
async fn activity_handler(State(state): State<Arc<AppState>>, Path(address): Path<String>) -> Result<Json<Vec<portfolio::Trade>>, StatusCode> {
    static CACHE: Mutex<Option<HashMap<String, (Instant, Vec<portfolio::Trade>)>>> = Mutex::new(None);
    if !account::is_solana_address(&address) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some((at, t)) = CACHE.lock().expect("activity cache").get_or_insert_with(HashMap::new).get(&address) {
        if at.elapsed() < Duration::from_secs(60) {
            return Ok(Json(t.clone()));
        }
    }
    let mut trades = portfolio::history(&state.http, &state.config.helius_api_key, &address).await.ok_or(StatusCode::BAD_GATEWAY)?;
    portfolio::name_trades(&state.http, &mut trades).await;
    trades.sort_by(|a, b| b.time.cmp(&a.time));
    let mut c = CACHE.lock().expect("activity cache");
    let m = c.get_or_insert_with(HashMap::new);
    if m.len() > 2_000 {
        m.clear();
    }
    m.insert(address, (Instant::now(), trades.clone()));
    Ok(Json(trades))
}
