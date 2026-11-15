# Kixo AI trainer: keeps the AI trained once a day without any setup. kixo-start.cmd
# starts it with the rest of Kixo, so it runs whenever the PC is on and you are signed in.
#
# Every 30 minutes it checks when the AI was last trained (E:\KixoData\ai-last-train.txt):
# - trained less than 24 hours ago: nothing to do;
# - due, and it is between 02:00 and 06:00: train now (a quiet time);
# - overdue by more than 30 hours (the PC was off at night): train now, any hour.
# Training needs the memory the platform uses, so Kixo pauses for about 30 minutes
# (kixo-stop), the AI trains and the Strategy Lab runs (kixo-ai-nightly.ps1), then Kixo
# starts again (kixo-start). The old models stay in use if anything fails.
# Log: E:\KixoData\logs\ai-nightly.log

$Root = "E:\Moxnexa Trade"
$Stamp = "E:\KixoData\ai-last-train.txt"
$Log = "E:\KixoData\logs\ai-nightly.log"
New-Item -ItemType Directory -Force -Path "E:\KixoData\logs" | Out-Null

function Write-Log($text) {
    Add-Content -Path $Log -Encoding utf8 -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text)
}

function HoursSinceTraining {
    try {
        $t = [datetime]::Parse((Get-Content -Path $Stamp -ErrorAction Stop | Select-Object -First 1).Trim())
        return ((Get-Date) - $t).TotalHours
    } catch {
        # Never trained by this job: use the model's own file time.
        $m = Get-Item "E:\KixoAI\models\dump_latest.txt" -ErrorAction SilentlyContinue
        if ($m) { return ((Get-Date) - $m.LastWriteTime).TotalHours }
        return 999
    }
}

Write-Log "trainer started"
# Let Kixo settle after the PC starts.
Start-Sleep -Seconds 600

while ($true) {
    $age = HoursSinceTraining
    $hour = (Get-Date).Hour
    $due = $age -ge 24 -and (($hour -ge 2 -and $hour -lt 6) -or $age -ge 30)
    if ($due) {
        Write-Log ("training due (last {0:N0} h ago): pausing Kixo" -f $age)
        # Keep the watchdog from bringing the platform back mid-training.
        New-Item -ItemType File -Force -Path "E:\KixoData\watchdog.pause" | Out-Null
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$Root\scripts\kixo-stop.cmd`"" -WindowStyle Hidden -Wait
        Start-Sleep -Seconds 5
        $p = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$Root\scripts\kixo-ai-nightly.ps1`"" -WindowStyle Hidden -Wait -PassThru
        if ($p.ExitCode -eq 0) {
            Set-Content -Path $Stamp -Value (Get-Date -Format "o") -Encoding utf8
        } else {
            Write-Log "training did not finish (exit $($p.ExitCode)); it will try again in a few hours"
            # Try again later, not in a loop: count this as a recent attempt minus 20 hours.
            Set-Content -Path $Stamp -Value ((Get-Date).AddHours(-20).ToString("o")) -Encoding utf8
        }
        Remove-Item -Force -Path "E:\KixoData\watchdog.pause" -ErrorAction SilentlyContinue
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$Root\scripts\kixo-start.cmd`"" -WindowStyle Hidden
        Write-Log "Kixo started again"
    }
    Start-Sleep -Seconds 1800
}
