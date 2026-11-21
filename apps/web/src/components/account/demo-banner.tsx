"use client";

import { useAccount } from "@/lib/account";
import { setMode, useMode } from "@/lib/demo";

/** A thin strip on phones while the demo account is on, so it is never mistaken for real
 *  money. On wider screens the top bar says it beside the Demo/Real switch instead. */
export function DemoBanner() {
  const mode = useMode();
  const account = useAccount();
  if (mode !== "demo" || account.status !== "signed-in") return null;
  return (
    <div className="flex items-center justify-center gap-3 border-b border-warning/15 md:hidden bg-warning/[0.06] px-4 py-0.5 text-[11px] whitespace-nowrap text-warning">
      <span className="sm:hidden">Demo: virtual money, live prices</span>
      <span className="hidden sm:inline">Demo account: virtual money, live market prices</span>
      <button type="button" onClick={() => setMode("real")} className="-my-0.5 inline-flex h-6 items-center px-1 underline underline-offset-2 hover:text-text">
        Switch to real
      </button>
    </div>
  );
}
