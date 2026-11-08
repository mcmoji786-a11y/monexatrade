import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ReferralCapture } from "@/components/account/referral-capture";
import { CampaignCapture } from "@/components/marketing/marketing-ui";
import { seo } from "@/lib/seo";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

/** Title and description from the admin (Marketing, Social and search). */
export async function generateMetadata(): Promise<Metadata> {
  const s = await seo();
  return { title: { default: s.title, template: "%s · Kixo" }, applicationName: "Kixo", description: s.description };
}

/** Root layout: fonts and theme only. The marketing site and the app each add their own shell. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} antialiased`}>
      <body className="min-h-screen">
        <ReferralCapture />
        <CampaignCapture />
        {children}
      </body>
    </html>
  );
}
