//! Our own pump.fun bonding-curve trades: buy and sell instructions built straight
//! from chain state, with no router in between. Faster than a router round trip, no
//! rate limit, and coins tradeable from their first second.
//!
//! The account list follows the program's IDL plus the two accounts the live program
//! now expects after it (read from real mainnet trades, 2026-11-07):
//! - `bonding-curve-v2`: PDA of ["bonding-curve-v2", mint] under the pump program,
//!   for every coin. Mayhem's own agent passes a Mayhem-program PDA when it trades its
//!   coins; a normal user must pass the pump one (checked by simulation).
//! - A buyback fee recipient: any entry of Global.buyback_fee_recipients.
//!
//! Every trade is simulated before the user signs, and the gateway falls back to
//! Jupiter if this builder cannot handle a coin.

use crate::solana_tx::{self as stx, AccountMeta, Instruction, Pubkey};
use monexa_ingest::pumpswap::find_pda;

pub const PROGRAM: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
pub const MAYHEM_PROGRAM: &str = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e";
pub const FEE_PROGRAM: &str = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
pub const TOKEN: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const TOKEN_2022: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
pub const ATA_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM: &str = "11111111111111111111111111111111";

const BUY_EXACT_SOL_IN: [u8; 8] = [56, 252, 116, 8, 158, 223, 205, 95];
const SELL: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];
const CURVE_DISC: [u8; 8] = [0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60];
/// fee_config PDA seed (the fee program's config for the pump program).
const FEE_CONFIG_SEED: [u8; 32] = [
    1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176,
];
/// Fee assumed when estimating amounts (protocol plus creator; tiers vary). The
/// slippage limit covers any difference and simulation confirms every trade.
pub const EST_FEE_BPS: u128 = 125;

/// The state of one bonding curve.
#[derive(Clone, Debug, PartialEq)]
pub struct Curve {
    pub virtual_token: u64,
    pub virtual_sol: u64,
    pub real_token: u64,
    pub complete: bool,
    pub creator: Pubkey,
    pub mayhem: bool,
    pub cashback: bool,
    /// Quote token; all-zero or wrapped SOL means SOL.
    pub quote_mint: Pubkey,
}

impl Curve {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 115 || d[..8] != CURVE_DISC {
            return None;
        }
        let u = |o: usize| u64::from_le_bytes(d[o..o + 8].try_into().expect("8"));
        Some(Self {
            virtual_token: u(8),
            virtual_sol: u(16),
            real_token: u(24),
            complete: d[48] != 0,
            creator: d[49..81].try_into().ok()?,
            mayhem: d[81] != 0,
            cashback: d[82] != 0,
            quote_mint: d[83..115].try_into().ok()?,
        })
    }

    pub fn sol_quoted(&self) -> bool {
        self.quote_mint == [0u8; 32] || stx::b58(&self.quote_mint) == crate::trade::WSOL
    }

    /// Tokens out for `lamports` spent, before fees are taken.
    pub fn tokens_for(&self, lamports: u64) -> u64 {
        let net = lamports as u128 * 10_000 / (10_000 + EST_FEE_BPS);
        let out = self.virtual_token as u128 * net / (self.virtual_sol as u128 + net);
        out.min(self.real_token as u128) as u64
    }

    /// Lamports out for `tokens` sold, after the estimated fee.
    pub fn sol_for(&self, tokens: u64) -> u64 {
        let gross = self.virtual_sol as u128 * tokens as u128 / (self.virtual_token as u128 + tokens as u128);
        (gross * (10_000 - EST_FEE_BPS) / 10_000) as u64
    }
}

/// The parts of pump's Global account a trade needs. Offsets follow the IDL field
/// order (verified on mainnet: reserved_fee_recipient at 483, buyback list at 741).
#[derive(Clone, Debug)]
pub struct Global {
    pub fee_recipients: Vec<Pubkey>,
    pub reserved_fee_recipients: Vec<Pubkey>,
    pub buyback_fee_recipients: Vec<Pubkey>,
}

impl Global {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 997 {
            return None;
        }
        let key = |o: usize| -> Option<Pubkey> { d[o..o + 32].try_into().ok() };
        let list = |start: usize, n: usize| -> Vec<Pubkey> { (0..n).filter_map(|i| key(start + 32 * i)).filter(|k| *k != [0u8; 32]).collect() };
        let mut fee_recipients = vec![key(41)?];
        fee_recipients.extend(list(162, 7));
        let mut reserved = vec![key(483)?];
        reserved.extend(list(516, 7));
        Some(Self { fee_recipients, reserved_fee_recipients: reserved, buyback_fee_recipients: list(741, 8) })
    }
}

fn pk(s: &str) -> Pubkey {
    stx::pubkey(s).expect("constant address")
}

fn pda(seeds: &[&[u8]], program: &str) -> Pubkey {
    find_pda(seeds, &pk(program)).expect("pda")
}

pub fn bonding_curve(mint: &Pubkey) -> Pubkey {
    pda(&[b"bonding-curve", mint], PROGRAM)
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    find_pda(&[owner, token_program, mint], &pk(ATA_PROGRAM)).expect("ata")
}

pub fn global() -> Pubkey {
    pda(&[b"global"], PROGRAM)
}

fn meta(pubkey: Pubkey, writable: bool) -> AccountMeta {
    AccountMeta { pubkey, signer: false, writable }
}

/// Creates the user's token account for `mint` if it does not exist yet.
pub fn create_ata_idempotent(user: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Instruction {
    Instruction {
        program: pk(ATA_PROGRAM),
        accounts: vec![
            AccountMeta { pubkey: *user, signer: true, writable: true },
            meta(ata(user, mint, token_program), true),
            meta(*user, false),
            meta(*mint, false),
            meta(pk(SYSTEM), false),
            meta(*token_program, false),
        ],
        data: vec![1],
    }
}

/// The accounts every curve trade shares, and the two the live program adds.
struct Parts {
    global: Pubkey,
    fee_recipient: Pubkey,
    curve: Pubkey,
    curve_ata: Pubkey,
    user_ata: Pubkey,
    creator_vault: Pubkey,
    event_authority: Pubkey,
    fee_config: Pubkey,
    curve_v2: Pubkey,
    buyback: Pubkey,
}

fn parts(user: &Pubkey, mint: &Pubkey, token_program: &Pubkey, c: &Curve, g: &Global, pick: usize) -> Option<Parts> {
    let curve = bonding_curve(mint);
    let fee_list = if c.mayhem { &g.reserved_fee_recipients } else { &g.fee_recipients };
    Some(Parts {
        global: global(),
        fee_recipient: *fee_list.get(pick % fee_list.len().max(1))?,
        curve,
        curve_ata: ata(&curve, mint, token_program),
        user_ata: ata(user, mint, token_program),
        creator_vault: pda(&[b"creator-vault", &c.creator], PROGRAM),
        event_authority: pda(&[b"__event_authority"], PROGRAM),
        fee_config: pda(&[b"fee_config", &FEE_CONFIG_SEED], FEE_PROGRAM),
        curve_v2: pda(&[b"bonding-curve-v2", mint], PROGRAM),
        buyback: *g.buyback_fee_recipients.get(pick % g.buyback_fee_recipients.len().max(1))?,
    })
}

/// Buys with exactly `lamports` (fees included), receiving at least `min_tokens`.
/// `pick` spreads trades over the fee recipient lists, as other clients do.
pub fn buy(user: &Pubkey, mint: &Pubkey, token_program: &Pubkey, c: &Curve, g: &Global, lamports: u64, min_tokens: u64, pick: usize) -> Option<Vec<Instruction>> {
    let p = parts(user, mint, token_program, c, g, pick)?;
    let mut data = BUY_EXACT_SOL_IN.to_vec();
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&min_tokens.to_le_bytes());
    data.push(1); // track_volume: Some(true), so the user keeps volume rewards
    data.push(0); // partial_fill: false, the whole amount or nothing
    let ix = Instruction {
        program: pk(PROGRAM),
        accounts: vec![
            meta(p.global, false),
            meta(p.fee_recipient, true),
            meta(*mint, false),
            meta(p.curve, true),
            meta(p.curve_ata, true),
            meta(p.user_ata, true),
            AccountMeta { pubkey: *user, signer: true, writable: true },
            meta(pk(SYSTEM), false),
            meta(*token_program, false),
            meta(p.creator_vault, true),
            meta(p.event_authority, false),
            meta(pk(PROGRAM), false),
            meta(pda(&[b"global_volume_accumulator"], PROGRAM), false),
            meta(pda(&[b"user_volume_accumulator", user], PROGRAM), true),
            meta(p.fee_config, false),
            meta(pk(FEE_PROGRAM), false),
            meta(p.curve_v2, true),
            meta(p.buyback, true),
        ],
        data,
    };
    Some(vec![create_ata_idempotent(user, mint, token_program), ix])
}

/// Sells `tokens`, receiving at least `min_lamports`.
pub fn sell(user: &Pubkey, mint: &Pubkey, token_program: &Pubkey, c: &Curve, g: &Global, tokens: u64, min_lamports: u64, pick: usize) -> Option<Vec<Instruction>> {
    let p = parts(user, mint, token_program, c, g, pick)?;
    let mut data = SELL.to_vec();
    data.extend_from_slice(&tokens.to_le_bytes());
    data.extend_from_slice(&min_lamports.to_le_bytes());
    Some(vec![Instruction {
        program: pk(PROGRAM),
        accounts: vec![
            meta(p.global, false),
            meta(p.fee_recipient, true),
            meta(*mint, false),
            meta(p.curve, true),
            meta(p.curve_ata, true),
            meta(p.user_ata, true),
            AccountMeta { pubkey: *user, signer: true, writable: true },
            meta(pk(SYSTEM), false),
            meta(p.creator_vault, true),
            meta(*token_program, false),
            meta(p.event_authority, false),
            meta(pk(PROGRAM), false),
            meta(p.fee_config, false),
            meta(pk(FEE_PROGRAM), false),
            meta(p.curve_v2, true),
            meta(p.buyback, true),
        ],
        data,
    }])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_live_addresses() {
        // Addresses read from real mainnet trades on 2026-11-07.
        assert_eq!(stx::b58(&global()), "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
        assert_eq!(stx::b58(&pda(&[b"__event_authority"], PROGRAM)), "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
        assert_eq!(stx::b58(&pda(&[b"fee_config", &FEE_CONFIG_SEED], FEE_PROGRAM)), "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
        assert_eq!(stx::b58(&pda(&[b"global_volume_accumulator"], PROGRAM)), "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y");
        let mint = pk("AJrmvtqcvHh4GXCgyQtef4KsjTRJ56JYpbERjSXMpump");
        assert_eq!(stx::b58(&bonding_curve(&mint)), "6qFRuy1XvS9btJ29LitdkuqVgxtaNnnFoLfrQA1taR5j");
        assert_eq!(stx::b58(&ata(&bonding_curve(&mint), &mint, &pk(TOKEN_2022))), "NMzGHYny57G9wf8Ma7gxvEKFuwcuyKe9dLG2BGRLDdv");
        assert_eq!(stx::b58(&pda(&[b"bonding-curve-v2", &mint], PROGRAM)), "8mrfgNkWzoPSVbg7bxYRCRvuGV8VVAagXjE42hGCZZjH");
        // Mayhem's own agent trades its coins with a Mayhem-program PDA instead.
        let mayhem = pk("AtrUdtY2ajau5ovvKtaqaAbAj6ND3deEBj6TmPUvpump");
        assert_eq!(stx::b58(&pda(&[b"bonding-curve-v2", &mayhem], MAYHEM_PROGRAM)), "Du9krqrJ6k8xX9CNrwnUXAShkJW5MSCJTHURVCCTZYSb");
        let user = pk("BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s");
        assert_eq!(stx::b58(&pda(&[b"user_volume_accumulator", &user], PROGRAM)), "FGFrX2q1iAjyAojjeyFDxXqdmvegjPpSWsrPmrJjeQ2f");
        assert_eq!(stx::b58(&ata(&user, &mayhem, &pk(TOKEN_2022))), "7hEgqEy5FPabnzKzcLjxtLH8gjrUL8E4isLGMa4zgnSV");
    }

    #[test]
    fn curve_math_is_constant_product_with_fees() {
        let c = Curve { virtual_token: 1_073_000_000_000_000, virtual_sol: 30_000_000_000, real_token: 793_100_000_000_000, complete: false, creator: [0; 32], mayhem: false, cashback: false, quote_mint: [0; 32] };
        let out = c.tokens_for(1_000_000_000);
        // 1 SOL into a fresh curve buys about 34.6M tokens before fees (6 decimals).
        assert!(out > 33_000_000_000_000 && out < 34_700_000_000_000, "{out}");
        let back = c.sol_for(out);
        assert!(back < 1_000_000_000, "selling straight back never returns more");
    }
}
