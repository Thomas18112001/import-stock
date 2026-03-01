# Rapport de tests fonctionnels

Date: 2026-03-01

## Resultat global

Etat: **OK en local sur tests unitaires/build**  
Etat manuel Shopify/Prestashop: **a rejouer avec le store** (checklist ci-dessous)

## Scenarios verifies automatiquement

1. Parsing Prestashop:
   - detail `/api/orders/{id}`
   - list `/api/orders`
2. Conversion dates Shopify `date_time`
3. Encodage/decodage receipt id (GID URL-safe)
4. Guard reauth (pas de boucle)
5. Detection scope manquant
6. Unicite import (doublon id/reference)
7. Regles apply/annulation/suppression:
   - selection lignes applicables
   - anti double apply (status)
   - rollback negatif detecte
   - suppression refusee si APPLIED
8. Integration simulee (mock Shopify GraphQL):
   - resolution SKU
   - mutation d'ajustement envoyee avec bonne location + bons deltas
9. Multi-boutiques:
   - mapping boutique -> id_customer Prestashop
   - boutique non configuree (Chicago) bloquee proprement

## Checklist manuelle Shopify Admin

1. Dashboard -> Recepcions: navigation sans ecran login.
2. Import par ID (ancienne commande ex. `1000500`):
   - reception creee
   - doublon bloque au second import.
3. Ouvrir reception:
   - detail affiche
   - preparation SKU fonctionne.
4. Ajouter au stock boutique:
   - stock augmente uniquement sur la boutique selectionnee.
5. Annuler l'application:
   - stock revient exactement.
   - refus si cela cree du negatif.
6. Suppression:
   - possible avant application
   - refusee apres application tant que non annulee.
7. Cron:
   - sans secret => 503
   - mauvais secret => 401
   - bon secret => 200

## Logs DEBUG utiles

1. Navigation: clic Ouvrir + trace id.
2. Loader detail: param recu, decode, found/not found.
3. Cursor: read/write/display.
4. Performance: duree sync/prepare/apply/annulation.
