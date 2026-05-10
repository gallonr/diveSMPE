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
    return Number(entry.profMax) + hMaree;
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
    const profAStr = r.profA !== null ? `${Math.round(r.profA)} m` : '? m';
    const profBStr = r.profB !== null ? `${Math.round(r.profB)} m` : '? m';
    const p1Fenetre = r.p1EnFenetre ? '' : ' bi-dive-ko';
    const p2Fenetre = r.p2EnFenetre ? '' : ' bi-dive-ko';
    const borderColor = r.statut === 'vert' ? 'var(--vert-ok)' : 'var(--orange-light)';

    return `
      <div class="bi-card" style="border-left-color:${borderColor}">
        <div class="bi-card-dive${p1Fenetre}">
          <div class="bi-card-num">P1</div>
          <div class="bi-card-site">${r.siteA.siteNom}</div>
          <div class="bi-card-time">${_minToHHMM(r.arriveeA_min)} – ${_minToHHMM(r.finP1_min)}</div>
          <div class="bi-card-prof">${profAStr}</div>
        </div>
        <div class="bi-card-sep">↓ surface ${_formatDuree(r.surfaceTotale_min)}</div>
        <div class="bi-card-dive${p2Fenetre}">
          <div class="bi-card-num">P2</div>
          <div class="bi-card-site">${r.siteB.siteNom}</div>
          <div class="bi-card-time">${_minToHHMM(r.arriveeB_min)} – ${_minToHHMM(r.finP2_min)}</div>
          <div class="bi-card-prof">${profBStr}</div>
        </div>
      </div>
    `;
  }

  /**
   * Lance le calcul et affiche les résultats dans le conteneur spécifié.
   *
   * Optimisations :
   *  • Pré-calcul O(n) par site (transit port→site, arrivée, fin P1, fenêtres, profA)
   *    → élimine n-1 recalculs identiques par site dans la boucle interne.
   *  • État de progression (_ci, _cj) conservé en closure entre les frames
   *    → plus de logique de skip O(n²) : chaque reprise repart exactement où
   *      elle s'est arrêtée sans rescanner les paires précédentes.
   *  • Lot de BATCH paires par frame (requestAnimationFrame) pour ne pas
   *    bloquer le thread principal.
   *
   * @param {string} dateStr    "YYYY-MM-DD"
   * @param {number} departMin  minutes depuis minuit
   * @param {string} [containerId="prev-bi-resultats"]  id du div cible
   */
  function afficher(dateStr, departMin, containerId = 'prev-bi-resultats') {
    const container = document.getElementById(containerId);
    if (!container) return;

    // ── Validation préalable ───────────────────────────────────
    const geojson     = Sites.getGeojson();
    const entreeMaree = geojson
      ? Marees.getEntreePourDate(new Date(dateStr + 'T12:00:00'))
      : null;

    if (!geojson) {
      container.innerHTML = `<p class="bi-empty">⚠️ Sites non chargés. Rechargez la page.</p>`;
      return;
    }
    if (!entreeMaree) {
      container.innerHTML = `<p class="bi-empty">⚠️ Pas de données de marée pour le <strong>${dateStr}</strong>.</p>`;
      return;
    }

    const features = geojson.features;
    const n        = features.length;
    const total    = n * (n - 1);

    _fenetresCache.clear();
    const resultats = [];
    const latP = NAYE.lat;
    const lonP = NAYE.lon;

    // ── Pré-calcul O(n) : données fixes par site ───────────────
    // Ces valeurs ne dépendent que du site A (indice i) et de l'heure de départ ;
    // les calculer ici évite de les répéter (n-1) fois dans la boucle interne.
    const sc = features.map(f => {
      const p           = f.properties;
      const [lon, lat]  = f.geometry.coordinates;
      const transitPA   = _transitMin(latP, lonP, lat, lon);
      const arriveeA    = departMin + transitPA;
      const finP1       = arriveeA + DIVE_DUREE_MIN;
      const fenetres    = _getFenetres(p, entreeMaree, dateStr);
      // profA dépend du milieu de P1, qui ne change pas d'une paire à l'autre
      const profA       = _profReelleMax(p.siteID, arriveeA + DIVE_DUREE_MIN / 2, dateStr);
      // distance port→site en NM (pour l'affichage)
      const distPA_nm   = Math.round(_distanceNM(latP, lonP, lat, lon) * 10) / 10;
      return { p, lon, lat, transitPA, arriveeA, finP1, fenetres, profA, distPA_nm };
    });

    // ── Barre de progression ───────────────────────────────────
    const _renderProgress = (done, tot) => {
      const pct = Math.round(done / tot * 100);
      container.innerHTML = `
        <div class="bi-progress-wrap">
          <div class="bi-progress-label">⏳ Calcul… ${done} / ${tot} paires</div>
          <div class="bi-progress-bar-outer">
            <div class="bi-progress-bar-inner" style="width:${pct}%"></div>
          </div>
          <div class="bi-progress-pct">${pct}%</div>
        </div>`;
    };

    _renderProgress(0, total);

    // ── Paires pré-aplaties : tableau plat [[i, j], …] ────────
    // Taille : n*(n-1) ≈ 3 540 entrées → ~28 Ko, négligeable.
    // Avantage : indice entier unique, aucune logique de curseur.
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) pairs.push(i * 256 + j); // encodage compact (n ≤ 255)
      }
    }
    // (si n > 255 un jour : utiliser pairs.push([i,j]) et adapter la lecture)

    // ── Boucle par lots (setTimeout, jamais throttlé) ──────────
    const BATCH = 400; // paires par appel
    let _idx = 0;      // position courante dans pairs[]

    const _runBatch = () => {
      try {
        const end = Math.min(_idx + BATCH, total);

        while (_idx < end) {
          const code = pairs[_idx++];
          const i    = code >> 8;     // quotient
          const j    = code & 0xFF;   // reste

          // ── Calcul de la paire (i, j) ─────────────────────
          const cA = sc[i];
          const cB = sc[j];

          const transitAB     = _transitMin(cA.lat, cA.lon, cB.lat, cB.lon);
          const surfaceTotale = Math.max(SURFACE_MIN, transitAB);
          const arriveeB      = cA.finP1 + surfaceTotale;
          const finP2         = arriveeB + DIVE_DUREE_MIN;
          const profB         = _profReelleMax(cB.p.siteID, arriveeB + DIVE_DUREE_MIN / 2, dateStr);

          // Vérification profil anti-inversion
          let profilOk = true, profilNote = '', profilWarning = false;
          if (cA.profA !== null && profB !== null) {
            const tolerance = profB <= 20 ? 5 : 0;
            if (profB > cA.profA + tolerance) {
              profilOk = false;
            } else if (profB > cA.profA) {
              profilWarning = true;
              profilNote = `⚠️ ${cA.profA.toFixed(0)} m → ${profB.toFixed(0)} m (tolérance ≤ 5 m)`;
            } else {
              profilNote = `✅ ${cA.profA.toFixed(0)} m → ${profB.toFixed(0)} m`;
            }
          } else {
            profilNote = '⚙️ Profondeur LiDAR non disponible';
          }

          if (profilOk) {
            const p1EnFenetre = _couvreIntervalle(cA.arriveeA, cA.finP1, cA.fenetres);
            const p2EnFenetre = _couvreIntervalle(arriveeB, finP2, cB.fenetres);
            const statut      = p1EnFenetre && p2EnFenetre ? 'vert'
                              : p1EnFenetre || p2EnFenetre ? 'orange'
                              : 'rouge';
            const fenA = cA.fenetres.find(f => cA.arriveeA >= f.debutMin && cA.finP1 <= f.finMin) || cA.fenetres[0] || null;
            const fenB = cB.fenetres.find(f => arriveeB   >= f.debutMin && finP2    <= f.finMin) || cB.fenetres[0] || null;

            // distAB dérivée du transit (pas de 2e appel haversine)
            const distAB_nm = Math.round((transitAB / 60) * VITESSE_KTS / NAV_COEFF * 10) / 10;

            resultats.push({
              siteA: cA.p, siteB: cB.p,
              distPA_nm: cA.distPA_nm,
              distAB_nm,
              transitPA_min:     Math.round(cA.transitPA),
              transitAB_min:     Math.round(transitAB),
              surfaceTotale_min: Math.round(surfaceTotale),
              arriveeA_min: Math.round(cA.arriveeA),
              finP1_min:    Math.round(cA.finP1),
              arriveeB_min: Math.round(arriveeB),
              finP2_min:    Math.round(finP2),
              p1EnFenetre, p2EnFenetre, fenA, fenB,
              profilNote, profilWarning,
              profA: cA.profA, profB,
              statut,
            });
          }
        }

        // Mettre à jour la barre et programmer le prochain lot
        _renderProgress(_idx, total);
        if (_idx < total) {
          setTimeout(_runBatch, 0);
          return;
        }

      } catch (err) {
        console.error('[BiPlongee] Erreur lors du calcul :', err);
        container.innerHTML = `<p class="bi-empty">❌ Erreur de calcul : ${err.message}<br><small>Ouvrez la console (F12) pour le détail.</small></p>`;
        return;
      }

      // ── Toutes les paires traitées → rendu final ───────────────

      const ordre = { vert: 0, orange: 1, rouge: 2 };
      resultats.sort((a, b) => {
        if (ordre[a.statut] !== ordre[b.statut]) return ordre[a.statut] - ordre[b.statut];
        return a.finP2_min - b.finP2_min;
      });

      const verts   = resultats.filter(r => r.statut === 'vert');
      const oranges = resultats.filter(r => r.statut === 'orange');

      let html = '';
      if (verts.length > 0) {
        html += `<div class="bi-section-title">✅ ${verts.length} combinaison(s) entièrement compatibles${verts.length > 20 ? ' — 20 premières affichées' : ''}</div>`;
        html += verts.slice(0, 20).map(_rendrePaire).join('');
      }
      if (oranges.length > 0) {
        const slice = oranges.slice(0, 10);
        html += `<div class="bi-section-title bi-section-orange">⚠️ ${oranges.length} combinaison(s) partiellement compatibles${oranges.length > 10 ? ' — 10 premières affichées' : ''}</div>`;
        html += slice.map(_rendrePaire).join('');
      }
      if (verts.length === 0 && oranges.length === 0) {
        html = `<p class="bi-empty">Aucune combinaison compatible.<br>💡 Essayez un autre horaire ou une autre date.</p>`;
      }
      html += `<p class="bi-note">📌 Distances × ${NAV_COEFF} (tolérance chenal). Profil inversé exclu.</p>`;

      container.innerHTML = html;
      container.scrollTop = 0;
    };

    // Démarrer le premier lot après un tick (laisse le navigateur afficher la barre)
    setTimeout(_runBatch, 0);
  }

  // ── Initialisation ────────────────────────────────────────────

  function init() {
    // Tout est piloté depuis Prevision.js via afficher()
  }

  return { init, calculerPaires, afficher };

})();
