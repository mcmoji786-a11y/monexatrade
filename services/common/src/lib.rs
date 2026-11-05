//! Shared code for all MONEXA Rust services: configuration and logging.

use anyhow::{Context, Result};
use std::fmt;

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

    pub fn helius_rpc_url(&self) -> String {
        format!("https://mainnet.helius-rpc.com/?api-key={}", self.helius_api_key)
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
