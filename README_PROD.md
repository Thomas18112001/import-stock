# Deploy production VPS (PM2 + Nginx)

Ce document explique un demarrage de l'app en production derriere Nginx.

## 1) Variables d'environnement

Exemple minimal:

```dotenv
NODE_ENV=production
PORT=3000
SHOPIFY_APP_URL=https://stock-sync.votre-domaine.com
# ou APP_URL=https://stock-sync.votre-domaine.com

PRESTA_BASE_URL=...
PRESTA_WS_KEY=...
PRESTA_BOUTIQUE_CUSTOMER_ID=...
SHOPIFY_DEFAULT_LOCATION_NAME=...
SYNC_BATCH_SIZE=50
SYNC_MAX_PER_RUN=200
CRON_SECRET=...
```

Notes:
- Le serveur ecoute sur `process.env.PORT` avec fallback `3000` (via `react-router-serve`).
- En production, l'app refuse de demarrer si `SHOPIFY_APP_URL` et `APP_URL` sont absents.

## 2) Build + demarrage PM2

```bash
npm ci
npm run build
NODE_ENV=production PORT=3000 pm2 start npm --name wear-moi-stock-sync -- start
pm2 save
pm2 startup
```

Commande utile:

```bash
pm2 logs wear-moi-stock-sync
```

## 3) Configuration Nginx

Exemple `/etc/nginx/sites-available/wear-moi-stock-sync.conf`:

```nginx
server {
    listen 80;
    server_name stock-sync.votre-domaine.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }
}
```

Activer et recharger:

```bash
sudo ln -s /etc/nginx/sites-available/wear-moi-stock-sync.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 4) TLS (recommande)

Utiliser Certbot ensuite:

```bash
sudo certbot --nginx -d stock-sync.votre-domaine.com
```

## 5) Cron automatique (toutes les 4h)

Route cron:
- `POST /api/cron/sync`
- Auth: `X-CRON-SECRET` ou query `cron_secret`
- Reponse succes: `{"ok":true,"imported":n}`

Exemple crontab (toutes les 4 heures):

```cron
0 */4 * * * curl -fsS -X POST "https://stock-sync.votre-domaine.com/api/cron/sync?shop=woora-app-2.myshopify.com&locationId=gid://shopify/Location/123456789" -H "X-CRON-SECRET: VOTRE_CRON_SECRET" >/dev/null 2>&1
```

## 6) Shopify Partner Dashboard: App URL + Redirect URLs

Pour la production `https://import-stock.woora.fr`, verifier dans Shopify Partner Dashboard (ou `shopify.app.toml`) :
- `application_url = "https://import-stock.woora.fr"`
- `embedded = true`
- `redirect_urls` contient:
  - `https://import-stock.woora.fr/auth/callback`
  - `https://import-stock.woora.fr/auth/shopify/callback`
  - `https://import-stock.woora.fr/api/auth/callback`
- `scopes` doit inclure:
  - `read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_inventory,read_locations,read_products,write_inventory`

Note runtime:
- En production, l'app leve une erreur si l'URL applicative (`SHOPIFY_APP_URL`/`APP_URL`) contient `example.com`.
