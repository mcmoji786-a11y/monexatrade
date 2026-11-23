/* Candle series helpers shared by the charts. */
import type { Candle } from "./gateway";

/** At most this many candles are added to fill quiet stretches (older gaps stay as they are). */
const MAX_FILLED = 4000;

/** One unbroken series, as trading terminals draw it: an interval with no trades gets a
 *  flat candle at the last price, and each candle opens where the one before closed (its
 *  high and low widen to include that), so the chart never shows gaps or jumps between
 *  candles. Only the newest MAX_FILLED intervals are filled. */
export function continuous(candles: Candle[], secs: number): Candle[] {
  if (candles.length < 2) return candles;
  const first = Math.max(candles[0].t, candles[candles.length - 1].t - MAX_FILLED * secs);
  const out: Candle[] = [];
  for (const c of candles) {
    const prev = out[out.length - 1];
    if (prev && c.t >= first) {
      for (let t = Math.max(prev.t + secs, first); t < c.t; t += secs) out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
    }
    const before = out[out.length - 1];
    if (before) {
      const o = before.c;
      out.push({ ...c, o, h: Math.max(c.h, o), l: Math.min(c.l, o) });
    } else out.push({ ...c });
  }
  return out;
}
