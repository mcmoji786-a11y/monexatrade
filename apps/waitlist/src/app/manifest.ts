import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kixo: AI Solana memecoin trading",
    short_name: "Kixo",
    description: "The AI that trades Solana memecoins for you.",
    start_url: "/",
    display: "standalone",
    background_color: "#050506",
    theme_color: "#050506",
    icons: [{ src: "/kixo-mark.png", sizes: "512x512", type: "image/png" }],
  };
}
