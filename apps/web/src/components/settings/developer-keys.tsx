"use client";
/* Settings, Developer API: make, copy and revoke keys for the Kixo AI API (devapi.rs). A
   new key is shown once; after that only its first characters. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { accessToken, openLogin, useAccount } from "@/lib/account";
import { pushToast } from "@/lib/toast";
import { useFeatures } from "@/lib/features";

type Key = { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`${GATEWAY_HTTP}${path}`, { method, headers: { authorization: `Bearer ${accessToken()}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await r.text();
  if (!r.ok) {
    let m = text;
    try {
      m = JSON.parse(text).error ?? text;
    } catch {}
    throw new Error(/not set up/i.test(m) ? "The developer API is not set up yet" : m);
  }
  return JSON.parse(text) as T;
}

export function DeveloperKeys() {
  const auth = useAccount();
  const f = useFeatures();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    call<{ keys: Key[] }>("/developer/keys")
      .then((r) => (setKeys(r.keys), setErr(null)))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load"));
  }, []);
  useEffect(() => {
    if (auth.status === "signed-in" && f.dev_api) load();
  }, [auth.status, f.dev_api, load]);

  if (!f.dev_api) return <p className="px-5 py-4 text-sm text-muted">The developer API is switched off right now</p>;
  if (auth.status !== "signed-in")
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-text-2">Sign in to make API keys</p>
        <button type="button" onClick={() => openLogin("/settings")} className="h-8 rounded-lg bg-text px-3 text-sm text-bg">
          Sign in
        </button>
      </div>
    );

  const make = async () => {
    setBusy(true);
    try {
      const r = await call<{ key: string }>("/developer/keys", "POST", { name });
      setFresh(r.key);
      setName("");
      load();
    } catch (e) {
      pushToast({ tone: "bad", title: "No key made", body: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (k: Key) => {
    if (!confirm(`Revoke "${k.name || k.prefix}"? Apps using it stop working at once`)) return;
    try {
      await call(`/developer/keys/${k.id}`, "DELETE");
      load();
    } catch (e) {
      pushToast({ tone: "bad", title: "Not revoked", body: e instanceof Error ? e.message : "" });
    }
  };

  return (
    <div className="divide-y divide-border">
      <div className="px-5 py-4">
        <p className="text-sm text-text-2">
          Use Kixo AI&apos;s scores in your own bot or dashboard. 60 calls a minute, 10,000 a day per key.{" "}
          <Link href="/developers" className="text-text underline underline-offset-2">
            API docs
          </Link>
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void make();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Key name, for example My bot" aria-label="Key name" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50" />
          <button type="submit" disabled={busy} className="flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-60">
            <KeyRound size={14} strokeWidth={1.5} />
            Make a key
          </button>
        </form>
        {fresh && (
          <div className="fade-up mt-3 rounded-lg border border-emerald/30 bg-emerald/5 p-3">
            <p className="text-xs text-text-2">Your new key. Copy it now: Kixo cannot show it again</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-text">{fresh}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(fresh).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text hover:bg-surface-2"
              >
                {copied ? <Check size={13} strokeWidth={1.5} className="text-emerald" /> : <Copy size={13} strokeWidth={1.5} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
      {err ? (
        <p className="px-5 py-4 text-sm text-muted">{err}</p>
      ) : keys && keys.length > 0 ? (
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text">{k.name || "Unnamed key"}</span>
                <span className="block font-mono text-[11px] text-muted">
                  {k.prefix}… · made {new Date(k.created_at).toLocaleDateString()} · {k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleString()}` : "not used yet"}
                </span>
              </span>
              <button type="button" onClick={() => revoke(k)} aria-label={`Revoke ${k.name || k.prefix}`} className="text-muted hover:text-negative">
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
