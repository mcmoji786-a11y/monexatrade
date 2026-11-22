# Puts the committed Kixo waitlist on the VPS:
#   powershell -File scripts\deploy-waitlist.ps1 -Server administrator@209.209.40.179 -Port 10059
# First time only, add -Setup -Domain kixo.trade to install Node, nginx and the service.
# Sends only what is committed (git archive), never .env files; the VPS builds it with
# /etc/kixo/waitlist.env (see apps/waitlist/.env.example) and switches over. The login
# user needs sudo without a password.
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [int]$Port = 22,
  [switch]$Setup,
  [string]$Domain = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$ssh = @("-o", "BatchMode=yes", "-p", "$Port", $Server)
$scp = @("-o", "BatchMode=yes", "-P", "$Port")

if ($Setup) {
  if (-not $Domain) { throw "Setup needs -Domain" }
  scp @scp "$root\scripts\vps-setup-waitlist.sh" "${Server}:/tmp/vps-setup-waitlist.sh"
  ssh @ssh "sudo bash /tmp/vps-setup-waitlist.sh $Domain"
  if ($LASTEXITCODE -ne 0) { throw "setup failed" }
}

$dirty = git status --porcelain -- apps/waitlist
if ($dirty) { Write-Warning "apps/waitlist has changes that are not committed; they are not sent:`n$dirty" }

$tgz = Join-Path $env:TEMP "kixo-waitlist.tgz"
git archive --format=tar.gz -o $tgz HEAD:apps/waitlist
scp @scp $tgz "${Server}:/tmp/kixo-waitlist.tgz"
scp @scp "$root\scripts\vps-deploy-waitlist.sh" "${Server}:/tmp/vps-deploy-waitlist.sh"
ssh @ssh "sudo bash /tmp/vps-deploy-waitlist.sh /tmp/kixo-waitlist.tgz"
$code = $LASTEXITCODE
Remove-Item $tgz
if ($code -ne 0) { throw "deploy failed" }

# IndexNow: tell Bing (ChatGPT's search), Yandex and others the pages changed. The key is
# the 32-hex file in apps/waitlist/public (public by design, checked at /<key>.txt).
$key = (Get-ChildItem "$root\apps\waitlist\public" -Filter *.txt | Where-Object { $_.BaseName -match '^[0-9a-f]{32}$' } | Select-Object -First 1).BaseName
if ($key) {
  $body = @{ host = "kixo.trade"; key = $key; keyLocation = "https://kixo.trade/$key.txt"; urlList = @("https://kixo.trade/", "https://kixo.trade/llms.txt") } | ConvertTo-Json
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method Post "https://api.indexnow.org/indexnow" -ContentType "application/json; charset=utf-8" -Body $body
    Write-Host "IndexNow: $($r.StatusCode)"
  } catch { Write-Warning "IndexNow ping failed: $($_.Exception.Message)" }
}
