"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { orderError, refreshDemo, useDemo } from "@/lib/demo";
import { cancelRule } from "@/lib/growth";
import { useFeatures } from "@/lib/features";
import { useVenue } from "@/lib/execute";
import { kixoAddress, useKixoWallet } from "@/lib/kixo-wallet";
import { usePortfolio } from "@/lib/portfolio";
import { pushToast } from "@/lib/toast";
import { addRealOrder, cancelRealOrder, checkOrder, fetchPrices, ORDER_TEXT, placeDemoOrder, useRealOrders, type OrderKind } from "@/lib/orders";
import { tinyPrice } from "./trade-panel";

const KINDS: OrderKind[] = ["limit_buy", "limit_sell", "sl", "trail"];
/** Quick price levels, % from the current price. */
const LEVELS: Record<OrderKind, number[]> = { limit_buy: [-10, -25, -50], limit_sell: [25, 50, 100], sl: [-10, -20, -35], trail: [10, 20, 30] };
const SELL_SHARES = [25, 50, 100];

/** The price the order engines fire on (gateway /price), refreshed every 3 seconds. */
function useOrderPrice(mint: string) {
  const [p, setP] = useState<{ mint: string; price: number | null } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetchPrices([mint]).then((v) => live && setP({ mint, price: v[mint] ?? null })).catch(() => {});
    load();
    const t = setInterval(load, 3_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [mint]);
  return p?.mint === mint ? p.price : null;
}

/** Orders on this coin: limit buy, limit sell, stop loss and trailing stop. The same card
 *  on demo (watched by the gateway around the clock) and real (watched in this browser
 *  while Kixo is open, signed with the unlocked Kixo wallet). */
export function OrdersCard({ mint, symbol }: { mint: string; symbol: string }) {
  const on = useFeatures().demo_orders;
  const { venue, why } = useVenue();
  const { account, rules } = useDemo();
  const wallet = useKixoWallet();
  const real = useRealOrders();
  const realWallet = venue === "real" ? kixoAddress() : null;
  const port = usePortfolio(realWallet);
  const price = useOrderPrice(mint);
  const [kind, setKind] = useState<OrderKind>("limit_sell");
  const [level, setLevel] = useState("");
  const [amount, setAmount] = useState("");
  const [share, setShare] = useState(100);
  const [busy, setBusy] = useState(false);
  if (!on) return null;

  const demo = venue === "demo";
  const holds = demo ? !!account?.positions.some((p) => p.mint === mint && p.tokens > 0) : !!port.data?.tokens.some((t) => t.mint === mint && t.amount > 0);
  const trail = kind === "trail";
  const pct = Number(level);
  // Limit and stop prices come from a % of the current price; trailing stops are a %.
  const signed = kind === "limit_buy" || kind === "sl" ? -Math.abs(pct) : Math.abs(pct);
  const target = !trail && price && level !== "" ? price * (1 + signed / 100) : undefined;
  const input = { mint, symbol, kind, priceUsd: target, fraction: share / 100, amount: Number(amount) || undefined, trailPct: trail ? Math.abs(pct) : undefined };
  const err = level === "" ? null : checkOrder(input, price, holds);
  const ready = venue != null && level !== "" && !err && (kind !== "limit_buy" || Number(amount) > 0);

  const open = demo
    ? rules.filter((r) => r.mint === mint && r.status === "open").map((r) => ({ id: String(r.id), kind: (r.kind === "tp" ? "limit_sell" : r.kind) as OrderKind, trigger: Number(r.trigger_price_usd), size: r.kind === "limit_buy" ? `$${Number(r.usd ?? 0)}` : `${Math.round(Number(r.fraction) * 100)}%`, trailPct: r.trail_pct ?? null, filling: false }))
    : real.filter((o) => o.mint === mint && (o.status === "open" || o.status === "filling")).map((o) => ({ id: o.id, kind: o.kind, trigger: o.trigger, size: o.kind === "limit_buy" ? `${o.sol} SOL` : `${Math.round((o.fraction ?? 1) * 100)}%`, trailPct: o.trailPct ?? null, filling: o.status === "filling" }));

  async function place() {
    setBusy(true);
    try {
      if (demo) {
        await placeDemoOrder(input);
      } else {
        const e = addRealOrder(input, price, holds);
        if (e) throw new Error(e);
      }
      pushToast({ tone: "good", title: `${ORDER_TEXT[kind].label} placed · ${venue}`, body: trail ? `Sells if the price falls ${Math.abs(pct)}% from its high` : `Fires at ${tinyPrice(target!)}` });
      setLevel("");
    } catch (e) {
      pushToast({ tone: "bad", title: "Order not placed", body: orderError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (!demo) return cancelRealOrder(id);
    try {
      await cancelRule(Number(id));
      await refreshDemo();
    } catch (e) {
      pushToast({ tone: "bad", title: "Could not cancel", body: orderError(e) });
    }
  }

  return (
    <section className="border-b border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Orders</h2>
        <span className="font-mono text-[11px] text-muted">{price ? `Now ${tinyPrice(price)}` : "Pricing…"}</span>
      </div>

      {open.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {open.map((o) => {
            const away = price ? (o.trigger / price - 1) * 100 : null;
            return (
              <li key={o.id} className="grid h-9 grid-cols-[1fr_auto_auto_24px] items-center gap-2 rounded-lg border border-border px-3 text-xs">
                <span className={`truncate ${ORDER_TEXT[o.kind].tone === "good" ? "text-positive" : "text-negative"}`}>
                  {ORDER_TEXT[o.kind].label}
                  <span className="ml-1.5 text-muted">{o.size}</span>
                </span>
                <span className="font-mono text-text-2">{o.kind === "trail" && o.trailPct ? `−${o.trailPct}% · ${tinyPrice(o.trigger)}` : tinyPrice(o.trigger)}</span>
                <span className="w-16 text-right font-mono text-muted">{o.filling ? "Filling" : away != null ? `${away >= 0 ? "+" : "−"}${Math.abs(away).toFixed(1)}%` : ""}</span>
                <button type="button" onClick={() => cancel(o.id)} disabled={o.filling} aria-label="Cancel order" className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-text disabled:opacity-40">
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div role="group" aria-label="Order type" className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-bg p-1">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => (setKind(k), setLevel(""))}
            className={`h-8 rounded-md text-[11px] transition-colors ${kind === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
          >
            {ORDER_TEXT[k].label.replace("Trailing stop", "Trailing")}
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto] gap-1">
        <div className="grid grid-cols-3 gap-1">
          {LEVELS[kind].map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={pct === Math.abs(p) && level !== ""}
              onClick={() => setLevel(String(Math.abs(p)))}
              className={`h-8 rounded-md border font-mono text-xs transition-colors hover:bg-surface-3 ${pct === Math.abs(p) && level !== "" ? "border-text/30 text-text" : "border-border"} ${trail || p < 0 ? "text-negative" : "text-positive"}`}
            >
              {trail ? `−${p}%` : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`}
            </button>
          ))}
        </div>
        <label className="flex h-8 w-24 items-center gap-1 rounded-md border border-border bg-bg px-2 focus-within:border-emerald/50">
          <span className="font-mono text-xs text-muted">{kind === "limit_sell" ? "+" : "−"}</span>
          <input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="%" aria-label="Percent from the current price" className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text outline-none placeholder:text-muted" />
        </label>
      </div>

      {kind === "limit_buy" ? (
        <label className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <span className="text-xs text-muted">Spend</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="min-w-0 flex-1 bg-transparent text-right font-mono text-xs text-text outline-none placeholder:text-muted" />
          <span className="font-mono text-xs text-text-2">{demo ? "USD" : "SOL"}</span>
        </label>
      ) : (
        <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2">
          <span className="text-xs text-muted">Sell</span>
          <div className="grid grid-cols-3 gap-1">
            {SELL_SHARES.map((s) => (
              <button key={s} type="button" aria-pressed={share === s} onClick={() => setShare(s)} className={`h-8 rounded-md border font-mono text-xs transition-colors ${share === s ? "border-text/30 text-text" : "border-border text-text-2 hover:bg-surface-3"}`}>
                {s}%
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!ready || busy}
        onClick={place}
        className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-text text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
        Place {ORDER_TEXT[kind].label.toLowerCase()}
      </button>

      <p className={`mt-2 text-[11px] leading-4 ${err ? "text-negative" : "text-muted"}`}>
        {!venue
          ? why
          : err
            ? err
            : trail
              ? level
                ? `Follows the price up and sells ${share}% if it falls ${Math.abs(pct)}% from its high`
                : "Follows the price up and sells when it falls back by your %"
              : target
                ? `${kind === "limit_buy" ? "Buys" : `Sells ${share}%`} when the price reaches ${tinyPrice(target)}`
                : "Pick a level from the current price"}
        {venue === "real" && !err && <span className="block text-warning">Real orders run while Kixo is open in this browser{wallet.status !== "unlocked" ? " with the wallet unlocked" : ""}</span>}
      </p>
    </section>
  );
}
