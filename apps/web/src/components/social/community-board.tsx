"use client";
/* Community: your trader profile, the live trade feed (traders you follow, or everyone)
   and the leaderboard. Only demo trades of public profiles appear (gateway social.rs).
   Wide screens: the lists on the left, your card and this week's top traders on the right. */
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
type Tab = "traders" | "feed" | "chain" | "leaders";

const segment = (on: boolean) => `h-8 rounded-md px-3 text-sm transition-colors ${on ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`;
const signedMoney = (v: number) => `${v >= 0 ? "+" : ""}${money(v)}`;

export function CommunityBoard() {
  const auth = useAccount();
  const signedIn = auth.status === "signed-in";
  const [me, setMe] = useState<Me | null>(null);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);

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
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Community</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">Find Kixo traders, see their real demo results, follow them and copy the ones who win</p>
      </div>

      {/* Making or editing a profile takes the full width. */}
      {signedIn && me && !me.profile && !setupErr && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-base font-medium text-text">Make your trader profile</h2>
          <p className="mt-1 text-sm text-text-2">Pick a handle and a picture. Others can then follow you and see your demo trades. No email or wallet is ever shown</p>
          <div className="mt-4">
            <ProfileForm onSaved={loadMe} />
          </div>
        </section>
      )}
      {me?.profile && editing && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium text-text">Edit your profile</h2>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-text-2 hover:text-text">
              Cancel
            </button>
          </div>
          <ProfileForm initial={me.profile} onSaved={() => (setEditing(false), loadMe())} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
            {(
              [
                ["traders", "Traders"],
                ["feed", "Trades"],
                ["leaders", "Leaderboard"],
                ["chain", "All Solana"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={shown === k}
                onClick={() => setTab(k)}
                className={`-mb-px h-11 shrink-0 border-b-2 px-3 text-sm transition-colors ${shown === k ? "border-text text-text" : "border-transparent text-text-2 hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {shown === "traders" ? <TradersTab onFollow={loadMe} /> : shown === "feed" ? <Feed signedIn={signedIn} hasFollows={(me?.following ?? 0) > 0} /> : shown === "chain" ? <ChainTrades /> : <Leaders following={following} />}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-16 lg:self-start">
          <YouCard signedIn={signedIn} me={me} setupErr={setupErr} onEdit={() => setEditing(true)} />
          <TopThisWeek following={following} onAll={() => setTab("leaders")} />
        </aside>
      </div>
    </section>
  );
}

/** Your card: who you are here, your counts, and the way to your page. */
function YouCard({ signedIn, me, setupErr, onEdit }: { signedIn: boolean; me: Me | null; setupErr: string | null; onEdit: () => void }) {
  if (!signedIn) {
    return (
      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm text-text">Join the Kixo community</p>
        <p className="mt-1 text-sm text-text-2">Make a trader profile, follow traders and copy their trades on your demo account</p>
        <button type="button" onClick={() => openLogin("/community")} className="mt-4 h-10 w-full rounded-lg bg-text text-sm font-medium text-bg hover:opacity-90">
          Sign in
        </button>
      </section>
    );
  }
  if (setupErr) return <p className="rounded-xl border border-border bg-surface p-5 text-sm text-text-2">{/not set up/i.test(setupErr) ? "Community opens soon" : setupErr}</p>;
  if (!me?.profile) return null;
  const p = me.profile;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="h-16 bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.banner_url && <img src={p.banner_url} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="px-5 pb-5">
        <span className="-mt-7 inline-block rounded-full ring-4 ring-surface">
          <TraderAvatar handle={p.handle} src={p.avatar_url} size={56} />
        </span>
        <p className="mt-2 truncate text-base font-medium text-text">{p.display_name || `@${p.handle}`}</p>
        <p className="text-sm text-muted">
          @{p.handle}
          {!p.public && " · private"}
        </p>
        <p className="mt-2 text-sm text-text-2">
          <FollowCounts handle={p.handle} followers={me.followers} following={me.following} />
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href={`/u/${p.handle}`} className="flex h-9 items-center justify-center rounded-lg bg-text text-sm font-medium text-bg hover:opacity-90">
            Your page
          </Link>
          <button type="button" onClick={onEdit} className="h-9 rounded-lg border border-border text-sm text-text hover:bg-surface-2">
            Edit profile
          </button>
        </div>
      </div>
    </section>
  );
}

/** This week's five best traders, a short way into the leaderboard. */
function TopThisWeek({ following, onAll }: { following: Set<string>; onAll: () => void }) {
  const [rows, setRows] = useState<Leader[] | null>(null);
  useEffect(() => {
    let alive = true;
    getLeaders("7d")
      .then((r) => alive && setRows(r.leaders.filter((l) => l.realized_usd == null || l.realized_usd > 0).slice(0, 5)))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-5 py-3">
        <h2 className="text-sm font-medium text-text">Top traders this week</h2>
        <button type="button" onClick={onAll} className="text-xs text-text-2 hover:text-text">
          See all
        </button>
      </div>
      <ol className="divide-y divide-border">
        {rows.map((r, i) => (
          <li key={r.handle} className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-4 font-mono text-xs text-muted">{i + 1}</span>
            <Link href={`/u/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-2.5">
              <TraderAvatar handle={r.handle} src={r.avatar_url} size={28} />
              <span className="min-w-0 truncate text-sm text-text hover:underline">{r.display_name || `@${r.handle}`}</span>
            </Link>
            <span className="font-mono text-sm text-positive">{r.realized_usd != null ? signedMoney(r.realized_usd) : `${r.win_rate}%`}</span>
            {!following.has(r.handle) && <span className="sr-only">Not followed</span>}
          </li>
        ))}
      </ol>
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
        <div className="flex gap-1 self-start rounded-lg border border-border p-0.5" role="group" aria-label="Whose trades">
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
              className={segment(scope === k)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">Demo trades by Kixo traders, live</span>
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

  const podium = (rows ?? []).filter((r) => r.realized_usd == null || r.realized_usd > 0).slice(0, 3);
  const rest = (rows ?? []).filter((r) => !podium.includes(r));
  const scale = Math.max(1, ...(rows ?? []).map((r) => Math.abs(r.realized_usd ?? 0)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 self-start rounded-lg border border-border p-0.5" role="group" aria-label="Period">
          {(
            [
              ["7d", "7 days"],
              ["30d", "30 days"],
              ["all", "All time"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => (setRows(null), setPeriod(k))} aria-pressed={period === k} className={segment(period === k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">Ranked by profit taken on the demo account, 3 closed trades or more</span>
      </div>
      {err ? (
        <p className="rounded-xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted">{/not set up/i.test(err) ? "Community opens soon" : err}</p>
      ) : !rows ? (
        <p className="rounded-xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted">Loading</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted">No ranked traders yet. A trader is ranked after 3 closed demo trades</p>
      ) : (
        <>
          {podium.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {podium.map((r) => (
                <article key={r.handle} className="flex flex-col items-center rounded-xl border border-border bg-surface px-4 py-5 text-center">
                  <span className="font-mono text-xs text-muted">#{r.rank}</span>
                  <Link href={`/u/${r.handle}`} className="mt-2 flex flex-col items-center">
                    <TraderAvatar handle={r.handle} src={r.avatar_url} size={56} />
                    <span className="mt-2 max-w-full truncate text-sm text-text hover:underline">{r.display_name || `@${r.handle}`}</span>
                  </Link>
                  <span className="mt-2 font-mono text-xl text-positive">{r.realized_usd != null ? signedMoney(r.realized_usd) : "Hidden"}</span>
                  <span className="mt-0.5 text-xs text-muted">
                    {r.win_rate}% won · {r.trades} trades
                  </span>
                  <div className="mt-3">
                    <FollowButton key={`${r.handle}:${following.has(r.handle)}`} handle={r.handle} initial={following.has(r.handle)} quiet />
                  </div>
                </article>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <section className="rounded-xl border border-border bg-surface">
              <ul className="divide-y divide-border">
                {rest.map((r) => (
                  <li key={r.handle} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                    <span className="w-6 shrink-0 text-center font-mono text-xs text-muted">{r.rank}</span>
                    <Link href={`/u/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <TraderAvatar handle={r.handle} src={r.avatar_url} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-text hover:underline">{r.display_name || `@${r.handle}`}</span>
                        <span className="block truncate text-xs text-muted">
                          {r.win_rate}% won · {r.trades} trades · {r.followers} {r.followers === 1 ? "follower" : "followers"}
                        </span>
                      </span>
                    </Link>
                    {/* Profit as a thin bar against the best, like a scoreboard. */}
                    <span className="hidden w-28 sm:block" aria-hidden="true">
                      {r.realized_usd != null && (
                        <span className="block h-1 overflow-hidden rounded-full bg-surface-3">
                          <span className={`block h-full ${r.realized_usd >= 0 ? "bg-positive/70" : "bg-negative/70"}`} style={{ width: `${Math.max(3, (Math.abs(r.realized_usd) / scale) * 100)}%` }} />
                        </span>
                      )}
                    </span>
                    <span className={`w-24 shrink-0 text-right font-mono text-sm ${r.realized_usd == null ? "text-muted" : r.realized_usd >= 0 ? "text-positive" : "text-negative"}`}>
                      {r.realized_usd != null ? signedMoney(r.realized_usd) : "Hidden"}
                    </span>
                    <FollowButton key={`${r.handle}:${following.has(r.handle)}`} handle={r.handle} initial={following.has(r.handle)} quiet />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
