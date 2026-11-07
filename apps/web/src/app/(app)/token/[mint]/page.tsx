import { Suspense } from "react";
import type { Metadata } from "next";
import { TokenView } from "@/components/trade/token-view";

export const metadata: Metadata = { title: "Trade" };

export default function TokenPage() {
  // TokenView reads the mint from the URL in the browser, which needs a Suspense boundary.
  return (
    <Suspense>
      <TokenView />
    </Suspense>
  );
}
