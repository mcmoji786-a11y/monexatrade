//! Decoder for Moonshot bonding curves. The program logs an Anchor `TradeEvent` for
//! every buy and sell.
//!
//! Layout read from a real buy (2026-11-06) and checked against that transaction's
//! balance changes: u64 amount (coin, 9 decimals), u64 collateral_amount (lamports),
//! u64 dex_fee, u64 helio_fee, u64 allocation, then curve, cost_token and sender
//! (32 bytes each), u8 trade type (0 buy, 1 sell) and a string label.
//! The event names the trader and the curve but not the coin: the curve is a PDA of
//! the mint. Curve reserves are not logged, so the price is the fill price.

use crate::pumpfun::Trade;
use crate::pumpswap::find_pda;

pub const PROGRAM_ID: &str = crate::launches::MOONSHOT;
const TRADE_EVENT: [u8; 8] = [0xbd, 0xdb, 0x7f, 0xd3, 0x4e, 0xe6, 0x61, 0xee];
/// Moonshot coins have 9 decimals; the market engine counts in 6.
const TO_ENGINE_UNITS: u64 = 1_000;
/// The market engine's default curve size, reported as "nothing sold" (see market.rs).
const CURVE_UNKNOWN: u64 = 793_100_000_000_000;

#[derive(Debug, Clone, PartialEq)]
pub struct CurveTrade {
    pub curve: String,
    pub user: String,
    pub is_buy: bool,
    /// Raw coin units (9 decimals).
    pub amount: u64,
    pub lamports: u64,
}

impl CurveTrade {
    /// Same shape as a pump.fun trade. Without logged reserves, the "reserves" are the
    /// trade itself, so the engine's price is the fill price.
    pub fn into_trade(self, mint: &str, timestamp: i64) -> Trade {
        let tokens = self.amount / TO_ENGINE_UNITS;
        Trade {
            mint: mint.to_string(),
            sol_amount: self.lamports,
            token_amount: tokens,
            is_buy: self.is_buy,
            user: self.user,
            timestamp,
            virtual_sol_reserves: self.lamports,
            virtual_token_reserves: tokens,
            // Progress is not logged; a full curve keeps the engine from reading 100%.
            real_token_reserves: CURVE_UNKNOWN,
        }
    }
}

pub fn parse_trades(logs: &[String]) -> Vec<CurveTrade> {
    crate::logs::program_data(logs, PROGRAM_ID).into_iter().filter_map(|b| decode(&b)).collect()
}

fn decode(bytes: &[u8]) -> Option<CurveTrade> {
    if bytes.len() < 8 + 40 + 96 + 1 || bytes[..8] != TRADE_EVENT {
        return None;
    }
    let b = &bytes[8..];
    let u = |i: usize| u64::from_le_bytes(b[8 * i..8 * i + 8].try_into().expect("8 bytes"));
    let key = |o: usize| bs58::encode(&b[o..o + 32]).into_string();
    let (amount, lamports) = (u(0), u(1));
    if amount == 0 || lamports == 0 {
        return None;
    }
    Some(CurveTrade { curve: key(40), user: key(104), is_buy: b[136] == 0, amount, lamports })
}

/// A Moonshot coin's curve: PDA of ["token", mint].
pub fn curve_of(mint: &str) -> Option<String> {
    let mint = bs58::decode(mint).into_vec().ok().filter(|m| m.len() == 32)?;
    let program = bs58::decode(PROGRAM_ID).into_vec().ok()?;
    find_pda(&[b"token", &mint], &program).map(|p| bs58::encode(p).into_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINT: &str = "B9uCnVsbgEdwC1fqucTeM4uGuice9iXAsoc5UfB1moon";
    const CURVE: &str = "3tmfCM3FzgPB37oB85zAQmoEu5Yj89ZtYxNh1ECZQZLs";
    // Real buy event, as logged.
    const EVENT: &str = "vdt/007mYe4wbqer3s4BAAvwDQIAAAAAAKgCAAAAAAAAqAIAAAAAAK89YBsJqVMFKvp9nhTspxfh94wdp39Z7+1t7i3lPU+1HQOnIZ578bgGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAARXUDeH1GtdB5iGsuql5IiXGu2NfCBK6MoQviwzfQO0LAAUAAAB0cmFkZQ==";

    #[test]
    fn decodes_a_real_buy() {
        let logs = vec![
            format!("Program {PROGRAM_ID} invoke [2]"),
            "Program log: Instruction: Buy".to_string(),
            format!("Program data: {EVENT}"),
            format!("Program {PROGRAM_ID} success"),
        ];
        let t = parse_trades(&logs);
        assert_eq!(t.len(), 1);
        let t = &t[0];
        assert_eq!(t.curve, CURVE);
        assert_eq!(t.user, "2UD718nWVyfAciEY2WXK35f9Kou78zsnxtxFub5FbCZG");
        assert!(t.is_buy);
        // Balance changes of that transaction: 508,930.73 coins left the curve.
        assert_eq!(t.amount, 508_930_734_648_880);
        assert_eq!(t.lamports, 34_467_851);
    }

    #[test]
    fn curve_is_derived_from_the_mint() {
        assert_eq!(curve_of(MINT).as_deref(), Some(CURVE));
    }
}
