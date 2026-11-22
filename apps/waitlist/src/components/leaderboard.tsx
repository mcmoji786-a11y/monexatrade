"use client";
/* Top inviters, live from the list (api/board): their public name, friends brought and the
   offer those invites unlocked. Next to it, the gift draw: every invite is a ticket. */

import { useEffect, useState } from "react";
import { GIFTS, offerByInvites } from "@/lib/offers";
import { PassButton } from "./pass-button";

type Row = { name: string; referrals: number; example?: boolean };

/** While the list is new, sample rows show how the board works. Each is marked "Example"
 *  on the page; real inviters always come first and push them out, one by one, as they
 *  arrive. They are never counted for gifts or offers. */
const EXAMPLES: Row[] = [
  { name: "Adam", referrals: 12 },
  { name: "Kevin", referrals: 9 },
  { name: "Sara", referrals: 7 },
  { name: "Omar", referrals: 5 },
  { name: "Lina", referrals: 4 },
  { name: "Bilal", referrals: 3 },
  { name: "Mia", referrals: 2 },
].map((r) => ({ ...r, example: true }));
const SHOWN = 8;

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

  // Real inviters first, in their order; examples fill the places nobody has taken yet.
  const shown = rows === null ? null : [...rows, ...EXAMPLES].slice(0, SHOWN);
  const examples = !!shown?.some((r) => r.example);
  return (
    <div className="board-grid">
      <div className="board">
        <div className="board-head">
          <span>
            <span className="live" aria-hidden="true" /> Top inviters
          </span>
          <span className="muted">updates every minute</span>
        </div>
        {examples && <p className="board-note">Rows marked Example show how it works. Real inviters take their places as invites come in, and only real accounts win gifts</p>}
        {/* The podium: first in the middle. */}
        <ol className="podium-row" aria-label="Top three">
          {[1, 0, 2].map((i) => {
            const r = shown?.[i];
            return (
              <li key={i} className={`step step-${i + 1} ${r ? "taken" : "open"} ${r?.example ? "example" : ""}`}>
                <span className="medal">{i + 1}</span>
                {r ? (
                  <>
                    <b className="step-name">{r.name}</b>
                    {r.example && <span className="ex-tag">Example</span>}
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
        {shown && shown.length > 3 && (
          <ol className="board-list" start={4}>
            {shown.slice(3).map((r, i) => (
              <li key={`${r.name}-${i}`} className={r.example ? "example" : ""}>
                <span className="b-rank">{String(i + 4).padStart(2, "0")}</span>
                <span className="b-name">
                  {r.name}
                  {r.example && <span className="ex-tag">Example</span>}
                </span>
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
        <PassButton className="btn-primary">Get tickets</PassButton>
      </aside>
    </div>
  );
}
