# WearMoi Stock Sync - Rapport de fiabilisation et sécurité

## 1) Navigation et fiabilité

- Navigation interne en mode embedded via helper `embeddedNavigate`.
- Routes `Réceptions` refactorées en layout + index:
  - `app.receipts.tsx` (layout avec `Outlet`)
  - `app.receipts._index.tsx` (liste)
  - `app.receipts.$receiptIdEnc.tsx` (détail)
- Instrumentation `DEBUG=true`:
  - clic `Ouvrir` (id brut/encodé + traceId + path)
  - loader liste/détail (params, auth, redirections)

## 2) Sécurité API / secrets

- Clé Presta (`PRESTA_WS_KEY`) utilisée uniquement côté serveur.
- URL sensible masquée dans les logs (`ws_key=***`).
- Aucune route client n'expose la clé.
- Toutes les actions sensibles passent par `requireAdmin(request)`.
- Endpoint cron protégé par secret (`X-CRON-SECRET`) + rate limit.

## 3) Sécurité stock

- Apply:
  - uniquement lignes de la réception courante
  - uniquement `RESOLVED`, non skippées, qty > 0
  - idempotence: refus si `APPLIED`
- Rollback:
  - uniquement lignes de l'ajustement lié à la réception
  - vérification anti-stock négatif avant écriture
- Logs DEBUG:
  - `apply receipt validation`
  - `rollback receipt validation`

## 4) Validation URL / isolation

- `receiptId` encodé/décodé via helpers dédiés:
  - `encodeReceiptIdForUrl`
  - `decodeReceiptIdFromUrl`
- Anti double-encodage intégré.
- Si ID invalide/introuvable:
  - message clair UI
  - pas de redirection silencieuse.

## 5) Conflits Shopify / storefront

- App embedded admin uniquement.
- Aucun script storefront injecté.
- Aucun override de thème.
- Aucune mutation inventory hors actions explicites utilisateur.

## 6) Icônes

- Fichiers ajoutés:
  - `public/wearmoi-logo.svg`
  - `public/wearmoi-favicon.ico`
  - `public/wearmoi-app-icon.png`
- `root.tsx` configure favicon + apple-touch-icon.
- Pour l'icône de l'app dans Shopify Admin (tuile app):
  - upload manuel recommandé dans le Partner Dashboard avec `public/wearmoi-app-icon.png`.
