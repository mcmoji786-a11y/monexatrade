import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Search engines may read the public site and the guides; account and admin pages stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin-preview", "/auth/", "/login", "/settings", "/portfolio"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
