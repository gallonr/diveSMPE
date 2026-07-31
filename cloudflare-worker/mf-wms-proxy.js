/**
 * Cloudflare Worker — Proxy WMS Météo-France + relais retour d'expérience
 *
 * Déploiement :
 *  1. Créer un compte sur https://workers.cloudflare.com/
 *  2. Nouveau Worker → coller ce code
 *  3. Dans "Settings > Variables" du Worker, ajouter les secrets :
 *       MF_TOKEN_PAAROME   = votre_token_paarome
 *       MF_TOKEN_AROMEPI   = votre_token_aromepi
 *       APPSCRIPT_URL      = URL du déploiement Web App Google Apps Script (retour-experience.gs)
 *       APPSCRIPT_SECRET   = secret partagé avec ce script Apps Script
 *  4. Déployer → noter l'URL (ex: https://mf-proxy.moncompte.workers.dev)
 *  5. Mettre cette URL dans CONFIG.METEO_FRANCE.proxyUrl (config.js)
 *
 * Usage depuis le navigateur :
 *   GET  https://mf-proxy.moncompte.workers.dev/paarome?SERVICE=WMS&...
 *   GET  https://mf-proxy.moncompte.workers.dev/aromepi?SERVICE=WMS&...
 *   POST https://mf-proxy.moncompte.workers.dev/retour-experience
 *
 * Le token n'est JAMAIS exposé côté client.
 */

const MF_ENDPOINTS = {
  paarome: 'https://public-api.meteofrance.fr/public/arome/1.0/wms/MF-NWP-HIGHRES-PAAROME-001-FRANCE-WMS/GetMap',
  aromepi: 'https://public-api.meteofrance.fr/public/aromepi/1.0/wms/MF-NWP-HIGHRES-AROMEPI-001-FRANCE-WMS/GetMap',
};

// Origines autorisées (ajouter votre domaine custom si besoin)
const ALLOWED_ORIGINS = [
  'https://gallonr.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null',  // file://
];

export default {
  async fetch(request, env) {
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
    const path = url.pathname.replace(/^\//, '').split('/')[0];

    if (path === 'retour-experience') {
      return handleRetourExperience(request, env, corsHeaders);
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
