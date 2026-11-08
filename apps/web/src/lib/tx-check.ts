/* Checks a swap transaction from the gateway before the wallet is asked to sign it.
   The gateway builds it, but the browser does not take that on trust: the payer must be
   the user's wallet, only known programs may run at the top level, and the SOL leaving
   the wallet by plain transfer must match what the ticket shows. Only then does the Kixo
   wallet sign it. */

import { base58 } from "./phantom";

const SYSTEM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const LAUNCHLAB = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const ALLOWED = new Set([SYSTEM, COMPUTE_BUDGET, TOKEN, TOKEN_2022, ATA, JUPITER, PUMP, PUMPSWAP, DBC, LAUNCHLAB]);

/* Our own builders spend SOL inside the swap program, where no top-level transfer
   shows it, so their instruction data is read: [discriminator, SOL in, user index]. */
const hex = (d: Uint8Array) => Array.from(d.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
type Swap = { program: string; user: number; side: "buy" | "sell" | "either" };
/** Every swap instruction our builders send, by discriminator and program. */
const SWAPS: Record<string, Swap[]> = {
  "38fc74089edfcd5f": [{ program: PUMP, user: 6, side: "buy" }], // pump.fun buy_exact_sol_in
  "33e685a4017f83ad": [
    { program: PUMP, user: 6, side: "sell" }, // pump.fun sell
    { program: PUMPSWAP, user: 1, side: "sell" }, // PumpSwap sell
  ],
  c62e1552b4d9e870: [{ program: PUMPSWAP, user: 1, side: "buy" }], // PumpSwap buy_exact_quote_in
  f8c69e91e17587c8: [{ program: DBC, user: 9, side: "either" }], // Meteora DBC swap (direction from accounts)
  faea0d7bd59c13ec: [{ program: LAUNCHLAB, user: 0, side: "buy" }], // LaunchLab buy_exact_in
  "9527de9bd37c981a": [{ program: LAUNCHLAB, user: 0, side: "sell" }], // LaunchLab sell_exact_in
};

type Ix = { program: string; accounts: number[]; data: Uint8Array };
export type Parsed = { signers: number; keys: string[]; ixs: Ix[] };

function compact(b: Uint8Array, at: { i: number }) {
  let n = 0;
  for (let shift = 0; shift < 21; shift += 7) {
    const byte = b[at.i++];
    if (byte === undefined) throw new Error("truncated");
    n |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return n;
  }
  throw new Error("bad length");
}

/** Reads an unsigned or signed v0 transaction. Lookup-table accounts are not
 *  resolved: the checks below only ever need static keys. */
export function parseTx(tx: Uint8Array): Parsed {
  const at = { i: 0 };
  const sigs = compact(tx, at);
  at.i += 64 * sigs;
  if (tx[at.i++] !== 0x80) throw new Error("not a v0 transaction");
  const signers = tx[at.i];
  at.i += 3;
  const nKeys = compact(tx, at);
  const keys: string[] = [];
  for (let k = 0; k < nKeys; k++) keys.push(base58(tx.subarray(at.i, (at.i += 32))));
  at.i += 32; // blockhash
  const nIx = compact(tx, at);
  const ixs: Ix[] = [];
  for (let k = 0; k < nIx; k++) {
    const p = tx[at.i++];
    const na = compact(tx, at);
    const accounts = Array.from(tx.subarray(at.i, (at.i += na)));
    const nd = compact(tx, at);
    const data = tx.subarray(at.i, (at.i += nd));
    if (p >= keys.length) throw new Error("program not in static keys");
    ixs.push({ program: keys[p], accounts, data });
  }
  return { signers, keys, ixs };
}

const u64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getBigUint64(0, true);
const u32 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 4).getUint32(0, true);

export type Expect = {
  wallet: string;
  side: "buy" | "sell";
  /** Buy: SOL the ticket says it spends (fee included). */
  spendLamports: bigint;
  feeWallet: string;
  feeLamports: bigint;
  tipAccounts: string[];
  tipLamports: bigint;
  priorityLamports: bigint;
};

export type TransferExpect = {
  /** Who pays and signs. */
  from: string;
  /** Where the money goes, and how much must arrive there. */
  to: string;
  amount: bigint;
  /** Kixo's fee: at most `maxFeeBps` of the whole amount, to one fee wallet. */
  maxFeeBps: number;
};

/**
 * Checks a deposit or withdrawal before it is signed: only compute-budget settings and
 * plain SOL transfers from `from`, exactly `amount` to `to`, at most one more transfer
 * (Kixo's fee) of no more than `maxFeeBps`, and a priority fee under 0.0001 SOL. Returns
 * the fee found.
 */
export function checkTransfer(tx: Uint8Array, e: TransferExpect): bigint {
  const { signers, keys, ixs } = parseTx(tx);
  if (signers !== 1 || keys[0] !== e.from) throw new Error("The transfer is not paid by the right wallet");
  let limit = BigInt(200_000);
  let price = BigInt(0);
  let toTotal = BigInt(0);
  const fees: bigint[] = [];
  for (const ix of ixs) {
    const key = (n: number) => (ix.accounts[n] !== undefined ? keys[ix.accounts[n]] : undefined);
    if (ix.program === COMPUTE_BUDGET) {
      if (ix.data[0] === 2) limit = BigInt(u32(ix.data, 1));
      else if (ix.data[0] === 3) price = u64(ix.data, 1);
      else throw new Error("Unexpected compute budget instruction");
    } else if (ix.program === SYSTEM) {
      if (ix.data.length !== 12 || u32(ix.data, 0) !== 2) throw new Error("Unexpected system instruction");
      if (key(0) !== e.from) throw new Error("A transfer from another account");
      const lamports = u64(ix.data, 4);
      if (key(1) === e.to) toTotal += lamports;
      else fees.push(lamports);
    } else throw new Error(`Unexpected program ${ix.program.slice(0, 8)}…`);
  }
  if (toTotal !== e.amount) throw new Error("The amount differs from what you chose");
  if (fees.length > 1) throw new Error("The transfer pays more than one other account");
  const fee = fees[0] ?? BigInt(0);
  if (fee * BigInt(10_000) > (toTotal + fee) * BigInt(e.maxFeeBps)) throw new Error("The fee is higher than shown");
  if ((limit * price + BigInt(999_999)) / BigInt(1_000_000) > BigInt(100_000)) throw new Error("The priority fee is too high");
  return fee;
}

/** Throws with a plain reason when the transaction is not what the ticket shows. */
export function checkTx(tx: Uint8Array, e: Expect) {
  const { signers, keys, ixs } = parseTx(tx);
  if (signers !== 1 || keys[0] !== e.wallet) throw new Error("The transaction is not paid by your wallet");
  let limit = BigInt(200_000);
  let price = BigInt(0);
  let fee = BigInt(0);
  let tip = BigInt(0);
  let other = BigInt(0);
  let nativeSpend = BigInt(0);
  let poolSpend = BigInt(0);
  for (const ix of ixs) {
    if (!ALLOWED.has(ix.program)) throw new Error(`Unexpected program ${ix.program.slice(0, 8)}…`);
    const key = (n: number) => (ix.accounts[n] !== undefined ? keys[ix.accounts[n]] : undefined);
    if (ix.program === COMPUTE_BUDGET) {
      if (ix.data[0] === 2) limit = BigInt(u32(ix.data, 1));
      else if (ix.data[0] === 3) price = u64(ix.data, 1);
      else throw new Error("Unexpected compute budget instruction");
    } else if (ix.program === SYSTEM) {
      if (ix.data.length !== 12 || u32(ix.data, 0) !== 2) throw new Error("Unexpected system instruction");
      if (key(0) !== e.wallet) throw new Error("A transfer from another account");
      const lamports = u64(ix.data, 4);
      const to = key(1);
      if (to === e.feeWallet) fee += lamports;
      else if (to && e.tipAccounts.includes(to)) tip += lamports;
      else other += lamports; // wrapping SOL into the wallet's own token account
    } else if (ix.program === PUMP || ix.program === PUMPSWAP || ix.program === DBC || ix.program === LAUNCHLAB) {
      const swap = SWAPS[hex(ix.data)]?.find((x) => x.program === ix.program);
      if (!swap) throw new Error("Unexpected swap instruction");
      if (key(swap.user) !== e.wallet) throw new Error("The swap is not for your wallet");
      if (swap.side !== "either" && swap.side !== e.side) throw new Error("The swap goes the other way");
      if (e.side === "buy") {
        // pump.fun takes SOL inside the program. The others take it from the wrapped-SOL
        // account, which may already hold the user's own wrapped SOL: both are capped.
        if (ix.program === PUMP) nativeSpend += u64(ix.data, 8);
        else poolSpend += u64(ix.data, 8);
      }
    } else if (ix.program === TOKEN || ix.program === TOKEN_2022) {
      // Only SyncNative (17) and CloseAccount (9) back to the wallet itself.
      if (ix.data[0] === 17) continue;
      if (ix.data[0] === 9 && key(1) === e.wallet && key(2) === e.wallet) continue;
      throw new Error("Unexpected token instruction");
    }
  }
  if (fee !== e.feeLamports) throw new Error("The platform fee differs from the ticket");
  if (tip !== e.tipLamports) throw new Error("The network tip differs from the ticket");
  if ((limit * price + BigInt(999_999)) / BigInt(1_000_000) > e.priorityLamports + BigInt(1)) throw new Error("The priority fee is higher than shown");
  if (e.side === "sell" && other > BigInt(0)) throw new Error("A sale should not send SOL anywhere else");
  // PumpSwap's SOL arrives by the wrap transfer counted in `other`; pump.fun's is in its data.
  if (e.side === "buy" && fee + other + nativeSpend > e.spendLamports) throw new Error("The transaction spends more SOL than shown");
  if (e.side === "buy" && fee + poolSpend > e.spendLamports) throw new Error("The transaction spends more SOL than shown");
}
