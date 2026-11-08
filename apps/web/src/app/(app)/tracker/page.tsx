import type { Metadata } from "next";
import { Suspense } from "react";
import { TrackerPage } from "@/components/tracker/tracker-page";

export const metadata: Metadata = { title: "Wallet Tracker" };

export default function WalletTrackerPage() {
  return (
    <Suspense>
      <TrackerPage />
    </Suspense>
  );
}
