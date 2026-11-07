"use client";

import { useReferralCapture } from "@/lib/growth";

/** Remembers a referral code from the address bar and claims it after sign-up. */
export function ReferralCapture() {
  useReferralCapture();
  return null;
}
