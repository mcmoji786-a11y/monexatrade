"use client";
/* Welcome tour: a one-minute walk through Kixo on the real screen. Each step dims the
   page, lights up the part it talks about (a sidebar link, the search, Demo/Real) and
   explains it in a card with its icon. It starts once for a new signed-in user, after
   any setup dialog has closed, and can be replayed from Settings (startTour). Steps
   whose part of the screen is not there (a page switched off) are skipped; on a phone,
   where the sidebar is hidden, the card shows in the middle. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, MousePointerClick, Search, Wallet, X, type LucideIcon } from "lucide-react";
import { AiWords, CommunityPeople, DemoCount, FirstSteps, RadarLive, SearchTry, SniperRule } from "./tour-previews";
import { KixoMark } from "@/components/brand";
import { useAccount } from "@/lib/account";
import { useFeatures } from "@/lib/features";
import { NAV_GROUPS } from "@/lib/nav";

const DONE_KEY = "kixo.tour.v1";
const EVENT = "kixo:tour";

/** Opens the tour from anywhere (Settings has the button). */
export function startTour() {
  window.dispatchEvent(new Event(EVENT));
}

type Extra = "demo" | "search" | "radar" | "ai" | "sniper" | "community";
type Step = { anchor: string | null; icon: LucideIcon | "brand"; title: string; body: string; extra?: Extra };

const navIcon = (slug: string): LucideIcon => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.slug === slug)?.icon ?? Check;

const STEPS: Step[] = [
  { anchor: null, icon: "brand", title: "Welcome to Kixo", body: "A trading terminal for new Solana coins. This tour shows you around in about a minute" },
  { anchor: "account", icon: Wallet, title: "Demo first", body: "Virtual money at live prices, so you can learn without risk. Switch to Real when you are ready", extra: "demo" },
  { anchor: "search", icon: Search, title: "Find any coin", body: "Type a name or paste a contract address to open its trade page", extra: "search" },
  { anchor: "nav-discover", icon: navIcon("discover"), title: "Discover", body: "Trending coins with price, volume and safety at a glance. Tap a row to trade it" },
  { anchor: "nav-radar", icon: navIcon("radar"), title: "Sol Radar", body: "New coins the second they launch, each with a safety score and the risk checks behind it", extra: "radar" },
  { anchor: "nav-ai", icon: navIcon("ai"), title: "Kixo AI", body: "One word per coin, from a model trained on thousands of launches. Ask it anything about Solana too", extra: "ai" },
  { anchor: "nav-sniper", icon: navIcon("sniper"), title: "Sniper", body: "Rules that buy new coins for you and sell them on your terms", extra: "sniper" },
  { anchor: "nav-smart-money", icon: navIcon("smart-money"), title: "Smart Money", body: "Wallets that keep making money. Watch them, or copy their trades on demo" },
  { anchor: "nav-wallets", icon: navIcon("wallets"), title: "Wallet Monitor", body: "Follow any wallet. Its buys and sells reach you here, or by Email, Telegram and Discord" },
  { anchor: "nav-community", icon: navIcon("community"), title: "Community", body: "Follow Kixo traders, watch their trades live and copy one with a tap. Your profile is ready", extra: "community" },
  { anchor: "nav-portfolio", icon: navIcon("portfolio"), title: "Portfolio", body: "Your coins, profit and loss, and your Kixo wallet in one place" },
  { anchor: "nav-settings", icon: navIcon("settings"), title: "Settings", body: "Alerts outside Kixo, trading defaults, and this tour again whenever you want it" },
  { anchor: null, icon: Check, title: "You are set", body: "Three good first moves. Pick one" },
];

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_W = 340;

function find(anchor: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
}
function visible(el: HTMLElement | null) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}
function done() {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true;
  }
}
function markDone() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {}
}

export function ProductTour() {
  const f = useFeatures();
  const auth = useAccount();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vw, setVw] = useState(0);
  const next = useRef<HTMLButtonElement>(null);

  // Steps whose part of the screen exists (a page switched off has no link).
  const steps = useMemo(() => (open ? STEPS.filter((s) => !s.anchor || find(s.anchor)) : STEPS), [open]);
  const step = steps[Math.min(i, steps.length - 1)];

  const close = useCallback(() => {
    markDone();
    setOpen(false);
  }, []);

  // Replay from Settings.
  useEffect(() => {
    const go = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(EVENT, go);
    return () => window.removeEventListener(EVENT, go);
  }, []);

  // First visit after signing up: wait until setup dialogs (terms, wallet) are closed.
  useEffect(() => {
    if (!f.tour || auth.status !== "signed-in" || open || done()) return;
    let calm = 0;
    const id = setInterval(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      calm = dialog ? 0 : calm + 1;
      // Two quiet seconds in a row, so the page has settled.
      if (calm >= 2) {
        clearInterval(id);
        setI(0);
        setOpen(true);
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [f.tour, auth.status, open]);

  // Follow the lit part of the screen as the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      setVw(window.innerWidth);
      const el = step.anchor ? find(step.anchor) : null;
      const r = visible(el);
      setBox(r ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null);
    };
    const el = step.anchor ? find(step.anchor) : null;
    el?.scrollIntoView({ block: "nearest" });
    measure();
    const id = setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [open, step]);

  useEffect(() => {
    if (open) next.current?.focus();
  }, [open, i]);

  const last = i >= steps.length - 1;
  const forward = useCallback(() => (last ? close() : setI((n) => n + 1)), [last, close]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") forward();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, close, forward, back]);

  if (!open || !f.tour) return null;

  // Where the card goes: beside a sidebar link, under a top-bar part, or centred.
  let card: React.CSSProperties;
  if (!box) card = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  else if (box.left + box.width + 16 + CARD_W < vw && box.left < 320) card = { top: Math.max(16, Math.min(box.top - 8, window.innerHeight - 460)), left: box.left + box.width + 16 };
  else card = { top: box.top + box.height + 12, left: Math.max(16, Math.min(box.left + box.width - CARD_W, vw - CARD_W - 16)) };

  const Icon = step.icon;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Kixo tour">
      {/* The dim layer, with a hole over the part being explained. */}
      {box ? (
        <div className="tour-glide pointer-events-none fixed rounded-xl border border-emerald/60" style={{ ...box, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.66)" }}>
          <div key={i} className="tour-ring absolute inset-0 rounded-xl" />
        </div>
      ) : (
        <div className="fixed inset-0 bg-black/70" />
      )}
      {/* Clicks outside the card do nothing, so the tour is not lost by accident. */}
      <div className="fixed inset-0" />
      {/* A lit sidebar link can be clicked: it opens that page and the tour goes on. */}
      {box && step.anchor?.startsWith("nav-") && (
        <button
          type="button"
          aria-label={`Open ${step.title}`}
          className="fixed cursor-pointer rounded-xl"
          style={box}
          onClick={() => {
            find(step.anchor ?? "")?.click();
            forward();
          }}
        />
      )}

      <section key={i} className="fade-up fixed w-[min(340px,calc(100vw-32px))] rounded-2xl border border-border bg-surface p-5" style={card}>
        <div className="flex items-start justify-between gap-3">
          <span className="tour-pop flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-2">
            {Icon === "brand" ? <KixoMark size={22} /> : <Icon size={18} strokeWidth={1.5} className="text-emerald" />}
          </span>
          <button type="button" onClick={close} aria-label="Close tour" className="text-muted hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <h2 className="mt-4 text-base font-medium text-text">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-6 text-text-2">{step.body}</p>
        {box && step.anchor?.startsWith("nav-") && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <MousePointerClick size={13} strokeWidth={1.5} />
            Click it to take a look, the tour goes on
          </p>
        )}
        {step.extra && (
          <div className="mt-4">
            {step.extra === "demo" ? <DemoCount /> : step.extra === "search" ? <SearchTry onDone={forward} /> : step.extra === "radar" ? <RadarLive /> : step.extra === "ai" ? <AiWords /> : step.extra === "sniper" ? <SniperRule /> : <CommunityPeople />}
          </div>
        )}
        {last && (
          <div className="mt-4">
            <FirstSteps onPick={close} />
          </div>
        )}

        {/* Progress: one segment per step, the done ones in the accent. */}
        <div className="mt-5 flex gap-1" aria-hidden="true">
          {steps.map((_, n) => (
            <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${n <= i ? "bg-emerald" : "bg-surface-3"}`} />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <span className="whitespace-nowrap font-mono text-xs text-muted">
              {i + 1} of {steps.length}
            </span>
          )}
          {!last && i > 0 && (
            <button type="button" onClick={close} className="ml-2 text-xs text-muted hover:text-text">
              Skip
            </button>
          )}
          <div className="ml-auto flex gap-2">
            {i > 0 && !last && (
              <button type="button" onClick={back} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-2 hover:bg-surface-2 hover:text-text">
                <ArrowLeft size={14} strokeWidth={1.5} />
              </button>
            )}
            {last ? (
              <button ref={next} type="button" onClick={close} className="h-9 rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90">
                Done
              </button>
            ) : (
              <button ref={next} type="button" onClick={forward} className="flex h-9 items-center gap-1.5 rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90">
                {i === 0 ? "Show me" : "Next"}
                <ArrowRight size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
        {i === 0 && (
          <button type="button" onClick={close} className="mt-3 text-xs text-muted hover:text-text">
            Not now
          </button>
        )}
      </section>
    </div>
  );
}
