# WearMoi Stock Sync (Sans DB externe)

## Variables d'environnement (.env)

```env
PRESTA_BASE_URL=https://btob.wearmoi.com
PRESTA_WS_KEY=...
PRESTA_BOUTIQUE_CUSTOMER_ID=21749
SHOPIFY_DEFAULT_LOCATION_NAME=Boutique Toulon
SYNC_BATCH_SIZE=50
SYNC_MAX_PER_RUN=200
CRON_SECRET=...
```

`DATABASE_URL` n'est pas utilise.

## Demarrage

```bash
shopify app dev --store woora-app-2.myshopify.com
```

## Cron (toutes les 4h)

Endpoint:

- `POST /actions/sync/cron`
- Secret: header `X-CRON-SECRET: <CRON_SECRET>`
- Parametre shop obligatoire: `shop=<shop>.myshopify.com` (query ou form-data)

Exemple cron:

```bash
0 */4 * * * curl -sS -X POST "https://<app-host>/actions/sync/cron?shop=woora-app-2.myshopify.com" -H "X-CRON-SECRET: <CRON_SECRET>"
```
