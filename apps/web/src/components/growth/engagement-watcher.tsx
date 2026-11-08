"use client";

import { useEffect } from "react";
import { useDemo } from "@/lib/demo";
import { useFeatures } from "@/lib/features";
import { useAccount } from "@/lib/account";
import { pushToast } from "@/lib/toast";
import { openShare } from "@/lib/share";
import { ACHIEVEMENTS, milestoneOf, progress, recap, weekStart, type AchievementId } from "@/lib/achievements";

/* Mounted once in the app shell. Watches the demo account and tells the user, once
   each, when an open position reaches 2x, 5x, 10x..., when an achievement is earned,
   and when last week's recap is ready. What was announced is kept per user in this
   browser, so nothing repeats after a reload. */

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v >= 1000 ? 0 : 2 })}`;

export function EngagementWatcher() {
  const { account, trades, mode } = useDemo();
  const f = useFeatures();
  const me = useAccount();
  const uid = me.status === "signed-in" ? (me.me?.id ?? null) : null;

  // 2x, 5x, 10x... on open positions (value after selling costs, so it is real).
  useEffect(() => {
    if (!f.milestone_alerts || mode !== "demo" || !uid || !account) return;
    const key = `kixo.milestones.${uid}`;
    const seen = read<Record<string, number>>(key) ?? {};
    const next: Record<string, number> = {};
    for (const p of account.positions) {
      const id = `${p.mint}:${p.opened_at}`;
      const m = milestoneOf(p.cost_usd, p.value_usd);
      next[id] = Math.max(seen[id] ?? 0, m);
      if (m > (seen[id] ?? 0) && p.value_usd != null) {
        const sym = p.symbol || p.mint.slice(0, 4);
        const milestone = { mint: p.mint, symbol: sym, multiple: m, costUsd: p.cost_usd, valueUsd: p.value_usd, entryPrice: p.tokens > 0 ? p.cost_usd / p.tokens : null, price: p.price_usd, openedAt: p.opened_at };
        pushToast({
          tone: "good",
          title: `$${sym} hit ${m}x`,
          body: `${money(p.cost_usd)} is now ${money(p.value_usd)} on your demo account`,
          figure: `${m}x`,
          href: `/token/${p.mint}`,
          action: f.share_cards ? { label: "Share", onClick: () => openShare({ kind: "milestone", m: milestone }) } : undefined,
        });
      }
    }
    write(key, next);
  }, [account, mode, uid, f.milestone_alerts, f.share_cards]);

  // Achievements: the first time they are computed in this browser, they are only
  // recorded; after that, each new one is announced.
  useEffect(() => {
    if (!f.achievements || mode !== "demo" || !uid || !trades) return;
    const key = `kixo.achievements.${uid}`;
    const seen = read<AchievementId[]>(key);
    const got = Object.keys(progress(trades).unlocked) as AchievementId[];
    if (seen) {
      for (const id of got.filter((a) => !seen.includes(a))) {
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (a) pushToast({ tone: "good", title: `Achievement: ${a.title}`, body: a.desc, href: "/portfolio" });
      }
    }
    write(key, got);
  }, [trades, mode, uid, f.achievements]);

  // Last week's recap, once a week, when there was something to recap.
  useEffect(() => {
    if (!f.weekly_recap || mode !== "demo" || !uid || !trades) return;
    const key = `kixo.recap.${uid}`;
    const week = weekStart(Date.now());
    if (read<number>(key) === week) return;
    const r = recap(trades, "last");
    write(key, week);
    if (r.trades === 0) return;
    pushToast({
      tone: "info",
      title: "Your week on Kixo is ready",
      body: `${r.trades} trades last week, ${r.realizedUsd >= 0 ? "+" : "−"}${money(Math.abs(r.realizedUsd))} taken`,
      href: "/portfolio",
      action: f.share_cards ? { label: "Share", onClick: () => openShare({ kind: "recap", recap: r }) } : undefined,
    });
  }, [trades, mode, uid, f.weekly_recap, f.share_cards]);

  return null;
}
