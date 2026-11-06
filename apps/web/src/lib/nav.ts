// Navigation from MONEXA_MASTER_SPEC.md section 18.
// `phase` is the roadmap phase where the section gets real functionality.
// `live` marks sections that already work with real data.
import type { LucideIcon } from "lucide-react";
import {
  ChartPie,
  Compass,
  Crosshair,
  Gift,
  LayoutGrid,
  LifeBuoy,
  Newspaper,
  Radar,
  ScanSearch,
  Settings,
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
      { slug: "wallets", label: "Wallet Tracker", phase: "Phase 5", icon: Wallet },
      { slug: "sniper", label: "Sniper", phase: "Product phase 2", icon: Crosshair },
      { slug: "ai", label: "AI Intelligence", phase: "Product phase 2", icon: ScanSearch },
    ],
  },
  {
    label: "Account",
    items: [
      { slug: "dashboard", label: "Dashboard", phase: "Phase 2", icon: LayoutGrid },
      { slug: "portfolio", label: "Portfolio", phase: "Phase 4", icon: ChartPie },
      { slug: "rewards", label: "Rewards", phase: "Phase 6", icon: Gift },
    ],
  },
  {
    label: "Help",
    items: [
      { slug: "news", label: "News", phase: "Phase 6", icon: Newspaper },
      { slug: "support", label: "Support", phase: "Phase 6", icon: LifeBuoy },
      { slug: "settings", label: "Settings", phase: "Phase 3", icon: Settings },
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Sections that have their own page and must not use the placeholder route. */
export const BUILT = new Set(["discover", "radar"]);
