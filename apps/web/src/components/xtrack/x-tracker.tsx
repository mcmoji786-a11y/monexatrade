"use client";
/* X Tracker: pick X accounts; when one posts a Solana contract address, the post shows
   here and an alert reaches your Email, Telegram or Discord (gateway xtrack.rs). */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, ExternalLink, X } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { accessToken, openLogin, useAccount } from "@/lib/account";
import { tokenHref } from "@/lib/open-token";
import { pushToast } from "@/lib/toast";

type Post = { handle: string; id: string; text: string; mints: string[]; at: string | null; url: string };
type Status = { x_api: boolean; accounts: number; cap: number; per_user: number; last_poll: number; error: string | null };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`${GATEWAY_HTTP}${path}`, { method, headers: { authorization: `Bearer ${accessToken()}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await r.text();
  if (!r.ok) throw new Error(/not set up/i.test(text) ? "The X Tracker is not set up yet" : text || `Failed (${r.status})`);
  return JSON.parse(text) as T;
}

export function XTracker() {
  const auth = useAccount();
  const [status, setStatus] = useState<Status | null>(null);
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [feed, setFeed] = useState<Post[]>([]);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    call<{ accounts: string[]; feed: Post[] }>("/x-tracker/me")
      .then((r) => (setAccounts(r.accounts), setFeed(r.feed), setErr(null)))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load"));
  }, []);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/x-tracker/status`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
    if (auth.status !== "signed-in") return;
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [auth.status, load]);

  const save = async (next: string[]) => {
    try {
      const r = await call<{ accounts: string[] }>("/x-tracker/me", "PUT", { accounts: next });
      setAccounts(r.accounts);
    } catch (e) {
      pushToast({ tone: "bad", title: "Not saved", body: e instanceof Error ? e.message : "" });
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-text-2">Choose X accounts. When one posts a Solana contract address, the call shows here with the coin one click away, and an alert reaches your Email, Telegram or Discord</p>

      {status && !status.x_api && (
        <p className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-text-2">
          Kixo is not reading X yet: it needs an X API plan. You can choose accounts now; posts start arriving once it is on
        </p>
      )}

      {auth.status !== "signed-in" ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
          <p className="text-sm text-text-2">Sign in to choose X accounts</p>
          <button type="button" onClick={() => openLogin("/wallets?tab=calls")} className="h-9 rounded-lg bg-text px-4 text-sm font-medium text-bg">
            Sign in
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <section className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-text">Your accounts</p>
            <p className="mt-0.5 text-xs text-muted">Up to {status?.per_user ?? 10}. Alerts use the channels in Settings, Alerts outside Kixo</p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const h = add.trim().replace(/^@/, "").replace(/^https?:\/\/(x|twitter)\.com\//, "").split(/[/?]/)[0];
                if (!h || !accounts) return;
                void save([...accounts, h]);
                setAdd("");
              }}
            >
              <label className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 focus-within:border-emerald/50">
                <AtSign size={13} strokeWidth={1.5} className="text-muted" />
                <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="handle or x.com link" aria-label="X handle" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted" />
              </label>
              <button type="submit" disabled={!accounts || accounts.length >= (status?.per_user ?? 10)} className="h-9 rounded-lg bg-text px-3 text-sm font-medium text-bg disabled:opacity-50">
                Add
              </button>
            </form>
            {err && <p className="mt-2 text-xs text-negative">{err}</p>}
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {(accounts ?? []).map((h) => (
                <li key={h} className="flex h-7 items-center gap-1 rounded-md border border-border pr-1 pl-2 text-xs text-text">
                  <a href={`https://x.com/${h}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    @{h}
                  </a>
                  <button type="button" onClick={() => save(accounts!.filter((x) => x !== h))} aria-label={`Remove @${h}`} className="text-muted hover:text-text">
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
            {accounts && accounts.length === 0 && <p className="mt-3 text-xs text-muted">No accounts yet</p>}
          </section>

          <section className="rounded-xl border border-border bg-surface">
            <p className="border-b border-border px-4 py-3 text-sm text-text">Calls</p>
            {feed.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted">{accounts?.length ? "Nothing yet. A post with a contract address from your accounts shows here" : "Add an account to start"}</p>
            ) : (
              <ul className="divide-y divide-border">
                {feed.map((p) => (
                  <li key={p.id} className="fade-up px-4 py-3">
                    <p className="flex items-center gap-2 text-xs text-muted">
                      <span className="text-text">@{p.handle}</span>
                      {p.at && <span>{new Date(p.at).toLocaleString()}</span>}
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 hover:text-text">
                        On X <ExternalLink size={11} strokeWidth={1.5} />
                      </a>
                    </p>
                    <p className="mt-1.5 text-sm leading-6 wrap-break-word whitespace-pre-line text-text-2">{p.text}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.mints.map((m) => (
                        <Link key={m} href={tokenHref(m)} className="rounded-md border border-emerald/30 px-2 py-0.5 font-mono text-xs text-emerald hover:bg-emerald/5">
                          {m.slice(0, 4)}…{m.slice(-4)} · open
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
