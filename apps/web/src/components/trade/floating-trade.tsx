"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, PanelRightClose, PictureInPicture2 } from "lucide-react";
import { TradePanel } from "./trade-panel";

const POS_KEY = "kixo.trade.float.pos";
const WIDTH = 360;

type Pos = { x: number; y: number };

function clamp(p: Pos, h = 480): Pos {
  const maxX = Math.max(8, window.innerWidth - WIDTH - 8);
  const maxY = Math.max(64, window.innerHeight - Math.min(h, 200));
  return { x: Math.min(Math.max(8, p.x), maxX), y: Math.min(Math.max(64, p.y), maxY) };
}

function savedPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as Pos | null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return clamp(p);
  } catch {}
  return clamp({ x: window.innerWidth - WIDTH - 24, y: 96 });
}

/**
 * The buy and sell box, docked in the side panel or popped out into a window the user
 * drags anywhere on the screen (its place is remembered). The same ticket either way.
 */
export function DockableTrade({ symbol, mint }: { symbol: string; mint: string }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // Keep the window on screen when the browser is resized.
  useEffect(() => {
    if (!pos) return;
    const fit = () => setPos((p) => (p ? clamp(p, box.current?.offsetHeight) : p));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [pos]);

  const popOut = () => setPos(savedPos());
  const dock = () => setPos(null);

  if (!pos) {
    return (
      <div>
        <div className="flex items-center justify-between px-4 pt-3 text-xs text-text-2">
          Buy and sell
          <button
            type="button"
            onClick={popOut}
            title="Pop out the buy and sell box and move it anywhere"
            className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <PictureInPicture2 size={13} strokeWidth={1.5} />
            Pop out
          </button>
        </div>
        <TradePanel symbol={symbol} mint={mint} />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs text-text-2">
        The buy and sell box is floating
        <button type="button" onClick={dock} className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-text-2 hover:bg-surface-2 hover:text-text">
          <PanelRightClose size={13} strokeWidth={1.5} />
          Dock it here
        </button>
      </div>
      {createPortal(
        <div
          ref={box}
          role="dialog"
          aria-label={`Buy and sell ${symbol}`}
          className="fixed z-40 flex max-h-[calc(100vh-80px)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/60"
          style={{ left: pos.x, top: pos.y, width: WIDTH }}
        >
          <div
            className="flex h-10 shrink-0 cursor-move touch-none select-none items-center justify-between gap-2 border-b border-border bg-surface-2 px-3"
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, box.current?.offsetHeight));
            }}
            onPointerUp={(e) => {
              if (!drag.current) return;
              drag.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
              try {
                localStorage.setItem(POS_KEY, JSON.stringify(pos));
              } catch {}
            }}
          >
            <span className="flex items-center gap-2 text-xs text-text-2">
              <GripHorizontal size={14} strokeWidth={1.5} className="text-muted" />
              Buy / Sell <span className="font-medium text-text">{symbol}</span>
            </span>
            <button type="button" onClick={dock} title="Put the box back in the side panel" className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-2 hover:bg-surface-3 hover:text-text">
              <PanelRightClose size={13} strokeWidth={1.5} />
              Dock
            </button>
          </div>
          <div className="overflow-y-auto">
            <TradePanel symbol={symbol} mint={mint} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
