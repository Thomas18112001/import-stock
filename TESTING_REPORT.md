# Rapport de tests - Sécurité et fiabilité stock

Date: 2026-03-02

## Commandes exécutées

1. `npm run typecheck` ✅
2. `npm run lint` ✅
3. `npm run test:unit` ✅ (58 tests passés)
4. `npm run build` ✅

## Scénarios obligatoires validés

1. Apply n'affecte que les SKU de la réception
   - Fichier: `tests/receiptSecurityRules.test.ts`
   - Vérifie que seules les lignes `RESOLVED`, non ignorées, `qty>0` sont envoyées à Shopify.
   - Résultat: ✅

2. Rollback inverse exact des deltas, y compris vers négatif
   - Fichier: `tests/receiptSecurityRules.test.ts`
   - Cas simulé: stock initial `-1`, apply `+1` => `0`, rollback `-1` => `-1`.
   - Résultat: ✅

3. Boutique verrouillée sur une réception
   - Fichiers: `tests/receiptSecurityRules.test.ts`, `tests/locationLock.test.ts`
   - Vérifie:
     - UI détail: sélecteur boutique désactivé.
     - Serveur: rejet si location demandée ≠ location de la réception.
   - Résultat: ✅

4. Endpoints sensibles refusent sans session Shopify
   - Fichier: `tests/receiptSecurityRules.test.ts`
   - Vérifie rejet sans session sur actions sensibles (`sync`, `apply`).
   - Résultat: ✅

## Régressions métier contrôlées

1. Anti double import/apply conservé (tests existants + guards de statut).
2. Flux Presta conservé avec validation renforcée SKU/qty.
3. Build client/server OK après patch.
