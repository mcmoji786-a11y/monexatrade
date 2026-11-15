import { Suspense } from "react";
import type { Metadata } from "next";
import { TraderView } from "@/components/social/trader-view";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const h = decodeURIComponent(handle).replace(/^@/, "").toLowerCase().slice(0, 20);
  return { title: `@${h} on Kixo`, description: `@${h}'s Solana memecoin trades on Kixo: results, latest trades, follow and copy`, alternates: { canonical: `/u/${h}` } };
}

export default function TraderPage() {
  // TraderView reads the handle from the URL in the browser, which needs a Suspense boundary.
  return (
    <Suspense>
      <TraderView />
    </Suspense>
  );
}
