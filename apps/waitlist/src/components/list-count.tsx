"use client";

import { useEffect, useState } from "react";

/** "1,240 traders are waiting", shown once the list has 100 people (a real count). */
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
      <span className="dot" /> {n.toLocaleString("en-US")} traders are already waiting
    </p>
  );
}
