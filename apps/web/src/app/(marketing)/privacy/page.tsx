import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/legal-page";
import { PRIVACY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Kixo keeps about you, what stays in your browser, what it never collects, and how to download or delete your data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalPage eyebrow="Privacy Policy" title="Privacy Policy" intro="What Kixo keeps about you and why, in plain words." sections={PRIVACY} />;
}
