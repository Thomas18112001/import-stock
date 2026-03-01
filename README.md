# Import Stock Boutique

Application Shopify embedded (React Router + TypeScript + Polaris) pour importer des réceptions Prestashop BtoB et ajouter le stock dans une boutique Shopify.

## Variables d'environnement

Utiliser `.env` (ignoré par git) avec:

```dotenv
PRESTA_BASE_URL=https://btob.wearmoi.com
PRESTA_WS_KEY=...
PRESTA_BOUTIQUE_CUSTOMER_ID=21749
SHOPIFY_DEFAULT_LOCATION_NAME=Boutique Toulon
SYNC_BATCH_SIZE=50
SYNC_MAX_PER_RUN=200
CRON_SECRET=...
DEBUG=false
```

## Commandes

```bash
npm run dev
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

## Procédure scopes Shopify (dev)

Quand les scopes changent:

1. `shopify app config link`
2. `shopify app deploy`
3. `shopify app dev clean`
4. Désinstaller l'app dans Shopify Admin
5. `shopify app dev --store woora-app-2.myshopify.com`
6. Réinstaller depuis Shopify Admin

Vérification:

1. `shopify app env show` -> `SCOPES` non vide
2. `SHOPIFY_API_KEY` = `client_id` dans `shopify.app.toml`
3. Plus d'erreur `Access denied ... Required access`

## Debug

Mettre `DEBUG=true` pour activer:

1. logs auth/session route par route
2. logs navigation `Ouvrir` (trace id, id encode, path)
3. logs loader detail (param recu/decoder, found/not found)
4. logs cursor (read/write/display)
5. logs timing sync/prepare/apply/annulation

Les logs n'affichent jamais `PRESTA_WS_KEY`.

## Check avant prod

1. Scopes minimaux confirmés:
   `read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_inventory,read_locations,read_products,write_inventory`
2. Toutes les routes `/app/*` et actions utilisent `requireAdmin`.
3. Endpoint cron protégé par `X-CRON-SECRET` + rate limit.
4. Import doublon bloqué (même ID Prestashop).
5. Ajout de stock doublon bloqué (statut `APPLIED`).
6. Apply stock = delta positif seulement, jamais overwrite.
7. Retrait du stock refusé si le stock deviendrait négatif.
8. Pas d'affichage d'identifiants techniques en UI (client Prestashop).

## Multi-boutiques

Le mapping Shopify -> Prestashop est géré dans:

- `app/config/boutiques.ts`

Format:

```ts
{
  shopifyLocationName: "Boutique X",
  prestaCustomerId: 12345 | null
}
```

Règles:

1. `prestaCustomerId` défini: synchronisation active.
2. `prestaCustomerId = null`: boutique marquée `À configurer`, synchronisation bloquée avec message clair.
3. Curseur et date de dernière synchronisation sont stockés par boutique (metafields shop JSON).

### Ajouter l'ID Prestashop de Chicago

Modifier [boutiques.ts](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/app/config/boutiques.ts) et remplacer:

```ts
{
  key: "chicago",
  shopifyLocationName: "Boutique Chicago",
  prestaCustomerId: null,
}
```

par:

```ts
{
  key: "chicago",
  shopifyLocationName: "Boutique Chicago",
  prestaCustomerId: <ID_PRESTASHOP_CHICAGO>,
}
```

Puis redémarrer l'app et relancer une synchronisation.

## Documentation tests et securite

1. [TESTING.md](./TESTING.md)
2. [FUNCTIONAL_CHECK_REPORT.md](./FUNCTIONAL_CHECK_REPORT.md)
3. [FUNCTIONAL_TEST_REPORT.md](./FUNCTIONAL_TEST_REPORT.md)
4. [SECURITY_AUDIT.md](./SECURITY_AUDIT.md)
