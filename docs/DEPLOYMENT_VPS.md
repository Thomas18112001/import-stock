# Deploiement VPS Ubuntu

Contexte cible:

- VPS Ubuntu
- Node `v20.19.6`
- Domaine `https://import-stock.woora.fr`
- Port interne app `3001`
- Repo `https://github.com/Thomas18112001/import-stock.git`

## 1) Prerequis serveur

```bash
sudo apt update
sudo apt install -y git nginx ufw certbot python3-certbot-nginx curl
node -v
npm -v
```

Le projet attend Node 20+.

## 2) Deploiement reproductible (script)

Script idempotent:

- [scripts/deploy_vps.sh](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/scripts/deploy_vps.sh)

Ce script:

1. installe les paquets systeme requis;
2. verifie Node (installe via nvm seulement si absent);
3. clone/pull le repo dans `/var/www/import-stock-wearmoi`;
4. verifie que `.env` existe (sinon stop explicite);
5. lance `npm ci` puis `npm run build`;
6. installe/relance le service systemd;
7. installe Nginx reverse proxy;
8. applique UFW;
9. tente certbot Let's Encrypt.

Execution:

```bash
cd /var/www/import-stock-wearmoi
sudo chmod +x scripts/deploy_vps.sh
sudo ./scripts/deploy_vps.sh
```

Pour les mises a jour suivantes (apres push GitHub), utiliser:

```bash
cd /var/www/import-stock-wearmoi
chmod +x scripts/redeploy_vps.sh
./scripts/redeploy_vps.sh
```

## 3) Fichier .env (a creer manuellement)

Ne jamais commiter les secrets.  
Le script ne cree pas `.env`.

```bash
cd /var/www/import-stock-wearmoi
cp .env.vps.example .env
nano .env
```

Variables attendues: voir [docs/CONFIGURATION.md](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/docs/CONFIGURATION.md).

## 4) Service systemd (defaut)

Template:

- [deploy/import-stock-wearmoi.service](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/deploy/import-stock-wearmoi.service)

Installation manuelle:

```bash
sudo cp deploy/import-stock-wearmoi.service /etc/systemd/system/import-stock-wearmoi.service
sudo systemctl daemon-reload
sudo systemctl enable import-stock-wearmoi
sudo systemctl restart import-stock-wearmoi
sudo systemctl status import-stock-wearmoi
```

## 5) Nginx reverse proxy

Template:

- [deploy/nginx/import-stock.woora.fr.conf](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/deploy/nginx/import-stock.woora.fr.conf)

Installation manuelle:

```bash
sudo cp deploy/nginx/import-stock.woora.fr.conf /etc/nginx/sites-available/import-stock.woora.fr
sudo ln -s /etc/nginx/sites-available/import-stock.woora.fr /etc/nginx/sites-enabled/import-stock.woora.fr
sudo nginx -t
sudo systemctl reload nginx
```

## 6) HTTPS Let's Encrypt

```bash
sudo certbot --nginx -d import-stock.woora.fr
```

Version non interactive (si automation):

```bash
sudo certbot --nginx -d import-stock.woora.fr --non-interactive --agree-tos --register-unsafely-without-email
```

## 7) Firewall UFW

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 8) Option PM2 (facultative)

Un exemple PM2 est disponible:

- [ecosystem.config.cjs](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/ecosystem.config.cjs)

Le mode recommande reste systemd sur ce projet.
