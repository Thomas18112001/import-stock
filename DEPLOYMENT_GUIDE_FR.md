# DEPLOYMENT GUIDE FR (ULTRA DÉTAILLÉ - DÉBUTANT)

Ce guide part de zéro et couvre:

1. Installation propre de l'environnement local (Node + Shopify CLI)
2. Création compte Shopify Partner + Dev Store
3. Liaison du projet local à Shopify
4. Démarrage de l'app en local sans erreur
5. Vérifications fonctionnelles concrètes
6. Préparation release GitHub
7. Déploiement VPS Ubuntu (sans Docker)

---

## 1) Ton contexte actuel (important)

Tu as actuellement:

- `node -v` = `v25.6.1`
- `npm -v` = `11.9.0`
- erreur terminal = `shopify: command not found`

### Pourquoi c'est bloquant

Le projet n'est pas prévu pour Node 25.
Dans `package.json`, l'engine attend:

- `>=20.19 <22`
- ou `>=22.12`

Donc Node 25 peut créer des comportements imprévisibles.

### Version recommandée

Utilise **Node 22 LTS**, idéalement **22.12+**.

---

## 2) Installer Node correctement (macOS)

## 2.1 Installer `nvm` (recommandé)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Ferme puis rouvre le terminal, puis vérifie:

```bash
command -v nvm
```

Si rien ne s'affiche, charge `nvm` manuellement:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

## 2.2 Installer Node 22 LTS

```bash
nvm install 22
nvm use 22
nvm alias default 22
```

Vérifie:

```bash
node -v
npm -v
```

Tu dois avoir un `node -v` en `v22.x` (et pas `v25.x`).

---

## 3) Installer Shopify CLI (macOS)

Tu peux l'installer de 2 façons.

## 3.1 Option A (recommandée): Homebrew

### Étape A1: Vérifier Homebrew

```bash
brew --version
```

Si `brew` n'existe pas:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Étape A2: Installer Shopify CLI

```bash
brew tap shopify/shopify
brew install shopify-cli
```

### Étape A3: Vérifier

```bash
which shopify
shopify version
```

Tu dois voir un chemin + une version.

## 3.2 Option B: npm global

```bash
npm install -g @shopify/cli @shopify/theme
```

Puis:

```bash
which shopify
shopify version
```

---

## 4) Corriger `shopify: command not found`

Si la commande reste introuvable:

## 4.1 Vérifier où est installé le binaire

```bash
which shopify
```

Si vide, teste:

```bash
ls -l /opt/homebrew/bin/shopify
ls -l /usr/local/bin/shopify
```

## 4.2 Corriger le PATH (Apple Silicon)

```bash
echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## 4.3 Corriger le PATH (Intel)

```bash
echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## 4.4 Si install npm global

Trouve le prefix npm:

```bash
npm config get prefix
```

Ajoute au PATH (exemple):

```bash
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Puis re-vérifie:

```bash
shopify version
```

---

## 5) Créer le compte Shopify Partner + Dev Store

## 5.1 Créer le compte Partner

1. Va sur `https://partners.shopify.com`
2. Clique `Join now` / créer un compte
3. Vérifie ton email
4. Connecte-toi au dashboard Partner

## 5.2 Créer un Dev Store

1. Dans Partner Dashboard, clique `Stores`
2. Clique `Add store`
3. Choisis `Development store`
4. Donne un nom (ex: `import-stock-dev`)
5. Crée le store
6. Note son domaine, ex: `import-stock-dev.myshopify.com`

---

## 6) Préparer le projet local

## 6.1 Cloner le repo

```bash
git clone <URL_DU_REPO>
cd shopify-app-migration
```

## 6.2 Installer les dépendances

```bash
npm ci
```

## 6.3 Créer le fichier d'environnement local

Le projet charge `.env`.

```bash
cp .env.example .env
```

Édite `.env`:

```dotenv
NODE_ENV=development
PORT=3000
DEBUG=true

SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://<url-tunnel-fourni-par-shopify-cli>
SCOPES=read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_inventory,read_locations,read_products,write_inventory
SHOP=<ton-dev-store>.myshopify.com

PRESTA_BASE_URL=https://btob.wearmoi.com
PRESTA_ALLOWED_HOST=btob.wearmoi.com
PRESTA_WS_KEY=...
PRESTA_BOUTIQUE_CUSTOMER_ID=21749

SHOPIFY_DEFAULT_LOCATION_NAME=Boutique Toulon
SYNC_BATCH_SIZE=50
SYNC_MAX_PER_RUN=200
CRON_SECRET=...
```

Important:

- ne jamais commiter `.env`
- garder les secrets uniquement en local

---

## 7) Lier le projet à Shopify (étapes CLI)

Depuis le dossier du projet:

## 7.1 Login Shopify CLI

```bash
shopify login
```

Le navigateur s'ouvre, valide l'authentification.

## 7.2 Vérifier que la CLI répond

```bash
shopify version
shopify whoami
```

## 7.3 Lier la config app au Partner

```bash
shopify app config link
```

Puis (si nécessaire):

```bash
shopify app config use shopify.app.toml
```

Tu peux vérifier la config active:

```bash
shopify app env show
```

---

## 8) Lancer l'app en local sans erreur

Commande recommandée:

```bash
shopify app dev
```

Tu peux aussi utiliser le script npm du projet:

```bash
npm run dev
```

(`npm run dev` appelle déjà `shopify app dev`)

## 8.1 À quoi s'attendre dans le terminal

Tu dois voir:

1. démarrage du serveur local
2. URL tunnel HTTPS
3. indication du store de test
4. éventuellement une étape d'installation/réinstallation app

Si Shopify CLI propose d'installer l'app sur le Dev Store, accepte.

## 8.2 Ouvrir l'app dans le Dev Store

1. Va dans ton admin Shopify Dev Store
2. Ouvre `Apps`
3. Clique ton app `Import Stock Boutique`

---

## 9) Vérification fonctionnelle locale (pas à pas)

## 9.1 Vérifier synchronisation

1. Sur le dashboard app, choisis une boutique (ex: Toulon)
2. Clique `Synchroniser`
3. Résultat attendu:
   - message succès
   - nouvelles réceptions visibles dans la liste

## 9.2 Vérifier import par ID

1. Saisis un `ID commande Prestashop`
2. Clique `Importer`
3. Résultat attendu:
   - réception créée
   - ou message clair de doublon si déjà importée

## 9.3 Vérifier ajout de stock (Apply)

1. Clique `Ouvrir` sur la réception
2. Lance `Ajuster les SKU`
3. Vérifie qu'il reste des lignes valides (`RESOLVED`, qty > 0)
4. Clique `Ajouter au stock boutique`
5. Résultat attendu:
   - statut `APPLIED`
   - bannière succès

## 9.4 Vérifier retrait de stock (Rollback)

1. Sur une réception `APPLIED`, clique `Retirer le stock`
2. Résultat attendu:
   - statut `ROLLED_BACK`
   - bannière succès
   - retrait exécuté avec inverse exact des deltas

## 9.5 Vérifier filtrage multi-boutiques

1. Reviens dashboard
2. Sélectionne `Boutique Toulon`
3. Observe les réceptions affichées
4. Passe à `Boutique Chicago`
5. Résultat attendu:
   - liste différente selon location
   - persistance de sélection cohérente

---

## 10) Dépannage local rapide

## 10.1 `shopify: command not found`

1. Vérifie install CLI (section 3)
2. Vérifie PATH (section 4)
3. Rouvre terminal puis:

```bash
shopify version
```

## 10.2 Node incompatible

Si `node -v` affiche `v25.x`:

```bash
nvm use 22
node -v
```

## 10.3 Dépendances cassées

```bash
rm -rf node_modules package-lock.json
npm install
npm ci
```

## 10.4 Erreur scopes/autorisations

1. Exécute:
```bash
shopify app deploy
```
2. Réinstalle/réautorise l'app dans le Dev Store
3. Relance:
```bash
shopify app dev
```

---

## 11) Préparer la release GitHub (rappel)

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Puis:

```bash
git status
git add .
git commit -m "release"
git push
```

Vérifie avant push:

1. pas de `.env`
2. pas de secrets/API keys
3. pas de fichiers locaux sensibles

---

## 12) Déploiement VPS (résumé court)

Le détail complet est déjà dans:

- `README_PROD.md`
- `README_PROD_HARDENING.md`
- `deploy/nginx/import-stock.production.hardening.conf`

Étapes minimales:

1. installer Node 20/22 + nginx + pm2
2. cloner repo + `npm ci` + `npm run build`
3. créer `.env` prod (`chmod 600`)
4. `pm2 start npm -- run start`
5. config nginx + certbot SSL
6. vérifier `pm2 logs` + `nginx -t`

