/**
 * meteo.js — Météo marine via Open-Meteo (Phase 11)
 *
 * Modèles Météo-France via Open-Meteo (gratuit, sans clé, JSON) :
 *   → AROME PI  : meteofrance_arome_france      — 1.3 km, nowcasting 0-42h
 *                 Utilisé pour les conditions actuelles (current)
 *   → AROME HD  : meteofrance_arome_france_hd   — 1 km, prévisions 0-42h
 *                 Utilisé pour les prévisions horaires 24h
 *   → API Marine: marine-api.open-meteo.com     — houle (MFWAM/ERA5)
 *
 * Doc Open-Meteo MF : https://open-meteo.com/en/docs/meteofrance-api
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

  // ── Requêtes Open-Meteo ──────────────────────────────────────

  async function _fetchJson(url) {
    const ctrl  = new AbortController();
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

  /**
   * Conditions actuelles — AROME PI (meteofrance_arome_france, 1.3 km)
   * Résolution maximale, mise à jour toutes les heures, portée 0-42h.
   * Idéal pour le nowcasting : température, vent, rafales, visibilité.
   */
  async function _fetchAromePi(lat, lon) {
    const url = new URL('https://api.open-meteo.com/v1/meteofrance');
    url.searchParams.set('latitude',  lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('models',    'meteofrance_arome_france');
    url.searchParams.set('current',
      'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility'
    );
    url.searchParams.set('timezone',      'Europe/Paris');
    url.searchParams.set('forecast_days', '1');
    return _fetchJson(url);
  }

  /**
   * Prévisions horaires 24h — AROME HD (meteofrance_arome_france_hd, 1 km)
   * Meilleure résolution spatiale pour les prévisions vent détaillées.
   */
  async function _fetchAromeHd(lat, lon) {
    const url = new URL('https://api.open-meteo.com/v1/meteofrance');
    url.searchParams.set('latitude',  lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('models',    'meteofrance_arome_france_hd');
    url.searchParams.set('hourly',
      'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,weather_code,visibility'
    );
    url.searchParams.set('timezone',      'Europe/Paris');
    url.searchParams.set('forecast_days', '2');
    return _fetchJson(url);
  }

  /**
   * Houle — API Marine Open-Meteo (modèle MFWAM/ERA5, sans clé)
   * Variables : hauteur vagues, période, direction, swell
   */
  async function _fetchMarine(lat, lon) {
    const url = new URL('https://marine-api.open-meteo.com/v1/marine');
    url.searchParams.set('latitude',  lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('hourly',
      'wave_height,wave_period,wave_direction,swell_wave_height'
    );
    url.searchParams.set('timezone',      'Europe/Paris');
    url.searchParams.set('forecast_days', '2');
    return _fetchJson(url);
  }

  /** Agrège les trois sources en un seul objet {current, hourly, _marine} */
  async function _fetchMeteo(lat, lon) {
    const [pi, hd, marine] = await Promise.allSettled([
      _fetchAromePi(lat, lon),
      _fetchAromeHd(lat, lon),
      _fetchMarine(lat, lon),
    ]);
    // current → AROME PI (nowcasting), fallback AROME HD
    const data = pi.status === 'fulfilled' ? pi.value : {};
    // hourly → AROME HD (prévisions)
    if (hd.status === 'fulfilled') {
      data.hourly      = hd.value.hourly;
      data.hourly_units = hd.value.hourly_units;
    }
    data._marine = marine.status === 'fulfilled' ? marine.value : null;
    return data;
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

    // Extraire houle de l'heure actuelle (API Marine)
    let houleH = '—', houlePer = '—', houleSwell = '—';
    const marine = data._marine;
    if (marine && marine.hourly) {
      const now = new Date();
      const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:00`;
      const mTimes  = marine.hourly.time || [];
      const mIdx    = Math.max(0, mTimes.findIndex(t => t === nowStr));
      if (marine.hourly.wave_height)       houleH     = `${marine.hourly.wave_height[mIdx]?.toFixed(1) ?? '—'} m`;
      if (marine.hourly.wave_period)       houlePer   = `${marine.hourly.wave_period[mIdx] ?? '—'} s`;
      if (marine.hourly.swell_wave_height) houleSwell = `${marine.hourly.swell_wave_height[mIdx]?.toFixed(1) ?? '—'} m`;
    }

    // Prévisions horaires du vent (24 prochaines heures)
    let ventPrevisionHtml = '';
    if (data.hourly && data.hourly.wind_speed_10m) {
      const now = new Date();
      // Trouver l'index de l'heure actuelle dans les données horaires
      const times = data.hourly.time || [];
      const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:00`;
      let startIdx = times.findIndex(t => t === nowStr);
      if (startIdx < 0) startIdx = 0;
      const rows = [];
      for (let i = startIdx; i < Math.min(startIdx + 24, times.length); i++) {
        const t = times[i];
        const heure = t ? t.substring(11, 16) : '—';
        const vitesse = data.hourly.wind_speed_10m[i] != null ? Math.round(data.hourly.wind_speed_10m[i]) : '—';
        const dir = data.hourly.wind_direction_10m[i] != null ? _directionVent(data.hourly.wind_direction_10m[i]) : '—';
        const deg = data.hourly.wind_direction_10m[i] != null ? data.hourly.wind_direction_10m[i] : null;
        const rafale = data.hourly.wind_gusts_10m[i] != null ? Math.round(data.hourly.wind_gusts_10m[i]) : '—';
        const arrow = deg != null ? `<span style="display:inline-block;transform:rotate(${deg}deg);">↑</span>` : '';
        rows.push(`<tr>
          <td>${heure}</td>
          <td>${vitesse} km/h</td>
          <td>${arrow} ${dir}</td>
          <td>${rafale} km/h</td>
        </tr>`);
      }
      ventPrevisionHtml = `
        <div class="meteo-prevision-vent">
          <h4 style="color:var(--blanc);margin:12px 0 6px;font-size:13px;">🌬 Prévisions vent 10 m (24 h)</h4>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;color:var(--gris-texte);">
              <thead>
                <tr style="color:var(--bleu-clair);border-bottom:1px solid #2d3e4e;">
                  <th style="text-align:left;padding:3px 6px;">Heure</th>
                  <th style="text-align:right;padding:3px 6px;">Vitesse</th>
                  <th style="text-align:center;padding:3px 6px;">Direction</th>
                  <th style="text-align:right;padding:3px 6px;">Rafales</th>
                </tr>
              </thead>
              <tbody>
                ${rows.join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
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

      ${ventPrevisionHtml}

      <p style="text-align:center;font-size:11px;color:#636e72;margin-top:8px;">
        🇫🇷 AROME PI (actuel) · AROME HD (prévisions) · Marine — Open-Meteo.com
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
