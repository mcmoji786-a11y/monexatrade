"use client";
/* Ask Kixo AI: a chat over Kixo's live data (lib/ai-chat.ts). Coins in an answer come
   with their actions: open, quick buy, watch. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Loader2, ScanSearch } from "lucide-react";
import { answer, STARTERS, type AiOverview, type ChatReply } from "@/lib/ai-chat";
import { riskTitle, verdict } from "@/lib/ai-risk";
import { tokenHref } from "@/lib/open-token";
import { useRadarFeed } from "@/components/radar/use-radar-feed";
import { TokenLogo } from "@/components/token/token-bits";
import { StarButton } from "@/components/token/star-button";
import { QuickBuy } from "@/components/trade/quick-buy";

type Msg = { id: number; role: "user"; text: string } | { id: number; role: "ai"; reply: ChatReply };

export function AiChatPanel({ overview }: { overview: AiOverview | null }) {
  const feed = useRadarFeed();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setQ("");
    setMsgs((m) => [...m, { id: nextId.current++, role: "user", text: t }]);
    setBusy(true);
    const reply = await answer(t, { tokens: feed.tokens, overview });
    setMsgs((m) => [...m, { id: nextId.current++, role: "ai", reply }]);
    setBusy(false);
  };

  const last = [...msgs].reverse().find((m) => m.role === "ai");
  const chips = msgs.length === 0 ? STARTERS : last?.role === "ai" ? (last.reply.suggestions ?? []) : [];

  return (
    <section className="flex h-[560px] min-w-0 flex-col rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ScanSearch size={16} strokeWidth={1.5} className="text-emerald" />
        <h2 className="text-sm font-medium text-text">Ask Kixo AI</h2>
        <span className="ml-auto text-[11px] text-muted">Answers from Kixo&apos;s live data and model</span>
      </div>

      <div ref={box} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <div className="my-auto text-center">
            <p className="text-sm text-text">Ask about any coin, or what to watch right now</p>
            <p className="mt-1 text-xs text-muted">Paste a coin address or write a $SYMBOL from the radar. English or Roman Urdu</p>
          </div>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-surface-3 px-3 py-2 text-sm text-text">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className="flex max-w-[95%] flex-col gap-2 self-start">
              <div className="rounded-xl rounded-bl-sm border border-border bg-bg px-3 py-2 text-sm leading-6 text-text-2">
                {m.reply.text.map((line, i) => (
                  <p key={i} className={i === 0 ? "text-text" : "mt-1"}>
                    {line}
                  </p>
                ))}
              </div>
              {m.reply.coins?.map((c) => (
                <div key={c.mint} className="flex items-center gap-2.5 rounded-lg border border-border bg-bg px-3 py-2">
                  <Link href={tokenHref(c.mint)} className="flex min-w-0 flex-1 items-center gap-2.5">
                    <TokenLogo src={c.image} symbol={c.symbol} size={28} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-text">{c.symbol}</span>
                      {c.line && <span className="truncate font-mono text-[11px] text-muted">{c.line}</span>}
                    </span>
                  </Link>
                  {c.risk && (
                    <span className={`flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] ${verdict(c.risk).className}`} title={riskTitle(c.risk)}>
                      {verdict(c.risk).label}
                    </span>
                  )}
                  <StarButton mint={c.mint} size={14} />
                  <QuickBuy mint={c.mint} symbol={c.symbol} />
                </div>
              ))}
            </div>
          ),
        )}
        {busy && (
          <span className="flex items-center gap-2 self-start text-xs text-muted">
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
            Checking the live data
          </span>
        )}
      </div>

      {chips.length > 0 && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => ask(c)}
              className="h-7 shrink-0 rounded-full border border-border px-3 text-xs whitespace-nowrap text-text-2 transition-colors hover:border-emerald/40 hover:text-text"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
        className="flex gap-2 border-t border-border p-3"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about a coin or trading"
          aria-label="Ask Kixo AI"
          maxLength={300}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-text text-bg transition-opacity disabled:opacity-40"
        >
          <ArrowUp size={16} strokeWidth={1.5} />
        </button>
      </form>
    </section>
  );
}
