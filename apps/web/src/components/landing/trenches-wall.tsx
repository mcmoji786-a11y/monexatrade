"use client";
/* Landing hero: "the trenches", the real Sol Radar feed as a wall of coin cards drifting
   up in three columns at different speeds, each with Kixo AI's word. Every card is an
   actual launch. With reduced motion the columns stand still. */
import { usd } from "@/lib/gateway";
import { formatAge, useNow, useRadarFeed } from "@/components/radar/use-radar-feed";
import type { RadarToken as FeedToken } from "@/components/radar/use-radar-feed";
import { VerdictTag } from "./live-preview";

function Card({ t, now }: { t: FeedToken; now: number }) {
  const age = now / 1000 - t.timestamp;
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="size-8 shrink-0 overflow-hidden rounded-full border border-border bg-surface-3">
          {t.meta?.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.meta.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" />
          )}
        </div>
        <p className="min-w-0 truncate text-sm font-medium text-text">{t.symbol || "—"}</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-mono text-xs text-muted">
          {t.market?.sol_quoted === false ? "—" : usd(t.market?.mc_usd)} · {formatAge(age)}
        </p>
        <VerdictTag mint={t.mint} ageS={age} />
      </div>
    </div>
  );
}

/** One column, its cards twice over so the drift loops without a seam. */
function Column({ tokens, now, secs }: { tokens: FeedToken[]; now: number; secs: number }) {
  const list = (key: string) => (
    <div className="flex flex-col gap-3 pb-3" aria-hidden={key === "b"}>
      {tokens.map((t) => (
        <Card key={key + t.mint} t={t} now={now} />
      ))}
    </div>
  );
  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      <div className="drift" style={{ animationDuration: `${secs}s` }}>
        {list("a")}
        {list("b")}
      </div>
    </div>
  );
}

export function TrenchesWall() {
  const { tokens } = useRadarFeed();
  const now = useNow();
  const list = [...tokens].sort((a, b) => b.timestamp - a.timestamp).slice(0, 36);
  if (list.length < 9) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Waiting for the next launches</div>;
  }
  const cols = [list.filter((_, i) => i % 3 === 0), list.filter((_, i) => i % 3 === 1), list.filter((_, i) => i % 3 === 2)];
  return (
    <div className="wall-mask flex h-full gap-3">
      <Column tokens={cols[0]} now={now} secs={46} />
      <Column tokens={cols[1]} now={now} secs={60} />
      <div className="hidden min-w-0 flex-1 sm:flex">
        <Column tokens={cols[2]} now={now} secs={52} />
      </div>
    </div>
  );
}
