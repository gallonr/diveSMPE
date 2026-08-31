# Design — Données sites et marées servies en live via le Worker

Date : 2026-08-31
Contexte : discussion initiale autour de la simplification du modèle offline-first, la connectivité 4G/internet étant désormais fiable dans la Baie de Saint-Malo (peu de zones d'ombre). Deux objectifs distincts s'y sont ajoutés en cours de discussion : (1) rafraîchir les métadonnées sites sans passer par le cycle `build_all.R` → `sync_docs.sh` → rechargement SW sur tablette, et (2) sortir `sites.geojson` et `marees.json` du dépôt GitHub public pour empêcher leur réutilisation par des tiers (autres clubs/sites).

## Problème

Aujourd'hui, `sites.geojson` (métadonnées BDD + `profMin`/`profMax` fusionnés par le pipeline LiDAR) et `marees.json` (prédictions FES2022 calibrées SHOM, jusqu'à fin 2028) sont générés par `build_all.R`, committés dans `pwa/data/` et `docs/data/`, et servis comme fichiers statiques publics sur GitHub Pages — donc téléchargeables par n'importe qui à l'URL du repo. Toute mise à jour de la BDD (ajout de site, correction) nécessite en plus tout le cycle build + sync + attente que le Service Worker détecte la nouvelle version en cache sur chaque tablette.

## Décisions

- Les **métadonnées sites** (nom, description, type, mouillage, coordonnées...) sont désormais **récupérées en direct** à chaque chargement de l'appli, via un relais Cloudflare Worker → Google Apps Script → Google Sheet — plus de fichier `sites.geojson` publié ni committé.
- Les **prédictions de marées** (`marees.json`) sont **hébergées dans un Cloudflare KV** (namespace privé attaché au Worker) plutôt que committées dans le dépôt public. Le calcul FES2022 lui-même reste inchangé (script Python local).
- Le pipeline LiDAR (`01_process_las.R`) dépend de `data/sites.geojson` en **entrée** (coordonnées + liste des `siteID` à échantillonner) — `02_process_bdd.R` reste donc dans `build_all.R`, mais son résultat devient un **artefact strictement local**, jamais commité ni publié.
- `bathy_sites.json` (déjà `{siteID, profMin, profMax}`) et `courants_grid.json` restent générés et publiés exactement comme aujourd'hui — ce sont des calculs lourds (LiDAR, FES2014/2022) qui ne peuvent pas être recalculés à la demande.
- Niveau de protection retenu pour `/sites` et `/marees` : **hors dépôt public + CORS restreint au domaine de l'appli**, sans vérification de session utilisateur côté Worker (jugé suffisant — l'objectif est d'empêcher la réutilisation passive par des tiers, pas de bloquer un acteur déterminé faisant des requêtes directes).
- Authentification Worker → Google Sheet : réutilisation du pattern **Apps Script Web App + secret partagé** déjà en place pour `auth.gs`/`retour-experience.gs`, plutôt qu'un service account Google Cloud (pas de nouvelle mécanique de credential à gérer).
- Fallback réseau : les deux nouvelles routes sont traitées en **Network First + cache de secours** dans le Service Worker, comme la route Open-Meteo existante — pas de mode "aucun fallback".

## Flux de données

```
Google Sheet (onglet "site")
   ├─→ r/02_process_bdd.R (PC, appelé par build_all.R)
   │      → data/sites.geojson (artefact LOCAL uniquement —
   │        jamais commité/publié, sert d'entrée à 01_process_las.R)
   │
   └─→ google-apps-script/bdd.gs (nouveau, Web App liée au Sheet)
          ↕ HTTPS + secret partagé (BDD_APPSCRIPT_SECRET)
       cloudflare-worker/mf-wms-proxy.js — route GET /sites
          (normalise : mouillage, type, priorité — logique portée
           depuis 02_process_bdd.R)
          ↕ CORS restreint (gallonr.github.io / localhost)
       pwa/js/sites.js — fetch(CONFIG.DATA.sites) → merge profMin/profMax
          depuis bathy_sites.json (Bathy.init(), déjà chargé avant Sites.init())
          ↕ intercepté par
       pwa/sw.js — Network First + fallback cache (comme Open-Meteo)

r/04_marees_fes.py (PC, inchangé)
   → data/marees.json → upload Cloudflare KV (wrangler kv key put, via sync_docs.sh)
       cloudflare-worker/mf-wms-proxy.js — route GET /marees (lit le KV)
          ↕ CORS restreint
       pwa/js/marees.js — fetch(CONFIG.DATA.marees), inchangé sinon
          ↕ intercepté par pwa/sw.js — Network First + fallback cache
```

## Composants — nouveaux

### `google-apps-script/bdd.gs`

Même pattern que `auth.gs`/`retour-experience.gs` : script lié au Sheet, `doPost(e)` vérifie le secret transmis dans le corps JSON, lit l'onglet `site`, renvoie les lignes brutes en JSON. Aucune logique métier ici — un simple relais authentifié.

### Worker `GET /sites`

Appelle `BDD_APPSCRIPT_URL` (avec `BDD_APPSCRIPT_SECRET`), reçoit les lignes brutes du Sheet, puis construit une `FeatureCollection` GeoJSON valide :
- géométrie `Point` depuis `latitude`/`longitude`,
- validation du vocabulaire contrôlé `mouillage` (`fixe`/`ancre`/`gueuse`/vide), reprise de la logique de `r/02_process_bdd.R`,
- conversion booléenne du champ priorité,
- toutes les autres colonnes du Sheet recopiées telles quelles en `properties`.

CORS restreint comme les routes existantes (`ALLOWED_ORIGINS`).

### Worker `GET /marees`

Lit la clé KV (binding `MAREES_KV`) et renvoie le JSON tel quel, CORS restreint. Pas de transformation — le fichier est déjà la sortie finale de `04_marees_fes.py`.

### Nouveaux secrets/bindings Worker

À ajouter dans `wrangler.toml` et le dashboard Cloudflare :
- `BDD_APPSCRIPT_URL`, `BDD_APPSCRIPT_SECRET`
- Binding KV `MAREES_KV`

## Composants modifiés

### `pwa/js/config.js`

`CONFIG.DATA.sites` et `CONFIG.DATA.marees` pointent vers `${CONFIG.RETOUR_EXPERIENCE.workerUrl}/sites` et `${CONFIG.RETOUR_EXPERIENCE.workerUrl}/marees` au lieu de chemins locaux (`CONFIG.DATA.bathy` reste inchangé, local).

### `pwa/js/sites.js`

`init()` : le `fetch` cible désormais l'URL Worker (logique de parsing identique par ailleurs). Après réception du GeoJSON, fusion de `profMin`/`profMax` dans chaque feature depuis les données déjà chargées par le module `Bathy` (par `siteID`) avant `_afficherListe` — seul vrai changement de logique de ce chantier côté PWA. `Bathy` doit exposer un accès par `siteID` (nouvel accesseur si absent).

### `pwa/sw.js`

- Retrait de `BASE + 'data/sites.geojson'` et `BASE + 'data/marees.json'` de `ASSETS_STATIQUES`.
- Nouvelle branche dans le handler `fetch` : si `url.hostname` correspond au Worker et le path est `/sites` ou `/marees` → `_networkFirst(event.request, CACHE_DYNAMIC)` (identique au traitement Open-Meteo).
- Bump `VERSION`.

### `sync_docs.sh`

- Retrait des lignes `cp pwa/data/sites.geojson docs/data/sites.geojson` et `cp pwa/data/marees.json docs/data/marees.json`.
- Ajout d'une étape `wrangler kv key put --binding=MAREES_KV marees "$(cat pwa/data/marees.json)"` (ou équivalent) pour publier la dernière version dans le KV.

### `r/build_all.R`

- `02_process_bdd.R` reste appelé (entrée nécessaire à `01_process_las.R`).
- La validation end-to-end (étape 5.4) ne considère plus `sites.geojson` comme un livrable public à vérifier dans `docs/` — uniquement comme artefact interne présent dans `data/`/`pwa/data/`.

### `.gitignore`

Ajout de `data/sites.geojson`, `pwa/data/sites.geojson`, `docs/data/sites.geojson`, et `data/marees.json`/`pwa/data/marees.json`/`docs/data/marees.json` (le calcul Python local reste, mais son fichier de sortie n'est plus commité). Les fichiers actuellement suivis sont retirés du suivi git (`git rm --cached`) sans suppression locale.

## Sécurité

- Secret OAuth Google du compte perso (utilisé par `googlesheets4::gs4_auth()` dans `r/02_process_bdd.R`) inchangé — usage local uniquement, hors du périmètre de ce chantier.
- `BDD_APPSCRIPT_SECRET` et l'URL du Web App Apps Script ne sont jamais exposés côté client — uniquement dans les variables d'environnement du Worker, comme `AUTH_APPSCRIPT_SECRET`/`APPSCRIPT_SECRET` déjà en place.
- Le KV `marees.json` n'est accessible qu'au Worker (pas de binding public).
- Niveau de protection assumé : CORS + absence du dépôt public. Ce n'est pas une authentification stricte (une requête directe au Worker avec le bon hostname reste possible) — jugé suffisant pour l'objectif (empêcher la réutilisation passive par des tiers), l'appli exigeant déjà une connexion (`Auth.init` bloque `App.init`) pour le reste du parcours utilisateur.

## Fallback / gestion des erreurs

Si le Worker, l'Apps Script ou le KV sont injoignables : le Service Worker sert la dernière réponse mise en cache (stratégie Network First + fallback déjà utilisée pour Open-Meteo) — dégradation cohérente avec le reste de l'appli, pas de nouvel état d'erreur à gérer.

## Hors périmètre

- Pas d'authentification de session côté Worker pour `/sites`/`/marees` (voir Sécurité).
- Pas de changement au pipeline `01_process_las.R` / `03_generate_profile.R` / bathymétrie.
- Pas de changement au calcul FES2022/FES2014 (marées, courants) — seule la distribution du résultat change pour `marees.json`.
- Pas d'édition des données sites depuis la PWA — reste géré uniquement via le Google Sheet.

## Plan de test manuel

1. Déployer `bdd.gs` en Web App, configurer `BDD_APPSCRIPT_URL`/`BDD_APPSCRIPT_SECRET` dans le Worker, vérifier `curl` sur `/sites` renvoie une `FeatureCollection` valide avec les mêmes sites que le Sheet.
2. Publier `marees.json` dans le KV, vérifier `curl` sur `/marees` renvoie le JSON attendu.
3. Modifier une ligne du Sheet (ex. description d'un site) et vérifier que le changement apparaît dans l'appli au rechargement, **sans** `build_all.R` ni `sync_docs.sh`.
4. Vérifier que le filtre profondeur (`profMin`/`profMax`) fonctionne toujours à l'identique après le passage au fetch live + merge côté client.
5. Couper le réseau après un premier chargement réussi : vérifier que le Service Worker sert bien la liste des sites et les marées en cache (pas d'écran vide).
6. Vérifier que `data/sites.geojson`, `pwa/data/sites.geojson`, `docs/data/sites.geojson`, `marees.json` publié n'apparaissent plus dans `git status` après un `build_all.R` + `sync_docs.sh` complet.
7. Lancer `Rscript r/build_all.R` de bout en bout : vérifier que `01_process_las.R` fonctionne toujours normalement (lit bien `data/sites.geojson` local).
