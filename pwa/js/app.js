/**
 * app.js — Point d'entrée de l'application SMPE Plongée
 * Orchestre tous les modules : Carte, Sites, Navigation, Marees, Meteo
 */

const App = (() => {

  let _filtreType = 'all';
  let _termeRecherche = '';
  let _filtreProf = 'all';

  // ── Initialisation ───────────────────────────────────────────

  async function init() {
    console.log('🚀 SMPE Plongée — démarrage');
    await _startApp();
  }

  async function _startApp() {

    // Horloge locale
    _startClock();

    // 1. Marées (bandeau immédiat — nécessaire avant la carte pour les états marée)
    await Marees.init();

    // 2. Bathymétrie LiDAR (chargement silencieux)
    await Bathy.init();

    // 3. Courants FES2022 — doit précéder Carte.init() pour que isDisponible() soit juste
    if (typeof Courants !== 'undefined') await Courants.init();

    // 4. Carte Leaflet (utilise Courants.isDisponible() pour le contrôle des couches)
    Carte.init();

    // 5. Sites (chargement GeoJSON + affichage carte)
    const geojson = await Sites.init(_onSiteSelectionne);
    if (geojson) {
      Carte.afficherSites(geojson, _onSiteSelectionne);
    }

    // 6. GPS en arrière-plan (si autorisé)
    if (CONFIG.NAV.watchGPS) Navigation.demarrerGPS();

    // 7. Init onglets fiche
    Sites.initOnglets();

    // 8. Init module Prévision
    Prevision.init();

    // 9. Init module Port (widget carte + créneaux bateaux)
    Port.init();

    // 10. Init module Bi-journée
    BiPlongee.init();

    // 11. Init module CGU
    if (typeof Cgu !== 'undefined') Cgu.init();

    // 12. Tutoriel premier démarrage
    if (typeof Tutorial !== 'undefined') Tutorial.init();

    // 9. Événements UI
    _bindEvents();

    // 8. Mode offline
    _monitorOnline();

    console.log('✅ Application prête');
  }

  // ── Callback sélection site ──────────────────────────────────

  function _onSiteSelectionne(feature) {
    if (!feature || !feature.geometry) return;
    const coords = feature.geometry.coordinates;
    Carte.centrerSurSite(coords[1], coords[0]);

    // Overlay LiDAR sur la carte
    Carte.toggleOverlayBathy(feature.properties.siteID);

    // Charger météo du site dans l'onglet Conditions
    Meteo.chargerPourSite(coords[1], coords[0]);

    // Indiquer le site dans le HUD (distance live sans activer la navigation)
    Navigation.setSiteDestination(feature);

    // Bouton Naviguer
    const btn = document.getElementById('btn-naviguer');
    if (btn) btn.classList.remove('hidden');
  }

  // ── Accès public (appelé depuis les popups HTML) ─────────────

  function ouvrirFiche(siteID) {
    Sites.selectionner(siteID);
    // Fermer la popup Leaflet
    Carte.getMap().closePopup();
    // Fermer le panel liste si mobile
    if (window.innerWidth <= 768) {
      document.getElementById('panel-sites')?.classList.add('hidden');
    }
  }

  // ── Événements UI ────────────────────────────────────────────

  function _bindEvents() {

    // ── Header : Menu sites
    document.getElementById('btn-menu')?.addEventListener('click', () => {
      const panel = document.getElementById('panel-sites');
      panel?.classList.toggle('hidden');
    });
    document.getElementById('btn-close-sites')?.addEventListener('click', () => {
      document.getElementById('panel-sites')?.classList.add('hidden');
    });

    // ── Header : GPS
    document.getElementById('btn-gps')?.addEventListener('click', () => {
      Navigation.centrerSurMoi();
    });

    // ── Header : Bi-journée (intégré dans Prévision — checkbox 2 tanks)
    document.getElementById('btn-close-biplongee')?.addEventListener('click', () => {
      document.getElementById('modal-biplongee')?.classList.add('hidden');
    });
    document.getElementById('btn-marees')?.addEventListener('click', () => {
      Marees.ouvrirModal();
    });
    document.getElementById('btn-close-marees')?.addEventListener('click', () => {
      document.getElementById('modal-marees')?.classList.add('hidden');
    });

    // ── Header : Météo
    document.getElementById('btn-meteo')?.addEventListener('click', () => {
      Meteo.ouvrirModal();
    });
    document.getElementById('btn-close-meteo')?.addEventListener('click', () => {
      document.getElementById('modal-meteo')?.classList.add('hidden');
    });

    // ── Header : Tutoriel
    document.getElementById('btn-tutorial')?.addEventListener('click', () => {
      if (typeof Tutorial !== 'undefined') Tutorial.relancer();
    });

    // ── Fiche : fermer
    document.getElementById('btn-close-fiche')?.addEventListener('click', () => {
      Sites.fermerFiche();
      Carte.toggleOverlayBathy(null); // masquer overlay LiDAR
    });

    // ── Fiche : naviguer
    document.getElementById('btn-naviguer')?.addEventListener('click', () => {
      const site = Sites.getSiteActif();
      if (!site) return;
      if (Navigation.isActif()) {
        Navigation.arreter();
      } else {
        Navigation.naviguerVers(site);
      }
    });

    // ── HUD : arrêter la navigation
    document.getElementById('btn-stop-nav')?.addEventListener('click', () => {
      Navigation.arreter();
    });

    // ── Toggle widgets (HUD + port + vent)
    document.getElementById('btn-widgets-toggle')?.addEventListener('click', () => {
      const btn = document.getElementById('btn-widgets-toggle');
      const masques = document.body.classList.toggle('widgets-masques');
      btn?.classList.toggle('widgets-masques', masques);
    });

    // ── Recherche sites
    document.getElementById('search-sites')?.addEventListener('input', e => {
      _termeRecherche = e.target.value.trim();
      Sites.filtrer(_termeRecherche, _filtreType, _filtreProf);
    });

    // ── Filtres type
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _filtreType = btn.dataset.filter;
        Sites.filtrer(_termeRecherche, _filtreType, _filtreProf);
      });
    });

    // ── Filtres profondeur
    document.querySelectorAll('.filter-prof-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-prof-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _filtreProf = btn.dataset.prof;
        Sites.filtrer(_termeRecherche, _filtreType, _filtreProf);
      });
    });

    // ── Fermer modales en cliquant dehors
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    });

    // ── Touche Echap
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
        Sites.fermerFiche();
      }
    });
  }

  // ── Horloge locale ───────────────────────────────────────────

  function _startClock() {
    const el = document.getElementById('local-time');
    if (!el) return;
    const tick = () => {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    setInterval(tick, 1000);
  }

  // ── Surveillance réseau ──────────────────────────────────────

  function _monitorOnline() {
    const banner = document.getElementById('offline-banner');
    const update = () => {
      if (banner) banner.classList.toggle('hidden', navigator.onLine);
    };
    window.addEventListener('online',  update);
    window.addEventListener('offline', update);
    update();
  }

  return { init, ouvrirFiche };
})();
