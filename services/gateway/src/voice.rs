//! Kixo Agent's voice: the way in to Kixo's own voice service (ai/voice.py, VOICE_URL,
//! default http://127.0.0.1:8091), which speaks with Kokoro and listens with Whisper on
//! this machine. No outside speech service. Off when the admin switch "voice_agent" is off.
//!
//! `GET /voice/health` → whether the agent can speak and listen.
//! `POST /voice/tts {text, voice, speed}` → audio/wav.
//! `POST /voice/stt` raw audio → {"text": "..."}.

use axum::{
    body::Bytes,
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

#[derive(Clone)]
pub struct VoiceCtx {
    pub admin: Arc<crate::admin::AdminState>,
    pub http: reqwest::Client,
}

/// Longest line spoken at once; the browser sends a reply sentence by sentence.
const MAX_TEXT: usize = 600;

fn url() -> String {
    std::env::var("VOICE_URL").ok().filter(|u| !u.trim().is_empty()).unwrap_or_else(|| "http://127.0.0.1:8091".into())
}

fn off() -> Response {
    (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Kixo Agent is off" }))).into_response()
}

pub async fn health(State(ctx): State<VoiceCtx>) -> Json<Value> {
    if !ctx.admin.voice_agent() {
        return Json(json!({ "on": false }));
    }
    let v = ctx.http.get(format!("{}/health", url())).timeout(Duration::from_secs(3)).send().await;
    match v {
        Ok(r) if r.status().is_success() => {
            let body = r.json::<Value>().await.unwrap_or(Value::Null);
            Json(json!({ "on": true, "ready": true, "voices": body["voices"], "speech": body["tts"], "listening": body["stt"] }))
        }
        _ => Json(json!({ "on": true, "ready": false })),
    }
}

#[derive(Deserialize)]
pub struct Speak {
    text: String,
    voice: Option<String>,
    speed: Option<f64>,
}

pub async fn tts(State(ctx): State<VoiceCtx>, Json(s): Json<Speak>) -> Response {
    if !ctx.admin.voice_agent() {
        return off();
    }
    let text: String = s.text.trim().chars().take(MAX_TEXT).collect();
    if text.is_empty() {
        return (StatusCode::BAD_REQUEST, "no text").into_response();
    }
    let body = json!({ "text": text, "voice": s.voice.unwrap_or_default(), "speed": s.speed.unwrap_or(1.05) });
    let res = ctx.http.post(format!("{}/tts", url())).json(&body).timeout(Duration::from_secs(20)).send().await;
    match res {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(b) => ([(header::CONTENT_TYPE, "audio/wav"), (header::CACHE_CONTROL, "no-store")], b).into_response(),
            Err(_) => StatusCode::BAD_GATEWAY.into_response(),
        },
        _ => (StatusCode::BAD_GATEWAY, Json(json!({ "error": "the voice service is not answering" }))).into_response(),
    }
}

pub async fn stt(State(ctx): State<VoiceCtx>, audio: Bytes) -> Response {
    if !ctx.admin.voice_agent() {
        return off();
    }
    if audio.is_empty() || audio.len() > 4 << 20 {
        return (StatusCode::BAD_REQUEST, "bad audio").into_response();
    }
    let res = ctx
        .http
        .post(format!("{}/stt", url()))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(audio)
        .timeout(Duration::from_secs(30))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => Json(json!({ "text": v["text"].as_str().unwrap_or("") })).into_response(),
            Err(_) => StatusCode::BAD_GATEWAY.into_response(),
        },
        _ => (StatusCode::BAD_GATEWAY, Json(json!({ "error": "the voice service is not answering" }))).into_response(),
    }
}
