import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

/** App shell: sidebar navigation, top bar and the page content. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Both read the URL (usePathname), which needs a Suspense boundary on dynamic routes like /token/[mint]. */}
      <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-border bg-surface md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-14 border-b border-border" />}>
          <Topbar />
        </Suspense>
        {/* The trade terminal runs edge to edge; other pages keep the centered column. */}
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6 has-[.terminal]:max-w-none has-[.terminal]:p-0">{children}</main>
      </div>
    </div>
  );
}
