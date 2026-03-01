# Guide Debutant: Local + VPS

Ce guide est la procedure unique pour eviter les boucles OAuth.

## Prerequis

- Node.js installe
- Shopify CLI connecte (`shopify auth login`)
- Fichier `.env` present a la racine

## Regle importante

Il y a 2 apps Shopify differentes:

- DEV local: `shopify.app.import-stock-boutique.toml` (client_id `3f929...`)
- PROD VPS: `shopify.app.toml` (client_id `80d2...`)

Ne jamais melanger les deux.

## A. Demarrer en local (copier/coller)

```powershell
npm run dev:local
```

Ce script fait automatiquement:

1. `NODE_ENV=development` dans `.env`
2. selection de l'app DEV
3. `shopify app dev clean`
4. `shopify app dev --reset`

Ensuite:

1. Ouvre l'app depuis Shopify Admin
2. Si une ancienne app apparait encore, desinstalle-la (ancienne URL tunnel)

### Si erreur DNS trycloudflare

Relance simplement:

```powershell
shopify app dev --reset
```

Et verifie DNS (sans `< >`):

```powershell
Resolve-DnsName metallica-spirit-charms-searching.trycloudflare.com
```

## B. Preparer la production VPS (copier/coller)

Sur ta machine locale (avant deploy):

```powershell
npm run prepare:vps
```

Puis commit + push sur GitHub, puis sur le VPS:

```bash
cd /var/www/import-stock-wearmoi
cp .env.vps.example .env
nano .env
chmod +x scripts/redeploy_vps.sh
./scripts/redeploy_vps.sh
```

Verification VPS:

```bash
sudo systemctl status import-stock-wearmoi --no-pager
sudo ss -lntp | grep 3001
curl -I https://import-stock.woora.fr
```

## C. Checklist rapide

- Local: `appUrl` doit etre `https://...trycloudflare.com`
- VPS: `SHOPIFY_APP_URL` doit etre `https://import-stock.woora.fr`
- Local et VPS n'utilisent pas le meme `client_id`
