@echo off
rem Makes Kixo start by itself every time you sign in to Windows (run this once).
rem It puts a small launcher in your Startup folder; no administrator rights needed.
rem To undo: kixo-autostart-remove.cmd
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
(
  echo @echo off
  echo rem Starts Kixo at sign-in. Added by kixo-autostart-install.cmd
  echo timeout /t 30 /nobreak ^>nul
  echo call "E:\Moxnexa Trade\scripts\kixo-start.cmd"
) > "%STARTUP%\Kixo.cmd"
if exist "%STARTUP%\Kixo.cmd" (
  echo Done: Kixo will start 30 seconds after you sign in.
) else (
  echo Could not write to the Startup folder.
)
echo.
echo Tip: so data keeps coming in, stop the PC from sleeping while plugged in:
echo   powercfg /change standby-timeout-ac 0
