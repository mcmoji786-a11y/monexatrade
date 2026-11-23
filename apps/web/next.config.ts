import type { NextConfig } from "next";

/* Security headers on every page:
   - no other site may show Kixo inside a frame (clickjacking on the wallet and trade
     buttons): X-Frame-Options and CSP frame-ancestors;
   - the browser never guesses a file's type (nosniff);
   - links to other sites carry only Kixo's address, not the page path;
   - camera and location stay off; the microphone only for Kixo itself (Kixo Agent's
     push-to-talk), never for another site in a frame; payment and passkeys allowed;
   - HTTPS only once it is served over HTTPS (the header is ignored on http://localhost). */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), browsing-topics=(), payment=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Do not announce the framework to scanners.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
