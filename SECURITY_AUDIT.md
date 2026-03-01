# Audit securite - Import Stock Boutique

Date: 2026-03-01

## Surface d'attaque revue

1. Authentification Shopify embedded (routes loader/actions)
2. Endpoints server d'import/sync/apply/annulation/suppression
3. Endpoint cron
4. Appels externes Prestashop
5. Ecriture Metaobjects/stock Shopify

## Mesures en place

1. Auth obligatoire:
   - Toutes les routes `/app/*` et actions utilisent `authenticate.admin` via `requireAdmin`.
2. Isolation shop:
   - Le token admin est toujours celui de la session courante.
   - Les operations Metaobjects/stock passent par ce token.
3. Secrets:
   - `PRESTA_WS_KEY` uniquement cote serveur (`env.server.ts`).
   - Logs Prestashop: endpoint + status seulement, jamais URL avec `ws_key`.
4. Endpoint cron:
   - `X-CRON-SECRET` obligatoire.
   - Si `CRON_SECRET` absent: endpoint desactive (503).
   - Rate limit memoire (1 hit/min).
5. Validation d'entree:
   - ID commande Prestashop: entier strictement positif.
   - SKU skip: trim + format strict.
   - Location Shopify: format GID valide.
   - Filtres listes (status/sort/search) normalises.
6. Durcissement metier:
   - Double import bloque (ID Prestashop strict).
   - Collision de reference (ID different) non consideree comme doublon.
   - Double application bloque (status APPLIED).
   - Context boutique verrouille sur la reception pendant diagnostic/validation.
   - Mapping boutique -> id_customer Prestashop valide cote serveur.
   - Application refusee sans lignes applicables.
   - Application refusee si qty <= 0 ou inventaire invalide.
   - Suppression refusee si APPLIED.
   - Annulation refusee si stock final negatif.
7. Scope handling:
   - Detection `Access denied ... Required access`.
   - Message UX FR + route d'aide scopes.
   - Reauth controle (guard anti-boucle).

## Scopes minimaux retenus

`read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_inventory,read_locations,read_products,write_inventory`

## Risques residuels

1. Session storage en memoire (`MemorySessionStorage`) non persistant multi-instance.
2. Rate limits manuels en memoire (perte apres restart).
3. Tests E2E reels Shopify/Prestashop non automatises (manuel requis).

## Recommandations avant prod

1. Migrer session storage vers stockage persistant.
2. Ajouter observabilite centralisee (logs structure JSON + correlation id).
3. Ajouter tests E2E contre dev store dedie.
4. Configurer alertes sur erreurs reauth/scopes/presta timeout.
