// Navigation from MONEXA_MASTER_SPEC.md section 18.
// `phase` is the roadmap phase where the section gets real functionality.
// `live` marks sections that already work with real data.
import type { LucideIcon } from "lucide-react";
import {
  Brain,
  ChartPie,
  Compass,
  Crosshair,
  Gift,
  LifeBuoy,
  Newspaper,
  Radar,
  ScanSearch,
  Settings,
  Trophy,
  Wallet,
} from "lucide-react";

export type NavItem = { slug: string; label: string; phase: string; icon: LucideIcon; live?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Markets",
    items: [
      { slug: "discover", label: "Discover", phase: "Phase 1", icon: Compass, live: true },
      { slug: "radar", label: "Sol Radar", phase: "Phase 1", icon: Radar, live: true },
    ],
  },
  {
    label: "Tools",
    items: [
      { slug: "sniper", label: "Sniper", phase: "Phase 1", icon: Crosshair, live: true },
      { slug: "ai", label: "AI Intelligence", phase: "Product phase 2", icon: ScanSearch },
      { slug: "smart-money", label: "Smart Money", phase: "Phase 1", icon: Brain, live: true },
      { slug: "wallets", label: "Wallet Monitor", phase: "Phase 1", icon: Wallet, live: true },
    ],
  },
  {
    label: "Account",
    items: [
      { slug: "portfolio", label: "Portfolio", phase: "Phase 1", icon: ChartPie, live: true },
      { slug: "competition", label: "Competition", phase: "Phase 1", icon: Trophy, live: true },
      { slug: "rewards", label: "Rewards", phase: "Phase 1", icon: Gift, live: true },
    ],
  },
  {
    label: "Help",
    items: [
      { slug: "news", label: "News", phase: "Phase 6", icon: Newspaper, live: true },
      { slug: "support", label: "Support", phase: "Phase 6", icon: LifeBuoy, live: true },
      { slug: "settings", label: "Settings", phase: "Phase 3", icon: Settings, live: true },
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Sections that have their own page and must not use the placeholder route. */
export const BUILT = new Set(["discover", "radar", "smart-money", "wallets", "sniper", "rewards", "portfolio", "competition", "settings", "support", "news"]);
