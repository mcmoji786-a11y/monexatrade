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

import pandas as pd

# Seconds of a coin's life the model looks at. KIXO_WINDOW lets the lab try 60 s.
WINDOW = int(os.environ.get("KIXO_WINDOW", "120"))
LAUNCHPADS = ["pump.fun", "letsbonk.fun", "bags", "met-dbc", "raydium-launchlab", "moonshot", "other"]
# A wallet counts once it has this many earlier coins on record.
MIN_RECORD = 2
WHALE_SOL = 5.0


def prepare(t: pd.DataFrame) -> pd.DataFrame:
    """Raw collector rows (or live trades) to typed rows with a price and SOL amount."""
    for c in ["ts", "slot", "sol_lamports", "token_amount", "v_sol", "v_tokens"]:
        if c in t.columns:
            t[c] = pd.to_numeric(t[c], errors="coerce")
    t = t.dropna(subset=["ts", "sol_lamports", "v_sol", "v_tokens"])
    t = t[(t.v_sol > 0) & (t.v_tokens > 0)]
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

    def save(self, path, names=None):
        """Wallets with a record worth keeping, for the live service (by address: training
        counts wallets by number, `names` turns them back)."""
        keep = {(str(names[w]) if names is not None else w): s for w, s in self.stats.items() if s[0] >= MIN_RECORD}
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
    b = early[early.buy]
    if creator:
        b = b[b.wallet != creator]
    return list(dict.fromkeys(b.wallet.tolist()))


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
    return out


FEATURES = [
    "launchpad", "n_trades", "n_buys", "n_sells", "wallets", "buy_sol", "sell_sol", "net_sol", "max_buy_sol",
    "top_wallet_share", "dev_buy_sol", "dev_sell_sol", "first_slot_buyers", "first3s_buyers", "mc_sol",
    "price_change", "has_x", "has_tg", "has_web", "dev_coins", "dev_rugged", "dev_died_fast", "dev_graduated",
    "whale_buys", "top3_share", "buy_pace", "rep_known", "rep_good", "rep_bad", "rep_pros", "rep_dbl_rate",
]


def model_columns(booster) -> list:
    """The columns a trained model expects (an older model has fewer)."""
    return list(booster.feature_name())
