# Kixo AI

Models trained on Kixo's own on-chain data (the collector, `E:\KixoData`), on this PC.

## Setup (once)
```
python -m venv E:\KixoAI\venv
E:\KixoAI\venv\Scripts\python.exe -m pip install numpy pandas scikit-learn lightgbm pyarrow
```

## Model 1: dump / 2x from a coin's first 2 minutes
```
E:\KixoAI\venv\Scripts\python.exe ai\train_rug.py
```
Trains on the older days, tests on the newest days it never saw, and saves the models and a
report to `E:\KixoAI\models`. Retrain weekly as data grows.
Saves `dump_latest.txt`, `pump_latest.txt` and `report_latest.json` (with dated copies), and
prints a backtest of a simple rule on the unseen days (buy at 2 minutes, +100% / -40% / 1 hour,
1% cost each side).

Latest run (2026-11-14, 29,743 coins): dump AUC 0.914 (riskiest 10% dumped 52% vs 7.8%
on average), 2x AUC 0.866 (top 10% doubled 28% vs 5.4%). The simple buy rule still loses
(-3% to -6% per trade): the model is a good **danger filter**, not yet a buy signal.

## Live: the AI in the app
```
E:\KixoAI\venv\Scripts\python.exe ai\serve.py
```
Listens on 127.0.0.1:8090 (this PC only); `scripts\kixo-start.cmd` starts it too. The gateway
(`services/gateway/src/ai_risk.rs`) keeps each new coin's first 2 minutes of trades, asks the
service once, and serves `GET /ai/risk?mints=a,b`. Sol Radar cards and the trade page show
"Dump X% · 2x Y%". Admin switch: "Kixo AI risk". `features.py` is shared by training and the
service, so both compute the same numbers. Restart `serve.py` after retraining.
