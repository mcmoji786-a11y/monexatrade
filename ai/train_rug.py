"""Kixo AI, model 1: from a coin's first 2 minutes, the chance it dumps (falls 70%+) or
doubles in the next hour. Trained on the collector's data (E:/KixoData/live), tested on
the newest days it has never seen, then backtested as a trading rule with costs.

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\train_rug.py
Out:  E:\\KixoAI\\models\\{dump,pump}_latest.txt (+ dated copies) and report_latest.json
"""

import glob
import io
import json
import os
import shutil
import sys
import zlib
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, os.path.dirname(__file__))
from features import FEATURES, WINDOW, features, prepare  # noqa: E402

DATA = os.environ.get("KIXO_DATA", "E:/KixoData/live")
OUT = os.environ.get("KIXO_AI", "E:/KixoAI/models")
HORIZON = 3600
DUMP = 0.30
PUMP = 2.0
# Backtest rule: buy at 2 minutes, sell at +100% (take profit), -40% (stop loss) or after an
# hour; each side costs 1% (Kixo's 0.5% fee plus price impact on a small buy).
TP, SL, COST = 2.0, 0.6, 0.01


class GzStream(io.RawIOBase):
    """Reads a gzip file chunk by chunk and stops quietly at a truncated end, so a big or
    still-being-written file never has to fit in memory at once."""

    def __init__(self, path):
        self.f = open(path, "rb")
        self.z = zlib.decompressobj(16 + zlib.MAX_WBITS)
        self.buf = b""

    def readable(self):
        return True

    def readinto(self, b):
        while not self.buf:
            raw = self.f.read(1 << 20)
            if not raw:
                return 0
            try:
                self.buf = self.z.decompress(raw)
            except zlib.error:
                return 0
        n = min(len(b), len(self.buf))
        b[:n] = self.buf[:n]
        self.buf = self.buf[n:]
        return n

    def close(self):
        self.f.close()
        super().close()


def gz_text(path):
    s = GzStream(path)
    try:
        return io.BufferedReader(s).read()
    finally:
        s.close()


ALL_TRADE_COLS = ["ts", "slot", "signature", "mint", "side", "sol_lamports", "token_amount", "wallet", "v_sol", "v_tokens", "real_tokens"]
TRADE_COLS = ["signature", "mint", "wallet", "side", "ts", "slot", "sol_lamports", "v_sol", "v_tokens"]


def load(kind):
    frames = []
    cols = (lambda c: c in TRADE_COLS) if kind == "trades" else None
    for f in sorted(glob.glob(f"{DATA}/*/{kind}-*.csv.gz")):
        s = GzStream(f)
        try:
            r = io.BufferedReader(s, 1 << 20)
            # Pieces split off a broken file (`*-old2`...) start without the header row.
            names = None if kind != "trades" or r.peek(3)[:3] == b"ts," else ALL_TRADE_COLS
            df = pd.read_csv(r, names=names, usecols=cols, on_bad_lines="skip", low_memory=False)
            if kind == "trades":
                # One number per trade for de-duplication instead of four long strings.
                df["key"] = pd.util.hash_pandas_object(df[["signature", "mint", "wallet", "side"]], index=False).values
                df = df.drop(columns=["signature"])
                df["side"] = pd.Categorical(df.side, categories=["buy", "sell"])
                df = df.drop_duplicates("key")
            frames.append(df)
        except (pd.errors.EmptyDataError, ValueError):
            pass
        finally:
            s.close()
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def load_cards():
    cards = {}
    for f in sorted(glob.glob(f"{DATA}/*/coin_cards-*.jsonl.gz")):
        for line in gz_text(f).decode("utf8", "ignore").splitlines():
            try:
                c = json.loads(line)
            except ValueError:
                continue
            cards[c.get("mint")] = c
    return cards


def trade_result(later, entry):
    """What the rule returns after costs, walking the price after the entry."""
    for p in later.price.values:
        if p >= TP * entry:
            return TP * (1 - COST) / (1 + COST) - 1
        if p <= SL * entry:
            return SL * (1 - COST) / (1 + COST) - 1
    last = later.price.values[-1] if len(later) else entry
    return (last / entry) * (1 - COST) / (1 + COST) - 1


def main():
    print("loading trades...", flush=True)
    t = load("trades")
    coins = load("coins")
    cards = load_cards()
    print(f"  {len(t):,} trades, {len(coins):,} coins, {len(cards):,} cards", flush=True)
    t = prepare(t.drop_duplicates("key").drop(columns=["key"]))
    coins = coins.drop_duplicates("mint").set_index("mint")
    end_of_data = t.ts.max()

    rows = []
    for mint, g in t.groupby("mint", sort=False):
        start = g.ts.iloc[0]
        cut = start + WINDOW
        if cut + HORIZON > end_of_data:
            continue
        early = g[g.ts <= cut]
        f = features(early, coins.creator.get(mint), str(coins.launchpad.get(mint, "")), cards.get(mint))
        if f is None:
            continue
        p0 = early.price.iloc[-1]
        later = g[(g.ts > cut) & (g.ts <= cut + HORIZON)]
        lo = later.price.min() if len(later) else p0
        hi = later.price.max() if len(later) else p0
        f.update({"mint": mint, "start": start, "dump": int(lo <= DUMP * p0), "pump": int(hi >= PUMP * p0), "ret": trade_result(later, p0)})
        rows.append(f)
    df = pd.DataFrame(rows).sort_values("start")
    print(f"  {len(df):,} coins with a full first hour", flush=True)
    if len(df) < 500:
        sys.exit("not enough coins yet")

    split = df.start.quantile(0.75)
    tr, te = df[df.start <= split], df[df.start > split].copy()
    report = {"trained": datetime.now(timezone.utc).isoformat(), "coins": len(df), "train": len(tr), "test": len(te), "window_s": WINDOW, "horizon_s": HORIZON, "targets": {}}
    os.makedirs(OUT, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    for target in ("dump", "pump"):
        model = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1)
        model.fit(tr[FEATURES], tr[target])
        p = model.predict_proba(te[FEATURES])[:, 1]
        te[f"p_{target}"] = p
        base = te[target].mean()
        auc = roc_auc_score(te[target], p) if te[target].nunique() > 1 else float("nan")
        order = np.argsort(-p)
        n10 = max(1, len(te) // 10)
        report["targets"][target] = {
            "base_rate": round(float(base), 4),
            "auc": round(float(auc), 4),
            "top10pct_rate": round(float(te[target].values[order[:n10]].mean()), 4),
            "bottom10pct_rate": round(float(te[target].values[order[-n10:]].mean()), 4),
        }
        model.booster_.save_model(f"{OUT}/{target}_{stamp}.txt")
        shutil.copy(f"{OUT}/{target}_{stamp}.txt", f"{OUT}/{target}_latest.txt")
        print(f"{target.upper()}: base {base:.1%}, riskiest 10% {report['targets'][target]['top10pct_rate']:.1%}, AUC {auc:.3f}", flush=True)

    # Backtest on the unseen days: every coin vs the coins the model picks.
    te["score"] = te.p_pump - te.p_dump
    bt = {}

    def line(name, sel):
        if len(sel) == 0:
            return
        r = sel.ret
        bt[name] = {"trades": int(len(sel)), "win_rate": round(float((r > 0).mean()), 4), "avg_return": round(float(r.mean()), 4), "median_return": round(float(r.median()), 4)}
        print(f"  {name:<34} {len(sel):>6} trades  win {(r > 0).mean():>6.1%}  avg {r.mean():>+7.1%}  median {r.median():>+7.1%}", flush=True)

    print("\nBACKTEST (buy at 2 min, +100% / -40% / 1 h, 1% cost each side):")
    line("every coin", te)
    for q in (0.5, 0.8, 0.9, 0.95, 0.98):
        line(f"model's best {int(round((1 - q) * 100))}%", te[te.score >= te.score.quantile(q)])
    line("low dump risk only (p_dump<10%)", te[te.p_dump < 0.10])
    report["backtest"] = bt
    for name in (f"report_{stamp}.json", "report_latest.json"):
        with open(f"{OUT}/{name}", "w") as fh:
            json.dump(report, fh, indent=2)
    print(f"\nsaved to {OUT}")


if __name__ == "__main__":
    main()
