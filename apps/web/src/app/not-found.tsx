import type { Metadata } from "next";
import Link from "next/link";
import { StatusPage } from "@/components/status-page";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/** Any address Kixo has no page for. */
export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="This page is not on Kixo"
      body="The link may be old or mistyped. To open a coin, paste its contract address into the search on Sol Radar"
      action={
        <Link href="/radar" className="flex h-10 items-center rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90">
          Open Sol Radar
        </Link>
      }
    />
  );
}
