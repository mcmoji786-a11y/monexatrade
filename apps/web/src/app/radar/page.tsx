import type { Metadata } from "next";
import { RadarBoard } from "@/components/radar/radar-board";

export const metadata: Metadata = { title: "Sol Radar · MONEXA" };

export default function RadarPage() {
  return <RadarBoard />;
}
