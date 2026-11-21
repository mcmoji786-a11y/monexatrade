"use client";
/* Wallet Monitor page: one place for everything that watches other traders. Three tabs,
   the user's own wallets, the well-known traders (KOLs) and coin calls posted on X. The tab
   lives in the link (?tab=kols, ?tab=calls) so a refresh or a shared link opens it again.
   Each tab keeps its own admin switch; a paused one is left out. */
import { useRouter, useSearchParams } from "next/navigation";
import { useFeatures, type Features } from "@/lib/features";
import { MonitorBoard } from "./monitor-board";
import { KolBoard } from "@/components/kols/kol-board";
import { XTracker } from "@/components/xtrack/x-tracker";

type Tab = "wallets" | "kols" | "calls";
const TABS: { key: Tab; label: string; hint: string; flag: keyof Features }[] = [
  { key: "wallets", label: "Wallets", hint: "Wallets you follow", flag: "wallet_monitor" },
  { key: "kols", label: "KOLs", hint: "Well-known traders", flag: "kol_tracker" },
  { key: "calls", label: "Calls", hint: "Coins posted on X", flag: "x_tracker" },
];

export function MonitorHub() {
  const f = useFeatures();
  const router = useRouter();
  const params = useSearchParams();
  const tabs = TABS.filter((t) => f[t.flag]);
  const asked = params.get("tab") as Tab | null;
  const tab = tabs.find((t) => t.key === asked)?.key ?? tabs[0]?.key ?? "wallets";
  const pick = (t: Tab) => router.replace(t === "wallets" ? "/wallets" : `/wallets?tab=${t}`, { scroll: false });

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-medium text-text">Wallet Monitor</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">Follow wallets, well-known traders and coin calls on X. Their buys, sells and posts land here as they happen, and alerts reach you when Kixo is closed</p>
        </div>
        {tabs.length > 1 && (
          <div role="tablist" aria-label="Monitor" className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => pick(t.key)}
                className={`-mb-px flex h-10 items-center gap-2 border-b px-3 text-sm transition-colors ${tab === t.key ? "border-emerald text-text" : "border-transparent text-text-2 hover:text-text"}`}
              >
                {t.label}
                <span className="hidden text-xs text-muted sm:inline">{t.hint}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      {tabs.length === 0 && <p className="rounded-xl border border-border bg-surface px-5 py-10 text-center text-sm text-text-2">Wallet Monitor is paused by the Kixo team for now. It will be back soon</p>}
      {tabs.length > 0 && tab === "wallets" && <MonitorBoard />}
      {tab === "kols" && <KolBoard />}
      {tab === "calls" && <XTracker />}
    </section>
  );
}
