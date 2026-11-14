//! Kixo gateway: the public HTTP/WebSocket entry point for the frontend.
//! Runs the ingest engine in-process: one Helius connection serves all users.
//! Tracked tokens live only in memory (no database), per ADR 0003.

mod account;
mod admin;
mod demo;
mod presence;
mod book;
mod devs;
mod dex;
mod growth;
mod settings;
mod support;
mod jupiter;
mod metadata;
mod news;
mod pools;
mod portfolio;
mod rpc;
mod rpc_router;
mod safe_fetch;
mod sender;
mod platform;
mod ops;
mod marketing;
mod ai_risk;
mod auto_wallet;
mod collector;
mod monitor;
mod tracker;
mod journal;
mod wallet;
mod pumpfun_tx;
mod pumpswap_tx;
mod launch_tx;
mod solana_tx;
mod trade;
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
    /// Our Solana RPC router (rpc_router.rs): which node serves, for /health.
    router: rpc_router::RouterState,
    http: reqwest::Client,
    /// For URLs that come from outside (token logos and metadata): public https hosts only.
    outside: reqwest::Client,
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
    /// SOL balances of smart-money candidates, re-read every few minutes.
    smart_balances: Mutex<HashMap<String, (Instant, f64)>>,
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
    /// Solana is reachable (through Helius or a fallback node).
    helius: bool,
    solana_slot: Option<u64>,
    stream_connected: bool,
    /// Helius itself answers; false while Kixo runs on its fallback nodes.
    primary: bool,
    /// Which Solana node serves now and why others are skipped (rpc_router.rs).
    rpc: serde_json::Value,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Console logs as before, plus every warning and error kept for the admin (monitor.rs).
    monitor::init_tracing();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let config = Config::from_env()?;
    tracing::info!(?config, "starting gateway");

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("monexa-gateway/0.1")
        .build()?;

    // Admin settings and API keys saved on this server (data/), before anything uses them.
    platform::load();

    // Every RPC call goes through our router: Helius first, our fallback nodes behind it.
    let (route, router) = rpc_router::start(&config).await?;
    monexa_common::set_rpc_route(route);

    let (ingest_tx, ingest_rx) = broadcast::channel(8192);
    let (feed, _) = broadcast::channel(1024);
    let stats = Arc::new(IngestStats::default());
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let (tx_queue_tx, tx_queue_rx) = mpsc::unbounded_channel();
    let state = Arc::new(AppState {
        http,
        outside: safe_fetch::client()?,
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
        smart_balances: Mutex::new(HashMap::new()),
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
        router,
    });

    tokio::spawn(monexa_ingest::run_forever(
        config.ws_urls(),
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
    tokio::spawn(monitor::sample_loop(state.clone()));
    // Saves every launch and trade for the AI when COLLECT_DIR is set (collector.rs).
    collector::start(state.clone());
    tokio::spawn(seed_smart(state.clone()));

    let cors = CorsLayer::new()
        .allow_origin(config.allowed_origin.parse::<HeaderValue>()?)
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::PUT, axum::http::Method::DELETE])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderName::from_static("x-admin-token"),
            axum::http::HeaderName::from_static("x-owner-session"),
        ]);

    // Rewards settings and creator applications (admin.rs), with their own state.
    let admin_state = admin::AdminState::load();
    let admin_routes: Router<Arc<AppState>> = Router::new()
        .route("/rewards/config", get(admin::get_rewards))
        .route("/features", get(admin::get_features))
        .route("/admin/features", axum::routing::put(admin::put_features))
        .route("/creator/apply", axum::routing::post(admin::apply_creator))
        .route("/admin/check", get(admin::check_admin))
        .route("/admin/rewards", axum::routing::put(admin::put_rewards))
        .route("/admin/creator-applications", get(admin::list_applications))
        .route("/admin/creator-applications/{id}", axum::routing::post(admin::set_application))
        .with_state(admin_state.clone());

    let acct = account::AccountState::new(state.http.clone(), &config.supabase_url, &config.supabase_anon_key, &config.supabase_service_role_key);
    // Demo trading (demo.rs): virtual balance filled at live market prices.
    let demo_routes: Router<Arc<AppState>> = Router::new()
        .route("/demo/account", get(demo::get_account))
        .route("/demo/order", axum::routing::post(demo::order))
        .route("/demo/reset", axum::routing::post(demo::reset))
        .route("/demo/trades", get(demo::trades))
        .route("/demo/orders", get(demo::list_rules).post(demo::create_rule))
        .route("/demo/orders/{id}/cancel", axum::routing::post(demo::cancel_rule))
        .route("/price", get(demo::prices))
        .with_state(demo::DemoCtx { app: state.clone(), acct: acct.clone() });
    tokio::spawn(demo::watch_rules(demo::DemoCtx { app: state.clone(), acct: acct.clone() }));
    // Accounts: profile sync (account.rs).
    let kixo_sender = sender::Sender::new(state.http.clone(), state.config.helius_rpc_url());
    tokio::spawn(sender::run(kixo_sender.clone()));
    let direct_admin = admin_state.clone();
    let (tracker, outcomes) = tracker::Tracker::new(state.http.clone(), state.config.helius_rpc_url(), kixo_sender.clone(), Box::new(move || direct_admin.kixo_sender()));
    tokio::spawn(tracker::run(tracker.clone()));
    let wallet_ctx = wallet::WalletCtx { app: state.clone(), acct: acct.clone(), admin: admin_state.clone(), sender: kixo_sender.clone(), w: Default::default() };
    let trade_ctx = trade::TradeCtx { app: state.clone(), acct: acct.clone(), admin: admin_state.clone(), t: trade::TradeState::from_env(), sender: kixo_sender, tracker };
    tokio::spawn(trade::outcomes(trade_ctx.clone(), outcomes));
    tokio::spawn(trade::replay_journal(trade_ctx.clone()));
    let trade_routes: Router<Arc<AppState>> = Router::new()
        .route("/trade/config", get(trade::config))
        .route("/trade/quote", axum::routing::post(trade::quote))
        .route("/trade/prepare", axum::routing::post(trade::prepare))
        .route("/trade/send", axum::routing::post(trade::send))
        .route("/trade/status/{sig}", get(trade::status))
        .route("/trade/history", get(trade::history))
        .route("/trade/sender", get(trade::sender_status))
        .with_state(trade_ctx.clone());
    tokio::spawn(trade::warm_loop(trade_ctx));
    let ops_ctx = ops::OpsCtx { acct: acct.clone(), app: state.clone(), admin: admin_state.clone() };
    let ops_routes: Router<Arc<AppState>> = Router::new()
        .route("/admin/users", get(ops::users))
        .route("/admin/users/{id}", get(ops::user))
        .route("/admin/users/{id}/pause", axum::routing::post(ops::pause))
        .route("/admin/earnings", get(ops::earnings))
        .route("/admin/export/{kind}", get(ops::export))
        .with_state(ops_ctx.clone());
    let marketing_ctx = marketing::MarketingCtx { acct: acct.clone(), ops: ops_ctx.clone() };
    let marketing_routes: Router<Arc<AppState>> = Router::new()
        .route("/marketing", get(marketing::public))
        .route("/track/visit", axum::routing::post(marketing::visit))
        .route("/track/signup", axum::routing::post(marketing::signup))
        .route("/promo", get(marketing::promo_me))
        .route("/promo/redeem", axum::routing::post(marketing::redeem))
        .route("/admin/marketing", get(marketing::admin_get).put(marketing::admin_put))
        .route("/admin/campaigns", axum::routing::post(marketing::campaign_add))
        .route("/admin/campaigns/{code}", axum::routing::delete(marketing::campaign_delete))
        .route("/admin/promos", axum::routing::post(marketing::promo_add))
        .route("/admin/promos/{code}/end", axum::routing::post(marketing::promo_end))
        .with_state(marketing_ctx);
    let platform_ctx = platform::PlatformCtx { acct: acct.clone(), router: state.router.clone(), app: state.clone() };
    let platform_routes: Router<Arc<AppState>> = Router::new()
        .route("/platform", get(platform::public))
        .route("/admin/platform", get(platform::admin_get).put(platform::admin_put))
        .route("/admin/secrets", axum::routing::put(platform::secret_put))
        .route("/admin/owner/code", axum::routing::post(platform::owner_code))
        .route("/admin/owner/verify", axum::routing::post(platform::owner_verify))
        .route("/admin/audit", get(platform::audit_list))
        .with_state(platform_ctx);
    let wallet_routes: Router<Arc<AppState>> = Router::new()
        .route("/kixo-wallet", get(wallet::me).post(wallet::create))
        .route("/kixo-wallet/code", axum::routing::post(wallet::send_code))
        .route("/kixo-wallet/locked", axum::routing::post(wallet::locked))
        .route("/kixo-wallet/two-fa", axum::routing::post(wallet::two_fa))
        .route("/kixo-wallet/withdraw", axum::routing::post(wallet::withdraw))
        .route("/kixo-wallet/withdraw/send", axum::routing::post(wallet::transfer_send))
        .route("/kixo-wallet/deposit", axum::routing::post(wallet::deposit))
        .route("/kixo-wallet/deposit/send", axum::routing::post(wallet::transfer_send))
        .route("/kixo-wallet/status/{sig}", get(wallet::status))
        .route("/auto-wallet", get(auto_wallet::me).post(auto_wallet::create).put(auto_wallet::update))
        .route("/auto-wallet/withdraw", axum::routing::post(auto_wallet::withdraw))
        .with_state(wallet_ctx);

    let news_ctx = news::NewsCtx { app: state.clone(), admin: admin_state.clone(), news: news::News::stored("data/news.json") };
    tokio::spawn(news::run(news_ctx.clone()));
    let ai_ctx = ai_risk::AiCtx { app: state.clone(), admin: admin_state.clone() };
    tokio::spawn(ai_risk::run(ai_ctx.clone()));
    let ai_routes: Router<Arc<AppState>> = Router::new().route("/ai/risk", get(ai_risk::get_risk)).with_state(ai_ctx);
    let news_routes: Router<Arc<AppState>> = Router::new()
        .route("/news", get(news::list))
        .route("/ws/news", get(news::ws))
        .with_state(news_ctx);
    let support_ctx = support::SupportCtx { app: state.clone(), acct: acct.clone(), admin: admin_state.clone(), live: support::Live::new() };
    tokio::spawn(support::presence_loop(support_ctx.clone()));
    let support_routes: Router<Arc<AppState>> = Router::new()
        .route("/support/diagnose", axum::routing::post(support::diagnose))
        .route("/support/tickets", get(support::list).post(support::create))
        .route("/support/unread", get(support::unread))
        .route("/support/tickets/{id}", get(support::get_ticket))
        .route("/support/tickets/{id}/messages", axum::routing::post(support::reply))
        .route("/admin/support/tickets", get(support::admin_list))
        .route("/admin/support/tickets/{id}", get(support::admin_get))
        .route("/admin/support/tickets/{id}/messages", axum::routing::post(support::admin_reply))
        .route("/admin/support/tickets/{id}/status", axum::routing::post(support::admin_update))
        .route("/admin/support/tickets/{id}/claim", axum::routing::post(support::admin_claim))
        .route("/admin/support/presence", get(support::admin_presence).post(support::admin_set_presence))
        .route("/support/live", get(support::live_current))
        .route("/support/presence", get(support::presence))
        .route("/support/ws", get(support::ws))
        .with_state(support_ctx.clone());

    let activity_routes: Router<Arc<AppState>> = Router::new()
        .route("/wallet/{address}/activity", get(activity_handler))
        .with_state(ActivityCtx { app: state.clone(), acct: acct.clone() });

    let account_routes: Router<Arc<AppState>> = Router::new()
        .route("/account/sync", axum::routing::post(account::sync))
        .route("/account/me", get(account::me_handler))
        .route("/account/referral", get(growth::referral).post(growth::claim))
        .route("/account/settings", get(settings::get).put(settings::put))
        .route("/account/export", get(settings::export))
        .route("/account/delete", axum::routing::post(settings::delete))
        .route("/demo/leaderboard", get(growth::leaderboard))
        .with_state(acct);

    let app = Router::new()
        .route("/health", get(health))
        .route("/ops/client-error", axum::routing::post(monitor::client_error))
        .route("/admin/system", get(monitor::admin_system))
        .route("/stats", get(stats_handler))
        .route("/metrics/public", get(metrics_handler))
        .route("/ws/new-tokens", get(ws_new_tokens))
        .route("/token/{mint}", get(token_handler))
        .route("/token/{mint}/wallets", get(wallets_handler))
        .route("/token/{mint}/labels", get(labels_handler))
        .route("/token/{mint}/dex", get(dex_handler))
        .route("/img", get(img_proxy))
        .route("/smart-money", get(smart_handler))
        .route("/competition/onchain", get(onchain_top_handler))
        .route("/wallet/{address}/kixo-pnl", get(kixo_pnl_handler))
        .route("/wallet/{address}/balance", get(balance_handler))
        .route("/address/{address}/kind", get(address_kind_handler))
        .route("/wallet/{address}/portfolio", get(portfolio_handler))
        .route("/wallet/{address}/live", get(live_trades_handler))
        .route("/alerts/status", get(alerts_status))
        .route("/ws/wallets", get(ws_wallets))
        .route("/ws/token/{mint}", get(ws_token))
        .merge(admin_routes)
        .merge(account_routes)
        .merge(demo_routes)
        .merge(trade_routes)
        .merge(wallet_routes)
        .merge(platform_routes)
        .merge(ops_routes)
        .merge(marketing_routes)
        .merge(activity_routes)
        .merge(support_routes)
        .merge(news_routes)
        .merge(ai_routes)
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
                collector::coin(&token);
                ai_risk::coin(&token);
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
                collector::coin(&token);
                ai_risk::coin(&token);
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
                // Saved before the coin leaves memory: how its life went (collector.rs).
                collector::outcome(&state, &mints);
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
                slot,
            } => {
                collector::trade(&signature, &trade, slot);
                ai_risk::trade(&trade, slot);
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
                    .apply_in_slot(&signature, &trade, slot);
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
        let Some(meta) = metadata::fetch(&state.outside, &token.uri).await else {
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
        primary: monexa_common::primary_up(),
        rpc: rpc_router::status(&state.router),
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

/// Kixo shows Solana memecoins only: our own pump.fun launches, or a token the
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

/// `GET /token/{mint}/labels`: the coin's labelled wallets (dev, sniper, bundler, whale,
/// plus "smart" for Smart Money leaders), and the smart-money wallets on their own so any
/// page can mark them without a coin.
async fn labels_handler(State(state): State<Arc<AppState>>, Path(mint): Path<String>) -> Json<serde_json::Value> {
    let mut labels = state.books.lock().expect("books lock").labels(&mint).unwrap_or_default();
    let smart: Vec<String> = state.leaders.lock().expect("leaders lock").iter().map(|l| l.wallet.clone()).collect();
    for w in &smart {
        if let Some(l) = labels.get_mut(w) {
            l.push("smart");
        }
    }
    Json(json!({ "labels": labels, "smart": smart }))
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
    let needs_pool = graduated || !known;
    // The pool's 1 minute history loads while the pool is being set up, so the first
    // snapshot already has a chart instead of an empty one that fills seconds later.
    let (history, watching) = tokio::join!(
        async {
            if needs_pool {
                tokio::time::timeout(Duration::from_secs(4), dex::history(&state.http, &state.dex, &mint)).await.ok().flatten()
            } else {
                None
            }
        },
        async {
            if needs_pool && is_memecoin(&state, &mint).await {
                watch_pool(&state, &mint).await
            } else {
                false
            }
        }
    );
    if let Some(h) = history {
        seed_candles(&state, &mint, &h);
    }
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
    // Candles (the chart) and recent trades load side by side: the chart must not wait
    // for the slower, rate paced transaction backfill.
    let (st, m) = (state.clone(), mint.to_string());
    tokio::spawn(async move { backfill_candles(st, m).await });
    tokio::spawn(async move {
        // Recent trades from the chain, read by the universal decoder.
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
    });
    true
}

/// Longer candle history from the indexer, retried if it is rate limited.
async fn backfill_candles(state: Arc<AppState>, mint: String) {
        for attempt in 0..5 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
            let Some(h) = dex::history(&state.http, &state.dex, &mint).await else {
                continue;
            };
            if seed_candles(&state, &mint, &h) {
                let _ = state.refresh.send(mint.clone());
                return;
            }
        }
}

/// Puts a pool's USD price history in front of a book's candles (market cap in SOL).
/// Only candles older than the book's first are added, so running it twice is harmless.
fn seed_candles(state: &AppState, mint: &str, h: &dex::DexHistory) -> bool {
    let Some(sol_usd) = state.board.lock().expect("board lock").sol_usd else {
        return false;
    };
    if h.candles.is_empty() {
        return false;
    }
    let mut books = state.books.lock().expect("books lock");
    let Some(supply) = books.supply(mint) else {
        return false;
    };
    let k = supply / sol_usd;
    let candles = h
        .candles
        .iter()
        .map(|c| book::Candle { t: c.t, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k, v: c.v / sol_usd })
        .collect();
    books.backfill_candles(mint, candles);
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
            if bot {
                continue;
            }
            // A wallet that sends its profit away right after (no SOL left) is a burner:
            // nothing to follow there.
            let cached = state.smart_balances.lock().expect("balance lock").get(&l.wallet).filter(|(at, _)| at.elapsed() < SMART_BALANCE_TTL).map(|(_, b)| *b);
            let sol = match cached {
                Some(b) => b,
                None => {
                    let Some(b) = rpc::sol_balance(&state.http, &state.config.helius_rpc_url(), &l.wallet).await else { continue };
                    let mut m = state.smart_balances.lock().expect("balance lock");
                    if m.len() > 10_000 {
                        m.retain(|_, (at, _)| at.elapsed() < SMART_BALANCE_TTL);
                    }
                    m.insert(l.wallet.clone(), (Instant::now(), b));
                    b
                }
            };
            if sol < SMART_MIN_SOL_BALANCE {
                continue;
            }
            leaders.push(devs::Leader { sol_balance: Some((sol * 1000.0).round() / 1000.0), ..l });
        }
        let leaders = drop_clones(leaders);
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
    // How long the records reach back (they survive restarts), not this run's uptime.
    let now = now_unix();
    let oldest = state.smart.lock().expect("smart lock").oldest().unwrap_or(now);
    let tracking = (now - oldest).max(state.started.elapsed().as_secs() as i64);
    Json(json!({ "tracking_secs": tracking, "min_copy_coins": devs::MIN_COPY_COINS, "leaders": leaders, "symbols": symbols }))
}

/// `GET /wallet/{address}/kixo-pnl`: the wallet's profit over the last week on the coins
/// our engine read (devs.rs). Instant and costs no RPC; `null` when we saw no sale.
async fn kixo_pnl_handler(State(state): State<Arc<AppState>>, Path(address): Path<String>) -> Result<Json<serde_json::Value>, StatusCode> {
    if !account::is_solana_address(&address) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let r = {
        let books = state.books.lock().expect("books lock");
        let smart = state.smart.lock().expect("smart lock");
        smart.wallet_result(&address, books.all_positions())
    };
    let now = now_unix();
    let since = state.smart.lock().expect("smart lock").oldest().unwrap_or(now).max(now - 7 * 86_400);
    Ok(Json(json!({ "since": since, "result": r })))
}

/// `GET /competition/onchain?window=24h|7d`: Solana memecoin traders ranked by the
/// profit they took on chain, from the trades our engine read (devs.rs). Known bots are
/// left out. Cached a minute.
async fn onchain_top_handler(State(state): State<Arc<AppState>>, Query(q): Query<HashMap<String, String>>) -> Json<serde_json::Value> {
    static CACHE: Mutex<Option<HashMap<String, (Instant, serde_json::Value)>>> = Mutex::new(None);
    let window = if q.get("window").map(String::as_str) == Some("7d") { "7d" } else { "24h" };
    if let Some((at, v)) = CACHE.lock().expect("top cache").get_or_insert_with(HashMap::new).get(window) {
        if at.elapsed() < Duration::from_secs(60) {
            return Json(v.clone());
        }
    }
    let now = now_unix();
    let since = now - if window == "7d" { 7 * 86_400 } else { 86_400 };
    let ranked = {
        let books = state.books.lock().expect("books lock");
        let smart = state.smart.lock().expect("smart lock");
        smart.top_traders(books.all_positions(), since, 80)
    };
    let bots: std::collections::HashSet<String> = state.bot_checks.lock().expect("bot lock").iter().filter(|(_, (_, b))| *b).map(|(w, _)| w.clone()).collect();
    let traders: Vec<devs::TopTrader> = ranked.into_iter().filter(|t| !bots.contains(&t.wallet)).take(50).collect();
    let sol_usd = state.board.lock().expect("board lock").sol_usd;
    let oldest = state.smart.lock().expect("smart lock").oldest().unwrap_or(now);
    let v = json!({ "window": window, "since": since.max(oldest), "now": now, "sol_usd": sol_usd, "traders": traders });
    CACHE.lock().expect("top cache").get_or_insert_with(HashMap::new).insert(window.to_string(), (Instant::now(), v.clone()));
    Json(v)
}

/// Largest image the proxy passes on.
const IMG_MAX_BYTES: usize = 2 * 1024 * 1024;
const IMG_CACHE: usize = 400;
type ImgEntry = (Instant, String, axum::body::Bytes);
static IMGS: std::sync::Mutex<Option<HashMap<String, ImgEntry>>> = std::sync::Mutex::new(None);

#[derive(serde::Deserialize)]
struct ImgQuery {
    u: String,
}

/// Only public https hosts: no IP literals, no localhost or internal names, so the
/// proxy can never be pointed at our own network. The `outside` client re-checks every
/// redirect and refuses domains that resolve to private addresses.
fn proxy_allowed(url: &str) -> bool {
    safe_fetch::allowed_str(url)
}

/// `GET /img?u=<https url>`: a token logo fetched by the gateway, for image hosts that
/// refuse to be shown on other sites. Images only, at most 2 MB, cached a day.
async fn img_proxy(State(state): State<Arc<AppState>>, Query(q): Query<ImgQuery>) -> Response {
    use axum::{http::header, response::IntoResponse};
    if !proxy_allowed(&q.u) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let hit = IMGS.lock().expect("img lock").as_ref().and_then(|m| m.get(&q.u).cloned());
    let (ctype, body) = match hit {
        Some((at, c, b)) if at.elapsed() < Duration::from_secs(86_400) => (c, b),
        _ => {
            // Every failure gives the same answer, so the proxy tells nothing about what
            // is or is not reachable from here.
            let Ok(res) = state.outside.get(&q.u).send().await else {
                return StatusCode::NOT_FOUND.into_response();
            };
            let ctype = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            if !res.status().is_success() || !ctype.starts_with("image/") || ctype.contains("svg") {
                return StatusCode::NOT_FOUND.into_response();
            }
            if res.content_length().is_some_and(|l| l as usize > IMG_MAX_BYTES) {
                return StatusCode::PAYLOAD_TOO_LARGE.into_response();
            }
            let Ok(body) = res.bytes().await else { return StatusCode::BAD_GATEWAY.into_response() };
            if body.len() > IMG_MAX_BYTES {
                return StatusCode::PAYLOAD_TOO_LARGE.into_response();
            }
            let mut cache = IMGS.lock().expect("img lock");
            let map = cache.get_or_insert_with(HashMap::new);
            if map.len() >= IMG_CACHE {
                if let Some(old) = map.iter().min_by_key(|(_, (at, _, _))| *at).map(|(k, _)| k.clone()) {
                    map.remove(&old);
                }
            }
            map.insert(q.u.clone(), (Instant::now(), ctype.clone(), body.clone()));
            (ctype, body)
        }
    };
    (
        [
            (header::CONTENT_TYPE, ctype),
            (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod img_tests {
    use super::proxy_allowed;

    #[test]
    fn proxy_only_reaches_public_https_hosts() {
        assert!(proxy_allowed("https://gmgn.ai/external-res-asia/a.webp"));
        assert!(proxy_allowed("https://ipfs.io/ipfs/Qm123"));
        assert!(!proxy_allowed("http://gmgn.ai/a.png"));
        assert!(!proxy_allowed("https://127.0.0.1/a.png"));
        assert!(!proxy_allowed("https://169.254.169.254/latest"));
        assert!(!proxy_allowed("https://localhost/a.png"));
        assert!(!proxy_allowed("https://evil.com:8080/a.png"));
        assert!(!proxy_allowed("https://user@10.0.0.1/a.png"));
        assert!(!proxy_allowed("https://[::1]/a.png"));
        assert!(!proxy_allowed("https://printer.local/a.png"));
        assert!(!proxy_allowed("file:///etc/passwd"));
    }
}

/// `GET /alerts/status`: which outside delivery channels are set up on this gateway.
/// Telegram needs Kixo's bot token in the environment; Discord uses each user's own
/// webhook, delivered by the gateway once alerts are stored per account.
async fn alerts_status() -> Json<serde_json::Value> {
    let telegram = monexa_common::secret("TELEGRAM_BOT_TOKEN").is_some();
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

/// Smart wallets must hold at least this much SOL now.
const SMART_MIN_SOL_BALANCE: f64 = 0.5;
const SMART_BALANCE_TTL: Duration = Duration::from_secs(5 * 60);

/// One operator often runs several wallets that trade the same coins at the same
/// moments; they then show identical records. Keep the most profitable of each group.
fn drop_clones(mut leaders: Vec<devs::Leader>) -> Vec<devs::Leader> {
    leaders.sort_by(|a, b| b.realized_sol.total_cmp(&a.realized_sol));
    let mut seen = std::collections::HashSet::new();
    leaders.retain(|l| seen.insert((l.coins, l.wins, l.avg_hold_secs, l.last_trade / 60)));
    leaders
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

/// `GET /address/{address}/kind`: what an address is, so the Wallet Tracker can tell a
/// pasted coin address from a wallet. "coin" (a token mint, with what the board knows of
/// it), "token_account", "program" or "wallet" (anything else, including a new empty one).
/// Cached 10 minutes; an address's kind does not change.
async fn address_kind_handler(State(state): State<Arc<AppState>>, Path(address): Path<String>) -> Result<Json<serde_json::Value>, StatusCode> {
    static CACHE: Mutex<Option<HashMap<String, (Instant, &'static str)>>> = Mutex::new(None);
    const TOKEN_PROGRAMS: [&str; 2] = [pumpfun_tx::TOKEN, pumpfun_tx::TOKEN_2022];
    if !account::is_solana_address(&address) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let cached = CACHE.lock().expect("kind cache").get_or_insert_with(HashMap::new).get(&address).filter(|(at, _)| at.elapsed() < Duration::from_secs(600)).map(|(_, k)| *k);
    let kind = match cached {
        Some(k) => k,
        None => {
            let url = state.config.helius_rpc_url();
            // A failed lookup is an error, never a guess: the page then shows it as a wallet
            // without caching anything.
            let found = rpc::account_kind(&state.http, &url, &address).await.ok_or(StatusCode::BAD_GATEWAY)?;
            let kind = match found {
                Some((owner, parsed, _)) if TOKEN_PROGRAMS.contains(&owner.as_str()) => {
                    if parsed == "mint" { "coin" } else { "token_account" }
                }
                Some((owner, _, executable)) if executable || owner.starts_with("BPFLoader") => "program",
                _ => "wallet",
            };
            let mut c = CACHE.lock().expect("kind cache");
            let m = c.get_or_insert_with(HashMap::new);
            if m.len() > 10_000 {
                m.clear();
            }
            m.insert(address.clone(), (Instant::now(), kind));
            kind
        }
    };
    let mut v = serde_json::json!({ "kind": kind });
    if kind == "coin" {
        let board = state.board.lock().expect("board lock");
        if let Some(m) = board.markets.get(&address) {
            v["symbol"] = m.symbol.clone().into();
            v["name"] = m.name.clone().into();
            v["image"] = serde_json::json!(m.image);
            v["mc_usd"] = serde_json::json!(m.mc_usd);
        } else if let Some(t) = board.tokens.get(&address) {
            v["symbol"] = t.token.symbol.clone().into();
            v["name"] = t.token.name.clone().into();
            v["image"] = serde_json::json!(t.meta.as_ref().and_then(|x| x.image.clone()));
            v["mc_usd"] = serde_json::json!(t.market.as_ref().and_then(|x| x.mc_usd));
        }
    }
    Ok(Json(v))
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
    fill_from_board(&state, &mut tokens);
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

/// Coins Jupiter does not price yet (fresh launchpad coins) get their price, name and
/// image from Kixo's own live feed, so a trader's newest buys are not hidden as dust.
fn fill_from_board(state: &AppState, tokens: &mut [portfolio::Holding]) {
    let b = state.board.lock().expect("board lock");
    for h in tokens.iter_mut() {
        if let Some(ft) = b.tokens.get(&h.mint) {
            if h.symbol.is_empty() {
                h.symbol = ft.token.symbol.clone();
            }
            if h.name.is_empty() {
                h.name = ft.token.name.clone();
            }
            if h.image.is_none() {
                h.image = ft.meta.as_ref().and_then(|m| m.image.clone());
            }
            if let Some(m) = &ft.market {
                if h.price_usd.is_none() {
                    h.price_usd = m.price_usd.or_else(|| b.sol_usd.map(|u| m.price_sol * u)).filter(|p| *p > 0.0);
                }
                if h.mcap.is_none() {
                    h.mcap = m.mc_usd;
                }
                if h.change_24h.is_none() {
                    h.change_24h = m.change_1h_pct;
                }
            }
        } else if let Some(m) = b.markets.get(&h.mint) {
            if h.symbol.is_empty() {
                h.symbol = m.symbol.clone();
            }
            if h.name.is_empty() {
                h.name = m.name.clone();
            }
            if h.image.is_none() {
                h.image = m.image.clone();
            }
            if h.price_usd.is_none() {
                h.price_usd = m.price_usd;
            }
            if h.change_24h.is_none() {
                h.change_24h = m.change_24h_pct;
            }
        }
        if h.value_usd.is_none() {
            h.value_usd = h.price_usd.map(|p| p * h.amount);
        }
    }
}

/// `GET /wallet/{address}/live`: the wallet's trades that Kixo saw live on the coins it
/// follows (newest first, up to 200). Instant, and costs no RPC: the Wallet Tracker shows
/// these at once while the full on-chain history loads.
async fn live_trades_handler(State(state): State<Arc<AppState>>, Path(address): Path<String>) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    if !account::is_solana_address(&address) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let set: std::collections::HashSet<String> = [address].into_iter().collect();
    let rows = state.books.lock().expect("books lock").trades_by(&set, 200);
    let b = state.board.lock().expect("board lock");
    let out = rows
        .into_iter()
        .map(|(mint, t)| {
            let (symbol, image) = b
                .tokens
                .get(&mint)
                .map(|f| (f.token.symbol.clone(), f.meta.as_ref().and_then(|m| m.image.clone())))
                .or_else(|| b.markets.get(&mint).map(|m| (m.symbol.clone(), m.image.clone())))
                .unwrap_or_default();
            serde_json::json!({ "mint": mint, "buy": t.is_buy, "sol": t.sol, "tokens": t.tokens, "time": t.ts, "sig": t.signature, "symbol": symbol, "image": image, "price_sol": t.price_sol })
        })
        .collect();
    Ok(Json(out))
}

/// `GET /wallet/{address}/activity`: the wallet's swaps among its latest 100
/// transactions, newest first. Cached 60 seconds per wallet.
/// How far back a portfolio's history reaches.
const HISTORY_DAYS: i64 = 30;
/// History pages read when a wallet is first opened (up to 100 transactions each), and
/// on later visits until the newest stored swap is reached.
const BACKFILL_PAGES: usize = 6;
const UPDATE_PAGES: usize = 3;
/// Older pages read per visit until the stored history reaches 30 days back.
const OLDER_PAGES: usize = 2;
/// First-time backfills allowed per hour across all wallets, so nobody can drain the
/// history API's credits by opening thousands of wallets.
const BACKFILLS_PER_HOUR: usize = 40;

#[derive(Clone)]
struct ActivityCtx {
    app: Arc<AppState>,
    acct: Arc<account::AccountState>,
}

fn backfill_allowed() -> bool {
    static RECENT: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
    let mut r = RECENT.lock().expect("backfill lock");
    r.retain(|t| t.elapsed() < Duration::from_secs(3600));
    if r.len() >= BACKFILLS_PER_HOUR {
        return false;
    }
    r.push(Instant::now());
    true
}

fn trade_of_row(r: &serde_json::Value) -> Option<portfolio::Trade> {
    let num = |v: &serde_json::Value| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()));
    let ts = r["ts"].as_str()?;
    Some(portfolio::Trade {
        mint: r["mint"].as_str()?.to_string(),
        buy: r["buy"].as_bool()?,
        sol: num(&r["sol"])?,
        raw: match &r["raw"] {
            serde_json::Value::String(s) => s.split('.').next().unwrap_or("0").to_string(),
            v => v.to_string().split('.').next().unwrap_or("0").to_string(),
        },
        time: iso_secs(ts)?,
        sig: r["signature"].as_str()?.to_string(),
        symbol: r["symbol"].as_str().unwrap_or("").to_string(),
    })
}

/// "2026-11-07T10:20:30+00:00" (as Postgres returns it) to unix seconds.
fn iso_secs(s: &str) -> Option<i64> {
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, dd) = (d.next()??, d.next()??, d.next()??);
    let t: Vec<i64> = time.get(..8)?.split(':').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + dd - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146_097 + doe - 719_468) * 86_400 + t[0] * 3600 + t[1] * 60 + t[2])
}

/// `GET /wallet/{address}/activity`: the wallet's swaps over the last 30 days. Swaps are
/// stored as they are found, so the history keeps growing past the 100 transactions the
/// history API returns at a time. Falls back to that single page if the table is missing.
async fn activity_handler(State(c): State<ActivityCtx>, Path(address): Path<String>) -> Result<Json<Vec<portfolio::Trade>>, StatusCode> {
    static CACHE: Mutex<Option<HashMap<String, (Instant, Vec<portfolio::Trade>)>>> = Mutex::new(None);
    if !account::is_solana_address(&address) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some((at, t)) = CACHE.lock().expect("activity cache").get_or_insert_with(HashMap::new).get(&address) {
        if at.elapsed() < Duration::from_secs(60) {
            return Ok(Json(t.clone()));
        }
    }
    let state = &c.app;
    let key = &monexa_common::helius_key(&state.config.helius_api_key);
    let since = now_unix() - HISTORY_DAYS * 86_400;
    let stored = c
        .acct
        .rest(reqwest::Method::GET, &format!("wallet_trades?wallet=eq.{address}&ts=gte.{}&select=*&order=ts.desc&limit=5000", account::chrono_iso(since)), None)
        .await
        .ok()
        .and_then(|v| v.as_array().cloned());

    let mut trades: Vec<portfolio::Trade> = match stored {
        // Table missing (migration not applied): the latest page only, as before.
        None => portfolio::history(&state.http, key, &address).await.ok_or(StatusCode::BAD_GATEWAY)?,
        Some(rows) => {
            let mut have: Vec<portfolio::Trade> = rows.iter().filter_map(trade_of_row).collect();
            let known: std::collections::HashSet<String> = have.iter().map(|t| t.sig.clone()).collect();
            let first_visit = have.is_empty();
            // Without Helius every page costs dozens of paced calls on the fallback node.
            let pages = if !monexa_common::primary_up() { 1 } else if first_visit && backfill_allowed() { BACKFILL_PAGES } else { UPDATE_PAGES };
            let mut fresh: Vec<portfolio::Trade> = Vec::new();
            let mut before: Option<String> = None;
            for _ in 0..pages {
                let Some(page) = portfolio::history_page(&state.http, key, &address, before.as_deref()).await else { break };
                let reached_known = page.signatures.iter().any(|s| known.contains(s));
                fresh.extend(page.trades.into_iter().filter(|t| !known.contains(&t.sig)));
                // Stop at the stored part, at 30 days back, or at the end of the history.
                if reached_known || !page.full || page.oldest.is_some_and(|t| t < since) {
                    break;
                }
                before = page.signatures.last().cloned();
            }
            // Older side: a very active wallet needs more than one visit to reach 30 days
            // back. Each visit reads a little further back from the oldest stored swap.
            if !first_visit && monexa_common::primary_up() {
                if let Some(oldest) = have.iter().min_by_key(|t| t.time).filter(|t| t.time > since + 3600) {
                    let mut before = Some(oldest.sig.clone());
                    for _ in 0..OLDER_PAGES {
                        let Some(page) = portfolio::history_page(&state.http, key, &address, before.as_deref()).await else { break };
                        fresh.extend(page.trades.into_iter().filter(|t| !known.contains(&t.sig) && t.time >= since));
                        if !page.full || page.oldest.is_some_and(|t| t < since) {
                            break;
                        }
                        before = page.signatures.last().cloned();
                    }
                }
            }
            if !fresh.is_empty() {
                portfolio::name_trades(&state.http, &mut fresh).await;
                let rows: Vec<serde_json::Value> = fresh
                    .iter()
                    .map(|t| json!({ "wallet": address, "signature": t.sig, "ts": account::chrono_iso(t.time), "mint": t.mint, "symbol": t.symbol, "buy": t.buy, "sol": t.sol, "raw": t.raw }))
                    .collect();
                if let Err(e) = c.acct.rest(reqwest::Method::POST, "wallet_trades?on_conflict=wallet,signature", Some(serde_json::Value::Array(rows))).await {
                    tracing::warn!(error = %e.1, "could not store wallet history");
                }
            }
            have.extend(fresh);
            have
        }
    };
    trades.retain(|t| t.time >= since);
    // Stored rows carry their tickers; name only what is still unnamed.
    if trades.iter().any(|t| t.symbol.is_empty()) {
        let mut unnamed: Vec<portfolio::Trade> = trades.iter().filter(|t| t.symbol.is_empty()).cloned().collect();
        portfolio::name_trades(&state.http, &mut unnamed).await;
        let names: HashMap<String, String> = unnamed.into_iter().filter(|t| !t.symbol.is_empty()).map(|t| (t.mint, t.symbol)).collect();
        for t in trades.iter_mut().filter(|t| t.symbol.is_empty()) {
            if let Some(n) = names.get(&t.mint) {
                t.symbol = n.clone();
            }
        }
    }
    trades.sort_by(|a, b| b.time.cmp(&a.time));
    trades.dedup_by(|a, b| a.sig == b.sig);
    let mut cache = CACHE.lock().expect("activity cache");
    let m = cache.get_or_insert_with(HashMap::new);
    if m.len() > 2_000 {
        m.clear();
    }
    m.insert(address, (Instant::now(), trades.clone()));
    Ok(Json(trades))
}

#[cfg(test)]
mod history_tests {
    use super::*;

    #[test]
    fn stored_rows_read_back_as_trades() {
        assert_eq!(iso_secs("1970-01-01T00:00:00+00:00"), Some(0));
        assert_eq!(iso_secs("2026-11-02T00:00:00+00:00"), Some(1_793_577_600));
        let row = json!({ "mint": "M", "buy": true, "sol": "0.25", "raw": "123456.0", "ts": "2026-11-07T10:20:30+00:00", "signature": "S", "symbol": "PNUT" });
        let t = trade_of_row(&row).unwrap();
        assert_eq!((t.mint.as_str(), t.buy, t.sol, t.raw.as_str(), t.sig.as_str()), ("M", true, 0.25, "123456", "S"));
        assert_eq!(t.time, iso_secs("2026-11-07T10:20:30+00:00").unwrap());
        assert_eq!(account::chrono_iso(t.time), "2026-11-07T10:20:30Z");
    }
}
