/**
 * sw.js — Service Worker SMPE Plongée (Phase 11 — v6 FES2022)
 * Stratégie : Cache First pour les assets statiques + données
 * Mise à jour au lancement si connecté (Network First pour API)
 */

// ── Configuration ─────────────────────────────────────────────
const DEBUG   = false;          // Passer à true pour les logs en développement
const VERSION = 'v7';

const CACHE_STATIC  = `smpe-static-${VERSION}`;
const CACHE_DYNAMIC = `smpe-dynamic-${VERSION}`;
const KNOWN_CACHES  = [CACHE_STATIC, CACHE_DYNAMIC];

const CACHE_DYNAMIC_MAX_ENTRIES = 300;  // Limite du cache des tuiles

// ── Logger conditionnel ───────────────────────────────────────
const log  = (...args) => DEBUG && console.log('[SW]', ...args);
const warn = (...args) => console.warn('[SW]', ...args);

// ── Assets à mettre en cache à l'installation ─────────────────
const ASSETS_STATIQUES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/config.js',
  '/js/marees.js',
  '/js/mareesite.js',
  '/js/bathy.js',
  '/js/carte.js',
  '/js/sites.js',
  '/js/navigation.js',
  '/js/meteo.js',
  '/js/auth.js',
  '/js/app.js',
  '/data/sites.geojson',
  '/data/marees.json',
  '/data/bathy_sites.json',
  '/libs/leaflet/leaflet.css',
  '/libs/leaflet/leaflet.js',
  '/libs/turf/turf.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/logo-smpe.png',
];

// ── Installation : mise en cache des assets statiques ─────────
self.addEventListener('install', event => {
  log('Installation — cache des assets statiques');
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        // On tente tous les assets ; les erreurs individuelles ne bloquent pas
        return Promise.allSettled(
          ASSETS_STATIQUES.map(url => cache.add(url).catch(e => {
            warn('Impossible de mettre en cache :', url, e.message);
          }))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activation : nettoyage des vieux caches ───────────────────
self.addEventListener('activate', event => {
  log('Activation');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => !KNOWN_CACHES.includes(k))
          .map(k => {
            log('Suppression vieux cache :', k);
            return caches.delete(k);
          })
      )
    )
    .then(() => self.clients.claim())
    .then(() => _notifyClients({ type: 'SW_UPDATED', version: VERSION }))
  );
});

// ── Fetch : stratégies par type de requête ────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes non-GET
  if (event.request.method !== 'GET') return;

  // ── API Open-Meteo (Network First, fallback cache) ──────────
  if (url.hostname.includes('open-meteo.com')) {
    event.respondWith(_networkFirst(event.request, CACHE_DYNAMIC));
    return;
  }

  // ── Tuiles cartographiques (Cache First avec mise à jour réseau) ──
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('tiles.openseamap.org') ||
    url.hostname.includes('wxs.ign.fr')
  ) {
    event.respondWith(_cacheFirstThenNetwork(event.request, CACHE_DYNAMIC));
    return;
  }

  // ── Assets statiques de l'appli (Cache First strict) ────────
  event.respondWith(_cacheFirst(event.request, CACHE_STATIC));
});

// ── Stratégie : Cache First ───────────────────────────────────
async function _cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    warn('Ressource non disponible offline :', request.url);
    return _offlineFallback(request);
  }
}

// ── Stratégie : Cache First + mise à jour en arrière-plan ────
async function _cacheFirstThenNetwork(request, cacheName) {
  const cached = await caches.match(request);

  const fetchPromise = fetch(request, { signal: AbortSignal.timeout(8000) })
    .then(async response => {
      // Ne pas mettre en cache les réponses opaques (erreurs silencieuses CORS)
      if (response && response.status === 200 && response.type !== 'opaque') {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
        await _trimCache(cacheName, CACHE_DYNAMIC_MAX_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response('', { status: 503 });
}

// ── Stratégie : Network First (avec fallback cache) ──────────
async function _networkFirst(request, cacheName) {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(8000) });
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });
  }
}

// ── Message depuis l'app (ex: forcer mise à jour) ────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═════════════════════════════════════════════════════════════
// Utilitaires
// ═════════════════════════════════════════════════════════════

// ── Limite la taille d'un cache ───────────────────────────────
async function _trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map(k => cache.delete(k)));
    log(`Cache ${cacheName} réduit : ${keys.length} → ${maxEntries} entrées`);
  }
}

// ── Réponse offline adaptée au type de ressource demandé ──────
function _offlineFallback(request) {
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'offline' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });
  }
  if (accept.includes('image/')) {
    // SVG transparent 1×1
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      { headers: { 'Content-Type': 'image/svg+xml' }, status: 503 }
    );
  }
  // HTML par défaut
  return new Response(
    '<!DOCTYPE html><html lang="fr"><body><h1>Mode offline — ressource non disponible</h1></body></html>',
    { headers: { 'Content-Type': 'text/html' }, status: 503 }
  );
}

// ── Envoie un message à tous les clients ouverts ──────────────
async function _notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => client.postMessage(message));
  log(`Notification envoyée à ${clients.length} client(s) :`, message.type);
}
