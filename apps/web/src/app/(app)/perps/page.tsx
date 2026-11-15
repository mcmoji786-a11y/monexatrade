import type { Metadata } from "next";
import { PerpsBoard } from "@/components/perps/perps-board";

export const metadata: Metadata = {
  title: "Perps",
  description: "Practice perpetual futures on live Hyperliquid prices with Kixo's demo account: long or short with leverage, real fees and funding",
  alternates: { canonical: "/perps" },
};

export default function PerpsPage() {
  return <PerpsBoard />;
}
