# Writes the waitlist's settings on the VPS (/etc/kixo/waitlist.env) from this PC's own
# files, without showing any value on screen:
#   powershell -File scripts\push-waitlist-env.ps1 -Server root@1.2.3.4 -Domain kixo.example
# Server keys come from apps/waitlist/.env.local, the public Supabase pair from
# apps/web/.env.local. SMTP lines are added when apps/waitlist/.env.local has them.
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Domain,
  [int]$Port = 22
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Read-EnvFile([string]$path) {
  $map = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content $path) {
      if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') { $map[$matches[1]] = $matches[2].Trim('"') }
    }
  }
  return $map
}

$wl = Read-EnvFile "$root\apps\waitlist\.env.local"
$web = Read-EnvFile "$root\apps\web\.env.local"
$out = [ordered]@{
  NEXT_PUBLIC_SUPABASE_URL      = $web["NEXT_PUBLIC_SUPABASE_URL"]
  NEXT_PUBLIC_SUPABASE_ANON_KEY = $web["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  SUPABASE_URL                  = $wl["SUPABASE_URL"]
  SUPABASE_SERVICE_ROLE_KEY     = $wl["SUPABASE_SERVICE_ROLE_KEY"]
  NEXT_PUBLIC_SITE_URL          = "https://$Domain"
}
foreach ($k in @("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM")) {
  if ($wl[$k]) { $out[$k] = $wl[$k] }
}
$missing = @($out.Keys | Where-Object { -not $out[$_] })
if ($missing) { throw "Missing on this PC: $($missing -join ', ')" }

$tmp = Join-Path $env:TEMP "kixo-waitlist.env"
[IO.File]::WriteAllText($tmp, (($out.Keys | ForEach-Object { "$_=$($out[$_])" }) -join "`n") + "`n")
try {
  scp -o BatchMode=yes -P $Port $tmp "${Server}:/tmp/kixo-waitlist.env"
  ssh -o BatchMode=yes -p $Port $Server "sudo install -o root -g kixo -m 640 /tmp/kixo-waitlist.env /etc/kixo/waitlist.env && rm -f /tmp/kixo-waitlist.env"
  Write-Host "Settings written on the VPS: $($out.Keys -join ', ')"
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}
