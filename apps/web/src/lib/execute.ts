"use client";

/** One way to place a buy or sell, for every feature that trades: Quick Buy, limit and
 *  stop orders, grid and copy trading. Demo fills on the demo account at live prices;
 *  real signs in this browser with the unlocked Kixo wallet and sends through Kixo's own
 *  path, so a feature behaves the same on both (the founder's rule: demo and real alike). */

import { useAccount } from "./account";
import { orderError, placeOrder, useMode, type TradeSource } from "./demo";
import { useFeatures } from "./features";
import { kixoAddress, useKixoWallet } from "./kixo-wallet";
import { getSettings } from "./settings";
import { getQuote, signAndSend, tradeConfig, TradeFail, waitForTrade } from "./trade";

export type Venue = "demo" | "real";

/** Where a trade placed now would go, or why it cannot be placed. */
export function useVenue(): { venue: Venue | null; why: string | null } {
  const auth = useAccount();
  const mode = useMode();
  const features = useFeatures();
  const wallet = useKixoWallet();
  if (auth.status !== "signed-in") return { venue: null, why: "Sign in to trade" };
  if (mode === "demo") return { venue: "demo", why: null };
  if (!features.real_trading) return { venue: null, why: "Real trading opens after Kixo's security review. Switch to Demo to practise" };
  if (wallet.status === "none") return { venue: null, why: "Set up your Kixo wallet first" };
  if (wallet.status !== "unlocked") return { venue: null, why: "Unlock your Kixo wallet (balance at the top) to trade" };
  return { venue: "real", why: null };
}

export type TradeRequest = {
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  /** Buys: SOL to spend (real), or converted to USD on demo. */
  sol?: number;
  /** Buys on demo: USD to spend (wins over `sol`). */
  usd?: number;
  /** Sells: share of the position, 0 to 1. */
  fraction?: number;
  solUsd: number | null;
  /** Who placed it (demo history): Quick Buy, grid or copy trading. */
  source?: TradeSource;
};

export type Fill = {
  venue: Venue;
  side: "buy" | "sell";
  symbol: string;
  /** What was spent (buy) or received (sell), in SOL; for real sells, the quoted amount. */
  sol: number;
  usd: number | null;
  tokens: number | null;
  priceUsd: number | null;
  feeUsd: number | null;
  /** Demo sells: realized profit in USD. */
  realizedUsd: number | null;
  /** Real trades: the transaction. */
  signature?: string;
};

/** A readable reason from any trade error. */
export function tradeErrorText(e: unknown) {
  if (e instanceof TradeFail) return e.info.message + (e.info.hint ? `. ${e.info.hint}` : "");
  return orderError(e);
}

/** Places one trade on `venue` and waits for it to fill (real: confirmed on chain). */
export async function execute(venue: Venue, r: TradeRequest): Promise<Fill> {
  if (venue === "demo") {
    let usd = r.usd;
    if (r.side === "buy" && usd == null) {
      if (!r.sol || !r.solUsd) throw new Error("SOL price not loaded yet");
      usd = r.sol * r.solUsd;
    }
    const res = await placeOrder(r.side === "buy" ? { mint: r.mint, side: "buy", usd, source: r.source } : { mint: r.mint, side: "sell", fraction: r.fraction ?? 1, source: r.source });
    const f = res.fill;
    return { venue, side: r.side, symbol: res.symbol || r.symbol, sol: f.sol, usd: f.usd, tokens: f.tokens, priceUsd: f.price_usd, feeUsd: f.fee_usd, realizedUsd: res.realized_usd };
  }

  const wallet = kixoAddress();
  if (!wallet) throw new Error("Unlock your Kixo wallet first");
  const cfg = await tradeConfig();
  if (!cfg.enabled || !cfg.ready) throw new Error(cfg.not_ready ?? "Real trading is not open");
  const t = getSettings().trading;
  const common = { wallet, mint: r.mint, slippage_bps: t.slippage_bps, speed: t.speed, mev: t.mev, symbol: r.symbol };
  let q;
  if (r.side === "buy") {
    const sol = r.sol ?? (r.usd != null && r.solUsd ? r.usd / r.solUsd : 0);
    const lamports = Math.round(sol * 1e9);
    if (lamports <= 0) throw new Error("Enter an amount");
    if (lamports > cfg.max_lamports) throw new Error(`Above the ${cfg.max_lamports / 1e9} SOL limit per trade`);
    q = await getQuote({ ...common, side: "buy", lamports });
  } else {
    q = await getQuote({ ...common, side: "sell", fraction: r.fraction ?? 1 });
  }
  const signature = await signAndSend(q, wallet, cfg, () => {});
  const st = await waitForTrade(signature);
  if (st.status !== "confirmed") throw new Error(st.error?.message ?? `Trade ${st.status}`);
  const sol = r.side === "buy" ? Number(q.sol_lamports) / 1e9 : (Number(q.sol_lamports) - q.platform_fee_lamports) / 1e9;
  const tokens = Number(q.token_amount) / 10 ** q.decimals;
  return {
    venue,
    side: r.side,
    symbol: r.symbol,
    sol,
    usd: r.solUsd ? sol * r.solUsd : null,
    tokens,
    priceUsd: r.solUsd && tokens > 0 ? (Number(q.sol_lamports) / 1e9 / tokens) * r.solUsd : null,
    feeUsd: r.solUsd ? (q.platform_fee_lamports / 1e9) * r.solUsd : null,
    realizedUsd: null,
    signature,
  };
}
