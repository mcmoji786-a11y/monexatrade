"use client";

import { useAccount } from "@/lib/account";
import { setMode, useMode } from "@/lib/demo";

/** A thin strip on every page while the demo account is on, so it is never mistaken
 *  for real money. */
export function DemoBanner() {
  const mode = useMode();
  const account = useAccount();
  if (mode !== "demo" || account.status !== "signed-in") return null;
  return (
    <div className="flex items-center justify-center gap-3 border-b border-warning/20 bg-warning/10 px-4 py-1.5 text-xs whitespace-nowrap text-warning">
      <span className="sm:hidden">Demo: virtual money, live prices</span>
      <span className="hidden sm:inline">Demo account: virtual money, live market prices</span>
      <button type="button" onClick={() => setMode("real")} className="underline underline-offset-2 hover:text-text">
        Switch to real
      </button>
    </div>
  );
}
