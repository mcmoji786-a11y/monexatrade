/** Search title and description set in the admin, read on the server (cached 5 minutes).
 *  Falls back to the built-in text when the gateway is not reachable, e.g. at build time. */

import { cacheLife } from "next/cache";
import { GATEWAY_HTTP } from "./gateway";

export const DEFAULT_TITLE = "Kixo – Solana Memecoin Trading Terminal";
export const DEFAULT_DESCRIPTION =
  "Fast Solana memecoin trading terminal: every new launch the second it lands, safety scores, a sniper, smart money and wallet tracking, live on-chain news, and a free demo account at live prices.";

export async function seo(): Promise<{ title: string; description: string }> {
  "use cache";
  // Refreshed every few minutes; built pages keep the last good copy in between.
  cacheLife("minutes");
  try {
    const r = await fetch(`${GATEWAY_HTTP}/marketing`, { signal: AbortSignal.timeout(2_000) });
    if (r.ok) {
      const v = (await r.json()) as { site?: { seo_title?: string; seo_description?: string } };
      return { title: v.site?.seo_title?.trim() || DEFAULT_TITLE, description: v.site?.seo_description?.trim() || DEFAULT_DESCRIPTION };
    }
  } catch {}
  return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
}
