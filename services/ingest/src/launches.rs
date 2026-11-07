//! New coins from every Solana launchpad, not just pump.fun.
//!
//! pump.fun creates are decoded from logs (pumpfun.rs). Everything else is caught by
//! one rule: a successful transaction that initializes a new mint. The engine listens
//! on the programs where memecoins are born (Metaplex metadata for classic SPL coins
//! from any launcher, plus the launchpads whose Token-2022 coins skip Metaplex), then
//! this module reads the transaction for the mint and creator and asks Helius DAS
//! for the name, symbol and metadata URI.
//!
//! Measured 2026-11-06 on logsSubscribe (MB per day): Metaplex ~92, Meteora DBC ~382,
//! Raydium LaunchLab ~757, Moonshot ~13.

use crate::pumpfun::{NewToken, TokenStandard};
use serde_json::{json, Value};
use std::time::Duration;

/// Metaplex Token Metadata: every classic SPL coin with a name passes through it.
pub const METAPLEX: &str = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
/// Raydium LaunchLab (letsbonk.fun and other LaunchLab frontends).
pub const LAUNCHLAB: &str = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
/// Meteora Dynamic Bonding Curve (Bags, Believe and other DBC frontends).
pub const METEORA_DBC: &str = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
pub const MOONSHOT: &str = "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG";

/// Programs the engine subscribes to for non-pump.fun creates.
pub const SOURCES: [&str; 4] = [METAPLEX, LAUNCHLAB, METEORA_DBC, MOONSHOT];

const TOKEN_2022: &str = "TokenzQdBNbLqP5VEhdkAS5EN5kb3XjBBAnBAYYj4jC5";

/// Cheap log check before any RPC call: a new mint, and not a pump.fun create
/// (those arrive decoded on their own subscription).
pub fn is_candidate(logs: &[String]) -> bool {
    let mut new_mint = false;
    for l in logs {
        if l.starts_with(&format!("Program {} invoke", crate::pumpfun::PROGRAM_ID)) {
            return false;
        }
        if l == "Program log: Instruction: InitializeMint2" || l == "Program log: Instruction: InitializeMint" {
            new_mint = true;
        }
    }
    new_mint
}

/// Which launchpad created the coin, from the programs the transaction invokes and the
/// vanity suffix frontends give their mints.
pub fn launchpad_of(logs: &[String], mint: &str) -> &'static str {
    let invoked = |p: &str| logs.iter().any(|l| l.starts_with(&format!("Program {p} invoke")));
    if invoked(LAUNCHLAB) {
        if mint.ends_with("bonk") {
            "letsbonk.fun"
        } else {
            "raydium-launchlab"
        }
    } else if invoked(METEORA_DBC) {
        if mint.ends_with("BAGS") {
            "bags"
        } else {
            "met-dbc"
        }
    } else if invoked(MOONSHOT) {
        "moonshot"
    } else {
        "other"
    }
}

/// The mint a transaction initializes, its decimals, the fee payer (creator) and the
/// token program, from a `jsonParsed` transaction.
pub fn new_mint(tx: &Value) -> Option<(String, u64, String, TokenStandard)> {
    let msg = &tx["transaction"]["message"];
    let payer = msg["accountKeys"][0]["pubkey"].as_str()?.to_string();
    let top = msg["instructions"].as_array().into_iter().flatten();
    let inner = tx["meta"]["innerInstructions"].as_array().into_iter().flatten().flat_map(|g| g["instructions"].as_array().into_iter().flatten());
    top.chain(inner).find_map(|i| {
        let kind = i["parsed"]["type"].as_str()?;
        if kind != "initializeMint" && kind != "initializeMint2" {
            return None;
        }
        let info = &i["parsed"]["info"];
        let standard = if i["programId"].as_str() == Some(TOKEN_2022) { TokenStandard::Token2022 } else { TokenStandard::Spl };
        Some((info["mint"].as_str()?.to_string(), info["decimals"].as_u64()?, payer.clone(), standard))
    })
}

/// A Meteora DBC create's pool and quote mint. The create instruction's accounts are
/// [config, pool_authority, creator, base_mint, quote_mint, pool, base_vault, ...]
/// (verified on the real create 4bQj5bhZ…).
pub fn dbc_pool(tx: &Value) -> Option<(String, String)> {
    let top = tx["transaction"]["message"]["instructions"].as_array().into_iter().flatten();
    let inner = tx["meta"]["innerInstructions"].as_array().into_iter().flatten().flat_map(|g| g["instructions"].as_array().into_iter().flatten());
    top.chain(inner).find_map(|i| {
        if i["programId"].as_str() != Some(METEORA_DBC) {
            return None;
        }
        let a = i["accounts"].as_array()?;
        Some((a.get(5)?.as_str()?.to_string(), a.get(4)?.as_str()?.to_string()))
    })
}

async fn call(http: &reqwest::Client, url: &str, method: &str, params: Value) -> Option<Value> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let res = http.post(url).json(&body).timeout(Duration::from_secs(10)).send().await.ok()?;
    let v: Value = res.json().await.ok()?;
    v.get("result").filter(|r| !r.is_null()).cloned()
}

/// Read a candidate transaction and build the new coin. `None` for NFTs (0 decimals),
/// coins without a name, and transactions not yet visible.
pub async fn resolve(http: &reqwest::Client, rpc_url: &str, signature: &str, logs: &[String]) -> Option<NewToken> {
    let mut tx = None;
    for attempt in 0..3 {
        tx = call(http, rpc_url, "getTransaction", json!([signature, { "maxSupportedTransactionVersion": 1, "encoding": "jsonParsed", "commitment": "confirmed" }])).await;
        if tx.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(600 * (attempt + 1))).await;
    }
    let tx = tx?;
    let (mint, decimals, creator, standard) = new_mint(&tx)?;
    if decimals == 0 {
        return None;
    }
    let asset = call(http, rpc_url, "getAsset", json!({ "id": mint })).await?;
    let meta = &asset["content"]["metadata"];
    let name = meta["name"].as_str().unwrap_or("").trim().to_string();
    let symbol = meta["symbol"].as_str().unwrap_or("").trim().to_string();
    if name.is_empty() && symbol.is_empty() {
        return None;
    }
    let launchpad = launchpad_of(logs, &mint).to_string();
    // Meteora DBC trades are not logged: the gateway streams the pool while someone
    // views the coin, so keep its address (and quote) from the create.
    let (bonding_curve, quote_mint) = match dbc_pool(&tx) {
        Some((pool, quote)) => (pool, (quote != crate::pumpswap::WSOL).then_some(quote)),
        None => (String::new(), None),
    };
    Some(NewToken {
        signature: signature.to_string(),
        name,
        symbol,
        uri: asset["content"]["json_uri"].as_str().unwrap_or("").to_string(),
        mint,
        bonding_curve,
        creator,
        timestamp: tx["blockTime"].as_i64().unwrap_or(0),
        reserves: None,
        standard,
        quote_mint,
        launchpad,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn candidates_are_new_mints_outside_pump_fun() {
        // Real LaunchLab create (5VGq64qK…), trimmed.
        let lab = logs(&[
            "Program LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj invoke [2]",
            "Program log: Instruction: InitializeWithToken2022",
            "Program log: Instruction: InitializeMint2",
        ]);
        assert!(is_candidate(&lab));
        assert_eq!(launchpad_of(&lab, "6vnzeMF6rd7f3uMVxk3PJ7cTR8ymPTuVyHGyA1Sqmfun"), "raydium-launchlab");
        assert_eq!(launchpad_of(&lab, "Xbonk"), "letsbonk.fun");

        let swap = logs(&["Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN invoke [1]", "Program log: Instruction: Swap2"]);
        assert!(!is_candidate(&swap));

        let pump = logs(&["Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]", "Program log: Instruction: InitializeMint2"]);
        assert!(!is_candidate(&pump));
    }

    #[test]
    fn reads_the_new_mint_from_a_parsed_transaction() {
        // Shape of the real Meteora DBC create 4bQj5bhZ… (jsonParsed), trimmed.
        let tx = json!({
            "transaction": { "message": {
                "accountKeys": [{ "pubkey": "63i4MjgkMfoDsTXBVwXeZBb7df5GbeHuSALwg2kVJCjV" }],
                "instructions": [{ "programId": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", "data": "x" }]
            }},
            "meta": { "innerInstructions": [{ "index": 0, "instructions": [
                { "programId": "TokenzQdBNbLqP5VEhdkAS5EN5kb3XjBBAnBAYYj4jC5",
                  "parsed": { "type": "initializeMint2", "info": { "mint": "EnVhn58ZKoP4nnQSribgbSF2GqrggmNhbs9rbFwS8oKt", "decimals": 6 } } }
            ]}]}
        });
        let (mint, decimals, payer, standard) = new_mint(&tx).expect("mint");
        assert_eq!(mint, "EnVhn58ZKoP4nnQSribgbSF2GqrggmNhbs9rbFwS8oKt");
        assert_eq!(decimals, 6);
        assert_eq!(payer, "63i4MjgkMfoDsTXBVwXeZBb7df5GbeHuSALwg2kVJCjV");
        assert_eq!(standard, TokenStandard::Token2022);
    }

    #[test]
    fn finds_the_dbc_pool_of_a_create() {
        // Accounts of the real create 4bQj5bhZ…, first seven.
        let tx = json!({
            "transaction": { "message": { "instructions": [{
                "programId": METEORA_DBC,
                "accounts": ["3UrgMkchnVuywDaYdtcJ8MkFNp56zkRxf4VpvkZgBmgg", "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM",
                    "63i4MjgkMfoDsTXBVwXeZBb7df5GbeHuSALwg2kVJCjV", "EnVhn58ZKoP4nnQSribgbSF2GqrggmNhbs9rbFwS8oKt",
                    "So11111111111111111111111111111111111111112", "7QWyVLLkrvi2v8yJuRYA9RXbXykJTjZSPyQaVLrP5i6v",
                    "9JpRLKoSiqxte6vba8GWg7qgyoh8QdmrvLNmqnQ9nHuk"]
            }]}},
            "meta": {}
        });
        let (pool, quote) = dbc_pool(&tx).expect("pool");
        assert_eq!(pool, "7QWyVLLkrvi2v8yJuRYA9RXbXykJTjZSPyQaVLrP5i6v");
        assert_eq!(quote, "So11111111111111111111111111111111111111112");
    }
}
