# Architecture

## Vue d'ensemble

- Frontend/admin embedded: routes React Router dans `app/routes/*`.
- Serveur runtime: `react-router-serve` sur build SSR (`build/server/index.js`).
- Integrations:
  - Shopify Admin GraphQL + OAuth (`app/shopify.server.ts`)
  - Prestashop Webservice (`app/services/prestaClient.ts`)
- Metier sync: `app/services/receiptService.ts`.

## Composants principaux

- `app/config/env.ts`: validation centralisee des variables d'environnement.
- `app/shopify.server.ts`: init Shopify (`apiKey`, `apiSecretKey`, `apiVersion`, scopes, appUrl).
- `app/services/prestaClient.ts`: appels API Prestashop avec `ws_key`.
- `app/services/receiptService.ts`: import des receptions + application des deltas stock.
- `app/routes/actions.sync.tsx`: sync manuelle.
- `app/routes/api.cron.sync.tsx`: sync cron protegee par secret.

## Flux OAuth Shopify (custom app)

1. Shopify charge l'app custom embeddee.
2. Route `/auth` demarre le flux OAuth.
3. Callback sur `/auth/callback` (ou `/auth/shopify/callback`).
4. Session Shopify validee.
5. Les routes `/app/*` passent par authentification admin.

## Flux Prestashop

1. Une sync demande une boutique Shopify (`locationId`).
2. Le service lit l'etat de sync (curseur, derniere sync).
3. Le client Prestashop interroge les commandes/receptions.
4. Les receptions sont converties/importees en metaobjects Shopify.
5. Le curseur est mis a jour par boutique.

## Endpoints et taches

- UI admin:
  - `/app`, `/app/receipts`, etc.
- Actions:
  - `/actions/sync` (manuelle)
  - `/api/cron/sync` (cron, secret header/query)
- Webhooks Shopify:
  - `/webhooks/app/scopes_update`
  - `/webhooks/app/uninstalled`

## Stockage et logs

- Sessions Shopify: stockage memoire (adapter current).
- Etat de sync: metafields/metaobjects Shopify.
- Logs: stdout/stderr (consommes via `journalctl` avec systemd).
- Secrets: jamais logs.
