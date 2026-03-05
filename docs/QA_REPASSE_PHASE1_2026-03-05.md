# Repasse QA Phase 1 - 2026-03-05

## Perimetre
- Sync Presta -> receptions -> reassorts -> stock Shopify.
- Multi-boutiques (location Shopify), incoming, PO, POS read-only.
- Idempotence, erreurs, audit log, diagnostics non-sync.

## Execution technique
- `npm run typecheck`: PASS
- `npm run test:unit`: PASS (122/122)

## Checklist fonctionnelle (pass/fail)

### 1) Commandes fournisseurs (Presta)
- PASS: ETA Presta stockee sur le PO (`expected_arrival_at`) et utilisee pour incoming.
- PASS: Aucune application automatique de stock a la date ETA.
- PASS: Stock disponible augmente uniquement via confirmation manuelle (`mark_received` / `receiveReceipt`).
- PASS: Modif avant reception: upsert Presta met a jour lignes + ETA et reste en `INCOMING`.
- PASS: Annulation PO: statut `CANCELED`, incoming retire des snapshots (filtres sur `INCOMING`), audit conserve.
- PASS: Modif apres reception: non ecrasee (upsert ignore `RECEIVED` + trace d'audit globale).

### 2) Multi-boutiques
- PASS: `locationId` obligatoire/valide sur flux stock, incoming et planning.
- PASS: Stock Shopify base sur `available` par location.
- PASS: incoming attache a `destination_location_id`; pas de melange inter-boutiques.
- PASS: endpoints POS/planning/alertes filtrent par boutique.

### 3) Incoming / ETA / retards
- PASS: incoming visible app + endpoints POS.
- PASS: ETA par location (pas d'exposition fiche produit publique).
- PASS: alertes retard ETA (`INCOMING_DELAY`) si ETA depassee.
- FIX APPLIQUE: edition manuelle ETA ajoutee sur detail PO (`modifier-eta`) avec audit.

### 4) POS
- PASS: extension read-only (aucune mutation inventaire).
- PASS: endpoint `/api/pos/incoming-search` renvoie incoming + ETA + seuils + couverture + risque.
- PASS: filtrage sur location POS active.

### 5) Diagnostics non-sync
- PASS: diagnostic par commande Presta (`diagnosePrestaOrderSync`) avec raisons explicites.
- PASS: import force par ID present.

## Checklist technique
- PASS: anti-doublon import par `presta_order_id` + gestion collision reference non bloquante.
- PASS: garde anti-double apply/receive/rollback.
- PASS: journal d'evenements present (sync/import/receive/cancel/error).
- PASS: protection endpoints sensibles sans session admin.
- PASS: cron guard (secret header/query) pour jobs planifies.

## Scenarios demandés
- PO importee avec ETA -> incoming visible app + POS: PASS (couvert code + endpoints).
- PO modifiee avant reception -> incoming mis a jour: PASS (upsert Presta sur PO non recu).
- PO annulee -> incoming supprime + CANCELED + audit: PASS.
- Reception confirmee -> stock available location correcte: PASS (tests + service).
- Incoming sur 2 boutiques -> POS filtre boutique active: PASS (locationId obligatoire).
- Commande validée non synchronisee -> diagnostic + forçage: PASS (diagnostic + importById).

## Ecarts restants (priorises)
- P1 (live QA): valider sur environnement Presta reel les transitions d'etat `current_state` annule/rembourse.
- P2: enrichir l'alerte metier specifique "modification Presta apres reception" en signal d'exploitation dedie.

## Correctifs appliques pendant cette repasse
- Ajout mutation ETA securisee:
  - service `updatePurchaseOrderExpectedArrival(...)`
  - route action `actions/reassorts-magasin/:purchaseOrderGid/modifier-eta`
  - UI detail PO: bloc edition ETA + feedback + audit.
- Ajout page `Stats inventaire`:
  - KPIs risque/couverture/entrants/vitesse ventes 30j-365j.
  - historique imports/receptions (20) avec quantites/montants/dates.
  - filtres boutique/periode + refresh ventes Presta.
