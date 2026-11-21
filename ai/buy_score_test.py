"""Does the Kixo Buy Score tell good buys from bad ones?

Run: E:/KixoAI/venv/Scripts/python.exe ai/buy_score_test.py

For every coin Kixo AI scored (data/ai_outcomes.jsonl), the score is computed as the
gateway does it (ai_risk.rs similar_stats: the 150 past coins with the closest AI scores,
their average trade result), using ONLY coins whose hour had already ended before this
coin was scored, so the answer is never peeked at. Then the score is compared with what
really happened to the coin.

Trade result (rough, cautious; ai_risk.rs trade_result): crashed 70%+ -> -40% (stop loss,
even if it rose first), else rose 50% -> +50% (take profit), else 0; minus 2% costs.
Good buy: rose 50% or more within the hour without crashing.
"""
import json
import numpy as np

rows = [json.loads(l) for l in open("E:/Moxnexa Trade/data/ai_outcomes.jsonl", encoding="utf8") if l.strip()]
rows = [r for r in rows if r.get("high_x", 0) > 0 and r.get("low_x", 0) > 0]
rows.sort(key=lambda r: r["at"])
at = np.array([r["at"] for r in rows])
d = np.sqrt(np.array([r["dump"] for r in rows]))
p = np.sqrt(np.array([r["pump"] for r in rows]))
good = np.array([(r["high_x"] >= 1.5) and not r["dumped"] for r in rows])
crash = np.array([r["dumped"] for r in rows])
ret = np.where(crash, -0.40, np.where(np.array([r["high_x"] >= 1.5 for r in rows]), 0.50, 0.0)) - 0.02
N, WARM = 150, 1500

scores = np.full(len(rows), np.nan)
for i in range(len(rows)):
    known = np.nonzero(at < at[i] - 3600)[0]
    if len(known) < WARM:
        continue
    dist = (d[known] - d[i]) ** 2 + (p[known] - p[i]) ** 2
    near = known[np.argpartition(dist, N)[:N]]
    scores[i] = ret[near].mean() * 100  # expected trade result of the closest past coins

m = ~np.isnan(scores)
s, g, c, r = scores[m], good[m], crash[m], ret[m]
print(f"coins tested: {m.sum()} (of {len(rows)}; the first ones only build the history)")
print(f"every coin: good buy {g.mean()*100:.1f}%  crashed {c.mean()*100:.1f}%  avg trade {r.mean()*100:+.1f}%\n")
print("expected result   coins   good buy   crashed   real avg trade   trades in profit")
for lo, hi in [(-99, -10), (-10, -5), (-5, -2), (-2, 0), (0, 2), (2, 5), (5, 99)]:
    k = (s >= lo) & (s < hi)
    if k.sum():
        print(f"  {lo:>4} to {hi:<4}%  {k.sum():>6}    {g[k].mean()*100:5.1f}%    {c[k].mean()*100:5.1f}%      {r[k].mean()*100:+6.1f}%          {(r[k] > 0).mean()*100:5.1f}%")
for cut in (-2, 0, 2):
    k = s >= cut
    print(f"buy when expected >= {cut}%: {k.sum()} coins, real avg trade {r[k].mean()*100:+.1f}%, good {g[k].mean()*100:.1f}%, crashed {c[k].mean()*100:.1f}%")
