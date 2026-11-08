import type { Metadata } from "next";
import { CompetitionBoard } from "@/components/competition/competition-board";

export const metadata: Metadata = {
  title: "Weekly competition",
  description: "Weekly Solana memecoin trading competition on demo accounts: climb the leaderboard with no real money at risk",
  alternates: { canonical: "/competition" }, openGraph: { title: "Memecoin trading competition · Kixo", description: "Weekly Solana memecoin trading competition on demo accounts: climb the leaderboard with no real money at risk", url: "/competition" },
};

export default function CompetitionPage() {
  return <CompetitionBoard />;
}
