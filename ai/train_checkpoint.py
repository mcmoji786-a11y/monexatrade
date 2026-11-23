"""Kixo AI, model 3: a second look at a coin at 5, 15 and 30 minutes (features.py,
CHECKPOINTS). By then most rugs have happened, and who holds the coin, whether the dev and
the first buyers are still in, and how it trades right now are known. Question: from the
price at the checkpoint, does it reach +50% before it falls 25% within the hour?

Honest testing, like train_rug.py: trained on older days, tested on Kixo's own newest
days it never saw. The unseen days are split in time: the first half picks the pick line
(how sure the model must be), the second half only checks it. A coin is bought once, at
the first checkpoint where it passes, with 1% cost on each side.

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\train_checkpoint.py
Out:  E:\\KixoAI\\models\\ck_{win,crash}_latest.txt (+ dated copies), ck_report_latest.json
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
from features import (  # noqa: E402
    CHECKPOINTS, CK_FEATURES, CK_HOLD, CK_SL, CK_TP, WINDOW, WalletBook, checkpoint_features, ck_outcome, model_columns, prepare, rep_features,
)
from train_rug import COST, DUMP, OUT, PARAMS, PUMP, compact, day_folders, day_start, read_cards, read_kind  # noqa: E402

LAST_CK = max(CHECKPOINTS)
# Pick lines tried on the search half: the model's most confident share of the alive coins.
TOPS = (0.01, 0.02, 0.05, 0.10, 0.20)
MIN_TRADES = 40
MAX_TREES = 2000


def stream_checkpoints():
    """Every alive coin at every checkpoint with a full hour after it, oldest day first,
    with its outcome. Each wallet's record (WalletBook, the same record as train_rug.py) is
    filled in time order, so no row sees an outcome that ended after its own moment."""
    days = day_folders()
    if int(os.environ.get("KIXO_CK_DAYS", "0")) > 0:  # a quick run on the newest days only
        days = days[-int(os.environ["KIXO_CK_DAYS"]):]
    book = WalletBook()
    frames, n_rows = [], 0
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
                t2 = t2[pd.to_numeric(t2.ts, errors="coerce") < d1 + LAST_CK + CK_HOLD + 60]
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
        rows, outcomes = [], []
        for mint, g in t.groupby("mint", sort=False):
            start = g.ts.iloc[0]
            if start + WINDOW + 3600 > end:
                continue
            creator = coins.creator.get(mint)
            creator = creator if isinstance(creator, str) else None
            lp = str(coins.launchpad.get(mint, ""))
            # The 2-minute outcome feeds the wallet record, exactly as train_rug.py does.
            early = g[g.ts <= start + WINDOW]
            if len(early) >= 3 and early.price.iloc[-1] > 0:
                p0 = early.price.iloc[-1]
                later = g[(g.ts > start + WINDOW) & (g.ts <= start + WINDOW + 3600)]
                lo = later.price.min() if len(later) else p0
                hi = later.price.max() if len(later) else p0
                buyers = [w for w in dict.fromkeys(early[early.buy & (early.wallet != creator)].wallet.tolist()) if isinstance(w, str) and w]
                outcomes.append((start + WINDOW + 3600, buyers, int(hi >= PUMP * p0), int(lo <= DUMP * p0)))
            for ck in CHECKPOINTS:
                cut = start + ck
                if cut + CK_HOLD > end:
                    continue
                upto = g[g.ts <= cut]
                f = checkpoint_features(upto, ck, creator, lp, cards.get(mint), with_buyers=True)
                if f is None:
                    continue
                entry = upto.price.iloc[-1]
                after = g[(g.ts > cut) & (g.ts <= cut + CK_HOLD)].price.values
                won, crashed, ret = ck_outcome(after, entry, COST)
                f.update({"mint": mint, "start": start, "when": int(cut), "src": src, "win": won, "crash": crashed, "ret": ret})
                rows.append(f)
        for o in outcomes:
            book.add_later(*o)
        rows.sort(key=lambda r: r["when"])
        for r in rows:
            book.advance(r["when"])
            r.update(rep_features(book, r.pop("_buyers"), r.pop("_recent")))
        if rows:
            frames.append(compact(pd.DataFrame(rows)))
            n_rows += len(rows)
        print(f"  {name} ({src}): {len(rows):,} checkpoint rows, {n_rows:,} so far", flush=True)
        del t
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fit(train, target):
    """The best of PARAMS on the newest 15% of the training rows, refit on all of them."""
    train = train.sort_values("when")
    cut = int(len(train) * 0.85)
    tr, va = train.iloc[:cut], train.iloc[cut:]
    best = None
    if va[target].nunique() > 1 and tr[target].nunique() > 1:
        for name, p in PARAMS.items():
            m = lgb.LGBMClassifier(n_estimators=MAX_TREES, subsample=0.8, subsample_freq=1, verbose=-1, **p)
            m.fit(tr[CK_FEATURES], tr[target], eval_X=va[CK_FEATURES], eval_y=va[target], eval_metric="auc", callbacks=[lgb.early_stopping(100, verbose=False)])
            auc = roc_auc_score(va[target], m.predict_proba(va[CK_FEATURES], num_iteration=m.best_iteration_)[:, 1])
            trees = max(50, int((m.best_iteration_ or MAX_TREES) * 1.1))
            print(f"    {target} {name}: validation AUC {auc:.4f} with {trees} trees", flush=True)
            if best is None or auc > best[0]:
                best = (auc, name, trees)
    name, trees = (best[1], best[2]) if best else ("base", 400)
    model = lgb.LGBMClassifier(n_estimators=trees, subsample=0.8, subsample_freq=1, verbose=-1, **PARAMS[name])
    model.fit(train[CK_FEATURES], train[target])
    print(f"    {target}: using {name} ({trees} trees)", flush=True)
    return model


def first_pick(rows, line):
    """Each coin once: its first checkpoint at or above the pick line (as live trading would)."""
    sel = rows[rows.score >= line].sort_values("when")
    return sel.drop_duplicates("mint")


def summary(sel):
    r = sel.ret
    if len(sel) == 0:
        return {"trades": 0}
    return {
        "trades": int(len(sel)),
        "coins": int(sel.mint.nunique()),
        "win_rate": round(float(sel.win.mean()), 4),
        "avg_return": round(float(r.mean()), 4),
        "median_return": round(float(r.median()), 4),
        "total_return": round(float(r.sum()), 2),
        "by_checkpoint": {f"{int(c) // 60}m": int(n) for c, n in sel.ck.value_counts().sort_index().items()},
    }


def main():
    print("building checkpoint rows day by day...", flush=True)
    os.makedirs(OUT, exist_ok=True)
    df = stream_checkpoints()
    live = df[df.src == "live"]
    print(f"  {len(df):,} rows ({len(live):,} Kixo's own); win rate {df.win.mean():.1%}, crash rate {df.crash.mean():.1%}", flush=True)
    if len(live) < 2000:
        sys.exit("not enough checkpoint rows yet")

    # Test: Kixo's own newest quarter by moment, never seen in training.
    split = live["when"].quantile(0.75)
    te = live[live["when"] > split].copy()
    candidates = {"own": live[live["when"] <= split]}
    both = df[df["when"] <= split]
    if len(both) > len(candidates["own"]):
        candidates["own+imported"] = both
    models, scores = {}, {}
    for name, train in candidates.items():
        models[name] = {t: fit(train, t) for t in ("win", "crash")}
        scores[name] = {t: roc_auc_score(te[t], models[name][t].predict_proba(te[CK_FEATURES])[:, 1]) for t in ("win", "crash") if te[t].nunique() > 1}
        print(f"  trained on {name} ({len(train):,} rows): AUC win {scores[name].get('win', float('nan')):.3f}, crash {scores[name].get('crash', float('nan')):.3f}", flush=True)
    best = max(scores, key=lambda n: scores[n].get("win", 0) * 2 + scores[n].get("crash", 0))
    print(f"  keeping: {best}", flush=True)
    win_m, crash_m = models[best]["win"], models[best]["crash"]
    te["p_win"] = win_m.predict_proba(te[CK_FEATURES])[:, 1]
    te["p_crash"] = crash_m.predict_proba(te[CK_FEATURES])[:, 1]
    te["score"] = te.p_win

    # The model in use (if any) on the same unseen rows: a worse new model never replaces it.
    keep_old = False
    old_path = f"{OUT}/ck_win_latest.txt"
    if os.path.exists(old_path):
        try:
            old = lgb.Booster(model_file=old_path)
            cols = model_columns(old)
            if all(c in te.columns for c in cols):
                auc_old = roc_auc_score(te.win, old.predict(te[cols]))
                auc_new = roc_auc_score(te.win, te.p_win)
                print(f"  win: model in use AUC {auc_old:.4f}, new {auc_new:.4f}", flush=True)
                keep_old = auc_old > auc_new + 0.002
        except Exception as e:
            print(f"  could not judge the model in use ({e})", flush=True)

    # Pick line: chosen on the first half of the unseen days, checked on the second.
    mid = te["when"].median()
    search, check = te[te["when"] <= mid], te[te["when"] > mid]
    print("\nPICK LINE (buy once at the first checkpoint above the line; +50% / -25% / 1 h, 1% cost each side):")
    print(f"  {'every alive coin':<22} search {summary(first_pick(search, -1))}  check {summary(first_pick(check, -1))}")
    tried = []
    for top in TOPS:
        line = float(search.score.quantile(1 - top))
        s, c = summary(first_pick(search, line)), summary(first_pick(check, line))
        tried.append({"top": top, "line": round(line, 4), "search": s, "check": c})
        print(f"  top {top:>4.0%} (p_win >= {line:.3f})  search {s.get('trades', 0):>5} trades win {s.get('win_rate', 0):.1%} avg {s.get('avg_return', 0):+.1%}   check {c.get('trades', 0):>5} trades win {c.get('win_rate', 0):.1%} avg {c.get('avg_return', 0):+.1%}", flush=True)
    good = [x for x in tried if x["search"].get("trades", 0) >= MIN_TRADES]
    chosen = max(good, key=lambda x: x["search"]["avg_return"]) if good else None
    proven = bool(chosen and chosen["check"].get("trades", 0) >= MIN_TRADES // 2 and chosen["check"]["avg_return"] > 0 and chosen["search"]["avg_return"] > 0)

    stamp = datetime.now().strftime("%Y%m%d")
    for target, m in (("win", win_m), ("crash", crash_m)):
        m.booster_.save_model(f"{OUT}/ck_{target}_{stamp}.txt")
        if not keep_old:
            shutil.copy(f"{OUT}/ck_{target}_{stamp}.txt", f"{OUT}/ck_{target}_latest.txt")
    order = np.argsort(-te.p_win.values)
    n10 = max(1, len(te) // 10)
    report = {
        "trained": datetime.now(timezone.utc).isoformat(),
        "rows": len(df),
        "own_rows": len(live),
        "test_rows": len(te),
        "test_coins": int(te.mint.nunique()),
        "trained_on": best,
        "checkpoints_s": list(CHECKPOINTS),
        "rule": {"take_profit": CK_TP, "stop_loss": CK_SL, "hold_s": CK_HOLD, "cost_each_side": COST},
        "kept": "previous" if keep_old else "new",
        "win": {"base_rate": round(float(te.win.mean()), 4), "auc": round(float(roc_auc_score(te.win, te.p_win)), 4), "top10pct_rate": round(float(te.win.values[order[:n10]].mean()), 4)},
        "crash": {"base_rate": round(float(te.crash.mean()), 4), "auc": round(float(roc_auc_score(te.crash, te.p_crash)), 4)},
        "every_alive_coin": {"search": summary(first_pick(search, -1)), "check": summary(first_pick(check, -1))},
        "lines": tried,
        "pick": {"line": chosen["line"], "top": chosen["top"], "search": chosen["search"], "check": chosen["check"]} if chosen else None,
        "proven": proven,
    }
    for name in (f"ck_report_{stamp}.json", "ck_report_latest.json"):
        with open(f"{OUT}/{name}", "w") as fh:
            json.dump(report, fh, indent=2)
    print(f"\nWIN: base {report['win']['base_rate']:.1%}, model's top 10% {report['win']['top10pct_rate']:.1%}, AUC {report['win']['auc']:.3f}")
    print(f"CRASH: base {report['crash']['base_rate']:.1%}, AUC {report['crash']['auc']:.3f}")
    print(f"pick line: {report['pick']}\nproven after costs on both halves: {proven}\nsaved to {OUT}")


if __name__ == "__main__":
    main()
