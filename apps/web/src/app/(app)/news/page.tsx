import type { Metadata } from "next";
import { NewsFeed } from "@/components/news/news-panel";

export const metadata: Metadata = {
  title: "News",
  description: "Live Solana memecoin news: pumps, trending coins, graduations and whale buys from on-chain data, plus crypto news and videos",
  alternates: { canonical: "/news" }, openGraph: { title: "Solana memecoin news · Kixo", description: "Live Solana memecoin news: pumps, trending coins, graduations and whale buys from on-chain data, plus crypto news and videos", url: "/news" },
};

/** The news feed as a page (phones, and direct links). On desktop it also opens as a
 *  panel beside any page. */
export default function NewsPage() {
  return (
    <section className="-mx-4 -my-6 h-[calc(100dvh-3.5rem)] border-border bg-surface md:mx-auto md:my-0 md:h-[calc(100dvh-8rem)] md:max-w-2xl md:rounded-xl md:border">
      <NewsFeed />
    </section>
  );
}
