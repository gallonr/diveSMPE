/**
 * tutorial.js — Tutoriel interactif au premier démarrage
 * Affiche un spotlight sur chaque fonctionnalité clé de l'application.
 * Le tutoriel peut être passé à tout moment et ne se réaffiche plus
 * une fois terminé ou passé (localStorage).
 */

const Tutorial = (() => {

  const STORAGE_KEY = 'smpe_tutorial_done';
  const PADDING      = 10; // px autour de l'élément mis en avant

  /* ── Définition des étapes ─────────────────────────────────── */
  const ETAPES = [
    {
      titre:    '🤿 Bienvenue sur SMPE Plongée !',
      texte:    'Cette application vous permet de consulter les sites de plongée de la Baie de Saint-Malo, avec marées, météo, courants et navigation GPS.\n\nSuivez ce rapide tutoriel pour découvrir les fonctionnalités essentielles.',
      cible:    null,   // pas de spotlight → écran de bienvenue centré
      position: 'center'
    },
    {
      titre:    '🗺️ La carte interactive',
      texte:    'La carte est le cœur de l\'application. Cliquez sur un marqueur pour ouvrir la fiche d\'un site de plongée.\n\nVous pouvez zoomer, déplacer la carte et basculer entre les couches (carte/satellite/bathymétrie).',
      cible:    '#map',
      position: 'top'
    },
    {
      titre:    '☰ Liste des sites',
      texte:    'Ouvrez le panneau latéral pour parcourir et filtrer tous les sites de plongée par type (récif, épave, roche) ou par profondeur.',
      cible:    '#btn-menu',
      position: 'bottom'
    },
    {
      titre:    '🌊 Marées',
      texte:    'Consultez le graphique des marées du jour, les horaires de BM/PM et le coefficient. Le bandeau en haut de page affiche en permanence la hauteur actuelle.',
      cible:    '#btn-marees',
      position: 'bottom'
    },
    {
      titre:    '🌬️ Météo marine',
      texte:    'Accédez aux conditions météo marines : vent, vagues, visibilité et température. Les données sont issues des modèles AROME et MFWAM de Météo-France.',
      cible:    '#btn-meteo',
      position: 'bottom'
    },
    {
      titre:    '📅 Prévision de plongeabilité',
      texte:    'Obtenez une prévision sur 7 jours combinant marées, vents et courants pour estimer la plongeabilité de chaque créneau.\n\nL\'option bi-journée planifie deux plongées dans la même journée.',
      cible:    '#btn-prevision',
      position: 'bottom'
    },
    {
      titre:    '📍 Navigation GPS',
      texte:    'Activez le GPS pour voir votre position en temps réel sur la carte. Depuis la fiche d\'un site, le bouton "Naviguer" affiche le cap et la distance jusqu\'au site.',
      cible:    '#btn-gps',
      position: 'bottom'
    },
    {
      titre:    '📖 Documentation',
      texte:    'Le guide utilisateur complet est disponible en ligne. Il détaille toutes les fonctionnalités, les données utilisées et les conseils de sécurité.',
      cible:    'a[title="Documentation"]',
      position: 'bottom'
    },
    {
      titre:    '✅ Vous êtes prêt !',
      texte:    'Le tutoriel est terminé. Bonne exploration des sites de plongée de la Baie de Saint-Malo !\n\nVous pouvez relancer ce tutoriel à tout moment via le menu ⚙️ Paramètres.',
      cible:    null,
      position: 'center'
    }
  ];

  let _etapeActuelle = 0;
  let _overlay       = null;
  let _spotlight     = null;
  let _card          = null;
  let _resizeObs     = null;

  /* ── API publique ──────────────────────────────────────────── */

  function init() {
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
    _build();
    _afficherEtape(0);
  }

  /** Relancer manuellement le tutoriel (ex : depuis les paramètres) */
  function relancer() {
    localStorage.removeItem(STORAGE_KEY);
    _etapeActuelle = 0;
    if (_overlay) {
      _overlay.classList.remove('hidden');
      _afficherEtape(0);
    } else {
      _build();
      _afficherEtape(0);
    }
  }

  /* ── Construction du DOM ───────────────────────────────────── */

  function _build() {
    _overlay = document.getElementById('tutorial-overlay');
    if (!_overlay) return;
    _spotlight = document.getElementById('tutorial-spotlight');
    _card      = document.getElementById('tutorial-card');

    document.getElementById('tuto-btn-skip')?.addEventListener('click', _terminer);
    document.getElementById('tuto-btn-prev')?.addEventListener('click', _precedent);
    document.getElementById('tuto-btn-next')?.addEventListener('click', _suivant);

    // Fermer avec Echap
    document.addEventListener('keydown', e => {
      if (!_overlay.classList.contains('hidden')) {
        if (e.key === 'Escape') _terminer();
        if (e.key === 'ArrowRight') _suivant();
        if (e.key === 'ArrowLeft')  _precedent();
      }
    });

    // Mettre à jour le spotlight si la fenêtre change de taille
    window.addEventListener('resize', _debounce(() => {
      if (!_overlay.classList.contains('hidden')) {
        _afficherEtape(_etapeActuelle);
      }
    }, 150));
  }

  /* ── Navigation entre étapes ───────────────────────────────── */

  function _afficherEtape(idx) {
    if (!_overlay || !_card) return;
    _etapeActuelle = idx;
    const etape = ETAPES[idx];

    // Contenu de la carte
    document.getElementById('tuto-titre').textContent = etape.titre;
    document.getElementById('tuto-texte').innerHTML   = etape.texte.replace(/\n/g, '<br>');

    // Compteur
    document.getElementById('tuto-compteur').textContent = `${idx + 1} / ${ETAPES.length}`;

    // Boutons
    const btnPrev = document.getElementById('tuto-btn-prev');
    const btnNext = document.getElementById('tuto-btn-next');
    if (btnPrev) btnPrev.classList.toggle('hidden', idx === 0);
    if (btnNext) btnNext.textContent = (idx === ETAPES.length - 1) ? '🎉 Terminer' : 'Suivant →';

    // Spotlight
    _positionnerSpotlight(etape);
  }

  function _suivant() {
    if (_etapeActuelle < ETAPES.length - 1) {
      _afficherEtape(_etapeActuelle + 1);
    } else {
      _terminer();
    }
  }

  function _precedent() {
    if (_etapeActuelle > 0) {
      _afficherEtape(_etapeActuelle - 1);
    }
  }

  function _terminer() {
    localStorage.setItem(STORAGE_KEY, '1');
    if (_overlay) _overlay.classList.add('hidden');
    // Retirer le highlight des éléments
    document.querySelectorAll('.tuto-highlighted').forEach(el => {
      el.classList.remove('tuto-highlighted');
    });
  }

  /* ── Spotlight ─────────────────────────────────────────────── */

  function _positionnerSpotlight(etape) {
    if (!_spotlight || !_card) return;

    // Retirer l'ancien highlight
    document.querySelectorAll('.tuto-highlighted').forEach(el => {
      el.classList.remove('tuto-highlighted');
    });

    if (!etape.cible || etape.position === 'center') {
      // Mode centré : pas de spotlight, carte centrée
      _spotlight.style.display = 'none';
      _card.className          = 'tutorial-card tutorial-card--center';
      _card.removeAttribute('style');
      return;
    }

    const cible = document.querySelector(etape.cible);
    if (!cible) {
      // Élément introuvable → mode centré
      _spotlight.style.display = 'none';
      _card.className          = 'tutorial-card tutorial-card--center';
      _card.removeAttribute('style');
      return;
    }

    // Highlight CSS sur l'élément cible
    cible.classList.add('tuto-highlighted');

    const r = cible.getBoundingClientRect();
    const p = PADDING;

    // Position du "trou" dans l'overlay (clip-path)
    const x1 = r.left   - p;
    const y1 = r.top    - p;
    const x2 = r.right  + p;
    const y2 = r.bottom + p;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    _spotlight.style.display = 'block';
    _spotlight.style.clipPath = [
      `polygon(`,
      `0% 0%, 100% 0%, 100% 100%, 0% 100%,`,         // contour extérieur
      `0% ${y1}px,`,
      `${x1}px ${y1}px, ${x1}px ${y2}px,`,           // trou
      `${x2}px ${y2}px, ${x2}px ${y1}px,`,
      `0% ${y1}px, 0% 100%`,
      `)`
    ].join(' ');

    // Positionnement de la carte tooltip
    _card.removeAttribute('style');
    _card.className = 'tutorial-card tutorial-card--positioned';

    const cardH = _card.offsetHeight || 180;
    const cardW = _card.offsetWidth  || 300;

    let top, left;

    if (etape.position === 'bottom') {
      top  = Math.min(y2 + 12, vh - cardH - 12);
      left = Math.max(8, Math.min(r.left, vw - cardW - 8));
    } else if (etape.position === 'top') {
      top  = Math.max(8, y1 - cardH - 12);
      left = Math.max(8, Math.min(r.left, vw - cardW - 8));
    } else {
      // right
      top  = Math.max(8, r.top);
      left = Math.min(x2 + 12, vw - cardW - 8);
    }

    _card.style.top  = `${top}px`;
    _card.style.left = `${left}px`;
  }

  /* ── Utilitaires ────────────────────────────────────────────── */

  function _debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  /* ── Exports ────────────────────────────────────────────────── */
  return { init, relancer };

})();
