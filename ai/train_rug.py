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
from features import FEATURES, WINDOW, WalletBook, early_buyers, features, prepare  # noqa: E402

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


def load(kind, since=None):
    """All rows of one kind; with `since` (unix seconds), only trades from then on."""
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
                if since is not None:
                    df = df[pd.to_numeric(df.ts, errors="coerce") >= since]
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


EXTRA = os.environ.get("KIXO_EXTRA", "E:/KixoData/external_days")


def day_start(name):
    return datetime.strptime(name, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()


def day_folders():
    """Every day of data, oldest first: imported public data (KIXO_EXTRA), then Kixo's own."""
    out = []
    for root, src in ((EXTRA, "external"), (DATA, "live")):
        for d in sorted(glob.glob(f"{root}/*")):
            name = os.path.basename(d)
            if os.path.isdir(d) and len(name) == 10 and glob.glob(f"{d}/trades-*.csv.gz"):
                out.append((name, d, src))
    return sorted(out)


def read_kind(folder, kind):
    """One day folder's rows of one kind (every file of that day)."""
    frames = []
    cols = (lambda c: c in TRADE_COLS) if kind == "trades" else None
    for f in sorted(glob.glob(f"{folder}/{kind}-*.csv.gz")):
        s = GzStream(f)
        try:
            r = io.BufferedReader(s, 1 << 20)
            names = None if kind != "trades" or r.peek(3)[:3] == b"ts," else ALL_TRADE_COLS
            df = pd.read_csv(r, names=names, usecols=cols, on_bad_lines="skip", low_memory=False, dtype={"wallet": str, "mint": str} if kind == "trades" else None)
            if kind == "trades":
                df["key"] = pd.util.hash_pandas_object(df[["signature", "mint", "wallet", "side"]], index=False).values
                df = df.drop(columns=["signature"]).drop_duplicates("key")
            frames.append(df)
        except (pd.errors.EmptyDataError, ValueError):
            pass
        finally:
            s.close()
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def read_cards(folder):
    cards = {}
    for f in sorted(glob.glob(f"{folder}/coin_cards-*.jsonl.gz")):
        for line in gz_text(f).decode("utf8", "ignore").splitlines():
            try:
                c = json.loads(line)
            except ValueError:
                continue
            cards[c.get("mint")] = c
    return cards


def stream_rows(keep_paths=None, lag_path=None, sources=("external", "live")):
    """Every coin with a full first hour, as features and outcomes, one day at a time
    (so tens of millions of trades never sit in memory together), oldest day first.

    Each wallet's record (WalletBook) is filled strictly in time order, across days and
    across both data sets: when a coin is judged, only coins whose hour had already ended
    count. With `lag_path`, the record as it stood two days before the end of the data
    is saved there (the 24-hour backtest uses it, so it never sees the outcomes it tests).
    `keep_paths(src, start)` says which coins keep their price path (for the lab)."""
    days = [d for d in day_folders() if d[2] in sources]
    if not days:
        return pd.DataFrame(), WalletBook()
    book = WalletBook()
    rows = []
    lag_cut = day_start(days[-1][0]) - 86_400
    lag_saved = False
    for i, (name, folder, src) in enumerate(days):
        d0 = day_start(name)
        d1 = d0 + 86_400
        coins = read_kind(folder, "coins")
        if coins.empty:
            continue
        t = read_kind(folder, "trades")
        # A coin made late in the day trades into the next day: its first hour comes too.
        if i + 1 < len(days) and days[i + 1][2] == src and day_start(days[i + 1][0]) == d1:
            t2 = read_kind(days[i + 1][1], "trades")
            if not t2.empty:
                t2 = t2[pd.to_numeric(t2.ts, errors="coerce") < d1 + WINDOW + HORIZON + 60]
                t = pd.concat([t, t2], ignore_index=True).drop_duplicates("key")
        if t.empty:
            continue
        t = prepare(t.drop(columns=["key"]))
        coins = coins.drop_duplicates("mint").set_index("mint")
        created = pd.to_numeric(coins.ts, errors="coerce")
        today = set(created[(created >= d0) & (created < d1)].index)
        t = t[t.mint.isin(today)]
        end = t.ts.max() if len(t) else d0
        cards = read_cards(folder)
        base = []
        for mint, g in t.groupby("mint", sort=False):
            start = g.ts.iloc[0]
            cut = start + WINDOW
            if cut + HORIZON > end:
                continue
            early = g[g.ts <= cut]
            creator = coins.creator.get(mint)
            creator = creator if isinstance(creator, str) else None
            f = features(early, creator, str(coins.launchpad.get(mint, "")), cards.get(mint))
            if f is None:
                continue
            p0 = early.price.iloc[-1]
            later = g[(g.ts > cut) & (g.ts <= cut + HORIZON)]
            lo = later.price.min() if len(later) else p0
            hi = later.price.max() if len(later) else p0
            f.update({"mint": mint, "start": start, "src": src, "dump": int(lo <= DUMP * p0), "pump": int(hi >= PUMP * p0), "ret": trade_result(later, p0), "_buyers": early_buyers(early, creator)})
            if keep_paths is not None and keep_paths(src, start):
                f.update({"entry": float(p0), "t": (later.ts.values - cut).astype(float), "p": later.price.values.astype(float)})
            base.append(f)
        base.sort(key=lambda r: r["start"])
        for r in base:
            book.advance(r["start"])
            if lag_path and not lag_saved and r["start"] >= lag_cut:
                book.save(lag_path)
                lag_saved = True
            r.update(book.features(r["_buyers"]))
            book.add_later(r["start"] + WINDOW + HORIZON, r.pop("_buyers"), r["pump"], r["dump"])
        rows.extend(base)
        print(f"  {name} ({src}): {len(base):,} coins, {len(rows):,} so far, {len(book.stats):,} wallets on record", flush=True)
        del t
    book.advance(float("inf"))
    if lag_path and not lag_saved:
        book.save(lag_path)
    return pd.DataFrame(rows), book


def fit(train, target):
    model = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1)
    model.fit(train[FEATURES], train[target])
    return model


def main():
    print("building coins day by day...", flush=True)
    os.makedirs(OUT, exist_ok=True)
    df, book = stream_rows(lag_path=f"{OUT}/wallet_book_lag.json")
    kept = book.save(f"{OUT}/wallet_book.json")
    print(f"  wallet record: {kept:,} wallets with 2+ earlier coins", flush=True)
    live = df[df.src == "live"]
    print(f"  {len(df):,} coins with a full first hour ({len(live):,} Kixo's own, {len(df) - len(live):,} imported)", flush=True)
    if len(live) < 500:
        sys.exit("not enough coins yet")

    # The test is always Kixo's own newest quarter: today's market, never seen in training.
    split = live.start.quantile(0.75)
    te = live[live.start > split].copy()
    own, both = live[live.start <= split], df[df.start <= split]
    candidates = {"own": own}
    if len(both) > len(own):
        candidates["own+imported"] = both
    models, scores = {}, {}
    for name, train in candidates.items():
        models[name] = {t: fit(train, t) for t in ("dump", "pump")}
        aucs = {t: roc_auc_score(te[t], models[name][t].predict_proba(te[FEATURES])[:, 1]) for t in ("dump", "pump") if te[t].nunique() > 1}
        scores[name] = aucs
        print(f"  trained on {name} ({len(train):,} coins): AUC dump {aucs.get('dump', float('nan')):.3f}, pump {aucs.get('pump', float('nan')):.3f}", flush=True)
    best = max(scores, key=lambda n: sum(scores[n].values()))
    tr = candidates[best]
    print(f"  keeping: {best}", flush=True)

    report = {"trained": datetime.now(timezone.utc).isoformat(), "coins": len(df), "own_coins": len(live), "train": len(tr), "test": len(te), "trained_on": best, "candidates": {n: {t: round(v, 4) for t, v in a.items()} for n, a in scores.items()}, "window_s": WINDOW, "horizon_s": HORIZON, "features": len(FEATURES), "targets": {}}
    stamp = datetime.now().strftime("%Y%m%d")
    for target in ("dump", "pump"):
        model = models[best][target]
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
