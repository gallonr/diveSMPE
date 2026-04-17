# diveSMPE

Application de catalogue et d'aide à la navigation pour les sites de plongée du club **SMPE — Saint-Malo Plongée Emeraude**, couvrant la Baie de Saint-Malo.

---

## Concept

L'application repose sur deux mondes distincts :

- **Au centre de plongée** — un pipeline R/Python génère des fichiers statiques à partir de la base de données et des données LiDAR bathymétriques
- **En mer sur tablette** — une PWA consomme ces fichiers et fonctionne 100% offline

```
Modifier la BDD  →  Lancer build_all.R  →  Tablette sur WiFi centre  →  Ouvrir le navigateur  →  ✅ À jour
```

---

## Fonctionnalités

- Carte marine interactive (OSM + OpenSeaMap) avec les 60 sites de plongée
- Fiches sites : type, niveau, conditions, bathymétrie, profil de fond
- Miniatures MNT issues du LiDAR LITTO3D (44 sites couverts)
- Transect bathymétrique libre (clic-clic sur la miniature)
- Marées en temps réel : PM/BM, coefficient, hauteur actuelle, courbe J-1/J+2
- Indicateur d'étale et fenêtre de plongée optimale par site
- Navigation GPS : cap, distance, ETA vers le site sélectionné
- Météo marine (Open-Meteo) si réseau disponible
- Mode offline natif via Service Worker — bandeau de statut réseau

---

## Architecture

```
diveSMPE/
├── r/                        # Scripts de preprocessing
│   ├── build_all.R           # Pipeline maître (lance tout)
│   ├── 01_process_las.R      # LiDAR → MNT, grilles Z, miniatures PNG
│   ├── 02_process_bdd.R      # XLSX → GeoJSON sites
│   ├── 03_generate_profile.R # Profils bathymétriques + transects
│   └── 04_marees_fes.py      # FES2022 → tables de marées JSON
├── bdd/
│   └── bddAtlasPlongeeSMPE.xlsx  # Base de données des sites
├── data/                     # Fichiers générés par R
│   ├── sites.geojson         # 60 sites (WGS84)
│   ├── bathy_sites.json      # Grilles Z + profils (44 sites LiDAR)
│   ├── marees.json           # PM/BM ±1 an (FES2022)
│   └── constituantes_stmalo.json  # 34 constituantes harmoniques
├── pwa/                      # Application web offline-first
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                 # Service Worker
│   ├── css/style.css
│   ├── js/                   # Modules JS (carte, sites, marées, bathy, GPS…)
│   ├── data/                 # Copie des fichiers statiques + miniatures PNG
│   └── libs/                 # Leaflet 1.9.4 + Turf.js 6.5.0 (offline)
└── las/                      # Données LiDAR brutes (~3,8 Go, non commitées)
    └── LITTO3D_BaieSaintMalo.las
```

---

## Stack technique

| Couche | Outils |
|--------|--------|
| Preprocessing | R (`lidR`, `terra`, `sf`, `readxl`), Python (`pyfes`) |
| Marées | Modèle FES2022 (CNES/LEGOS) — 34 constituantes harmoniques |
| Bathymétrie | LiDAR LITTO3D IGN — 206 M points, résolution MNT 5m |
| Carte | Leaflet.js 1.9.4 + Turf.js + OSM + OpenSeaMap |
| Offline | Service Worker (Cache First) |
| Météo | Open-Meteo API (sans clé) |
| Frontend | Vanilla JS — pas de framework |

---

## Utilisation

### Générer les données (centre de plongée)

```r
# Depuis R, à la racine du projet
source("r/build_all.R")
```

Prérequis : R ≥ 4.3, packages `lidR`, `terra`, `sf`, `readxl`, `jsonlite` — Python avec `pyfes` pour les marées.

### Servir la PWA (développement)

```bash
cd pwa && npx http-server -p 8080
```

### Servir via nginx (production centre)

```bash
# Pointer nginx vers le dossier pwa/
sudo nginx -s reload
```

Le Service Worker requiert HTTPS ou localhost. Pour le déploiement local en réseau, un certificat auto-signé est nécessaire.

---

## Données sources

| Fichier | Description |
|---------|-------------|
| `bdd/bddAtlasPlongeeSMPE.xlsx` | 60 sites de plongée, 15 champs par site |
| `las/LITTO3D_BaieSaintMalo.las` | LiDAR bathymétrique IGN, ~3,8 Go (non commité) |
| `fes2022/` | Atlas FES2022 (AVISO/CNES), ~34 fichiers .nc.xz (non commité) |

---

## Avancement

| Phase | Description | Statut |
|-------|-------------|--------|
| 0–1 | Initialisation + exploration données | ✅ |
| 2 | R : BDD → GeoJSON | ✅ |
| 3 | R : LiDAR → Bathymétrie | ✅ |
| 4 | Marées FES2022 | ✅ |
| 5 | Pipeline build R | ✅ |
| 6–11 | PWA : carte, fiches, GPS, marées, météo, offline | ✅ |
| 12 | Serveur nginx centre de plongée | ⬜ |
| 13 | Tests terrain | ⬜ |
| 14 | Documentation utilisateur | ⬜ |

---

*Club SMPE — Saint-Malo Plongée Emeraude — Baie de Saint-Malo*
