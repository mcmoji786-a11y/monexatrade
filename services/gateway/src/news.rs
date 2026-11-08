//! Kixo News: live Solana and memecoin news from across the internet, plus Kixo's own
//! on-chain events, merged into one feed.
//!
//! Sources (polled, staggered so no site sees bursts):
//! - news sites' RSS feeds and a Google News search, kept only when they are about
//!   Solana or memecoins;
//! - Reddit communities (r/solana, r/memecoins), hot posts with real upvotes, only
//!   when `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set: Reddit refuses
//!   automated access without its API (OAuth), and its rules require it;
//! - X (Twitter) recent search, only when `X_BEARER_TOKEN` is set: X's data needs a
//!   paid API key, and scraping it breaks their rules;
//! - YouTube: new videos from Solana's own channel and crypto news channels;
//! - on-chain: new coins taking off (often before anyone tweets them), coins
//!   graduating, passing $1M, whale buys and devs selling out, from our own engine.
//!
//! Stories that name an established coin ($BONK, dogwifhat...) carry it, so the panel
//! can show its live price and open it.
//!
//! Only the headline, a short plain-text intro and a link to the original are kept:
//! articles are never republished. Browsers get the feed at `GET /news` and live
//! updates over `/ws/news`.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::broadcast;

const MAX_ITEMS: usize = 400;
const MAX_AGE_SECS: i64 = 48 * 3600;
const SUMMARY_CHARS: usize = 220;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct NewsItem {
    pub id: String,
    /// "news" (sites and Google News), "community" (Reddit), "x" or "onchain".
    pub kind: &'static str,
    pub source: String,
    pub title: String,
    pub summary: Option<String>,
    /// The original article, or a Kixo page (`/token/<mint>`) for on-chain events.
    pub url: String,
    pub ts: i64,
    pub tags: Vec<&'static str>,
    /// The coin an on-chain event is about.
    pub mint: Option<String>,
    /// A picture from the source (https only; shown through the gateway's image proxy).
    pub image: Option<String>,
    /// A YouTube video id, played inside the panel.
    pub video: Option<String>,
    /// Established coins the story names, so a trader can open them in one click.
    pub coins: Vec<CoinTag>,
    /// On-chain alerts: "rising", "million", "graduated", "whale", "dev_out", "pump",
    /// "trending" or "sniped".
    pub alert: Option<&'static str>,
    /// The coin's own X (Twitter) link, from its metadata.
    pub x_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CoinTag {
    pub mint: String,
    pub symbol: String,
}

pub struct News {
    /// Last result per source (name -> status, items kept, when), for the admin.
    status: Mutex<HashMap<String, (String, usize, i64)>>,
    items: Mutex<VecDeque<NewsItem>>,
    seen: Mutex<HashSet<String>>,
    tx: broadcast::Sender<Vec<NewsItem>>,
    /// Where the feed is saved, so a restart keeps the last 48 hours of stories and alerts.
    store: Option<std::path::PathBuf>,
}

/// A saved story, read back with its labels matched to the known ones.
#[derive(Deserialize)]
struct Saved {
    id: String,
    kind: String,
    source: String,
    title: String,
    summary: Option<String>,
    url: String,
    ts: i64,
    #[serde(default)]
    tags: Vec<String>,
    mint: Option<String>,
    image: Option<String>,
    video: Option<String>,
    #[serde(default)]
    coins: Vec<CoinTag>,
    alert: Option<String>,
    x_url: Option<String>,
}

const KINDS: [&str; 5] = ["news", "community", "x", "onchain", "video"];
const TAGS: [&str; 2] = ["solana", "memecoin"];
const ALERTS: [&str; 8] = ["rising", "million", "graduated", "whale", "dev_out", "pump", "trending", "sniped"];

fn known(s: &str, list: &[&'static str]) -> Option<&'static str> {
    list.iter().copied().find(|k| *k == s)
}

impl Saved {
    fn item(self) -> Option<NewsItem> {
        Some(NewsItem {
            id: self.id,
            kind: known(&self.kind, &KINDS)?,
            source: self.source,
            title: self.title,
            summary: self.summary,
            url: self.url,
            ts: self.ts,
            tags: self.tags.iter().filter_map(|t| known(t, &TAGS)).collect(),
            mint: self.mint,
            image: self.image,
            video: self.video,
            coins: self.coins,
            alert: match self.alert {
                Some(a) => Some(known(&a, &ALERTS)?),
                None => None,
            },
            x_url: self.x_url,
        })
    }
}

impl News {
    /// A feed that is not saved anywhere (tests).
    #[cfg(test)]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { status: Mutex::new(HashMap::new()), items: Mutex::new(VecDeque::new()), seen: Mutex::new(HashSet::new()), tx: broadcast::channel(64).0, store: None })
    }

    /// A feed saved to `path`, starting from what was saved there (stories older than
    /// 48 hours are dropped).
    pub fn stored(path: &str) -> Arc<Self> {
        let saved: Vec<Saved> = std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let now = now_secs();
        let items: VecDeque<NewsItem> = saved.into_iter().filter_map(Saved::item).filter(|it| now - it.ts <= MAX_AGE_SECS).collect();
        let seen = items.iter().flat_map(seen_keys).collect();
        tracing::info!(stories = items.len(), "news feed loaded");
        Arc::new(Self { status: Mutex::new(HashMap::new()), items: Mutex::new(items), seen: Mutex::new(seen), tx: broadcast::channel(64).0, store: Some(path.into()) })
    }

    fn save(&self) {
        let Some(path) = &self.store else { return };
        let body = {
            let items = self.items.lock().expect("news items");
            serde_json::to_vec(&*items)
        };
        if let Ok(body) = body {
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, body).is_ok() {
                let _ = std::fs::rename(&tmp, path);
            }
        }
    }

    /// Adds the items not seen before (same link or same headline) and tells browsers.
    fn add(&self, batch: Vec<NewsItem>) {
        let now = now_secs();
        let mut fresh = Vec::new();
        {
            let mut seen = self.seen.lock().expect("news seen");
            for it in batch {
                if now - it.ts > MAX_AGE_SECS || it.ts > now + 600 {
                    continue;
                }
                let keys = seen_keys(&it);
                if keys.iter().any(|k| seen.contains(k)) {
                    continue;
                }
                seen.extend(keys);
                fresh.push(it);
            }
            if seen.len() > 20_000 {
                seen.clear();
            }
        }
        if fresh.is_empty() {
            return;
        }
        fresh.sort_by(|a, b| b.ts.cmp(&a.ts));
        {
            let mut items = self.items.lock().expect("news items");
            for it in fresh.iter().rev() {
                items.push_front(it.clone());
            }
            let mut v: Vec<NewsItem> = items.drain(..).collect();
            v.sort_by(|a, b| b.ts.cmp(&a.ts));
            v.retain(|it| now - it.ts <= MAX_AGE_SECS);
            v.truncate(MAX_ITEMS);
            items.extend(v);
        }
        let _ = self.tx.send(fresh);
        self.save();
    }

    fn note(&self, source: &str, status: impl Into<String>, kept: usize) {
        self.status.lock().expect("news status").insert(source.to_string(), (status.into(), kept, now_secs()));
    }

    fn list(&self, kind: Option<&str>, limit: usize) -> Vec<NewsItem> {
        self.items.lock().expect("news items").iter().filter(|it| kind.is_none_or(|k| k == "all" || it.kind == k)).take(limit).cloned().collect()
    }
}

/// On-chain events all link to the coin's page, so they are told apart by id (a coin can
/// rise, then graduate, then pump); stories by link and by headline.
fn seen_keys(it: &NewsItem) -> Vec<String> {
    if it.kind == "onchain" {
        vec![format!("i:{}", it.id)]
    } else {
        vec![format!("u:{}", it.url), format!("t:{}", title_key(&it.title))]
    }
}

#[derive(Clone)]
pub struct NewsCtx {
    pub app: Arc<crate::AppState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub news: Arc<News>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/* ---------------- Text helpers ---------------- */

/// Plain text from HTML: tags removed, common entities decoded, spaces collapsed.
pub fn plain(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
        .replace("&apos;", "'")
        .replace("&#8217;", "\u{2019}")
        .replace("&#8216;", "\u{2018}")
        .replace("&#8220;", "\u{201c}")
        .replace("&#8221;", "\u{201d}")
        .replace("&#8230;", "\u{2026}")
        .replace("&#8211;", "\u{2013}")
        .replace("&#8212;", "\u{2014}")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// At most `n` characters, cut at a word, with an ellipsis when shortened.
pub fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let cut: String = s.chars().take(n).collect();
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(a, _)| a).trim_end_matches([',', '.', ';', ':', '-']);
    format!("{cut}\u{2026}")
}

fn title_key(t: &str) -> String {
    t.to_lowercase().chars().filter(|c| c.is_alphanumeric()).take(80).collect()
}

/// Only web links.
fn web_url(u: &str) -> Option<String> {
    let u = u.trim();
    (u.starts_with("https://") || u.starts_with("http://")).then(|| u.to_string()).filter(|u| u.len() <= 2_000)
}

const SOLANA_WORDS: [&str; 14] = ["solana", "$sol", " sol ", "sol price", "phantom wallet", "raydium", "jupiter exchange", "jupiter dex", "meteora", "firedancer", "helius", "pump.fun", "pumpfun", "letsbonk"];
const MEME_WORDS: [&str; 16] = ["memecoin", "meme coin", "meme-coin", "meme token", "pump.fun", "pumpfun", "bonk", "dogwifhat", "$wif", "fartcoin", "popcat", "pengu", "$trump", "trump coin", "dogecoin", "shiba inu"];

/// Which of our topics a text is about.
pub fn topics(text: &str) -> Vec<&'static str> {
    let t = format!(" {} ", text.to_lowercase());
    let mut out = Vec::new();
    if SOLANA_WORDS.iter().any(|w| t.contains(w)) {
        out.push("solana");
    }
    if MEME_WORDS.iter().any(|w| t.contains(w)) {
        out.push("memecoin");
    }
    out
}

/// Posts that are almost always spam, paid promotion or scams.
fn spammy(title: &str) -> bool {
    let t = title.to_lowercase();
    [
        "airdrop", "giveaway", "presale", "pre-sale", "dm me", "send me", "free sol", "100x", "1000x", "guaranteed",
        "best crypto to buy", "top crypto to buy", "crypto to buy now", "next crypto to explode", "best meme coin to buy", "best memecoin to buy",
        "could make you a millionaire", "turn $", "early investors", "early buyers",
        "altcoin to buy", "coin to buy", "crypto to buy", "coins to buy",
        // Presales that pay for coverage under many outlets.
        "pepeto", "remittix", "bitcoin hyper", "little pepe", "ozak ai",
        // Price-listing pages and prediction pieces, not news.
        "price today", "live chart", "price prediction", "to usd live price", "price, chart",
    ]
    .iter()
    .any(|w| t.contains(w))
}

/// Press-release and paid-content outlets: mostly promotion, often for risky presales.
fn promo_source(source: &str) -> bool {
    let s = source.to_lowercase();
    ["openpr", "globenewswire", "prnewswire", "accesswire", "einpresswire", "newsfile", "binance square", "bitcoinethereumnews", "markets insider", "streetinsider"]
        .iter()
        .any(|w| s.contains(w))
}

/* ---------------- Feeds ---------------- */

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    /// A news site: kept only when about Solana or memecoins.
    Site,
    /// Already a Solana / memecoin search: kept as is.
    Search,
    Reddit,
    /// A YouTube channel feed; `all` keeps every video, otherwise only Solana / memecoin ones.
    Video { all: bool },
}

struct Source {
    name: &'static str,
    url: &'static str,
    kind: Kind,
    every: Duration,
}

const SOURCES: [Source; 17] = [
    Source { name: "Google News", url: "https://news.google.com/rss/search?q=solana+memecoin+OR+%22solana%22+crypto+when:1d&hl=en-US&gl=US&ceid=US:en", kind: Kind::Search, every: Duration::from_secs(120) },
    Source { name: "Google News", url: "https://news.google.com/rss/search?q=memecoin+OR+%22meme+coin%22+when:1d&hl=en-US&gl=US&ceid=US:en", kind: Kind::Search, every: Duration::from_secs(150) },
    Source { name: "Cointelegraph", url: "https://cointelegraph.com/rss", kind: Kind::Site, every: Duration::from_secs(120) },
    Source { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", kind: Kind::Site, every: Duration::from_secs(120) },
    Source { name: "Decrypt", url: "https://decrypt.co/feed", kind: Kind::Site, every: Duration::from_secs(120) },
    Source { name: "The Block", url: "https://www.theblock.co/rss.xml", kind: Kind::Site, every: Duration::from_secs(150) },
    Source { name: "Blockworks", url: "https://blockworks.co/feed", kind: Kind::Site, every: Duration::from_secs(150) },
    Source { name: "CryptoSlate", url: "https://cryptoslate.com/feed/", kind: Kind::Site, every: Duration::from_secs(180) },
    Source { name: "NewsBTC", url: "https://www.newsbtc.com/feed/", kind: Kind::Site, every: Duration::from_secs(180) },
    Source { name: "U.Today", url: "https://u.today/rss", kind: Kind::Site, every: Duration::from_secs(180) },
    Source { name: "Solana", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC9AdQPUe4BdVJ8M9X7wxHUA", kind: Kind::Video { all: true }, every: Duration::from_secs(600) },
    Source { name: "CoinDesk", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC7TghOL755nBk7HelHoi9LQ", kind: Kind::Video { all: false }, every: Duration::from_secs(600) },
    Source { name: "Cointelegraph", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCRqBu-grVX1p97WaX4d-OuQ", kind: Kind::Video { all: false }, every: Duration::from_secs(600) },
    Source { name: "Decrypt", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC-dmTM1R31S8uFgPmexxkNg", kind: Kind::Video { all: false }, every: Duration::from_secs(600) },
    Source { name: "Bankless", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCAl9Ld79qaZxp9JzEOwd3aA", kind: Kind::Video { all: false }, every: Duration::from_secs(600) },
    Source { name: "r/solana", url: "solana", kind: Kind::Reddit, every: Duration::from_secs(300) },
    Source { name: "r/memecoins", url: "memecoins", kind: Kind::Reddit, every: Duration::from_secs(300) },
];

/// Parses an RSS or Atom document into items.
fn parse_feed(src: &Source, body: &[u8]) -> Vec<NewsItem> {
    let Ok(feed) = feed_rs::parser::parse(body) else { return Vec::new() };
    let now = now_secs();
    let mut out = Vec::new();
    for e in feed.entries {
        let Some(link) = e.links.first().and_then(|l| web_url(&l.href)) else { continue };
        let mut title = e.title.map(|t| plain(&t.content)).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        // Google News titles end with " - Publisher": show the publisher as the source.
        let mut source = src.name.to_string();
        if src.kind == Kind::Search {
            if let Some((t, publisher)) = title.rsplit_once(" - ") {
                if !publisher.is_empty() && publisher.len() <= 60 {
                    source = publisher.to_string();
                    title = t.to_string();
                }
            }
        }
        // A picture: the feed's media (thumbnail first), https only.
        let image = e
            .media
            .iter()
            .flat_map(|m| m.thumbnails.iter().map(|t| t.image.uri.clone()).chain(m.content.iter().filter(|c| c.content_type.as_ref().is_none_or(|t| t.to_string().starts_with("image/"))).filter_map(|c| c.url.as_ref().map(|u| u.to_string()))))
            .find(|u| u.starts_with("https://") && u.len() <= 600);
        // YouTube entries are "yt:video:<id>".
        let video = e.id.strip_prefix("yt:video:").filter(|v| v.len() == 11 && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).map(String::from);
        let media_text = e.media.iter().filter_map(|m| m.description.as_ref().map(|d| d.content.clone())).next().unwrap_or_default();
        let summary_raw = e.summary.map(|s| plain(&s.content)).or_else(|| e.content.and_then(|c| c.body).map(|b| plain(&b))).unwrap_or_else(|| plain(&media_text));
        let summary_raw = summary_raw.replace("submitted by", "").replace("[link] [comments]", "");
        let ts = e.published.or(e.updated).map_or(now, |d| d.timestamp());
        let text = format!("{title} {summary_raw}");
        let mut tags = topics(&text);
        if spammy(&title) || promo_source(&source) {
            continue;
        }
        match src.kind {
            Kind::Site | Kind::Video { all: false } if tags.is_empty() => continue,
            Kind::Video { all: true } if !tags.contains(&"solana") => tags.insert(0, "solana"),
            Kind::Video { .. } if video.is_none() => continue,
            Kind::Reddit if src.name.contains("solana") && !tags.contains(&"solana") => tags.insert(0, "solana"),
            Kind::Reddit if src.name.contains("meme") && !tags.contains(&"memecoin") => tags.push("memecoin"),
            _ => {}
        }
        let summary = clip(summary_raw.trim(), SUMMARY_CHARS);
        out.push(NewsItem {
            id: format!("{:x}", fxhash(&link)),
            kind: match src.kind {
                Kind::Reddit => "community",
                Kind::Video { .. } => "video",
                _ => "news",
            },
            source,
            title: clip(&title, 200),
            summary: (summary.len() > 20 && !src.kind.eq(&Kind::Search)).then_some(summary),
            url: link,
            ts,
            tags,
            mint: None,
            image,
            video,
            coins: Vec::new(),
            alert: None,
            x_url: None,
        });
    }
    out
}

fn fxhash(s: &str) -> u64 {
    // FNV-1a: a short stable id, not security sensitive.
    s.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

/* ---------------- Reddit (needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET) ---------------- */

/// An application-only Reddit token, refreshed before it expires.
#[derive(Default)]
struct RedditAuth {
    token: Option<(String, Instant)>,
}

async fn reddit_token(http: &reqwest::Client, auth: &mut RedditAuth, id: &str, secret: &str) -> Result<String, String> {
    if let Some((t, until)) = &auth.token {
        if Instant::now() < *until {
            return Ok(t.clone());
        }
    }
    let res = http
        .post("https://www.reddit.com/api/v1/access_token")
        .basic_auth(id, Some(secret))
        .header("user-agent", "kixo-news/0.1")
        .form(&[("grant_type", "client_credentials")])
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Reddit unreachable".to_string())?;
    if !res.status().is_success() {
        return Err(format!("Reddit login refused (HTTP {})", res.status().as_u16()));
    }
    let v: Value = res.json().await.map_err(|_| "bad Reddit login reply".to_string())?;
    let token = v["access_token"].as_str().ok_or("no Reddit token")?.to_string();
    let secs = v["expires_in"].as_u64().unwrap_or(3600).saturating_sub(120);
    auth.token = Some((token.clone(), Instant::now() + Duration::from_secs(secs)));
    Ok(token)
}

/// Hot posts of a subreddit that people actually upvoted.
fn parse_reddit(src: &Source, v: &Value) -> Vec<NewsItem> {
    let mut out = Vec::new();
    for c in v["data"]["children"].as_array().cloned().unwrap_or_default() {
        let d = &c["data"];
        if d["stickied"].as_bool() == Some(true) || d["over_18"].as_bool() == Some(true) || d["score"].as_i64().unwrap_or(0) < 20 {
            continue;
        }
        let (Some(title), Some(permalink)) = (d["title"].as_str(), d["permalink"].as_str()) else { continue };
        let title = plain(title);
        if spammy(&title) || !permalink.starts_with('/') {
            continue;
        }
        let body = plain(d["selftext"].as_str().unwrap_or(""));
        let mut tags = topics(&format!("{title} {body}"));
        if src.url == "solana" && !tags.contains(&"solana") {
            tags.insert(0, "solana");
        }
        if src.url.contains("meme") && !tags.contains(&"memecoin") {
            tags.push("memecoin");
        }
        let summary = clip(&body, SUMMARY_CHARS);
        out.push(NewsItem {
            id: format!("r{}", d["id"].as_str().unwrap_or(permalink)),
            kind: "community",
            source: src.name.to_string(),
            title: clip(&title, 200),
            summary: (summary.len() > 20).then_some(summary),
            url: format!("https://www.reddit.com{permalink}"),
            ts: d["created_utc"].as_f64().map_or_else(now_secs, |t| t as i64),
            tags,
            mint: None,
            image: d["thumbnail"].as_str().filter(|u| u.starts_with("https://")).map(String::from),
            video: None,
            coins: Vec::new(),
            alert: None,
            x_url: None,
        });
    }
    out
}

/* ---------------- X (needs X_BEARER_TOKEN) ---------------- */

async fn poll_x(http: &reqwest::Client, token: &str) -> Result<Vec<NewsItem>, String> {
    let q = "(solana OR memecoin OR pumpfun OR \"meme coin\") -is:retweet -is:reply lang:en";
    let res = http
        .get("https://api.twitter.com/2/tweets/search/recent")
        .bearer_auth(token)
        .query(&[("query", q), ("max_results", "50"), ("tweet.fields", "created_at,public_metrics,author_id"), ("expansions", "author_id"), ("user.fields", "username,name,verified")])
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("X answered {}", res.status()));
    }
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    let users: HashMap<String, (String, String)> = v["includes"]["users"]
        .as_array()
        .map(|a| a.iter().filter_map(|u| Some((u["id"].as_str()?.to_string(), (u["username"].as_str()?.to_string(), u["name"].as_str().unwrap_or("").to_string())))).collect())
        .unwrap_or_default();
    let mut out = Vec::new();
    for t in v["data"].as_array().cloned().unwrap_or_default() {
        let likes = t["public_metrics"]["like_count"].as_u64().unwrap_or(0);
        let reposts = t["public_metrics"]["retweet_count"].as_u64().unwrap_or(0);
        // Only posts people actually engaged with: most of the stream is spam.
        if likes + reposts * 2 < 25 {
            continue;
        }
        let (Some(id), Some(text)) = (t["id"].as_str(), t["text"].as_str()) else { continue };
        if spammy(text) {
            continue;
        }
        let (user, name) = users.get(t["author_id"].as_str().unwrap_or("")).cloned().unwrap_or_default();
        let ts = t["created_at"].as_str().and_then(|s| chrono_like(s)).unwrap_or_else(now_secs);
        out.push(NewsItem {
            id: format!("x{id}"),
            kind: "x",
            source: if name.is_empty() { format!("@{user}") } else { format!("{name} (@{user})") },
            title: clip(&plain(text), 240),
            summary: None,
            url: format!("https://x.com/{}/status/{id}", if user.is_empty() { "i" } else { &user }),
            ts,
            tags: topics(text),
            mint: None,
            image: None,
            video: None,
            coins: Vec::new(),
            alert: None,
            x_url: None,
        });
    }
    Ok(out)
}

/// RFC 3339 time to Unix seconds, through the feed parser's date support.
fn chrono_like(s: &str) -> Option<i64> {
    let xml = format!("<rss version=\"2.0\"><channel><item><title>x</title><link>https://x</link><pubDate>{s}</pubDate></item></channel></rss>");
    feed_rs::parser::parse(xml.as_bytes()).ok()?.entries.first()?.published.map(|d| d.timestamp())
}

/* ---------------- On-chain events (our engine) ---------------- */

#[derive(Default)]
struct ChainSeen {
    started: bool,
    rising: HashSet<String>,
    graduated: HashSet<String>,
    million: HashSet<String>,
    dev_out: HashSet<String>,
    sniped: HashSet<String>,
    /// Last pump and trending alert per coin (unix seconds), for the cool-downs.
    pump_at: HashMap<String, i64>,
    trend_at: HashMap<String, i64>,
    whale_at: HashMap<String, Instant>,
}

/// A sudden pump: up this much in 5 minutes on real volume, any coin on the board
/// (new launches and established Discover coins alike). One alert per coin per 30 min.
const PUMP_5M_PCT: f64 = 25.0;
const PUMP_VOL_5M_USD: f64 = 15_000.0;
const PUMP_MC_USD: f64 = 50_000.0;
const PUMP_EVERY_SECS: i64 = 1800;
/// Suddenly trending: at least this much traded in 5 minutes, and those 5 minutes are at
/// least TREND_SHARE of the whole last hour (about 3.5x its usual pace). One per coin per hour.
const TREND_VOL_5M_USD: f64 = 25_000.0;
const TREND_SHARE: f64 = 0.3;
const TREND_EVERY_SECS: i64 = 3600;
/// Sniped at launch: this many wallets bought in the first 3 seconds, on a coin that went
/// on to get real traction (so it is news, not one of thousands of dead launches).
const SNIPED_WALLETS: u32 = 10;
/// Holders a coin needs before its graduation (or a whale buy in it) is news.
const GRADUATED_HOLDERS: u64 = 50;
const SNIPED_MC_USD: f64 = 25_000.0;
const SNIPED_HOLDERS: u32 = 40;
/// At most this many pump and trending alerts per scan, strongest first, so a market-wide
/// move does not flood the feed.
const MOVERS_PER_SCAN: usize = 4;

/// A pump on a coin known from the market provider: real liquidity and none of the
/// red flags we can see there (mint or freeze authority, a few wallets holding most,
/// bot-only trading).
fn pumping_market(m: &crate::jupiter::MarketToken) -> bool {
    m.change_5m_pct.is_some_and(|p| p >= PUMP_5M_PCT)
        && m.volume_5m_usd.is_some_and(|v| v >= PUMP_VOL_5M_USD)
        && m.mc_usd.unwrap_or(0.0) >= PUMP_MC_USD
        && m.liquidity_usd.unwrap_or(0.0) >= 15_000.0
        && market_clean(m)
}

fn trending_market(m: &crate::jupiter::MarketToken) -> bool {
    let (v5, v1h) = (m.volume_5m_usd.unwrap_or(0.0), m.volume_1h_usd.unwrap_or(0.0));
    v5 >= TREND_VOL_5M_USD && v1h > 0.0 && v5 / v1h >= TREND_SHARE && m.change_5m_pct.unwrap_or(0.0) >= 0.0 && m.liquidity_usd.unwrap_or(0.0) >= 15_000.0 && market_clean(m)
}

fn market_clean(m: &crate::jupiter::MarketToken) -> bool {
    // A brand-new coin often has no organic score yet (0); many distinct traders count instead.
    let organic = m.organic_score.is_none_or(|o| o >= 15.0) || m.traders_1h.is_some_and(|t| t >= 250);
    m.mint_authority_disabled && m.freeze_authority_disabled != Some(false) && m.top_holders_pct.is_none_or(|p| p <= 50.0) && organic
}

/// The same checks for coins our own engine decoded, which also knows the dev and bundles.
fn own_clean(m: &monexa_ingest::market::MarketSnapshot) -> bool {
    !m.dev_sold_all && m.top10_pct <= 50.0 && m.dev_pct <= 15.0 && m.bundle_pct <= 30.0
}

fn pumping_own(m: &monexa_ingest::market::MarketSnapshot, sol_usd: f64) -> bool {
    m.change_5m_pct.is_some_and(|p| p >= PUMP_5M_PCT) && m.volume_5m_sol * sol_usd >= PUMP_VOL_5M_USD && m.mc_usd.unwrap_or(0.0) >= PUMP_MC_USD && own_clean(m)
}

fn trending_own(m: &monexa_ingest::market::MarketSnapshot, sol_usd: f64) -> bool {
    m.volume_5m_sol * sol_usd >= TREND_VOL_5M_USD && m.volume_1h_sol > 0.0 && m.volume_5m_sol / m.volume_1h_sol >= TREND_SHARE && m.change_5m_pct.unwrap_or(0.0) >= 0.0 && own_clean(m)
}

fn sniped(age_secs: i64, m: &monexa_ingest::market::MarketSnapshot) -> bool {
    age_secs <= RISING_MAX_AGE_SECS && m.snipers >= SNIPED_WALLETS && m.mc_usd.unwrap_or(0.0) >= SNIPED_MC_USD && m.holders >= SNIPED_HOLDERS
}

/// Whether a cool-down has passed, and if so starts the next one.
fn cooled(map: &mut HashMap<String, i64>, mint: &str, now: i64, every: i64) -> bool {
    if map.get(mint).is_some_and(|t| now - t < every) {
        return false;
    }
    map.insert(mint.to_string(), now);
    if map.len() > 5_000 {
        map.retain(|_, t| now - *t < every);
    }
    true
}

/// "1 minute", "12 minutes", "3 hours", "2 days".
fn span(secs: i64) -> String {
    let (n, unit) = if secs < 3600 { ((secs / 60).max(1), "minute") } else if secs < 86_400 { (secs / 3600, "hour") } else { (secs / 86_400, "day") };
    format!("{n} {unit}{}", if n == 1 { "" } else { "s" })
}

fn change_line(label: &str, p: Option<f64>) -> String {
    p.map(|p| format!(" · {label} {}{:.0}%", if p >= 0.0 { "+" } else { "" }, p)).unwrap_or_default()
}

fn usd_short(v: f64) -> String {
    if v >= 1e9 {
        format!("${:.2}B", v / 1e9)
    } else if v >= 1e6 {
        format!("${:.2}M", v / 1e6)
    } else if v >= 1e3 {
        format!("${:.0}K", v / 1e3)
    } else {
        format!("${v:.0}")
    }
}

struct Chain<'a> {
    alert: &'static str,
    mint: &'a str,
    symbol: &'a str,
    image: Option<String>,
    x_url: Option<String>,
}

fn chain_item(c: Chain, id: String, title: String, summary: Option<String>, ts: i64) -> NewsItem {
    let Chain { alert, mint, symbol, image, x_url } = c;
    NewsItem {
        id,
        kind: "onchain",
        source: "Kixo on-chain".into(),
        title,
        summary,
        url: format!("/token/{mint}"),
        ts,
        tags: vec!["solana", "memecoin"],
        mint: Some(mint.to_string()),
        image,
        video: None,
        coins: (!symbol.is_empty()).then(|| vec![CoinTag { mint: mint.to_string(), symbol: symbol.to_string() }]).unwrap_or_default(),
        alert: Some(alert),
        x_url,
    }
}

/// A new coin "taking off": young, real market cap and holders, no red flags in who
/// holds it. Often seen here before anyone tweets about it.
const RISING_MAX_AGE_SECS: i64 = 1800;
const RISING_MC_USD: f64 = 50_000.0;
const RISING_HOLDERS: u32 = 80;

fn rising(age_secs: i64, m: &monexa_ingest::market::MarketSnapshot, rugged_before: bool) -> bool {
    age_secs <= RISING_MAX_AGE_SECS
        && m.mc_usd.unwrap_or(0.0) >= RISING_MC_USD
        && m.holders >= RISING_HOLDERS
        && !m.dev_sold_all
        && m.top10_pct <= 40.0
        && m.dev_pct <= 10.0
        && m.bundle_pct <= 30.0
        && !rugged_before
}

/// The same "taking off" rule for coins known only from the market provider (when our
/// own stream has not decoded them, or is down). Dev holdings are not known there, so
/// it also needs both authorities revoked and real (not bot) trading.
fn rising_market(age_secs: i64, m: &crate::jupiter::MarketToken) -> bool {
    age_secs <= RISING_MAX_AGE_SECS
        && m.mc_usd.unwrap_or(0.0) >= RISING_MC_USD
        && m.holders.unwrap_or(0) >= RISING_HOLDERS as u64
        && m.top_holders_pct.is_some_and(|p| p <= 40.0)
        && m.mint_authority_disabled
        && m.freeze_authority_disabled != Some(false)
        && m.organic_score.is_none_or(|o| o >= 20.0)
}

fn scan_board(c: &NewsCtx, seen: &mut ChainSeen) -> Vec<NewsItem> {
    let now = now_secs();
    let board = c.app.board.lock().expect("board lock");
    let sol_usd = board.sol_usd.unwrap_or(0.0);
    let mut out = Vec::new();
    // Pump and trending candidates as (strength, kind, item); the strongest few are kept.
    let mut movers: Vec<(f64, &'static str, NewsItem)> = Vec::new();
    for m in board.markets.all() {
        if board.tokens.contains_key(&m.mint) {
            continue; // our own engine covers it, with dev data
        }
        let sym = if m.symbol.trim().is_empty() { "A coin".to_string() } else { format!("${}", m.symbol.trim()) };
        let image = m.image.clone().filter(|u| u.starts_with("https://"));
        let x_url = m.twitter.clone().filter(|u| u.starts_with("https://x.com/") || u.starts_with("https://twitter.com/"));
        let who = |alert| Chain { alert, mint: &m.mint, symbol: m.symbol.trim(), image: image.clone(), x_url: x_url.clone() };
        let mc = m.mc_usd.unwrap_or(0.0);
        let created = m.created_at.as_deref().and_then(chrono_like);
        // The provider compares a coin younger than an hour with its launch price.
        let young = created.is_some_and(|c| now - c < 3600);
        if pumping_market(&m) && !seen.pump_at.get(&m.mint).is_some_and(|t| now - t < PUMP_EVERY_SECS) {
            let p = m.change_5m_pct.unwrap_or(0.0);
            movers.push((
                p,
                "pump",
                chain_item(
                    who("pump"),
                    format!("pump:{}:{now}", m.mint),
                    format!("{sym} is up {p:.0}% in 5 minutes"),
                    Some(format!("Market cap {} · {} traded in 5 min{}", usd_short(mc), usd_short(m.volume_5m_usd.unwrap_or(0.0)), change_line(if young { "since launch" } else { "1h" }, m.change_1h_pct))),
                    now,
                ),
            ));
        } else if trending_market(&m) && !seen.trend_at.get(&m.mint).is_some_and(|t| now - t < TREND_EVERY_SECS) {
            let (v5, v1h) = (m.volume_5m_usd.unwrap_or(0.0), m.volume_1h_usd.unwrap_or(1.0));
            let traders = m.traders_1h.map(|t| format!(" · {t} traders in 1h")).unwrap_or_default();
            movers.push((
                v5 / v1h * 100.0,
                "trending",
                chain_item(
                    who("trending"),
                    format!("trend:{}:{now}", m.mint),
                    format!("{sym} is suddenly trending: {} traded in the last 5 minutes", usd_short(v5)),
                    Some(format!("{:.0}% of its last hour's volume · market cap {}{traders}", v5 / v1h * 100.0, usd_short(mc))),
                    now,
                ),
            ));
        }
        let Some(created) = created else { continue };
        let age = (now - created).max(0);
        if !(rising_market(age, &m) && seen.rising.insert(m.mint.clone()) && (seen.started || age <= 900)) {
            continue;
        }
        let sym = if m.symbol.trim().is_empty() { "A new coin".to_string() } else { sym };
        let mins = (age / 60).max(1);
        let vol = m.volume_1h_usd.map(|v| format!(" · {} volume", usd_short(v))).unwrap_or_default();
        out.push(chain_item(
            who("rising"),
            format!("rise:{}", m.mint),
            format!("{sym} is taking off: {} market cap {mins} min after launch", usd_short(mc)),
            Some(format!("{} holders · top 10 hold {:.0}%{vol}", m.holders.unwrap_or(0), m.top_holders_pct.unwrap_or(0.0))),
            now,
        ));
    }
    for t in board.tokens.values() {
        let Some(m) = &t.market else { continue };
        let mint = &t.token.mint;
        let sym = if t.token.symbol.trim().is_empty() { "A new coin".to_string() } else { format!("${}", t.token.symbol.trim()) };
        let mc = m.mc_usd.unwrap_or(0.0);
        let age = (now - t.token.timestamp).max(0);
        let mins = (age / 60).max(1);
        let image = t.meta.as_ref().and_then(|x| x.image.clone()).filter(|u| u.starts_with("https://"));
        let x_url = t.meta.as_ref().and_then(|x| x.twitter.clone()).filter(|u| u.starts_with("https://x.com/") || u.starts_with("https://twitter.com/"));
        let who = |alert| Chain { alert, mint, symbol: t.token.symbol.trim(), image: image.clone(), x_url: x_url.clone() };
        let rugged_before = t.dev_report.as_ref().is_some_and(|d| d.rugged > 0);
        // Our own count only sees trades since this gateway started; the market provider counts from launch.
        let holders = board.markets.get(mint).and_then(|j| j.holders).unwrap_or(m.holders as u64);
        // On start-up, coins already taking off are still news while they are young.
        if rising(age, m, rugged_before) && seen.rising.insert(mint.clone()) && (seen.started || age <= 900) {
            let vol = m.volume_1h_usd.map(|v| format!(" · {} volume", usd_short(v))).unwrap_or_default();
            out.push(chain_item(
                who("rising"),
                format!("rise:{mint}"),
                format!("{sym} is taking off: {} market cap {mins} min after launch", usd_short(mc)),
                Some(format!("{} holders · top 10 hold {:.0}% · dev {:.1}%{vol}", holders, m.top10_pct, m.dev_pct)),
                now,
            ));
        }
        // A curve filled within a minute by a handful of wallets is the dev's own bundle, not
        // news: graduation and milestones need a real crowd and a clean dev and bundle record.
        let crowd = |n: u64| holders >= n && own_clean(m);
        if m.complete && crowd(GRADUATED_HOLDERS) && seen.graduated.insert(mint.clone()) && seen.started {
            out.push(chain_item(who("graduated"), format!("grad:{mint}"), format!("{sym} graduated from its bonding curve"), Some(format!("Market cap {} · {} holders · launched {} ago", usd_short(mc), holders, span(age))), now));
        }
        if mc >= 1_000_000.0 && crowd(100) && seen.million.insert(mint.clone()) && seen.started {
            out.push(chain_item(who("million"), format!("1m:{mint}"), format!("{sym} passed $1M market cap"), Some(format!("{} after launch, {} holders", span(age), holders)), now));
        }
        if m.dev_sold_all && mc >= 100_000.0 && seen.dev_out.insert(mint.clone()) && seen.started {
            out.push(chain_item(who("dev_out"), format!("dev:{mint}"), format!("The dev of {sym} sold everything"), Some(format!("Market cap {}", usd_short(mc))), now));
        }
        if sniped(age, m) && seen.sniped.insert(mint.clone()) && (seen.started || age <= 900) {
            // Honest either way: snipers still holding a lot is a risk, snipers gone is not.
            let hold = if m.sniper_pct >= 5.0 { format!("Snipers still hold {:.0}%", m.sniper_pct) } else { "Snipers have mostly sold".to_string() };
            out.push(chain_item(
                who("sniped"),
                format!("snipe:{mint}"),
                format!("{sym} was sniped at launch: {} wallets bought in the first 3 seconds", m.snipers),
                Some(format!("{hold} · market cap {} · {} holders", usd_short(mc), holders)),
                now,
            ));
        }
        if sol_usd > 0.0 && pumping_own(m, sol_usd) && !seen.pump_at.get(mint).is_some_and(|t| now - t < PUMP_EVERY_SECS) {
            let p = m.change_5m_pct.unwrap_or(0.0);
            movers.push((
                p,
                "pump",
                chain_item(
                    who("pump"),
                    format!("pump:{mint}:{now}"),
                    format!("{sym} is up {p:.0}% in 5 minutes"),
                    Some(format!("Market cap {} · {} traded in 5 min · {} holders", usd_short(mc), usd_short(m.volume_5m_sol * sol_usd), holders)),
                    now,
                ),
            ));
        } else if sol_usd > 0.0 && trending_own(m, sol_usd) && !seen.trend_at.get(mint).is_some_and(|t| now - t < TREND_EVERY_SECS) {
            let share = m.volume_5m_sol / m.volume_1h_sol * 100.0;
            movers.push((
                share,
                "trending",
                chain_item(
                    who("trending"),
                    format!("trend:{mint}:{now}"),
                    format!("{sym} is suddenly trending: {} traded in the last 5 minutes", usd_short(m.volume_5m_sol * sol_usd)),
                    Some(format!("{share:.0}% of its last hour's volume · market cap {}", usd_short(mc))),
                    now,
                ),
            ));
        }
    }
    drop(board);
    for kind in ["pump", "trending"] {
        let mut these: Vec<_> = movers.iter().filter(|(_, k, _)| *k == kind).collect();
        these.sort_by(|a, b| b.0.total_cmp(&a.0));
        for (_, _, it) in these.into_iter().take(MOVERS_PER_SCAN) {
            let mint = it.mint.as_deref().unwrap_or_default();
            let (map, every) = if kind == "pump" { (&mut seen.pump_at, PUMP_EVERY_SECS) } else { (&mut seen.trend_at, TREND_EVERY_SECS) };
            if cooled(map, mint, now, every) {
                out.push(it.clone());
            }
        }
    }
    seen.started = true;
    out
}

/// Whale buys: at least this much SOL in one trade, at most one item per coin per 10 minutes.
const WHALE_SOL: f64 = 25.0;

/* ---------------- Coins named in a story ---------------- */

/// Words that look like tickers but are not coins.
const NOT_COINS: [&str; 24] = ["THE", "AND", "FOR", "ETF", "ETFS", "SEC", "USD", "CEO", "NEW", "ATH", "NFT", "NFTS", "DEX", "CEX", "API", "USA", "BTC", "ETH", "SOL", "XRP", "CEO", "IPO", "WHY", "HOW"];

/// Established coins (verified, or $5M+ market cap with real liquidity) by ticker and
/// by distinctive name. When a ticker is shared, the biggest coin wins.
fn coin_index(markets: &[crate::jupiter::MarketToken]) -> (HashMap<String, CoinTag>, Vec<(String, CoinTag)>) {
    let mut by_sym: HashMap<String, (f64, CoinTag)> = HashMap::new();
    let mut by_name: Vec<(String, f64, CoinTag)> = Vec::new();
    for m in markets {
        let mc = m.mc_usd.unwrap_or(0.0);
        let solid = m.verified || (mc >= 5_000_000.0 && m.liquidity_usd.unwrap_or(0.0) >= 200_000.0);
        let sym = m.symbol.trim().to_uppercase();
        if !solid || sym.len() < 3 || sym.len() > 10 || NOT_COINS.contains(&sym.as_str()) {
            continue;
        }
        let tag = CoinTag { mint: m.mint.clone(), symbol: m.symbol.trim().to_string() };
        if by_sym.get(&sym).is_none_or(|(best, _)| mc > *best) {
            by_sym.insert(sym, (mc, tag.clone()));
        }
        let name = m.name.trim().to_lowercase();
        if name.len() >= 6 && !["solana", "bitcoin", "ethereum", "wrapped sol"].contains(&name.as_str()) {
            by_name.push((name, mc, tag));
        }
    }
    by_name.sort_by(|a, b| b.1.total_cmp(&a.1));
    (by_sym.into_iter().map(|(k, (_, t))| (k, t)).collect(), by_name.into_iter().map(|(n, _, t)| (n, t)).collect())
}

/// The coins a headline (and intro) names: "$TICKER" anywhere, an all-caps ticker of
/// four or more letters in the headline, or a coin's distinctive full name. At most 3.
fn coins_in(title: &str, summary: &str, idx: &(HashMap<String, CoinTag>, Vec<(String, CoinTag)>)) -> Vec<CoinTag> {
    let mut out: Vec<CoinTag> = Vec::new();
    let mut push = |t: &CoinTag| {
        if out.len() < 3 && !out.iter().any(|o| o.mint == t.mint) {
            out.push(t.clone());
        }
    };
    let text = format!("{title} {summary}");
    for w in text.split(|c: char| !(c.is_alphanumeric() || c == '$')) {
        if let Some(sym) = w.strip_prefix('$') {
            if let Some(t) = idx.0.get(&sym.to_uppercase()) {
                push(t);
            }
        }
    }
    for w in title.split(|c: char| !c.is_alphanumeric()) {
        if w.len() >= 4 && w.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
            if let Some(t) = idx.0.get(w) {
                push(t);
            }
        }
    }
    let lower = format!(" {} ", text.to_lowercase().replace(|c: char| !c.is_alphanumeric(), " "));
    for (name, t) in &idx.1 {
        let n = name.replace(|c: char| !c.is_alphanumeric(), " ");
        if lower.contains(&format!(" {} ", n.split_whitespace().collect::<Vec<_>>().join(" "))) {
            push(t);
        }
    }
    out
}

fn tag_coins(c: &NewsCtx, items: &mut [NewsItem]) {
    let markets = c.app.board.lock().expect("board lock").markets.all();
    let idx = coin_index(&markets);
    for it in items.iter_mut().filter(|it| it.kind != "onchain") {
        it.coins = coins_in(&it.title, it.summary.as_deref().unwrap_or(""), &idx);
    }
}

/* ---------------- Engine ---------------- */

pub async fn run(c: NewsCtx) {
    let mut due: Vec<Instant> = SOURCES.iter().enumerate().map(|(i, _)| Instant::now() + Duration::from_secs(i as u64 * 4)).collect();
    let mut x_due = Instant::now();
    let x_token = monexa_common::secret("X_BEARER_TOKEN").filter(|t| t.len() > 20);
    let reddit_keys = monexa_common::secret("REDDIT_CLIENT_ID").zip(monexa_common::secret("REDDIT_CLIENT_SECRET")).filter(|(a, b)| !a.is_empty() && !b.is_empty());
    let mut reddit_auth = RedditAuth::default();
    let mut chain = ChainSeen::default();
    // Alerts restored from the saved feed keep their cool-downs, so a restart does not
    // post the same coin's pump again a few minutes later.
    for it in c.news.list(Some("onchain"), MAX_ITEMS) {
        let Some(mint) = it.mint.clone() else { continue };
        match it.alert {
            Some("pump") => {
                chain.pump_at.entry(mint).and_modify(|t| *t = (*t).max(it.ts)).or_insert(it.ts);
            }
            Some("trending") => {
                chain.trend_at.entry(mint).and_modify(|t| *t = (*t).max(it.ts)).or_insert(it.ts);
            }
            _ => {}
        }
    }
    let mut trades = c.app.trades.subscribe();
    let mut tick = tokio::time::interval(Duration::from_secs(10));
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if !c.admin.news() {
                    continue;
                }
                let found = scan_board(&c, &mut chain);
                c.news.add(found);
                // At most two feeds per tick, so no site sees a burst.
                let now = Instant::now();
                let ready: Vec<usize> = (0..SOURCES.len()).filter(|&i| due[i] <= now).take(2).collect();
                for i in ready {
                    let src = &SOURCES[i];
                    due[i] = now + src.every;
                    if src.kind == Kind::Reddit {
                        let Some((id, secret)) = &reddit_keys else {
                            c.news.note(src.name, "off: needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET", 0);
                            due[i] = now + Duration::from_secs(3600);
                            continue;
                        };
                        let result = async {
                            let token = reddit_token(&c.app.http, &mut reddit_auth, id, secret).await?;
                            let r = c.app.http
                                .get(format!("https://oauth.reddit.com/r/{}/hot?limit=40&raw_json=1", src.url))
                                .bearer_auth(token)
                                .header("user-agent", "kixo-news/0.1")
                                .timeout(Duration::from_secs(12))
                                .send()
                                .await
                                .map_err(|_| "Reddit unreachable".to_string())?;
                            if r.status().as_u16() == 429 {
                                return Err("rate limited".to_string());
                            }
                            if !r.status().is_success() {
                                return Err(format!("HTTP {}", r.status().as_u16()));
                            }
                            r.json::<Value>().await.map_err(|_| "bad Reddit reply".to_string())
                        }
                        .await;
                        match result {
                            Ok(v) => {
                                let mut items = parse_reddit(src, &v);
                                tag_coins(&c, &mut items);
                                c.news.note(src.name, "ok", items.len());
                                c.news.add(items);
                            }
                            Err(e) => {
                                if e.contains("rate") {
                                    due[i] = now + Duration::from_secs(600);
                                }
                                c.news.note(src.name, e, 0);
                            }
                        }
                        continue;
                    }
                    let res = c.app.http.get(src.url).header("user-agent", "kixo-news/0.1").timeout(Duration::from_secs(12)).send().await;
                    let label = match src.kind {
                        Kind::Search => format!("{} {}", src.name, i + 1),
                        Kind::Video { .. } => format!("YouTube {}", src.name),
                        _ => src.name.to_string(),
                    };
                    match res {
                        Ok(r) if r.status().as_u16() == 429 => {
                            // Rate limited: wait 10 minutes before asking this source again.
                            due[i] = now + Duration::from_secs(600);
                            c.news.note(&label, "rate limited, retry in 10 min", 0);
                        }
                        Ok(r) if r.status().is_success() => {
                            if let Ok(body) = r.bytes().await {
                                let mut items = parse_feed(src, &body);
                                tag_coins(&c, &mut items);
                                c.news.note(&label, "ok", items.len());
                                c.news.add(items);
                            }
                        }
                        Ok(r) => c.news.note(&label, format!("HTTP {}", r.status().as_u16()), 0),
                        Err(e) => c.news.note(&label, if e.is_timeout() { "timeout".to_string() } else { "unreachable".to_string() }, 0),
                    }
                }
                if let Some(tok) = &x_token {
                    if x_due <= now {
                        x_due = now + Duration::from_secs(180);
                        match poll_x(&c.app.http, tok).await {
                            Ok(mut items) => {
                                tag_coins(&c, &mut items);
                                c.news.note("X", "ok", items.len());
                                c.news.add(items);
                            }
                            Err(e) => {
                                tracing::warn!(%e, "X news");
                                c.news.note("X", e, 0);
                            }
                        }
                    }
                }
            }
            trade = trades.recv() => {
                let Ok((mint, row)) = trade else { continue };
                if !row.is_buy || row.sol < WHALE_SOL || !c.admin.news() {
                    continue;
                }
                if chain.whale_at.get(&mint).is_some_and(|t| t.elapsed() < Duration::from_secs(600)) {
                    continue;
                }
                chain.whale_at.insert(mint.clone(), Instant::now());
                if chain.whale_at.len() > 5_000 {
                    chain.whale_at.retain(|_, t| t.elapsed() < Duration::from_secs(600));
                }
                let found = c.app.board.lock().expect("board lock").tokens.get(&mint).filter(|t| {
                    // Same bar as graduation: a 38 SOL buy into a one-minute coin with a dozen
                    // holders is usually the dev's own wallet, not a whale.
                    t.market.as_ref().is_some_and(|m| m.holders as u64 >= GRADUATED_HOLDERS && own_clean(m))
                }).map(|t| {
                    (
                        t.token.symbol.trim().to_string(),
                        t.meta.as_ref().and_then(|x| x.image.clone()).filter(|u| u.starts_with("https://")),
                        t.meta.as_ref().and_then(|x| x.twitter.clone()).filter(|u| u.starts_with("https://x.com/") || u.starts_with("https://twitter.com/")),
                    )
                });
                let Some((sym, image, x_url)) = found.filter(|f| !f.0.is_empty()) else { continue };
                let usd = c.app.board.lock().expect("board lock").sol_usd.map(|p| format!(" ({})", usd_short(row.sol * p))).unwrap_or_default();
                c.news.add(vec![chain_item(Chain { alert: "whale", mint: &mint, symbol: &sym, image, x_url }, format!("whale:{}", row.signature), format!("Whale bought {:.0} SOL{usd} of ${sym}", row.sol), Some(format!("Market cap {:.0} SOL after the buy", row.mc_sol)), row.ts.max(now_secs() - 60))]);
            }
        }
    }
}

/* ---------------- HTTP and WebSocket ---------------- */

#[derive(Deserialize)]
pub struct ListQuery {
    kind: Option<String>,
    limit: Option<usize>,
}

/// `GET /news?kind=news|community|x|onchain&limit=`: the feed, newest first.
pub async fn list(State(c): State<NewsCtx>, Query(q): Query<ListQuery>) -> Json<Value> {
    if !c.admin.news() {
        return Json(json!({ "enabled": false, "items": [] }));
    }
    let items = c.news.list(q.kind.as_deref(), q.limit.unwrap_or(100).min(MAX_ITEMS));
    let mut sources: Vec<Value> = c.news.status.lock().expect("news status").iter().map(|(k, (s, n, at))| json!({ "source": k, "status": s, "kept": n, "at": at })).collect();
    sources.sort_by(|a, b| a["source"].as_str().cmp(&b["source"].as_str()));
    Json(json!({ "enabled": true, "x": monexa_common::secret("X_BEARER_TOKEN").is_some_and(|t| t.len() > 20), "sources": sources, "items": items }))
}

/// `/ws/news`: the latest items, then each new batch as it arrives.
pub async fn ws(ws: WebSocketUpgrade, State(c): State<NewsCtx>) -> Response {
    ws.on_upgrade(move |socket| stream(socket, c))
}

async fn stream(mut socket: WebSocket, c: NewsCtx) {
    let mut rx = c.news.tx.subscribe();
    let first = json!({ "type": "snapshot", "items": c.news.list(None, 150) });
    if socket.send(Message::Text(first.to_string().into())).await.is_err() {
        return;
    }
    let mut ping = tokio::time::interval(Duration::from_secs(25));
    loop {
        tokio::select! {
            _ = ping.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    return;
                }
            }
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {}
            },
            batch = rx.recv() => match batch {
                Ok(items) => {
                    let msg = json!({ "type": "items", "items": items });
                    if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movers_and_snipes_follow_the_rules() {
        use crate::jupiter::MarketToken;
        let clean = MarketToken { mint: "M".into(), mc_usd: Some(2e6), liquidity_usd: Some(1e5), mint_authority_disabled: true, top_holders_pct: Some(20.0), organic_score: Some(60.0), ..Default::default() };
        let pump = MarketToken { change_5m_pct: Some(40.0), volume_5m_usd: Some(50_000.0), ..clean.clone() };
        assert!(pumping_market(&pump));
        assert!(!pumping_market(&MarketToken { volume_5m_usd: Some(2_000.0), ..pump.clone() }), "thin volume is not a pump");
        assert!(!pumping_market(&MarketToken { mint_authority_disabled: false, ..pump.clone() }), "mint authority still on");
        assert!(!pumping_market(&MarketToken { top_holders_pct: Some(80.0), ..pump.clone() }), "a few wallets hold most");
        assert!(!pumping_market(&MarketToken { organic_score: Some(0.0), traders_1h: Some(40), ..pump.clone() }), "bot trading");
        assert!(pumping_market(&MarketToken { organic_score: Some(0.0), traders_1h: Some(600), ..pump.clone() }), "no score yet, many traders");
        let trend = MarketToken { volume_5m_usd: Some(40_000.0), volume_1h_usd: Some(100_000.0), change_5m_pct: Some(3.0), ..clean.clone() };
        assert!(trending_market(&trend));
        assert!(!trending_market(&MarketToken { volume_1h_usd: Some(1_000_000.0), ..trend.clone() }), "steady volume is not sudden");
        assert!(!trending_market(&MarketToken { change_5m_pct: Some(-12.0), ..trend.clone() }), "a dump is not trending");

        use monexa_ingest::market::MarketSnapshot;
        let s = MarketSnapshot { mc_usd: Some(60_000.0), holders: 120, snipers: 14, sniper_pct: 22.0, ..Default::default() };
        assert!(sniped(300, &s));
        assert!(!sniped(300, &MarketSnapshot { snipers: 3, ..s.clone() }));
        assert!(!sniped(300, &MarketSnapshot { mc_usd: Some(4_000.0), ..s.clone() }), "dead launches are not news");
        assert!(!sniped(7_200, &s), "old coins are not news");
        let own = MarketSnapshot { change_5m_pct: Some(30.0), volume_5m_sol: 300.0, volume_1h_sol: 500.0, mc_usd: Some(300_000.0), top10_pct: 25.0, ..Default::default() };
        assert!(pumping_own(&own, 150.0) && trending_own(&own, 150.0));
        assert!(!pumping_own(&MarketSnapshot { dev_sold_all: true, ..own.clone() }, 150.0));

        let mut at = HashMap::new();
        assert!(cooled(&mut at, "M", 1000, 1800));
        assert!(!cooled(&mut at, "M", 2000, 1800));
        assert!(cooled(&mut at, "M", 2900, 1800));
    }

    #[test]
    fn one_coin_can_have_several_onchain_events() {
        let n = News::new();
        let ev = |id: &str| NewsItem { id: id.into(), kind: "onchain", source: "Kixo on-chain".into(), title: format!("$X {id}"), summary: None, url: "/token/X".into(), ts: now_secs(), tags: vec![], mint: Some("X".into()), image: None, video: None, coins: vec![], alert: Some("pump"), x_url: None };
        n.add(vec![ev("rise:X")]);
        n.add(vec![ev("grad:X")]);
        n.add(vec![ev("grad:X")]);
        assert_eq!(n.list(None, 10).len(), 2, "same link, different events; repeats dropped");
    }

    #[test]
    fn the_feed_survives_a_restart() {
        let path = std::env::temp_dir().join(format!("kixo-news-{}.json", std::process::id()));
        let p = path.to_str().unwrap();
        let _ = std::fs::remove_file(&path);
        let a = News::stored(p);
        let pump = NewsItem { id: "pump:X:1".into(), kind: "onchain", source: "Kixo on-chain".into(), title: "$X is up 40% in 5 minutes".into(), summary: Some("Market cap $1M".into()), url: "/token/X".into(), ts: now_secs(), tags: vec!["solana"], mint: Some("X".into()), image: None, video: None, coins: vec![CoinTag { mint: "X".into(), symbol: "X".into() }], alert: Some("pump"), x_url: None };
        let old = NewsItem { id: "old".into(), kind: "news", ts: now_secs() - MAX_AGE_SECS - 10, url: "https://a.b/old".into(), title: "Old".into(), alert: None, ..pump.clone() };
        a.add(vec![pump.clone()]);
        let b = News::stored(p);
        let back = b.list(None, 10);
        assert_eq!(back, vec![pump.clone()], "restored as it was");
        b.add(vec![pump, old]);
        assert_eq!(b.list(None, 10).len(), 1, "a restored alert is not posted twice, a stale story is not added");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn text_is_cleaned_and_topics_found() {
        assert_eq!(plain("<p>Solana&#8217;s <b>memecoin</b> run &amp; more</p>"), "Solana\u{2019}s memecoin run & more");
        assert_eq!(clip("one two three four", 9), "one two\u{2026}");
        assert_eq!(topics("Solana memecoin season is back"), vec!["solana", "memecoin"]);
        assert!(topics("Bitcoin ETF flows hit a record").is_empty());
        assert!(topics("The SOL price jumped").contains(&"solana"));
        assert!(spammy("FREE SOL AIRDROP claim now"));
        assert!(spammy("4 Best Crypto To Buy In November 2026 as Solana ETFs shed"));
        assert!(promo_source("openPR.com") && !promo_source("CoinDesk"));
        assert!(promo_source("StreetInsider"));
        assert!(spammy("Best Altcoin to Buy: Ether Funds Shed $93 Million as Early Buyers Pick Pepeto Before the Crowd"));
        assert!(spammy("Remittix Earn, Zcash or Solana? $1.3M TVL in Four Days"));
        assert!(!spammy("Whales buy the dip as Solana memecoins rebound"));
        assert!(spammy("Catecoin (cate.meme) price today, CATE to USD live price, marketcap and chart"));
        assert!(spammy("Solana Price Prediction: SOL to $500?"));
        assert!(chrono_like("2026-11-07T10:00:00.000Z").is_some_and(|t| t > 1_700_000_000), "X times parse");
        assert_eq!(web_url("javascript:alert(1)"), None);
        assert_eq!(web_url(" https://a.b/c ").as_deref(), Some("https://a.b/c"));
    }

    #[test]
    fn feeds_parse_and_filter() {
        let rss = br#"<rss version="2.0"><channel><title>Site</title>
            <item><title>Solana DEX volume tops Ethereum</title><link>https://site.com/a</link><description>&lt;p&gt;Solana leads again this week.&lt;/p&gt;</description><pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate></item>
            <item><title>Bitcoin miners sell</title><link>https://site.com/b</link><pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate></item>
            <item><title>Bad link</title><link>javascript:alert(1)</link></item>
        </channel></rss>"#;
        let src = Source { name: "Site", url: "", kind: Kind::Site, every: Duration::from_secs(1) };
        let items = parse_feed(&src, rss);
        assert_eq!(items.len(), 1, "only the Solana story with a web link");
        assert_eq!(items[0].title, "Solana DEX volume tops Ethereum");
        assert_eq!(items[0].tags, vec!["solana"]);
        let g = br#"<rss version="2.0"><channel><item><title>Memecoins rally as BONK jumps - CoinDesk</title><link>https://news.google.com/x</link></item></channel></rss>"#;
        let gsrc = Source { name: "Google News", url: "", kind: Kind::Search, every: Duration::from_secs(1) };
        let gi = parse_feed(&gsrc, g);
        assert_eq!(gi[0].source, "CoinDesk");
        assert_eq!(gi[0].title, "Memecoins rally as BONK jumps");
    }

    #[test]
    fn reddit_listing_keeps_upvoted_posts() {
        let v = serde_json::json!({ "data": { "children": [
            { "data": { "id": "a", "title": "Solana validators upgrade tonight", "permalink": "/r/solana/comments/a/x/", "score": 150, "created_utc": 1794000000.0, "selftext": "" } },
            { "data": { "id": "b", "title": "FREE SOL airdrop", "permalink": "/r/solana/comments/b/x/", "score": 500, "created_utc": 1794000000.0 } },
            { "data": { "id": "c", "title": "my first post", "permalink": "/r/solana/comments/c/x/", "score": 2, "created_utc": 1794000000.0 } },
            { "data": { "id": "d", "title": "Weekly thread", "permalink": "/r/solana/comments/d/x/", "score": 900, "stickied": true, "created_utc": 1794000000.0 } }
        ] } });
        let src = Source { name: "r/solana", url: "solana", kind: Kind::Reddit, every: Duration::from_secs(1) };
        let items = parse_reddit(&src, &v);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://www.reddit.com/r/solana/comments/a/x/");
        assert_eq!(items[0].kind, "community");
        assert!(items[0].tags.contains(&"solana"));
    }

    #[test]
    fn coins_are_found_by_ticker_and_name() {
        let tag = |m: &str, s: &str| CoinTag { mint: m.into(), symbol: s.into() };
        let mut sym = HashMap::new();
        sym.insert("BONK".to_string(), tag("bonk-mint", "Bonk"));
        sym.insert("WIF".to_string(), tag("wif-mint", "WIF"));
        let idx = (sym, vec![("dogwifhat".to_string(), tag("wif-mint", "WIF"))]);
        let found = coins_in("BONK jumps 20% as $wif follows", "", &idx);
        assert_eq!(found.iter().map(|c| c.symbol.as_str()).collect::<Vec<_>>(), vec!["WIF", "Bonk"]);
        assert_eq!(coins_in("Dogwifhat holders rally", "", &idx).len(), 1, "full name");
        assert!(coins_in("Bonk mention in lower case is not a ticker", "", &idx).is_empty());
    }

    #[test]
    fn youtube_entries_become_videos() {
        let xml = br#"<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
          <entry><id>yt:video:vIYEi-GARaw</id><yt:videoId>vIYEi-GARaw</yt:videoId><title>Solana Breakpoint recap</title>
            <link rel="alternate" href="https://www.youtube.com/watch?v=vIYEi-GARaw"/><published>2026-11-07T10:00:00+00:00</published>
            <media:group><media:title>Solana Breakpoint recap</media:title><media:thumbnail url="https://i3.ytimg.com/vi/vIYEi-GARaw/hqdefault.jpg" width="480" height="360"/><media:description>Highlights from the stage</media:description></media:group>
          </entry></feed>"#;
        let src = Source { name: "Solana", url: "", kind: Kind::Video { all: true }, every: Duration::from_secs(1) };
        let items = parse_feed(&src, xml);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "video");
        assert_eq!(items[0].video.as_deref(), Some("vIYEi-GARaw"));
        assert_eq!(items[0].image.as_deref(), Some("https://i3.ytimg.com/vi/vIYEi-GARaw/hqdefault.jpg"));
    }

    #[test]
    fn rising_coins_need_real_traction_and_no_red_flags() {
        let good = monexa_ingest::market::MarketSnapshot { mc_usd: Some(120_000.0), holders: 150, top10_pct: 18.0, dev_pct: 2.0, bundle_pct: 5.0, ..Default::default() };
        assert!(rising(300, &good, false), "young, $120K, 150 holders, clean");
        assert!(!rising(2_400, &good, false), "older than 30 minutes is not new");
        assert!(!rising(300, &good, true), "dev rugged before");
        assert!(!rising(300, &monexa_ingest::market::MarketSnapshot { holders: 20, ..good.clone() }, false), "few holders");
        assert!(!rising(300, &monexa_ingest::market::MarketSnapshot { dev_sold_all: true, ..good.clone() }, false), "dev sold out");
        assert!(!rising(300, &monexa_ingest::market::MarketSnapshot { top10_pct: 60.0, ..good.clone() }, false), "top 10 hold too much");
        assert!(!rising(300, &monexa_ingest::market::MarketSnapshot { mc_usd: Some(20_000.0), ..good }, false), "too small");
    }

    #[test]
    fn market_coins_rise_only_with_clean_authorities_and_real_trading() {
        let mut m = crate::jupiter::MarketToken {
            mint: "m".into(),
            symbol: "NEW".into(),
            mc_usd: Some(150_000.0),
            holders: Some(300),
            top_holders_pct: Some(20.0),
            mint_authority_disabled: true,
            freeze_authority_disabled: Some(true),
            organic_score: Some(45.0),
            ..Default::default()
        };
        assert!(rising_market(240, &m));
        m.organic_score = Some(5.0);
        assert!(!rising_market(240, &m), "mostly bot trading");
        m.organic_score = Some(45.0);
        m.mint_authority_disabled = false;
        assert!(!rising_market(240, &m), "mint authority active");
        m.mint_authority_disabled = true;
        assert!(!rising_market(3_600, &m), "an hour old is not new");
        assert!(chrono_like("2026-11-07T10:11:01Z").is_some(), "provider times parse");
    }

    #[test]
    fn duplicates_are_dropped() {
        let n = News::new();
        let it = |url: &str, title: &str| NewsItem { id: url.into(), kind: "news", source: "S".into(), title: title.into(), summary: None, url: url.into(), ts: now_secs(), tags: vec![], mint: None, image: None, video: None, coins: vec![], alert: None, x_url: None };
        n.add(vec![it("https://a/1", "Solana hits a record"), it("https://b/2", "Solana hits a record!"), it("https://a/1", "Other")]);
        assert_eq!(n.list(None, 10).len(), 1);
    }
}
