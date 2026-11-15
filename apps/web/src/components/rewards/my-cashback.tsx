"use client";
/* The signed-in user's own numbers on Rewards: the welcome fee while it lasts, and the
   cashback earned this month on real trades (gateway cashback.rs). Payouts open with
   real trading; until then this counts honestly, from the user's confirmed trades. */
import { useEffect, useState } from "react";
import { BadgePercent, Sparkle } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { accessToken, useAccount } from "@/lib/account";
import { getPromo, type PromoState } from "@/lib/marketing";

type Cashback = {
  enabled: boolean;
  trades: number;
  volume_usd: number;
  fees_sol: number;
  tier: { name: string; pct: number } | null;
  next_tier: { name: string; pct: number; min_usd: number } | null;
  pct: number;
  cashback_sol: number;
  min_claim_sol: number;
  payouts_open: boolean;
};

export function useMyCashback() {
  const auth = useAccount();
  const [c, setC] = useState<Cashback | null>(null);
  useEffect(() => {
    if (auth.status !== "signed-in") return;
    const token = accessToken();
    fetch(`${GATEWAY_HTTP}/account/cashback`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setC)
      .catch(() => setC(null));
  }, [auth.status]);
  return c;
}

/** "Welcome fee 0.25% until 15 Dec": shown while a new account pays less. */
export function WelcomeFee() {
  const auth = useAccount();
  const [p, setP] = useState<PromoState | null>(null);
  useEffect(() => {
    if (auth.status === "signed-in") void getPromo().then(setP).catch(() => setP(null));
  }, [auth.status]);
  if (!p?.welcome_until) return null;
  const until = new Date(p.welcome_until * 1000).toLocaleDateString([], { day: "numeric", month: "short" });
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald/30 bg-emerald/5 px-4 py-3 text-sm text-text-2">
      <Sparkle size={15} strokeWidth={1.5} className="text-emerald" />
      <span>
        Welcome fee: <span className="font-mono text-text">{(p.trade_fee_bps / 100).toFixed(2)}%</span> per trade until {until}, instead of{" "}
        <span className="font-mono">{((p.base_trade_fee_bps ?? p.trade_fee_bps) / 100).toFixed(2)}%</span>
      </span>
    </p>
  );
}

/** This month's cashback, from the user's own confirmed real trades. */
export function MyCashback() {
  const auth = useAccount();
  const c = useMyCashback();
  if (auth.status !== "signed-in" || !c) return null;
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-sm text-text">
        <BadgePercent size={15} strokeWidth={1.5} className="text-muted" />
        Your cashback this month
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fig k="Real volume" v={`$${c.volume_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} sub={`${c.trades} trades`} />
        <Fig k="Tier" v={c.tier ? `${c.tier.name} · ${c.tier.pct}%` : "—"} sub={c.next_tier ? `${c.next_tier.name} at $${c.next_tier.min_usd.toLocaleString()}` : "Top tier"} />
        <Fig k="Fees paid" v={`${c.fees_sol.toFixed(4)} SOL`} />
        <Fig k="Cashback" v={`${c.cashback_sol.toFixed(4)} SOL`} tone="text-emerald" />
      </dl>
      <p className="mt-3 text-xs text-muted">
        {c.trades === 0 ? "Counts real trades only; demo trades pay no fee. " : ""}
        {c.payouts_open ? `Claim from ${c.min_claim_sol} SOL` : "Payouts open together with real trading"}
      </p>
    </section>
  );
}

function Fig({ k, v, sub, tone = "text-text" }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg px-3 py-2.5">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`mt-1 font-mono text-base ${tone}`}>{v}</dd>
      {sub && <dd className="text-[11px] text-muted">{sub}</dd>}
    </div>
  );
}
