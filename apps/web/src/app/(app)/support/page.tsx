import type { Metadata } from "next";
import { SupportBoard } from "@/components/support/support-board";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with Kixo: guides, tickets and live chat",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return <SupportBoard />;
}
