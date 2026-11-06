"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { reportPage, useRadarFeed } from "@/components/radar/use-radar-feed";

/** Tells the gateway which page this tab shows (for live counts in the admin). */
export function PageReporter() {
  const path = usePathname();
  useRadarFeed(); // keeps the live connection open on every page
  useEffect(() => {
    reportPage(path);
  }, [path]);
  return null;
}
