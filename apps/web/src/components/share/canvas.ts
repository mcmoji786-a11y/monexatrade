"use client";

/* Shared drawing for every Kixo share card: a 1200x675 PNG (X's large image size) on
   a canvas. Backgrounds are photos from public/share (Unsplash License, see
   CREDITS.txt), darkened on the left where the figures sit. */

import { GATEWAY_HTTP } from "@/lib/gateway";

export const W = 1200;
export const H = 675;
export const C = {
  bg: "#08090a",
  text: "#ededed",
  text2: "#a1a1a6",
  muted: "#85858b",
  emerald: "#34d399",
  positive: "#4cc38a",
  negative: "#e5484d",
  warning: "#e0a63e",
};

export const BACKGROUNDS = Array.from({ length: 9 }, (_, i) => `/share/bg-${i + 1}.jpg`);

/** Video backgrounds: public/share/videos/1.mp4, 2.mp4, ... in order, found by asking for
 *  each number until one is missing (up to 60). Drop new ones in with the next number. */
let videoList: Promise<string[]> | null = null;
export function findVideos(): Promise<string[]> {
  videoList ??= (async () => {
    const out: string[] = [];
    for (let i = 1; i <= 60; i++) {
      const url = `/share/videos/${i}.mp4`;
      const ok = await fetch(url, { method: "HEAD" }).then((r) => r.ok && (r.headers.get("content-type") ?? "").includes("video")).catch(() => false);
      if (!ok) break;
      out.push(url);
    }
    return out;
  })();
  return videoList;
}

/** Draws `src` to fill the card, centred (like CSS object-fit: cover). */
export function drawCover(g: CanvasRenderingContext2D, src: HTMLImageElement | HTMLVideoElement) {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (!sw || !sh) return;
  const k = Math.max(W / sw, H / sh);
  g.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
}

export function loadImage(src: string, cors = false): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** A coin logo through the gateway's image proxy, which allows this site, so the canvas
 *  stays exportable. null when it cannot be loaded (the card draws the initial). */
export const loadCoinImage = (src: string | null | undefined) => (src ? loadImage(`${GATEWAY_HTTP}/img?u=${encodeURIComponent(src)}`, true) : Promise.resolve(null));

export function fonts() {
  const css = getComputedStyle(document.body);
  const sans = css.fontFamily || "system-ui, sans-serif";
  const mono = css.getPropertyValue("--font-jetbrains").trim() || "ui-monospace, monospace";
  return { sans, mono: `${mono}, ui-monospace, monospace` };
}
export type Fonts = ReturnType<typeof fonts>;

export const pctText = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p) >= 1000 ? Math.round(Math.abs(p)).toLocaleString("en-US") : Math.abs(p).toFixed(Math.abs(p) >= 100 ? 0 : 2)}%`;
export const usdText = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })}`;
export const compactUsd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(a >= 1 ? 0 : 2);
  return `$${s}`;
};
export const multipleText = (x: number) => `${x >= 100 ? Math.round(x).toLocaleString("en-US") : x >= 10 ? x.toFixed(1) : x.toFixed(2)}x`;

export type Label = { text: string; tone: "warning" | "emerald" };

/** Background photo, shade, the Kixo header and the label pill. With `shadeOnly`, the
 *  background is left transparent (a video plays under it) and only the shade is drawn. */
export function paintFrame(g: CanvasRenderingContext2D, bg: HTMLImageElement | null, mark: HTMLImageElement | null, label: Label, f: Fonts, shadeOnly = false) {
  g.textBaseline = "alphabetic";
  if (!shadeOnly) {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
  }
  if (bg || shadeOnly) {
    if (bg && !shadeOnly) drawCover(g, bg);
    const side = g.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, "rgba(8,9,10,0.94)");
    side.addColorStop(0.45, "rgba(8,9,10,0.74)");
    side.addColorStop(1, "rgba(8,9,10,0.2)");
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
  if (mark) g.drawImage(mark, 56, 40, 76, 76);
  g.fillStyle = C.text;
  g.font = `600 56px ${f.sans}`;
  g.fillText("Kixo", 146, 98);
  g.fillStyle = C.text2;
  g.font = `400 20px ${f.sans}`;
  g.fillText("Solana memecoin terminal", 148, 126);

  g.font = `500 22px ${f.sans}`;
  const lw = g.measureText(label.text).width + 36;
  const tone = label.tone === "warning" ? C.warning : C.emerald;
  g.strokeStyle = label.tone === "warning" ? "rgba(224,166,62,0.55)" : "rgba(52,211,153,0.55)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.roundRect(W - 64 - lw, 56, lw, 40, 10);
  g.stroke();
  g.fillStyle = tone;
  g.fillText(label.text, W - 64 - lw + 18, 83);
}

/** A row of label / value pairs near the bottom. */
export function paintFacts(g: CanvasRenderingContext2D, facts: [string, string][], f: Fonts) {
  const colW = (W - 128) / Math.max(4, facts.length);
  facts.forEach(([k, v], i) => {
    const x = 64 + i * colW;
    g.fillStyle = C.text2;
    g.font = `400 22px ${f.sans}`;
    g.fillText(k, x, H - 138);
    g.fillStyle = C.text;
    g.font = `500 30px ${f.mono}`;
    g.fillText(v, x, H - 100);
  });
}

/** Hairline, what this is on the left, the site on the right. */
export function paintFooter(g: CanvasRenderingContext2D, left: string, site: string, f: Fonts) {
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(237,237,237,0.14)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(64, H - 70.5);
  g.lineTo(W - 64, H - 70.5);
  g.stroke();
  g.fillStyle = C.text2;
  g.font = `400 20px ${f.sans}`;
  g.fillText(left, 64, H - 34);
  if (site) {
    // Only the domain: the picture cannot be clicked, the post text carries the link.
    const host = site.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
    g.font = `500 22px ${f.sans}`;
    const hw = g.measureText(host).width;
    g.fillStyle = C.emerald;
    g.fillText(host, W - 64 - hw, H - 34);
    g.fillStyle = C.text2;
    g.font = `400 20px ${f.sans}`;
    const pre = "Trade on ";
    g.fillText(pre, W - 64 - hw - g.measureText(pre).width, H - 34);
  }
}

/** A coin logo in a circle, or its first letter. */
export function paintCoin(g: CanvasRenderingContext2D, img: HTMLImageElement | null, symbol: string, x: number, y: number, size: number, f: Fonts) {
  g.save();
  g.shadowBlur = 0;
  g.beginPath();
  g.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  g.closePath();
  if (img) {
    g.clip();
    g.drawImage(img, x, y, size, size);
  } else {
    g.fillStyle = "#1a1c1f";
    g.fill();
    g.fillStyle = C.text2;
    g.font = `600 ${Math.round(size * 0.42)}px ${f.sans}`;
    const ch = (symbol[0] ?? "?").toUpperCase();
    g.fillText(ch, x + size / 2 - g.measureText(ch).width / 2, y + size * 0.64);
  }
  g.restore();
}

export function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Image failed"))), "image/png"));
}
