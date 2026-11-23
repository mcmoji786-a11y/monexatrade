@echo off
rem Retrains Kixo AI on all data collected so far (E:\KixoData). Run it once a week.
rem Takes about 10-20 minutes and needs about 4 GB of free memory: close extra browser tabs.
rem The running AI service picks up the new models by itself within a minute (no restart).

setlocal
set ROOT=E:\Moxnexa Trade
set PY=E:\KixoAI\venv\Scripts\python.exe
set LOGS=E:\KixoData\logs
if not exist "%LOGS%" mkdir "%LOGS%"

if not exist "%PY%" (
  echo Kixo AI is not set up on this PC: see ai\README.md
  exit /b 1
)

echo Retraining Kixo AI... (log: %LOGS%\ai-train.log)
if not defined KIXO_EXTRA_DAYS set KIXO_EXTRA_DAYS=10
"%PY%" "%ROOT%\ai\train_rug.py" > "%LOGS%\ai-train.log" 2>&1
if errorlevel 1 (
  echo Training failed. The old models stay in use. See %LOGS%\ai-train.log
  exit /b 1
)
type "%LOGS%\ai-train.log"
echo.
rem The second look (5, 15 and 30 minutes) uses the wallet record train_rug.py just saved.
echo Retraining the second look... (log: %LOGS%\ai-ck-train.log)
"%PY%" "%ROOT%\ai\train_checkpoint.py" > "%LOGS%\ai-ck-train.log" 2>&1
if errorlevel 1 (
  echo Second look training failed. Its old models stay in use. See %LOGS%\ai-ck-train.log
) else (
  type "%LOGS%\ai-ck-train.log"
)
echo.
echo Done. The AI service switches to the new models within a minute.
endlocal
