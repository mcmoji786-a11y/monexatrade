"use client";
/* Mounted once in the app shell: keeps the account's copy of price alerts, Wallet
   Monitor wallets and starred coins up to date, so the gateway can send them by Email,
   Telegram and Discord when Kixo is closed (lib/alerts.ts). */
import { useEffect } from "react";
import { useAccount } from "@/lib/account";
import { useFeatures } from "@/lib/features";
import { alertInputs } from "@/lib/prefs";
import { clearRemote, firstSync, pullAlerts, saveAlerts } from "@/lib/alerts";

export function AlertSync() {
  const auth = useAccount();
  const f = useFeatures();
  const on = auth.status === "signed-in" && f.alert_delivery;

  useEffect(() => {
    if (!on) {
      clearRemote();
      return;
    }
    let stop = false;
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = alertInputs.subscribe(() => {
      if (!ready || stop) return;
      clearTimeout(timer);
      timer = setTimeout(() => void saveAlerts().catch(() => {}), 1_500);
    });
    firstSync()
      .catch(() => {})
      .finally(() => {
        ready = true;
      });
    const id = setInterval(() => {
      if (ready && document.visibilityState === "visible") void pullAlerts().catch(() => {});
    }, 60_000);
    return () => {
      stop = true;
      off();
      clearTimeout(timer);
      clearInterval(id);
    };
  }, [on]);

  return null;
}
