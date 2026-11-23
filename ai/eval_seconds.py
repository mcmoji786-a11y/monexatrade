"""How Kixo AI's next-minutes model (train_scalp.py) reads the next 15 and 30 seconds: on the
newest days (part of the model's unseen test days), every moment is scored with the live
models, then compared with what the price really did within 15 and 30 seconds.

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\eval_seconds.py   (KIXO_SCALP_DAYS=2 by default)
"""

import os
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

os.environ.setdefault("KIXO_SCALP_DAYS", "2")
sys.path.insert(0, os.path.dirname(__file__))
import scalp  # noqa: E402
import train_scalp  # noqa: E402
from train_rug import OUT  # noqa: E402

_base = scalp.outcome


def outcome_with_seconds(later_ts, later_price, now, p):
    o = _base(later_ts, later_price, now, p)
    for secs in (15, 30):
        seg = later_price[later_ts <= now + secs]
        o[f"hi_{secs}s"] = float(seg.max() / p) if len(seg) else 1.0
        o[f"lo_{secs}s"] = float(seg.min() / p) if len(seg) else 1.0
    return o


train_scalp.outcome = outcome_with_seconds
df = train_scalp.stream()
print(f"{len(df):,} moments, {df.mint.nunique():,} coins")
for t in ("up10_1m", "up20_2m", "down15_2m", "scalp_win"):
    b = lgb.Booster(model_file=f"{OUT}/scalp_{t}_latest.txt")
    df[f"p_{t}"] = b.predict(df[scalp.FEATURES])

rows = []
for name, sel in (
    ("every moment", df),
    ("model says hot (top 10% for +10% in 1 min)", df[df.p_up10_1m >= df.p_up10_1m.quantile(0.9)]),
    ("model says hot (top 2%)", df[df.p_up10_1m >= df.p_up10_1m.quantile(0.98)]),
    ("model says danger (top 10% for -15% in 2 min)", df[df.p_down15_2m >= df.p_down15_2m.quantile(0.9)]),
    ("model says calm (bottom 50% for -15% in 2 min)", df[df.p_down15_2m <= df.p_down15_2m.quantile(0.5)]),
):
    rows.append({
        "when": name,
        "moments": len(sel),
        "up 5% in 15 s": f"{(sel.hi_15s >= 1.05).mean():.0%}",
        "up 10% in 30 s": f"{(sel.hi_30s >= 1.10).mean():.0%}",
        "down 5% in 15 s": f"{(sel.lo_15s <= 0.95).mean():.0%}",
        "down 10% in 30 s": f"{(sel.lo_30s <= 0.90).mean():.0%}",
        "median best in 30 s": f"{(sel.hi_30s.median() - 1) * 100:+.1f}%",
    })
print(pd.DataFrame(rows).to_string(index=False))
