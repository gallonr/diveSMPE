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
  let _leafletAdapter = null;     // Adaptateur Open-Meteo Weather Map Layer

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



    // Overlay WMS Litto3D SHOM Bretagne 2018-2021
    const litto3d = L.tileLayer.wms(CONFIG.TILES.litto3d.url, {
      layers:      CONFIG.TILES.litto3d.layer,
      format:      CONFIG.TILES.litto3d.format,
      transparent: CONFIG.TILES.litto3d.transparent,
      attribution: CONFIG.TILES.litto3d.attribution,
      opacity:     CONFIG.TILES.litto3d.opacity,
    });

    // ── Couches météo Open-Meteo Weather Map Layer ───────────
    const couchesMeteo = _creerCouchesMeteo();

    // Contrôle des couches
    L.control.layers(
      {
        '⚓ SHOM Marine':   shom,
        '🗺️ IGN Plan':     ignPlan,
        '🌊 ESRI Ocean':   esriOceanGroup,
        '🗾 OpenStreetMap': osm,
      },
      {
        'OpenSeaMap ⚓':         openSeaMap,
        '🏔️ Litto3D SHOM':      litto3d,
        '🌡 Temp. air (AROME)': couchesMeteo.temperature,
        '💨 Vent + flèches':    couchesMeteo.ventComplet,
        '🌧 Précipitations':    couchesMeteo.precipitation,
      },
      { position: 'topright', collapsed: true }
    ).addTo(_map);

    // OpenSeaMap toujours au-dessus des autres overlays
    _map.on('overlayadd', () => openSeaMap.bringToFront());

    // Mise à jour des bounds pour le rendu des tuiles météo
    function _updateOmBounds() {
      if (typeof OMWeatherMapLayer === 'undefined') return;
      const b = _map.getBounds();
      OMWeatherMapLayer.updateCurrentBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    }
    _map.on('moveend', _updateOmBounds);
    _updateOmBounds();

    // Attribution compacte
    _map.attributionControl.setPrefix('');

    // Contrôle vent Open-Meteo (aucune clé requise)
    _ajouterControleVent();

    return _map;
  }

  // ── Couches météo Open-Meteo Weather Map Layer ──────────────

  /**
   * Crée et retourne les couches météo raster et vecteur via
   * l'adaptateur Leaflet de @openmeteo/weather-map-layer.
   *
   * Modèle utilisé : meteofrance_arome_france_hd (1 km, 0-42 h)
   * Fallback automatique vers dwd_icon si AROME non disponible.
   *
   * Variables disponibles sur map-tiles.open-meteo.com :
   *   temperature_2m, wind_u_component_10m, precipitation, cloud_cover…
   *
   * Doc : https://github.com/open-meteo/weather-map-layer
   */
  function _creerCouchesMeteo() {
    // Couches vides (fallback si la lib n'est pas chargée)
    const dummy = L.layerGroup();

    if (typeof OMWeatherMapLayer === 'undefined') {
      console.warn('OMWeatherMapLayer non disponible — couches météo désactivées');
      return { temperature: dummy, ventComplet: dummy, precipitation: dummy };
    }

    // Initialisation de l'adaptateur Leaflet (une seule fois)
    if (!_leafletAdapter) {
      _leafletAdapter = OMWeatherMapLayer.addLeafletProtocolSupport(L);
      _leafletAdapter.addProtocol('om', OMWeatherMapLayer.omProtocol);
    }

    const BASE_URL = 'https://map-tiles.open-meteo.com/data_spatial';
    // Modèle AROME HD (Météo-France, 1 km) — heure courante arrondie à l'heure
    const MODEL   = 'meteofrance_arome_france_hd';
    const TS      = 'time_step=current_time_1H';

    function omUrl(variable, extra = '') {
      return `om://${BASE_URL}/${MODEL}/latest.json?${TS}&variable=${variable}${extra}`;
    }

    // 🌡 Température 2 m
    const temperature = _leafletAdapter.createTileLayer(
      omUrl('temperature_2m'),
      { opacity: 0.70, attribution: '© <a href="https://open-meteo.com">Open-Meteo</a> · MF AROME HD' }
    );

    // 💨 Vent 10 m — composante U (vitesse colorée)
    const vent = _leafletAdapter.createTileLayer(
      omUrl('wind_u_component_10m'),
      { opacity: 0.65, attribution: '© <a href="https://open-meteo.com">Open-Meteo</a> · MF AROME HD' }
    );

    // 🏹 Flèches de vent (couche vecteur PBF)
    // La lib récupère automatiquement la composante V pour calculer la direction.
    // Le style encode simultanément vitesse (épaisseur + opacité) et direction (orientation).
    const ventArrows = _leafletAdapter.createVectorTileLayer(
      omUrl('wind_u_component_10m', '&arrows=true'),
      {
        style(properties) {
          const v = parseFloat(properties.value) || 0;
          // Vitesse → épaisseur : 1 px (< 5 km/h) … 4 px (> 50 km/h)
          const lineWidth = Math.min(4, Math.max(1, v / 12));
          // Vitesse → opacité : faible vent discret, fort vent bien visible
          const alpha = Math.min(0.9, Math.max(0.2, v / 50));
          return {
            strokeStyle: `rgba(10, 40, 100, ${alpha.toFixed(2)})`,
            lineWidth,
            lineCap: 'round',
            lineJoin: 'round',
          };
        }
      }
    );

    // Groupe combiné : raster vitesse + flèches direction
    const ventComplet = L.layerGroup([vent, ventArrows]);

    // 🌧 Précipitations
    const precipitation = _leafletAdapter.createTileLayer(
      omUrl('precipitation'),
      { opacity: 0.70, attribution: '© <a href="https://open-meteo.com">Open-Meteo</a> · MF AROME HD' }
    );

    return { temperature, ventComplet, precipitation };
  }

  // ── Contrôle vent Open-Meteo ─────────────────────────────────

  function _directionVentCarte(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  function _ajouterControleVent() {
    const WindControl = L.Control.extend({
      options: { position: 'bottomleft' },

      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-vent-control');
        div.innerHTML = '<span class="vent-loading">🌬 …</span>';
        L.DomEvent.disableClickPropagation(div);
        this._div = div;
        this._charger();
        // Actualisation toutes les 15 min
        this._timer = setInterval(() => this._charger(), 15 * 60 * 1000);
        return div;
      },

      onRemove() {
        clearInterval(this._timer);
      },

      async _charger() {
        const lat = CONFIG.METEO.lat;
        const lon = CONFIG.METEO.lon;
        try {
          const url = new URL('https://api.open-meteo.com/v1/forecast');
          url.searchParams.set('latitude',  lat);
          url.searchParams.set('longitude', lon);
          url.searchParams.set('current', 'wind_speed_10m,wind_direction_10m,wind_gusts_10m');
          url.searchParams.set('timezone', 'Europe/Paris');
          const res  = await fetch(url.toString());
          const data = await res.json();
          const c    = data.current;
          const dir  = _directionVentCarte(c.wind_direction_10m);
          const deg  = c.wind_direction_10m;
          const arrow = `<span style="display:inline-block;transform:rotate(${deg}deg);font-style:normal;">↑</span>`;
          this._div.innerHTML = `
            <div class="vent-widget">
              <span class="vent-icon">🌬</span>
              <span class="vent-val">${Math.round(c.wind_speed_10m)} km/h</span>
              <span class="vent-dir">${arrow} ${dir}</span>
              <span class="vent-rafale">⚡ ${Math.round(c.wind_gusts_10m)} km/h</span>
            </div>`;
        } catch (_) {
          this._div.innerHTML = '<span class="vent-loading">🌬 —</span>';
        }
      },
    });

    new WindControl().addTo(_map);
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
