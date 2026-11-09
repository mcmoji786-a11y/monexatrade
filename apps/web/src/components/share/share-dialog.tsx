"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, ImageIcon, Loader2, Send, Share2, Volume2, VolumeX, X } from "lucide-react";
import { pushToast } from "@/lib/toast";
import { refLink, useReferral } from "@/lib/growth";
import { useFeatures } from "@/lib/features";
import { BACKGROUNDS, drawCover, findVideos, fonts, H, loadImage, paintFooter, paintFrame, toBlob, W, type Fonts, type Label } from "./canvas";

/** A background: a video from public/share/videos (with its music) or a photo. */
type Bg = { kind: "video" | "image"; src: string };
/** Longest video a card download records. */
const MAX_RECORD_SECS = 12;
const MUTE_KEY = "kixo.share.muted";

export type Paint = (g: CanvasRenderingContext2D, f: Fonts, extra: HTMLImageElement | null) => void;

/** One share card in a dialog: the image (download, copy) and posts to X, Reddit and
 *  Telegram. Every post link carries the sharer's referral code. */
export function ShareDialog({
  title,
  text,
  fileName,
  label,
  footLeft,
  seed,
  paint,
  paintKey,
  extra,
  onClose,
}: {
  title: string;
  /** The post text (the link is added after it). */
  text: string;
  fileName: string;
  label: Label;
  footLeft: string;
  /** Picks the first background. */
  seed: number;
  paint: Paint;
  /** Changes when what is drawn changes. */
  paintKey: string;
  /** One more image the card draws, e.g. the coin logo. */
  extra?: () => Promise<HTMLImageElement | null>;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Ready once the current background and card are drawn.
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [bgs, setBgs] = useState<Bg[] | null>(null);
  const [bgIndex, setBgIndex] = useState(0);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [recording, setRecording] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const audio = useRef<{ ctx: AudioContext; gain: GainNode; dest: MediaStreamAudioDestinationNode } | null>(null);
  useEffect(() => {
    let alive = true;
    findVideos().then((vids) => {
      if (!alive) return;
      const list: Bg[] = [...vids.map((src) => ({ kind: "video" as const, src })), ...BACKGROUNDS.map((src) => ({ kind: "image" as const, src }))];
      const pick = Math.abs(Math.floor(seed) || 0);
      setBgs(list);
      setBgIndex(vids.length ? pick % vids.length : vids.length + (pick % BACKGROUNDS.length));
    });
    return () => {
      alive = false;
    };
  }, [seed]);
  const bg = bgs?.[bgIndex] ?? null;
  const ref = useReferral();
  const refOn = useFeatures().referrals;
  const site = ref && refOn ? refLink(ref.code) : typeof window === "undefined" ? "" : window.location.origin;
  const { text: labelText, tone: labelTone } = label;
  const drawKey = bg ? `${bg.src}|${paintKey}|${site}` : "";
  const ready = readyKey === drawKey;
  const mutedRef = useRef(muted);
  const paintRef = useRef(paint);
  const extraRef = useRef(extra);
  useEffect(() => {
    paintRef.current = paint;
    extraRef.current = extra;
  });

  useEffect(() => {
    if (!bg) return;
    let alive = true;
    let frame = 0;
    let v: HTMLVideoElement | null = null;
    Promise.all([document.fonts.ready, bg.kind === "image" ? loadImage(bg.src) : Promise.resolve(null), loadImage("/brand/kixo-mark.png"), extraRef.current?.() ?? Promise.resolve(null)]).then(([, img, mark, more]) => {
      const c = canvas.current;
      if (!alive || !c) return;
      c.width = W;
      c.height = H;
      const g = c.getContext("2d")!;
      const f = fonts();
      const label = { text: labelText, tone: labelTone };
      if (bg.kind === "image") {
        paintFrame(g, img, mark, label, f);
        paintRef.current(g, f, more);
        paintFooter(g, footLeft, site, f);
        setReadyKey(drawKey);
        return;
      }
      // The card drawn once on a transparent layer; the video plays under it.
      const overlay = document.createElement("canvas");
      overlay.width = W;
      overlay.height = H;
      const og = overlay.getContext("2d")!;
      paintFrame(og, null, mark, label, f, true);
      paintRef.current(og, f, more);
      paintFooter(og, footLeft, site, f);
      v = document.createElement("video");
      v.src = bg.src;
      v.loop = true;
      v.playsInline = true;
      v.preload = "auto";
      video.current = v;
      // Sound goes through Web Audio: one gain for mute, and a copy for recording.
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaElementSource(v);
        const gain = ctx.createGain();
        const dest = ctx.createMediaStreamDestination();
        gain.gain.value = mutedRef.current ? 0 : 1;
        src.connect(gain).connect(ctx.destination);
        src.connect(dest);
        audio.current = { ctx, gain, dest };
        ctx.resume().catch(() => {});
      } catch {
        v.muted = true;
      }
      v.play().catch(() => {
        // Autoplay with sound was refused: play silently, the speaker button turns it on.
        if (audio.current) audio.current.gain.gain.value = 0;
        setMuted(true);
        v?.play().catch(() => {});
      });
      const draw = () => {
        if (!alive) return;
        g.clearRect(0, 0, W, H);
        g.fillStyle = "#08090a";
        g.fillRect(0, 0, W, H);
        if (v && v.readyState >= 2) drawCover(g, v);
        g.drawImage(overlay, 0, 0);
        frame = requestAnimationFrame(draw);
      };
      draw();
      v.addEventListener("loadeddata", () => alive && setReadyKey(drawKey), { once: true });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
      audio.current?.ctx.close().catch(() => {});
      audio.current = null;
      video.current = null;
    };
  }, [bg, drawKey, site, labelText, labelTone, footLeft]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  useEffect(() => {
    mutedRef.current = muted;
    if (audio.current) {
      audio.current.ctx.resume().catch(() => {});
      audio.current.gain.gain.value = muted ? 0 : 1;
    }
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {}
  }, [muted]);

  /** Records the card with its video and music (up to MAX_RECORD_SECS) as MP4 where the
   *  browser can, otherwise WebM. */
  async function recordVideo() {
    const c = canvas.current;
    const v = video.current;
    if (!c || !v) return;
    const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    const type = types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    if (!type) {
      pushToast({ tone: "bad", title: "This browser cannot record video", body: "Download the image instead" });
      return;
    }
    const stream = c.captureStream(30);
    audio.current?.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const secs = Math.max(3, Math.min(MAX_RECORD_SECS, Number.isFinite(v.duration) ? v.duration : MAX_RECORD_SECS));
    v.currentTime = 0;
    await v.play().catch(() => {});
    rec.start(250);
    for (let t = 0; t < secs; t++) {
      setRecording(Math.ceil(secs - t));
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
    setRecording(null);
    const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(new Blob(chunks, { type: type.split(";")[0] }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.png$/, `.${ext}`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    if (ext === "webm") pushToast({ tone: "info", title: "Saved as WebM", body: "X takes MP4: convert it, or post on Telegram and Reddit as is" });
  }

  const file = async () => new File([await toBlob(canvas.current!)], fileName, { type: "image/png" });

  async function download() {
    if (bg?.kind === "video") return recordVideo();
    const url = URL.createObjectURL(await file());
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
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
            {title}
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
          {bg?.kind === "video" && (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Turn sound on" : "Turn sound off"}
              className="absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
            >
              {muted ? <VolumeX size={16} strokeWidth={1.5} /> : <Volume2 size={16} strokeWidth={1.5} />}
            </button>
          )}
          {recording != null && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
              <span className="size-2 animate-pulse rounded-full bg-negative" /> Recording · {recording}s
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
          <Btn onClick={download} disabled={!ready || recording != null}>
            <Download size={16} strokeWidth={1.5} /> {bg?.kind === "video" ? "Download video" : "Download"}
          </Btn>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span>The image is copied when you post, paste it into the post</span>
          <div className="flex shrink-0 gap-3">
            <button type="button" onClick={() => bgs && setBgIndex((i) => (i + 1) % bgs.length)} disabled={!ready} className="flex items-center gap-1 text-text-2 hover:text-text">
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
