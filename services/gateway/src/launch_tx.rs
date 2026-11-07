//! Our own trades on two more launchpads' bonding curves:
//! - Meteora Dynamic Bonding Curve (DBC). Bags, Believe and many others launch on it.
//! - Raydium LaunchLab, which powers bonk.fun.
//!
//! Account lists follow each program's published IDL (MeteoraAg/dynamic-bonding-curve-sdk
//! and raydium-io/raydium-idl), checked against real mainnet trades on 2026-11-07.
//! LaunchLab now also expects the system program and the platform and creator fee vaults
//! after the IDL accounts. Their curves are not plain constant product, so the gateway
//! quotes these trades by simulation (see trade.rs) instead of with a formula.

use crate::pumpfun_tx::{ata, create_ata_idempotent, TOKEN};
use crate::solana_tx::{self as stx, AccountMeta, Instruction, Pubkey};
use monexa_ingest::pumpswap::find_pda;

pub const DBC: &str = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
pub const LAUNCHLAB: &str = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const DBC_POOL_AUTHORITY: &str = "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM";
const SYSTEM: &str = "11111111111111111111111111111111";
const DBC_SWAP: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];
const DBC_POOL_DISC: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];
const LAB_BUY: [u8; 8] = [250, 234, 13, 123, 213, 156, 19, 236];
const LAB_SELL: [u8; 8] = [149, 39, 222, 155, 211, 124, 152, 26];
const LAB_POOL_DISC: [u8; 8] = [247, 237, 227, 245, 215, 195, 222, 70];

fn pk(s: &str) -> Pubkey {
    stx::pubkey(s).expect("constant address")
}

fn pda(seeds: &[&[u8]], program: &str) -> Pubkey {
    find_pda(seeds, &pk(program)).expect("pda")
}

fn meta(pubkey: Pubkey, writable: bool) -> AccountMeta {
    AccountMeta { pubkey, signer: false, writable }
}

fn key(d: &[u8], o: usize) -> Option<Pubkey> {
    d.get(o..o + 32)?.try_into().ok()
}

/// A Meteora DBC pool still on its curve. The quote mint lives in its config account.
#[derive(Clone, Debug)]
pub struct DbcPool {
    pub key: Pubkey,
    pub config: Pubkey,
    pub base_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
}

impl DbcPool {
    pub fn parse(key: Pubkey, d: &[u8]) -> Option<Self> {
        if d.len() < 424 || d[..8] != DBC_POOL_DISC || d[305] != 0 {
            return None; // not a pool, or already migrated to its AMM
        }
        Some(Self { key, config: key_at(d, 72)?, base_mint: key_at(d, 136)?, base_vault: key_at(d, 168)?, quote_vault: key_at(d, 200)? })
    }
}

fn key_at(d: &[u8], o: usize) -> Option<Pubkey> {
    key(d, o)
}

/// Quote mint of a DBC config account.
pub fn dbc_quote_mint(config: &[u8]) -> Option<Pubkey> {
    key(config, 8)
}

/// A Raydium LaunchLab pool still raising (status 0).
#[derive(Clone, Debug)]
pub struct LabPool {
    pub key: Pubkey,
    pub global_config: Pubkey,
    pub platform_config: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub creator: Pubkey,
}

impl LabPool {
    pub fn parse(key: Pubkey, d: &[u8]) -> Option<Self> {
        if d.len() < 429 || d[..8] != LAB_POOL_DISC || d[17] != 0 {
            return None; // not a pool, or no longer trading on its curve
        }
        Some(Self {
            key,
            global_config: key_at(d, 141)?,
            platform_config: key_at(d, 173)?,
            base_mint: key_at(d, 205)?,
            quote_mint: key_at(d, 237)?,
            base_vault: key_at(d, 269)?,
            quote_vault: key_at(d, 301)?,
            creator: key_at(d, 333)?,
        })
    }
}

/// LaunchLab's pool for a coin quoted in `quote`: PDA of ["pool", base, quote].
pub fn lab_pool(base: &Pubkey, quote: &Pubkey) -> Pubkey {
    pda(&[b"pool", base, quote], LAUNCHLAB)
}

/// Wraps `lamports` into the user's wrapped-SOL account (created if missing).
fn wrap(user: &Pubkey, wsol_mint: &Pubkey, lamports: u64) -> Vec<Instruction> {
    let wsol = ata(user, wsol_mint, &pk(TOKEN));
    let mut v = vec![create_ata_idempotent(user, wsol_mint, &pk(TOKEN))];
    if lamports > 0 {
        v.push(stx::transfer(user, &wsol, lamports));
        v.push(Instruction { program: pk(TOKEN), accounts: vec![meta(wsol, true)], data: vec![17] }); // SyncNative
    }
    v
}

/// Closes the user's wrapped-SOL account, returning all of it as SOL to the user.
pub fn unwrap(user: &Pubkey, wsol_mint: &Pubkey) -> Instruction {
    let wsol = ata(user, wsol_mint, &pk(TOKEN));
    Instruction { program: pk(TOKEN), accounts: vec![meta(wsol, true), meta(*user, true), AccountMeta { pubkey: *user, signer: true, writable: false }], data: vec![9] }
}

/// A DBC swap. Buy: `amount_in` lamports for at least `min_out` tokens. Sell: `amount_in`
/// tokens for at least `min_out` lamports. `close` unwraps the SOL at the end (left out
/// only in the quote simulation, which reads the wrapped balance instead).
#[allow(clippy::too_many_arguments)]
pub fn dbc_swap(user: &Pubkey, p: &DbcPool, quote_mint: &Pubkey, base_program: &Pubkey, buy: bool, amount_in: u64, min_out: u64, close: bool) -> Vec<Instruction> {
    let user_base = ata(user, &p.base_mint, base_program);
    let user_quote = ata(user, quote_mint, &pk(TOKEN));
    let (input, output) = if buy { (user_quote, user_base) } else { (user_base, user_quote) };
    let mut data = DBC_SWAP.to_vec();
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_out.to_le_bytes());
    let swap = Instruction {
        program: pk(DBC),
        accounts: vec![
            meta(pk(DBC_POOL_AUTHORITY), false),
            meta(p.config, false),
            meta(p.key, true),
            meta(input, true),
            meta(output, true),
            meta(p.base_vault, true),
            meta(p.quote_vault, true),
            meta(p.base_mint, false),
            meta(*quote_mint, false),
            AccountMeta { pubkey: *user, signer: true, writable: true },
            meta(*base_program, false),
            meta(pk(TOKEN), false),
            meta(pk(DBC), false), // no referral: the program id stands in
            meta(pda(&[b"__event_authority"], DBC), false),
            meta(pk(DBC), false),
        ],
        data,
    };
    let mut v = wrap(user, quote_mint, if buy { amount_in } else { 0 });
    v.push(create_ata_idempotent(user, &p.base_mint, base_program));
    v.push(swap);
    if close {
        v.push(unwrap(user, quote_mint));
    }
    v
}

/// A LaunchLab swap, as `dbc_swap`.
pub fn lab_swap(user: &Pubkey, p: &LabPool, base_program: &Pubkey, buy: bool, amount_in: u64, min_out: u64, close: bool) -> Vec<Instruction> {
    let mut data = if buy { LAB_BUY } else { LAB_SELL }.to_vec();
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_out.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // share_fee_rate: no share fee
    let swap = Instruction {
        program: pk(LAUNCHLAB),
        accounts: vec![
            AccountMeta { pubkey: *user, signer: true, writable: true },
            meta(pda(&[b"vault_auth_seed"], LAUNCHLAB), false),
            meta(p.global_config, false),
            meta(p.platform_config, false),
            meta(p.key, true),
            meta(ata(user, &p.base_mint, base_program), true),
            meta(ata(user, &p.quote_mint, &pk(TOKEN)), true),
            meta(p.base_vault, true),
            meta(p.quote_vault, true),
            meta(p.base_mint, false),
            meta(p.quote_mint, false),
            meta(*base_program, false),
            meta(pk(TOKEN), false),
            meta(pda(&[b"__event_authority"], LAUNCHLAB), false),
            meta(pk(LAUNCHLAB), false),
            meta(pk(SYSTEM), false),
            meta(pda(&[&p.platform_config, &p.quote_mint], LAUNCHLAB), true),
            meta(pda(&[&p.creator, &p.quote_mint], LAUNCHLAB), true),
        ],
        data,
    };
    let mut v = wrap(user, &p.quote_mint, if buy { amount_in } else { 0 });
    v.push(create_ata_idempotent(user, &p.base_mint, base_program));
    v.push(swap);
    if close {
        v.push(unwrap(user, &p.quote_mint));
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_live_addresses() {
        // Addresses read from real mainnet trades on 2026-11-07.
        assert_eq!(stx::b58(&pda(&[b"__event_authority"], DBC)), "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");
        assert_eq!(stx::b58(&pda(&[b"vault_auth_seed"], LAUNCHLAB)), "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
        assert_eq!(stx::b58(&pda(&[b"__event_authority"], LAUNCHLAB)), "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr");
        let wsol = pk(crate::trade::WSOL);
        assert_eq!(stx::b58(&lab_pool(&pk("9Xfj9yQFJurpJMLevySfAgdn5oQ4AYzhRjLvyshwRY5p"), &wsol)), "ENZ5tiytTqm253tV1kR235X5hfZthhfNUXApmixggEap");
        assert_eq!(stx::b58(&pda(&[&pk("GyMuvy3febHAsn5Vb71AyByHBnAgjJHBpCHYDxYCrHGT"), &wsol], LAUNCHLAB)), "4TkUqZKhNrkD6my9kJCQ3qZfEpwNxy66JWAAEB7DGfXW");
        assert_eq!(stx::b58(&pda(&[&pk("5UtgmGbtDQGX8bvEZpjZgcvRbS49tUZAwNvv1k6GLAfV"), &wsol], LAUNCHLAB)), "79NEGmidrH97J1FgSKL6qniygwx6BDdV4TP4rK9yYCTv");
    }
}
