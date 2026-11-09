//! Kixo trading wallet (decision 0010). The key is made and locked in the user's
//! browser; the gateway only stores the locked copy and hands it back to its owner (after
//! an email code when 2FA is on). Kixo can never open it.
//!
//! Deposits: the user picks an amount, the gateway builds that exact transfer from their
//! Phantom to their Kixo wallet, Phantom shows and signs it, and the gateway checks it
//! before sending (behind the `wallet_deposits` switch). Sending to the address from an
//! exchange works too.
//! Withdrawals: the gateway builds a plain SOL transfer out of the Kixo wallet, the
//! browser signs it with the unlocked key, and the gateway checks it is exactly that
//! transfer before sending it.

use crate::account::AccountState;
use crate::solana_tx::{self as stx, Pubkey};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// The password-derived key must be slow to guess: at least this many PBKDF2 rounds.
const MIN_ITERATIONS: u64 = 300_000;
const MAX_ITERATIONS: u64 = 5_000_000;
const BUILD_TTL: Duration = Duration::from_secs(90);
#[cfg(test)]
const MIN_DEPOSIT: u64 = 1_000_000; // 0.001 SOL
// Kixo's fee on deposits and withdrawals (1% by default) and the deposit limits are
// admin settings: see platform.rs.

#[derive(Clone)]
pub struct WalletCtx {
    pub app: Arc<crate::AppState>,
    pub acct: Arc<AccountState>,
    pub admin: Arc<crate::admin::AdminState>,
    pub sender: crate::sender::SenderState,
    pub w: Arc<WalletState>,
}

#[derive(Default)]
pub struct WalletState {
    /// Rate limits: "user:action" -> recent attempts.
    hits: Mutex<HashMap<String, Vec<Instant>>>,
    /// Built withdrawals waiting for the wallet's signature.
    builds: Mutex<HashMap<String, Build>>,
}

struct Build {
    user: String,
    from: Pubkey,
    message: Vec<u8>,
    created: Instant,
    /// "deposit" or "withdraw", what reaches the destination and Kixo's fee (lamports),
    /// for the transfer log behind the admin's earnings.
    kind: &'static str,
    amount: u64,
    fee: u64,
}

pub(crate) type ApiErr = (StatusCode, Json<Value>);

pub(crate) fn err(status: StatusCode, message: &str) -> ApiErr {
    (status, Json(json!({ "message": message })))
}

pub(crate) fn auth(e: (StatusCode, String)) -> ApiErr {
    err(e.0, &e.1)
}

impl WalletState {
    /// True when `user` may do `action` again (at most `max` times per `window`).
    pub(crate) fn allow(&self, user: &str, action: &str, max: usize, window: Duration) -> bool {
        let mut h = self.hits.lock().expect("hits lock");
        if h.len() > 20_000 {
            h.retain(|_, v| v.iter().any(|t| t.elapsed() < Duration::from_secs(3600)));
        }
        let v = h.entry(format!("{user}:{action}")).or_default();
        v.retain(|t| t.elapsed() < window);
        if v.len() >= max {
            return false;
        }
        v.push(Instant::now());
        true
    }
}

pub(crate) async fn row(c: &WalletCtx, user: &str) -> Result<Option<Value>, ApiErr> {
    let v = c.acct.rest(reqwest::Method::GET, &format!("kixo_wallets?user_id=eq.{user}&select=pubkey,two_fa,locked"), None).await.map_err(auth)?;
    Ok(v.as_array().and_then(|a| a.first()).cloned())
}

/// `GET /kixo-wallet`: whether the user has a Kixo wallet, its address and 2FA.
pub async fn me(State(c): State<WalletCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    let r = row(&c, &user.id).await?;
    Ok(Json(json!({
        "exists": r.is_some(),
        "pubkey": r.as_ref().map(|r| r["pubkey"].clone()),
        "two_fa": r.as_ref().is_some_and(|r| r["two_fa"].as_bool() == Some(true)),
        "email": user.email,
        "deposits": c.admin.wallet_deposits(),
        "deposit_fee_bps": crate::marketing::deposit_fee_bps_for(&user.id),
        "withdraw_fee_bps": crate::marketing::withdraw_fee_bps_for(&user.id),
    })))
}

/// Checks the locked copy is only what it should be: a 32-byte key sealed with
/// AES-256-GCM under a slow PBKDF2 key. Anything else (a plain key, say) is refused.
pub fn valid_locked(v: &Value) -> bool {
    let len = |k: &str| v[k].as_str().and_then(|s| B64.decode(s).ok()).map(|b| b.len());
    v["v"].as_u64() == Some(1)
        && v["kdf"].as_str() == Some("PBKDF2-SHA256")
        && v["cipher"].as_str() == Some("AES-256-GCM")
        && v["iterations"].as_u64().is_some_and(|i| (MIN_ITERATIONS..=MAX_ITERATIONS).contains(&i))
        && len("salt") == Some(16)
        && len("iv") == Some(12)
        && len("ciphertext") == Some(32 + 16)
        && v.as_object().is_some_and(|o| o.len() == 7)
}

/// The message a new wallet signs to prove the browser holds its key.
pub fn proof_message(user: &str, pubkey: &str) -> String {
    format!("Kixo wallet {user} {pubkey}")
}

#[derive(Deserialize)]
pub struct CreateIn {
    pubkey: String,
    locked: Value,
    /// Base64 Ed25519 signature of `proof_message` by the new key.
    proof: String,
}

/// `POST /kixo-wallet`: stores a new wallet's locked copy. One wallet per account; an
/// existing one is never replaced.
pub async fn create(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<CreateIn>) -> Result<Json<Value>, ApiErr> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let user = c.acct.user(&headers).await.map_err(auth)?;
    if !c.admin.kixo_wallet() {
        return Err(err(StatusCode::FORBIDDEN, "Kixo wallets are paused"));
    }
    if !c.w.allow(&user.id, "create", 5, Duration::from_secs(3600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts, try again later"));
    }
    let pk = stx::pubkey(&b.pubkey).map_err(|_| err(StatusCode::BAD_REQUEST, "not a Solana address"))?;
    if !valid_locked(&b.locked) {
        return Err(err(StatusCode::BAD_REQUEST, "the wallet was not locked correctly"));
    }
    let sig: [u8; 64] = B64.decode(&b.proof).ok().and_then(|s| s.try_into().ok()).ok_or_else(|| err(StatusCode::BAD_REQUEST, "missing proof"))?;
    let key = VerifyingKey::from_bytes(&pk).map_err(|_| err(StatusCode::BAD_REQUEST, "not a valid key"))?;
    if key.verify(proof_message(&user.id, &b.pubkey).as_bytes(), &Signature::from_bytes(&sig)).is_err() {
        return Err(err(StatusCode::BAD_REQUEST, "the proof does not match the address"));
    }
    let v = c.acct.insert_new("kixo_wallets", json!({ "user_id": user.id, "pubkey": b.pubkey, "locked": b.locked })).await.map_err(auth)?;
    if v.as_array().is_none_or(|a| a.is_empty()) {
        return Err(err(StatusCode::CONFLICT, "This account already has a Kixo wallet"));
    }
    tracing::info!(user = user.id, pubkey = b.pubkey, "kixo wallet created");
    Ok(Json(json!({ "ok": true, "pubkey": b.pubkey })))
}

/// `POST /kixo-wallet/code`: emails a 6-digit code to the account address.
pub async fn send_code(State(c): State<WalletCtx>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    let email = user.email.clone().filter(|e| e.contains('@')).ok_or_else(|| err(StatusCode::BAD_REQUEST, "This account has no email address"))?;
    if !c.w.allow(&user.id, "code", 3, Duration::from_secs(600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many codes sent, wait a few minutes"));
    }
    c.acct.send_email_code(&email).await.map_err(auth)?;
    Ok(Json(json!({ "sent_to": mask(&email) })))
}

/// "mcmoji786@gmail.com" -> "mc•••@gmail.com".
pub fn mask(email: &str) -> String {
    match email.split_once('@') {
        Some((name, domain)) => format!("{}•••@{domain}", name.chars().take(2).collect::<String>()),
        None => "•••".into(),
    }
}

async fn code_ok(c: &WalletCtx, user: &crate::account::User, code: Option<&str>) -> Result<(), ApiErr> {
    let code = code.unwrap_or("").trim();
    if !c.w.allow(&user.id, "verify", 8, Duration::from_secs(900)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many tries, wait 15 minutes"));
    }
    let email = user.email.as_deref().unwrap_or("");
    if email.is_empty() || !c.acct.check_email_code(email, code).await {
        return Err(err(StatusCode::UNAUTHORIZED, "That code is wrong or expired"));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct CodeIn {
    code: Option<String>,
}

/// `POST /kixo-wallet/locked`: the locked copy, for unlocking on this device. With 2FA
/// on, only after the emailed code.
pub async fn locked(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<CodeIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    if !c.w.allow(&user.id, "locked", 20, Duration::from_secs(3600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts, try again later"));
    }
    let r = row(&c, &user.id).await?.ok_or_else(|| err(StatusCode::NOT_FOUND, "No Kixo wallet yet"))?;
    if r["two_fa"].as_bool() == Some(true) {
        if b.code.is_none() {
            return Err(err(StatusCode::PRECONDITION_REQUIRED, "code_required"));
        }
        code_ok(&c, &user, b.code.as_deref()).await?;
    }
    Ok(Json(json!({ "pubkey": r["pubkey"], "locked": r["locked"] })))
}

#[derive(Deserialize)]
pub struct TwoFaIn {
    on: bool,
    code: Option<String>,
}

/// `POST /kixo-wallet/two-fa`: turns the email code for new devices on or off. Either
/// way needs a fresh code, so a stolen session alone cannot turn it off.
pub async fn two_fa(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<TwoFaIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    code_ok(&c, &user, b.code.as_deref()).await?;
    let v = c.acct.rest(reqwest::Method::PATCH, &format!("kixo_wallets?user_id=eq.{}", user.id), Some(json!({ "two_fa": b.on, "updated_at": crate::account::chrono_iso(now_secs()) }))).await.map_err(auth)?;
    if v.as_array().is_none_or(|a| a.is_empty()) {
        return Err(err(StatusCode::NOT_FOUND, "No Kixo wallet yet"));
    }
    Ok(Json(json!({ "two_fa": b.on })))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Network fee of a one-signature transfer, plus its small priority fee
/// (1,000 compute units at 20,000 micro-lamports each).
const TRANSFER_FEE: u64 = 5_000 + 20;
/// Below this an account cannot exist on Solana (rent exemption for a plain account).
const RENT_MIN: u64 = 890_880;

#[derive(Deserialize)]
pub struct WithdrawIn {
    to: String,
    /// Lamports to send; ignored when `max` is set.
    #[serde(default)]
    lamports: u64,
    /// Send everything (the balance minus the network fee).
    #[serde(default)]
    max: bool,
}

/// What a withdrawal of `want` from a wallet holding `balance` sends, or why it cannot.
/// The wallet must end empty or above the rent minimum, and a new recipient must receive
/// at least the rent minimum.
pub fn withdraw_amount(balance: u64, want: u64, max: bool, recipient_balance: u64, fee_bps: u64) -> Result<(u64, u64), String> {
    let spendable = balance.saturating_sub(TRANSFER_FEE);
    let amount = if max { spendable } else { want };
    if amount == 0 || amount > spendable {
        return Err(format!("Not enough SOL: {:.4} SOL can be withdrawn", spendable as f64 / 1e9));
    }
    let left = balance - TRANSFER_FEE - amount;
    if left > 0 && left < RENT_MIN {
        return Err(format!("This would leave {:.6} SOL, below Solana's minimum. Withdraw everything (Max) or leave at least 0.00089 SOL", left as f64 / 1e9));
    }
    let fee = amount * fee_bps / 10_000;
    let receive = amount - fee;
    if recipient_balance == 0 && receive < RENT_MIN {
        return Err("A new address needs at least 0.00089 SOL to receive".into());
    }
    Ok((receive, fee))
}

/// The platform fee wallet (admin setting, else FEE_WALLET), when it can receive fees:
/// a fee transfer to an account below the rent minimum would fail.
async fn fee_wallet(c: &WalletCtx, rpc: &crate::trade::Rpc) -> Option<Pubkey> {
    let w = c.admin.fee_wallet().or_else(|| std::env::var("FEE_WALLET").ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))?;
    let pk = stx::pubkey(&w).ok()?;
    let bal = crate::trade::rpc(rpc, "getBalance", json!([w, { "commitment": "confirmed" }])).await.ok()?["value"].as_u64()?;
    (bal >= RENT_MIN).then_some(pk)
}

/// `POST /kixo-wallet/withdraw`: a SOL transfer from the user's Kixo wallet to any
/// address, unsigned. The browser signs it with the unlocked wallet. Withdrawals are
/// never switched off: users can always take their SOL out.
pub async fn withdraw(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<WithdrawIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    if !c.w.allow(&user.id, "withdraw", 20, Duration::from_secs(600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts, try again later"));
    }
    let r = row(&c, &user.id).await?.ok_or_else(|| err(StatusCode::NOT_FOUND, "No Kixo wallet yet"))?;
    let from = stx::pubkey(r["pubkey"].as_str().unwrap_or("")).map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "wallet address unreadable"))?;
    let to = stx::pubkey(b.to.trim()).map_err(|_| err(StatusCode::BAD_REQUEST, "That is not a Solana address"))?;
    if to == from {
        return Err(err(StatusCode::BAD_REQUEST, "That is this wallet itself"));
    }
    let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
    let unreachable = |_| err(StatusCode::BAD_GATEWAY, "Could not reach Solana, try again");
    let bal = |k: Pubkey| {
        let rpc = &rpc;
        async move { crate::trade::rpc(rpc, "getBalance", json!([stx::b58(&k), { "commitment": "confirmed" }])).await.map(|v| v["value"].as_u64().unwrap_or(0)) }
    };
    let (balance, recipient, hash, fee_to) = tokio::join!(bal(from), bal(to), crate::trade::rpc(&rpc, "getLatestBlockhash", json!([{ "commitment": "confirmed" }])), fee_wallet(&c, &rpc));
    let (balance, recipient, hash) = (balance.map_err(unreachable)?, recipient.map_err(unreachable)?, hash.map_err(unreachable)?);
    // Withdrawals never stop: without a fee wallet set up, no fee is taken. Moving money
    // to the user's own auto-trade wallet is free too.
    let to_own_auto = c
        .acct
        .rest(reqwest::Method::GET, &format!("auto_wallets?user_id=eq.{}&select=pubkey", user.id), None)
        .await
        .ok()
        .and_then(|v| v.as_array()?.first()?["pubkey"].as_str().map(String::from))
        .is_some_and(|p| p == stx::b58(&to));
    let fee_bps = if fee_to.is_some_and(|f| f != to) && !to_own_auto { crate::marketing::withdraw_fee_bps_for(&user.id) } else { 0 };
    let (lamports, fee) = withdraw_amount(balance, b.lamports, b.max, recipient, fee_bps).map_err(|m| err(StatusCode::BAD_REQUEST, &m))?;
    let blockhash = stx::pubkey(hash["value"]["blockhash"].as_str().unwrap_or("")).map_err(|_| err(StatusCode::BAD_GATEWAY, "Could not reach Solana, try again"))?;
    let mut ixs = vec![stx::compute_unit_limit(1_000), stx::compute_unit_price(20_000), stx::transfer(&from, &to, lamports)];
    if let (Some(f), true) = (fee_to, fee > 0) {
        ixs.push(stx::transfer(&from, &f, fee));
    }
    let message = stx::compile_v0(&from, &ixs, &[], &blockhash).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    let id = format!("{:016x}{:016x}", rand_u64(), rand_u64());
    {
        let mut builds = c.w.builds.lock().expect("builds lock");
        builds.retain(|_, d| d.created.elapsed() < BUILD_TTL);
        builds.insert(id.clone(), Build { user: user.id.clone(), from, message: message.clone(), created: Instant::now(), kind: "withdraw", amount: lamports, fee });
    }
    Ok(Json(json!({ "build_id": id, "tx": B64.encode(stx::unsigned_tx(&message)), "lamports": lamports, "kixo_fee": fee, "fee_wallet": fee_to.filter(|_| fee > 0).map(|f| stx::b58(&f)), "network_fee": TRANSFER_FEE, "to": stx::b58(&to) })))
}

pub(crate) fn rand_u64() -> u64 {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut b = [0u8; 8];
    SystemRandom::new().fill(&mut b).expect("os random");
    u64::from_le_bytes(b)
}

#[derive(Deserialize)]
pub struct SendIn {
    build_id: String,
    tx: String,
}

#[derive(Deserialize)]
pub struct DepositIn {
    /// The user's Phantom address (read from Phantom; nothing is signed to connect).
    from: String,
    lamports: u64,
}

/// `POST /kixo-wallet/deposit`: a SOL transfer of exactly `lamports` from the user's
/// Phantom to their Kixo wallet, unsigned, for Phantom to show and sign.
pub async fn deposit(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<DepositIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    if !c.admin.wallet_deposits() {
        return Err(err(StatusCode::FORBIDDEN, "Deposits open after Kixo's security review"));
    }
    if let Some(why) = crate::ops::paused(&user.id) {
        return Err(err(StatusCode::FORBIDDEN, &format!("Deposits are paused on this account{}. Contact support. Withdrawals still work", if why.is_empty() { String::new() } else { format!(": {why}") })));
    }
    let (min, max) = crate::platform::deposit_range_lamports();
    if !(min..=max).contains(&b.lamports) {
        return Err(err(StatusCode::BAD_REQUEST, &format!("Deposit between {} and {} SOL", min as f64 / 1e9, max as f64 / 1e9)));
    }
    if !c.w.allow(&user.id, "deposit", 20, Duration::from_secs(600)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many attempts, try again later"));
    }
    let r = row(&c, &user.id).await?.ok_or_else(|| err(StatusCode::NOT_FOUND, "Set up your Kixo wallet first"))?;
    let to = stx::pubkey(r["pubkey"].as_str().unwrap_or("")).map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "wallet address unreadable"))?;
    let from = stx::pubkey(b.from.trim()).map_err(|_| err(StatusCode::BAD_REQUEST, "That is not a Solana address"))?;
    if from == to {
        return Err(err(StatusCode::BAD_REQUEST, "That is your Kixo wallet itself"));
    }
    let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
    let fee_bps = crate::marketing::deposit_fee_bps_for(&user.id);
    let (hash, fee_to) = tokio::join!(crate::trade::rpc(&rpc, "getLatestBlockhash", json!([{ "commitment": "confirmed" }])), fee_wallet(&c, &rpc));
    let hash = hash.map_err(|_| err(StatusCode::BAD_GATEWAY, "Could not reach Solana, try again"))?;
    let blockhash = stx::pubkey(hash["value"]["blockhash"].as_str().unwrap_or("")).map_err(|_| err(StatusCode::BAD_GATEWAY, "Could not reach Solana, try again"))?;
    // Deposits are free unless the admin sets a fee; only a fee needs the fee wallet.
    let (credit, fee) = deposit_split(b.lamports, fee_bps);
    let mut ixs = vec![stx::compute_unit_limit(1_000), stx::compute_unit_price(20_000), stx::transfer(&from, &to, credit)];
    let fee_to = if fee > 0 {
        let f = fee_to.ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "Deposits are not set up yet: the platform fee wallet is missing or holds under 0.001 SOL"))?;
        ixs.push(stx::transfer(&from, &f, fee));
        Some(f)
    } else {
        None
    };
    let message = stx::compile_v0(&from, &ixs, &[], &blockhash).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    let id = format!("{:016x}{:016x}", rand_u64(), rand_u64());
    {
        let mut builds = c.w.builds.lock().expect("builds lock");
        builds.retain(|_, d| d.created.elapsed() < BUILD_TTL);
        builds.insert(id.clone(), Build { user: user.id.clone(), from, message: message.clone(), created: Instant::now(), kind: "deposit", amount: credit, fee });
    }
    Ok(Json(json!({ "build_id": id, "tx": B64.encode(stx::unsigned_tx(&message)), "lamports": b.lamports, "credit": credit, "kixo_fee": fee, "fee_wallet": fee_to.map(|f| stx::b58(&f)), "to": stx::b58(&to) })))
}

/// A deposit of `lamports` from Phantom: what reaches the Kixo wallet and Kixo's 1%.
pub fn deposit_split(lamports: u64, fee_bps: u64) -> (u64, u64) {
    let fee = lamports * fee_bps / 10_000;
    (lamports - fee, fee)
}

/// `POST /kixo-wallet/withdraw/send` and `/kixo-wallet/deposit/send`: checks the signer
/// (the Kixo wallet for a withdrawal, Phantom for a deposit) signed exactly the transfer
/// we built and sends it (Kixo Sender plus the RPC), re-sending for 20 s.
pub async fn transfer_send(State(c): State<WalletCtx>, headers: HeaderMap, Json(b): Json<SendIn>) -> Result<Json<Value>, ApiErr> {
    let user = c.acct.user(&headers).await.map_err(auth)?;
    let d = {
        let mut builds = c.w.builds.lock().expect("builds lock");
        match builds.get(&b.build_id) {
            Some(d) if d.user != user.id => return Err(err(StatusCode::BAD_REQUEST, "not your transfer")),
            Some(d) if d.created.elapsed() > BUILD_TTL => {
                builds.remove(&b.build_id);
                return Err(err(StatusCode::GONE, "This transfer expired, start again"));
            }
            Some(_) => builds.remove(&b.build_id).expect("present"),
            None => return Err(err(StatusCode::GONE, "This transfer expired or was already sent")),
        }
    };
    let tx = B64.decode(b.tx.trim()).map_err(|_| err(StatusCode::BAD_REQUEST, "unreadable transaction"))?;
    if !stx::verify_signed(&tx, &d.message, &d.from) {
        return Err(err(StatusCode::BAD_REQUEST, "The signed transfer is not the one we built"));
    }
    let (sigs, _) = stx::split_tx(&tx).expect("verified");
    let signature = stx::b58(&sigs[0]);
    let raw = B64.encode(&tx);
    let send = |c: WalletCtx, raw: String, tx: Vec<u8>| async move {
        c.sender.send_many(&[&tx], Instant::now()).await;
        let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
        let _ = crate::trade::rpc(&rpc, "sendTransaction", json!([raw, { "encoding": "base64", "skipPreflight": true, "maxRetries": 0 }])).await;
    };
    crate::ops::log_transfer(json!({ "ts": now_secs(), "user": user.id, "kind": d.kind, "sig": signature, "amount": d.amount, "fee": d.fee, "status": "sent" }));
    send(c.clone(), raw.clone(), tx.clone()).await;
    let sig = signature.clone();
    tokio::spawn(async move {
        for _ in 0..10 {
            tokio::time::sleep(Duration::from_secs(2)).await;
            send(c.clone(), raw.clone(), tx.clone()).await;
        }
        // Record how it ended, for the earnings: checked now, then once more later.
        let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
        for wait in [0u64, 60, 120] {
            tokio::time::sleep(Duration::from_secs(wait)).await;
            let v = crate::trade::rpc(&rpc, "getSignatureStatuses", json!([[sig], { "searchTransactionHistory": true }])).await.ok();
            let s = v.as_ref().map(|v| v["value"][0].clone()).unwrap_or(Value::Null);
            if matches!(s["confirmationStatus"].as_str(), Some("confirmed" | "finalized")) {
                crate::ops::log_transfer(json!({ "sig": sig, "status": if s["err"].is_null() { "confirmed" } else { "failed" } }));
                return;
            }
        }
        // Never seen by the chain: the blockhash has long expired, so it never will be.
        crate::ops::log_transfer(json!({ "sig": sig, "status": "failed" }));
    });
    tracing::info!(user = user.id, signature, "transfer sent");
    Ok(Json(json!({ "signature": signature })))
}

/// `GET /kixo-wallet/status/{sig}`: whether a deposit landed.
pub async fn status(State(c): State<WalletCtx>, headers: HeaderMap, Path(sig): Path<String>) -> Result<Json<Value>, ApiErr> {
    c.acct.user(&headers).await.map_err(auth)?;
    if sig.len() > 100 || !sig.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(err(StatusCode::BAD_REQUEST, "not a signature"));
    }
    let rpc = crate::trade::Rpc { http: c.app.http.clone(), url: c.app.config.helius_rpc_url() };
    let v = crate::trade::rpc(&rpc, "getSignatureStatuses", json!([[sig], { "searchTransactionHistory": false }])).await.map_err(|_| err(StatusCode::BAD_GATEWAY, "Could not reach Solana"))?;
    let s = &v["value"][0];
    let status = match (s["confirmationStatus"].as_str(), s["err"].is_null()) {
        (Some("confirmed" | "finalized"), true) => "confirmed",
        (Some("confirmed" | "finalized"), false) => "failed",
        _ => "sent",
    };
    Ok(Json(json!({ "status": status })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> Value {
        json!({ "v": 1, "kdf": "PBKDF2-SHA256", "cipher": "AES-256-GCM", "iterations": 600000, "salt": B64.encode([1u8; 16]), "iv": B64.encode([2u8; 12]), "ciphertext": B64.encode([3u8; 48]) })
    }

    #[test]
    fn only_a_properly_locked_key_is_stored() {
        assert!(valid_locked(&good()));
        let mut weak = good();
        weak["iterations"] = json!(1000);
        assert!(!valid_locked(&weak));
        let mut extra = good();
        extra["secret"] = json!("plain key");
        assert!(!valid_locked(&extra));
        let mut long = good();
        long["ciphertext"] = json!(B64.encode([3u8; 80]));
        assert!(!valid_locked(&long));
    }

    #[test]
    fn withdrawals_respect_fees_and_rent() {
        // Max empties the wallet exactly: the network fee, then 1% to Kixo, the rest out.
        let all = 1_000_000_000 - TRANSFER_FEE;
        assert_eq!(withdraw_amount(1_000_000_000, 0, true, 5, 100), Ok((all - all / 100, all / 100)));
        // Without a fee wallet nothing is taken.
        assert_eq!(withdraw_amount(1_000_000_000, 0, true, 5, 0), Ok((all, 0)));
        // Leaving dust below the rent minimum is refused.
        assert!(withdraw_amount(1_000_000_000, 1_000_000_000 - TRANSFER_FEE - 1_000, false, 5, 100).is_err());
        // 0.5 SOL out: 0.495 arrives, 0.005 to Kixo.
        assert_eq!(withdraw_amount(1_000_000_000, 500_000_000, false, 5, 100), Ok((495_000_000, 5_000_000)));
        // More than the balance is refused.
        assert!(withdraw_amount(1_000_000, 2_000_000, false, 5, 100).is_err());
        // A brand new recipient needs the rent minimum after the fee.
        assert!(withdraw_amount(1_000_000_000, 899_000, false, 0, 100).is_err());
        assert!(withdraw_amount(0, 0, true, 0, 100).is_err());
        // Deposits: 1 SOL from Phantom puts 0.99 in the Kixo wallet.
        assert_eq!(deposit_split(1_000_000_000, 100), (990_000_000, 10_000_000));
        assert_eq!(deposit_split(MIN_DEPOSIT, 100), (990_000, 10_000));
        assert_eq!(deposit_split(1_000_000_000, 0), (1_000_000_000, 0));
    }

    /// The browser signs an unsigned transfer the way `signTxWithKixo` does: byte 0 is
    /// the signature count (1), bytes 1..65 the signature, then the message.
    #[test]
    fn a_browser_signed_withdrawal_verifies() {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let from: Pubkey = key.verifying_key().to_bytes();
        let to: Pubkey = [9u8; 32];
        let ixs = [stx::compute_unit_limit(1_000), stx::compute_unit_price(20_000), stx::transfer(&from, &to, 5_000_000)];
        let message = stx::compile_v0(&from, &ixs, &[], &[1u8; 32]).unwrap();
        let mut tx = stx::unsigned_tx(&message);
        assert_eq!(tx[0], 1);
        let sig = key.sign(&tx[65..]).to_bytes();
        tx[1..65].copy_from_slice(&sig);
        assert!(stx::verify_signed(&tx, &message, &from));
        // Any other signer is refused.
        assert!(!stx::verify_signed(&tx, &message, &to));
    }

    #[test]
    fn emails_are_masked() {
        assert_eq!(mask("mcmoji786@gmail.com"), "mc•••@gmail.com");
    }
}
