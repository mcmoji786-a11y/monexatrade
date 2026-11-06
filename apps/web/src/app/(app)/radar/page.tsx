import { Suspense } from "react";
import type { Metadata } from "next";
import { RadarBoard } from "@/components/radar/radar-board";

export const metadata: Metadata = { title: "Sol Radar · MONEXA" };

export default function RadarPage() {
  // RadarBoard reads ?q= from the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <RadarBoard />
    </Suspense>
  );
}
