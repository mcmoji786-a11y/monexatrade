import { WalletTrackerDrawer } from "@/components/tracker/wallet-tracker";
import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { PriceAlertWatcher } from "@/components/token/price-alerts";
import { SniperEngine } from "@/components/sniper/sniper-engine";
import { RealOrderEngine } from "@/components/trade/order-engine";
import { GridEngine } from "@/components/trade/grid-engine";
import { CopyEngine } from "@/components/smart/copy-engine";
import { Toaster } from "@/components/toaster";
import { ShareCardHost } from "@/components/portfolio/share-card";
import { AuthGate } from "@/components/account/auth-gate";
import { TermsGate } from "@/components/account/terms-gate";
import { WalletSetupGate } from "@/components/wallet/kixo-wallet-card";
import { DemoBanner } from "@/components/account/demo-banner";
import { PageReporter } from "@/components/page-reporter";
import { AnnouncementBar, FeatureGuard } from "@/components/feature-guard";
import { MarketingBanner, MarketingPopup } from "@/components/marketing/marketing-ui";
import { LiveChat } from "@/components/support/live-chat";
import { NewsDock } from "@/components/news/news-panel";

/** App shell: sidebar navigation, top bar and the page content. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <PriceAlertWatcher />
      <SniperEngine />
      <RealOrderEngine />
      <GridEngine />
      <CopyEngine />
      <Toaster />
      <ShareCardHost />
      <WalletTrackerDrawer />
      <Suspense fallback={null}>
        <LiveChat />
      </Suspense>
      <TermsGate />
      <WalletSetupGate />
      <Suspense fallback={null}>
        <PageReporter />
      </Suspense>
      {/* Both read the URL (usePathname), which needs a Suspense boundary on dynamic routes like /token/[mint]. */}
      <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-border bg-surface md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-14 border-b border-border" />}>
          <Topbar />
        </Suspense>
        {/* The trade terminal runs edge to edge; other pages keep the centered column. */}
        <DemoBanner />
        <AnnouncementBar />
        <MarketingBanner />
        <MarketingPopup />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6 has-[.terminal]:max-w-none has-[.terminal]:p-0">
          {/* Pages the admin paused show a notice instead (lib/features.ts). */}
          <Suspense fallback={children}>
            <AuthGate>
              <FeatureGuard>{children}</FeatureGuard>
            </AuthGate>
          </Suspense>
        </main>
      </div>
      {/* Live news: a panel on the right, the page narrows beside it. */}
      <Suspense fallback={null}>
        <NewsDock />
      </Suspense>
    </div>
  );
}
