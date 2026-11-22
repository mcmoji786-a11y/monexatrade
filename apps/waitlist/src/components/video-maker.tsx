"use client";
/* The share video: a 9 second vertical edit (TikTok, Reels, Shorts, X) made in the
   browser from the person's own name, place and invite link, with a beat made on the spot
   (Web Audio, so no music rights). Drawn on a canvas and recorded with MediaRecorder; MP4
   where the browser can record it, WebM otherwise. Kixo's mark and the link stay on every
   frame, so wherever it travels it points back to the waitlist. */

import { useEffect, useRef, useState } from "react";

export type VideoInfo = { name: string; position: number; tier: string; link: string };

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
    centered(g, "link in bio", 860, 34, MUTED, 600, true);
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

export function VideoMaker({ info, onClose }: { info: VideoInfo; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mark = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "rec"; left: number } | { kind: "done"; url: string; file: File } | { kind: "error"; text: string }>({ kind: "idle" });

  // The first frame shows straight away, as a preview.
  useEffect(() => {
    const img = new Image();
    img.src = "/kixo-mark.png";
    img.onload = () => {
      mark.current = img;
      const g = canvas.current?.getContext("2d");
      if (g) frame(g, 1.6, info, img);
    };
  }, [info]);

  useEffect(() => () => (state.kind === "done" ? URL.revokeObjectURL(state.url) : undefined), [state]);

  const record = async () => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g || typeof MediaRecorder === "undefined") return setState({ kind: "error", text: "This browser cannot make videos. Try Chrome or Safari" });
    const type = pickType();
    const ctx = new AudioContext();
    await ctx.resume();
    const out = ctx.createGain();
    out.gain.value = 0.8;
    const dest = ctx.createMediaStreamDestination();
    out.connect(dest);
    out.connect(ctx.destination);
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { ...(type.mime ? { mimeType: type.mime } : {}), videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      void ctx.close();
      const blob = new Blob(chunks, { type: type.mime.split(";")[0] || "video/webm" });
      const file = new File([blob], `kixo-${info.name.replace(/[^a-z0-9_]/gi, "") || "pass"}.${type.ext}`, { type: blob.type });
      setState({ kind: "done", url: URL.createObjectURL(blob), file });
    };
    const start = ctx.currentTime + 0.1;
    scheduleBeat(ctx, out, start);
    rec.start(250);
    const t0 = performance.now() + 100;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= LENGTH) {
        rec.stop();
        return;
      }
      frame(g, Math.max(0, t), info, mark.current);
      setState({ kind: "rec", left: Math.ceil(LENGTH - t) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const share = async () => {
    if (state.kind !== "done") return;
    const text = `I'm #${info.position.toLocaleString("en-US")} on the Kixo waitlist. Get your pass: ${info.link}`;
    if (navigator.canShare?.({ files: [state.file] })) {
      try {
        await navigator.share({ files: [state.file], text });
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
        <div className="vm-stage">{state.kind === "done" ? <video src={state.url} controls autoPlay loop playsInline /> : <canvas ref={canvas} width={W} height={H} />}</div>
        {state.kind === "idle" && (
          <button type="button" className="btn-primary" onClick={record}>
            Make my video
          </button>
        )}
        {state.kind === "rec" && <p className="vm-note">Making your video, {state.left}s. Keep this tab open</p>}
        {state.kind === "error" && <p className="note bad">{state.text}</p>}
        {state.kind === "done" && (
          <div className="vm-actions">
            <button type="button" className="btn-primary" onClick={share}>
              Share video
            </button>
            <a className="btn-ghost" href={state.url} download={state.file.name}>
              Download
            </a>
            <a className="btn-ghost" href={`https://x.com/intent/post?text=${encodeURIComponent(`I'm #${info.position.toLocaleString("en-US")} on the Kixo waitlist. The AI that trades memecoins for you`)}&url=${encodeURIComponent(info.link)}`} target="_blank" rel="noopener noreferrer">
              Post on X
            </a>
          </div>
        )}
        <p className="vm-note">Post it on TikTok, Reels, Shorts or X with your link. Every friend who joins with it moves you up and is a ticket in the gift draw</p>
      </div>
    </div>
  );
}
