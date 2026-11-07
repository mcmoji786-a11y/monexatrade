"use client";

import { useEffect, useState } from "react";
import {
  BadgePercent,
  Check,
  CircleCheck,
  Copy,
  Gift,
  Link2,
  Megaphone,
  PauseCircle,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { GATEWAY_HTTP, usd } from "@/lib/gateway";
import { refLink, useReferral } from "@/lib/growth";
import { useAccount, openLogin } from "@/lib/account";
import { pushToast } from "@/lib/toast";
import {
  CASHBACK,
  CREATOR,
  FALLBACK_CONFIG,
  fromGateway,
  PLATFORMS,
  REFERRAL,
  tierFor,
  type RewardsConfig,
  type Tier,
} from "@/lib/rewards";

type Section = "referral" | "cashback" | "creator";

/** Rewards settings from the gateway; the built-in draft while it is unreachable. */
function useRewardsConfig() {
  const [cfg, setCfg] = useState<RewardsConfig>(FALLBACK_CONFIG);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/rewards/config`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: RewardsConfig | null) => c && setCfg(c))
      .catch(() => {});
  }, []);
  return cfg;
}

/** Rewards: Referral, Cashback and the Creator Program. Every number comes from
 *  lib/rewards.ts. Earnings start with trading and accounts, so balances show zero
 *  and say why instead of showing made-up figures. */
export function RewardsBoard() {
  const [section, setSection] = useState<Section>("referral");
  const cfg = useRewardsConfig();
  const SECTIONS: {
    key: Section;
    label: string;
    icon: typeof Gift;
    line: string;
    off?: boolean;
  }[] = [
    {
      key: "referral",
      label: "Referral",
      icon: Users,
      line: `Up to ${cfg.referral_tiers.at(-1)?.pct ?? 0}% of your invites' fees`,
      off: !cfg.referral_enabled,
    },
    {
      key: "cashback",
      label: "Cashback",
      icon: BadgePercent,
      line: `Up to ${cfg.cashback_tiers.at(-1)?.pct ?? 0}% of your own fees back`,
      off: !cfg.cashback_enabled,
    },
    {
      key: "creator",
      label: "Creator Program",
      icon: Megaphone,
      line: `Up to ${cfg.creator_max_share_pct}% for people who bring traders`,
      off: !cfg.creator_open,
    },
  ];

  return (
    <section className="flex flex-col gap-6">
      {/* Title and balances */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text">Rewards</h1>
            {cfg.draft && (
              <span className="rounded-md border border-warning/30 px-2 py-0.5 text-xs text-warning">
                Draft rates
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Earn from the traders you bring, get part of your own fees back, and
            grow with Kixo as a creator. Payouts start when trading goes live
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Balance label="Total earned" />
          <Balance label="Referral" />
          <Balance label="Cashback" />
          <Balance label="Claimable" />
        </dl>
      </div>

      {/* Section switch */}
      <div
        className="grid gap-3 md:grid-cols-3"
        role="tablist"
        aria-label="Rewards programmes"
      >
        {SECTIONS.map((s) => {
          const on = section === s.key;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition-colors ${on ? "border-emerald/40 bg-surface-2" : "border-border bg-surface hover:bg-surface-2"}`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${on ? "border-emerald/40 text-emerald" : "border-border text-muted"}`}
              >
                <s.icon size={18} strokeWidth={1.5} />
              </span>
              <span>
                <span className="flex items-center gap-2 text-sm font-medium text-text">
                  {s.label}
                  {s.off && (
                    <span className="rounded border border-border px-1.5 text-[10px] font-normal text-muted">
                      Paused
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-text-2">
                  {s.line}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div key={section} className="fade-up">
        {section === "referral" && <Referral cfg={cfg} />}
        {section === "cashback" && <Cashback cfg={cfg} />}
        {section === "creator" && <Creator cfg={cfg} />}
      </div>

      <p className="max-w-3xl text-xs leading-5 text-muted">
        Rates and tiers are a draft and may change before launch. Rewards are
        paid from Kixo trading fees only. Nothing here is an investment or a
        promise of income.
      </p>
    </section>
  );
}

function Balance({ label }: { label: string }) {
  return (
    <div title="Starts when trading and accounts go live">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl text-text-2">0 SOL</dd>
    </div>
  );
}

/* ---------------- Referral ---------------- */

function Paused({ what }: { what: string }) {
  return (
    <p className="mb-6 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
      <PauseCircle size={16} strokeWidth={1.5} />
      {what} is paused right now. Rewards already earned are kept
    </p>
  );
}

function Referral({ cfg }: { cfg: RewardsConfig }) {
  const tiers = cfg.referral_tiers.map(fromGateway);
  return (
    <>
      {!cfg.referral_enabled && <Paused what="The invite programme" />}
      <div
        className={cfg.referral_enabled ? "" : "pointer-events-none opacity-50"}
      >
        {reffBody(cfg, tiers)}
      </div>
    </>
  );
}

/** The signed-in user's own invite link, and how many joined with it. */
function InviteLink() {
  const account = useAccount();
  const ref = useReferral();
  if (account.status !== "signed-in")
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-bg px-3 py-2.5 text-sm text-text-2">
        Sign in to get your invite link
        <button type="button" onClick={() => openLogin("/rewards")} className="text-text underline underline-offset-2">
          Sign in
        </button>
      </div>
    );
  const link = ref ? refLink(ref.code) : null;
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      pushToast({ tone: "good", title: "Link copied" });
    } catch {
      pushToast({ tone: "bad", title: "Copy not supported here" });
    }
  };
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="flex h-10 min-w-64 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 font-mono text-sm text-text">
          <Link2 size={14} strokeWidth={1.5} className="text-muted" />
          {link ?? "Creating your link…"}
        </span>
        <button
          type="button"
          disabled={!link}
          onClick={copy}
          className="flex h-10 items-center gap-1.5 rounded-lg border border-border px-4 text-sm text-text-2 transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-50"
        >
          <Copy size={14} strokeWidth={1.5} />
          Copy
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {ref ? `${ref.invited} ${ref.invited === 1 ? "person has" : "people have"} joined with your link · code ${ref.code}` : "Your code is also your name on the competition board"}
      </p>
    </>
  );
}

function reffBody(cfg: RewardsConfig, tiers: Tier[]) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex flex-col gap-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text">Your invite link</p>
              <p className="mt-0.5 text-xs text-text-2">
                Friends who join with it pay {cfg.invitee_discount_pct}% less in
                fees, and you earn a share of every trade they make
              </p>
            </div>
          </div>
          <InviteLink />
        </Card>

        <Steps
          steps={[
            {
              title: "Share your link",
              body: "Post it on X, Telegram or send it to friends",
            },
            {
              title: "They trade",
              body: `They save ${cfg.invitee_discount_pct}% on fees from their first trade`,
            },
            {
              title: "You earn",
              body: "A share of their fees, every trade, with no end date",
            },
          ]}
        />

        <Card title="Your referrals">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Mini k="Invited" v="0" />
            <Mini k="Trading" v="0" />
            <Mini k="Their volume" v="$0" />
            <Mini k="You earned" v="0 SOL" />
          </dl>
          <p className="mt-4 rounded-lg border border-border bg-bg px-3 py-6 text-center text-xs text-muted">
            Invited traders and what each one earned you appear here
          </p>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <TierTable
          title="Referral tiers"
          tiers={tiers}
          unit="of their fees"
          current={0}
        />
        <Rules
          rules={[
            ...REFERRAL.rules.slice(0, 2),
            `Paid in SOL to your wallet, claimable any time above ${cfg.min_claim_sol} SOL`,
            REFERRAL.rules[3],
          ]}
        />
      </div>
    </div>
  );
}

/* ---------------- Cashback ---------------- */

function Cashback({ cfg }: { cfg: RewardsConfig }) {
  const tiers = cfg.cashback_tiers.map(fromGateway);
  const [volume, setVolume] = useState(25_000);
  const { current, next } = tierFor(tiers, volume);
  const fees = (volume * cfg.trading_fee_pct) / 100;
  const back = (fees * current.pct) / 100;

  return (
    <>
      {!cfg.cashback_enabled && <Paused what="Cashback" />}
      <div
        className={cfg.cashback_enabled ? "" : "pointer-events-none opacity-50"}
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex flex-col gap-6">
            <Card title="Cashback calculator">
              <p className="text-xs text-text-2">
                How much of your own trading fees would come back in a month
              </p>
              <label className="mt-4 block">
                <span className="flex items-baseline justify-between text-xs text-muted">
                  Monthly trading volume
                  <span className="font-mono text-base text-text">
                    {usd(volume)}
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={2_000_000}
                  step={5_000}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="mt-2 w-full accent-emerald"
                  aria-label="Monthly trading volume in USD"
                />
                <span className="mt-1 flex justify-between font-mono text-[10px] text-muted">
                  <span>$0</span>
                  <span>$500K</span>
                  <span>$1M</span>
                  <span>$2M</span>
                </span>
              </label>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <Result
                  k="Fees you pay"
                  v={usd(fees)}
                  sub={`${cfg.trading_fee_pct}% of volume`}
                />
                <Result
                  k="Your tier"
                  v={current.name}
                  sub={`${current.pct}% back`}
                  tone="text-emerald"
                />
                <Result
                  k="Cashback a month"
                  v={usd(back)}
                  sub={
                    next
                      ? `${usd(next.minUsd - volume)} more volume to ${next.name}`
                      : "Top tier"
                  }
                  tone="text-positive"
                />
              </div>
              {next && (
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] text-muted">
                    <span>{current.name}</span>
                    <span>
                      {next.name} at {usd(next.minUsd)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-emerald transition-[width] duration-300"
                      style={{
                        width: `${Math.min(100, ((volume - current.minUsd) / (next.minUsd - current.minUsd)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted">
                An estimate from the draft rates, not a promise
              </p>
            </Card>

            <Card title="This month">
              <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Mini k="Your volume" v="$0" />
                <Mini k="Tier" v={tiers[0]?.name ?? "—"} />
                <Mini k="Earned" v="0 SOL" />
                <Mini k="Resets" v="1st of month" />
              </dl>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <TierTable
              title="Cashback tiers"
              tiers={tiers}
              unit="of your fees back"
              current={tiers.indexOf(current)}
            />
            <Rules rules={CASHBACK.rules} />
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Creator Program ---------------- */

function Creator({ cfg }: { cfg: RewardsConfig }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-6">
        <Card>
          <p className="text-sm font-medium text-text">
            For people who bring traders
          </p>
          <p className="mt-1 max-w-xl text-sm text-text-2">
            You post about Solana memecoins and people listen. Bring them to
            Kixo, give them better tools, and earn up to{" "}
            {cfg.creator_max_share_pct}% of the fees they pay
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {CREATOR.benefits.map((b) => (
              <div
                key={b.title}
                className="rounded-xl border border-border bg-bg/40 p-4"
              >
                <p className="text-sm text-text">{b.title}</p>
                <p className="mt-1 text-xs leading-5 text-text-2">
                  {b.title === "Higher revenue share"
                    ? `Up to ${cfg.creator_max_share_pct}% of the trading fees from your audience, above the public referral tiers`
                    : b.body}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Steps
          steps={[
            {
              title: "Apply",
              body: "Add your social accounts and send the request",
            },
            {
              title: "We review",
              body: "The Kixo team checks your profiles and replies",
            },
            {
              title: "Earn and grow",
              body: "Your code, a higher share, live stats and early features",
            },
          ]}
        />

        <Card title="Who can join">
          <ul className="flex flex-col gap-2">
            {CREATOR.requirements.map((r) => (
              <li key={r} className="flex gap-2 text-xs text-text-2">
                <ShieldCheck
                  size={14}
                  strokeWidth={1.5}
                  className="mt-px shrink-0 text-emerald"
                />
                {r}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ApplyForm open={cfg.creator_open} />
    </div>
  );
}

type SocialRow = { platform: string; url: string };

/** Creator application: name, one or more social accounts, audience and a note. Sent
 *  to the gateway, where it waits for the admin. */
function ApplyForm({ open }: { open: boolean }) {
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [socials, setSocials] = useState<SocialRow[]>([
    { platform: "x", url: "" },
  ]);
  const [state, setState] = useState<{
    kind: "idle" | "sending" | "sent" | "error";
    msg?: string;
  }>({ kind: "idle" });

  const used = new Set(socials.map((s) => s.platform));
  const setRow = (i: number, patch: Partial<SocialRow>) =>
    setSocials((rows) =>
      rows.map((r, k) => (k === i ? { ...r, ...patch } : r)),
    );
  const valid =
    name.trim().length > 0 &&
    socials.some((s) => s.url.trim()) &&
    socials.every(
      (s) => !s.url.trim() || /^https:\/\/\S+\.\S+/.test(s.url.trim()),
    );

  const submit = async () => {
    setState({ kind: "sending" });
    try {
      const res = await fetch(`${GATEWAY_HTTP}/creator/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          audience: audience.trim(),
          contact: contact.trim(),
          note: note.trim(),
          socials: socials
            .filter((s) => s.url.trim())
            .map((s) => ({ platform: s.platform, url: s.url.trim() })),
        }),
      });
      if (res.ok) setState({ kind: "sent" });
      else
        setState({
          kind: "error",
          msg: (await res.text()) || "Could not send. Try again",
        });
    } catch {
      setState({
        kind: "error",
        msg: "Kixo is offline. Try again in a moment",
      });
    }
  };

  if (state.kind === "sent") {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CircleCheck size={32} strokeWidth={1.5} className="text-positive" />
          <p className="text-sm font-medium text-text">Application sent</p>
          <p className="max-w-xs text-xs text-text-2">
            The Kixo team reviews every request and replies on the contact you
            gave
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Apply">
      {!open && (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Applications are closed for now
        </p>
      )}
      <div
        className={`flex flex-col gap-3 ${open ? "" : "pointer-events-none opacity-50"}`}
      >
        <Input
          label="Name or handle"
          placeholder="@yourname"
          value={name}
          onChange={setName}
          max={60}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Social accounts</span>
          {socials.map((row, i) => {
            const meta = PLATFORMS.find((p) => p.key === row.platform)!;
            return (
              <div key={i} className="flex gap-1.5">
                <select
                  value={row.platform}
                  onChange={(e) => setRow(i, { platform: e.target.value })}
                  aria-label="Platform"
                  className="h-9 w-32 shrink-0 rounded-lg border border-border bg-bg px-2 text-sm text-text outline-none focus:border-emerald/50"
                >
                  {PLATFORMS.filter(
                    (p) => p.key === row.platform || !used.has(p.key),
                  ).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  value={row.url}
                  onChange={(e) => setRow(i, { url: e.target.value })}
                  placeholder={`${meta.prefix}…`}
                  spellCheck={false}
                  aria-label={`${meta.label} link`}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 font-mono text-xs text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50"
                />
                {socials.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSocials((r) => r.filter((_, k) => k !== i))
                    }
                    aria-label="Remove"
                    className="px-1 text-muted hover:text-negative"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            );
          })}
          {socials.length < PLATFORMS.length && (
            <button
              type="button"
              onClick={() =>
                setSocials((r) => [
                  ...r,
                  {
                    platform: PLATFORMS.find((p) => !used.has(p.key))!.key,
                    url: "",
                  },
                ])
              }
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs text-text-2 hover:text-text"
            >
              <Plus size={13} strokeWidth={1.5} />
              Add another platform
            </button>
          )}
        </div>

        <Input
          label="Audience size"
          placeholder="e.g. 12K followers"
          value={audience}
          onChange={setAudience}
          max={40}
        />
        <Input
          label="Contact for our reply (Telegram or email)"
          placeholder="@telegram or name@mail.com"
          value={contact}
          onChange={setContact}
          max={100}
        />
        <label className="flex flex-col gap-1 text-xs text-muted">
          About your content (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 600))}
            rows={3}
            placeholder="What you post, how often, who follows you"
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
          />
        </label>

        {state.kind === "error" && (
          <p className="text-xs text-negative">{state.msg}</p>
        )}
        <button
          type="button"
          disabled={!valid || state.kind === "sending" || !open}
          onClick={submit}
          className="h-10 rounded-lg bg-text text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {state.kind === "sending" ? "Sending" : "Send application"}
        </button>
        <p className="text-[11px] text-muted">
          Links must start with https://. Your request goes to the Kixo admin
          team
        </p>
      </div>
    </Card>
  );
}

/* ---------------- Shared pieces ---------------- */

function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      {title && <p className="mb-3 text-sm font-medium text-text">{title}</p>}
      {children}
    </div>
  );
}

function Steps({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {steps.map((s, i) => (
        <li
          key={s.title}
          className="fade-up rounded-2xl border border-border bg-surface p-4"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald/40 font-mono text-xs text-emerald">
            {i + 1}
          </span>
          <p className="mt-3 text-sm text-text">{s.title}</p>
          <p className="mt-1 text-xs leading-5 text-text-2">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

function TierTable({
  title,
  tiers,
  unit,
  current,
}: {
  title: string;
  tiers: Tier[];
  unit: string;
  current: number;
}) {
  return (
    <Card title={title}>
      <ul className="flex flex-col gap-2">
        {tiers.map((t, i) => {
          const on = i === current;
          return (
            <li
              key={t.name}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${on ? "border-emerald/40 bg-emerald/5" : "border-border"}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-xs ${on ? "border-emerald/40 text-emerald" : "border-border text-muted"}`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-text">{t.name}</span>
                <span className="block text-[11px] text-muted">{t.unlock}</span>
              </span>
              <span className="text-right">
                <span
                  className={`block font-mono text-lg ${on ? "text-emerald" : "text-text"}`}
                >
                  {t.pct}%
                </span>
                <span className="block text-[10px] text-muted">{unit}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Rules({ rules }: { rules: string[] }) {
  return (
    <Card title="How it works">
      <ul className="flex flex-col gap-2">
        {rules.map((r) => (
          <li key={r} className="flex gap-2 text-xs text-text-2">
            <Check
              size={14}
              strokeWidth={1.5}
              className="mt-px shrink-0 text-positive"
            />
            {r}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="mt-0.5 font-mono text-sm text-text">{v}</dd>
    </div>
  );
}

function Result({
  k,
  v,
  sub,
  tone = "text-text",
}: {
  k: string;
  v: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg/40 p-3">
      <p className="text-[11px] text-muted">{k}</p>
      <p className={`mt-1 font-mono text-xl ${tone}`}>{v}</p>
      <p className="mt-0.5 text-[11px] text-text-2">{sub}</p>
    </div>
  );
}

function Input({
  label,
  placeholder,
  value,
  onChange,
  max,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        placeholder={placeholder}
        className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
      />
    </label>
  );
}
