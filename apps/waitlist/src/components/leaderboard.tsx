"use client";
/* Top inviters, live from the list (api/board): their public name, friends brought and the
   offer those invites unlocked. Next to it, the gift draw: every invite is a ticket. */

import { useEffect, useState } from "react";
import { GIFTS, offerByInvites } from "@/lib/offers";

type Row = { name: string; referrals: number };

export function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/board")
        .then((r) => r.json() as Promise<{ rows: Row[] }>)
        .then((v) => alive && setRows(v.rows ?? []))
        .catch(() => alive && setRows([]));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="board-grid">
      <div className="board">
        <div className="board-head">
          <span>Top inviters</span>
          <span className="muted">Live</span>
        </div>
        {rows === null ? (
          <p className="board-empty">Loading</p>
        ) : rows.length === 0 ? (
          <p className="board-empty">Nobody has invited a friend yet. The first invite puts you at the top</p>
        ) : (
          <ol>
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} className={i < 3 ? "podium" : ""}>
                <span className="b-rank">{String(i + 1).padStart(2, "0")}</span>
                <span className="b-name">{r.name}</span>
                <span className="b-tier">{offerByInvites(r.referrals).name}</span>
                <span className="b-n">
                  {r.referrals.toLocaleString("en-US")}
                  <small> friend{r.referrals === 1 ? "" : "s"}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <aside className="gifts">
        <p className="gifts-title">The gift draw</p>
        <p className="gifts-sub">Every friend who joins with your link is one ticket. Winners are picked at random and get a printed Kixo gift, shipped to them</p>
        <ul>
          {GIFTS.map((g) => (
            <li key={g.name}>
              <b>{g.name}</b>
              <span>{g.note}</span>
            </li>
          ))}
        </ul>
        <a href="#join" className="btn-primary">
          Get tickets
        </a>
      </aside>
    </div>
  );
}
