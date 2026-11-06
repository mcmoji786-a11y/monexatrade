import Link from "next/link";
import { tokenHref } from "@/lib/open-token";

/** Explicit way into a token's trade page; the whole row or card is clickable too. */
export function TradeLink({ mint, full = false }: { mint: string; full?: boolean }) {
  return (
    <Link
      href={tokenHref(mint)}
      className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-emerald/15 px-3 text-xs font-medium text-emerald transition-colors hover:bg-emerald/25 focus-visible:outline-2 focus-visible:outline-emerald ${
        full ? "w-full" : ""
      }`}
    >
      Trade
    </Link>
  );
}
