"""Kixo AI, model 4: the next 1, 2 and 5 minutes of a coin, from its last minute of trades
(scalp.py). Every coin is looked at every 15 seconds of its first 30 minutes while it
trades. Targets: +10% within a minute, +20% within two, +50% within five, -15% within two,
and the scalp trade (+20% take profit before -10% stop, at most 2 minutes, 1% cost each
side).

Honest testing like the other models: trained on older days, tested on Kixo's own newest
days it never saw. The unseen days are split in time: the first half picks the line (how
sure the model must be), the second half only checks it. A coin is entered at most once
every 2 minutes (no overlapping trades on one coin).

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\train_scalp.py
Out:  E:\\KixoAI\\models\\scalp_<target>_latest.txt, scalp_report_latest.json
Env:  KIXO_SCALP_DAYS=N (newest N days only), KIXO_SCALP_EXTERNAL=1 (add imported days)
"""

import json
import os
import shutil
import sys
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, os.path.dirname(__file__))
from features import prepare  # noqa: E402
from scalp import COST, FEATURES, HOLD, SL, TARGETS, TP, features, outcome  # noqa: E402
from train_rug import OUT, compact, day_folders, day_start, read_kind  # noqa: E402

STEP = 15
FIRST = 20
LAST = 1800
AFTER = 300
ALIVE = 30
MAX_PER_COIN = 80
SNIPE_S = 3
MIN_TRADES = 60


def coin_rows(g, creator, end):
    """Every moment of one coin, with its features and what followed."""
    ts = g.ts.values.astype("float64")
    price = g.price.values.astype("float64")
    sol = g.sol.values.astype("float64")
    buy = g.buy.values.astype(bool)
    wallet = np.array([w if isinstance(w, str) else "" for w in g.wallet.values], dtype=object)
    slot = g.slot.values if "slot" in g.columns else np.zeros(len(g))
    start = ts[0]
    dev = wallet == (creator or "\0")
    # Snipers: bought in the first seconds; bundles: bought in the launch slot. Not the dev.
    sniper_set = set(wallet[(ts <= start + SNIPE_S) & buy & ~dev].tolist()) - {""}
    bundle_set = set(wallet[(slot == slot[0]) & buy & ~dev].tolist()) - {""}
    sniper = np.array([w in sniper_set for w in wallet])
    bundler = np.array([w in bundle_set for w in wallet])
    peak = np.maximum.accumulate(price)
    rows = []
    t = start + FIRST
    stop = min(start + LAST, end - AFTER)
    while t <= stop and len(rows) < MAX_PER_COIN:
        hi = np.searchsorted(ts, t, side="right")
        if hi >= 3 and ts[hi - 1] >= t - ALIVE:
            lo = np.searchsorted(ts, t - 120, side="left")
            p = price[hi - 1]
            f = features(ts[lo:hi], price[lo:hi], sol[lo:hi], buy[lo:hi], wallet[lo:hi], dev[lo:hi], sniper[lo:hi], bundler[lo:hi], t, t - start, p * 1e6, peak[hi - 1], price[0])
            if f is not None:
                j = np.searchsorted(ts, t + AFTER, side="right")
                f.update(outcome(ts[hi:j], price[hi:j], t, p))
                f["when"] = int(t)
                rows.append(f)
        t += STEP
    return rows


def stream():
    days = day_folders()
    if os.environ.get("KIXO_SCALP_EXTERNAL") != "1":
        days = [d for d in days if d[2] == "live"]
    if int(os.environ.get("KIXO_SCALP_DAYS", "0")) > 0:
        days = days[-int(os.environ["KIXO_SCALP_DAYS"]):]
    frames, n = [], 0
    for i, (name, folder, src) in enumerate(days):
        d0 = day_start(name)
        d1 = d0 + 86_400
        coins = read_kind(folder, "coins")
        if coins.empty:
            continue
        t = read_kind(folder, "trades")
        if i + 1 < len(days) and days[i + 1][2] == src and day_start(days[i + 1][0]) == d1:
            t2 = read_kind(days[i + 1][1], "trades")
            if not t2.empty:
                t2 = t2[pd.to_numeric(t2.ts, errors="coerce") < d1 + LAST + AFTER + 60]
                t = pd.concat([t, t2], ignore_index=True).drop_duplicates("key")
        if t.empty:
            continue
        t = prepare(t.drop(columns=["key"]))
        coins = coins.drop_duplicates("mint").set_index("mint")
        created = pd.to_numeric(coins.ts, errors="coerce")
        today = set(created[(created >= d0) & (created < d1)].index)
        t = t[t.mint.isin(today)]
        end = t.ts.max() if len(t) else d0
        rows = []
        for mint, g in t.groupby("mint", sort=False):
            if len(g) < MIN_TRADES:
                continue
            creator = coins.creator.get(mint)
            for r in coin_rows(g, creator if isinstance(creator, str) else None, end):
                r["mint"] = mint
                r["src"] = src
                rows.append(r)
        if rows:
            frames.append(compact(pd.DataFrame(rows)))
            n += len(rows)
        print(f"  {name} ({src}): {len(rows):,} moments, {n:,} so far", flush=True)
        del t
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


PARAMS = dict(learning_rate=0.05, num_leaves=63, min_child_samples=200, colsample_bytree=0.8, reg_lambda=2.0)


def fit(train, target):
    train = train.sort_values("when")
    cut = int(len(train) * 0.85)
    tr, va = train.iloc[:cut], train.iloc[cut:]
    m = lgb.LGBMClassifier(n_estimators=1500, subsample=0.8, subsample_freq=1, verbose=-1, **PARAMS)
    m.fit(tr[FEATURES], tr[target], eval_X=va[FEATURES], eval_y=va[target], eval_metric="auc", callbacks=[lgb.early_stopping(100, verbose=False)])
    trees = max(50, int((m.best_iteration_ or 400) * 1.1))
    final = lgb.LGBMClassifier(n_estimators=trees, subsample=0.8, subsample_freq=1, verbose=-1, **PARAMS)
    final.fit(train[FEATURES], train[target])
    print(f"    {target}: {trees} trees", flush=True)
    return final


def entries(rows, line):
    """Moments at or above the line, at most one entry per coin every HOLD seconds."""
    sel = rows[rows.p_win >= line].sort_values("when")
    keep, last = [], {}
    for i, (m, w) in enumerate(zip(sel.mint.values, sel["when"].values)):
        if w - last.get(m, -1e18) >= HOLD:
            keep.append(i)
            last[m] = w
    return sel.iloc[keep]


def summary(sel):
    if len(sel) == 0:
        return {"trades": 0}
    r = sel.scalp_ret
    return {"trades": int(len(sel)), "coins": int(sel.mint.nunique()), "win_rate": round(float(sel.scalp_win.mean()), 4), "avg_return": round(float(r.mean()), 4), "median_return": round(float(r.median()), 4)}


def main():
    print("building moments day by day...", flush=True)
    os.makedirs(OUT, exist_ok=True)
    df = stream()
    if len(df) < 20_000:
        sys.exit(f"not enough moments yet ({len(df)})")
    split = df["when"].quantile(0.75)
    tr, te = df[df["when"] <= split], df[df["when"] > split].copy()
    print(f"  {len(df):,} moments, {df.mint.nunique():,} coins; train {len(tr):,}, test {len(te):,}", flush=True)
    for t in TARGETS:
        print(f"  base rate {t}: {df[t].mean():.1%}", flush=True)

    models, report = {}, {"trained": datetime.now(timezone.utc).isoformat(), "moments": len(df), "coins": int(df.mint.nunique()), "test_moments": len(te), "rule": {"take_profit": TP, "stop_loss": SL, "hold_s": HOLD, "cost_each_side": COST}, "targets": {}}
    stamp = datetime.now().strftime("%Y%m%d")
    for t in TARGETS:
        m = fit(tr, t)
        p = m.predict_proba(te[FEATURES])[:, 1]
        te[f"p_{t}"] = p
        auc = roc_auc_score(te[t], p) if te[t].nunique() > 1 else float("nan")
        # Calibration: the model's chance against what really happened, by tenth.
        bins = pd.qcut(p, 10, labels=False, duplicates="drop")
        cal = [{"said": round(float(p[bins == b].mean()), 4), "was": round(float(te[t].values[bins == b].mean()), 4), "n": int((bins == b).sum())} for b in sorted(set(bins))]
        report["targets"][t] = {"base_rate": round(float(te[t].mean()), 4), "auc": round(float(auc), 4), "calibration": cal}
        print(f"  {t}: AUC {auc:.3f}, base {te[t].mean():.1%}, top tenth said {cal[-1]['said']:.1%} was {cal[-1]['was']:.1%}", flush=True)
        m.booster_.save_model(f"{OUT}/scalp_{t}_{stamp}.txt")
        shutil.copy(f"{OUT}/scalp_{t}_{stamp}.txt", f"{OUT}/scalp_{t}_latest.txt")
        models[t] = m

    te["p_win"] = te["p_scalp_win"]
    mid = te["when"].median()
    search, check = te[te["when"] <= mid], te[te["when"] > mid]
    print(f"\nSCALP (+{(TP - 1) * 100:.0f}% / -{(1 - SL) * 100:.0f}% / {HOLD}s, {COST:.0%} cost each side, one entry per coin per {HOLD}s):")
    print(f"  every moment        search {summary(entries(search, -1))}  check {summary(entries(check, -1))}")
    tried = []
    for top in (0.01, 0.02, 0.05, 0.10, 0.20):
        line = float(search.p_win.quantile(1 - top))
        sres, cres = summary(entries(search, line)), summary(entries(check, line))
        tried.append({"top": top, "line": round(line, 4), "search": sres, "check": cres})
        print(f"  top {top:>4.0%} (p >= {line:.3f})  search {sres.get('trades', 0):>6} win {sres.get('win_rate', 0):.1%} avg {sres.get('avg_return', 0):+.2%}   check {cres.get('trades', 0):>6} win {cres.get('win_rate', 0):.1%} avg {cres.get('avg_return', 0):+.2%}", flush=True)
    good = [x for x in tried if x["search"].get("trades", 0) >= 100]
    chosen = max(good, key=lambda x: x["search"]["avg_return"]) if good else None
    proven = bool(chosen and chosen["search"]["avg_return"] > 0 and chosen["check"].get("trades", 0) >= 50 and chosen["check"]["avg_return"] > 0)
    report.update({"every_moment": {"search": summary(entries(search, -1)), "check": summary(entries(check, -1))}, "lines": tried, "pick": chosen, "proven": proven})
    for name in (f"scalp_report_{stamp}.json", "scalp_report_latest.json"):
        with open(f"{OUT}/{name}", "w") as fh:
            json.dump(report, fh, indent=2)
    print(f"\npick: {chosen}\nproven after costs on both halves: {proven}\nsaved to {OUT}")


if __name__ == "__main__":
    main()
