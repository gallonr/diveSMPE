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

  // ── Météo (OpenMeteo — gratuit, pas de clé) ────────────────
  METEO: {
    // Coordonnées de Saint-Malo pour la météo générale
    lat:      48.65,
    lon:     -2.02,
    timeout:  5000,     // ms avant d'abandonner la requête
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
