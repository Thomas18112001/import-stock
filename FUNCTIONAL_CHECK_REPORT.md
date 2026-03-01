# Rapport de check fonctionnel global

Date: 2026-03-01

## Résumé

Le flux principal est valide en local: navigation, import, filtres multi-boutiques, protections anti-doublon, garde-fous d'ajout/retrait de stock, suppression conditionnelle.

## Vérifications techniques exécutées

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run test:unit` ✅
- `npm run build` ✅

## Vérifications fonctionnelles couvertes (tests unitaires)

- Mapping boutique -> Prestashop:
  - Toulon configurée.
  - Chicago non configurée (sync bloquée proprement).
- Anti-doublon import:
  - même ID Prestashop bloqué.
  - collision de référence avec ID différent non traitée comme doublon strict.
- Anti-doublon ajout de stock:
  - statut `APPLIED` non ré-applicable.
- Verrouillage et sécurité métier:
  - ajustement SKU refusé après `APPLIED`.
  - suppression refusée si stock déjà ajouté.
  - retrait du stock refusé si cela crée un stock négatif.
- Filtrage multi-boutiques:
  - Chicago n'affiche pas les imports legacy sans location.
  - Toulon peut afficher les imports legacy sans location.
- Helpers critiques:
  - encode/decode des GID URL.
  - parsing XML Prestashop (list + detail).
  - conversion date Prestashop -> format Shopify.

## Corrections appliquées pendant ce check

- Correction FR/accents des messages métier et action errors.
- Durcissement du message doublon import (doublon strict par ID Prestashop).
- Centralisation du filtrage des réceptions par boutique via helper testé:
  - [receiptFilters.ts](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/app/utils/receiptFilters.ts)
  - [receiptFilters.test.ts](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/tests/receiptFilters.test.ts)
- Alignement des libellés dashboard (Sélectionner, Dernière synchronisation, Référence).

## Points manuels à rejouer sur le store

- Import réel par ID (ex: `1000500`) puis ouverture du détail depuis la liste.
- Vérification visuelle des stocks avant/après ajout puis retrait.
- Vérification Shopify Admin (scopes installés et session embedded active).

Référence procédure manuelle: [TESTING.md](/c:/Users/Thoma/Desktop/Wearmoiapp/wear-moi-stock-sync/TESTING.md)
