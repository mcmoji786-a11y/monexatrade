"use client";
/* The user's own notes on coins and wallets (gateway notes.rs, migration 0016). Loaded
   once per session and shared by every Note button on the page. */
import { useEffect, useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken, useAccount } from "./account";

export type NoteKind = "coin" | "wallet";
export type Note = { kind: NoteKind; ref: string; label: string; body: string; updated_at: string };

let notes: Note[] | null = null;
let error: string | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function call<T>(method: string, body?: unknown): Promise<T> {
  const token = accessToken();
  if (!token) throw new Error("Sign in to keep notes");
  const r = await fetch(`${GATEWAY_HTTP}/notes`, {
    method,
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(/not set up/i.test(text) ? "Notes are not set up yet" : text || `Request failed (${r.status})`);
  return JSON.parse(text) as T;
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    notes = (await call<{ notes: Note[] }>("GET")).notes;
    error = null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load notes";
  } finally {
    loading = false;
    emit();
  }
}

export function useNotes() {
  const auth = useAccount();
  const signedIn = auth.status === "signed-in";
  useEffect(() => {
    if (signedIn && notes === null && !loading) void load();
  }, [signedIn]);
  const state = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => notes,
    () => null,
  );
  return { notes: signedIn ? state : null, error, signedIn };
}

export function noteOf(list: Note[] | null, kind: NoteKind, ref: string) {
  return list?.find((n) => n.kind === kind && n.ref === ref) ?? null;
}

/** Saves (or, with an empty body, deletes) one note and updates every button. */
export async function saveNote(kind: NoteKind, ref: string, body: string, label = "") {
  await call("PUT", { kind, ref, body, label });
  const rest = (notes ?? []).filter((n) => !(n.kind === kind && n.ref === ref));
  notes = body.trim() ? [{ kind, ref, label, body: body.trim(), updated_at: new Date().toISOString() }, ...rest] : rest;
  emit();
}
