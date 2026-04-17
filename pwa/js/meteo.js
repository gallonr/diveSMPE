/**
 * meteo.js — Météo marine via Open-Meteo (Phase 10)
 * Gratuit, sans clé API, données WMO + marine
 */

const Meteo = (() => {

  let _cache = null;
  let _cacheTs = 0;
  const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Codes WMO → description + emoji
  const WMO_CODES = {
    0:  { label: 'Ciel dégagé',      emoji: '☀️' },
    1:  { label: 'Principalement dégagé', emoji: '🌤' },
    2:  { label: 'Partiellement nuageux', emoji: '⛅' },
    3:  { label: 'Couvert',           emoji: '☁️' },
    45: { label: 'Brouillard',        emoji: '🌫' },
    48: { label: 'Brouillard givrant',emoji: '🌫' },
    51: { label: 'Bruine légère',     emoji: '🌦' },
    53: { label: 'Bruine modérée',    emoji: '🌦' },
    61: { label: 'Pluie légère',      emoji: '🌧' },
    63: { label: 'Pluie modérée',     emoji: '🌧' },
    65: { label: 'Pluie forte',       emoji: '🌧' },
    80: { label: 'Averses légères',   emoji: '🌦' },
    81: { label: 'Averses modérées',  emoji: '🌧' },
    82: { label: 'Averses fortes',    emoji: '⛈' },
    95: { label: 'Orage',             emoji: '⛈' },
    99: { label: 'Orage avec grêle',  emoji: '⛈' },
  };

  function _wmo(code) {
    return WMO_CODES[code] || { label: `Code ${code}`, emoji: '🌡' };
  }

  function _directionVent(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // ── Requête Open-Meteo ───────────────────────────────────────

  async function _fetchMeteo(lat, lon) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',  lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('current',
      'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility'
    );
    url.searchParams.set('hourly',
      'wave_height,wave_period,wave_direction,swell_wave_height'
    );
    url.searchParams.set('hourly_units', 'true');
    url.searchParams.set('timezone', 'Europe/Paris');
    url.searchParams.set('forecast_days', '2');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.METEO.timeout);
    try {
      const res = await fetch(url.toString(), { signal: ctrl.signal });
      clearTimeout(timer);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  // ── Affichage modal météo ────────────────────────────────────

  async function ouvrirModal() {
    const modal = document.getElementById('modal-meteo');
    if (!modal) return;
    modal.classList.remove('hidden');

    const el = document.getElementById('meteo-contenu');
    if (!el) return;

    // Vérifier cache
    if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
      _afficher(el, _cache);
      return;
    }

    if (!navigator.onLine) {
      el.innerHTML = `<div class="offline-msg">
        📡 Pas de connexion réseau.<br>La météo nécessite une connexion 4G/WiFi.
      </div>`;
      return;
    }

    el.innerHTML = '<p class="loading">⏳ Chargement météo marine…</p>';

    try {
      const data = await _fetchMeteo(CONFIG.METEO.lat, CONFIG.METEO.lon);
      _cache = data;
      _cacheTs = Date.now();
      _afficher(el, data);
    } catch (e) {
      el.innerHTML = `<div class="offline-msg">
        ⚠️ Impossible de charger la météo.<br>${e.message}
      </div>`;
    }
  }

  function _afficher(el, data) {
    const c = data.current;
    if (!c) {
      el.innerHTML = '<p class="loading">Données météo indisponibles</p>';
      return;
    }

    const wmo  = _wmo(c.weather_code);
    const vent = `${Math.round(c.wind_speed_10m)} km/h ${_directionVent(c.wind_direction_10m)}`;
    const rafale = c.wind_gusts_10m ? ` (rafales ${Math.round(c.wind_gusts_10m)} km/h)` : '';
    const visi = c.visibility ? `${Math.round(c.visibility / 1000)} km` : '—';

    // Extraire houle de l'heure actuelle
    let houleH = '—', houlePer = '—', houleSwell = '—';
    if (data.hourly) {
      const now = new Date();
      const h = now.getHours();
      if (data.hourly.wave_height)       houleH     = `${data.hourly.wave_height[h]?.toFixed(1) || '—'} m`;
      if (data.hourly.wave_period)       houlePer   = `${data.hourly.wave_period[h] || '—'} s`;
      if (data.hourly.swell_wave_height) houleSwell = `${data.hourly.swell_wave_height[h]?.toFixed(1) || '—'} m`;
    }

    el.innerHTML = `
      <div class="meteo-card">
        <div class="meteo-icon">${wmo.emoji}</div>
        <div class="meteo-data">
          <strong>${wmo.label}</strong>
          <span>Saint-Malo — maintenant</span>
        </div>
        <div class="meteo-val">${Math.round(c.temperature_2m)}°C</div>
      </div>

      <div class="meteo-card">
        <div class="meteo-icon">🌬</div>
        <div class="meteo-data">
          <strong>Vent</strong>
          <span>${rafale}</span>
        </div>
        <div class="meteo-val">${vent}</div>
      </div>

      <div class="meteo-card">
        <div class="meteo-icon">🌊</div>
        <div class="meteo-data">
          <strong>Houle</strong>
          <span>Période ${houlePer} · Swell ${houleSwell}</span>
        </div>
        <div class="meteo-val">${houleH}</div>
      </div>

      <div class="meteo-card">
        <div class="meteo-icon">👁</div>
        <div class="meteo-data">
          <strong>Visibilité</strong>
          <span>Horizontale estimée</span>
        </div>
        <div class="meteo-val">${visi}</div>
      </div>

      <p style="text-align:center;font-size:11px;color:#636e72;margin-top:8px;">
        Source : Open-Meteo.com — actualisé toutes les 30 min
      </p>
    `;
  }

  // ── Météo dans la fiche site ─────────────────────────────────

  async function chargerPourSite(lat, lon) {
    const el = document.getElementById('meteo-site');
    if (!el) return;
    if (!navigator.onLine) {
      el.innerHTML = '<p class="offline-msg" style="font-size:12px;">📡 Météo non disponible offline</p>';
      return;
    }
    el.innerHTML = '<p class="loading">Chargement météo…</p>';
    try {
      const data = await _fetchMeteo(lat, lon);
      const c = data.current;
      const wmo = _wmo(c.weather_code);
      const vent = `${Math.round(c.wind_speed_10m)} km/h ${_directionVent(c.wind_direction_10m)}`;
      el.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:8px;">
          <span style="font-size:24px;">${wmo.emoji}</span>
          <div>
            <div style="color:var(--blanc);font-weight:600;">${wmo.label} · ${Math.round(c.temperature_2m)}°C</div>
            <div style="color:var(--gris-texte);">Vent ${vent}</div>
          </div>
        </div>
      `;
    } catch (e) {
      el.innerHTML = '<p class="offline-msg" style="font-size:12px;">⚠️ Météo indisponible</p>';
    }
  }

  return { ouvrirModal, chargerPourSite };
})();
