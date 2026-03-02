# Wear Moi Stock Sync

Shopify embedded app (React Router / TypeScript) to import Prestashop receipts and sync inventory to Shopify locations.

## Quick start

1. Install dependencies:

```bash
npm ci
```

2. Create local environment file:

```bash
cp .env.example .env
```

3. Run in dev:

```bash
npm run dev
```

4. Build and run production server locally:

```bash
npm run build
npm run start
```

`npm run start` now loads `.env` automatically with Node `--env-file=.env`.

## NPM scripts

- `npm run dev`: Shopify dev server
- `npm run build`: production build
- `npm run start`: run built server with `.env` loading
- `npm run start:plain`: run built server without Node `--env-file`
- `npm run start:prod`: same as `start`, explicit production entrypoint
- `npm run typecheck`: type generation + TypeScript checks
- `npm run test:unit`: unit tests

## Environment validation

Environment validation is centralized in:

- [app/config/env.ts](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/app/config/env.ts)

At startup, missing/invalid variables are reported in a single readable error block.

## VPS deploy

- Reproducible script: [scripts/deploy_vps.sh](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/scripts/deploy_vps.sh)
- Default process manager: `systemd` via [deploy/import-stock-wearmoi.service](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/deploy/import-stock-wearmoi.service)
- Nginx vhost template: [deploy/nginx/import-stock.woora.fr.conf](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/deploy/nginx/import-stock.woora.fr.conf)

## Documentation map

- [docs/ARCHITECTURE.md](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/docs/ARCHITECTURE.md)
- [docs/CONFIGURATION.md](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/docs/CONFIGURATION.md)
- [docs/DEPLOYMENT_VPS.md](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/docs/DEPLOYMENT_VPS.md)
- [docs/TROUBLESHOOTING.md](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/docs/TROUBLESHOOTING.md)
- [README_PROD.md](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/README_PROD.md)

## Security

- Never commit `.env` or secrets.
- `.env` is git-ignored.
- Debug logs must not expose credentials.

## Sécurité stock (production)

- Toutes les actions sensibles (`sync/import/prepare/apply/rollback`) sont protégées par session Shopify (hors cron/webhooks dédiés).
- Contexte boutique renforcé:
  - validation stricte du shop session;
  - rejet en cas de shop incohérent;
  - `location_id` stockée dès l'import et utilisée comme source de vérité.
- Verrouillage boutique sur page Réception:
  - sélecteur boutique désactivé;
  - serveur refuse toute action si la location demandée diffère de la location enregistrée.
- Apply stock limité strictement aux SKU de la réception (résolus, non ignorés, qty > 0).
- Anti-abus:
  - rate-limit en mémoire par shop + IP;
  - mutex par réception sur `apply/rollback`.

## Rollback négatif

- Le rollback applique l'inverse exact du journal d'application (`adjustment` + `adjustment_line`).
- Le retrait n'est plus bloqué par un contrôle local de stock négatif: objectif de restauration exacte de l'état précédent.
- Idempotence:
  - retrait possible uniquement depuis `APPLIED`;
  - une réception déjà rollback (`ROLLED_BACK`) ne peut pas être retirée une seconde fois.
