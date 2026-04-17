/**
 * carte.js — Initialisation et gestion de la carte Leaflet (Phase 6)
 * Fond OSM + overlay OpenSeaMap + marqueurs sites + GPS
 */

const Carte = (() => {

  let _map = null;
  let _layerSites = null;
  let _markerGPS = null;
  let _ligneNav = null;
  let _overlayBathy = null;       // L.imageOverlay MNT actif
  let _overlayOpacity = 0.65;     // opacité par défaut
  let _etatsMaree = new Map();    // siteID → { statut, label } (mis à jour par Sites)

  // ── Init carte ───────────────────────────────────────────────

  function init() {
    _map = L.map('map', {
      center:  CONFIG.CARTE.centre,
      zoom:    CONFIG.CARTE.zoom,
      minZoom: CONFIG.CARTE.zoomMin,
      maxZoom: CONFIG.CARTE.zoomMax,
      zoomControl: true,
    });

    // Couche de base : OpenStreetMap
    const osm = L.tileLayer(CONFIG.TILES.osm.url, {
      attribution: CONFIG.TILES.osm.attribution,
      maxZoom: CONFIG.TILES.osm.maxZoom,
    });

    // Couche de base : ESRI Ocean Basemap
    const esriOcean = L.tileLayer(CONFIG.TILES.esriOcean.url, {
      attribution: CONFIG.TILES.esriOcean.attribution,
      maxZoom: CONFIG.TILES.esriOcean.maxZoom,
    });
    const esriOceanRef = L.tileLayer(CONFIG.TILES.esriOceanRef.url, {
      attribution: CONFIG.TILES.esriOceanRef.attribution,
      maxZoom: CONFIG.TILES.esriOceanRef.maxZoom,
      opacity: CONFIG.TILES.esriOceanRef.opacity,
    });
    // Groupe ESRI Ocean : base + annotations
    const esriOceanGroup = L.layerGroup([esriOcean, esriOceanRef]);

    // Couche de base : IGN Plan V2
    const ignPlan = L.tileLayer(CONFIG.TILES.ignPlan.url, {
      attribution: CONFIG.TILES.ignPlan.attribution,
      maxZoom: CONFIG.TILES.ignPlan.maxZoom,
    });

    // Couche de base : SHOM cartes marines
    const shom = L.tileLayer(CONFIG.TILES.shom.url, {
      attribution: CONFIG.TILES.shom.attribution,
      maxZoom: CONFIG.TILES.shom.maxZoom,
    });

    // Fond par défaut : SHOM cartes marines
    shom.addTo(_map);

    // Overlay OpenSeaMap
    const openSeaMap = L.tileLayer(CONFIG.TILES.openSeaMap.url, {
      attribution: CONFIG.TILES.openSeaMap.attribution,
      maxZoom: CONFIG.TILES.openSeaMap.maxZoom,
      opacity: CONFIG.TILES.openSeaMap.opacity,
    }).addTo(_map);

    // Contrôle des couches
    L.control.layers(
      {
        '⚓ SHOM Marine':   shom,
        '🗺️ IGN Plan':     ignPlan,
        '🌊 ESRI Ocean':   esriOceanGroup,
        '🗾 OpenStreetMap': osm,
      },
      { 'OpenSeaMap ⚓': openSeaMap },
      { position: 'topright', collapsed: true }
    ).addTo(_map);

    // Attribution compacte
    _map.attributionControl.setPrefix('');

    return _map;
  }

  // ── Marqueurs sites ──────────────────────────────────────────

  function _getTypeInfo(typeSite) {
    if (!typeSite) return CONFIG.TYPE_SITE.default;
    const key = typeSite.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return CONFIG.TYPE_SITE[typeSite.toLowerCase()] ||
           CONFIG.TYPE_SITE[key] ||
           CONFIG.TYPE_SITE.default;
  }

  function _creerIcone(typeSite, statut) {
    const info = _getTypeInfo(typeSite);
    const dot = (statut && statut !== 'gris')
      ? `<span class="marker-maree-dot marker-maree-dot-${statut}"></span>`
      : '';
    return L.divIcon({
      className: '',
      html: `<div class="marker-icon ${info.markerClasse}">${dot}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 29],
      popupAnchor: [0, -32],
    });
  }

  function afficherSites(geojsonData, onClickSite) {
    if (_layerSites) _map.removeLayer(_layerSites);

    _layerSites = L.geoJSON(geojsonData, {
      pointToLayer(feature, latlng) {
        const props = feature.properties;
        const etat  = _etatsMaree.get(props.siteID);
        const icone = _creerIcone(props.typeSite, etat?.statut);
        const marker = L.marker(latlng, { icon: icone });

        const info = _getTypeInfo(props.typeSite);
        const popupHtml = `
          <div class="popup-titre">${info.emoji} ${props.siteNom || props.siteID}</div>
          <div class="popup-id">${props.siteID}</div>
          <div class="popup-type">
            <span class="badge-type ${info.classe}">${props.typeSite || '—'}</span>
          </div>
          <button class="popup-btn" onclick="App.ouvrirFiche('${props.siteID}')">
            📋 Voir la fiche
          </button>
        `;
        marker.bindPopup(popupHtml, { maxWidth: 220 });
        marker.on('click', () => {
          if (typeof Sites !== 'undefined') Sites.selectionner(props.siteID);
        });
        return marker;
      }
    }).addTo(_map);

    return _layerSites;
  }

  // ── GPS ──────────────────────────────────────────────────────

  function afficherGPS(lat, lon) {
    const latlng = [lat, lon];
    if (_markerGPS) {
      _markerGPS.setLatLng(latlng);
    } else {
      _markerGPS = L.marker(latlng, {
        icon: L.divIcon({
          className: '',
          html: '<div class="marker-gps"></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        zIndexOffset: 1000,
      }).bindPopup('📍 Ma position').addTo(_map);
    }
  }

  function centrerSurGPS(lat, lon) {
    _map.flyTo([lat, lon], Math.max(_map.getZoom(), 14), { duration: 1 });
  }

  // ── Ligne de navigation ──────────────────────────────────────

  function afficherLigneNav(latDep, lonDep, latArr, lonArr) {
    if (_ligneNav) _map.removeLayer(_ligneNav);
    _ligneNav = L.polyline(
      [[latDep, lonDep], [latArr, lonArr]],
      { color: '#2ecc71', weight: 2, dashArray: '6 6', opacity: 0.8 }
    ).addTo(_map);
  }

  function supprimerLigneNav() {
    if (_ligneNav) { _map.removeLayer(_ligneNav); _ligneNav = null; }
  }

  // ── Overlay bathymétrie LiDAR ────────────────────────────────

  /**
   * Affiche/masque la miniature MNT du site comme overlay sur la carte.
   * @param {string|null} siteID  null = masquer l'overlay
   */
  function toggleOverlayBathy(siteID) {
    // Supprimer l'overlay précédent
    if (_overlayBathy) {
      _map.removeLayer(_overlayBathy);
      _overlayBathy = null;
    }
    if (!siteID) return;

    const entry = (typeof Bathy !== 'undefined') ? Bathy.get(siteID) : null;
    if (!entry || !entry.grid || !entry.grid.bounds_wgs84) return;

    const b = entry.grid.bounds_wgs84;
    const bounds = [[b.south, b.west], [b.north, b.east]];
    const thumbUrl = `data/thumbs/${siteID}_thumb.png`;

    _overlayBathy = L.imageOverlay(thumbUrl, bounds, {
      opacity:     _overlayOpacity,
      interactive: false,
      className:   'bathy-overlay',
    }).addTo(_map);
  }

  function setOverlayOpacity(val) {
    _overlayOpacity = val;
    if (_overlayBathy) _overlayBathy.setOpacity(val);
  }

  function getOverlayOpacity() { return _overlayOpacity; }

  // ── Centrer sur un site ──────────────────────────────────────

  function centrerSurSite(lat, lon) {
    _map.flyTo([lat, lon], Math.max(_map.getZoom(), 14), { duration: 0.8 });
  }

  // ── Mise à jour états marée sur les marqueurs ────────────────

  /**
   * Reçoit la Map siteID → {statut, label} calculée par Sites/MaréeSite
   * et met à jour l'icône de chaque marqueur sur la carte.
   */
  function majEtatsMaree(etatsMaree) {
    _etatsMaree = etatsMaree || new Map();
    if (!_layerSites) return;
    _layerSites.eachLayer(layer => {
      const props = layer.feature && layer.feature.properties;
      if (!props) return;
      const etat = _etatsMaree.get(props.siteID);
      layer.setIcon(_creerIcone(props.typeSite, etat?.statut));
    });
  }

  // ── Getters ──────────────────────────────────────────────────

  function getMap() { return _map; }

  return {
    init,
    afficherSites,
    afficherGPS,
    centrerSurGPS,
    centrerSurSite,
    afficherLigneNav,
    supprimerLigneNav,
    toggleOverlayBathy,
    setOverlayOpacity,
    getOverlayOpacity,
    majEtatsMaree,
    getMap,
  };
})();
