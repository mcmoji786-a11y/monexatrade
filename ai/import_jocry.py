"""Imports the public PumpFun Launch-to-Graduation Corpus (jocry/Pumpfun_Memecoin_Corpus
on Hugging Face, 5 Jun - 14 Jul 2026, 33.6M trades; CC BY 4.0 / MIT, cite the dataset)
into Kixo's collector format, one folder per UTC day under E:\\KixoData\\external_days,
so training reads it exactly like Kixo's own data.

Following the corpus's KNOWN_ISSUES.md:
- the System Program address (19.9% of rows) is not a trader: its wallet is dropped
  (the trade stays, it just counts for no wallet);
- trades whose sol_amount disagrees with token_amount x price (outside 0.01x-100x) or is
  missing are skipped (prices come from the bonding-curve reserves, which are clean);
- reserves are raw units, as in Kixo's data; token amounts are human units (x 1e6 here).
There is no slot number: an estimate from the time (400 ms slots) stands in.
Social links are not in the corpus: coin cards say so ("external"), and the features
leave them unknown rather than "none".

Run: E:\\KixoAI\\venv\\Scripts\\python.exe -I ai\\import_jocry.py
"""

import csv
import glob
import gzip
import io
import json
import math
import os

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


def day_of(ts):
    import datetime as dt

    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d")


def main():
    if os.path.exists(OUT) and glob.glob(f"{OUT}/*/trades-jocry.csv.gz"):
        raise SystemExit(f"{OUT} already has imported days: delete it first to import again")
    print("tokens...", flush=True)
    tokens = pq.read_table(f"{SRC}/tokens.parquet", columns=["mint", "detected_at", "symbol", "name", "creator", "creator_past_tokens", "creator_past_rugs", "bonding_curve_key"]).to_pylist()
    coins_w = Days("coins", COINS_HEADER)
    cards = {}
    for r in tokens:
        if not r["mint"] or r["detected_at"] is None:
            continue
        ts = r["detected_at"].timestamp()
        d = day_of(ts)
        coins_w.writer(d).writerow([f"{ts:.3f}", "", r["mint"], (r["symbol"] or "")[:20], (r["name"] or "")[:40], r["creator"] or "", "pump.fun", "", r["bonding_curve_key"] or "", ""])
        rep = {"coins": r["creator_past_tokens"], "rugged": r["creator_past_rugs"], "died_fast": None, "graduated": None}
        cards.setdefault(d, []).append(json.dumps({"mint": r["mint"], "external": True, "meta": None, "dev_report": rep, "t": int(ts)}))
    coins_w.close()
    for d, lines in cards.items():
        with gzip.open(f"{OUT}/{d}/coin_cards-jocry.jsonl.gz", "wt", encoding="utf8") as fh:
            fh.write("\n".join(lines) + "\n")
    print(f"  {len(tokens):,} coins", flush=True)
    del tokens, cards

    trades_w = Days("trades", TRADES_HEADER)
    kept = skipped = no_wallet = 0
    cols = ["mint", "tx_signature", "event_time", "is_buy", "sol_amount", "token_amount", "user_wallet", "v_tokens_bonding_curve", "v_sol_bonding_curve", "price_sol"]
    for path in sorted(glob.glob(f"{SRC}/trades-*.parquet")):
        pf = pq.ParquetFile(path)
        for batch in pf.iter_batches(batch_size=200_000, columns=cols):
            for r in batch.to_pylist():
                sol, tok, price = r["sol_amount"], r["token_amount"], r["price_sol"]
                vs, vt, at = r["v_sol_bonding_curve"], r["v_tokens_bonding_curve"], r["event_time"]
                if not (sol and tok and price and vs and vt and at) or sol <= 0 or tok <= 0:
                    skipped += 1
                    continue
                ratio = sol / (tok * price)
                if not (0.01 <= ratio <= 100) or math.isnan(ratio):
                    skipped += 1
                    continue
                ts = at.timestamp()
                wallet = r["user_wallet"] or ""
                if wallet == SYSTEM_PROGRAM:
                    wallet = ""
                    no_wallet += 1
                trades_w.writer(day_of(ts)).writerow([
                    f"{ts:.3f}", int(ts / 0.4), r["tx_signature"] or "", r["mint"], "buy" if r["is_buy"] else "sell",
                    int(sol * 1e9), int(tok * 1e6), wallet, int(vs), int(vt), "",
                ])
                kept += 1
        print(f"  {os.path.basename(path)}: {kept:,} trades kept so far, {skipped:,} skipped", flush=True)
    trades_w.close()
    print(f"done: {kept:,} trades ({no_wallet:,} without a trader wallet), {skipped:,} skipped, into {OUT}", flush=True)


if __name__ == "__main__":
    main()
