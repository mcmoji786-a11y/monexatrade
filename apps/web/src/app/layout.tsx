import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ReferralCapture } from "@/components/account/referral-capture";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Kixo – AI-Powered Solana Memecoin Trading Terminal", template: "%s · Kixo" },
  applicationName: "Kixo",
  description: "See every new Solana token the second it launches, priced from on-chain trades.",
};

/** Root layout: fonts and theme only. The marketing site and the app each add their own shell. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} antialiased`}>
      <body className="min-h-screen">
        <ReferralCapture />
        {children}
      </body>
    </html>
  );
}
