"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { isWallet, forgetRecent, remember, useRecentWallets } from "@/lib/tracker";
import { shortAddress } from "@/lib/gateway";
import { WalletTracker } from "./wallet-tracker";

/** Tools · Wallet Tracker: paste any Solana wallet and see its balance, coins and swaps. */
export function TrackerPage() {
  const params = useSearchParams();
  const router = useRouter();
  const w = params.get("w")?.trim() ?? "";
  const address = isWallet(w) ? w : null;
  const [q, setQ] = useState(w);
  const [error, setError] = useState<string | null>(null);
  const recent = useRecentWallets();

  useEffect(() => {
    if (address) remember(address);
  }, [address]);

  const go = (a: string) => router.push(`/tracker?w=${a}`);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-medium text-text">Wallet Tracker</h1>
        <p className="mt-1 text-sm text-text-2">Any Solana wallet: its balance in SOL and dollars, every coin it holds, and what it bought and sold in the last hours</p>
      </header>

      <form
        className="flex h-12 max-w-2xl items-center gap-3 rounded-xl border border-border bg-surface px-4 focus-within:border-emerald/50"
        onSubmit={(e) => {
          e.preventDefault();
          const a = q.trim();
          if (!isWallet(a)) return setError("That is not a Solana wallet address");
          setError(null);
          go(a);
        }}
      >
        <Search size={16} strokeWidth={1.5} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paste a wallet address" spellCheck={false} autoFocus={!address} className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text outline-none placeholder:font-sans placeholder:text-muted" />
        {q && (
          <button type="button" aria-label="Clear" onClick={() => setQ("")} className="text-muted hover:text-text">
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
        <button type="submit" className="h-8 rounded-lg bg-text px-3 text-sm font-medium text-bg hover:opacity-90">
          Track
        </button>
      </form>
      {error && <p className="-mt-3 text-xs text-negative">{error}</p>}

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-text-2">Recently viewed</span>
          {recent.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setQ(a);
                go(a);
              }}
              className={`rounded-md border px-2 py-1 font-mono transition-colors ${a === address ? "border-emerald/40 text-text" : "border-border text-text-2 hover:bg-surface-2 hover:text-text"}`}
            >
              {shortAddress(a)}
            </button>
          ))}
          <button type="button" onClick={forgetRecent} className="text-muted hover:text-text">
            Clear
          </button>
        </div>
      )}

      {address ? (
        <WalletTracker key={address} address={address} />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-5 py-10 text-center text-sm text-text-2">
          Paste a wallet above, or click any wallet address on Kixo (traders, holders, Smart Money) to open it here
        </p>
      )}
    </div>
  );
}
