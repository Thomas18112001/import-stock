# Configuration

## Variables d'environnement

Le runtime lit `.env` via `node --env-file=.env`.  
Reference complete: `.env.example`.

### Requises

- `PRESTA_BASE_URL`: URL de base Prestashop (ex: `https://btob.wearmoi.com`).
- `PRESTA_WS_KEY`: cle Webservice Prestashop.
- `PRESTA_BOUTIQUE_CUSTOMER_ID`: id client Prestashop (entier positif).
- `SHOPIFY_DEFAULT_LOCATION_NAME`: nom de la localisation Shopify par defaut.
- `SYNC_BATCH_SIZE`: taille de lot de sync (entier positif).
- `SYNC_MAX_PER_RUN`: max recu par execution (entier positif, >= batch size).
- `SHOPIFY_APP_URL`: URL publique de l'app (fallback possible via `APP_URL`).
- `SHOPIFY_API_KEY`: API key Shopify.
- `SHOPIFY_API_SECRET`: API secret Shopify.
- `SCOPES`: liste CSV des scopes Shopify.

### Optionnelles

- `APP_URL`: fallback si `SHOPIFY_APP_URL` absent.
- `CRON_SECRET`: secret de protection `/api/cron/sync`.
- `PORT`: port d'ecoute interne (defaut `3000`).
- `NODE_ENV`: `development|test|production` (defaut `production`).
- `DEBUG`: `true` pour logs debug.
- `SHOP_CUSTOM_DOMAIN`: domaine custom Shopify (si utilise).
- `SHOP`: shop cible (ex: `wearmoi-dev.myshopify.com`) si vos flux internes l'exigent.

## Validation centralisee

Module unique:

- [app/config/env.ts](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/app/config/env.ts)

Comportement:

- agrege toutes les erreurs env en une seule exception lisible;
- normalise `SHOPIFY_APP_URL` (sans slash final);
- impose HTTPS en production;
- bloque les URLs `example.com` en production.

## Scopes Shopify

Scopes recommandes pour la sync stock:

`read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_inventory,read_locations,read_products,write_inventory`

Ces scopes doivent etre coherents entre:

1. `.env` (`SCOPES`)
2. `shopify.app.toml`
3. configuration Shopify de la boutique

## Shopify custom app (important)

Contexte de ce projet: app **custom** par boutique (`wearmoi-dev`), pas un flux App Store classique.

Recuperer `SHOPIFY_API_KEY` et `SHOPIFY_API_SECRET`:

1. Ouvrir Shopify Admin de la boutique:
   `https://admin.shopify.com/store/wearmoi-dev`
2. Aller dans `Apps` > `Develop apps`
3. Ouvrir l'app custom cible
4. Recuperer `API key` et `API secret key`

## URL de production

- App URL: `https://import-stock.woora.fr`
- Redirects:
  - `https://import-stock.woora.fr/auth/callback`
  - `https://import-stock.woora.fr/auth/shopify/callback`
  - `https://import-stock.woora.fr/api/auth/callback`
