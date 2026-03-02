# Audit sécurité - Import Stock Boutique

Date: 2026-03-02  
Périmètre audité: `app/`, `routes/`, `services/`, `utils/`, `extensions/`, `scripts/`, `deploy/`, `shopify*.toml`, `ecosystem.config.cjs`, `Dockerfile`.

## Surface d'attaque

1. Auth Shopify embedded (`/app/*`, routes actions).
2. Endpoints internes d'écriture stock/import (`/actions/*`).
3. Endpoints cron non-session (`/api/cron/sync`, `/actions/sync/cron`).
4. Webhooks Shopify.
5. Appels sortants Prestashop (XML API + `ws_key`).
6. Écritures Shopify Admin GraphQL (inventory + metaobjects + metafields shop).
7. Scripts de déploiement VPS (Nginx/systemd/PM2).

## Menaces (OWASP + Shopify)

1. `A01 Broken Access Control`: appel d'actions sans session Shopify.
2. `A04 Insecure Design`: changement de boutique pendant un flux de réception.
3. `A05 Security Misconfiguration`: scopes Shopify trop larges, shop spoof via paramètre `shop`.
4. `A09 Security Logging and Monitoring Failures`: fuite de secrets (Presta `ws_key`) dans logs.
5. Concurrence métier: double clic concurrent sur `apply`/`rollback`, replay d'actions.
6. Intégrité stock: impact hors périmètre réception (SKU non concernés).
7. Risque métier critique: rollback bloqué si stock final négatif.

## Risques identifiés (avant correctifs)

1. Rollback refusé si le retrait rendait un stock négatif.
2. Import initial stockait `location_id` vide (source de vérité incomplète).
3. Changement de boutique encore possible selon état de la réception (UI non verrouillée en permanence).
4. Pas de rate-limit unifié sur `import/prepare/apply/rollback`.
5. Paramètre `shop` cron insuffisamment validé (format domaine).
6. Validation Presta des lignes incomplète (`qty` non strict entier >= 0, SKU non normalisé strictement).
7. Contrôles anti-concurrence `apply/rollback` absents au niveau réception.

## Correctifs appliqués

1. Sécurité session/context Shopify:
   - Validation du `shop` de session (`*.myshopify.com`) dans `requireAdmin`.
   - Rejet si `shop` URL et shop session incohérents.
2. Anti-abus:
   - Ajout d'un rate-limit mémoire par `action + shop + IP` sur `sync/import/prepare/apply/rollback`.
   - Ajout d'un mutex mémoire par réception pour empêcher `apply/rollback` concurrents.
3. Sécurité stock (SKU concernés uniquement):
   - `apply` conserve uniquement lignes réception valides (`RESOLVED`, non ignorées, `qty>0`, `inventoryItemId` présent).
   - Refus explicite si aucune ligne applicable.
   - Ciblage explicite de la location verrouillée de la réception.
4. Rollback négatif:
   - Suppression du blocage "stock insuffisant".
   - Rollback basé sur le journal d'application (metaobjects `adjustment` + `adjustment_line`) en inversant strictement `qty_delta`.
   - Idempotence maintenue: refus si déjà `ROLLED_BACK`; action autorisée uniquement depuis `APPLIED`.
5. Verrouillage boutique réception:
   - `location_id` stockée dès l'import (sync et import manuel).
   - UI détail réception: sélecteur boutique désactivé.
   - Gardes serveur strictes sur mismatch location (`prepare/apply/rollback`).
6. Validation stricte entrées:
   - `presta_order_id`: entier strictement positif.
   - `SKU`: trim + max 80 + charset `[A-Za-z0-9._-]`.
   - `qty` Presta: entier `>= 0`.
   - `locationId`: GID Shopify strict.
   - `shop` cron: domaine Shopify strict.
7. Secrets/logs:
   - `ws_key` reste côté serveur uniquement.
   - Pas d'exposition de secrets dans réponses/actions ajoutées.

## Scopes Shopify minimaux requis

`read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_locations,read_products,read_inventory,write_inventory`

Justification:
1. Metaobjects/metafields: stockage réceptions + journal d'ajustements + état sync.
2. Locations: résolution/location lock.
3. Products: résolution SKU.
4. Inventory (read/write): apply/rollback stock.

## Résiduel / points de vigilance

1. `MemorySessionStorage` et rate-limit/mutex mémoire: non partagé multi-instance.
2. Cron protégé par secret mais pas par allowlist IP.
3. `shopify.app.import-stock-boutique.toml` reste vide en scopes (config dev non prod), à maintenir cohérent selon workflow.
4. `deploy/nginx/import-stock.woora.fr.conf` proxifie `127.0.0.1:3000` alors que certains scripts utilisent `PORT=3001`; vérifier alignement infra.
