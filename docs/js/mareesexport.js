/**
 * mareesexport.js — Export des marées sur une période en CSV
 *
 * Génère un fichier CSV (séparateur ";", BOM UTF-8) listant, pour chaque
 * marée (PM/BM) de la période choisie : date, heure, type, coefficient,
 * hauteur, ainsi que les créneaux de blocage des bateaux du club
 * (CONFIG.PORT.bateaux), calculés via Port.getFenetresJour().
 *
 * Dépendances : Marees (données + normalisation _haut), Port (fenêtres bateaux)
 */

const MareesExport = (() => {

  // ── Helpers date locale (pas de toISOString — cf. bug de fuseau horaire déjà corrigé ailleurs) ──

  function _pad2(n) { return String(n).padStart(2, '0'); }

  function _dateLocal(d) {
    return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
  }

  function _buildDateLocal(dateStr) {
    const [Y, M, D] = dateStr.split('-').map(Number);
    return new Date(Y, M - 1, D);
  }

  function _minToHHMM(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${_pad2(h)}:${_pad2(m)}`;
  }

  // ── Plage de données disponible ─────────────────────────────

  function _plageDisponible() {
    const cles = Object.keys(Marees.getData()).sort();
    return { min: cles[0] || null, max: cles[cles.length - 1] || null };
  }

  // ── Formatage des fenêtres de blocage bateau ────────────────

  function _formaterBlocage(bloque) {
    if (!bloque || bloque.length === 0) return 'Libre';
    return bloque.map(pl => `${_minToHHMM(pl.debut)}–${_minToHHMM(pl.fin)}`).join(' / ');
  }

  // ── Événements de marée d'une journée, triés chronologiquement ──

  function _evenementsJour(entree) {
    const cles = [
      { cle: 'PM1', type: 'Pleine mer' },
      { cle: 'PM2', type: 'Pleine mer' },
      { cle: 'BM1', type: 'Basse mer' },
      { cle: 'BM2', type: 'Basse mer' },
    ];
    const lignes = [];
    for (const c of cles) {
      const heure = entree[c.cle + '_h'];
      if (!heure) continue;
      lignes.push({
        heure,
        type: c.type,
        coeff: entree[c.cle + '_coeff'] ?? '',
        hauteurM: entree[c.cle + '_haut'] ?? '',
      });
    }
    lignes.sort((a, b) => a.heure.localeCompare(b.heure));
    return lignes;
  }

  // ── Génération CSV ───────────────────────────────────────────

  function _csvChamp(val) {
    const s = String(val ?? '');
    if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function _genererCSV(dateDebut, dateFin) {
    const data    = Marees.getData();
    const bateaux = CONFIG.PORT.bateaux;

    const entetes = ['Date', 'Heure', 'Type', 'Coefficient', 'Hauteur_m_ZH', ...bateaux.map(b => `${b.nom}_bloque`)];
    const lignes  = [entetes];

    const fin = _buildDateLocal(dateFin);
    for (let d = _buildDateLocal(dateDebut); d <= fin; d.setDate(d.getDate() + 1)) {
      const cle    = _dateLocal(d);
      const entree = data[cle];
      if (!entree) continue;

      const fenetres    = Port.getFenetresJour(entree);
      const colsBateaux = bateaux.map(b => _formaterBlocage(fenetres[b.nom]?.bloque));

      for (const evt of _evenementsJour(entree)) {
        lignes.push([cle, evt.heure, evt.type, evt.coeff, evt.hauteurM, ...colsBateaux]);
      }
    }

    const corps = lignes.map(l => l.map(_csvChamp).join(';')).join('\r\n');
    return '\uFEFF' + corps; // BOM UTF-8 pour affichage correct des accents dans Excel
  }

  function _telecharger(nomFichier, contenu) {
    const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── UI ────────────────────────────────────────────────────────

  function _afficherErreur(msg) {
    const el = document.getElementById('export-marees-erreur');
    if (!el) return;
    if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
    else { el.textContent = ''; el.classList.add('hidden'); }
  }

  function open() {
    const modal = document.getElementById('modal-export-marees');
    if (!modal) return;
    _afficherErreur(null);

    const { min, max } = _plageDisponible();
    const inputDebut = document.getElementById('export-date-debut');
    const inputFin   = document.getElementById('export-date-fin');
    const info       = document.getElementById('export-marees-plage');

    if (min && max) {
      [inputDebut, inputFin].forEach(inp => { inp.min = min; inp.max = max; });
      const aujourdHui = _dateLocal(new Date());
      const debutParDefaut = aujourdHui < min ? min : (aujourdHui > max ? max : aujourdHui);
      inputDebut.value = debutParDefaut;
      inputFin.value   = max;
      if (info) info.textContent = `Données disponibles du ${min} au ${max}.`;
    }

    modal.classList.remove('hidden');
  }

  function close() {
    document.getElementById('modal-export-marees')?.classList.add('hidden');
  }

  function _onSubmit(e) {
    e.preventDefault();
    _afficherErreur(null);

    const dateDebut = document.getElementById('export-date-debut').value;
    const dateFin   = document.getElementById('export-date-fin').value;
    const { min, max } = _plageDisponible();

    if (!dateDebut || !dateFin) {
      _afficherErreur('Choisissez une date de début et une date de fin.');
      return;
    }
    if (dateFin < dateDebut) {
      _afficherErreur('La date de fin doit être postérieure ou égale à la date de début.');
      return;
    }
    if (min && max && (dateDebut < min || dateFin > max)) {
      _afficherErreur(`Période hors des données disponibles (${min} au ${max}).`);
      return;
    }

    const csv = _genererCSV(dateDebut, dateFin);
    _telecharger(`marees_SMPE_${dateDebut}_a_${dateFin}.csv`, csv);
    close();
  }

  function init() {
    document.getElementById('btn-export-marees')?.addEventListener('click', open);
    document.getElementById('btn-close-export-marees')?.addEventListener('click', close);

    const modal = document.getElementById('modal-export-marees');
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    document.getElementById('form-export-marees')?.addEventListener('submit', _onSubmit);
  }

  return { init, open, close };
})();
