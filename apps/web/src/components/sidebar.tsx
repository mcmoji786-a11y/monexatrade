"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="h-3 w-3 rounded-[3px] bg-emerald" />
        <span className="text-base font-semibold">Monexa</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const href = `/${item.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={item.slug}
              href={href}
              className={`flex h-9 items-center justify-between rounded-lg px-3 text-sm transition-colors duration-150 ${
                active
                  ? "bg-surface-3 text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-text-2 hover:bg-surface-2 hover:text-text"
              } focus-visible:outline-2 focus-visible:outline-emerald`}
            >
              {item.label}
              {item.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-label="live" />}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
