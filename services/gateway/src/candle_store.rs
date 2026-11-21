//! The charts Kixo built itself, saved to disk every two minutes and read back at start.
//! Before this, every restart left each chart with only the minutes since, and the
//! earlier part had to come from GeckoTerminal, whose free plan often blocks Kixo for
//! minutes at a time. Coins keep their saved chart for a day after their last trade, and
//! a coin opened again later (even after it left the board) gets it back at once.

use crate::book::Candle;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::Mutex,
};

const FILE: &str = "data/candles.json.gz";
/// A coin's saved chart is kept this long after its last candle.
const KEEP_SECS: i64 = 24 * 3600;
/// Coins with fewer candles are not worth saving (nobody traded them).
const MIN_CANDLES: usize = 12;
/// Most coins kept, the most recently traded first.
const MAX_COINS: usize = 4_000;

pub type Saved = HashMap<String, Vec<Candle>>;

static STORE: Mutex<Option<Saved>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut Saved) -> R) -> R {
    let mut s = STORE.lock().expect("candle store lock");
    f(s.get_or_insert_with(HashMap::new))
}

/// Reads the saved charts (once, at start).
pub fn load() {
    let read = || -> Option<Saved> {
        let mut gz = flate2::read::GzDecoder::new(std::fs::File::open(FILE).ok()?);
        let mut buf = Vec::new();
        gz.read_to_end(&mut buf).ok()?;
        serde_json::from_slice(&buf).ok()
    };
    let saved = read().unwrap_or_default();
    tracing::info!(coins = saved.len(), "saved charts loaded");
    with(|s| *s = saved);
}

/// The saved chart of one coin, if any.
pub fn get(mint: &str) -> Option<Vec<Candle>> {
    with(|s| s.get(mint).cloned())
}

/// The current charts over the saved ones, without coins nobody traded, charts older
/// than a day, or more than the most recent MAX_COINS.
fn merge(s: &mut Saved, current: Saved, now: i64) {
    for (mint, candles) in current {
        if candles.len() >= MIN_CANDLES {
            s.insert(mint, candles);
        }
    }
    s.retain(|_, c| c.last().is_some_and(|l| now - l.t <= KEEP_SECS));
    if s.len() > MAX_COINS {
        let mut by_last: Vec<(i64, String)> = s.iter().map(|(m, c)| (c.last().map_or(0, |l| l.t), m.clone())).collect();
        by_last.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        for (_, m) in by_last.into_iter().skip(MAX_COINS) {
            s.remove(&m);
        }
    }
}

/// Takes in the current charts, drops old ones and writes the file (off the async threads).
pub async fn save(current: Saved, now: i64) {
    let snapshot = with(|s| {
        merge(s, current, now);
        serde_json::to_vec(&*s).ok()
    });
    let Some(bytes) = snapshot else { return };
    let _ = tokio::task::spawn_blocking(move || {
        let tmp = format!("{FILE}.tmp");
        let write = || -> std::io::Result<()> {
            if let Some(dir) = std::path::Path::new(FILE).parent() {
                std::fs::create_dir_all(dir)?;
            }
            let mut gz = flate2::write::GzEncoder::new(std::fs::File::create(&tmp)?, flate2::Compression::fast());
            gz.write_all(&bytes)?;
            gz.finish()?;
            std::fs::rename(&tmp, FILE)
        };
        if let Err(e) = write() {
            tracing::warn!(error = %e, "could not save charts");
        }
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(t: i64) -> Candle {
        Candle { t, o: 1.0, h: 1.0, l: 1.0, c: 1.0, v: 1.0 }
    }

    #[test]
    fn keeps_traded_recent_charts_only() {
        let now = 100_000;
        let current: Saved = [
            ("busy".to_string(), (0..20).map(|i| c(now - 60 * i)).rev().collect()),
            ("quiet".to_string(), vec![c(now)]),
            ("old".to_string(), (0..20).map(|i| c(now - KEEP_SECS - 100 - i)).rev().collect()),
        ]
        .into();
        let mut s = Saved::new();
        merge(&mut s, current, now);
        assert!(s.contains_key("busy"));
        assert!(!s.contains_key("quiet") && !s.contains_key("old"));
    }
}
