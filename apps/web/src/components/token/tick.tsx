"use client";

import { useState } from "react";

/** Wraps a live figure and flashes it green or red when its value moves.
 *  The first render does not flash, so a page load stays calm. */
export function Tick({ value, children, className = "" }: { value: number | null | undefined; children: React.ReactNode; className?: string }) {
  const [prev, setPrev] = useState(value);
  const [flash, setFlash] = useState<{ n: number; dir: "up" | "down" } | null>(null);

  // Adjust state when the prop changes (React's documented pattern, no effect needed).
  if (value !== prev) {
    if (value != null && prev != null && value !== prev) {
      setFlash({ n: (flash?.n ?? 0) + 1, dir: value > prev ? "up" : "down" });
    }
    setPrev(value);
  }

  return (
    <span key={flash?.n ?? 0} className={`px-0.5 ${flash ? (flash.dir === "up" ? "tick-up" : "tick-down") : ""} ${className}`}>
      {children}
    </span>
  );
}
