# taskmanager.md — Plan de projet Catalogue Sites de Plongée SMPE

> **Légende** : ⬜ À faire · 🔄 En cours · ✅ Terminé · ⏸️ Bloqué

---

## PHASE 0 — Initialisation du projet
> *Objectif : mettre en place l'environnement de travail et les fondations*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 0.1 | Créer `CLAUDE.md` (contexte projet) | ✅ | Fait le 08/04/2026 |
| 0.2 | Créer `taskmanager.md` (ce fichier) | ✅ | Fait le 08/04/2026 |
| 0.3 | Initialiser le dépôt Git | ✅ | Fait le 08/04/2026 |
| 0.4 | Créer `.gitignore` | ✅ | Fait le 08/04/2026 — exclut `las/`, `data/tiles/`, `fes2022/`, `node_modules/` |
| 0.5 | Créer la structure de dossiers cible | ✅ | Fait le 08/04/2026 — `r/`, `data/`, `data/tiles/`, `pwa/`, `pwa/js/`, `pwa/css/`, `pwa/data/` |
| 0.6 | Vérifier l'installation R et les packages nécessaires | ✅ | Fait le 08/04/2026 — lidR 4.2.3, terra 1.8.86, sf 1.0.23, readxl 1.4.5, jsonlite 2.0.0, httr2 1.2.2 |

---

## PHASE 1 — Exploration et validation des données sources
> *Objectif : comprendre et valider les données avant de coder*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 1.1 | Inspecter `bddAtlasPlongeeSMPE.xlsx` | ✅ | 4 feuilles : `metadonnees` (dictionnaire), `site` (68 lignes × 15 col.), `biologie` (vide), `histoire` (vide) |
| 1.2 | Vérifier la projection/CRS du fichier XLSX | ✅ | **WGS84 degrés décimaux** — `latitude` ∈ [48.629, 48.808], `longitude` ∈ [-2.276, -2.011] |
| 1.3 | Inspecter le fichier LAS (header, extent, densité) | ✅ | **Lambert-93** — 206 406 455 pts — X [320725, 330690] Y [6847262, 6855878] Z [-25.96, +43.91] m — densité ~2,4 pts/m² |
| 1.4 | Vérifier la couverture spatiale LAS vs sites BDD | ✅ | **45/60 sites** dans l'emprise LAS — 15 hors emprise (dont SR002, SR003, SR016, SE004, SE012…) → LAS ne couvre pas toute la zone |
| 1.5 | Identifier les champs utiles de la BDD pour la PWA | ✅ | Champs PWA : `siteID`, `siteNom`, `latitude`, `longitude`, `typeSite`, `accessibilite`, `typePlongee`, `niveauPlongee`, `accesVent`, `houle`, `mouillage`, `maree`, `tpsEtale`, `commentaire`, `photoSite` |
| 1.6 | Lister les sites sans coordonnées / données manquantes | ✅ | **8 sites sans coordonnées** (SR047–SR053, SE015) — champs très incomplets : `accesVent` 100% NA, `houle` 100% NA, `photoSite` 97% NA, `niveauPlongee` 96% NA |

---

## PHASE 2 — Preprocessing R : BDD → GeoJSON
> *Objectif : transformer la BDD Excel en GeoJSON exploitable par la PWA*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 2.1 | Créer `r/02_process_bdd.R` | ✅ | Fait le 08/04/2026 — lecture XLSX avec `readxl`, feuille `site` |
| 2.2 | Conversion en objet `sf` + reprojection WGS84 | ✅ | `st_as_sf()` — CRS EPSG:4326 confirmé, 8 sites sans coords exclus |
| 2.3 | Sélection et renommage des colonnes utiles | ✅ | 15 colonnes PWA retenues, toutes présentes dans le XLSX |
| 2.4 | Export `data/sites.geojson` | ✅ | `sf::st_write()` — 60 features POINT, 26,8 Ko, precision=6 |
| 2.5 | Valider le GeoJSON (taille, nb features, CRS) | ✅ | Fait le 08/04/2026 — 60 features, CRS WGS 84, siteID uniques, 26,8 Ko ✅ |

---

## PHASE 3 — Preprocessing R : LiDAR → Bathymétrie
> *Objectif : générer les données de fond marin (MNT, profils) à partir du LAS*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 3.1 | Créer `r/01_process_las.R` | ✅ | Fait le 09/04/2026 — 485 lignes, couvre 3.1→3.8 |
| 3.2 | Lecture et normalisation du LAS par tuiles | ✅ | Fait le 09/04/2026 — `lidR::readLAScatalog()` + clip bbox par site |
| 3.3 | Filtrage des points (bruit, classes) | ✅ | Fait le 09/04/2026 — LAS 1.2 sans Classification → filtrage Z + densité |
| 3.4 | Génération du MNT raster par site (résolution 5m) | ✅ | Fait le 09/04/2026 — `terra::rasterize()` mean Z — 44 GeoTIFF (216 Mo) dans `data/tiles/` |
| 3.5 | Génération grille Z 120×120 @ 5m + miniatures PNG | ✅ | Fait le 09/04/2026 — grille dans `bathy_sites.json`, 44 PNG dans `pwa/data/thumbs/` (1,5 Mo) |
| 3.6 | Extraction de profils bathymétriques par site | ✅ | Fait le 09/04/2026 — `r/03_generate_profile.R` (139 lignes) — profMin, profMax, transect E→O |
| 3.7 | Export `data/tiles/` + `data/bathy_sites.json` | ✅ | Fait le 09/04/2026 — 45 sites, clé `grid` + `transect` — copie auto vers `pwa/data/` + `sites.geojson` mis à jour |
| 3.8 | Valider visuellement les tuiles dans QGIS | ⬜ | À faire — `data/tiles/*.tif` prêts — log suggère ouverture QGIS |

---

## PHASE 4 — Preprocessing : Tables de marées (modèle FES2022)
> *Objectif : pré-calculer les marées ±1 an pour un fonctionnement offline*
>
> **Choix technique : modèle FES2022 (CNES/LEGOS) via PyFES (Python)**
> FES2022 est le modèle mondial de référence, très précis en Manche/Baie de Saint-Malo (fort marnage, 34 composantes harmoniques).
> Stratégie : extraire une seule fois les constituantes harmoniques pour Saint-Malo, puis calculer les marées sans atlas (offline total).

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 4.1 | Créer un compte AVISO et télécharger les données FES2022 | ✅ | Fait le 17/04/2026 — 34 fichiers atlas `.nc.xz` présents dans `fes2022/` (toutes les constituantes : M2, S2, K1, O1…) |
| 4.2 | Installer PyFES : `conda install -c conda-forge pyfes` | ✅ | Fait le 17/04/2026 — pyfes 2026.3.0 installé dans miniconda3 |
| 4.3 | Créer `r/03_marees.py` — extraction des constituantes harmoniques | ✅ | Fait le 17/04/2026 — `r/04_marees_fes.py` — décompresse chaque `.nc.xz` à la volée, extrait amp/phase au point Saint-Malo (lat=48.637°, lon=-2.025°) |
| 4.4 | Sauvegarder les constituantes harmoniques Saint-Malo (`constituantes_stmalo.json`) | ✅ | Fait le 17/04/2026 — `data/constituantes_stmalo.json` — 34 constituantes extraites (M2=372cm, S2=145cm, N2=72cm…) |
| 4.5 | Créer `r/03_marees.py` — calcul PM/BM ±365 jours depuis les constituantes | ✅ | Fait le 17/04/2026 — `pyfes.evaluate_tide_from_constituents()` — 105 120 pas de 10 min — 1410 PM détectés |
| 4.6 | Calculer les coefficients de marée (0-120) pour chaque PM | ✅ | Fait le 17/04/2026 — référence 95e percentile des marnages — coeff = round(120 × marnage / marnage_VE) |
| 4.7 | Export `data/marees.json` | ✅ | Fait le 17/04/2026 — 730 jours — 129 Ko — format `{date, PM1_h, PM1_coeff, PM1_hcm, BM1_h, BM1_hcm, PM2_h…}` — copié dans `pwa/data/marees.json` |
| 4.8 | Valider les données (comparer avec annuaire SHOM Saint-Malo) | ✅ | Fait le 17/04/2026 — PM1 07h50 vs 07h55 (±5min ✅), coeff 98 vs 97 (±1 ✅) — PM2 20h10 vs 20h15 (±5min ✅), coeff 102 vs 101 (±1 ✅) — ref VE calibrée à 1366 cm |
| 4.9 | (Optionnel) Appeler le script Python depuis R avec `reticulate` ou `system()` | ⬜ | Pour intégration dans le pipeline `build_all.R` |

---

## PHASE 5 — Script R maître + build pipeline
> *Objectif : un seul script pour régénérer toutes les données*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 5.1 | Créer `r/build_all.R` | ✅ | Fait le 17/04/2026 — `source()` des scripts R + `system()` python — 5 étapes orchestrées |
| 5.2 | Ajouter logs + timings dans le script maître | ✅ | Fait le 17/04/2026 — `.log()` horodaté + `.step()` avec `proc.time()` — niveaux INFO/WARN/ERROR |
| 5.3 | Copier automatiquement `data/` vers `pwa/data/` | ✅ | Fait le 17/04/2026 — `file.copy()` pour sites.geojson, bathy_sites.json, marees.json |
| 5.4 | Tester un cycle complet de build end-to-end | ⬜ | À faire — `Rscript r/build_all.R` depuis la racine |

---

## PHASE 6 — PWA : structure de base et carte
> *Objectif : squelette de l'application web avec carte Leaflet fonctionnelle*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 6.1 | Créer `pwa/index.html` (structure HTML5 PWA) | ✅ | Fait le 08/04/2026 — Viewport mobile, meta charset, structure complète |
| 6.2 | Créer `pwa/manifest.json` | ✅ | Fait le 08/04/2026 — Nom, icônes, `display: standalone` |
| 6.3 | Intégrer Leaflet.js (local, offline) | ✅ | Fait le 08/04/2026 — Leaflet 1.9.4 + Turf.js 6.5.0 copiés dans `pwa/libs/` |
| 6.4 | Configurer la carte de base (IGN Géoportail WMS) | ✅ | Fait le 08/04/2026 — OSM par défaut + slot IGN prévu dans `config.js` |
| 6.5 | Ajouter overlay OpenSeaMap | ✅ | Fait le 08/04/2026 — overlay OpenSeaMap actif, contrôle de couches |
| 6.6 | Afficher les sites depuis `sites.geojson` | ✅ | Fait le 08/04/2026 — marqueurs colorés par type + popup + `pwa/data/sites.geojson` |
| 6.7 | Tester l'affichage carte sur navigateur desktop | ✅ | Fait le 09/04/2026 — http-server port 8080 actif, affichage vérifié |
| 6.8 | Tester l'affichage carte sur tablette (responsive) | ⬜ | Viewport, zoom touch |

---

## PHASE 7 — PWA : fiches sites
> *Objectif : afficher les informations détaillées de chaque site*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 7.1 | Définir la maquette d'une fiche site | ✅ | Fait le 08/04/2026 — Drawer bas mobile / panneau droit desktop |
| 7.2 | Créer le panneau latéral / modal fiche site | ✅ | Fait le 08/04/2026 — HTML + CSS responsive dans `index.html` + `style.css` |
| 7.3 | Afficher le profil bathymétrique du site | ✅ | Fait le 08/04/2026 — Placeholder Canvas 2D (données LiDAR phase 3 à venir) |
| 7.4 | Afficher la miniature MNT du site | ✅ | Fait le 09/04/2026 — 44 PNG dans `pwa/data/thumbs/` — intégré dans `sites.js` (onglet Bathymétrie) |
| 7.5 | Ajouter les infos de sécurité / niveau requis | ✅ | Fait le 08/04/2026 — Tous les champs BDD affichés (niveauPlongee, maree, tpsEtale…) |
| 7.6 | Filtre/recherche des sites sur la carte | ✅ | Fait le 08/04/2026 — Recherche texte + filtres par type (récif/épave/roche) |
| 7.7 | Module `mareesite.js` — interprétation codes marée | ✅ | Fait le 09/04/2026 — 375 lignes — parse codes `PMME_R15'/BMVE_A2h30`, calcule statut vert/orange/rouge/gris |
| 7.8 | Intégration états marée dans liste + fiche site | ✅ | Fait le 09/04/2026 — badge coloré par site, bloc marée dans fiche, rafraîchissement toutes les minutes |
| 7.9 | Transect libre utilisateur (clic sur miniature) | ✅ | Fait le 09/04/2026 — mode sélection 2 points sur la grille Z, recalcul profil dans `bathy.js` |

---

## PHASE 8 — PWA : navigation et GPS
> *Objectif : aide à la navigation en mer (position, cap, ETA)*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 8.1 | Intégrer la Geolocation API | ✅ | Fait le 08/04/2026 — `navigator.geolocation.watchPosition()` dans `navigation.js` |
| 8.2 | Afficher la position GPS sur la carte (temps réel) | ✅ | Fait le 08/04/2026 — Marqueur GPS animé (pulsant vert) |
| 8.3 | Calcul de cap et distance vers le site sélectionné | ✅ | Fait le 08/04/2026 — `turf.bearing()` + `turf.distance()` |
| 8.4 | Afficher ETA (distance + vitesse bateau) | ✅ | Fait le 08/04/2026 — Vitesse défaut 6 nœuds, configurable dans `config.js` |
| 8.5 | Afficher une ligne de navigation site → position | ✅ | Fait le 08/04/2026 — `L.polyline()` verte pointillée |

---

## PHASE 9 — PWA : marées
> *Objectif : afficher les marées du jour et de la semaine*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 9.1 | Lire `marees.json` dans la PWA | ✅ | Fait le 08/04/2026 — `fetch()` dans `marees.js` + mis en cache par SW |
| 9.2 | Afficher PM/BM du jour (heure + hauteur + coeff) | ✅ | Fait le 08/04/2026 — Bandeau permanent en haut de l'appli (heure, hauteur, coefficient) |
| 9.3 | Graphique courbe de marée (J-1 à J+2) | ✅ | Fait le 08/04/2026 — Canvas 2D dans la modal marées (4 jours, dégradé bleu) |
| 9.4 | Calculer la hauteur d'eau actuelle (interpolation sinusoïdale) | ✅ | Fait le 08/04/2026 — Interpolation PM→BM, mise à jour toutes les minutes |
| 9.5 | Indicateur de fenêtre plongée optimale | ✅ | Fait le 08/04/2026 — Bandeau "🤿 Étale PM dans Xmin" (±2h étale, animé) |
| 9.6 | Adapter la PWA au format FES2022 (`_hcm` → `_haut`) | ✅ | Fait le 17/04/2026 — Normalisation dans `init()` de `marees.js` : `_haut = _hcm/100 + CONFIG.MAREES.MSL_OFFSET_M` (offset ZH Saint-Malo = 6.9m) — `SW_CACHE_VERSION` → `smpe-v6` |

---

## PHASE 10 — PWA : météo marine
> *Objectif : intégrer les données météo si connexion disponible*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 10.1 | Identifier l'API Météo-France à utiliser | ✅ | Fait le 08/04/2026 — **Open-Meteo** (gratuit, sans clé, données marine incluses) |
| 10.2 | Récupérer vent, vagues, visibilité si 4G dispo | ✅ | Fait le 08/04/2026 — `fetch()` avec AbortSignal.timeout(5s) dans `meteo.js` |
| 10.3 | Afficher les conditions météo dans la PWA | ✅ | Fait le 08/04/2026 — Modal météo + résumé dans l'onglet Conditions de la fiche site |
| 10.4 | Gérer gracieusement l'absence de réseau | ✅ | Fait le 08/04/2026 — Bandeau offline + message "Météo non disponible offline" |

---

## PHASE 11 — Service Worker et mode offline
> *Objectif : garantir le fonctionnement 100% offline en mer*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 11.1 | Créer `pwa/sw.js` (Service Worker) | ✅ | Fait le 08/04/2026 — Cache API + stratégie Cache First |
| 11.2 | Mettre en cache tous les assets statiques à l'installation | ✅ | Fait le 08/04/2026 — HTML, CSS, JS, Leaflet, Turf, sites.geojson, marees.json |
| 11.3 | Mettre en cache les tuiles cartographiques IGN | ✅ | Fait le 08/04/2026 — Stratégie Cache First + Network Update pour OSM/OpenSeaMap |
| 11.4 | Stratégie de mise à jour (network-first au centre, cache en mer) | ✅ | Fait le 08/04/2026 — Network First pour météo, Cache First pour assets, mise à jour bg tuiles |
| 11.5 | Tester le mode offline (couper le réseau, recharger) | ⬜ | À tester via DevTools → Network → Offline |
| 11.6 | Afficher un bandeau "Mode offline" quand hors réseau | ✅ | Fait le 08/04/2026 — `navigator.onLine` event, bandeau orange |

---

## PHASE 12 — Serveur local au centre de plongée
> *Objectif : servir la PWA en local au centre via nginx*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 12.1 | Installer et configurer nginx sur le PC du centre | ⬜ | Ou `http-server` Node.js |
| 12.2 | Configurer nginx pour servir `pwa/` sur port 80 | ⬜ | Headers HTTPS requis pour Service Worker |
| 12.3 | Configurer HTTPS local (certificat auto-signé) | ⬜ | Service Worker exige HTTPS ou localhost |
| 12.4 | Tester l'accès depuis la tablette sur WiFi centre | ⬜ | `http://[IP-PC]:80` |
| 12.5 | Documenter la procédure de démarrage/arrêt serveur | ⬜ | Pour les moniteurs non-techs |

---

## PHASE 13 — Tests et validation terrain
> *Objectif : valider l'application en conditions réelles*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 13.1 | Test complet de la PWA sur tablette Android/iOS | ⬜ | Chrome mobile recommandé |
| 13.2 | Test d'installation PWA (icône sur l'écran d'accueil) | ⬜ | |
| 13.3 | Test offline complet en mer (sortie test) | ⬜ | Mode avion sur la tablette |
| 13.4 | Test du GPS et de la navigation | ⬜ | Précision, stabilité du signal |
| 13.5 | Test de mise à jour (modifier BDD → rebuild R → WiFi) | ⬜ | Vérifier que la tablette se met à jour |
| 13.6 | Recueillir les retours des moniteurs | ⬜ | Ergonomie, fonctionnalités manquantes |

---

## PHASE 14 — Documentation et livraison
> *Objectif : rendre le projet maintenable par un non-développeur*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 14.1 | Rédiger guide de mise à jour de la BDD | ⬜ | "Comment ajouter un site" |
| 14.2 | Rédiger guide de rebuild et déploiement | ⬜ | "Comment régénérer les données" |
| 14.3 | Rédiger guide utilisateur tablette | ⬜ | "Comment utiliser l'appli en mer" |
| 14.4 | Mettre à jour `CLAUDE.md` avec l'état final | ⬜ | |
| 14.5 | Tag Git de la version 1.0 | ⬜ | `git tag v1.0` |

---

## Récapitulatif des phases

| Phase | Description | Priorité | Dépendances |
|-------|-------------|----------|-------------|
| 0 | Initialisation | 🔴 Critique | — |
| 1 | Exploration données | 🔴 Critique | Phase 0 |
| 2 | R : BDD → GeoJSON | 🔴 Critique | Phase 1 |
| 3 | R : LiDAR → Bathy | 🟠 Haute | Phase 1 |
| 4 | Marées FES2022 (PyFES Python) | 🟠 Haute | Phase 0 — nécessite compte AVISO |
| 5 | Pipeline build R | 🟠 Haute | Phases 2,3,4 |
| 6 | PWA : carte de base | 🔴 Critique | Phase 2 |
| 7 | PWA : fiches sites | 🟠 Haute | Phases 3,6 |
| 8 | PWA : navigation GPS | 🟡 Moyenne | Phase 6 |
| 9 | PWA : marées | 🟡 Moyenne | Phases 4,6 |
| 10 | PWA : météo | 🟢 Basse | Phase 6 |
| 11 | Service Worker offline | 🔴 Critique | Phase 6 |
| 12 | Serveur local nginx | 🟠 Haute | Phase 11 |
| 13 | Tests terrain | 🔴 Critique | Phases 6-12 |
| 14 | Documentation | 🟡 Moyenne | Phase 13 |

---

*Dernière mise à jour : 17/04/2026 — Phase 4 complète (FES2022 opérationnel) + PWA adaptée au format FES*
