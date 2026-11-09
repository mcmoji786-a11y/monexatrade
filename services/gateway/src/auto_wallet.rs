//! The auto-trade wallet (decision 0014): a second, opt-in wallet whose key the server
//! holds, so orders, grids, copies, the sniper and the AI agent can trade 24/7. The main
//! Kixo wallet (decision 0010) is unchanged: its key never leaves the browser.
//!
//! Safety rules enforced here, whatever any caller asks:
//! - The key is made on the server from the OS random source, sealed with AES-256-GCM
//!   under AUTO_WALLET_KEY (a 32-byte master key; a cloud key vault at launch) and bound
//!   to its owner (the seal's associated data is the user id and the address). It is only
//!   opened in memory to sign, and never logged or returned.
//! - SOL leaves the auto wallet only to its owner's main Kixo wallet, fixed when the auto
//!   wallet is created. There is no way to send it anywhere else.
//! - Trading from it (stage 2) goes only through Kixo's own swap routes, within the
//!   owner's limits; pausing stops everything.

use crate::solana_tx::{self as stx, Pubkey};
use crate::wallet::{auth, err, rand_u64, row, ApiErr, WalletCtx};
use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

/// What the owner can set, and the bounds Kixo allows.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, Deserialize)]
pub struct Limits {
    /// Most SOL any one automatic buy may spend.
    pub max_trade_sol: f64,
    /// Automatic trading stops for the day after losing this much SOL.
    pub daily_loss_sol: f64,
    /// Coins below this safety score are never bought automatically.
    pub min_safety: u8,
    /// Highest slippage an automatic trade may accept, in basis points.
    pub max_slippage_bps: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Self { max_trade_sol: 0.1, daily_loss_sol: 0.5, min_safety: 50, max_slippage_bps: 1_500 }
    }
}

impl Limits {
    pub fn check(&self) -> Result<(), String> {
        if !(self.max_trade_sol > 0.0 && self.max_trade_sol <= 50.0) {
            return Err("Max per trade must be between 0 and 50 SOL".into());
        }
        if !(self.daily_loss_sol > 0.0 && self.daily_loss_sol <= 500.0) {
            return Err("Daily loss limit must be between 0 and 500 SOL".into());
        }
        if self.min_safety > 100 {
            return Err("Minimum safety score is 0 to 100".into());
        }
        if !(50..=5_000).contains(&self.max_slippage_bps) {
            return Err("Max slippage must be between 0.5% and 50%".into());
        }
        Ok(())
    }
}

/// How much SOL Kixo lets an auto wallet hold (AUTO_WALLET_MAX_SOL, default 10): above
/// it, automatic trading waits until the owner withdraws the extra.
pub fn max_balance_sol() -> f64 {
    std::env::var("AUTO_WALLET_MAX_SOL").ok().and_then(|v| v.trim().parse().ok()).filter(|v: &f64| *v > 0.0).unwrap_or(10.0)
}

/* ---------------- Sealing the key ---------------- */

fn master() -> Option<LessSafeKey> {
    let raw = B64.decode(std::env::var("AUTO_WALLET_KEY").ok()?.trim()).ok()?;
    (raw.len() == 32).then(|| LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &raw).expect("32-byte key")))
}

/// True when the server can make and use auto wallets (the master key is set).
pub fn available() -> bool {
    master().is_some()
}

fn aad(user: &str, pubkey: &str) -> String {
    format!("kixo-auto-wallet:v1:{user}:{pubkey}")
}

pub fn seal(key: &LessSafeKey, user: &str, pubkey: &str, secret: &[u8; 32]) -> Value {
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(&rand_u64().to_le_bytes());
    nonce[8..].copy_from_slice(&(rand_u64() as u32).to_le_bytes());
    let mut buf = secret.to_vec();
    key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(aad(user, pubkey).as_bytes()), &mut buf).expect("seal");
    json!({ "v": 1, "alg": "aes-256-gcm", "nonce": B64.encode(nonce), "ct": B64.encode(&buf) })
}

pub fn open(key: &LessSafeKey, user: &str, pubkey: &str, sealed: &Value) -> Option<ed25519_dalek::SigningKey> {
    let nonce: [u8; 12] = B64.decode(sealed["nonce"].as_str()?).ok()?.try_into().ok()?;
    let mut buf = B64.decode(sealed["ct"].as_str()?).ok()?;
    let plain = key.open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(aad(user, pubkey).as_bytes()), &mut buf).ok()?;
    let secret: [u8; 32] = plain.try_into().ok()?;
    let sk = ed25519_dalek::SigningKey::from_bytes(&secret);
    // The key must still be the one for this address.
    (stx::b58(sk.verifying_key().as_bytes()) == pubkey).then_some(sk)
}

/// A one-signer transaction, signed: [1][signature][message].
pub fn signed_tx(sk: &ed25519_dalek::SigningKey, message: &[u8]) -> Vec<u8> {
    use ed25519_dalek::Signer;
    let sig = sk.sign(message).to_bytes();
    let mut tx = Vec::with_capacity(1 + 64 + message.len());
    tx.push(1);
    tx.extend_from_slice(&sig);
    tx.extend_from_slice(message);
    tx
}

/* ---------------- Storage ---------------- */

async fn auto_row(c: &WalletCtx, user: &str) -> Result<Option<Value>, ApiErr> {
    let v = c
        .acct
        .rest(reqwest::Method::GET, &format!("auto_wallets?user_id=eq.{user}&select=pubkey,owner_pubkey,sealed,limits,paused"), None)
        .await
        .map_err(auth)?;
    Ok(v.as_array().and_then(|a| a.first()).cloned())
}

fn limits_of(r: &Value) -> Limits {
    serde_json::from_value(r["limits"].clone()).unwrap_or_default()
}

async fn balance(c: &WalletCtx, pubkey: &str) -> Option<u64> {
    let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
    crate::trade::rpc(&rpc, "getBalance", json!([pubkey, { "commitment": "confirmed" }])).await.ok()?["value"].as_u64()
}

/* ---------------- Endpoints ---------------- */

/// `GET /auto-wallet`: whether the user has an auto wallet, its address, balance,
/// limits and whether it is paused.
pub async fn me(State(c): State<WalletCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    let on = available() && c.admin.auto_wallet();
    let Some(r) = auto_row(&c, &user.id).await? else {
        return Ok(Json(json!({ "available": on, "exists": false, "max_balance_sol": max_balance_sol(), "limits": Limits::default() })));
    };
    let pubkey = r["pubkey"].as_str().unwrap_or("").to_string();
    let lamports = balance(&c, &pubkey).await;
    Ok(Json(json!({
        "available": on,
        "exists": true,
        "pubkey": pubkey,
        "owner": r["owner_pubkey"],
        "lamports": lamports,
        "limits": limits_of(&r),
        "paused": r["paused"].as_bool().unwrap_or(false),
        "max_balance_sol": max_balance_sol(),
        "over_max": lamports.is_some_and(|l| l as f64 / 1e9 > max_balance_sol()),
    })))
}

/// `POST /auto-wallet`: makes the auto wallet. Its money can only ever go back to the
/// user's main Kixo wallet, so that wallet must exist first.
pub async fn create(State(c): State<WalletCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    if !c.admin.auto_wallet() {
        return Err(err(StatusCode::FORBIDDEN, "The auto-trade wallet is not open yet"));
    }
    let key = master().ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "The auto-trade wallet is not set up on this server"))?;
    if !c.w.allow(&user.id, "auto-create", 5, Duration::from_secs(3600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts, try again later"));
    }
    if auto_row(&c, &user.id).await?.is_some() {
        return Err(err(StatusCode::CONFLICT, "You already have an auto-trade wallet"));
    }
    let main = row(&c, &user.id).await?.ok_or_else(|| err(StatusCode::BAD_REQUEST, "Create your Kixo wallet first: the auto wallet sends money back only to it"))?;
    let owner = main["pubkey"].as_str().unwrap_or("").to_string();
    stx::pubkey(&owner).map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "main wallet address unreadable"))?;

    let mut secret = [0u8; 32];
    {
        use ring::rand::{SecureRandom, SystemRandom};
        SystemRandom::new().fill(&mut secret).expect("os random");
    }
    let sk = ed25519_dalek::SigningKey::from_bytes(&secret);
    let pubkey = stx::b58(sk.verifying_key().as_bytes());
    let sealed = seal(&key, &user.id, &pubkey, &secret);
    secret.fill(0);
    // Check the seal opens before saving it.
    if open(&key, &user.id, &pubkey, &sealed).is_none() {
        return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "could not seal the key"));
    }
    let inserted = c
        .acct
        .insert_new("auto_wallets", json!({ "user_id": user.id, "pubkey": pubkey, "owner_pubkey": owner, "sealed": sealed, "limits": Limits::default(), "paused": true }))
        .await
        .map_err(auth)?;
    if inserted.as_array().is_none_or(|a| a.is_empty()) {
        return Err(err(StatusCode::CONFLICT, "You already have an auto-trade wallet"));
    }
    tracing::info!(user = user.id, pubkey, "auto wallet created");
    Ok(Json(json!({ "pubkey": pubkey, "owner": owner, "paused": true })))
}

#[derive(Deserialize)]
pub struct SettingsIn {
    limits: Option<Limits>,
    paused: Option<bool>,
}

/// `PUT /auto-wallet`: the owner's limits, and pause / resume.
pub async fn update(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<SettingsIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    auto_row(&c, &user.id).await?.ok_or_else(|| err(StatusCode::NOT_FOUND, "No auto-trade wallet yet"))?;
    let mut patch = serde_json::Map::new();
    if let Some(l) = b.limits {
        l.check().map_err(|m| err(StatusCode::BAD_REQUEST, &m))?;
        patch.insert("limits".into(), json!(l));
    }
    if let Some(p) = b.paused {
        patch.insert("paused".into(), json!(p));
    }
    if patch.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "nothing to change"));
    }
    c.acct
        .rest(reqwest::Method::PATCH, &format!("auto_wallets?user_id=eq.{}", user.id), Some(Value::Object(patch)))
        .await
        .map_err(auth)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct WithdrawIn {
    /// Lamports to send back; ignored with `all`.
    #[serde(default)]
    lamports: u64,
    #[serde(default)]
    all: bool,
}

/// Network fee of a plain transfer, kept back when sending everything.
const TRANSFER_FEE: u64 = 5_000 + 20; // base fee + a tiny priority fee

/// `POST /auto-wallet/withdraw`: sends SOL back to the owner's main Kixo wallet, the only
/// place it can go. No Kixo fee: it is the user's own money moving between their wallets.
pub async fn withdraw(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<WithdrawIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    if !c.w.allow(&user.id, "auto-withdraw", 20, Duration::from_secs(600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts, try again later"));
    }
    let key = master().ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "The auto-trade wallet is not set up on this server"))?;
    let r = auto_row(&c, &user.id).await?.ok_or_else(|| err(StatusCode::NOT_FOUND, "No auto-trade wallet yet"))?;
    let pubkey = r["pubkey"].as_str().unwrap_or("").to_string();
    let from: Pubkey = stx::pubkey(&pubkey).map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "address unreadable"))?;
    let to: Pubkey = stx::pubkey(r["owner_pubkey"].as_str().unwrap_or("")).map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "main wallet address unreadable"))?;
    let sk = open(&key, &user.id, &pubkey, &r["sealed"]).ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "could not open the auto wallet"))?;

    let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
    let unreachable = |_| err(StatusCode::BAD_GATEWAY, "Could not reach Solana, try again");
    let (bal, hash) = tokio::join!(
        crate::trade::rpc(&rpc, "getBalance", json!([pubkey, { "commitment": "confirmed" }])),
        crate::trade::rpc(&rpc, "getLatestBlockhash", json!([{ "commitment": "confirmed" }]))
    );
    let balance = bal.map_err(unreachable)?["value"].as_u64().unwrap_or(0);
    let hash = hash.map_err(unreachable)?;
    let lamports = if b.all { balance.saturating_sub(TRANSFER_FEE) } else { b.lamports };
    if lamports == 0 {
        return Err(err(StatusCode::BAD_REQUEST, "Nothing to withdraw"));
    }
    if lamports + TRANSFER_FEE > balance {
        return Err(err(StatusCode::BAD_REQUEST, "Not enough SOL in the auto wallet"));
    }
    let blockhash = stx::pubkey(hash["value"]["blockhash"].as_str().unwrap_or("")).map_err(|_| err(StatusCode::BAD_GATEWAY, "Could not reach Solana, try again"))?;
    let ixs = vec![stx::compute_unit_limit(1_000), stx::compute_unit_price(20_000), stx::transfer(&from, &to, lamports)];
    let message = stx::compile_v0(&from, &ixs, &[], &blockhash).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    let tx = signed_tx(&sk, &message);
    drop(sk);
    let (sigs, _) = stx::split_tx(&tx).ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "bad transaction"))?;
    let signature = stx::b58(&sigs[0]);
    let raw = B64.encode(&tx);
    crate::ops::log_transfer(json!({ "ts": chrono_now(), "user": user.id, "kind": "auto-withdraw", "sig": signature, "amount": lamports, "fee": 0, "status": "sent" }));
    c.sender.send_many(&[&tx], Instant::now()).await;
    let _ = crate::trade::rpc(&rpc, "sendTransaction", json!([raw, { "encoding": "base64", "skipPreflight": true, "maxRetries": 0 }])).await;
    let (c2, raw2, tx2) = (c.clone(), raw.clone(), tx.clone());
    tokio::spawn(async move {
        let rpc = crate::trade::Rpc { http: c2.app.http.clone(), url: c2.app.config.helius_rpc_url() };
        for _ in 0..8 {
            tokio::time::sleep(Duration::from_secs(2)).await;
            c2.sender.send_many(&[&tx2], Instant::now()).await;
            let _ = crate::trade::rpc(&rpc, "sendTransaction", json!([raw2, { "encoding": "base64", "skipPreflight": true, "maxRetries": 0 }])).await;
        }
    });
    tracing::info!(user = user.id, signature, lamports, "auto wallet withdrawal sent");
    Ok(Json(json!({ "signature": signature, "lamports": lamports, "to": stx::b58(&to) })))
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> LessSafeKey {
        LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &[9u8; 32]).expect("key"))
    }

    #[test]
    fn a_sealed_key_opens_only_for_its_owner_and_address() {
        let key = test_key();
        let secret = [5u8; 32];
        let sk = ed25519_dalek::SigningKey::from_bytes(&secret);
        let pubkey = stx::b58(sk.verifying_key().as_bytes());
        let sealed = seal(&key, "user-a", &pubkey, &secret);
        assert!(!sealed.to_string().contains(&B64.encode(secret)), "the secret is not stored in the clear");
        let opened = open(&key, "user-a", &pubkey, &sealed).expect("opens");
        assert_eq!(opened.to_bytes(), secret);
        // Another user, another address, or another master key: it does not open.
        assert!(open(&key, "user-b", &pubkey, &sealed).is_none());
        assert!(open(&key, "user-a", "11111111111111111111111111111111", &sealed).is_none());
        let other = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &[8u8; 32]).expect("key"));
        assert!(open(&other, "user-a", &pubkey, &sealed).is_none());
        // Two seals of the same key differ (fresh nonce).
        assert_ne!(seal(&key, "user-a", &pubkey, &secret)["ct"], sealed["ct"]);
    }

    #[test]
    fn signed_transactions_verify() {
        let sk = ed25519_dalek::SigningKey::from_bytes(&[3u8; 32]);
        let from: Pubkey = sk.verifying_key().to_bytes();
        let to: Pubkey = [4u8; 32];
        let msg = stx::compile_v0(&from, &[stx::transfer(&from, &to, 1_000)], &[], &[1u8; 32]).expect("message");
        let tx = signed_tx(&sk, &msg);
        assert!(stx::verify_signed(&tx, &msg, &from));
    }

    #[test]
    fn limits_are_checked() {
        assert!(Limits::default().check().is_ok());
        assert!(Limits { max_trade_sol: 0.0, ..Limits::default() }.check().is_err());
        assert!(Limits { max_slippage_bps: 9_000, ..Limits::default() }.check().is_err());
        assert!(Limits { min_safety: 101, ..Limits::default() }.check().is_err());
    }
}
