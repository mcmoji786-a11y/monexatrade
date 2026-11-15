"use client";
/* Perps (demo): pick a market, go long or short with leverage, and watch the position
   with live profit and its liquidation price. Hyperliquid's live prices, demo balance,
   real fees and funding (gateway perps.rs). */
import { useEffect, useMemo, useState } from "react";
import { Search, TriangleAlert } from "lucide-react";
import { useAccount, openLogin } from "@/lib/account";
import { refreshDemo, useDemo } from "@/lib/demo";
import { pushToast } from "@/lib/toast";
import { closePerp, compact, getMarkets, getPositions, liqPrice, openPerp, px, usdc, type PerpClosed, type PerpMarket, type PerpOpen } from "@/lib/perps";

const MARGINS = [10, 50, 100, 500];

export function PerpsBoard() {
  const auth = useAccount();
  const signedIn = auth.status === "signed-in";
  const [markets, setMarkets] = useState<PerpMarket[] | null>(null);
  const [fee, setFee] = useState(0.00045);
  const [err, setErr] = useState<string | null>(null);
  const [coin, setCoin] = useState("SOL");
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ open: PerpOpen[]; closed: PerpClosed[] } | null>(null);
  // Trading needs the database update (migration 0013); prices work without it.
  const [notReady, setNotReady] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const m = await getMarkets();
        if (!stop) {
          setMarkets(m.markets);
          setFee(m.taker_fee);
          setErr(null);
        }
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : "Could not load");
      }
      if (signedIn) {
        try {
          const p = await getPositions();
          if (!stop) {
            setPos(p);
            setNotReady(false);
          }
        } catch (e) {
          if (!stop && e instanceof Error && /not set up/i.test(e.message)) setNotReady(true);
        }
      }
    };
    void load();
    const id = setInterval(load, 3_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [signedIn]);

  const m = markets?.find((x) => x.coin === coin) ?? markets?.[0] ?? null;
  const list = useMemo(() => (markets ?? []).filter((x) => !q || x.coin.toLowerCase().includes(q.toLowerCase())), [markets, q]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text">Perps</h1>
            <span className="rounded-md border border-warning/30 px-2 py-0.5 text-xs text-warning">Demo</span>
          </div>
          <p className="mt-1 text-sm text-text-2">Long or short on Solana coins with leverage, live Hyperliquid prices, your demo balance, real fees and funding</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        {/* Markets */}
        <section className="flex max-h-[560px] min-w-0 flex-col rounded-xl border border-border bg-surface">
          <label className="flex h-11 items-center gap-2 border-b border-border px-3">
            <Search size={14} strokeWidth={1.5} className="text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets" aria-label="Search markets" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted" />
          </label>
          {!markets ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{err ?? "Loading prices"}</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.map((x) => (
                <li key={x.coin}>
                  <button
                    type="button"
                    onClick={() => setCoin(x.coin)}
                    aria-pressed={m?.coin === x.coin}
                    className={`flex h-10 w-full items-center gap-2 px-3 text-left text-sm transition-colors ${m?.coin === x.coin ? "bg-surface-3" : "hover:bg-surface-2"}`}
                  >
                    <span className="w-16 truncate text-text">{x.coin}</span>
                    <span className="flex-1 text-right font-mono text-xs text-text-2">{px(x.mark)}</span>
                    <span className={`w-16 text-right font-mono text-xs ${x.change_24h_pct >= 0 ? "text-positive" : "text-negative"}`}>
                      {x.change_24h_pct >= 0 ? "+" : ""}
                      {x.change_24h_pct.toFixed(2)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The market */}
        <section className="min-w-0 rounded-xl border border-border bg-surface">
          {m ? <MarketHead m={m} /> : <p className="px-5 py-10 text-sm text-muted">Loading</p>}
          <Positions pos={pos} signedIn={signedIn} notReady={notReady} />
        </section>

        {/* The ticket */}
        {m && <Ticket m={m} fee={fee} signedIn={signedIn} notReady={notReady} />}
      </div>
    </section>
  );
}

function MarketHead({ m }: { m: PerpMarket }) {
  const yearly = m.funding_hourly * 24 * 365 * 100;
  return (
    <div className="border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg text-text">{m.coin}-USD</h2>
        <span className="font-mono text-2xl text-text">{px(m.mark)}</span>
        <span className={`font-mono text-sm ${m.change_24h_pct >= 0 ? "text-positive" : "text-negative"}`}>
          {m.change_24h_pct >= 0 ? "+" : ""}
          {m.change_24h_pct.toFixed(2)}% 24h
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Fact k="Funding / hour" v={`${(m.funding_hourly * 100).toFixed(4)}%`} hint={`${yearly >= 0 ? "Longs pay shorts" : "Shorts pay longs"}, about ${Math.abs(yearly).toFixed(1)}% a year`} tone={m.funding_hourly >= 0 ? "text-text" : "text-positive"} />
        <Fact k="Volume 24h" v={compact(m.volume_24h)} />
        <Fact k="Open interest" v={compact(m.open_interest_usd)} />
        <Fact k="Max leverage" v={`${m.max_leverage}x`} />
      </dl>
    </div>
  );
}

function Fact({ k, v, hint, tone = "text-text" }: { k: string; v: string; hint?: string; tone?: string }) {
  return (
    <div title={hint}>
      <dt className="text-muted">{k}</dt>
      <dd className={`mt-0.5 font-mono text-sm ${tone}`}>{v}</dd>
    </div>
  );
}

function Ticket({ m, fee, signedIn, notReady }: { m: PerpMarket; fee: number; signedIn: boolean; notReady: boolean }) {
  const { account } = useDemo();
  const [side, setSide] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("50");
  const [lev, setLev] = useState(5);
  const [busy, setBusy] = useState(false);
  const levOk = Math.min(lev, m.max_leverage);
  const mg = Number(margin);
  const notional = mg > 0 ? mg * levOk : 0;
  const liq = liqPrice(side, m.mark, levOk, m.max_leverage);
  const cost = notional * fee;
  const cash = account?.cash_usd ?? null;
  const tooMuch = cash != null && mg + cost > cash;

  const submit = async () => {
    if (!signedIn) return openLogin("/perps");
    setBusy(true);
    try {
      const r = await openPerp({ coin: m.coin, side, margin_usd: mg, leverage: levOk });
      pushToast({ kind: "trade", tone: "good", title: `${side === "long" ? "Long" : "Short"} ${m.coin} ${levOk}x opened · demo`, body: `Entry ${px(r.entry_px)} · liquidation ${px(r.liq_px)}` });
      refreshDemo();
    } catch (e) {
      pushToast({ tone: "bad", title: "Could not open", body: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
        {(["long", "short"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={`h-9 rounded-md text-sm capitalize transition-colors ${side === s ? (s === "long" ? "bg-[#2ebd85] font-medium text-bg" : "bg-[#f6465d] font-medium text-text") : "text-text-2 hover:text-text"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-2">Margin</span>
          <span className="font-mono text-muted">{cash != null ? `${usdc(cash)} demo` : ""}</span>
        </div>
        <label className="mt-1.5 flex h-10 items-center rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <span className="text-muted">$</span>
          <input value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-label="Margin in dollars" className="min-w-0 flex-1 bg-transparent px-1 font-mono text-sm text-text outline-none" />
        </label>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {MARGINS.map((a) => (
            <button key={a} type="button" onClick={() => setMargin(String(a))} className="h-8 rounded-md border border-border font-mono text-xs text-text-2 hover:bg-surface-2">
              ${a}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-2">Leverage</span>
          <span className={`font-mono text-sm ${levOk > 10 ? "text-warning" : "text-text"}`}>{levOk}x</span>
        </div>
        <input type="range" min={1} max={m.max_leverage} step={1} value={levOk} onChange={(e) => setLev(Number(e.target.value))} aria-label="Leverage" className="mt-2 w-full accent-emerald-500" />
        <div className="flex justify-between font-mono text-[10px] text-muted">
          <span>1x</span>
          <span>{m.max_leverage}x</span>
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg px-3 py-2.5 text-xs">
        <Row k="Position size" v={`${usdc(notional)} · ${notional > 0 ? (notional / m.mark).toPrecision(4) : "0"} ${m.coin}`} />
        <Row k="Entry (now)" v={px(m.mark)} />
        <Row k="Liquidation" v={px(liq)} tone="text-negative" />
        <Row k="Fee" v={usdc(cost)} />
        <Row k="A 1% move" v={`${usdc(notional / 100)} (${levOk}% of margin)`} />
      </dl>

      {levOk > 10 && (
        <p className="flex gap-2 text-xs text-warning">
          <TriangleAlert size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
          At {levOk}x, a {((1 / levOk) * 100).toFixed(1)}% move against you loses the whole margin
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !(mg >= 1) || tooMuch || notReady}
        className={`h-11 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50 ${side === "long" ? "bg-[#2ebd85] text-bg" : "bg-[#f6465d] text-text"}`}
      >
        {!signedIn ? "Sign in to trade" : notReady ? "Trading opens soon" : tooMuch ? "Not enough demo balance" : `${side === "long" ? "Long" : "Short"} ${m.coin} ${levOk}x`}
      </button>
      <p className="text-[11px] leading-5 text-muted">Demo: virtual money, live Hyperliquid prices, Hyperliquid&apos;s 0.045% fee each way, funding while open. Real perps come later</p>
    </section>
  );
}

function Row({ k, v, tone = "text-text" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={`font-mono ${tone}`}>{v}</dd>
    </div>
  );
}

function Positions({ pos, signedIn, notReady }: { pos: { open: PerpOpen[]; closed: PerpClosed[] } | null; signedIn: boolean; notReady: boolean }) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [closing, setClosing] = useState<number | null>(null);
  const close = async (p: PerpOpen) => {
    setClosing(p.id);
    try {
      const r = await closePerp(p.id);
      pushToast({ kind: "trade", tone: r.pnl_usd >= 0 ? "good" : "bad", title: `Closed ${p.coin} ${p.side} · demo`, figure: usdc(r.pnl_usd, true), body: `Exit ${px(r.exit_px)}, after fees and funding` });
      refreshDemo();
    } catch (e) {
      pushToast({ tone: "bad", title: "Could not close", body: e instanceof Error ? e.message : "" });
    } finally {
      setClosing(null);
    }
  };
  return (
    <div>
      <div className="flex gap-1 border-b border-border px-3">
        {(
          [
            ["open", `Positions ${pos?.open.length ?? 0}`],
            ["closed", "History"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px h-10 border-b-2 px-2 text-sm ${tab === k ? "border-emerald text-text" : "border-transparent text-text-2 hover:text-text"}`}>
            {label}
          </button>
        ))}
      </div>
      {notReady ? (
        <p className="px-5 py-8 text-center text-sm text-muted">Trading opens soon. Prices are live</p>
      ) : !signedIn ? (
        <p className="px-5 py-8 text-center text-sm text-muted">Sign in to see your positions</p>
      ) : !pos ? (
        <p className="px-5 py-8 text-center text-sm text-muted">Loading</p>
      ) : tab === "open" ? (
        pos.open.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No open positions</p>
        ) : (
          <ul className="divide-y divide-border">
            {pos.open.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="w-28 text-text">
                  {p.coin} <span className={p.side === "long" ? "text-positive" : "text-negative"}>{p.side}</span>
                  <span className="ml-1 font-mono text-xs text-muted">{p.leverage}x</span>
                </span>
                <span className="font-mono text-xs text-text-2">
                  {usdc(p.margin_usd * p.leverage)} · entry {px(p.entry_px)} · now {px(p.mark)} · <span className="text-negative">liq {px(p.liq_px)}</span>
                </span>
                <span className={`ml-auto font-mono ${p.pnl_usd >= 0 ? "text-positive" : "text-negative"}`} title={`After fees and funding: ${usdc(p.pnl_after_costs_usd, true)}`}>
                  {usdc(p.pnl_usd, true)} <span className="text-xs">({p.roe_pct >= 0 ? "+" : ""}{p.roe_pct.toFixed(1)}%)</span>
                </span>
                <button type="button" disabled={closing === p.id} onClick={() => close(p)} className="h-8 rounded-lg border border-border px-3 text-xs text-text hover:bg-surface-2 disabled:opacity-50">
                  Close
                </button>
              </li>
            ))}
          </ul>
        )
      ) : pos.closed.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">No closed positions yet</p>
      ) : (
        <ul className="divide-y divide-border">
          {pos.closed.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="w-28 text-text">
                {p.coin} <span className={p.side === "long" ? "text-positive" : "text-negative"}>{p.side}</span>
                <span className="ml-1 font-mono text-xs text-muted">{p.leverage}x</span>
              </span>
              <span className="font-mono text-xs text-text-2">
                {px(p.entry_px)} → {px(p.exit_px)} · fees {usdc(p.fees_usd)}
                {p.status === "liquidated" && <span className="ml-1 text-negative">liquidated</span>}
              </span>
              <span className={`ml-auto font-mono ${p.pnl_usd >= 0 ? "text-positive" : "text-negative"}`}>{usdc(p.pnl_usd, true)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
