import { Suspense } from "react";
import type { Metadata } from "next";
import { CashtagView } from "@/components/social/cashtag-view";

export async function generateMetadata({ params }: { params: Promise<{ q: string }> }): Promise<Metadata> {
  const { q } = await params;
  const s = decodeURIComponent(q).replace(/^\$/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 44);
  return { title: `$${s} on Kixo`, description: `Trade $${s} on Solana with Kixo: live chart, safety score and Kixo AI`, robots: { index: false } };
}

/** kixo.trade/x/$SYMBOL: the link behind an X cashtag (and the Kixo browser extension). */
export default function CashtagPage() {
  return (
    <Suspense>
      <CashtagView />
    </Suspense>
  );
}
