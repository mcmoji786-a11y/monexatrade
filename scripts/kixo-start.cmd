@echo off
rem Starts Kixo on this PC: the gateway (live engine + data collector) and the website.
rem Run it by hand, or let kixo-autostart-install.cmd run it at every sign-in.
rem Logs go to E:\KixoData\logs. Closing the PC stops everything; data is safe.

setlocal
set ROOT=E:\Moxnexa Trade
set LOGS=E:\KixoData\logs
if not exist "%LOGS%" mkdir "%LOGS%"

set GW=%ROOT%\target\release\monexa-gateway.exe
if not exist "%GW%" set GW=%ROOT%\target\debug\monexa-gateway.exe

tasklist /FI "IMAGENAME eq monexa-gateway.exe" | find /I "monexa-gateway.exe" >nul
if errorlevel 1 (
  echo Starting the Kixo gateway...
  start "Kixo gateway" /MIN /D "%ROOT%" cmd /c ""%GW%" >> "%LOGS%\gateway.log" 2>&1"
) else (
  echo The Kixo gateway is already running.
)

rem Kixo AI (ai/serve.py): scores new coins from their first 2 minutes, on this PC only.
set PY=E:\KixoAI\venv\Scripts\python.exe
if exist "%PY%" (
  powershell -NoProfile -Command "try { (Invoke-WebRequest http://127.0.0.1:8090/health -UseBasicParsing -TimeoutSec 3) | Out-Null; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo Starting Kixo AI...
    start "Kixo AI" /MIN /D "%ROOT%" cmd /c ""%PY%" ai\serve.py >> "%LOGS%\ai.log" 2>&1"
  ) else (
    echo Kixo AI is already running.
  )
)

rem Give the gateway a moment, then start the website if it is not up yet.
timeout /t 8 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 5) | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Starting the Kixo website...
  start "Kixo website" /MIN /D "%ROOT%\apps\web" cmd /c "pnpm start >> "%LOGS%\web.log" 2>&1"
) else (
  echo The Kixo website is already running.
)

echo.
echo Kixo is starting. Website: http://localhost:3000
echo Data is saved to E:\KixoData  (see E:\KixoData\status.json)
endlocal
