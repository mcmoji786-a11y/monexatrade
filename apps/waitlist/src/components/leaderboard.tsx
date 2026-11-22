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
          <span>
            <span className="live" aria-hidden="true" /> Top inviters
          </span>
          <span className="muted">updates every minute</span>
        </div>
        {/* The podium: first in the middle. A free place says what it takes. */}
        <ol className="podium-row" aria-label="Top three">
          {[1, 0, 2].map((i) => {
            const r = rows?.[i];
            return (
              <li key={i} className={`step step-${i + 1} ${r ? "taken" : "open"}`}>
                <span className="medal">{i + 1}</span>
                {r ? (
                  <>
                    <b className="step-name">{r.name}</b>
                    <span className="step-n">
                      {r.referrals.toLocaleString("en-US")} friend{r.referrals === 1 ? "" : "s"}
                    </span>
                    <span className="step-tier">{offerByInvites(r.referrals).name}</span>
                  </>
                ) : (
                  <>
                    <b className="step-name">Open spot</b>
                    <span className="step-n">{rows === null ? "Loading" : "Invite 1 friend to take it"}</span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
        {rows && rows.length > 3 && (
          <ol className="board-list" start={4}>
            {rows.slice(3).map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <span className="b-rank">{String(i + 4).padStart(2, "0")}</span>
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
        {rows && rows.length <= 3 && <p className="board-empty">The list is just starting: one invite puts you on the podium</p>}
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
