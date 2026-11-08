@echo off
rem Stops Kixo from starting by itself at sign-in.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Kixo.cmd" >nul 2>&1
echo Kixo will no longer start at sign-in.
