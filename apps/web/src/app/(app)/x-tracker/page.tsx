import type { Metadata } from "next";
import { XTracker } from "@/components/xtrack/x-tracker";

export const metadata: Metadata = {
  title: "X Tracker",
  description: "Choose X accounts and get an alert when one posts a Solana contract address",
  alternates: { canonical: "/x-tracker" },
};

export default function XTrackerPage() {
  return <XTracker />;
}
