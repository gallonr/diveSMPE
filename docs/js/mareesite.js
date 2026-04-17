/**
 * mareesite.js — Aide au choix de site : interprétation des codes marée
 *
 * Convention des codes (ex. "PMME_R15'/BMVE_A2h30") :
 *   [PM|BM] = Pleine Mer / Basse Mer
 *   [ME|VE] = Morte-Eau (coeff ≤ 70) / Vive-Eau (coeff > 70)
 *   _
 *   [R|A|H] = Retard (après l'étale) / Avance (avant l'étale) / à l'Heure
 *   [durée] = en minutes (15, 30...) ou heures (1h, 2h30...)
 *
 *  tpsEtale = durée totale de la fenêtre de plongée (centré autour de l'étale
 *             si H, sinon à partir du moment R|A)
 *
 * Résultat d'état :
 *   { statut: 'vert'|'orange'|'rouge'|'gris', label, detail, prochaine }
 *   - vert   : dans la fenêtre de plongée maintenant
 *   - orange : fenêtre dans < 2h
 *   - rouge  : fenêtre passée ou trop loin
 *   - gris   : pas assez de données (pas de code ou pas de marées)
 */

const MaréeSite = (() => {

  // ── Parseurs ─────────────────────────────────────────────────

  /** "1h30" | "2h15" | "45'" | "15'-20'" → minutes (valeur centrale si plage) */
  function _parseDureeMin(s) {
    if (!s || s === 'H') return 0;
    // Plage "15'-20'" → moyenne
    const plage = s.match(/^(\d+)['']?-(\d+)['']$/);
    if (plage) return (parseInt(plage[1]) + parseInt(plage[2])) / 2;
    // "2h30"
    const hm = s.match(/^(\d+)h(\d+)?$/);
    if (hm) return parseInt(hm[1]) * 60 + (hm[2] ? parseInt(hm[2]) : 0);
    // "45'" ou "45"
    const m = s.match(/^(\d+)['']?$/);
    if (m) return parseInt(m[1]);
    return 0;
  }

  /**
   * Parse un code marée unique ex. "PMME_R15'" → objet
   * {
   *   type: 'PM'|'BM',
   *   eau:  'ME'|'VE',
   *   dir:  'R'|'A'|'H',
   *   decalMin: number   (minutes de décalage par rapport à l'étale)
   * }
   * Retourne null si non parsable.
   */
  function _parseCode(code) {
    if (!code) return null;
    code = code.trim();
    // Normaliser le tiret du code PMV E-R... (quelques entrées ont PMV E-R)
    const m = code.match(/^(PM|BM)(ME|VE)[_-](R|A|H)(.*)$/i);
    if (!m) return null;
    const dir = m[3].toUpperCase();
    const decalMin = _parseDureeMin(m[4]);
    return {
      type:     m[1].toUpperCase(),   // 'PM' | 'BM'
      eau:      m[2].toUpperCase(),   // 'ME' | 'VE'
      dir,                            // 'R' | 'A' | 'H'
      decalMin,
    };
  }

  /**
   * Parse la durée tpsEtale "2h15" | "1h-1h30" | "45'" → minutes (centrale)
   */
  function _parseTpsEtale(s) {
    if (!s) return 60; // défaut 1h si manquant
    // Plage "1h-1h30"
    const plageH = s.match(/^(\d+h?\d*['']?)-(\d+h?\d*['']?)$/);
    if (plageH) {
      return (_parseDureeMin(plageH[1]) + _parseDureeMin(plageH[2])) / 2;
    }
    return _parseDureeMin(s);
  }

  // ── Calcul de l'étale de référence ───────────────────────────

  /**
   * Coefficient du jour : seuil ME/VE = 70
   * Retourne 'ME' | 'VE' | null
   */
  function _typeEau(entreeMaree) {
    if (!entreeMaree) return null;
    const coeff = entreeMaree.PM1_coeff ?? entreeMaree.PM2_coeff;
    if (coeff == null) return null;
    return coeff <= 70 ? 'ME' : 'VE';
  }

  /**
   * Retourne toutes les étales (PM/BM) du jour en minutes depuis minuit,
   * avec leur type et hauteur.
   * [ { typeEtale:'PM'|'BM', tMin:number, haut:number }, ... ]
   */
  function _etalesJour(entreeMaree) {
    if (!entreeMaree) return [];
    const paires = [
      { key: 'PM1', typeEtale: 'PM' },
      { key: 'BM1', typeEtale: 'BM' },
      { key: 'PM2', typeEtale: 'PM' },
      { key: 'BM2', typeEtale: 'BM' },
    ];
    const res = [];
    for (const { key, typeEtale } of paires) {
      const h = entreeMaree[key + '_h'];
      const haut = entreeMaree[key + '_haut'];
      if (!h) continue;
      const [hh, mm] = h.split(':').map(Number);
      res.push({ typeEtale, tMin: hh * 60 + mm, haut });
    }
    return res.sort((a, b) => a.tMin - b.tMin);
  }

  // ── Calcul de l'état du site ──────────────────────────────────

  /**
   * Pour un site donné, calcule l'état de plongeabilité maintenant.
   *
   * @param {object} props         - feature.properties du site (maree, tpsEtale)
   * @param {object} entreeMaree   - entrée marees.json du jour
   * @param {Date}   [now]         - date/heure de référence (défaut : maintenant)
   *
   * @returns {object} {
   *   statut: 'vert'|'orange'|'rouge'|'gris',
   *   label: string,            // texte court pour le badge
   *   detail: string,           // phrase complète pour la fiche
   *   prochaineFenetre: null | { debut: Date, fin: Date, etaleLabel: string }
   * }
   */
  function calculerEtat(props, entreeMaree, now = new Date()) {
    const codeRaw  = props.maree;
    const tpsRaw   = props.tpsEtale;

    if (!codeRaw) {
      return { statut: 'gris', label: '—', detail: 'Aucune contrainte de marée renseignée.', prochaineFenetre: null };
    }
    if (!entreeMaree) {
      return { statut: 'gris', label: '?', detail: 'Données de marée non disponibles.', prochaineFenetre: null };
    }

    const typeEauJour = _typeEau(entreeMaree); // 'ME' | 'VE' | null
    const etalesJour  = _etalesJour(entreeMaree);

    if (etalesJour.length === 0) {
      return { statut: 'gris', label: '?', detail: 'Horaires de marée manquants pour aujourd\'hui.', prochaineFenetre: null };
    }

    // Parser tous les codes (séparés par '/')
    const codes = codeRaw.split('/').map(c => _parseCode(c)).filter(Boolean);
    if (codes.length === 0) {
      return { statut: 'gris', label: '?', detail: `Code marée non reconnu : ${codeRaw}`, prochaineFenetre: null };
    }

    const fenetreMin = _parseTpsEtale(tpsRaw); // durée en minutes

    // Heure actuelle en minutes depuis minuit
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // Pour chaque code, chercher si une étale compatible existe aujourd'hui
    // et calculer la fenêtre [debutMin, finMin]
    const fenetres = [];

    for (const code of codes) {
      // Filtrer les étales compatibles avec le type PM/BM et ME/VE
      const etalesCompatibles = etalesJour.filter(e => {
        if (e.typeEtale !== code.type) return false;
        // Si on connaît le type d'eau du jour, vérifier la compatibilité
        if (typeEauJour && code.eau !== typeEauJour) return false;
        // Si on ne connaît pas le type d'eau (pas de coeff), accepter le code
        return true;
      });

      // Si pas d'étale compatible avec le coeff du jour, accepter quand même
      // (mieux que rien — données partielles)
      const etalesRef = etalesCompatibles.length > 0
        ? etalesCompatibles
        : etalesJour.filter(e => e.typeEtale === code.type);

      // Si vraiment aucune étale du bon type (PM/BM) dans les données du jour,
      // passer au code suivant sans créer de fenêtre fantôme
      if (etalesRef.length === 0) continue;

      for (const etale of etalesRef) {
        let debutMin, finMin;

        if (code.dir === 'H') {
          // À l'heure : fenêtre centrée sur l'étale ± tpsEtale/2
          debutMin = etale.tMin - Math.round(fenetreMin / 2);
          finMin   = etale.tMin + Math.round(fenetreMin / 2);
        } else if (code.dir === 'A') {
          // Avance : le plongeur arrive EN AVANCE, fenêtre commence decalMin AVANT l'étale
          debutMin = etale.tMin - code.decalMin;
          finMin   = debutMin + fenetreMin;
        } else {
          // Retard : le plongeur arrive EN RETARD, fenêtre commence decalMin APRÈS l'étale
          debutMin = etale.tMin + code.decalMin;
          finMin   = debutMin + fenetreMin;
        }

        fenetres.push({
          etaleLabel: `${code.type === 'PM' ? 'PM' : 'BM'} ${code.eau === 'ME' ? 'morte-eau' : 'vive-eau'} à ${etale.tMin >= 0 ? _minToHHMM(etale.tMin) : '?'}`,
          debutMin,
          finMin,
          etaleMin: etale.tMin,
        });
      }
    }

    if (fenetres.length === 0) {
      // Deux raisons possibles :
      // 1. Le type d'eau du jour est incompatible avec les codes du site
      // 2. Les horaires d'étale nécessaires (BM ou PM) sont absents des données
      const coeff = entreeMaree.PM1_coeff ?? entreeMaree.PM2_coeff;
      const typeEauLabel = typeEauJour === 'ME' ? 'morte-eau' : typeEauJour === 'VE' ? 'vive-eau' : null;
      const codeLabels = codes.map(c => `${c.type} ${c.eau === 'ME' ? 'morte-eau' : 'vive-eau'}`).join(', ');

      // Vérifier si le problème vient des données manquantes
      const typesNecessaires = [...new Set(codes.map(c => c.type))];
      const typesDispos = new Set(etalesJour.map(e => e.typeEtale));
      const donneeManquante = typesNecessaires.some(t => !typesDispos.has(t));

      if (donneeManquante) {
        const manquants = typesNecessaires.filter(t => !typesDispos.has(t)).join(', ');
        return {
          statut: 'gris',
          label: '?',
          detail: `Horaires ${manquants} non disponibles dans les données de marée du jour.`,
          prochaineFenetre: null,
        };
      }

      return {
        statut: 'rouge',
        label: '🔴 Hors type',
        detail: `Ce site est optimal en ${codeLabels}${coeff ? ` — coeff actuel ${coeff} (${typeEauLabel})` : ''}.`,
        prochaineFenetre: null,
      };
    }

    // Trier les fenêtres par début
    fenetres.sort((a, b) => a.debutMin - b.debutMin);

    // Chercher si on est dans une fenêtre
    const fenetreActive = fenetres.find(f => nowMin >= f.debutMin && nowMin <= f.finMin);
    if (fenetreActive) {
      const resteMin = fenetreActive.finMin - nowMin;
      const resteStr = _formatDuree(resteMin);
      return {
        statut: 'vert',
        label: '✅ Plongeable',
        detail: `Fenêtre de plongée ouverte — encore ${resteStr} (${fenetreActive.etaleLabel}).`,
        prochaineFenetre: fenetreActive,
      };
    }

    // Chercher la prochaine fenêtre future
    const prochaine = fenetres.find(f => f.debutMin > nowMin);
    if (prochaine) {
      const dansMin = prochaine.debutMin - nowMin;
      const dansStr = _formatDuree(dansMin);
      const statut  = dansMin <= 120 ? 'orange' : 'rouge';
      const heureDebut = _minToHHMM(prochaine.debutMin);
      const heureFin   = _minToHHMM(prochaine.finMin);
      return {
        statut,
        label: statut === 'orange' ? `⏱ ${dansStr}` : `🔴 ${heureDebut}`,
        detail: `Prochaine fenêtre : ${heureDebut}–${heureFin} (${prochaine.etaleLabel}), dans ${dansStr}.`,
        prochaineFenetre: prochaine,
      };
    }

    // Toutes les fenêtres sont passées
    const derniere = fenetres[fenetres.length - 1];
    return {
      statut: 'rouge',
      label: '🔴 Passé',
      detail: `La fenêtre de plongée est passée (dernière : jusqu'à ${_minToHHMM(derniere.finMin)}).`,
      prochaineFenetre: null,
    };
  }

  // ── Helpers formatage ─────────────────────────────────────────

  function _minToHHMM(min) {
    if (min == null) return '?';
    const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
    const m = ((min % 1440) + 1440) % 1440 % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  function _formatDuree(min) {
    if (min <= 0) return '0 min';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h${String(m).padStart(2,'0')}`;
  }

  /**
   * Retourne le HTML du bloc marée interprété pour la fiche site.
   * Appelé depuis sites.js → _ouvrirFiche()
   */
  function rendreBloc(props, entreeMaree, now = new Date()) {
    const etat = calculerEtat(props, entreeMaree, now);
    const codeRaw   = props.maree    || '—';
    const tpsRaw    = props.tpsEtale || '—';

    // Décodage lisible du code brut
    const decoded = _decoderCodeHumain(props.maree, props.tpsEtale);

    return `
      <div class="maree-site-bloc">
        <div class="maree-site-header">
          <span class="maree-site-badge maree-badge-${etat.statut}">${etat.label}</span>
          <span class="maree-site-code">${codeRaw}</span>
        </div>
        <p class="maree-site-detail">${etat.detail}</p>
        <p class="maree-site-decoded">${decoded}</p>
        <div class="maree-site-meta">
          <span>⏱ Fenêtre : <strong>${tpsRaw}</strong></span>
        </div>
      </div>
    `;
  }

  /**
   * Traduit le code en phrase lisible.
   * Ex. "PMME_R15'/BMVE_A2h30" → "PM morte-eau (−15 min) ou BM vive-eau (+2h30)"
   */
  function _decoderCodeHumain(codeRaw, tpsRaw) {
    if (!codeRaw) return '';
    const parties = codeRaw.split('/').map(c => {
      const p = _parseCode(c);
      if (!p) return c;
      const typeLabel = p.type === 'PM' ? 'Pleine Mer' : 'Basse Mer';
      const eauLabel  = p.eau  === 'ME' ? 'morte-eau'  : 'vive-eau';
      let decalLabel;
      if (p.dir === 'H') {
        decalLabel = 'à l\'étale';
      } else if (p.dir === 'A') {
        decalLabel = p.decalMin > 0
          ? `${p.decalMin} min avant l'étale`
          : 'à l\'étale';
      } else {
        decalLabel = p.decalMin > 0
          ? `${p.decalMin} min après l'étale`
          : 'à l\'étale';
      }
      return `${typeLabel} ${eauLabel} (${decalLabel})`;
    });
    return parties.join(' ou ');
  }

  /**
   * Calcule le statut pour tous les sites d'un GeoJSON (pour les badges liste).
   * Retourne un Map<siteID, etat>
   */
  function calculerTous(geojson, entreeMaree) {
    const map = new Map();
    if (!geojson) return map;
    const now = new Date();
    for (const feat of geojson.features) {
      const id = feat.properties.siteID;
      map.set(id, calculerEtat(feat.properties, entreeMaree, now));
    }
    return map;
  }

  return { calculerEtat, calculerTous, rendreBloc };
})();
