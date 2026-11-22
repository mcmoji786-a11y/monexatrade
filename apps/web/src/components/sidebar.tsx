"use client";

import { KixoMark } from "@/components/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/nav";
import { useSupportUnread } from "@/lib/support";
import { toggleNews, useNews } from "@/lib/news";

/** Navigation used by the desktop sidebar and the mobile drawer. `rail`: the desktop
 *  icon rail, whose labels fade in when the sidebar opens on hover. */
export function NavList({ onNavigate, rail = false }: { onNavigate?: () => void; rail?: boolean }) {
  // Labels on the rail: hidden while closed, faded in when the sidebar opens.
  const label = rail ? "opacity-0 transition-opacity duration-150 group-hover/side:opacity-100 group-has-[:focus-visible]/side:opacity-100" : "";
  const pathname = usePathname();
  const unread = useSupportUnread();
  const news = useNews(false);
  return (
    <nav className="flex flex-col gap-2.5 px-1.5 py-2" aria-label="Main">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.label}>
          <div className={`relative h-5 px-2 text-xs whitespace-nowrap text-muted ${label}`}>{group.label}</div>
          {rail && gi > 0 && <div className="-mt-2.5 mb-2.5 ml-3 h-px w-5 bg-border transition-opacity group-hover/side:opacity-0" aria-hidden="true" />}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const href = `/${item.slug}`;
              // On desktop News is a panel beside the page, not a page of its own.
              const panel = item.slug === "news" && !onNavigate;
              const active = panel ? news.open : pathname === href || pathname.startsWith(`${href}/`);
              const Icon = item.icon;
              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    data-tour={onNavigate ? undefined : `nav-${item.slug}`}
                    onClick={(e) => {
                      if (panel) {
                        e.preventDefault();
                        toggleNews();
                      }
                      onNavigate?.();
                    }}
                    aria-pressed={panel ? news.open : undefined}

                    aria-current={active ? "page" : undefined}
                    className={`relative flex h-9 items-center gap-3 rounded-md text-sm whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-emerald ${rail ? "pl-[13px]" : "px-2"} ${
                      active
                        ? "bg-surface-3 text-text"
                        : item.live
                          ? "text-text-2 hover:bg-surface-2 hover:text-text"
                          : "text-muted hover:bg-surface-2 hover:text-text-2"
                    }`}
                  >
                    {/* The active page's marker: a short emerald rail on the left edge. */}
                    {active && <span className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-emerald" aria-hidden="true" />}
                    {/* New support replies: a count on Support (a dot on the collapsed rail). */}
                    {item.slug === "support" && unread > 0 && rail && <span className="absolute top-1.5 left-7 h-1.5 w-1.5 rounded-full bg-emerald group-hover/side:hidden" aria-label={`${unread} new replies`} />}
                    <Icon size={18} strokeWidth={1.5} className={`shrink-0 ${active ? "text-emerald" : item.live ? "text-text-2" : "text-muted/70"}`} />
                    <span className={`flex min-w-0 flex-1 items-center gap-2 ${label}`}>
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {panel && news.unread > 0 && !news.open && <span className="rounded-full bg-surface-3 px-1.5 font-mono text-[10px] leading-4 text-text-2" aria-label={`${news.unread} new stories`}>{news.unread > 99 ? "99+" : news.unread}</span>}
                        {item.slug === "support" && unread > 0 && <span className="rounded-full bg-emerald px-1.5 font-mono text-[10px] leading-4 text-bg" aria-label={`${unread} new replies`}>{unread}</span>}
                        {/* Built sections need no badge; only the ones still coming say so. */}
                        {!item.live && <span className="rounded border border-border px-1.5 py-px text-[10px] leading-4 text-muted">Soon</span>}
                      </>
                    </span>
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

export function Logo({ compact = false, fade = false }: { compact?: boolean; fade?: boolean }) {
  return (
    <Link href="/discover" aria-label="Kixo home" className="flex min-h-9 min-w-9 items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-emerald">
      <KixoMark size={28} />
      {!compact && (
        <span className={`text-xl font-semibold tracking-tight whitespace-nowrap text-text ${fade ? "opacity-0 transition-opacity duration-150 group-hover/side:opacity-100 group-has-[:focus-visible]/side:opacity-100" : ""}`}>Kixo</span>
      )}
    </Link>
  );
}

export function Sidebar() {
  // A 56px icon rail holds the page's place; the panel opens over the page (no layout
  // jump) while the pointer is on it, and closes as it leaves.
  return (
    <div className="sticky top-0 z-50 hidden h-screen w-14 shrink-0 md:block">
      <aside className="group/side absolute inset-y-0 left-0 z-40 flex w-14 flex-col overflow-hidden border-r border-border bg-surface transition-[width,box-shadow] duration-200 ease-out hover:w-56 hover:shadow-2xl hover:shadow-black/70 has-[:focus-visible]:w-56">
        <div className="flex h-11 shrink-0 items-center border-b border-border pl-[13px]">
          <Logo fade />
        </div>
        <div className="nav-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <NavList rail />
        </div>
      </aside>
    </div>
  );
}
