/**
 * biplongee.js — Planificateur de bi-journée (2 plongées / jour)
 *
 * Paramètres fixes :
 *   Port de départ : Cale du Naye, Saint-Malo  (48.6384°N / 2.0235°W)
 *   Bateau         : Maclow — 15 nœuds
 *   Coefficient de navigation : 1.35
 *     → les distances sont calculées à vol d'oiseau et multipliées par 1.35
 *       pour estimer le chemin réel (contournement des hauts-fonds / chenaux)
 *   Durée par plongée   : 45 min
 *   Intervalle surface  : ≥ 60 min (inclut le transit A→B)
 *   Profil interdit     : 2e plongée > 1re + tolérance
 *     • Si profondeur réelle dive-2 ≤ 20 m → tolérance 5 m
 *     • Si profondeur réelle dive-2 > 20 m → 0 m (strictement égal ou moins profond)
 *
 * Dépendances : Sites, Bathy, Marees, MaréeSite
 */

const BiPlongee = (() => {

  // ── Constantes ───────────────────────────────────────────────

  /** Coordonnées de la Cale du Naye, Saint-Malo */
  const NAYE = { lat: 48.6384, lon: -2.0235 };

  const VITESSE_KTS    = 15;    // nœuds
  const NAV_COEFF      = 1.35;  // multiplicateur distance vol d'oiseau → chenal estimé
  const DIVE_DUREE_MIN = 45;    // minutes par plongée
  const SURFACE_MIN    = 60;    // intervalle surface minimum (min)

  // ── État interne ──────────────────────────────────────────────

  let _geojson = null;   // FeatureCollection des sites
  let _fenetresCache = new Map(); // Map<"siteID|dateStr", [{debutMin, finMin}]>

  // ── Initialisation ────────────────────────────────────────────

  function init() {
    _bindUI();
    _setDefaultDateTime();
  }

  // ── Calcul géographique ───────────────────────────────────────

  /** Distance haversine en milles nautiques entre deux points WGS84 */
  function _distanceNM(lat1, lon1, lat2, lon2) {
    const R    = 3440.065; // rayon terrestre en NM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180)
               * Math.cos(lat2 * Math.PI / 180)
               * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  /**
   * Temps de transit en minutes entre deux points.
   * Applique le coefficient de navigation pour estimer la distance réelle.
   */
  function _transitMin(lat1, lon1, lat2, lon2) {
    const dNM = _distanceNM(lat1, lon1, lat2, lon2) * NAV_COEFF;
    return (dNM / VITESSE_KTS) * 60;
  }

  // ── Fenêtres de plongeabilité ─────────────────────────────────

  /**
   * Retourne les fenêtres [{debutMin, finMin}] pour un site à une date donnée.
   * Utilise un cache pour éviter les recalculs répétés.
   */
  function _getFenetres(props, entreeMaree, dateStr) {
    const cacheKey = `${props.siteID}|${dateStr}`;
    if (_fenetresCache.has(cacheKey)) return _fenetresCache.get(cacheKey);
    const fenetres = MaréeSite.getFenetres(props, entreeMaree);
    _fenetresCache.set(cacheKey, fenetres);
    return fenetres;
  }

  /**
   * Vérifie si l'intervalle [startMin, endMin] est entièrement couvert
   * par au moins une fenêtre de plongeabilité.
   */
  function _couvreIntervalle(startMin, endMin, fenetres) {
    return fenetres.some(f => startMin >= f.debutMin && endMin <= f.finMin);
  }

  // ── Profondeur réelle (LiDAR + marée) ────────────────────────

  /**
   * Profondeur réelle maximum au centre d'une plongée.
   * = profMax_ZH + hauteur_marée_à_T
   * Retourne null si LiDAR non disponible pour ce site.
   */
  function _profReelleMax(siteID, midpointMin, dateStr) {
    const entry = Bathy.get(siteID);
    if (!entry) return null;
    // Construire la date complète à partir de dateStr + heure du midpoint
    const [Y, M, D] = dateStr.split('-').map(Number);
    const H  = Math.floor(midpointMin / 60);
    const Mi = Math.round(midpointMin % 60);
    const dt = new Date(Y, M - 1, D, H, Mi, 0);
    const hMaree = Marees.getHauteurAt(dt) ?? 0;
    return entry.profMax + hMaree;
  }

  // ── Algorithme principal ──────────────────────────────────────

  /**
   * Calcule toutes les paires (A, B) de sites compatibles pour une bi-journée.
   *
   * @param {string} dateStr   "YYYY-MM-DD"
   * @param {number} departMin Minutes depuis minuit (heure départ de la Cale du Naye)
   * @returns {Array} Résultats triés : vert → orange → rouge
   */
  function calculerPaires(dateStr, departMin) {
    _fenetresCache.clear();

    const geojson = Sites.getGeojson();
    if (!geojson) return [];

    const entreeMaree = Marees.getEntreePourDate(new Date(dateStr + 'T12:00:00'));
    if (!entreeMaree) return [];

    const features  = geojson.features;
    const resultats = [];

    const latP = NAYE.lat;
    const lonP = NAYE.lon;

    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < features.length; j++) {
        if (i === j) continue;

        const fA = features[i];
        const fB = features[j];
        const pA = fA.properties;
        const pB = fB.properties;
        const [lonA, latA] = fA.geometry.coordinates;
        const [lonB, latB] = fB.geometry.coordinates;

        // ── Horaire ──────────────────────────────────────────

        // Transit Port → Site A
        const transitPA    = _transitMin(latP, lonP, latA, lonA);
        const arriveeA_min = departMin + transitPA;
        const finP1_min    = arriveeA_min + DIVE_DUREE_MIN;

        // Transit Site A → Site B (surface + déplacement)
        const transitAB      = _transitMin(latA, lonA, latB, lonB);
        const surfaceTotale  = Math.max(SURFACE_MIN, transitAB);
        const arriveeB_min   = finP1_min + surfaceTotale;
        const finP2_min      = arriveeB_min + DIVE_DUREE_MIN;

        // ── Fenêtres de marée ─────────────────────────────────

        const fenetresA = _getFenetres(pA, entreeMaree, dateStr);
        const fenetresB = _getFenetres(pB, entreeMaree, dateStr);

        const p1EnFenetre = _couvreIntervalle(arriveeA_min, finP1_min, fenetresA);
        const p2EnFenetre = _couvreIntervalle(arriveeB_min, finP2_min, fenetresB);

        // ── Vérification profil (anti-inversion) ──────────────

        const midP1 = arriveeA_min + DIVE_DUREE_MIN / 2;
        const midP2 = arriveeB_min + DIVE_DUREE_MIN / 2;
        const profA = _profReelleMax(pA.siteID, midP1, dateStr);
        const profB = _profReelleMax(pB.siteID, midP2, dateStr);

        let profilOk   = true;
        let profilNote = '';
        let profilWarning = false;

        if (profA !== null && profB !== null) {
          // Tolérance : 5 m si dive-2 ≤ 20 m, 0 m sinon
          const tolerance = profB <= 20 ? 5 : 0;
          const profALabel = profA.toFixed(0);
          const profBLabel = profB.toFixed(0);

          if (profB > profA + tolerance) {
            profilOk   = false;
            profilNote = `⛔ Profil inversé : ${profALabel} m → ${profBLabel} m`;
          } else if (profB > profA) {
            // Dans la tolérance mais signalé
            profilWarning = true;
            profilNote = `⚠️ ${profALabel} m → ${profBLabel} m (dans tolérance ≤ 5 m)`;
          } else {
            profilNote = `✅ ${profALabel} m → ${profBLabel} m`;
          }
        } else {
          profilNote = '⚙️ Profondeur LiDAR non disponible';
        }

        // Exclure les profils inversés
        if (!profilOk) continue;

        // ── Statut global ─────────────────────────────────────

        let statut;
        if (p1EnFenetre && p2EnFenetre) {
          statut = 'vert';
        } else if (p1EnFenetre || p2EnFenetre) {
          statut = 'orange';
        } else {
          statut = 'rouge';
        }

        // ── Détail fenêtres pour affichage ────────────────────

        const fenA = fenetresA.find(f => arriveeA_min >= f.debutMin && finP1_min <= f.finMin)
                  || fenetresA[0];
        const fenB = fenetresB.find(f => arriveeB_min >= f.debutMin && finP2_min <= f.finMin)
                  || fenetresB[0];

        resultats.push({
          siteA: pA,
          siteB: pB,
          // Distances vol d'oiseau
          distPA_nm: Math.round(_distanceNM(latP, lonP, latA, lonA) * 10) / 10,
          distAB_nm: Math.round(_distanceNM(latA, lonA, latB, lonB) * 10) / 10,
          // Horaires
          transitPA_min:   Math.round(transitPA),
          transitAB_min:   Math.round(transitAB),
          surfaceTotale_min: Math.round(surfaceTotale),
          arriveeA_min:    Math.round(arriveeA_min),
          finP1_min:       Math.round(finP1_min),
          arriveeB_min:    Math.round(arriveeB_min),
          finP2_min:       Math.round(finP2_min),
          // Marée
          p1EnFenetre,
          p2EnFenetre,
          fenA,
          fenB,
          // Profil
          profilNote,
          profilWarning,
          profA,
          profB,
          // Statut
          statut,
        });
      }
    }

    // Tri : vert → orange → rouge, puis par durée totale croissante
    const ordre = { vert: 0, orange: 1, rouge: 2 };
    resultats.sort((a, b) => {
      if (ordre[a.statut] !== ordre[b.statut]) return ordre[a.statut] - ordre[b.statut];
      return a.finP2_min - b.finP2_min;
    });

    return resultats;
  }

  // ── Rendu ─────────────────────────────────────────────────────

  function _minToHHMM(min) {
    const total = Math.round(((min % 1440) + 1440) % 1440);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function _formatDuree(min) {
    const total = Math.round(min);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h${String(m).padStart(2, '0')}`;
  }

  function _rendrePaire(r) {
    const p1Icon = r.p1EnFenetre ? '✅' : '🔴';
    const p2Icon = r.p2EnFenetre ? '✅' : '🔴';

    // Note surface inter-plongée
    let surfaceNote;
    if (r.transitAB_min >= SURFACE_MIN) {
      surfaceNote = `${_formatDuree(r.surfaceTotale_min)} de transit (≥ 60 min ✓)`;
    } else {
      const attente = SURFACE_MIN - r.transitAB_min;
      surfaceNote = `Transit ${_formatDuree(r.transitAB_min)} + attente ${_formatDuree(attente)} = 60 min`;
    }

    // Étiquette fenêtre de marée
    const fenALabel = r.fenA ? r.fenA.etaleLabel : '—';
    const fenBLabel = r.fenB ? r.fenB.etaleLabel : '—';

    // Heure de fin estimée
    const heureRetour = r.finP2_min + r.transitAB_min; // retour approximatif (A→B puis B≈port)

    return `
      <div class="bi-paire bi-paire-${r.statut}">
        <div class="bi-paire-header">
          <span class="bi-badge bi-badge-${r.statut}">
            ${r.statut === 'vert' ? '✅ Compatible' : r.statut === 'orange' ? '⚠️ Partiel' : '🔴 Hors fenêtre'}
          </span>
          <span class="bi-paire-titre">${r.siteA.siteNom} → ${r.siteB.siteNom}</span>
        </div>

        <div class="bi-timeline">

          <div class="bi-tl-row bi-tl-transit">
            <span class="bi-tl-icon">🚤</span>
            <span class="bi-tl-label">Port → <strong>${r.siteA.siteNom}</strong></span>
            <span class="bi-tl-val">${_formatDuree(r.transitPA_min)} · ${r.distPA_nm} Nm</span>
          </div>

          <div class="bi-tl-row bi-tl-dive ${r.p1EnFenetre ? 'bi-dive-ok' : 'bi-dive-ko'}">
            <span class="bi-tl-icon">${p1Icon}</span>
            <span class="bi-tl-label">Plongée 1</span>
            <span class="bi-tl-val">${_minToHHMM(r.arriveeA_min)} – ${_minToHHMM(r.finP1_min)}</span>
          </div>
          ${r.p1EnFenetre ? `<div class="bi-tl-sub">${fenALabel}</div>` : `<div class="bi-tl-sub bi-sub-ko">Hors fenêtre de marée</div>`}

          <div class="bi-tl-row bi-tl-surface">
            <span class="bi-tl-icon">⛵</span>
            <span class="bi-tl-label">Surface + Transit</span>
            <span class="bi-tl-val">${surfaceNote}</span>
          </div>

          <div class="bi-tl-row bi-tl-dive ${r.p2EnFenetre ? 'bi-dive-ok' : 'bi-dive-ko'}">
            <span class="bi-tl-icon">${p2Icon}</span>
            <span class="bi-tl-label">Plongée 2</span>
            <span class="bi-tl-val">${_minToHHMM(r.arriveeB_min)} – ${_minToHHMM(r.finP2_min)}</span>
          </div>
          ${r.p2EnFenetre ? `<div class="bi-tl-sub">${fenBLabel}</div>` : `<div class="bi-tl-sub bi-sub-ko">Hors fenêtre de marée</div>`}

          <div class="bi-tl-row bi-tl-profil ${r.profilWarning ? 'bi-profil-warn' : ''}">
            <span class="bi-tl-icon">🌊</span>
            <span class="bi-tl-label">Profil</span>
            <span class="bi-tl-val">${r.profilNote}</span>
          </div>

          <div class="bi-tl-row bi-tl-info">
            <span class="bi-tl-icon">📏</span>
            <span class="bi-tl-label">A → B</span>
            <span class="bi-tl-val">${r.distAB_nm} Nm (vol d'oiseau × ${NAV_COEFF})</span>
          </div>

        </div>
      </div>
    `;
  }

  /**
   * Lance le calcul et affiche les résultats dans le conteneur #bi-resultats.
   */
  function afficher(dateStr, departMin) {
    const container = document.getElementById('bi-resultats');
    if (!container) return;

    container.innerHTML = '<p class="bi-loading">⏳ Calcul des paires en cours…</p>';

    // Calcul asynchrone pour ne pas bloquer l'UI
    setTimeout(() => {
      const resultats = calculerPaires(dateStr, departMin);

      if (resultats.length === 0) {
        container.innerHTML = `
          <p class="bi-empty">
            Aucune donnée de marée disponible pour cette date,<br>
            ou aucun site chargé.
          </p>`;
        return;
      }

      const verts   = resultats.filter(r => r.statut === 'vert');
      const oranges = resultats.filter(r => r.statut === 'orange');

      let html = '';

      if (verts.length > 0) {
        html += `<div class="bi-section-title">✅ ${verts.length} combinaison(s) entièrement compatibles</div>`;
        html += verts.map(_rendrePaire).join('');
      }

      if (oranges.length > 0) {
        const affichesOranges = oranges.slice(0, 15);
        html += `<div class="bi-section-title bi-section-orange">⚠️ ${oranges.length} combinaison(s) partiellement compatibles (15 premières)</div>`;
        html += affichesOranges.map(_rendrePaire).join('');
      }

      if (verts.length === 0 && oranges.length === 0) {
        html = `
          <p class="bi-empty">
            Aucune combinaison compatible pour ce départ.<br>
            💡 Essayez un autre horaire de départ ou une autre date.
          </p>`;
      }

      // Note sur la tolérance de navigation
      html += `
        <p class="bi-note">
          📌 Distances calculées à vol d'oiseau × ${NAV_COEFF} (tolérance chenal).
          Profil inversé exclu (2e plongée > 1re + 5 m si ≤ 20 m, + 0 m si > 20 m).
        </p>`;

      container.innerHTML = html;
    }, 30);
  }

  // ── UI ────────────────────────────────────────────────────────

  function _setDefaultDateTime() {
    const dateEl = document.getElementById('bi-date');
    const timeEl = document.getElementById('bi-time');
    if (!dateEl || !timeEl) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dateEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    timeEl.value = '08:30';
  }

  function _bindUI() {
    const btn = document.getElementById('btn-bi-calculer');
    if (btn) btn.addEventListener('click', _onCalculer);

    // Recalcul automatique sur changement de date/heure
    ['bi-date', 'bi-time'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', _onCalculer);
    });
  }

  function _onCalculer() {
    const dateEl = document.getElementById('bi-date');
    const timeEl = document.getElementById('bi-time');
    if (!dateEl || !timeEl || !dateEl.value || !timeEl.value) return;
    const [h, m]   = timeEl.value.split(':').map(Number);
    const departMin = h * 60 + m;
    afficher(dateEl.value, departMin);
  }

  return { init, calculerPaires, afficher };

})();
