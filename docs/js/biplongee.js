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
  const SURFACE_MAX    = 180;   // intervalle surface maximum (min) — au-delà la paire est exclue

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
   * @param {number} margeFinMin  marge de sécurité avant la fin de la fenêtre (min)
   */
  function _couvreIntervalle(startMin, endMin, fenetres, margeFinMin = 0) {
    return fenetres.some(f => startMin >= f.debutMin && endMin <= f.finMin - margeFinMin);
  }

  /** Marge de sécurité avant la fin de l'étale pour la 2e plongée */
  const MARGE_FIN_P2 = 5; // minutes

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
        // Exclure si l'intervalle surface dépasse 3h (trop long)
        if (surfaceTotale > SURFACE_MAX) continue;
        const arriveeB_min   = finP1_min + surfaceTotale;
        const finP2_min      = arriveeB_min + DIVE_DUREE_MIN;

        // ── Fenêtres de marée ─────────────────────────────────

        const fenetresA = _getFenetres(pA, entreeMaree, dateStr);
        const fenetresB = _getFenetres(pB, entreeMaree, dateStr);

        const p1EnFenetre = _couvreIntervalle(arriveeA_min, finP1_min, fenetresA);
        const p2EnFenetre = _couvreIntervalle(arriveeB_min, finP2_min, fenetresB, MARGE_FIN_P2);

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

        // ── Statut global : uniquement les deux sites en fenêtre ──
        // Exclure si l'une ou l'autre plongée est hors fenêtre d'étale
        if (!p1EnFenetre || !p2EnFenetre) continue;
        const statut = 'vert';

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
    const borderColor = r.statut === 'vert' ? 'var(--vert-ok)' : 'var(--orange-light)';
    const idA = r.siteA.siteID;
    const idB = r.siteB.siteID;

    // Fenêtre de départ
    const fenDuree = r.deptMax - r.deptMin;
    const deptStr = fenDuree === 0
      ? `${_minToHHMM(r.deptMin)}`
      : `${_minToHHMM(r.deptMin)} – ${_minToHHMM(r.deptMax)} (${_formatDuree(fenDuree)})`;

    // Infos surface inter-plongée
    let surfaceNote;
    if (r.transitAB_min >= SURFACE_MIN) {
      surfaceNote = `Transit ${_formatDuree(r.transitAB_min)} (≥ 1h ✓)`;
    } else {
      surfaceNote = `Transit ${_formatDuree(r.transitAB_min)} + attente ${_formatDuree(SURFACE_MIN - r.transitAB_min)} = 1h`;
    }

    return `
      <div class="bi-card" style="border-left-color:${borderColor}">
        <div class="bi-card-depart">🕐 Départ : ${deptStr}</div>
        <div class="bi-card-dive bi-card-clickable" onclick="BiPlongee._ouvrirSite('${idA}')" title="Voir ${r.siteA.siteNom} sur la carte">
          <div class="bi-card-num">P1</div>
          <div class="bi-card-info">
            <div class="bi-card-site">${r.siteA.siteNom}</div>
            <div class="bi-card-sub">${_minToHHMM(r.arriveeA_min)} – ${_minToHHMM(r.finP1_min)} · ${profAStr} · ${r.distPA_nm} Nm du port</div>
          </div>
          <div class="bi-card-map-icon">🗺</div>
        </div>
        <div class="bi-card-sep">⛵ ${surfaceNote} · ${r.distAB_nm} Nm</div>
        <div class="bi-card-dive bi-card-clickable" onclick="BiPlongee._ouvrirSite('${idB}')" title="Voir ${r.siteB.siteNom} sur la carte">
          <div class="bi-card-num">P2</div>
          <div class="bi-card-info">
            <div class="bi-card-site">${r.siteB.siteNom}</div>
            <div class="bi-card-sub">${_minToHHMM(r.arriveeB_min)} – ${_minToHHMM(r.finP2_min)} · ${profBStr}</div>
          </div>
          <div class="bi-card-map-icon">🗺</div>
        </div>
        <div class="bi-card-port ${r.retourPortOk ? 'bi-card-port-ok' : 'bi-card-port-bloque'}">
          ⚓ Retour port ${_minToHHMM(r.retourMin)} ${r.retourPortOk ? '✅' : '🚫 bloqué (seuil)'}
        </div>
      </div>
    `;
  }

  /**
   * Sélectionne un site sur la carte et ferme la modal Prévision.
   * Appelé depuis le HTML généré (onclick).
   */
  function _ouvrirSite(siteID) {
    // Fermer la modal Prévision pour laisser la carte visible
    if (typeof Prevision !== 'undefined') Prevision.fermer();
    // Sélectionner le site (centre la carte + ouvre le panneau détail)
    if (typeof Sites !== 'undefined') Sites.selectionner(siteID);
  }

  /**
   * Lance le calcul et affiche les résultats dans le conteneur spécifié.
   *
   * Parcourt tous les créneaux de départ de 7h00 à 22h00 (pas 5 min)
   * pour chaque paire (A, B) et affiche une carte par paire unique avec
   * la fenêtre de départ valide [deptMin – deptMax].
   *
   * @param {string} dateStr    "YYYY-MM-DD"
   * @param {string} [containerId="prev-bi-resultats"]  id du div cible
   */
  function afficher(dateStr, containerId = 'prev-bi-resultats') {
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
    _fenetresCache.clear();
    const resultats = [];
    const latP = NAYE.lat;
    const lonP = NAYE.lon;

    // ── Port : fenêtres de blocage pour Maclow ─────────────────
    const portFen  = (typeof Port !== 'undefined') ? Port.getFenetresJour(entreeMaree) : null;
    const maclowBl = portFen?.['Maclow']?.bloque ?? [];
    const _portOuvert = tMin => !maclowBl.some(pl => tMin >= pl.debut && tMin < pl.fin);

    // ── Pré-calcul O(n) par site ───────────────────────────────
    const sc = features.map(f => {
      const p          = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const transitPA  = _transitMin(latP, lonP, lat, lon);
      const fenetres   = _getFenetres(p, entreeMaree, dateStr);
      const distPA_nm  = Math.round(_distanceNM(latP, lonP, lat, lon) * 10) / 10;
      return { p, lon, lat, transitPA, fenetres, distPA_nm };
    });

    // ── Créneaux de départ à scanner : 07h00 → 22h00, pas 5 min ─
    const departures = [];
    for (let t = 7 * 60; t <= 22 * 60; t += 5) departures.push(t);

    // ── Paires plates ──────────────────────────────────────────
    const pairs = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (i !== j) pairs.push(i * 256 + j);

    const total = pairs.length;

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

    const BATCH = 80; // paires par appel (chacune scanne ~181 créneaux en interne)
    let _idx = 0;

    const _runBatch = () => {
      try {
        const end = Math.min(_idx + BATCH, total);

        while (_idx < end) {
          const code = pairs[_idx++];
          const i    = code >> 8;
          const j    = code & 0xFF;
          const cA   = sc[i];
          const cB   = sc[j];

          // Transit A→B constant pour cette paire
          const transitAB     = _transitMin(cA.lat, cA.lon, cB.lat, cB.lon);
          const surfaceTotale = Math.max(SURFACE_MIN, transitAB);
          if (surfaceTotale > SURFACE_MAX) continue;

          const distAB_nm     = Math.round((transitAB / 60) * VITESSE_KTS / NAV_COEFF * 10) / 10;
          const transitRetour = _transitMin(cB.lat, cB.lon, latP, lonP);

          let deptMin  = null;
          let deptMax  = null;
          let firstData = null;

          // ── Scan de tous les créneaux de départ ─────────────
          for (const dept of departures) {
            const arriveeA = dept + cA.transitPA;
            const finP1    = arriveeA + DIVE_DUREE_MIN;
            const arriveeB = finP1 + surfaceTotale;
            const finP2    = arriveeB + DIVE_DUREE_MIN;

            // Fenêtres d'étale
            if (!_couvreIntervalle(arriveeA, finP1, cA.fenetres)) continue;
            if (!_couvreIntervalle(arriveeB, finP2, cB.fenetres, MARGE_FIN_P2)) continue;

            // Profil anti-inversion
            const profA = _profReelleMax(cA.p.siteID, arriveeA + DIVE_DUREE_MIN / 2, dateStr);
            const profB = _profReelleMax(cB.p.siteID, arriveeB + DIVE_DUREE_MIN / 2, dateStr);

            let profilOk = true, profilNote = '', profilWarning = false;
            if (profA !== null && profB !== null) {
              const tolerance = profB <= 20 ? 5 : 0;
              if (profB > profA + tolerance) {
                profilOk = false;
              } else if (profB > profA) {
                profilWarning = true;
                profilNote = `⚠️ ${profA.toFixed(0)} m → ${profB.toFixed(0)} m (tolérance ≤ 5 m)`;
              } else {
                profilNote = `✅ ${profA.toFixed(0)} m → ${profB.toFixed(0)} m`;
              }
            } else {
              profilNote = '⚙️ Profondeur LiDAR non disponible';
            }
            if (!profilOk) continue;

            // ── Créneau valide ──────────────────────────────────
            if (deptMin === null) deptMin = dept;
            deptMax = dept;

            // Conserver les données du premier créneau valide
            if (firstData === null) {
              const retourMin = finP2 + transitRetour;
              firstData = {
                siteA: cA.p, siteB: cB.p,
                distPA_nm: cA.distPA_nm,
                distAB_nm,
                transitAB_min:     Math.round(transitAB),
                surfaceTotale_min: Math.round(surfaceTotale),
                arriveeA_min: Math.round(arriveeA),
                finP1_min:    Math.round(finP1),
                arriveeB_min: Math.round(arriveeB),
                finP2_min:    Math.round(finP2),
                retourMin:    Math.round(retourMin),
                retourPortOk: _portOuvert(retourMin),
                profilNote, profilWarning,
                profA, profB,
                statut: 'vert',
              };
            }
          }

          if (firstData !== null) {
            resultats.push({ ...firstData, deptMin, deptMax });
          }
        }

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

      // ── Rendu final ────────────────────────────────────────────
      // Tri : par heure de premier départ possible, puis par fin P2
      resultats.sort((a, b) => a.deptMin - b.deptMin || a.finP2_min - b.finP2_min);

      _dernierResultats = resultats;
      _dernierContainer = containerId;

      _afficherResultats(resultats, container);
    };

    setTimeout(_runBatch, 0);
  }

  // ── Résultats en mémoire (pour la recherche et le filtrage) ──────────────────
  let _dernierResultats = [];
  let _dernierContainer = 'prev-bi-resultats';

  /**
   * Injecte le HTML des résultats + barre de recherche dans le conteneur.
   * Appelé après le calcul et après chaque frappe dans le champ de recherche.
   */
  function _afficherResultats(resultats, container, filtre = '') {
    const MAX_DISPLAY = 30;
    const q = filtre.trim().toLowerCase();
    const filtres = q
      ? resultats.filter(r =>
          r.siteA.siteNom.toLowerCase().includes(q) ||
          r.siteB.siteNom.toLowerCase().includes(q))
      : resultats;

    const total   = resultats.length;
    const visible = filtres.length;
    const slice   = filtres.slice(0, MAX_DISPLAY);

    let html = '';

    // Barre de recherche (persistante)
    html += `
      <div class="bi-search-bar">
        <input
          type="search"
          id="bi-search-input"
          class="bi-search-input"
          placeholder="🔍 Filtrer par nom de site…"
          value="${filtre.replace(/"/g, '&quot;')}"
          oninput="BiPlongee._filtrer(this.value)"
          autocomplete="off"
        />
        <span class="bi-search-count">${q ? `${visible} / ${total}` : total} combinaison(s)</span>
      </div>
    `;

    if (slice.length > 0) {
      if (visible > MAX_DISPLAY) {
        html += `<p class="bi-search-hint">${MAX_DISPLAY} premières affichées sur ${visible}</p>`;
      }
      html += slice.map(_rendrePaire).join('');
    } else {
      html += `<p class="bi-empty">${q ? `Aucun site ne correspond à « ${filtre} »` : 'Aucune combinaison compatible.<br>💡 Essayez un autre horaire ou une autre date.'}</p>`;
    }

    html += `<p class="bi-note">📌 Les deux plongées sont en fenêtre d'étale · surface ≤ 3h · profil non inversé</p>`;

    container.innerHTML = html;

    // Redonner le focus au champ de recherche si un filtre est actif
    if (q) {
      const inp = container.querySelector('#bi-search-input');
      if (inp) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
    } else {
      container.scrollTop = 0;
    }
  }

  /**
   * Appelé depuis le champ de recherche (oninput).
   */
  function _filtrer(valeur) {
    const container = document.getElementById(_dernierContainer);
    if (!container || !_dernierResultats.length) return;
    _afficherResultats(_dernierResultats, container, valeur);
  }

  // ── Initialisation ────────────────────────────────────────────

  function init() {
    // Tout est piloté depuis Prevision.js via afficher()
  }

  return { init, calculerPaires, afficher, _ouvrirSite, _filtrer };

})();
