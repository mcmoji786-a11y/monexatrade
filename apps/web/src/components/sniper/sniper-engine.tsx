"use client";

import { useFeatures } from "@/lib/features";
import { useEffect, useRef } from "react";
import { useRadarFeed } from "@/components/radar/use-radar-feed";
import { dropPosition, pnl, realSpent24h, recordFill, sniperStep, snipeShare, useSniper, type SniperEvent, type SniperSettings } from "@/lib/sniper";
import { openShareCard } from "@/lib/share";
import { money, signed, tinyPrice } from "@/components/trade/trade-panel";
import { orderError, placeOrder, useMode } from "@/lib/demo";
import { useAccount } from "@/lib/account";
import { kixoAddress, useKixoWallet } from "@/lib/kixo-wallet";
import { getQuote, signAndSend, tradeConfig, TradeFail, waitForTrade } from "@/lib/trade";
import { launchSignals, safetyScore } from "@/lib/safety";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";

const STEP_MS = 2_000;

/** Where the sniper's buys and sells go right now. */
export type SniperAccount = "paper" | "demo" | "real";

/** Real snipes need all three: real trading open in the admin, the user's "Use real SOL"
 *  switch, and an unlocked Kixo wallet in this tab. Anything else stays demo or paper. */
export function useSniperAccount(): { account: SniperAccount; why: string | null } {
  const { settings } = useSniper();
  const mode = useMode();
  const auth = useAccount();
  const features = useFeatures();
  const wallet = useKixoWallet();
  if (auth.status !== "signed-in") return { account: "paper", why: "Sign in to trade the sniper's picks" };
  if (mode === "demo") return { account: "demo", why: null };
  if (!settings.realEnabled) return { account: "paper", why: "Real mode: turn on Use real SOL to let the sniper trade your Kixo wallet" };
  if (!features.real_trading) return { account: "paper", why: "Real trading opens after Kixo's security review. Until then snipes are on paper" };
  if (wallet.status !== "unlocked") return { account: "paper", why: "Unlock your Kixo wallet (balance at the top) so the sniper can sign" };
  return { account: "real", why: null };
}

/** Mounted once in the app shell: runs the sniper on the live feed while Kixo is open,
 *  whatever page the user is on, and announces every buy and sell. */
function SniperEngineInner() {
  const { settings, positions } = useSniper();
  const feed = useRadarFeed();
  const { account } = useSniperAccount();
  const where = useRef<SniperAccount>("paper");
  useEffect(() => {
    where.current = account;
  }, [account]);
  const latest = useRef(feed);
  const prefs = useRef(settings);
  useEffect(() => {
    latest.current = feed;
    prefs.current = settings;
  }, [feed, settings]);
  const active = settings.enabled || positions.some((p) => !p.exitTs);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const { tokens, markets, smart, solUsd } = latest.current;
      if (!tokens.length) return;
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t.symbol.trim().toUpperCase(), (counts.get(t.symbol.trim().toUpperCase()) ?? 0) + 1);
      const copied = (t: (typeof tokens)[number]) => (counts.get(t.symbol.trim().toUpperCase()) ?? 0) > 1;
      const nowSecs = Date.now() / 1000;
      const safetyOf = (t: (typeof tokens)[number]) =>
        safetyScore(launchSignals(t, markets[t.mint] ?? null, { copyOfReal: false, sameSymbol: copied(t), sameXAccount: false, smart: smart[t.mint] ?? 0, nowSecs })).score;
      const events = sniperStep(tokens, copied, solUsd, safetyOf);
      if (!events.length) return;
      const acc = where.current;
      // New buys carry the account they were made on; sells follow their buy.
      for (const e of events) if (e.kind === "buy") recordFill(e.position.id, { account: acc });
      announce(events, prefs.current, solUsd, acc);
      for (const e of events) {
        const on = e.kind === "buy" ? acc : (e.position.account ?? "paper");
        if (on === "demo") void toDemo(e, solUsd, prefs.current.notifyToast);
        else if (on === "real") enqueue(() => toReal(e, prefs.current));
      }
    }, STEP_MS);
    return () => clearInterval(id);
  }, [active]);

  return null;
}

function announce(events: SniperEvent[], s: { notifyToast: boolean; notifySound: boolean; notifyDesktop: boolean }, solUsd: number | null, acc: SniperAccount) {
  for (const e of events.slice(0, 4)) {
    const p = e.position;
    const on = e.kind === "buy" ? acc : (p.account ?? "paper");
    const tag = on === "real" ? " · real SOL" : on === "demo" ? " · demo" : " · paper";
    const usd = (sol: number) => (solUsd ? ` ($${Math.abs(sol * solUsd).toFixed(2)})` : "");
    let title: string;
    let body: string;
    let tone: "good" | "bad" | "info";
    if (e.kind === "buy") {
      title = `Sniper bought ${p.symbol || "a coin"}${tag}`;
      body = `${p.sizeSol.toFixed(3)} SOL${usd(p.sizeSol)} · MC ${p.entryMcSol.toFixed(1)} SOL${p.entrySafety != null ? ` · safety ${p.entrySafety}%` : ""}`;
      tone = "info";
    } else {
      const r = pnl(p, null);
      const win = (r.sol ?? 0) >= 0;
      title = `Sniper sold ${p.symbol || "a coin"} · ${p.reason}${tag}`;
      body = `${win ? "+" : "−"}${Math.abs(r.sol ?? 0).toFixed(3)} SOL${usd(r.sol ?? 0)} · ${r.pct != null ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(0)}%` : ""}${on !== "paper" ? " · final figure after the order fills" : ""}`;
      tone = win ? "good" : "bad";
    }
    // A demo sell gets its notification when the order fills (real figure and share card).
    const demoSell = e.kind === "sell" && on === "demo";
    if (s.notifyToast && !demoSell) pushToast({ kind: "sniper", tone, title, body, href: tokenHref(p.mint) });
    if (s.notifyDesktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(`Kixo · ${title}`, { body, tag: `${p.id}:${e.kind}` });
      n.onclick = () => {
        window.focus();
        window.location.assign(tokenHref(p.mint));
      };
    }
  }
  if (s.notifySound) chime(events.some((e) => e.kind === "buy"));
}

/** Demo: every buy and sell is a demo order, and its real fill replaces the estimate. */
async function toDemo(e: SniperEvent, solUsd: number | null, toast: boolean) {
  const p = e.position;
  try {
    if (e.kind === "buy") {
      if (!solUsd) throw new Error("SOL price not loaded");
      const r = await placeOrder({ mint: p.mint, side: "buy", usd: p.sizeSol * solUsd, source: "sniper" });
      recordFill(p.id, { entryUsd: r.fill.usd });
    } else {
      const r = await placeOrder({ mint: p.mint, side: "sell", fraction: 1, source: "sniper" });
      const f = r.fill;
      recordFill(p.id, { exitUsd: f.usd, pnlUsd: r.realized_usd ?? undefined, exitTokens: f.tokens, exitPriceUsd: f.price_usd, exitFeeUsd: f.fee_usd, exitSol: f.sol });
      // The result from the actual fill, with the share card one click away (as for a
      // manual sell). It replaces the estimate announced when the sniper decided to sell.
      const pnlUsd = r.realized_usd ?? 0;
      const cost = f.usd - pnlUsd;
      const pct = cost > 0 ? (pnlUsd / cost) * 100 : 0;
      const card = snipeShare({ ...p, account: "demo", exitTs: p.exitTs ?? Math.floor(Date.now() / 1000), exitUsd: f.usd, pnlUsd, exitTokens: f.tokens, exitPriceUsd: f.price_usd, exitFeeUsd: f.fee_usd, exitSol: f.sol });
      if (toast) {
        pushToast({
          kind: "trade",
          tone: pnlUsd < 0 ? "bad" : "good",
          title: `Sniper sold ${r.symbol || p.symbol || "a coin"} · ${p.reason ?? "exit"} · demo`,
          figure: `${signed(pnlUsd)}  ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`,
          body: `Received ${money(f.usd)} at ${tinyPrice(f.price_usd)} · fee ${money(f.fee_usd)}`,
          action: card ? { label: "View card", onClick: () => openShareCard(card) } : undefined,
        });
      }
    }
  } catch (err) {
    if (e.kind === "buy") dropPosition(p.id);
    else recordFill(p.id, { error: orderError(err) });
    pushToast({ tone: "bad", title: `Sniper demo ${e.kind} not filled: ${p.symbol || "coin"}`, body: orderError(err) });
  }
}

/* Real orders go one at a time: one wallet, one signature after another. */
let queue: Promise<void> = Promise.resolve();
function enqueue(job: () => Promise<void>) {
  queue = queue.then(job, job);
}

const failText = (e: unknown) => (e instanceof TradeFail ? e.info.message + (e.info.hint ? `. ${e.info.hint}` : "") : e instanceof Error ? e.message : String(e));

/** Real: the Kixo wallet signs the same checked transaction a manual trade would. */
async function toReal(e: SniperEvent, s: SniperSettings) {
  const p = e.position;
  const wallet = kixoAddress();
  const slippage = Math.min(5_000, Math.max(500, Math.round(s.slippagePct * 100)));
  try {
    if (!wallet) throw new Error("No Kixo wallet");
    const cfg = await tradeConfig();
    if (!cfg.enabled || !cfg.ready) throw new Error(cfg.not_ready ?? "Real trading is not open");
    if (e.kind === "buy") {
      // The 24-hour cap counts this snipe too.
      if (realSpent24h() > s.realDailyCapSol + 1e-9) throw new Error(`Daily limit of ${s.realDailyCapSol} SOL reached`);
      const lamports = Math.round(p.sizeSol * 1e9);
      if (lamports > cfg.max_lamports) throw new Error(`Above the ${cfg.max_lamports / 1e9} SOL limit per trade`);
      const q = await getQuote({ wallet, mint: p.mint, side: "buy", lamports, slippage_bps: slippage, speed: "turbo", mev: false, symbol: p.symbol });
      const sig = await signAndSend(q, wallet, cfg, () => {});
      recordFill(p.id, { buySig: sig, realInSol: p.sizeSol });
      const st = await waitForTrade(sig);
      if (st.status !== "confirmed") throw new Error(st.error?.message ?? `Buy ${st.status}`);
    } else {
      const q = await getQuote({ wallet, mint: p.mint, side: "sell", fraction: 1, slippage_bps: slippage, speed: "turbo", mev: false, symbol: p.symbol });
      const sig = await signAndSend(q, wallet, cfg, () => {});
      recordFill(p.id, { sellSig: sig, realOutSol: (Number(q.sol_lamports) - q.platform_fee_lamports) / 1e9 });
      const st = await waitForTrade(sig);
      if (st.status !== "confirmed") throw new Error(st.error?.message ?? `Sell ${st.status}: sell it from the coin page`);
    }
  } catch (err) {
    const msg = failText(err);
    if (e.kind === "buy") dropPosition(p.id);
    else recordFill(p.id, { error: msg });
    pushToast({ tone: "bad", title: `Sniper real ${e.kind} failed: ${p.symbol || "coin"}`, body: msg });
  }
}

/** A short two-note chime: rising for a buy, falling for a sell. */
function chime(buy: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = buy ? [660, 880] : [660, 440];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.12;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {
    // Audio blocked until the user interacts with the page.
  }
}

/** Hidden when the admin switches "sniper" off (lib/features.ts). */
export function SniperEngine(props: Record<string, never>) {
  const f = useFeatures();
  return f.sniper ? <SniperEngineInner {...props} /> : null;
}
