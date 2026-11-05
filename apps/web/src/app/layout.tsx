import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { GatewayStatus } from "@/components/gateway-status";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MONEXA",
  description: "AI-powered Solana trading and market intelligence terminal",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex h-full min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-border px-5">
            <span className="text-sm font-semibold tracking-[0.2em] md:hidden">MONEXA</span>
            <div className="ml-auto">
              <GatewayStatus />
            </div>
          </header>
          <main className="flex-1 p-5">{children}</main>
        </div>
      </body>
    </html>
  );
}
