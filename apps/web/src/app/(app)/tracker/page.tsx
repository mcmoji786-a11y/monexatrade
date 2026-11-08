import type { Metadata } from "next";
import { Suspense } from "react";
import { TrackerPage } from "@/components/tracker/tracker-page";

export const metadata: Metadata = {
  title: "Wallet Tracker",
  description: "Solana wallet tracker: any wallet's balance, every coin it holds, profit and loss and its recent swaps",
  alternates: { canonical: "/tracker" }, openGraph: { title: "Solana wallet tracker · Kixo", description: "Solana wallet tracker: any wallet's balance, every coin it holds, profit and loss and its recent swaps", url: "/tracker" },
};

export default function WalletTrackerPage() {
  return (
    <Suspense>
      <TrackerPage />
    </Suspense>
  );
}
