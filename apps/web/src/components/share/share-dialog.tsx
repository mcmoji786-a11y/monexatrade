"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, ImageIcon, Loader2, Send, Share2, X } from "lucide-react";
import { pushToast } from "@/lib/toast";
import { refLink, useReferral } from "@/lib/growth";
import { useFeatures } from "@/lib/features";
import { BACKGROUNDS, fonts, loadImage, paintFooter, paintFrame, toBlob, type Fonts, type Label } from "./canvas";

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
  const [ready, setReady] = useState(false);
  const [bgIndex, setBgIndex] = useState(() => Math.abs(Math.floor(seed) || 0) % BACKGROUNDS.length);
  const ref = useReferral();
  const refOn = useFeatures().referrals;
  const site = ref && refOn ? refLink(ref.code) : typeof window === "undefined" ? "" : window.location.origin;
  const { text: labelText, tone: labelTone } = label;
  const paintRef = useRef(paint);
  const extraRef = useRef(extra);
  useEffect(() => {
    paintRef.current = paint;
    extraRef.current = extra;
  });

  useEffect(() => {
    let alive = true;
    Promise.all([document.fonts.ready, loadImage(BACKGROUNDS[bgIndex]), loadImage("/brand/kixo-mark.png"), extraRef.current?.() ?? Promise.resolve(null)]).then(([, bg, mark, more]) => {
      const c = canvas.current;
      if (!alive || !c) return;
      c.width = 1200;
      c.height = 675;
      const g = c.getContext("2d")!;
      const f = fonts();
      paintFrame(g, bg, mark, { text: labelText, tone: labelTone }, f);
      paintRef.current(g, f, more);
      paintFooter(g, footLeft, site, f);
      setReady(true);
    });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      alive = false;
      window.removeEventListener("keydown", esc);
    };
  }, [paintKey, onClose, bgIndex, site, labelText, labelTone, footLeft]);

  const file = async () => new File([await toBlob(canvas.current!)], fileName, { type: "image/png" });

  async function download() {
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
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
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
