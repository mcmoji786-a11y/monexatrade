import { Suspense } from "react";
import type { Metadata } from "next";
import { PortfolioBoard } from "@/components/portfolio/portfolio-board";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return (
    <Suspense fallback={null}>
      <PortfolioBoard />
    </Suspense>
  );
}
