import { Suspense } from "react";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { TokenView } from "@/components/trade/token-view";
import { GATEWAY_HTTP } from "@/lib/gateway";

/** The coin's name for its search title and share preview (cached a few minutes; a plain
 *  title when the gateway is not reachable). */
async function coinName(mint: string): Promise<{ symbol: string; name: string } | null> {
  "use cache";
  cacheLife("minutes");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  try {
    const r = await fetch(`${GATEWAY_HTTP}/token/${mint}`, { signal: AbortSignal.timeout(2_000) });
    const v = r.ok ? ((await r.json()) as { symbol?: string; name?: string } | null) : null;
    return v?.symbol ? { symbol: v.symbol.trim(), name: (v.name ?? "").trim() } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps<"/token/[mint]">): Promise<Metadata> {
  const { mint } = await params;
  const c = await coinName(mint);
  if (!c) return { title: "Trade", description: "Trade this Solana token on Kixo: live chart, holders, trades and safety score" };
  const title = `$${c.symbol} price, chart and safety score`;
  const description = `${c.name || c.symbol} ($${c.symbol}) on Solana: live price, chart, market cap, holders, trades and safety checks. Trade it on Kixo`;
  return { title, description, alternates: { canonical: `/token/${mint}` }, openGraph: { title: `${title} · Kixo`, description, url: `/token/${mint}` } };
}

export default function TokenPage() {
  // TokenView reads the mint from the URL in the browser, which needs a Suspense boundary.
  return (
    <Suspense>
      <TokenView />
    </Suspense>
  );
}
