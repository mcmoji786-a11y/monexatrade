"use client";
/* Admin, Emails: every email the gateway sends, as an editable template. Text is plain:
   a blank line starts a paragraph, **double stars** make bold, {{variables}} are filled
   in when the email is sent. The preview is rendered by the gateway, so it is exactly
   what goes out. Tests go to OWNER_EMAIL with sample values. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Monitor, RotateCcw, Send, Smartphone } from "lucide-react";
import { adminFetch } from "@/lib/admin";
import { pushToast } from "@/lib/toast";

type Edit = { on: boolean; subject: string; heading: string; body: string; button: string };
type Tpl = { key: string; group: string; name: string; about: string; footer: string; vars: { name: string; sample: string }[]; default: Edit; current: Edit };
type List = { templates: Tpl[]; ready: boolean; sender: string; test_to: string | null };
type Preview = { subject: string; html: string; problem: string | null };
type Field = "subject" | "heading" | "body" | "button";

const same = (a: Edit, b: Edit) => a.on === b.on && a.subject === b.subject && a.heading === b.heading && a.body === b.body && a.button === b.button;
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export function EmailsAdmin() {
  const [list, setList] = useState<List | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Edit | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  useEffect(() => {
    adminFetch<List>("/admin/emails")
      .then((r) => {
        setList(r);
        setKey(r.templates[0]?.key ?? null);
        setDraft(r.templates[0]?.current ?? null);
      })
      .catch((e) => setErr(msg(e)));
  }, []);

  const tpl = list?.templates.find((t) => t.key === key) ?? null;
  const dirty = !!(tpl && draft && !same(tpl.current, draft));
  const groups = useMemo(() => {
    const g = new Map<string, Tpl[]>();
    for (const t of list?.templates ?? []) g.set(t.group, [...(g.get(t.group) ?? []), t]);
    return [...g];
  }, [list]);

  const pick = (t: Tpl) => {
    if (dirty && !window.confirm("Leave without saving your changes?")) return;
    setKey(t.key);
    setDraft(t.current);
  };

  const replace = (t: Tpl) => setList((l) => (l ? { ...l, templates: l.templates.map((x) => (x.key === t.key ? t : x)) } : l));

  const save = async (next: Edit) => {
    if (!tpl) return;
    setBusy("save");
    try {
      const t = await adminFetch<Tpl>(`/admin/emails/${tpl.key}`, { method: "PUT", body: next });
      replace(t);
      setDraft(t.current);
      pushToast({ tone: "good", title: "Email saved", body: t.name });
    } catch (e) {
      pushToast({ tone: "bad", title: "Not saved", body: msg(e) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!tpl || !draft) return;
    setBusy("test");
    try {
      const r = await adminFetch<{ sent_to: string }>(`/admin/emails/${tpl.key}/test`, { body: draft });
      pushToast({ tone: "good", title: "Test sent", body: `To ${r.sent_to}` });
    } catch (e) {
      pushToast({ tone: "bad", title: "Test not sent", body: msg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium text-text">Emails</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-2">Every email Kixo sends, in one design. Change the words, switch an email off, and send yourself a test before saving</p>
      </div>

      {list && <Status list={list} />}
      {err && <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-negative">{err}</p>}
      {!list && !err && (
        <p className="flex items-center gap-2 text-sm text-text-2">
          <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> Loading
        </p>
      )}

      {list && tpl && draft && (
        <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
          <nav className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-3">
            {groups.map(([g, ts]) => (
              <div key={g}>
                <p className="px-2 pb-1 text-xs text-muted">{g}</p>
                {ts.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => pick(t)}
                    className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors ${t.key === key ? "bg-surface-3 text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
                  >
                    <span className={`size-1.5 shrink-0 rounded-full ${t.current.on ? "bg-positive" : "bg-muted/50"}`} aria-hidden />
                    <span className="flex-1 truncate">{t.name}</span>
                    {!same(t.current, t.default) && <span className="text-xs text-muted">Edited</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <Editor key={tpl.key} tpl={tpl} draft={draft} setDraft={setDraft} />

          <div className="flex min-w-0 flex-col gap-3">
            <PreviewPane tpl={tpl} draft={draft} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={!dirty || !!busy} onClick={() => save(draft)} className="flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-50">
                {busy === "save" && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
                Save
              </button>
              <button type="button" disabled={!!busy || !list.ready || !list.test_to} onClick={test} className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text hover:bg-surface-2 disabled:opacity-50">
                {busy === "test" ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <Send size={14} strokeWidth={1.5} />}
                Send me a test
              </button>
              <button
                type="button"
                disabled={!!busy || same(draft, tpl.default)}
                onClick={() => setDraft({ ...tpl.default, on: draft.on })}
                className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-text-2 hover:text-text disabled:opacity-50"
              >
                <RotateCcw size={14} strokeWidth={1.5} />
                Default text
              </button>
              {dirty && <span className="text-xs text-warning">Not saved</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Status({ list }: { list: List }) {
  const testDomain = /@resend\.dev>?$/.test(list.sender);
  return (
    <div className="grid gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm sm:grid-cols-3">
      <p>
        <span className="block text-xs text-muted">Sending</span>
        {list.ready ? <span className="text-positive">On, through Resend</span> : <span className="text-negative">Off: add RESEND_API_KEY in API keys</span>}
      </p>
      <p className="min-w-0">
        <span className="block text-xs text-muted">From</span>
        <span className="block truncate font-mono text-xs text-text">{list.sender}</span>
        {testDomain && <span className="block text-xs text-warning">Test sender: only reaches your own Resend address until a domain is verified</span>}
      </p>
      <p>
        <span className="block text-xs text-muted">Tests go to</span>
        {list.test_to ? <span className="text-text">{list.test_to}</span> : <span className="text-negative">Set OWNER_EMAIL in .env</span>}
      </p>
    </div>
  );
}

function Editor({ tpl, draft, setDraft }: { tpl: Tpl; draft: Edit; setDraft: (e: Edit) => void }) {
  const last = useRef<{ field: Field; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const set = (f: Field, v: string) => setDraft({ ...draft, [f]: v });

  const insert = (name: string) => {
    const token = `{{${name}}}`;
    const l = last.current;
    if (!l) {
      set("body", `${draft.body}${draft.body.endsWith(" ") || !draft.body ? "" : " "}${token}`);
      return;
    }
    const { field, el } = l;
    const s = el.selectionStart ?? draft[field].length;
    const e = el.selectionEnd ?? s;
    set(field, draft[field].slice(0, s) + token + draft[field].slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };

  const field = (f: Field, label: string, hint?: string) => {
    const common = {
      value: draft[f],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(f, e.target.value),
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => (last.current = { field: f, el: e.currentTarget }),
      spellCheck: true,
      className: "w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-emerald/50",
    };
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{label}</span>
        {f === "body" ? <textarea {...common} rows={9} className={`${common.className} py-2 leading-relaxed`} /> : <input {...common} className={`${common.className} h-9`} />}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </label>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{tpl.name}</p>
          <p className="mt-0.5 text-xs text-text-2">{tpl.about}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.on}
          aria-label={`Send ${tpl.name}`}
          onClick={() => setDraft({ ...draft, on: !draft.on })}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${draft.on ? "border-emerald/50 bg-emerald/30" : "border-border bg-surface-3"}`}
        >
          <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${draft.on ? "left-5.5 bg-emerald" : "left-0.5 bg-text-2"}`} />
        </button>
      </div>
      {!draft.on && <p className="-mt-2 text-xs text-warning">Switched off: this email is not sent. Telegram and Discord alerts still go out</p>}

      {field("subject", "Subject")}
      {field("heading", "Heading", "Leave empty for no heading")}
      {field("body", "Text", "A blank line starts a new paragraph. **Double stars** make bold")}
      {field("button", "Button", "Leave empty for no button")}

      <div>
        <p className="text-xs text-muted">Values, filled in when sent. Click to insert where the cursor is</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tpl.vars.map((v) => (
            <button key={v.name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v.name)} title={`Example: ${v.sample}`} className="h-7 rounded-md border border-border bg-bg px-2 font-mono text-xs text-text-2 hover:border-emerald/40 hover:text-text">
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>
      </div>

      <p className="border-t border-border pt-3 text-xs text-muted">
        Footer, always included: <span className="text-text-2">{tpl.footer}</span>
      </p>
    </div>
  );
}

function PreviewPane({ tpl, draft }: { tpl: Tpl; draft: Edit }) {
  const [p, setP] = useState<Preview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [phone, setPhone] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      adminFetch<Preview>(`/admin/emails/${tpl.key}/preview`, { body: draft })
        .then((r) => {
          setP(r);
          setFailed(null);
        })
        .catch((e) => setFailed(msg(e)));
    }, 350);
    return () => clearTimeout(t);
  }, [tpl.key, draft]);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-sm text-text">
          <span className="text-muted">Subject </span>
          {p?.subject ?? "…"}
        </p>
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {[
            [true, Smartphone, "Phone"],
            [false, Monitor, "Desktop"],
          ].map(([v, Icon, label]) => {
            const I = Icon as typeof Smartphone;
            return (
              <button key={label as string} type="button" aria-label={label as string} aria-pressed={phone === v} onClick={() => setPhone(v as boolean)} className={`flex size-7 items-center justify-center rounded-md ${phone === v ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}>
                <I size={14} strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      </div>
      {(failed || p?.problem) && <p className="border-b border-border px-4 py-2 text-xs text-negative">{failed ?? p?.problem}</p>}
      <div className="flex justify-center bg-bg p-4">
        <iframe title={`${tpl.name} preview`} sandbox="" srcDoc={p?.html ?? ""} className="h-140 rounded-lg border border-border bg-bg transition-[width]" style={{ width: phone ? 375 : "100%" }} />
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted">With example values. Email apps differ slightly; send a test to see it in yours</p>
    </div>
  );
}
