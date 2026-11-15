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
const MAX_MESSAGE: usize = 600;
const MAX_HISTORY: usize = 6;
const REST_AFTER_LIMIT: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct ChatCtx {
    pub app: Arc<crate::AppState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub http: reqwest::Client,
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
    [
        provider("groq", "https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", "GROQ_MODEL", "openai/gpt-oss-120b", Some("low")),
        provider("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-3.5-flash", Some("none")),
        provider("openrouter", "https://openrouter.ai/api/v1/chat/completions", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free", None),
    ]
    .into_iter()
    .flatten()
    .collect()
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

/// Live facts for the prompt: the coin the message names (address or $SYMBOL) and the
/// AI's current Good odds and Danger coins.
fn live_data(ctx: &ChatCtx, msg: &str) -> Value {
    let board = ctx.app.board.lock().expect("board lock");
    let now = crate::now_unix();
    let mut coin = None;
    let mint = msg.split(|c: char| !c.is_ascii_alphanumeric()).find(|w| (32..=44).contains(&w.len()) && is_base58(w)).map(String::from);
    let by_symbol = || {
        let sym = msg.split_whitespace().find_map(|w| w.strip_prefix('$')).map(|s| s.trim_matches(|c: char| !c.is_ascii_alphanumeric()).to_lowercase())?;
        board.tokens.values().filter(|t| t.token.symbol.to_lowercase() == sym).max_by_key(|t| t.token.timestamp).map(|t| t.token.mint.clone())
    };
    if let Some(m) = mint.or_else(by_symbol) {
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
    let name = |m: &str| board.tokens.get(m).map(|t| t.token.symbol.clone()).unwrap_or_else(|| m[..6.min(m.len())].to_string());
    let mut good: Vec<_> = recent.iter().filter(|(_, r)| verdict(r.dump, r.pump) == "Good odds").collect();
    good.sort_by(|a, b| b.1.pump.total_cmp(&a.1.pump));
    let mut danger: Vec<_> = recent.iter().filter(|(_, r)| r.dump >= 0.4).collect();
    danger.sort_by(|a, b| b.1.dump.total_cmp(&a.1.dump));
    json!({
        "coin_asked_about": coin,
        "good_odds_now": good.iter().take(5).map(|(m, r)| json!({ "symbol": name(m), "mint": m, "double_chance": r.pump, "crash_chance": r.dump })).collect::<Vec<_>>(),
        "danger_now": danger.iter().take(5).map(|(m, r)| json!({ "symbol": name(m), "mint": m, "crash_chance": r.dump })).collect::<Vec<_>>(),
    })
}

const SYSTEM: &str = "You are Kixo AI, the assistant inside Kixo, a Solana memecoin trading terminal.

Scope: answer only about Solana, crypto, blockchain, trading, DeFi, wallets and their security, and Kixo itself. If asked about anything else, say in one sentence that you only help with Solana and crypto, and offer a related question instead.

Kixo: Sol Radar (new coins live), Discover, a trade page with charts, a demo account with virtual $10,000 at live prices and real fees, a Sniper (auto-buys new coins by rules), Smart Money and copy trading, Wallet Tracker and Monitor, alerts, and Kixo AI. Kixo AI watches each new coin's first 2 minutes and gives one word: Danger (high chance of a 70%+ crash within the hour), Careful, Calm, or Good odds (under 20% crash chance and 15%+ chance to double). When it says Danger, about half of coins crashed in testing versus 8% normally. Auto trade (Copy Kixo AI) buys the strongest Good odds coins (20%+ double chance) on the demo account and sells fast: at a 20% loss, 20% below its best price, at 3x, or after 10 minutes. It is not proven profitable yet; demo first.

Solana facts (current, prefer these over older knowledge):
- SOL pays fees; a normal transaction costs a fraction of a cent, plus an optional priority fee in busy times. Jito tips buy faster landing and some protection from sandwich bots.
- Pump.fun: anyone creates a coin for almost nothing; it trades on a bonding curve where the price rises as people buy; at 100% of the curve it graduates to PumpSwap, pump.fun's own AMM. Most coins never graduate. Bonk.fun (LetsBonk) works the same way on Raydium LaunchLab. Meteora has a similar curve (DBC). Bags and Moonshot are other launchpads.
- Raydium is Solana's largest AMM (standard and concentrated pools) and runs LaunchLab. Serum is dead; its order book continues as OpenBook. Jupiter is the main swap aggregator (best route across DEXes) and offers limit orders and DCA; those are Jupiter's, not Raydium's. LaunchLab is open to anyone, not vetted. Orca and Meteora are other DEXes.
- Wallets: Phantom, Solflare, Backpack. A seed phrase or private key gives full control; never share it. Token accounts hold each token; closing empty ones returns a little SOL rent.
- Rug signs: dev sells everything, bundled wallets holding a big share, snipers holding a big share, top 10 holding over 30%, a dev with earlier rugs, mint or freeze authority still active (pump.fun coins have both revoked).

Rules:
- If you are not sure of a fact, say so plainly instead of guessing.
- Use the LIVE DATA below for any coin facts. Never invent prices, holders or numbers. If the data does not have it, say so and suggest opening the coin on Kixo.
- Chances are given as 0 to 1; say them as percentages.
- Never promise profit or tell someone to put money in. Explain risk plainly; most new memecoins go to zero. Suggest the demo account, small sizes and a stop loss.
- Never ask for a seed phrase or private key, and warn that anyone asking for one is a scammer.
- Reply in the user's language AND script. If they write Urdu or Hindi words in Latin letters (Roman Urdu, like \"kya hai\", \"kaise bachun\"), reply in Roman Urdu with Latin letters only: never Devanagari or Arabic script. Use Urdu script or Devanagari only if the user wrote in it. Keep it short: under 120 words unless asked for more. Plain text only: no markdown, no ** or # signs, no tables.";

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

    let data = live_data(&ctx, &msg);
    let mut messages = vec![json!({ "role": "system", "content": format!("{SYSTEM}\n\nLIVE DATA (Kixo, now):\n{data}") })];
    for t in body.history.iter().rev().take(MAX_HISTORY).rev() {
        let role = if t.role == "assistant" { "assistant" } else { "user" };
        messages.push(json!({ "role": role, "content": t.content.chars().take(MAX_MESSAGE).collect::<String>() }));
    }
    messages.push(json!({ "role": "user", "content": msg }));

    for p in list {
        let resting = limits().lock().expect("chat limits lock").resting.get(p.name).is_some_and(|t| t.elapsed() < REST_AFTER_LIMIT);
        if resting {
            continue;
        }
        let mut req = json!({ "model": p.model, "messages": messages, "max_tokens": 700, "temperature": 0.4 });
        if let Some(e) = p.effort {
            req["reasoning_effort"] = json!(e);
        }
        let res = ctx.http.post(p.url).bearer_auth(&p.key).timeout(Duration::from_secs(25)).json(&req).send().await;
        match res {
            Ok(r) if r.status().is_success() => {
                if let Ok(v) = r.json::<Value>().await {
                    if let Some(text) = v["choices"][0]["message"]["content"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                        return Json(json!({ "reply": text, "provider": p.name }));
                    }
                }
            }
            Ok(r) => {
                // Rate limited or down: rest this provider a minute, try the next.
                tracing::warn!(provider = p.name, status = r.status().as_u16(), "AI chat provider refused");
            }
            Err(e) => tracing::warn!(provider = p.name, error = %e, "AI chat provider unreachable"),
        }
        limits().lock().expect("chat limits lock").resting.insert(p.name, Instant::now());
    }
    Json(json!({ "fallback": true, "reason": "providers busy" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_caught_and_questions_are_not() {
        assert!(looks_secret("abandon ability able about above absent absorb abstract absurd abuse access accident"));
        assert!(looks_secret(&"5".repeat(1).chars().chain("Kd3NBUAdUnhyzenEwVLy9pBKxSwXvE9FMPyR4UKZvpe6E3AgLr6rbGKBUGfGJ2TPdy9nKK2hEo8mNJwGBExnZrQ".chars()).collect::<String>()));
        assert!(!looks_secret("is this coin safe? 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
        assert!(!looks_secret("what are bundles and how do snipers work on pump fun coins today please explain"));
    }
}
