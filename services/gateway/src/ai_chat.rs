//! Ask Kixo AI with a language model: `POST /ai/chat`.
//!
//! The browser never holds a model key. The gateway adds Kixo's live data (the coin asked
//! about, the AI's current Good odds and Danger coins) to a system prompt that keeps the
//! model on Solana, crypto and Kixo, and asks the free providers in turn: Groq (fastest),
//! Gemini, OpenRouter (each only when its key is in `.env`). A provider that is rate limited or
//! down rests for a minute and the next one answers. When none can, the reply says
//! `fallback` and the browser answers from Kixo's own data (lib/ai-chat.ts), so the chat
//! never stops.
//!
//! Guards: a message that looks like a seed phrase or private key is refused here and
//! never sent anywhere; per-visitor and daily limits keep the free quotas for everyone;
//! the admin switch "ai_chat" turns the model off (the built-in answers stay).

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

const PER_VISITOR: usize = 20;
const PER_VISITOR_WINDOW: Duration = Duration::from_secs(600);
const MAX_MESSAGE: usize = 1500;
const MAX_HISTORY: usize = 6;
const REST_AFTER_LIMIT: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct ChatCtx {
    pub app: Arc<crate::AppState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub http: reqwest::Client,
    /// The news engine, for what is being said about a coin (Kixo Agent).
    pub news: Arc<crate::news::News>,
}

struct Provider {
    name: &'static str,
    url: &'static str,
    key: String,
    model: String,
    /// Keeps "thinking" models short, for a quick chat answer.
    effort: Option<&'static str>,
}

fn provider(name: &'static str, url: &'static str, key_var: &str, model_var: &str, default_model: &str, effort: Option<&'static str>) -> Option<Provider> {
    let key = std::env::var(key_var).ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty())?;
    let model = std::env::var(model_var).ok().map(|m| m.trim().to_string()).filter(|m| !m.is_empty()).unwrap_or_else(|| default_model.to_string());
    Some(Provider { name, url, key, model, effort })
}

/// The free providers with a key in `.env`, fastest first (tested 2026-11-15: Groq about
/// 1 s, OpenRouter's Nemotron about 2 s, Gemini Flash about 7 s). All speak the OpenAI
/// chat format. Models change often: override with GROQ_MODEL, GEMINI_MODEL,
/// OPENROUTER_MODEL in `.env`.
fn providers() -> Vec<Provider> {
    let local = (std::env::var("KIXO_BRAIN").ok().as_deref() != Some("off")).then(|| Provider {
        name: "kixo-brain",
        url: LOCAL_BRAIN,
        key: "local".into(),
        model: "kixo-brain".into(),
        effort: None,
    });
    local.into_iter().chain([
        provider("groq", "https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", "GROQ_MODEL", "openai/gpt-oss-120b", Some("low")),
        // Each Groq model has its own free limit (8,000 tokens a minute, about two answers
        // with live data), so two more models on the same key triple what Groq takes
        // before the slower providers are needed (checked 2026-11-21, all under 1 s).
        provider("groq-20b", "https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", "GROQ_MODEL_2", "openai/gpt-oss-20b", Some("low")),
        provider("groq-qwen", "https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", "GROQ_MODEL_3", "qwen/qwen3.8-27b", Some("none")),
        provider("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-3.5-flash", Some("none")),
        provider("openrouter", "https://openrouter.ai/api/v1/chat/completions", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free", None),
    ]
    .into_iter()
    .flatten())
    .collect()
}

/// Kixo's own language model on this machine (scripts/kixo-start.cmd starts llama.cpp's
/// server with an open model on the GPU), in the same chat format as the others.
const LOCAL_BRAIN: &str = "http://127.0.0.1:8092/v1/chat/completions";

/// One answer from the first free provider that gives one (for background jobs such as
/// turning a strategy write-up into rules); None when all are busy or none is set up.
pub async fn complete(http: &reqwest::Client, system: &str, user: &str, max_tokens: u32) -> Option<String> {
    for p in providers() {
        let mut req = json!({
            "model": p.model,
            "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }],
            "max_tokens": max_tokens,
            "temperature": 0.1,
        });
        if let Some(e) = p.effort {
            req["reasoning_effort"] = json!(e);
        }
        let Ok(r) = http.post(p.url).bearer_auth(&p.key).timeout(Duration::from_secs(60)).json(&req).send().await else { continue };
        if !r.status().is_success() {
            tracing::warn!(provider = p.name, status = r.status().as_u16(), "LLM job: provider refused");
            continue;
        }
        if let Some(text) = r.json::<Value>().await.ok().and_then(|v| v["choices"][0]["message"]["content"].as_str().map(|t| t.trim().to_string())).filter(|t| !t.is_empty()) {
            return Some(text);
        }
    }
    None
}

#[derive(Default)]
struct Limits {
    visitors: HashMap<IpAddr, VecDeque<Instant>>,
    day: (u64, u32),
    resting: HashMap<&'static str, Instant>,
}

static LIMITS: OnceLock<Mutex<Limits>> = OnceLock::new();
fn limits() -> &'static Mutex<Limits> {
    LIMITS.get_or_init(|| Mutex::new(Limits::default()))
}

fn daily_max() -> u32 {
    std::env::var("AI_CHAT_DAILY_MAX").ok().and_then(|v| v.trim().parse().ok()).unwrap_or(1500)
}

/// Whether this visitor may ask the model now (and counts the question).
fn allow(ip: IpAddr) -> Result<(), &'static str> {
    let mut l = limits().lock().expect("chat limits lock");
    let today = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400);
    if l.day.0 != today {
        l.day = (today, 0);
    }
    if l.day.1 >= daily_max() {
        return Err("daily");
    }
    let q = l.visitors.entry(ip).or_default();
    while q.front().is_some_and(|t| t.elapsed() > PER_VISITOR_WINDOW) {
        q.pop_front();
    }
    if q.len() >= PER_VISITOR {
        return Err("visitor");
    }
    q.push_back(Instant::now());
    l.day.1 += 1;
    if l.visitors.len() > 50_000 {
        l.visitors.retain(|_, q| q.back().is_some_and(|t| t.elapsed() < PER_VISITOR_WINDOW));
    }
    Ok(())
}

const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn is_base58(w: &str) -> bool {
    w.chars().all(|c| BASE58.contains(c))
}

/// A seed phrase (12 to 24 plain lowercase words), a private key (a long base58 string) or
/// a key file (a long list of numbers). Such a message is never sent to a provider.
pub fn looks_secret(msg: &str) -> bool {
    let words: Vec<&str> = msg.split_whitespace().collect();
    let plain = words.iter().all(|w| (3..=8).contains(&w.len()) && w.chars().all(|c| c.is_ascii_lowercase()));
    if plain && [12, 15, 18, 21, 24].contains(&words.len()) {
        return true;
    }
    if msg.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| (80..=90).contains(&w.len()) && is_base58(w)) {
        return true;
    }
    msg.matches(',').count() >= 31 && msg.chars().filter(|c| c.is_ascii_digit() || *c == ',' || c.is_whitespace() || *c == '[' || *c == ']').count() * 10 >= msg.len() * 9
}

fn verdict(dump: f64, pump: f64) -> &'static str {
    if dump >= 0.4 {
        "Danger"
    } else if dump >= 0.2 {
        "Careful"
    } else if pump >= 0.15 {
        "Good odds"
    } else {
        "Calm"
    }
}

/// The coin a text names: an address, or a $SYMBOL Kixo has seen.
fn coin_in(board: &crate::Board, text: &str) -> Option<String> {
    if let Some(m) = text.split(|c: char| !c.is_ascii_alphanumeric()).find(|w| (32..=44).contains(&w.len()) && is_base58(w)) {
        return Some(m.to_string());
    }
    let sym = text.split_whitespace().find_map(|w| w.strip_prefix('$')).map(|s| s.trim_matches(|c: char| !c.is_ascii_alphanumeric()).to_lowercase()).filter(|s| !s.is_empty())?;
    board.tokens.values().filter(|t| t.token.symbol.to_lowercase() == sym).max_by_key(|t| t.token.timestamp).map(|t| t.token.mint.clone())
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn short_addr(a: &str) -> String {
    if a.len() > 10 {
        format!("{}…{}", &a[..4], &a[a.len() - 4..])
    } else {
        a.to_string()
    }
}

/// Holders, the dev's position, bundlers and snipers of a coin, from Kixo's own book of
/// its trades (only coins Kixo watched from launch). Balances come from trades, so
/// transfers are not seen.
fn holders_of(ctx: &ChatCtx, mint: &str) -> Option<Value> {
    let books = ctx.app.books.lock().expect("books lock");
    let w = books.wallets(mint, None)?;
    let labels = books.labels(mint).unwrap_or_default();
    let all = books.positions_of(mint);
    drop(books);
    let group = |sel: &dyn Fn(&crate::book::Position) -> bool| {
        let g: Vec<_> = all.iter().filter(|p| sel(p)).collect();
        let holding: Vec<_> = g.iter().filter(|p| p.balance > 0.0).collect();
        json!({
            "wallets": g.len(),
            "still_holding": holding.len(),
            "hold_pct_of_supply": round2(holding.iter().map(|p| p.pct).sum::<f64>()),
            "bought_sol": round2(g.iter().map(|p| p.bought_sol).sum::<f64>()),
            "sold_sol": round2(g.iter().map(|p| p.sold_sol).sum::<f64>()),
        })
    };
    let top: Vec<_> = w.holders.iter().take(10).collect();
    Some(json!({
        "holders": w.holder_count,
        "top10_hold_pct": round2(top.iter().map(|p| p.pct).sum::<f64>()),
        "top_holders": top.iter().map(|p| json!({ "wallet": short_addr(&p.wallet), "hold_pct": round2(p.pct), "labels": labels.get(&p.wallet).cloned().unwrap_or_default() })).collect::<Vec<_>>(),
        "dev_position": w.dev.as_ref().map(|d| json!({
            "hold_pct": round2(d.pct), "still_holding": d.balance > 0.0, "bought_sol": round2(d.bought_sol),
            "sold_sol": round2(d.sold_sol), "sells": d.sells, "realized_profit_sol": round2(d.realized_sol),
        })),
        "bundlers": group(&|p| p.bundler),
        "snipers": group(&|p| p.sniper),
        "whales": group(&|p| p.big_buyer),
        "note": "From trades Kixo saw since launch; tokens moved by transfer are not counted.",
    }))
}

/// The dev wallet's SOL and other coins right now (Helius), cached a minute.
async fn dev_wallet(ctx: &ChatCtx, address: &str) -> Value {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Value)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some((at, v)) = cache.lock().expect("dev wallet cache").get(address) {
        if at.elapsed() < Duration::from_secs(60) {
            return v.clone();
        }
    }
    let rpc = ctx.app.config.helius_rpc_url();
    let Ok(Some((sol, das_usd, mut tokens))) = tokio::time::timeout(Duration::from_secs(6), crate::portfolio::holdings(&ctx.http, &rpc, address)).await else {
        return json!({ "address": address, "error": "wallet could not be read right now" });
    };
    let _ = tokio::time::timeout(Duration::from_secs(5), crate::portfolio::enrich(&ctx.http, &mut tokens)).await;
    tokens.sort_by(|a, b| b.value_usd.unwrap_or(0.0).total_cmp(&a.value_usd.unwrap_or(0.0)));
    let sol_usd = ctx.app.board.lock().expect("board lock").sol_usd.or(das_usd);
    let tokens_usd: f64 = tokens.iter().filter_map(|t| t.value_usd).sum();
    let v = json!({
        "address": address,
        "sol_balance": round2(sol),
        "sol_value_usd": sol_usd.map(|p| round2(sol * p)),
        "other_coins_held": tokens.len(),
        "other_coins_value_usd": round2(tokens_usd),
        "biggest_coins": tokens.iter().take(5).map(|t| json!({ "symbol": t.symbol, "value_usd": t.value_usd.map(round2) })).collect::<Vec<_>>(),
    });
    let mut c = cache.lock().expect("dev wallet cache");
    if c.len() > 500 {
        c.clear();
    }
    c.insert(address.to_string(), (Instant::now(), v.clone()));
    v
}

/// Live facts for the prompt: the coin the message (or an earlier message) names, with
/// its holders and the dev wallet, and the AI's current Good odds and Danger coins.
async fn live_data(ctx: &ChatCtx, msg: &str, history: &[Turn]) -> Value {
    let (mut data, dev) = {
        let board = ctx.app.board.lock().expect("board lock");
        let mint = coin_in(&board, msg)
            .or_else(|| history.iter().rev().filter(|t| t.role != "assistant").find_map(|t| coin_in(&board, &t.content)))
            .or_else(|| asks_newest(msg).then(|| newest(&board, 1).into_iter().next()).flatten());
        let dev = mint.as_deref().and_then(|m| board.tokens.get(m)).map(|t| t.token.creator.clone()).filter(|c| !c.is_empty());
        (board_data(&board, mint), dev)
    };
    // Holders from Kixo's own book only for coins it watched from launch: for older coins
    // the book holds just the trades since the gateway started, which would mislead.
    let watched = data["coin_asked_about"].get("on_kixo_radar") != Some(&json!(false));
    if let (true, Some(m)) = (watched, data["coin_asked_about"]["mint"].as_str().map(String::from)) {
        if let Some(h) = holders_of(ctx, &m) {
            data["coin_asked_about"]["wallets"] = h;
        }
        // Bundles (same block) and clusters (wallets funded by one wallet), with shares held.
        data["coin_asked_about"]["groups"] = crate::funders::groups(&ctx.app, &m);
    }
    if let Some(d) = dev {
        data["coin_asked_about"]["dev_wallet_now"] = dev_wallet(ctx, &d).await;
    }
    data
}

/// "the newest coin", "latest launch", "just launched": the question is about the newest launch.
fn asks_newest(msg: &str) -> bool {
    let m = msg.to_lowercase();
    ["newest", "latest", "just launched", "last launch", "most recent", "new coin"].iter().any(|k| m.contains(k))
}

/// The `n` newest launches on the board, newest first.
fn newest(board: &crate::Board, n: usize) -> Vec<String> {
    let mut v: Vec<(&String, i64)> = board.tokens.iter().map(|(m, t)| (m, t.token.timestamp)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v.into_iter().take(n).map(|(m, _)| m.clone()).collect()
}

fn board_data(board: &crate::Board, mint: Option<String>) -> Value {
    let now = crate::now_unix();
    let mut coin = None;
    if let Some(m) = mint {
        let ai = crate::ai_risk::score_of(&m);
        coin = Some(match board.tokens.get(&m) {
            Some(t) => {
                let mk = t.market.as_ref();
                json!({
                    "mint": m,
                    "symbol": t.token.symbol,
                    "name": t.token.name,
                    "launchpad": t.token.launchpad,
                    "age_minutes": (now - t.token.timestamp).max(0) / 60,
                    "market_cap_usd": mk.and_then(|x| x.mc_usd),
                    "holders": mk.map(|x| x.holders),
                    "trades": mk.map(|x| x.trades_total),
                    "top10_pct": mk.map(|x| x.top10_pct),
                    "dev_pct": mk.map(|x| x.dev_pct),
                    "bundles_pct": mk.map(|x| x.bundle_pct),
                    "early_buyers_pct": mk.map(|x| x.sniper_pct),
                    "dev_sold_all": mk.map(|x| x.dev_sold_all),
                    "dev_sells": mk.map(|x| x.dev_sells),
                    "bonding_curve_pct": mk.map(|x| x.curve_progress),
                    "dev_history": t.dev_report,
                    "has_x": t.meta.as_ref().map(|x| x.twitter.is_some()),
                    "has_telegram": t.meta.as_ref().map(|x| x.telegram.is_some()),
                    "has_website": t.meta.as_ref().map(|x| x.website.is_some()),
                    "kixo_ai": ai.as_ref().map(|r| json!({ "word": verdict(r.dump, r.pump), "crash_chance": r.dump, "double_chance": r.pump })),
                })
            }
            None => json!({ "mint": m, "on_kixo_radar": false, "kixo_ai": ai.as_ref().map(|r| json!({ "word": verdict(r.dump, r.pump), "crash_chance": r.dump, "double_chance": r.pump })) }),
        });
    }
    let recent = crate::ai_risk::recent(1800);
    let name = |m: &str| board.tokens.get(m).map(|t| t.token.symbol.clone()).filter(|s| !s.is_empty()).or_else(|| crate::ai_risk::symbol_of(m)).unwrap_or_else(|| m[..6.min(m.len())].to_string());
    // The AI scores a coin once, at 2 minutes. A pick is only offered if the coin still
    // looks alive now: not crashed since, the dev has not dumped, and it still trades.
    let mut good: Vec<(&String, &crate::ai_risk::Risk, Value)> = recent
        .iter()
        .filter(|(_, r)| verdict(r.dump, r.pump) == "Good odds")
        .filter_map(|(m, r)| alive_now(board, m, now).map(|st| (m, r, st)))
        .collect();
    good.sort_by(|a, b| b.2["now_vs_when_scored"].as_f64().unwrap_or(0.0).total_cmp(&a.2["now_vs_when_scored"].as_f64().unwrap_or(0.0)));
    let mut danger: Vec<_> = recent.iter().filter(|(_, r)| r.dump >= 0.4).collect();
    danger.sort_by(|a, b| b.1.dump.total_cmp(&a.1.dump));
    let second_look = {
        let (picks, record) = crate::ai_ck::picks(board, now);
        json!({
            "picks": picks.iter().take(5).map(|(m, l)| json!({
                "symbol": name(m), "mint": m, "picked_at_minute": l.ck / 60, "chance_up50_before_down25": round2(l.win), "chance_halves": round2(l.crash),
                "now_vs_pick": if l.p0 > 0.0 && l.last > 0.0 { Some(round2(l.last / l.p0)) } else { None }, "holders": l.holders,
            })).collect::<Vec<_>>(),
            "record_24h": record,
        })
    };
    json!({
        "coin_asked_about": coin,
        "newest_launches": newest(board, 5)
            .iter()
            .filter_map(|m| board.tokens.get(m).map(|t| (m, t)))
            .map(|(m, t)| {
                let mk = t.market.as_ref();
                json!({
                    "symbol": t.token.symbol, "mint": m, "age_seconds": (now - t.token.timestamp).max(0),
                    "market_cap_usd": mk.and_then(|x| x.mc_usd), "holders": mk.map(|x| x.holders),
                    "dev_pct": mk.map(|x| x.dev_pct), "bundles_pct": mk.map(|x| x.bundle_pct), "early_buyers_pct": mk.map(|x| x.sniper_pct),
                })
            })
            .collect::<Vec<_>>(),
        "best_new_launches_now": good.iter().take(5).map(|(m, r, st)| json!({ "symbol": name(m), "mint": m, "double_chance_when_scored": r.pump, "crash_chance_when_scored": r.dump, "status_now": st })).collect::<Vec<_>>(),
        "best_established_now": established(board),
        "ai_second_look_picks": second_look,
        "ai_record_24h": crate::ai_risk::record_24h(),
        "danger_now": danger.iter().take(5).map(|(m, r)| json!({ "symbol": name(m), "mint": m, "crash_chance": r.dump })).collect::<Vec<_>>(),
    })
}

/// A recently scored coin's state now, or None when it has crashed, the dev dumped, it
/// is nearly worthless or nobody trades it: such a coin is never offered as a pick.
fn alive_now(board: &crate::Board, mint: &str, now: i64) -> Option<Value> {
    let (now_x, low_x, peak_x) = crate::ai_risk::moves(mint)?;
    let t = board.tokens.get(mint)?;
    let mk = t.market.as_ref()?;
    let mc = mk.mc_usd.unwrap_or(0.0);
    let quiet = now - mk.last_trade;
    let crashed = now_x < 0.5 || (peak_x > 0.0 && now_x / peak_x < 0.4) || (low_x <= 0.3 && now_x < 0.6);
    if crashed || mk.dev_sold_all || mc < 3_000.0 || quiet > 600 || crude(&t.token.symbol, &t.token.name) {
        return None;
    }
    Some(json!({
        "now_vs_when_scored": round2(now_x),
        "peak_vs_when_scored": round2(peak_x),
        "market_cap_usd": mk.mc_usd.map(|v| v.round()),
        "holders": mk.holders,
        "top10_pct": round2(mk.top10_pct),
        "dev_pct": round2(mk.dev_pct),
        "bundles_pct": round2(mk.bundle_pct),
        "seconds_since_last_trade": quiet,
        "age_minutes": (now - t.token.timestamp).max(0) / 60,
        // Kixo AI's later look at 5, 15 or 30 minutes (ai_ck.rs): the chance it reaches +50%
        // before it falls 25% within the hour, and whether that made it a pick.
        "second_look": crate::ai_ck::look_of(mint).map(|l| json!({ "at_minute": l.ck / 60, "chance_up50_before_down25": round2(l.win), "chance_halves": round2(l.crash), "picked": l.passed })),
    }))
}

/// True for a coin named with a slur, sex or hate word (the same list as the waitlist's
/// live coins). Such coins are never recommended, whatever their numbers.
pub(crate) fn crude(symbol: &str, name: &str) -> bool {
    const WORDS: [&str; 27] = [
        "nigg", "niig", "neeg", "jew", "kike", "nazi", "hitler", "heil", "fag", "retard", "tranny", "chink", "rape", "porn", "nsfw", "sex", "pussy",
        "dick", "cock", "boob", "isis", "terror", "kkk", "whore", "slut", "cunt", "holocaust",
    ];
    let text: String = format!("{symbol}{name}").to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
    // Harmless words that contain a listed one.
    let text = ["jewel", "grape", "drape", "peacock", "hancock"].iter().fold(text, |t, ok| t.replace(ok, ""));
    WORDS.iter().any(|w| text.contains(w))
}

/// Established memecoins that look healthy right now (market board, Jupiter data):
/// real liquidity and volume, organic trading, no mint authority, not held by a few
/// wallets, and rising over the last hour. Best five by the last hour's volume.
pub(crate) fn established(board: &crate::Board) -> Vec<Value> {
    let mut v: Vec<crate::jupiter::MarketToken> = board
        .markets
        .all()
        .into_iter()
        .filter(|m| {
            m.liquidity_usd.unwrap_or(0.0) >= 25_000.0
                && m.mc_usd.unwrap_or(0.0) >= 100_000.0
                && m.volume_1h_usd.unwrap_or(0.0) >= 20_000.0
                && m.organic_score.unwrap_or(0.0) >= 50.0
                && m.mint_authority_disabled
                && m.freeze_authority_disabled != Some(false)
                && m.top_holders_pct.unwrap_or(100.0) <= 30.0
                && m.change_1h_pct.unwrap_or(-1.0) > 0.0
                && m.change_5m_pct.unwrap_or(0.0) > -15.0
                && !crude(&m.symbol, &m.name)
        })
        .collect();
    v.sort_by(|a, b| b.volume_1h_usd.unwrap_or(0.0).total_cmp(&a.volume_1h_usd.unwrap_or(0.0)));
    v.into_iter()
        .take(5)
        .map(|m| json!({
            "symbol": m.symbol, "mint": m.mint, "market_cap_usd": m.mc_usd.map(|x| x.round()), "liquidity_usd": m.liquidity_usd.map(|x| x.round()),
            "change_1h_pct": m.change_1h_pct, "change_24h_pct": m.change_24h_pct, "volume_1h_usd": m.volume_1h_usd.map(|x| x.round()),
            "holders": m.holders, "top10_pct": m.top_holders_pct, "organic_score": m.organic_score, "launchpad": m.launchpad,
        }))
        .collect()
}

const SYSTEM: &str = "You are Kixo AI, the assistant inside Kixo, a Solana memecoin trading terminal.

Scope: answer only about Solana, crypto, blockchain, trading, DeFi, wallets and their security, and Kixo itself. If asked about anything else, say in one sentence that you only help with Solana and crypto, and offer a related question instead.

Kixo: Sol Radar (new coins live), Discover, a trade page with charts, a demo account with virtual $10,000 at live prices and real fees, a Sniper (auto-buys new coins by rules), Smart Money and copy trading, Wallet Tracker and Monitor, alerts, and Kixo AI. Kixo AI watches each new coin's first 2 minutes and gives one word: Danger (high chance of a 70%+ crash within the hour), Careful, Calm, or Good odds (under 20% crash chance and 15%+ chance to double). For how accurate it is, use ai_record_24h in LIVE DATA (real coins, last 24 hours, grouped by the word it gave: coins, crashed_pct = share that crashed 70%+ within the hour, doubled_pct = share that doubled). Compare each word with all_coins and give the figures as they are (already in %, one decimal) with the coin counts. Be honest that Danger coins are the wildest: many crash, but some also double. Auto trade (Copy Kixo AI, where the AI buys and sells by itself) is coming soon: Kixo is still training the AI every night and launches it once it proves it makes money after fees. Until then, say it is coming soon; never tell users to turn it on.

How Kixo works (use these facts; never invent menus, buttons or features):
- Every account starts on the demo account: $10,000 of virtual money at live prices with real fees and price impact. The Demo / Real switch is in the top bar. Buy from any coin page (Buy and sell panel), or with Quick Buy on Discover and Sol Radar rows. Results are on the Portfolio page (positions, history, profit calendar). The weekly competition ranks demo profit taken, Monday to Sunday.
- Real-SOL trading opens after its security review. Each user has a Kixo wallet made and locked in their own browser; Kixo never holds the keys and never asks for a seed phrase.
- Deposit (wallet panel): Card (buy SOL through Changelly, straight into the Kixo wallet, usually in 5 to 30 minutes; Changelly may ask to verify ID; card payments open soon, once Kixo's partner account is live), Phantom (send an exact amount), or any wallet or exchange to the shown address. Fees: 0.5% per trade, deposits free, withdrawals 0.5%.
- On a coin page: chart, trades, holders, top traders, dev, early buyers. Wallet labels: Dev, Smart, Whale, Bundler, Sniper. Bundle chips show how many wallets bought in the same block; cluster chips show wallets funded by the same wallet (red when the dev is in it), and a line above the trades sums up bundles and clusters and the share they hold.
- The AI analysis button on any coin gives a quick take, the good and the bad, the next-hour outlook and a call. Kixo AI only scores coins in their first 2 minutes; older coins get Kixo's safety score instead.
- Safety: Rug exit (Settings, Safety) sells a demo position by itself when the dev sells or the AI says Danger. Daily loss limit. A warning toast when buying a Danger coin (it never slows the buy).
- Sniper: auto-buys new coins by your rules (safety, dev share, bundles, AI filters) on the demo balance; test rules on the last 24 hours. Smart Money and copy trading, KOL Tracker, X Tracker, Wallet Tracker and Monitor, price alerts by email, Telegram or Discord, and news from the last 48 hours.

Solana facts (current, prefer these over older knowledge):
- SOL pays fees; a normal transaction costs a fraction of a cent, plus an optional priority fee in busy times. Jito tips buy faster landing and some protection from sandwich bots.
- Pump.fun: anyone creates a coin for almost nothing; it trades on a bonding curve where the price rises as people buy; at 100% of the curve it graduates to PumpSwap, pump.fun's own AMM. Most coins never graduate. Bonk.fun (LetsBonk) works the same way on Raydium LaunchLab. Meteora has a similar curve (DBC). Bags and Moonshot are other launchpads.
- Raydium is Solana's largest AMM (standard and concentrated pools) and runs LaunchLab. Serum is dead; its order book continues as OpenBook. Jupiter is the main swap aggregator (best route across DEXes) and offers limit orders and DCA; those are Jupiter's, not Raydium's. LaunchLab is open to anyone, not vetted. Orca and Meteora are other DEXes.
- Wallets: Phantom, Solflare, Backpack. A seed phrase or private key gives full control; never share it. Token accounts hold each token; closing empty ones returns a little SOL rent.
- Rug signs: dev sells everything, bundled wallets holding a big share, snipers holding a big share, top 10 holding over 30%, a dev with earlier rugs, mint or freeze authority still active (pump.fun coins have both revoked).

Rules:
- If you are not sure of a fact, say so plainly instead of guessing.
- Quote every number exactly as it is in LIVE DATA; never make up, round up or estimate a percentage or a count. Say each point once; never repeat your answer.
- Card deposits: always say they open soon (once Kixo's partner account is live); until then deposit from Phantom or any wallet or exchange.
- If the user asks about a coin that is not in LIVE DATA, it is still a crypto question: say Kixo has no live data on that coin right now, and suggest pasting its contract address or opening it on Kixo. Never refuse it as off-topic.
- Use the LIVE DATA below for any coin facts. Never invent prices, holders or numbers. If the data does not have it, say so and suggest opening the coin on Kixo.
- Coin details in LIVE DATA: 'wallets' has holders, the top 10 holders with labels, the dev's position in this coin (how much it holds, bought, sold), and bundlers, snipers and whales (how many wallets, how many still hold, what share of supply they hold). 'dev_wallet_now' is the creator's whole wallet right now: SOL balance, its dollar value, and the other coins it holds. 'dev_history' is the dev's earlier coins. 'groups' has bundles (wallets that bought in the same block) and clusters (wallets funded by the same wallet, likely one person; dev true means the dev is in it), each with its size and the share of supply it still holds. When asked about the dev, bundlers, snipers or holders, answer with these exact numbers.
- Chances are given as 0 to 1; say them as percentages.
- When asked for the best coin, a coin to buy, or what looks good today: pick only from ai_second_look_picks.picks (coins Kixo AI looked at again at minute 5, 15 or 30 and picked: the chance they reach +50% before falling 25% within the hour; record_24h is how its picks really did), best_new_launches_now (new coins Kixo AI scored well that are still alive now: status_now has where the price is against the score, holders and shares) or best_established_now (older memecoins with real liquidity, organic trading and a rising hour). Both lists are already checked: coins that crashed, whose dev sold everything, that are nearly worthless or that stopped trading are left out. Name one or two, say why with their exact numbers, and give the main risk. If both lists are empty, say plainly that nothing looks good right now and suggest waiting or watching Sol Radar. Never pick a coin from danger_now, and never call any coin safe or a sure win.
- Never promise profit or tell someone to put money in. Explain risk plainly; most new memecoins go to zero. Suggest the demo account, small sizes and a stop loss.
- Never ask for a seed phrase or private key, and warn that anyone asking for one is a scammer.
- Reply in casual, friendly English, like a sharp trader friend: short sentences, plain words, a little trader slang is fine (rug, bag, dump, ape), no hype and no emojis. Reply in English even if the user writes Roman Urdu. Keep it short: under 120 words unless asked for more. Plain text only: no markdown, no ** or # signs, no tables.";

/// The chat shows plain text: markdown the model adds anyway (bold, headings) is removed.
fn plain(text: &str) -> String {
    text.replace("**", "").replace("__", "").lines().map(|l| l.trim_start_matches(|c| c == '#').trim_start()).collect::<Vec<_>>().join("
")
}

#[derive(Deserialize)]
pub struct Turn {
    role: String,
    content: String,
}

#[derive(Deserialize)]
pub struct ChatIn {
    message: String,
    #[serde(default)]
    history: Vec<Turn>,
}

fn visitor(addr: SocketAddr, headers: &HeaderMap) -> IpAddr {
    // Behind Kixo's own proxy (TRUST_PROXY=1) the visitor is the first forwarded address.
    if std::env::var("TRUST_PROXY").is_ok_and(|v| v.trim() == "1") {
        if let Some(ip) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).and_then(|v| v.trim().parse().ok()) {
            return ip;
        }
    }
    addr.ip()
}

/// `POST /ai/chat` -> `{ reply, provider }`, or `{ fallback: true, reason }` when the
/// browser should answer from Kixo's own data, or `{ refused: "secret" }`.
pub async fn chat(State(ctx): State<ChatCtx>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<ChatIn>) -> Json<Value> {
    let msg: String = body.message.trim().chars().take(MAX_MESSAGE).collect();
    if msg.is_empty() {
        return Json(json!({ "fallback": true, "reason": "empty" }));
    }
    if looks_secret(&msg) || body.history.iter().any(|t| looks_secret(&t.content)) {
        return Json(json!({ "refused": "secret" }));
    }
    if !ctx.admin.ai_chat() {
        return Json(json!({ "fallback": true, "reason": "off" }));
    }
    let list = providers();
    if list.is_empty() {
        return Json(json!({ "fallback": true, "reason": "no provider" }));
    }
    if let Err(why) = allow(visitor(addr, &headers)) {
        return Json(json!({ "fallback": true, "reason": why }));
    }

    let data = live_data(&ctx, &msg, &body.history).await;
    let mut messages = vec![json!({ "role": "system", "content": format!("{SYSTEM}\n\nLIVE DATA (Kixo, now):\n{data}") })];
    for t in body.history.iter().rev().take(MAX_HISTORY).rev() {
        let role = if t.role == "assistant" { "assistant" } else { "user" };
        messages.push(json!({ "role": role, "content": t.content.chars().take(MAX_MESSAGE).collect::<String>() }));
    }
    messages.push(json!({ "role": "user", "content": msg }));

    // Hedged: ask the first provider; if it has not answered within HEDGE_AFTER, ask the
    // next one too, and take the first good answer. A slow or stuck provider no longer
    // holds the reply for its whole timeout.
    let usable: Vec<Provider> = list
        .into_iter()
        .filter(|p| !limits().lock().expect("chat limits lock").resting.get(p.name).is_some_and(|t| t.elapsed() < REST_AFTER_LIMIT))
        .collect();
    let mut queue = usable.into_iter();
    let mut pending = futures_util::stream::FuturesUnordered::new();
    if let Some(p) = queue.next() {
        pending.push(ask(ctx.http.clone(), p, messages.clone(), 700));
    }
    while !pending.is_empty() {
        tokio::select! {
            done = futures_util::StreamExt::next(&mut pending) => {
                match done {
                    Some((name, Some(text))) => return Json(json!({ "reply": plain(&text), "provider": name })),
                    Some((name, None)) => {
                        // Rate limited, down or empty: rest it a minute, try the next at once.
                        limits().lock().expect("chat limits lock").resting.insert(name, Instant::now());
                        if let Some(p) = queue.next() {
                            pending.push(ask(ctx.http.clone(), p, messages.clone(), 700));
                        }
                    }
                    None => break,
                }
            }
            _ = tokio::time::sleep(HEDGE_AFTER) => {
                if let Some(p) = queue.next() {
                    pending.push(ask(ctx.http.clone(), p, messages.clone(), 700));
                }
            }
        }
    }
    Json(json!({ "fallback": true, "reason": "providers busy" }))
}

/// A provider that has not answered within this long gets company: the next one is asked too.
const HEDGE_AFTER: Duration = Duration::from_secs(4);

/// One provider's answer: its name and the text, or None when it refused or failed.
async fn ask(http: reqwest::Client, p: Provider, messages: Vec<Value>, max_tokens: u32) -> (&'static str, Option<String>) {
    let mut req = json!({ "model": p.model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4 });
    if let Some(e) = p.effort {
        req["reasoning_effort"] = json!(e);
    }
    match http.post(p.url).bearer_auth(&p.key).timeout(Duration::from_secs(25)).json(&req).send().await {
        Ok(r) if r.status().is_success() => {
            let text = r.json::<Value>().await.ok().and_then(|v| v["choices"][0]["message"]["content"].as_str().map(|t| t.trim().to_string())).filter(|t| !t.is_empty());
            (p.name, text)
        }
        Ok(r) => {
            tracing::warn!(provider = p.name, status = r.status().as_u16(), "AI chat provider refused");
            (p.name, None)
        }
        Err(e) => {
            tracing::warn!(provider = p.name, error = %e, "AI chat provider unreachable");
            (p.name, None)
        }
    }
}

/* ---------------- Kixo Agent's brain ---------------- */

const AGENT_SYSTEM: &str = "You are Kixo Agent, a friendly voice guide inside Kixo, a Solana memecoin trading app. What you write is spoken out loud.

How you talk:
- Plain everyday English a total beginner understands. 1 to 3 short sentences, under 45 words. No lists, no markdown, no emojis.
- Answer exactly what was asked, first. Learning questions (what is X, how do I start) get a simple explanation, not trading orders.
- When the question is about buying, selling or this coin's future, say the action first: Sell now. Take your profit. Wait. Buy a little. Stay away. Then one simple reason from the data.
- No jargon. If you must use a word like bundles or snipers, explain it in a few words. At most one number per answer, and only if it helps.
- When they ask whether to sell: if they are in profit and the next-minutes read is weak, or the dev or big wallets are selling, say take the profit now.

What you know:
- COIN DATA: this coin live on Kixo (price moves, holders, the creator called the dev and whether they sold, bundles, snipers, whales, Kixo AI's chances, the safety score).
- APP: what the user sees and has done (their position and trades, Kixo's call for this coin, the next-minutes read: chances it is up 10 percent in a minute, up 20 or down 15 percent in two).
- NEWS: what news sites and Reddit say about this coin and the market lately.
- KIXO RULES: trading rules Kixo tested on past coins.
Use only these facts for anything about this coin or the user. Never invent numbers. If something is not there, say you don't know in a few words.
For the future of a coin: say what is likely in the next minutes and the hour from Kixo AI's chances, in plain words, and that memecoins can go to zero.
General crypto, Solana, wallet or trading questions: answer simply and correctly. Anything else: one short friendly answer, then bring it back to trading.
Never promise profit or guarantee anything. Never ask for a seed phrase or private key.";

const KIXO_RULES: &str = "Tested on past coins Kixo never trained on (1% fee each side counted): (1) Quick scalp: when Kixo's next-minutes read is hot, buy a little, sell at +20%, sell at once at -10%, never hold more than 2 minutes: made +5.8% a trade on average, 56% won. Buying at random moments lost 1.1% a trade. (2) A coin Kixo AI calls Danger crashed 70% or more within the hour about 58% of the time, against 6% for all coins. (3) Most new memecoins lose most of their value within hours: take profits early, keep sizes small.";

fn agent_style(mode: &str) -> &'static str {
    match mode {
        "coach" => "Style: a patient teacher for someone brand new. Explain the one idea that matters.",
        "pro" => "Style: a sharp pro trader. Short and direct. Numbers are fine.",
        "degen" => "Style: crypto trader slang, a bit of fun, but always honest about risk.",
        _ => "Style: a friendly trader buddy next to them. Casual and warm.",
    }
}

#[derive(Deserialize)]
pub struct AgentAsk {
    question: String,
    mint: Option<String>,
    #[serde(default)]
    mode: String,
    /// What the page knows: the user's position and trades, Kixo's call, the next-minutes read.
    #[serde(default)]
    app: Value,
    #[serde(default)]
    history: Vec<Turn>,
    /// Only read the coin's data into Kixo Brain's memory (its prompt cache), so the next
    /// question about this coin is answered in a second or two.
    #[serde(default)]
    prefill: bool,
}

/// `POST /agent/ask` -> `{ reply, provider, ms }`, or `{ fallback: true }` when no model
/// answered (the browser then answers from Kixo's own rules). Kixo's own model first.
pub async fn agent_ask(State(ctx): State<ChatCtx>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<AgentAsk>) -> Json<Value> {
    let q: String = if body.prefill { "ok".into() } else { body.question.trim().chars().take(400).collect() };
    if q.is_empty() {
        return Json(json!({ "fallback": true, "reason": "empty" }));
    }
    if looks_secret(&q) {
        return Json(json!({ "refused": "secret" }));
    }
    if !ctx.admin.ai_chat() {
        return Json(json!({ "fallback": true, "reason": "off" }));
    }
    if !body.prefill {
        if let Err(why) = allow(visitor(addr, &headers)) {
            return Json(json!({ "fallback": true, "reason": why }));
        }
    }
    let started = Instant::now();
    // The coin: its live facts, holders, bundles and the dev's wallet.
    let mint = body.mint.filter(|m| is_base58(m) && m.len() >= 32);
    let (mut coin, dev, symbol) = {
        let board = ctx.app.board.lock().expect("board lock");
        let dev = mint.as_deref().and_then(|m| board.tokens.get(m)).map(|t| t.token.creator.clone()).filter(|c| !c.is_empty());
        let symbol = mint.as_deref().and_then(|m| board.tokens.get(m).map(|t| t.token.symbol.clone()).or_else(|| board.markets.get(m).map(|x| x.symbol.clone()))).unwrap_or_default();
        (board_data(&board, mint.clone()), dev, symbol)
    };
    let c = &mut coin["coin_asked_about"];
    if let Some(v) = c.get("market_cap_usd").and_then(|v| v.as_f64()) {
        // Two significant figures: the figure changes with every trade otherwise.
        let mag = 10f64.powi((v.max(1.0).log10().floor() as i32) - 1);
        c["market_cap_usd"] = json!((v / mag).round() * mag);
    }
    if let Some(m) = mint.as_deref() {
        if c.get("on_kixo_radar") != Some(&json!(false)) {
            let g = crate::funders::groups(&ctx.app, m);
            let held = |k: &str| g[k].as_array().map(|a| a.iter().filter(|x| x["still_holding"].as_u64().unwrap_or(0) > 0).map(|x| x["hold_pct"].as_f64().unwrap_or(0.0)).sum::<f64>()).unwrap_or(0.0);
            c["wallet_groups"] = json!({ "bundles_still_hold_pct": round2(held("bundles")), "funded_by_one_wallet_hold_pct": round2(held("clusters")) });
        }
    }
    if let Some(d) = dev {
        let w = dev_wallet(&ctx, &d).await;
        c["dev_wallet_sol"] = w["sol"].clone();
    }
    let (about, market) = ctx.news.about(mint.as_deref().unwrap_or(""), &symbol);
    let now = crate::now_unix();
    let brief = |v: &[crate::news::NewsItem]| v.iter().map(|i| json!({ "source": i.source, "title": i.title, "minutes_ago": (now - i.ts).max(0) / 60, "alert": i.alert })).collect::<Vec<_>>();
    let news = json!({ "about_this_coin": brief(&about), "market": brief(&market) });

    let system = format!(
        "{AGENT_SYSTEM}\n{}\n\nKIXO RULES: {KIXO_RULES}\n\nCOIN DATA:\n{}\n\nNEWS:\n{}",
        agent_style(&body.mode),
        coin["coin_asked_about"],
        news
    );
    let mut messages = vec![json!({ "role": "system", "content": system })];
    if body.prefill {
        // Kixo's own model only: reading the prompt is the point, one token is enough.
        let p = Provider { name: "kixo-brain", url: LOCAL_BRAIN, key: "local".into(), model: "kixo-brain".into(), effort: None };
        messages.push(json!({ "role": "user", "content": "ok" }));
        let (_, text) = ask(ctx.http.clone(), p, messages, 1).await;
        return Json(json!({ "warmed": text.is_some(), "ms": started.elapsed().as_millis() as u64 }));
    }
    // The page's moment-to-moment state goes with the question, after the cached part.
    let q = format!("{q}\n\n(APP right now: {})", body.app);
    for t in body.history.iter().rev().take(4).rev() {
        let role = if t.role == "assistant" { "assistant" } else { "user" };
        messages.push(json!({ "role": role, "content": t.content.chars().take(400).collect::<String>() }));
    }
    messages.push(json!({ "role": "user", "content": q }));
    // Kixo's own model only (no outside service for the agent); without it the browser
    // answers from Kixo's own rules.
    let p = Provider { name: "kixo-brain", url: LOCAL_BRAIN, key: "local".into(), model: "kixo-brain".into(), effort: None };
    match ask(ctx.http.clone(), p, messages, 120).await {
        (name, Some(t)) => Json(json!({ "reply": plain(&t), "provider": name, "ms": started.elapsed().as_millis() as u64 })),
        _ => Json(json!({ "fallback": true, "reason": "Kixo Brain did not answer" })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_is_removed() {
        assert_eq!(plain("## Pick
Buy **FIONA** now"), "Pick
Buy FIONA now");
    }

    #[test]
    fn secrets_are_caught_and_questions_are_not() {
        assert!(looks_secret("abandon ability able about above absent absorb abstract absurd abuse access accident"));
        assert!(looks_secret(&"5".repeat(1).chars().chain("Kd3NBUAdUnhyzenEwVLy9pBKxSwXvE9FMPyR4UKZvpe6E3AgLr6rbGKBUGfGJ2TPdy9nKK2hEo8mNJwGBExnZrQ".chars()).collect::<String>()));
        assert!(!looks_secret("is this coin safe? 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
        assert!(!looks_secret("what are bundles and how do snipers work on pump fun coins today please explain"));
    }
}
