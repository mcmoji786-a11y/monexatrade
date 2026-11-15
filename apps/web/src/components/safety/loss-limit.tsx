"use client";
/* Daily loss limit (gateway limits.rs): a slim bar while buying is paused for the day,
   and the numbers for Settings. */
import { useEffect, useSyncExternalStore } from "react";
import { ShieldAlert } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { accessToken, useAccount } from "@/lib/account";
import { useMode } from "@/lib/demo";
import { useSettings } from "@/lib/settings";
import { useFeatures } from "@/lib/features";

export type Limits = { limit_usd: number; demo_lost_usd: number; real_lost_usd: number; demo_blocked: boolean; real_blocked: boolean; resets_at: number };

let limits: Limits | null = null;
const listeners = new Set<() => void>();

export async function refreshLimits() {
  const token = accessToken();
  if (!token) return;
  try {
    const r = await fetch(`${GATEWAY_HTTP}/account/limits`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (r.ok) {
      limits = (await r.json()) as Limits;
      listeners.forEach((l) => l());
    }
  } catch {}
}

export function useLimits() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => limits,
    () => null,
  );
}

/** Mounted in the app shell. */
export function LossLimitBar() {
  const auth = useAccount();
  const { settings } = useSettings();
  const mode = useMode();
  const l = useLimits();
  const f = useFeatures();
  const on = f.loss_limit && auth.status === "signed-in" && settings.safety.daily_loss_limit_usd > 0;

  useEffect(() => {
    if (!on) return;
    void refreshLimits();
    const id = setInterval(() => document.visibilityState === "visible" && refreshLimits(), 30_000);
    return () => clearInterval(id);
  }, [on, settings.safety.daily_loss_limit_usd]);

  const blocked = on && l && (mode === "demo" ? l.demo_blocked : l.real_blocked);
  if (!blocked || !l) return null;
  const until = new Date(l.resets_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const lost = mode === "demo" ? l.demo_lost_usd : l.real_lost_usd;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-negative/25 bg-negative/5 px-4 py-1.5 text-xs text-text-2">
      <ShieldAlert size={13} strokeWidth={1.5} className="text-negative" />
      <span>
        Daily loss limit reached: ${lost.toFixed(2)} lost today. Buying is paused until {until}; selling still works
      </span>
    </div>
  );
}
