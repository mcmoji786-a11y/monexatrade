import type { Metadata } from "next";
import { KolBoard } from "@/components/kols/kol-board";

export const metadata: Metadata = {
  title: "KOL Tracker",
  description: "Well-known Solana memecoin traders, named with their X accounts, and every trade they make, live",
  alternates: { canonical: "/kols" },
  openGraph: { title: "Kixo KOL Tracker", description: "Well-known Solana memecoin traders and every trade they make, live", url: "/kols" },
};

export default function KolsPage() {
  return <KolBoard />;
}
