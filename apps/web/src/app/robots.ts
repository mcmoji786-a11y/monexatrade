import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Search engines may read the public site and the guides; account pages stay out (the admin is not listed: its address is secret, proxy.ts). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/auth/", "/login", "/settings", "/portfolio"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
