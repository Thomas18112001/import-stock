# TESTING

## 1. Verification technique locale

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

## 2. Verification auth/scopes Shopify

1. `shopify app config link`
2. `shopify app deploy`
3. `shopify app dev clean`
4. Desinstaller/reinstaller l'app
5. `shopify app env show`:
   - `SCOPES` non vide
   - `SHOPIFY_API_KEY` coherent avec `shopify.app.toml`

## 3. Flux fonctionnel manuel (happy path)

1. Ouvrir l'app depuis Shopify Admin.
2. Dashboard -> `Synchroniser maintenant`.
3. Import manuel `1000500`.
4. Aller sur `Receptions boutique`.
5. Cliquer `Ouvrir`:
   - navigation vers detail OK
   - pas de retour silencieux vers liste.
6. Cliquer `Preparer`.
7. Cliquer `Ajouter au stock boutique` puis confirmer.
8. Verifier stock augmente sur la boutique selectionnee.
9. Cliquer `Annuler l'application`.
10. Verifier stock revient a la valeur initiale.

## 3.b Multi-boutiques

1. Choisir `Boutique Toulon`:
   - synchronisation autorisee.
   - import par ID autorise.
2. Choisir `Boutique Chicago` (sans id_customer configure):
   - message `A configurer`.
   - bouton synchroniser desactive.
   - import par ID desactive.

## 4. Cas de robustesse

1. Reimport meme ID:
   - message `Cette commande a deja ete importee.`
   - pas de doublon.
2. Double apply:
   - reception `APPLIED` non reappliquable.
3. SKU manquant:
   - statut `Bloquee`
   - apply refuse tant que non ignore.
4. Suppression:
   - autorisee si non appliquee
   - refusee si appliquee (annulation requise).
5. URL detail invalide:
   - banner `Commande introuvable ou supprimée`.

## 5. Cron securise

1. Sans `CRON_SECRET` -> `503`.
2. Mauvais `X-CRON-SECRET` -> `401`.
3. Bon secret + `locationId` valide -> `200`.
4. Deux appels rapides (< 1 min) -> `429`.

## 6. Logs DEBUG a verifier

Mettre `DEBUG=true`, puis verifier:

1. Clic Ouvrir: id brut + id encode + path.
2. Loader detail: param recu + decode + found/not found.
3. Cursor: read/write.
4. Durees: sync/prepare/apply/annulation.
