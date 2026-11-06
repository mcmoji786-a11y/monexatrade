import type { Metadata } from "next";
import { MonitorBoard } from "@/components/monitor/monitor-board";

export const metadata: Metadata = { title: "Wallet Monitor · MONEXA" };

export default function WalletsPage() {
  return <MonitorBoard />;
}
