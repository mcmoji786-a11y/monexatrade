/* Rewards programme: every rate, tier and rule in one place, so the founder can set
   them without touching the page. DRAFT values: nothing is paid yet. Payouts start
   when trading and accounts go live, and these numbers are a proposal until then. */

export const REWARDS_STATUS = {
  draft: true,
  /** MONEXA's trading fee the programmes share, in % of each trade. */
  tradingFeePct: 1,
};

export type Tier = { name: string; /** Unlock condition, shown as text. */ unlock: string; /** Minimum for this tier in USD (volume or referred volume). */ minUsd: number; pct: number };

/** Referral: a share of the trading fees paid by people you invite, for as long as they trade. */
export const REFERRAL = {
  tiers: [
    { name: "Bronze", unlock: "From your first invite", minUsd: 0, pct: 20 },
    { name: "Silver", unlock: "$250K traded by your invites", minUsd: 250_000, pct: 25 },
    { name: "Gold", unlock: "$1M traded by your invites", minUsd: 1_000_000, pct: 30 },
    { name: "Diamond", unlock: "$5M traded by your invites", minUsd: 5_000_000, pct: 35 },
  ] satisfies Tier[],
  /** Discount on fees for the person who signs up with a link. */
  inviteeDiscountPct: 10,
  rules: [
    "Earn on every trade your invites make, with no end date",
    "Invites get a fee discount for using your link",
    "Paid in SOL to your wallet, claimable any time above 0.05 SOL",
    "Self-referrals and fake accounts are removed and not paid",
  ],
};

/** Cashback: part of your own trading fees back, by monthly volume. */
export const CASHBACK = {
  tiers: [
    { name: "Starter", unlock: "Every trader", minUsd: 0, pct: 5 },
    { name: "Active", unlock: "$50K traded this month", minUsd: 50_000, pct: 10 },
    { name: "Pro", unlock: "$250K traded this month", minUsd: 250_000, pct: 15 },
    { name: "Whale", unlock: "$1M traded this month", minUsd: 1_000_000, pct: 20 },
  ] satisfies Tier[],
  rules: [
    "Counted on every buy and sell you make on MONEXA",
    "Your tier is set by this calendar month's volume and resets on the 1st",
    "Added to your rewards balance after each trade, claimable in SOL",
  ],
};

/** Creator programme: for people who bring traders (X, Telegram, YouTube, Discord). */
export const CREATOR = {
  benefits: [
    { title: "Higher revenue share", body: "Up to 40% of the trading fees from your audience, above the public referral tiers" },
    { title: "Your own code and page", body: "A custom invite code and a creator page that shows the coins you call" },
    { title: "Early features", body: "New tools before public launch, and a direct line to the MONEXA team" },
    { title: "Live stats", body: "Sign-ups, active traders, volume and earnings from your audience, updated live" },
  ],
  requirements: [
    "An active audience of traders: X, Telegram, YouTube, Twitch or Discord",
    "Original content about Solana memecoins and trading",
    "No paid pumps, fake calls or hidden promotions",
    "Clear disclosure that you earn from MONEXA invites",
  ],
};

/** The tier a volume reaches, and the next one. */
export function tierFor(tiers: Tier[], usd: number) {
  let i = 0;
  tiers.forEach((t, k) => {
    if (usd >= t.minUsd) i = k;
  });
  return { current: tiers[i], next: tiers[i + 1] ?? null };
}

/* Live settings from the gateway (admin.rs), edited on the admin page. The defaults
   above are only a fallback while the gateway is unreachable. */
export type GatewayTier = { name: string; unlock: string; min_usd: number; pct: number };
export type RewardsConfig = {
  draft: boolean;
  trading_fee_pct: number;
  referral_enabled: boolean;
  invitee_discount_pct: number;
  referral_tiers: GatewayTier[];
  cashback_enabled: boolean;
  cashback_tiers: GatewayTier[];
  creator_open: boolean;
  creator_max_share_pct: number;
  min_claim_sol: number;
};

const toGateway = (t: Tier): GatewayTier => ({ name: t.name, unlock: t.unlock, min_usd: t.minUsd, pct: t.pct });
export const fromGateway = (t: GatewayTier): Tier => ({ name: t.name, unlock: t.unlock, minUsd: t.min_usd, pct: t.pct });

export const FALLBACK_CONFIG: RewardsConfig = {
  draft: REWARDS_STATUS.draft,
  trading_fee_pct: REWARDS_STATUS.tradingFeePct,
  referral_enabled: true,
  invitee_discount_pct: REFERRAL.inviteeDiscountPct,
  referral_tiers: REFERRAL.tiers.map(toGateway),
  cashback_enabled: true,
  cashback_tiers: CASHBACK.tiers.map(toGateway),
  creator_open: true,
  creator_max_share_pct: 40,
  min_claim_sol: 0.05,
};

/** Social platforms a creator can list (same list as the gateway). */
export const PLATFORMS = [
  { key: "x", label: "X (Twitter)", prefix: "https://x.com/" },
  { key: "telegram", label: "Telegram", prefix: "https://t.me/" },
  { key: "youtube", label: "YouTube", prefix: "https://youtube.com/@" },
  { key: "tiktok", label: "TikTok", prefix: "https://tiktok.com/@" },
  { key: "discord", label: "Discord", prefix: "https://discord.gg/" },
  { key: "twitch", label: "Twitch", prefix: "https://twitch.tv/" },
  { key: "instagram", label: "Instagram", prefix: "https://instagram.com/" },
] as const;
