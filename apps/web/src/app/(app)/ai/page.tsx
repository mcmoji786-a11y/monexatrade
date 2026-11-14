import type { Metadata } from "next";
import { AiBoard } from "@/components/ai/ai-board";

export const metadata: Metadata = {
  title: "Kixo AI",
  description: "Kixo AI judges every new Solana memecoin from its first 2 minutes: the chance it dumps 70% or doubles within the hour, with a live track record",
  alternates: { canonical: "/ai" },
  openGraph: {
    title: "Kixo AI · dump and 2x odds for new Solana coins",
    description: "Kixo AI judges every new Solana memecoin from its first 2 minutes: the chance it dumps 70% or doubles within the hour, with a live track record",
    url: "/ai",
  },
};

export default function AiPage() {
  return <AiBoard />;
}
