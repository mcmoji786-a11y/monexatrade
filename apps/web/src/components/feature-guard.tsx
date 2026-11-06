"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Megaphone, PauseCircle, Wrench } from "lucide-react";
import { FEATURE_LIST, PAGE_FLAG, useFeatures } from "@/lib/features";

/** Site-wide announcement from the admin, above every page. */
export function AnnouncementBar() {
  const f = useFeatures();
  if (!f.announcement_on || !f.announcement.trim()) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-cyan/20 bg-cyan/5 px-4 py-2 text-center text-xs text-text">
      <Megaphone size={13} strokeWidth={1.5} className="shrink-0 text-cyan" />
      {f.announcement}
    </div>
  );
}

/** Shows the page, or a calm notice when the admin paused it or the site is in maintenance. */
export function FeatureGuard({ children }: { children: React.ReactNode }) {
  const f = useFeatures();
  const path = usePathname();
  const flag = PAGE_FLAG[path.split("/")[1] ?? ""];

  if (f.maintenance) {
    return (
      <Notice icon={<Wrench size={22} strokeWidth={1.5} />} title="Maintenance" body={f.maintenance_message || "MONEXA is being upgraded. Back shortly"} />
    );
  }
  if (flag && !f[flag]) {
    const name = FEATURE_LIST.find((x) => x.key === flag)?.label ?? "This page";
    return <Notice icon={<PauseCircle size={22} strokeWidth={1.5} />} title={`${name} is paused`} body="The MONEXA team paused this feature for now. It will be back soon" back />;
  }
  return <>{children}</>;
}

function Notice({ icon, title, body, back }: { icon: React.ReactNode; title: string; body: string; back?: boolean }) {
  return (
    <section className="mx-auto mt-20 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center">
      <span className="text-muted">{icon}</span>
      <h1 className="text-lg font-medium text-text">{title}</h1>
      <p className="text-sm text-text-2">{body}</p>
      {back && (
        <Link href="/discover" className="mt-2 inline-flex h-9 items-center rounded-lg bg-surface-3 px-4 text-sm text-text hover:bg-surface-2">
          Go to Discover
        </Link>
      )}
    </section>
  );
}
