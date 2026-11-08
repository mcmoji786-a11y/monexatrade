import type { Metadata } from "next";
import { SniperBoard } from "@/components/sniper/sniper-board";

export const metadata: Metadata = {
  title: "Sniper",
  description: "Solana sniper bot: buy new launches that pass your rules and sell on take profit, stop loss or trailing stop. Practise free on a demo account",
  alternates: { canonical: "/sniper" }, openGraph: { title: "Solana memecoin sniper · Kixo", description: "Solana sniper bot: buy new launches that pass your rules and sell on take profit, stop loss or trailing stop. Practise free on a demo account", url: "/sniper" },
};

export default function SniperPage() {
  return <SniperBoard />;
}
