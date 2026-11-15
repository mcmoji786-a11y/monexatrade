"use client";
/* Admin, KOLs: the list behind the KOL Tracker. Each KOL is a Solana wallet, a name and
   an X handle. Add only wallets that are confirmed to belong to that person (their own
   post, or a well-known public tracker), never a guess. Paste many at once as lines of
   "address, name, @handle". */
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { adminFetch } from "@/lib/admin";
import { pushToast } from "@/lib/toast";

type K = { address: string; name: string; x: string };
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function KolsAdmin() {
  const [list, setList] = useState<K[] | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ kols: K[] }>("/admin/kols")
      .then((r) => setList(r.kols))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load"));
  }, []);

  const parsed = paste
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [address = "", name = "", x = ""] = l.split(/[,\t]/).map((s) => s.trim());
      return { address, name, x: x.replace(/^@/, ""), ok: ADDR.test(address) && name.length > 0 };
    });
  const bad = parsed.filter((p) => !p.ok);

  const save = async (next: K[]) => {
    setBusy(true);
    try {
      const r = await adminFetch<{ kols: K[] }>("/admin/kols", { method: "PUT", body: { kols: next } });
      setList(r.kols);
      pushToast({ tone: "good", title: "KOL list saved", body: `${r.kols.length} KOLs` });
      return true;
    } catch (e) {
      pushToast({ tone: "bad", title: "Not saved", body: e instanceof Error ? e.message : "" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium text-text">KOLs</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-2">The traders on the KOL Tracker. Add a wallet only when it is confirmed to be that person&apos;s: their own post, or a public tracker you trust. A wrong wallet shows wrong trades under a real person&apos;s name</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm text-text">Add KOLs</p>
        <p className="mt-0.5 text-xs text-muted">One per line: wallet address, name, @XHandle</p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} spellCheck={false} placeholder="7xKX…wallet, Name, @handle" className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text outline-none focus:border-emerald/50" />
        {bad.length > 0 && <p className="mt-1 text-xs text-negative">{bad.length} line{bad.length === 1 ? "" : "s"} need a Solana address and a name</p>}
        <button
          type="button"
          disabled={busy || !parsed.length || bad.length > 0 || !list}
          onClick={async () => {
            const known = new Set(list!.map((k) => k.address));
            const add = parsed.filter((p) => !known.has(p.address)).map(({ address, name, x }) => ({ address, name, x }));
            if (await save([...list!, ...add])) setPaste("");
          }}
          className="mt-3 flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-50"
        >
          {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
          Add {parsed.length || ""}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <p className="border-b border-border px-4 py-3 text-sm text-text">{list ? `${list.length} KOLs` : "Loading"}</p>
        {err && <p className="px-4 py-4 text-sm text-negative">{err}</p>}
        <ul className="divide-y divide-border">
          {(list ?? []).map((k) => (
            <li key={k.address} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-40 truncate text-text">{k.name}</span>
              <span className="w-32 truncate text-text-2">{k.x ? `@${k.x}` : "—"}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{k.address}</span>
              <button type="button" disabled={busy} onClick={() => save(list!.filter((x) => x.address !== k.address))} aria-label={`Remove ${k.name}`} className="text-muted hover:text-negative">
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
