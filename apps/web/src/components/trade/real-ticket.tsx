"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { useKixoWallet } from "@/lib/kixo-wallet";
import { WalletPanel } from "@/components/wallet/kixo-wallet-card";
import { setMode } from "@/lib/demo";
import { pushToast } from "@/lib/toast";
import { getQuote, signAndSend, sol, solscan, TradeFail, usePrepare, useTradeConfig, waitForTrade, type Quote, type Stage, type TradeError, receiptLine } from "@/lib/trade";
import { compact } from "./trade-panel";
import { useSettings } from "@/lib/settings";

const SLIPPAGES = [500, 1000, 2000];
/** A quote older than this is fetched again before signing. */
const FRESH_MS = 15_000;

const STAGE: Record<Stage | "building", string> = { building: "Building and checking the trade", checking: "Checking the transaction", signing: "Signing with your Kixo wallet", sending: "Sending", confirming: "Confirming on chain" };

/** The real-money ticket: SOL from the user's Kixo wallet, signed in the browser with
 *  no popup. */
export function RealTicket({ symbol, mint, side }: { symbol: string; mint: string; side: "buy" | "sell" }) {
  const cfg = useTradeConfig();
  const kw = useKixoWallet();
  const wallet = kw.status === "unlocked" ? (kw.info?.pubkey ?? null) : null;
  const [amount, setAmount] = useState("");
  // Defaults come from Settings; a change here applies to this ticket only.
  const t = useSettings().settings.trading;
  const [own, setOwn] = useState<{ slippage?: number; speed?: "fast" | "turbo"; mev?: boolean }>({});
  const slippage = own.slippage ?? t.slippage_bps;
  const speed = own.speed ?? t.speed;
  const mev = own.mev ?? t.mev;
  const setSlippage = (v: number) => setOwn((o) => ({ ...o, slippage: v }));
  const setSpeed = (v: "fast" | "turbo") => setOwn((o) => ({ ...o, speed: v }));
  const setMev = (v: boolean) => setOwn((o) => ({ ...o, mev: v }));
  const slippages = [...new Set([...SLIPPAGES, t.slippage_bps])].sort((a, b) => a - b);
  // Large buys ask once more (Settings: confirm above).
  const [confirming, setConfirming] = useState(false);
  const [quote, setQuote] = useState<{ q: Quote; at: number; key: string } | null>(null);
  const [qErr, setQErr] = useState<TradeError | null>(null);
  const [stage, setStage] = useState<Stage | "building" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; sig?: string; err?: TradeError; ms?: number | null; route?: string | null } | null>(null);
  const seq = useRef(0);
  usePrepare(!!cfg?.enabled && !!cfg.ready && !!wallet);

  const value = Number(amount);
  const maxSol = cfg ? cfg.max_lamports / 1e9 : 3;
  const valid = side === "buy" ? value >= 0.001 && value <= maxSol : value > 0 && value <= 100;
  const key = `${wallet}|${mint}|${side}|${amount}|${slippage}|${speed}|${mev}`;

  const request = () =>
    getQuote({
      wallet: wallet!,
      mint,
      side,
      ...(side === "buy" ? { lamports: Math.round(value * 1e9) } : { fraction: value / 100 }),
      slippage_bps: slippage,
      speed,
      mev,
      symbol,
    });

  // The trade is built when the user presses Buy or Sell, not while typing: every build
  // calls the router, whose free tier allows about one request every two seconds.
  useEffect(() => {
    seq.current++;
  }, [key]);

  async function submit() {
    if (!cfg || !wallet) return;
    setResult(null);
    setQErr(null);
    setStage("building");
    try {
      let q = quote && quote.key === key && Date.now() - quote.at < FRESH_MS ? quote.q : null;
      if (!q) {
        q = await request();
        setQuote({ q, at: Date.now(), key });
      }
      const sig = await signAndSend(q, wallet, cfg, setStage);
      const s = await waitForTrade(sig);
      if (s.status === "confirmed") {
        setResult({ ok: true, sig, ms: s.latency_ms, route: receiptLine(s.receipt) });
        setAmount("");
        pushToast({ kind: "trade", tone: "good", title: `${side === "buy" ? "Bought" : "Sold"} ${symbol || "token"}`, body: s.latency_ms ? `Confirmed in ${(s.latency_ms / 1000).toFixed(1)}s` : "Confirmed", href: solscan(sig) });
      } else if (s.status === "sent") {
        setResult({ ok: false, sig, err: { code: "pending", message: "Still waiting for the network", hint: "Check it on Solscan before trading again" } });
      } else {
        setResult({ ok: false, sig, err: s.error ?? { code: s.status, message: "The trade did not go through" } });
      }
    } catch (e) {
      const info = e instanceof TradeFail ? e.info : { code: "error", message: e instanceof Error ? e.message : String(e) };
      if (info.code !== "rejected") {
        setResult({ ok: false, err: info });
        setQErr(info);
      }
      else pushToast({ tone: "info", title: "Cancelled", body: "Nothing was sent" });
    } finally {
      setStage(null);
    }
  }

  if (!cfg) return <p className="mt-4 text-center text-xs text-muted">Loading</p>;
  if (!cfg.enabled || !cfg.ready)
    return (
      <>
        <button type="button" disabled className={`mt-4 h-11 w-full cursor-not-allowed rounded-full text-sm font-medium opacity-50 ${side === "buy" ? "bg-[#2ebd85] text-bg" : "bg-[#f6465d] text-text"}`}>
          {side === "buy" ? "Buy" : "Sell"} {symbol || "token"}
        </button>
        <p className="mt-2 text-center text-xs text-muted">
          Real trading opens soon.{" "}
          <button type="button" onClick={() => setMode("demo")} className="text-warning underline underline-offset-2">
            Practise in demo
          </button>
        </p>
      </>
    );
  if (!wallet)
    return (
      <div className="mt-4 rounded-lg border border-border bg-bg/60 p-4">
        <WalletPanel compact />
      </div>
    );

  const q = quote?.key === key ? quote.q : null;
  const out = q ? (side === "buy" ? `${compact(Number(q.token_amount) / 10 ** q.decimals)} ${symbol}` : `${sol(q.sol_lamports).toFixed(4)} SOL`) : null;
  const minOut = q ? (side === "buy" ? `${compact(Number(q.min_out) / 10 ** q.decimals)} ${symbol}` : `${(sol(q.min_out) - sol(q.platform_fee_lamports)).toFixed(4)} SOL`) : null;
  const costs = q ? q.platform_fee_lamports + q.priority_fee_lamports + q.tip_lamports + q.network_fee_lamports : 0;

  return (
    <>
      <label className="mt-3 flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
        <span className="text-xs text-muted">Amount</span>
        <input
          inputMode="decimal"
          value={amount}
          disabled={!!stage}
          onChange={(e) => (setAmount(e.target.value.replace(/[^0-9.]/g, "")), setResult(null))}
          placeholder="0"
          className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm text-text outline-none placeholder:text-muted"
        />
        <span className="font-mono text-xs text-text-2">{side === "buy" ? "SOL" : "%"}</span>
      </label>
      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${(side === "buy" ? t.buy_presets : t.sell_presets).length}, minmax(0, 1fr))` }}>
        {(side === "buy" ? t.buy_presets : t.sell_presets).map(String).map((p) => (
          <button key={p} type="button" disabled={!!stage} onClick={() => setAmount(p)} className="h-8 rounded-md border border-border font-mono text-xs text-text-2 transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-50">
            {side === "buy" ? p : `${p}%`}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          Slippage
          {slippages.map((s) => (
            <button key={s} type="button" aria-pressed={slippage === s} onClick={() => setSlippage(s)} className={`rounded px-1.5 py-0.5 font-mono ${slippage === s ? "bg-surface-3 text-text" : "hover:text-text"}`}>
              {s / 100}%
            </button>
          ))}
        </span>
        <span className="flex items-center gap-1">
          {(["fast", "turbo"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} className={`rounded px-1.5 py-0.5 capitalize ${speed === s ? "bg-surface-3 text-text" : "hover:text-text"}`}>
              {s}
            </button>
          ))}
        </span>
        <button type="button" aria-pressed={mev} onClick={() => setMev(!mev)} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${mev ? "text-emerald" : "hover:text-text"}`} title="Avoids validators known for sandwich attacks">
          <ShieldCheck size={12} strokeWidth={1.5} /> MEV {mev ? "on" : "off"}
        </button>
      </div>

      {valid && !result && (
        <dl className="mt-3 flex flex-col gap-1 rounded-lg border border-border px-3 py-2 font-mono text-xs tabular-nums">
          {!q && !qErr ? (
            <>
              <Row k={`Platform fee ${cfg.fee_bps / 100}%`} v={side === "buy" ? `${((value * cfg.fee_bps) / 10_000).toFixed(5)} SOL` : `${cfg.fee_bps / 100}% of the SOL received`} />
              <Row k="Sender tip" v={`${sol(cfg.speeds[speed].tip).toFixed(6)} SOL`} />
              <Row k="Priority fee" v={`up to ${sol(cfg.speeds[speed].max_priority).toFixed(4)} SOL`} />
              <span className="font-sans text-[11px] text-muted">Exact amounts show when you press {side === "buy" ? "Buy" : "Sell"}, before Phantom asks you to approve</span>
            </>
          ) : q ? (
            <>
              <Row k="You get about" v={out!} />
              <Row k="At least" v={minOut!} />
              {q.price_impact_pct != null && <Row k="Price impact" v={`${q.price_impact_pct.toFixed(2)}%`} warn={q.price_impact_pct > 5} />}
              <Row k={`Platform fee ${(q.fee_bps ?? cfg.fee_bps) / 100}%`} v={`${sol(q.platform_fee_lamports).toFixed(5)} SOL`} />
              <Row k="Network, priority and tip" v={`${sol(q.priority_fee_lamports + q.tip_lamports + q.network_fee_lamports).toFixed(5)} SOL`} />
              <Row k="All costs" v={`${sol(costs).toFixed(5)} SOL`} />
              <Row k="Route" v={q.route.join(" › ") || "—"} />
            </>
          ) : qErr ? (
            <span className="font-sans text-negative">
              {qErr.message}
              {qErr.hint && <span className="block text-muted">{qErr.hint}</span>}
            </span>
          ) : null}
        </dl>
      )}
      {side === "buy" && value > maxSol && <p className="mt-2 text-xs text-warning">At most {maxSol} SOL per trade</p>}

      {result && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${result.ok ? "border-positive/30 text-positive" : "border-negative/30 text-negative"}`}>
          {result.ok ? `Confirmed${result.ms ? ` in ${(result.ms / 1000).toFixed(1)}s` : ""}` : result.err?.message}
          {!result.ok && result.err?.hint && <span className="mt-0.5 block text-muted">{result.err.hint}</span>}
          {result.ok && result.route && <span className="mt-0.5 block text-text-2">{result.route}</span>}
          {result.sig && (
            <a href={solscan(result.sig)} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-text-2 hover:text-text">
              View on Solscan <ExternalLink size={12} strokeWidth={1.5} />
            </a>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={!valid || !!stage || (side === "buy" && value > maxSol)}
        onClick={() => {
          if (side === "buy" && t.confirm_above_sol > 0 && value >= t.confirm_above_sol && !confirming) {
            setConfirming(true);
            setTimeout(() => setConfirming(false), 5_000);
            return;
          }
          setConfirming(false);
          submit();
        }}
        className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${side === "buy" ? "bg-[#2ebd85] text-bg" : "bg-[#f6465d] text-text"}`}
      >
        {stage && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
        {stage ? STAGE[stage] : confirming ? `Confirm buy of ${value} SOL` : `${side === "buy" ? "Buy" : "Sell"} ${symbol || "token"}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-muted">Real SOL from your wallet. You approve every trade in Phantom</p>
    </>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 font-sans text-muted">{k}</dt>
      <dd className={`truncate text-right ${warn ? "text-warning" : "text-text-2"}`}>{v}</dd>
    </div>
  );
}
