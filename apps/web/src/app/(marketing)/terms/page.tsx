import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/legal-page";
import { TERMS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms for using Kixo, the Solana memecoin trading terminal: not financial advice, your keys stay yours, fees, the demo account and automatic tools.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalPage eyebrow="Terms of Use" title="Terms of Use" intro="The rules for using Kixo, in plain words. By creating an account you accept them." sections={TERMS} />;
}
