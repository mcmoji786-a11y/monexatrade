"use client";
/* The whole app failed to load (even the root layout): a plain page of its own. */
import "./globals.css";
import { useEffect } from "react";
import { StatusPage } from "@/components/status-page";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en" className="antialiased">
      <body className="min-h-screen bg-bg">
        <StatusPage
          code="Error"
          title="Kixo could not load"
          body="Your balances, orders and wallet are safe. Reload the page; if it keeps happening, the service may be restarting and is back within a minute"
          action={
            <button type="button" onClick={reset} className="flex h-10 items-center rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90">
              Reload
            </button>
          }
        />
      </body>
    </html>
  );
}
