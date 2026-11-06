//! Decoder for Raydium LaunchLab bonding curves (letsbonk.fun and other LaunchLab
//! frontends). The program logs an Anchor `TradeEvent` for every buy and sell.
//!
//! Layout read from a real buy (1DEqkP24…, 2026-11-06) and checked against that
//! transaction's balance changes: pool (32 bytes), then u64s total_base_sell,
//! virtual_base, virtual_quote, real_base_before, real_quote_before, real_base_after,
//! real_quote_after, amount_in, amount_out, protocol_fee, platform_fee, creator_fee,
//! share_fee, then u8 trade_direction (0 buy, 1 sell), u8 pool_status, bool exact_in.
//! The event names neither the coin nor the trader: the coin comes from the pool
//! address (a PDA of the mint), and the trader is not in the logs.

use crate::pumpfun::Trade;
use crate::pumpswap::{find_pda, WSOL};

pub const PROGRAM_ID: &str = crate::launches::LAUNCHLAB;
const TRADE_EVENT: [u8; 8] = [0xbd, 0xdb, 0x7f, 0xd3, 0x4e, 0xe6, 0x61, 0xee];

#[derive(Debug, Clone, PartialEq)]
pub struct CurveTrade {
    pub pool: String,
    pub is_buy: bool,
    /// Lamports paid (buy) or received (sell).
    pub quote_amount: u64,
    /// Raw coin units received (buy) or sold (sell).
    pub base_amount: u64,
    /// Coins the curve sells in total before migrating.
    pub total_base_sell: u64,
    /// Effective reserves after the trade: price = quote / base.
    pub quote_reserves: u64,
    pub base_reserves: u64,
    /// Coins still for sale on the curve.
    pub base_left: u64,
    /// pool_status 0 is trading; anything else means the curve is done.
    pub complete: bool,
}

impl CurveTrade {
    /// Same shape as a pump.fun trade so the market engine and trade book handle it.
    /// LaunchLab logs do not name the trader, so `user` is empty.
    pub fn into_trade(self, mint: &str, timestamp: i64) -> Trade {
        Trade {
            mint: mint.to_string(),
            sol_amount: self.quote_amount,
            token_amount: self.base_amount,
            is_buy: self.is_buy,
            user: String::new(),
            timestamp,
            virtual_sol_reserves: self.quote_reserves,
            virtual_token_reserves: self.base_reserves,
            real_token_reserves: self.base_left,
        }
    }
}

/// Every LaunchLab trade in one transaction's logs.
pub fn parse_trades(logs: &[String]) -> Vec<CurveTrade> {
    crate::logs::program_data(logs, PROGRAM_ID).into_iter().filter_map(|b| decode(&b)).collect()
}

fn decode(bytes: &[u8]) -> Option<CurveTrade> {
    if bytes.len() < 8 + 32 + 13 * 8 + 3 || bytes[..8] != TRADE_EVENT {
        return None;
    }
    let body = &bytes[8..];
    let pool = bs58::encode(&body[..32]).into_string();
    let u = |i: usize| u64::from_le_bytes(body[32 + 8 * i..40 + 8 * i].try_into().expect("8 bytes"));
    let (total_base_sell, virtual_base, virtual_quote) = (u(0), u(1), u(2));
    let (real_base_after, real_quote_after, amount_in, amount_out) = (u(5), u(6), u(7), u(8));
    let flags = &body[32 + 13 * 8..];
    let is_buy = flags[0] == 0;
    let (quote_amount, base_amount) = if is_buy { (amount_in, amount_out) } else { (amount_out, amount_in) };
    Some(CurveTrade {
        pool,
        is_buy,
        quote_amount,
        base_amount,
        total_base_sell,
        quote_reserves: virtual_quote.checked_add(real_quote_after)?,
        base_reserves: virtual_base.checked_sub(real_base_after)?,
        base_left: total_base_sell.saturating_sub(real_base_after),
        complete: flags[1] != 0,
    })
}

/// The curve of a SOL-quoted LaunchLab coin: PDA of ["pool", mint, WSOL].
pub fn pool_of(mint: &str) -> Option<String> {
    let mint = bs58::decode(mint).into_vec().ok().filter(|m| m.len() == 32)?;
    let program = bs58::decode(PROGRAM_ID).into_vec().ok()?;
    let wsol = bs58::decode(WSOL).into_vec().ok()?;
    find_pda(&[b"pool", &mint, &wsol], &program).map(|p| bs58::encode(p).into_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real buy 1DEqkP24Hv9emreEd5Y54EX6FWFsY1d5mVPnGwDNAvPtrSdj4REwD9JRLL48AeDRPAKziEVRXaL3tR42eUKfBNs
    const MINT: &str = "45vfEpnuRCAYD9yr8xUPYsZdc5tHk89JKgDguGtfLoat";
    const POOL: &str = "FfAkqDMjgx7xQaQm6oy5xDaEaDDscDXAG9zdpVErWN94";

    fn event() -> Vec<u8> {
        let mut b = TRADE_EVENT.to_vec();
        b.extend(bs58::decode(POOL).into_vec().expect("pool"));
        for v in [
            732_500_000_000_000u64,
            1_153_884_408_603_357,
            227_589_797_310,
            367_305_219_914_234,
            106_276_547_582,
            367_977_507_999_023,
            106_562_146_761,
            288_484_020,
            672_288_084_789,
            721_211,
            1_730_904,
            432_726,
            0,
        ] {
            b.extend(v.to_le_bytes());
        }
        b.extend([0, 0, 1]);
        b
    }

    #[test]
    fn decodes_a_real_buy() {
        use base64::Engine;
        let logs = vec![
            format!("Program {PROGRAM_ID} invoke [1]"),
            "Program log: Instruction: BuyExactIn".to_string(),
            format!("Program data: {}", base64::engine::general_purpose::STANDARD.encode(event())),
            format!("Program {PROGRAM_ID} success"),
        ];
        let t = parse_trades(&logs);
        assert_eq!(t.len(), 1);
        let t = &t[0];
        assert_eq!(t.pool, POOL);
        assert!(t.is_buy && !t.complete);
        // The transaction moved 0.288 SOL and 672,288 coins (balance changes).
        assert_eq!(t.quote_amount, 288_484_020);
        assert_eq!(t.base_amount, 672_288_084_789);
        // Spot price after the trade sits next to the fill price.
        let spot = t.quote_reserves as f64 / t.base_reserves as f64;
        let fill = t.quote_amount as f64 / t.base_amount as f64;
        assert!((spot / fill - 1.0).abs() < 0.02, "spot {spot} fill {fill}");
    }

    #[test]
    fn pool_is_derived_from_the_mint() {
        assert_eq!(pool_of(MINT).as_deref(), Some(POOL));
    }

    #[test]
    fn ignores_the_same_event_from_another_program() {
        use base64::Engine;
        let logs = vec![
            "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]".to_string(),
            format!("Program data: {}", base64::engine::general_purpose::STANDARD.encode(event())),
        ];
        assert!(parse_trades(&logs).is_empty());
    }
}
