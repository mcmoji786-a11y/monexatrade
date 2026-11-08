import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/guides";
import { SITE_URL } from "@/lib/site";

/** The public pages search engines should know about: the site and the guides. App pages
 *  need an account, so they are reached from here rather than listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/learn`, changeFrequency: "weekly", priority: 0.8 },
    ...GUIDES.map((g) => ({ url: `${SITE_URL}/learn/${g.slug}`, lastModified: new Date(`${g.updated}T00:00:00Z`), changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
