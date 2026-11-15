# Kixo watchdog: every 10 seconds it checks the gateway, Kixo AI and the website, and
# brings back any part that stopped or stopped answering. kixo-start.cmd starts it;
# kixo-stop.cmd stops it first, so a planned stop is never undone.
#
# - A part that is down (no answer) twice in a row is started again by kixo-start.cmd,
#   which only starts what is missing.
# - A gateway that is running but has not answered /health for 30 seconds is stopped and
#   started again (a hang, not just a crash).
# - While E:\KixoData\watchdog.pause exists, it only watches (for builds and updates).
# Log: E:\KixoData\logs\watchdog.log

$Root = "E:\Moxnexa Trade"
$Logs = "E:\KixoData\logs"
$Pause = "E:\KixoData\watchdog.pause"
$Log = Join-Path $Logs "watchdog.log"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Write-Log($text) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
    Add-Content -Path $Log -Value $line -Encoding utf8
}

function Test-Url($url, $timeout) {
    try {
        $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec $timeout
        return $r.StatusCode -lt 500
    } catch {
        return $false
    }
}

$checks = @(
    @{ Name = "gateway"; Url = "http://127.0.0.1:8080/health"; Timeout = 5 },
    @{ Name = "ai"; Url = "http://127.0.0.1:8090/health"; Timeout = 5 },
    @{ Name = "website"; Url = "http://127.0.0.1:3000/"; Timeout = 15 }
)
$misses = @{ gateway = 0; ai = 0; website = 0 }
$aiInstalled = Test-Path "E:\KixoAI\venv\Scripts\python.exe"

Write-Log "watchdog started"
# Let a fresh start settle before judging anything.
Start-Sleep -Seconds 60

while ($true) {
    $restart = $false
    foreach ($c in $checks) {
        if ($c.Name -eq "ai" -and -not $aiInstalled) { continue }
        if (Test-Url $c.Url $c.Timeout) {
            if ($misses[$c.Name] -ge 2) { Write-Log "$($c.Name) answers again" }
            $misses[$c.Name] = 0
        } else {
            $misses[$c.Name]++
            if ($misses[$c.Name] -eq 2) { Write-Log "$($c.Name) not answering" }
            if ($misses[$c.Name] -ge 2) { $restart = $true }
        }
    }

    if ($restart -and -not (Test-Path $Pause)) {
        # A gateway that is still running but silent for 30 s is hung: stop it first.
        if ($misses["gateway"] -ge 3 -and (Get-Process monexa-gateway -ErrorAction SilentlyContinue)) {
            Write-Log "gateway hung: stopping it"
            Stop-Process -Name monexa-gateway -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
        Write-Log "starting the missing parts"
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$Root\scripts\kixo-start.cmd`"" -WindowStyle Hidden -Wait
        foreach ($k in @($misses.Keys)) { $misses[$k] = 0 }
        # Give what was started time to come up before checking again.
        Start-Sleep -Seconds 45
    }
    Start-Sleep -Seconds 10
}
