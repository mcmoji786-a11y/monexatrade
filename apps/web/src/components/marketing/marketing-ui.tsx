"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useAccount } from "@/lib/account";
import { forAudience, useCampaignCapture, useMarketing, type Message } from "@/lib/marketing";

/** Tracking links: remembers `?c=CODE` and reports the visit and the sign-up. */
export function CampaignCapture() {
  useCampaignCapture();
  return null;
}

function MessageLink({ m, className }: { m: Message; className: string }) {
  if (!m.link) return null;
  const label = m.link_label || "Open";
  return m.link.startsWith("/") ? (
    <Link href={m.link} className={className}>
      {label}
    </Link>
  ) : (
    <a href={m.link} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
    </a>
  );
}

/** The admin's scheduled banner, above every page, for the chosen audience. */
export function MarketingBanner() {
  const { banner } = useMarketing();
  const account = useAccount();
  if (!banner || account.status === "loading" || !forAudience(banner, account.status === "signed-in")) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-emerald/20 bg-emerald/5 px-4 py-2 text-center text-xs text-text">
      {banner.title && <span className="font-medium">{banner.title}</span>}
      <span className="text-text-2">{banner.text}</span>
      <MessageLink m={banner} className="text-emerald underline-offset-2 hover:underline" />
    </div>
  );
}

const SEEN_KEY = "kixo.popup.seen";

/** The admin's popup (also used for broadcasts): shown once per visitor until it changes. */
export function MarketingPopup() {
  const { popup } = useMarketing();
  const account = useAccount();
  const [closed, setClosed] = useState<string | null>(() => {
    try {
      return typeof window !== "undefined" ? localStorage.getItem(SEEN_KEY) : null;
    } catch {
      return null;
    }
  });
  if (!popup || account.status === "loading" || closed === popup.id || !forAudience(popup, account.status === "signed-in")) return null;
  const close = () => {
    try {
      localStorage.setItem(SEEN_KEY, popup.id);
    } catch {}
    setClosed(popup.id);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={popup.title || "Message"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={close}>
      <div className="relative w-full max-w-[440px] rounded-2xl border border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text">
          <X size={16} strokeWidth={1.5} />
        </button>
        {popup.title && <h2 className="pr-8 text-lg font-medium text-text">{popup.title}</h2>}
        {popup.text && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-text-2">{popup.text}</p>}
        <div className="mt-5 flex gap-2">
          <MessageLink m={popup} className="flex h-10 items-center justify-center rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90" />
          <button type="button" onClick={close} className="flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm text-text-2 hover:bg-surface-2 hover:text-text">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Social links set in the admin, for the site footer. */
export function SocialLinks() {
  const { site } = useMarketing();
  const links = (
    [
      ["X", site.x],
      ["Telegram", site.telegram],
      ["Discord", site.discord],
      ["YouTube", site.youtube],
    ] as const
  ).filter(([, href]) => href);
  if (!links.length) return null;
  return (
    <nav aria-label="Kixo on social media" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-2">
      {links.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="hover:text-text">
          {label}
        </a>
      ))}
    </nav>
  );
}
