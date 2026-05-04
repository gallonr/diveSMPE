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

    // ── Couche courants de marée ──────────────────────────────
    const coucheCourants = (typeof Courants !== 'undefined')
      ? Courants.creerCouche()
      : L.layerGroup();

    // Contrôle des couches
    L.control.layers(
      {
        '⚓ SHOM Marine':   shom,
        '🗺️ IGN Plan':     ignPlan,
        '🌊 ESRI Ocean':   esriOceanGroup,
        '🗾 OpenStreetMap': osm,
      },
      {
        '⚓ OpenSeaMap':         openSeaMap,
        '🏔️ Litto3D SHOM':      litto3d,
        '� Courants marée':    coucheCourants,
        '�🌡 Temp.': couchesMeteo.temperature,
        '🌬 Vent':   couchesMeteo.ventBarbules,
        '🌧 Précipitations':    couchesMeteo.precipitation,
      },
      { position: 'topright', collapsed: true }
    ).addTo(_map);

    // Ajouter le contrôle temporel courants quand la couche est activée
    let _courantsCtrl = null;
    _map.on('overlayadd', e => {
      if (e.name === '🌊 Courants marée' && typeof Courants !== 'undefined') {
        if (!_courantsCtrl) _courantsCtrl = Courants.ajouterControle(_map);
      }
      openSeaMap.bringToFront();
    });
    _map.on('overlayremove', e => {
      if (e.name === '🌊 Courants marée' && _courantsCtrl) {
        _map.removeControl(_courantsCtrl);
        _courantsCtrl = null;
      }
    });

    // (l'événement overlayadd gère déjà bringToFront ci-dessus)

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

  // ── Barbules de vent (couche canvas custom) ──────────────────

  /**
   * Dessine une barbule météo sur un canvas 2D.
   * Convention hémisphère Nord :
   *   Hampe FROM (vers l'origine), barbules à droite de la hampe.
   *   Fanion plein = 50 kn, trait long = 10 kn, demi-trait = 5 kn.
   */
  function _drawBarb(ctx, x, y, kmh, dirDeg) {
    const kn    = kmh / 1.852;
    const SHAFT = 22; // longueur hampe (px)
    const BLEN  = 10; // longueur barbule longue
    const BSTEP = 5;  // espacement entre barbules

    ctx.save();
    ctx.translate(x, y);
    // L'axe +y pointe vers l'ORIGINE du vent (FROM direction)
    ctx.rotate((dirDeg + 180) * Math.PI / 180);
    ctx.strokeStyle = 'rgba(10,30,100,0.9)';
    ctx.fillStyle   = 'rgba(10,30,100,0.9)';
    ctx.lineWidth   = 1.6;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (kn < 2) {
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore(); return;
    }

    // Hampe : du centre (0,0) vers le bas (+y = amont)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, SHAFT); ctx.stroke();

    // Barbules partent de l'extrémité amont, vers le haut
    let rem = Math.round(kn);
    let yb  = SHAFT;

    // Fanions 50 kn (triangle plein)
    while (rem >= 50) {
      ctx.beginPath();
      ctx.moveTo(0, yb);
      ctx.lineTo(BLEN, yb - BSTEP);
      ctx.lineTo(0,    yb - BSTEP * 2);
      ctx.closePath(); ctx.fill();
      yb -= BSTEP * 2 + 1; rem -= 50;
    }
    // Traits 10 kn
    while (rem >= 10) {
      ctx.beginPath();
      ctx.moveTo(0, yb); ctx.lineTo(BLEN, yb - BSTEP * 0.6);
      ctx.stroke();
      yb -= BSTEP; rem -= 10;
    }
    // Demi-trait 5 kn
    if (rem >= 5) {
      ctx.beginPath();
      ctx.moveTo(0, yb); ctx.lineTo(BLEN * 0.5, yb - BSTEP * 0.3);
      ctx.stroke();
    }

    // Point central (nœud de la hampe)
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  /**
   * L.Layer affichant une grille de barbules météo sur un canvas Leaflet.
   * Requête batch Open-Meteo (AROME HD) à chaque déplacement/zoom.
   * spacing : distance en px entre deux barbules.
   */
  const _WindBarbLayer = L.Layer.extend({
    options: { spacing: 60 },

    onAdd(map) {
      this._map = map;

      // Canvas attaché au container de la carte, pas dans l'overlayPane
      // (l'overlayPane est transformé par Leaflet pendant les zooms)
      this._canvas = document.createElement('canvas');
      this._canvas.style.cssText =
        'position:absolute;top:0;left:0;pointer-events:none;z-index:400;';
      map.getContainer().appendChild(this._canvas);

      this._setSize();

      this._cbMoveEnd  = () => { clearTimeout(this._t); this._t = setTimeout(() => this._fetch(), 1200); };
      this._cbZoomEnd  = () => { clearTimeout(this._t); this._setSize(); this._t = setTimeout(() => this._fetch(), 1200); };
      this._cbResize   = () => { this._setSize(); clearTimeout(this._t); this._t = setTimeout(() => this._fetch(), 1200); };

      map.on('moveend',  this._cbMoveEnd,  this);
      map.on('zoomend',  this._cbZoomEnd,  this);
      map.on('resize',   this._cbResize,   this);

      this._fetch();
    },

    onRemove(map) {
      map.getContainer().removeChild(this._canvas);
      map.off('moveend', this._cbMoveEnd, this);
      map.off('zoomend', this._cbZoomEnd, this);
      map.off('resize',  this._cbResize,  this);
      clearTimeout(this._t);
      this._pts = null;
    },

    _setSize() {
      const s = this._map.getSize();
      this._canvas.width  = s.x;
      this._canvas.height = s.y;
    },

    async _fetch() {
      const map  = this._map;
      const size = map.getSize();
      const sp   = 80; // espacement plus grand = moins de points = moins de requêtes API

      // Cache 15 min par centre+zoom pour économiser les appels API
      const center = map.getCenter();
      const cacheKey = `${center.lat.toFixed(2)}_${center.lng.toFixed(2)}_${map.getZoom()}`;
      if (this._cacheKey === cacheKey && this._pts) { this._draw(); return; }
      this._cacheKey = cacheKey;
      const cols = Math.floor(size.x / sp);
      const rows = Math.floor(size.y / sp);
      const offX = (size.x - cols * sp) / 2 + sp / 2;
      const offY = (size.y - rows * sp) / 2 + sp / 2;

      const pts = [], lats = [], lons = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = offX + c * sp;
          const py = offY + r * sp;
          const ll = map.containerPointToLatLng([px, py]);
          pts.push({ x: px, y: py });
          lats.push(+ll.lat.toFixed(3));
          lons.push(+ll.lng.toFixed(3));
        }
      }
      if (!pts.length) return;

      try {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude',      lats.join(','));
        url.searchParams.set('longitude',     lons.join(','));
        url.searchParams.set('current',       'wind_speed_10m,wind_direction_10m');
        url.searchParams.set('wind_speed_unit', 'kmh');
        url.searchParams.set('timezone',      'Europe/Paris');
        url.searchParams.set('forecast_days', '1');
        // best_match : sélection auto du meilleur modèle (AROME sur FR, ICON ailleurs)
        // → couverture mondiale, pas de trou sur les zones maritimes
        const res  = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.reason || 'API error');
        const arr  = Array.isArray(json) ? json : [json];
        this._pts = arr.map((d, i) => ({
          x: pts[i].x, y: pts[i].y,
          kmh: d.current?.wind_speed_10m,
          dir: d.current?.wind_direction_10m,
        })).filter(p => p.kmh != null && p.dir != null);
        this._draw();
      } catch (e) {
        console.warn('WindBarbLayer fetch error:', e);
      }
    },

    _draw() {
      const ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      if (!this._pts) return;
      for (const p of this._pts) {
        if (p.kmh != null && p.dir != null) _drawBarb(ctx, p.x, p.y, p.kmh, p.dir);
      }
    },
  });

  // ── Couches météo Open-Meteo Weather Map Layer ──────────────

  function _creerCouchesMeteo() {
    const dummy = L.layerGroup();

    if (typeof OMWeatherMapLayer === 'undefined') {
      console.warn('OMWeatherMapLayer non disponible — couches météo désactivées');
      return { temperature: dummy, ventBarbules: dummy, precipitation: dummy };
    }

    if (!_leafletAdapter) {
      _leafletAdapter = OMWeatherMapLayer.addLeafletProtocolSupport(L);
      _leafletAdapter.addProtocol('om', OMWeatherMapLayer.omProtocol);
    }

    const BASE_URL = 'https://map-tiles.open-meteo.com/data_spatial';
    const MODEL    = 'meteofrance_arome_france_hd';
    const TS       = 'time_step=current_time_1H';
    function omUrl(v) {
      return `om://${BASE_URL}/${MODEL}/latest.json?${TS}&variable=${v}`;
    }

    // 🌡 Température 2 m
    const temperature = _leafletAdapter.createTileLayer(
      omUrl('temperature_2m'),
      { opacity: 0.70, attribution: '© <a href="https://open-meteo.com">Open-Meteo</a> · MF AROME HD' }
    );

    // 🌬 Barbules de vent (canvas custom — sans raster)
    const ventBarbules = new _WindBarbLayer({ spacing: 60 });

    // 🌧 Précipitations
    const precipitation = _leafletAdapter.createTileLayer(
      omUrl('precipitation'),
      { opacity: 0.70, attribution: '© <a href="https://open-meteo.com">Open-Meteo</a> · MF AROME HD' }
    );

    return { temperature, ventBarbules, precipitation };
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
