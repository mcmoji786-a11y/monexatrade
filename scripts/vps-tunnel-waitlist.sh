#!/usr/bin/env bash
# Connects kixo.trade to the waitlist through a Cloudflare Tunnel (the VPS sits behind a
# shared IP, so nothing can reach it on ports 80/443 directly). Run as the login user,
# after `cloudflared tunnel login` has authorised this server:
#   bash vps-tunnel-waitlist.sh kixo.trade
# The tunnel dials out to Cloudflare, which serves https for the domain and sends visitors
# to the site on 127.0.0.1:3100. Runs as a system service.
set -euo pipefail
DOMAIN="${1:?usage: vps-tunnel-waitlist.sh domain}"
NAME=kixo-waitlist

[ -f "$HOME/.cloudflared/cert.pem" ] || { echo "Authorise first: cloudflared tunnel login"; exit 1; }

if ! cloudflared tunnel info "$NAME" >/dev/null 2>&1; then
  cloudflared tunnel create "$NAME"
fi
ID="$(cloudflared tunnel list -o json | python3 -c "import json,sys; print(next(t['id'] for t in json.load(sys.stdin) if t['name']=='$NAME'))")"

# The domain and www point at the tunnel (CNAME records in Cloudflare).
cloudflared tunnel route dns --overwrite-dns "$NAME" "$DOMAIN"
cloudflared tunnel route dns --overwrite-dns "$NAME" "www.$DOMAIN"

sudo mkdir -p /etc/cloudflared
sudo install -m 600 "$HOME/.cloudflared/$ID.json" "/etc/cloudflared/$ID.json"
sudo tee /etc/cloudflared/config.yml >/dev/null <<YML
tunnel: $ID
credentials-file: /etc/cloudflared/$ID.json
ingress:
  - hostname: $DOMAIN
    service: http://127.0.0.1:3100
  - hostname: www.$DOMAIN
    service: http://127.0.0.1:3100
  - service: http_status:404
YML

if ! systemctl list-unit-files | grep -q '^cloudflared.service'; then
  sudo cloudflared service install
fi
sudo systemctl enable cloudflared >/dev/null 2>&1
sudo systemctl restart cloudflared
sleep 5
systemctl is-active cloudflared
cloudflared tunnel info "$NAME" | tail -n 5
