//! Minimal Solana versioned (v0) transaction building, without the Solana SDK.
//!
//! The gateway only ever builds unsigned transactions for the user's own wallet to
//! sign in Phantom, and checks that what comes back signed is exactly what it built.
//! Format: https://solana.com/docs/core/transactions (v0 messages with address lookup
//! tables). Verified against mainnet by simulating built transactions.

use std::collections::HashMap;

pub type Pubkey = [u8; 32];

pub const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";
pub const COMPUTE_BUDGET_PROGRAM: &str = "ComputeBudget111111111111111111111111111111";
/// Largest serialized transaction the network accepts.
pub const MAX_TX_BYTES: usize = 1232;

pub fn pubkey(s: &str) -> Result<Pubkey, String> {
    let v = bs58::decode(s).into_vec().map_err(|_| format!("bad address {s}"))?;
    v.try_into().map_err(|_| format!("bad address {s}"))
}

pub fn b58(p: &[u8]) -> String {
    bs58::encode(p).into_string()
}

#[derive(Clone, Debug, PartialEq)]
pub struct AccountMeta {
    pub pubkey: Pubkey,
    pub signer: bool,
    pub writable: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Instruction {
    pub program: Pubkey,
    pub accounts: Vec<AccountMeta>,
    pub data: Vec<u8>,
}

/// An address lookup table and the addresses it holds, in order.
#[derive(Clone, Debug)]
pub struct LookupTable {
    pub key: Pubkey,
    pub addresses: Vec<Pubkey>,
}

/// SOL transfer from `from` (signs) to `to`.
pub fn transfer(from: &Pubkey, to: &Pubkey, lamports: u64) -> Instruction {
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program: pubkey(SYSTEM_PROGRAM).expect("system program"),
        accounts: vec![
            AccountMeta { pubkey: *from, signer: true, writable: true },
            AccountMeta { pubkey: *to, signer: false, writable: true },
        ],
        data,
    }
}

pub fn compute_unit_limit(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction { program: pubkey(COMPUTE_BUDGET_PROGRAM).expect("cb program"), accounts: vec![], data }
}

pub fn compute_unit_price(micro_lamports: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&micro_lamports.to_le_bytes());
    Instruction { program: pubkey(COMPUTE_BUDGET_PROGRAM).expect("cb program"), accounts: vec![], data }
}

/// Solana's compact-u16 length prefix.
fn compact(out: &mut Vec<u8>, mut n: usize) {
    loop {
        let mut b = (n & 0x7f) as u8;
        n >>= 7;
        if n == 0 {
            out.push(b);
            return;
        }
        b |= 0x80;
        out.push(b);
    }
}

fn read_compact(b: &[u8], i: &mut usize) -> Option<usize> {
    let mut n = 0usize;
    for shift in [0, 7, 14] {
        let byte = *b.get(*i)?;
        *i += 1;
        n |= ((byte & 0x7f) as usize) << shift;
        if byte & 0x80 == 0 {
            return Some(n);
        }
    }
    None
}

#[derive(Clone, Copy)]
struct Key {
    signer: bool,
    writable: bool,
    invoked: bool,
}

/// Compiles instructions into a v0 message paid by `payer`. Signers and invoked
/// programs stay in the static keys; other accounts found in a lookup table are loaded
/// from it, which keeps the transaction small.
pub fn compile_v0(payer: &Pubkey, ixs: &[Instruction], tables: &[LookupTable], blockhash: &Pubkey) -> Result<Vec<u8>, String> {
    let mut order: Vec<Pubkey> = vec![*payer];
    let mut keys: HashMap<Pubkey, Key> = HashMap::new();
    keys.insert(*payer, Key { signer: true, writable: true, invoked: false });
    let mut add = |k: Pubkey, signer: bool, writable: bool, invoked: bool, order: &mut Vec<Pubkey>| {
        let e = keys.entry(k).or_insert_with(|| {
            order.push(k);
            Key { signer: false, writable: false, invoked: false }
        });
        e.signer |= signer;
        e.writable |= writable;
        e.invoked |= invoked;
    };
    for ix in ixs {
        add(ix.program, false, false, true, &mut order);
        for a in &ix.accounts {
            add(a.pubkey, a.signer, a.writable, false, &mut order);
        }
    }

    // Where each loadable account sits in the tables.
    let mut in_table: HashMap<Pubkey, (usize, u8)> = HashMap::new();
    for (t, table) in tables.iter().enumerate() {
        for (i, a) in table.addresses.iter().enumerate().take(256) {
            in_table.entry(*a).or_insert((t, i as u8));
        }
    }

    let mut statics: Vec<Pubkey> = Vec::new();
    let mut loaded: Vec<Pubkey> = Vec::new();
    for k in &order {
        let m = keys[k];
        if m.signer || m.invoked || !in_table.contains_key(k) {
            statics.push(*k);
        } else {
            loaded.push(*k);
        }
    }
    // Static key order: writable signers, read-only signers, writable, read-only.
    // A stable sort keeps the payer first.
    let rank = |k: &Pubkey| {
        let m = keys[k];
        match (m.signer, m.writable) {
            (true, true) => 0,
            (true, false) => 1,
            (false, true) => 2,
            (false, false) => 3,
        }
    };
    statics.sort_by_key(rank);
    if statics.first() != Some(payer) {
        return Err("payer must sign first".into());
    }
    let num_signers = statics.iter().filter(|k| keys[*k].signer).count();
    let ro_signed = statics.iter().filter(|k| keys[*k].signer && !keys[*k].writable).count();
    let ro_unsigned = statics.iter().filter(|k| !keys[*k].signer && !keys[*k].writable).count();

    // Lookups: per table, its writable then read-only entries. Indexes run over every
    // table's writable entries first, then every table's read-only ones.
    let mut writable: Vec<Vec<u8>> = vec![Vec::new(); tables.len()];
    let mut readonly: Vec<Vec<u8>> = vec![Vec::new(); tables.len()];
    let mut w_keys: Vec<Vec<Pubkey>> = vec![Vec::new(); tables.len()];
    let mut r_keys: Vec<Vec<Pubkey>> = vec![Vec::new(); tables.len()];
    for k in &loaded {
        let (t, i) = in_table[k];
        if keys[k].writable {
            writable[t].push(i);
            w_keys[t].push(*k);
        } else {
            readonly[t].push(i);
            r_keys[t].push(*k);
        }
    }
    let mut index: HashMap<Pubkey, u8> = HashMap::new();
    let all: Vec<Pubkey> = statics.iter().copied().chain(w_keys.iter().flatten().copied()).chain(r_keys.iter().flatten().copied()).collect();
    if all.len() > 256 {
        return Err("too many accounts".into());
    }
    for (i, k) in all.iter().enumerate() {
        index.insert(*k, i as u8);
    }

    let mut m = vec![0x80u8, num_signers as u8, ro_signed as u8, ro_unsigned as u8];
    compact(&mut m, statics.len());
    for k in &statics {
        m.extend_from_slice(k);
    }
    m.extend_from_slice(blockhash);
    compact(&mut m, ixs.len());
    for ix in ixs {
        m.push(index[&ix.program]);
        compact(&mut m, ix.accounts.len());
        for a in &ix.accounts {
            m.push(index[&a.pubkey]);
        }
        compact(&mut m, ix.data.len());
        m.extend_from_slice(&ix.data);
    }
    let used: Vec<usize> = (0..tables.len()).filter(|t| !writable[*t].is_empty() || !readonly[*t].is_empty()).collect();
    compact(&mut m, used.len());
    for t in used {
        m.extend_from_slice(&tables[t].key);
        compact(&mut m, writable[t].len());
        m.extend_from_slice(&writable[t]);
        compact(&mut m, readonly[t].len());
        m.extend_from_slice(&readonly[t]);
    }
    Ok(m)
}

/// Number of signatures a compiled message needs.
pub fn signers_needed(message: &[u8]) -> usize {
    message.get(1).copied().unwrap_or(0) as usize
}

/// An unsigned transaction: empty signature slots, then the message.
pub fn unsigned_tx(message: &[u8]) -> Vec<u8> {
    let n = signers_needed(message);
    let mut tx = Vec::with_capacity(1 + 64 * n + message.len());
    compact(&mut tx, n);
    tx.extend(std::iter::repeat_n(0u8, 64 * n));
    tx.extend_from_slice(message);
    tx
}

/// Splits a serialized transaction into its signatures and message.
pub fn split_tx(tx: &[u8]) -> Option<(Vec<[u8; 64]>, &[u8])> {
    let mut i = 0;
    let n = read_compact(tx, &mut i)?;
    if n == 0 || n > 8 {
        return None;
    }
    let mut sigs = Vec::with_capacity(n);
    for _ in 0..n {
        sigs.push(tx.get(i..i + 64)?.try_into().ok()?);
        i += 64;
    }
    Some((sigs, tx.get(i..)?))
}

/// True when `tx` is exactly `message` signed by `signer` alone.
pub fn verify_signed(tx: &[u8], message: &[u8], signer: &Pubkey) -> bool {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let Some((sigs, msg)) = split_tx(tx) else { return false };
    if sigs.len() != 1 || msg != message || signers_needed(message) != 1 {
        return false;
    }
    let Ok(key) = VerifyingKey::from_bytes(signer) else { return false };
    key.verify(message, &Signature::from_bytes(&sigs[0])).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(n: u8) -> Pubkey {
        [n; 32]
    }

    #[test]
    fn compact_lengths_round_trip() {
        for n in [0usize, 1, 127, 128, 255, 300, 16_383, 16_384] {
            let mut v = Vec::new();
            compact(&mut v, n);
            let mut i = 0;
            assert_eq!(read_compact(&v, &mut i), Some(n));
            assert_eq!(i, v.len());
        }
        let mut v = Vec::new();
        compact(&mut v, 300);
        assert_eq!(v, vec![0xac, 0x02]);
    }

    #[test]
    fn instruction_encodings_match_the_programs() {
        let t = transfer(&k(1), &k(2), 1_000_000);
        assert_eq!(t.data, [2, 0, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]);
        assert_eq!(compute_unit_limit(200_000).data, [2, 0x40, 0x0d, 0x03, 0]);
        assert_eq!(compute_unit_price(5).data, [3, 5, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn compiles_header_static_order_and_lookups() {
        let payer = k(9);
        let program = k(7);
        let ix = Instruction {
            program,
            accounts: vec![
                AccountMeta { pubkey: payer, signer: true, writable: true },
                AccountMeta { pubkey: k(1), signer: false, writable: true }, // in table, writable
                AccountMeta { pubkey: k(2), signer: false, writable: false }, // in table, read-only
                AccountMeta { pubkey: k(3), signer: false, writable: true }, // not in a table
            ],
            data: vec![42],
        };
        let table = LookupTable { key: k(50), addresses: vec![k(5), k(2), k(1)] };
        let m = compile_v0(&payer, &[ix], &[table], &k(8)).unwrap();
        assert_eq!(&m[..4], &[0x80, 1, 0, 1], "v0, 1 signer, 0 ro signed, 1 ro unsigned (program)");
        assert_eq!(m[4], 3, "static keys: payer, k3, program");
        assert_eq!(&m[5..37], &payer);
        assert_eq!(&m[37..69], &k(3));
        assert_eq!(&m[69..101], &program);
        assert_eq!(&m[101..133], &k(8), "blockhash");
        // 1 instruction: program index 2; accounts payer=0, k1=3 (loaded writable),
        // k2=4 (loaded read-only), k3=1; data [42].
        assert_eq!(&m[133..142], &[1, 2, 4, 0, 3, 4, 1, 1, 42]);
        // One lookup: table key, writable [2], read-only [1].
        assert_eq!(m[142], 1);
        assert_eq!(&m[143..175], &k(50));
        assert_eq!(&m[175..], &[1, 2, 1, 1]);
    }

    #[test]
    fn signers_and_programs_never_come_from_tables() {
        let payer = k(9);
        let ix = Instruction { program: k(7), accounts: vec![AccountMeta { pubkey: payer, signer: true, writable: true }], data: vec![] };
        let table = LookupTable { key: k(50), addresses: vec![payer, k(7)] };
        let m = compile_v0(&payer, &[ix], &[table], &k(8)).unwrap();
        assert_eq!(m[4], 2, "both static");
        assert_eq!(*m.last().unwrap(), 0, "no lookups used");
    }

    #[test]
    fn verifies_only_the_exact_message_signed_by_the_wallet() {
        use ed25519_dalek::{Signer, SigningKey};
        let sk = SigningKey::from_bytes(&[3u8; 32]);
        let payer: Pubkey = sk.verifying_key().to_bytes();
        let m = compile_v0(&payer, &[transfer(&payer, &k(2), 5)], &[], &k(8)).unwrap();
        let mut tx = unsigned_tx(&m);
        assert_eq!(tx.len(), 1 + 64 + m.len());
        let sig = sk.sign(&m).to_bytes();
        tx[1..65].copy_from_slice(&sig);
        assert!(verify_signed(&tx, &m, &payer));
        // A changed message, another signer or a missing signature all fail.
        let mut other = m.clone();
        *other.last_mut().unwrap() ^= 1;
        assert!(!verify_signed(&tx, &other, &payer));
        assert!(!verify_signed(&tx, &m, &k(4)));
        assert!(!verify_signed(&unsigned_tx(&m), &m, &payer));
        let mut tampered = tx.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(!verify_signed(&tampered, &m, &payer));
    }
}
