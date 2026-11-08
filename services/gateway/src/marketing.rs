//! Marketing tools in the admin: tracking links with a sign-up funnel, promo codes that
//! discount Kixo's fees, a scheduled banner and popup (also used for broadcasts), and the
//! social links and search text of the site.
//!
//! - Settings: `data/marketing.json`. Which campaign brought each account:
//!   `data/attribution.json`. Promo codes in use: `data/redemptions.json`.
//! - A tracking link is the site address with `?c=CODE`. The browser reports one visit per
//!   campaign per day, and the campaign again once the visitor signs up.
//! - Promo codes change what users pay, so creating one needs the owner session.
//!   A discount only ever lowers a fee, never raises it.

use crate::account::AccountState;
use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MARKETING_FILE: &str = "data/marketing.json";
const ATTRIBUTION_FILE: &str = "data/attribution.json";
const REDEMPTIONS_FILE: &str = "data/redemptions.json";

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct Campaign {
    pub code: String,
    pub name: String,
    pub created: i64,
    pub visits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct Promo {
    pub code: String,
    /// "trade", "transfer" or "both".
    pub applies: String,
    /// Share of Kixo's fee taken off, 1 to 100.
    pub discount_pct: u32,
    /// Unix seconds; 0 means it never expires.
    pub expires: i64,
    /// 0 means no limit.
    pub max_uses: u32,
    pub uses: u32,
    pub active: bool,
    pub created: i64,
}

/// A line above every page, or a popup shown once to each visitor. `audience` is
/// "all", "signed_out" or "signed_in". Times are unix seconds; 0 means no limit.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct Message {
    pub on: bool,
    /// Changes whenever the popup is edited, so it shows again.
    pub id: String,
    pub title: String,
    pub text: String,
    pub link: String,
    pub link_label: String,
    pub starts: i64,
    pub ends: i64,
    pub audience: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct Site {
    pub x: String,
    pub telegram: String,
    pub discord: String,
    pub youtube: String,
    pub seo_title: String,
    pub seo_description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct Marketing {
    pub campaigns: Vec<Campaign>,
    pub promos: Vec<Promo>,
    pub banner: Message,
    pub popup: Message,
    pub site: Site,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Redemption {
    pub code: String,
    pub applies: String,
    pub discount_pct: u32,
    pub until: i64,
}

struct Store {
    m: Mutex<Marketing>,
    attribution: Mutex<HashMap<String, String>>,
    redemptions: Mutex<HashMap<String, Redemption>>,
    /// "ip|code" -> last visit counted.
    seen: Mutex<HashMap<String, Instant>>,
}

static STORE: OnceLock<Store> = OnceLock::new();

fn read<T: for<'de> Deserialize<'de> + Default>(path: &str) -> T {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn store() -> &'static Store {
    STORE.get_or_init(|| Store {
        m: Mutex::new(read(MARKETING_FILE)),
        attribution: Mutex::new(read(ATTRIBUTION_FILE)),
        redemptions: Mutex::new(read(REDEMPTIONS_FILE)),
        seen: Mutex::new(HashMap::new()),
    })
}

fn save(path: &str, value: &impl Serialize) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let tmp = format!("{path}.tmp");
    std::fs::create_dir_all("data").and_then(|_| std::fs::write(&tmp, json)).and_then(|_| std::fs::rename(&tmp, path)).map_err(|e| e.to_string())
}

/* ---------------- Fees after a promo ---------------- */

fn discounted(base: u64, user: &str, kind: &str) -> u64 {
    let r = store().redemptions.lock().expect("redemptions lock").get(user).cloned();
    match r {
        Some(r) if (r.applies == kind || r.applies == "both") && (r.until == 0 || r.until > now()) => base * (100 - r.discount_pct.min(100) as u64) / 100,
        _ => base,
    }
}

/// The trade fee this user pays, in basis points, after any promo code.
pub fn trade_fee_bps_for(user: &str) -> u64 {
    discounted(crate::platform::trade_fee_bps(), user, "trade")
}

/// The deposit fee this user pays, after any promo code.
pub fn deposit_fee_bps_for(user: &str) -> u64 {
    discounted(crate::platform::deposit_fee_bps(), user, "transfer")
}

/// The withdrawal fee this user pays, after any promo code.
pub fn withdraw_fee_bps_for(user: &str) -> u64 {
    discounted(crate::platform::withdraw_fee_bps(), user, "transfer")
}

/* ---------------- Checks ---------------- */

fn code_ok(c: &str) -> bool {
    (3..=20).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn link_ok(l: &str) -> bool {
    l.is_empty() || (l.len() <= 300 && (l.starts_with("https://") || (l.starts_with('/') && !l.starts_with("//"))) && !l.contains(char::is_whitespace))
}

fn social_ok(l: &str) -> bool {
    l.is_empty() || (l.len() <= 200 && l.starts_with("https://") && !l.contains(char::is_whitespace))
}

impl Message {
    fn validate(&self, what: &str) -> Result<(), String> {
        if self.title.len() > 80 || self.text.len() > 300 || self.link_label.len() > 30 {
            return Err(format!("{what}: title up to 80, text up to 300, button up to 30 characters"));
        }
        if !link_ok(&self.link) {
            return Err(format!("{what}: the link must start with https:// or /"));
        }
        if !["all", "signed_out", "signed_in", ""].contains(&self.audience.as_str()) {
            return Err(format!("{what}: unknown audience"));
        }
        if self.ends != 0 && self.ends <= self.starts {
            return Err(format!("{what}: it must end after it starts"));
        }
        Ok(())
    }

    fn live(&self, t: i64) -> bool {
        self.on && (!self.text.trim().is_empty() || !self.title.trim().is_empty()) && (self.starts == 0 || self.starts <= t) && (self.ends == 0 || t < self.ends)
    }
}

/* ---------------- Public ---------------- */

/// `GET /marketing`: the banner and popup live right now, the social links and the
/// search text.
pub async fn public() -> Json<Value> {
    let m = store().m.lock().expect("marketing lock").clone();
    let t = now();
    Json(json!({
        "banner": m.banner.live(t).then_some(&m.banner),
        "popup": m.popup.live(t).then_some(&m.popup),
        "site": m.site,
    }))
}

#[derive(Deserialize)]
pub struct VisitIn {
    c: String,
}

/// `POST /track/visit`: one visit from a tracking link (counted once per address per
/// campaign per day).
pub async fn visit(ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(b): Json<VisitIn>) -> StatusCode {
    let code = b.c.trim().to_lowercase();
    if !code_ok(&code) {
        return StatusCode::NO_CONTENT;
    }
    {
        let mut seen = store().seen.lock().expect("seen lock");
        if seen.len() > 100_000 {
            seen.retain(|_, at| at.elapsed() < Duration::from_secs(86_400));
        }
        let key = format!("{}|{code}", addr.ip());
        if seen.get(&key).is_some_and(|at| at.elapsed() < Duration::from_secs(86_400)) {
            return StatusCode::NO_CONTENT;
        }
        seen.insert(key, Instant::now());
    }
    let snapshot = {
        let mut m = store().m.lock().expect("marketing lock");
        let Some(c) = m.campaigns.iter_mut().find(|c| c.code == code) else { return StatusCode::NO_CONTENT };
        c.visits += 1;
        m.clone()
    };
    let _ = save(MARKETING_FILE, &snapshot);
    StatusCode::NO_CONTENT
}

#[derive(Clone)]
pub struct MarketingCtx {
    pub acct: Arc<AccountState>,
    pub ops: crate::ops::OpsCtx,
}

type ApiErr = (StatusCode, Json<Value>);

fn err(status: StatusCode, message: &str) -> ApiErr {
    (status, Json(json!({ "message": message })))
}

/// `POST /track/signup`: the campaign that brought a signed-in account (first one wins).
pub async fn signup(State(c): State<MarketingCtx>, headers: HeaderMap, Json(b): Json<VisitIn>) -> Result<StatusCode, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(|e| err(e.0, &e.1))?;
    let code = b.c.trim().to_lowercase();
    if !code_ok(&code) || !store().m.lock().expect("marketing lock").campaigns.iter().any(|c| c.code == code) {
        return Ok(StatusCode::NO_CONTENT);
    }
    let snapshot = {
        let mut a = store().attribution.lock().expect("attribution lock");
        if a.contains_key(&user.id) {
            return Ok(StatusCode::NO_CONTENT);
        }
        a.insert(user.id.clone(), code);
        a.clone()
    };
    let _ = save(ATTRIBUTION_FILE, &snapshot);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RedeemIn {
    code: String,
}

fn promo_view(user: &str) -> Value {
    let r = store().redemptions.lock().expect("redemptions lock").get(user).cloned().filter(|r| r.until == 0 || r.until > now());
    json!({
        "promo": r,
        "trade_fee_bps": trade_fee_bps_for(user),
        "deposit_fee_bps": deposit_fee_bps_for(user),
        "withdraw_fee_bps": withdraw_fee_bps_for(user),
    })
}

/// `GET /promo`: the signed-in user's promo code and the fees they pay now.
pub async fn promo_me(State(c): State<MarketingCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(|e| err(e.0, &e.1))?;
    Ok(Json(promo_view(&user.id)))
}

static REDEEM_TRIES: Mutex<Option<HashMap<String, Vec<Instant>>>> = Mutex::new(None);

/// `POST /promo/redeem`: applies a promo code to the signed-in account.
pub async fn redeem(State(c): State<MarketingCtx>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(b): Json<RedeemIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(|e| err(e.0, &e.1))?;
    {
        let mut g = REDEEM_TRIES.lock().expect("redeem lock");
        let list = g.get_or_insert_with(HashMap::new).entry(user.id.clone()).or_default();
        list.retain(|t| t.elapsed() < Duration::from_secs(3600));
        if list.len() >= 10 {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many tries, wait an hour"));
        }
        list.push(Instant::now());
    }
    let code = b.code.trim().to_uppercase();
    let t = now();
    let (promo, snapshot) = {
        let mut m = store().m.lock().expect("marketing lock");
        let Some(p) = m.promos.iter_mut().find(|p| p.code == code) else { return Err(err(StatusCode::NOT_FOUND, "That code does not exist")) };
        if !p.active || (p.expires != 0 && p.expires <= t) {
            return Err(err(StatusCode::GONE, "That code has ended"));
        }
        if p.max_uses != 0 && p.uses >= p.max_uses {
            return Err(err(StatusCode::GONE, "That code has been used up"));
        }
        if store().redemptions.lock().expect("redemptions lock").get(&user.id).is_some_and(|r| r.code == code && (r.until == 0 || r.until > t)) {
            return Ok(Json(promo_view(&user.id)));
        }
        p.uses += 1;
        (p.clone(), m.clone())
    };
    let _ = save(MARKETING_FILE, &snapshot);
    let reds = {
        let mut r = store().redemptions.lock().expect("redemptions lock");
        r.insert(user.id.clone(), Redemption { code: promo.code.clone(), applies: promo.applies.clone(), discount_pct: promo.discount_pct, until: promo.expires });
        r.clone()
    };
    let _ = save(REDEMPTIONS_FILE, &reds);
    crate::platform::audit(Some(addr), "promo_redeemed", json!({ "user": user.id, "code": promo.code }));
    Ok(Json(promo_view(&user.id)))
}

/* ---------------- Admin ---------------- */

fn need_admin(headers: &HeaderMap) -> Result<(), ApiErr> {
    if crate::admin::is_admin(headers) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Wrong admin key"))
    }
}

/// `GET /admin/marketing`: every setting, plus the funnel overall and per campaign.
pub async fn admin_get(State(c): State<MarketingCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let m = store().m.lock().expect("marketing lock").clone();
    let users = crate::ops::all_users(&c.ops).await?;
    let attribution = store().attribution.lock().expect("attribution lock").clone();
    let depositors: HashSet<String> = crate::ops::transfers().iter().filter(|t| t["kind"] == "deposit" && t["status"] == "confirmed").filter_map(|t| t["user"].as_str().map(String::from)).collect();
    let trades = c.acct.rest(reqwest::Method::GET, "real_trades?status=eq.confirmed&select=user_id&limit=100000", None).await.unwrap_or(Value::Array(vec![]));
    let traders: HashSet<String> = trades.as_array().into_iter().flatten().filter_map(|r| r["user_id"].as_str().map(String::from)).collect();
    let funnel = |ids: &[&Value]| {
        json!({
            "signups": ids.len(),
            "wallets": ids.iter().filter(|u| !u["wallet"].is_null()).count(),
            "depositors": ids.iter().filter(|u| u["id"].as_str().is_some_and(|i| depositors.contains(i))).count(),
            "traders": ids.iter().filter(|u| u["id"].as_str().is_some_and(|i| traders.contains(i))).count(),
        })
    };
    let everyone: Vec<&Value> = users.iter().collect();
    let campaigns: Vec<Value> = m
        .campaigns
        .iter()
        .map(|cmp| {
            let ids: Vec<&Value> = users.iter().filter(|u| u["id"].as_str().and_then(|i| attribution.get(i)) == Some(&cmp.code)).collect();
            let mut f = funnel(&ids);
            f["visits"] = json!(cmp.visits);
            json!({ "campaign": cmp, "funnel": f })
        })
        .collect();
    Ok(Json(json!({ "marketing": m, "funnel": funnel(&everyone), "campaigns": campaigns })))
}

#[derive(Deserialize)]
pub struct MessagesIn {
    banner: Message,
    popup: Message,
    site: Site,
}

/// `PUT /admin/marketing`: the banner, popup, social links and search text.
pub async fn admin_put(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(mut b): Json<MessagesIn>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    b.banner.validate("banner").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
    b.popup.validate("popup").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
    for (name, l) in [("X", &b.site.x), ("Telegram", &b.site.telegram), ("Discord", &b.site.discord), ("YouTube", &b.site.youtube)] {
        if !social_ok(l) {
            return Err(err(StatusCode::BAD_REQUEST, &format!("{name}: the link must start with https://")));
        }
    }
    if b.site.seo_title.len() > 70 || b.site.seo_description.len() > 200 {
        return Err(err(StatusCode::BAD_REQUEST, "search title up to 70, description up to 200 characters"));
    }
    let (before, snapshot) = {
        let mut m = store().m.lock().expect("marketing lock");
        // An edited popup gets a new id, so people who closed the old one see it again.
        if b.popup != m.popup {
            b.popup.id = format!("{:x}", now());
        }
        let before = json!({ "banner": m.banner, "popup": m.popup, "site": m.site });
        m.banner = b.banner;
        m.popup = b.popup;
        m.site = b.site;
        (before, m.clone())
    };
    save(MARKETING_FILE, &snapshot).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    let after = json!({ "banner": snapshot.banner, "popup": snapshot.popup, "site": snapshot.site });
    crate::platform::audit(Some(addr), "marketing", crate::platform::diff(&before, &after));
    Ok(Json(json!({ "marketing": snapshot })))
}

#[derive(Deserialize)]
pub struct CampaignIn {
    code: String,
    name: String,
}

/// `POST /admin/campaigns`: a new tracking link.
pub async fn campaign_add(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(b): Json<CampaignIn>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let code = b.code.trim().to_lowercase();
    if !code_ok(&code) {
        return Err(err(StatusCode::BAD_REQUEST, "code: 3 to 20 letters, digits, - or _"));
    }
    let name = b.name.trim().chars().take(60).collect::<String>();
    let snapshot = {
        let mut m = store().m.lock().expect("marketing lock");
        if m.campaigns.iter().any(|c| c.code == code) {
            return Err(err(StatusCode::CONFLICT, "That code is taken"));
        }
        if m.campaigns.len() >= 200 {
            return Err(err(StatusCode::BAD_REQUEST, "up to 200 tracking links"));
        }
        m.campaigns.push(Campaign { code: code.clone(), name, created: now(), visits: 0 });
        m.clone()
    };
    save(MARKETING_FILE, &snapshot).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    crate::platform::audit(Some(addr), "campaign_added", json!({ "code": code }));
    Ok(Json(json!({ "ok": true })))
}

/// `DELETE /admin/campaigns/{code}`.
pub async fn campaign_delete(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Path(code): Path<String>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let snapshot = {
        let mut m = store().m.lock().expect("marketing lock");
        m.campaigns.retain(|c| c.code != code);
        m.clone()
    };
    save(MARKETING_FILE, &snapshot).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    crate::platform::audit(Some(addr), "campaign_deleted", json!({ "code": code }));
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct PromoIn {
    code: String,
    applies: String,
    discount_pct: u32,
    #[serde(default)]
    expires: i64,
    #[serde(default)]
    max_uses: u32,
}

/// `POST /admin/promos`: a new promo code (owner session needed: it changes fees).
pub async fn promo_add(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(b): Json<PromoIn>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    if !crate::platform::owner_ok(&headers) {
        return Err(err(StatusCode::UNAUTHORIZED, "owner_code_required"));
    }
    let code = b.code.trim().to_uppercase();
    if !code_ok(&code) {
        return Err(err(StatusCode::BAD_REQUEST, "code: 3 to 20 letters, digits, - or _"));
    }
    if !["trade", "transfer", "both"].contains(&b.applies.as_str()) {
        return Err(err(StatusCode::BAD_REQUEST, "applies to: trade, transfer or both"));
    }
    if !(1..=100).contains(&b.discount_pct) {
        return Err(err(StatusCode::BAD_REQUEST, "discount: 1% to 100% of Kixo's fee"));
    }
    if b.expires != 0 && b.expires <= now() {
        return Err(err(StatusCode::BAD_REQUEST, "the end date has passed"));
    }
    let snapshot = {
        let mut m = store().m.lock().expect("marketing lock");
        if m.promos.iter().any(|p| p.code == code) {
            return Err(err(StatusCode::CONFLICT, "That code is taken"));
        }
        m.promos.push(Promo { code: code.clone(), applies: b.applies.clone(), discount_pct: b.discount_pct, expires: b.expires, max_uses: b.max_uses, uses: 0, active: true, created: now() });
        m.clone()
    };
    save(MARKETING_FILE, &snapshot).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    crate::platform::audit(Some(addr), "promo_added", json!({ "code": code, "applies": b.applies, "discount_pct": b.discount_pct, "expires": b.expires, "max_uses": b.max_uses }));
    Ok(Json(json!({ "ok": true })))
}

/// `POST /admin/promos/{code}/end`: stops a promo code. People who already used it keep
/// their discount until the code's end date, unless `revoke` is set.
pub async fn promo_end(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Path(code): Path<String>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let snapshot = {
        let mut m = store().m.lock().expect("marketing lock");
        let Some(p) = m.promos.iter_mut().find(|p| p.code == code) else { return Err(err(StatusCode::NOT_FOUND, "No such code")) };
        p.active = false;
        m.clone()
    };
    save(MARKETING_FILE, &snapshot).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {e}")))?;
    // Ending a code also ends the discount for everyone using it: fees go back to normal.
    let reds = {
        let mut r = store().redemptions.lock().expect("redemptions lock");
        r.retain(|_, x| x.code != code);
        r.clone()
    };
    let _ = save(REDEMPTIONS_FILE, &reds);
    crate::platform::audit(Some(addr), "promo_ended", json!({ "code": code }));
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_hold() {
        assert!(code_ok("launch-50"));
        assert!(!code_ok("a b"));
        assert!(!code_ok("x"));
        assert!(link_ok("/discover"));
        assert!(link_ok("https://kixo.app/x"));
        assert!(!link_ok("//evil.com"));
        assert!(!link_ok("javascript:alert(1)"));
        assert!(!social_ok("http://x.com/kixo"));
    }

    #[test]
    fn messages_go_live_in_their_window() {
        let m = Message { on: true, text: "Hi".into(), starts: 100, ends: 200, ..Default::default() };
        assert!(!m.live(50));
        assert!(m.live(150));
        assert!(!m.live(200));
        assert!(!Message { on: false, ..m.clone() }.live(150));
        assert!(Message { ends: 50, ..m }.validate("x").is_err());
    }

    #[test]
    fn a_promo_only_lowers_the_fee() {
        store().redemptions.lock().unwrap().insert("u1".into(), Redemption { code: "HALF".into(), applies: "trade".into(), discount_pct: 50, until: 0 });
        store().redemptions.lock().unwrap().insert("u2".into(), Redemption { code: "OLD".into(), applies: "both".into(), discount_pct: 100, until: 1 });
        let base = crate::platform::trade_fee_bps();
        assert_eq!(trade_fee_bps_for("u1"), base / 2);
        assert_eq!(withdraw_fee_bps_for("u1"), crate::platform::withdraw_fee_bps(), "a trade promo leaves transfers alone");
        assert_eq!(trade_fee_bps_for("u2"), base, "an expired promo gives nothing");
        assert_eq!(trade_fee_bps_for("nobody"), base);
    }
}
