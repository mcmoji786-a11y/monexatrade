"use client";

import { KixoLogo } from "@/components/brand";
import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

// From "/" so they also work on the Learn pages.
const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#security", label: "Security" },
  { href: "/#fees", label: "Fees" },
  { href: "/learn", label: "Learn" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-300 items-center gap-8 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-emerald">
          <KixoLogo size={26} text="text-[17px]" />
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-text-2 transition-colors hover:text-text">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ButtonLink href="/discover" className="hidden sm:inline-flex">
            Trade now
          </ButtonLink>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text md:hidden"
          >
            {open ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border px-4 py-3 md:hidden" aria-label="Main">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex h-11 items-center rounded-lg px-3 text-text-2 hover:bg-surface-2 hover:text-text"
            >
              {l.label}
            </Link>
          ))}
          <ButtonLink href="/discover" className="mt-2 w-full">
            Trade now
          </ButtonLink>
        </nav>
      )}
    </header>
  );
}
