import type { Metadata } from "next";
import { SmartMoneyBoard } from "@/components/smart/smart-board";

export const metadata: Metadata = {
  title: "Smart Money",
  description: "Track Solana smart money: wallets ranked by realized profit, what they buy and sell, and when",
  alternates: { canonical: "/smart-money" }, openGraph: { title: "Solana smart money tracker · Kixo", description: "Track Solana smart money: wallets ranked by realized profit, what they buy and sell, and when", url: "/smart-money" },
};

export default function SmartMoneyPage() {
  return <SmartMoneyBoard />;
}
