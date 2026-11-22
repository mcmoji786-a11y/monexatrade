#!/usr/bin/env bash
# One-time setup of the Kixo waitlist on a fresh Ubuntu VPS (22.04 or 24.04), run as root:
#   bash vps-setup-waitlist.sh kixo.example
# Installs Node 22, nginx and certbot, opens only SSH and web ports, and runs the site as
# its own user under systemd (restarts on crash and on reboot). The site itself arrives
# with scripts/deploy-waitlist.ps1. SSL is added once the domain points at this server.
set -euo pipefail

DOMAIN="${1:?usage: vps-setup-waitlist.sh your-domain}"
APP=/opt/kixo-waitlist

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates nginx certbot python3-certbot-nginx ufw

# Node 22 (NodeSource).
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# The site runs as its own user, never as root.
id kixo >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin kixo
mkdir -p "$APP/releases" /etc/kixo
chown -R kixo:kixo "$APP"
# Secrets (Supabase keys, SMTP) live here, readable by the site only.
touch /etc/kixo/waitlist.env
chown root:kixo /etc/kixo/waitlist.env
chmod 640 /etc/kixo/waitlist.env

cat >/etc/systemd/system/kixo-waitlist.service <<'UNIT'
[Unit]
Description=Kixo waitlist
After=network.target

[Service]
User=kixo
WorkingDirectory=/opt/kixo-waitlist/current
EnvironmentFile=/etc/kixo/waitlist.env
Environment=NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable kixo-waitlist

cat >/etc/nginx/sites-available/kixo-waitlist <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};
    client_max_body_size 2m;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3100;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/kixo-waitlist /etc/nginx/sites-enabled/kixo-waitlist
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo
echo "Setup done. Next:"
echo "  1. Point ${DOMAIN} (and www) at this server's IP."
echo "  2. Deploy the site from the Kixo PC: scripts/deploy-waitlist.ps1"
echo "  3. SSL: certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect -m YOUR_EMAIL --agree-tos -n"
