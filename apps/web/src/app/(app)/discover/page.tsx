import type { Metadata } from "next";
import { DiscoverBoard } from "@/components/discover/discover-board";

export const metadata: Metadata = { title: "Discover · MONEXA" };

export default function DiscoverPage() {
  return <DiscoverBoard />;
}
