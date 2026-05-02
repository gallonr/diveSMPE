/**
 * config.js — Configuration globale de l'application SMPE Plongée
 */

const CONFIG = {
  // ── Données ────────────────────────────────────────────────
  DATA: {
    sites:  'data/sites.geojson',
    marees: 'data/marees.json',
    bathy:  'data/bathy_sites.json',   // profils transects LiDAR LITTO3D
  },

  // ── Carte ──────────────────────────────────────────────────
  CARTE: {
    centre:  [48.68, -2.02],   // Baie de Saint-Malo
    zoom:    12,
    zoomMin: 8,
    zoomMax: 18,
  },

  // ── Tuiles cartographiques ─────────────────────────────────
  TILES: {
    // OpenStreetMap (fallback universel, pas de clé nécessaire)
    osm: {
      url:         'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    },
    // ESRI Ocean Basemap — relief bathymétrique, idéal pour la plongée
    esriOcean: {
      url:         'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri',
      maxZoom: 13,
    },
    // ESRI Ocean Reference — noms et annotations par-dessus l'Ocean Basemap
    esriOceanRef: {
      url:         'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
      attribution: '',
      maxZoom: 13,
      opacity: 1,
    },
    // IGN France — Plan IGN (WMTS Géoportail, sans clé)
    ignPlan: {
      url:         'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      attribution: '<a href="https://www.ign.fr/">IGN</a>',
      maxZoom: 19,
    },
    // SHOM/IGN — Cartes littorales (fusion cartes marines SHOM + cartes terrestres IGN, Géoportail, sans clé)
    shom: {
      url:         'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.COASTALMAPS&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      attribution: '<a href="https://www.shom.fr/">SHOM</a> / <a href="https://www.ign.fr/">IGN</a>',
      maxZoom: 18,
    },
    // OpenSeaMap overlay nautique
    openSeaMap: {
      url:         'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
      attribution: '© <a href="https://www.openseamap.org">OpenSeaMap</a> contributors',
      maxZoom: 18,
      opacity: 0.8,
    },
    // SHOM Litto3D Bretagne 2018-2021 — WMS bathymétrie/altimétrie
    litto3d: {
      url:         'https://services.data.shom.fr/INSPIRE/wms/r?',
      layer:       'LITTO3D_BZH_2018_2021_PYR_3857_WMSR',
      attribution: '© <a href="https://www.shom.fr/">SHOM</a> — Litto3D Bretagne 2018-2021',
      format:      'image/png',
      transparent: true,
      opacity:     0.7,
    },

    // ── Overlays WMS Météo-France ───────────────────────────────
    // Token requis : CONFIG.METEO_FRANCE.token (injecté via secrets.js)
    // L'API WMS retourne des images PNG d'un champ 2D → overlay Leaflet.
    // ⚠️  Visible dans les DevTools (réseau) — acceptable pour usage associatif.

    // PAAROME — analyse conditions actuelles (assimilation, délai ~3h)
    analyseVent: {
      wmsUrl:      'https://public-api.meteofrance.fr/public/arome/1.0/wms/MF-NWP-HIGHRES-PAAROME-001-FRANCE-WMS/GetMap',
      layer:       'WIND_SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND',
      style:       'BARBULES',
      elevation:   '10',
      attribution: '© <a href="https://meteofrance.fr">Météo-France</a> PAAROME',
      format:      'image/png',
      transparent: true,
      opacity:     0.65,
      timeMode:    'analyse',
    },

    // AROME-PI — rafales 15 min, nowcasting 0–6h
    aromePiRafales: {
      wmsUrl:      'https://public-api.meteofrance.fr/public/aromepi/1.0/wms/MF-NWP-HIGHRES-AROMEPI-001-FRANCE-WMS/GetMap',
      layer:       'WIND_GUST_15MIN__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND',
      style:       'FF_RAF__HEIGHT__SHADING',
      elevation:   '10',
      attribution: '© <a href="https://meteofrance.fr">Météo-France</a> AROME-PI',
      format:      'image/png',
      transparent: true,
      opacity:     0.55,
      timeStep:    15,
    },
  },

  // ── Navigation ─────────────────────────────────────────────
  NAV: {
    vitesseDefaut: 6,   // nœuds
    watchGPS: true,     // suivi GPS continu
  },

  // ── Marées ────────────────────────────────────────────────
  MAREES: {
    // Correction FES2022 → zéro hydrographique (ZH SHOM) à Saint-Malo.
    // FES2022 surestime légèrement le marnage. Calibration OLS sur données
    // annuaire SHOM du 17 au 23/04/2026 (27 points : PM + BM) :
    //   h_ZH = hcm/100 * MSL_SCALE + MSL_OFFSET_M
    // RMS résidus = 0.16m ; biais BM = -0.01m ; biais PM = +0.02m.
    MSL_SCALE:    0.9822,  // facteur d'échelle (FES légèrement surestimé)
    MSL_OFFSET_M: 6.5278,  // offset MSL FES2022 → ZH SHOM Saint-Malo (m)
  },

  // ── Port (seuil + pieds de pilote des bateaux) ────────────
  PORT: {
    // Hauteur du seuil d'entrée du port au-dessus du zéro hydrographique (m ZH)
    seuilZH: 2.0,
    // Embarcations du club : nom + tirant d'eau (m)
    bateaux: [
      { nom: 'Maclow',     tirant: 1.3 },
      { nom: 'Cassiopée',  tirant: 1.1 },
      { nom: 'Neptune',    tirant: 0.7 },
    ],
  },

  // ── Météo (OpenMeteo — gratuit, pas de clé) ────────────────
  METEO: {
    // Coordonnées de Saint-Malo pour la météo générale
    lat:      48.65,
    lon:     -2.02,
    timeout:  5000,     // ms avant d'abandonner la requête
  },

  // ── Météo-France API (AROME / MFWAM) ──────────────────────
  // ⚠️  L'API "Ciblée Modèles" retourne des fichiers GRIB2 (WCS) ou des
  //     images PNG (WMS). Les GRIB2 ne sont pas décodables dans un navigateur
  //     (nécessitent eccodes côté serveur). Pas d'intégration données chiffrées
  //     possible sur GitHub Pages sans backend proxy.
  //     Les overlays WMS (champ vent/houle) restent envisageables comme couches
  //     Leaflet supplémentaires (voir CONFIG.TILES).
  //     Doc : https://confluence-meteofrance.atlassian.net/wiki/x/AYCVKg
  // Tokens gratuits : https://portail-api.meteofrance.fr/
  // Chaque API du portail peut avoir son propre token d'abonnement.
  METEO_FRANCE: {
    tokenAromePi: null,   // token API AROME-PI (nowcasting 0–6h, pas 15 min)
    tokenPaArome: null,   // token API PAAROME = Analyse AROME (données d'analyse 0–1h)
    baseUrl: 'https://public-api.meteofrance.fr/public',
    timeout: 7000,
  },

  // ── Types de sites → couleur + badge ──────────────────────
  TYPE_SITE: {
    récif:  { classe: 'badge-recif',   markerClasse: 'marker-recif',   emoji: '🪸' },
    epave:  { classe: 'badge-epave',   markerClasse: 'marker-epave',   emoji: '⚓' },
    épave:  { classe: 'badge-epave',   markerClasse: 'marker-epave',   emoji: '⚓' },
    roche:  { classe: 'badge-roche',   markerClasse: 'marker-roche',   emoji: '🪨' },
    default:{ classe: 'badge-default', markerClasse: 'marker-default', emoji: '📍' },
  },
};

// Clé de cache Service Worker (incrémentez à chaque mise à jour)
const SW_CACHE_VERSION = 'smpe-v9';
