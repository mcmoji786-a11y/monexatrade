//! Our own PumpSwap trades for pump.fun coins that have graduated into a SOL pool.
//!
//! Accounts follow the PumpSwap IDL plus the three the live program expects after them
//! (read from real mainnet trades, 2026-11-07): the `pool-v2` PDA of the coin, a
//! buyback fee recipient from GlobalConfig.buyback_fee_recipients, and that
//! recipient's wrapped-SOL account.
//! SOL is wrapped into the user's own wrapped-SOL account for the swap and unwrapped
//! straight after, so nothing is left behind. Pools quoted in another token use Jupiter.

use crate::pumpfun_tx::{ata, create_ata_idempotent, ATA_PROGRAM, TOKEN};
use crate::solana_tx::{self as stx, AccountMeta, Instruction, Pubkey};
use monexa_ingest::pumpswap::find_pda;

pub const PROGRAM: &str = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const FEE_PROGRAM: &str = crate::pumpfun_tx::FEE_PROGRAM;
const SYSTEM: &str = "11111111111111111111111111111111";
const BUY_EXACT_QUOTE_IN: [u8; 8] = [198, 46, 21, 82, 180, 217, 232, 112];
const SELL: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];
const POOL_DISC: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];
/// Fee assumed when estimating amounts; slippage covers the difference and every trade
/// is simulated first.
pub const EST_FEE_BPS: u128 = 125;

fn pk(s: &str) -> Pubkey {
    stx::pubkey(s).expect("constant address")
}

fn pda(seeds: &[&[u8]], program: &str) -> Pubkey {
    find_pda(seeds, &pk(program)).expect("pda")
}

pub fn global_config() -> Pubkey {
    pda(&[b"global_config"], PROGRAM)
}

/// A PumpSwap pool and its reserves.
#[derive(Clone, Debug)]
pub struct Pool {
    pub key: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub pool_base: Pubkey,
    pub pool_quote: Pubkey,
    pub coin_creator: Pubkey,
    pub mayhem: bool,
    /// Extra quote the pool prices with on top of its real balance (newer pools start
    /// with about 17.5 SOL of it). Read from the pool; may be zero.
    pub virtual_quote: i128,
    pub base_reserve: u64,
    /// Effective quote reserve: the quote account's balance plus `virtual_quote`.
    pub quote_reserve: u64,
}

impl Pool {
    /// Parses the pool account; reserves come from its two token accounts.
    pub fn parse(key: Pubkey, d: &[u8]) -> Option<Self> {
        if d.len() < 245 || d[..8] != POOL_DISC {
            return None;
        }
        let k = |o: usize| -> Option<Pubkey> { d[o..o + 32].try_into().ok() };
        Some(Self {
            key,
            base_mint: k(43)?,
            quote_mint: k(75)?,
            pool_base: k(139)?,
            pool_quote: k(171)?,
            coin_creator: k(211)?,
            mayhem: d[243] != 0,
            virtual_quote: d.get(245..261).map(|b| i128::from_le_bytes(b.try_into().expect("16"))).unwrap_or(0),
            base_reserve: 0,
            quote_reserve: 0,
        })
    }

    /// Sets the reserves from the pool's two token accounts.
    pub fn set_reserves(&mut self, base_balance: u64, quote_balance: u64) {
        self.base_reserve = base_balance;
        self.quote_reserve = (quote_balance as i128 + self.virtual_quote).clamp(0, u64::MAX as i128) as u64;
    }

    pub fn sol_quoted(&self) -> bool {
        stx::b58(&self.quote_mint) == crate::trade::WSOL
    }

    /// Tokens out for `lamports` in, after the estimated fee.
    pub fn tokens_for(&self, lamports: u64) -> u64 {
        let net = lamports as u128 * 10_000 / (10_000 + EST_FEE_BPS);
        (self.base_reserve as u128 * net / (self.quote_reserve as u128 + net)) as u64
    }

    /// Lamports out for `tokens` in, after the estimated fee.
    pub fn sol_for(&self, tokens: u64) -> u64 {
        let gross = self.quote_reserve as u128 * tokens as u128 / (self.base_reserve as u128 + tokens as u128);
        (gross * (10_000 - EST_FEE_BPS) / 10_000) as u64
    }
}

/// Fee recipients from PumpSwap's GlobalConfig (offsets follow the IDL; verified on
/// mainnet: protocol list at 57, buyback list at 643).
#[derive(Clone, Debug)]
pub struct Config {
    pub protocol_fee_recipients: Vec<Pubkey>,
    pub reserved_fee_recipients: Vec<Pubkey>,
    pub buyback_fee_recipients: Vec<Pubkey>,
}

impl Config {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 899 {
            return None;
        }
        let list = |start: usize, n: usize| -> Vec<Pubkey> { (0..n).filter_map(|i| d[start + 32 * i..start + 32 * (i + 1)].try_into().ok()).filter(|k: &Pubkey| *k != [0u8; 32]).collect() };
        let mut reserved = list(385, 1);
        reserved.extend(list(418, 7));
        Some(Self { protocol_fee_recipients: list(57, 8), reserved_fee_recipients: reserved, buyback_fee_recipients: list(643, 8) })
    }
}

fn meta(pubkey: Pubkey, writable: bool) -> AccountMeta {
    AccountMeta { pubkey, signer: false, writable }
}

/// The accounts both directions share (0 to 18).
fn common(user: &Pubkey, p: &Pool, base_program: &Pubkey, cfg: &Config, pick: usize) -> Option<Vec<AccountMeta>> {
    let quote_program = pk(TOKEN);
    let list = if p.mayhem && !cfg.reserved_fee_recipients.is_empty() { &cfg.reserved_fee_recipients } else { &cfg.protocol_fee_recipients };
    let recipient = *list.get(pick % list.len().max(1))?;
    let vault_authority = pda(&[b"creator_vault", &p.coin_creator], PROGRAM);
    Some(vec![
        meta(p.key, true),
        AccountMeta { pubkey: *user, signer: true, writable: true },
        meta(global_config(), false),
        meta(p.base_mint, false),
        meta(p.quote_mint, false),
        meta(ata(user, &p.base_mint, base_program), true),
        meta(ata(user, &p.quote_mint, &quote_program), true),
        meta(p.pool_base, true),
        meta(p.pool_quote, true),
        meta(recipient, false),
        meta(ata(&recipient, &p.quote_mint, &quote_program), true),
        meta(*base_program, false),
        meta(quote_program, false),
        meta(pk(SYSTEM), false),
        meta(pk(ATA_PROGRAM), false),
        meta(pda(&[b"__event_authority"], PROGRAM), false),
        meta(pk(PROGRAM), false),
        meta(ata(&vault_authority, &p.quote_mint, &quote_program), true),
        meta(vault_authority, false),
    ])
}

fn fee_config() -> Pubkey {
    pda(&[b"fee_config", &pk(PROGRAM)], FEE_PROGRAM)
}

/// The three accounts the live program expects after the IDL ones: the pool's
/// `pool-v2` PDA, a buyback fee recipient and its wrapped-SOL account.
fn extras(cfg: &Config, p: &Pool, pick: usize) -> Option<[AccountMeta; 3]> {
    let r = *cfg.buyback_fee_recipients.get(pick % cfg.buyback_fee_recipients.len().max(1))?;
    Some([meta(pool_v2(&p.base_mint), true), meta(r, true), meta(ata(&r, &p.quote_mint, &pk(TOKEN)), true)])
}

pub fn pool_v2(base_mint: &Pubkey) -> Pubkey {
    pda(&[b"pool-v2", base_mint], PROGRAM)
}

fn token_ix(data: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction { program: pk(TOKEN), accounts, data }
}

/// Buys with exactly `lamports` of SOL, receiving at least `min_tokens`.
pub fn buy(user: &Pubkey, p: &Pool, base_program: &Pubkey, cfg: &Config, lamports: u64, min_tokens: u64, pick: usize) -> Option<Vec<Instruction>> {
    let wsol = ata(user, &p.quote_mint, &pk(TOKEN));
    let mut accounts = common(user, p, base_program, cfg, pick)?;
    accounts.push(meta(pda(&[b"global_volume_accumulator"], PROGRAM), false));
    accounts.push(meta(pda(&[b"user_volume_accumulator", user], PROGRAM), true));
    accounts.push(meta(fee_config(), false));
    accounts.push(meta(pk(FEE_PROGRAM), false));
    accounts.extend(extras(cfg, p, pick)?);
    let mut data = BUY_EXACT_QUOTE_IN.to_vec();
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&min_tokens.to_le_bytes());
    data.push(1); // track_volume: Some(true)
    Some(vec![
        create_ata_idempotent(user, &p.quote_mint, &pk(TOKEN)),
        stx::transfer(user, &wsol, lamports),
        token_ix(vec![17], vec![meta(wsol, true)]), // SyncNative
        create_ata_idempotent(user, &p.base_mint, base_program),
        Instruction { program: pk(PROGRAM), accounts, data },
        token_ix(vec![9], vec![meta(wsol, true), meta(*user, true), AccountMeta { pubkey: *user, signer: true, writable: false }]), // CloseAccount
    ])
}

/// Sells `tokens`, receiving at least `min_lamports` of SOL.
pub fn sell(user: &Pubkey, p: &Pool, base_program: &Pubkey, cfg: &Config, tokens: u64, min_lamports: u64, pick: usize) -> Option<Vec<Instruction>> {
    let wsol = ata(user, &p.quote_mint, &pk(TOKEN));
    let mut accounts = common(user, p, base_program, cfg, pick)?;
    accounts.push(meta(fee_config(), false));
    accounts.push(meta(pk(FEE_PROGRAM), false));
    accounts.extend(extras(cfg, p, pick)?);
    let mut data = SELL.to_vec();
    data.extend_from_slice(&tokens.to_le_bytes());
    data.extend_from_slice(&min_lamports.to_le_bytes());
    Some(vec![
        create_ata_idempotent(user, &p.quote_mint, &pk(TOKEN)),
        Instruction { program: pk(PROGRAM), accounts, data },
        token_ix(vec![9], vec![meta(wsol, true), meta(*user, true), AccountMeta { pubkey: *user, signer: true, writable: false }]), // CloseAccount
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_live_addresses() {
        // Addresses read from real mainnet PumpSwap trades on 2026-11-07.
        assert_eq!(stx::b58(&global_config()), "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
        assert_eq!(stx::b58(&pda(&[b"__event_authority"], PROGRAM)), "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
        assert_eq!(stx::b58(&pda(&[b"global_volume_accumulator"], PROGRAM)), "C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw");
        assert_eq!(stx::b58(&fee_config()), "5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx");
        assert_eq!(stx::b58(&pool_v2(&pk("5VCEFq1aATjga39QtDunYjJqYBx67w8V8TXwHrqopump"))), "CmCmAZTNacaSUUfwq8cjSh6RUb2Qnx2Brii2jLrLLbku");
        let user = pk("35dszeQQQzkMvjcmyrPWPnN5ZyK9ZjYkNp9kKXZWMvji");
        assert_eq!(stx::b58(&pda(&[b"user_volume_accumulator", &user], PROGRAM)), "8dmYGc9x4r5kEaAffcC2LkeZnW9bYG7FToSsm1Zgyjqr");
        let wsol = pk(crate::trade::WSOL);
        assert_eq!(stx::b58(&ata(&pk("EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL"), &wsol, &pk(TOKEN))), "CA7v8gHfbquYXyDnDx6QxWW8hmL1H7X6Y2RYDrGLnuck");
    }
}
