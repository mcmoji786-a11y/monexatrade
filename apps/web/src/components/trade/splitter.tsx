"use client";

import { useCallback, useEffect, useState } from "react";

/** A size the user drags, remembered per browser. */
export function useStoredSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(initial);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(key));
      // Read after mount so the server render and first client render agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v >= min && v <= max) setSize(v);
    } catch {
      // storage blocked: keep the default
    }
  }, [key, min, max]);
  const set = useCallback(
    (v: number) => {
      const next = Math.round(Math.min(max, Math.max(min, v)));
      setSize(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {}
    },
    [key, min, max],
  );
  return [size, set] as const;
}

/** Drag handle between two panels. `row` resizes height (drag up and down),
 *  `col` resizes width (drag left and right). Arrow keys work too. */
export function Splitter({
  axis,
  value,
  onChange,
  invert = false,
  label,
}: {
  axis: "row" | "col";
  value: number;
  onChange: (v: number) => void;
  /** Dragging toward the start makes the panel bigger (a panel on the right). */
  invert?: boolean;
  label: string;
}) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = axis === "row" ? e.clientY : e.clientX;
    const from = value;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const d = (axis === "row" ? ev.clientY : ev.clientX) - start;
      onChange(from + (invert ? -d : d));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = axis === "row" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const back = axis === "row" ? "ArrowUp" : "ArrowLeft";
    const fwd = axis === "row" ? "ArrowDown" : "ArrowRight";
    if (e.key === back) onChange(value + (invert ? step : -step));
    else if (e.key === fwd) onChange(value + (invert ? -step : step));
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === "row" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`group relative z-20 shrink-0 touch-none outline-none ${
        axis === "row" ? "h-1.5 w-full cursor-row-resize" : "hidden h-full w-1.5 cursor-col-resize lg:block"
      }`}
    >
      <span
        className={`absolute bg-border transition-colors group-hover:bg-emerald/60 group-focus-visible:bg-emerald ${
          dragging ? "bg-emerald" : ""
        } ${axis === "row" ? "inset-x-0 top-1/2 h-px -translate-y-1/2" : "inset-y-0 left-1/2 w-px -translate-x-1/2"}`}
      />
      <span
        className={`absolute rounded-full bg-surface-3 opacity-0 transition-opacity group-hover:opacity-100 ${dragging ? "opacity-100" : ""} ${
          axis === "row" ? "top-1/2 left-1/2 h-1 w-10 -translate-1/2" : "top-1/2 left-1/2 h-10 w-1 -translate-1/2"
        }`}
      />
    </div>
  );
}
