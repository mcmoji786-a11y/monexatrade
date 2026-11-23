"""The features of a coin's first WINDOW seconds, shared by training (train_rug.py), the
Strategy Lab, the 24-hour backtest and the live service (serve.py), so all of them
compute exactly the same numbers.

Besides the coin's own trades, a coin is judged by WHO bought it early: every wallet's
record on earlier coins (how many new coins it bought early, how many of those doubled,
how many crashed). Big, proven traders buying early is a different coin from known
rug-sellers buying early. The record is built strictly in time order (WalletBook): a
coin's outcome joins it only after that coin's hour is over, so no coin is ever judged
with knowledge of its own future.
"""

import heapq
import json
import os

import numpy as np
import pandas as pd

# Seconds of a coin's life the model looks at. KIXO_WINDOW lets the lab try 60 s.
WINDOW = int(os.environ.get("KIXO_WINDOW", "120"))
LAUNCHPADS = ["pump.fun", "letsbonk.fun", "bags", "met-dbc", "raydium-launchlab", "moonshot", "other"]
# A wallet counts once it has this many earlier coins on record.
MIN_RECORD = 2
WHALE_SOL = 5.0
SYSTEM_PROGRAM = "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"


def prepare(t: pd.DataFrame) -> pd.DataFrame:
    """Raw collector rows (or live trades) to typed rows with a price and SOL amount."""
    for c in ["ts", "slot", "sol_lamports", "token_amount", "v_sol", "v_tokens"]:
        if c in t.columns:
            t[c] = pd.to_numeric(t[c], errors="coerce")
    t = t.dropna(subset=["ts", "sol_lamports", "v_sol", "v_tokens"])
    t = t[(t.v_sol > 0) & (t.v_tokens > 0)]
    # The System Program shows up as a "wallet" on some decoded trades: it is no trader.
    if "wallet" in t.columns:
        t.loc[t.wallet == SYSTEM_PROGRAM, "wallet"] = None
    t["price"] = t.v_sol / t.v_tokens
    t["sol"] = t.sol_lamports / 1e9
    t["buy"] = t.side == "buy"
    return t.sort_values("ts")


class WalletBook:
    """Every wallet's record on earlier coins: [coins bought early, doubled, crashed]."""

    def __init__(self, stats=None):
        self.stats = stats or {}
        self._pending = []

    def add_later(self, ends_at, wallets, doubled, dumped):
        """A coin's outcome, to join the record once its hour is over (`ends_at`)."""
        heapq.heappush(self._pending, (ends_at, id(wallets), wallets, int(doubled), int(dumped)))

    def advance(self, now):
        """Moves every outcome whose hour ended by `now` into the record."""
        while self._pending and self._pending[0][0] <= now:
            _, _, wallets, d, x = heapq.heappop(self._pending)
            for w in wallets:
                s = self.stats.get(w)
                if s is None:
                    self.stats[w] = [1, d, x]
                else:
                    s[0] += 1
                    s[1] += d
                    s[2] += x

    def features(self, buyers):
        known = good = bad = pros = 0
        rate_sum = 0.0
        for w in buyers:
            s = self.stats.get(w)
            if not s or s[0] < MIN_RECORD:
                continue
            n, d, x = s
            known += 1
            rate_sum += (d + 0.04) / (n + 1)
            if n >= 3 and d / n >= 0.25:
                good += 1
            if n >= 3 and x / n >= 0.5:
                bad += 1
            if n >= 20:
                pros += 1
        return {
            "rep_known": known,
            "rep_good": good,
            "rep_bad": bad,
            "rep_pros": pros,
            "rep_dbl_rate": rate_sum / known if known else 0.0,
        }

    def save(self, path):
        """Wallets with a record worth keeping, for the live service."""
        keep = {w: s for w, s in self.stats.items() if s[0] >= MIN_RECORD}
        with open(path + ".tmp", "w") as fh:
            json.dump(keep, fh, separators=(",", ":"))
        os.replace(path + ".tmp", path)
        return len(keep)

    @staticmethod
    def load(path):
        try:
            with open(path) as fh:
                return WalletBook(json.load(fh))
        except (OSError, ValueError):
            return WalletBook()


def early_buyers(early: pd.DataFrame, creator) -> list:
    """Wallets that bought early, without the creator and without unknown wallets."""
    b = early[early.buy]
    if creator:
        b = b[b.wallet != creator]
    return [w for w in dict.fromkeys(b.wallet.tolist()) if isinstance(w, str) and w]


def features(early: pd.DataFrame, creator, launchpad, card, book: WalletBook | None = None) -> dict | None:
    """`early`: one coin's prepared trades within its first WINDOW seconds."""
    if len(early) < 3:
        return None
    start = early.ts.iloc[0]
    p0 = early.price.iloc[-1]
    if not p0 > 0:
        return None
    buys = early[early.buy]
    sells = early[~early.buy]
    dev = early[early.wallet == creator] if creator else early.iloc[0:0]
    per_wallet = buys.groupby("wallet", observed=True).sol.sum()
    first_slot = early.slot.min()
    card = card or {}
    meta = card.get("meta") or {}
    rep = card.get("dev_report") or {}
    lp = launchpad if launchpad in LAUNCHPADS else "other"
    out = {
        "launchpad": LAUNCHPADS.index(lp),
        "n_trades": len(early),
        "n_buys": len(buys),
        "n_sells": len(sells),
        "wallets": early.wallet.nunique(),
        "buy_sol": float(buys.sol.sum()),
        "sell_sol": float(sells.sol.sum()),
        "net_sol": float(buys.sol.sum() - sells.sol.sum()),
        "max_buy_sol": float(buys.sol.max()) if len(buys) else 0.0,
        "top_wallet_share": float(per_wallet.max() / per_wallet.sum()) if per_wallet.sum() > 0 else 0.0,
        "dev_buy_sol": float(dev[dev.buy].sol.sum()),
        "dev_sell_sol": float(dev[~dev.buy].sol.sum()),
        "first_slot_buyers": int(early[(early.slot == first_slot) & early.buy].wallet.nunique()),
        "first3s_buyers": int(early[(early.ts <= start + 3) & early.buy].wallet.nunique()),
        "mc_sol": float(p0 * 1e9),
        "price_change": float(p0 / early.price.iloc[0] - 1),
        "has_x": int(bool(meta.get("twitter"))),
        "has_tg": int(bool(meta.get("telegram"))),
        "has_web": int(bool(meta.get("website"))),
        "dev_coins": rep.get("coins", 0) or 0,
        "dev_rugged": rep.get("rugged", 0) or 0,
        "dev_died_fast": rep.get("died_fast", 0) or 0,
        "dev_graduated": rep.get("graduated", 0) or 0,
        # Big buyers: whale buys and the share of the buying the top three wallets did.
        "whale_buys": int((buys.sol >= WHALE_SOL).sum()),
        "top3_share": float(per_wallet.nlargest(3).sum() / per_wallet.sum()) if per_wallet.sum() > 0 else 0.0,
        "buy_pace": float(len(buys) / max(1.0, early.ts.iloc[-1] - start)),
    }
    out.update((book or WalletBook()).features(early_buyers(early, creator)))
    if card.get("external"):
        # Imported public data has no social links and only part of the creator record:
        # unknown, not "none", so the model does not learn a false pattern.
        nan = float("nan")
        out.update({"has_x": nan, "has_tg": nan, "has_web": nan, "dev_died_fast": nan, "dev_graduated": nan})
        if rep.get("coins") is None:
            out["dev_coins"] = nan
        if rep.get("rugged") is None:
            out["dev_rugged"] = nan
    return out


FEATURES = [
    "launchpad", "n_trades", "n_buys", "n_sells", "wallets", "buy_sol", "sell_sol", "net_sol", "max_buy_sol",
    "top_wallet_share", "dev_buy_sol", "dev_sell_sol", "first_slot_buyers", "first3s_buyers", "mc_sol",
    "price_change", "has_x", "has_tg", "has_web", "dev_coins", "dev_rugged", "dev_died_fast", "dev_graduated",
    "whale_buys", "top3_share", "buy_pace", "rep_known", "rep_good", "rep_bad", "rep_pros", "rep_dbl_rate",
]


CARD_COLS = ["has_x", "has_tg", "has_web", "dev_coins", "dev_rugged", "dev_died_fast", "dev_graduated"]


def card_features(card) -> dict:
    """Social links and the creator's record from the coin card, as `features` reads them."""
    card = card or {}
    meta = card.get("meta") or {}
    rep = card.get("dev_report") or {}
    out = {
        "has_x": int(bool(meta.get("twitter"))),
        "has_tg": int(bool(meta.get("telegram"))),
        "has_web": int(bool(meta.get("website"))),
        "dev_coins": rep.get("coins", 0) or 0,
        "dev_rugged": rep.get("rugged", 0) or 0,
        "dev_died_fast": rep.get("died_fast", 0) or 0,
        "dev_graduated": rep.get("graduated", 0) or 0,
    }
    if card.get("external"):
        nan = float("nan")
        out.update({"has_x": nan, "has_tg": nan, "has_web": nan, "dev_died_fast": nan, "dev_graduated": nan})
        if rep.get("coins") is None:
            out["dev_coins"] = nan
        if rep.get("rugged") is None:
            out["dev_rugged"] = nan
    return out


# ---------------------------------------------------------------------------------------
# Checkpoints: the AI looks at a coin again later in its life (train_checkpoint.py). By 5,
# 15 or 30 minutes most rugs have happened, and who holds the coin, whether the dev and
# the first buyers are still in, and how it trades now say far more than its first 2
# minutes. The question there: from this price, does it reach +50% before it falls 25%
# within the next hour?
# ---------------------------------------------------------------------------------------

# Seconds after the first trade when a coin is looked at again.
CHECKPOINTS = (300, 900, 1800)
# A coin counts as alive at a checkpoint when it traded within this many seconds before it.
CK_ALIVE = 120
# The trade the checkpoint model is judged on: take profit, stop loss, and at most an hour.
CK_TP, CK_SL, CK_HOLD = 1.5, 0.75, 3600


def checkpoint_features(g: pd.DataFrame, ck: int, creator, launchpad, card, book: "WalletBook | None" = None, with_buyers: bool = False) -> dict | None:
    """`g`: one coin's prepared trades from its first trade up to `ck` seconds after it.
    None when the coin is too thin to judge or has gone quiet."""
    if len(g) < 10:
        return None
    ts = g.ts.values.astype("float64")
    price = g.price.values.astype("float64")
    sol = g.sol.values.astype("float64")
    buy = g.buy.values.astype(bool)
    wallet = g.wallet.values
    start = ts[0]
    cut = start + ck
    if ts[-1] < cut - CK_ALIVE:
        return None
    p = price[-1]
    if not p > 0:
        return None
    in2 = ts <= start + WINDOW
    p2 = price[in2][-1] if in2.any() else price[0]
    hi = price.max()
    lo_after2 = price[~in2].min() if (~in2).any() else p2

    def window(secs):
        m = ts > cut - secs
        b = m & buy
        s = m & ~buy
        first = price[m][0] if m.any() else p
        wb = wallet[b]
        return {
            f"t{secs}": int(m.sum()),
            f"b{secs}": int(b.sum()),
            f"s{secs}": int(s.sum()),
            f"net{secs}": float(sol[b].sum() - sol[s].sum()),
            f"vol{secs}": float(sol[m].sum()),
            f"buyers{secs}": len({w for w in wb if isinstance(w, str) and w}),
            f"chg{secs}": float(p / first - 1) if first > 0 else 0.0,
            f"range{secs}": float(price[m].max() / price[m].min() - 1) if m.any() and price[m].min() > 0 else 0.0,
        }

    # Who holds it now: each wallet's net tokens (SOL / price per trade), in relative units.
    tokens = sol / np.where(price > 0, price, np.nan)
    signed = np.where(buy, tokens, -tokens)
    ok = np.array([isinstance(w, str) and bool(w) for w in wallet])
    pos = pd.Series(signed[ok]).groupby(wallet[ok]).sum()
    bought = pd.Series(np.where(buy, tokens, 0.0)[ok]).groupby(wallet[ok]).sum()
    held = pos[pos > bought * 0.02]
    total = float(held.sum()) if len(held) else 0.0
    top10 = float(held.nlargest(10).sum() / total) if total > 0 else 0.0
    top1 = float(held.max() / total) if total > 0 else 0.0
    dev_buy = float(sol[buy & (wallet == creator)].sum()) if creator else 0.0
    dev_sell = float(sol[~buy & (wallet == creator)].sum()) if creator else 0.0
    dev_hold = float(held.get(creator, 0.0) / total) if creator and total > 0 else 0.0
    # The first 2 minutes' buyers: how many still hold, and how much of the coin they hold.
    early = [w for w in dict.fromkeys(wallet[in2 & buy & ok]) if w != creator]
    early_held = [w for w in early if w in held.index]
    early_share = float(held[early_held].sum() / total) if total > 0 and early_held else 0.0
    r300 = ts > cut - 300

    out = {
        "ck": ck,
        "launchpad": LAUNCHPADS.index(launchpad if launchpad in LAUNCHPADS else "other"),
        "mc_sol": float(p * 1e9),
        "x_first": float(p / price[0]) if price[0] > 0 else 0.0,
        "x_2m": float(p / p2) if p2 > 0 else 0.0,
        "x_peak": float(p / hi) if hi > 0 else 0.0,
        "x_low": float(p / lo_after2) if lo_after2 > 0 else 0.0,
        "n_trades": len(g),
        "n_buys": int(buy.sum()),
        "n_sells": int((~buy).sum()),
        "traders": int(pos.size),
        "buy_sol": float(sol[buy].sum()),
        "sell_sol": float(sol[~buy].sum()),
        "holders": int(held.size),
        "top10_held": top10,
        "top1_held": top1,
        "dev_buy_sol": dev_buy,
        "dev_sold_frac": float(min(1.0, dev_sell / dev_buy)) if dev_buy > 0 else (1.0 if dev_sell > 0 else 0.0),
        "dev_held": dev_hold,
        "early_buyers": len(early),
        "early_still": float(len(early_held) / len(early)) if early else 0.0,
        "early_share": early_share,
        "quiet_s": float(cut - ts[-1]),
        "whales300": int((buy & r300 & (sol >= WHALE_SOL)).sum()),
    }
    for secs in (60, 300):
        out.update(window(secs))
    out.update(card_features(card))
    buyers = early_buyers(g, creator)
    recent = [w for w in dict.fromkeys(wallet[r300 & buy & ok]) if w != creator]
    if with_buyers:
        out["_buyers"], out["_recent"] = buyers, recent
    else:
        out.update(rep_features(book, buyers, recent))
    return out


def rep_features(book: "WalletBook | None", buyers, recent) -> dict:
    """The wallet record of everyone who bought so far, and of the last 5 minutes' buyers."""
    book = book or WalletBook()
    a = book.features(buyers)
    r = book.features(recent)
    return {**a, "rec_good": r["rep_good"], "rec_bad": r["rep_bad"], "rec_pros": r["rep_pros"], "rec_dbl_rate": r["rep_dbl_rate"]}


CK_FEATURES = [
    "ck", "launchpad", "mc_sol", "x_first", "x_2m", "x_peak", "x_low", "n_trades", "n_buys", "n_sells", "traders",
    "buy_sol", "sell_sol", "holders", "top10_held", "top1_held", "dev_buy_sol", "dev_sold_frac", "dev_held",
    "early_buyers", "early_still", "early_share", "quiet_s", "whales300",
    "t60", "b60", "s60", "net60", "vol60", "buyers60", "chg60", "range60",
    "t300", "b300", "s300", "net300", "vol300", "buyers300", "chg300", "range300",
    *CARD_COLS,
    "rep_known", "rep_good", "rep_bad", "rep_pros", "rep_dbl_rate", "rec_good", "rec_bad", "rec_pros", "rec_dbl_rate",
]


def ck_outcome(later_prices, entry, cost):
    """From `entry`: (reached +50% before -25%, crashed to half, the trade's return after
    costs) over the prices that follow within the hour."""
    won, ret = 0, None
    for q in later_prices:
        if q >= CK_TP * entry:
            won, ret = 1, CK_TP * (1 - cost) / (1 + cost) - 1
            break
        if q <= CK_SL * entry:
            ret = CK_SL * (1 - cost) / (1 + cost) - 1
            break
    if ret is None:
        last = later_prices[-1] if len(later_prices) else entry
        ret = (last / entry) * (1 - cost) / (1 + cost) - 1
    crashed = int(len(later_prices) > 0 and min(later_prices) <= 0.5 * entry)
    return won, crashed, float(ret)


def model_columns(booster) -> list:
    """The columns a trained model expects (an older model has fewer)."""
    return list(booster.feature_name())
