import type { Metadata } from "next";
import { CommunityBoard } from "@/components/social/community-board";

export const metadata: Metadata = {
  title: "Community",
  description: "Follow Solana memecoin traders on Kixo, see their trades live, check the leaderboard and copy the ones who win",
  alternates: { canonical: "/community" },
  openGraph: { title: "Kixo Community · follow and copy memecoin traders", description: "Follow Solana memecoin traders on Kixo, see their trades live, check the leaderboard and copy the ones who win", url: "/community" },
};

export default function CommunityPage() {
  return <CommunityBoard />;
}
