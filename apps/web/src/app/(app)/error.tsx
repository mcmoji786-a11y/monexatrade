"use client";
/* A page inside the app broke: the sidebar and top bar stay, this page offers a retry.
   The error itself reaches the admin's System page through the error reporter. */
import { useEffect } from "react";
import { StatusPage } from "@/components/status-page";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPage
      code={error.digest ? `Error ${error.digest}` : "Error"}
      title="This page hit a problem"
      body="Your balances, orders and wallet are safe: nothing changed. Try the page again, or go back to Discover"
      action={
        <button type="button" onClick={reset} className="flex h-10 items-center rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90">
          Try again
        </button>
      }
    />
  );
}
