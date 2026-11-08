"use client";

/**
 * Kixo trading wallet (decision 0010).
 *
 * The key is made here, in the browser, with WebCrypto (Ed25519), and locked with the
 * user's wallet password (PBKDF2-SHA256, 600,000 rounds, then AES-256-GCM). Kixo's server
 * stores only the locked copy and cannot open it. Unlocking happens here too; the open
 * key is kept in memory as a non-extractable CryptoKey and is gone when the tab closes.
 */

import { useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken } from "./account";
import { base58 } from "./phantom";

const ITERATIONS = 600_000;
/** PKCS#8 header for an Ed25519 private key; the 32-byte seed follows it. */
const PKCS8_ED25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export type Locked = { v: 1; kdf: "PBKDF2-SHA256"; cipher: "AES-256-GCM"; iterations: number; salt: string; iv: string; ciphertext: string };

export type WalletInfo = { exists: boolean; pubkey: string | null; two_fa: boolean; email: string | null; deposits: boolean; deposit_fee_bps?: number; withdraw_fee_bps?: number };

/** Kixo's fees on deposits and withdrawals, in basis points (50 = 0.5%). */
export const depositFeeBps = () => state.info?.deposit_fee_bps ?? 0;
export const withdrawFeeBps = () => state.info?.withdraw_fee_bps ?? 50;

type State = {
  status: "loading" | "signed-out" | "none" | "locked" | "unlocked" | "error";
  info: WalletInfo | null;
  error?: string;
  /** Right after creating: the recovery file to save. Kept only in this tab's memory and
   *  cleared once the user confirms they saved it. */
  recovery?: { address: string; text: string } | null;
};

/* ---------------- Store ---------------- */

let state: State = { status: "loading", info: null };
let signer: CryptoKey | null = null;
/** The address `signer` belongs to. */
let signerPubkey: string | null = null;
const subs = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

export function useKixoWallet(): State {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}

export class WalletError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = accessToken();
  if (!token) throw new WalletError("Sign in first", 401);
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let v: { message?: string } | null = null;
  try {
    v = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new WalletError(v?.message ?? `Request failed (${res.status})`, res.status);
  return v as T;
}

/** Reads whether this account has a Kixo wallet. Keeps an unlocked wallet unlocked. */
export async function refreshWallet() {
  if (!accessToken()) {
    signer = null;
    signerPubkey = null;
    set({ status: "signed-out", info: null, recovery: null });
    return;
  }
  try {
    const info = await call<WalletInfo>("/kixo-wallet");
    const unlocked = !!signer && signerPubkey === info.pubkey;
    if (!unlocked) {
      signer = null;
      signerPubkey = null;
    }
    set({ info, status: !info.exists ? "none" : unlocked ? "unlocked" : "locked", error: undefined });
    if (info.exists) void refreshBalance();
  } catch (e) {
    set({ status: "error", error: e instanceof Error ? e.message : "Could not load your wallet" });
  }
}

/* ---------------- Crypto ---------------- */

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fromB64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Whether this browser can make and use the wallet (WebCrypto Ed25519). */
export async function walletSupported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

async function passwordKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const pkcs8 = (seed: Uint8Array) => {
  const out = new Uint8Array(PKCS8_ED25519.length + 32);
  out.set(PKCS8_ED25519);
  out.set(seed, PKCS8_ED25519.length);
  return out;
};

/** The public key of a seed, and a signing key that cannot be read back out. */
async function openSeed(seed: Uint8Array): Promise<{ pubkey: string; key: CryptoKey }> {
  const extractable = await crypto.subtle.importKey("pkcs8", buf(pkcs8(seed)), { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", extractable);
  const pubkey = base58(fromB64url(jwk.x ?? ""));
  const key = await crypto.subtle.importKey("pkcs8", buf(pkcs8(seed)), { name: "Ed25519" }, false, ["sign"]);
  return { pubkey, key };
}

async function lock(seed: Uint8Array, password: string): Promise<Locked> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await passwordKey(password, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, k, buf(seed)));
  return { v: 1, kdf: "PBKDF2-SHA256", cipher: "AES-256-GCM", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(ct) };
}

async function unlockSeed(l: Locked, password: string): Promise<Uint8Array> {
  const k = await passwordKey(password, unb64(l.salt), l.iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(unb64(l.iv)) }, k, buf(unb64(l.ciphertext))));
  } catch {
    throw new WalletError("Wrong wallet password");
  }
}

/** The text of the recovery file: the key in the format Phantom imports. */
function recoveryText(seed: Uint8Array, pubkey: Uint8Array, address: string) {
  const full = new Uint8Array(64);
  full.set(seed);
  full.set(pubkey, 32);
  return [
    "Kixo wallet recovery file",
    "",
    `Address: ${address}`,
    `Private key: ${base58(full)}`,
    "",
    "This key controls the wallet. Anyone who has it can move the funds.",
    "Keep this file offline and never share it. Kixo will never ask you for it.",
    "If you forget your wallet password, this file is the only way back in.",
    "To open the wallet in Phantom: Add account, then Import private key.",
    "",
  ].join("\n");
}

/* ---------------- Actions ---------------- */

export function passwordProblem(p: string): string | null {
  if (p.length < 10) return "Use at least 10 characters";
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|password)/i.test(p)) return "Too easy to guess";
  return null;
}

/**
 * Makes the wallet: a new key, locked with `password`, stored on the account. Returns the
 * recovery file text for the user to download. The open key never leaves this tab.
 */
export async function createWallet(password: string): Promise<{ address: string; recovery: string }> {
  const problem = passwordProblem(password);
  if (problem) throw new WalletError(problem);
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const seed = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).slice(PKCS8_ED25519.length);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const address = base58(pub);
  const locked = await lock(seed, password);
  // Check the lock opens before storing it.
  const check = await unlockSeed(locked, password);
  if (b64(check) !== b64(seed)) throw new WalletError("The wallet could not be locked, try again");
  const { key } = await openSeed(seed);
  const userId = (await import("./account")).currentUserId();
  if (!userId) throw new WalletError("Sign in first", 401);
  const proof = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`Kixo wallet ${userId} ${address}`)));
  await call("/kixo-wallet", { pubkey: address, locked, proof: b64(proof) });
  const recovery = recoveryText(seed, pub, address);
  seed.fill(0);
  check.fill(0);
  signer = key;
  signerPubkey = address;
  set({ recovery: { address, text: recovery } });
  await refreshWallet();
  return { address, recovery };
}

/** Asks for an email code (2FA). Returns the masked address it went to. */
export async function sendWalletCode(): Promise<string> {
  const r = await call<{ sent_to: string }>("/kixo-wallet/code", {});
  return r.sent_to;
}

/** Unlocks the wallet on this device. Throws `WalletError` with status 428 when an email
 *  code is needed first. */
export async function unlockWallet(password: string, code?: string) {
  const r = await call<{ pubkey: string; locked: Locked }>("/kixo-wallet/locked", { code: code || undefined });
  const seed = await unlockSeed(r.locked, password);
  const { pubkey, key } = await openSeed(seed);
  seed.fill(0);
  if (pubkey !== r.pubkey) throw new WalletError("This key does not match your wallet address");
  signer = key;
  signerPubkey = pubkey;
  set({ status: "unlocked" });
}

/** Downloads the recovery file again: the wallet password opens the locked copy here,
 *  in the browser. Throws `WalletError` 428 when 2FA needs an email code first. */
export async function exportRecovery(password: string, code?: string) {
  const r = await call<{ pubkey: string; locked: Locked }>("/kixo-wallet/locked", { code: code || undefined });
  const seed = await unlockSeed(r.locked, password);
  const pub = new Uint8Array(32);
  const { pubkey } = await openSeed(seed);
  if (pubkey !== r.pubkey) throw new WalletError("This key does not match your wallet address");
  pub.set(unbase58(pubkey));
  downloadRecovery(recoveryText(seed, pub, pubkey), pubkey);
  seed.fill(0);
}

function unbase58(s: string): Uint8Array {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(0);
  for (const c of s) n = n * BigInt(58) + BigInt(A.indexOf(c));
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & BigInt(255));
    n >>= BigInt(8);
  }
  return out;
}

/** The user saved the recovery file: forget it. */
export function recoverySaved() {
  set({ recovery: null });
}

export function lockWallet() {
  signer = null;
  signerPubkey = null;
  if (state.status === "unlocked") set({ status: "locked" });
}

export async function setTwoFa(on: boolean, code: string) {
  await call("/kixo-wallet/two-fa", { on, code });
  await refreshWallet();
}

/** Signs a message with the unlocked wallet (used for trades and withdrawals). */
export async function signWithKixo(message: Uint8Array): Promise<Uint8Array> {
  if (!signer) throw new WalletError("Unlock your Kixo wallet first");
  return new Uint8Array(await crypto.subtle.sign("Ed25519", signer, buf(message)));
}

export function downloadRecovery(text: string, address: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `kixo-wallet-${address.slice(0, 6)}-recovery.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- Transactions ---------------- */

/** The Kixo wallet's address, when it exists. */
export const kixoAddress = () => (state.info?.exists ? state.info.pubkey : null);
export const kixoUnlocked = () => !!signer;

/**
 * Signs an unsigned transaction (one empty signature slot, then the message) with the
 * unlocked Kixo wallet and returns the signed bytes. Nothing is sent from here.
 */
export async function signTxWithKixo(unsigned: Uint8Array): Promise<Uint8Array> {
  if (!signer) throw new WalletError("Unlock your Kixo wallet first");
  // Only one signer is supported: count (compact u16 = 1), 64 empty bytes, message.
  if (unsigned[0] !== 1 || unsigned.length < 1 + 64 + 3) throw new WalletError("Kixo can only sign transactions with one signer");
  const message = unsigned.slice(65);
  const sig = await signWithKixo(message);
  const out = new Uint8Array(unsigned);
  out.set(sig, 1);
  return out;
}

/** Sends SOL out of the Kixo wallet to `to`. `sol: "max"` sends everything after the
 *  network fee. Returns the signature and the lamports sent. */
export async function withdrawSol(to: string, sol: number | "max"): Promise<{ signature: string; lamports: number; fee: number }> {
  const from = kixoAddress();
  if (!from) throw new WalletError("No Kixo wallet");
  const built = await call<{ build_id: string; tx: string; lamports: number; kixo_fee: number }>("/kixo-wallet/withdraw", sol === "max" ? { to, max: true } : { to, lamports: Math.round(sol * 1e9) });
  const tx = unb64(built.tx);
  // Never sign on trust: only this transfer to `to`, plus at most Kixo's fee.
  const { checkTransfer } = await import("./tx-check");
  try {
    checkTransfer(tx, { from, to, amount: BigInt(built.lamports), maxFeeBps: withdrawFeeBps() });
  } catch (e) {
    throw new WalletError(`Not signed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const signed = await signTxWithKixo(tx);
  const sent = await call<{ signature: string }>("/kixo-wallet/withdraw/send", { build_id: built.build_id, tx: b64(signed) });
  return { signature: sent.signature, lamports: built.lamports, fee: built.kixo_fee };
}

/* ---------------- Phantom: only to move SOL in and out ---------------- */

let phantomAddr: string | null = null;
const phSubs = new Set<() => void>();

/** The Phantom address shared for deposits and withdrawals in this visit, if any. */
export function usePhantomAddress(): string | null {
  return useSyncExternalStore(
    (f) => {
      phSubs.add(f);
      return () => phSubs.delete(f);
    },
    () => phantomAddr,
    () => null,
  );
}

/** Asks Phantom for its address. Connecting signs nothing and moves nothing. */
export async function connectPhantom(): Promise<string> {
  const { phantom } = await import("./phantom");
  const p = phantom();
  if (!p) throw new WalletError("Phantom is not installed. Install it, or withdraw to another address");
  const { publicKey } = await p.connect();
  phantomAddr = publicKey.toString();
  phSubs.forEach((f) => f());
  return phantomAddr;
}

/** Deposit: builds a transfer of exactly `sol` from Phantom to the Kixo wallet, Phantom
 *  shows it and the user approves there, then Kixo sends it. Returns the signature. */
export async function depositFromPhantom(sol: number): Promise<string> {
  const { signTransactionWithPhantom } = await import("./phantom");
  const from = phantomAddr ?? (await connectPhantom());
  const to = kixoAddress();
  if (!to) throw new WalletError("Set up your Kixo wallet first");
  const built = await call<{ build_id: string; tx: string; credit: number }>("/kixo-wallet/deposit", { from, lamports: Math.round(sol * 1e9) });
  const tx = unb64(built.tx);
  // Checked here as well as in Phantom: the credit goes to this account's wallet.
  const { checkTransfer } = await import("./tx-check");
  try {
    checkTransfer(tx, { from, to, amount: BigInt(built.credit), maxFeeBps: depositFeeBps() });
  } catch (e) {
    throw new WalletError(`Not sent to Phantom: ${e instanceof Error ? e.message : String(e)}`);
  }
  let signed: Uint8Array;
  try {
    signed = await signTransactionWithPhantom(tx, from);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new WalletError(/reject|denied|cancel/i.test(m) ? "You cancelled in Phantom. Nothing was sent" : m);
  }
  const sent = await call<{ signature: string }>("/kixo-wallet/deposit/send", { build_id: built.build_id, tx: b64(signed) });
  return sent.signature;
}

/** Waits until a transfer lands (about a minute at most). */
export async function waitForTransfer(sig: string): Promise<"confirmed" | "failed" | "sent"> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const s = await call<{ status: "confirmed" | "failed" | "sent" }>(`/kixo-wallet/status/${sig}`);
      if (s.status !== "sent") return s.status;
    } catch {}
  }
  return "sent";
}

/** The Kixo wallet's SOL balance, refreshed every 20 s (and on demand). */
let balance: { address: string; sol: number } | null = null;
const balSubs = new Set<() => void>();
let balTimer: ReturnType<typeof setInterval> | null = null;
export async function refreshBalance() {
  const address = kixoAddress();
  if (!address) return;
  try {
    const r = await fetch(`${GATEWAY_HTTP}/wallet/${address}/balance`, { cache: "no-store" });
    const v = r.ok ? await r.json() : null;
    if (v && typeof v.sol === "number") {
      balance = { address, sol: v.sol };
      balSubs.forEach((f) => f());
    }
  } catch {}
}
export function useKixoBalance(): number | null {
  const b = useSyncExternalStore(
    (f) => {
      balSubs.add(f);
      if (!balTimer) {
        void refreshBalance();
        balTimer = setInterval(() => void refreshBalance(), 20_000);
      }
      return () => {
        balSubs.delete(f);
        if (!balSubs.size && balTimer) {
          clearInterval(balTimer);
          balTimer = null;
        }
      };
    },
    () => balance,
    () => null,
  );
  const address = useKixoWallet().info?.pubkey;
  return b && b.address === address ? b.sol : null;
}
