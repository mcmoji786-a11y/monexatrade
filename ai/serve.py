"""Kixo AI local service: scores a coin from its first 2 minutes with the trained models.

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\serve.py
POST http://127.0.0.1:8090/predict
  {"trades": [{"ts", "slot", "sol_lamports", "v_sol", "v_tokens", "side", "wallet"}...],
   "creator": "...", "launchpad": "pump.fun", "card": {"meta": {...}, "dev_report": {...}}}
-> {"dump": 0.12, "pump": 0.31, "trades": 57}
POST http://127.0.0.1:8090/market
  {"market": {a Discover market row}, "series": [[unix_s, price], ...the last 30 minutes]}
-> {"up10": .., "up20": .., "down10": .., "down20": .., "green": ..}   (next hour, train_market.py)
POST http://127.0.0.1:8090/checkpoint
  {"ck": 900, "trades": [...the coin's trades so far...], "creator", "launchpad", "card"}
-> {"win": 0.31, "crash": 0.08, "line": 0.27, "proven": false}   (train_checkpoint.py)
GET  /health -> the models in use and their test results.
Listens on 127.0.0.1 only, so nothing outside this PC can reach it.
"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import lightgbm as lgb
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from features import WINDOW, WalletBook, checkpoint_features, features, model_columns, prepare  # noqa: E402
import numpy as np  # noqa: E402
from train_market import FEATURES as MARKET_FEATURES, TARGETS as MARKET_TARGETS, market_features, series_features  # noqa: E402

MODELS = os.environ.get("KIXO_AI", "E:/KixoAI/models")
PORT = int(os.environ.get("KIXO_AI_PORT", "8090"))
MAX_BODY = 4 << 20

boosters = {}
report = {}
book = WalletBook()
loaded_at = 0.0
checked_at = 0.0
lock = threading.Lock()


def load_models():
    """Loads the latest models, and again whenever train_rug.py writes new ones, so a
    retrain needs no restart. A half-written file keeps the models already loaded."""
    global boosters, report, loaded_at, book
    try:
        stamp = max(os.path.getmtime(f"{MODELS}/{t}_latest.txt") for t in ("dump", "pump"))
        if stamp <= loaded_at or time.time() - stamp < 10:
            return
        fresh = {t: lgb.Booster(model_file=f"{MODELS}/{t}_latest.txt") for t in ("dump", "pump")}
        try:
            rep = json.load(open(f"{MODELS}/report_latest.json"))
        except (OSError, ValueError):
            rep = {}
        boosters, report, loaded_at = fresh, rep, stamp
        book = WalletBook.load(f"{MODELS}/wallet_book.json")
        print(f"models loaded (trained {rep.get('trained', '?')})", flush=True)
    except Exception as e:  # keep serving the old models
        print(f"model reload skipped: {e}", flush=True)


market_boosters = {}
market_report = {}
market_loaded_at = 0.0


def load_market_models():
    """The established-coin models (train_market.py), reloaded when retrained. Optional:
    without them /market answers 503 and the rest keeps working."""
    global market_boosters, market_report, market_loaded_at
    try:
        stamp = max(os.path.getmtime(f"{MODELS}/market_{t}_latest.txt") for t in MARKET_TARGETS)
        if stamp <= market_loaded_at or time.time() - stamp < 10:
            return
        fresh = {t: lgb.Booster(model_file=f"{MODELS}/market_{t}_latest.txt") for t in MARKET_TARGETS}
        try:
            rep_ = json.load(open(f"{MODELS}/market_report_latest.json"))
        except (OSError, ValueError):
            rep_ = {}
        market_boosters, market_report, market_loaded_at = fresh, rep_, stamp
        print(f"market models loaded (trained {rep_.get('trained', '?')})", flush=True)
    except Exception as e:
        print(f"market models not loaded: {e}", flush=True)


def predict_market(body):
    """Next-hour chances for an established coin from its market row and its last 30
    minutes of prices, built with the same code as training."""
    m = body.get("market") or {}
    pts = sorted((int(t), float(p)) for t, p in (body.get("series") or []) if p and p > 0)
    if not m or not m.get("price_usd"):
        return None
    now = pts[-1][0] if pts else 0
    pts.append((now + 1, float(m["price_usd"])))
    # Training used one price a minute: keep the newest point per minute.
    per_min = {}
    for t, p in pts:
        per_min[t // 60] = (t, p)
    ts = np.array([v[0] for v in sorted(per_min.values())], dtype=np.int64)
    ps = np.array([v[1] for v in sorted(per_min.values())], dtype=np.float64)
    f = {**market_features(m), **series_features(ts, ps, len(ts) - 1)}
    x = np.array([[f[k] for k in MARKET_FEATURES]])
    return {k: round(float(b.predict(x)[0]), 4) for k, b in market_boosters.items()}


ck_boosters = {}
ck_report = {}
ck_loaded_at = 0.0


def load_ck_models():
    """The checkpoint models (train_checkpoint.py), reloaded when retrained. Optional:
    without them /checkpoint answers 503 and the rest keeps working."""
    global ck_boosters, ck_report, ck_loaded_at
    try:
        stamp = max(os.path.getmtime(f"{MODELS}/ck_{t}_latest.txt") for t in ("win", "crash"))
        if stamp <= ck_loaded_at or time.time() - stamp < 10:
            return
        fresh = {t: lgb.Booster(model_file=f"{MODELS}/ck_{t}_latest.txt") for t in ("win", "crash")}
        try:
            rep_ = json.load(open(f"{MODELS}/ck_report_latest.json"))
        except (OSError, ValueError):
            rep_ = {}
        ck_boosters, ck_report, ck_loaded_at = fresh, rep_, stamp
        print(f"checkpoint models loaded (trained {rep_.get('trained', '?')})", flush=True)
    except Exception as e:
        print(f"checkpoint models not loaded: {e}", flush=True)


def ck_summary():
    """What the checkpoint model proved on days it never saw, for the AI page."""
    r = ck_report
    if not r:
        return None
    return {"trained": r.get("trained"), "rule": r.get("rule"), "win": r.get("win"), "crash": r.get("crash"), "pick": r.get("pick"), "every_alive_coin": r.get("every_alive_coin"), "proven": r.get("proven"), "test_coins": r.get("test_coins")}


def predict_checkpoint(body):
    """A coin's second look at `ck` seconds, built with the same code as training."""
    ck = int(body.get("ck") or 0)
    t = pd.DataFrame(body.get("trades") or [])
    if t.empty or ck <= WINDOW:
        return None
    t = prepare(t)
    if t.empty:
        return None
    t = t[t.ts <= t.ts.iloc[0] + ck]
    f = checkpoint_features(t, ck, body.get("creator"), body.get("launchpad") or "", body.get("card"), book)
    if f is None:
        return None
    x = pd.DataFrame([f])
    out = {k: round(float(b.predict(x[model_columns(b)])[0]), 4) for k, b in ck_boosters.items()}
    pick = ck_report.get("pick") or {}
    out.update({"line": pick.get("line"), "proven": bool(ck_report.get("proven")), "holders": f["holders"], "early_still": round(f["early_still"], 3), "top10_held": round(f["top10_held"], 3), "dev_sold_frac": round(f["dev_sold_frac"], 3)})
    return out


def maybe_reload():
    global checked_at
    if time.time() - checked_at > 60:
        with lock:
            checked_at = time.time()
            load_models()
            load_market_models()
            load_ck_models()


load_models()
load_market_models()
load_ck_models()
if not boosters:
    sys.exit(f"no models in {MODELS}: run ai\\train_rug.py first")


def strategy_summary():
    """The Strategy Lab's latest check of the Copy Kixo AI rule (strategy_lab.py), both
    halves of the coins the models never saw together; None before the lab has run."""
    try:
        s = json.load(open(f"{MODELS}/strategy_latest.json"))
        cur = s["current_auto_trade"]
        halves = [h for h in (cur.get("search"), cur.get("test")) if h]
        trades = sum(h["trades"] for h in halves)
        if not trades:
            return None
        return {
            "made": s.get("made"),
            "cost_each_side": s.get("cost_each_side"),
            "trades": trades,
            "win_rate": sum(h["win_rate"] * h["trades"] for h in halves) / trades,
            "avg_return": sum(h["avg"] * h["trades"] for h in halves) / trades,
            "coins": (s.get("coins") or {}).get("unseen"),
        }
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _predict_many(x):
    maybe_reload()
    return {k: b.predict(x[model_columns(b)]) for k, b in boosters.items()}


from backtest import Lab  # noqa: E402

lab = Lab(_predict_many)


def predict(body):
    maybe_reload()
    t = pd.DataFrame(body.get("trades") or [])
    if t.empty:
        return None
    t = prepare(t)
    if t.empty:
        return None
    early = t[t.ts <= t.ts.iloc[0] + WINDOW]
    f = features(early, body.get("creator"), body.get("launchpad") or "", body.get("card"), book)
    if f is None:
        return None
    x = pd.DataFrame([f])
    out = {k: round(float(b.predict(x[model_columns(b)])[0]), 4) for k, b in boosters.items()}
    out["trades"] = int(len(early))
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/backtest/status":
            return self._send(200, lab.status())
        if self.path == "/market/health":
            return self._send(200, {"ok": bool(market_boosters), "trained": market_report.get("trained"), "targets": market_report.get("targets"), "backtest": market_report.get("backtest")})
        if self.path == "/health":
            self._send(200, {"ok": True, "window_s": WINDOW, "trained": report.get("trained"), "coins": report.get("coins"), "targets": report.get("targets"), "backtest": report.get("backtest"), "strategy": strategy_summary(), "checkpoint": ck_summary()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/predict", "/backtest", "/market", "/checkpoint"):
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("content-length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(400, {"error": "bad body"})
        if self.path == "/market":
            maybe_reload()
            if not market_boosters:
                return self._send(503, {"error": "market models not trained yet"})
            try:
                out = predict_market(json.loads(self.rfile.read(n)))
            except Exception as e:
                return self._send(400, {"error": str(e)[:200]})
            return self._send(200, out) if out else self._send(422, {"error": "no market data"})
        if self.path == "/checkpoint":
            maybe_reload()
            if not ck_boosters:
                return self._send(503, {"error": "checkpoint models not trained yet"})
            try:
                out = predict_checkpoint(json.loads(self.rfile.read(n)))
            except Exception as e:
                return self._send(400, {"error": str(e)[:200]})
            return self._send(200, out) if out else self._send(422, {"error": "quiet or too few trades"})
        if self.path == "/backtest":
            try:
                return self._send(200, lab.run(json.loads(self.rfile.read(n))))
            except Exception as e:
                return self._send(400, {"error": str(e)[:200]})
        try:
            body = json.loads(self.rfile.read(n))
            out = predict(body)
        except Exception as e:  # a bad request must never stop the service
            return self._send(400, {"error": str(e)[:200]})
        if out is None:
            return self._send(422, {"error": "not enough trades"})
        self._send(200, out)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"Kixo AI on http://127.0.0.1:{PORT} (models from {MODELS})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
