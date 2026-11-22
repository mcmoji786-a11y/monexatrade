#!/usr/bin/env bash
# Builds and switches to a new release of the Kixo waitlist on the VPS (run as root by
# scripts/deploy-waitlist.ps1):  bash vps-deploy-waitlist.sh /tmp/kixo-waitlist.tgz
# The release is built here, on Linux, with the settings in /etc/kixo/waitlist.env (the
# NEXT_PUBLIC_ ones are baked in at build time). The previous release keeps serving until
# the new one is built; the last 3 releases are kept for a quick rollback.
set -euo pipefail

TGZ="${1:?usage: vps-deploy-waitlist.sh release.tgz}"
APP=/opt/kixo-waitlist
REL="$APP/releases/$(date +%Y%m%d-%H%M%S)"

command -v pnpm >/dev/null || npm install -g pnpm@12.16.1

mkdir -p "$REL"
tar -xzf "$TGZ" -C "$REL"
chown -R kixo:kixo "$REL"

cd "$REL"
# Build as the site's user, with the site's settings.
sudo -u kixo bash -c "set -a; . /etc/kixo/waitlist.env; set +a; pnpm install --frozen-lockfile && pnpm build"

# The standalone server needs its static files and public folder beside it.
cp -r "$REL/.next/static" "$REL/.next/standalone/.next/static"
cp -r "$REL/public" "$REL/.next/standalone/public"
chown -R kixo:kixo "$REL"

ln -sfn "$REL/.next/standalone" "$APP/current"
systemctl restart kixo-waitlist

# Up within 20 seconds, or say so.
for i in $(seq 1 20); do
  if curl -fsS -o /dev/null http://127.0.0.1:3100/; then
    echo "Live: release $(basename "$REL")"
    ls -1dt "$APP"/releases/* | tail -n +4 | xargs -r rm -rf
    rm -f "$TGZ"
    exit 0
  fi
  sleep 1
done
echo "The new release did not answer. Logs: journalctl -u kixo-waitlist -n 50" >&2
exit 1
