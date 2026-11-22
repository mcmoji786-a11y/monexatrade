"use client";
/* The share video: a 9 second vertical edit (TikTok, Reels, Shorts, X) made in the
   browser from the person's own name, place and invite link, with a beat made on the spot
   (Web Audio, so no music rights). Drawn on a canvas and recorded with MediaRecorder; MP4
   where the browser can record it, WebM otherwise. Kixo's mark and the link stay on every
   frame, so wherever it travels it points back to the waitlist. */

import { useEffect, useRef, useState } from "react";

export type VideoInfo = { name: string; handle: string | null; code: string; position: number; tier: string; link: string };

const W = 720;
const H = 1280;
const LENGTH = 9; // seconds
const BPM = 120;
const BEAT = 60 / BPM;
const EMERALD = "#2fd38a";
const RED = "#f26d6d";
const TEXT = "#ededef";
const MUTED = "#8b8b94";

/* ---------------- The beat ---------------- */

function scheduleBeat(ctx: AudioContext, out: AudioNode, t0: number) {
  const noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const kick = (t: number, hard = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.95 * hard, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.36);
  };
  const hiss = (t: number, len: number, freq: number, type: BiquadFilterType, vol: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + len);
  };
  const bass = (t: number, note: number, len: number) => {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = 55 * Math.pow(2, note / 12);
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + len);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.02);
  };
  const riff = [0, 0, 12, 0, 3, 0, 10, 7];
  const beats = Math.floor(LENGTH / BEAT);
  for (let b = 0; b < beats; b++) {
    const t = t0 + b * BEAT;
    const drop = b >= 9; // the drop lands at 4.5 s
    if (b < 4 || drop || b === 8) kick(t, drop ? 1 : 0.7);
    hiss(t + BEAT / 2, 0.05, 8000, "highpass", 0.22);
    if (b % 2 === 1) hiss(t, 0.16, 1800, "bandpass", drop ? 0.7 : 0.45);
    if (drop || b < 4) {
      bass(t, riff[(b * 2) % 8], BEAT / 2 - 0.02);
      bass(t + BEAT / 2, riff[(b * 2 + 1) % 8], BEAT / 2 - 0.02);
    }
  }
  // A riser into the drop (4 to 4.5 s).
  const r = ctx.createOscillator();
  const rg = ctx.createGain();
  r.type = "square";
  r.frequency.setValueAtTime(200, t0 + 3.4);
  r.frequency.exponentialRampToValueAtTime(1600, t0 + 4.5);
  rg.gain.setValueAtTime(0.0001, t0 + 3.4);
  rg.gain.exponentialRampToValueAtTime(0.12, t0 + 4.45);
  rg.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.5);
  r.connect(rg).connect(out);
  r.start(t0 + 3.4);
  r.stop(t0 + 4.55);
}

/* ---------------- The frames ---------------- */

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
/** 1 on every beat, falling to 0 before the next. */
const pulse = (t: number) => Math.pow(1 - (t % BEAT) / BEAT, 3);

function font(size: number, weight = 600, mono = false) {
  return `${weight} ${size}px ${mono ? "ui-monospace, 'JetBrains Mono', monospace" : "Inter, system-ui, sans-serif"}`;
}

function centered(g: CanvasRenderingContext2D, text: string, y: number, size: number, color = TEXT, weight = 700, mono = false) {
  g.font = font(size, weight, mono);
  g.fillStyle = color;
  g.textAlign = "center";
  g.fillText(text, W / 2, y);
}

/** Fits a line into the width by shrinking it. */
function fitted(g: CanvasRenderingContext2D, text: string, y: number, max: number, color = TEXT, mono = false) {
  let size = max;
  g.font = font(size, 800, mono);
  while (g.measureText(text).width > W - 96 && size > 28) {
    size -= 2;
    g.font = font(size, 800, mono);
  }
  centered(g, text, y, size, color, 800, mono);
}

/** A chart line: falling (rug) or rising (pump), drawn up to `progress`. */
function chart(g: CanvasRenderingContext2D, progress: number, up: boolean, t: number) {
  const pts: [number, number][] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const x = 64 + ((W - 128) * i) / n;
    const wobble = Math.sin(i * 1.7 + t * 3) * 14;
    const base = up ? 0.82 - Math.pow(i / n, 1.8) * 0.62 : 0.3 + (i > n * 0.6 ? Math.pow((i - n * 0.6) / (n * 0.4), 0.6) * 0.55 : (i / n) * -0.08);
    pts.push([x, 380 + base * 520 + wobble]);
  }
  const k = Math.max(2, Math.floor(pts.length * progress));
  g.lineWidth = 8;
  g.lineJoin = "round";
  g.strokeStyle = up ? EMERALD : RED;
  g.beginPath();
  pts.slice(0, k).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  const [lx, ly] = pts[k - 1];
  g.fillStyle = up ? EMERALD : RED;
  g.beginPath();
  g.arc(lx, ly, 12, 0, Math.PI * 2);
  g.fill();
}

function frame(g: CanvasRenderingContext2D, t: number, v: VideoInfo, mark: HTMLImageElement | null) {
  const p = pulse(t);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#050506";
  g.fillRect(0, 0, W, H);
  // A faint grid that thumps with the beat.
  g.strokeStyle = `rgba(255,255,255,${0.035 + p * 0.03})`;
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = 0; y <= H; y += 60) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }

  // Camera punch on each beat after the drop.
  const zoom = 1 + (t > 4.5 ? p * 0.035 : p * 0.012);
  g.setTransform(zoom, 0, 0, zoom, (W - W * zoom) / 2, (H - H * zoom) / 2);

  if (t < 2) {
    const a = ease(t / 0.4);
    g.globalAlpha = a;
    centered(g, "POV:", 470, 40, MUTED, 600, true);
    fitted(g, v.name, 580, 104, EMERALD);
    const line = "found the AI that trades";
    const shown = line.slice(0, Math.floor(line.length * ease((t - 0.5) / 0.8)));
    centered(g, shown, 690, 46, TEXT, 700);
    if (t > 1.2) centered(g, "memecoins for you", 750, 46, TEXT, 700);
    g.globalAlpha = 1;
  } else if (t < 4.5) {
    const s = t - 2;
    centered(g, "everyone else:", 230, 44, MUTED, 600, true);
    centered(g, "bought the top", 300, 56, TEXT, 800);
    chart(g, ease(s / 1.6), false, t);
    if (s > 1.4) {
      // The stamp lands and shakes.
      const k = ease((s - 1.4) / 0.25);
      const shake = s < 1.9 ? Math.sin(s * 90) * 8 : 0;
      g.save();
      g.translate(W / 2 + shake, 700);
      g.rotate(-0.18);
      g.scale(2 - k, 2 - k);
      g.globalAlpha = k;
      g.strokeStyle = RED;
      g.lineWidth = 10;
      g.strokeRect(-230, -70, 460, 140);
      g.font = font(96, 900);
      g.fillStyle = RED;
      g.textAlign = "center";
      g.fillText("RUGGED", 0, 34);
      g.restore();
      g.globalAlpha = 1;
    }
  } else if (t < 6.5) {
    const s = t - 4.5;
    // The drop: a white flash.
    if (s < 0.15) {
      g.fillStyle = `rgba(237,237,239,${1 - s / 0.15})`;
      g.fillRect(0, 0, W, H);
    }
    fitted(g, v.name, 230, 64, EMERALD);
    centered(g, "checked Kixo first", 300, 52, TEXT, 800);
    chart(g, ease(s / 1.4), true, t);
    // Rug check badge.
    const k = ease((s - 0.6) / 0.3);
    g.globalAlpha = k;
    g.fillStyle = "rgba(47,211,138,0.12)";
    g.strokeStyle = EMERALD;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(W / 2 - 200, 960, 400, 90, 20);
    g.fill();
    g.stroke();
    centered(g, "rug check: passed", 1018, 36, EMERALD, 700, true);
    g.globalAlpha = 1;
  } else if (t < 7.8) {
    const s = t - 6.5;
    const k = ease(s / 0.35);
    // The pass slides up.
    g.save();
    g.translate(0, (1 - k) * 220);
    g.globalAlpha = k;
    g.fillStyle = "#121316";
    g.strokeStyle = EMERALD;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(80, 380, W - 160, 470, 36);
    g.fill();
    g.stroke();
    g.textAlign = "left";
    g.font = font(30, 600, true);
    g.fillStyle = EMERALD;
    g.fillText("EARLY ACCESS", 130, 450);
    g.font = font(34, 600);
    g.fillStyle = MUTED;
    g.fillText("Kixo waitlist", 130, 560);
    g.font = font(150, 800, true);
    g.fillStyle = TEXT;
    g.fillText(`#${v.position.toLocaleString("en-US")}`, 122, 700);
    g.font = font(36, 700);
    g.fillStyle = EMERALD;
    g.fillText(v.tier, 130, 790);
    g.restore();
    g.globalAlpha = 1;
    centered(g, "locked in", 1000, 52, TEXT, 800);
  } else {
    const s = t - 7.8;
    const k = ease(s / 0.3);
    g.globalAlpha = k;
    centered(g, "Get your pass", 470, 76, TEXT, 800);
    centered(g, "AI agent free for 1 year", 550, 40, EMERALD, 700);
    g.fillStyle = "#121316";
    g.beginPath();
    g.roundRect(56, 640, W - 112, 120, 24);
    g.fill();
    let size = 40;
    g.font = font(size, 600, true);
    const url = v.link.replace(/^https?:\/\//, "");
    while (g.measureText(url).width > W - 160 && size > 20) {
      size -= 2;
      g.font = font(size, 600, true);
    }
    centered(g, url, 714, size, "#22d3ee", 600, true);
    centered(g, `code ${v.code.toUpperCase()}`, 860, 40, EMERALD, 700, true);
    g.globalAlpha = 1;
  }

  // Kixo's mark and the link on every frame.
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "rgba(5,5,6,0.6)";
  g.fillRect(0, H - 110, W, 110);
  if (mark) g.drawImage(mark, 48, H - 86, 52, 52);
  g.textAlign = "left";
  g.font = font(40, 700);
  g.fillStyle = TEXT;
  g.fillText("Kixo", 114, H - 46);
  g.textAlign = "right";
  g.font = font(24, 500, true);
  g.fillStyle = MUTED;
  g.fillText(v.link.replace(/^https?:\/\//, "").split("/?")[0], W - 48, H - 50);
}

/* ---------------- The founder's video with the person's code on it ---------------- */

/** The shared video everyone posts (public/share/base.mp4). Without it, the made-up edit
 *  above is used instead. */
const BASE_VIDEO = "/share/base.mp4";
/** Longest video recorded, in seconds. */
const MAX_BASE = 60;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** The bands over the shared video: Kixo and the person's code on top, their name and link
 *  below. They slide in, the link types itself out, and a sheen crosses the code every
 *  few seconds so the eye goes to it. */
function overlay(g: CanvasRenderingContext2D, t: number, v: VideoInfo, mark: HTMLImageElement | null, w: number, h: number) {
  const u = w / 720;
  const inTop = ease(t / 0.45);
  const inBottom = ease((t - 0.15) / 0.5);

  // Top band.
  const topH = 118 * u;
  const ty = -topH * (1 - inTop);
  g.fillStyle = "rgba(5,5,6,0.84)";
  g.fillRect(0, ty, w, topH);
  g.fillStyle = EMERALD;
  g.fillRect(0, ty + topH - 3 * u, w * inTop, 3 * u);
  if (mark) g.drawImage(mark, 32 * u, ty + 33 * u, 50 * u, 50 * u);
  g.textAlign = "left";
  g.font = font(38 * u, 800);
  g.fillStyle = TEXT;
  g.fillText("Kixo", 94 * u, ty + 72 * u);
  // The code chip.
  const label = `CODE ${v.code.toUpperCase()}`;
  g.font = font(30 * u, 700, true);
  const cw = g.measureText(label).width + 40 * u;
  const cx = w - 32 * u - cw;
  const cy = ty + 30 * u;
  const ch = 56 * u;
  g.save();
  roundRect(g, cx, cy, cw, ch, 14 * u);
  g.fillStyle = "rgba(47,211,138,0.16)";
  g.fill();
  g.lineWidth = 2.5 * u;
  g.strokeStyle = EMERALD;
  g.stroke();
  g.clip();
  const sweep = (t % 3) / 0.7;
  if (sweep < 1) {
    const sx = cx - 80 * u + (cw + 160 * u) * sweep;
    const grad = g.createLinearGradient(sx - 60 * u, 0, sx + 60 * u, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(cx, cy, cw, ch);
  }
  g.restore();
  g.font = font(30 * u, 700, true);
  g.fillStyle = EMERALD;
  g.fillText(label, cx + 20 * u, cy + 38 * u);

  // Bottom band.
  const botH = 210 * u;
  const by = h - botH * inBottom;
  g.fillStyle = "rgba(5,5,6,0.86)";
  g.fillRect(0, by, w, botH);
  g.fillStyle = EMERALD;
  g.fillRect(0, by, w * inBottom, 3 * u);
  g.textAlign = "left";
  g.font = font(40 * u, 800);
  g.fillStyle = TEXT;
  g.fillText("Join me on Kixo", 32 * u, by + 62 * u);
  if (v.handle) {
    g.textAlign = "right";
    g.font = font(34 * u, 800);
    g.fillStyle = EMERALD;
    g.fillText(v.handle, w - 32 * u, by + 62 * u);
  }
  // The link types itself out.
  const url = v.link.replace(/^https?:\/\//, "");
  const shown = url.slice(0, Math.ceil(url.length * ease((t - 0.5) / 1.2)));
  let size = 34 * u;
  g.font = font(size, 700, true);
  while (g.measureText(url).width > w - 64 * u && size > 16 * u) {
    size -= 1;
    g.font = font(size, 700, true);
  }
  g.textAlign = "left";
  g.fillStyle = "#22d3ee";
  g.fillText(shown + (Math.floor(t * 2) % 2 === 0 && shown.length < url.length ? "_" : ""), 32 * u, by + 118 * u);
  g.font = font(26 * u, 600);
  g.fillStyle = MUTED;
  g.fillText(`AI agent free for 1 year · use my code ${v.code.toUpperCase()}`, 32 * u, by + 168 * u);
}

/** Draws the video to fill the canvas (cropping the edges if its shape differs). */
function cover(g: CanvasRenderingContext2D, el: HTMLVideoElement, w: number, h: number) {
  const s = Math.max(w / el.videoWidth, h / el.videoHeight);
  const dw = el.videoWidth * s;
  const dh = el.videoHeight * s;
  g.fillStyle = "#050506";
  g.fillRect(0, 0, w, h);
  g.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/* ---------------- Recording ---------------- */

function pickType(): { mime: string; ext: string } {
  const list = [
    { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  return list.find((x) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(x.mime)) ?? { mime: "", ext: "webm" };
}

/** The caption that goes with the video: the code and the link, ready to paste. */
export function captionFor(v: VideoInfo) {
  return `I'm on the Kixo waitlist: the AI that trades Solana memecoins for you. Use my code ${v.code.toUpperCase()} or join with my link: ${v.link}`;
}

type Mode = "checking" | "base" | "edit";

export function VideoMaker({ info, onClose }: { info: VideoInfo; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mark = useRef<HTMLImageElement | null>(null);
  const base = useRef<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<Mode>("checking");
  const [size, setSize] = useState({ w: W, h: H });
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "rec"; left: number } | { kind: "done"; url: string; file: File } | { kind: "error"; text: string }>({ kind: "idle" });

  // Kixo's mark, then the shared video if there is one; the preview frame follows.
  useEffect(() => {
    let gone = false;
    const img = new Image();
    img.src = "/kixo-mark.png";
    img.onload = () => (mark.current = img);
    const el = document.createElement("video");
    el.src = BASE_VIDEO;
    el.playsInline = true;
    el.preload = "auto";
    el.onloadeddata = () => {
      if (gone) return;
      const scale = Math.min(1, 1280 / Math.max(el.videoWidth, el.videoHeight));
      base.current = el;
      setSize({ w: Math.round((el.videoWidth * scale) / 2) * 2, h: Math.round((el.videoHeight * scale) / 2) * 2 });
      setMode("base");
      el.currentTime = Math.min(1.5, (el.duration || 2) / 2);
    };
    el.onerror = () => !gone && setMode("edit");
    return () => {
      gone = true;
      el.removeAttribute("src");
    };
  }, []);

  // The preview frame.
  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g || mode === "checking" || state.kind !== "idle") return;
    const draw = () => {
      if (mode === "base" && base.current) {
        cover(g, base.current, size.w, size.h);
        overlay(g, 2.5, info, mark.current, size.w, size.h);
      } else frame(g, 1.6, info, mark.current);
    };
    draw();
    const el = base.current;
    el?.addEventListener("seeked", draw);
    const id = setTimeout(draw, 400);
    return () => {
      el?.removeEventListener("seeked", draw);
      clearTimeout(id);
    };
  }, [mode, size, info, state.kind]);

  useEffect(() => () => (state.kind === "done" ? URL.revokeObjectURL(state.url) : undefined), [state]);

  const record = async () => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g || typeof MediaRecorder === "undefined") return setState({ kind: "error", text: "This browser cannot make videos. Try Chrome or Safari" });
    const type = pickType();
    const ctx = new AudioContext();
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    const el = mode === "base" ? base.current : null;
    let length = LENGTH;
    if (el) {
      // The shared video's own sound goes into the recording (and to the speakers).
      const src = ctx.createMediaElementSource(el);
      src.connect(dest);
      src.connect(ctx.destination);
      el.muted = false;
      el.currentTime = 0;
      length = Math.min(MAX_BASE, el.duration || MAX_BASE);
    } else {
      const out = ctx.createGain();
      out.gain.value = 0.8;
      out.connect(dest);
      out.connect(ctx.destination);
      scheduleBeat(ctx, out, ctx.currentTime + 0.1);
    }
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { ...(type.mime ? { mimeType: type.mime } : {}), videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      el?.pause();
      void ctx.close();
      const blob = new Blob(chunks, { type: type.mime.split(";")[0] || "video/webm" });
      const file = new File([blob], `kixo-${info.code}.${type.ext}`, { type: blob.type });
      setState({ kind: "done", url: URL.createObjectURL(blob), file });
    };
    rec.start(250);
    const t0 = performance.now() + (el ? 0 : 100);
    if (el) await el.play().catch(() => {});
    let stopped = false;
    const stop = () => {
      if (!stopped) {
        stopped = true;
        rec.stop();
      }
    };
    if (el) el.onended = stop;
    const tick = () => {
      if (stopped) return;
      const t = el ? el.currentTime : (performance.now() - t0) / 1000;
      if (t >= length - 0.02) return stop();
      if (el) {
        cover(g, el, size.w, size.h);
        overlay(g, t, info, mark.current, size.w, size.h);
      } else frame(g, Math.max(0, t), info, mark.current);
      setState({ kind: "rec", left: Math.max(1, Math.ceil(length - t)) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const caption = captionFor(info);
  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const share = async () => {
    if (state.kind !== "done") return;
    // The caption is copied too: apps that drop shared text (TikTok, Instagram) can paste it.
    void copyCaption();
    if (navigator.canShare?.({ files: [state.file] })) {
      try {
        await navigator.share({ files: [state.file], text: caption });
        return;
      } catch {}
    }
    const a = document.createElement("a");
    a.href = state.url;
    a.download = state.file.name;
    a.click();
  };

  return (
    <div className="vm" role="dialog" aria-modal="true" aria-label="Your share video" onClick={onClose}>
      <div className="vm-box" onClick={(e) => e.stopPropagation()}>
        <div className="vm-head">
          <p>Your share video</p>
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="vm-stage" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
          {state.kind === "done" ? <video src={state.url} controls autoPlay loop playsInline /> : <canvas ref={canvas} width={size.w} height={size.h} />}
        </div>
        {state.kind === "idle" && (
          <button type="button" className="btn-primary" onClick={record} disabled={mode === "checking"}>
            Make my video
          </button>
        )}
        {state.kind === "rec" && <p className="vm-note">Making your video, {state.left}s left. Keep this tab open</p>}
        {state.kind === "error" && <p className="note bad">{state.text}</p>}
        {state.kind === "done" && (
          <div className="vm-actions">
            <button type="button" className="btn-primary" onClick={share}>
              Share video
            </button>
            <a className="btn-ghost" href={state.url} download={state.file.name}>
              Download
            </a>
            <a className="btn-ghost" href={`https://x.com/intent/post?text=${encodeURIComponent(caption)}`} target="_blank" rel="noopener noreferrer">
              Post on X
            </a>
          </div>
        )}
        <div className="caption">
          <p>{caption}</p>
          <button type="button" className="link" onClick={copyCaption}>
            {copied ? "Caption copied: paste it with your video" : "Copy caption"}
          </button>
        </div>
        <p className="vm-note">Your code and link are on the video and in the caption. Every friend who joins with them moves you up and is a ticket in the gift draw</p>
      </div>
    </div>
  );
}
