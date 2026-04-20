/**
 * navigation.js — GPS, cap et distance vers le site (Phase 8)
 * Utilise Geolocation API + Turf.js
 */

const Navigation = (() => {

  let _watchId = null;
  let _posActuelle = null;    // { lat, lon }
  let _siteDestination = null;// feature GeoJSON
  let _actif = false;

  // ── GPS ──────────────────────────────────────────────────────

  function demarrerGPS() {
    if (!navigator.geolocation) {
      console.warn('⚠️ Geolocation non disponible');
      return;
    }
    _watchId = navigator.geolocation.watchPosition(
      _onPosition,
      _onErreur,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
    // Afficher le HUD dès l'activation du GPS
    _afficherHUD(true);
  }

  function arreterGPS() {
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
    }
  }

  function _onPosition(pos) {
    const c = pos.coords;
    _posActuelle = { lat: c.latitude, lon: c.longitude };

    // Afficher sur carte
    Carte.afficherGPS(_posActuelle.lat, _posActuelle.lon);

    // ── Mise à jour HUD ──────────────────────────────────────
    _afficherHUD(false);

    // Lat / Lon
    const elLat = document.getElementById('hud-lat');
    const elLon = document.getElementById('hud-lon');
    if (elLat) elLat.textContent = _formatDMS(c.latitude,  'NS');
    if (elLon) elLon.textContent = _formatDMS(c.longitude, 'EW');

    // Cap (GeolocationCoordinates.heading : degrés vrai, null si immobile)
    const elCap = document.getElementById('hud-cap');
    if (elCap) {
      if (c.heading !== null && c.heading !== undefined && !isNaN(c.heading)) {
        elCap.textContent = `${Math.round(c.heading)}°`;
      } else {
        elCap.textContent = '—°';
      }
    }

    // Vitesse (m/s → nœuds : ÷ 0.5144)
    const elVit = document.getElementById('hud-vitesse');
    if (elVit) {
      if (c.speed !== null && c.speed !== undefined && !isNaN(c.speed)) {
        const kts = c.speed / 0.5144;
        elVit.textContent = `${kts.toFixed(1)} kt`;
        elVit.classList.toggle('hud-vitesse-alerte', kts > 10);
      } else {
        elVit.textContent = '— kt';
      }
    }

    // Distance au site destination (si actif)
    _updateHUDDist();

    // Mettre à jour nav si destination
    if (_actif && _siteDestination) _updateNav();
  }

  function _onErreur(err) {
    console.warn('GPS erreur', err.message);
  }

  // ── HUD helpers ──────────────────────────────────────────────

  function _afficherHUD(acquiring) {
    const hud = document.getElementById('nav-hud');
    if (!hud) return;
    hud.classList.remove('hidden');
    hud.classList.toggle('hud-acquiring', acquiring);
  }

  /** Formate un angle décimal en degrés°min'sec" N/S ou E/W */
  function _formatDMS(deg, dirs) {
    const d = Math.abs(deg);
    const dInt = Math.floor(d);
    const mAll = (d - dInt) * 60;
    const mInt = Math.floor(mAll);
    const sec  = ((mAll - mInt) * 60).toFixed(1);
    const dir  = deg >= 0 ? dirs[0] : dirs[1];
    return `${dInt}°${String(mInt).padStart(2,'0')}'${String(sec).padStart(4,'0')}"${dir}`;
  }

  function _updateHUDDist() {
    const elDist = document.getElementById('hud-dist');
    const distBloc = document.getElementById('hud-dist-bloc');
    if (!elDist || !_posActuelle) return;

    if (_siteDestination && _siteDestination.geometry) {
      const dest = _siteDestination.geometry.coordinates;
      const from = turf.point([_posActuelle.lon, _posActuelle.lat]);
      const to   = turf.point([dest[0], dest[1]]);
      const distNm = turf.distance(from, to, { units: 'kilometers' }) / 1.852;
      elDist.textContent = `${distNm.toFixed(2)} Nm`;
      if (distBloc) distBloc.style.display = '';
    } else {
      elDist.textContent = '— Nm';
    }
  }

  function centrerSurMoi() {
    if (_posActuelle) {
      Carte.centrerSurGPS(_posActuelle.lat, _posActuelle.lon);
    } else {
      // Demander la position une seule fois
      navigator.geolocation.getCurrentPosition(
        pos => {
          _posActuelle = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          Carte.afficherGPS(_posActuelle.lat, _posActuelle.lon);
          Carte.centrerSurGPS(_posActuelle.lat, _posActuelle.lon);
        },
        err => alert('Impossible d\'obtenir votre position GPS : ' + err.message)
      );
    }
  }

  // ── Navigation vers un site ──────────────────────────────────

  function naviguerVers(feature) {
    if (!feature || !feature.geometry) return;
    _siteDestination = feature;
    _actif = true;

    const btn = document.getElementById('btn-naviguer');
    if (btn) {
      btn.textContent = '🛑 Arrêter la navigation';
      btn.classList.add('active');
      btn.classList.remove('hidden');
    }

    if (_posActuelle) {
      _updateNav();
      _updateHUDDist();
      Carte.afficherLigneNav(
        _posActuelle.lat, _posActuelle.lon,
        feature.geometry.coordinates[1], feature.geometry.coordinates[0]
      );
    } else {
      demarrerGPS();
    }

    document.getElementById('nav-info')?.classList.remove('hidden');

    // Afficher le bouton stop dans le HUD
    const btnStop = document.getElementById('btn-stop-nav');
    if (btnStop) btnStop.classList.remove('hidden');
  }

  function arreter() {
    _actif = false;
    _siteDestination = null;
    Carte.supprimerLigneNav();

    const navInfo = document.getElementById('nav-info');
    if (navInfo) navInfo.classList.add('hidden');

    const btn = document.getElementById('btn-naviguer');
    if (btn) {
      btn.textContent = '🧭 Naviguer vers ce site';
      btn.classList.remove('active');
    }

    // Réinitialiser distance HUD
    const elDist = document.getElementById('hud-dist');
    if (elDist) elDist.textContent = '— Nm';

    // Masquer le bouton stop dans le HUD
    const btnStop = document.getElementById('btn-stop-nav');
    if (btnStop) btnStop.classList.add('hidden');
  }

  /** Définir le site affiché dans le HUD (sans démarrer la navigation active) */
  function setSiteDestination(feature) {
    _siteDestination = feature;
    _updateHUDDist();
  }

  function _updateNav() {
    if (!_posActuelle || !_siteDestination) return;
    const dest = _siteDestination.geometry.coordinates;
    const from = turf.point([_posActuelle.lon, _posActuelle.lat]);
    const to   = turf.point([dest[0], dest[1]]);

    const distKm  = turf.distance(from, to, { units: 'kilometers' });
    const distNm  = distKm / 1.852;
    const bearing = turf.bearing(from, to);
    const capMag  = ((bearing + 360) % 360).toFixed(0);

    // ETA (vitesse défaut en nœuds)
    const vitesse = CONFIG.NAV.vitesseDefaut;
    const etaMin  = Math.round(distNm / vitesse * 60);
    const etaStr  = etaMin < 60
      ? `${etaMin} min`
      : `${Math.floor(etaMin/60)}h${String(etaMin % 60).padStart(2,'0')}`;

    // Mettre à jour l'interface
    const elDist = document.getElementById('nav-distance');
    const elCap  = document.getElementById('nav-cap');
    const elEta  = document.getElementById('nav-eta');
    if (elDist) elDist.textContent = `${distNm.toFixed(1)} Nm`;
    if (elCap)  elCap.textContent  = `Cap ${capMag}°`;
    if (elEta)  elEta.textContent  = `ETA ~${etaStr}`;

    // Mettre à jour la ligne de nav sur la carte
    Carte.afficherLigneNav(
      _posActuelle.lat, _posActuelle.lon,
      dest[1], dest[0]
    );
  }

  function getPosition() { return _posActuelle; }
  function isActif()     { return _actif; }

  return {
    demarrerGPS,
    arreterGPS,
    centrerSurMoi,
    naviguerVers,
    arreter,
    setSiteDestination,
    getPosition,
    isActif,
  };
})();
