"use client";

import { useEffect, useState } from "react";

type Health = {
  status: string;
  supabase: boolean;
  helius: boolean;
  solana_slot: number | null;
};

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";

// Polls the Rust gateway's /health endpoint. Shows real status only, no mock data.
export function GatewayStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${GATEWAY}/health`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data: Health = await res.json();
        if (!cancelled) {
          setHealth(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dot = (ok: boolean) => (
    <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald" : "bg-danger"}`} />
  );

  if (error || !health) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        {dot(false)} Gateway {error ? "offline" : "connecting…"}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 font-mono text-xs text-muted">
      <span className="flex items-center gap-1.5">{dot(health.status === "ok")} Gateway</span>
      <span className="flex items-center gap-1.5">{dot(health.supabase)} Supabase</span>
      <span className="flex items-center gap-1.5">{dot(health.helius)} Solana</span>
      {health.solana_slot !== null && <span>slot {health.solana_slot.toLocaleString()}</span>}
    </div>
  );
}
