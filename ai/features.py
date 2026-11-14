"""The features of a coin's first WINDOW seconds, shared by training (train_rug.py) and
the live service (serve.py) so both compute exactly the same numbers."""

import pandas as pd

WINDOW = 120  # seconds of a coin's life the model looks at
LAUNCHPADS = ["pump.fun", "letsbonk.fun", "bags", "met-dbc", "raydium-launchlab", "moonshot", "other"]


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


def features(early: pd.DataFrame, creator, launchpad, card) -> dict | None:
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
    per_wallet = buys.groupby("wallet").sol.sum()
    first_slot = early.slot.min()
    card = card or {}
    meta = card.get("meta") or {}
    rep = card.get("dev_report") or {}
    lp = launchpad if launchpad in LAUNCHPADS else "other"
    return {
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
    }


FEATURES = [
    "launchpad", "n_trades", "n_buys", "n_sells", "wallets", "buy_sol", "sell_sol", "net_sol", "max_buy_sol",
    "top_wallet_share", "dev_buy_sol", "dev_sell_sol", "first_slot_buyers", "first3s_buyers", "mc_sol",
    "price_change", "has_x", "has_tg", "has_web", "dev_coins", "dev_rugged", "dev_died_fast", "dev_graduated",
]
