//! Standalone ingest runner for debugging: logs every engine event.
//! In normal operation the gateway runs the ingest engine in-process.

use anyhow::Result;
use monexa_common::Config;
use monexa_ingest::{IngestEvent, IngestStats};
use std::sync::Arc;
use tokio::sync::broadcast;

#[tokio::main]
async fn main() -> Result<()> {
    monexa_common::init_tracing();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let config = Config::from_env()?;

    let (tx, mut rx) = broadcast::channel(1024);
    let stats = Arc::new(IngestStats::default());
    let (_commands, commands_rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(monexa_ingest::run_forever(config.ws_urls(), config.helius_rpc_url(), tx, stats, commands_rx));

    while let Ok(event) = rx.recv().await {
        match event {
            IngestEvent::Created(t) => tracing::info!(mint = %t.mint, symbol = %t.symbol, "created"),
            IngestEvent::Market { sol_usd, items } => tracing::info!(?sol_usd, updated = items.len(), "market"),
            IngestEvent::Removed(m) => tracing::info!(removed = m.len(), "pruned"),
            IngestEvent::Launched(t) => tracing::info!(mint = %t.mint, launchpad = %t.launchpad, symbol = %t.symbol, "launched"),
            IngestEvent::Trade { .. } | IngestEvent::PoolTx { .. } => {}
        }
    }
    Ok(())
}
