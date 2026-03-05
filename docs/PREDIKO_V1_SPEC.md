# Prediko-like Inventory - Spec V1/V2 (shopify-app-migration)

Date: 2026-03-05

## 1) Audit fonctionnel (existant)

### Ecrans admin app
- `app._index` / `app.tableau-de-bord`: synchronisation Presta, import manuel, derniere receptions.
- `app.receipts._index`: liste receptions Presta (filtrage boutique, statuts).
- `app.receipts.$receiptIdEnc`: detail reception, resolution SKU, mise en arrivage, confirmation reception.
- `app.purchase-orders._index`: liste commandes fournisseurs magasin (DRAFT/INCOMING/RECEIVED/CANCELED).
- `app.purchase-orders.new`: creation commande fournisseur.
- `app.purchase-orders.$purchaseOrderIdEnc`: detail commande fournisseur + actions.
- `app.planification-stocks`: planning central (stock/incoming/sales/coverage/stockout/suggestion) + inline thresholds overrides + creation PO draft.
- `app.alertes-inventaire`: centre alertes + configuration frequence/emails/types.
- `app.help.scopes`: aide permissions Shopify.

### APIs / actions existantes clefs
- Sync/Import: `actions/synchroniser`, `actions/importer-par-id`, `actions/synchroniser/cron`.
- Receptions: actions apply/receive/rollback/delete/toggle skip.
- Reassorts magasin: create/send/receive/cancel/delete/duplicate.
- Planning thresholds: `actions/planification/seuils` (global, override, reset, copy, import CSV global).
- PO depuis suggestion: `actions/planification/creer-po`.
- Alertes: `actions/alertes/configuration`, `actions/alertes/statut`.
- Sales/forecast: `/api/sales/agg`, `/api/sales/rate`, `/api/inventory/sales-rate`, `/api/inventory/forecast`.
- POS: `/api/pos/incoming-search`, `/api/pos/incoming`.

### Services metier existants
- `inventoryThresholdService`: global + overrides + merge effectif + copy/reset.
- `prestaSalesService`: aggregation ventes Presta B2B (Toulon), cache metaobjects, sales rate, forecast simple.
- `inventoryPlanningService`: coverage days, stockout prediction, risk, reorder suggestion, creation PO draft.
- `inventoryAlertService`: alert config, dedup alerts, status OPEN/ACK/RESOLVED.
- `purchaseOrderService`, `receiptService`, `auditLogService`, `posAuth`.

### POS extension
- `extensions/pos-incoming-smart-grid`: lecture seule, recherche clavier, liste produits en arrivage.
- Endpoint POS enrichi avec: available, incoming, ETA, min/max, coverage, stockout, suggestion, risk.

## 2) Arborescence menu cible

Menu principal propose:
1. Tableau de bord
2. Planification stock
3. Alertes inventaire
4. Produits en reception
5. Reassorts magasin
6. Aide

Evolution V2 menu (optionnel):
1. Tableau de bord
2. Planification stock
3. Forecast & projection
4. Fournisseurs
5. Alertes inventaire
6. Reassorts magasin
7. Produits en reception
8. Aide

## 3) Gap analysis vs Prediko

### Deja en place (V1 solide)
- Multi-boutiques par location Shopify.
- Flux incoming manuel (pas d auto apply a ETA).
- Planning central avec coverage/stockout/suggestion.
- Thresholds override par boutique (inline) + copy.
- Sales rate Presta B2B agrege/cache.
- Alert center in-app + config de frequence et destinataires.
- POS read-only avec metriques logistiques.

### Manques V1 a finir
- UI dediee complete pour gestion fournisseurs (CRUD + leadTimeDays + mapping SKU).
- Dispatch email reel (instant/daily/weekly), aujourd hui configuration + donnees seulement.
- CSV import/export thresholds: export UI + import global implementes; manque export server-side et import overrides par boutique.
- KPI health dashboard dedie (rupture/a risque/surstock) avec liens de filtres.

### V2 manquants
- Forecast avance 30/60/90 avec saisonnalite mensuelle plus robuste.
- Projection stock timeline (stock + incoming - forecast).
- Suggestions avances basees forecast/seasonality.
- Receptions partielles completes.
- POS actions avancees (si un jour autorise metier).

## 4) Workflow UX cible (V1)

1. Voir l etat stock:
   - Ecran planification + KPIs.
2. Comprendre le risque:
   - colonnes couverture, rupture estimee, badge risque.
3. Voir impact entrants:
   - stock entrant + ETA + references.
4. Recevoir suggestions:
   - suggestion qty auto par SKU/location.
5. Creer PO:
   - selection lignes -> creer PO brouillon.
6. Reception manuelle:
   - commande INCOMING -> confirmation reception.

Etats UI obligatoires:
- loading (table/kpi),
- empty (aucune ligne),
- erreur explicite (API/action),
- feedback succes (toast/banner),
- confirmations sur actions irreversibles.

## 5) Spec technique V1

### Metaobjects utilises
- `thresholdGlobal`
- `thresholdOverride`
- `salesAgg`
- `alertConfig`
- `alertEvent`
- `supplier`
- `supplierSku`

### Endpoints
- `GET /api/sales/agg?locationId=&range=30|90|365&refresh=1`
- `GET /api/sales/rate?sku=&locationId=&range=30|90|365`
- `GET /api/inventory/sales-rate?sku=&locationId=&range=...`
- `GET /api/inventory/forecast?sku=&locationId=&range=...`
- `GET /api/pos/incoming-search?locationId=&q=&limit=`
- `GET /api/pos/incoming?locationId=&sku=|inventoryItemId=`

### Regles calcul V1
- Coverage days = `(available + incoming) / avgDailySales` (si ventes > 0).
- Stockout days = `(available + incoming - safetyStock) / avgDailySales`.
- Suggestion qty = `targetCoverageDays * avgDailySales + safetyStock - available - incoming`,
  avec garde-fous min/max + lead time.
- Risk:
  - critical: rupture ou stockout <= 7j
  - warning: stockout <= 21j / sous min
  - no_sales: avgDailySales = 0
  - ok sinon

## 6) Criteres d acceptation V1

- Pas de double import sur `presta_order_id + location`.
- Stocks independants par location.
- ETA informative uniquement; bascule stock seulement via confirmation manuelle.
- Planification exploitable en 1 ecran:
  stock, incoming, ventes/j, couverture, rupture, suggestion.
- Alertes deduplees et filtrables.
- POS lit les metriques de la boutique active.

## 7) Checklist QA (manuel)

1. Planning:
   - changer boutique/range/status/recherche,
   - verifier coverage/stockout/suggestion cohérents.
2. Thresholds:
   - sauver override inline, reset override, copy A->B,
   - sauver seuil global manuel,
   - importer CSV global,
   - exporter CSV global.
3. Sales rate:
   - refresh ventes 30/90/365,
   - endpoint SKU retourne avgDailySales attendu.
4. Reorder:
   - selection lignes suggerees -> creation PO brouillon.
5. Alertes:
   - apparition LOW_STOCK/OUT_OF_STOCK/STOCKOUT_SOON,
   - changement statut ACK/RESOLVED.
6. POS:
   - recherche clavier,
   - affichage available/incoming/ETA/min-max/coverage/stockout,
   - aucune action de mutation stock.
7. Non-regression:
   - import Presta, apply incoming, receive, rollback.
