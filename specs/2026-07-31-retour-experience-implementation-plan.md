# Formulaire retour d'expérience post-plongée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Retour d'expérience post-plongée" form to the diveSMPE PWA that writes rows to a Google Sheet via a Cloudflare Worker proxy + Google Apps Script backend, with a local retry queue for network failures.

**Architecture:** PWA (`pwa/js/retourexperience.js`) POSTs the filled form as JSON to the existing Cloudflare Worker (`cloudflare-worker/mf-wms-proxy.js`, new `/retour-experience` route). The Worker injects a server-side secret and forwards to a Google Apps Script Web App (`google-apps-script/retour-experience.gs`), which validates the secret and appends a row to the "retours_plongee" sheet tab. On network failure, the client queues the submission in `localStorage` and retries on `online` / app load.

**Tech Stack:** Vanilla JS (IIFE modules, no bundler — existing project convention), Cloudflare Workers (plain JS, no wrangler.toml in this repo — manual dashboard deploy per existing `mf-wms-proxy.js` header comment), Google Apps Script (`.gs`, V8 runtime).

**Source spec:** `specs/2026-07-28-retour-experience-design.md` — read it before starting; this plan implements it task-by-task and does not repeat its rationale.

## Global Constraints

- **No test framework exists in this repo** (no `package.json`, no test runner) and none should be introduced. Verification for pure logic is done via a throwaway Node script run with `node` (works because `pwa/js/marees.js`'s IIFE only defines functions at top level — it does not touch `document` until a function is actually called, so `eval`-loading it in Node is safe as long as you never call `init()`/`_updateBandeau()`/etc.). Verification for UI/integration is manual, via `cd pwa && npx http-server -p 8080` + browser devtools, matching how every other feature in this app has been validated (see the spec's own "Plan de test manuel" section).
- **Vanilla JS only**, IIFE module pattern (`const X = (() => { ... return {...}; })();`), matching `pwa/js/cgu.js` / `pwa/js/meteo.js`.
- **French** for all user-facing strings, code comments follow existing sparse style (only non-obvious rationale, no docstring dumps).
- Every static file added to `pwa/` (new JS module) or any modification to a file listed in `ASSETS_STATIQUES` (`pwa/sw.js`) **requires a `VERSION` bump** in `pwa/sw.js` — this is a hard project rule (CLAUDE.md), not optional.
- **Never edit `docs/`** directly — it's the GitHub Pages deployment copy, synced only via `./sync_docs.sh`. This plan only touches `pwa/`, `cloudflare-worker/`, and a new `google-apps-script/` directory.
- Secrets (`APPSCRIPT_SECRET`, Apps Script Web App URL) are **never** present in client code (`pwa/js/*`) — only as Cloudflare Worker environment variables, exactly like `MF_TOKEN_PAAROME`/`MF_TOKEN_AROMEPI` already are.
- Reuse `CONFIG.PORT.bateaux` names (`Maclow`, `Cassiopée`, `Neptune`) for the boat list rather than re-declaring a parallel list with different casing.

---

### Task 1: `getEtaleProche(date)` in `marees.js`

**Files:**
- Modify: `pwa/js/marees.js:343-385` (public API section)

**Interfaces:**
- Consumes: existing private helpers `_hhmm2min(hhmm)` (marees.js:30-34) and public `getEntreePourDate(date)` (marees.js:346-350).
- Produces: `Marees.getEtaleProche(date)` → `{ type: 'PM'|'BM', heure: 'HH:MM', coeff: number|null, deltaMin: number, avantApres: 'avant'|'après'|"à l'étale" }` or `null`. Consumed by Task 7 (`retourexperience.js`).

- [ ] **Step 1: Add the function**

Insert just before the `return { init, ... }` line at the end of `pwa/js/marees.js` (currently line 384):

```js
  /**
   * Étale (PM ou BM) la plus proche d'une heure donnée.
   * Retourne { type: 'PM'|'BM', heure: 'HH:MM', coeff, deltaMin, avantApres }
   * ou null si les données marée du jour sont absentes.
   */
  function getEtaleProche(date) {
    const entree = getEntreePourDate(date);
    if (!entree) return null;

    const targetMin = date.getHours() * 60 + date.getMinutes();
    const candidats = [
      { key: 'PM1', type: 'PM' },
      { key: 'BM1', type: 'BM' },
      { key: 'PM2', type: 'PM' },
      { key: 'BM2', type: 'BM' },
      { key: 'BM3', type: 'BM' },
    ];

    let best = null;
    for (const c of candidats) {
      const t = _hhmm2min(entree[c.key + '_h']);
      if (t === null) continue;
      const delta = t - targetMin;
      if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
        best = { ...c, heure: entree[c.key + '_h'], coeff: entree[c.key + '_coeff'] ?? null, delta };
      }
    }
    if (!best) return null;

    return {
      type: best.type,
      heure: best.heure,
      coeff: best.coeff,
      deltaMin: Math.abs(best.delta),
      avantApres: best.delta > 0 ? 'avant' : (best.delta < 0 ? 'après' : "à l'étale"),
    };
  }
```

Then update the return statement (marees.js:384) from:
```js
  return { init, ouvrirModal, getData, getAujourd, getEntreePourDate, getHauteurAt, getHauteurActuelle, getExtremaJour };
```
to:
```js
  return { init, ouvrirModal, getData, getAujourd, getEntreePourDate, getHauteurAt, getHauteurActuelle, getExtremaJour, getEtaleProche };
```

- [ ] **Step 2: Verify against real data in the browser console**

`Marees._data` is a private closure variable with no test seam, and none should be added just to unit-test this (YAGNI — the spec doesn't call for a testing API). Verify through the public API against live data instead:

```bash
cd pwa && npx http-server -p 8080
```

Open `http://localhost:8080` in a browser, open devtools console, run:

```js
Marees.getEtaleProche(new Date())
```

Read the printed `entree` fields by also running `Marees.getAujourd()` in the same console — manually pick the PM1_h/BM1_h/PM2_h/BM2_h/BM3_h value closest (in minutes) to the current time, and confirm `getEtaleProche`'s `type`/`heure`/`deltaMin`/`avantApres` match your manual pick. Also test a specific future date within range, e.g. `Marees.getEtaleProche(new Date('2026-08-05T14:30:00'))`, cross-checked the same way using `Marees.getEntreePourDate(new Date('2026-08-05'))`.

- [ ] **Step 3: Commit**

```bash
git add pwa/js/marees.js
git commit -m "feat: ajoute getEtaleProche à marees.js pour le formulaire retour d'expérience"
```

---

### Task 2: `CONFIG.RETOUR_EXPERIENCE` in `config.js`

**Files:**
- Modify: `pwa/js/config.js` (add a new top-level config block, after the existing `PORT` block at line 116)

**Interfaces:**
- Produces: `CONFIG.RETOUR_EXPERIENCE.workerUrl`, `.bateaux`, `.etatMer`, `.vent`, `.courant` — consumed by Task 7 (`retourexperience.js`).

- [ ] **Step 1: Add the config block**

Insert after the closing `},` of the `PORT` block (`pwa/js/config.js:116`), before the `// ── Météo` comment:

```js
  // ── Retour d'expérience post-plongée ──────────────────────
  // URL du Worker Cloudflare (route /retour-experience) — à renseigner une
  // fois le Worker déployé (cf. cloudflare-worker/mf-wms-proxy.js).
  RETOUR_EXPERIENCE: {
    workerUrl: null,
    bateaux: null, // résolu juste après la fermeture de CONFIG (PORT.bateaux n'est pas encore accessible en tant que CONFIG.PORT ici)
    etatMer: [
      { degre: 0, label: 'Calme',       detail: '0 m' },
      { degre: 1, label: 'Ridée',       detail: '0–0,10 m' },
      { degre: 2, label: 'Belle',       detail: '0,10–0,50 m' },
      { degre: 3, label: 'Peu agitée',  detail: '0,50–1,25 m' },
      { degre: 4, label: 'Agitée',      detail: '1,25–2,50 m' },
    ],
    vent: [
      { code: 'calme', label: 'Calme / très léger', detail: '0–5 km/h' },
      { code: 'leger', label: 'Léger / petite brise', detail: '6–19 km/h' },
      { code: 'jolie', label: 'Jolie / bonne brise',  detail: '20–38 km/h' },
      { code: 'frais', label: 'Vent frais et plus',   detail: '> 39 km/h' },
    ],
    courant: [
      { code: 'aucun',  label: 'Pas de courant' },
      { code: 'modere', label: 'Modéré' },
      { code: 'fort',   label: 'Fort' },
    ],
  },
```

Then, immediately after the closing `};` of the `CONFIG` object (`pwa/js/config.js:161`, the line right before `// Clé de cache Service Worker`), add:

```js
CONFIG.RETOUR_EXPERIENCE.bateaux = CONFIG.PORT.bateaux.map(b => b.nom);
```

- [ ] **Step 2: Verify in Node**

```bash
node -e "
const fs = require('fs');
global.window = undefined;
eval(fs.readFileSync('pwa/js/config.js', 'utf8'));
console.log(CONFIG.RETOUR_EXPERIENCE.bateaux);
console.log(CONFIG.RETOUR_EXPERIENCE.etatMer.length, CONFIG.RETOUR_EXPERIENCE.vent.length, CONFIG.RETOUR_EXPERIENCE.courant.length);
"
```

Expected output:
```
[ 'Maclow', 'Cassiopée', 'Neptune' ]
5 4 3
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/config.js
git commit -m "feat: ajoute CONFIG.RETOUR_EXPERIENCE (échelles, bateaux, URL worker)"
```

---

### Task 3: Google Apps Script backend

**Files:**
- Create: `google-apps-script/retour-experience.gs`
- Create: `google-apps-script/README.md`

**Interfaces:**
- Produces: a Web App `doPost` endpoint accepting `POST { secret: string, data: {...21 fields...} }`, responding `200 { ok: true }` or `200 { ok: false, error: string }` (Apps Script Web Apps cannot return custom HTTP status codes — the body's `ok` field is the only signal, and the Worker in Task 4 must read it that way).
- Consumes: Script Properties `APPSCRIPT_SECRET` and `SHEET_ID`, and a sheet tab literally named `retours_plongee` with a header row matching `HEADERS` below (column order matters — `appendRow` writes positionally, not by header name).

- [ ] **Step 1: Write the script**

```js
/**
 * retour-experience.gs — Google Apps Script Web App
 * Reçoit les soumissions du formulaire "Retour d'expérience post-plongée"
 * (relayées par le Worker Cloudflare, jamais appelé directement par la PWA)
 * et les ajoute en ligne dans l'onglet "retours_plongee" du Google Sheet.
 *
 * Déploiement :
 *  1. https://script.google.com/ → Nouveau projet, coller ce fichier.
 *  2. Fichier > Propriétés du projet > Propriétés du script, ajouter :
 *       APPSCRIPT_SECRET = <secret partagé avec le Worker Cloudflare>
 *       SHEET_ID         = <ID du Google Sheet cible (dans son URL)>
 *  3. Dans le Sheet cible, créer un onglet nommé exactement "retours_plongee"
 *     avec une ligne d'en-tête reprenant HEADERS ci-dessous, dans le même ordre
 *     (appendRow() écrit par position, pas par nom de colonne).
 *  4. Déployer > Nouveau déploiement > Type "Application Web" :
 *       Exécuter en tant que : Moi
 *       Qui a accès : Tout le monde
 *  5. Copier l'URL de déploiement (se terminant par /exec) → variable
 *     d'environnement APPSCRIPT_URL du Worker Cloudflare (jamais dans le
 *     code client de la PWA).
 */

const HEADERS = [
  'timestampSoumission', 'datePlongee', 'siteID', 'siteNom', 'bateau', 'rempliPar',
  'heureMiseEau', 'heureSortieEau', 'dureePlongeeMin',
  'etatMerDegre', 'etatMerLabel', 'ventBeaufort', 'ventLabel', 'courantClasse',
  'hauteurEauMiseEau_m', 'hauteurEauSortieEau_m', 'coefficientJour',
  'etaleMiseEauType', 'etaleMiseEauDeltaMin', 'etaleSortieEauType', 'etaleSortieEauDeltaMin',
  'commentaire',
];

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty('APPSCRIPT_SECRET');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _respond(false, 'JSON invalide');
  }

  if (!expectedSecret || payload.secret !== expectedSecret) {
    return _respond(false, 'Secret invalide');
  }

  const data = payload.data || {};
  const row = HEADERS.map(key => (data[key] !== undefined && data[key] !== null) ? data[key] : '');

  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return _respond(false, 'SHEET_ID non configuré');

  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('retours_plongee');
  if (!sheet) return _respond(false, 'Onglet retours_plongee introuvable');

  sheet.appendRow(row);
  return _respond(true, '');
}

function _respond(ok, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok, error: error || undefined }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Write the deployment README**

```markdown
# google-apps-script/retour-experience.gs

Backend Google Sheets pour le formulaire "Retour d'expérience post-plongée"
(cf. `specs/2026-07-28-retour-experience-design.md`).

## Mise en place (une fois)

1. Créer un Google Sheet nommé par exemple `retours_plongee_smpe`.
2. Y créer un onglet nommé exactement `retours_plongee`, avec cette ligne
   d'en-tête (dans cet ordre) :

   ```
   timestampSoumission | datePlongee | siteID | siteNom | bateau | rempliPar |
   heureMiseEau | heureSortieEau | dureePlongeeMin | etatMerDegre |
   etatMerLabel | ventBeaufort | ventLabel | courantClasse |
   hauteurEauMiseEau_m | hauteurEauSortieEau_m | coefficientJour |
   etaleMiseEauType | etaleMiseEauDeltaMin | etaleSortieEauType |
   etaleSortieEauDeltaMin | commentaire
   ```

3. Dans le Sheet : Extensions > Apps Script → coller `retour-experience.gs`.
4. Apps Script : Fichier > Propriétés du projet > Propriétés du script :
   - `APPSCRIPT_SECRET` — générer une chaîne aléatoire longue (ex.
     `openssl rand -hex 32`), à reporter aussi côté Worker Cloudflare.
   - `SHEET_ID` — l'ID dans l'URL du Sheet
     (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).
5. Déployer > Nouveau déploiement > Application Web :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
6. Copier l'URL `/exec` → à mettre dans la variable d'environnement
   `APPSCRIPT_URL` du Worker Cloudflare (`cloudflare-worker/mf-wms-proxy.js`).

## Analyse depuis R

```r
library(googlesheets4)
gs4_auth()  # une fois, ouvre le navigateur
df <- read_sheet("https://docs.google.com/spreadsheets/d/<SHEET_ID>")
```
```

- [ ] **Step 3: Commit**

```bash
git add google-apps-script/retour-experience.gs google-apps-script/README.md
git commit -m "feat: ajoute le backend Google Apps Script pour le retour d'expérience"
```

---

### Task 4: Cloudflare Worker route `/retour-experience`

**Files:**
- Modify: `cloudflare-worker/mf-wms-proxy.js`

**Interfaces:**
- Consumes: `env.APPSCRIPT_URL`, `env.APPSCRIPT_SECRET` (new Worker environment variables); forwards to the Apps Script contract from Task 3 (`POST { secret, data }` → `{ ok, error? }`).
- Produces: `POST {workerUrl}/retour-experience` with a JSON body (the 21-field `data` object) → response `{ ok: true }` (HTTP 200) or `{ ok: false, error }` (HTTP 502/400/405/500). Consumed by Task 7 (`retourexperience.js`).

- [ ] **Step 1: Update the header comment and CORS methods**

In `cloudflare-worker/mf-wms-proxy.js`, update the top comment block (lines 1-18) to also document the new route, and change the `corsHeaders` methods line (currently line 39: `'Access-Control-Allow-Methods': 'GET, OPTIONS',`) to:

```js
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
```

- [ ] **Step 2: Add routing for `/retour-experience` before the MF_ENDPOINTS lookup**

Currently (lines 46-51):
```js
    // ── Routing : /paarome ou /aromepi ──────────────────────────
    const path = url.pathname.replace(/^\//, '').split('/')[0];
    const endpoint = MF_ENDPOINTS[path];
    if (!endpoint) {
      return new Response('Not found. Use /paarome or /aromepi', { status: 404 });
    }
```

Replace with:
```js
    // ── Routing ──────────────────────────────────────────────────
    const path = url.pathname.replace(/^\//, '').split('/')[0];

    if (path === 'retour-experience') {
      return handleRetourExperience(request, env, corsHeaders);
    }

    const endpoint = MF_ENDPOINTS[path];
    if (!endpoint) {
      return new Response('Not found. Use /paarome, /aromepi ou /retour-experience', { status: 404, headers: corsHeaders });
    }
```

- [ ] **Step 3: Add the handler function**

Add after the closing `};` of the `export default { ... }` object (end of file):

```js

// ── Route /retour-experience — relais vers Google Apps Script ────
async function handleRetourExperience(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
  if (!env.APPSCRIPT_URL || !env.APPSCRIPT_SECRET) {
    return new Response('Route non configurée (APPSCRIPT_URL/APPSCRIPT_SECRET manquants)', { status: 500, headers: corsHeaders });
  }

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'JSON invalide' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const gasRes = await fetch(env.APPSCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.APPSCRIPT_SECRET, data }),
  });

  const gasJson = await gasRes.json().catch(() => ({ ok: false, error: 'Réponse Apps Script invalide' }));

  return new Response(JSON.stringify(gasJson), {
    status: gasJson.ok ? 200 : 502,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Verify with a local mock (no live Apps Script needed yet)**

```bash
node -e "
const http = require('http');
// Mock Apps Script endpoint
const mockGas = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const parsed = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    if (parsed.secret !== 'test-secret') { res.end(JSON.stringify({ ok:false, error:'bad secret' })); return; }
    res.end(JSON.stringify({ ok: true }));
  });
}).listen(9999, () => console.log('mock GAS on :9999'));
"
```

In a separate terminal, confirm the handler logic manually by re-reading `handleRetourExperience` against this mock's contract (Cloudflare Workers require `wrangler dev` for a full local run, which isn't set up in this repo — this mock only validates the Apps Script request/response shape assumed by the handler). Full end-to-end verification happens in Task 9 after real deployment.

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker/mf-wms-proxy.js
git commit -m "feat: ajoute la route /retour-experience au Worker Cloudflare"
```

---

### Task 5: `index.html` markup — modal, entry points, badge

**Files:**
- Modify: `pwa/index.html`

**Interfaces:**
- Produces DOM ids consumed by Task 7: `btn-fiche-retour`, `btn-menu-retour`, `badge-retour-pending`, `modal-retour-experience`, `btn-close-retour`, `re-site`, `re-date`, `re-heure-mise`, `re-heure-sortie`, `re-bateau-group`, `re-etatmer-group`, `re-vent-group`, `re-courant-group`, `re-rempli-par`, `re-commentaire`, `re-calculs`, `re-erreur`, `btn-re-submit`.

- [ ] **Step 1: Add the menu item (next to `btn-cgu`)**

In `pwa/index.html`, after the `btn-cgu` button (currently lines 104-106):
```html
          <button id="btn-cgu" class="more-item">
            ⚖ CGU
          </button>
```
add:
```html
          <button id="btn-menu-retour" class="more-item">
            📝 Retour d'expérience
            <span id="badge-retour-pending" class="badge-pending hidden">0</span>
          </button>
```

- [ ] **Step 2: Add the fiche-site button (next to `btn-naviguer`)**

After line 216 (`<button id="btn-naviguer" class="btn-naviguer hidden">🧭 Naviguer vers ce site</button>`), add:
```html
    <button id="btn-fiche-retour" class="btn-naviguer btn-retour-experience">📝 Retour d'expérience</button>
```

(Not `hidden` by default — unlike `btn-naviguer`, this button is always relevant once a site is open, since `fiche-site` itself is only shown after a site is selected.)

- [ ] **Step 3: Add the modal markup**

After the `modal-meteo` closing `</div>` (currently line 429) and before the `modal-cgu` comment banner (line 431), insert:

```html
  <!-- ═══════════════════════════════════════════════════════════
       MODAL RETOUR D'EXPÉRIENCE POST-PLONGÉE
  ══════════════════════════════════════════════════════════════ -->
  <div id="modal-retour-experience" class="modal hidden">
    <div class="modal-content modal-content-retour">
      <div class="modal-header">
        <h2>📝 Retour d'expérience</h2>
        <button id="btn-close-retour" class="btn-icon">✕</button>
      </div>

      <form id="form-retour-experience">
        <div class="re-field">
          <label for="re-site">Site</label>
          <select id="re-site" required></select>
        </div>

        <div class="re-field">
          <label for="re-date">Date de la plongée</label>
          <input type="date" id="re-date" required>
        </div>

        <div class="re-field-row">
          <div class="re-field">
            <label for="re-heure-mise">Mise à l'eau</label>
            <input type="time" id="re-heure-mise" required>
          </div>
          <div class="re-field">
            <label for="re-heure-sortie">Sortie d'eau</label>
            <input type="time" id="re-heure-sortie" required>
          </div>
        </div>

        <div class="re-field">
          <label>Bateau</label>
          <div id="re-bateau-group" class="re-btn-group"></div>
        </div>

        <div class="re-field">
          <label>État de la mer</label>
          <div id="re-etatmer-group" class="re-btn-group"></div>
        </div>

        <div class="re-field">
          <label>Vent</label>
          <div id="re-vent-group" class="re-btn-group"></div>
        </div>

        <div class="re-field">
          <label>Courant ressenti</label>
          <div id="re-courant-group" class="re-btn-group"></div>
        </div>

        <div id="re-calculs" class="re-calculs hidden"></div>

        <div class="re-field">
          <label for="re-rempli-par">Rempli par (optionnel)</label>
          <input type="text" id="re-rempli-par" placeholder="Prénom">
        </div>

        <div class="re-field">
          <label for="re-commentaire">Commentaire (optionnel)</label>
          <textarea id="re-commentaire" rows="3" placeholder="Visibilité, faune, incident mineur…"></textarea>
        </div>

        <p id="re-erreur" class="re-erreur hidden"></p>

        <button type="submit" id="btn-re-submit" class="tuto-btn tuto-btn-primary">Envoyer</button>
      </form>
    </div>
  </div>

```

- [ ] **Step 4: Verify markup loads without console errors**

```bash
cd pwa && npx http-server -p 8080
```

Open `http://localhost:8080`, open devtools console — confirm no HTML parsing errors and that `document.getElementById('modal-retour-experience')` returns the element (the modal stays hidden until Task 7 wires it up; the two buttons will be inert until then, which is expected).

- [ ] **Step 5: Commit**

```bash
git add pwa/index.html
git commit -m "feat: ajoute le markup du formulaire retour d'expérience"
```

---

### Task 6: `style.css` — form and badge styles

**Files:**
- Modify: `pwa/css/style.css`

**Interfaces:**
- Consumes: CSS variables already defined at `pwa/css/style.css:8-33` (`--emeraude`, `--gris-card`, `--gris-texte`, `--radius`, `--transition`, `--rouge`, `--orange-warn`).
- Produces: `.re-field`, `.re-field-row`, `.re-btn-group`, `.re-btn`, `.re-btn.active`, `.re-calculs`, `.re-erreur`, `.badge-pending`, `.btn-retour-experience`, `.modal-content-retour` classes consumed by the markup from Task 5.

- [ ] **Step 1: Append the new CSS section**

At the end of `pwa/css/style.css` (after line 2584, the last `}` of the tutorial responsive block), add:

```css

/* ── Formulaire retour d'expérience ─────────────────────────── */
.modal-content-retour {
  max-height: 88vh;
}

#form-retour-experience {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  max-height: calc(88vh - 70px);
  padding-right: 4px;
}

.re-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.re-field label {
  font-size: 12px;
  color: var(--gris-texte);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--font-title);
}
.re-field-row {
  display: flex;
  gap: 12px;
}
.re-field-row .re-field { flex: 1; }

#form-retour-experience input[type="date"],
#form-retour-experience input[type="time"],
#form-retour-experience input[type="text"],
#form-retour-experience select,
#form-retour-experience textarea {
  background: var(--gris-card);
  border: 1px solid rgba(58,175,168,0.3);
  border-radius: var(--radius);
  color: var(--blanc);
  padding: 8px 10px;
  font-size: 14px;
  font-family: var(--font-body);
}
#form-retour-experience textarea { resize: vertical; }

.re-btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.re-btn {
  padding: 6px 12px;
  border-radius: 20px;
  border: 1px solid rgba(58,175,168,0.4);
  background: transparent;
  color: var(--gris-texte);
  font-size: 12px;
  font-family: var(--font-title);
  cursor: pointer;
  transition: all var(--transition);
}
.re-btn.active, .re-btn:hover {
  background: var(--emeraude);
  color: var(--blanc);
  border-color: var(--emeraude);
}

.re-calculs {
  background: rgba(58,175,168,0.08);
  border-radius: var(--radius);
  padding: 10px;
  font-size: 12px;
  color: var(--gris-texte);
  line-height: 1.6;
}

.re-erreur {
  color: var(--rouge);
  font-size: 13px;
}

.btn-retour-experience {
  background: rgba(58,175,168,0.15);
  border: 1px solid rgba(58,175,168,0.4);
}

.badge-pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--orange-warn);
  color: #1a1a1a;
  font-size: 10px;
  font-weight: bold;
  margin-left: 6px;
}
```

- [ ] **Step 2: Verify visually**

With `npx http-server -p 8080` still running (from Task 5), reload the browser. Since the modal is still `hidden` and unwired, verify by temporarily running in devtools console:
```js
document.getElementById('modal-retour-experience').classList.remove('hidden')
```
Confirm the form renders with readable styling consistent with the other modals (marées/météo), then re-add `hidden`:
```js
document.getElementById('modal-retour-experience').classList.add('hidden')
```

- [ ] **Step 3: Commit**

```bash
git add pwa/css/style.css
git commit -m "feat: styles du formulaire retour d'expérience"
```

---

### Task 7: `pwa/js/retourexperience.js` — core module

**Files:**
- Create: `pwa/js/retourexperience.js`

**Interfaces:**
- Consumes: `CONFIG.RETOUR_EXPERIENCE` (Task 2), `Marees.getHauteurAt(date)` / `Marees.getEntreePourDate(date)` / `Marees.getEtaleProche(date)` (Task 1 + existing), `Sites.getGeojson()` / `Sites.getSiteActif()` / `Sites.getSiteById(id)` (existing, `pwa/js/sites.js`), DOM ids from Task 5.
- Produces: `RetourExperience.init()` — called once from `app.js` (Task 8). Module binds its own buttons internally (same pattern as `Cgu.init()` in `pwa/js/cgu.js`), so `app.js` needs no other wiring beyond the `init()` call and the `_onSiteSelectionne` hook update (Task 8) to show `btn-fiche-retour`.

- [ ] **Step 1: Write the module**

```js
/**
 * retourexperience.js — Formulaire retour d'expérience post-plongée
 *
 * Envoie chaque soumission au Worker Cloudflare (route /retour-experience),
 * qui relaie vers Google Apps Script (jamais d'appel direct client → Apps
 * Script, cf. specs/2026-07-28-retour-experience-design.md). En cas d'échec
 * réseau, la soumission est mise en file d'attente locale (localStorage) et
 * réessayée au chargement de l'app et à l'évènement 'online'.
 */

const RetourExperience = (() => {

  const QUEUE_KEY = 'smpe_retour_queue';
  let _siteImposeID = null; // siteID pré-rempli si ouvert depuis la fiche site

  // ── File d'attente locale ────────────────────────────────────

  function _lireQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function _ecrireQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    _majBadge(queue.length);
  }

  function _majBadge(count) {
    const badge = document.getElementById('badge-retour-pending');
    if (!badge) return;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  async function _envoyer(data) {
    const url = CONFIG.RETOUR_EXPERIENCE.workerUrl;
    if (!url) return { ok: false, error: 'workerUrl non configurée' };
    try {
      const res = await fetch(`${url}/retour-experience`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({ ok: false, error: 'Réponse invalide' }));
      return json;
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  async function flushQueue() {
    let queue = _lireQueue();
    if (queue.length === 0) return;
    const restants = [];
    for (const data of queue) {
      const res = await _envoyer(data);
      if (!res.ok) restants.push(data);
    }
    _ecrireQueue(restants);
  }

  // ── Rendu des groupes de boutons ──────────────────────────────

  function _rendreBoutons(containerId, items, labelKey, valueKey) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items.map(it =>
      `<button type="button" class="re-btn" data-value="${it[valueKey]}">${it[labelKey]}</button>`
    ).join('');
    el.querySelectorAll('.re-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.re-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  function _valeurActive(containerId) {
    const el = document.getElementById(containerId);
    const btn = el?.querySelector('.re-btn.active');
    return btn ? btn.dataset.value : null;
  }

  function _rendreSelectSites() {
    const select = document.getElementById('re-site');
    if (!select) return;
    const geojson = Sites.getGeojson();
    const features = (geojson?.features || []).slice()
      .sort((a, b) => (a.properties.siteNom || a.properties.siteID)
        .localeCompare(b.properties.siteNom || b.properties.siteID));
    select.innerHTML = '<option value="">— Choisir un site —</option>' + features.map(f =>
      `<option value="${f.properties.siteID}">${f.properties.siteNom || f.properties.siteID}</option>`
    ).join('');
  }

  // ── Calculs automatiques ──────────────────────────────────────

  function _dateHeure(dateStr, heureStr) {
    if (!dateStr || !heureStr) return null;
    const d = new Date(`${dateStr}T${heureStr}:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  function _formatEtale(etale) {
    if (!etale) return '—';
    const hh = Math.floor(etale.deltaMin / 60);
    const mm = etale.deltaMin % 60;
    const duree = hh > 0 ? `${hh}h${String(mm).padStart(2, '0')}` : `${mm}min`;
    return `${etale.type} ${etale.heure} (${duree} ${etale.avantApres})`;
  }

  function _recalculer() {
    const dateStr = document.getElementById('re-date').value;
    const hMise = document.getElementById('re-heure-mise').value;
    const hSortie = document.getElementById('re-heure-sortie').value;
    const calculs = document.getElementById('re-calculs');

    const dMise = _dateHeure(dateStr, hMise);
    const dSortie = _dateHeure(dateStr, hSortie);
    if (!dMise && !dSortie) {
      calculs.classList.add('hidden');
      return;
    }

    const lignes = [];
    if (dMise) {
      const h = Marees.getHauteurAt(dMise);
      const etale = Marees.getEtaleProche(dMise);
      lignes.push(`Mise à l'eau — hauteur : ${h !== null ? h.toFixed(2) + ' m' : '—'} · étale : ${_formatEtale(etale)}`);
    }
    if (dSortie) {
      const h = Marees.getHauteurAt(dSortie);
      const etale = Marees.getEtaleProche(dSortie);
      lignes.push(`Sortie d'eau — hauteur : ${h !== null ? h.toFixed(2) + ' m' : '—'} · étale : ${_formatEtale(etale)}`);
    }
    const entreeJour = dMise ? Marees.getEntreePourDate(dMise) : (dSortie ? Marees.getEntreePourDate(dSortie) : null);
    const coeff = entreeJour ? (entreeJour.PM1_coeff || entreeJour.PM2_coeff) : null;
    if (coeff) lignes.push(`Coefficient du jour : ${coeff}`);

    calculs.innerHTML = lignes.join('<br>');
    calculs.classList.remove('hidden');
  }

  // ── Validation + soumission ───────────────────────────────────

  function _erreur(msg) {
    const el = document.getElementById('re-erreur');
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  function _construireDonnees() {
    const siteID = document.getElementById('re-site').value;
    const dateStr = document.getElementById('re-date').value;
    const hMise = document.getElementById('re-heure-mise').value;
    const hSortie = document.getElementById('re-heure-sortie').value;
    const bateau = _valeurActive('re-bateau-group');
    const etatMerDegre = _valeurActive('re-etatmer-group');
    const ventCode = _valeurActive('re-vent-group');
    const courantCode = _valeurActive('re-courant-group');

    if (!siteID) return { erreur: 'Choisissez un site.' };
    if (!dateStr) return { erreur: 'Choisissez une date.' };
    if (new Date(dateStr) > new Date(new Date().toDateString())) return { erreur: 'La date ne peut pas être dans le futur.' };
    if (!hMise || !hSortie) return { erreur: "Renseignez l'heure de mise à l'eau et de sortie." };
    if (hSortie <= hMise) return { erreur: "L'heure de sortie doit être postérieure à l'heure de mise à l'eau." };
    if (!bateau) return { erreur: 'Choisissez le bateau.' };
    if (etatMerDegre === null) return { erreur: "Choisissez l'état de la mer." };
    if (!ventCode) return { erreur: 'Choisissez le vent.' };
    if (!courantCode) return { erreur: 'Choisissez le courant ressenti.' };

    const site = Sites.getSiteById(siteID);
    const dMise = _dateHeure(dateStr, hMise);
    const dSortie = _dateHeure(dateStr, hSortie);
    const etatMer = CONFIG.RETOUR_EXPERIENCE.etatMer.find(e => String(e.degre) === etatMerDegre);
    const vent = CONFIG.RETOUR_EXPERIENCE.vent.find(v => v.code === ventCode);
    const etaleMise = Marees.getEtaleProche(dMise);
    const etaleSortie = Marees.getEtaleProche(dSortie);
    const entreeJour = Marees.getEntreePourDate(dMise);

    return {
      data: {
        timestampSoumission: new Date().toISOString(),
        datePlongee: dateStr,
        siteID,
        siteNom: site?.properties?.siteNom || siteID,
        bateau,
        rempliPar: document.getElementById('re-rempli-par').value.trim(),
        heureMiseEau: hMise,
        heureSortieEau: hSortie,
        dureePlongeeMin: Math.round((dSortie - dMise) / 60000),
        etatMerDegre: Number(etatMerDegre),
        etatMerLabel: etatMer?.label || '',
        ventBeaufort: ventCode,
        ventLabel: vent?.label || '',
        courantClasse: courantCode,
        hauteurEauMiseEau_m: Marees.getHauteurAt(dMise),
        hauteurEauSortieEau_m: Marees.getHauteurAt(dSortie),
        coefficientJour: entreeJour ? (entreeJour.PM1_coeff || entreeJour.PM2_coeff || null) : null,
        etaleMiseEauType: etaleMise?.type || null,
        etaleMiseEauDeltaMin: etaleMise?.deltaMin ?? null,
        etaleSortieEauType: etaleSortie?.type || null,
        etaleSortieEauDeltaMin: etaleSortie?.deltaMin ?? null,
        commentaire: document.getElementById('re-commentaire').value.trim(),
      },
    };
  }

  async function _soumettre(e) {
    e.preventDefault();
    _erreur('');

    const { erreur, data } = _construireDonnees();
    if (erreur) { _erreur(erreur); return; }

    const btn = document.getElementById('btn-re-submit');
    btn.disabled = true;
    btn.textContent = 'Envoi…';

    const res = await _envoyer(data);
    if (res.ok) {
      _fermer();
    } else {
      const queue = _lireQueue();
      queue.push(data);
      _ecrireQueue(queue);
      _erreur('Envoi impossible (réseau) — mis en file d\'attente, réessai automatique.');
      setTimeout(_fermer, 1500);
    }

    btn.disabled = false;
    btn.textContent = 'Envoyer';
  }

  // ── Ouverture / fermeture modale ──────────────────────────────

  function _reinitialiserForm() {
    document.getElementById('form-retour-experience').reset();
    document.querySelectorAll('#modal-retour-experience .re-btn.active').forEach(b => b.classList.remove('active'));
    document.getElementById('re-calculs').classList.add('hidden');
    _erreur('');
    document.getElementById('re-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('re-date').max = new Date().toISOString().slice(0, 10);
  }

  function ouvrir(siteID = null) {
    _reinitialiserForm();
    _rendreSelectSites();
    if (siteID) {
      document.getElementById('re-site').value = siteID;
    }
    document.getElementById('modal-retour-experience').classList.remove('hidden');
  }

  function _fermer() {
    document.getElementById('modal-retour-experience').classList.add('hidden');
  }

  // ── Init ───────────────────────────────────────────────────────

  function init() {
    _rendreBoutons('re-bateau-group', CONFIG.RETOUR_EXPERIENCE.bateaux.map(nom => ({ nom, value: nom })), 'nom', 'value');
    _rendreBoutons('re-etatmer-group', CONFIG.RETOUR_EXPERIENCE.etatMer.map(e => ({ ...e, label: `${e.degre} ${e.label}` })), 'label', 'degre');
    _rendreBoutons('re-vent-group', CONFIG.RETOUR_EXPERIENCE.vent, 'label', 'code');
    _rendreBoutons('re-courant-group', CONFIG.RETOUR_EXPERIENCE.courant, 'label', 'code');

    document.getElementById('re-date')?.addEventListener('change', _recalculer);
    document.getElementById('re-heure-mise')?.addEventListener('change', _recalculer);
    document.getElementById('re-heure-sortie')?.addEventListener('change', _recalculer);

    document.getElementById('form-retour-experience')?.addEventListener('submit', _soumettre);
    document.getElementById('btn-close-retour')?.addEventListener('click', _fermer);
    document.getElementById('modal-retour-experience')?.addEventListener('click', e => {
      if (e.target.id === 'modal-retour-experience') _fermer();
    });

    document.getElementById('btn-menu-retour')?.addEventListener('click', () => ouvrir(null));
    document.getElementById('btn-fiche-retour')?.addEventListener('click', () => {
      const site = Sites.getSiteActif();
      ouvrir(site?.properties?.siteID || null);
    });

    _majBadge(_lireQueue().length);
    window.addEventListener('online', flushQueue);
    flushQueue();
  }

  return { init, ouvrir, flushQueue };
})();
```

Note the deliberate reuse of `etatMer.degre` (a number, e.g. `2`) as the `data-value` attribute — HTML dataset values are always strings, hence `_valeurActive` returns `'2'` and `_construireDonnees` does `String(e.degre) === etatMerDegre` / `Number(etatMerDegre)` to convert back. This matches the pattern already used for `_filtreType`/`_filtreProf` string comparisons in `pwa/js/app.js`.

- [ ] **Step 2: Verify pure helpers in Node**

```bash
node -e "
function formatEtale(etale) {
  if (!etale) return '—';
  const hh = Math.floor(etale.deltaMin / 60);
  const mm = etale.deltaMin % 60;
  const duree = hh > 0 ? \`\${hh}h\${String(mm).padStart(2, '0')}\` : \`\${mm}min\`;
  return \`\${etale.type} \${etale.heure} (\${duree} \${etale.avantApres})\`;
}
console.assert(formatEtale(null) === '—', 'null case failed');
console.assert(formatEtale({type:'PM',heure:'14:05',deltaMin:75,avantApres:'avant'}) === 'PM 14:05 (1h15 avant)', 'formatting failed: ' + formatEtale({type:'PM',heure:'14:05',deltaMin:75,avantApres:'avant'}));
console.log('OK');
"
```

Expected output: `OK` (no assertion errors printed).

- [ ] **Step 3: Verify duration/validation logic in Node**

```bash
node -e "
const hMise = '10:00', hSortie = '09:30';
console.assert((hSortie <= hMise) === true, 'should flag invalid order');
const dMise = new Date('2026-08-01T10:00:00');
const dSortie = new Date('2026-08-01T11:15:00');
console.assert(Math.round((dSortie - dMise) / 60000) === 75, 'duration calc wrong');
console.log('OK');
"
```

Expected output: `OK`.

- [ ] **Step 4: Commit**

```bash
git add pwa/js/retourexperience.js
git commit -m "feat: ajoute le module retourexperience.js (formulaire, calculs, file d'attente)"
```

---

### Task 8: Wire into `app.js` and bump `sw.js` VERSION

**Files:**
- Modify: `pwa/js/app.js`
- Modify: `pwa/sw.js`

**Interfaces:**
- Consumes: `RetourExperience.init()` (Task 7).
- Produces: app boots the module; SW caches the new file and forces cache refresh on tablets.

- [ ] **Step 1: Call `RetourExperience.init()` in `app.js`**

In `pwa/js/app.js`, after step 11 (`if (typeof Cgu !== 'undefined') Cgu.init();`, line 58), add step 12 and renumber the existing "12. Tutoriel" comment to 13:

```js
    // 11. Init module CGU
    if (typeof Cgu !== 'undefined') Cgu.init();

    // 12. Init module Retour d'expérience
    if (typeof RetourExperience !== 'undefined') RetourExperience.init();

    // 13. Tutoriel premier démarrage
    if (typeof Tutorial !== 'undefined') Tutorial.init();
```

- [ ] **Step 2: Show the fiche-site button whenever a site is selected**

`btn-fiche-retour` (Task 5) is not `hidden` by default, so no change is strictly needed there — but confirm in `_onSiteSelectionne` (`pwa/js/app.js:74-91`) that nothing needs hiding it when no site is active. Since `fiche-site` itself is `hidden` until a site is selected (existing behavior, unrelated to this feature), `btn-fiche-retour` is only visible when the fiche is open — no additional code required. Skip further changes here.

- [ ] **Step 3: Add the new script tag**

`pwa/index.html` currently loads scripts in this order (lines 519-534):
```html
  <script src="js/config.js"></script>
  <script src="js/marees.js"></script>
  <script src="js/mareesite.js"></script>
  <script src="js/port.js"></script>
  <script src="js/bathy.js"></script>
  <script src="js/courants.js"></script>
  <script src="js/carte.js"></script>
  <script src="js/sites.js"></script>
  <script src="js/prevision.js"></script>
  <script src="js/navigation.js"></script>
  <script src="js/meteo.js"></script>
  <script src="js/biplongee.js"></script>
  <script src="js/cgu.js"></script>
  <script src="js/tutorial.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/app.js"></script>
```

`retourexperience.js` depends on `Sites` (line 526) and `Marees` (line 520), both already loaded earlier, and must itself be defined before `app.js` (line 534) calls `RetourExperience.init()`. Insert it after `cgu.js` (line 531), mirroring the init-order comment in `app.js` (Cgu then RetourExperience then Tutorial):

```html
  <script src="js/cgu.js"></script>
  <script src="js/retourexperience.js"></script>
  <script src="js/tutorial.js"></script>
```

- [ ] **Step 4: Register the new file in the Service Worker and bump VERSION**

In `pwa/sw.js`, change line 9 from:
```js
const VERSION = 'v34';
```
to:
```js
const VERSION = 'v35';
```

And add to `ASSETS_STATIQUES` (after `BASE + 'js/sites.js',` at line 36):
```js
  BASE + 'js/retourexperience.js',
```

- [ ] **Step 5: Verify boot order in browser console**

```bash
cd pwa && npx http-server -p 8080
```

Open `http://localhost:8080`, devtools console, confirm no errors and:
```js
typeof RetourExperience
```
prints `"object"`.

- [ ] **Step 6: Commit**

```bash
git add pwa/js/app.js pwa/index.html pwa/sw.js
git commit -m "feat: intègre RetourExperience dans app.js, bump SW v35"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only, per the spec's own "Plan de test manuel" section, `specs/2026-07-28-retour-experience-design.md:157-164`)

**Prerequisites:** Task 3's Apps Script deployed with real `SHEET_ID`/`APPSCRIPT_SECRET`, Task 4's Worker deployed with matching `APPSCRIPT_URL`/`APPSCRIPT_SECRET` env vars, and `CONFIG.RETOUR_EXPERIENCE.workerUrl` (Task 2, `pwa/js/config.js`) set to the deployed Worker's URL.

- [ ] **Step 1:** Fill the form from a site's fiche with 4G/WiFi active → confirm a new row appears in the Google Sheet with all computed values (hauteur d'eau, coefficient, delta étale) matching `Marees.getEntreePourDate(date)` for the chosen date (cross-check manually in the console, same method as Task 1 Step 2b).

- [ ] **Step 2:** Enable airplane mode before submitting → confirm the submission is queued (`localStorage.getItem('smpe_retour_queue')` is a non-empty JSON array, badge shows a count) → disable airplane mode → confirm automatic flush (queue empties, row appears in the Sheet, badge disappears).

- [ ] **Step 3:** Open the form from the header menu without a preselected site → confirm the site `<select>` is searchable (native browser type-ahead) and populates `siteID`/`siteNom` correctly on submit.

- [ ] **Step 4:** Confirm the "heure de sortie > heure de mise à l'eau" validation error displays when submitting an inverted pair.

- [ ] **Step 5:** Run `./sync_docs.sh "feat: formulaire retour d'expérience post-plongée"` and, once on a tablet, confirm the SW updates to `v35` (check `chrome://inspect` or the console for the new cache name `smpe-static-v35`).

- [ ] **Step 6: Final commit (if `sync_docs.sh` wasn't already run in Step 5)**

```bash
git status
```

If anything is uncommitted at this point, review and commit it — otherwise this task produces no code changes beyond what Tasks 1-8 already committed.
