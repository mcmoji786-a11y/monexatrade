@echo off
rem Installs the nightly Kixo AI job: at 04:00 every day, retrain the AI on all data
rem collected so far and refresh the Strategy Lab check (scripts\kixo-ai-nightly.ps1).
rem Run once. To remove it: schtasks /Delete /TN "Kixo AI nightly" /F
schtasks /Create /TN "Kixo AI nightly" /SC DAILY /ST 04:00 /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"E:\Moxnexa Trade\scripts\kixo-ai-nightly.ps1\""
if errorlevel 1 (
  echo Could not add the task. Try running this file as administrator.
  exit /b 1
)
echo The nightly Kixo AI job is set for 04:00 every day. Log: E:\KixoData\logs\ai-nightly.log
