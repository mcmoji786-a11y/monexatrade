# Kixo AI, every night: retrain on all data collected so far, then run the Strategy Lab
# so the site's "latest check" of the Auto trade rule is fresh. Installed as a Windows
# scheduled task by kixo-ai-nightly-install.cmd (04:00 every day).
#
# Training needs about 4 GB of free memory. If there is less, it waits up to an hour for
# it, then skips the night (the old models stay in use) and says so in the log.
# Log: E:\KixoData\logs\ai-nightly.log

$Root = "E:\Moxnexa Trade"
$Py = "E:\KixoAI\venv\Scripts\python.exe"
$Logs = "E:\KixoData\logs"
$Log = Join-Path $Logs "ai-nightly.log"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Write-Log($text) {
    Add-Content -Path $Log -Encoding utf8 -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text)
}

if (-not (Test-Path $Py)) { Write-Log "Kixo AI is not set up on this PC"; exit 1 }

function FreeGB { (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB }

$waited = 0
while ((FreeGB) -lt 4 -and $waited -lt 60) {
    Start-Sleep -Seconds 60
    $waited++
}
if ((FreeGB) -lt 4) {
    Write-Log ("skipped: only {0:N1} GB of memory free" -f (FreeGB))
    exit 0
}

Write-Log "training started"
& $Py "$Root\ai\train_rug.py" *> "$Logs\ai-train.log"
if ($LASTEXITCODE -ne 0) { Write-Log "training failed (old models stay): see ai-train.log"; exit 1 }
$summary = (Get-Content "$Logs\ai-train.log" | Select-String -Pattern "coins with a full first hour|DUMP:|PUMP:" | ForEach-Object { $_.Line.Trim() }) -join " | "
Write-Log "trained: $summary"

& $Py "$Root\ai\strategy_lab.py" *> "$Logs\ai-lab.log"
if ($LASTEXITCODE -ne 0) { Write-Log "strategy lab failed: see ai-lab.log"; exit 1 }
$lab = (Get-Content "$Logs\ai-lab.log" | Select-String -Pattern "current Auto trade" | Select-Object -First 1 | ForEach-Object { $_.Line.Trim() })
Write-Log "lab: $lab"
Write-Log "done; the AI service switches to the new models within a minute"
