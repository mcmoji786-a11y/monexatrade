//! Strategy Library: trading strategies from the outside world (a YouTube video's
//! transcript, a GitHub repo, an X thread), turned into Kixo sniper rules and tested on
//! Kixo's real data before anyone sees them.
//!
//! 1. The admin pastes a source (link and text), or asks Kixo to look on GitHub.
//! 2. A free language model (ai_chat::complete) turns the text into a rule: the sniper's
//!    filters and exits. What the rule cannot express is listed, never invented.
//! 3. The rule runs on the last 24 hours of real launches (ai/backtest.py), and again
//!    every day; each result is kept (up to 30).
//! 4. Only what the admin publishes is shown to users (GET /strategies), always with its
//!    tested results, good or bad. Users can load one into their Sniper (demo first).
//!
//! Stored in data/strategies.json. Admin routes sit under /admin/ (admin_guard, key).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

const FILE: &str = "data/strategies.json";
const MAX_TEXT: usize = 14_000;
const MAX_TESTS: usize = 30;
const MAX_STRATEGIES: usize = 300;

#[derive(Clone)]
pub struct StratCtx {
    pub http: reqwest::Client,
    pub admin: Arc<crate::admin::AdminState>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Test {
    pub at: i64,
    pub coins: u64,
    pub trades: u64,
    pub win_rate: f64,
    pub avg_pct: f64,
    pub total_usd: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Strategy {
    pub id: u64,
    pub title: String,
    pub summary: String,
    pub source_url: String,
    pub source_kind: String,
    pub rule: Value,
    #[serde(default)]
    pub unsupported: Vec<String>,
    #[serde(default)]
    pub published: bool,
    pub created: i64,
    #[serde(default)]
    pub tests: Vec<Test>,
}

fn store() -> &'static Mutex<Vec<Strategy>> {
    static S: OnceLock<Mutex<Vec<Strategy>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(std::fs::read(FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()))
}

fn save(list: &[Strategy]) {
    let _ = std::fs::create_dir_all("data");
    let _ = std::fs::write(FILE, serde_json::to_vec_pretty(list).unwrap_or_default());
}

type ApiErr = (StatusCode, String);

fn admin_only(headers: &HeaderMap) -> Result<(), ApiErr> {
    if crate::admin::is_admin(headers) {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, "admin only".into()))
    }
}

/* ---------------- Rules ---------------- */

fn num(v: &Value, lo: f64, hi: f64) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim_end_matches('%').trim().parse().ok())).filter(|x| x.is_finite()).map(|x| x.clamp(lo, hi))
}

/// Keeps a rule inside what the sniper can do; anything unknown is dropped.
pub fn normalize(r: &Value) -> Value {
    let opt = |k: &str, lo: f64, hi: f64| num(&r[k], lo, hi).map(Value::from).unwrap_or(Value::Null);
    let req = |k: &str, lo: f64, hi: f64, d: f64| Value::from(num(&r[k], lo, hi).unwrap_or(d));
    json!({
        "maxAgeSecs": req("maxAgeSecs", 5.0, 1_800.0, 120.0),
        "minHolders": opt("minHolders", 0.0, 10_000.0),
        "minTrades": opt("minTrades", 0.0, 10_000.0),
        "maxDevPct": opt("maxDevPct", 0.0, 100.0),
        "maxTop10Pct": opt("maxTop10Pct", 0.0, 100.0),
        "maxBundlePct": opt("maxBundlePct", 0.0, 100.0),
        "maxEarlyBuyerPct": opt("maxEarlyBuyerPct", 0.0, 100.0),
        "socialsRequired": r["socialsRequired"].as_bool().unwrap_or(false),
        "skipRepeatRuggers": r["skipRepeatRuggers"].as_bool().unwrap_or(true),
        "aiMaxDump": opt("aiMaxDump", 0.0, 100.0),
        "aiMinPump": opt("aiMinPump", 0.0, 100.0),
        "takeProfitPct": req("takeProfitPct", 5.0, 2_000.0, 100.0),
        "stopLossPct": req("stopLossPct", 1.0, 95.0, 30.0),
        "trailingPct": req("trailingPct", 0.0, 90.0, 0.0),
        "maxHoldMins": req("maxHoldMins", 1.0, 1_440.0, 30.0),
    })
}

const SYSTEM: &str = r#"You turn a memecoin trading strategy (a video transcript, a README, a thread) into rules for Kixo's sniper, which buys new Solana launches (pump.fun and similar) and sells them automatically.

Answer with ONE JSON object and nothing else:
{"title": "short name, max 60 chars",
 "summary": "two plain sentences: when it buys, when it sells",
 "rule": {
   "maxAgeSecs": seconds since launch the coin may be at most when bought,
   "minHolders": number or null, "minTrades": number or null,
   "maxDevPct": creator's share of supply in % or null, "maxTop10Pct": top 10 holders' share in % or null,
   "maxBundlePct": % bought in the launch block by others or null, "maxEarlyBuyerPct": % bought in the first 3 seconds or null,
   "socialsRequired": true/false, "skipRepeatRuggers": true/false,
   "aiMaxDump": null, "aiMinPump": null,
   "takeProfitPct": sell when up this %, "stopLossPct": sell when down this %,
   "trailingPct": sell when this % below the best price since buying (0 = none), "maxHoldMins": sell after this many minutes},
 "unsupported": ["each part of the strategy these rules cannot express, in a few words"]}

Use only what the text says. Do not invent numbers: leave a filter null when the text gives none, and use 100 / 30 / 0 / 30 for exits it does not give. If the text has no concrete buying and selling rules for new coins, answer {"none": true}."#;

fn first_json(text: &str) -> Option<Value> {
    let a = text.find('{')?;
    let b = text.rfind('}')?;
    serde_json::from_str(&text[a..=b]).ok()
}

fn kind_of(url: &str) -> &'static str {
    if url.contains("youtube.com") || url.contains("youtu.be") {
        "youtube"
    } else if url.contains("github.com") {
        "github"
    } else if url.contains("x.com") || url.contains("twitter.com") {
        "x"
    } else {
        "other"
    }
}

/// Text to a draft strategy, or why not.
async fn extract(http: &reqwest::Client, source_url: &str, text: &str) -> Result<Strategy, String> {
    let text: String = text.chars().take(MAX_TEXT).collect();
    if text.trim().len() < 80 {
        return Err("Paste the transcript or text too (at least a few sentences)".into());
    }
    let answer = crate::ai_chat::complete(http, SYSTEM, &text, 900).await.ok_or("The language models are busy or not set up (GROQ, GEMINI or OPENROUTER key)")?;
    let v = first_json(&answer).ok_or("The model did not answer with rules")?;
    if v["none"].as_bool() == Some(true) {
        return Err("No concrete buy and sell rules for new coins in this text".into());
    }
    let clean = |s: &str, n: usize| s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(n).collect::<String>();
    Ok(Strategy {
        id: 0,
        title: clean(v["title"].as_str().unwrap_or("Untitled strategy"), 60),
        summary: clean(v["summary"].as_str().unwrap_or(""), 400),
        source_url: clean(source_url, 300),
        source_kind: kind_of(source_url).into(),
        rule: normalize(&v["rule"]),
        unsupported: v["unsupported"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).map(|x| clean(x, 120)).take(8).collect()).unwrap_or_default(),
        published: false,
        created: crate::now_unix(),
        tests: Vec::new(),
    })
}

fn add(mut s: Strategy) -> Result<Strategy, String> {
    let mut list = store().lock().expect("strategies lock");
    if list.len() >= MAX_STRATEGIES {
        return Err(format!("At most {MAX_STRATEGIES} strategies; delete some"));
    }
    s.id = list.iter().map(|x| x.id).max().unwrap_or(0) + 1;
    list.push(s.clone());
    save(&list);
    Ok(s)
}

/// Runs a rule on the last 24 hours of launches through the AI service.
async fn backtest(http: &reqwest::Client, rule: &Value) -> Result<Test, String> {
    let mut body = rule.clone();
    body["sizeUsd"] = json!(25);
    body["maxOpen"] = json!(5);
    body["maxPerHour"] = json!(20);
    body["slippagePct"] = json!(2);
    let r = http.post(format!("{}/backtest", crate::ai_risk::service_url())).json(&body).timeout(Duration::from_secs(90)).send().await.map_err(|_| "The AI service is not running".to_string())?;
    let v: Value = r.json().await.map_err(|_| "Bad answer from the AI service".to_string())?;
    if v["ready"].as_bool() != Some(true) {
        return Err(v["error"].as_str().unwrap_or("The last 24 hours are still loading").to_string());
    }
    Ok(Test {
        at: crate::now_unix(),
        coins: v["coins"].as_u64().unwrap_or(0),
        trades: v["trades"].as_u64().unwrap_or(0),
        win_rate: v["win_rate"].as_f64().unwrap_or(0.0),
        avg_pct: v["avg_pct"].as_f64().unwrap_or(0.0),
        total_usd: v["total_usd"].as_f64().unwrap_or(0.0),
    })
}

fn record(id: u64, t: Test) -> Option<Strategy> {
    let mut list = store().lock().expect("strategies lock");
    let s = list.iter_mut().find(|s| s.id == id)?;
    s.tests.push(t);
    if s.tests.len() > MAX_TESTS {
        let cut = s.tests.len() - MAX_TESTS;
        s.tests.drain(..cut);
    }
    let out = s.clone();
    save(&list);
    Some(out)
}

/// Every 6 hours: strategies whose last test is older than a day are tested again, so
/// the results follow the market instead of one lucky day.
pub async fn run(c: StratCtx) {
    tokio::time::sleep(Duration::from_secs(15 * 60)).await;
    loop {
        if c.admin.strategy_library() {
            let due: Vec<(u64, Value)> = store().lock().expect("strategies lock").iter().filter(|s| s.published || !s.tests.is_empty()).filter(|s| s.tests.last().is_none_or(|t| crate::now_unix() - t.at > 20 * 3600)).map(|s| (s.id, s.rule.clone())).collect();
            for (id, rule) in due {
                if let Ok(t) = backtest(&c.http, &rule).await {
                    record(id, t);
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        }
        tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
    }
}

/* ---------------- Public ---------------- */

fn public_view(s: &Strategy) -> Value {
    let recent: Vec<&Test> = s.tests.iter().rev().take(7).collect();
    let trades: u64 = recent.iter().map(|t| t.trades).sum();
    let avg = if trades > 0 { recent.iter().map(|t| t.avg_pct * t.trades as f64).sum::<f64>() / trades as f64 } else { 0.0 };
    let wins = if trades > 0 { recent.iter().map(|t| t.win_rate * t.trades as f64).sum::<f64>() / trades as f64 } else { 0.0 };
    json!({
        "id": s.id, "title": s.title, "summary": s.summary, "source_url": s.source_url, "source_kind": s.source_kind,
        "rule": s.rule, "unsupported": s.unsupported,
        "last": s.tests.last(),
        "days": recent.len(), "trades": trades, "avg_pct": (avg * 100.0).round() / 100.0, "win_rate": (wins * 10.0).round() / 10.0,
        "history": s.tests.iter().map(|t| json!([t.at, t.avg_pct])).collect::<Vec<_>>(),
    })
}

/// `GET /strategies`: the published strategies with their tested results, best first.
pub async fn list_public(State(c): State<StratCtx>) -> Result<Json<Value>, ApiErr> {
    if !c.admin.strategy_library() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "The Strategy Library is switched off right now".into()));
    }
    let mut out: Vec<Value> = store().lock().expect("strategies lock").iter().filter(|s| s.published && !s.tests.is_empty()).map(public_view).collect();
    out.sort_by(|a, b| b["avg_pct"].as_f64().unwrap_or(0.0).total_cmp(&a["avg_pct"].as_f64().unwrap_or(0.0)));
    Ok(Json(json!({ "strategies": out })))
}

/* ---------------- Admin ---------------- */

pub async fn admin_list(headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    admin_only(&headers)?;
    let list: Vec<Value> = store().lock().expect("strategies lock").iter().rev().map(|s| {
        let mut v = public_view(s);
        v["published"] = json!(s.published);
        v["created"] = json!(s.created);
        v
    }).collect();
    Ok(Json(json!({ "strategies": list })))
}

#[derive(Deserialize)]
pub struct ExtractIn {
    #[serde(default)]
    source_url: String,
    text: String,
}

/// `POST /admin/strategies/extract`: a pasted source to a draft, tested at once.
pub async fn admin_extract(State(c): State<StratCtx>, headers: HeaderMap, Json(i): Json<ExtractIn>) -> Result<Json<Value>, ApiErr> {
    admin_only(&headers)?;
    let draft = extract(&c.http, &i.source_url, &i.text).await.map_err(|m| (StatusCode::BAD_REQUEST, m))?;
    let saved = add(draft).map_err(|m| (StatusCode::BAD_REQUEST, m))?;
    let tested = match backtest(&c.http, &saved.rule).await {
        Ok(t) => record(saved.id, t).unwrap_or(saved),
        Err(_) => saved,
    };
    Ok(Json(public_view(&tested)))
}

/// `POST /admin/strategies/{id}/test`
pub async fn admin_test(State(c): State<StratCtx>, headers: HeaderMap, Path(id): Path<u64>) -> Result<Json<Value>, ApiErr> {
    admin_only(&headers)?;
    let rule = store().lock().expect("strategies lock").iter().find(|s| s.id == id).map(|s| s.rule.clone()).ok_or((StatusCode::NOT_FOUND, "No such strategy".to_string()))?;
    let t = backtest(&c.http, &rule).await.map_err(|m| (StatusCode::SERVICE_UNAVAILABLE, m))?;
    let s = record(id, t).ok_or((StatusCode::NOT_FOUND, "No such strategy".to_string()))?;
    Ok(Json(public_view(&s)))
}

#[derive(Deserialize)]
pub struct EditIn {
    title: Option<String>,
    summary: Option<String>,
    rule: Option<Value>,
    published: Option<bool>,
}

/// `PUT /admin/strategies/{id}`: edit, publish or unpublish.
pub async fn admin_edit(headers: HeaderMap, Path(id): Path<u64>, Json(e): Json<EditIn>) -> Result<Json<Value>, ApiErr> {
    admin_only(&headers)?;
    let mut list = store().lock().expect("strategies lock");
    let s = list.iter_mut().find(|s| s.id == id).ok_or((StatusCode::NOT_FOUND, "No such strategy".to_string()))?;
    if let Some(t) = e.title {
        s.title = t.chars().filter(|c| !c.is_control()).take(60).collect();
    }
    if let Some(t) = e.summary {
        s.summary = t.chars().filter(|c| !c.is_control()).take(400).collect();
    }
    if let Some(r) = e.rule {
        s.rule = normalize(&r);
        // A changed rule starts its record over.
        s.tests.clear();
    }
    if let Some(p) = e.published {
        if p && s.tests.is_empty() {
            return Err((StatusCode::BAD_REQUEST, "Test it before publishing: users always see results".into()));
        }
        s.published = p;
    }
    let out = s.clone();
    save(&list);
    Ok(Json(public_view(&out)))
}

/// `DELETE /admin/strategies/{id}`
pub async fn admin_delete(headers: HeaderMap, Path(id): Path<u64>) -> Result<Json<Value>, ApiErr> {
    admin_only(&headers)?;
    let mut list = store().lock().expect("strategies lock");
    let before = list.len();
    list.retain(|s| s.id != id);
    if list.len() == before {
        return Err((StatusCode::NOT_FOUND, "No such strategy".into()));
    }
    save(&list);
    Ok(Json(json!({ "deleted": true })))
}

#[derive(Deserialize)]
pub struct GithubIn {
    #[serde(default)]
    query: String,
}

/// `POST /admin/strategies/github`: looks for memecoin strategy repos on GitHub, reads up
/// to five new READMEs, and turns each into a tested draft (the admin then reviews).
pub async fn admin_github(State(c): State<StratCtx>, headers: HeaderMap, Json(g): Json<GithubIn>) -> Result<Json<Value>, ApiErr> {
    admin_only(&headers)?;
    let q = if g.query.trim().is_empty() { "pump.fun sniper strategy" } else { g.query.trim() };
    let gh = |url: String| c.http.get(url).header("User-Agent", "kixo-strategy-library").header("Accept", "application/vnd.github+json").timeout(Duration::from_secs(15));
    let found: Value = gh(format!("https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page=20", urlencode(q)))
        .send()
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "GitHub unreachable".to_string()))?
        .json()
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Bad answer from GitHub".to_string()))?;
    let known: Vec<String> = store().lock().expect("strategies lock").iter().map(|s| s.source_url.clone()).collect();
    let mut made = Vec::new();
    let mut skipped = Vec::new();
    for repo in found["items"].as_array().cloned().unwrap_or_default() {
        if made.len() + skipped.len() >= 5 {
            break;
        }
        let (Some(full), Some(url)) = (repo["full_name"].as_str(), repo["html_url"].as_str()) else { continue };
        if known.iter().any(|k| k == url) {
            continue;
        }
        let readme = gh(format!("https://api.github.com/repos/{full}/readme")).header("Accept", "application/vnd.github.raw").send().await;
        let Ok(readme) = readme else { continue };
        let Ok(text) = readme.text().await else { continue };
        match extract(&c.http, url, &text).await {
            Ok(d) => {
                if let Ok(s) = add(d) {
                    let s = match backtest(&c.http, &s.rule).await {
                        Ok(t) => record(s.id, t).unwrap_or(s),
                        Err(_) => s,
                    };
                    made.push(json!({ "id": s.id, "title": s.title, "source_url": url }));
                }
            }
            Err(why) => skipped.push(json!({ "source_url": url, "why": why })),
        }
    }
    Ok(Json(json!({ "made": made, "skipped": skipped })))
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_are_kept_in_range() {
        let r = normalize(&json!({ "maxAgeSecs": 99999, "takeProfitPct": "50%", "stopLossPct": -5, "maxDevPct": "abc", "socialsRequired": true, "evil": 1 }));
        assert_eq!(r["maxAgeSecs"], json!(1800.0));
        assert_eq!(r["takeProfitPct"], json!(50.0));
        assert_eq!(r["stopLossPct"], json!(1.0));
        assert_eq!(r["maxDevPct"], Value::Null);
        assert_eq!(r["socialsRequired"], json!(true));
        assert!(r.get("evil").is_none());
        assert_eq!(first_json("sure! {\"none\": true} done"), Some(json!({ "none": true })));
        assert_eq!(kind_of("https://youtu.be/x"), "youtube");
    }
}
