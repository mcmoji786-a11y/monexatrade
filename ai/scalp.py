"""Kixo AI scalp features: a coin's last minute of trades, the same numbers in training
(train_scalp.py, from the collector's trades) and live (serve.py /scalp, from the trade
page's live book). Only what both sides have: each trade's time, SOL, buy or sell, price
(or market cap), wallet, and whether the wallet is the dev, a first-seconds sniper or a
launch bundle.

The question at each moment: from this price, what happens in the next 1, 2 and 5 minutes?
"""

import numpy as np

WINDOWS = (15, 30, 60)
WHALE_SOL = 5.0
# The scalp trade the model is judged on: take profit, stop loss, longest hold, cost.
TP, SL, HOLD, COST = 1.20, 0.90, 120, 0.01

FEATURES = [
    "age_s", "log_mc", "x_peak", "x_first", "quiet_s",
    *[f"{k}{w}" for w in WINDOWS for k in ("nb", "ns", "bsol", "ssol", "ub", "us", "chg", "rng")],
    "dev_ssol60", "snp_ssol60", "bnd_ssol60", "dev_bsol60", "whale_b60", "whale_s60", "max_b60", "max_s60",
    "net_ratio60", "buy_share30",
]


def features(ts, price, sol, buy, wallet, dev, sniper, bundler, now, age_s, mc_sol, peak, first) -> dict | None:
    """Arrays: one coin's trades up to `now` (oldest first). `price` may be any price-like
    series (only its ratios are used); `mc_sol` is the market cap in SOL now; `peak` and
    `first` are the highest and first price on the same scale as `price`."""
    if len(ts) < 3:
        return None
    p = price[-1]
    if not p > 0 or not peak > 0 or not first > 0:
        return None
    out = {
        "age_s": float(age_s),
        "log_mc": float(np.log10(max(mc_sol, 1e-6))),
        "x_peak": float(p / peak),
        "x_first": float(p / first),
        "quiet_s": float(now - ts[-1]),
    }
    for w in WINDOWS:
        m = ts > now - w
        b = m & buy
        s = m & ~buy
        pm = price[m]
        out.update({
            f"nb{w}": int(b.sum()),
            f"ns{w}": int(s.sum()),
            f"bsol{w}": float(sol[b].sum()),
            f"ssol{w}": float(sol[s].sum()),
            f"ub{w}": len(set(wallet[b].tolist())),
            f"us{w}": len(set(wallet[s].tolist())),
            # Against the last price before the window: the move within it.
            f"chg{w}": float(p / (price[~m][-1] if (~m).any() else price[0]) - 1),
            f"rng{w}": float(pm.max() / pm.min() - 1) if len(pm) and pm.min() > 0 else 0.0,
        })
    m = ts > now - 60
    s = m & ~buy
    b = m & buy
    bs, ss = float(sol[b].sum()), float(sol[s].sum())
    m30 = ts > now - 30
    out.update({
        "dev_ssol60": float(sol[s & dev].sum()),
        "snp_ssol60": float(sol[s & sniper].sum()),
        "bnd_ssol60": float(sol[s & bundler].sum()),
        "dev_bsol60": float(sol[b & dev].sum()),
        "whale_b60": int((b & (sol >= WHALE_SOL)).sum()),
        "whale_s60": int((s & (sol >= WHALE_SOL)).sum()),
        "max_b60": float(sol[b].max()) if b.any() else 0.0,
        "max_s60": float(sol[s].max()) if s.any() else 0.0,
        "net_ratio60": float((bs - ss) / (bs + ss)) if bs + ss > 0 else 0.0,
        "buy_share30": float((m30 & buy).sum() / m30.sum()) if m30.any() else 0.0,
    })
    return out


def outcome(later_ts, later_price, now, p):
    """What followed a moment: the best and worst move within 1, 2 and 5 minutes, and the
    scalp trade's result (TP first, SL first, or the price at 2 minutes), after costs."""
    o = {}
    for secs, tag in ((60, "1m"), (120, "2m"), (300, "5m")):
        m = later_ts <= now + secs
        seg = later_price[m]
        o[f"hi_{tag}"] = float(seg.max() / p) if len(seg) else 1.0
        o[f"lo_{tag}"] = float(seg.min() / p) if len(seg) else 1.0
    won, ret = 0, None
    seg = later_price[later_ts <= now + HOLD]
    for q in seg:
        if q >= TP * p:
            won, ret = 1, TP * (1 - COST) / (1 + COST) - 1
            break
        if q <= SL * p:
            ret = SL * (1 - COST) / (1 + COST) - 1
            break
    if ret is None:
        last = seg[-1] if len(seg) else p
        ret = (last / p) * (1 - COST) / (1 + COST) - 1
    o["scalp_win"] = won
    o["scalp_ret"] = float(ret)
    o["up10_1m"] = int(o["hi_1m"] >= 1.10)
    o["up20_2m"] = int(o["hi_2m"] >= 1.20)
    o["up50_5m"] = int(o["hi_5m"] >= 1.50)
    o["down15_2m"] = int(o["lo_2m"] <= 0.85)
    return o


TARGETS = ["scalp_win", "up10_1m", "up20_2m", "up50_5m", "down15_2m"]
