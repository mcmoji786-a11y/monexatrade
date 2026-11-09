import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Kixo · The AI that trades memecoins for you",
  description: "Kixo is an AI agent that auto-trades Solana memecoins within your rules, with 100,000+ strategies trained on 3 years of market data, a fast engine and every coin's risk in plain sight. Join the waitlist.",
  openGraph: { title: "Kixo · The AI that trades memecoins for you", description: "An AI agent that auto-trades Solana memecoins within your rules. Join the waitlist.", images: ["/og.png"] },
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
