import type { Metadata } from "next";
import { SniperBoard } from "@/components/sniper/sniper-board";

export const metadata: Metadata = { title: "Sniper" };

export default function SniperPage() {
  return <SniperBoard />;
}
