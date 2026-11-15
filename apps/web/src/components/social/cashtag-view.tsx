"use client";
/* /x/$SYMBOL (an X cashtag) or /x/<address>: finds the coin and opens its trade page. When
   one coin is the clear match (an exact address, a single result, or a verified coin far
   deeper than the rest) it opens straight away; otherwise the candidates are listed, since
   copies of famous names are common. */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, TriangleAlert } from "lucide-react";
import { GATEWAY_HTTP, usd } from "@/lib/gateway";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "@/components/token/token-bits";

type Hit = { mint: string; symbol: string; name: string; image: string | null; mc_usd: number | null; liquidity_usd: number | null; verified: boolean; launchpad: string | null; source: "new" | "market" };

/** Coins whose symbol is exactly the cashtag; the search also returns similar names. */
const norm = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
const exactOf = (q: string, hits: Hit[]) => hits.filter((h) => norm(h.symbol) === norm(q));

function clearWinner(q: string, hits: Hit[]): Hit | null {
  const byMint = hits.find((h) => h.mint === q);
  if (byMint) return byMint;
  const exact = exactOf(q, hits);
  if (exact.length === 1) return exact[0];
  // Several coins use the name: only a verified one far deeper than the next opens itself.
  const [a, b] = [...exact].sort((x, y) => (y.liquidity_usd ?? 0) - (x.liquidity_usd ?? 0));
  if (a?.verified && !b?.verified && (a.liquidity_usd ?? 0) > 10 * (b?.liquidity_usd ?? 0)) return a;
  return null;
}

export function CashtagView() {
  const params = useParams<{ q: string }>();
  const router = useRouter();
  const q = decodeURIComponent(params?.q ?? "").replace(/^\$/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 44);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!q) return;
    let alive = true;
    // The market search is rate limited: a busy answer is asked again twice.
    const ask = (tries: number): Promise<{ results: Hit[]; busy?: boolean }> =>
      fetch(`${GATEWAY_HTTP}/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ results: Hit[]; busy?: boolean }>)
        .then((v) => (v.busy && !v.results.length && tries > 0 ? new Promise((ok) => setTimeout(ok, 2000)).then(() => ask(tries - 1)) : v));
    ask(2)
      .then((v) => {
        if (!alive) return;
        const win = clearWinner(q, v.results);
        if (win) router.replace(tokenHref(win.mint));
        else if (v.busy && !v.results.length) setErr(true);
        else setHits(v.results);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [q, router]);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-medium text-text">${q || "?"}</h1>
      {err ? (
        <p className="text-sm text-text-2">Could not search right now. Try again in a moment</p>
      ) : !hits ? (
        <p className="text-sm text-muted">Finding ${q}</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-text-2">No Solana coin called ${q} found. Paste its address in the search box instead</p>
      ) : (
        <>
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-text-2">
            <TriangleAlert size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-warning" />
            {exactOf(q, hits).length > 1 ? `${exactOf(q, hits).length} coins use $${q}. Copies of famous names are common: pick the one whose address matches the post` : `No single coin is called $${q}. These have similar names: check the address in the post`}
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {[...exactOf(q, hits), ...hits.filter((h) => !exactOf(q, hits).includes(h))].map((h) => (
              <li key={h.mint}>
                <Link href={tokenHref(h.mint)} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                  <TokenLogo src={h.image} symbol={h.symbol} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm text-text">
                      {h.symbol}
                      {h.verified && <BadgeCheck size={14} strokeWidth={1.5} className="text-cyan" aria-label="Verified" />}
                      <span className="truncate text-xs text-muted">{h.name}</span>
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted">
                      {h.mint.slice(0, 6)}…{h.mint.slice(-6)}
                      {h.source === "new" ? " · just launched" : h.launchpad ? ` · ${h.launchpad}` : ""}
                      {norm(h.symbol) !== norm(q) && " · similar name"}
                    </span>
                  </span>
                  <span className="text-right font-mono text-xs text-text-2">
                    <span className="block">MC {usd(h.mc_usd)}</span>
                    {h.liquidity_usd != null && <span className="block text-muted">Liq {usd(h.liquidity_usd)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
