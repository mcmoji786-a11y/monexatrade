@echo off
rem Stops the Kixo gateway and website. The data collector flushes every 5 seconds, so
rem stopping (or shutting the PC down) loses at most those seconds.
rem The watchdog first, or it would start everything again.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'kixo-watchdog.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'Kixo watchdog stopped.'"
taskkill /IM monexa-gateway.exe /F >nul 2>&1 && echo Kixo gateway stopped.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'next' -and $_.CommandLine -match 'start' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'Kixo website stopped.'"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'serve.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'Kixo AI stopped.'"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'voice.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'Kixo voice stopped.'"
powershell -NoProfile -Command "Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force; 'Kixo Brain stopped.'"
