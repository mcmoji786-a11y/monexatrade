"use client";

import { openShareCard, type ShareTrade } from "@/lib/share";
import { pctOf, usePlatform } from "@/lib/platform";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  orderError,
  placeOrder,
  previewOrder,
  useDemo,
  type DemoFill,
} from "@/lib/demo";
import { useAccount } from "@/lib/account";
import { pushToast } from "@/lib/toast";
import { useSettings } from "@/lib/settings";
import { createRule } from "@/lib/growth";
import { useFeatures } from "@/lib/features";
import { RealTicket } from "./real-ticket";

const SELL_PCT = ["25", "50", "75", "100"];

/** Order ticket. Demo mode trades the virtual account at live prices; real-money
 *  trading stays off until the founder approves it after a security review. */
export function TradePanel({ symbol, mint }: { symbol: string; mint: string }) {
  const platform = usePlatform();
  const demoPresets = useSettings().settings.demo.buy_presets_usd.map(String);
  const { mode, account } = useDemo();
  const auth = useAccount();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  // The Buy and Sell bar at the bottom of the trade page on phones (token-view.tsx).
  useEffect(() => {
    const pick = (e: Event) => {
      const s = (e as CustomEvent<"buy" | "sell">).detail;
      if (s === "buy" || s === "sell") setSide(s);
    };
    window.addEventListener("kixo:trade-side", pick);
    return () => window.removeEventListener("kixo:trade-side", pick);
  }, []);
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<DemoFill | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const exitsOn = useFeatures().demo_orders;
  const demo = mode === "demo" && auth.status === "signed-in";
  const held = account?.positions.find((p) => p.mint === mint);
  const value = Number(amount);
  const valid = side === "buy" ? value >= 1 : value > 0 && value <= 100;

  // Live estimate of the fill while typing (debounced).
  useEffect(() => {
    if (!demo || !valid || (side === "sell" && !held)) return;
    let alive = true;
    const t = setTimeout(() => {
      previewOrder(
        side === "buy"
          ? { mint, side, usd: value }
          : { mint, side, fraction: value / 100 },
      )
        .then((r) => alive && (setPreview(r.fill), setPreviewErr(null)))
        .catch(
          (e) => alive && (setPreview(null), setPreviewErr(orderError(e))),
        );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [demo, valid, side, value, mint, held]);

  async function submit() {
    setBusy(true);
    // When the position was opened, for the share card's "Held" figure.
    const openedAt = held?.opened_at ?? null;
    try {
      const r = await placeOrder(
        side === "buy"
          ? { mint, side, usd: value }
          : { mint, side, fraction: value / 100 },
      );
      const f = r.fill;
      const sym = r.symbol || symbol;
      if (side === "sell") {
        // The result, big, with the share card one click away.
        const pnl = r.realized_usd ?? 0;
        const cost = f.usd - pnl;
        const pct = cost > 0 ? (pnl / cost) * 100 : 0;
        const trade: ShareTrade = {
          id: Math.round(f.tokens) + Math.round(f.usd * 100),
          mint,
          symbol: sym,
          side: "sell",
          tokens: f.tokens,
          usd: f.usd,
          sol: f.sol,
          price_usd: f.price_usd,
          fee_usd: f.fee_usd,
          impact_pct: f.impact_pct,
          source: "manual",
          realized_usd: r.realized_usd,
          round: 0,
          ts: new Date().toISOString(),
          openedAt: openedAt,
        };
        pushToast({
          kind: "trade",
          tone: pnl < 0 ? "bad" : "good",
          title: `Sold ${sym} · demo`,
          figure: `${signed(pnl)}  ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`,
          body: `Received ${money(f.usd)} at ${tinyPrice(f.price_usd)} · fee ${money(f.fee_usd)}`,
          action: { label: "View card", onClick: () => openShareCard(trade) },
        });
      } else {
        pushToast({
          kind: "trade",
          tone: "good",
          title: `Bought ${sym} · demo`,
          body: `${money(f.usd)} at ${tinyPrice(f.price_usd)} · fee ${money(f.fee_usd)}`,
        });
      }
      setAmount("");
      setPreview(null);
      // Exits typed with the buy are placed once it has filled.
      if (side === "buy" && exitsOn) {
        const exits: { kind: "tp" | "sl"; pct: number }[] = [];
        if (Number(tp) >= 1) exits.push({ kind: "tp", pct: Number(tp) });
        if (Number(sl) >= 1)
          exits.push({ kind: "sl", pct: -Math.min(95, Number(sl)) });
        for (const x of exits) {
          await createRule({ mint, ...x }).catch((e) =>
            pushToast({
              tone: "bad",
              title: "Exit not set",
              body: orderError(e),
            }),
          );
        }
        if (exits.length) {
          pushToast({
            tone: "good",
            title: "Exits set",
            body: exits
              .map(
                (x) =>
                  `${x.kind === "tp" ? "TP" : "SL"} ${x.pct > 0 ? "+" : ""}${x.pct}%`,
              )
              .join(" · "),
          });
          setTp("");
          setSl("");
        }
      }
    } catch (e) {
      pushToast({
        tone: "bad",
        title: "Order not filled",
        body: orderError(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-b border-border p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => (
              setSide(s),
              setAmount(""),
              setPreview(null),
              setPreviewErr(null)
            )}
            className={`h-9 rounded-md text-sm capitalize transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${
              side === s
                ? s === "buy"
                  ? "bg-[#2ebd85] font-medium text-bg"
                  : "bg-[#f6465d] font-medium text-text"
                : "text-text-2 hover:text-text"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {demo && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-warning">Demo account</span>
          <span data-private className="font-mono tabular-nums text-text-2">
            {side === "buy"
              ? `${account ? money(account.cash_usd) : "…"} available`
              : held
                ? `${compact(held.tokens)} ${symbol || ""} held`
                : "None held"}
          </span>
        </div>
      )}

      {!demo && <RealTicket symbol={symbol} mint={mint} side={side} />}

      {demo && (
        <>
          <label className="mt-3 flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
            <span className="text-xs text-muted">Amount</span>
            <input
              inputMode="decimal"
              value={amount}
              disabled={!demo}
              onChange={(e) =>
                setAmount(e.target.value.replace(/[^0-9.]/g, ""))
              }
              onKeyDown={(e) =>
                e.key === "Enter" && demo && valid && !busy && submit()
              }
              placeholder="0"
              className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm text-text outline-none placeholder:text-muted disabled:cursor-not-allowed"
            />
            <span className="font-mono text-xs text-text-2">
              {side === "buy" ? "USD" : "%"}
            </span>
          </label>

          <div className="mt-2 grid grid-cols-4 gap-1">
            {(side === "buy" ? demoPresets : SELL_PCT).map((p) => (
              <button
                key={p}
                type="button"
                disabled={!demo}
                onClick={() => setAmount(p)}
                className="h-8 rounded-md border border-border font-mono text-xs text-text-2 transition-colors hover:bg-surface-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                {side === "buy" ? `$${p}` : `${p}%`}
              </button>
            ))}
          </div>

          {demo && side === "buy" && exitsOn && (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <ExitInput
                label="TP"
                sign="+"
                value={tp}
                onChange={setTp}
                tone="text-positive"
              />
              <ExitInput
                label="SL"
                sign="−"
                value={sl}
                onChange={setSl}
                tone="text-negative"
              />
            </div>
          )}

          {demo && valid && (
            <dl className="mt-3 flex flex-col gap-1 rounded-lg border border-border px-3 py-2 font-mono text-xs tabular-nums">
              {preview ? (
                <>
                  <Row
                    k={side === "buy" ? "You get" : "You receive"}
                    v={
                      side === "buy"
                        ? `${compact(preview.tokens)} ${symbol || ""}`
                        : money(preview.usd)
                    }
                  />
                  <Row k="Avg price" v={tinyPrice(preview.price_usd)} />
                  <Row
                    k="Price impact"
                    v={`${preview.impact_pct.toFixed(2)}%`}
                    warn={preview.impact_pct > 10}
                  />
                  <Row k="Fees" v={money(preview.fee_usd)} />
                </>
              ) : previewErr ? (
                <span className="text-negative">{previewErr}</span>
              ) : (
                <span className="text-muted">Pricing at the live market…</span>
              )}
            </dl>
          )}

          {demo ? (
            <button
              type="button"
              disabled={
                !valid || busy || (side === "sell" && !held) || !!previewErr
              }
              onClick={submit}
              className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${side === "buy" ? "bg-[#2ebd85] text-bg" : "bg-[#f6465d] text-text"}`}
            >
              {busy && (
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
              )}
              {busy
                ? "Filling at market"
                : `${side === "buy" ? "Buy" : "Sell"} ${symbol || "token"}`}
            </button>
          ) : null}
          {demo && (
            <p className="mt-2 text-center text-[11px] text-muted">
              Live price, {pctOf(platform.trade_fee_bps)} fee each way and real price impact, exactly as real trading would cost
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Optional exit typed with a buy, in % from the entry. */
function ExitInput({
  label,
  sign,
  value,
  onChange,
  tone,
}: {
  label: string;
  sign: string;
  value: string;
  onChange: (v: string) => void;
  tone: string;
}) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg px-2 focus-within:border-emerald/50">
      <span className={`text-[11px] ${tone}`}>{label}</span>
      <span className="font-mono text-xs text-muted">{sign}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        placeholder="off"
        aria-label={
          label === "TP" ? "Take profit percent" : "Stop loss percent"
        }
        className="min-w-0 flex-1 bg-transparent text-right font-mono text-xs text-text outline-none placeholder:text-muted"
      />
      <span className="font-mono text-xs text-muted">%</span>
    </label>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className={warn ? "text-warning" : "text-text-2"}>{v}</dd>
    </div>
  );
}

export const money = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
export const signed = (v: number) =>
  `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
export function tinyPrice(v: number) {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(Math.min(20, Math.ceil(-Math.log10(v)) + 3))}`;
}
export function compact(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v >= 1 ? v.toFixed(2) : v.toPrecision(3);
}
