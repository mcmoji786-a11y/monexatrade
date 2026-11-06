import type { Metadata } from "next";
import { SmartMoneyBoard } from "@/components/smart/smart-board";

export const metadata: Metadata = { title: "Smart Money · MONEXA" };

export default function SmartMoneyPage() {
  return <SmartMoneyBoard />;
}
