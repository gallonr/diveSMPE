# Compte utilisateur (email + token) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the diveSMPE PWA's single shared login (`smpe`/`smpe2026`) with individual accounts identified by email + a signed, stateless magic-link token, while preserving 100%-offline startup once a device has logged in once.

**Architecture:** Login screen collects an email → PWA POSTs to the existing Cloudflare Worker (`cloudflare-worker/mf-wms-proxy.js`, new `/auth/request-link` and `/auth/verify` routes) → Worker injects a server-side secret and forwards to a **new, separate** Google Apps Script Web App (`google-apps-script/auth.gs`) → the script checks the email against a Google Sheet tab `"utilisateurs"` and, if active, emails a signed token (HMAC-SHA256, no server-side token storage). Clicking the link (or pasting the token as a fallback) verifies it via the same Worker route and stores `{email, nom, token, ts}` in `localStorage` for 90 days, glissant. The app always starts immediately from the local session (never blocks on network); when online, a background call re-verifies and either refreshes the session or logs out on an explicit revocation.

**Tech Stack:** Vanilla JS (IIFE modules, no bundler — existing project convention), Cloudflare Workers (plain JS, manual dashboard deploy, no wrangler.toml for this proxy), Google Apps Script (`.gs`, V8 runtime).

**Spec:** `specs/2026-08-25-auth-utilisateur-token-design.md` — read it before starting; this plan implements it task-by-task and does not repeat its rationale.

## Global Constraints

- **No test framework exists in this repo** (no `package.json`, no test runner) and none should be introduced. Pure algorithmic logic that is portable to Node (the HMAC token format) is cross-checked with a throwaway `node -e` script against a fixed test vector, then confirmed inside the deployed Apps Script editor. UI/integration logic is verified manually via `cd pwa && npx http-server -p 8080` + browser devtools, matching every other feature in this app.
- **Vanilla JS only**, IIFE module pattern (`const X = (() => { ... return {...}; })();`), matching `pwa/js/auth.js` / `pwa/js/retourexperience.js`.
- **French** for all user-facing strings; code comments follow the existing sparse style (only non-obvious rationale, no docstring dumps).
- Every static file added to `pwa/` or any modification to a file listed in `ASSETS_STATIQUES` (`pwa/sw.js`) **requires a `VERSION` bump** in `pwa/sw.js` — hard project rule (CLAUDE.md), not optional.
- **Never edit `docs/`** directly — it's the GitHub Pages deployment copy, synced only via `./sync_docs.sh`. This plan only touches `pwa/`, `cloudflare-worker/`, and a new `google-apps-script/auth.gs`.
- Secrets (`AUTH_APPSCRIPT_SECRET`, `AUTH_TOKEN_SECRET`, the Apps Script Web App URL) are **never** present in client code (`pwa/js/*`) — only as Cloudflare Worker environment variables, exactly like `MF_TOKEN_PAAROME`/`APPSCRIPT_SECRET` already are.
- The new Apps Script deployment is **separate** from `retour-experience.gs` (distinct secrets, per the design's cloisonnement decision) but reads/writes the **same Google Sheet** (`SHEET_ID`), in a new tab named exactly `"utilisateurs"`.
- The `localStorage` session key changes from `smpe_auth` to `smpe_auth_v2` — a deliberate hard cutover so no device silently keeps access via an old-shaped session object missing `email`/`nom`/`token`; every device is forced through the new email flow at least once (matches the spec's "Migration" section).
- GitHub Pages URL for this repo: `https://gallonr.github.io/diveSMPE/` (repo `gallonr/diveSMPE`, no custom domain/CNAME).

---

### Task 1: `google-apps-script/auth.gs` — token issuance + verification backend

**Files:**
- Create: `google-apps-script/auth.gs`
- Create: `google-apps-script/README-auth.md`

**Interfaces:**
- Consumes: Script Properties `AUTH_APPSCRIPT_SECRET`, `AUTH_TOKEN_SECRET`, `SHEET_ID`, `PWA_URL`; a sheet tab literally named `utilisateurs` with header row `email | nom | actif`.
- Produces: a Web App `doPost` endpoint accepting `POST { secret, action: 'request-link', email }` → `{ ok: true }` / `{ ok: false, error }`, and `POST { secret, action: 'verify', token }` → `{ ok: true, email, nom }` / `{ ok: false, error }`. Apps Script Web Apps cannot return custom HTTP status codes — the body's `ok` field is the only signal. Consumed by Task 3 (Worker).

- [ ] **Step 1: Write the script**

```js
/**
 * auth.gs — Google Apps Script Web App
 * Authentification par lien magique (email + token signé) pour la PWA
 * diveSMPE, en remplacement de l'ancien login partagé (cf.
 * specs/2026-08-25-auth-utilisateur-token-design.md). Relayé par le Worker
 * Cloudflare (routes /auth/request-link, /auth/verify), jamais appelé
 * directement par la PWA. Déploiement séparé de retour-experience.gs
 * (secrets distincts), mais pointe vers le même Google Sheet.
 *
 * Déploiement :
 *  1. https://script.google.com/ → Nouveau projet, coller ce fichier.
 *  2. Fichier > Propriétés du projet > Propriétés du script, ajouter :
 *       AUTH_APPSCRIPT_SECRET = <secret partagé avec le Worker Cloudflare>
 *       AUTH_TOKEN_SECRET     = <clé HMAC de signature des tokens, distincte
 *                                du secret ci-dessus — ex. openssl rand -hex 32>
 *       SHEET_ID              = <ID du Google Sheet, même valeur que pour
 *                                retour-experience.gs>
 *       PWA_URL                = https://gallonr.github.io/diveSMPE/
 *  3. Dans le Sheet cible, créer un onglet nommé exactement "utilisateurs"
 *     avec une ligne d'en-tête : email | nom | actif
 *  4. Déployer > Nouveau déploiement > Type "Application Web" :
 *       Exécuter en tant que : Moi
 *       Qui a accès : Tout le monde
 *  5. Copier l'URL de déploiement (se terminant par /exec) → variable
 *     d'environnement AUTH_APPSCRIPT_URL du Worker Cloudflare (jamais dans
 *     le code client de la PWA).
 */

const SESSION_DUREE_MS = 90 * 24 * 60 * 60 * 1000; // 90 jours

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty('AUTH_APPSCRIPT_SECRET');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _respond(false, 'JSON invalide');
  }

  // Note : comparaison non constant-time — acceptable pour la menace interne
  // au club (même choix que retour-experience.gs).
  if (!expectedSecret || payload.secret !== expectedSecret) {
    return _respond(false, 'Secret invalide');
  }

  if (payload.action === 'request-link') return _demanderLien(payload, props);
  if (payload.action === 'verify') return _verifier(payload, props);
  return _respond(false, 'Action inconnue');
}

function _demanderLien(payload, props) {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return _respond(false, 'Email requis');

  const utilisateur = _trouverUtilisateur(email, props);
  if (!utilisateur || !utilisateur.actif) {
    return _respond(false, 'Email non reconnu ou inactif');
  }

  const exp = Date.now() + SESSION_DUREE_MS;
  const token = _construireToken(email, exp, props.getProperty('AUTH_TOKEN_SECRET'));
  const pwaUrl = props.getProperty('PWA_URL') || 'https://gallonr.github.io/diveSMPE/';
  const lien = pwaUrl + '?token=' + encodeURIComponent(token);

  MailApp.sendEmail({
    to: email,
    subject: 'Votre lien de connexion — SMPE Plongée',
    body: 'Bonjour ' + utilisateur.nom + ',\n\n'
      + "Cliquez sur ce lien pour vous connecter à l'application SMPE Plongée :\n"
      + lien + '\n\n'
      + "Si le lien ne s'ouvre pas dans l'application installée sur votre tablette, "
      + 'copiez plutôt ce code et collez-le dans le champ "Coller le token" '
      + "de l'écran de connexion :\n\n"
      + token + '\n\n'
      + 'Ce lien est valable 90 jours.',
  });

  return _respond(true, '');
}

function _verifier(payload, props) {
  const token = String(payload.token || '');
  const donnees = _verifierToken(token, props.getProperty('AUTH_TOKEN_SECRET'));
  if (!donnees) return _respond(false, 'Token invalide ou expiré');

  const utilisateur = _trouverUtilisateur(donnees.email, props);
  if (!utilisateur || !utilisateur.actif) {
    return _respond(false, 'Compte désactivé');
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, email: utilisateur.email, nom: utilisateur.nom }))
    .setMimeType(ContentService.MimeType.JSON);
}

function _trouverUtilisateur(email, props) {
  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return null;
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('utilisateurs');
  if (!sheet) return null;

  const lignes = sheet.getDataRange().getValues(); // lignes[0] = en-tête
  for (let i = 1; i < lignes.length; i++) {
    const ligneEmail = String(lignes[i][0] || '').trim().toLowerCase();
    if (ligneEmail === email) {
      const nom = String(lignes[i][1] || '');
      const actifBrut = String(lignes[i][2] || '').trim().toUpperCase();
      const actif = lignes[i][2] === true || actifBrut === 'VRAI' || actifBrut === 'TRUE';
      return { email: email, nom: nom, actif: actif };
    }
  }
  return null;
}

function _construireToken(email, exp, secret) {
  const payloadStr = encodeURIComponent(JSON.stringify({ email: email, exp: exp }));
  return payloadStr + ':' + _hmacHex(payloadStr, secret);
}

function _verifierToken(token, secret) {
  const idx = String(token).indexOf(':');
  if (idx === -1) return null;
  const payloadStr = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!secret || sig !== _hmacHex(payloadStr, secret)) return null;

  let donnees;
  try {
    donnees = JSON.parse(decodeURIComponent(payloadStr));
  } catch (err) {
    return null;
  }
  if (!donnees.email || !donnees.exp || Date.now() > donnees.exp) return null;
  return donnees;
}

function _hmacHex(payloadStr, secret) {
  const sigBytes = Utilities.computeHmacSha256Signature(payloadStr, secret);
  return sigBytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function _respond(ok, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, error: error || undefined }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Cross-check the HMAC token format with a throwaway Node script**

`Utilities.computeHmacSha256Signature` is Apps-Script-only, so `_hmacHex` can't run directly in Node — but it's a standard HMAC-SHA256 hex digest, so Node's `crypto` module must produce byte-identical output for the same message/key. Run:

```bash
node -e "
const crypto = require('crypto');
const email = 'test@example.com';
const exp = 1234567890000;
const payloadStr = encodeURIComponent(JSON.stringify({ email, exp }));
const sig = crypto.createHmac('sha256', 'test-secret').update(payloadStr, 'utf8').digest('hex');
console.log('payloadStr =', payloadStr);
console.log('sig =', sig);
"
```

Expected output (fixed test vector — copy these exact values):
```
payloadStr = %7B%22email%22%3A%22test%40example.com%22%2C%22exp%22%3A1234567890000%7D
sig = dd31df95f333083a15457d43e799c072b2b9c8a84f453d82f7eae8e44040fa30
```

After pasting `auth.gs` into the Apps Script editor (Step 1's deployment, before or after the final `/exec` deploy — the editor's "Run" works on a saved draft), temporarily add this function, select it in the function dropdown, and run it (View > Logs or Execution log shows the output):

```js
function _testHmacCrossCheck() {
  Logger.log(_hmacHex('%7B%22email%22%3A%22test%40example.com%22%2C%22exp%22%3A1234567890000%7D', 'test-secret'));
}
```

Confirm the logged value is exactly `dd31df95f333083a15457d43e799c072b2b9c8a84f453d82f7eae8e44040fa30`. Delete `_testHmacCrossCheck` afterward — it's not part of the shipped script.

- [ ] **Step 3: Write the deployment README**

```markdown
# google-apps-script/auth.gs

Backend d'authentification par lien magique (email + token signé) pour la
PWA diveSMPE (cf. `specs/2026-08-25-auth-utilisateur-token-design.md`).
Déploiement **séparé** de `retour-experience.gs` (secrets distincts), mais
lit/écrit le **même** Google Sheet (nouvel onglet).

## Mise en place (une fois)

1. Dans le Google Sheet déjà utilisé pour `retours_plongee`, créer un onglet
   nommé exactement `utilisateurs`, avec cette ligne d'en-tête :

   ```
   email | nom | actif
   ```

   Remplir une ligne par membre autorisé (`actif` = `VRAI` ou `FAUX`).

2. Dans le Sheet : Extensions > Apps Script → **Nouveau projet** (ne pas
   réutiliser celui de `retour-experience.gs`) → coller `auth.gs`.
3. Apps Script : Fichier > Propriétés du projet > Propriétés du script :
   - `AUTH_APPSCRIPT_SECRET` — chaîne aléatoire longue (ex.
     `openssl rand -hex 32`), à reporter côté Worker Cloudflare.
   - `AUTH_TOKEN_SECRET` — **une autre** chaîne aléatoire longue (clé de
     signature des tokens — ne jamais réutiliser `AUTH_APPSCRIPT_SECRET`).
   - `SHEET_ID` — même valeur que pour `retour-experience.gs`.
   - `PWA_URL` — `https://gallonr.github.io/diveSMPE/`
4. Déployer > Nouveau déploiement > Application Web :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
5. Copier l'URL `/exec` → variable d'environnement `AUTH_APPSCRIPT_URL` du
   Worker Cloudflare (`cloudflare-worker/mf-wms-proxy.js`).

## Révocation

Passer `actif` à `FAUX` sur la ligne du membre dans l'onglet `utilisateurs`.
Prend effet à la prochaine revalidation silencieuse de l'appareil concerné
(prochain démarrage de l'app en ligne) — voir la section "Détail de la
révocation" de la spec.
```

- [ ] **Step 4: Commit**

```bash
git add google-apps-script/auth.gs google-apps-script/README-auth.md
git commit -m "feat: ajoute le backend Apps Script d'authentification par lien magique"
```

---

### Task 2: `CONFIG.AUTH` in `config.js`

**Files:**
- Modify: `pwa/js/config.js:141` (insert after the `RETOUR_EXPERIENCE` block's closing `},`)

**Interfaces:**
- Produces: `CONFIG.AUTH.workerUrl`. Consumed by Task 4 (`auth.js`).

- [ ] **Step 1: Add the block**

In `pwa/js/config.js`, current lines 140-143:
```js
    ],
  },

  // ── Météo (OpenMeteo — gratuit, pas de clé) ────────────────
```

Replace with:
```js
    ],
  },

  // ── Authentification (compte individuel, lien magique) ────
  // URL du Worker Cloudflare (routes /auth/request-link, /auth/verify) —
  // même Worker que RETOUR_EXPERIENCE.
  AUTH: {
    workerUrl: 'https://mf-wms-proxy.reg-gallon.workers.dev',
  },

  // ── Météo (OpenMeteo — gratuit, pas de clé) ────────────────
```

- [ ] **Step 2: Verify with Node**

```bash
node -e "
global.CONFIG = {};
eval(require('fs').readFileSync('pwa/js/config.js', 'utf8').replace(/^const CONFIG = /m, 'CONFIG = '));
console.log(CONFIG.AUTH.workerUrl);
"
```
Expected: prints `https://mf-wms-proxy.reg-gallon.workers.dev`.

(If this fails because `config.js` doesn't declare `const CONFIG = {...}` at the top, inspect the file's actual declaration and adjust the `eval` regex accordingly — the goal is only to confirm the object parses and the new key is reachable.)

- [ ] **Step 3: Commit**

```bash
git add pwa/js/config.js
git commit -m "feat: ajoute CONFIG.AUTH pour l'authentification par lien magique"
```

---

### Task 3: Cloudflare Worker routes `/auth/request-link` et `/auth/verify`

**Files:**
- Modify: `cloudflare-worker/mf-wms-proxy.js`

**Interfaces:**
- Consumes: `env.AUTH_APPSCRIPT_URL`, `env.AUTH_APPSCRIPT_SECRET` (new Worker environment variables); forwards to the Apps Script contract from Task 1.
- Produces: `POST {workerUrl}/auth/request-link {email}` → `{ok:true}` / `{ok:false,error}`, and `POST {workerUrl}/auth/verify {token}` → `{ok:true,email,nom}` / `{ok:false,error}`. Consumed by Task 4 (`auth.js`).

- [ ] **Step 1: Update the header comment**

In `cloudflare-worker/mf-wms-proxy.js`, replace lines 1-21 with:

```js
/**
 * Cloudflare Worker — Proxy WMS Météo-France + relais retour d'expérience
 * + relais authentification par lien magique
 *
 * Déploiement :
 *  1. Créer un compte sur https://workers.cloudflare.com/
 *  2. Nouveau Worker → coller ce code
 *  3. Dans "Settings > Variables" du Worker, ajouter les secrets :
 *       MF_TOKEN_PAAROME     = votre_token_paarome
 *       MF_TOKEN_AROMEPI     = votre_token_aromepi
 *       APPSCRIPT_URL        = URL du déploiement Web App retour-experience.gs
 *       APPSCRIPT_SECRET     = secret partagé avec ce script Apps Script
 *       AUTH_APPSCRIPT_URL   = URL du déploiement Web App auth.gs
 *       AUTH_APPSCRIPT_SECRET = secret partagé avec ce script Apps Script
 *  4. Déployer → noter l'URL (ex: https://mf-proxy.moncompte.workers.dev)
 *  5. Mettre cette URL dans CONFIG.METEO_FRANCE.proxyUrl (config.js)
 *
 * Usage depuis le navigateur :
 *   GET  https://mf-proxy.moncompte.workers.dev/paarome?SERVICE=WMS&...
 *   GET  https://mf-proxy.moncompte.workers.dev/aromepi?SERVICE=WMS&...
 *   POST https://mf-proxy.moncompte.workers.dev/retour-experience
 *   POST https://mf-proxy.moncompte.workers.dev/auth/request-link
 *   POST https://mf-proxy.moncompte.workers.dev/auth/verify
 *
 * Les tokens/secrets ne sont JAMAIS exposés côté client.
 */
```

- [ ] **Step 2: Add routing for `/auth/*`**

Current lines 54-59:
```js
    // ── Routing ──────────────────────────────────────────────────
    const path = url.pathname.replace(/^\//, '').split('/')[0];

    if (path === 'retour-experience') {
      return handleRetourExperience(request, env, corsHeaders);
    }
```

Replace with:
```js
    // ── Routing ──────────────────────────────────────────────────
    const segments = url.pathname.replace(/^\//, '').split('/');
    const path = segments[0];

    if (path === 'retour-experience') {
      return handleRetourExperience(request, env, corsHeaders);
    }

    if (path === 'auth') {
      return handleAuth(request, env, corsHeaders, segments[1]);
    }
```

- [ ] **Step 3: Add the handler function**

Add after the closing `}` of `handleRetourExperience` (end of file, currently line 144):

```js

// ── Routes /auth/* — relais vers Google Apps Script (auth.gs) ────
async function handleAuth(request, env, corsHeaders, action) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
  if (action !== 'request-link' && action !== 'verify') {
    return new Response(JSON.stringify({ ok: false, error: 'Action inconnue' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!env.AUTH_APPSCRIPT_URL || !env.AUTH_APPSCRIPT_SECRET) {
    return new Response('Route non configurée (AUTH_APPSCRIPT_URL/AUTH_APPSCRIPT_SECRET manquants)', { status: 500, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'JSON invalide' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let gasJson;
  try {
    const gasRes = await fetch(env.AUTH_APPSCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.AUTH_APPSCRIPT_SECRET, action, ...body }),
    });
    gasJson = await gasRes.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Apps Script injoignable' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(gasJson), {
    status: gasJson.ok ? 200 : 502,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Verify routing + payload shape with a local mock**

```bash
node -e "
const http = require('http');
const mockGas = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const parsed = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    if (parsed.secret !== 'test-secret') { res.end(JSON.stringify({ ok:false, error:'bad secret' })); return; }
    if (parsed.action === 'request-link' && parsed.email === 'test@example.com') {
      res.end(JSON.stringify({ ok: true })); return;
    }
    if (parsed.action === 'verify' && parsed.token === 'abc') {
      res.end(JSON.stringify({ ok: true, email: 'test@example.com', nom: 'Test' })); return;
    }
    res.end(JSON.stringify({ ok: false, error: 'not matched' }));
  });
}).listen(9999, () => console.log('mock GAS on :9999'));
"
```

In a separate terminal, re-read `handleAuth` against this mock's contract: confirm it builds `{ secret: env.AUTH_APPSCRIPT_SECRET, action, ...body }` matching the mock's expected `{secret, action, email}` / `{secret, action, token}` shapes, and that it 404s on any `action` other than `request-link`/`verify`. Cloudflare Workers require `wrangler dev` for a full local run, not set up in this repo — this mock only validates the request/response shape. Full end-to-end verification with the real Worker happens in Task 7.

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker/mf-wms-proxy.js
git commit -m "feat: ajoute les routes /auth/request-link et /auth/verify au Worker"
```

---

### Task 4: Login flow — `auth.js` rewrite + `index.html` markup + `style.css`

**Files:**
- Modify: `pwa/js/auth.js` (full rewrite)
- Modify: `pwa/index.html:31-56` (login overlay markup)
- Modify: `pwa/css/style.css` (add `.login-info`, `.login-form-token`, `.login-btn-secondary`)

**Interfaces:**
- Consumes: `CONFIG.AUTH.workerUrl` (Task 2), `POST {workerUrl}/auth/request-link` and `POST {workerUrl}/auth/verify` (Task 3).
- Produces: `Auth.init(onSuccess)`, `Auth.logout()`, `Auth.isAuthenticated()`, `Auth.getUser()` → `{email, nom} | null`. `Auth.init` and `Auth.logout` keep the exact same signatures as today (called from `index.html:697`, unchanged). `Auth.getUser()` is new — consumed by Task 5 (`retourexperience.js`).

- [ ] **Step 1: Rewrite `pwa/js/auth.js`**

Replace the entire file with:

```js
/**
 * auth.js — Authentification par compte individuel (email + lien magique)
 *
 * Remplace l'ancien login partagé. Chaque plongeur demande un lien de
 * connexion envoyé par email (Worker Cloudflare → Apps Script dédié, cf.
 * specs/2026-08-25-auth-utilisateur-token-design.md). La session est
 * conservée localement 90 jours, glissante, revalidée en tâche de fond dès
 * que l'app est en ligne (jamais bloquant, pour rester utilisable hors
 * ligne en mer).
 */

const Auth = (() => {

  const SESSION_KEY   = 'smpe_auth_v2';
  const SESSION_DUREE_MS = 90 * 24 * 60 * 60 * 1000; // 90 jours, glissant

  let _session = null; // { email, nom, token, ts } une fois connecté

  // ── Session locale ───────────────────────────────────────────

  function _lireSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!stored || !stored.token || !stored.ts) return null;
      if ((Date.now() - stored.ts) >= SESSION_DUREE_MS) return null;
      return stored;
    } catch {
      return null;
    }
  }

  function _ecrireSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // quota dépassé ou stockage indisponible (navigation privée) — la
      // session reste valide pour l'onglet courant, juste pas persistée
    }
  }

  function isAuthenticated() {
    return _lireSession() !== null;
  }

  function getUser() {
    return _session ? { email: _session.email, nom: _session.nom } : null;
  }

  // ── Appels réseau ────────────────────────────────────────────

  async function _appelWorker(action, body) {
    const url = CONFIG.AUTH.workerUrl;
    if (!url) return { ok: false, error: 'workerUrl non configurée' };
    try {
      const res = await fetch(`${url}/auth/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json().catch(() => ({ ok: false, error: 'Réponse invalide' }));
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  async function demanderLien(email) {
    return _appelWorker('request-link', { email: String(email).trim().toLowerCase() });
  }

  async function validerToken(token) {
    const res = await _appelWorker('verify', { token });
    if (res.ok) {
      _session = { email: res.email, nom: res.nom, token, ts: Date.now() };
      _ecrireSession(_session);
    }
    return res;
  }

  // ── Revalidation silencieuse (non bloquante) ────────────────

  function _revaliderEnArrierePlan() {
    if (!navigator.onLine || !_session) return;
    _appelWorker('verify', { token: _session.token }).then(res => {
      if (res.ok) {
        _session = { email: res.email, nom: res.nom, token: _session.token, ts: Date.now() };
        _ecrireSession(_session);
      } else if (res.error !== 'network') {
        // Refus explicite du serveur (compte désactivé) — jamais déclenché
        // par un simple souci réseau, seulement par une réponse ok:false.
        try { localStorage.setItem('smpe_auth_revoque', '1'); } catch {}
        logout();
      }
    });
  }

  // ── Déconnexion ──────────────────────────────────────────────

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  // ── Affichage écran de login ─────────────────────────────────

  function showLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
    let revoque = false;
    try { revoque = !!localStorage.getItem('smpe_auth_revoque'); } catch {}
    if (revoque) {
      try { localStorage.removeItem('smpe_auth_revoque'); } catch {}
      _afficherMessage('login-error', 'Votre accès a été révoqué. Contactez le club.');
    }
  }

  function hideLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function _afficherMessage(elementId, msg) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  // ── Lecture du token dans l'URL (retour du lien magique) ────

  function _extraireTokenURL() {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (token) {
      params.delete('token');
      const reste = params.toString();
      history.replaceState({}, '', location.pathname + (reste ? `?${reste}` : ''));
    }
    return token;
  }

  // ── Initialisation ───────────────────────────────────────────

  function init(onSuccess) {
    const session = _lireSession();
    if (session) {
      _session = session;
      onSuccess();
      _revaliderEnArrierePlan();
      return;
    }

    showLoginScreen();

    async function _valider(token) {
      _afficherMessage('login-info', '');
      _afficherMessage('login-error', '');
      const res = await validerToken(token);
      if (res.ok) {
        hideLoginScreen();
        onSuccess();
      } else {
        _afficherMessage('login-error', 'Lien invalide ou expiré, redemandez un lien.');
      }
    }

    const tokenURL = _extraireTokenURL();
    if (tokenURL) _valider(tokenURL);

    const formLien = document.getElementById('form-demande-lien');
    formLien.addEventListener('submit', async (e) => {
      e.preventDefault();
      _afficherMessage('login-error', '');
      const email = document.getElementById('login-email').value;
      const btn = document.getElementById('btn-demander-lien');
      btn.disabled = true;
      const res = await demanderLien(email);
      btn.disabled = false;
      if (res.ok) {
        _afficherMessage('login-info', 'Lien envoyé — vérifiez vos emails.');
      } else if (res.error === 'network') {
        _afficherMessage('login-error', 'Connexion internet requise pour recevoir le lien.');
      } else {
        _afficherMessage('login-error', "Cet email n'est pas reconnu, contactez le club.");
      }
    });

    const formToken = document.getElementById('form-coller-token');
    formToken.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = document.getElementById('login-token').value.trim();
      if (token) _valider(token);
    });
  }

  return { init, logout, isAuthenticated, getUser };

})();
```

- [ ] **Step 2: Replace the login overlay markup in `pwa/index.html`**

Current lines 31-56:
```html
  <div id="login-overlay" class="login-overlay hidden">
    <div class="login-card">
      <div class="login-logo">
        <img src="icons/logo-smpe.png" alt="Logo SMPE" class="login-logo-img" />
      </div>
      <h2 class="login-title">SMPE Plongée</h2>
      <p class="login-subtitle">Accès réservé aux membres</p>
      <form id="login-form" autocomplete="off">
        <div class="login-field">
          <label for="login-input">Identifiant</label>
          <input id="login-input" type="text" autocomplete="username"
                 placeholder="Identifiant" required />
        </div>
        <div class="login-field">
          <label for="login-password">Mot de passe</label>
          <input id="login-password" type="password" autocomplete="current-password"
                 placeholder="Mot de passe" required />
        </div>
        <p id="login-error" class="login-error hidden"></p>
        <button type="submit" class="login-btn">Connexion</button>
      </form>
      <p class="login-cgu-link">
        <a href="#" id="link-cgu-login">Conditions générales d'utilisation</a>
      </p>
    </div>
  </div>
```

Replace with:
```html
  <div id="login-overlay" class="login-overlay hidden">
    <div class="login-card">
      <div class="login-logo">
        <img src="icons/logo-smpe.png" alt="Logo SMPE" class="login-logo-img" />
      </div>
      <h2 class="login-title">SMPE Plongée</h2>
      <p class="login-subtitle">Accès réservé aux membres</p>
      <form id="form-demande-lien" autocomplete="off">
        <div class="login-field">
          <label for="login-email">Email</label>
          <input id="login-email" type="email" autocomplete="email"
                 placeholder="votre@email.fr" required />
        </div>
        <p id="login-info" class="login-info hidden"></p>
        <p id="login-error" class="login-error hidden"></p>
        <button type="submit" id="btn-demander-lien" class="login-btn">Recevoir mon lien</button>
      </form>
      <form id="form-coller-token" autocomplete="off" class="login-form-token">
        <div class="login-field">
          <label for="login-token">Ou collez le token reçu par email</label>
          <input id="login-token" type="text" placeholder="Token" />
        </div>
        <button type="submit" class="login-btn login-btn-secondary">Valider le token</button>
      </form>
      <p class="login-cgu-link">
        <a href="#" id="link-cgu-login">Conditions générales d'utilisation</a>
      </p>
    </div>
  </div>
```

- [ ] **Step 3: Add CSS for the new elements**

In `pwa/css/style.css`, after the existing `.login-error.hidden { display: none; }` block (currently lines 1765-1767), add:

```css
.login-info {
  color: var(--emeraude-light);
  font-size: 0.85rem;
  margin: 0.4rem 0 0.8rem;
  min-height: 1.2em;
}

.login-info.hidden {
  display: none;
}

.login-form-token {
  margin-top: 1.2rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--emeraude-mid);
}

.login-btn-secondary {
  background: transparent;
  border: 1px solid var(--emeraude-mid);
  color: var(--blanc);
}

.login-btn-secondary:hover {
  background: var(--emeraude-mid);
  color: var(--blanc);
}
```

- [ ] **Step 4: Manual verification in browser**

```bash
cd pwa && npx http-server -p 8080
```

Open `http://localhost:8080` in a browser, devtools open:

1. **Login screen renders** with the email field, "Recevoir mon lien" button, and the "coller le token" fallback form below a visible divider — confirm no console errors.
2. **Stub the network** in the console before submitting, to exercise both code paths without a live Worker:
   ```js
   const _origFetch = window.fetch;
   window.fetch = (url, opts) => {
     if (url.includes('/auth/request-link')) {
       return Promise.resolve({ json: async () => ({ ok: true }) });
     }
     if (url.includes('/auth/verify')) {
       return Promise.resolve({ json: async () => ({ ok: true, email: 'test@example.com', nom: 'Test User' }) });
     }
     return _origFetch(url, opts);
   };
   ```
   Submit the email form → confirm the `#login-info` message "Lien envoyé — vérifiez vos emails." appears (not `#login-error`).
   Type any text into "Coller le token" and submit → confirm the login overlay hides and the app starts (the stub always returns `ok:true` for `verify`).
3. **Reload the page** → confirm the app starts immediately without showing the login screen (session was written to `localStorage['smpe_auth_v2']` by step 2's verify call) — check via `JSON.parse(localStorage.getItem('smpe_auth_v2'))` that it has `{email, nom, token, ts}`.
4. **Simulate expiry**: `const s = JSON.parse(localStorage.getItem('smpe_auth_v2')); s.ts = Date.now() - 91*24*60*60*1000; localStorage.setItem('smpe_auth_v2', JSON.stringify(s)); location.reload();` → confirm the login screen reappears.
5. **Simulate the URL token path**: with the fetch stub from step 2 still active (re-apply it after reload if needed), navigate to `http://localhost:8080/?token=anything` → confirm it auto-validates (no manual submit needed) and the URL is cleaned to `http://localhost:8080/` afterward (check `location.search` is empty).
6. Restore real fetch when done: `window.fetch = _origFetch;`.

- [ ] **Step 5: Commit**

```bash
git add pwa/js/auth.js pwa/index.html pwa/css/style.css
git commit -m "feat: remplace le login partagé par un compte individuel (email + lien magique)"
```

---

### Task 5: Auto-fill "rempli par" from the authenticated user

**Files:**
- Modify: `pwa/index.html:493-496`
- Modify: `pwa/js/retourexperience.js:178,187,257-264`

**Interfaces:**
- Consumes: `Auth.getUser()` → `{email, nom}` (Task 4). `RetourExperience.init()` already runs after `Auth.init`'s `onSuccess` (via `App.init()`, `index.html:697`), so `Auth.getUser()` is always populated by the time this module runs.

- [ ] **Step 1: Make the field read-only in `index.html`**

Current lines 493-496:
```html
        <div class="re-field">
          <label for="re-rempli-par">Rempli par</label>
          <input type="text" id="re-rempli-par" placeholder="Nom et prénom" required>
        </div>
```

Replace with:
```html
        <div class="re-field">
          <label for="re-rempli-par">Rempli par</label>
          <input type="text" id="re-rempli-par" readonly>
        </div>
```

- [ ] **Step 2: Pre-fill it from `Auth.getUser()` in `retourexperience.js`**

In `_reinitialiserForm()` (current lines 257-264):
```js
  function _reinitialiserForm() {
    document.getElementById('form-retour-experience').reset();
    document.querySelectorAll('#modal-retour-experience .re-btn.active').forEach(b => b.classList.remove('active'));
    document.getElementById('re-calculs').classList.add('hidden');
    _erreur('');
    document.getElementById('re-date').value = _dateLocaleISO();
    document.getElementById('re-date').max = _dateLocaleISO();
  }
```

Add a line after `.reset()` (form reset would otherwise clear the readonly field's displayed value, so it must be re-applied after):
```js
  function _reinitialiserForm() {
    document.getElementById('form-retour-experience').reset();
    document.getElementById('re-rempli-par').value = Auth.getUser()?.nom || '';
    document.querySelectorAll('#modal-retour-experience .re-btn.active').forEach(b => b.classList.remove('active'));
    document.getElementById('re-calculs').classList.add('hidden');
    _erreur('');
    document.getElementById('re-date').value = _dateLocaleISO();
    document.getElementById('re-date').max = _dateLocaleISO();
  }
```

- [ ] **Step 3: Read the authenticated name instead of the input in `_construireDonnees()`**

Current line 178:
```js
    const rempliPar = document.getElementById('re-rempli-par').value.trim();
```

Replace with:
```js
    const rempliPar = Auth.getUser()?.nom || '';
```

Current line 187:
```js
    if (!rempliPar) return { erreur: 'Indiquez le nom et prénom de la personne qui remplit le formulaire.' };
```

Delete this line entirely — a logged-in user always has a `nom` (guaranteed by `auth.gs`'s `_trouverUtilisateur`, which only returns active rows from the `utilisateurs` sheet), so the free-text validation no longer applies.

- [ ] **Step 4: Manual verification in browser**

```bash
cd pwa && npx http-server -p 8080
```

With a valid session in `localStorage['smpe_auth_v2']` (from Task 4's Step 4 verification, or seed one manually: `localStorage.setItem('smpe_auth_v2', JSON.stringify({email:'test@example.com', nom:'Test User', token:'x', ts: Date.now()})); location.reload();`), open the retour d'expérience form (menu → 📝 Retour d'expérience) and confirm the "Rempli par" field shows "Test User", greyed out / non-editable, and that submitting a filled form no longer requires typing anything in that field.

- [ ] **Step 5: Commit**

```bash
git add pwa/index.html pwa/js/retourexperience.js
git commit -m "feat: pré-remplit 'rempli par' depuis le compte connecté"
```

---

### Task 6: Bump Service Worker `VERSION`

**Files:**
- Modify: `pwa/sw.js`

**Interfaces:** none — internal cache-busting only.

- [ ] **Step 1: Bump the version**

In `pwa/sw.js`, change:
```js
const VERSION = 'v36';
```
to:
```js
const VERSION = 'v37';
```

No entries need to be added to `ASSETS_STATIQUES` — `auth.js`, `index.html`, `config.js`, `retourexperience.js`, and `style.css` are all pre-existing files already listed there; only their content changed.

- [ ] **Step 2: Verify**

```bash
grep -n "^const VERSION" pwa/sw.js
```
Expected: `const VERSION = 'v37';`

- [ ] **Step 3: Commit**

```bash
git add pwa/sw.js
git commit -m "chore: bump SW v37 (auth par lien magique)"
```

---

### Task 7: End-to-end manual verification (real deployment)

**Files:** none — verification only, per the spec's own "Plan de test manuel" section (`specs/2026-08-25-auth-utilisateur-token-design.md`).

**Prerequisites:**
- Task 1's `auth.gs` deployed with real `AUTH_APPSCRIPT_SECRET`/`AUTH_TOKEN_SECRET`/`SHEET_ID`/`PWA_URL`, and the Sheet's `utilisateurs` tab populated with at least one row for a real, reachable test email with `actif = VRAI`.
- Task 3's Worker deployed with matching `AUTH_APPSCRIPT_URL`/`AUTH_APPSCRIPT_SECRET` env vars.
- `CONFIG.AUTH.workerUrl` (Task 2) pointing at the deployed Worker.
- All members currently able to log in with the shared `smpe`/`smpe2026` password added to the `utilisateurs` tab **before** this task's Step 8 (final cutover) — per the spec's Migration section.

- [ ] **Step 1:** Enter a registered, active email on the login screen → confirm an email arrives (check spam folder too) containing both a clickable link and the raw token text.

- [ ] **Step 2:** Enter an email **not** present in the `utilisateurs` tab (or present with `actif = FAUX`) → confirm the error "Cet email n'est pas reconnu, contactez le club." displays and no email is sent.

- [ ] **Step 3:** Click the link from Step 1's email → confirm the app opens, logs in, and the URL no longer contains `?token=...`.

- [ ] **Step 4:** Copy the raw token text from Step 1's email instead, paste it into "Coller le token" and submit → confirm login succeeds through this path too.

- [ ] **Step 5:** After a successful login, enable airplane mode and reload the app → confirm it starts immediately without any login prompt or network wait.

- [ ] **Step 6:** With the device still logged in, in the `utilisateurs` Sheet set that email's `actif` to `FAUX`, re-enable network, reload the app → confirm the app logs out automatically and shows "Votre accès a été révoqué. Contactez le club." on the login screen. Set `actif` back to `VRAI` afterward to restore the test account.

- [ ] **Step 7:** Log in again with a fresh token (Step 1-3), open the retour d'expérience form, confirm "Rempli par" is pre-filled read-only with the name from the Sheet's `nom` column, and that a submission succeeds end-to-end (row appears in `retours_plongee` with the correct `rempliPar` value).

- [ ] **Step 8:** Once all real members are confirmed present and `actif = VRAI` in the `utilisateurs` tab, run `./sync_docs.sh "feat: authentification par compte individuel (email + lien magique)"` and, on a tablet, confirm the SW updates to `v37` (check the console or `chrome://inspect` for cache name `smpe-static-v37`) and that the old `smpe`/`smpe2026` login no longer works (the form no longer has those fields at all).

- [ ] **Step 9: Final commit (if `sync_docs.sh` wasn't already run in Step 8)**

```bash
git status
```

If anything is uncommitted at this point, review and commit it — otherwise this task produces no code changes beyond what Tasks 1-6 already committed.
