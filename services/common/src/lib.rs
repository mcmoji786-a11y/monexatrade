//! Shared code for all Kixo Rust services: configuration and logging.

use anyhow::{Context, Result};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/* Helius is the main Solana connection; our own fallback keeps Kixo running when
   Helius is down or its quota is used up. The gateway runs a local RPC router (see
   gateway rpc_router.rs) and points every caller at it through `set_rpc_route`. */

static RPC_ROUTE: OnceLock<String> = OnceLock::new();
static PRIMARY_UP: AtomicBool = AtomicBool::new(true);

/// Sends every `helius_rpc_url()` caller through this address (the local router).
pub fn set_rpc_route(url: String) {
    let _ = RPC_ROUTE.set(url);
}

/// The local router's address, when the gateway runs it.
pub fn rpc_route() -> Option<String> {
    RPC_ROUTE.get().cloned()
}

/// Whether Helius answers right now (kept by the router's probe).
pub fn primary_up() -> bool {
    PRIMARY_UP.load(Ordering::Relaxed)
}
pub fn set_primary_up(up: bool) {
    PRIMARY_UP.store(up, Ordering::Relaxed);
}

/// Solana's own public node: free, no key, rate limited. Used only as a fallback.
pub const PUBLIC_RPC: &str = "https://api.mainnet-beta.solana.com";
pub const PUBLIC_WS: &str = "wss://api.mainnet-beta.solana.com";

fn url_list(var: &str, scheme: &str, default: &str) -> Vec<String> {
    match std::env::var(var) {
        Ok(v) if !v.trim().is_empty() => v.split(',').map(str::trim).filter(|u| u.starts_with(scheme)).map(String::from).collect(),
        _ => vec![default.to_string()],
    }
}

/// Fallback RPC nodes, in order: FALLBACK_RPC_URLS (comma separated), or Solana's public node.
pub fn fallback_rpc_urls() -> Vec<String> {
    url_list("FALLBACK_RPC_URLS", "https://", PUBLIC_RPC)
}

/// Fallback WebSocket nodes: FALLBACK_WS_URLS, or Solana's public node.
pub fn fallback_ws_urls() -> Vec<String> {
    url_list("FALLBACK_WS_URLS", "wss://", PUBLIC_WS)
}

/// Runtime configuration loaded from environment variables (and `.env` in development).
/// Secrets are never printed: `Debug` is implemented manually and redacts them.
#[derive(Clone)]
pub struct Config {
    pub helius_api_key: String,
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub supabase_service_role_key: String,
    pub gateway_port: u16,
    pub allowed_origin: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        // Look for .env in the current dir and its parents (repo root in development).
        let _ = dotenvy::dotenv();

        Ok(Self {
            helius_api_key: required("HELIUS_API_KEY")?,
            supabase_url: required("SUPABASE_URL")?.trim_end_matches('/').to_string(),
            supabase_anon_key: required("SUPABASE_ANON_KEY")?,
            supabase_service_role_key: required("SUPABASE_SERVICE_ROLE_KEY")?,
            gateway_port: std::env::var("GATEWAY_PORT")
                .ok()
                .map(|p| p.parse().context("GATEWAY_PORT must be a number"))
                .transpose()?
                .unwrap_or(8080),
            allowed_origin: std::env::var("ALLOWED_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
        })
    }

    /// The RPC address every caller uses: the gateway's local router when it runs
    /// (Helius first, our fallback nodes when Helius fails), otherwise Helius itself.
    pub fn helius_rpc_url(&self) -> String {
        match RPC_ROUTE.get() {
            Some(route) => route.clone(),
            None => self.helius_direct_rpc_url(),
        }
    }

    /// Helius itself. HELIUS_RPC_URL in the environment (a paid or dedicated endpoint)
    /// wins over the standard shared one.
    pub fn helius_direct_rpc_url(&self) -> String {
        match std::env::var("HELIUS_RPC_URL") {
            Ok(u) if u.starts_with("https://") => u,
            _ => format!("https://mainnet.helius-rpc.com/?api-key={}", self.helius_api_key),
        }
    }

    pub fn helius_ws_url(&self) -> String {
        format!("wss://mainnet.helius-rpc.com/?api-key={}", self.helius_api_key)
    }

    /// Live-stream nodes in order of preference: Helius, then the fallbacks.
    pub fn ws_urls(&self) -> Vec<String> {
        let mut v = vec![self.helius_ws_url()];
        v.extend(fallback_ws_urls());
        v
    }
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("helius_api_key", &"<redacted>")
            .field("supabase_url", &self.supabase_url)
            .field("supabase_anon_key", &"<redacted>")
            .field("supabase_service_role_key", &"<redacted>")
            .field("gateway_port", &self.gateway_port)
            .field("allowed_origin", &self.allowed_origin)
            .finish()
    }
}

fn required(name: &str) -> Result<String> {
    let value = std::env::var(name).with_context(|| format!("missing env var {name}"))?;
    let value = value.trim().to_string();
    anyhow::ensure!(!value.is_empty(), "env var {name} is empty");
    Ok(value)
}

/// Initialise structured logging. Level is controlled by `RUST_LOG` (default: info).
pub fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_redacts_secrets() {
        let cfg = Config {
            helius_api_key: "secret-helius".into(),
            supabase_url: "https://x.supabase.co".into(),
            supabase_anon_key: "secret-anon".into(),
            supabase_service_role_key: "secret-service".into(),
            gateway_port: 8080,
            allowed_origin: "http://localhost:3000".into(),
        };
        let out = format!("{cfg:?}");
        assert!(!out.contains("secret-"));
        assert!(out.contains("<redacted>"));
    }
}
