"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Camera,
  ChevronDown,
  Crosshair,
  Expand,
  GitCommitHorizontal,
  Magnet,
  Minus,
  MoveUpRight,
  Rows3,
  Slash,
  Trash2,
  Type,
} from "lucide-react";
import { dispose, init, registerYAxis, type Chart, type KLineData } from "klinecharts";
import { price, usd, type Candle } from "@/lib/gateway";
import type { BookState } from "./use-token-book";

const INTERVALS = [
  { label: "5s", secs: 5 },
  { label: "15s", secs: 15 },
  { label: "1m", secs: 60 },
  { label: "5m", secs: 300 },
  { label: "15m", secs: 900 },
  { label: "1h", secs: 3600 },
];

const MAIN_INDICATORS = ["MA", "EMA", "BOLL"] as const;
const SUB_INDICATORS = ["VOL", "MACD", "RSI"] as const;

const TOOLS = [
  { name: null, label: "Crosshair", icon: Crosshair },
  { name: "segment", label: "Trend line", icon: Slash },
  { name: "rayLine", label: "Ray", icon: MoveUpRight },
  { name: "horizontalStraightLine", label: "Horizontal line", icon: Minus },
  { name: "priceLine", label: "Price line", icon: GitCommitHorizontal },
  { name: "priceChannelLine", label: "Channel", icon: Rows3 },
  { name: "fibonacciLine", label: "Fibonacci", icon: ArrowUpRight },
  { name: "simpleAnnotation", label: "Note", icon: Type },
] as const;

/** Marker letters: D dev, W whale, E early buyer, then B buy or S sell. */
const MARKS = {
  dev: { letter: "D", color: "#e0a63e" },
  whale: { letter: "W", color: "#67e8f9" },
  sniper: { letter: "E", color: "#e5484d" },
};

type Mode = "mc" | "price";
type Unit = "usd" | "sol";

/** Fallback for tokens outside our decoder: one sample per second from the live feed,
 *  kept for the browser session. */
const SAMPLES = new Map<string, Candle[]>();

/** The y-axis reads the current formatter from here, so labels read $3.89K, not 3890.00. */
let axisFormat: (x: number) => string = usd;
let axisRegistered = false;
/** Four significant digits, for a tightly zoomed axis. */
function fine(x: number) {
  const a = Math.abs(x);
  const [d, suffix] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  const body = (x / d).toPrecision(4);
  return axisFormat(1).includes("SOL") ? body + suffix + " SOL" : "$" + body + suffix;
}
function ensureAxis() {
  if (axisRegistered) return;
  axisRegistered = true;
  registerYAxis({
    name: "mx",
    createTicks: ({ defaultTicks }) => {
      // Neighbouring ticks must read differently: add digits until they do
      // ($2.85K and $2.90K instead of $2.8K twice).
      const texts = defaultTicks.map((t) => axisFormat(Number(t.value)));
      const clash = texts.some((x, i) => i > 0 && x === texts[i - 1]);
      return defaultTicks.map((t, i) => ({ ...t, text: clash ? fine(Number(t.value)) : texts[i] }));
    },
  });
}

function aggregate(base: Candle[], secs: number): Candle[] {
  const out: Candle[] = [];
  for (const c of base) {
    const t = c.t - (c.t % secs);
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else out.push({ ...c, t });
  }
  return out;
}

/** Decimals the crosshair label needs to show a few significant digits. */
function precisionFor(v: number) {
  if (!v || !Number.isFinite(v)) return 2;
  return Math.min(14, Math.max(2, Math.ceil(-Math.log10(Math.abs(v))) + 3));
}

export function PriceChart({
  symbol,
  mint,
  book,
  solUsd,
  mcUsd,
  supply,
}: {
  symbol: string;
  mint: string;
  book: BookState;
  solUsd: number | null;
  mcUsd: number | null;
  /** Token supply, to turn market cap into price. */
  supply: number | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const drawn = useRef<{ key: string; len: number }>({ key: "", len: 0 });
  const [interval, setInterval_] = useState(15);
  const [mode, setMode] = useState<Mode>("mc");
  const [unit, setUnit] = useState<Unit>("usd");
  const [tool, setTool] = useState<string | null>(null);
  const [magnet, setMagnet] = useState(false);
  const [indicators, setIndicators] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState<KLineData | null>(null);
  const [samples, setSamples] = useState(0);

  const live = book.status === "live";
  const dex = book.status === "dex";
  const tokenSupply = live ? book.supply : supply;
  const showUnit: Unit = (live || dex) && unit === "sol" && solUsd != null ? "sol" : live && solUsd == null ? "sol" : "usd";
  // DEX history comes in 1 minute candles, so shorter intervals are not offered.
  const minSecs = dex ? book.history.candle_secs : 1;
  const tf = Math.max(interval, minSecs);

  // Fallback sampling when the gateway has no trade book for this token.
  const mcRef = useRef(mcUsd);
  useEffect(() => {
    mcRef.current = mcUsd;
  }, [mcUsd]);
  useEffect(() => {
    if (book.status !== "untracked") return;
    const tick = () => {
      const v = mcRef.current;
      if (v == null) return;
      const list = SAMPLES.get(mint) ?? [];
      const t = Math.floor(Date.now() / 1000);
      const last = list[list.length - 1];
      if (last && last.t === t) last.c = v;
      else list.push({ t, o: last?.c ?? v, h: Math.max(last?.c ?? v, v), l: Math.min(last?.c ?? v, v), c: v, v: 0 });
      if (list.length > 21_600) list.shift();
      SAMPLES.set(mint, list);
      setSamples(list.length);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [book.status, mint]);

  const data: KLineData[] = useMemo(() => {
    let base: Candle[];
    let scale = 1;
    let volScale = 1;
    if (live) {
      // Market cap in SOL.
      base = book.candles;
      if (showUnit === "usd") scale = volScale = solUsd ?? 1;
      if (mode === "price" && tokenSupply) scale /= tokenSupply;
    } else if (dex) {
      // USD price; market cap is price times supply.
      base = book.history.candles;
      if (mode === "mc") scale = tokenSupply ?? 0;
      if (showUnit === "sol" && solUsd) {
        scale /= solUsd;
        volScale = 1 / solUsd;
      }
    } else {
      // Sampled USD market cap.
      base = samples ? (SAMPLES.get(mint) ?? []) : [];
      if (mode === "price" && tokenSupply) scale /= tokenSupply;
    }
    if (!scale) return [];
    return aggregate(base, tf).map((c) => ({
      timestamp: c.t * 1000,
      open: c.o * scale,
      high: c.h * scale,
      low: c.l * scale,
      close: c.c * scale,
      volume: c.v * volScale,
    }));
  }, [live, dex, book, showUnit, solUsd, samples, mint, mode, tokenSupply, tf]);

  const fmt = useMemo(() => {
    const f = mode === "mc" ? usd : price;
    return showUnit === "usd" ? f : (x: number) => `${f(x).replace("$", "")} SOL`;
  }, [mode, showUnit]);

  // Create the chart once.
  useEffect(() => {
    if (!box.current) return;
    ensureAxis();
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    // Candle colors are brighter than the UI's positive/negative tokens so price
    // action reads at a glance, as on an exchange terminal.
    const up = "#2ebd85";
    const down = "#f6465d";
    const muted = v("--mx-muted");
    const hair = "rgba(237,237,237,0.06)";
    const font = "JetBrains Mono, ui-monospace, monospace";
    const c = init(box.current, {
      layout: [
        { type: "candle" as never, options: { id: "candle_pane", axisOptions: { name: "mx" } } },
        { type: "xAxis" as never },
      ],
      styles: {
        grid: { horizontal: { color: hair }, vertical: { color: hair } },
        candle: {
          bar: { upColor: up, downColor: down, noChangeColor: muted, upBorderColor: up, downBorderColor: down, upWickColor: up, downWickColor: down },
          priceMark: {
            // These labels ignore the custom axis format (they would read 26,620.70), so the
            // legend and axis carry the figures instead.
            high: { show: false },
            low: { show: false },
            last: { upColor: up, downColor: down, text: { show: false } },
          },
          tooltip: { showRule: "none" as never },
        },
        indicator: {
          tooltip: { text: { family: font, size: 12, color: muted } },
          // Palette colors only (no purple): cyan, warning, text-2, then muted steps.
          lines: [v("--mx-cyan"), v("--mx-warning"), v("--mx-text-2"), "#6b6b70", "#4a4a4f"].map((color) => ({ color, size: 1 })),
          bars: [{ upColor: "rgba(76,195,138,0.45)", downColor: "rgba(229,72,77,0.45)", noChangeColor: "rgba(133,133,139,0.45)" }],
        },
        xAxis: { axisLine: { color: hair }, tickLine: { color: hair }, tickText: { color: muted, family: font, size: 12 } },
        yAxis: { axisLine: { color: hair }, tickLine: { color: hair }, tickText: { color: muted, family: font, size: 12 } },
        separator: { color: hair },
        crosshair: {
          horizontal: { line: { color: "rgba(237,237,237,0.25)" }, text: { family: font, backgroundColor: v("--mx-surface-3"), borderColor: v("--mx-surface-3") } },
          vertical: { line: { color: "rgba(237,237,237,0.25)" }, text: { family: font, backgroundColor: v("--mx-surface-3"), borderColor: v("--mx-surface-3") } },
        },
        overlay: {
          line: { color: v("--mx-cyan") },
          point: { color: v("--mx-cyan"), borderColor: "rgba(103,232,249,0.35)", activeColor: v("--mx-cyan") },
          text: { family: font },
        },
      },
      customApi: { formatBigNumber: (x) => usd(Number(x)).replace("$", "") },
    });
    if (!c) return;
    c.setOffsetRightDistance(64);
    c.setBarSpace(10);
    c.subscribeAction("onCrosshairChange" as never, (d: unknown) => {
      setHover((d as { kLineData?: KLineData } | undefined)?.kLineData ?? null);
    });
    chart.current = c;
    const onResize = () => c.resize();
    const ro = new ResizeObserver(onResize);
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      dispose(c);
      chart.current = null;
      drawn.current = { key: "", len: 0 };
    };
  }, []);

  // Formatting follows the mode and unit.
  useEffect(() => {
    axisFormat = fmt;
    const ref = data[data.length - 1]?.close ?? 0;
    chart.current?.setPriceVolumePrecision(precisionFor(ref), 2);
  }, [fmt, data]);

  // Draw: full reload when the series changes, otherwise only the newest candles.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const key = `${mint}|${tf}|${mode}|${showUnit}|${book.status}`;
    const prev = drawn.current;
    if (prev.key !== key || data.length < prev.len || prev.len === 0) {
      // Spread a short history across most of the width instead of a thin sliver at
      // the right edge; long histories keep a readable minimum candle width.
      const width = box.current?.clientWidth ?? 800;
      c.setBarSpace(Math.min(12, Math.max(6, (width * 0.7) / Math.max(1, data.length))));
      c.applyNewData(data);
      c.scrollToRealTime();
    } else {
      for (let i = Math.max(0, prev.len - 1); i < data.length; i++) c.updateData(data[i]);
    }
    drawn.current = { key, len: data.length };
  }, [data, mint, tf, mode, showUnit, book.status]);

  // Indicators.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    for (const n of MAIN_INDICATORS) c.removeIndicator("candle_pane", n);
    for (const n of SUB_INDICATORS) c.removeIndicator(`pane_${n}`, n);
    for (const n of indicators) {
      if ((MAIN_INDICATORS as readonly string[]).includes(n)) c.createIndicator(n, true, { id: "candle_pane" });
      // Volume as plain bars; its moving averages only add noise on short histories.
      else c.createIndicator(n === "VOL" ? { name: "VOL", calcParams: [] } : n, false, { id: `pane_${n}`, height: n === "VOL" ? 96 : 110 });
    }
  }, [indicators]);

  // Smart markers: dev trades, whale trades and sniper exits, newest 60.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.removeOverlay({ groupId: "marks" });
    if (!live) return;
    const scale = (showUnit === "usd" ? (solUsd ?? 1) : 1) / (mode === "price" && tokenSupply ? tokenSupply : 1);
    const marks = book.trades.filter((t) => t.dev || t.whale || (t.sniper && !t.is_buy)).slice(0, 60);
    for (const t of marks) {
      const kind = t.dev ? MARKS.dev : t.whale ? MARKS.whale : MARKS.sniper;
      const color = t.dev ? kind.color : t.is_buy ? "#4cc38a" : "#e5484d";
      c.createOverlay({
        name: "simpleAnnotation",
        groupId: "marks",
        lock: true,
        points: [{ timestamp: (t.ts - (t.ts % interval)) * 1000, value: t.mc_sol * scale }],
        extendData: `${kind.letter}${t.is_buy ? "B" : "S"}`,
        styles: {
          line: { color, size: 1 },
          polygon: { color },
          text: { color: "#08090a", backgroundColor: color, borderColor: color, size: 9, weight: 600, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, borderRadius: 3 },
        },
      });
    }
  }, [live, book, interval, mode, showUnit, solUsd, tokenSupply]);

  // Drawing tools.
  const draw = (name: string | null) => {
    setTool(name);
    if (!name || !chart.current) return;
    chart.current.createOverlay({
      name,
      groupId: "drawings",
      mode: (magnet ? "weak_magnet" : "normal") as never,
      onDrawEnd: () => {
        setTool(null);
        return false;
      },
    });
  };

  const screenshot = () => {
    const url = chart.current?.getConvertPictureUrl(true, "png", "#0e0f11");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `monexa-${mint.slice(0, 6)}.png`;
    a.click();
  };

  const shown = hover ?? data[data.length - 1] ?? null;
  const change = shown ? ((shown.close - shown.open) / (shown.open || 1)) * 100 : 0;
  const tone = change >= 0 ? "text-positive" : "text-negative";

  return (
    <div ref={root} className="flex h-full flex-col bg-bg">
      {/* Top toolbar */}
      <div className="no-scrollbar flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 text-[13px]">
        {INTERVALS.filter((i) => i.secs >= minSecs).map((i) => (
          <Toggle key={i.secs} on={tf === i.secs} onClick={() => setInterval_(i.secs)}>
            {i.label}
          </Toggle>
        ))}
        <Divider />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
          >
            Indicators <ChevronDown size={12} strokeWidth={1.5} />
          </button>
        </div>
        <Divider />
        <Pair a="MC" b="Price" on={mode === "mc" ? 0 : 1} onChange={(i) => setMode(i === 0 ? "mc" : "price")} />
        {(live || dex) && solUsd != null && (
          <>
            <Divider />
            <Pair a="USD" b="SOL" on={showUnit === "usd" ? 0 : 1} onChange={(i) => setUnit(i === 0 ? "usd" : "sol")} />
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-3">
          <span className="mr-2 font-mono text-muted">
            {book.status === "untracked"
              ? `Live since opened · ${samples}s`
              : book.status === "loading"
                ? "Loading"
                : book.status === "dex"
                  ? `${book.history.pool.name} · history`
                  : book.source !== "curve"
                    ? `${book.pool && !/pumpswap|meteora/i.test(book.pool) ? book.pool : "Pool"} · live`
                    : "bonding curve · live"}
          </span>
          <IconButton label="Screenshot" onClick={screenshot}>
            <Camera size={15} strokeWidth={1.5} />
          </IconButton>
          <IconButton label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())}>
            <Expand size={15} strokeWidth={1.5} />
          </IconButton>
        </span>
      </div>

      {menu && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 text-xs">
          {[...MAIN_INDICATORS, ...SUB_INDICATORS].map((n) => (
            <Toggle key={n} on={indicators.includes(n)} onClick={() => setIndicators((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]))}>
              {n}
            </Toggle>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 bg-[#0b0c0e]">
        {/* Drawing tools */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-border py-3">
          {TOOLS.map((t) => (
            <IconButton key={t.label} label={t.label} on={tool === t.name} onClick={() => draw(t.name)}>
              <t.icon size={18} strokeWidth={1.5} />
            </IconButton>
          ))}
          <span className="my-1 h-px w-5 bg-border" />
          <IconButton label="Magnet" on={magnet} onClick={() => setMagnet((m) => !m)}>
            <Magnet size={18} strokeWidth={1.5} />
          </IconButton>
          <IconButton label="Remove drawings" onClick={() => chart.current?.removeOverlay({ groupId: "drawings" })}>
            <Trash2 size={18} strokeWidth={1.5} />
          </IconButton>
        </div>

        <div className="relative min-w-0 flex-1">
          {shown && (
            <div className="pointer-events-none absolute top-2.5 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
              <span className="flex items-center gap-2 font-sans text-sm text-text">
                {symbol || "—"}
                <span className="rounded border border-border px-1.5 font-mono text-[11px] text-text-2">Solana</span>
                <span className="text-muted">·</span>
                <span className="text-text-2">{INTERVALS.find((i) => i.secs === tf)?.label}</span>
                <span className="text-muted">·</span>
                <span className="text-text-2">{mode === "mc" ? "Market cap" : "Price"} in {showUnit === "usd" ? "USD" : "SOL"}</span>
                {(live || dex) && <span className="h-1.5 w-1.5 rounded-full bg-emerald" title="Live" />}
              </span>
              {(
                [
                  ["O", shown.open],
                  ["H", shown.high],
                  ["L", shown.low],
                  ["C", shown.close],
                ] as const
              ).map(([k, val]) => (
                <span key={k} className="text-muted">
                  {k} <span className={tone}>{fmt(val)}</span>
                </span>
              ))}
              <span className={tone}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)}%
              </span>
              <span className="text-muted">
                Vol <span className="text-text-2">{showUnit === "usd" ? usd(shown.volume ?? 0) : `${(shown.volume ?? 0).toFixed(2)} SOL`}</span>
              </span>
            </div>
          )}
          {data.length === 0 && book.status !== "loading" && (
            <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">Waiting for the first trade</p>
          )}
          <div ref={box} className="relative h-full w-full" />
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1.5 h-4 w-px shrink-0 bg-border" />;
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-7 shrink-0 rounded-md px-2 font-mono transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${
        on ? "bg-surface-3 text-text" : "text-muted hover:text-text-2"
      }`}
    >
      {children}
    </button>
  );
}

/** Two-way switch written as "MC / Price", the active side lit. */
function Pair({ a, b, on, onChange }: { a: string; b: string; on: 0 | 1; onChange: (i: 0 | 1) => void }) {
  return (
    <span className="flex shrink-0 items-center font-mono">
      <button type="button" onClick={() => onChange(0)} className={`h-7 px-1.5 transition-colors ${on === 0 ? "text-emerald" : "text-muted hover:text-text-2"}`}>
        {a}
      </button>
      <span className="text-muted">/</span>
      <button type="button" onClick={() => onChange(1)} className={`h-7 px-1.5 transition-colors ${on === 1 ? "text-emerald" : "text-muted hover:text-text-2"}`}>
        {b}
      </button>
    </span>
  );
}

function IconButton({ label, on = false, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${
        on ? "bg-surface-3 text-emerald" : "text-muted hover:bg-surface-3 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
