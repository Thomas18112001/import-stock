# Hardening VPS Production (FR)

Ce guide complète `README_PROD.md` avec des mesures de durcissement serveur.

## 1) Utilisateur non-root + permissions

```bash
sudo adduser --disabled-password --gecos "" appuser
sudo usermod -aG www-data appuser
sudo mkdir -p /var/www/import-stock-wearmoi
sudo chown -R appuser:appuser /var/www/import-stock-wearmoi
```

Fichier `.env`:

```bash
cd /var/www/import-stock-wearmoi
sudo chown appuser:appuser .env
sudo chmod 600 .env
```

## 2) SSH clés uniquement (désactiver mot de passe)

1. Copier votre clé publique:
```bash
ssh-copy-id user@vps
```

2. Configurer SSH:
```bash
sudo sed -i 's/^#\\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl reload sshd
```

## 3) UFW: n'ouvrir que 22/80/443

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

## 4) Fail2ban

```bash
sudo apt-get update
sudo apt-get install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
sudo fail2ban-client status
```

## 5) Mises à jour sécurité automatiques

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

## 6) Secrets

1. Jamais dans Git.
2. Stocker uniquement dans `.env` serveur (chmod `600`).
3. Rotation régulière:
   - `PRESTA_WS_KEY`
   - `SHOPIFY_API_SECRET`
   - `CRON_SECRET`

## 7) Nginx durci

Exemple fourni:

- `deploy/nginx/import-stock.production.hardening.conf`

Points couverts:

1. blocage dotfiles et chemins sensibles (`.env`, `.shopify`, `deploy`, etc.)
2. `client_max_body_size` restreint
3. headers sécurité (HSTS, nosniff, referrer-policy, permissions-policy)
4. rate limit optionnel sur `/actions/*` et `/api/cron/*`

## 8) PM2 (optionnel)

Exemple sans secrets:

- `deploy/ecosystem.pm2.example.cjs`

Démarrage:

```bash
cd /var/www/import-stock-wearmoi
pm2 start deploy/ecosystem.pm2.example.cjs
pm2 save
pm2 startup
```

## 9) Vérifications finales

```bash
sudo nginx -t
sudo systemctl reload nginx
pm2 status
curl -I https://import-stock.woora.fr
```
