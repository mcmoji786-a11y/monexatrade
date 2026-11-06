"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/nav";

/** Navigation used by the desktop sidebar and the mobile drawer. */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-6 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-3 pb-2 text-xs text-muted">{group.label}</div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const href = `/${item.slug}`;
              const active = pathname === href;
              const Icon = item.icon;
              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-emerald ${
                      active
                        ? "bg-surface-3 text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "text-text-2 hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    <Icon size={16} strokeWidth={1.5} className={active ? "text-emerald" : "text-muted"} />
                    <span className="flex-1">{item.label}</span>
                    {item.live ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-label="Live" />
                    ) : (
                      <span className="text-[11px] text-muted">Soon</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Logo() {
  return (
    <Link href="/discover" className="flex items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-emerald">
      <span className="h-3 w-3 rounded-[3px] bg-emerald" />
      <span className="text-base font-semibold text-text">Monexa</span>
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-6">
        <Logo />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavList />
      </div>
    </aside>
  );
}
