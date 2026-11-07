import type { Metadata } from "next";
import { RewardsBoard } from "@/components/rewards/rewards-board";

export const metadata: Metadata = { title: "Rewards" };

export default function RewardsPage() {
  return <RewardsBoard />;
}
