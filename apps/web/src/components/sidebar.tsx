"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_GROUPS } from "@/lib/nav";
import { useSupportUnread } from "@/lib/support";
import { toggleNews, useNews } from "@/lib/news";

/* Collapsed or full sidebar, remembered per browser (a convenience only). */
const KEY = "mx.sidebar";
let collapsed = false;
let loaded = false;
const listeners = new Set<() => void>();
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    collapsed = localStorage.getItem(KEY) === "1";
  } catch {}
}
function setCollapsed(v: boolean) {
  collapsed = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}
function useCollapsed() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (load(), collapsed),
    () => false,
  );
}

/** Navigation used by the desktop sidebar and the mobile drawer. `rail` shows icons only. */
export function NavList({ onNavigate, rail = false }: { onNavigate?: () => void; rail?: boolean }) {
  const pathname = usePathname();
  const unread = useSupportUnread();
  const news = useNews(false);
  return (
    <nav className={`flex flex-col py-4 ${rail ? "gap-3 px-2" : "gap-6 px-3"}`} aria-label="Main">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.label}>
          {rail ? (
            gi > 0 && <div className="mx-2 mb-3 h-px bg-border" aria-hidden="true" />
          ) : (
            <div className="px-3 pb-2 text-xs text-muted">{group.label}</div>
          )}
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
                    onClick={(e) => {
                      if (panel) {
                        e.preventDefault();
                        toggleNews();
                      }
                      onNavigate?.();
                    }}
                    aria-pressed={panel ? news.open : undefined}
                    title={rail ? `${item.label}${item.live ? "" : " (soon)"}` : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex h-9 items-center rounded-lg text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-emerald ${rail ? "justify-center" : "gap-2.5 px-3"} ${
                      active
                        ? "bg-surface-3 text-text"
                        : item.live
                          ? "text-text-2 hover:bg-surface-2 hover:text-text"
                          : "text-muted hover:bg-surface-2 hover:text-text-2"
                    }`}
                  >
                    {/* The active page's marker: a short emerald rail on the left edge. */}
                    {active && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-emerald" aria-hidden="true" />}
                    {/* New support replies: a count on Support (a dot on the collapsed rail). */}
                    {item.slug === "support" && unread > 0 && rail && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald" aria-label={`${unread} new replies`} />}
                    <Icon size={16} strokeWidth={1.5} className={active ? "text-emerald" : item.live ? "text-text-2" : "text-muted/70"} />
                    {!rail && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {panel && news.unread > 0 && !news.open && <span className="rounded-full bg-surface-3 px-1.5 font-mono text-[10px] leading-4 text-text-2" aria-label={`${news.unread} new stories`}>{news.unread > 99 ? "99+" : news.unread}</span>}
                        {item.slug === "support" && unread > 0 && <span className="rounded-full bg-emerald px-1.5 font-mono text-[10px] leading-4 text-bg" aria-label={`${unread} new replies`}>{unread}</span>}
                        {/* Built sections need no badge; only the ones still coming say so. */}
                        {!item.live && <span className="rounded border border-border px-1.5 py-px text-[10px] leading-4 text-muted">Soon</span>}
                      </>
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

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/discover" aria-label="Kixo home" className="flex items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-emerald">
      <span className="h-3 w-3 rounded-[3px] bg-emerald" />
      {!compact && <span className="text-base font-semibold text-text">Kixo</span>}
    </Link>
  );
}

function Keycap({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-bg px-1.5 font-mono text-[10px] leading-4 text-muted">{children}</kbd>;
}

export function Sidebar() {
  const rail = useCollapsed();

  // "[" toggles the sidebar, as in most trading terminals (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']");
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || typing) return;
      setCollapsed(!collapsed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex ${rail ? "w-16" : "w-60"}`}>
      <div className={`flex h-14 shrink-0 items-center border-b border-border ${rail ? "justify-center" : "px-6"}`}>
        <Logo compact={rail} />
      </div>
      <div className="nav-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <NavList rail={rail} />
      </div>
      <div className={`shrink-0 border-t border-border p-2 ${rail ? "flex justify-center" : ""}`}>
        <button
          type="button"
          onClick={() => setCollapsed(!rail)}
          title={rail ? "Expand sidebar  [" : "Collapse sidebar  ["}
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!rail}
          className={`flex h-9 items-center rounded-lg text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text-2 focus-visible:outline-2 focus-visible:outline-emerald ${rail ? "w-9 justify-center" : "w-full gap-2.5 px-3"}`}
        >
          {rail ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
          {!rail && (
            <>
              <span className="flex-1 text-left">Collapse</span>
              <Keycap>[</Keycap>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
