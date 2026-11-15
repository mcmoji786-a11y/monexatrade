@echo off
rem Opens the Kixo admin at its secret address and copies the admin key to the clipboard
rem (paste it with Ctrl+V on the admin page). Nothing is printed on screen.
rem The address is ADMIN_PATH in apps\web\.env.local; the key is ADMIN_TOKEN in .env.
powershell -NoProfile -Command ^
  "$root='E:\Moxnexa Trade';" ^
  "$p=(Select-String -Path \"$root\apps\web\.env.local\" -Pattern '^ADMIN_PATH=(.+)$').Matches.Groups[1].Value.Trim();" ^
  "$k=(Select-String -Path \"$root\.env\" -Pattern '^ADMIN_TOKEN=(.+)$').Matches.Groups[1].Value.Trim();" ^
  "if (-not $p -or -not $k) { 'Admin is not set up: ADMIN_PATH or ADMIN_TOKEN missing'; exit 1 };" ^
  "Set-Clipboard -Value $k;" ^
  "Start-Process \"http://localhost:3000/$p\";" ^
  "'Admin opened. The admin key is on the clipboard: paste it with Ctrl+V.'"
