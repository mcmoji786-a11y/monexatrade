import type { Metadata } from "next";
import { DiscoverBoard } from "@/components/discover/discover-board";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return <DiscoverBoard />;
}
