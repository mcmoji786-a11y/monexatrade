"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { useLeaderboard, type BoardRow } from "@/lib/growth";
import { useAccount, openLogin } from "@/lib/account";
import { useNow } from "@/components/radar/use-radar-feed";
import { money, signed } from "@/components/trade/trade-panel";

const PLACES = ["1st", "2nd", "3rd"];

function left(secs: number) {
  if (secs <= 0) return "Ended";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const day = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
const tone = (v: number) => (v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-text-2");

/** The weekly demo competition: everyone starts with $10,000 of virtual money and is
 *  ranked by realised profit from Monday to Sunday (UTC). */
export function CompetitionBoard() {
  const [week, setWeek] = useState<"current" | "last">("current");
  const { board, failed } = useLeaderboard(week);
  const account = useAccount();
  const now = useNow();
  const me = board?.leaders.find((l) => l.you);
  const ends = board ? board.to - Math.floor((now || board.now * 1000) / 1000) : null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-medium text-text">Weekly competition</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Demo traders ranked by the profit they actually took this week. Everyone trades the live market with the same $10,000
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Fact label={week === "current" ? "Ends in" : "Week"} value={board ? (week === "current" ? left(ends ?? 0) : `${day(board.from)} – ${day(board.to - 1)}`) : "—"} />
          <Fact label="Ranked traders" value={board ? String(board.leaders.length) : "—"} />
          <Fact label="Your rank" value={me ? `#${me.rank}` : "—"} />
        </dl>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1" role="group" aria-label="Week">
          {(
            [
              ["current", "This week"],
              ["last", "Last week"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={week === k}
              onClick={() => setWeek(k)}
              className={`h-8 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${week === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {board && <span className="font-mono text-xs text-muted">{`${day(board.from)} – ${day(board.to - 1)} · Monday to Sunday UTC`}</span>}
      </div>

      <YouCard me={me} signedIn={account.status === "signed-in"} current={week === "current"} hasBoard={!!board} />

      {!board ? (
        <p className="rounded-2xl border border-border bg-surface px-8 py-16 text-center text-sm text-muted">{failed ? "Leaderboard unavailable, retrying" : "Loading"}</p>
      ) : board.leaders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface px-8 py-14 text-center">
          <Trophy size={18} strokeWidth={1.5} className="text-muted" />
          <p className="text-sm text-text">{week === "current" ? "No one is ranked yet this week" : "No one was ranked last week"}</p>
          <p className="max-w-md text-xs text-muted">A trader is ranked after 3 closed demo trades. Be the first on the board</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[760px] text-sm tabular-nums whitespace-nowrap">
            <thead>
              <tr className="h-10 border-b border-border text-left text-xs text-muted">
                <th className="w-20 pl-5 font-normal">Rank</th>
                <th className="font-normal">Trader</th>
                <th className="px-3 text-right font-normal">Return</th>
                <th className="px-3 text-right font-normal">Profit taken</th>
                <th className="px-3 text-right font-normal">Trades</th>
                <th className="px-3 text-right font-normal">Win rate</th>
                <th className="px-5 text-right font-normal">Best trade</th>
              </tr>
            </thead>
            <tbody>
              {board.leaders.map((l) => (
                <Row key={l.rank} l={l} winner={week === "last" && l.rank <= 3} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="flex max-w-3xl flex-col gap-1.5 text-xs leading-5 text-muted">
        <li>Ranked by realised profit: only sells count, open positions do not</li>
        <li>Every round counts, so resetting the demo account never wipes a loss</li>
        <li>3 closed trades a week to be ranked. Names are referral codes, never emails or wallets</li>
        <li>Demo results use virtual money at live prices. They are not real profits</li>
      </ul>
    </section>
  );
}

function Row({ l, winner }: { l: BoardRow; winner: boolean }) {
  return (
    <tr className={`h-12 border-b border-border last:border-0 ${l.you ? "bg-surface-2" : ""}`}>
      <td className="pl-5 font-mono text-xs">
        {l.rank <= 3 ? <span className="text-emerald">{PLACES[l.rank - 1]}</span> : <span className="text-muted">#{l.rank}</span>}
      </td>
      <td>
        <span className="flex items-center gap-2">
          <span className="font-mono text-text">@{l.name}</span>
          {l.you && <span className="rounded border border-border px-1.5 text-[10px] text-text-2">You</span>}
          {winner && (
            <span className="flex items-center gap-1 rounded border border-emerald/30 px-1.5 text-[10px] text-emerald">
              <Trophy size={10} strokeWidth={1.5} /> Week winner
            </span>
          )}
        </span>
      </td>
      <td className={`px-3 text-right font-mono ${tone(l.pct)}`}>{pct(l.pct)}</td>
      <td className={`px-3 text-right font-mono ${tone(l.realized_usd)}`}>{signed(l.realized_usd)}</td>
      <td className="px-3 text-right font-mono text-text-2">{l.trades}</td>
      <td className="px-3 text-right font-mono text-text-2">{l.win_rate.toFixed(0)}%</td>
      <td className="px-5 text-right font-mono text-text-2">{money(l.best_usd)}</td>
    </tr>
  );
}

function YouCard({ me, signedIn, current, hasBoard }: { me?: BoardRow; signedIn: boolean; current: boolean; hasBoard: boolean }) {
  if (!hasBoard || !current) return null;
  if (!signedIn)
    return (
      <Banner>
        <span>Sign in and trade with demo money to join this week</span>
        <button type="button" onClick={() => openLogin("/competition")} className="text-text underline underline-offset-2">
          Sign in
        </button>
      </Banner>
    );
  if (!me)
    return (
      <Banner>
        <span>You are not ranked yet. Close 3 demo trades this week to join</span>
        <Link href="/radar" className="text-text underline underline-offset-2">
          Find a coin
        </Link>
      </Banner>
    );
  return (
    <Banner>
      <span>
        You are <span className="font-mono text-text">#{me.rank}</span> with <span className={`font-mono ${tone(me.pct)}`}>{pct(me.pct)}</span> this week
      </span>
      <Link href="/portfolio" className="text-text underline underline-offset-2">
        Your trades
      </Link>
    </Banner>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-2">{children}</div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl text-text">{value}</dd>
    </div>
  );
}
