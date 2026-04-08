# CLAUDE.md — Catalogue Sites de Plongée SMPE

## Description du projet

Application de catalogue et d'aide à la navigation pour les sites de plongée du club **SMPE** (Saint-Malo Plongée Emeraude), couvrant la **Baie de Saint-Malo**. L'application est utilisée :
- **Au centre de plongée** (PC) : gestion de la base de données, preprocessing des données
- **En mer sur tablette** : consultation offline des sites, navigation, marées

---

## Architecture retenue : Approche B — R preprocessing + PWA offline-first ⭐

### Principe

Deux mondes distincts :
- **R (centre)** : preprocessing lourd une seule fois, génère des fichiers statiques
- **PWA (tablette en mer)** : consomme les fichiers statiques, fonctionne 100% offline

### Cycle de mise à jour
```
1. Modifier la BDD sur PC  →  2. Lancer script R  →  3. Tablette sur WiFi centre  →  4. Ouvrir le navigateur  →  ✅ Mis à jour
```

---

## Stack technique

### Preprocessing R (centre de plongée)
| Outil | Usage |
|-------|-------|
| `lidR`, `terra` | LAS 3,9 Go → GeoTIFF tuilé + profils bathymétriques |
| `sf`, `jsonlite` | XLSX sites → GeoJSON |
| `readxl`, `httr2` | Lecture BDD Excel, requêtes API |
| Calcul marées SHOM | Tables JSON pré-calculées ±365 jours |

### Frontend PWA (tablette en mer)
| Outil | Usage |
|-------|-------|
| `Leaflet.js` | Carte marine IGN/SHOM + affichage des sites |
| `Turf.js` | Calculs géospatiaux dans le navigateur |
| `Geolocation API` | GPS temps réel, ETA, cap |
| `Service Worker` | Offline natif, mise à jour automatique sur WiFi |
| `Météo-France API` | Données marines si 4G disponible |
| Vanilla JS | Pas de framework — simplicité et maintenabilité |

### Cartes marines
- **IGN Géoportail WMS** — fond cartographique officiel
- **OpenSeaMap** — overlay nautique

### Serveur local (centre)
- `nginx` ou `http-server` (PC du centre, allumé en permanence)

---

## Données sources

| Fichier | Description | Taille |
|---------|-------------|--------|
| `bdd/bddAtlasPlongeeSMPE.xlsx` | Base de données des sites de plongée | ~15 Ko |
| `las/LITTO3D_BaieSaintMalo.las` | Données LiDAR bathymétriques LITTO3D — Baie de Saint-Malo | ~3,8 Go |

---

## Structure cible du projet

```
CatalogueSitePlongée/
├── CLAUDE.md                   # Ce fichier
├── bdd/
│   └── bddAtlasPlongeeSMPE.xlsx  # Base de données sites
├── las/
│   └── LITTO3D_BaieSaintMalo.las # Données LiDAR brutes
├── r/
│   ├── 01_process_las.R          # Traitement LiDAR → GeoTIFF/tuiles
│   ├── 02_process_bdd.R          # XLSX → GeoJSON sites
│   ├── 03_marees.R               # Calcul tables de marées SHOM
│   └── build_all.R               # Script maître (lance tout)
├── data/                         # Fichiers générés par R (gitignorés si volumineux)
│   ├── sites.geojson
│   ├── marees.json
│   └── tiles/                    # Tuiles MNT
└── pwa/
    ├── index.html
    ├── manifest.json
    ├── sw.js                     # Service Worker
    ├── css/
    ├── js/
    └── data/                     # Copie des fichiers statiques pour la PWA
```

---

## Commandes utiles

### Lancer le preprocessing R complet
```r
source("r/build_all.R")
```

### Servir la PWA en local (développement)
```bash
cd pwa && npx http-server -p 8080
```

### Servir via nginx (production centre)
```bash
# Config nginx pointant vers /pwa
sudo nginx -s reload
```

---

## Contexte métier

- **Club** : SMPE — Saint-Malo Plongée Emeraude
- **Zone** : Baie de Saint-Malo (Manche, Bretagne Nord)
- **Utilisateurs** : moniteurs et plongeurs du club
- **Contrainte principale** : fonctionnement **offline en mer** (pas ou peu de réseau 4G)
- **Mise à jour** : réalisée au centre, synchronisée sur WiFi avant de partir en mer

---

## Notes pour Claude

- L'utilisateur maîtrise **R** (lidR, terra, sf) — c'est son domaine principal
- Le **frontend JS** (Leaflet, Service Worker) est nouveau — privilégier Vanilla JS simple
- **Éviter React/Vue/Angular** — trop complexe à maintenir pour ce contexte
- Les scripts R de preprocessing peuvent être longs (~minutes pour le LAS)
- Le fichier LAS (~3,8 Go) ne doit jamais être commité dans git
- Toujours tester le mode offline de la PWA avant livraison
