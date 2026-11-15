"use client";
/* "3 KOLs" on a coin: well-known traders bought it in the last 24 hours. The names are in
   the tooltip; on the trade page the full chip lists them. */
import { BadgeCheck } from "lucide-react";
import { useCoinKols } from "@/lib/kols";
import { useFeatures } from "@/lib/features";

export function KolBadge({ mint, size = "sm" }: { mint: string; size?: "sm" | "md" }) {
  const f = useFeatures();
  const kols = useCoinKols(mint);
  if (!f.kol_tracker || kols.length === 0) return null;
  const names = kols.map((k) => (k.x ? `${k.name} (@${k.x})` : k.name)).join(", ");
  return (
    <span
      title={`KOLs who bought in the last 24 hours: ${names}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan/30 bg-cyan/5 text-cyan ${size === "md" ? "h-8 px-2.5 text-sm" : "h-5 px-1.5 text-[11px]"}`}
    >
      <BadgeCheck size={size === "md" ? 14 : 11} strokeWidth={1.5} />
      {kols.length} KOL{kols.length === 1 ? "" : "s"}
      {size === "md" && <span className="max-w-40 truncate text-text-2">· {kols.slice(0, 2).map((k) => k.name).join(", ")}{kols.length > 2 ? "…" : ""}</span>}
    </span>
  );
}
