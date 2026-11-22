import type { NextConfig } from "next";

/* `standalone`: the build carries its own server and only the packages it uses, so the
   VPS needs Node and nothing else (scripts/deploy-waitlist.ps1). */
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
