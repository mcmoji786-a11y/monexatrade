"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, ImageIcon, Loader2, Send, Share2, X } from "lucide-react";
import type { DemoTrade } from "@/lib/demo";
import { pushToast } from "@/lib/toast";
import { money, tinyPrice } from "@/components/trade/trade-panel";
import { refLink, useReferral } from "@/lib/growth";
import { useFeatures } from "@/lib/features";
import { closeShareCard, useShareCard, type ShareTrade } from "@/lib/share";

/* Share card for a closed demo trade: a 1200x675 PNG (X's large image size) drawn on a
   canvas, so it can be downloaded, copied or attached to a post. The background is a
   photo from public/share (Unsplash License, see CREDITS.txt), picked per trade and
   changeable. Every card says "Demo account" so a virtual result is never passed off
   as a real one. */

export type { ShareTrade };

/** Background photos, darkened on the left where the figures sit. */
const BACKGROUNDS = Array.from({ length: 9 }, (_, i) => `/share/bg-${i + 1}.jpg`);

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

const W = 1200;
const H = 675;
const C = {
  bg: "#08090a",
  surface: "#0e0f11",
  line: "rgba(237,237,237,0.08)",
  text: "#ededed",
  text2: "#a1a1a6",
  muted: "#85858b",
  emerald: "#34d399",
  positive: "#4cc38a",
  negative: "#e5484d",
  warning: "#e0a63e",
};

/** P&L of a sell as a share of what the sold tokens cost. */
export function tradeResult(t: DemoTrade) {
  const usd = Number(t.usd);
  const pnl = Number(t.realized_usd ?? 0);
  const cost = usd - pnl;
  return { usd, pnl, cost, pct: cost > 0 ? (pnl / cost) * 100 : 0, entry: cost / Number(t.tokens), exit: Number(t.price_usd) };
}

function held(from: string | null, to: string) {
  if (!from) return null;
  const s = Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

const pctText = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p) >= 1000 ? Math.round(Math.abs(p)).toLocaleString("en-US") : Math.abs(p).toFixed(2)}%`;
const usdText = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;

function fonts() {
  const css = getComputedStyle(document.body);
  const sans = css.fontFamily || "system-ui, sans-serif";
  const mono = css.getPropertyValue("--font-jetbrains").trim() || "ui-monospace, monospace";
  return { sans, mono: `${mono}, ui-monospace, monospace` };
}

function draw(canvas: HTMLCanvasElement, t: ShareTrade, bg: HTMLImageElement | null, site: string, mark: HTMLImageElement | null) {
  const r = tradeResult(t);
  const up = r.pnl >= 0;
  const tone = up ? C.positive : C.negative;
  const { sans, mono } = fonts();
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  g.textBaseline = "alphabetic";

  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  if (bg) {
    // Cover the card, centred.
    const k = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
    const w = bg.naturalWidth * k;
    const h = bg.naturalHeight * k;
    g.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
    // Shade: dark behind the figures on the left, the photo open on the right.
    const side = g.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, "rgba(8,9,10,0.94)");
    side.addColorStop(0.45, "rgba(8,9,10,0.72)");
    side.addColorStop(1, "rgba(8,9,10,0.18)");
    g.fillStyle = side;
    g.fillRect(0, 0, W, H);
    const foot = g.createLinearGradient(0, H - 230, 0, H);
    foot.addColorStop(0, "rgba(8,9,10,0)");
    foot.addColorStop(1, "rgba(8,9,10,0.9)");
    g.fillStyle = foot;
    g.fillRect(0, H - 230, W, 230);
  }
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 14;

  // Header: the Kixo mark and name, large, then the demo label on the right.
  if (mark) g.drawImage(mark, 56, 40, 76, 76);
  g.fillStyle = C.text;
  g.font = `600 56px ${sans}`;
  g.fillText("Kixo", 146, 98);
  g.fillStyle = C.text2;
  g.font = `400 20px ${sans}`;
  g.fillText("Solana memecoin terminal", 148, 126);

  const label = "Demo account";
  g.font = `500 22px ${sans}`;
  const lw = g.measureText(label).width + 36;
  g.strokeStyle = "rgba(224,166,62,0.55)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.roundRect(W - 64 - lw, 56, lw, 40, 10);
  g.stroke();
  g.fillStyle = C.warning;
  g.fillText(label, W - 64 - lw + 18, 83);

  // Coin and what happened.
  g.fillStyle = C.text;
  g.font = `500 46px ${sans}`;
  const sym = `$${t.symbol || t.mint.slice(0, 4)}`;
  g.fillText(sym, 64, 222);
  const sw = g.measureText(sym).width;
  g.fillStyle = C.text2;
  g.font = `400 26px ${sans}`;
  g.fillText(`Sold · ${new Date(t.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`, 64 + sw + 20, 220);

  // The figure.
  g.fillStyle = tone;
  g.font = `600 150px ${mono}`;
  g.fillText(pctText(r.pct), 56, 382);
  g.font = `500 42px ${mono}`;
  g.fillText(usdText(r.pnl), 64, 444);

  // Facts row.
  const facts: [string, string][] = [
    ["Entry", tinyPrice(r.entry)],
    ["Exit", tinyPrice(r.exit)],
    ["Size", money(r.cost)],
  ];
  const h = held(t.openedAt, t.ts);
  if (h) facts.push(["Held", h]);
  const colW = (W - 128) / 4;
  facts.forEach(([k, v], i) => {
    const x = 64 + i * colW;
    g.fillStyle = C.text2;
    g.font = `400 22px ${sans}`;
    g.fillText(k, x, H - 138);
    g.fillStyle = C.text;
    g.font = `500 30px ${mono}`;
    g.fillText(v, x, H - 100);
  });

  // Footer: a hairline, then what this is on the left and where to trade on the right.
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(237,237,237,0.14)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(64, H - 70.5);
  g.lineTo(W - 64, H - 70.5);
  g.stroke();
  g.fillStyle = C.text2;
  g.font = `400 20px ${sans}`;
  g.fillText("Virtual money at live market prices", 64, H - 34);
  if (site) {
    // Only the domain: the picture cannot be clicked, and the post text carries the referral link.
    const host = site.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
    g.font = `500 22px ${sans}`;
    const hw = g.measureText(host).width;
    g.fillStyle = C.emerald;
    g.fillText(host, W - 64 - hw, H - 34);
    g.fillStyle = C.text2;
    g.font = `400 20px ${sans}`;
    const pre = "Trade on ";
    g.fillText(pre, W - 64 - hw - g.measureText(pre).width, H - 34);
  }
}

function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Image failed"))), "image/png"));
}

export function ShareCard({ trade, onClose }: { trade: ShareTrade; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  // A photo picked per trade; "Change background" steps through the rest.
  const [bgIndex, setBgIndex] = useState(() => Math.abs(Number(trade.id) || 0) % BACKGROUNDS.length);
  const r = tradeResult(trade);
  const sym = trade.symbol || trade.mint.slice(0, 4);
  // The link in every post carries the sharer's referral code, so viewers who join count for them.
  const ref = useReferral();
  const refOn = useFeatures().referrals;
  const site = ref && refOn ? refLink(ref.code) : typeof window === "undefined" ? "" : window.location.origin;
  const text = `Closed $${sym} at ${pctText(r.pct)} (${usdText(r.pnl)}) on my Kixo demo account`;

  useEffect(() => {
    let alive = true;
    Promise.all([document.fonts.ready, loadImage(BACKGROUNDS[bgIndex]), loadImage("/brand/kixo-mark.png")]).then(([, bg, mark]) => {
      if (!alive || !canvas.current) return;
      draw(canvas.current, trade, bg, site, mark);
      setReady(true);
    });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      alive = false;
      window.removeEventListener("keydown", esc);
    };
  }, [trade, onClose, bgIndex, site]);

  const file = async () => new File([await toBlob(canvas.current!)], `kixo-${sym}-${trade.id}.png`, { type: "image/png" });

  async function download() {
    const url = URL.createObjectURL(await file());
    const a = document.createElement("a");
    a.href = url;
    a.download = `kixo-${sym}-${trade.id}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy(quiet = false) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(canvas.current!) })]);
      if (!quiet) pushToast({ tone: "good", title: "Image copied", body: "Paste it into any post or chat" });
      return true;
    } catch {
      if (!quiet) pushToast({ tone: "bad", title: "Copy not supported here", body: "Use Download instead" });
      return false;
    }
  }

  // X, Reddit and Telegram links cannot carry an image, so it goes to the clipboard first.
  async function post(where: "x" | "reddit" | "telegram") {
    const copied = await copy(true);
    const u = encodeURIComponent(site);
    const s = encodeURIComponent(text);
    const url =
      where === "x"
        ? `https://x.com/intent/post?text=${s}&url=${u}`
        : where === "reddit"
          ? `https://www.reddit.com/submit?url=${u}&title=${s}`
          : `https://t.me/share/url?url=${u}&text=${s}`;
    window.open(url, "_blank", "noopener,noreferrer");
    pushToast({ tone: "good", title: copied ? "Image copied" : "Download the image to attach it", body: copied ? "Paste it into your post" : "This browser cannot copy images" });
  }

  const canShare = typeof navigator !== "undefined" && "canShare" in navigator;
  async function native() {
    const f = await file();
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text: `${text} ${site}` }).catch(() => {});
    else download();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-12 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={onClose}>
      <div className="w-full max-w-[720px] rounded-2xl border border-border bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="share-title" className="text-base font-medium text-text">
            Share trade
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-text focus-visible:outline-2 focus-visible:outline-emerald">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="relative mt-4 overflow-hidden rounded-xl border border-border">
          <canvas ref={canvas} className="block aspect-[1200/675] w-full" aria-label={text} />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg">
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-muted" />
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Btn onClick={() => post("x")} disabled={!ready} primary>
            <XLogo /> Post on X
          </Btn>
          <Btn onClick={() => post("reddit")} disabled={!ready}>
            <Share2 size={16} strokeWidth={1.5} /> Reddit
          </Btn>
          <Btn onClick={() => post("telegram")} disabled={!ready}>
            <Send size={16} strokeWidth={1.5} /> Telegram
          </Btn>
          <Btn onClick={download} disabled={!ready}>
            <Download size={16} strokeWidth={1.5} /> Download
          </Btn>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
          <span>The image is copied when you post, paste it into the post</span>
          <div className="flex shrink-0 gap-3">
            <button type="button" onClick={() => setBgIndex((i) => (i + 1) % BACKGROUNDS.length)} disabled={!ready} className="flex items-center gap-1 text-text-2 hover:text-text">
              <ImageIcon size={14} strokeWidth={1.5} /> Change background
            </button>
            <button type="button" onClick={() => copy()} disabled={!ready} className="flex items-center gap-1 text-text-2 hover:text-text">
              <Copy size={14} strokeWidth={1.5} /> Copy image
            </button>
            {canShare && (
              <button type="button" onClick={native} disabled={!ready} className="text-text-2 hover:text-text sm:hidden">
                More apps
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm transition-colors focus-visible:outline-2 focus-visible:outline-emerald disabled:opacity-50 ${
        primary ? "bg-text font-medium text-bg hover:bg-text/90" : "border border-border text-text-2 hover:bg-surface-3 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function XLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** The share card opened from anywhere (a sell notification), once per app. */
export function ShareCardHost() {
  const t = useShareCard();
  if (!t) return null;
  return <ShareCard trade={t} onClose={closeShareCard} />;
}
