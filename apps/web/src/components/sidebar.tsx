"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <span className="h-2.5 w-2.5 rounded-sm bg-emerald" />
        <span className="text-sm font-semibold tracking-[0.2em]">MONEXA</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const href = `/${item.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={item.slug}
              href={href}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-surface-2 text-emerald"
                  : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
