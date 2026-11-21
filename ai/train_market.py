"""Kixo AI for established coins: what happens in the next hour.

Run:  E:/KixoAI/venv/Scripts/python.exe ai/train_market.py
Out:  E:/KixoAI/models/market_<target>_latest.txt and market_report_latest.json

The collector saves every coin on Discover's market board once a minute (snapshots
"markets": price, market cap, liquidity, volume, buys/sells, traders, holders, top-holder
share, organic score...). For each coin, one sample every 10 minutes: its figures then,
its own price moves over the last 15 and 30 minutes, and what its price did over the next
hour. The newest days are held out and never seen in training: the report is measured on
them.

Targets (from the price at the sample):
  up10 / up20     the price reached +10% / +20% at some point in the next hour
  down10 / down20 the price fell to -10% / -20% at some point in the next hour
  green           the price an hour later is higher
A sample needs the coin's price for most of the next hour; coins that leave the board
early are counted in the report (they bias the data towards coins that kept trading).
"""
import glob
import gzip
import json
import math
import os
import sys
import zlib
from array import array
from collections import defaultdict
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
from sklearn.metrics import roc_auc_score

DATA = os.environ.get("KIXO_DATA", "E:/KixoData/live")
OUT = os.environ.get("KIXO_AI", "E:/KixoAI/models")
EVERY = 600  # one sample per coin every 10 minutes
HORIZON = 3600
TEST_DAYS = 3
TARGETS = ("up10", "up20", "down10", "down20", "green")
FEATURES = [
    "chg5m", "chg1h", "chg24h", "mom15", "mom30", "vol30",
    "log_mc", "log_liq", "liq_mc", "log_v5", "log_v1h", "log_v24", "v5_v1h", "v1h_v24",
    "buy_share", "log_traders", "log_holders", "top_pct", "organic", "verified", "mint_ok", "freeze_ok",
]


def lg(x):
    return math.log10(x) if x and x > 0 else 0.0


def market_features(m):
    """The figures of one market row, as in FEATURES (minus the series ones)."""
    b, s = m.get("buys_1h") or 0, m.get("sells_1h") or 0
    mc, liq = m.get("mc_usd") or 0.0, m.get("liquidity_usd") or 0.0
    v5, v1, v24 = m.get("volume_5m_usd") or 0.0, m.get("volume_1h_usd") or 0.0, m.get("volume_24h_usd") or 0.0
    return {
        "chg5m": m.get("change_5m_pct") or 0.0,
        "chg1h": m.get("change_1h_pct") or 0.0,
        "chg24h": m.get("change_24h_pct") or 0.0,
        "log_mc": lg(mc),
        "log_liq": lg(liq),
        "liq_mc": liq / mc if mc > 0 else 0.0,
        "log_v5": lg(v5),
        "log_v1h": lg(v1),
        "log_v24": lg(v24),
        "v5_v1h": (v5 * 12) / v1 if v1 > 0 else 0.0,
        "v1h_v24": (v1 * 24) / v24 if v24 > 0 else 0.0,
        "buy_share": b / (b + s) if b + s > 0 else 0.5,
        "log_traders": lg(m.get("traders_1h") or 0),
        "log_holders": lg(m.get("holders") or 0),
        "top_pct": m.get("top_holders_pct") if m.get("top_holders_pct") is not None else -1.0,
        "organic": m.get("organic_score") if m.get("organic_score") is not None else -1.0,
        "verified": 1.0 if m.get("verified") else 0.0,
        "mint_ok": 1.0 if m.get("mint_authority_disabled") else 0.0,
        "freeze_ok": 1.0 if m.get("freeze_authority_disabled") else 0.0,
    }


def series_features(ts, ps, i):
    """Moves over the last 15 and 30 minutes and how jumpy the last 30 minutes were."""
    t, p = ts[i], ps[i]

    def back(sec):
        j = np.searchsorted(ts, t - sec)
        return ps[j] if j < i and abs(ts[j] - (t - sec)) <= 120 else None

    p15, p30 = back(900), back(1800)
    j = np.searchsorted(ts, t - 1800)
    w = ps[j : i + 1]
    vol = float(np.std(np.diff(np.log(w)))) if len(w) > 5 else 0.0
    return {"mom15": (p / p15 - 1) * 100 if p15 else 0.0, "mom30": (p / p30 - 1) * 100 if p30 else 0.0, "vol30": vol * 100}


def load():
    series = defaultdict(lambda: (array("q"), array("d")))
    rows = []  # (mint, t, features)
    last = {}
    files = sorted(glob.glob(f"{DATA}/*/snapshots-*.jsonl.gz"))
    for n, f in enumerate(files):
        try:
            with gzip.open(f, "rt", encoding="utf8") as g:
                for line in g:
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    t = d.get("t")
                    for m in d.get("markets") or []:
                        p = m.get("price_usd")
                        if not p or p <= 0:
                            continue
                        ts, ps = series[m["mint"]]
                        if ts and t <= ts[-1]:
                            continue
                        ts.append(t)
                        ps.append(p)
                        if t - last.get(m["mint"], 0) >= EVERY:
                            last[m["mint"]] = t
                            rows.append((m["mint"], t, market_features(m)))
        except (EOFError, OSError, zlib.error):
            pass  # a file still being written, or cut short: keep what was read
        if n % 20 == 0:
            print(f"  read {n + 1}/{len(files)} files, {len(rows):,} samples, {len(series):,} coins", flush=True)
    return series, rows


def build(series, rows):
    arr = {m: (np.frombuffer(ts, dtype=np.int64), np.frombuffer(ps, dtype=np.float64)) for m, (ts, ps) in series.items()}
    X, Y, T, M = [], [], [], []
    dropped = 0
    for mint, t, feats in rows:
        ts, ps = arr[mint]
        i = np.searchsorted(ts, t)
        if i >= len(ts) or ts[i] != t:
            continue
        j = np.searchsorted(ts, t + HORIZON, side="right")
        fut = ps[i + 1 : j]
        # Needs the price for most of the hour, through to its end.
        if len(fut) < 40 or ts[j - 1] < t + HORIZON - 300:
            dropped += 1
            continue
        p0 = ps[i]
        hi, lo, end = fut.max() / p0, fut.min() / p0, fut[-1] / p0
        feats = {**feats, **series_features(ts, ps, i)}
        X.append([feats[k] for k in FEATURES])
        Y.append([hi >= 1.10, hi >= 1.20, lo <= 0.90, lo <= 0.80, end > 1.0, end])
        T.append(t)
        M.append(mint)
    return np.array(X, dtype=np.float64), np.array(Y, dtype=np.float64), np.array(T), M, dropped


def main():
    print("reading the market board snapshots...", flush=True)
    series, rows = load()
    X, Y, T, M, dropped = build(series, rows)
    print(f"  {len(X):,} samples kept, {dropped:,} dropped (coin left the board within the hour: {dropped / max(1, dropped + len(X)) * 100:.1f}%)", flush=True)
    if len(X) < 5000:
        sys.exit("not enough samples yet")

    cut = T.max() - TEST_DAYS * 86400
    tr, te = T <= cut - HORIZON, T > cut  # an hour's gap so no outcome leaks into training
    vcut = np.quantile(T[tr], 0.85)
    fit_idx, val_idx = tr & (T <= vcut), tr & (T > vcut)
    print(f"  train {tr.sum():,} (validation {val_idx.sum():,}), test {te.sum():,} on the newest {TEST_DAYS} days", flush=True)

    params = dict(learning_rate=0.03, num_leaves=31, min_child_samples=200, colsample_bytree=0.7, subsample=0.8, subsample_freq=1, reg_lambda=2.0, verbose=-1)
    report = {"trained": datetime.now(timezone.utc).isoformat(), "samples": int(len(X)), "dropped_left_board": int(dropped), "test_days": TEST_DAYS, "horizon_s": HORIZON, "features": FEATURES, "targets": {}}
    preds = {}
    stamp = datetime.now().strftime("%Y%m%d")
    os.makedirs(OUT, exist_ok=True)
    for k, name in enumerate(TARGETS):
        y = Y[:, k]
        m = lgb.LGBMClassifier(n_estimators=2000, **params)
        m.fit(X[fit_idx], y[fit_idx], eval_set=[(X[val_idx], y[val_idx])], eval_metric="auc", callbacks=[lgb.early_stopping(100, verbose=False)])
        trees = max(50, int((m.best_iteration_ or 300) * 1.1))
        final = lgb.LGBMClassifier(n_estimators=trees, **params).fit(X[tr], y[tr])
        p = final.predict_proba(X[te])[:, 1]
        preds[name] = p
        auc = roc_auc_score(y[te], p) if len(set(y[te])) > 1 else float("nan")
        # Calibration: does "30%" come true about 30 times in 100?
        bands = []
        for lo_, hi_ in [(0, 0.1), (0.1, 0.2), (0.2, 0.3), (0.3, 0.5), (0.5, 1.01)]:
            sel = (p >= lo_) & (p < hi_)
            if sel.sum() >= 30:
                bands.append({"said": f"{int(lo_ * 100)}-{int(min(hi_, 1) * 100)}%", "coins": int(sel.sum()), "really": round(float(y[te][sel].mean()), 3)})
        report["targets"][name] = {"base_rate": round(float(y[te].mean()), 3), "auc": round(auc, 3), "calibration": bands}
        print(f"  {name:7} test AUC {auc:.3f}  base {y[te].mean() * 100:.1f}%  bands {bands}", flush=True)
        final.booster_.save_model(f"{OUT}/market_{name}_{stamp}.txt")
        final.booster_.save_model(f"{OUT}/market_{name}_latest.txt")

    # A simple rule on the unseen days: buy when the up10 chance is high and the down10
    # chance low; out at +10%, -10% or after the hour; 1% costs. When both +10% and -10%
    # were touched in the hour, it counts as the loss (cautious).
    up, dn = Y[te][:, 0] > 0, Y[te][:, 2] > 0
    res = np.where(dn, -0.10, np.where(up, 0.10, Y[te][:, 5] - 1)) - 0.01
    report["backtest"] = {}
    for name, sel in [("every sample", np.ones(len(res), bool)), ("up10 >= 40% and down10 <= 20%", (preds["up10"] >= 0.4) & (preds["down10"] <= 0.2)), ("up10 >= 50% and down10 <= 15%", (preds["up10"] >= 0.5) & (preds["down10"] <= 0.15)), ("down10 >= 50% (avoid)", preds["down10"] >= 0.5)]:
        if sel.sum():
            report["backtest"][name] = {"trades": int(sel.sum()), "avg": round(float(res[sel].mean()), 4), "win_rate": round(float((res[sel] > 0).mean()), 3)}
            print(f"  rule {name:32} trades {sel.sum():6}  avg {res[sel].mean() * 100:+.2f}%  wins {(res[sel] > 0).mean() * 100:.1f}%", flush=True)
    for name in ("market_report_latest.json", f"market_report_{stamp}.json"):
        json.dump(report, open(f"{OUT}/{name}", "w"), indent=1)
    print(f"saved to {OUT}", flush=True)


if __name__ == "__main__":
    main()
