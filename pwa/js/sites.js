/**
 * sites.js — Chargement GeoJSON et gestion des fiches sites (Phase 6, 7)
 * Affichage liste, filtres, recherche, fiche détaillée
 */

const Sites = (() => {

  let _geojson = null;           // GeoJSON brut
  let _sites = [];               // tableau des features
  let _siteActif = null;         // feature courante
  let _onSiteSelectionne = null; // callback externe
  let _etatsMaree = new Map();   // siteID → etat (calculé par MaréeSite)
  let _intervalMaree = null;     // timer rafraîchissement

  // ── État transect libre ──────────────────────────────────────
  let _transectMode = false;     // true = mode sélection actif
  let _transectPts  = [];        // [{x,y} Lambert-93] 0, 1 ou 2 points

  // ── Chargement ───────────────────────────────────────────────

  async function init(onSiteSelectionne) {
    _onSiteSelectionne = onSiteSelectionne;
    try {
      const res = await fetch(CONFIG.DATA.sites);
      _geojson = await res.json();
      _sites = _geojson.features;
      console.log(`✅ ${_sites.length} sites chargés`);
      _majEtatsMaree();
      _afficherListe(_sites);
      // Rafraîchir les états marée chaque minute
      _intervalMaree = setInterval(() => {
        _majEtatsMaree();
        _afficherListe(_sites);
        // Mettre à jour le bloc marée dans la fiche si ouverte
        if (_siteActif) _majBlocMareeF(_siteActif.properties);
      }, 60_000);
    } catch (e) {
      console.error('❌ Impossible de charger sites.geojson', e);
      document.getElementById('liste-sites').innerHTML =
        '<li style="padding:16px;color:#e74c3c;">Erreur de chargement des sites.</li>';
    }
    return _geojson;
  }

  function _majEtatsMaree() {
    if (typeof MaréeSite === 'undefined') return;
    const entree = (typeof Marees !== 'undefined' && Marees.getAujourd)
      ? Marees.getAujourd() : null;
    _etatsMaree = MaréeSite.calculerTous(_geojson, entree);
    // Mettre à jour les indicateurs sur les marqueurs de la carte
    if (typeof Carte !== 'undefined') Carte.majEtatsMaree(_etatsMaree);
  }

  // ── Liste des sites ──────────────────────────────────────────

  function _getTypeInfo(typeSite) {
    if (!typeSite) return CONFIG.TYPE_SITE.default;
    return CONFIG.TYPE_SITE[typeSite.toLowerCase()] || CONFIG.TYPE_SITE.default;
  }

  function _afficherListe(sites) {
    const ul = document.getElementById('liste-sites');
    if (!ul) return;
    if (sites.length === 0) {
      ul.innerHTML = '<li style="padding:16px;color:#adb5bd;text-align:center;">Aucun site trouvé</li>';
      return;
    }
    ul.innerHTML = sites.map(f => {
      const p = f.properties;
      const info = _getTypeInfo(p.typeSite);
      const metaExtra = p.niveauPlongee ? ` · ${p.niveauPlongee}` : '';
      const etat = _etatsMaree.get(p.siteID);
      const badgeMaree = etat && etat.statut !== 'gris'
        ? `<span class="maree-badge-liste maree-badge-${etat.statut}">${etat.label}</span>`
        : '';
      return `
        <li class="site-item" data-id="${p.siteID}" onclick="Sites.selectionner('${p.siteID}')">
          <div class="site-nom">${info.emoji} ${p.siteNom || p.siteID}</div>
          <div class="site-meta">
            <span class="badge-type ${info.classe}">${p.typeSite || '?'}</span>
            <span>${p.typePlongee || ''}${metaExtra}</span>
            ${badgeMaree}
          </div>
        </li>
      `;
    }).join('');
  }

  // ── Filtres et recherche ─────────────────────────────────────

  function filtrer(terme, typeFilter, profFilter) {
    let resultats = _sites;
    if (typeFilter && typeFilter !== 'all') {
      resultats = resultats.filter(f => {
        const t = (f.properties.typeSite || '').toLowerCase();
        return t.includes(typeFilter);
      });
    }
    if (profFilter && profFilter !== 'all') {
      const hMaree = (typeof Marees !== 'undefined' && Marees.getHauteurActuelle)
        ? Marees.getHauteurActuelle() : null;
      resultats = resultats.filter(f => {
        const p = f.properties;
        if (p.profMax === null || p.profMax === undefined) return false; // pas de donnée → exclu
        const depMax = hMaree !== null ? p.profMax + hMaree : p.profMax;
        if (profFilter === '6')   return depMax <= 6;
        if (profFilter === '10')  return depMax <= 10;
        if (profFilter === '20')  return depMax <= 20;
        if (profFilter === '20+') return depMax >  20;
        return true;
      });
    }
    if (terme) {
      const q = terme.toLowerCase();
      resultats = resultats.filter(f => {
        const p = f.properties;
        return (p.siteNom || '').toLowerCase().includes(q) ||
               (p.siteID || '').toLowerCase().includes(q) ||
               (p.typePlongee || '').toLowerCase().includes(q);
      });
    }
    _afficherListe(resultats);
  }

  // ── Sélection d'un site ───────────────────────────────────────

  function selectionner(siteID) {
    _siteActif = _sites.find(f => f.properties.siteID === siteID) || null;
    if (!_siteActif) return;

    // Surligner dans la liste
    document.querySelectorAll('.site-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === siteID);
    });

    // Ouvrir la fiche
    _ouvrirFiche(_siteActif);

    // Callback → carte + navigation
    if (_onSiteSelectionne) _onSiteSelectionne(_siteActif);
  }

  // ── Fiche site ───────────────────────────────────────────────

  const _horaires = new Map(); // siteID → { debut, fin }

  function _val(v) { return (v !== null && v !== undefined && v !== '') ? v : '—'; }

  function _ouvrirFiche(feature) {
    const p = feature.properties;
    const fiche = document.getElementById('fiche-site');
    if (!fiche) return;

    const info = _getTypeInfo(p.typeSite);

    // En-tête
    document.getElementById('fiche-badge-type').textContent = p.typeSite || '—';
    document.getElementById('fiche-badge-type').className = `badge-type ${info.classe}`;
    document.getElementById('fiche-nom').textContent = p.siteNom || p.siteID;
    document.getElementById('fiche-id').textContent = p.siteID;

    // Onglet Infos
    document.getElementById('f-typePlongee').textContent   = _val(p.typePlongee);
    document.getElementById('f-niveauPlongee').textContent = _val(p.niveauPlongee);
    document.getElementById('f-accessibilite').textContent = _val(p.accessibilite);
    document.getElementById('f-mouillage').textContent     = _val(p.mouillage);
    document.getElementById('f-commentaire').textContent   = _val(p.commentaire);

    // Horaires de plongée — pré-remplir depuis la fenêtre de plongée calculée
    let fenetrePlongee = null;
    if (typeof MaréeSite !== 'undefined') {
      const entree = (typeof Marees !== 'undefined' && Marees.getAujourd) ? Marees.getAujourd() : null;
      const etat = MaréeSite.calculerEtat(p, entree);
      if (etat.prochaineFenetre) fenetrePlongee = etat.prochaineFenetre;
    }
    _initHoraires(p.siteID, fenetrePlongee);

    // Onglet Conditions
    document.getElementById('f-accesVent').textContent = _val(p.accesVent);
    document.getElementById('f-houle').textContent     = _val(p.houle);

    // Bloc marée interprété
    _majBlocMareeF(p);

    // Profondeurs dynamiques (LiDAR + marée)
    _afficherProfondeurs(p);

    // Onglet Bathymétrie : miniature + profil transect
    _afficherBathy(p);

    // Activer l'onglet Infos par défaut
    _activerOnglet('infos');

    fiche.classList.remove('hidden');
  }

  function _initHoraires(siteID, fenetre) {
    const elDebut = document.getElementById('f-heure-debut');
    const elFin   = document.getElementById('f-heure-fin');
    const elDuree = document.getElementById('f-duree-plongee');
    const elRow   = document.getElementById('f-duree-plongee-row');
    if (!elDebut || !elFin) return;

    // Convertir debutMin/finMin (minutes depuis minuit) en "HH:MM"
    function minToHHMM(min) {
      if (min == null) return '';
      const total = Math.round(((min % 1440) + 1440) % 1440);
      return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
    }

    // Valeurs par défaut depuis la fenêtre de plongée calculée
    const debutFenetre = fenetre ? minToHHMM(fenetre.debutMin) : '';
    const finFenetre   = fenetre ? minToHHMM(fenetre.finMin)   : '';

    // Si une valeur a été sauvegardée manuellement, on la garde ; sinon on prend la fenêtre
    const saved = _horaires.get(siteID);
    const debut = (saved && saved.source === 'manuel') ? saved.debut : debutFenetre;
    const fin   = (saved && saved.source === 'manuel') ? saved.fin   : finFenetre;

    // Supprimer les anciens listeners (clone)
    const newDebut = elDebut.cloneNode(true);
    const newFin   = elFin.cloneNode(true);
    elDebut.parentNode.replaceChild(newDebut, elDebut);
    elFin.parentNode.replaceChild(newFin, elFin);
    newDebut.value = debut;
    newFin.value   = fin;
    _majDuree(debut, fin, elDuree, elRow);

    const onChange = () => {
      const d = newDebut.value;
      const f = newFin.value;
      _horaires.set(siteID, { debut: d, fin: f, source: 'manuel' });
      _majDuree(d, f, elDuree, elRow);
    };
    newDebut.addEventListener('change', onChange);
    newFin.addEventListener('change', onChange);
  }

  function _majDuree(debut, fin, elDuree, elRow) {
    if (!debut || !fin || !elDuree || !elRow) { if (elRow) elRow.style.display = 'none'; return; }
    const [hD, mD] = debut.split(':').map(Number);
    const [hF, mF] = fin.split(':').map(Number);
    let totalMin = (hF * 60 + mF) - (hD * 60 + mD);
    if (totalMin <= 0) { elRow.style.display = 'none'; return; }
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    elDuree.textContent = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    elRow.style.display = '';
  }

  function _majBlocMareeF(props) {
    const el = document.getElementById('f-maree-bloc');
    if (!el) return;
    if (typeof MaréeSite === 'undefined') {
      el.innerHTML = `<div class="info-row"><span class="info-label">Marée / Étale</span><span class="info-val">${_val(props.maree)}</span></div>
                      <div class="info-row"><span class="info-label">Tps d'étale</span><span class="info-val">${_val(props.tpsEtale)}</span></div>`;
      return;
    }
    const entree = (typeof Marees !== 'undefined' && Marees.getAujourd) ? Marees.getAujourd() : null;
    el.innerHTML = MaréeSite.rendreBloc(props, entree);
  }

  function _afficherProfondeurs(props) {
    const blocDispo   = document.getElementById('f-profondeur-bloc');
    const blocManquant = document.getElementById('f-profondeur-lidar-manquant');

    const profMin = props.profMin; // cote sous ZHMM (valeur positive = profondeur)
    const profMax = props.profMax;

    if (profMin === null || profMax === null ||
        profMin === undefined || profMax === undefined) {
      // Données LiDAR pas encore disponibles
      if (blocDispo)    blocDispo.classList.add('hidden');
      if (blocManquant) blocManquant.classList.remove('hidden');
      return;
    }

    if (blocManquant) blocManquant.classList.add('hidden');
    if (blocDispo)    blocDispo.classList.remove('hidden');

    // Hauteur de marée actuelle (m au-dessus du ZHMM)
    const hMaree = (typeof Marees !== 'undefined' && Marees.getHauteurActuelle)
      ? Marees.getHauteurActuelle()
      : null;

    const elMareeVal = document.getElementById('f-prof-maree-val');
    const elMin      = document.getElementById('f-prof-min');
    const elMax      = document.getElementById('f-prof-max');

    if (hMaree === null) {
      if (elMareeVal) elMareeVal.textContent = '— m';
      if (elMin)      elMin.textContent = '— m';
      if (elMax)      elMax.textContent = '— m';
      return;
    }

    if (elMareeVal) elMareeVal.textContent = `${hMaree.toFixed(2)} m`;

    // profondeur visible = cote chart datum + hauteur marée
    // profMin = zone la moins profonde du site (sommet / fond), profMax = point le plus bas
    const depMin = (profMin + hMaree);
    const depMax = (profMax + hMaree);

    if (elMin) elMin.textContent = depMin > 0 ? `${depMin.toFixed(1)} m` : 'Émergé';
    if (elMax) elMax.textContent = depMax > 0 ? `${depMax.toFixed(1)} m` : 'Émergé';
  }

  function _afficherBathy(props) {
    const sid = props.siteID;

    // Réinitialiser le mode transect à chaque ouverture de fiche
    _transectMode = false;
    _transectPts  = [];
    _resetTransectUI();

    // ── Miniature MNT ──────────────────────────────────────
    const img       = document.getElementById('bathy-thumb');
    const imgAbsent = document.getElementById('bathy-thumb-absent');
    if (img) {
      const thumbUrl = `data/thumbs/${sid}_thumb.png`;
      img.src = thumbUrl;
      img.alt = `Bathymétrie ${sid}`;
      img.onload  = () => {
        img.classList.remove('hidden');
        if (imgAbsent) imgAbsent.classList.add('hidden');
        _redimensionnerCanvasSel(img);
      };
      img.onerror = () => {
        img.classList.add('hidden');
        if (imgAbsent) imgAbsent.classList.remove('hidden');
      };
    }

    // ── Profil transect ────────────────────────────────────
    const canvas = document.getElementById('canvas-bathy');
    const hMaree = (typeof Marees !== 'undefined' && Marees.getHauteurActuelle)
      ? Marees.getHauteurActuelle() : null;

    if (typeof Bathy !== 'undefined') {
      Bathy.dessiner(canvas, sid, hMaree);
    }

    // ── Badge profondeurs marée ────────────────────────────
    const blocProf = document.getElementById('bathy-prof-maree');
    const elMin    = document.getElementById('bathy-prof-min');
    const elMax    = document.getElementById('bathy-prof-max');
    const entry    = (typeof Bathy !== 'undefined') ? Bathy.get(sid) : null;

    if (entry && hMaree !== null && blocProf) {
      const depMin = (entry.profMin + hMaree);
      const depMax = (entry.profMax + hMaree);
      if (elMin) elMin.textContent = depMin > 0 ? `${depMin.toFixed(1)} m` : 'Émergé';
      if (elMax) elMax.textContent = depMax > 0 ? `${depMax.toFixed(1)} m` : 'Émergé';
      blocProf.classList.remove('hidden');
    } else if (blocProf) {
      blocProf.classList.add('hidden');
    }

    // ── Slider opacité overlay carte ───────────────────────
    const slider = document.getElementById('slider-overlay-opacity');
    const sliderVal = document.getElementById('overlay-opacity-val');
    if (slider) {
      slider.oninput = () => {
        const v = parseFloat(slider.value);
        if (sliderVal) sliderVal.textContent = `${Math.round(v * 100)}%`;
        if (typeof Carte !== 'undefined') Carte.setOverlayOpacity(v);
      };
      // Synchroniser avec la valeur actuelle
      const cur = (typeof Carte !== 'undefined') ? Carte.getOverlayOpacity() : 0.65;
      slider.value = cur;
      if (sliderVal) sliderVal.textContent = `${Math.round(cur * 100)}%`;
    }

    // ── Bouton transect libre ──────────────────────────────
    const btnLibre = document.getElementById('btn-transect-libre');
    const btnReset = document.getElementById('btn-transect-reset');

    if (btnLibre) {
      btnLibre.onclick = () => {
        _transectMode = !_transectMode;
        _transectPts  = [];
        if (_transectMode) {
          btnLibre.textContent = '✕ Annuler';
          btnLibre.classList.add('active');
          document.getElementById('transect-aide')?.classList.remove('hidden');
          const stepEl = document.getElementById('transect-step');
          if (stepEl) stepEl.textContent = 'A';
          const sel = document.getElementById('canvas-transect-sel');
          sel?.classList.remove('hidden');
          _effacerCanvasSel();
        } else {
          _resetTransectUI();
          // Redessiner le profil par défaut
          if (typeof Bathy !== 'undefined') Bathy.dessiner(canvas, sid, hMaree);
          const titre = document.getElementById('bathy-profil-titre');
          if (titre) titre.textContent = 'Profil bathymétrique — transect E→O';
        }
      };
    }

    if (btnReset) {
      btnReset.onclick = () => {
        _transectMode = false;
        _transectPts  = [];
        _resetTransectUI();
        if (typeof Bathy !== 'undefined') Bathy.dessiner(canvas, sid, hMaree);
        const titre = document.getElementById('bathy-profil-titre');
        if (titre) titre.textContent = 'Profil bathymétrique — transect E→O';
      };
    }

    // ── Clic sur la miniature = sélection point transect ──
    const container = document.getElementById('bathy-thumb-container');
    // Retirer l'ancien listener (remplacement propre)
    const oldFn = container?._transectClickFn;
    if (container && oldFn) container.removeEventListener('click', oldFn);

    const clickFn = (e) => {
      if (!_transectMode) return;
      const img2  = document.getElementById('bathy-thumb');
      const entry2 = (typeof Bathy !== 'undefined') ? Bathy.get(sid) : null;
      if (!img2 || !entry2 || !entry2.grid) return;

      // Convertir clic → coordonnées Lambert-93
      const rect = img2.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;   // 0=gauche 1=droite
      const py = (e.clientY - rect.top)  / rect.height;  // 0=haut   1=bas

      const g = entry2.grid;
      const xL = g.xmin + px * (g.ncol * g.res);
      const yL = (g.ymin + g.nrow * g.res) - py * (g.nrow * g.res);  // inverser Y

      _transectPts.push({ x: xL, y: yL });
      _dessinerPointSel(_transectPts.length, px, py);

      if (_transectPts.length === 1) {
        const stepEl = document.getElementById('transect-step');
        if (stepEl) stepEl.textContent = 'B';
      }

      if (_transectPts.length >= 2) {
        // Tracer le profil
        _transectMode = false;
        document.getElementById('btn-transect-libre').textContent = '✏️ Tracer un transect';
        document.getElementById('btn-transect-libre').classList.remove('active');
        document.getElementById('transect-aide')?.classList.add('hidden');
        document.getElementById('btn-transect-reset')?.classList.remove('hidden');

        if (typeof Bathy !== 'undefined') {
          const hM = (typeof Marees !== 'undefined' && Marees.getHauteurActuelle)
            ? Marees.getHauteurActuelle() : null;
          Bathy.dessinerTransectLibre(canvas, sid,
            _transectPts[0], _transectPts[1], hM);
        }
        const dist = Math.round(Math.hypot(
          _transectPts[1].x - _transectPts[0].x,
          _transectPts[1].y - _transectPts[0].y));
        const titre = document.getElementById('bathy-profil-titre');
        if (titre) titre.textContent = `Profil bathymétrique — transect libre (${dist} m)`;
      }
    };

    if (container) {
      container._transectClickFn = clickFn;
      container.addEventListener('click', clickFn);
    }
  }

  // ── Helpers transect ──────────────────────────────────────

  function _resetTransectUI() {
    const btn = document.getElementById('btn-transect-libre');
    if (btn) { btn.textContent = '✏️ Tracer un transect'; btn.classList.remove('active'); }
    document.getElementById('btn-transect-reset')?.classList.add('hidden');
    document.getElementById('transect-aide')?.classList.add('hidden');
    const sel = document.getElementById('canvas-transect-sel');
    sel?.classList.add('hidden');
    _effacerCanvasSel();
  }

  function _redimensionnerCanvasSel(img) {
    const sel = document.getElementById('canvas-transect-sel');
    if (!sel || !img) return;
    sel.style.width  = img.offsetWidth  + 'px';
    sel.style.height = img.offsetHeight + 'px';
    sel.width  = img.offsetWidth;
    sel.height = img.offsetHeight;
  }

  function _effacerCanvasSel() {
    const sel = document.getElementById('canvas-transect-sel');
    if (!sel) return;
    const ctx = sel.getContext('2d');
    ctx.clearRect(0, 0, sel.width, sel.height);
  }

  function _dessinerPointSel(nPoint, px, py) {
    const sel = document.getElementById('canvas-transect-sel');
    if (!sel) return;
    const ctx = sel.getContext('2d');
    const x = Math.round(px * sel.width);
    const y = Math.round(py * sel.height);

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = nPoint === 1 ? '#ff6b35' : '#2ecc71';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(nPoint === 1 ? 'A' : 'B', x, y - 10);
    ctx.textAlign = 'left';

    // Tracer la ligne A→B si 2 points
    if (nPoint === 2 && _transectPts.length >= 2) {
      const img = document.getElementById('bathy-thumb');
      const rect = img?.getBoundingClientRect();
      // On stocke les coordonnées canvas du point A
      const entry = (typeof Bathy !== 'undefined') ? Bathy.get(
        (document.getElementById('fiche-id') || {}).textContent || ''
      ) : null;
      if (!entry || !entry.grid) return;
      const g = entry.grid;
      const pxA = (_transectPts[0].x - g.xmin) / (g.ncol * g.res);
      const pyA = 1 - (_transectPts[0].y - g.ymin) / (g.nrow * g.res);
      const xA = Math.round(pxA * sel.width);
      const yA = Math.round(pyA * sel.height);

      ctx.beginPath();
      ctx.moveTo(xA, yA);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(255,255,100,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function fermerFiche() {
    const fiche = document.getElementById('fiche-site');
    if (fiche) fiche.classList.add('hidden');
    _siteActif = null;
    document.querySelectorAll('.site-item').forEach(el => el.classList.remove('active'));
    Navigation.arreter();
  }

  function _activerOnglet(nom) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === nom);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('hidden', c.id !== `tab-${nom}`);
      c.classList.toggle('active', c.id === `tab-${nom}`);
    });
  }

  // ── Getters ──────────────────────────────────────────────────

  function getGeojson()   { return _geojson; }
  function getSiteActif() { return _siteActif; }

  function getSiteById(id) {
    return _sites.find(f => f.properties.siteID === id) || null;
  }

  // ── Écouteurs onglets ────────────────────────────────────────

  function initOnglets() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => _activerOnglet(btn.dataset.tab));
    });
  }

  return {
    init,
    filtrer,
    selectionner,
    fermerFiche,
    getGeojson,
    getSiteActif,
    getSiteById,
    initOnglets,
  };
})();
