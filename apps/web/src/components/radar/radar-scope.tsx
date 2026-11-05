"use client";

import type { RadarToken } from "./use-radar-feed";

const WINDOW_SECS = 60;
const SIZE = 168;
const C = SIZE / 2;
const R = C - 6;

/**
 * Sol Radar's one rich element: a radar scope where every blip is a real launch
 * from the last minute. Distance from the center is age (new launches sit near the
 * center and drift outward), and the angle comes from the mint address, so a token
 * keeps its bearing. Blips fade as they age out of the window.
 */
export function RadarScope({ tokens, now }: { tokens: RadarToken[]; now: number }) {
  const blips = now
    ? tokens
        .map((t) => ({ t, age: now / 1000 - t.timestamp }))
        .filter(({ age }) => age >= 0 && age <= WINDOW_SECS)
    : [];

  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }} aria-hidden>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0">
        <circle cx={C} cy={C} r={R} fill="var(--mx-surface)" stroke="var(--mx-border)" />
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="var(--mx-border)" />
        ))}
        <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="var(--mx-border)" />
        <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="var(--mx-border)" />
        {blips.map(({ t, age }) => {
          const angle = bearing(t.mint);
          const dist = (0.12 + (age / WINDOW_SECS) * 0.88) * R;
          const x = C + Math.cos(angle) * dist;
          const y = C + Math.sin(angle) * dist;
          const fresh = age < 5;
          return (
            <circle
              key={t.signature}
              cx={x}
              cy={y}
              r={fresh ? 3.5 : 2.5}
              fill={fresh ? "var(--mx-text)" : "var(--mx-emerald)"}
              opacity={1 - (age / WINDOW_SECS) * 0.75}
            />
          );
        })}
        <circle cx={C} cy={C} r={2} fill="var(--mx-emerald)" />
      </svg>
      {/* Sweep: a single-hue fade inside the scope, clipped to the circle. */}
      <div
        className="radar-sweep absolute rounded-full"
        style={{
          inset: 6,
          background:
            "conic-gradient(from 0deg, rgb(52 211 153 / 0.28), rgb(52 211 153 / 0) 70deg, transparent 360deg)",
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
