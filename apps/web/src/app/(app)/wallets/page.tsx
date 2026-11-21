import type { Metadata } from "next";
import { Suspense } from "react";
import { MonitorHub } from "@/components/monitor/monitor-hub";

export const metadata: Metadata = {
  title: "Wallet Monitor",
  description: "Follow Solana wallets, well-known traders and coin calls on X, with an alert the moment they buy, sell or post",
  alternates: { canonical: "/wallets" },
  openGraph: { title: "Solana wallet monitor · Kixo", description: "Follow Solana wallets, well-known traders and coin calls on X, with an alert the moment they buy, sell or post", url: "/wallets" },
};

export default function WalletsPage() {
  return (
    <Suspense>
      <MonitorHub />
    </Suspense>
  );
}
