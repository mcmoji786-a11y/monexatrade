"use client";
/* Community: your trader profile, the live trade feed (traders you follow, or everyone)
   and the leaderboard. Only demo trades of public profiles appear (gateway social.rs). */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { useAccount, openLogin } from "@/lib/account";
import { getFeed, getLeaders, getMe, money, type Leader, type SocialTrade, type TraderProfile } from "@/lib/social";
import { FollowButton, TradeLine, TraderAvatar } from "./social-bits";
import { ProfileForm } from "./profile-form";
import { FollowCounts, TradersTab } from "./people";
import { ChainTrades } from "./chain-trades";

type Me = { profile: TraderProfile | null; followers: number; following: number; following_handles: string[] };

export function CommunityBoard() {
  const auth = useAccount();
  const signedIn = auth.status === "signed-in";
  const [me, setMe] = useState<Me | null>(null);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"traders" | "feed" | "chain" | "leaders" | null>(null);

  const loadMe = useCallback(() => {
    if (!signedIn) return;
    getMe()
      .then((m) => (setMe(m), setSetupErr(null)))
      .catch((e) => setSetupErr(e instanceof Error ? e.message : "Could not load"));
  }, [signedIn]);
  useEffect(() => {
    loadMe();
  }, [loadMe]);
  // Following nobody yet: start on Traders, to find people. Otherwise their trades.
  const shown = tab ?? (me && me.following > 0 ? "feed" : "traders");
  const following = new Set(me?.following_handles ?? []);

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-medium text-text">Community</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">Find Kixo users, follow them and copy the ones who win, or watch every trade across Solana live</p>
      </div>

      {/* Your profile */}
      {!signedIn ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
          <p className="text-sm text-text-2">Sign in to make your trader profile and follow traders</p>
          <button type="button" onClick={() => openLogin("/community")} className="h-9 rounded-lg bg-text px-4 text-sm font-medium text-bg">
            Sign in
          </button>
        </div>
      ) : setupErr ? (
        <p className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-text-2">{/not set up/i.test(setupErr) ? "Community opens soon" : setupErr}</p>
      ) : me && !me.profile ? (
        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <h2 className="text-sm font-medium text-text">Make your trader profile</h2>
          <p className="mt-1 text-xs text-muted">Pick a handle. Others can then follow you and see your demo trades. No email or wallet is ever shown</p>
          <ProfileForm onSaved={loadMe} />
        </section>
      ) : me?.profile && editing ? (
        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text">Edit your profile</h2>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-text-2 hover:text-text">
              Cancel
            </button>
          </div>
          <ProfileForm initial={me.profile} onSaved={() => (setEditing(false), loadMe())} />
        </section>
      ) : me?.profile ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4">
          <TraderAvatar handle={me.profile.handle} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-text">{me.profile.display_name || `@${me.profile.handle}`}</p>
            <p className="font-mono text-xs text-muted">
              @{me.profile.handle} · <FollowCounts handle={me.profile.handle} followers={me.followers} following={me.following} />{!me.profile.public && " · private"}
            </p>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="flex h-9 items-center rounded-lg border border-border px-3 text-sm text-text transition-colors hover:bg-surface-2">
            Edit profile
          </button>
          <Link href={`/u/${me.profile.handle}`} className="flex h-9 items-center rounded-lg border border-border px-3 text-sm text-text transition-colors hover:bg-surface-2">
            Your page
          </Link>
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-border" role="tablist">
        {(
          [
            ["traders", "Kixo users"],
            ["feed", "Kixo trades"],
            ["chain", "All Solana"],
            ["leaders", "Leaderboard"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={shown === k}
            onClick={() => setTab(k)}
            className={`-mb-px h-11 border-b-2 px-3 text-sm transition-colors ${shown === k ? "border-emerald text-text" : "border-transparent text-text-2 hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown === "traders" ? <TradersTab onFollow={loadMe} /> : shown === "feed" ? <Feed signedIn={signedIn} hasFollows={(me?.following ?? 0) > 0} /> : shown === "chain" ? <ChainTrades /> : <Leaders following={following} />}
    </section>
  );
}

function Feed({ signedIn, hasFollows }: { signedIn: boolean; hasFollows: boolean }) {
  const [scope, setScope] = useState<"following" | "everyone">(signedIn && hasFollows ? "following" : "everyone");
  const [items, setItems] = useState<SocialTrade[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [more, setMore] = useState(true);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await getFeed(scope);
        if (stop) return;
        // New trades on top; older pages already loaded stay.
        setItems((cur) => {
          const ids = new Set(r.items.map((t) => t.id));
          return [...r.items, ...(cur ?? []).filter((t) => !ids.has(t.id) && t.id < (r.items.at(-1)?.id ?? 0))];
        });
        setErr(null);
        setNow(Date.now());
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : "Could not load");
      }
    };
    void load();
    const id = setInterval(load, 5_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [scope]);

  const older = async () => {
    const last = items?.at(-1)?.id;
    if (!last) return;
    const r = await getFeed(scope, last);
    setMore(r.items.length > 0);
    setItems((cur) => [...(cur ?? []), ...r.items]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 rounded-lg border border-border p-0.5 self-start" role="group" aria-label="Whose trades">
        {(
          [
            ["following", "Following"],
            ["everyone", "Everyone"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => (k === "following" && !signedIn ? openLogin("/community") : (setItems(null), setMore(true), setScope(k)))}
            aria-pressed={scope === k}
            className={`h-8 rounded-md px-3 text-sm transition-colors ${scope === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
        <span className="text-xs text-muted">Demo trades by Kixo users. For everyone on Solana, see All Solana</span>
      </div>
      <section className="rounded-xl border border-border bg-surface">
        {err ? (
          <p className="px-6 py-10 text-center text-sm text-muted">{/not set up/i.test(err) ? "Community opens soon" : err}</p>
        ) : !items ? (
          <p className="px-6 py-10 text-center text-sm text-muted">Loading</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Users size={20} strokeWidth={1.5} className="text-muted" />
            <p className="text-sm text-text-2">{scope === "following" ? "No trades from the traders you follow yet" : "No public trades yet. Make your profile and be the first"}</p>
            {scope === "following" && <p className="text-xs text-muted">Find people in the Traders tab and follow them</p>}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((t) => (
              <TradeLine key={t.id} t={t} now={now} />
            ))}
          </ul>
        )}
        {items && items.length >= 50 && more && (
          <div className="border-t border-border p-3 text-center">
            <button type="button" onClick={older} className="h-8 rounded-lg px-3 text-sm text-text-2 hover:bg-surface-2 hover:text-text">
              Older trades
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Leaders({ following }: { following: Set<string> }) {
  const [period, setPeriod] = useState<"7d" | "30d" | "all">("7d");
  const [rows, setRows] = useState<Leader[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getLeaders(period)
      .then((r) => alive && (setRows(r.leaders), setErr(null)))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Could not load"));
    return () => {
      alive = false;
    };
  }, [period]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 self-start rounded-lg border border-border p-0.5" role="group" aria-label="Period">
        {(
          [
            ["7d", "7 days"],
            ["30d", "30 days"],
            ["all", "All time"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => (setRows(null), setPeriod(k))}
            aria-pressed={period === k}
            className={`h-8 rounded-md px-3 text-sm transition-colors ${period === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="rounded-xl border border-border bg-surface">
        {err ? (
          <p className="px-6 py-10 text-center text-sm text-muted">{/not set up/i.test(err) ? "Community opens soon" : err}</p>
        ) : !rows ? (
          <p className="px-6 py-10 text-center text-sm text-muted">Loading</p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">No ranked traders yet. A trader is ranked after 3 closed demo trades</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.handle} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <span className="w-6 shrink-0 text-center font-mono text-xs text-muted">{r.rank}</span>
                <Link href={`/u/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <TraderAvatar handle={r.handle} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text hover:underline">{r.display_name || `@${r.handle}`}</span>
                    <span className="block font-mono text-[11px] text-muted">
                      @{r.handle} · {r.followers} followers
                    </span>
                  </span>
                </Link>
                <span className="hidden w-24 text-right font-mono text-xs text-text-2 sm:block">
                  {r.win_rate}% win · {r.trades}
                </span>
                <span className={`w-20 text-right font-mono text-sm ${r.realized_usd >= 0 ? "text-positive" : "text-negative"}`}>
                  {r.realized_usd >= 0 ? "+" : ""}
                  {money(r.realized_usd)}
                </span>
                <FollowButton key={`${r.handle}:${following.has(r.handle)}`} handle={r.handle} initial={following.has(r.handle)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
