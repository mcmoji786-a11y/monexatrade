"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Newspaper, Search, X } from "lucide-react";
import { toggleNews, useNews } from "@/lib/news";
import { useFeatures } from "@/lib/features";
import { ConnectionNotice } from "./gateway-status";
import { Logo, NavList } from "./sidebar";
import { AccountMenu } from "./account/account-menu";

/** App top bar: mobile menu, global token search and the account controls. A notice
 *  appears only when the live connection is lost. */
export function Topbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Escape closes the drawer; links close it through onNavigate.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur md:px-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text md:hidden"
        >
          <Menu size={18} strokeWidth={1.5} />
        </button>
        {/* On a phone the mark alone, so the account controls fit without a sideways scroll. */}
        <div className="sm:hidden">
          <Logo compact />
        </div>
        <div className="hidden sm:block md:hidden">
          <Logo />
        </div>
        <GlobalSearch key={pathname} />
        <div className="ml-auto flex items-center gap-3">
          <ConnectionNotice />
          <NewsButton />
          <AccountMenu />
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="drawer-in absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border bg-surface">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="-mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Search by name, ticker or contract address. Opens Sol Radar with the query.
 *  Press "/" anywhere to focus it. */
function GlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(target.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="hidden min-w-0 flex-1 sm:block lg:max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        // A pasted contract address goes straight to its trade page.
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) {
          setValue("");
          input.current?.blur();
          router.push(`/token/${q}`);
          return;
        }
        router.push(q ? `/radar?q=${encodeURIComponent(q)}` : "/radar");
      }}
    >
      <label className="flex h-10 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-sm transition-colors hover:border-text/15 focus-within:border-emerald/50 focus-within:bg-surface-2">
        <Search size={16} strokeWidth={1.5} className="shrink-0 text-muted" />
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by name, symbol or paste a contract address"
          aria-label="Search token or contract address"
          className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-muted"
          spellCheck={false}
        />
        <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 font-mono text-[11px] text-muted lg:block">/</kbd>
      </label>
    </form>
  );
}

/** Opens the news panel; a dot shows when stories arrived while it was closed. */
function NewsButton() {
  const f = useFeatures();
  const news = useNews(f.news);
  if (!f.news) return null;
  return (
    <button
      type="button"
      onClick={toggleNews}
      aria-pressed={news.open}
      aria-label={news.unread > 0 && !news.open ? `News, ${news.unread} new stories` : "News"}
      title="News  N"
      className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${news.open ? "border-emerald/40 bg-surface-3 text-text" : "border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text"}`}
    >
      <Newspaper size={16} strokeWidth={1.5} />
      {news.unread > 0 && !news.open && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald" />}
    </button>
  );
}
