/**
 * marees.js — Gestion des marées (Phase 9)
 * Lit marees.json (généré par FES2022 via 04_marees_fes.py) et affiche
 * PM/BM + hauteur actuelle + graphique.
 *
 * Format marees.json (FES2022) :
 *   PM1_h      "07:55"   heure locale
 *   PM1_coeff  98        coefficient
 *   PM1_hcm    660       hauteur en cm par rapport au MSL (niveau moyen FES)
 *   BM1_h      "01:30"
 *   BM1_hcm    -680      peut être négatif (en-dessous du MSL)
 *
 * La normalisation dans init() calcule _haut (mètres/ZH) = _hcm/100 * CONFIG.MAREES.MSL_SCALE + CONFIG.MAREES.MSL_OFFSET_M
 * pour compatibilité avec le reste du code qui utilise _haut.
 */

const Marees = (() => {

  let _data = {};       // toutes les données { "2026-04-08": {...}, ... }
  let _aujourd = null;  // entrée du jour
  let _intervalID = null;

  // ── Helpers ──────────────────────────────────────────────────

  function _dateKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
  }

  /** Convertit "08:01" → minutes depuis minuit */
  function _hhmm2min(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  /** Hauteur d'eau actuelle par interpolation sinusoïdale PM→BM→PM */
  function _hauteurActuelle(entree, now = new Date()) {
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // Construire la liste ordonnée des PM/BM du jour
    const extrema = [];
    const champs = ['PM1_h','BM1_h','PM2_h','BM2_h'];
    const hauteurs = ['PM1_haut','BM1_haut','PM2_haut','BM2_haut'];
    for (let i = 0; i < 4; i++) {
      const t = _hhmm2min(entree[champs[i]]);
      if (t !== null) extrema.push({ t, h: entree[hauteurs[i]] });
    }
    extrema.sort((a, b) => a.t - b.t);

    if (extrema.length < 2) return null;

    // Trouver les deux encadrants
    let avant = extrema[extrema.length - 1];
    let apres = extrema[0];
    for (let i = 0; i < extrema.length - 1; i++) {
      if (nowMin >= extrema[i].t && nowMin < extrema[i + 1].t) {
        avant = extrema[i];
        apres = extrema[i + 1];
        break;
      }
    }

    // Interpolation sinusoïdale (règle du 12ème simplifiée)
    const duree = apres.t - avant.t;
    if (duree === 0) return avant.h;
    const frac = (nowMin - avant.t) / duree;
    const h = avant.h + (apres.h - avant.h) * (1 - Math.cos(frac * Math.PI)) / 2;
    return Math.round(h * 100) / 100;
  }

  /** Calcule la prochaine étale (PM ou BM) et le temps restant en min */
  function _prochaineEtale(entree, now = new Date()) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const champs  = ['PM1_h','BM1_h','PM2_h','BM2_h'];
    const labels  = ['PM','BM','PM','BM'];
    let best = null;
    for (let i = 0; i < champs.length; i++) {
      const t = _hhmm2min(entree[champs[i]]);
      if (t !== null && t > nowMin) {
        if (best === null || t < best.t) best = { t, label: labels[i] };
      }
    }
    if (!best) return null;
    return { label: best.label, dans: best.t - nowMin };
  }

  // ── Bandeau résumé (toujours visible) ───────────────────────

  function _updateBandeau() {
    if (!_aujourd) return;
    const now = new Date();

    // Hauteur actuelle + sens (montante/descendante)
    const h = _hauteurActuelle(_aujourd, now);
    const el = document.getElementById('maree-hauteur-actuelle');
    if (el && h !== null) {
      const past = new Date(now.getTime() - 10 * 60 * 1000); // -10 min
      const hPast = _hauteurActuelle(_aujourd, past);
      const arrow = (hPast === null || h >= hPast) ? '▲' : '▼';
      el.textContent = `${arrow} ${h.toFixed(2)} m`;
    } else if (el) {
      el.textContent = '…';
    }

    // PM/BM triés chronologiquement
    const extremaEl = document.getElementById('maree-extrema');
    if (extremaEl) {
      const champs = [
        { key: 'PM1', type: 'PM' }, { key: 'BM1', type: 'BM' },
        { key: 'PM2', type: 'PM' }, { key: 'BM2', type: 'BM' },
        { key: 'BM3', type: 'BM' },
      ];
      const items = champs
        .filter(c => _aujourd[c.key + '_h'])
        .map(c => ({
          type: c.type,
          h:    _aujourd[c.key + '_h'],
          haut: _aujourd[c.key + '_haut'],
          min:  _hhmm2min(_aujourd[c.key + '_h']),
        }))
        .sort((a, b) => a.min - b.min);

      extremaEl.innerHTML = items.map(it =>
        it.type === 'PM'
          ? `<span class="maree-item">⬆ <strong>${it.h}</strong> ${it.haut}m</span>`
          : `<span class="maree-item">⬇ <strong>${it.h}</strong> ${it.haut}m</span>`
      ).join('<span class="maree-sep"> </span>');
    }

    // Coefficient
    const coeff = _aujourd.PM1_coeff || _aujourd.PM2_coeff || '?';
    const elCoeff = document.getElementById('maree-coeff');
    if (elCoeff) elCoeff.textContent = `Coeff ${coeff}`;

    // Étale
    const etale = _prochaineEtale(_aujourd, now);
    const elEtale = document.getElementById('maree-etale');
    if (elEtale && etale) {
      const hh = Math.floor(etale.dans / 60);
      const mm = etale.dans % 60;
      const fenetreOK = etale.label === 'PM' && etale.dans <= 120;
      elEtale.textContent = fenetreOK
        ? `🤿 Étale ${etale.label} dans ${hh > 0 ? hh + 'h' : ''}${mm}min`
        : '';
      elEtale.classList.toggle('hidden', !fenetreOK);
    }
  }

  // ── Graphique courbe de marée (canvas) ──────────────────────

  function dessinerGraphique(canvasId, entrees) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const pad = { top: 20, right: 20, bottom: 30, left: 42 };
    const w = W - pad.left - pad.right;
    const h = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#253545';
    ctx.fillRect(0, 0, W, H);

    // Collecter tous les points (pas de 15min sur J-1, J, J+1, J+2)
    const now = new Date();
    const points = [];
    for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      const key = d.toISOString().slice(0, 10);
      const e = entrees[key];
      if (!e) continue;
      const baseMin = dayOffset * 1440; // minutes relatives au début de J
      for (let m = 0; m <= 1440; m += 15) {
        const t = m / 60;
        const h_val = _hauteurAtHoursPhase(t, e);
        if (h_val !== null) points.push({ x: baseMin + m, h: h_val });
      }
    }

    if (points.length === 0) return;

    const xMin = -1440, xMax = 3 * 1440;
    const hMin = 0, hMax = 14;

    const toX = xv => pad.left + (xv - xMin) / (xMax - xMin) * w;
    const toY = hv => pad.top + h - (hv - hMin) / (hMax - hMin) * h;

    // Grille horizontale
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let hv = 0; hv <= 14; hv += 2) {
      ctx.beginPath();
      ctx.moveTo(pad.left, toY(hv));
      ctx.lineTo(pad.left + w, toY(hv));
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '9px sans-serif';
      ctx.fillText(hv + 'm', 2, toY(hv) + 3);
    }

    // Trait "maintenant"
    const nowMinRel = 0; // J commence à 0
    ctx.strokeStyle = 'rgba(46,204,113,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(nowMinRel), pad.top);
    ctx.lineTo(toX(nowMinRel), pad.top + h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Courbe de marée (dégradé bleu)
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    grad.addColorStop(0, 'rgba(0,180,216,0.8)');
    grad.addColorStop(1, 'rgba(0,20,60,0.2)');

    ctx.beginPath();
    ctx.moveTo(toX(points[0].x), toY(points[0].h));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i].x), toY(points[i].h));
    }
    ctx.strokeStyle = '#00b4d8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Remplissage sous la courbe
    ctx.lineTo(toX(points[points.length - 1].x), pad.top + h);
    ctx.lineTo(toX(points[0].x), pad.top + h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Axe des heures (J 00:00, 06:00, 12:00, 18:00, Demain...)
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    for (let dayOff = 0; dayOff <= 2; dayOff++) {
      for (const h_tick of [0, 6, 12, 18]) {
        const xv = dayOff * 1440 + h_tick * 60;
        const xp = toX(xv);
        ctx.fillText(`${String(h_tick).padStart(2,'0')}h`, xp, H - 4);
      }
    }
    // Labels jours
    ctx.fillStyle = 'rgba(0,180,216,0.8)';
    ctx.font = '10px sans-serif';
    const labels = ["Auj.", "Dem.", "J+2"];
    for (let i = 0; i < 3; i++) {
      ctx.fillText(labels[i], toX(i * 1440 + 720), pad.top + 14);
    }
  }

  function _hauteurAtHoursPhase(t, entree) {
    // Approximation sinusoïdale depuis les PM/BM de l'entrée
    const extrema = [];
    const champs  = ['PM1_h','BM1_h','PM2_h','BM2_h'];
    const hauteurs = ['PM1_haut','BM1_haut','PM2_haut','BM2_haut'];
    for (let i = 0; i < 4; i++) {
      const tm = _hhmm2min(entree[champs[i]]);
      if (tm !== null) extrema.push({ t: tm / 60, h: entree[hauteurs[i]] });
    }
    extrema.sort((a, b) => a.t - b.t);
    if (extrema.length < 2) return 7.0;

    // Trouver les encadrants
    let avant = extrema[extrema.length - 1];
    let apres = extrema[0];
    for (let i = 0; i < extrema.length - 1; i++) {
      if (t >= extrema[i].t && t < extrema[i + 1].t) {
        avant = extrema[i];
        apres = extrema[i + 1];
        break;
      }
    }
    const duree = apres.t - avant.t;
    if (duree === 0) return avant.h;
    const frac = (t - avant.t) / duree;
    return avant.h + (apres.h - avant.h) * (1 - Math.cos(frac * Math.PI)) / 2;
  }

  // ── Tableau PM/BM ────────────────────────────────────────────

  function _afficherTableau(entree) {
    const el = document.getElementById('marees-tableau');
    if (!el) return;
    const items = [];
    if (entree.PM1_h) items.push({ type: 'PM', h: entree.PM1_h, haut: entree.PM1_haut, coeff: entree.PM1_coeff });
    if (entree.BM1_h) items.push({ type: 'BM', h: entree.BM1_h, haut: entree.BM1_haut, coeff: null });
    if (entree.PM2_h) items.push({ type: 'PM', h: entree.PM2_h, haut: entree.PM2_haut, coeff: entree.PM2_coeff });
    if (entree.BM2_h) items.push({ type: 'BM', h: entree.BM2_h, haut: entree.BM2_haut, coeff: null });
    items.sort((a, b) => a.h.localeCompare(b.h));

    el.innerHTML = items.map(it => `
      <div class="maree-card ${it.type.toLowerCase()}">
        <div class="type-label">${it.type === 'PM' ? '▲ Pleine Mer' : '▽ Basse Mer'}</div>
        <div class="heure">${it.h}</div>
        <div class="hauteur">${it.haut} m</div>
        ${it.coeff ? `<span class="coeff-badge">Coeff ${it.coeff}</span>` : ''}
      </div>
    `).join('');
  }

  // ── API publique ─────────────────────────────────────────────

  async function init() {
    try {
      const res = await fetch(CONFIG.DATA.marees);
      _data = await res.json();

      // ── Normalisation FES2022 → _haut (mètres au-dessus du ZH) ──
      // Le JSON FES exporte _hcm (cm par rapport au MSL FES2022).
      // FES2022 surestime légèrement le marnage à Saint-Malo → correction
      // affine : h_ZH = hcm/100 * scale + offset (calibré sur SHOM 17/04/2026).
      const mslScale  = (CONFIG.MAREES && CONFIG.MAREES.MSL_SCALE)    || 1.0;
      const mslOffset = (CONFIG.MAREES && CONFIG.MAREES.MSL_OFFSET_M) || 0;
      Object.values(_data).forEach(e => {
        ['PM1', 'PM2', 'BM1', 'BM2', 'BM3'].forEach(k => {
          if (e[k + '_hcm'] !== undefined && e[k + '_haut'] === undefined) {
            e[k + '_haut'] = Math.round((e[k + '_hcm'] / 100 * mslScale + mslOffset) * 100) / 100;
          }
        });
      });

      _aujourd = _data[_dateKey()];
      _updateBandeau();
      // Mise à jour toutes les minutes
      _intervalID = setInterval(_updateBandeau, 60_000);
    } catch (e) {
      console.warn('⚠️ Impossible de charger marees.json', e);
      document.getElementById('maree-hauteur-actuelle').textContent = 'N/A';
    }
  }

  function ouvrirModal() {
    const modal = document.getElementById('modal-marees');
    if (!modal || !_aujourd) return;
    modal.classList.remove('hidden');
    dessinerGraphique('canvas-marees', _data);
    _afficherTableau(_aujourd);
  }

  function getData() { return _data; }
  function getAujourd() { return _aujourd; }

  /** Entrée marees.json pour une Date quelconque (null si hors plage) */
  function getEntreePourDate(date) {
    const key = date.toISOString().slice(0, 10);
    return _data[key] || null;
  }

  /**
   * Hauteur d'eau en mètres à une Date quelconque.
   * Utilise l'interpolation sinusoïdale sur l'entrée du jour correspondant.
   */
  function getHauteurAt(date) {
    const entree = getEntreePourDate(date);
    if (!entree) return null;
    return _hauteurActuelle(entree, date);
  }

  /** Hauteur d'eau actuelle en mètres (null si données absentes) */
  function getHauteurActuelle() {
    if (!_aujourd) return null;
    return _hauteurActuelle(_aujourd);
  }

  /** PM et BM du jour : { pm: valeur_max, bm: valeur_min } */
  function getExtremaJour() {
    if (!_aujourd) return null;
    const hauteurs = [
      _aujourd.PM1_haut,
      _aujourd.BM1_haut,
      _aujourd.PM2_haut,
      _aujourd.BM2_haut,
    ].filter(v => v !== null && v !== undefined);
    if (hauteurs.length === 0) return null;
    return {
      pm: Math.max(...hauteurs),
      bm: Math.min(...hauteurs),
    };
  }

  return { init, ouvrirModal, getData, getAujourd, getEntreePourDate, getHauteurAt, getHauteurActuelle, getExtremaJour };
})();
