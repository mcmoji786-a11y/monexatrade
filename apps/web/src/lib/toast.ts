"use client";

import { useSyncExternalStore } from "react";
import { getSettings, playTone } from "./settings";

/* Small in-app notifications (bottom right). Anything can push one; they fade after a
   few seconds or on click. */
/** `kind` ties a pop-up to a notification setting; pop-ups without one always show. */
export type Toast = { id: number; tone: "good" | "bad" | "info"; title: string; body?: string; href?: string; kind?: "trade" | "exit" | "sniper" };

let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const LIFE_MS = 7_000;
const MAX = 4;

export function pushToast(t: Omit<Toast, "id">) {
  if (t.kind) {
    const n = getSettings().notifications;
    if ((t.kind === "trade" && !n.trades) || (t.kind === "exit" && !n.exits) || (t.kind === "sniper" && !n.sniper)) return;
    if (n.sound && t.kind !== "sniper") playTone(t.tone !== "bad");
  }
  const id = next++;
  toasts = [{ ...t, id }, ...toasts].slice(0, MAX);
  emit();
  setTimeout(() => dismissToast(id), LIFE_MS);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const EMPTY: Toast[] = [];
export function useToasts() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
    () => EMPTY,
  );
}
