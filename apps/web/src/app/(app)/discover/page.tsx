import type { Metadata } from "next";
import { DiscoverBoard } from "@/components/discover/discover-board";

export const metadata: Metadata = {
  title: "Discover",
  description: "Discover Solana memecoins: trending, top gainers and new pairs with live prices, volume and safety scores",
  alternates: { canonical: "/discover" }, openGraph: { title: "Discover Solana memecoins · Kixo", description: "Discover Solana memecoins: trending, top gainers and new pairs with live prices, volume and safety scores", url: "/discover" },
};

export default function DiscoverPage() {
  return <DiscoverBoard />;
}
