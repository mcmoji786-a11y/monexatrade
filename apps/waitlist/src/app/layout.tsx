import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Kixo · See the rug before you buy",
  description: "Kixo is a Solana memecoin trading terminal: every new coin the second it launches, a safety score, dev, sniper and bundler labels, and a free demo at live prices. Join the waitlist.",
  openGraph: { title: "Kixo · See the rug before you buy", description: "A Solana memecoin terminal that shows the trap before you buy. Join the waitlist.", images: ["/og.png"] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: { icon: "/kixo-mark.png" },
};

export const viewport: Viewport = { themeColor: "#050506" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
