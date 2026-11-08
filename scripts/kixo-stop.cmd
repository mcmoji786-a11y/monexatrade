@echo off
rem Stops the Kixo gateway and website. The data collector flushes every 5 seconds, so
rem stopping (or shutting the PC down) loses at most those seconds.
taskkill /IM monexa-gateway.exe /F >nul 2>&1 && echo Kixo gateway stopped.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'next' -and $_.CommandLine -match 'start' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'Kixo website stopped.'"
