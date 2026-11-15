"use client";
/* Small shared pieces of Community: a trader's avatar, a trade line, the follow button. */
import Link from "next/link";
import { useState } from "react";
import { follow, money, timeAgo, type SocialTrade } from "@/lib/social";
import { tokenHref } from "@/lib/open-token";
import { useAccount, openLogin } from "@/lib/account";
import { QuickBuy } from "@/components/trade/quick-buy";
import { pushToast } from "@/lib/toast";

/** A trader is their handle: a quiet initial, no picture to upload or moderate. */
export function TraderAvatar({ handle, size = 32 }: { handle: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-3 font-medium text-text-2 uppercase"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {handle.slice(0, 1)}
    </span>
  );
}

export function TradeLine({ t, now, showTrader = true }: { t: SocialTrade; now: number; showTrader?: boolean }) {
  const buy = t.side === "buy";
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      {showTrader && t.handle && (
        <Link href={`/u/${t.handle}`} aria-label={`@${t.handle}`}>
          <TraderAvatar handle={t.handle} />
        </Link>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate text-text-2">
          {showTrader && t.handle && (
            <Link href={`/u/${t.handle}`} className="text-text hover:underline">
              @{t.handle}
            </Link>
          )}{" "}
          {buy ? "bought" : "sold"}{" "}
          <Link href={tokenHref(t.mint)} className="text-text hover:underline">
            {t.symbol || t.mint.slice(0, 6)}
          </Link>
        </p>
        <p className="font-mono text-[11px] text-muted">
          {money(t.usd)}
          {!buy && t.realized_usd != null && (
            <span className={t.realized_usd >= 0 ? "text-positive" : "text-negative"}>
              {" "}
              · {t.realized_usd >= 0 ? "+" : ""}
              {money(t.realized_usd)} profit
            </span>
          )}
          {now > 0 && ` · ${timeAgo(t.ts, now)} ago`}
        </p>
      </div>
      <QuickBuy mint={t.mint} symbol={t.symbol} />
    </li>
  );
}

export function FollowButton({ handle, initial, onChange }: { handle: string; initial: boolean; onChange?: (on: boolean) => void }) {
  const auth = useAccount();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (auth.status !== "signed-in") return openLogin(`/u/${handle}`);
    setBusy(true);
    try {
      const r = await follow(handle, !on);
      setOn(r.following);
      onChange?.(r.following);
    } catch (e) {
      pushToast({ tone: "bad", title: "Could not update", body: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      className={`h-9 rounded-lg px-4 text-sm transition-colors disabled:opacity-60 ${on ? "border border-border text-text-2 hover:bg-surface-2" : "bg-text font-medium text-bg hover:opacity-90"}`}
    >
      {on ? "Following" : "Follow"}
    </button>
  );
}
