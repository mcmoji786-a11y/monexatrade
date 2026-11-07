"use client";

/* Phantom in the browser: connect, sign a text message to sign in, and sign a trade the
   user has reviewed. Signing in never moves funds. A trade is signed only when the user
   presses Buy or Sell and approves it in Phantom. Kixo never asks for a seed phrase. */

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

/* Wallet Standard: modern wallets (Phantom included) register themselves through these
   window events, even when another extension has taken window.solana. */
type StdAccount = { address: string; publicKey: Uint8Array };
type StdWallet = {
  name: string;
  accounts: readonly StdAccount[];
  features: Record<string, unknown>;
};
const registered: StdWallet[] = [];
if (typeof window !== "undefined") {
  const register = (...ws: StdWallet[]) => {
    for (const w of ws) if (!registered.includes(w)) registered.push(w);
    return () => {};
  };
  window.addEventListener("wallet-standard:register-wallet", ((e: CustomEvent) => {
    try {
      (e.detail as (api: { register: typeof register }) => void)({ register });
    } catch {}
  }) as EventListener);
  try {
    window.dispatchEvent(Object.assign(new Event("wallet-standard:app-ready"), { detail: { register } }));
  } catch {}
}

function fromStandard(w: StdWallet): PhantomSolana {
  const f = w.features as Record<string, { connect?: () => Promise<{ accounts: readonly StdAccount[] }>; signMessage?: (...i: { account: StdAccount; message: Uint8Array }[]) => Promise<{ signature: Uint8Array }[]>; disconnect?: () => Promise<void> }>;
  let account: StdAccount | undefined = w.accounts[0];
  const key = () => ({ toString: () => account?.address ?? "" });
  return {
    isPhantom: true,
    get publicKey() {
      return account ? key() : null;
    },
    async connect() {
      const out = await f["standard:connect"].connect!();
      account = out.accounts[0] ?? w.accounts[0];
      if (!account) throw new Error("No account selected in the wallet");
      return { publicKey: key() };
    },
    async signMessage(message: Uint8Array) {
      if (!account) await this.connect();
      const [out] = await f["solana:signMessage"].signMessage!({ account: account!, message });
      return { signature: out.signature };
    },
    disconnect: f["standard:disconnect"]?.disconnect,
  };
}

/** Phantom (or, failing that, any installed Solana wallet that can sign messages). */
export function phantom(): PhantomSolana | null {
  if (typeof window === "undefined") return null;
  const direct = window.phantom?.solana;
  if (direct && typeof direct.signMessage === "function") return direct;
  const std = registered.filter((w) => w.features["standard:connect"] && w.features["solana:signMessage"]);
  const pick = std.find((w) => /phantom/i.test(w.name)) ?? std[0];
  if (pick) return fromStandard(pick);
  const legacy = window.solana;
  return legacy && typeof legacy.signMessage === "function" ? legacy : null;
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
  // An all-zero input is only its leading "1"s; the value itself is zero.
  if (out.length === bytes.length) return out;
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

type SignTxFeature = {
  signTransaction(...inputs: { account: StdAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
};

/** Phantom through the Wallet Standard: it signs raw transaction bytes, so Kixo needs
 *  no Solana SDK in the browser. */
function phantomStandard(): StdWallet | null {
  const std = registered.filter((w) => w.features["standard:connect"] && w.features["solana:signTransaction"]);
  return std.find((w) => /phantom/i.test(w.name)) ?? null;
}

/** Asks Phantom to sign `tx` with `wallet`. The user sees and approves it in Phantom.
 *  Returns the signed bytes; nothing is sent from the wallet. */
export async function signTransactionWithPhantom(tx: Uint8Array, wallet: string): Promise<Uint8Array> {
  const w = phantomStandard();
  if (!w) throw new Error("Phantom is not installed or needs an update");
  let account = w.accounts.find((a) => a.address === wallet);
  if (!account) {
    const connect = w.features["standard:connect"] as { connect: () => Promise<{ accounts: readonly StdAccount[] }> };
    const out = await connect.connect();
    account = out.accounts.find((a) => a.address === wallet);
  }
  if (!account) throw new Error("Phantom is on another wallet. Switch to the connected one and try again");
  const f = w.features["solana:signTransaction"] as SignTxFeature;
  const [out] = await f.signTransaction({ account, transaction: tx, chain: "solana:mainnet" });
  return out.signedTransaction;
}
