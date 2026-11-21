"""Honest check of the established-coin models (train_market.py) on coins that left the
market board within the hour, which training could not use.

Run:  E:/KixoAI/venv/Scripts/python.exe ai/market_check.py

Coins drop off Discover's board when no trending list returns them for a few minutes, so
for 7 in 10 samples the full next hour is unknown. Leaving out such coins could make the
models look better than they are, if the coins that leave are the ones that fall. Here
every sample on the newest test days is scored with the saved models, and the trade rule
is replayed with whatever is known: +10% or -10% if either was touched before the coin
left (a -10% touch counts first when both were), else the last price seen, with 1% costs.
"""
import os
import sys

import lightgbm as lgb
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from train_market import FEATURES, HORIZON, OUT, TEST_DAYS, load, series_features  # noqa: E402


def main():
    series, rows = load()
    arr = {m: (np.frombuffer(ts, dtype=np.int64), np.frombuffer(ps, dtype=np.float64)) for m, (ts, ps) in series.items()}
    up10 = lgb.Booster(model_file=f"{OUT}/market_up10_latest.txt")
    dn10 = lgb.Booster(model_file=f"{OUT}/market_down10_latest.txt")
    t_max = max(t for _, t, _ in rows)
    cut = t_max - TEST_DAYS * 86400
    X, res, full = [], [], []
    for mint, t, feats in rows:
        if t <= cut or t > t_max - HORIZON:
            continue
        ts, ps = arr[mint]
        i = np.searchsorted(ts, t)
        if i >= len(ts) or ts[i] != t:
            continue
        j = np.searchsorted(ts, t + HORIZON, side="right")
        fut = ps[i + 1 : j]
        if len(fut) == 0:
            continue
        p0 = ps[i]
        hi, lo, last = fut.max() / p0, fut.min() / p0, fut[-1] / p0
        r = -0.10 if lo <= 0.90 else 0.10 if hi >= 1.10 else last - 1
        X.append([{**feats, **series_features(ts, ps, i)}[k] for k in FEATURES])
        res.append(r - 0.01)
        full.append(len(fut) >= 40 and ts[j - 1] >= t + HORIZON - 300)
    X, res, full = np.array(X), np.array(res), np.array(full)
    pu, pd_ = up10.predict(X), dn10.predict(X)
    print(f"test samples: {len(res):,}, of which {full.mean() * 100:.0f}% have the full hour\n")
    for name, sel in [
        ("every sample", np.ones(len(res), bool)),
        ("up10 >= 40% and down10 <= 20%", (pu >= 0.4) & (pd_ <= 0.2)),
        ("up10 >= 50% and down10 <= 15%", (pu >= 0.5) & (pd_ <= 0.15)),
        ("down10 >= 50% (avoid)", pd_ >= 0.5),
    ]:
        for label, k in [("all coins", sel), ("left the board", sel & ~full), ("stayed", sel & full)]:
            if k.sum():
                print(f"{name:32} {label:15} trades {k.sum():6}  avg {res[k].mean() * 100:+.2f}%  wins {(res[k] > 0).mean() * 100:.1f}%")
        print()


if __name__ == "__main__":
    main()
