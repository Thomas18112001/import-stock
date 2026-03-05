#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/shopify-app-migration"
SERVICE_NAME="import-stock-wearmoi"
NGINX_SITE="/etc/nginx/sites-available/import-stock.woora.fr"
NGINX_LINK="/etc/nginx/sites-enabled/import-stock.woora.fr"

cd "$APP_DIR"

echo "[1/8] Pull latest code from GitHub"
git fetch --all --prune
git pull --ff-only

echo "[2/8] Install dependencies"
npm ci

echo "[3/8] Build app"
npm run build

echo "[4/8] Install/refresh systemd unit"
sudo cp deploy/import-stock-wearmoi.service "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload

echo "[5/8] Restart app service"
sudo systemctl restart "$SERVICE_NAME"

echo "[6/8] Install/refresh nginx vhost"
sudo cp deploy/nginx/import-stock.woora.fr.conf "$NGINX_SITE"
sudo ln -sf "$NGINX_SITE" "$NGINX_LINK"

echo "[7/8] Reload nginx"
sudo nginx -t
sudo systemctl reload nginx

echo "[8/8] Status checks"
sudo systemctl --no-pager -l status "$SERVICE_NAME" | sed -n '1,20p'
ss -lntp | grep 3001 || true
curl -I https://import-stock.woora.fr || true
