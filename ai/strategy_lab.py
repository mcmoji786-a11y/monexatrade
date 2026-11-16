"""Kixo Strategy Lab: searches for an Auto trade rule (Copy Kixo AI) that makes money after
costs, honestly.

The models were trained on the oldest 75% of coins (train_rug.py). Everything newer is
unseen. That unseen part is split in time: the first half picks the best rule (search),
the second half only checks it (test). A rule counts only if it also wins on the test
half, with enough trades.

A rule: buy at 2 minutes when the AI's crash chance <= max_dump and double chance
>= min_pump; sell at take profit, stop loss, trailing stop, or after max_hold minutes.
Each side costs COST (Kixo's fee plus price impact on a small buy).

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\strategy_lab.py
Out:  E:\\KixoAI\\models\\strategy_latest.json
"""

import itertools
import json
import os
import sys
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from features import WINDOW, model_columns, prepare  # noqa: E402
from train_rug import OUT, stream_rows  # noqa: E402

HORIZON = 3600
COST = 0.01
MIN_TRADES = 40

GRID = {
    "max_dump": [0.03, 0.05, 0.10, 0.20, 0.30],
    "min_pump": [0.0, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50],
    # Sell half at this gain (None: no early half), the rest rides the other exits.
    "half_at": [None, 0.15, 0.3, 0.5, 1.0],
    "tp": [0.15, 0.3, 0.5, 1.0, 2.0],
    "sl": [0.1, 0.2, 0.3, 0.4, 0.6],
    "trail": [0.0, 0.2, 0.3],
    "hold_min": [10, 30, 60],
}


def simulate(path_t, path_p, entry, tp, sl, trail, hold, half_at=None):
    """Return after costs for one coin: walk its prices after the entry. With `half_at`,
    half is sold at that gain and the stop on the rest moves up to the entry price."""
    peak = entry
    exit_p = path_p[-1] if len(path_p) else entry
    half = None
    stop = entry * (1 - sl)
    for t, p in zip(path_t, path_p):
        if t > hold:
            break
        exit_p = p
        if half is None and half_at is not None and p >= entry * (1 + half_at):
            half = entry * (1 + half_at)
            stop = max(stop, entry)
        if p >= entry * (1 + tp):
            exit_p = entry * (1 + tp)
            break
        if p <= stop:
            exit_p = stop
            break
        peak = max(peak, p)
        if trail > 0 and peak > entry and p <= peak * (1 - trail):
            break
    gross = exit_p / entry if half is None else 0.5 * (half / entry) + 0.5 * (exit_p / entry)
    return gross * (1 - COST) / (1 + COST) - 1


EXITS = ("tp", "sl", "trail", "hold_min", "half_at")
_cache = {}


def returns(coins, tag, ex):
    """Every coin's return under one exit rule, computed once and reused by every entry rule."""
    key = (tag, ex)
    if key not in _cache:
        tp, sl, trail, hold, half_at = ex
        _cache[key] = np.array([simulate(c["t"], c["p"], c["entry"], tp, sl, trail, hold * 60, half_at) for c in coins])
    return _cache[key]


def evaluate(coins, rule, tag):
    ex = tuple(rule[k] for k in EXITS)
    dump = np.array([c["p_dump"] for c in coins])
    pump = np.array([c["p_pump"] for c in coins])
    mask = (dump <= rule["max_dump"]) & (pump >= rule["min_pump"])
    if not mask.any():
        return None
    r = returns(coins, tag, ex)[mask]
    return {"trades": int(len(r)), "avg": float(r.mean()), "median": float(np.median(r)), "win_rate": float((r > 0).mean()), "total": float(r.sum())}


def main():
    global COST
    print("loading...", flush=True)
    # Only the newest quarter of coins is unseen by the models (train_rug.py splits at the
    # 75% point of coin start times); load trades from just before there, an hour of margin.
    # Every coin, day by day, so each wallet's record is complete; prices kept for Kixo's
    # own coins only. The models never saw Kixo's newest 75%-quarter (train_rug.py).
    df, _ = stream_rows(keep_paths=lambda src, start: src == "live")
    live = df[df.src == "live"]
    split = live.start.quantile(0.75)
    unseen = live[live.start > split].copy()
    print(f"  {len(df):,} coins, {len(unseen):,} unseen by the models", flush=True)
    del df

    for target in ("dump", "pump"):
        b = lgb.Booster(model_file=f"{OUT}/{target}_latest.txt")
        unseen[f"p_{target}"] = b.predict(unseen[model_columns(b)])

    mid = unseen.start.quantile(0.5)
    search = unseen[unseen.start <= mid].to_dict("records")
    test = unseen[unseen.start > mid].to_dict("records")
    print(f"  search on {len(search):,} coins, test on {len(test):,}", flush=True)

    results = []
    keys = list(GRID)
    for combo in itertools.product(*GRID.values()):
        rule = dict(zip(keys, combo))
        s = evaluate(search, rule, "s")
        if s and s["trades"] >= MIN_TRADES:
            results.append((rule, s))
    results.sort(key=lambda x: x[1]["avg"], reverse=True)
    print(f"  {len(results):,} rules with {MIN_TRADES}+ trades on the search half", flush=True)

    # The rule the site runs now: Copy Kixo AI (web lib/sniper.ts AI_PRESET).
    current = {"max_dump": 0.20, "min_pump": 0.20, "tp": 2.0, "sl": 0.2, "trail": 0.2, "hold_min": 10, "half_at": None}
    every = {"max_dump": 1.0, "min_pump": 0.0, "tp": 1.0, "sl": 0.4, "trail": 0.0, "hold_min": 60, "half_at": None}

    def line(name, rule):
        s, te = evaluate(search, rule, "s"), evaluate(test, rule, "t")
        fmt = lambda x: f"{x['trades']:>5} trades  win {x['win_rate']:>5.1%}  avg {x['avg']:>+6.1%}" if x else "  no trades"
        print(f"  {name:<22} search: {fmt(s)}   test: {fmt(te)}", flush=True)
        return {"rule": rule, "search": s, "test": te}

    print("\nRULES (after 1% cost each side):")
    report = {"made": datetime.now(timezone.utc).isoformat(), "cost_each_side": COST, "baseline": line("every coin", every), "current_auto_trade": line("current Auto trade", current), "top": []}
    for i, (rule, _) in enumerate(results[:10]):
        report["top"].append(line(f"best #{i + 1} {rule}", rule))

    # The pick: the best search-half rule that also wins on the test half.
    winners = [r for r in report["top"] if r["search"]["avg"] > 0 and r["test"] and r["test"]["trades"] >= MIN_TRADES // 2 and r["test"]["avg"] > 0]
    report["pick"] = winners[0] if winners else None
    print("\nPICK:", json.dumps(report["pick"]["rule"]) if report["pick"] else "none: no rule made money on both halves", flush=True)

    # Small coins cost more than 1% to enter and leave: the same rules at 2% a side.
    COST = 0.02
    _cache.clear()
    print("\nAT 2% COST A SIDE:")
    report["at_2pct"] = [line("current Auto trade", current)] + [line(f"best #{i + 1}", r["rule"]) for i, r in enumerate(report["top"][:5])]
    with open(f"{OUT}/strategy_latest.json", "w") as fh:
        json.dump(report, fh, indent=2)


if __name__ == "__main__":
    main()
