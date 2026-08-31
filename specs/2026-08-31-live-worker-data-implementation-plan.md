# Données sites/marées servies en live via le Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servir les métadonnées sites et les prédictions de marées en direct depuis le Worker Cloudflare (relayant un Google Sheet et un KV), au lieu de fichiers `sites.geojson`/`marees.json` committés et publiés sur GitHub Pages.

**Architecture:** Un nouvel Apps Script (`bdd.gs`) lié au Google Sheet expose l'onglet `site` en JSON, relayé par une nouvelle route Worker `GET /sites` qui le transforme en GeoJSON (logique portée depuis `r/02_process_bdd.R`). `marees.json` est publié dans un Cloudflare KV et servi par une nouvelle route `GET /marees`. Le PWA fetch ces deux routes au lieu de fichiers locaux ; `sites.js` fusionne `profMin`/`profMax` côté client depuis `bathy_sites.json` (inchangé). Le Service Worker traite les deux nouvelles routes en Network First + fallback cache. Le pipeline LiDAR garde besoin de `data/sites.geojson` en interne (jamais publié).

**Tech Stack:** Google Apps Script (JS), Cloudflare Workers (JS) + Workers KV, Vanilla JS (PWA), R (`build_all.R`), Bash (`sync_docs.sh`).

**Spec:** `specs/2026-08-31-live-worker-data-design.md`

## Global Constraints

- Ce dépôt n'a pas de suite de tests automatisée pour le JS/R/Apps Script — la vérification de chaque tâche se fait manuellement (curl, console navigateur), comme dans les plans précédents (`specs/2026-07-31-retour-experience-implementation-plan.md`).
- Toute modification d'un fichier statique servi par `pwa/sw.js` ou de la liste `ASSETS_STATIQUES` doit s'accompagner d'un bump de `VERSION` dans `pwa/sw.js` (règle du `CLAUDE.md` du projet).
- Aucun secret (Apps Script, Worker) ne doit jamais apparaître dans un fichier sous `pwa/` ou `docs/` (code client public).
- `bathy_sites.json` et `courants_grid.json` ne sont pas touchés par ce plan.
- URL du Worker existant : `https://mf-wms-proxy.reg-gallon.workers.dev` (déjà dans `CONFIG.RETOUR_EXPERIENCE.workerUrl` / `CONFIG.AUTH.workerUrl`).

---

### Task 1: Apps Script `bdd.gs` — relais lecture Google Sheet

**Files:**
- Create: `google-apps-script/bdd.gs`

**Interfaces:**
- Consumes: rien (nouveau fichier).
- Produces: Web App déployée, `doPost(e)` répond `{ ok: boolean, rows: object[], error?: string }` où chaque objet de `rows` a une clé par en-tête de colonne de l'onglet `site` du Sheet (ex. `{siteID: "SR001", siteNom: "...", latitude: 48.68, longitude: -2.02, mouillage: "fixe", prioritePrevision: "VRAI", ...}`). Consommé par Task 2.

- [ ] **Step 1: Écrire `bdd.gs`**

```js
/**
 * bdd.gs — Google Apps Script Web App
 * Relais lecture de l'onglet "site" du Google Sheet BDD (même Sheet que
 * auth.gs / retour-experience.gs, ou un Sheet dédié — cf. bdd/README.md).
 * Appelé uniquement par le Worker Cloudflare (route GET /sites), jamais
 * directement par la PWA.
 *
 * Déploiement :
 *  1. https://script.google.com/ → Nouveau projet, coller ce fichier
 *     (ou l'ajouter au projet Apps Script existant lié au même Sheet).
 *  2. Fichier > Propriétés du projet > Propriétés du script, ajouter :
 *       BDD_APPSCRIPT_SECRET = <secret partagé avec le Worker Cloudflare>
 *       SHEET_ID              = <ID du Google Sheet BDD (dans son URL)>
 *  3. L'onglet "site" doit exister avec les colonnes décrites dans
 *     bdd/README.md (première ligne = en-têtes).
 *  4. Déployer > Nouveau déploiement > Type "Application Web" :
 *       Exécuter en tant que : Moi
 *       Qui a accès : Tout le monde
 *  5. Copier l'URL de déploiement (se terminant par /exec) → variable
 *     d'environnement BDD_APPSCRIPT_URL du Worker Cloudflare (jamais dans
 *     le code client de la PWA).
 */

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty('BDD_APPSCRIPT_SECRET');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _respond(false, null, 'JSON invalide');
  }

  // Note: comparaison non constant-time — acceptable pour ce modèle de
  // menace interne club (même choix que retour-experience.gs).
  if (!expectedSecret || payload.secret !== expectedSecret) {
    return _respond(false, null, 'Secret invalide');
  }

  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return _respond(false, null, 'SHEET_ID non configuré');

  try {
    const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('site');
    if (!sheet) return _respond(false, null, 'Onglet site introuvable');

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return _respond(true, [], null);

    const headers = values[0];
    const rows = values.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

    return _respond(true, rows, null);
  } catch (err) {
    return _respond(false, null, 'Erreur lecture Sheet : ' + err.message);
  }
}

function _respond(ok, rows, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok, rows: rows || [], error: error || undefined }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Déployer et configurer**

Suivre les 5 étapes du commentaire d'en-tête ci-dessus (créer/coller le script, définir les deux propriétés de script, déployer en Web App "Tout le monde"/"Exécuter en tant que Moi"). Noter l'URL `/exec` obtenue — nécessaire pour Task 2.

- [ ] **Step 3: Vérifier manuellement**

```bash
curl -s -X POST "<URL_DEPLOIEMENT>/exec" \
  -H "Content-Type: application/json" \
  -d '{"secret":"<BDD_APPSCRIPT_SECRET>"}'
```

Attendu : `{"ok":true,"rows":[{"siteID":"...","siteNom":"...",...}, ...]}` avec autant d'entrées que de lignes dans l'onglet `site`. Vérifier aussi qu'un secret erroné renvoie `{"ok":false,"error":"Secret invalide"}`.

- [ ] **Step 4: Commit**

```bash
git add google-apps-script/bdd.gs
git commit -m "feat: ajoute bdd.gs — relais Apps Script lecture Sheet BDD"
```

---

### Task 2: Worker `GET /sites` — relais + normalisation GeoJSON

**Files:**
- Modify: `cloudflare-worker/mf-wms-proxy.js`

**Interfaces:**
- Consumes: Web App `bdd.gs` déployée (Task 1), répond `{ok, rows, error?}` avec les colonnes `siteID, siteNom, latitude, longitude, typeSite, accessibilite, typePlongee, niveauPlongee, accesVent, houle, mouillage, maree, tpsEtale, commentaire, photoSite, prioritePrevision`.
- Produces: route `GET /sites` répondant une `FeatureCollection` GeoJSON — `{type:"FeatureCollection", features:[{type:"Feature", geometry:{type:"Point", coordinates:[lon,lat]}, properties:{siteID, siteNom, latitude, longitude, typeSite, accessibilite, typePlongee, niveauPlongee, accesVent, houle, mouillage, maree, tpsEtale, commentaire, photoSite, prioritePrevision:boolean}}, ...]}`. Consommé par Task 4/5 (client).

- [ ] **Step 1: Ajouter la constante de colonnes et la fonction de normalisation**

Ajouter en haut du fichier, après `MF_ENDPOINTS` :

```js
// ── Colonnes retenues pour /sites — miroir de cols_voulues dans r/02_process_bdd.R ──
const SITE_COLUMNS = [
  'siteID', 'siteNom',
  'latitude', 'longitude',
  'typeSite', 'accessibilite', 'typePlongee', 'niveauPlongee',
  'accesVent', 'houle', 'mouillage', 'maree', 'tpsEtale',
  'commentaire', 'photoSite', 'prioritePrevision',
];

// Convertit les lignes brutes du Sheet (rows de bdd.gs) en FeatureCollection GeoJSON.
function _buildSitesGeoJSON(rows) {
  const features = [];
  for (const row of rows) {
    const lat = parseFloat(row.latitude);
    const lon = parseFloat(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // sans coordonnées, exclu comme côté R

    const properties = {};
    for (const col of SITE_COLUMNS) {
      let val = row[col];
      if (typeof val === 'string') {
        val = val.trim();
        if (val === '') val = null;
      }
      properties[col] = (val === undefined || val === '') ? null : val;
    }
    properties.latitude = lat;
    properties.longitude = lon;
    properties.prioritePrevision = ['VRAI', 'TRUE', '1'].includes(
      String(row.prioritePrevision || '').trim().toUpperCase()
    );

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties,
    });
  }
  return { type: 'FeatureCollection', features };
}
```

- [ ] **Step 2: Ajouter le handler de route**

Ajouter après `handleAuth` :

```js
// ── Route /sites — relais vers Google Apps Script (bdd.gs) ───────
async function handleSites(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
  if (!env.BDD_APPSCRIPT_URL || !env.BDD_APPSCRIPT_SECRET) {
    return new Response('Route non configurée (BDD_APPSCRIPT_URL/BDD_APPSCRIPT_SECRET manquants)', { status: 500, headers: corsHeaders });
  }

  let gasJson;
  try {
    const gasRes = await fetch(env.BDD_APPSCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.BDD_APPSCRIPT_SECRET }),
    });
    gasJson = await gasRes.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Apps Script injoignable' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!gasJson.ok) {
    return new Response(JSON.stringify({ error: gasJson.error || 'Erreur Apps Script' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const geojson = _buildSitesGeoJSON(gasJson.rows);

  return new Response(JSON.stringify(geojson), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 3: Router `/sites` dans `fetch()`**

Dans le bloc `// ── Routing ──` de l'export `fetch`, ajouter avant le fallback `MF_ENDPOINTS` :

```js
    if (path === 'sites') {
      return handleSites(request, env, corsHeaders);
    }
```

- [ ] **Step 4: Configurer les secrets Worker**

```bash
cd cloudflare-worker
wrangler secret put BDD_APPSCRIPT_URL
wrangler secret put BDD_APPSCRIPT_SECRET
```

Coller respectivement l'URL `/exec` et le secret définis en Task 1.

- [ ] **Step 5: Déployer et vérifier manuellement**

```bash
cd cloudflare-worker
wrangler deploy
curl -s "https://mf-wms-proxy.reg-gallon.workers.dev/sites" \
  -H "Origin: https://gallonr.github.io"
```

Attendu : une `FeatureCollection` GeoJSON avec un `Feature` par site ayant des coordonnées valides, `properties.siteID` rempli, `properties.prioritePrevision` en booléen.

- [ ] **Step 6: Commit**

```bash
git add cloudflare-worker/mf-wms-proxy.js
git commit -m "feat: ajoute route Worker GET /sites (relais Apps Script bdd.gs)"
```

---

### Task 3: Worker `GET /marees` — relais KV

**Files:**
- Modify: `cloudflare-worker/mf-wms-proxy.js`
- Modify: `cloudflare-worker/wrangler.toml`

**Interfaces:**
- Consumes: rien (lit un binding KV `MAREES_KV`, clé `marees`, valeur = contenu texte de `marees.json`).
- Produces: route `GET /marees` répondant le JSON stocké tel quel. Consommé par Task 4 (client).

- [ ] **Step 1: Créer le namespace KV**

```bash
cd cloudflare-worker
wrangler kv namespace create MAREES_KV
```

Noter l'`id` renvoyé par la commande.

- [ ] **Step 2: Ajouter le binding dans `wrangler.toml`**

```toml
name = "mf-wms-proxy"
main = "mf-wms-proxy.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "MAREES_KV"
id = "<id renvoyé par la commande précédente>"
```

- [ ] **Step 3: Ajouter le handler de route**

Ajouter dans `cloudflare-worker/mf-wms-proxy.js`, après `handleSites` :

```js
// ── Route /marees — relais KV (marees.json publié par sync_docs.sh) ──
async function handleMarees(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
  if (!env.MAREES_KV) {
    return new Response('Route non configurée (binding MAREES_KV manquant)', { status: 500, headers: corsHeaders });
  }

  const json = await env.MAREES_KV.get('marees');
  if (!json) {
    return new Response(JSON.stringify({ error: 'Données marées non disponibles' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(json, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 4: Router `/marees` dans `fetch()`**

Juste après le bloc ajouté pour `/sites` en Task 2 :

```js
    if (path === 'marees') {
      return handleMarees(request, env, corsHeaders);
    }
```

- [ ] **Step 5: Publier une première version et déployer**

```bash
cd cloudflare-worker
wrangler kv key put "marees" --binding=MAREES_KV --path=../pwa/data/marees.json --remote
wrangler deploy
```

Note : si la commande est rejetée par votre version de `wrangler`, lancer `wrangler kv key put --help` pour confirmer le nom exact des options (`--binding`/`--namespace-id`, `--path`, `--remote` peuvent différer selon la version installée) et ajuster en conséquence.

- [ ] **Step 6: Vérifier manuellement**

```bash
curl -s "https://mf-wms-proxy.reg-gallon.workers.dev/marees" \
  -H "Origin: https://gallonr.github.io"
```

Attendu : le contenu JSON identique à `pwa/data/marees.json`.

- [ ] **Step 7: Commit**

```bash
git add cloudflare-worker/mf-wms-proxy.js cloudflare-worker/wrangler.toml
git commit -m "feat: ajoute route Worker GET /marees (relais KV)"
```

---

### Task 4: `config.js` — pointer vers le Worker

**Files:**
- Modify: `pwa/js/config.js`

**Interfaces:**
- Consumes: routes Worker `/sites` et `/marees` (Task 2, 3), URL de base `CONFIG.RETOUR_EXPERIENCE.workerUrl` (déjà définie plus bas dans le même fichier).
- Produces: `CONFIG.DATA.sites` et `CONFIG.DATA.marees` — URLs absolues. Consommé par Task 5 (`sites.js`) et `marees.js` (fetch inchangé par ailleurs).

- [ ] **Step 1: Retirer `sites`/`marees` du bloc `DATA` littéral**

Dans `pwa/js/config.js`, remplacer (lignes 6-11) :

```js
  DATA: {
    sites:  'data/sites.geojson',
    marees: 'data/marees.json',
    bathy:  'data/bathy_sites.json',   // profils transects LiDAR LITTO3D
  },
```

par :

```js
  DATA: {
    // sites et marees sont résolues plus bas (après CONFIG.RETOUR_EXPERIENCE),
    // sur le modèle de CONFIG.RETOUR_EXPERIENCE.bateaux — cf. bas de fichier.
    bathy: 'data/bathy_sites.json',   // profils transects LiDAR LITTO3D
  },
```

- [ ] **Step 2: Résoudre les URLs après la fermeture de `CONFIG`**

Repérer la ligne existante (fin du fichier) :

```js
CONFIG.RETOUR_EXPERIENCE.bateaux = CONFIG.PORT.bateaux.map(b => b.nom);
```

Ajouter juste après :

```js
// Données servies en live par le Worker (plus de fichiers statiques
// data/sites.geojson ni data/marees.json — cf. specs/2026-08-31-live-worker-data-design.md)
CONFIG.DATA.sites  = `${CONFIG.RETOUR_EXPERIENCE.workerUrl}/sites`;
CONFIG.DATA.marees = `${CONFIG.RETOUR_EXPERIENCE.workerUrl}/marees`;
```

- [ ] **Step 3: Vérifier manuellement**

Ouvrir `pwa/index.html` en local (`cd pwa && npx http-server -p 8080`), console navigateur :

```js
console.log(CONFIG.DATA.sites, CONFIG.DATA.marees);
```

Attendu : `https://mf-wms-proxy.reg-gallon.workers.dev/sites` et `.../marees`.

- [ ] **Step 4: Commit**

```bash
git add pwa/js/config.js
git commit -m "feat: CONFIG.DATA.sites/marees pointent vers le Worker"
```

---

### Task 5: `sites.js` — fusion `profMin`/`profMax` côté client

**Files:**
- Modify: `pwa/js/sites.js:19-43`

**Interfaces:**
- Consumes: `Bathy.get(siteID)` → `{siteID, profMin, profMax, transect}|null` (module `Bathy`, déjà chargé par `Bathy.init()` avant `Sites.init()` dans `app.js`).
- Produces: chaque `feature.properties` de `_geojson.features` porte désormais `profMin`/`profMax` (comme avant, mais fusionnés côté client au lieu d'être déjà présents dans le fichier fetché). Aucun changement d'interface publique de `Sites`.

- [ ] **Step 1: Ajouter la fusion après le chargement du GeoJSON**

Dans `pwa/js/sites.js`, fonction `init()`, remplacer :

```js
      const res = await fetch(CONFIG.DATA.sites);
      _geojson = await res.json();
      _sites = _geojson.features;
      console.log(`✅ ${_sites.length} sites chargés`);
```

par :

```js
      const res = await fetch(CONFIG.DATA.sites);
      _geojson = await res.json();
      _sites = _geojson.features;
      _fusionnerProfondeurs();
      console.log(`✅ ${_sites.length} sites chargés`);
```

- [ ] **Step 2: Ajouter la fonction `_fusionnerProfondeurs`**

Juste avant `function _majEtatsMaree() {` (ligne 45), ajouter :

```js
  // profMin/profMax viennent du pipeline LiDAR (bathy_sites.json), pas du
  // Sheet BDD relayé par le Worker — fusion côté client par siteID.
  function _fusionnerProfondeurs() {
    if (typeof Bathy === 'undefined') return;
    _sites.forEach(f => {
      const entry = Bathy.get(f.properties.siteID);
      f.properties.profMin = entry ? entry.profMin : null;
      f.properties.profMax = entry ? entry.profMax : null;
    });
  }
```

- [ ] **Step 3: Vérifier manuellement**

En local, tablette ou navigateur : ouvrir la fiche d'un site couvert par le LiDAR (44 sites sur 60) et confirmer que la profondeur min/max s'affiche comme avant ; ouvrir un site non couvert et confirmer qu'aucune erreur JS n'apparaît (dégradation gracieuse, comme aujourd'hui). Vérifier aussi que le filtre profondeur (`_filtreProf` dans `app.js`) fonctionne toujours.

- [ ] **Step 4: Commit**

```bash
git add pwa/js/sites.js
git commit -m "feat: fusionne profMin/profMax depuis Bathy après fetch live des sites"
```

---

### Task 6: `sw.js` — routage Worker + retrait du precache

**Files:**
- Modify: `pwa/sw.js`

**Interfaces:**
- Consumes: hostname du Worker `mf-wms-proxy.reg-gallon.workers.dev` (déjà utilisé côté client via `CONFIG.RETOUR_EXPERIENCE.workerUrl`).
- Produces: `/sites` et `/marees` sur ce hostname traités en Network First + cache de secours, comme Open-Meteo.

- [ ] **Step 1: Retirer les deux fichiers de `ASSETS_STATIQUES`**

Supprimer ces deux lignes (elles ne sont plus générées/publiées) :

```js
  BASE + 'data/sites.geojson',
  BASE + 'data/marees.json',
```

- [ ] **Step 2: Ajouter le routage Worker dans le handler `fetch`**

Juste après le bloc `// ── API Open-Meteo (Network First, fallback cache) ──` :

```js
  // ── Worker Cloudflare — /sites et /marees (Network First, fallback cache) ──
  if (
    url.hostname === 'mf-wms-proxy.reg-gallon.workers.dev' &&
    (url.pathname.endsWith('/sites') || url.pathname.endsWith('/marees'))
  ) {
    event.respondWith(_networkFirst(event.request, CACHE_DYNAMIC));
    return;
  }
```

- [ ] **Step 3: Bumper `VERSION`**

```js
const VERSION = 'v57';
```

- [ ] **Step 4: Vérifier manuellement**

En local (`npx http-server` sur `pwa/`), DevTools > Application > Service Workers : confirmer l'installation de `smpe-static-v57` sans erreur. Onglet Network : recharger, couper le réseau, recharger à nouveau — confirmer que la liste des sites et les marées s'affichent depuis le cache (`(from ServiceWorker)` ou équivalent).

- [ ] **Step 5: Commit**

```bash
git add pwa/sw.js
git commit -m "feat: SW — /sites et /marees en Network First, retrait du precache statique, bump v57"
```

---

### Task 7: `sync_docs.sh` — retrait de la copie, publication KV

**Files:**
- Modify: `sync_docs.sh`

**Interfaces:**
- Consumes: `wrangler kv key put` (CLI, cf. Task 3 Step 5 pour la syntaxe exacte à vérifier localement).
- Produces: `docs/data/sites.geojson` et `docs/data/marees.json` ne sont plus mis à jour par ce script ; `marees.json` est publié dans le KV à chaque sync.

- [ ] **Step 1: Retirer les deux lignes de copie**

Supprimer :

```bash
cp pwa/data/sites.geojson     docs/data/sites.geojson
```

et

```bash
cp pwa/data/marees.json       docs/data/marees.json
```

(dans le bloc `# Données (générées par r/build_all.R)...`).

- [ ] **Step 2: Ajouter la publication KV**

Juste après le bloc `rsync -a --delete pwa/data/thumbs/ docs/data/thumbs/`, ajouter :

```bash
# Marées : publiées dans le KV Cloudflare (données non publiques, cf.
# specs/2026-08-31-live-worker-data-design.md) plutôt que committées.
if command -v wrangler >/dev/null 2>&1 && [ -f pwa/data/marees.json ]; then
    echo "🌊 Publication marees.json dans le KV Cloudflare..."
    (cd cloudflare-worker && wrangler kv key put "marees" --binding=MAREES_KV --path=../pwa/data/marees.json --remote)
else
    echo "⚠️  wrangler introuvable ou pwa/data/marees.json absent — publication KV ignorée."
fi
```

- [ ] **Step 3: Vérifier manuellement**

```bash
./sync_docs.sh "test: vérification sync sans sites.geojson/marees.json"
git show --stat HEAD | grep -E "sites\.geojson|marees\.json"
```

Attendu : aucune ligne affichée (ces fichiers ne sont plus dans le commit produit par le script). Vérifier aussi que le message "Publication marees.json..." s'affiche si `wrangler` est installé.

- [ ] **Step 4: Commit**

```bash
git add sync_docs.sh
git commit -m "feat: sync_docs.sh — retire sites.geojson/marees.json de docs/, publie marees.json en KV"
```

---

### Task 8: `build_all.R` — validation adaptée

**Files:**
- Modify: `r/build_all.R:157-232`

**Interfaces:**
- Consumes: rien de nouveau — `data/sites.geojson`/`pwa/data/sites.geojson` restent générés par `02_process_bdd.R`/`01_process_las.R` comme aujourd'hui (artefacts internes).
- Produces: la validation end-to-end ne considère plus `docs/data/sites.geojson`/`docs/data/marees.json` comme des livrables attendus.

- [ ] **Step 1: Retirer les entrées `docs/` inexistantes de `expected_files`**

Dans le bloc `Phase 5.4 — Validation`, remplacer :

```r
    expected_files <- c(
        file.path(DATA_DIR, "sites.geojson"),
        file.path(DATA_DIR, "bathy_sites.json"),
        file.path(DATA_DIR, "marees.json"),
        file.path(PWA_DATA_DIR, "sites.geojson"),
        file.path(PWA_DATA_DIR, "bathy_sites.json"),
        file.path(PWA_DATA_DIR, "marees.json")
    )
```

par :

```r
    # sites.geojson et marees.json ne sont plus publiés (docs/) — ils
    # restent des artefacts internes (data/, pwa/data/) consommés par
    # 01_process_las.R et par la publication KV du Worker (sync_docs.sh).
    expected_files <- c(
        file.path(DATA_DIR, "sites.geojson"),
        file.path(DATA_DIR, "bathy_sites.json"),
        file.path(DATA_DIR, "marees.json"),
        file.path(PWA_DATA_DIR, "sites.geojson"),
        file.path(PWA_DATA_DIR, "bathy_sites.json"),
        file.path(PWA_DATA_DIR, "marees.json")
    )
```

(Contenu identique — ces fichiers doivent toujours exister localement. Seul le commentaire change, pour ne pas laisser croire qu'ils sont publiés. Aucune ligne de validation à retirer : `bathy_sites.json` et les comptages restent valables tels quels.)

- [ ] **Step 2: Mettre à jour le commentaire d'en-tête `FILES_TO_SYNC_AVANT_LIDAR`**

Remplacer le commentaire (lignes 83-84) :

```r
# Fichiers à synchroniser data/ → pwa/data/ AVANT Phase 3 (LiDAR) — sites.geojson
# doit être frais quand 01_process_las.R le lit pour y fusionner profMin/profMax.
```

par :

```r
# Fichiers à synchroniser data/ → pwa/data/ AVANT Phase 3 (LiDAR) — sites.geojson
# doit être frais quand 01_process_las.R le lit pour y fusionner profMin/profMax.
# Ce fichier reste un artefact interne : il n'est plus publié dans docs/ ni
# lu par la PWA (qui récupère les métadonnées sites en live via le Worker,
# cf. specs/2026-08-31-live-worker-data-design.md). sync_docs.sh ne le copie
# donc plus vers docs/data/.
```

- [ ] **Step 3: Vérifier manuellement**

```bash
Rscript r/build_all.R
```

Attendu : le build se termine par `✅ BUILD COMPLET — Toutes les étapes OK`, `data/sites.geojson` et `pwa/data/sites.geojson` existent toujours (nécessaires à `01_process_las.R`).

- [ ] **Step 4: Commit**

```bash
git add r/build_all.R
git commit -m "docs: build_all.R — clarifie que sites.geojson reste un artefact interne"
```

---

### Task 9: `.gitignore` — retirer les fichiers publics du suivi

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Consumes: rien.
- Produces: `data/sites.geojson`, `pwa/data/sites.geojson`, `docs/data/sites.geojson`, `data/marees.json`, `pwa/data/marees.json`, `docs/data/marees.json` ne sont plus suivis par git (mais restent présents localement).

- [ ] **Step 1: Ajouter les entrées au `.gitignore`**

Dans le bloc `# --- BDD sites — désormais dans un Google Sheet, plus dans le dépôt ---`, ajouter à la suite :

```
# --- sites.geojson / marees.json — servis en live via le Worker, plus publiés ---
# (cf. specs/2026-08-31-live-worker-data-design.md)
data/sites.geojson
pwa/data/sites.geojson
docs/data/sites.geojson
data/marees.json
pwa/data/marees.json
docs/data/marees.json
```

- [ ] **Step 2: Retirer ces fichiers du suivi git (sans les supprimer localement)**

```bash
git rm --cached data/sites.geojson pwa/data/sites.geojson docs/data/sites.geojson \
                data/marees.json pwa/data/marees.json docs/data/marees.json
```

- [ ] **Step 3: Vérifier manuellement**

```bash
git status
```

Attendu : les six fichiers apparaissent comme supprimés du suivi (`deleted:`) dans le diff indexé, mais `ls data/ pwa/data/ docs/data/` montre qu'ils existent toujours sur disque. `git status` ne doit plus jamais les signaler après un futur `build_all.R`/`sync_docs.sh`.

- [ ] **Step 4: Commit**

`git rm --cached` (step 2) a déjà indexé la suppression des six fichiers —
ne pas refaire `git add` dessus, sous peine de les re-suivre.

```bash
git add .gitignore
git commit -m "chore: retire sites.geojson/marees.json du suivi git (données non publiques)"
```

---

### Task 10: `CLAUDE.md` — documenter la nouvelle architecture

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: rien.
- Produces: documentation à jour pour les futures sessions Claude Code sur ce projet.

- [ ] **Step 1: Mettre à jour la section "Pipeline preprocessing (centre)"**

Dans la liste numérotée du pipeline (`r/build_all.R`), ajuster le point 1 :

```markdown
1. **`r/02_process_bdd.R`** — Google Sheet (`GOOGLE_SHEET_BDD_ID` dans `r/config_local.R`, gitignoré, cf. `bdd/README.md`) → `data/sites.geojson` (60 sites, WGS84). **Ce fichier n'est plus publié** (ni committé, ni copié vers `docs/`) — il reste un artefact interne consommé uniquement par `01_process_las.R` (coordonnées + fusion `profMin`/`profMax`). La PWA récupère les métadonnées sites en direct via le Worker Cloudflare (`GET /sites`, relayant `google-apps-script/bdd.gs`), cf. `specs/2026-08-31-live-worker-data-design.md`.
```

- [ ] **Step 2: Mettre à jour la section "Proxy Cloudflare Worker"**

Remplacer :

```markdown
### 4. Proxy Cloudflare Worker

`cloudflare-worker/mf-wms-proxy.js` — proxy WMS Météo-France (clé API serveur, CORS). Déploiement séparé via Wrangler.
```

par :

```markdown
### 4. Proxy Cloudflare Worker

`cloudflare-worker/mf-wms-proxy.js` — proxy WMS Météo-France (clé API serveur, CORS), relais retour d'expérience et authentification (Apps Script), et depuis le 2026-08-31 :
- `GET /sites` — relais `google-apps-script/bdd.gs` (lecture Google Sheet BDD), transformé en GeoJSON. Remplace le fichier `sites.geojson` publié.
- `GET /marees` — sert `marees.json` (généré par `r/04_marees_fes.py`) depuis un binding KV (`MAREES_KV`), publié par `sync_docs.sh`. Remplace le fichier `marees.json` publié.

Ces deux routes existent pour éviter d'exposer ces données (BDD sites, prédictions de marées calibrées) dans le dépôt public GitHub Pages. Déploiement séparé via Wrangler.
```

- [ ] **Step 3: Mettre à jour la section "Données — fichiers volumineux non commités"**

Ajouter à la liste des fichiers à ne jamais commiter :

```markdown
- `data/sites.geojson`, `pwa/data/sites.geojson`, `docs/data/sites.geojson`, `data/marees.json`, `pwa/data/marees.json`, `docs/data/marees.json` (données non publiques désormais servies en live par le Worker — `data/sites.geojson`/`pwa/data/sites.geojson` restent générés localement comme entrée du pipeline LiDAR, cf. `specs/2026-08-31-live-worker-data-design.md`)
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — documente les routes Worker /sites et /marees"
```

---

### Task 11: Vérification de bout en bout

**Files:** aucun fichier modifié — vérification uniquement.

**Interfaces:**
- Consumes: toutes les tâches précédentes déployées (Apps Script, Worker, PWA).
- Produces: confirmation que le chantier fonctionne en conditions réelles.

- [ ] **Step 1: Modifier une ligne du Google Sheet**

Éditer la description ou le type de mouillage d'un site existant dans l'onglet `site` du Sheet.

- [ ] **Step 2: Recharger la PWA (sans build ni sync)**

Ouvrir `pwa/index.html` (local ou tablette), vider le cache navigateur si nécessaire pour forcer un fetch réseau, et vérifier que la modification apparaît dans la fiche du site — **sans** avoir lancé `Rscript r/build_all.R` ni `./sync_docs.sh`.

- [ ] **Step 3: Vérifier le fallback offline**

Charger la PWA une première fois avec réseau, couper le réseau (mode avion ou DevTools "Offline"), recharger : la liste des sites et les marées doivent toujours s'afficher (depuis le cache SW), pas d'écran vide.

- [ ] **Step 4: Vérifier le filtre profondeur**

Filtrer par profondeur sur un site couvert par le LiDAR et confirmer que le comportement est identique à avant ce chantier.

- [ ] **Step 5: Vérifier l'absence des fichiers publics**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://gallonr.github.io/diveSMPE/data/sites.geojson
curl -s -o /dev/null -w "%{http_code}\n" https://gallonr.github.io/diveSMPE/data/marees.json
```

Attendu : `404` pour les deux (fichiers plus publiés).

- [ ] **Step 6: Build complet de bout en bout**

```bash
Rscript r/build_all.R
./sync_docs.sh "sync: pipeline sans sites.geojson/marees.json publics"
```

Attendu : succès complet, `git status` propre après le push (les six fichiers listés en Task 9 restent absents du suivi).
