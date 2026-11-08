"use client";

import { useEffect } from "react";
import { GATEWAY_HTTP } from "@/lib/gateway";

/** Sends uncaught errors from this browser to the admin's System page (monitor.rs): the
 *  message, the first line of the stack and the page path. Never the page query, form
 *  values or anything typed. A few per page load, each message once. */
const MAX_PER_LOAD = 5;
// Noise browsers raise on their own, and errors from extensions.
const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i, /Non-Error promise rejection captured/i];

export function ErrorReporter() {
  useEffect(() => {
    const sent = new Set<string>();
    const send = (message: string, kind: "error" | "promise", where?: string) => {
      const text = `${message}${where ? ` (${where})` : ""}`.slice(0, 400);
      if (!message || sent.size >= MAX_PER_LOAD || sent.has(text) || IGNORE.some((r) => r.test(text))) return;
      sent.add(text);
      fetch(`${GATEWAY_HTTP}/ops/client-error`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, page: window.location.pathname, kind }),
        keepalive: true,
      }).catch(() => {});
    };
    const firstFrame = (stack?: string) => stack?.split("\n").find((l) => l.trim().startsWith("at "))?.trim().replace(/https?:\/\/[^/]+/, "");
    const onError = (e: ErrorEvent) => {
      if (e.filename && /extension:\/\//.test(e.filename)) return;
      send(e.message || String(e.error), "error", firstFrame(e.error?.stack) ?? (e.filename ? `${e.filename.replace(/https?:\/\/[^/]+/, "")}:${e.lineno}` : undefined));
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      send(r instanceof Error ? r.message : typeof r === "string" ? r : "", "promise", r instanceof Error ? firstFrame(r.stack) : undefined);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
