import type { MetadataRoute } from "next";

/** Lets phones add Kixo to the home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kixo – Solana Memecoin Trading Terminal",
    short_name: "Kixo",
    description: "Trade Solana memecoins: new launches, safety scores, sniper, smart money and a free demo account.",
    start_url: "/discover",
    scope: "/",
    display: "standalone",
    background_color: "#08090a",
    theme_color: "#08090a",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/brand/kixo-mark-128.png", sizes: "128x128", type: "image/png" },
      { src: "/brand/kixo-mark.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
