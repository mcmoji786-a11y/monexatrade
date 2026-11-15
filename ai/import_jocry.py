"""Imports the public PumpFun Launch-to-Graduation Corpus (jocry/Pumpfun_Memecoin_Corpus
on Hugging Face, 5 Jun - 14 Jul 2026, 33.6M trades; CC BY 4.0 / MIT, cite the dataset)
into Kixo's collector format, one folder per UTC day under E:\\KixoData\\external_days,
so training reads it exactly like Kixo's own data.

Following the corpus's KNOWN_ISSUES.md:
- the System Program address (19.9% of rows) is not a trader: its wallet is dropped
  (the trade stays, it just counts for no wallet);
- a trade whose sol_amount disagrees with token_amount x price (outside 0.01x-100x), or
  whose amount, price or reserves are missing, cannot be used; a coin with even one such
  trade is left out whole, because a coin with gaps would show the model wrong buyer counts
  (two passes: find the clean coins, then write only those);
- reserves are raw units, as in Kixo's data; token amounts are human units (x 1e6 here).
There is no slot number: an estimate from the time (400 ms slots) stands in.
Social links are not in the corpus: coin cards say so ("external"), and the features
leave them unknown rather than "none".

Run: E:\\KixoAI\\venv\\Scripts\\python.exe -I ai\\import_jocry.py
"""

import csv
import datetime as dt
import glob
import gzip
import io
import json
import math
import os

import numpy as np
import pyarrow.parquet as pq

SRC = os.environ.get("JOCRY_DIR", "E:/KixoData/external/jocry")
OUT = os.environ.get("KIXO_EXTRA", "E:/KixoData/external_days")
SYSTEM_PROGRAM = "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"
TRADES_HEADER = ["ts", "slot", "signature", "mint", "side", "sol_lamports", "token_amount", "wallet", "v_sol", "v_tokens", "real_tokens"]
COINS_HEADER = ["ts", "signature", "mint", "symbol", "name", "creator", "launchpad", "quote_mint", "bonding_curve", "uri"]


class Days:
    """One gzip CSV writer per UTC day and kind."""

    def __init__(self, kind, header):
        self.kind, self.header, self.files = kind, header, {}

    def writer(self, day):
        if day not in self.files:
            os.makedirs(f"{OUT}/{day}", exist_ok=True)
            fh = gzip.open(f"{OUT}/{day}/{self.kind}-jocry.csv.gz", "wt", newline="", encoding="utf8")
            w = csv.writer(fh)
            w.writerow(self.header)
            self.files[day] = (fh, w)
        return self.files[day][1]

    def close(self):
        for fh, _ in self.files.values():
            fh.close()


_DAYS = {}


def day_of(ts):
    n = int(ts // 86400)
    if n not in _DAYS:
        _DAYS[n] = dt.datetime.fromtimestamp(n * 86400, dt.timezone.utc).strftime("%Y-%m-%d")
    return _DAYS[n]


COLS = ["mint", "tx_signature", "event_time", "is_buy", "sol_amount", "token_amount", "user_wallet", "v_tokens_bonding_curve", "v_sol_bonding_curve", "price_sol"]


def batches(columns):
    """Every trade file in order, as dicts of column arrays (not one Python dict per row)."""
    for path in sorted(glob.glob(f"{SRC}/trades-*.parquet")):
        for batch in pq.ParquetFile(path).iter_batches(batch_size=50_000, columns=columns):
            yield path, {name: batch.column(name).to_numpy(zero_copy_only=False) for name in columns}


def usable(c):
    """Which rows have a consistent amount, price, reserves and time."""
    sol, tok, price = c["sol_amount"].astype("float64"), c["token_amount"].astype("float64"), c["price_sol"].astype("float64")
    vs, vt = c["v_sol_bonding_curve"].astype("float64"), c["v_tokens_bonding_curve"].astype("float64")
    with np.errstate(all="ignore"):
        ratio = sol / (tok * price)
        return (sol > 0) & (tok > 0) & (price > 0) & (vs > 0) & (vt > 0) & ~np.isnat(c["event_time"]) & (ratio >= 0.01) & (ratio <= 100)


def main():
    if os.path.exists(OUT) and glob.glob(f"{OUT}/*/trades-jocry.csv.gz"):
        raise SystemExit(f"{OUT} already has imported days: delete it first to import again")
    print("pass 1: finding coins with unusable trades...", flush=True)
    bad, seen = set(), set()
    for _, c in batches(["mint", "event_time", "sol_amount", "token_amount", "price_sol", "v_sol_bonding_curve", "v_tokens_bonding_curve"]):
        ok = usable(c)
        seen.update(c["mint"].tolist())
        bad.update(c["mint"][~ok].tolist())
    print(f"  {len(seen):,} coins traded, {len(bad):,} left out for unusable trades", flush=True)
    del seen
    print("tokens...", flush=True)
    token_cols = ["mint", "detected_at", "symbol", "name", "creator", "creator_past_tokens", "creator_past_rugs", "bonding_curve_key"]
    tokens = (r for b in pq.ParquetFile(f"{SRC}/tokens.parquet").iter_batches(batch_size=20_000, columns=token_cols) for r in b.to_pylist())
    coins_w = Days("coins", COINS_HEADER)
    cards = {}
    for r in tokens:
        if not r["mint"] or r["detected_at"] is None or r["mint"] in bad:
            continue
        ts = r["detected_at"].timestamp()
        d = day_of(ts)
        coins_w.writer(d).writerow([f"{ts:.3f}", "", r["mint"], (r["symbol"] or "")[:20], (r["name"] or "")[:40], r["creator"] or "", "pump.fun", "", r["bonding_curve_key"] or "", ""])
        rep = {"coins": r["creator_past_tokens"], "rugged": r["creator_past_rugs"], "died_fast": None, "graduated": None}
        cards.setdefault(d, []).append(json.dumps({"mint": r["mint"], "external": True, "meta": None, "dev_report": rep, "t": int(ts)}))
    coins_w.close()
    n_coins = sum(len(v) for v in cards.values())
    for d, lines in cards.items():
        with gzip.open(f"{OUT}/{d}/coin_cards-jocry.jsonl.gz", "wt", encoding="utf8") as fh:
            fh.write("\n".join(lines) + "\n")
    print(f"  {n_coins:,} coins written", flush=True)
    del cards

    trades_w = Days("trades", TRADES_HEADER)
    kept = no_wallet = 0
    last = None
    for path, c in batches(COLS):
        ok = usable(c)
        sol, tok = c["sol_amount"].astype("float64"), c["token_amount"].astype("float64")
        vs, vt = c["v_sol_bonding_curve"].astype("float64"), c["v_tokens_bonding_curve"].astype("float64")
        ts_all = c["event_time"].astype("datetime64[ms]").astype("int64") / 1000.0
        for i in np.flatnonzero(ok):
            mint = c["mint"][i]
            if mint in bad:
                continue
            ts = float(ts_all[i])
            wallet = c["user_wallet"][i] or ""
            if wallet == SYSTEM_PROGRAM:
                wallet = ""
                no_wallet += 1
            trades_w.writer(day_of(ts)).writerow([
                f"{ts:.3f}", int(ts / 0.4), c["tx_signature"][i] or "", mint, "buy" if c["is_buy"][i] else "sell",
                int(sol[i] * 1e9), int(tok[i] * 1e6), wallet, int(vs[i]), int(vt[i]), "",
            ])
            kept += 1
        if path != last and last is not None:
            print(f"  {os.path.basename(last)} done: {kept:,} trades so far", flush=True)
        last = path
    trades_w.close()
    print(f"done: {n_coins:,} clean coins, {kept:,} trades ({no_wallet:,} without a trader wallet), into {OUT}", flush=True)


if __name__ == "__main__":
    main()
