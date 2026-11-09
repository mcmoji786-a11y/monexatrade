"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/* Cloudflare Turnstile: a free, privacy-friendly check that a person (not a bot) is
   signing up. On when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; Supabase then verifies
   the token (Authentication → Bot protection, with the Turnstile secret key). */

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type Api = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Api;
  }
}

let loading: Promise<Api | null> | null = null;
function load(): Promise<Api | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => res(window.turnstile ?? null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return loading;
}

export type TurnstileHandle = { reset: () => void };

/** The check itself. `onToken` gets a one-time token, or "" when it expires. */
export const Turnstile = forwardRef<TurnstileHandle, { onToken: (t: string) => void }>(function Turnstile({ onToken }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(onToken);
  useEffect(() => {
    cb.current = onToken;
  });
  useImperativeHandle(ref, () => ({
    reset: () => {
      if (id.current && window.turnstile) window.turnstile.reset(id.current);
      cb.current("");
    },
  }));
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let alive = true;
    load().then((api) => {
      if (!alive || !api || !box.current || id.current) return;
      id.current = api.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        size: "flexible",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(""),
        "error-callback": () => cb.current(""),
      });
    });
    return () => {
      alive = false;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
  }, []);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="mt-4 min-h-[65px]" />;
});
