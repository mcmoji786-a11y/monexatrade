/* Early-access offers: a discount on Kixo's own trading fee (not Solana network fees),
   for people on the waitlist. Change the tiers here; the page and the joined card read
   them. At launch each waitlist email is matched to its Kixo account and its tier's
   discount applied from the day real trading opens. */

export const BASE_FEE_PCT = 0.5;

export type Offer = {
  key: "early" | "insider" | "founding";
  name: string;
  how: string;
  /** Off Kixo's trading fee, in %. */
  off: number;
  months: number;
  extra?: string;
};

export const OFFERS: Offer[] = [
  { key: "early", name: "Early Bird", how: "Join the waitlist", off: 25, months: 3 },
  { key: "insider", name: "Insider", how: "3 friends join with your link", off: 50, months: 6 },
  { key: "founding", name: "Founding Trader", how: "10 friends join, or be in the first 500", off: 50, months: 12, extra: "Founding Trader badge" },
];

export const INSIDER_REFS = 3;
export const FOUNDING_REFS = 10;
export const FOUNDING_FIRST = 500;

export const feeAfter = (o: Offer) => +(BASE_FEE_PCT * (1 - o.off / 100)).toFixed(3);

/** The best offer a person has: by invites, or by how early they joined. */
export function offerFor(referrals: number, signupRank: number): Offer {
  if (referrals >= FOUNDING_REFS || signupRank <= FOUNDING_FIRST) return OFFERS[2];
  if (referrals >= INSIDER_REFS) return OFFERS[1];
  return OFFERS[0];
}

/** What it takes to reach the next offer, or null at the top. */
export function nextStep(referrals: number, signupRank: number): { offer: Offer; invites: number } | null {
  const now = offerFor(referrals, signupRank);
  if (now.key === "founding") return null;
  if (now.key === "early") return { offer: OFFERS[1], invites: INSIDER_REFS - referrals };
  return { offer: OFFERS[2], invites: FOUNDING_REFS - referrals };
}
