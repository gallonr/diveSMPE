/**
 * retourexperience.js — Formulaire retour d'expérience post-plongée
 *
 * Envoie chaque soumission au Worker Cloudflare (route /retour-experience),
 * qui relaie vers Google Apps Script (jamais d'appel direct client → Apps
 * Script, cf. specs/2026-07-28-retour-experience-design.md). En cas d'échec
 * réseau, la soumission est mise en file d'attente locale (localStorage) et
 * réessayée au chargement de l'app et à l'évènement 'online'.
 */

const RetourExperience = (() => {

  const QUEUE_KEY = 'smpe_retour_queue';
  let _siteImposeID = null; // siteID pré-rempli si ouvert depuis la fiche site

  // ── File d'attente locale ────────────────────────────────────

  function _lireQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function _ecrireQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    _majBadge(queue.length);
  }

  function _majBadge(count) {
    const badge = document.getElementById('badge-retour-pending');
    if (!badge) return;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  async function _envoyer(data) {
    const url = CONFIG.RETOUR_EXPERIENCE.workerUrl;
    if (!url) return { ok: false, error: 'workerUrl non configurée' };
    try {
      const res = await fetch(`${url}/retour-experience`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({ ok: false, error: 'Réponse invalide' }));
      return json;
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  async function flushQueue() {
    let queue = _lireQueue();
    if (queue.length === 0) return;
    const restants = [];
    for (const data of queue) {
      const res = await _envoyer(data);
      if (!res.ok) restants.push(data);
    }
    _ecrireQueue(restants);
  }

  // ── Rendu des groupes de boutons ──────────────────────────────

  function _rendreBoutons(containerId, items, labelKey, valueKey) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items.map(it =>
      `<button type="button" class="re-btn" data-value="${it[valueKey]}">${it[labelKey]}</button>`
    ).join('');
    el.querySelectorAll('.re-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.re-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  function _valeurActive(containerId) {
    const el = document.getElementById(containerId);
    const btn = el?.querySelector('.re-btn.active');
    return btn ? btn.dataset.value : null;
  }

  function _rendreSelectSites() {
    const select = document.getElementById('re-site');
    if (!select) return;
    const geojson = Sites.getGeojson();
    const features = (geojson?.features || []).slice()
      .sort((a, b) => (a.properties.siteNom || a.properties.siteID)
        .localeCompare(b.properties.siteNom || b.properties.siteID));
    select.innerHTML = '<option value="">— Choisir un site —</option>' + features.map(f =>
      `<option value="${f.properties.siteID}">${f.properties.siteNom || f.properties.siteID}</option>`
    ).join('');
  }

  // ── Calculs automatiques ──────────────────────────────────────

  function _dateHeure(dateStr, heureStr) {
    if (!dateStr || !heureStr) return null;
    const d = new Date(`${dateStr}T${heureStr}:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  function _formatEtale(etale) {
    if (!etale) return '—';
    const hh = Math.floor(etale.deltaMin / 60);
    const mm = etale.deltaMin % 60;
    const duree = hh > 0 ? `${hh}h${String(mm).padStart(2, '0')}` : `${mm}min`;
    return `${etale.type} ${etale.heure} (${duree} ${etale.avantApres})`;
  }

  function _recalculer() {
    const dateStr = document.getElementById('re-date').value;
    const hMise = document.getElementById('re-heure-mise').value;
    const hSortie = document.getElementById('re-heure-sortie').value;
    const calculs = document.getElementById('re-calculs');

    const dMise = _dateHeure(dateStr, hMise);
    const dSortie = _dateHeure(dateStr, hSortie);
    if (!dMise && !dSortie) {
      calculs.classList.add('hidden');
      return;
    }

    const lignes = [];
    if (dMise) {
      const h = Marees.getHauteurAt(dMise);
      const etale = Marees.getEtaleProche(dMise);
      lignes.push(`Mise à l'eau — hauteur : ${h !== null ? h.toFixed(2) + ' m' : '—'} · étale : ${_formatEtale(etale)}`);
    }
    if (dSortie) {
      const h = Marees.getHauteurAt(dSortie);
      const etale = Marees.getEtaleProche(dSortie);
      lignes.push(`Sortie d'eau — hauteur : ${h !== null ? h.toFixed(2) + ' m' : '—'} · étale : ${_formatEtale(etale)}`);
    }
    const entreeJour = dMise ? Marees.getEntreePourDate(dMise) : (dSortie ? Marees.getEntreePourDate(dSortie) : null);
    const coeff = entreeJour ? (entreeJour.PM1_coeff || entreeJour.PM2_coeff) : null;
    if (coeff) lignes.push(`Coefficient du jour : ${coeff}`);

    calculs.innerHTML = lignes.join('<br>');
    calculs.classList.remove('hidden');
  }

  // ── Validation + soumission ───────────────────────────────────

  function _erreur(msg) {
    const el = document.getElementById('re-erreur');
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  function _construireDonnees() {
    const siteID = document.getElementById('re-site').value;
    const dateStr = document.getElementById('re-date').value;
    const hMise = document.getElementById('re-heure-mise').value;
    const hSortie = document.getElementById('re-heure-sortie').value;
    const bateau = _valeurActive('re-bateau-group');
    const etatMerDegre = _valeurActive('re-etatmer-group');
    const ventCode = _valeurActive('re-vent-group');
    const courantCode = _valeurActive('re-courant-group');

    if (!siteID) return { erreur: 'Choisissez un site.' };
    if (!dateStr) return { erreur: 'Choisissez une date.' };
    if (new Date(dateStr) > new Date(new Date().toDateString())) return { erreur: 'La date ne peut pas être dans le futur.' };
    if (!hMise || !hSortie) return { erreur: "Renseignez l'heure de mise à l'eau et de sortie." };
    if (hSortie <= hMise) return { erreur: "L'heure de sortie doit être postérieure à l'heure de mise à l'eau." };
    if (!bateau) return { erreur: 'Choisissez le bateau.' };
    if (etatMerDegre === null) return { erreur: "Choisissez l'état de la mer." };
    if (!ventCode) return { erreur: 'Choisissez le vent.' };
    if (!courantCode) return { erreur: 'Choisissez le courant ressenti.' };

    const site = Sites.getSiteById(siteID);
    const dMise = _dateHeure(dateStr, hMise);
    const dSortie = _dateHeure(dateStr, hSortie);
    const etatMer = CONFIG.RETOUR_EXPERIENCE.etatMer.find(e => String(e.degre) === etatMerDegre);
    const vent = CONFIG.RETOUR_EXPERIENCE.vent.find(v => v.code === ventCode);
    const etaleMise = Marees.getEtaleProche(dMise);
    const etaleSortie = Marees.getEtaleProche(dSortie);
    const entreeJour = Marees.getEntreePourDate(dMise);

    return {
      data: {
        timestampSoumission: new Date().toISOString(),
        datePlongee: dateStr,
        siteID,
        siteNom: site?.properties?.siteNom || siteID,
        bateau,
        rempliPar: document.getElementById('re-rempli-par').value.trim(),
        heureMiseEau: hMise,
        heureSortieEau: hSortie,
        dureePlongeeMin: Math.round((dSortie - dMise) / 60000),
        etatMerDegre: Number(etatMerDegre),
        etatMerLabel: etatMer?.label || '',
        ventBeaufort: ventCode,
        ventLabel: vent?.label || '',
        courantClasse: courantCode,
        hauteurEauMiseEau_m: Marees.getHauteurAt(dMise),
        hauteurEauSortieEau_m: Marees.getHauteurAt(dSortie),
        coefficientJour: entreeJour ? (entreeJour.PM1_coeff || entreeJour.PM2_coeff || null) : null,
        etaleMiseEauType: etaleMise?.type || null,
        etaleMiseEauDeltaMin: etaleMise?.deltaMin ?? null,
        etaleSortieEauType: etaleSortie?.type || null,
        etaleSortieEauDeltaMin: etaleSortie?.deltaMin ?? null,
        commentaire: document.getElementById('re-commentaire').value.trim(),
      },
    };
  }

  async function _soumettre(e) {
    e.preventDefault();
    _erreur('');

    const { erreur, data } = _construireDonnees();
    if (erreur) { _erreur(erreur); return; }

    const btn = document.getElementById('btn-re-submit');
    btn.disabled = true;
    btn.textContent = 'Envoi…';

    const res = await _envoyer(data);
    if (res.ok) {
      _fermer();
    } else {
      const queue = _lireQueue();
      queue.push(data);
      _ecrireQueue(queue);
      _erreur('Envoi impossible (réseau) — mis en file d\'attente, réessai automatique.');
      setTimeout(_fermer, 1500);
    }

    btn.disabled = false;
    btn.textContent = 'Envoyer';
  }

  // ── Ouverture / fermeture modale ──────────────────────────────

  function _reinitialiserForm() {
    document.getElementById('form-retour-experience').reset();
    document.querySelectorAll('#modal-retour-experience .re-btn.active').forEach(b => b.classList.remove('active'));
    document.getElementById('re-calculs').classList.add('hidden');
    _erreur('');
    document.getElementById('re-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('re-date').max = new Date().toISOString().slice(0, 10);
  }

  function ouvrir(siteID = null) {
    _reinitialiserForm();
    _rendreSelectSites();
    if (siteID) {
      document.getElementById('re-site').value = siteID;
    }
    document.getElementById('modal-retour-experience').classList.remove('hidden');
  }

  function _fermer() {
    document.getElementById('modal-retour-experience').classList.add('hidden');
  }

  // ── Init ───────────────────────────────────────────────────────

  function init() {
    _rendreBoutons('re-bateau-group', CONFIG.RETOUR_EXPERIENCE.bateaux.map(nom => ({ nom, value: nom })), 'nom', 'value');
    _rendreBoutons('re-etatmer-group', CONFIG.RETOUR_EXPERIENCE.etatMer.map(e => ({ ...e, label: `${e.degre} ${e.label}` })), 'label', 'degre');
    _rendreBoutons('re-vent-group', CONFIG.RETOUR_EXPERIENCE.vent, 'label', 'code');
    _rendreBoutons('re-courant-group', CONFIG.RETOUR_EXPERIENCE.courant, 'label', 'code');

    document.getElementById('re-date')?.addEventListener('change', _recalculer);
    document.getElementById('re-heure-mise')?.addEventListener('change', _recalculer);
    document.getElementById('re-heure-sortie')?.addEventListener('change', _recalculer);

    document.getElementById('form-retour-experience')?.addEventListener('submit', _soumettre);
    document.getElementById('btn-close-retour')?.addEventListener('click', _fermer);
    document.getElementById('modal-retour-experience')?.addEventListener('click', e => {
      if (e.target.id === 'modal-retour-experience') _fermer();
    });

    document.getElementById('btn-menu-retour')?.addEventListener('click', () => ouvrir(null));
    document.getElementById('btn-fiche-retour')?.addEventListener('click', () => {
      const site = Sites.getSiteActif();
      ouvrir(site?.properties?.siteID || null);
    });

    _majBadge(_lireQueue().length);
    window.addEventListener('online', flushQueue);
    flushQueue();
  }

  return { init, ouvrir, flushQueue };
})();
