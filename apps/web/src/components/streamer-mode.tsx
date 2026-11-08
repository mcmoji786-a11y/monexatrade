"use client";

import { useStreamerMode } from "@/lib/streamer";

/** Applies streamer mode to the page (and Shift+S). Mounted once in the app shell. */
export function StreamerMode() {
  useStreamerMode();
  return null;
}
