"use client";

import { useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { execute, tradeErrorText, useVenue } from "@/lib/execute";
import { useFeatures } from "@/lib/features";
import { useSettings } from "@/lib/settings";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 });

/** One-click buy on a Discover or Sol Radar row: the Quick Buy amount from Settings
 *  ($ on demo, SOL on real), without opening the coin. Same path as every other trade. */
export function QuickBuy({ mint, symbol, className = "" }: { mint: string; symbol: string; className?: string }) {
  const on = useFeatures().quick_buy;
  const { venue, why } = useVenue();
  const { settings } = useSettings();
  const { solUsd } = useRadarFeed();
  const [busy, setBusy] = useState(false);
  if (!on) return null;

  const demo = venue !== "real";
  const amount = demo ? settings.demo.quick_buy_usd : settings.trading.quick_buy_sol;
  const label = demo ? `$${amount}` : `${amount}`;

  const buy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!venue) {
      pushToast({ tone: "info", title: "Quick Buy", body: why ?? "Not available" });
      return;
    }
    setBusy(true);
    try {
      const f = await execute(venue, { mint, symbol, side: "buy", ...(venue === "demo" ? { usd: amount } : { sol: amount }), solUsd, source: "quick" });
      const spent = venue === "demo" ? money(f.usd ?? amount) : `${f.sol.toFixed(3)} SOL`;
      pushToast({
        kind: "trade",
        tone: "good",
        title: `Bought ${f.symbol || symbol} · ${venue}`,
        body: `${spent}${f.priceUsd ? ` at $${f.priceUsd < 0.0001 ? f.priceUsd.toExponential(2) : f.priceUsd.toPrecision(4)}` : ""}${f.feeUsd != null ? ` · fee ${money(f.feeUsd)}` : ""}`,
        href: tokenHref(mint),
      });
    } catch (err) {
      pushToast({ tone: "bad", title: `Quick Buy failed: ${symbol || "coin"}`, body: tradeErrorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={buy}
      disabled={busy}
      title={venue ? `Buy ${demo ? money(amount) : `${amount} SOL`} of ${symbol || "this coin"} now (${venue}). Change the amount in Settings` : (why ?? undefined)}
      aria-label={`Quick Buy ${symbol}`}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 font-mono text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-emerald disabled:opacity-60 ${
        venue ? "border-emerald/30 bg-emerald/10 text-emerald hover:bg-emerald/20" : "border-border text-muted hover:text-text-2"
      } ${className}`}
    >
      {busy ? <Loader2 size={11} strokeWidth={1.5} className="animate-spin" /> : <Zap size={11} strokeWidth={1.5} />}
      {label}
    </button>
  );
}
