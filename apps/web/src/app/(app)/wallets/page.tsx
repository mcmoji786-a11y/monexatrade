import type { Metadata } from "next";
import { MonitorBoard } from "@/components/monitor/monitor-board";

export const metadata: Metadata = {
  title: "Wallet Monitor",
  description: "Monitor Solana wallets and get an alert the moment they buy or sell",
  alternates: { canonical: "/wallets" }, openGraph: { title: "Solana wallet monitor · Kixo", description: "Monitor Solana wallets and get an alert the moment they buy or sell", url: "/wallets" },
};

export default function WalletsPage() {
  return <MonitorBoard />;
}
