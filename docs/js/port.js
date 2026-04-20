/**
 * port.js — Gestion du port et des créneaux de sortie des bateaux
 *
 * Le port possède un seuil à CONFIG.PORT.seuilZH mètres au-dessus du ZH.
 * Un bateau de tirant d'eau T peut passer uniquement si :
 *   hauteur_maree(ZH) >= seuilZH + T
 *
 * Ce module fournit :
 *   - un widget flottant sur la carte (état en temps réel)
 *   - une section dans la modal Prévision (créneaux bloqués sur la journée)
 */

const Port = (() => {

  // ── Helpers ──────────────────────────────────────────────────

  /** minutes → "HH:MM" */
  function _minToHHMM(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Hauteur minimale requise pour qu'un bateau passe */
  function _hMin(tirant) {
    return CONFIG.PORT.seuilZH + tirant;
  }

  // ── Courbe sinusoïdale journalière ───────────────────────────

  /**
   * Reconstruit la courbe de hauteur (pas = 5 min) à partir d'une entrée marees.json.
   * Retourne un tableau de { t: minutes_depuis_minuit, h: hauteur_m }.
   */
  function _courbeJour(entree) {
    const champs   = ['PM1_h', 'BM1_h', 'PM2_h', 'BM2_h'];
    const hauteurs = ['PM1_haut', 'BM1_haut', 'PM2_haut', 'BM2_haut'];
    const extrema  = [];

    for (let i = 0; i < 4; i++) {
      if (!entree[champs[i]]) continue;
      const [hh, mm] = entree[champs[i]].split(':').map(Number);
      extrema.push({ t: hh * 60 + mm, h: entree[hauteurs[i]] });
    }
    extrema.sort((a, b) => a.t - b.t);
    if (extrema.length < 2) return [];

    const points = [];
    for (let m = 0; m <= 1440; m += 5) {
      let avant = extrema[extrema.length - 1];
      let apres = extrema[0];
      for (let i = 0; i < extrema.length - 1; i++) {
        if (m >= extrema[i].t && m < extrema[i + 1].t) {
          avant = extrema[i];
          apres = extrema[i + 1];
          break;
        }
      }
      const duree = apres.t - avant.t;
      let hv;
      if (duree === 0) {
        hv = avant.h;
      } else {
        const frac = (m - avant.t) / duree;
        hv = avant.h + (apres.h - avant.h) * (1 - Math.cos(frac * Math.PI)) / 2;
      }
      points.push({ t: m, h: hv });
    }
    return points;
  }

  // ── Calcul des fenêtres de blocage ───────────────────────────

  /**
   * Pour chaque bateau, calcule les plages horaires où la hauteur
   * est insuffisante pour franchir le seuil (en minutes depuis minuit).
   * Retourne un objet { nomBateau: { hMin, bloque: [{debut, fin}] } }
   */
  function getFenetresJour(entree) {
    if (!entree) return null;
    const points = _courbeJour(entree);
    const result = {};

    for (const b of CONFIG.PORT.bateaux) {
      const hMinReq = _hMin(b.tirant);
      const bloque  = [];
      let start     = null;

      for (const pt of points) {
        if (pt.h < hMinReq) {
          if (start === null) start = pt.t;
        } else {
          if (start !== null) {
            bloque.push({ debut: start, fin: pt.t });
            start = null;
          }
        }
      }
      if (start !== null) bloque.push({ debut: start, fin: 1440 });

      result[b.nom] = { hMin: hMinReq, bloque };
    }
    return result;
  }

  // ── État actuel ──────────────────────────────────────────────

  /**
   * Pour chaque bateau, retourne s'il peut passer le seuil à la hauteur donnée,
   * et la prochaine heure d'accès si bloqué (calculée sur la courbe du jour).
   * @param {number|null} hauteur  hauteur actuelle en m ZH
   * @param {object|null} entree   entrée marees.json du jour (pour la courbe)
   * @param {Date}        [now]    date/heure de référence (défaut = maintenant)
   */
  function getEtatActuel(hauteur, entree = null, now = new Date()) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const points = entree ? _courbeJour(entree) : [];

    return CONFIG.PORT.bateaux.map(b => {
      const hMinReq = _hMin(b.tirant);
      const peut    = hauteur !== null && hauteur >= hMinReq;

      // Prochain créneau libre : premier point futur où h >= hMin
      let prochainAcces = null;
      if (!peut && points.length > 0) {
        const futurs = points.filter(pt => pt.t > nowMin && pt.h >= hMinReq);
        if (futurs.length > 0) prochainAcces = _minToHHMM(futurs[0].t);
      }

      // Prochain blocage : premier point futur où h < hMin (seulement si actuellement accessible)
      let prochainBlocage = null;
      if (peut && points.length > 0) {
        const futursBloques = points.filter(pt => pt.t > nowMin && pt.h < hMinReq);
        if (futursBloques.length > 0) prochainBlocage = _minToHHMM(futursBloques[0].t);
      }

      return { nom: b.nom, tirant: b.tirant, hMin: hMinReq, peut, prochainAcces, prochainBlocage };
    });
  }

  // ── Widget carte (coin bas-droit) ────────────────────────────

  function updateWidgetCarte(hauteur, entree, now) {
    const el = document.getElementById('port-widget');
    if (!el) return;
    if (hauteur === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    const etats = getEtatActuel(hauteur, entree, now);
    const rows  = etats.map(e => `
      <div class="port-widget-row">
        <span class="port-widget-nom">${e.nom}</span>
        <span class="port-widget-etat ${e.peut ? 'port-ok' : 'port-bloque'}">
          ${e.peut ? '✅' : '🚫'}
        </span>
        ${!e.peut && e.prochainAcces
          ? `<span class="port-widget-next">⏱ Accès : ${e.prochainAcces}</span>`
          : ''}
        ${e.peut && e.prochainBlocage
          ? `<span class="port-widget-next port-widget-warn">⚠️ Bloqué à : ${e.prochainBlocage}</span>`
          : ''}
      </div>
    `).join('');

    el.innerHTML = `
      <div class="port-widget-titre">⚓ Port — seuil ${CONFIG.PORT.seuilZH} m</div>
      ${rows}
    `;
  }

  // ── Section Prévision ────────────────────────────────────────

  /**
   * Remplit le bloc #prev-port dans la modal Prévision.
   * @param {object|null} entree      entrée marees.json du jour choisi
   * @param {number|null} hauteur     hauteur à l'heure choisie
   * @param {Date}        [targetDate] date/heure choisie (pour prochainAcces)
   */
  function renderPrevision(entree, hauteur, targetDate = new Date()) {
    const el = document.getElementById('prev-port');
    if (!el) return;
    if (!entree) { el.innerHTML = ''; return; }

    const etatsActuels = getEtatActuel(hauteur, entree, targetDate);
    const fenetres     = getFenetresJour(entree);

    let html = `
      <div class="prev-port-header">
        <span class="prev-port-titre">⚓ Port</span>
        <span class="prev-port-seuil">Seuil ${CONFIG.PORT.seuilZH} m ZH</span>
      </div>
      <div class="prev-port-rows">
    `;

    for (const b of CONFIG.PORT.bateaux) {
      const etat = etatsActuels.find(e => e.nom === b.nom);
      const fen  = fenetres[b.nom];

      const statutClass = etat.peut ? 'port-badge-ok' : 'port-badge-bloque';
      const statutText  = etat.peut
        ? `✅ Peut sortir${etat.prochainBlocage ? ` · ⚠️ bloqué à ${etat.prochainBlocage}` : ''}`
        : `🚫 Bloqué${etat.prochainAcces ? ` · ⏱ accès à ${etat.prochainAcces}` : ''}`;

      let blocageHtml;
      if (fen.bloque.length === 0) {
        blocageHtml = `<span class="port-fen-libre">Libre toute la journée</span>`;
      } else {
        blocageHtml = fen.bloque.map(pl =>
          `<span class="port-fen-bloque">${_minToHHMM(pl.debut)}–${_minToHHMM(pl.fin)}</span>`
        ).join('');
      }

      html += `
        <div class="prev-port-row">
          <div class="prev-port-row-top">
            <span class="prev-port-nom">${b.nom}</span>
            <span class="prev-port-meta">T = ${b.tirant} m · min ${fen.hMin.toFixed(1)} m</span>
            <span class="port-badge ${statutClass}">${statutText}</span>
          </div>
          <div class="prev-port-blocages">
            <span class="prev-port-label-bloque">🚫 Bloqué :</span>
            ${blocageHtml}
          </div>
        </div>
      `;
    }

    html += `</div>`;
    el.innerHTML = html;
  }

  // ── Initialisation ────────────────────────────────────────────

  function init() {
    // Premier rendu immédiat
    _refreshWidget();
    // Mise à jour toutes les 60 secondes
    setInterval(_refreshWidget, 60_000);
  }

  function _refreshWidget() {
    if (typeof Marees === 'undefined') return;
    const now    = new Date();
    const entree = Marees.getEntreePourDate(now);
    const h      = entree ? Marees.getHauteurAt(now) : null;
    updateWidgetCarte(h, entree, now);
  }

  // ── API publique ──────────────────────────────────────────────

  return {
    init,
    getEtatActuel,
    getFenetresJour,
    updateWidgetCarte,
    renderPrevision,
  };
})();
