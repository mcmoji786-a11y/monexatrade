//! MONEXA gateway: the public HTTP/WebSocket entry point for the frontend.
//! Phase 0: only a `/health` endpoint that checks real connectivity to Supabase and Solana (Helius).

use anyhow::Result;
use axum::{extract::State, http::HeaderValue, routing::get, Json, Router};
use monexa_common::Config;
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

struct AppState {
    config: Config,
    http: reqwest::Client,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    supabase: bool,
    helius: bool,
    solana_slot: Option<u64>,
}

#[tokio::main]
async fn main() -> Result<()> {
    monexa_common::init_tracing();
    let config = Config::from_env()?;
    tracing::info!(?config, "starting gateway");

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("monexa-gateway/0.1")
        .build()?;

    let cors = CorsLayer::new()
        .allow_origin(config.allowed_origin.parse::<HeaderValue>()?)
        .allow_methods([axum::http::Method::GET]);

    let port = config.gateway_port;
    let state = Arc::new(AppState { config, http });

    let app = Router::new()
        .route("/health", get(health))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("gateway listening on http://localhost:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Health> {
    let (supabase, slot) = tokio::join!(check_supabase(&state), solana_slot(&state));
    let helius = slot.is_some();
    Json(Health {
        status: if supabase && helius { "ok" } else { "degraded" },
        supabase,
        helius,
        solana_slot: slot,
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
    let body = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "getSlot" });
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
