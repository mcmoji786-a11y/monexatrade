"""Sniper rules tested on the last 24 hours of real launches (the collector's data).

Kept in memory by serve.py and refreshed every 30 minutes in the background. For each
coin it precomputes, at fixed moments after launch (CHECKPOINTS), what the sniper's
filters look at: trades, holders, the creator's share, the top 10's share, the bundle
(first-slot buyers) and the early buyers (first 3 seconds), plus the AI's two chances at
2 minutes. A rule then buys each coin at the first checkpoint, within its max age, where
every filter passes, and walks the real trades after it to the take profit, stop loss,
trailing stop or max hold. Both sides pay the rule's paper cost (impact plus fees).

What it cannot replay is said in the result (notes): the Safety score and copied symbols
come from the live site, not from the stored trades.
"""

import glob
import io
import json
import os
import threading
import time

import numpy as np
import pandas as pd

from features import FEATURES, WINDOW, features, prepare
from train_rug import ALL_TRADE_COLS, GzStream, gz_text

DATA = os.environ.get("KIXO_DATA", "E:/KixoData/live")
SPAN = 24 * 3600
REFRESH = 30 * 60
CHECKPOINTS = np.array([5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 450, 600, 900, 1800], dtype=float)
SUPPLY = 1e15  # 1 billion tokens with 6 decimals: pump.fun and the other launchpads
HOLD_CAP = 6 * 3600
COLS = ["ts", "slot", "mint", "side", "sol_lamports", "token_amount", "wallet", "v_sol", "v_tokens"]


def _read_csv(path, kind):
    s = GzStream(path)
    try:
        r = io.BufferedReader(s, 1 << 20)
        names = None
        if kind == "trades" and r.peek(3)[:3] != b"ts,":
            names = ALL_TRADE_COLS
        usecols = (lambda c: c in COLS) if kind == "trades" else None
        return pd.read_csv(r, names=names, usecols=usecols, on_bad_lines="skip", low_memory=False)
    except (pd.errors.EmptyDataError, ValueError):
        return pd.DataFrame()
    finally:
        s.close()


def _recent_days():
    days = sorted(d for d in glob.glob(f"{DATA}/*") if os.path.isdir(d))
    return days[-2:]


class Lab:
    def __init__(self, predictor):
        """`predictor(df_of_features) -> {"dump": array, "pump": array}`."""
        self.predictor = predictor
        self.coins = []
        self.window = (0, 0)
        self.loaded_at = 0.0
        self.error = None
        self.lock = threading.Lock()
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                self._load()
                self.error = None
            except Exception as e:  # keep the last good data
                self.error = str(e)[:200]
                print(f"backtest load failed: {e}", flush=True)
            time.sleep(REFRESH)

    def _load(self):
        t0 = time.time()
        days = _recent_days()
        trades = [_read_csv(f, "trades") for d in days for f in sorted(glob.glob(f"{d}/trades-*.csv.gz"))]
        coins = [_read_csv(f, "coins") for d in days for f in sorted(glob.glob(f"{d}/coins-*.csv.gz"))]
        trades = [t for t in trades if not t.empty]
        coins = [c for c in coins if not c.empty]
        if not trades or not coins:
            return
        t = pd.concat(trades, ignore_index=True)
        c = pd.concat(coins, ignore_index=True).drop_duplicates("mint").set_index("mint")
        cards = {}
        for d in days:
            for f in sorted(glob.glob(f"{d}/coin_cards-*.jsonl.gz")):
                for line in gz_text(f).decode("utf8", "ignore").splitlines():
                    try:
                        x = json.loads(line)
                        cards[x.get("mint")] = x
                    except ValueError:
                        pass
        t["token_amount"] = pd.to_numeric(t.get("token_amount"), errors="coerce").fillna(0)
        t = prepare(t.dropna(subset=["wallet", "mint"]))
        t = t.drop_duplicates(["ts", "mint", "wallet", "side", "sol_lamports"])
        end = float(t.ts.max())
        start_from = end - SPAN
        created = pd.to_numeric(c.ts, errors="coerce")
        out = []
        feats = []
        for mint, g in t.groupby("mint", sort=False):
            born = created.get(mint)
            if born is None or not (born >= start_from):
                continue
            g = g[g.ts >= born]
            if len(g) < 3:
                continue
            creator = c.creator.get(mint)
            card = cards.get(mint) or {}
            ts = (g.ts.values - born).astype(np.float32)
            price = g.price.values.astype(np.float64)
            sol = g.sol.values.astype(np.float32)
            buy = g.buy.values
            wallet_codes, wallets = pd.factorize(g.wallet.values)
            signed = np.where(buy, 1.0, -1.0) * g.token_amount.values.astype(np.float64)
            slot = g.slot.values
            first_slot = slot.min() if len(slot) else 0
            dev_code = None
            if creator is not None:
                hit = np.where(wallets == creator)[0]
                dev_code = int(hit[0]) if len(hit) else None
            cp = []
            for k in CHECKPOINTS:
                n = int(np.searchsorted(ts, k, side="right"))
                if n == 0:
                    cp.append(None)
                    continue
                bal = np.bincount(wallet_codes[:n], weights=signed[:n], minlength=len(wallets))
                pos = bal[bal > 0]
                holders = int(len(pos))
                top10 = float(np.sort(pos)[-10:].sum() / SUPPLY * 100) if holders else 0.0
                dev_pct = float(max(bal[dev_code], 0) / SUPPLY * 100) if dev_code is not None else 0.0
                first = (slot[:n] == first_slot) & buy[:n]
                if dev_code is not None:
                    first &= wallet_codes[:n] != dev_code
                bundle = float(signed[:n][first].sum() / SUPPLY * 100)
                early = (ts[:n] <= 3) & buy[:n]
                early_pct = float(signed[:n][early].sum() / SUPPLY * 100)
                cp.append((n, holders, dev_pct, top10, bundle, early_pct, float(price[n - 1])))
            meta = card.get("meta") or {}
            rep = card.get("dev_report") or {}
            coin = {
                "mint": mint,
                "symbol": str(c.symbol.get(mint, "")) if "symbol" in c.columns else "",
                "born": float(born),
                "ts": ts,
                "price": price,
                "cp": cp,
                "socials": bool(meta.get("twitter") or meta.get("telegram") or meta.get("website")),
                "rugger": (rep.get("rugged") or 0) > 0,
                "dump": None,
                "pump": None,
            }
            early_df = g[g.ts <= born + WINDOW]
            f = features(early_df, creator, str(c.launchpad.get(mint, "")), card) if len(early_df) >= 3 else None
            if f is not None:
                feats.append((len(out), f))
            out.append(coin)
        if feats:
            x = pd.DataFrame([f for _, f in feats])[FEATURES]
            preds = self.predictor(x)
            for j, (i, _) in enumerate(feats):
                out[i]["dump"] = float(preds["dump"][j])
                out[i]["pump"] = float(preds["pump"][j])
        with self.lock:
            self.coins = sorted(out, key=lambda x: x["born"])
            self.window = (start_from, end)
            self.loaded_at = time.time()
        print(f"backtest data: {len(out):,} coins from the last 24 hours, in {time.time() - t0:.0f}s", flush=True)

    def status(self):
        return {"ready": bool(self.coins), "coins": len(self.coins), "from": self.window[0], "to": self.window[1], "error": self.error}

    def run(self, r):
        with self.lock:
            coins = self.coins
            window = self.window
        if not coins:
            return {"ready": False, "error": self.error or "The last 24 hours are still loading. Try again in a minute"}

        def num(k, default=None):
            v = r.get(k, default)
            return None if v is None else float(v)

        max_age = max(5.0, min(num("maxAgeSecs", 120), CHECKPOINTS[-1]))
        min_trades, min_holders = num("minTrades"), num("minHolders")
        max_dev, max_top10, max_bundle, max_early = num("maxDevPct"), num("maxTop10Pct"), num("maxBundlePct"), num("maxEarlyBuyerPct")
        ai_dump, ai_pump = num("aiMaxDump"), num("aiMinPump")
        socials, skip_ruggers = bool(r.get("socialsRequired")), bool(r.get("skipRepeatRuggers"))
        tp, sl = num("takeProfitPct", 100) / 100, num("stopLossPct", 30) / 100
        trail = (num("trailingPct", 0) or 0) / 100
        hold = min(max(num("maxHoldMins", 30), 0.5) * 60, HOLD_CAP)
        cost = min(max(num("slippagePct", 2) / 100, 0), 0.5)
        size = max(num("sizeUsd", 25), 1)
        max_open = int(num("maxOpen", 5) or 5)
        per_hour = int(num("maxPerHour", 20) or 20)
        uses_ai = ai_dump is not None or ai_pump is not None

        entries = []
        for coin in coins:
            if socials and not coin["socials"]:
                continue
            if skip_ruggers and coin["rugger"]:
                continue
            if uses_ai and coin["dump"] is None:
                continue
            for k, c in zip(CHECKPOINTS, coin["cp"]):
                if k > max_age:
                    break
                if c is None:
                    continue
                n, holders, dev_pct, top10, bundle, early_pct, px = c
                if uses_ai and k < WINDOW:
                    continue
                if min_trades is not None and n < min_trades:
                    continue
                if min_holders is not None and holders < min_holders:
                    continue
                if max_dev is not None and dev_pct > max_dev:
                    continue
                if max_top10 is not None and top10 > max_top10:
                    continue
                if max_bundle is not None and bundle > max_bundle:
                    continue
                if max_early is not None and early_pct > max_early:
                    continue
                if ai_dump is not None and coin["dump"] * 100 > ai_dump:
                    continue
                if ai_pump is not None and coin["pump"] * 100 < ai_pump:
                    continue
                entries.append((coin["born"] + k, coin, k, px))
                break

        entries.sort(key=lambda e: e[0])
        trades, open_until, hour = [], [], []
        for at, coin, k, px in entries:
            open_until = [u for u in open_until if u > at]
            hour = [h for h in hour if h > at - 3600]
            if len(open_until) >= max_open or len(hour) >= per_hour:
                continue
            entry = px
            ts, price = coin["ts"], coin["price"]
            i = int(np.searchsorted(ts, k, side="right"))
            peak, exit_px, reason, held = entry, entry, "max hold", hold
            for j in range(i, len(ts)):
                dt = ts[j] - k
                if dt > hold:
                    break
                p = price[j]
                exit_px, held = p, dt
                if p >= entry * (1 + tp):
                    exit_px, reason = entry * (1 + tp), "take profit"
                    break
                if p <= entry * (1 - sl):
                    exit_px, reason = entry * (1 - sl), "stop loss"
                    break
                peak = max(peak, p)
                if trail > 0 and peak > entry and p <= peak * (1 - trail):
                    reason = "trailing stop"
                    break
            else:
                if len(ts) <= i:
                    reason = "no trades after the buy"
            ret = (exit_px / entry) * (1 - cost) / (1 + cost) - 1
            open_until.append(at + held)
            hour.append(at)
            trades.append({"mint": coin["mint"], "symbol": coin["symbol"], "at": at, "age_s": k, "ret": ret, "reason": reason, "held_s": float(held)})

        if not trades:
            return {"ready": True, "trades": 0, "coins": len(coins), "from": window[0], "to": window[1], "notes": NOTES}
        rets = np.array([x["ret"] for x in trades])
        pnl = rets * size
        curve, run = [], 0.0
        for x, p in zip(trades, pnl):
            run += p
            curve.append([x["at"], round(run, 2)])
        reasons = {}
        for x in trades:
            reasons[x["reason"]] = reasons.get(x["reason"], 0) + 1
        best = sorted(trades, key=lambda x: -x["ret"])[:3]
        worst = sorted(trades, key=lambda x: x["ret"])[:3]
        pick = lambda xs: [{"mint": x["mint"], "symbol": x["symbol"], "ret_pct": round(x["ret"] * 100, 1), "reason": x["reason"]} for x in xs]
        return {
            "ready": True,
            "coins": len(coins),
            "from": window[0],
            "to": window[1],
            "trades": len(trades),
            "wins": int((rets > 0).sum()),
            "win_rate": round(float((rets > 0).mean()) * 100, 1),
            "total_usd": round(float(pnl.sum()), 2),
            "spent_usd": round(size * len(trades), 2),
            "avg_pct": round(float(rets.mean()) * 100, 2),
            "best": pick(best),
            "worst": pick(worst),
            "reasons": reasons,
            "curve": curve[:: max(1, len(curve) // 200)] + ([curve[-1]] if len(curve) > 200 else []),
            "notes": NOTES,
        }


NOTES = [
    "Filters are checked at fixed moments after launch (5 s, 10 s, 15 s ... 30 min), so a buy may come a few seconds later than the live sniper's",
    "Not replayed: the Safety score and copied-symbol checks, which come from the live site",
    "Prices are the real trades of the day; a real buy of your size would move them a little more",
]
