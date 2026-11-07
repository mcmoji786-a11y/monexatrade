//! Decoder for pump.fun token-creation events (see docs/decisions/0002-market-data-hybrid.md).

use serde::Serialize;

pub const PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
/// pump.fun's mint-authority PDA. Every create transaction includes it as an account;
/// buys and sells do not. Subscribing to it instead of the whole program cuts the
/// stream from every trade to creates only (measured: see docs/decisions/0003).
pub const MINT_AUTHORITY: &str = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
const CREATE_LOG: &str = "Program log: Instruction: Create";
const CREATE_V2_LOG: &str = "Program log: Instruction: CreateV2";
const CREATE_EVENT_DISCRIMINATOR: [u8; 8] = [27, 114, 169, 77, 222, 235, 99, 118];
// From pump.fun's public IDL (github.com/pump-fun/pump-public-docs, idl/pump.json).
const TRADE_EVENT_DISCRIMINATOR: [u8; 8] = [189, 219, 127, 211, 78, 230, 97, 238];
const COMPLETE_EVENT_DISCRIMINATOR: [u8; 8] = [95, 114, 97, 156, 212, 46, 152, 8];

/// One buy or sell on a bonding curve. Only the leading TradeEvent fields are read;
/// later fields vary by program version.
#[derive(Debug, Clone, PartialEq)]
pub struct Trade {
    pub mint: String,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub is_buy: bool,
    pub user: String,
    pub timestamp: i64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub real_token_reserves: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Create(NewToken),
    Trade(Trade),
    /// The bonding curve is complete; the token is ready to migrate to a DEX pool.
    Complete { mint: String },
}

/// Every pump.fun event in one transaction's logs, in log order.
pub fn parse_events(signature: &str, logs: &[String]) -> Vec<Event> {
    let standard = if logs.iter().any(|l| l == CREATE_V2_LOG) {
        Some(TokenStandard::Token2022)
    } else if logs.iter().any(|l| l == CREATE_LOG) {
        Some(TokenStandard::Spl)
    } else {
        None
    };

    let mut out = Vec::new();
    // Only events pump.fun itself emitted: other Anchor programs (Raydium LaunchLab)
    // log a TradeEvent with the same discriminator.
    for bytes in crate::logs::program_data(logs, PROGRAM_ID) {
        if bytes.len() <= 8 {
            continue;
        }
        let (disc, body) = bytes.split_at(8);
        let event = if disc == CREATE_EVENT_DISCRIMINATOR {
            standard.clone().and_then(|s| decode_event(signature, body, s)).map(Event::Create)
        } else if disc == TRADE_EVENT_DISCRIMINATOR {
            decode_trade(body).map(Event::Trade)
        } else if disc == COMPLETE_EVENT_DISCRIMINATOR {
            decode_complete(body)
        } else {
            None
        };
        out.extend(event);
    }
    out
}

fn decode_trade(data: &[u8]) -> Option<Trade> {
    let mut r = Reader { data, pos: 0 };
    let mint = r.pubkey()?;
    let sol_amount = r.u64()?;
    let token_amount = r.u64()?;
    let is_buy = r.bool()?;
    let user = r.pubkey()?;
    let timestamp = r.i64()?;
    let virtual_sol_reserves = r.u64()?;
    let virtual_token_reserves = r.u64()?;
    let _real_sol_reserves = r.u64()?;
    let real_token_reserves = r.u64()?;
    Some(Trade {
        mint,
        sol_amount,
        token_amount,
        is_buy,
        user,
        timestamp,
        virtual_sol_reserves,
        virtual_token_reserves,
        real_token_reserves,
    })
}

fn decode_complete(data: &[u8]) -> Option<Event> {
    let mut r = Reader { data, pos: 0 };
    let _user = r.pubkey()?;
    let mint = r.pubkey()?;
    Some(Event::Complete { mint })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum TokenStandard {
    Spl,
    Token2022,
}

/// Reserve values at creation. Optional because older events may not carry them.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Reserves {
    pub virtual_token: u64,
    pub virtual_sol: u64,
    pub real_token: u64,
    pub total_supply: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NewToken {
    pub signature: String,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub mint: String,
    pub bonding_curve: String,
    pub creator: String,
    pub timestamp: i64,
    pub reserves: Option<Reserves>,
    pub standard: TokenStandard,
    /// The currency the curve trades against. `None` means SOL: either the event
    /// predates quote mints, or it names SOL / wrapped SOL.
    pub quote_mint: Option<String>,
    /// Where the coin was created: "pump.fun", "letsbonk.fun", "bags", "met-dbc",
    /// "raydium-launchlab", "moonshot" or "other" (launches.rs).
    pub launchpad: String,
}

/// Wrapped SOL, and the all-zero key older events use as "no quote mint".
const SOL_MINTS: [&str; 2] = ["So11111111111111111111111111111111111111112", "11111111111111111111111111111111"];

impl NewToken {
    pub fn is_sol_quoted(&self) -> bool {
        self.quote_mint.is_none()
    }
}

/// Inspect one transaction's logs. Returns the new token if it is a pump.fun create.
/// Logs are matched as whole lines so `CreateTokenAccount` etc. do not match.
pub fn parse_create(signature: &str, logs: &[String]) -> Option<NewToken> {
    parse_events(signature, logs).into_iter().find_map(|e| match e {
        Event::Create(t) => Some(t),
        _ => None,
    })
}

fn decode_event(signature: &str, data: &[u8], standard: TokenStandard) -> Option<NewToken> {
    let mut r = Reader { data, pos: 0 };
    let name = r.string()?;
    let symbol = r.string()?;
    let uri = r.string()?;
    let mint = r.pubkey()?;
    let bonding_curve = r.pubkey()?;
    let _user = r.pubkey()?;
    let creator = r.pubkey()?;
    let timestamp = r.i64()?;
    // Fields after this point were added in later program versions; tolerate absence.
    let reserves = (|| {
        Some(Reserves {
            virtual_token: r.u64()?,
            virtual_sol: r.u64()?,
            real_token: r.u64()?,
            total_supply: r.u64()?,
        })
    })();
    // IDL order after supply: token_program, is_mayhem_mode, is_cashback_enabled, quote_mint.
    let quote_mint = (|| {
        r.pubkey()?;
        r.bool()?;
        r.bool()?;
        r.pubkey()
    })()
    .filter(|q| !SOL_MINTS.contains(&q.as_str()));

    Some(NewToken {
        quote_mint,
        signature: signature.to_string(),
        name,
        symbol,
        uri,
        mint,
        bonding_curve,
        creator,
        timestamp,
        reserves,
        standard,
        launchpad: "pump.fun".to_string(),
    })
}

/// Minimal bounds-checked Borsh reader. Every read returns None instead of panicking.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.data.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn bool(&mut self) -> Option<bool> {
        Some(self.take(1)?[0] != 0)
    }
    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn string(&mut self) -> Option<String> {
        let len = self.u32()? as usize;
        if len > 1024 {
            return None; // corrupt or hostile data
        }
        String::from_utf8(self.take(len)?.to_vec()).ok()
    }
    fn pubkey(&mut self) -> Option<String> {
        Some(bs58::encode(self.take(32)?).into_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};

    fn borsh_str(out: &mut Vec<u8>, s: &str) {
        out.extend((s.len() as u32).to_le_bytes());
        out.extend(s.as_bytes());
    }

    fn sample_event(with_reserves: bool) -> String {
        let mut b = CREATE_EVENT_DISCRIMINATOR.to_vec();
        borsh_str(&mut b, "Kixo Test");
        borsh_str(&mut b, "MNX");
        borsh_str(&mut b, "https://example.com/meta.json");
        for k in [1u8, 2, 3, 4] {
            b.extend([k; 32]); // mint, bonding_curve, user, creator
        }
        b.extend(1_700_000_000i64.to_le_bytes());
        if with_reserves {
            for v in [10u64, 20, 30, 40] {
                b.extend(v.to_le_bytes());
            }
        }
        STANDARD.encode(b)
    }

    fn logs(instruction: &str, data: &str) -> Vec<String> {
        vec![
            format!("Program {PROGRAM_ID} invoke [1]"),
            instruction.to_string(),
            format!("Program data: {data}"),
        ]
    }

    #[test]
    fn decodes_legacy_create_with_reserves() {
        let t = parse_create("sig1", &logs(CREATE_LOG, &sample_event(true))).unwrap();
        assert_eq!(t.name, "Kixo Test");
        assert_eq!(t.symbol, "MNX");
        assert_eq!(t.mint, bs58::encode([1u8; 32]).into_string());
        assert_eq!(t.creator, bs58::encode([4u8; 32]).into_string());
        assert_eq!(t.timestamp, 1_700_000_000);
        assert_eq!(t.standard, TokenStandard::Spl);
        assert_eq!(t.reserves.unwrap().total_supply, 40);
    }

    #[test]
    fn decodes_create_v2_without_reserves() {
        let t = parse_create("sig2", &logs(CREATE_V2_LOG, &sample_event(false))).unwrap();
        assert_eq!(t.standard, TokenStandard::Token2022);
        assert!(t.reserves.is_none());
    }

    #[test]
    fn ignores_non_create_and_similar_names() {
        let l = logs("Program log: Instruction: CreateTokenAccount", &sample_event(true));
        assert!(parse_create("sig3", &l).is_none());
        let l = logs("Program log: Instruction: Buy", &sample_event(true));
        assert!(parse_create("sig4", &l).is_none());
    }

    fn sample_trade(is_buy: bool) -> String {
        let mut b = TRADE_EVENT_DISCRIMINATOR.to_vec();
        b.extend([7u8; 32]); // mint
        b.extend(2_000_000_000u64.to_le_bytes()); // 2 SOL
        b.extend(1_000_000u64.to_le_bytes()); // 1 token
        b.push(is_buy as u8);
        b.extend([8u8; 32]); // user
        b.extend(1_700_000_100i64.to_le_bytes());
        for v in [30_000_000_000u64, 1_000_000_000_000_000, 2_000_000_000, 700_000_000_000_000] {
            b.extend(v.to_le_bytes());
        }
        b.extend([0u8; 40]); // trailing newer fields are ignored
        STANDARD.encode(b)
    }

    #[test]
    fn decodes_trade_and_complete_events_in_order() {
        let mut complete = COMPLETE_EVENT_DISCRIMINATOR.to_vec();
        complete.extend([1u8; 32]);
        complete.extend([7u8; 32]);
        let logs = vec![
            format!("Program {PROGRAM_ID} invoke [1]"),
            "Program log: Instruction: Sell".to_string(),
            format!("Program data: {}", sample_trade(false)),
            format!("Program data: {}", STANDARD.encode(&complete)),
        ];
        let events = parse_events("sig", &logs);
        assert_eq!(events.len(), 2);
        let Event::Trade(t) = &events[0] else { panic!("expected trade") };
        assert!(!t.is_buy);
        assert_eq!(t.sol_amount, 2_000_000_000);
        assert_eq!(t.user, bs58::encode([8u8; 32]).into_string());
        assert_eq!(t.real_token_reserves, 700_000_000_000_000);
        assert_eq!(events[1], Event::Complete { mint: bs58::encode([7u8; 32]).into_string() });
    }

    #[test]
    fn create_with_dev_buy_yields_both_events() {
        let mut l = logs(CREATE_LOG, &sample_event(true));
        l.push(format!("Program data: {}", sample_trade(true)));
        let events = parse_events("sig", &l);
        assert!(matches!(events[0], Event::Create(_)));
        assert!(matches!(events[1], Event::Trade(ref t) if t.is_buy));
    }

    #[test]
    fn rejects_truncated_data_without_panicking() {
        let full = STANDARD.decode(sample_event(true)).unwrap();
        for cut in [9, 20, 60, 120] {
            let l = logs(CREATE_LOG, &STANDARD.encode(&full[..cut]));
            assert!(parse_create("sig5", &l).is_none());
        }
    }
}
