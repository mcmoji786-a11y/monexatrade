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
