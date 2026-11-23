"use client";
/* A Kixo trader's page: who they are, how they did, their latest demo trades, and the two
   actions: follow (their trades in your feed) and copy (their trades on your demo account). */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, Copy as CopyIcon, Send } from "lucide-react";
import { getTrader, money, type Trader, type TraderStats } from "@/lib/social";
import { BadgeChip, PnlCalendar, PnlChart, ShareProfile, XGlyph } from "./profile-parts";
import { ProfileHistory, ProfilePositions } from "./profile-portfolio";
import { addCopy, removeCopy, useCopies } from "@/lib/copy";
import { useAccount, openLogin } from "@/lib/account";
import { pushToast } from "@/lib/toast";
import { FollowButton, TradeLine, TraderAvatar } from "./social-bits";
import { FollowCounts } from "./people";
import { ProfileForm } from "./profile-form";

const AMOUNTS = [10, 25, 50, 100];

export function TraderView() {
  const params = useParams<{ handle: string }>();
  const router = useRouter();
  const handle = (params?.handle ?? "").toLowerCase().replace(/^%40|^@/, "");
  const [t, setT] = useState<Trader | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [editing, setEditing] = useState(false);
  const [period, setPeriod] = useState<"d7" | "d30" | "all">("d30");
  const [tab, setTab] = useState<"overview" | "positions" | "history">("overview");

  useEffect(() => {
    let stop = false;
    const load = () =>
      getTrader(handle)
        .then((v) => !stop && (setT(v), setErr(null), setNow(Date.now())))
        .catch((e) => !stop && setErr(e instanceof Error ? e.message : "Could not load"));
    void load();
    const id = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [handle]);

  if (err) return <p className="py-20 text-center text-sm text-text-2">{/not set up/i.test(err) ? "Community opens soon" : err}</p>;
  if (!t) return <p className="py-20 text-center text-sm text-muted">Loading</p>;
  const p = t.profile;
  const s = t.stats[period];

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Link href="/community" className="self-start text-sm text-text-2 hover:text-text">
        Community
      </Link>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {/* Banner: the trader's own, else a quiet surface. */}
        <div className={`relative w-full bg-surface-2 ${p.banner_url ? "aspect-[3/1] max-h-56" : "h-28"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.banner_url && <img src={p.banner_url} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="px-5 pb-5">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-3">
            <span className="rounded-full ring-4 ring-surface">
              <TraderAvatar handle={p.handle} src={p.avatar_url} size={96} />
            </span>
            <div className="flex flex-wrap gap-2 pb-1">
              <ShareProfile handle={p.handle} />
              {t.own ? (
                <button type="button" onClick={() => setEditing(!editing)} className="h-9 rounded-lg border border-border px-4 text-sm text-text hover:bg-surface-2">
                  {editing ? "Close" : "Edit profile"}
                </button>
              ) : (
                <>
                  <CopyTrader handle={p.handle} />
                  <FollowButton handle={p.handle} initial={t.i_follow} onChange={(on) => setT({ ...t, i_follow: on, followers: t.followers + (on ? 1 : -1) })} />
                </>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-text">{p.display_name || `@${p.handle}`}</h1>
            {(t.badges ?? []).map((b) => (
              <BadgeChip key={b.key} b={b} />
            ))}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            @{p.handle}
            {!p.public && " · private"}
          </p>
          {p.bio && <p className="mt-3 max-w-xl text-[15px] leading-6 text-text-2">{p.bio}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-2">
            <FollowCounts key={t.followers} handle={p.handle} followers={t.followers} following={t.following} />
            {p.created_at && (
              <span className="flex items-center gap-1.5 text-muted">
                <CalendarDays size={14} strokeWidth={1.5} />
                Joined {new Date(p.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
            )}
            {p.x_handle && (
              <a href={`https://x.com/${p.x_handle}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 text-text-2 hover:text-text">
                <XGlyph />@{p.x_handle}
              </a>
            )}
            {p.telegram && (
              <a href={`https://t.me/${p.telegram}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 text-text-2 hover:text-text">
                <Send size={14} strokeWidth={1.5} />
                {p.telegram}
              </a>
            )}
          </div>
        </div>
      </div>

      {t.own && editing && (
        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <ProfileForm initial={p} onSaved={(np) => (setEditing(false), np.handle !== p.handle ? router.replace(`/u/${np.handle}`) : setT({ ...t, profile: np }))} />
        </section>
      )}

      <nav className="flex gap-1 border-b border-border" aria-label="Profile">
        {(
          [
            ["overview", "Overview"],
            ["positions", "Positions"],
            ["history", "History"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-current={tab === k ? "page" : undefined}
            className={`-mb-px h-10 border-b-2 px-4 text-sm transition-colors ${tab === k ? "border-text text-text" : "border-transparent text-text-2 hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "positions" && <ProfilePositions handle={p.handle} />}
      {tab === "history" && <ProfileHistory handle={p.handle} />}

      {tab === "overview" && (
      <>
      <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-text">Results</h2>
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Period">
            {(
              [
                ["d7", "7 days"],
                ["d30", "30 days"],
                ["all", "All"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k} className={`h-7 rounded-md px-2.5 text-xs ${period === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Stats s={s} />
        {t.hidden_amounts ? (
          <p className="px-5 py-4 text-xs text-muted">This trader shows results as percentages only</p>
        ) : (
          <PnlChart daily={t.daily ?? []} days={period === "d7" ? 7 : period === "d30" ? 30 : 120} />
        )}
      </section>

      <PnlCalendar daily={t.daily ?? []} hidden={!!t.hidden_amounts} />

      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-text">Latest trades</h2>
          <p className="mt-0.5 text-xs text-muted">Demo account, live market prices and real fees</p>
        </div>
        {t.trades.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">No trades yet</p>
        ) : (
          <ul className="divide-y divide-border">
            {t.trades.slice(0, 10).map((x) => (
              <TradeLine key={x.id} t={x} now={now} showTrader={false} />
            ))}
          </ul>
        )}
        {t.trades.length > 10 && (
          <button type="button" onClick={() => setTab("history")} className="w-full border-t border-border py-2.5 text-xs text-text-2 hover:text-text">
            See all trades
          </button>
        )}
      </section>
      </>
      )}
    </section>
  );
}

function Stats({ s }: { s: TraderStats }) {
  if (!s) return <p className="px-5 py-6 text-sm text-muted">No results yet</p>;
  return (
    <dl className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-5">
      {(
        [
          ["Profit", s.realized_usd == null ? "Hidden" : `${s.realized_usd >= 0 ? "+" : ""}${money(s.realized_usd)}`, s.realized_usd == null ? "text-muted" : s.realized_usd >= 0 ? "text-positive" : "text-negative"],
          ["Win rate", s.trades ? `${s.win_rate}%` : "—", "text-text"],
          ["Closed trades", String(s.trades), "text-text"],
          ["Best trade", s.best_usd == null ? "Hidden" : s.best_usd ? `${s.best_usd > 0 ? "+" : ""}${money(s.best_usd)}` : "—", s.best_usd == null ? "text-muted" : s.best_usd > 0 ? "text-positive" : s.best_usd < 0 ? "text-negative" : "text-text"],
          ["Volume", s.volume_usd == null ? "Hidden" : money(s.volume_usd), s.volume_usd == null ? "text-muted" : "text-text"],
        ] as const
      ).map(([k, v, tone]) => (
        <div key={k} className="bg-surface px-5 py-4">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className={`mt-1 font-mono text-lg ${tone}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One tap to copy: an amount per trade, then every new trade of this trader is copied on
 *  the demo account (lib/copy.ts, components/smart/copy-engine.tsx). */
function CopyTrader({ handle }: { handle: string }) {
  const auth = useAccount();
  const copies = useCopies();
  const mine = copies.find((c) => c.leader === `@${handle}`);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(25);

  if (mine) {
    return (
      <button type="button" onClick={() => removeCopy(mine.id)} className="flex h-9 items-center gap-2 rounded-lg border border-emerald/40 bg-emerald/10 px-4 text-sm text-emerald" title="Stop copying">
        <CopyIcon size={14} strokeWidth={1.5} />
        Copying
      </button>
    );
  }
  const start = () => {
    const err = addCopy(`@${handle}`, "demo", { amount, minSafety: null, mirrorSells: true });
    if (err) return pushToast({ tone: "bad", title: err });
    setOpen(false);
    pushToast({ tone: "good", title: `Copying @${handle} on demo`, body: `$${amount} on each of their new buys, sold when they sell` });
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (auth.status === "signed-in" ? setOpen(!open) : openLogin(`/u/${handle}`))}
        className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm text-text hover:bg-surface-2"
      >
        <CopyIcon size={14} strokeWidth={1.5} />
        Copy
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-surface p-4 shadow-2xl shadow-black/50">
          <p className="text-sm text-text">Copy @{handle}</p>
          <p className="mt-1 text-xs text-text-2">Each of their new buys is bought on your demo account, and sold the same share when they sell</p>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {AMOUNTS.map((a) => (
              <button key={a} type="button" onClick={() => setAmount(a)} aria-pressed={amount === a} className={`h-9 rounded-lg border font-mono text-sm ${amount === a ? "border-emerald/50 bg-emerald/10 text-emerald" : "border-border text-text-2 hover:bg-surface-2"}`}>
                ${a}
              </button>
            ))}
          </div>
          <button type="button" onClick={start} className="mt-3 h-10 w-full rounded-lg bg-emerald text-sm font-medium text-bg hover:opacity-90">
            Start copying
          </button>
          <p className="mt-2 text-[11px] text-muted">Runs while Kixo is open. Manage it under Smart Money, Copy trading</p>
        </div>
      )}
    </div>
  );
}
