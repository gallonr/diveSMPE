/**
 * prevision.js — Module Prévision de plongeabilité
 *
 * Permet de choisir une date et une heure, calcule la hauteur de marée
 * correspondante (via les données FES2022 de marees.json) et affiche
 * les sites plongeables triés par statut (vert → orange → rouge → gris).
 *
 * Dépendances : Marees, MaréeSite, Sites (optionnel, pour filtrer les types)
 */

const Prevision = (() => {

  // ── Helpers ──────────────────────────────────────────────────

  /** Pad "7" → "07" */
  function _pad2(n) { return String(n).padStart(2, '0'); }

  /** Date locale au format "YYYY-MM-DD" pour <input type="date"> */
  function _dateLocal(d = new Date()) {
    return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
  }

  /** Heure locale au format "HH:MM" pour <input type="time"> */
  function _timeLocal(d = new Date()) {
    return `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`;
  }

  /**
   * Construit une Date locale à partir de "YYYY-MM-DD" + "HH:MM".
   * On NE passe PAS par Date(string ISO) pour éviter le décalage UTC.
   */
  function _buildDate(dateStr, timeStr) {
    const [Y, M, D] = dateStr.split('-').map(Number);
    const [H, Mi]   = timeStr.split(':').map(Number);
    return new Date(Y, M - 1, D, H, Mi, 0, 0);
  }

  // ── Dessin de la mini-courbe de marée (canvas) ────────────────

  function _dessinerMiniCourbe(canvasId, entree, targetDate) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !entree) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const pad = { top: 12, right: 12, bottom: 24, left: 36 };
    const w = W - pad.left - pad.right;
    const h = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1a2e3a';
    ctx.fillRect(0, 0, W, H);

    // Construire les extrema de l'entrée
    const champs   = ['PM1_h','BM1_h','PM2_h','BM2_h'];
    const hauteurs = ['PM1_haut','BM1_haut','PM2_haut','BM2_haut'];
    const extrema  = [];
    for (let i = 0; i < 4; i++) {
      if (!entree[champs[i]]) continue;
      const [hh, mm] = entree[champs[i]].split(':').map(Number);
      extrema.push({ tMin: hh * 60 + mm, h: entree[hauteurs[i]] });
    }
    extrema.sort((a, b) => a.tMin - b.tMin);
    if (extrema.length < 2) return;

    // Générer les points de la courbe (pas 10 min)
    const points = [];
    for (let m = 0; m <= 1440; m += 10) {
      let avant = extrema[extrema.length - 1];
      let apres = extrema[0];
      for (let i = 0; i < extrema.length - 1; i++) {
        if (m >= extrema[i].tMin && m < extrema[i + 1].tMin) {
          avant = extrema[i];
          apres = extrema[i + 1];
          break;
        }
      }
      const duree = apres.tMin - avant.tMin;
      let hv;
      if (duree === 0) {
        hv = avant.h;
      } else {
        const frac = (m - avant.tMin) / duree;
        hv = avant.h + (apres.h - avant.h) * (1 - Math.cos(frac * Math.PI)) / 2;
      }
      points.push({ x: m, h: hv });
    }

    const hMin = 0, hMax = 14;
    const xMin = 0, xMax = 1440;
    const toX = xv => pad.left + (xv - xMin) / (xMax - xMin) * w;
    const toY = hv => pad.top + h - (hv - hMin) / (hMax - hMin) * h;

    // Grille h
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    for (let hv = 0; hv <= 14; hv += 2) {
      ctx.beginPath();
      ctx.moveTo(pad.left, toY(hv));
      ctx.lineTo(pad.left + w, toY(hv));
      ctx.stroke();
      ctx.fillText(hv + 'm', pad.left - 3, toY(hv) + 3);
    }

    // Courbe remplie
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    grad.addColorStop(0, 'rgba(0,180,216,0.6)');
    grad.addColorStop(1, 'rgba(0,20,60,0.15)');

    ctx.beginPath();
    ctx.moveTo(toX(points[0].x), toY(points[0].h));
    for (let i = 1; i < points.length; i++) ctx.lineTo(toX(points[i].x), toY(points[i].h));
    ctx.strokeStyle = '#00b4d8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(toX(points[points.length - 1].x), pad.top + h);
    ctx.lineTo(toX(points[0].x), pad.top + h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Trait heure choisie
    const chosenMin = targetDate.getHours() * 60 + targetDate.getMinutes();
    const xNow = toX(chosenMin);
    ctx.strokeStyle = 'rgba(255,220,0,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xNow, pad.top);
    ctx.lineTo(xNow, pad.top + h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Point sur la courbe à l'heure choisie
    let hChosen = null;
    for (let i = 0; i < points.length - 1; i++) {
      if (chosenMin >= points[i].x && chosenMin <= points[i + 1].x) {
        const frac = (chosenMin - points[i].x) / (points[i + 1].x - points[i].x);
        hChosen = points[i].h + (points[i + 1].h - points[i].h) * frac;
        break;
      }
    }
    if (hChosen !== null) {
      ctx.beginPath();
      ctx.arc(xNow, toY(hChosen), 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffd700';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Heures axe X
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    for (const hTick of [0, 6, 12, 18]) {
      const xv = hTick * 60;
      ctx.fillText(`${_pad2(hTick)}h`, toX(xv), H - 4);
    }
  }

  // ── Calcul et rendu des résultats ─────────────────────────────

  function _calculer() {
    const dateStr = document.getElementById('prev-date').value;
    const timeStr = document.getElementById('prev-time').value;
    if (!dateStr || !timeStr) return;

    const targetDate = _buildDate(dateStr, timeStr);
    const entree     = Marees.getEntreePourDate(targetDate);
    const hauteur    = entree ? Marees.getHauteurAt(targetDate) : null;

    // Afficher hauteur + courbe
    const hEl = document.getElementById('prev-hauteur');
    if (hEl) {
      if (hauteur !== null) {
        const coeff = entree ? (entree.PM1_coeff || entree.PM2_coeff || '?') : '?';
        const typeEau = (entree && (entree.PM1_coeff || entree.PM2_coeff))
          ? ((entree.PM1_coeff || entree.PM2_coeff) <= 70 ? 'morte-eau' : 'vive-eau')
          : '';
        hEl.innerHTML = `
          <span class="prev-haut-val">${hauteur.toFixed(2)} m</span>
          <span class="prev-coeff-badge">Coeff ${coeff}${typeEau ? ' · ' + typeEau : ''}</span>
        `;
      } else {
        hEl.innerHTML = `<span class="prev-haut-absent">Aucune donnée de marée pour cette date</span>`;
      }
    }

    _dessinerMiniCourbe('canvas-prev', entree, targetDate);

    // Bloc Port : état des bateaux à l'heure choisie
    if (typeof Port !== 'undefined') {
      Port.renderPrevision(entree, hauteur, targetDate);
    }

    // Calculer le statut de tous les sites
    const geojson = (typeof Sites !== 'undefined' && Sites.getGeojson)
      ? Sites.getGeojson()
      : null;

    const conteneur = document.getElementById('prev-sites');
    if (!conteneur) return;

    if (!geojson || !entree) {
      conteneur.innerHTML = hauteur === null
        ? '<p class="prev-empty">Aucune donnée de marée disponible pour cette date.<br>Les prévisions couvrent la plage de marees.json.</p>'
        : '<p class="prev-empty">Sites non disponibles.</p>';
      return;
    }

    // Calculer l'état de chaque site pour la date/heure choisie
    const resultats = geojson.features.map(feat => {
      const etat = MaréeSite.calculerEtat(feat.properties, entree, targetDate);
      return { props: feat.properties, etat };
    });

    // Trier : vert → orange → rouge → gris
    const ordre = { vert: 0, orange: 1, rouge: 2, gris: 3 };
    resultats.sort((a, b) => (ordre[a.etat.statut] ?? 4) - (ordre[b.etat.statut] ?? 4));

    // Groupes
    const groupes = {
      vert:   resultats.filter(r => r.etat.statut === 'vert'),
      orange: resultats.filter(r => r.etat.statut === 'orange'),
      rouge:  resultats.filter(r => r.etat.statut === 'rouge'),
      gris:   resultats.filter(r => r.etat.statut === 'gris'),
    };

    let html = '';

    if (groupes.vert.length > 0) {
      html += `<div class="prev-groupe-titre prev-titre-vert">✅ Plongeables maintenant (${groupes.vert.length})</div>`;
      html += groupes.vert.map(r => _renderSiteCard(r)).join('');
    }
    if (groupes.orange.length > 0) {
      html += `<div class="prev-groupe-titre prev-titre-orange">⏱ Bientôt plongeables (${groupes.orange.length})</div>`;
      html += groupes.orange.map(r => _renderSiteCard(r)).join('');
    }
    if (groupes.rouge.length > 0) {
      html += `<div class="prev-groupe-titre prev-titre-rouge">🔴 Non plongeables (${groupes.rouge.length})
        <button class="prev-toggle-rouge btn-icon" onclick="Prevision._toggleRouge(this)">▼</button>
      </div>`;
      html += `<div class="prev-rouge-liste">` + groupes.rouge.map(r => _renderSiteCard(r)).join('') + `</div>`;
    }
    if (groupes.gris.length > 0) {
      html += `<div class="prev-groupe-titre prev-titre-gris">— Sans contrainte de marée (${groupes.gris.length})
        <button class="prev-toggle-gris btn-icon" onclick="Prevision._toggleGris(this)">▼</button>
      </div>`;
      html += `<div class="prev-gris-liste">` + groupes.gris.map(r => _renderSiteCard(r)).join('') + `</div>`;
    }

    if (html === '') html = '<p class="prev-empty">Aucun site à afficher.</p>';
    conteneur.innerHTML = html;
  }

  function _renderSiteCard(r) {
    const p    = r.props;
    const etat = r.etat;
    const nom  = p.siteNom || p.siteID;
    const type = p.typeSite || '';
    return `
      <div class="prev-site-card prev-card-${etat.statut}" onclick="Sites.selectionner('${p.siteID}'); Prevision.fermer()">
        <div class="prev-site-header">
          <span class="prev-site-nom">${nom}</span>
          <span class="maree-badge-liste maree-badge-${etat.statut}">${etat.label}</span>
        </div>
        <div class="prev-site-detail">${etat.detail}</div>
        ${type ? `<div class="prev-site-type">${type}</div>` : ''}
      </div>
    `;
  }

  // ── Toggles groupes repliés ───────────────────────────────────

  function _toggleRouge(btn) {
    const liste = btn.closest('.prev-groupe-titre').nextElementSibling;
    if (!liste) return;
    const hidden = liste.classList.toggle('prev-liste-cachee');
    btn.textContent = hidden ? '▶' : '▼';
  }

  function _toggleGris(btn) {
    const liste = btn.closest('.prev-groupe-titre').nextElementSibling;
    if (!liste) return;
    const hidden = liste.classList.toggle('prev-liste-cachee');
    btn.textContent = hidden ? '▶' : '▼';
  }

  // ── Ouverture / fermeture ─────────────────────────────────────

  function ouvrir() {
    const modal = document.getElementById('modal-prevision');
    if (!modal) return;

    // Pré-remplir date/heure courante
    const now = new Date();
    const dateIn = document.getElementById('prev-date');
    const timeIn = document.getElementById('prev-time');
    if (dateIn && !dateIn.value) dateIn.value = _dateLocal(now);
    if (timeIn && !timeIn.value) timeIn.value = _timeLocal(now);

    modal.classList.remove('hidden');
    _calculer();
  }

  function fermer() {
    const modal = document.getElementById('modal-prevision');
    if (modal) modal.classList.add('hidden');
  }

  // ── Initialisation ────────────────────────────────────────────

  function init() {
    // Bouton header
    const btnPrev = document.getElementById('btn-prevision');
    if (btnPrev) btnPrev.addEventListener('click', ouvrir);

    // Fermer
    const btnClose = document.getElementById('btn-close-prevision');
    if (btnClose) btnClose.addEventListener('click', fermer);

    // Clic en dehors de la modal
    const modal = document.getElementById('modal-prevision');
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) fermer();
      });
    }

    // Bouton calculer
    const btnCalc = document.getElementById('btn-prev-calculer');
    if (btnCalc) btnCalc.addEventListener('click', _calculer);

    // Recalcul automatique sur changement de date/heure
    document.getElementById('prev-date')?.addEventListener('change', _calculer);
    document.getElementById('prev-time')?.addEventListener('change', _calculer);
  }

  return { init, ouvrir, fermer, _toggleRouge, _toggleGris };
})();
