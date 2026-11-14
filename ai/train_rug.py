"""Kixo AI, model 1: from a coin's first 2 minutes, the chance it dumps (falls 70%+) or
doubles in the next hour. Trained on the collector's data (E:/KixoData/live), tested on
the most recent days it has never seen.

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\train_rug.py
Out:  E:\\KixoAI\\models\\rug_<date>.txt (LightGBM) + report.json
"""

import glob
import gzip
import io
import json
import os
import sys
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

DATA = os.environ.get("KIXO_DATA", "E:/KixoData/live")
OUT = os.environ.get("KIXO_AI", "E:/KixoAI/models")
WINDOW = 120  # seconds of a coin's life the model may look at
HORIZON = 3600  # seconds after that whose outcome it predicts
DUMP = 0.30  # dump: the price falls to 30% of its value at 2 minutes or lower
PUMP = 2.0  # 2x: the price reaches double


def read_gz_csv(path):
    """Collector files may end without a gzip trailer (power cut): read what is there."""
    import zlib

    raw = open(path, "rb").read()
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        text = d.decompress(raw)
    except zlib.error:
        return None
    if not text:
        return None
    return pd.read_csv(io.BytesIO(text), on_bad_lines="skip", low_memory=False)


def load(kind):
    frames = []
    for f in sorted(glob.glob(f"{DATA}/*/{kind}-*.csv.gz")):
        df = read_gz_csv(f)
        if df is not None and len(df):
            frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def load_cards():
    cards = {}
    for f in sorted(glob.glob(f"{DATA}/*/coin_cards-*.jsonl.gz")):
        import zlib

        raw = open(f, "rb").read()
        try:
            text = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(raw).decode("utf8", "ignore")
        except zlib.error:
            continue
        for line in text.splitlines():
            try:
                c = json.loads(line)
            except ValueError:
                continue
            cards[c.get("mint")] = c
    return cards


def main():
    print("loading trades...", flush=True)
    t = load("trades")
    coins = load("coins")
    cards = load_cards()
    print(f"  {len(t):,} trades, {len(coins):,} coins, {len(cards):,} cards", flush=True)

    t = t.drop_duplicates(subset=["signature", "mint", "wallet", "side"])
    for c in ["ts", "slot", "sol_lamports", "token_amount", "v_sol", "v_tokens"]:
        t[c] = pd.to_numeric(t[c], errors="coerce")
    t = t.dropna(subset=["ts", "sol_lamports", "v_sol", "v_tokens"])
    t = t[(t.v_sol > 0) & (t.v_tokens > 0)]  # bonding-curve trades carry the curve price
    t["price"] = t.v_sol / t.v_tokens
    t["sol"] = t.sol_lamports / 1e9
    t["buy"] = t.side == "buy"
    t = t.sort_values(["mint", "ts"])

    coins = coins.drop_duplicates("mint").set_index("mint")
    end_of_data = t.ts.max()

    rows = []
    for mint, g in t.groupby("mint", sort=False):
        start = g.ts.iloc[0]
        cut = start + WINDOW
        if cut + HORIZON > end_of_data:
            continue  # its hour is not over yet
        early = g[g.ts <= cut]
        later = g[(g.ts > cut) & (g.ts <= cut + HORIZON)]
        if len(early) < 3:
            continue
        p0 = early.price.iloc[-1]
        if not p0 > 0:
            continue
        lo = later.price.min() if len(later) else p0
        hi = later.price.max() if len(later) else p0
        buys = early[early.buy]
        sells = early[~early.buy]
        creator = coins.creator.get(mint) if "creator" in coins.columns else None
        dev = early[early.wallet == creator] if creator else early.iloc[0:0]
        per_wallet = buys.groupby("wallet").sol.sum()
        first_slot = early.slot.min()
        card = cards.get(mint) or {}
        meta = card.get("meta") or {}
        rep = card.get("dev_report") or {}
        rows.append(
            {
                "mint": mint,
                "start": start,
                "launchpad": str(coins.launchpad.get(mint, "")) if "launchpad" in coins.columns else "",
                "n_trades": len(early),
                "n_buys": len(buys),
                "n_sells": len(sells),
                "wallets": early.wallet.nunique(),
                "buy_sol": buys.sol.sum(),
                "sell_sol": sells.sol.sum(),
                "net_sol": buys.sol.sum() - sells.sol.sum(),
                "max_buy_sol": buys.sol.max() if len(buys) else 0.0,
                "top_wallet_share": (per_wallet.max() / per_wallet.sum()) if per_wallet.sum() > 0 else 0.0,
                "dev_buy_sol": dev[dev.buy].sol.sum(),
                "dev_sell_sol": dev[~dev.buy].sol.sum(),
                "first_slot_buyers": early[(early.slot == first_slot) & early.buy].wallet.nunique(),
                "first3s_buyers": early[(early.ts <= start + 3) & early.buy].wallet.nunique(),
                "mc_sol": p0 * 1e9,  # price x 1B tokens (pump.fun supply) in SOL
                "price_change": p0 / early.price.iloc[0] - 1,
                "has_x": int(bool(meta.get("twitter"))),
                "has_tg": int(bool(meta.get("telegram"))),
                "has_web": int(bool(meta.get("website"))),
                "dev_coins": rep.get("coins", 0),
                "dev_rugged": rep.get("rugged", 0),
                "dev_died_fast": rep.get("died_fast", 0),
                "dev_graduated": rep.get("graduated", 0),
                "dump": int(lo <= DUMP * p0),
                "pump": int(hi >= PUMP * p0),
            }
        )
    df = pd.DataFrame(rows)
    print(f"  {len(df):,} coins with a full first hour", flush=True)
    if len(df) < 500:
        print("not enough coins yet")
        sys.exit(1)

    df["launchpad"] = df.launchpad.astype("category")
    feats = [c for c in df.columns if c not in ("mint", "start", "dump", "pump")]

    # Train on the older days, test on the newest ones (as it would be used).
    df = df.sort_values("start")
    split = df.start.quantile(0.75)
    tr, te = df[df.start <= split], df[df.start > split]
    report = {
        "trained": datetime.now(timezone.utc).isoformat(),
        "coins": len(df),
        "train": len(tr),
        "test": len(te),
        "window_s": WINDOW,
        "horizon_s": HORIZON,
        "targets": {},
    }
    os.makedirs(OUT, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    for target in ("dump", "pump"):
        model = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1)
        model.fit(tr[feats], tr[target])
        p = model.predict_proba(te[feats])[:, 1]
        base = te[target].mean()
        auc = roc_auc_score(te[target], p) if te[target].nunique() > 1 else float("nan")
        order = np.argsort(-p)
        top = te[target].values[order[: max(1, len(te) // 10)]].mean()
        bottom = te[target].values[order[-max(1, len(te) // 10) :]].mean()
        imp = sorted(zip(feats, model.booster_.feature_importance("gain")), key=lambda x: -x[1])[:8]
        report["targets"][target] = {
            "base_rate": round(float(base), 4),
            "auc": round(float(auc), 4),
            "top10pct_rate": round(float(top), 4),
            "bottom10pct_rate": round(float(bottom), 4),
            "top_features": [f for f, _ in imp],
        }
        model.booster_.save_model(f"{OUT}/{target}_{stamp}.txt")
        print(
            f"\n{target.upper()}: {base:.1%} of coins in the test days."
            f"\n  model's riskiest 10%: {top:.1%}   safest 10%: {bottom:.1%}   AUC {auc:.3f}"
            f"\n  strongest signals: {', '.join(f for f, _ in imp[:5])}",
            flush=True,
        )
    with open(f"{OUT}/report_{stamp}.json", "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nsaved to {OUT}")


if __name__ == "__main__":
    main()
