@echo off
rem Kixo control panel: double-click this file. Everything runs on this PC.
rem   1 Start    gateway, website, AI, watchdog and AI trainer
rem   2 Stop     everything
rem   3 Restart  stop, then start
rem   4 Update   after code changes: stop, build gateway and website, start
rem   5 Status   what is running
rem   6 Open     the website in the browser
rem   7 Logs     the logs folder
setlocal
set ROOT=E:\Moxnexa Trade
set RUSTUP_HOME=E:\DevTools\rustup
set CARGO_HOME=E:\DevTools\cargo
set PATH=E:\DevTools\cargo\bin;%PATH%
cd /d "%ROOT%"

:menu
cls
echo.
echo   ==========  KIXO  ==========
echo.
echo   1  Start
echo   2  Stop
echo   3  Restart
echo   4  Update (after code changes)
echo   5  Status
echo   6  Open website
echo   7  Open logs
echo   0  Exit
echo.
set "c="
set /p c=  Choose a number and press Enter:
if "%c%"=="1" goto start
if "%c%"=="2" goto stop
if "%c%"=="3" goto restart
if "%c%"=="4" goto update
if "%c%"=="5" goto status
if "%c%"=="6" goto open
if "%c%"=="7" goto logs
if "%c%"=="0" goto end
goto menu

:start
call "%ROOT%\scripts\kixo-start.cmd"
echo.
echo   Wait about 30 seconds, then open http://localhost:3000
goto done

:stop
del /q "E:\KixoData\watchdog.pause" >nul 2>&1
call "%ROOT%\scripts\kixo-stop.cmd"
goto done

:restart
call "%ROOT%\scripts\kixo-stop.cmd"
timeout /t 3 /nobreak >nul
del /q "E:\KixoData\watchdog.pause" >nul 2>&1
call "%ROOT%\scripts\kixo-start.cmd"
goto done

:update
echo.
echo   [1/4] Stopping Kixo...
call "%ROOT%\scripts\kixo-stop.cmd"
timeout /t 3 /nobreak >nul
echo.
echo   [2/4] Building the gateway (a few minutes the first time)...
cargo build -p monexa-gateway
if errorlevel 1 (
  echo.
  echo   GATEWAY BUILD FAILED. Nothing was changed: the old version starts again.
  call "%ROOT%\scripts\kixo-start.cmd"
  goto done
)
echo.
echo   [3/4] Building the website (2 to 5 minutes)...
cd /d "%ROOT%\apps\web"
call pnpm install --frozen-lockfile
call pnpm build
if errorlevel 1 (
  cd /d "%ROOT%"
  echo.
  echo   WEBSITE BUILD FAILED. Read the red lines above. Starting the last working version...
  call "%ROOT%\scripts\kixo-start.cmd"
  goto done
)
cd /d "%ROOT%"
echo.
echo   [4/4] Starting Kixo...
del /q "E:\KixoData\watchdog.pause" >nul 2>&1
call "%ROOT%\scripts\kixo-start.cmd"
echo.
echo   Update done. Open http://localhost:3000 in about 30 seconds.
goto done

:status
echo.
powershell -NoProfile -Command "foreach ($p in @(@('Gateway','http://127.0.0.1:8080/health'),@('Website','http://127.0.0.1:3000/'),@('Kixo AI','http://127.0.0.1:8090/health'))) { try { Invoke-WebRequest $p[1] -UseBasicParsing -TimeoutSec 8 | Out-Null; '  {0,-10} running' -f $p[0] } catch { '  {0,-10} NOT running' -f $p[0] } }"
if exist "E:\KixoData\watchdog.pause" echo   Note: paused for AI training. Kixo comes back by itself when it ends.
powershell -NoProfile -Command "$o=Get-CimInstance Win32_OperatingSystem; '  Free memory: {0:N1} GB' -f ($o.FreePhysicalMemory/1MB); $c=Get-PSDrive C; '  Free on C:  {0:N1} GB' -f ($c.Free/1GB)"
goto done

:open
start "" http://localhost:3000
goto menu

:logs
start "" "E:\KixoData\logs"
goto menu

:done
echo.
pause
goto menu

:end
endlocal
