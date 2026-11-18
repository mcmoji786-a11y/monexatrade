"use client";
/* Landing: three real screen recordings of Kixo (Sol Radar, Kixo AI analysis, the demo
   account), recorded from the app itself (E:/KixoData/tools/shots/record.mjs). One plays
   at a time, muted; when it ends the next one starts. With reduced motion nothing plays
   by itself: the poster shows and a press plays it. */
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { Reveal } from "./reveal";

const CLIPS = [
  {
    key: "radar",
    step: "01",
    title: "Spot it the second it launches",
    body: "Sol Radar shows every new Solana coin as it lands, with holders, dev share, bundles and early buyers on each card.",
    path: "kixo · Sol Radar",
  },
  {
    key: "ai",
    step: "02",
    title: "Ask Kixo AI before you buy",
    body: "One press gives a quick take, the good and the bad with real numbers, the next-hour odds and a plain call.",
    path: "kixo · Kixo AI analysis",
  },
  {
    key: "demo",
    step: "03",
    title: "Practise with $10,000 of demo money",
    body: "Trade the live market with the same fees and price impact as a real trade. Every day lands on your profit calendar.",
    path: "kixo · Portfolio, demo",
  },
] as const;

export function ProductTour() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Set once the viewer presses play: then it plays even with reduced motion.
  const [pressed, setPressed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Plays only while on screen, and with reduced motion only once pressed.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (visible && (pressed || !reduce)) v.play().catch(() => {});
    else v.pause();
  }, [visible, pressed, i]);

  const pick = (n: number) => {
    setI(n);
    setPressed(true);
  };
  const c = CLIPS[i];

  return (
    <section id="product" className="scroll-mt-20 border-y border-border bg-surface">
      <div className="mx-auto max-w-300 px-4 py-24 md:px-8">
        <Reveal>
          <div className="max-w-2xl">
            <p className="font-mono text-xs text-emerald">The product</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight text-text md:text-4xl">Three screens, recorded from the real app</h2>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
          <ol className="flex flex-col gap-2" aria-label="Product screens">
            {CLIPS.map((x, n) => (
              <li key={x.key}>
                <button
                  type="button"
                  onClick={() => pick(n)}
                  aria-pressed={n === i}
                  className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${n === i ? "border-border bg-bg" : "border-transparent hover:bg-bg/60"}`}
                >
                  <span className="flex items-baseline gap-3">
                    <span className={`font-mono text-xs ${n === i ? "text-emerald" : "text-muted"}`}>{x.step}</span>
                    <span className={`text-base ${n === i ? "text-text" : "text-text-2"}`}>{x.title}</span>
                  </span>
                  {n === i && <span className="mt-2 block pl-7 text-sm leading-6 text-text-2">{x.body}</span>}
                </button>
              </li>
            ))}
          </ol>

          <div ref={box} className="overflow-hidden rounded-2xl border border-border bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
            <div className="flex h-9 items-center gap-2 border-b border-border px-4">
              <span className="size-2.5 rounded-full bg-surface-3" />
              <span className="size-2.5 rounded-full bg-surface-3" />
              <span className="size-2.5 rounded-full bg-surface-3" />
              <span className="ml-3 font-mono text-xs text-muted">{c.path}</span>
            </div>
            <div className="relative aspect-[16/10] bg-bg">
              <video
                key={c.key}
                ref={video}
                src={`/landing/${c.key}.mp4`}
                poster={`/landing/${c.key}.jpg`}
                muted
                playsInline
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setI((n) => (n + 1) % CLIPS.length)}
                className="size-full object-cover object-top"
                aria-label={`${c.title}: screen recording`}
              />
              {!playing && (
                <button
                  type="button"
                  onClick={() => {
                    setPressed(true);
                    video.current?.play().catch(() => {});
                  }}
                  aria-label="Play"
                  className="absolute inset-0 flex items-center justify-center bg-bg/30 transition-colors hover:bg-bg/10"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-text text-bg">
                    <Play size={18} strokeWidth={1.5} />
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
