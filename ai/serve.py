"""Kixo AI local service: scores a coin from its first 2 minutes with the trained models.

Run:  E:\\KixoAI\\venv\\Scripts\\python.exe ai\\serve.py
POST http://127.0.0.1:8090/predict
  {"trades": [{"ts", "slot", "sol_lamports", "v_sol", "v_tokens", "side", "wallet"}...],
   "creator": "...", "launchpad": "pump.fun", "card": {"meta": {...}, "dev_report": {...}}}
-> {"dump": 0.12, "pump": 0.31, "trades": 57}
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
from features import FEATURES, WINDOW, features, prepare  # noqa: E402

MODELS = os.environ.get("KIXO_AI", "E:/KixoAI/models")
PORT = int(os.environ.get("KIXO_AI_PORT", "8090"))
MAX_BODY = 4 << 20

boosters = {}
report = {}
loaded_at = 0.0
checked_at = 0.0
lock = threading.Lock()


def load_models():
    """Loads the latest models, and again whenever train_rug.py writes new ones, so a
    retrain needs no restart. A half-written file keeps the models already loaded."""
    global boosters, report, loaded_at
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
        print(f"models loaded (trained {rep.get('trained', '?')})", flush=True)
    except Exception as e:  # keep serving the old models
        print(f"model reload skipped: {e}", flush=True)


def maybe_reload():
    global checked_at
    if time.time() - checked_at > 60:
        with lock:
            checked_at = time.time()
            load_models()


load_models()
if not boosters:
    sys.exit(f"no models in {MODELS}: run ai\\train_rug.py first")


def predict(body):
    maybe_reload()
    t = pd.DataFrame(body.get("trades") or [])
    if t.empty:
        return None
    t = prepare(t)
    if t.empty:
        return None
    early = t[t.ts <= t.ts.iloc[0] + WINDOW]
    f = features(early, body.get("creator"), body.get("launchpad") or "", body.get("card"))
    if f is None:
        return None
    x = pd.DataFrame([f])[FEATURES]
    out = {k: round(float(b.predict(x)[0]), 4) for k, b in boosters.items()}
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
        if self.path == "/health":
            self._send(200, {"ok": True, "window_s": WINDOW, "trained": report.get("trained"), "targets": report.get("targets"), "backtest": report.get("backtest")})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/predict":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("content-length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(400, {"error": "bad body"})
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
