# Puts the committed Kixo waitlist on the VPS:
#   powershell -File scripts\deploy-waitlist.ps1 -Server root@1.2.3.4
# First time only, add -Setup -Domain kixo.example to install Node, nginx and the service.
# Sends only what is committed (git archive), never .env files; the VPS builds it with
# /etc/kixo/waitlist.env (see apps/waitlist/.env.example) and switches over.
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [switch]$Setup,
  [string]$Domain = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Setup) {
  if (-not $Domain) { throw "Setup needs -Domain" }
  scp "$root\scripts\vps-setup-waitlist.sh" "${Server}:/tmp/vps-setup-waitlist.sh"
  ssh $Server "bash /tmp/vps-setup-waitlist.sh $Domain"
}

$dirty = git status --porcelain -- apps/waitlist
if ($dirty) { Write-Warning "apps/waitlist has changes that are not committed; they are not sent:`n$dirty" }

$tgz = Join-Path $env:TEMP "kixo-waitlist.tgz"
git archive --format=tar.gz -o $tgz HEAD:apps/waitlist
scp $tgz "${Server}:/tmp/kixo-waitlist.tgz"
scp "$root\scripts\vps-deploy-waitlist.sh" "${Server}:/tmp/vps-deploy-waitlist.sh"
ssh $Server "bash /tmp/vps-deploy-waitlist.sh /tmp/kixo-waitlist.tgz"
Remove-Item $tgz
