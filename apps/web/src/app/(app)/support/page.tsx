import type { Metadata } from "next";
import { SupportBoard } from "@/components/support/support-board";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return <SupportBoard />;
}
