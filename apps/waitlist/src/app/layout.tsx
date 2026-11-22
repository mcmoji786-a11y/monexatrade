import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Kixo · AI Memecoin Trading Bot & Solana Trading Terminal", template: "%s · Kixo" },
  applicationName: "Kixo",
  keywords: [
    "Solana memecoin trading bot",
    "AI trading bot",
    "memecoin trading terminal",
    "Solana trading terminal",
    "pump.fun trading bot",
    "AI memecoin trading",
    "rug pull checker",
    "Solana sniper bot",
    "copy trading Solana",
    "memecoin safety score",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  category: "finance",
  description: "Kixo is an AI agent that auto-trades Solana memecoins within your rules, with 100,000+ strategies trained on 3 years of market data, a fast engine and every coin's risk in plain sight. Join the waitlist.",
  /* The link preview on WhatsApp, X, Telegram, Discord and LinkedIn: a 1200x630 JPEG under
     300 KB (WhatsApp drops bigger images). Icons come from app/icon.png, apple-icon.png
     and favicon.ico, which Google also uses next to the search result. */
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Kixo",
    locale: "en_US",
    title: "Kixo · The AI that trades memecoins for you",
    description: "An AI agent that auto-trades Solana memecoins within your rules. Join the waitlist.",
    images: [{ url: "/og.jpg", width: 1200, height: 630, type: "image/jpeg", alt: "Kixo, the Solana memecoin trading terminal" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@kixotrade",
    creator: "@kixotrade",
    title: "Kixo · The AI that trades memecoins for you",
    description: "An AI agent that auto-trades Solana memecoins within your rules. Join the waitlist.",
    images: [{ url: "/og.jpg", alt: "Kixo, the Solana memecoin trading terminal" }],
  },
  /* Search Console and Bing ownership by meta tag, when their codes are set on the server. */
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
};

// viewport-fit=cover: the phone pass button can sit above the iPhone home bar (safe area).
export const viewport: Viewport = { themeColor: "#050506", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
