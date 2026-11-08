"use client";

/* The trade share card now lives with the other share cards (components/share). These
   names stay for the places that import them from here. */

export { ShareCardHost, TradeShareCard as ShareCard, tradeResult } from "@/components/share/cards";
export type { ShareTrade } from "@/lib/share";
