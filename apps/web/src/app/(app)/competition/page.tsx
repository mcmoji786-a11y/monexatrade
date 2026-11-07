import type { Metadata } from "next";
import { CompetitionBoard } from "@/components/competition/competition-board";

export const metadata: Metadata = { title: "Weekly competition" };

export default function CompetitionPage() {
  return <CompetitionBoard />;
}
