"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { execute, tradeErrorText, useVenue } from "@/lib/execute";
import { useFeatures } from "@/lib/features";
import { addGrid, checkGrid, gridTokens, levels, removeGrid, stepPct, updateGrid, useGrids, type Grid } from "@/lib/grid";
import { fetchPrices } from "@/lib/orders";
import { usePlatform } from "@/lib/platform";
import { useDemo } from "@/lib/demo";
import { pushToast } from "@/lib/toast";
import { useRadarFeed } from "@/components/radar/use-radar-feed";
import { tinyPrice } from "./trade-panel";

const RANGES = [15, 30, 50];
const COUNTS = [5, 8, 12];

function useGridPrice(mint: string) {
  const [p, setP] = useState<{ mint: string; price: number | null } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetchPrices([mint]).then((v) => live && setP({ mint, price: v[mint] ?? null })).catch(() => {});
    load();
    const t = setInterval(load, 5_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [mint]);
  return p?.mint === mint ? p.price : null;
}

const unitText = (g: Pick<Grid, "venue">, v: number) => (g.venue === "demo" ? `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}` : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(4)} SOL`);

/** Grid trading on this coin: buy each dip to a level, sell at the next one up. Runs in
 *  this browser while Kixo is open, on demo and real alike. */
export function GridCard({ mint, symbol }: { mint: string; symbol: string }) {
  const on = useFeatures().grid_trading;
  const { venue, why } = useVenue();
  const platform = usePlatform();
  const grids = useGrids();
  const price = useGridPrice(mint);
  const [range, setRange] = useState(30);
  const [count, setCount] = useState(8);
  const [amount, setAmount] = useState("");
  if (!on) return null;

  const demo = venue !== "real";
  const mine = grids.filter((g) => g.mint === mint);
  const lower = price ? price * (1 - range / 100) : 0;
  const upper = price ? price * (1 + range / 100) : 0;
  const roundTrip = (platform.trade_fee_bps * 2) / 100 + 0.5;
  const amt = Number(amount);
  const err = price ? checkGrid({ lower, upper, count, amount: amt || 1 }, price, roundTrip) : null;
  const step = price ? stepPct(lower, upper, count) : 0;
  const armed = price ? levels(lower, upper, count).slice(0, -1).filter((p) => p < price).length : 0;

  function start() {
    if (!venue || !price) return;
    const e = checkGrid({ lower, upper, count, amount: amt }, price, roundTrip) ?? addGrid({ mint, symbol, venue, lower, upper, amount: amt }, count, price);
    if (e) return pushToast({ tone: "bad", title: "Grid not started", body: e });
    pushToast({ tone: "good", title: `Grid started on ${symbol || "coin"} · ${venue}`, body: `${count} levels from ${tinyPrice(lower)} to ${tinyPrice(upper)}` });
    setAmount("");
  }

  return (
    <section className="border-b border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Grid</h2>
        <span className="text-[11px] text-muted">Buys dips, sells rises in a range</span>
      </div>

      {mine.map((g) => (
        <RunningGrid key={g.id} g={g} price={price} />
      ))}

      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-muted">Range</span>
        <div className="grid grid-cols-3 gap-1">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={`h-8 rounded-md border font-mono transition-colors ${range === r ? "border-text/30 text-text" : "border-border text-text-2 hover:bg-surface-3"}`}>
              ±{r}%
            </button>
          ))}
        </div>
        <span className="text-muted">Levels</span>
        <div className="grid grid-cols-3 gap-1">
          {COUNTS.map((n) => (
            <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)} className={`h-8 rounded-md border font-mono transition-colors ${count === n ? "border-text/30 text-text" : "border-border text-text-2 hover:bg-surface-3"}`}>
              {n}
            </button>
          ))}
        </div>
        <span className="text-muted">Per level</span>
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-2 focus-within:border-emerald/50">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" aria-label="Amount per level" className="min-w-0 flex-1 bg-transparent text-right font-mono text-text outline-none placeholder:text-muted" />
          <span className="font-mono text-text-2">{demo ? "USD" : "SOL"}</span>
        </label>
      </div>

      {price && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 font-mono text-[11px] tabular-nums">
          <dt className="text-muted">Range</dt>
          <dd className="text-right text-text-2">
            {tinyPrice(lower)} – {tinyPrice(upper)}
          </dd>
          <dt className="text-muted">Each swing</dt>
          <dd className={`text-right ${step > roundTrip ? "text-positive" : "text-negative"}`}>
            +{step.toFixed(1)}% − {roundTrip.toFixed(1)}% costs
          </dd>
          <dt className="text-muted">Buys below now</dt>
          <dd className="text-right text-text-2">
            {armed} × {amt > 0 ? (demo ? `$${amt}` : `${amt} SOL`) : "—"}
          </dd>
        </dl>
      )}

      <button type="button" disabled={!venue || !price || !!err || !(amt > 0)} onClick={start} className="mt-3 flex h-9 w-full items-center justify-center rounded-lg bg-text text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40">
        Start grid
      </button>
      <p className={`mt-2 text-[11px] leading-4 ${err ? "text-negative" : "text-muted"}`}>
        {!venue ? why : err ? err : "Nothing is bought now: each level below the price buys when the price falls to it, and sells one level up. Runs while Kixo is open in this browser"}
      </p>
    </section>
  );
}

function RunningGrid({ g, price }: { g: Grid; price: number | null }) {
  const { venue } = useVenue();
  const { solUsd } = useRadarFeed();
  const { account } = useDemo();
  const [closing, setClosing] = useState(false);
  const holding = g.slots.filter((s) => s.state === "sell").length;
  const tokens = gridTokens(g);
  const running = g.status === "running";

  async function stop(sell: boolean) {
    if (!sell || tokens <= 0) {
      updateGrid(g.id, { status: "stopped" });
      if (!running) removeGrid(g.id);
      return;
    }
    if (venue !== g.venue) return pushToast({ tone: "info", title: "Switch account first", body: `This grid trades on ${g.venue}` });
    setClosing(true);
    updateGrid(g.id, { status: "stopped" });
    try {
      const held = g.venue === "demo" ? (account?.positions.find((p) => p.mint === g.mint)?.tokens ?? tokens) : tokens;
      const f = await execute(g.venue, { mint: g.mint, symbol: g.symbol, side: "sell", fraction: Math.min(1, tokens / held), solUsd });
      const got = g.venue === "demo" ? (f.usd ?? 0) : f.sol;
      const cost = g.slots.reduce((t, s) => t + (s.state === "sell" ? s.cost : 0), 0);
      updateGrid(g.id, (cur) => ({ realized: cur.realized + got - cost, slots: cur.slots.map((s) => ({ ...s, state: "idle", tokens: 0, cost: 0 })) }));
      pushToast({ tone: "good", title: `Grid closed on ${g.symbol}`, body: `Sold its ${holding} held level${holding === 1 ? "" : "s"}` });
    } catch (e) {
      pushToast({ tone: "bad", title: "Could not sell the grid's tokens", body: tradeErrorText(e) });
    } finally {
      setClosing(false);
    }
  }

  const unreal = price && tokens > 0 && g.venue === "demo" ? tokens * price - g.slots.reduce((t, s) => t + (s.state === "sell" ? s.cost : 0), 0) : null;
  return (
    <div className="mt-3 rounded-lg border border-border p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${running ? (g.venue === venue ? "bg-emerald" : "bg-warning") : "bg-muted"}`} />
          <span className="text-text">{running ? (g.venue === venue ? "Running" : `Waiting for ${g.venue} mode`) : "Stopped"}</span>
          <span className="text-muted">· {g.venue} · {g.slots.length} levels</span>
        </span>
        <span className={`font-mono ${g.realized >= 0 ? "text-positive" : "text-negative"}`}>{unitText(g, g.realized)}</span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-muted">
        {tinyPrice(g.lower)} – {tinyPrice(g.upper)} · {g.buys} buys · {g.sells} sells · holding {holding}
        {unreal != null && <span className={unreal >= 0 ? " text-positive" : " text-negative"}> · open {unitText(g, unreal)}</span>}
      </p>
      {g.note && <p className="mt-1 text-[11px] text-warning">{g.note}</p>}
      <div className="mt-2 flex gap-2">
        {running ? (
          <>
            <button type="button" onClick={() => stop(false)} className="h-7 rounded-md border border-border px-2.5 text-text-2 hover:bg-surface-3 hover:text-text">
              Stop, keep tokens
            </button>
            {tokens > 0 && (
              <button type="button" onClick={() => stop(true)} disabled={closing} className="flex h-7 items-center gap-1 rounded-md border border-negative/30 px-2.5 text-negative hover:bg-negative/10 disabled:opacity-50">
                {closing && <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />}
                Stop and sell
              </button>
            )}
          </>
        ) : (
          <button type="button" onClick={() => removeGrid(g.id)} className="h-7 rounded-md border border-border px-2.5 text-text-2 hover:bg-surface-3 hover:text-text">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
