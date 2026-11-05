// Navigation from MONEXA_MASTER_SPEC.md section 18.
// `phase` is the roadmap phase where the section gets real functionality.
// `live` marks sections that already show real data.
export type NavItem = { slug: string; label: string; phase: string; live?: boolean };

export const NAV: NavItem[] = [
  { slug: "", label: "Dashboard", phase: "Phase 2" },
  { slug: "radar", label: "Sol Radar", phase: "Phase 1", live: true },
  { slug: "markets", label: "Markets", phase: "Phase 2" },
  { slug: "trade", label: "Trade", phase: "Phase 3" },
  { slug: "sniper", label: "Sniper", phase: "Product phase 2" },
  { slug: "ai", label: "AI Intelligence", phase: "Product phase 2" },
  { slug: "wallets", label: "Wallet Tracker", phase: "Phase 5" },
  { slug: "portfolio", label: "Portfolio", phase: "Phase 4" },
  { slug: "news", label: "News", phase: "Phase 6" },
  { slug: "rewards", label: "Rewards", phase: "Phase 6" },
  { slug: "support", label: "Support", phase: "Phase 6" },
  { slug: "settings", label: "Settings", phase: "Phase 3" },
];

/** Sections that have their own page and must not use the placeholder route. */
export const BUILT = new Set(["radar"]);
