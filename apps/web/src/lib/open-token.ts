"use client";

import { useRouter } from "next/navigation";

export const tokenHref = (mint: string) => `/token/${mint}`;

/** Click handler for a whole token row or card. Clicks on inner links and buttons
 *  (copy address, socials) keep their own behaviour. Ctrl/Cmd-click opens a new tab. */
export function useOpenToken() {
  const router = useRouter();
  return (mint: string) => (e: React.MouseEvent) => {
    if ((e.target as Element).closest("a,button")) return;
    if (e.metaKey || e.ctrlKey) window.open(tokenHref(mint), "_blank");
    else router.push(tokenHref(mint));
  };
}
