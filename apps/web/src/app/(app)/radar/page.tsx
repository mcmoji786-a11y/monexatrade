import { Suspense } from "react";
import type { Metadata } from "next";
import { RadarBoard } from "@/components/radar/radar-board";

export const metadata: Metadata = {
  title: "Sol Radar",
  description: "Sol Radar: every new Solana token from pump.fun, letsbonk.fun, Bags and Moonshot the second it launches, with curve progress and risk checks",
  alternates: { canonical: "/radar" }, openGraph: { title: "Sol Radar – new Solana token scanner · Kixo", description: "Sol Radar: every new Solana token from pump.fun, letsbonk.fun, Bags and Moonshot the second it launches, with curve progress and risk checks", url: "/radar" },
};

export default function RadarPage() {
  // RadarBoard reads ?q= from the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <RadarBoard />
    </Suspense>
  );
}
