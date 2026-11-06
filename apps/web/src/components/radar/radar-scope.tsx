"use client";

import type { RadarToken } from "./use-radar-feed";

const WINDOW_SECS = 60;

/**
 * Sol Radar's one rich element: a radar scope where every blip is a real launch
 * from the last minute. Distance from the center is age (new launches sit near the
 * center and drift outward), and the angle comes from the mint address, so a token
 * keeps its bearing. Blips fade as they age out of the window.
 */
export function RadarScope({ tokens, now, size = 168 }: { tokens: RadarToken[]; now: number; size?: number }) {
  const c = size / 2;
  const r = c - 4;
  const blips = now
    ? tokens
        .map((t) => ({ t, age: now / 1000 - t.timestamp }))
        .filter(({ age }) => age >= 0 && age <= WINDOW_SECS)
    : [];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <circle cx={c} cy={c} r={r} fill="var(--mx-surface)" stroke="var(--mx-border)" />
        {[0.33, 0.66].map((f) => (
          <circle key={f} cx={c} cy={c} r={r * f} fill="none" stroke="var(--mx-border)" />
        ))}
        <line x1={c - r} y1={c} x2={c + r} y2={c} stroke="var(--mx-border)" />
        <line x1={c} y1={c - r} x2={c} y2={c + r} stroke="var(--mx-border)" />
        {blips.map(({ t, age }) => {
          const angle = bearing(t.mint);
          const dist = (0.12 + (age / WINDOW_SECS) * 0.88) * r;
          const fresh = age < 5;
          return (
            <circle
              key={t.mint}
              cx={c + Math.cos(angle) * dist}
              cy={c + Math.sin(angle) * dist}
              r={fresh ? 3 : 2}
              fill={fresh ? "var(--mx-text)" : "var(--mx-emerald)"}
              opacity={1 - (age / WINDOW_SECS) * 0.75}
            />
          );
        })}
        <circle cx={c} cy={c} r={1.5} fill="var(--mx-emerald)" />
      </svg>
      {/* Sweep: a single-hue fade inside the scope. */}
      <div
        className="radar-sweep absolute rounded-full"
        style={{
          inset: 4,
          background: "conic-gradient(from 0deg, rgb(52 211 153 / 0.28), rgb(52 211 153 / 0) 70deg, transparent 360deg)",
        }}
      />
    </div>
  );
}

/** Stable angle (radians) from a mint address, so a blip never jumps around. */
function bearing(mint: string) {
  let h = 2166136261;
  for (let i = 0; i < mint.length; i++) {
    h ^= mint.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}
