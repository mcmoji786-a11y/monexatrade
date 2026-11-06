"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { shortAddress } from "@/lib/gateway";

/** Token logo from creator metadata, with a letter fallback when missing or broken. */
export function TokenLogo({ src, symbol, size = 56 }: { src: string | null; symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letter = (symbol.replace(/[^a-z0-9]/gi, "")[0] ?? "?").toUpperCase();

  return (
    <div
      className="shrink-0 overflow-hidden rounded-lg border border-border bg-surface-3"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        // Creator-hosted image of unknown origin: no referrer, lazy, sized box.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-mono text-muted" style={{ fontSize: size * 0.32 }}>
          {letter}
        </span>
      )}
    </div>
  );
}

/** Contract address with a copy button. */
export function CopyMint({ mint }: { mint: string }) {
  return <CopyAddress value={mint} title={`Copy contract address ${mint}`} className="text-cyan" />;
}

/** Any address (wallet, transaction) shortened, copied on click. Stays on one line. */
export function CopyAddress({ value, title, prefix, className = "text-text-2" }: { value: string; title?: string; prefix?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={title ?? `Copy ${value}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={`-mx-1 flex shrink-0 items-center gap-1 rounded px-1 font-mono whitespace-nowrap transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-emerald ${className}`}
    >
      {prefix && <span className="text-muted">{prefix}</span>}
      {shortAddress(value)}
      {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} className="opacity-60" />}
    </button>
  );
}
