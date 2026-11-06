import type { Metadata } from "next";
import { SniperBoard } from "@/components/sniper/sniper-board";

export const metadata: Metadata = { title: "Sniper · MONEXA" };

export default function SniperPage() {
  return <SniperBoard />;
}
