#!/usr/bin/env bash
set -euo pipefail

APP_NAME="import-stock-wearmoi"
APP_USER="appuser"
APP_GROUP="appuser"
APP_DIR="/var/www/import-stock-wearmoi"
REPO_URL="https://github.com/Thomas18112001/import-stock.git"
DOMAIN="import-stock.woora.fr"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
SERVICE_NAME="import-stock-wearmoi"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This script must be run as root (sudo)." >&2
  exit 1
fi

echo "[1/10] Installing system packages..."
apt-get update -y
apt-get install -y git nginx ufw certbot python3-certbot-nginx curl

echo "[2/10] Checking Node.js..."
if command -v node >/dev/null 2>&1; then
  echo "Node detected: $(node -v)"
else
  echo "Node not found. Installing Node 20 with nvm for ${APP_USER}..."
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --shell /bin/bash "${APP_USER}"
  fi
  su - "${APP_USER}" -c 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash'
  su - "${APP_USER}" -c 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 20; nvm alias default 20'
fi

echo "[3/10] Ensuring app user..."
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "${APP_USER}"
fi

echo "[4/10] Fetching repository..."
mkdir -p /var/www
if [[ ! -d "${APP_DIR}/.git" ]]; then
  rm -rf "${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch --all --prune
  git -C "${APP_DIR}" pull --ff-only
fi
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "Missing ${APP_DIR}/.env. Create it from .env.example with real secrets before deploy." >&2
  exit 1
fi

echo "[5/10] Installing dependencies and building..."
su - "${APP_USER}" -c "cd ${APP_DIR} && npm ci"
su - "${APP_USER}" -c "cd ${APP_DIR} && npm run build"

echo "[6/10] Installing systemd service..."
install -m 0644 "${APP_DIR}/deploy/import-stock-wearmoi.service" "${SERVICE_TARGET}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "[7/10] Installing Nginx vhost..."
install -m 0644 "${APP_DIR}/deploy/nginx/import-stock.woora.fr.conf" "${NGINX_SITE}"
if [[ ! -L "${NGINX_ENABLED}" ]]; then
  ln -s "${NGINX_SITE}" "${NGINX_ENABLED}"
fi
nginx -t
systemctl reload nginx

echo "[8/10] Configuring firewall..."
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

echo "[9/10] Requesting/renewing TLS certificate..."
if certbot certificates | grep -q "Domains: ${DOMAIN}"; then
  echo "Certificate already present for ${DOMAIN}, skipping issuance."
else
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email || {
    echo "Certbot automatic issuance failed. Run manually:"
    echo "  sudo certbot --nginx -d ${DOMAIN}"
  }
fi

echo "[10/10] Deploy complete."
echo "Service status:"
systemctl --no-pager --full status "${SERVICE_NAME}" | sed -n '1,12p'
