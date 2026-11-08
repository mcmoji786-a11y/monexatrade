import type { Metadata, Viewport } from "next";
import { KEYWORDS, SITE_NAME, SITE_URL } from "@/lib/site";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ReferralCapture } from "@/components/account/referral-capture";
import { CampaignCapture } from "@/components/marketing/marketing-ui";
import { ErrorReporter } from "@/components/error-reporter";
import { seo } from "@/lib/seo";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

/** Title and description from the admin (Marketing, Social and search). */
export async function generateMetadata(): Promise<Metadata> {
  const s = await seo();
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: s.title, template: "%s · Kixo" },
    applicationName: SITE_NAME,
    description: s.description,
    keywords: KEYWORDS,
    category: "finance",
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: SITE_NAME, title: s.title, description: s.description, url: "/", locale: "en_US" },
    twitter: { card: "summary_large_image", title: s.title, description: s.description },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = { themeColor: "#08090a", colorScheme: "dark" };

/** Root layout: fonts and theme only. The marketing site and the app each add their own shell. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} antialiased`}>
      <body className="min-h-screen">
        <ErrorReporter />
        <ReferralCapture />
        <CampaignCapture />
        {children}
      </body>
    </html>
  );
}
