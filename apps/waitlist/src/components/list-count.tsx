"use client";

import { useEffect, useState } from "react";

/** "1,240 traders already have a pass": the real count, shown once the list has 100. */
export function ListCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    fetch("/api/count")
      .then((r) => r.json() as Promise<{ total: number }>)
      .then((v) => setN(v.total ?? 0))
      .catch(() => {});
  }, []);
  if (n < 100) return null;
  return (
    <p className="count">
      <span className="live" aria-hidden="true" />
      <span>
        <b>{n.toLocaleString("en-US")}</b> traders already have a pass
      </span>
    </p>
  );
}
