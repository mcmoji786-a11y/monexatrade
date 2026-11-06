//! Universal swap decoder: reads a full transaction and finds what moved through the
//! pool's own token vaults. Works for any DEX (Raydium AMM v4 / CLMM / CPMM, Orca,
//! Meteora, PumpSwap...) without per-program layouts, because every pool account
//! stores its vault addresses: a vault is a token account in the transaction whose
//! address appears inside the pool account's data.
//! Verified on live transactions 2026-11-06 (AMM v4, CLMM, Orca, DLMM, PumpSwap).
//!
//! The same input arrives from `getTransaction` today (free plan) and from Helius
//! `transactionSubscribe` later (paid plan), so this decoder stays as is.

use serde_json::Value;
use std::collections::HashMap;

/// What a trade page needs to recognise its pool's vaults.
#[derive(Debug, Clone)]
pub struct PoolSpec {
    /// The pool account's raw data (it contains the vault addresses).
    pub data: Vec<u8>,
    pub coin: String,
    pub quote: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Swap {
    pub wallet: String,
    pub is_buy: bool,
    /// Raw units of the coin and the quote token that changed hands.
    pub coin_amount: u64,
    pub quote_amount: u64,
    pub timestamp: i64,
}

impl PoolSpec {
    fn holds(&self, address: &str) -> bool {
        match bs58::decode(address).into_vec() {
            Ok(key) if key.len() == 32 => self.data.windows(32).any(|w| w == key.as_slice()),
            _ => false,
        }
    }
}

/// The swap this transaction made through the pool, if any. Liquidity changes (both
/// vaults move the same way) and failed transactions yield None.
pub fn decode(tx: &Value, spec: &PoolSpec) -> Option<Swap> {
    let meta = &tx["meta"];
    if !meta["err"].is_null() {
        return None;
    }
    let msg = &tx["transaction"]["message"];
    let mut keys: Vec<&str> = msg["accountKeys"]
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    for part in ["writable", "readonly"] {
        if let Some(a) = meta["loadedAddresses"][part].as_array() {
            keys.extend(a.iter().filter_map(Value::as_str));
        }
    }

    let amount = |b: &Value| {
        b["uiTokenAmount"]["amount"]
            .as_str()
            .and_then(|s| s.parse::<i128>().ok())
    };
    let mut before: HashMap<u64, i128> = HashMap::new();
    for b in meta["preTokenBalances"].as_array()? {
        if let (Some(i), Some(a)) = (b["accountIndex"].as_u64(), amount(b)) {
            before.insert(i, a);
        }
    }
    let (mut coin, mut quote) = (0i128, 0i128);
    for b in meta["postTokenBalances"].as_array()? {
        let (Some(i), Some(after), Some(mint)) =
            (b["accountIndex"].as_u64(), amount(b), b["mint"].as_str())
        else {
            continue;
        };
        if mint != spec.coin && mint != spec.quote {
            continue;
        }
        let Some(address) = keys.get(i as usize) else {
            continue;
        };
        if !spec.holds(address) {
            continue;
        }
        let d = after - before.get(&i).copied().unwrap_or(0);
        if mint == spec.coin {
            coin += d;
        } else {
            quote += d;
        }
    }
    // The pool paid out coins and took quote: someone bought. The reverse is a sell.
    let is_buy = match (coin.signum(), quote.signum()) {
        (-1, 1) => true,
        (1, -1) => false,
        _ => return None,
    };
    Some(Swap {
        wallet: keys.first()?.to_string(),
        is_buy,
        coin_amount: coin.unsigned_abs() as u64,
        quote_amount: quote.unsigned_abs() as u64,
        timestamp: tx["blockTime"].as_i64().unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const VAULT_COIN: &str = "So11111111111111111111111111111111111111112";
    const VAULT_QUOTE: &str = "Tuy6gMupGQN7wCZ8rVP1EuLRYB132VSo9Smy4AJvQgn";
    const USER: &str = "4Rfd9KJmKKo1MfpdYvAFbkvfdFQzQGkz5ffPLgRFpump";

    fn spec() -> PoolSpec {
        let mut data = vec![0u8; 16];
        data.extend(bs58::decode(VAULT_COIN).into_vec().unwrap());
        data.extend([7u8; 5]);
        data.extend(bs58::decode(VAULT_QUOTE).into_vec().unwrap());
        PoolSpec {
            data,
            coin: "COIN".into(),
            quote: "QUOTE".into(),
        }
    }

    fn tx(coin_pre: &str, coin_post: &str, quote_pre: &str, quote_post: &str) -> Value {
        let bal = |i: u64, mint: &str, a: &str| json!({ "accountIndex": i, "mint": mint, "uiTokenAmount": { "amount": a } });
        json!({
            "blockTime": 1_793_900_000,
            "transaction": { "message": { "accountKeys": [USER, VAULT_COIN] } },
            "meta": {
                "err": null,
                "loadedAddresses": { "writable": [VAULT_QUOTE], "readonly": [] },
                "preTokenBalances": [bal(1, "COIN", coin_pre), bal(2, "QUOTE", quote_pre)],
                "postTokenBalances": [bal(1, "COIN", coin_post), bal(2, "QUOTE", quote_post)]
            }
        })
    }

    #[test]
    fn reads_buys_and_sells_from_vault_changes() {
        let buy = decode(&tx("1000", "900", "50", "70"), &spec()).unwrap();
        assert_eq!(
            buy,
            Swap {
                wallet: USER.into(),
                is_buy: true,
                coin_amount: 100,
                quote_amount: 20,
                timestamp: 1_793_900_000
            }
        );
        let sell = decode(&tx("900", "1000", "70", "51"), &spec()).unwrap();
        assert!(!sell.is_buy);
        assert_eq!((sell.coin_amount, sell.quote_amount), (100, 19));
    }

    #[test]
    fn ignores_liquidity_moves_and_failed_transactions() {
        assert!(
            decode(&tx("1000", "1100", "50", "60"), &spec()).is_none(),
            "both vaults grew: a deposit"
        );
        let mut failed = tx("1000", "900", "50", "70");
        failed["meta"]["err"] = json!({ "InstructionError": [0, "Custom"] });
        assert!(decode(&failed, &spec()).is_none());
    }
}
