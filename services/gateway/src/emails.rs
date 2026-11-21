//! Email templates, editable in the admin (Admin, Emails).
//!
//! Every email Kixo sends from the gateway is a template here: a subject, a heading, a
//! body and a button label, with {{variables}} filled in when it is sent. The defaults
//! live in this file; what the admin changes is saved in `data/emails.json`, and each
//! template has its own on/off switch. All of them share one layout (Kixo mark, card,
//! footer), so they look the same everywhere.
//!
//! Text the admin writes is plain text: a blank line starts a new paragraph and
//! **double stars** make bold. Everything is HTML-escaped, values included.
//!
//! Sending is through Resend (`RESEND_API_KEY`, sender `ALERTS_EMAIL_FROM`). Without a
//! verified domain Resend only delivers to the Resend account's own address, so tests
//! from the admin go to OWNER_EMAIL.

use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const FILE: &str = "data/emails.json";

/* ---------------- Templates ---------------- */

pub struct Template {
    pub key: &'static str,
    pub group: &'static str,
    pub name: &'static str,
    /// When it is sent, for the admin.
    pub about: &'static str,
    /// (variable, sample value for previews and tests)
    pub vars: &'static [(&'static str, &'static str)],
    pub subject: &'static str,
    pub heading: &'static str,
    pub body: &'static str,
    pub button: &'static str,
    /// The fixed line at the bottom: why this person gets this email.
    pub footer: &'static str,
}

const ALERT_FOOTER: &str = "You get this because email alerts are on in your Kixo account. Turn them off in Settings, Notifications.";

pub const TEMPLATES: &[Template] = &[
    Template {
        key: "alert_price",
        group: "Alerts",
        name: "Price alert",
        about: "A coin's market cap crossed the level the user set. Sent once, then the alert is removed.",
        vars: &[("symbol", "FROG"), ("direction", "above"), ("target", "$50.0K"), ("mc", "$52.4K"), ("link", "https://kixo.trade/token/example")],
        subject: "{{symbol}} market cap is {{direction}} {{target}}",
        heading: "{{symbol}} crossed your level",
        body: "**{{symbol}}** is at **{{mc}}** market cap now, {{direction}} the {{target}} you set.\n\nThis alert is done and has been removed. Set a new one on the coin page.",
        button: "Open {{symbol}}",
        footer: ALERT_FOOTER,
    },
    Template {
        key: "alert_wallet",
        group: "Alerts",
        name: "Wallet Monitor trade",
        about: "A wallet the user follows in Wallet Monitor bought (or sold, if they asked) a coin.",
        vars: &[("wallet", "Whale 3"), ("action", "bought"), ("symbol", "FROG"), ("sol", "12.50"), ("worth", "about $2.1K"), ("link", "https://kixo.trade/token/example")],
        subject: "{{wallet}} {{action}} {{symbol}}",
        heading: "{{wallet}} {{action}} {{symbol}}",
        body: "**{{wallet}}** {{action}} **{{symbol}}** for **{{sol}} SOL** ({{worth}}).\n\nCheck the coin's safety score and chart before you follow a trade.",
        button: "Open {{symbol}}",
        footer: ALERT_FOOTER,
    },
    Template {
        key: "alert_dev",
        group: "Alerts",
        name: "Dev is selling",
        about: "The creator of a coin the user starred started selling.",
        vars: &[("symbol", "FROG"), ("sol", "4.20"), ("worth", "about $710"), ("link", "https://kixo.trade/token/example")],
        subject: "Dev is selling {{symbol}}",
        heading: "The dev of {{symbol}} is selling",
        body: "The creator of **{{symbol}}**, a coin you starred, just sold **{{sol}} SOL** ({{worth}}).\n\nA dev selling early is one of the most common signs of a rug.",
        button: "Open {{symbol}}",
        footer: ALERT_FOOTER,
    },
    Template {
        key: "alert_x",
        group: "Alerts",
        name: "X Tracker post",
        about: "An X account the user tracks posted about a coin.",
        vars: &[("handle", "solwolf"), ("text", "Just aped into $FROG, chart looks clean"), ("link", "https://x.com/solwolf/status/example")],
        subject: "@{{handle}} posted a coin",
        heading: "@{{handle}} posted a coin",
        body: "@{{handle}} on X:\n\n{{text}}",
        button: "Open the post",
        footer: ALERT_FOOTER,
    },
    Template {
        key: "alert_test",
        group: "Alerts",
        name: "Test alert",
        about: "The user pressed \"Send a test\" in Settings, Notifications.",
        vars: &[("link", "https://kixo.trade")],
        subject: "Kixo test alert",
        heading: "Your alerts work",
        body: "Alerts reach you here, even when Kixo is closed.\n\nPrice alerts, Wallet Monitor trades and dev sells on your starred coins will arrive at this address.",
        button: "Open Kixo",
        footer: ALERT_FOOTER,
    },
];

pub fn template(key: &str) -> Option<&'static Template> {
    TEMPLATES.iter().find(|t| t.key == key)
}

/* ---------------- Saved edits ---------------- */

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Edit {
    pub on: bool,
    pub subject: String,
    pub heading: String,
    pub body: String,
    pub button: String,
}

impl Edit {
    fn default_of(t: &Template) -> Self {
        Self { on: true, subject: t.subject.into(), heading: t.heading.into(), body: t.body.into(), button: t.button.into() }
    }

    /// Lengths and only known {{variables}}.
    fn validate(&self, t: &Template) -> Result<(), String> {
        for (name, v, min, max) in [("Subject", &self.subject, 1, 150), ("Heading", &self.heading, 0, 150), ("Text", &self.body, 1, 4000), ("Button", &self.button, 0, 40)] {
            let n = v.trim().chars().count();
            if n < min || n > max {
                return Err(format!("{name}: {min} to {max} characters"));
            }
        }
        for v in [&self.subject, &self.heading, &self.body, &self.button] {
            for name in placeholders(v) {
                if !t.vars.iter().any(|(k, _)| *k == name) {
                    return Err(format!("{{{{{name}}}}} is not a variable of this email"));
                }
            }
        }
        Ok(())
    }
}

fn store() -> &'static Mutex<HashMap<String, Edit>> {
    static S: OnceLock<Mutex<HashMap<String, Edit>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(std::fs::read(FILE).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()))
}

fn current(t: &Template) -> Edit {
    store().lock().expect("emails lock").get(t.key).cloned().unwrap_or_else(|| Edit::default_of(t))
}

fn save(map: &HashMap<String, Edit>) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
    let tmp = format!("{FILE}.tmp");
    std::fs::create_dir_all("data").and_then(|_| std::fs::write(&tmp, json)).and_then(|_| std::fs::rename(&tmp, FILE)).map_err(|e| e.to_string())
}

/* ---------------- Rendering ---------------- */

/// Names inside {{ }} in a text.
fn placeholders(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(i) = rest.find("{{") {
        let after = &rest[i + 2..];
        let Some(j) = after.find("}}") else { break };
        out.push(after[..j].trim().to_string());
        rest = &after[j + 2..];
    }
    out
}

fn fill(s: &str, vars: &[(&str, String)]) -> String {
    let mut out = s.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// Escaped text with **bold**.
fn inline(s: &str) -> String {
    let e = esc(s);
    let mut out = String::new();
    for (i, part) in e.split("**").enumerate() {
        if i % 2 == 1 {
            out.push_str("<strong style=\"color:#ededed;font-weight:600\">");
            out.push_str(part);
            out.push_str("</strong>");
        } else {
            out.push_str(part);
        }
    }
    if e.matches("**").count() % 2 == 1 {
        // An unclosed ** : show the text as written instead of a half-bold email.
        return e;
    }
    out
}

fn site() -> String {
    crate::alerts::site()
}

pub struct Rendered {
    pub subject: String,
    pub html: String,
    pub text: String,
}

/// One email from a template and its values. `link` is the button's address.
pub fn render(t: &Template, e: &Edit, vars: &[(&str, String)]) -> Rendered {
    let link = vars.iter().find(|(k, _)| *k == "link").map(|(_, v)| v.clone()).filter(|l| l.starts_with("https://") || l.starts_with("http://"));
    let subject: String = fill(&e.subject, vars).chars().filter(|c| !c.is_control()).collect::<String>().trim().to_string();
    let heading = fill(&e.heading, vars);
    let body = fill(&e.body, vars);
    let button = fill(&e.button, vars);

    let paras: Vec<String> = body.replace("\r\n", "\n").split("\n\n").map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
    let body_html: String = paras
        .iter()
        .map(|p| format!("<p style=\"margin:0 0 14px;font-size:15px;line-height:1.6;color:#a1a1a6\">{}</p>", inline(p).replace('\n', "<br>")))
        .collect();
    let heading_html = if heading.trim().is_empty() {
        String::new()
    } else {
        format!("<h1 style=\"margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:#ededed\">{}</h1>", inline(heading.trim()))
    };
    let button_html = match (&link, button.trim().is_empty()) {
        (Some(l), false) => format!(
            "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:8px 0 4px\"><tr><td style=\"border-radius:8px;background:#34d399\"><a href=\"{}\" style=\"display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#04140c;text-decoration:none;border-radius:8px\">{}</a></td></tr></table>",
            esc(l),
            esc(button.trim())
        ),
        _ => String::new(),
    };
    let home = site();
    let html = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#08090a;font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#08090a"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 18px"><a href="{home}" style="text-decoration:none;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#ededed">Kixo<span style="color:#34d399">.</span></a></td></tr>
<tr><td style="background:#0e0f11;border:1px solid #1d1e21;border-radius:12px;padding:28px 26px">{heading}{body}{button}</td></tr>
<tr><td style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:#85858b">{footer}<br><a href="{home}" style="color:#85858b;text-decoration:underline">kixo</a> · Trading memecoins is risky. Kixo never asks for your seed phrase.</td></tr>
</table></td></tr></table></body></html>"#,
        title = esc(&subject),
        preheader = esc(&paras.first().map(|p| p.replace("**", "")).unwrap_or_default()),
        heading = heading_html,
        body = body_html,
        button = button_html,
        footer = esc(t.footer),
    );

    let mut text = String::new();
    if !heading.trim().is_empty() {
        text.push_str(&heading.replace("**", ""));
        text.push_str("\n\n");
    }
    text.push_str(&paras.iter().map(|p| p.replace("**", "")).collect::<Vec<_>>().join("\n\n"));
    if let Some(l) = &link {
        text.push_str(&format!("\n\n{}: {l}", button.trim()));
    }
    text.push_str(&format!("\n\n{}", t.footer));
    Rendered { subject, html, text }
}

/// The email for a live event, or None when that template is switched off.
pub fn for_event(key: &str, vars: &[(&str, String)]) -> Option<Rendered> {
    let t = template(key)?;
    let e = current(t);
    e.on.then(|| render(t, &e, vars))
}

fn samples(t: &Template) -> Vec<(&'static str, String)> {
    t.vars.iter().map(|(k, v)| (*k, v.to_string())).collect()
}

/* ---------------- Sending ---------------- */

pub fn ready() -> bool {
    monexa_common::secret("RESEND_API_KEY").is_some()
}

pub fn sender() -> String {
    monexa_common::secret("ALERTS_EMAIL_FROM").unwrap_or_else(|| "Kixo <onboarding@resend.dev>".into())
}

/// Sends one email through Resend; whether Resend accepted it.
pub async fn send(http: &reqwest::Client, to: &str, m: &Rendered) -> Result<(), String> {
    let key = monexa_common::secret("RESEND_API_KEY").ok_or("RESEND_API_KEY is not set (Admin, API keys)")?;
    let r = http
        .post("https://api.resend.com/emails")
        .bearer_auth(key)
        .json(&json!({ "from": sender(), "to": [to], "subject": m.subject, "html": m.html, "text": m.text }))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Resend did not answer".to_string())?;
    if r.status().is_success() {
        return Ok(());
    }
    let status = r.status().as_u16();
    let msg = r.json::<Value>().await.ok().and_then(|v| v["message"].as_str().map(String::from)).unwrap_or_default();
    tracing::warn!(status, "email not sent");
    Err(format!("Resend refused it ({status}): {}", msg.chars().take(200).collect::<String>()))
}

/* ---------------- Admin routes ---------------- */

#[derive(Clone)]
pub struct EmailsCtx {
    pub http: reqwest::Client,
}

type ApiErr = (StatusCode, Json<Value>);

fn err(status: StatusCode, message: &str) -> ApiErr {
    (status, Json(json!({ "message": message })))
}

fn need_admin(headers: &HeaderMap) -> Result<(), ApiErr> {
    if crate::admin::is_admin(headers) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Wrong admin key"))
    }
}

fn view(t: &Template) -> Value {
    json!({
        "key": t.key, "group": t.group, "name": t.name, "about": t.about, "footer": t.footer,
        "vars": t.vars.iter().map(|(k, v)| json!({ "name": k, "sample": v })).collect::<Vec<_>>(),
        "default": Edit::default_of(t),
        "current": current(t),
    })
}

/// `GET /admin/emails`: every template with its default and saved text.
pub async fn list(headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    Ok(Json(json!({
        "templates": TEMPLATES.iter().map(view).collect::<Vec<_>>(),
        "ready": ready(),
        "sender": sender(),
        "test_to": crate::platform::owner_email().map(|e| crate::wallet::mask(&e)),
    })))
}

/// `PUT /admin/emails/{key}`: saves a template's text and switch.
pub async fn put(ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Path(key): Path<String>, Json(e): Json<Edit>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let t = template(&key).ok_or_else(|| err(StatusCode::NOT_FOUND, "No such email"))?;
    e.validate(t).map_err(|m| err(StatusCode::BAD_REQUEST, &m))?;
    let before = current(t);
    let snapshot = {
        let mut m = store().lock().expect("emails lock");
        if e == Edit::default_of(t) {
            m.remove(t.key);
        } else {
            m.insert(t.key.to_string(), e.clone());
        }
        m.clone()
    };
    save(&snapshot).map_err(|m| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("could not save: {m}")))?;
    crate::platform::audit(Some(addr), &format!("email {}", t.key), crate::platform::diff(&json!(before), &json!(e)));
    Ok(Json(view(t)))
}

/// `POST /admin/emails/{key}/preview`: the email as it would be sent, with sample values.
pub async fn preview(headers: HeaderMap, Path(key): Path<String>, Json(e): Json<Edit>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let t = template(&key).ok_or_else(|| err(StatusCode::NOT_FOUND, "No such email"))?;
    let r = render(t, &e, &samples(t));
    Ok(Json(json!({ "subject": r.subject, "html": r.html, "text": r.text, "problem": e.validate(t).err() })))
}

/// `POST /admin/emails/{key}/test`: sends the email (as edited, unsaved is fine) to the
/// owner's address with sample values. Ten tests an hour.
pub async fn test(State(c): State<EmailsCtx>, headers: HeaderMap, Path(key): Path<String>, Json(e): Json<Edit>) -> Result<Json<Value>, ApiErr> {
    need_admin(&headers)?;
    let t = template(&key).ok_or_else(|| err(StatusCode::NOT_FOUND, "No such email"))?;
    e.validate(t).map_err(|m| err(StatusCode::BAD_REQUEST, &m))?;
    let to = crate::platform::owner_email().ok_or_else(|| err(StatusCode::BAD_REQUEST, "Set OWNER_EMAIL in .env first: tests go to the owner"))?;
    {
        static TESTS: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
        let mut v = TESTS.lock().expect("tests lock");
        v.retain(|at| at.elapsed() < Duration::from_secs(3600));
        if v.len() >= 10 {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "Ten test emails an hour. Try again later"));
        }
        v.push(Instant::now());
    }
    let mut r = render(t, &e, &samples(t));
    r.subject = format!("[Test] {}", r.subject);
    send(&c.http, &to, &r).await.map_err(|m| err(StatusCode::BAD_GATEWAY, &m))?;
    Ok(Json(json!({ "sent_to": crate::wallet::mask(&to) })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        for t in TEMPLATES {
            Edit::default_of(t).validate(t).unwrap_or_else(|e| panic!("{}: {e}", t.key));
            let r = render(t, &Edit::default_of(t), &samples(t));
            assert!(!r.html.contains("{{"), "{} left a variable unfilled", t.key);
            assert!(!r.text.contains("{{"), "{} left a variable unfilled", t.key);
        }
    }

    #[test]
    fn values_are_escaped() {
        let t = template("alert_x").unwrap();
        let r = render(t, &Edit::default_of(t), &[("handle", "a".into()), ("text", "<script>x</script> **hi**".into()), ("link", "https://x.com".into())]);
        assert!(!r.html.contains("<script>"));
        assert!(r.html.contains("&lt;script&gt;"));
    }

    #[test]
    fn unknown_variables_are_refused() {
        let t = template("alert_price").unwrap();
        let mut e = Edit::default_of(t);
        e.body = "Hi {{name}}".into();
        assert!(e.validate(t).is_err());
    }

    #[test]
    fn bad_links_get_no_button() {
        let t = template("alert_test").unwrap();
        let r = render(t, &Edit::default_of(t), &[("link", "javascript:alert(1)".into())]);
        assert!(!r.html.contains("javascript:"));
    }
}
