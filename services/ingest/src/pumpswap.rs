//! Decoder for PumpSwap, the AMM pump.fun coins move to when their bonding curve
//! completes. Buys and sells emit Anchor events in the logs ("Program data: ..."),
//! verified against live transactions on 2026-11-06 (BuyEvent on pool
//! BVhmSCZiNLHrfC8LKRH7FwGLk1yJxQ8Qor927LKQhDSj). Events name the pool, not the coin,
//! so the caller maps pool -> mint.

use base64::{engine::general_purpose::STANDARD, Engine};

pub const PROGRAM_ID: &str = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const DATA_PREFIX: &str = "Program data: ";
/// sha256("event:BuyEvent")[..8] and sha256("event:SellEvent")[..8].
const BUY_EVENT: [u8; 8] = [0x67, 0xf4, 0x52, 0x1f, 0x2c, 0xf5, 0x77, 0x77];
const SELL_EVENT: [u8; 8] = [0x3e, 0x2f, 0x37, 0x0a, 0xa5, 0x03, 0xdc, 0x2a];

/// One swap. Amounts are raw units: base is the coin (6 decimals for pump.fun coins),
/// quote is the pool's other side (lamports when it is wrapped SOL).
#[derive(Debug, Clone, PartialEq)]
pub struct Swap {
    pub pool: String,
    pub user: String,
    pub is_buy: bool,
    pub timestamp: i64,
    pub base_amount: u64,
    pub quote_amount: u64,
    pub pool_base_reserves: u64,
    pub pool_quote_reserves: u64,
}

/// Both events start with 14 u64 fields followed by pool and user pubkeys:
/// [0] timestamp, [1] base amount, [5] pool base reserves, [6] pool quote reserves,
/// [7] quote amount in (buy) or out (sell), [13] what the user paid or received.
const U64S: usize = 14;
const POOL_AT: usize = U64S * 8;
const USER_AT: usize = POOL_AT + 32;

pub fn parse_swaps(logs: &[String]) -> Vec<Swap> {
    logs.iter()
        .filter_map(|l| l.strip_prefix(DATA_PREFIX))
        .filter_map(|b64| STANDARD.decode(b64).ok())
        .filter_map(|bytes| decode(&bytes))
        .collect()
}

fn decode(bytes: &[u8]) -> Option<Swap> {
    if bytes.len() < 8 + USER_AT + 32 {
        return None;
    }
    let (disc, body) = bytes.split_at(8);
    let is_buy = match disc {
        d if d == BUY_EVENT => true,
        d if d == SELL_EVENT => false,
        _ => return None,
    };
    let u = |i: usize| u64::from_le_bytes(body[i * 8..i * 8 + 8].try_into().unwrap());
    let key = |at: usize| bs58::encode(&body[at..at + 32]).into_string();
    Some(Swap {
        pool: key(POOL_AT),
        user: key(USER_AT),
        is_buy,
        timestamp: u(0) as i64,
        base_amount: u(1),
        // A buy's SOL cost includes fees; a sell's proceeds are what reached the user.
        quote_amount: if is_buy { u(7) } else { u(13) },
        pool_base_reserves: u(5),
        pool_quote_reserves: u(6),
    })
}

const PUMP_PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
pub const WSOL: &str = "So11111111111111111111111111111111111111112";

/// The PumpSwap pool a pump.fun coin migrates into, derived without any network call:
/// seeds ["pool", index 0, pool-authority, mint, WSOL], where pool-authority is the
/// pump program's PDA of ["pool-authority", mint]. Verified against MrBeast's live pool.
pub fn canonical_pool(mint: &str) -> Option<String> {
    let mint = bs58::decode(mint).into_vec().ok().filter(|m| m.len() == 32)?;
    let pump = bs58::decode(PUMP_PROGRAM_ID).into_vec().ok()?;
    let amm = bs58::decode(PROGRAM_ID).into_vec().ok()?;
    let wsol = bs58::decode(WSOL).into_vec().ok()?;
    let authority = find_pda(&[b"pool-authority", &mint], &pump)?;
    let pool = find_pda(&[b"pool", &0u16.to_le_bytes(), &authority, &mint, &wsol], &amm)?;
    Some(bs58::encode(pool).into_string())
}

/// Solana's find_program_address: the first bump (255 down) whose hash is off the
/// ed25519 curve.
pub(crate) fn find_pda(seeds: &[&[u8]], program: &[u8]) -> Option<[u8; 32]> {
    use sha2::{Digest, Sha256};
    for bump in (0..=255u8).rev() {
        let mut h = Sha256::new();
        for s in seeds {
            h.update(s);
        }
        h.update([bump]);
        h.update(program);
        h.update(b"ProgramDerivedAddress");
        let out: [u8; 32] = h.finalize().into();
        if curve25519_dalek::edwards::CompressedEdwardsY(out).decompress().is_none() {
            return Some(out);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_live_pool() {
        assert_eq!(
            canonical_pool("4Rfd9KJmKKo1MfpdYvAFbkvfdFQzQGkz5ffPLgRFpump").as_deref(),
            Some("BVhmSCZiNLHrfC8LKRH7FwGLk1yJxQ8Qor927LKQhDSj")
        );
        assert!(canonical_pool("not-a-mint").is_none());
    }

    /// Real BuyEvent from transaction CEDRwtPN...hicTq (2026-11-06).
    const BUY: &str = "Z/RSHyz1d3dV9OxqAAAAADkqgGkAAAAAVJEeAAAAAAAIoda8AAAAAFSRHgAAAAAACP6YIRtyAAD6XlqTHAAAAFSRHgAAAAAAFAAAAAAAAAB4DwAAAAAAAAUAAAAAAAAA3gMAAAAAAAAARB4AAAAAAIg0HgAAAAAAm+8570CMc/kdVDRO/NRJcY7bzgVyMIc4AdbdEFXX9jQPLo8ZNuLX3alFHFL0k8K1mms2pt2CVzMgJ2z+9eydlDJpO0pivQkdyYajPB8WfrHddJ2GiHx0jmEnnelhtuFK4CkID7eSR4OcuLZu2RGliOK3NME7J6P5Q/emYt6XWjdKwvjQ3Vy8l+MonBl8tQYqVPPZVrnOblEV+WVnqlyz5nfZFZVfiIBzHOtKdaDMlsF0+kCVxOHZlnrPxChFrmeug8aW3mHmY/wNV07JC28/c/PJMNpZi65VFqCYNee+v5VfAAAAAAAAAHZJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcCj0XgAAAAASAAAAYnV5X2V4YWN0X3F1b3RlX2luAAAAAAAAAAAAAAAAAAAAAIgTAAAAAAAA7wEAAAAAAAB+3cUXBAAAAAAAAAAAAAAAAWq1H0lhigMAAAAAAAAAAAAAAAAAAAAAAA0gVgAAAAAAAAAAAAAAAAA=";

    #[test]
    fn decodes_a_real_buy() {
        let logs = vec!["Program log: Instruction: BuyExactQuoteIn".to_string(), format!("{DATA_PREFIX}{BUY}")];
        let s = &parse_swaps(&logs)[0];
        assert!(s.is_buy);
        assert_eq!(s.pool, "BVhmSCZiNLHrfC8LKRH7FwGLk1yJxQ8Qor927LKQhDSj");
        assert_eq!(s.user, "22GHxr3cYMB3VG9TyPkvTAXrEoviD2LZNSEt2aAGp8JP");
        assert_eq!(s.timestamp, 1_793_913_941);
        assert_eq!(s.base_amount, 1_770_007_097);
        assert_eq!(s.quote_amount, 2_003_284);
        assert_eq!(s.pool_base_reserves, 125_460_853_358_088);
        assert_eq!(s.pool_quote_reserves, 122_731_257_594);
    }

    #[test]
    fn ignores_other_events() {
        assert!(parse_swaps(&["Program data: AAAAAAAAAAAAAAAA".to_string()]).is_empty());
    }
}
