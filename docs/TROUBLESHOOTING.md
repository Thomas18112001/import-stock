# Troubleshooting

## 1) Variables d'env manquantes

Symptome:

- crash au demarrage avec `Invalid environment configuration`.

Cause:

- une ou plusieurs variables requises absentes/invalides.

Resolution:

1. verifier `.env` contre `.env.example`;
2. corriger toutes les cles indiquees par l'erreur;
3. relancer le service.

## 2) Shopify redirect mismatch

Symptome:

- OAuth echoue ou boucle vers login.

Cause:

- URL d'app/callbacks incoherentes.

Resolution:

1. verifier `SHOPIFY_APP_URL` dans `.env`;
2. verifier `shopify.app.toml` (`application_url` + `redirect_urls`);
3. verifier configuration de l'app custom dans Shopify Admin (`Apps > Develop apps`).

## 3) Shopify API initialization

Symptome:

- `Cannot initialize Shopify API Library. Missing values for: ...`.

Cause:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES` ou URL app manquants.

Resolution:

1. renseigner les cles dans `.env`;
2. relancer.

## 4) apiVersion Shopify

Symptome:

- erreurs API apres deprecation/version obsolette.

Resolution:

1. verifier les versions supportees dans:
   `node_modules/@shopify/shopify-api/dist/ts/lib/types.d.ts`
2. mettre a jour `apiVersion` dans `app/shopify.server.ts`;
3. rebuild + restart.

## 5) Nginx / ports / firewall

Symptome:

- `502 Bad Gateway` ou timeout.

Resolution:

1. verifier service app:
   `systemctl status import-stock-wearmoi`
2. verifier ecoute locale:
   `ss -lntp | grep 3000`
3. verifier config nginx:
   `sudo nginx -t`
4. verifier firewall:
   `sudo ufw status`

## 6) Certbot HTTPS

Symptome:

- certificat non genere/renouvellement KO.

Resolution:

1. verifier que le domaine pointe bien vers le VPS;
2. verifier port 80 ouvert (`Nginx Full`);
3. relancer:
   `sudo certbot --nginx -d import-stock.woora.fr`

## Sanity checks

Verifier chargement env:

```bash
node --env-file=.env -e "console.log(process.env.SHOPIFY_APP_URL)"
```

Verifier endpoint HTTPS:

```bash
curl -I https://import-stock.woora.fr
```

Suivre les logs runtime:

```bash
journalctl -u import-stock-wearmoi -f
```
