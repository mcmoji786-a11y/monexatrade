"use client";

import { useEffect, useState } from "react";
import { GATEWAY_HTTP as GATEWAY } from "@/lib/gateway";

/** Silent while the live connection works. When the gateway stops answering (two
 *  checks in a row, so a single slow reply does not flash it), a small notice says the
 *  data is paused and comes back on its own. */
export function ConnectionNotice() {
  const [fails, setFails] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${GATEWAY}/health`, { cache: "no-store" });
        const ok = res.ok && (await res.json()).status === "ok";
        if (!cancelled) setFails((n) => (ok ? 0 : n + 1));
      } catch {
        if (!cancelled) setFails((n) => n + 1);
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (fails < 2) return null;
  return (
    <span role="status" className="hidden items-center gap-2 rounded-lg border border-warning/30 px-2.5 py-1 text-xs text-warning sm:flex">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      Reconnecting, live data paused
    </span>
  );
}
