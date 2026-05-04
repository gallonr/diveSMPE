/**
 * courants.js — Couche des courants de marée (FES2022)
 *
 * Fonctionnement :
 *   1. Charge data/courants_grid.json (généré par r/05_courants_fes.py)
 *   2. Synthèse harmonique temps-réel : u(t) = Σ Aₙ·cos(ωₙ·Δt + φₙ)
 *   3. Couche Leaflet canvas avec flèches animées colorées par intensité
 *   4. Contrôle temporel : mode "maintenant" ou sélection date/heure
 *   5. API publique : Courants.getVitesseSite(lat, lon, date)
 *
 * Dépendances : Leaflet (global L), Marees (optionnel pour affichage contextuel)
 */

const Courants = (() => {

  // ── État interne ─────────────────────────────────────────────

  let _grid = null;         // données chargées depuis courants_grid.json
  let _tRef = null;         // Date() de référence (t_ref du JSON)
  let _couche = null;       // instance _CurrentArrowLayer
  let _temps = new Date();  // instant affiché
  let _modeTempsReel = true;
  let _timerTempsReel = null;
  let _timerAnim = null;
  let _animStep = 0;        // pas d'animation (0–23 → 0–23h à partir de maintenant)
  let _animActive = false;

  // ── Chargement ───────────────────────────────────────────────

  async function init() {
    try {
      const res = await fetch('data/courants_grid.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _grid = await res.json();
      _tRef = new Date(_grid.meta.t_ref);
      console.log(`✅ Courants chargés : ${_grid.meta.n_points} points, t_ref=${_grid.meta.t_ref}`);
    } catch (e) {
      console.warn('⚠️ courants_grid.json non disponible :', e.message,
        '— lancez r/05_courants_fes.py pour générer les données');
      _grid = null;
    }
  }

  // ── Synthèse harmonique ──────────────────────────────────────

  /**
   * Calcule U (est, cm/s) et V (nord, cm/s) à partir des constituantes
   * effectives pré-calculées pour un décalage temporel dt_h (heures depuis t_ref).
   * @param {number[]} series  [amp0, phi0, amp1, phi1, ...] en cm/s et degrés
   * @param {number[]} omegas  [ω0, ω1, ...] en degrés/heure
   * @param {number}   dt_h   heures depuis t_ref
   * @returns {number}
   */
  function _synthese(series, omegas, dt_h) {
    let val = 0.0;
    for (let k = 0; k < omegas.length; k++) {
      const amp = series[2 * k];
      const phi = series[2 * k + 1] * Math.PI / 180;  // → rad
      const w   = omegas[k] * Math.PI / 180;           // → rad/h
      val += amp * Math.cos(w * dt_h + phi);
    }
    return val;
  }

  /**
   * Retourne {u, v, vitesse, direction} au point de grille le plus proche de (lat, lon)
   * pour la date donnée (ou _temps si omis).
   * Unités : cm/s (u, v, vitesse), degrés (direction géographique 0=N)
   */
  function getVitesseSite(lat, lon, date) {
    if (!_grid) return null;
    const d = date || _temps;
    const dt_h = (d - _tRef) / 3_600_000;  // ms → h
    const omegas = _grid.meta.constituants.map(c => _grid.meta.omega_deg_h[c]);
    const pt = _pointLePlusProche(lat, lon);
    if (!pt) return null;
    const u = _synthese(pt.u, omegas, dt_h);
    const v = _synthese(pt.v, omegas, dt_h);
    const vitesse = Math.sqrt(u * u + v * v);
    // Direction : d'où vient le courant (convention nautique FROM)
    const dirFrom = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
    // Direction vers laquelle va le courant (TO)
    const dirTo   = (dirFrom + 180) % 360;
    return { u, v, vitesse: Math.round(vitesse * 10) / 10, dirFrom, dirTo };
  }

  function _pointLePlusProche(lat, lon) {
    if (!_grid) return null;
    let best = null, bestDist = Infinity;
    for (const pt of _grid.points) {
      const d = (pt.lat - lat) ** 2 + (pt.lon - lon) ** 2;
      if (d < bestDist) { bestDist = d; best = pt; }
    }
    return best;
  }

  // ── Interpolation bilinéaire ─────────────────────────────────

  /**
   * Interpole (u, v) en cm/s pour (lat, lon) en utilisant les 4 points voisins.
   * Plus précis que _pointLePlusProche mais plus lent.
   */
  function _interpoler(lat, lon, dt_h) {
    if (!_grid) return { u: 0, v: 0 };
    const omegas = _grid.meta.constituants.map(c => _grid.meta.omega_deg_h[c]);
    const res    = _grid.meta.res_deg;

    // Trouver les voisins dans un rayon de 1.5 × res
    const r = 1.5 * res;
    const voisins = _grid.points.filter(
      p => Math.abs(p.lat - lat) <= r && Math.abs(p.lon - lon) <= r
    );
    if (voisins.length === 0) return { u: 0, v: 0 };

    // Pondération inverse de la distance au carré
    let wSum = 0, uSum = 0, vSum = 0;
    for (const p of voisins) {
      const d2 = (p.lat - lat) ** 2 + (p.lon - lon) ** 2 || 1e-12;
      const w  = 1 / d2;
      uSum += w * _synthese(p.u, omegas, dt_h);
      vSum += w * _synthese(p.v, omegas, dt_h);
      wSum += w;
    }
    return { u: uSum / wSum, v: vSum / wSum };
  }

  // ── Couche Leaflet canvas ────────────────────────────────────

  /**
   * Dessine une flèche de courant sur un canvas 2D.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x, y  centre (pixels)
   * @param {number} u     composante Est (cm/s)
   * @param {number} v     composante Nord (cm/s)
   * @param {number} scale  pixels par cm/s
   */
  function _drawArrow(ctx, x, y, u, v, scale) {
    const vitesse = Math.sqrt(u * u + v * v);
    if (vitesse < 0.5) {
      // Courant très faible : cercle pointillé
      ctx.save();
      ctx.strokeStyle = 'rgba(100,200,220,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore();
      return;
    }

    // Couleur selon intensité (cm/s)
    const color = vitesse < 25 ? '#69d6d0'    // < 0.25 kn : teal clair
                : vitesse < 75 ? '#3aafa8'    // 0.25–0.75 kn : émeraude
                : vitesse < 150 ? '#ffa301'   // 0.75–1.5 kn : orange
                : '#e74c3c';                  // > 1.5 kn : rouge

    const len = Math.min(vitesse * scale, 40); // longueur plafonnée à 40 px
    // Direction TO (u=Est positif → droite, v=Nord positif → haut donc -y)
    const angle = Math.atan2(-v, u);  // angle en coords canvas (y inversé)

    const tipX = x + len * Math.cos(angle);
    const tipY = y + len * Math.sin(angle);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.85;

    // Tige
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Tête de flèche
    const hLen = Math.max(6, len * 0.28);
    const hAng = 0.45; // angle demi-ouverture (rad)
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - hLen * Math.cos(angle - hAng),
      tipY - hLen * Math.sin(angle - hAng)
    );
    ctx.lineTo(
      tipX - hLen * Math.cos(angle + hAng),
      tipY - hLen * Math.sin(angle + hAng)
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // ── Classe L.Layer courants ──────────────────────────────────

  const _CurrentArrowLayer = L.Layer.extend({
    options: { spacing: 55 },  // espacement grille en pixels

    onAdd(map) {
      this._map = map;
      this._canvas = document.createElement('canvas');
      this._canvas.style.cssText =
        'position:absolute;top:0;left:0;pointer-events:none;z-index:390;';
      map.getContainer().appendChild(this._canvas);
      this._setSize();

      this._onMove  = () => { this._schedDraw(200); };
      this._onZoom  = () => { this._setSize(); this._schedDraw(200); };
      this._onResize = () => { this._setSize(); this._schedDraw(200); };

      map.on('moveend',  this._onMove,   this);
      map.on('zoomend',  this._onZoom,   this);
      map.on('resize',   this._onResize, this);

      this._draw();
    },

    onRemove(map) {
      map.getContainer().removeChild(this._canvas);
      map.off('moveend',  this._onMove,   this);
      map.off('zoomend',  this._onZoom,   this);
      map.off('resize',   this._onResize, this);
      clearTimeout(this._drawTimer);
    },

    _setSize() {
      const s = this._map.getSize();
      this._canvas.width  = s.x;
      this._canvas.height = s.y;
    },

    _schedDraw(delay) {
      clearTimeout(this._drawTimer);
      this._drawTimer = setTimeout(() => this._draw(), delay);
    },

    _draw() {
      const ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

      if (!_grid) {
        // Pas de données — afficher un message
        ctx.save();
        ctx.font = '12px Signika, sans-serif';
        ctx.fillStyle = 'rgba(255,200,100,0.85)';
        ctx.fillText('⚠ Données courants non disponibles', 10, this._canvas.height - 14);
        ctx.restore();
        return;
      }

      const map     = this._map;
      const d       = _temps;
      const dt_h    = (d - _tRef) / 3_600_000;
      const omegas  = _grid.meta.constituants.map(c => _grid.meta.omega_deg_h[c]);
      const zoom    = map.getZoom();
      // Echelle flèche : ajustée au zoom (plus le zoom est grand, plus les flèches sont longues)
      const scale   = Math.max(0.18, zoom / 70);

      for (const pt of _grid.points) {
        const px = map.latLngToContainerPoint([pt.lat, pt.lon]);
        // Sauter les points hors de l'écran (+marge)
        const margin = 60;
        if (px.x < -margin || px.x > this._canvas.width  + margin) continue;
        if (px.y < -margin || px.y > this._canvas.height + margin) continue;

        const u = _synthese(pt.u, omegas, dt_h);
        const v = _synthese(pt.v, omegas, dt_h);
        _drawArrow(ctx, px.x, px.y, u, v, scale);
      }
    },

    /** Redessine avec le temps courant (appelé depuis setTemps) */
    refresh() {
      if (this._map) this._draw();
    },
  });

  // ── Création de la couche ────────────────────────────────────

  function creerCouche() {
    _couche = new _CurrentArrowLayer();
    return _couche;
  }

  // ── Contrôle temporel ────────────────────────────────────────

  function setTemps(date) {
    _temps = date instanceof Date ? date : new Date(date);
    _modeTempsReel = false;
    if (_couche) _couche.refresh();
    _majLegend();
  }

  function setTempsReel() {
    _modeTempsReel = true;
    _temps = new Date();
    if (_couche) _couche.refresh();
    _majLegend();
    // Réinitialiser le timer temps-réel
    clearInterval(_timerTempsReel);
    _timerTempsReel = setInterval(() => {
      if (_modeTempsReel) {
        _temps = new Date();
        if (_couche) _couche.refresh();
        _majLegend();
      }
    }, 5 * 60 * 1000); // refresh toutes les 5 min
  }

  function setAnimation(on) {
    _animActive = on;
    clearInterval(_timerAnim);
    if (!on) return;
    _animStep = 0;
    const base = new Date();
    base.setMinutes(0, 0, 0);  // arrondir à l'heure
    _timerAnim = setInterval(() => {
      _animStep = (_animStep + 1) % 25;
      const t = new Date(base.getTime() + _animStep * 3_600_000);
      _temps = t;
      _modeTempsReel = false;
      if (_couche) _couche.refresh();
      _majLegend();
    }, 600); // avance d'1h toutes les 0.6s
  }

  // ── Légende et contrôle carte ────────────────────────────────

  const _DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  function _compass(deg) { return _DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; }

  function _pad2(n) { return String(n).padStart(2, '0'); }

  function _formatTemps(d) {
    return `${_pad2(d.getDate())}/${_pad2(d.getMonth()+1)} ${_pad2(d.getHours())}h${_pad2(d.getMinutes())}`;
  }

  function _majLegend() {
    const el = document.getElementById('courants-legend-time');
    if (!el) return;
    el.textContent = _modeTempsReel ? `⏱ maintenant — ${_formatTemps(_temps)}` : `📅 ${_formatTemps(_temps)}`;
  }

  /**
   * Crée et ajoute le contrôle carte (légende + sélecteur de temps).
   * @param {L.Map} map
   */
  function ajouterControle(map) {
    const CourantsControl = L.Control.extend({
      options: { position: 'bottomright' },

      onAdd() {
        const div = L.DomUtil.create('div', 'courants-control');
        div.innerHTML = `
          <div class="courants-header">
            <span class="courants-title">🌊 Courants</span>
            <button id="courants-btn-now"  class="courants-btn courants-btn-active" title="Temps réel">⏱</button>
            <button id="courants-btn-anim" class="courants-btn" title="Animer +24h">▶</button>
          </div>
          <div class="courants-time-row">
            <span id="courants-legend-time" class="courants-time-label">⏱ —</span>
          </div>
          <div class="courants-picker-row">
            <input type="datetime-local" id="courants-datetime" class="courants-datetime" />
          </div>
          <div class="courants-scale">
            <span class="courants-scale-item" style="color:#69d6d0">● &lt;0.25 kn</span>
            <span class="courants-scale-item" style="color:#3aafa8">● 0.5 kn</span>
            <span class="courants-scale-item" style="color:#ffa301">● 1 kn</span>
            <span class="courants-scale-item" style="color:#e74c3c">● &gt;1.5 kn</span>
          </div>
          <div class="courants-precision">
            ⚠️ FES2022 ~3.7 km — effets locaux (chenaux, caps) non résolus
          </div>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        this._div = div;

        // Bouton "maintenant"
        div.querySelector('#courants-btn-now').addEventListener('click', () => {
          setTempsReel();
          setAnimation(false);
          div.querySelector('#courants-btn-now').classList.add('courants-btn-active');
          div.querySelector('#courants-btn-anim').classList.remove('courants-btn-active');
          div.querySelector('#courants-btn-anim').textContent = '▶';
        });

        // Bouton animation
        div.querySelector('#courants-btn-anim').addEventListener('click', () => {
          _animActive = !_animActive;
          setAnimation(_animActive);
          div.querySelector('#courants-btn-anim').classList.toggle('courants-btn-active', _animActive);
          div.querySelector('#courants-btn-anim').textContent = _animActive ? '⏹' : '▶';
          if (_animActive) {
            div.querySelector('#courants-btn-now').classList.remove('courants-btn-active');
          }
        });

        // Sélecteur date/heure
        const picker = div.querySelector('#courants-datetime');
        // Pré-remplir avec maintenant
        const now = new Date();
        now.setSeconds(0, 0);
        picker.value = _toDatetimeLocal(now);
        picker.addEventListener('change', () => {
          const d = new Date(picker.value);
          if (!isNaN(d)) {
            setTemps(d);
            setAnimation(false);
            div.querySelector('#courants-btn-now').classList.remove('courants-btn-active');
            div.querySelector('#courants-btn-anim').classList.remove('courants-btn-active');
            div.querySelector('#courants-btn-anim').textContent = '▶';
          }
        });

        return div;
      },
    });

    const ctrl = new CourantsControl().addTo(map);

    // Démarrer le temps réel
    setTempsReel();
    _majLegend();

    return ctrl;
  }

  function _toDatetimeLocal(d) {
    // "YYYY-MM-DDTHH:MM"
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ── Bloc courant pour la fiche site ─────────────────────────

  /**
   * Génère le HTML du bloc courant à injecter dans la fiche site.
   * @param {number} lat
   * @param {number} lon
   * @param {Date}   [date]   si omis, utilise l'instant affiché sur la carte
   * @returns {string}  HTML
   */
  function renderBlocFiche(lat, lon, date) {
    if (!_grid) {
      return `<div class="courant-bloc courant-indispo">
        <span class="courant-icon">🌊</span>
        <span class="courant-msg">Données courants non disponibles<br>
          <small>Lancez <code>r/05_courants_fes.py</code></small></span>
      </div>`;
    }

    const d = date || _temps;
    const r = getVitesseSite(lat, lon, d);
    if (!r) return '';

    const kn   = (r.vitesse / 51.44).toFixed(2);  // cm/s → nœuds
    const dir  = _compass(r.dirTo);
    const hhmm = `${_pad2(d.getHours())}h${_pad2(d.getMinutes())}`;

    // Couleur selon intensité
    const couleur = r.vitesse < 25 ? 'var(--emeraude-light)'
                  : r.vitesse < 75 ? 'var(--emeraude)'
                  : r.vitesse < 150 ? 'var(--orange-smpe)'
                  : 'var(--rouge)';

    const rotDeg = Math.round(r.dirTo);  // TO direction, 0 = N

    return `
      <div class="courant-bloc">
        <div class="courant-row">
          <span class="courant-fleche" style="transform:rotate(${rotDeg}deg);color:${couleur}">↑</span>
          <span class="courant-vitesse" style="color:${couleur}">${kn} kn</span>
          <span class="courant-dir">(${dir})</span>
          <span class="courant-heure">à ${hhmm}</span>
        </div>
        <div class="courant-detail">
          U=${r.u.toFixed(1)} cm/s · V=${r.v.toFixed(1)} cm/s
        </div>
        <div class="courant-precision">
          ⚠️ FES2022 ≈3.7 km — les effets locaux (chenaux, caps, récifs) peuvent différer significativement
        </div>
      </div>`;
  }

  // ── Prévision horaire pour la journée (tableau) ───────────────

  /**
   * Retourne un tableau de 25 valeurs horaires [{heure, vitesse, dirTo}]
   * pour la journée en cours (ou une date donnée), à partir de 00h.
   */
  function previsionJournee(lat, lon, date) {
    if (!_grid) return [];
    const base = new Date(date || _temps);
    base.setHours(0, 0, 0, 0);
    const result = [];
    for (let h = 0; h <= 24; h++) {
      const t = new Date(base.getTime() + h * 3_600_000);
      const r = getVitesseSite(lat, lon, t);
      if (r) result.push({
        heure:   h,
        vitesse: r.vitesse,
        dirTo:   r.dirTo,
        kn:      +(r.vitesse / 51.44).toFixed(2),
        dir:     _compass(r.dirTo),
      });
    }
    return result;
  }

  // ── Export public ─────────────────────────────────────────────

  return {
    init,
    creerCouche,
    ajouterControle,
    setTemps,
    setTempsReel,
    setAnimation,
    getVitesseSite,
    renderBlocFiche,
    previsionJournee,
    getTemps:     () => _temps,
    isTempsReel:  () => _modeTempsReel,
    isDisponible: () => _grid !== null,
  };

})();
