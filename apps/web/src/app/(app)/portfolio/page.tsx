import { Suspense } from "react";
import type { Metadata } from "next";
import { PortfolioBoard } from "@/components/portfolio/portfolio-board";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Your Kixo portfolio: holdings, profit and loss, and every trade",
  alternates: { canonical: "/portfolio" },
};

export default function PortfolioPage() {
  return (
    <Suspense fallback={null}>
      <PortfolioBoard />
    </Suspense>
  );
}
