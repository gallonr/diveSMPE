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
| 1.1 | Inspecter `bddAtlasPlongeeSMPE.xlsx` | ⬜ | Colonnes, types, coordonnées, nb de sites |
| 1.2 | Vérifier la projection/CRS du fichier XLSX | ⬜ | WGS84 (EPSG:4326) ou Lambert-93 ? |
| 1.3 | Inspecter le fichier LAS (header, extent, densité) | ⬜ | `lidR::readLASheader()` |
| 1.4 | Vérifier la couverture spatiale LAS vs sites BDD | ⬜ | Tous les sites sont-ils dans l'emprise LAS ? |
| 1.5 | Identifier les champs utiles de la BDD pour la PWA | ⬜ | Nom, coord, profondeur, type, description… |
| 1.6 | Lister les sites sans coordonnées / données manquantes | ⬜ | Nettoyer avant processing |

---

## PHASE 2 — Preprocessing R : BDD → GeoJSON
> *Objectif : transformer la BDD Excel en GeoJSON exploitable par la PWA*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 2.1 | Créer `r/02_process_bdd.R` | ⬜ | Lecture XLSX avec `readxl` |
| 2.2 | Conversion en objet `sf` + reprojection WGS84 | ⬜ | `st_as_sf()` + `st_transform(4326)` |
| 2.3 | Sélection et renommage des colonnes utiles | ⬜ | Garder ce qui est affiché dans la PWA |
| 2.4 | Export `data/sites.geojson` | ⬜ | `sf::st_write()` ou `jsonlite::write_json()` |
| 2.5 | Valider le GeoJSON (taille, nb features, CRS) | ⬜ | Ouvrir dans QGIS ou geojson.io |

---

## PHASE 3 — Preprocessing R : LiDAR → Bathymétrie
> *Objectif : générer les données de fond marin (MNT, profils) à partir du LAS*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 3.1 | Créer `r/01_process_las.R` | ⬜ | Squelette du script |
| 3.2 | Lecture et normalisation du LAS par tuiles | ⬜ | `lidR::readLAScatalog()` |
| 3.3 | Filtrage des points (bruit, classes) | ⬜ | Garder bathy + sol |
| 3.4 | Génération du MNT raster (résolution ~1m ou 2m) | ⬜ | `lidR::rasterize_terrain()` ou `terra` |
| 3.5 | Tuilage du MNT en GeoTIFF ou PMTiles | ⬜ | Résolution adaptée au zoom Leaflet |
| 3.6 | Extraction de profils bathymétriques par site | ⬜ | Profondeur max, min, profil transect |
| 3.7 | Export `data/tiles/` + `data/bathy_sites.json` | ⬜ | |
| 3.8 | Valider visuellement les tuiles dans QGIS | ⬜ | |

---

## PHASE 4 — Preprocessing : Tables de marées (modèle FES2022)
> *Objectif : pré-calculer les marées ±1 an pour un fonctionnement offline*
>
> **Choix technique : modèle FES2022 (CNES/LEGOS) via PyFES (Python)**
> FES2022 est le modèle mondial de référence, très précis en Manche/Baie de Saint-Malo (fort marnage, 34 composantes harmoniques).
> Stratégie : extraire une seule fois les constituantes harmoniques pour Saint-Malo, puis calculer les marées sans atlas (offline total).

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 4.1 | Créer un compte AVISO et télécharger les données FES2022 | 🔄 | Inscription en cours (08/04/2026) — accès FTP reçu par email. Télécharger en priorité : M2, S2, N2, K1, O1 (dossier `fes2022b/ocean_tide_extrapolated/`) |
| 4.2 | Installer PyFES : `conda install -c conda-forge pyfes` | ⬜ | Librairie Python officielle CNES — `pip install pyfes` aussi possible |
| 4.3 | Créer `r/03_marees.py` — extraction des constituantes harmoniques | ⬜ | Point Saint-Malo : lat=48.63°, lon=-2.01° — avec `pyfes.evaluate_tide()` + atlas FES2022 |
| 4.4 | Sauvegarder les constituantes harmoniques Saint-Malo (`constituantes_stmalo.json`) | ⬜ | M2, S2, K1, O1… — permet recalcul sans atlas (offline) |
| 4.5 | Créer `r/03_marees.py` — calcul PM/BM ±365 jours depuis les constituantes | ⬜ | `pyfes.evaluate_tide_from_constituents()` — pas besoin de l'atlas |
| 4.6 | Calculer les coefficients de marée (0-120) pour chaque PM | ⬜ | Rapport marnage PM / marnage moyen × 100 |
| 4.7 | Export `data/marees.json` | ⬜ | Format indexé par date : `{date, PM1_h, PM1_coeff, BM1_h, PM2_h, PM2_coeff, BM2_h}` |
| 4.8 | Valider les données (comparer avec annuaire SHOM Saint-Malo) | ⬜ | Tolérance ±5 min / ±5 cm |
| 4.9 | (Optionnel) Appeler le script Python depuis R avec `reticulate` ou `system()` | ⬜ | Pour intégration dans le pipeline `build_all.R` |

---

## PHASE 5 — Script R maître + build pipeline
> *Objectif : un seul script pour régénérer toutes les données*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 5.1 | Créer `r/build_all.R` | ⬜ | `source()` des scripts R + `system("python3 r/03_marees.py")` |
| 5.2 | Ajouter logs + timings dans le script maître | ⬜ | `message()` + `proc.time()` |
| 5.3 | Copier automatiquement `data/` vers `pwa/data/` | ⬜ | `file.copy()` R ou script bash |
| 5.4 | Tester un cycle complet de build end-to-end | ⬜ | |

---

## PHASE 6 — PWA : structure de base et carte
> *Objectif : squelette de l'application web avec carte Leaflet fonctionnelle*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 6.1 | Créer `pwa/index.html` (structure HTML5 PWA) | ⬜ | Viewport mobile, meta charset |
| 6.2 | Créer `pwa/manifest.json` | ⬜ | Nom, icônes, `display: standalone` |
| 6.3 | Intégrer Leaflet.js (local, offline) | ⬜ | Copier les fichiers Leaflet en local |
| 6.4 | Configurer la carte de base (IGN Géoportail WMS) | ⬜ | Clé API IGN Géoportail |
| 6.5 | Ajouter overlay OpenSeaMap | ⬜ | WMS ou tiles OpenSeaMap |
| 6.6 | Afficher les sites depuis `sites.geojson` | ⬜ | Marqueurs Leaflet + popup basique |
| 6.7 | Tester l'affichage carte sur navigateur desktop | ⬜ | |
| 6.8 | Tester l'affichage carte sur tablette (responsive) | ⬜ | Viewport, zoom touch |

---

## PHASE 7 — PWA : fiches sites
> *Objectif : afficher les informations détaillées de chaque site*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 7.1 | Définir la maquette d'une fiche site | ⬜ | Nom, type, profondeur, description, bathy |
| 7.2 | Créer le panneau latéral / modal fiche site | ⬜ | HTML + CSS |
| 7.3 | Afficher le profil bathymétrique du site | ⬜ | Canvas 2D ou SVG |
| 7.4 | Afficher la miniature MNT du site | ⬜ | Image PNG ou tuile |
| 7.5 | Ajouter les infos de sécurité / niveau requis | ⬜ | Selon champs BDD |
| 7.6 | Filtre/recherche des sites sur la carte | ⬜ | Par nom, type, profondeur |

---

## PHASE 8 — PWA : navigation et GPS
> *Objectif : aide à la navigation en mer (position, cap, ETA)*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 8.1 | Intégrer la Geolocation API | ⬜ | `navigator.geolocation.watchPosition()` |
| 8.2 | Afficher la position GPS sur la carte (temps réel) | ⬜ | Marqueur GPS animé |
| 8.3 | Calcul de cap et distance vers le site sélectionné | ⬜ | `Turf.js` : `bearing()` + `distance()` |
| 8.4 | Afficher ETA (distance + vitesse bateau) | ⬜ | Saisie vitesse ou estimation |
| 8.5 | Afficher une ligne de navigation site → position | ⬜ | `L.polyline()` Leaflet |

---

## PHASE 9 — PWA : marées
> *Objectif : afficher les marées du jour et de la semaine*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 9.1 | Lire `marees.json` dans la PWA | ⬜ | `fetch()` + cache Service Worker |
| 9.2 | Afficher PM/BM du jour (heure + hauteur + coeff) | ⬜ | Bandeau en haut de l'appli |
| 9.3 | Graphique courbe de marée (J-1 à J+2) | ⬜ | Canvas 2D ou SVG |
| 9.4 | Calculer la hauteur d'eau actuelle (interpolation sinusoïdale) | ⬜ | Afficher en temps réel |
| 9.5 | Indicateur de fenêtre plongée optimale | ⬜ | ±2h autour de l'étale |

---

## PHASE 10 — PWA : météo marine
> *Objectif : intégrer les données météo si connexion disponible*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 10.1 | Identifier l'API Météo-France à utiliser | ⬜ | API Marine ou OpenMeteo (gratuit) |
| 10.2 | Récupérer vent, vagues, visibilité si 4G dispo | ⬜ | `fetch()` avec timeout |
| 10.3 | Afficher les conditions météo dans la PWA | ⬜ | Icônes + valeurs |
| 10.4 | Gérer gracieusement l'absence de réseau | ⬜ | Afficher "Pas de données météo offline" |

---

## PHASE 11 — Service Worker et mode offline
> *Objectif : garantir le fonctionnement 100% offline en mer*

| # | Tâche | Statut | Notes |
|---|-------|--------|-------|
| 11.1 | Créer `pwa/sw.js` (Service Worker) | ⬜ | Cache API + stratégie Cache First |
| 11.2 | Mettre en cache tous les assets statiques à l'installation | ⬜ | HTML, CSS, JS, Leaflet, tuiles, données |
| 11.3 | Mettre en cache les tuiles cartographiques IGN | ⬜ | Limiter à l'emprise Baie de Saint-Malo |
| 11.4 | Stratégie de mise à jour (network-first au centre, cache en mer) | ⬜ | |
| 11.5 | Tester le mode offline (couper le réseau, recharger) | ⬜ | DevTools → Network → Offline |
| 11.6 | Afficher un bandeau "Mode offline" quand hors réseau | ⬜ | `navigator.onLine` event |

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

*Dernière mise à jour : 08/04/2026*
