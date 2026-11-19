"use client";
/* A heads-up when buying a coin Kixo AI calls Danger. It never blocks or slows the buy:
   the order goes out at once and a warning toast shows next to it. Manual buys only
   (trade ticket, Quick Buy); the sniper and copy trading have their own AI filters. The
   user can turn it off in Settings, Safety. */
import { aiScoreOf, pct, verdict } from "@/lib/ai-risk";
import { getSettings } from "@/lib/settings";
import { featuresNow } from "@/lib/features";
import { pushToast } from "@/lib/toast";

/** Always true, at once: the buy goes ahead. Warns when the AI calls this coin Danger. */
export function confirmDanger(mint: string, symbol: string): Promise<boolean> {
  if (featuresNow().danger_warning && getSettings().safety.warn_danger) {
    const s = aiScoreOf(mint);
    if (s && verdict(s).key === "danger") {
      pushToast({ tone: "bad", title: `Kixo AI says Danger on ${symbol || "this coin"}`, body: `${pct(s.dump)} chance it falls 70% or more within the hour. A tight stop loss helps` });
    }
  }
  return Promise.resolve(true);
}
