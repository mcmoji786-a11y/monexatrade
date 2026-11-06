"use client";

import { Star } from "lucide-react";
import { useWatchlist } from "@/lib/prefs";

/** Adds a coin to this browser's watchlist. */
export function StarButton({ mint, size = 14 }: { mint: string; size?: number }) {
  const w = useWatchlist();
  const on = w.has(mint);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(e) => {
        e.stopPropagation();
        w.toggle(mint);
      }}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-emerald ${
        on ? "text-warning" : "text-muted hover:text-text"
      }`}
    >
      <Star size={size} strokeWidth={1.5} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
