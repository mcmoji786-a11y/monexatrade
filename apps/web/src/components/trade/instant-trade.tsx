"use client";
/* Instant trading on a coin's page: one click buys a preset amount or sells a share of the
   position at once, with no ticket to fill. The amounts are the same presets as the Trade
   tab (Settings), editable right here with the pencil. Same path as every other trade
   (lib/execute.ts), with the same danger check before a buy. */
import { useState } from "react";
import { Check, Loader2, Pencil, Zap } from "lucide-react";
import { confirmDanger } from "@/components/safety/danger-confirm";
import { execute, tradeErrorText, useVenue } from "@/lib/execute";
import { updateSettings, useSettings } from "@/lib/settings";
import { pushToast } from "@/lib/toast";
import { useDemo } from "@/lib/demo";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 });

export function InstantTrade({ mint, symbol }: { mint: string; symbol: string }) {
  const { venue, why } = useVenue();
  const { settings } = useSettings();
  const { solUsd } = useRadarFeed();
  const { mode, account } = useDemo();
  const demo = venue !== "real";
  const buys = demo ? settings.demo.buy_presets_usd : settings.trading.buy_presets;
  const sells = settings.trading.sell_presets;
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ buys: string[]; sells: string[] }>({ buys: [], sells: [] });
  const held = mode === "demo" ? account?.positions.find((p) => p.mint === mint) : undefined;
  const holdingUsd = held?.value_usd ?? null;

  const run = async (key: string, side: "buy" | "sell", value: number) => {
    if (busy) return;
    if (!venue) {
      pushToast({ tone: "info", title: "Instant trade", body: why ?? "Not available" });
      return;
    }
    if (side === "buy" && !(await confirmDanger(mint, symbol))) return;
    setBusy(key);
    try {
      const f = await execute(venue, {
        mint,
        symbol,
        side,
        ...(side === "buy" ? (venue === "demo" ? { usd: value } : { sol: value }) : { fraction: value / 100 }),
        solUsd,
        source: "quick",
      });
      const amount = f.usd != null ? money(f.usd) : `${f.sol.toFixed(3)} SOL`;
      pushToast({
        kind: "trade",
        tone: "good",
        title: `${side === "buy" ? "Bought" : "Sold"} ${f.symbol || symbol} · ${venue}`,
        body: `${amount}${f.feeUsd != null ? ` · fee ${money(f.feeUsd)}` : ""}${f.realizedUsd != null ? ` · P&L ${f.realizedUsd >= 0 ? "+" : "−"}${money(Math.abs(f.realizedUsd))}` : ""}`,
      });
    } catch (e) {
      pushToast({ tone: "bad", title: `${side === "buy" ? "Buy" : "Sell"} failed: ${symbol || "coin"}`, body: tradeErrorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const startEdit = () => {
    setDraft({ buys: buys.map(String), sells: sells.map(String) });
    setEditing(true);
  };
  const saveEdit = () => {
    const nums = (xs: string[], max: number) => xs.map(Number).filter((x) => Number.isFinite(x) && x > 0 && x <= max).slice(0, 5);
    const b = nums(draft.buys, demo ? 100_000 : 3);
    const s = nums(draft.sells, 100);
    updateSettings((cur) =>
      demo
        ? { ...cur, demo: { ...cur.demo, buy_presets_usd: b.length ? b : cur.demo.buy_presets_usd }, trading: { ...cur.trading, sell_presets: s.length ? s : cur.trading.sell_presets } }
        : { ...cur, trading: { ...cur.trading, buy_presets: b.length ? b : cur.trading.buy_presets, sell_presets: s.length ? s : cur.trading.sell_presets } },
    );
    setEditing(false);
  };

  const cell = "flex h-10 items-center justify-center gap-1 rounded-lg font-mono text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const field = "h-10 w-full rounded-lg border border-border bg-bg px-2 text-center font-mono text-[13px] text-text outline-none focus:border-emerald/50";

  return (
    <section className="border-b border-border p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className={demo ? "text-warning" : "text-text-2"}>{demo ? "Demo account" : "Kixo wallet"} · one click, no ticket</span>
        {editing ? (
          <button type="button" onClick={saveEdit} className="flex h-6 items-center gap-1 rounded-md bg-emerald/15 px-2 text-emerald hover:bg-emerald/25">
            <Check size={12} strokeWidth={1.5} /> Save
          </button>
        ) : (
          <button type="button" onClick={startEdit} title="Change the amounts" className="flex h-6 items-center gap-1 rounded-md px-1.5 text-muted hover:bg-surface-2 hover:text-text">
            <Pencil size={12} strokeWidth={1.5} /> Edit
          </button>
        )}
      </div>

      <p className="mt-2.5 text-[11px] text-muted">Buy {demo ? "(USD)" : "(SOL)"}</p>
      <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {editing
          ? draft.buys.map((v, i) => (
              <input key={i} inputMode="decimal" value={v} aria-label={`Buy amount ${i + 1}`} onChange={(e) => setDraft((d) => ({ ...d, buys: d.buys.map((x, j) => (j === i ? e.target.value.replace(/[^0-9.]/g, "") : x)) }))} className={field} />
            ))
          : buys.slice(0, 4).map((v) => {
              const key = `b${v}`;
              return (
                <button key={key} type="button" disabled={!!busy} onClick={() => run(key, "buy", v)} className={`${cell} bg-positive/15 text-positive ring-1 ring-positive/30 hover:bg-positive/25`}>
                  {busy === key ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <Zap size={12} strokeWidth={1.5} />}
                  {demo ? `$${v}` : v}
                </button>
              );
            })}
      </div>

      <p className="mt-3 flex items-baseline justify-between text-[11px] text-muted">
        Sell (% of your position)
        {holdingUsd != null && <span className="font-mono text-text-2">holding {money(holdingUsd)}</span>}
      </p>
      <div className="mt-1 grid grid-cols-4 gap-1.5">
        {editing
          ? draft.sells.map((v, i) => (
              <input key={i} inputMode="decimal" value={v} aria-label={`Sell share ${i + 1}`} onChange={(e) => setDraft((d) => ({ ...d, sells: d.sells.map((x, j) => (j === i ? e.target.value.replace(/[^0-9.]/g, "") : x)) }))} className={field} />
            ))
          : sells.slice(0, 4).map((v) => {
              const key = `s${v}`;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!!busy || (mode === "demo" && !held)}
                  title={mode === "demo" && !held ? "You hold none of this coin" : undefined}
                  onClick={() => run(key, "sell", v)}
                  className={`${cell} bg-negative/15 text-negative ring-1 ring-negative/30 hover:bg-negative/25`}
                >
                  {busy === key ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : null}
                  {v}%
                </button>
              );
            })}
      </div>
      <p className="mt-2.5 text-center text-[10px] leading-4 text-muted">
        {venue ? "Fills at once at the live price, with the same fees and price impact as the Trade tab" : why}
      </p>
    </section>
  );
}
