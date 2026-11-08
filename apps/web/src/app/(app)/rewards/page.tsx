import type { Metadata } from "next";
import { RewardsBoard } from "@/components/rewards/rewards-board";

export const metadata: Metadata = {
  title: "Rewards",
  description: "Kixo rewards: invite friends and earn part of their trading fees, plus cashback on your own trades",
  alternates: { canonical: "/rewards" }, openGraph: { title: "Kixo rewards and referrals · Kixo", description: "Kixo rewards: invite friends and earn part of their trading fees, plus cashback on your own trades", url: "/rewards" },
};

export default function RewardsPage() {
  return <RewardsBoard />;
}
