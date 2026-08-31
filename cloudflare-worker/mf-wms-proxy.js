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

const MF_ENDPOINTS = {
  paarome: 'https://public-api.meteofrance.fr/public/arome/1.0/wms/MF-NWP-HIGHRES-PAAROME-001-FRANCE-WMS/GetMap',
  aromepi: 'https://public-api.meteofrance.fr/public/aromepi/1.0/wms/MF-NWP-HIGHRES-AROMEPI-001-FRANCE-WMS/GetMap',
};

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

// Origines autorisées (ajouter votre domaine custom si besoin)
const ALLOWED_ORIGINS = [
  'https://gallonr.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null',  // file://
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    const corsOk = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
    const corsHeaders = {
      'Access-Control-Allow-Origin':  corsOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Routing ──────────────────────────────────────────────────
    const segments = url.pathname.replace(/^\//, '').split('/');
    const path = segments[0];

    if (path === 'retour-experience') {
      return handleRetourExperience(request, env, corsHeaders);
    }

    if (path === 'auth') {
      return handleAuth(request, env, corsHeaders, segments[1]);
    }

    if (path === 'sites') {
      return handleSites(request, env, corsHeaders, ctx);
    }

    if (path === 'marees') {
      return handleMarees(request, env, corsHeaders);
    }

    const endpoint = MF_ENDPOINTS[path];
    if (!endpoint) {
      return new Response('Not found. Use /paarome, /aromepi ou /retour-experience', { status: 404, headers: corsHeaders });
    }

    // ── Token côté serveur (jamais exposé au client) ────────────
    const token = path === 'paarome'
      ? env.MF_TOKEN_PAAROME
      : env.MF_TOKEN_AROMEPI;

    if (!token) {
      return new Response(`Secret ${path === 'paarome' ? 'MF_TOKEN_PAAROME' : 'MF_TOKEN_AROMEPI'} non configuré`, { status: 500 });
    }

    // ── Construction de l'URL MF ────────────────────────────────
    const mfUrl = new URL(endpoint);
    mfUrl.searchParams.set('apikey', token);
    // Recopier tous les paramètres WMS du client
    for (const [k, v] of url.searchParams.entries()) {
      mfUrl.searchParams.set(k, v);
    }

    // ── Requête vers MF ─────────────────────────────────────────
    const mfRes = await fetch(mfUrl.toString(), {
      headers: {
        'User-Agent': 'diveSMPE-proxy/1.0',
        'Accept':     'image/png,image/*',
      },
    });

    // ── Réponse au client ───────────────────────────────────────
    const contentType = mfRes.headers.get('Content-Type') || 'image/png';
    const body = await mfRes.arrayBuffer();

    return new Response(body, {
      status: mfRes.status,
      headers: {
        ...corsHeaders,
        'Content-Type':  contentType,
        'Cache-Control': 'public, max-age=900',  // 15 min
      },
    });
  },
};

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

  let gasJson;
  try {
    const gasRes = await fetch(env.APPSCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.APPSCRIPT_SECRET, data }),
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

// ── Route /sites — relais vers Google Apps Script (bdd.gs) ───────
// L'Apps Script est lent et irrégulier (constaté : 2–15 s, parfois timeout).
// On protège donc la route par :
//  - un timeout explicite sur l'appel amont (évite un hang de 30 s / une 1101) ;
//  - une validation stricte de la réponse + un try/catch autour de la
//    transformation GeoJSON (une réponse amont malformée renvoie une 502
//    propre, jamais une exception Worker) ;
//  - un cache KV (binding MAREES_KV, clé `sites_geojson_cache`) : réponse
//    immédiate si la copie a moins de SITES_FRESH_MS, sinon rafraîchissement
//    depuis l'Apps Script. En cas d'échec/lenteur/réponse invalide amont, on
//    sert la dernière copie connue (jusqu'à SITES_STALE_TTL_S). L'API Cache
//    de Cloudflare (`caches.default`) n'étant pas opérante sur *.workers.dev,
//    on passe par le KV qui, lui, fonctionne partout.
const SITES_CACHE_KEY   = 'sites_geojson_cache';
const SITES_FRESH_MS    = 5 * 60 * 1000;   // fraîcheur : au-delà, on rafraîchit
const SITES_STALE_TTL_S = 24 * 60 * 60;    // survie de la copie de secours

async function handleSites(request, env, corsHeaders, ctx) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
  if (!env.BDD_APPSCRIPT_URL || !env.BDD_APPSCRIPT_SECRET) {
    return new Response('Route non configurée (BDD_APPSCRIPT_URL/BDD_APPSCRIPT_SECRET manquants)', { status: 500, headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
  const kv = env.MAREES_KV || null;

  // Lecture de la copie KV (contenu + date de mise en cache via metadata).
  let cachedBody = null, cachedTs = 0;
  if (kv) {
    try {
      const { value, metadata } = await kv.getWithMetadata(SITES_CACHE_KEY);
      if (value) { cachedBody = value; cachedTs = (metadata && metadata.ts) || 0; }
    } catch (e) { /* KV indisponible → on ignore, on ira taper l'Apps Script */ }
  }

  // Copie encore fraîche → réponse immédiate, pas d'appel amont.
  if (cachedBody && (Date.now() - cachedTs) < SITES_FRESH_MS) {
    return new Response(cachedBody, {
      status: 200,
      headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=300', 'X-Cache': 'hit' },
    });
  }

  // Sinon : rafraîchir depuis l'Apps Script, avec repli sur la copie KV
  // (même périmée) en cas d'échec.
  const serveStaleOr = (fallback) =>
    cachedBody
      ? new Response(cachedBody, { status: 200, headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=60', 'X-Cache': 'stale' } })
      : fallback;

  let gasJson;
  try {
    const gasRes = await fetch(env.BDD_APPSCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.BDD_APPSCRIPT_SECRET }),
      signal: AbortSignal.timeout(20000),
    });
    gasJson = await gasRes.json();
  } catch (e) {
    return serveStaleOr(new Response(JSON.stringify({ error: 'Apps Script injoignable' }), {
      status: 502, headers: jsonHeaders,
    }));
  }

  if (!gasJson || !gasJson.ok || !Array.isArray(gasJson.rows)) {
    return serveStaleOr(new Response(JSON.stringify({ error: (gasJson && gasJson.error) || 'Réponse Apps Script invalide' }), {
      status: 502, headers: jsonHeaders,
    }));
  }

  let body;
  try {
    body = JSON.stringify(_buildSitesGeoJSON(gasJson.rows));
  } catch (e) {
    return serveStaleOr(new Response(JSON.stringify({ error: 'Transformation GeoJSON échouée' }), {
      status: 502, headers: jsonHeaders,
    }));
  }

  // Mémoriser dans le KV (contenu frais + horodatage), en tâche de fond.
  if (kv) {
    const put = kv.put(SITES_CACHE_KEY, body, {
      expirationTtl: SITES_STALE_TTL_S,
      metadata: { ts: Date.now() },
    });
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }

  return new Response(body, {
    status: 200,
    headers: { ...jsonHeaders, 'Cache-Control': 'public, max-age=300', 'X-Cache': cachedBody ? 'refresh' : 'miss' },
  });
}

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
