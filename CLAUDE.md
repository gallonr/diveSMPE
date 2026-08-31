# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Description du projet

Application de catalogue et d'aide à la navigation pour les sites de plongée du club **SMPE** (Saint-Malo Plongée Emeraude), couvrant la **Baie de Saint-Malo**. Deux contextes d'utilisation :
- **Au centre de plongée** (PC) : preprocessing R/Python à partir de la BDD (Google Sheet) et du LiDAR
- **En mer sur tablette** : PWA consultée 100% offline (Service Worker)

Cycle de mise à jour : modifier la BDD → `build_all.R` → `./sync_docs.sh` → tablette sur WiFi → SW met à jour automatiquement.

## Architecture — les deux mondes

### 1. Pipeline preprocessing (centre)

`r/build_all.R` est le script maître. Il enchaîne :
1. **`r/02_process_bdd.R`** — Google Sheet (`GOOGLE_SHEET_BDD_ID` dans `r/config_local.R`, gitignoré, cf. `bdd/README.md`) → `data/sites.geojson` (60 sites, WGS84). **Ce fichier n'est plus publié** (ni committé, ni copié vers `docs/`) — il reste un artefact interne consommé uniquement par `01_process_las.R` (coordonnées + fusion `profMin`/`profMax`). La PWA récupère les métadonnées sites en direct via le Worker Cloudflare (`GET /sites`, relayant `google-apps-script/bdd.gs`), cf. `specs/2026-08-31-live-worker-data-design.md`.
2. **`r/01_process_las.R`** — LiDAR LITTO3D (~3,8 Go) → `data/bathy_sites.json` + miniatures PNG dans `pwa/data/thumbs/` (44 sites couverts)
3. **`r/03_generate_profile.R`** — profils bathymétriques + transects
4. **`r/04_marees_fes.py`** — atlas FES2022 → `data/marees.json` (PM/BM depuis aujourd'hui jusqu'au 2028-12-12, cf. `DATE_END`, 34 constituantes harmoniques)
5. **`r/05_courants_fes.py`** — courants FES2014/2022 → `data/courants_grid.json`
6. Copie automatique `data/` → `pwa/data/` pour les fichiers synchronisés (`FILES_TO_SYNC` dans `build_all.R:84`)
7. Validation end-to-end : nombre de features GeoJSON, jours dans `marees.json`, sites dans `bathy_sites.json`

Les miniatures PNG sont écrites **directement** dans `pwa/data/thumbs/` par `01_process_las.R` (pas de copie supplémentaire).

### 2. PWA offline-first (tablette)

`pwa/js/app.js` orchestre l'init dans un ordre précis (dépendances) :
`Marees → Bathy → Courants → Carte → Sites → Navigation (GPS) → Prevision`.

Modules sous `pwa/js/` (Vanilla JS, IIFE, pas de bundler) :
- `carte.js` — Leaflet + couches IGN/SHOM/OpenSeaMap
- `marees.js` / `mareesite.js` — courbe ±48h, fenêtre d'étale par site
- `bathy.js` — affichage MNT, transect interactif sur miniature
- `courants.js`, `port.js`, `prevision.js` — courants FES, état du port, prévision météo
- `meteo.js` — Open-Meteo (sans clé) + Météo-France via proxy Cloudflare
- `navigation.js` — Geolocation API, cap, ETA
- `sw.js` — Service Worker (Cache First statique + Network First API)
- `auth.js`, `tokens.js`, `secrets.js` — gestion clés API (cf. section Secrets)

### 3. Déploiement GitHub Pages

Le dossier **`docs/`** est la copie publiée sur GitHub Pages. **Ne jamais éditer `docs/` directement** — utiliser :

```bash
./sync_docs.sh "message de commit"
```

Ce script copie `pwa/{js,css,sw.js,manifest.json,index.html}` → `docs/`, corrige le lien guide-utilisateur, puis commit/push. Toute modif PWA passe par `pwa/` puis ce script.

### 4. Proxy Cloudflare Worker

`cloudflare-worker/mf-wms-proxy.js` — proxy WMS Météo-France (clé API serveur, CORS), relais retour d'expérience et authentification (Apps Script), et depuis le 2026-08-31 :
- `GET /sites` — relais `google-apps-script/bdd.gs` (lecture Google Sheet BDD), transformé en GeoJSON. Remplace le fichier `sites.geojson` publié.
- `GET /marees` — sert `marees.json` (généré par `r/04_marees_fes.py`) depuis un binding KV (`MAREES_KV`), publié par `sync_docs.sh`. Remplace le fichier `marees.json` publié.

Ces deux routes existent pour éviter d'exposer ces données (BDD sites, prédictions de marées calibrées) dans le dépôt public GitHub Pages. Déploiement séparé via Wrangler.

## Commandes

```r
# Build complet (depuis racine projet, R ou Rscript)
source("r/build_all.R")
# ou
Rscript r/build_all.R
```

```bash
# PWA en local (dev)
cd pwa && npx http-server -p 8080

# Sync vers docs/ + commit + push (déploiement GitHub Pages)
./sync_docs.sh "feat: …"
```

Prérequis : R ≥ 4.3 avec `lidR`, `terra`, `sf`, `googlesheets4`, `jsonlite` ; Python (`.venv/`) avec `pyfes` pour FES2022.

## Service Worker — versioning

Le SW (`pwa/sw.js`) utilise une constante `VERSION` (ex: `'v16'`). **Toute modification de la liste `ASSETS_STATIQUES` ou d'un fichier statique listé doit s'accompagner d'un bump de `VERSION`** — sinon les tablettes ne rechargent pas le cache. Bump aussi quand on ajoute un nouveau module JS.

L'ordre de chargement dans `app.js` doit rester cohérent avec les dépendances (Courants doit précéder Carte car `Carte.init()` consulte `Courants.isDisponible()`).

## Données — fichiers volumineux non commités

Voir `.gitignore`. À ne jamais commiter :
- `las/` (~3,8 Go LiDAR LITTO3D)
- `fes2022/` (atlas marées CNES)
- `currents/` (atlas courants FES)
- `data/tiles/`, `data/*.tif*` (sorties intermédiaires)
- `pwa/js/secrets.js`, `pwa/js/tokens.js`, équivalents `docs/js/`
- `bdd/bddAtlasPlongeeSMPE.xlsx`, `relevesGNSS/siteSMPE21042026.xlsx` (BDD sites — vit désormais dans un Google Sheet, cf. `bdd/README.md`), `r/config_local.R`
- `data/sites.geojson`, `pwa/data/sites.geojson`, `docs/data/sites.geojson`, `data/marees.json`, `pwa/data/marees.json`, `docs/data/marees.json` (données non publiques désormais servies en live par le Worker — `data/sites.geojson`/`pwa/data/sites.geojson` restent générés localement comme entrée du pipeline LiDAR, cf. `specs/2026-08-31-live-worker-data-design.md`)

## Secrets / tokens

`pwa/js/secrets.js.example` est le template versionné. Le vrai `secrets.js` (clé Météo-France notamment) reste local. `tokens.js` est généré côté client. Lors du sync vers `docs/`, ces fichiers ne sont pas copiés (ils doivent être déposés manuellement côté hébergement, ou — préférable — les appels passent par le worker Cloudflare).

## Conventions

- **Vanilla JS uniquement** dans `pwa/` — pas de React/Vue, pas de bundler. Modules en pattern IIFE (`const Module = (() => { ... })()`).
- **R** est le domaine de l'utilisateur ; le frontend JS lui est moins familier — privilégier la simplicité.
- Le Service Worker n'est servi qu'en HTTPS ou localhost (contrainte navigateur).
- Validation systématique en fin de `build_all.R` — un build avec features manquantes échoue explicitement.

## Contexte métier

- Club SMPE — Saint-Malo Plongée Emeraude, Baie de Saint-Malo (Manche)
- Utilisateurs : moniteurs et plongeurs du club
- Contrainte clé : **fonctionnement offline en mer** (4G inégale)
- Mise à jour : au centre, sur WiFi, avant la sortie
