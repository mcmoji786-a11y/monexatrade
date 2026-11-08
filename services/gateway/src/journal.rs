//! The trade journal: every real trade is written to a local file before it is sent,
//! in microseconds, instead of waiting 100-300 ms for the database. The database row is
//! written right after, in the background, with retries. If the gateway stops before a
//! row reached the database, the next start writes it from the journal.
//!
//! The file holds what the `real_trades` row holds (wallet, mint, amounts, signature):
//! no keys and nothing secret.

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    sync::Mutex,
};

pub const FILE: &str = "data/trade_journal.jsonl";

pub struct Journal {
    path: String,
    file: Mutex<Option<File>>,
}

impl Journal {
    pub fn open(path: &str) -> Self {
        if let Some(dir) = std::path::Path::new(path).parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| tracing::error!(%e, path, "trade journal could not open")).ok();
        Self { path: path.to_string(), file: Mutex::new(file) }
    }

    fn write(&self, v: &Value) -> std::io::Result<()> {
        let mut f = self.file.lock().expect("journal lock");
        let f = f.as_mut().ok_or_else(|| std::io::Error::other("journal not open"))?;
        let mut line = v.to_string();
        line.push('\n');
        f.write_all(line.as_bytes())
    }

    /// Records a trade about to be sent. An error means it must not be sent.
    pub fn sent(&self, row: &Value) -> std::io::Result<()> {
        self.write(&json!({ "sent": row }))
    }

    /// The trade's row reached the database.
    pub fn recorded(&self, sig: &str) {
        let _ = self.write(&json!({ "recorded": sig }));
    }

    /// Rows sent but never recorded, oldest first.
    pub fn unrecorded(&self) -> Vec<Value> {
        let Ok(f) = File::open(&self.path) else { return vec![] };
        let mut rows: Vec<(String, Value)> = Vec::new();
        let mut done: HashMap<String, ()> = HashMap::new();
        for line in BufReader::new(f).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if let Some(sig) = v["recorded"].as_str() {
                done.insert(sig.to_string(), ());
            } else if let Some(sig) = v["sent"]["signature"].as_str() {
                rows.push((sig.to_string(), v["sent"].clone()));
            }
        }
        rows.into_iter().filter(|(s, _)| !done.contains_key(s)).map(|(_, r)| r).collect()
    }

    /// Starts the file again with only the rows still to record.
    pub fn compact(&self, keep: &[Value]) {
        let mut f = self.file.lock().expect("journal lock");
        let tmp = format!("{}.tmp", self.path);
        let body: String = keep.iter().map(|r| format!("{}\n", json!({ "sent": r }))).collect();
        if std::fs::write(&tmp, body).is_ok() && std::fs::rename(&tmp, &self.path).is_ok() {
            *f = OpenOptions::new().append(true).open(&self.path).ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_unrecorded_trades_come_back_and_compact_keeps_them() {
        let dir = std::env::temp_dir().join(format!("kixo-journal-{}", std::process::id()));
        let path = dir.join("j.jsonl");
        let p = path.to_str().unwrap();
        let _ = std::fs::remove_file(p);
        let j = Journal::open(p);
        j.sent(&json!({ "signature": "a", "mint": "m" })).unwrap();
        j.sent(&json!({ "signature": "b", "mint": "m" })).unwrap();
        j.recorded("a");
        let left = j.unrecorded();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0]["signature"], "b");
        j.compact(&left);
        j.sent(&json!({ "signature": "c" })).unwrap();
        let again = Journal::open(p).unrecorded();
        assert_eq!(again.iter().map(|r| r["signature"].as_str().unwrap()).collect::<Vec<_>>(), ["b", "c"]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
