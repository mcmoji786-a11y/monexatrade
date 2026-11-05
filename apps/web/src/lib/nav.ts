// Navigation from MONEXA_MASTER_SPEC.md section 18.
// `phase` is the roadmap phase where the section gets real functionality.
export type NavItem = { slug: string; label: string; phase: string };

export const NAV: NavItem[] = [
  { slug: "", label: "Dashboard", phase: "Phase 2" },
  { slug: "pulse", label: "Pulse", phase: "Phase 2" },
  { slug: "markets", label: "Markets", phase: "Phase 2" },
  { slug: "trade", label: "Trade", phase: "Phase 3" },
  { slug: "sniper", label: "Sniper", phase: "Future (Phase 2 of product)" },
  { slug: "ai", label: "AI Intelligence", phase: "Future (Phase 2 of product)" },
  { slug: "wallets", label: "Wallet Tracker", phase: "Phase 5" },
  { slug: "portfolio", label: "Portfolio", phase: "Phase 4" },
  { slug: "news", label: "News", phase: "Phase 6" },
  { slug: "rewards", label: "Rewards", phase: "Phase 6" },
  { slug: "support", label: "Support", phase: "Phase 6" },
  { slug: "settings", label: "Settings", phase: "Phase 3" },
];
