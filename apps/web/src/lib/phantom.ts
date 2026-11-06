"use client";

/* Phantom in the browser: connect and sign a text message. Nothing here can move funds;
   MONEXA never asks for a transaction signature or a seed phrase to sign in. */

type PhantomSolana = {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: "utf8"): Promise<{ signature: Uint8Array }>;
  disconnect?(): Promise<void>;
};

declare global {
  interface Window {
    phantom?: { solana?: PhantomSolana };
    solana?: PhantomSolana;
  }
}

export function phantom(): PhantomSolana | null {
  if (typeof window === "undefined") return null;
  const p = window.phantom?.solana ?? window.solana;
  return p?.isPhantom ? p : null;
}

export const PHANTOM_INSTALL = "https://phantom.com/download";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet), as Solana uses for keys and signatures. */
export function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/** Connects Phantom and signs `message`. Returns the wallet and base58 signature. */
export async function signWithPhantom(message: string, wallet?: string) {
  const p = phantom();
  if (!p) throw new Error("Phantom is not installed");
  const { publicKey } = await p.connect();
  const address = publicKey.toString();
  if (wallet && wallet !== address) throw new Error("Phantom switched to another wallet, try again");
  const { signature } = await p.signMessage(new TextEncoder().encode(message), "utf8");
  return { wallet: address, signature: base58(signature) };
}
