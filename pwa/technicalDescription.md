# Description technique — Dossier `pwa/`

> Application web installable (PWA) « SMPE Plongée » — Catalogue des sites de plongée de la Baie de Saint-Malo.  
> Accès réservé aux membres du club SMPE. Fonctionne entièrement hors-ligne après la première visite.

---

## Vue d'ensemble

| Aspect | Détail |
|---|---|
| Type | Progressive Web App (SPA, installable sur mobile) |
| Langue | Français |
| Authentification | Login local, hash SHA-256, session 6h (localStorage) |
| Offline | Service Worker — stratégie Cache First |
| Cartographie | Leaflet.js (copie locale) |
| Géométrie | Turf.js |
| Météo | Open-Meteo API (gratuit, sans clé) |
| Marées | Données FES2022 pré-calculées (fichier JSON annuel) |
| Bathymétrie | LiDAR LITTO3D (profils transects générés par les scripts R) |
| Fonds de carte | OSM, ESRI Ocean, IGN Plan V2, SHOM, OpenSeaMap |

---

## Arborescence

```
pwa/
├── index.html              # Page unique (SPA)
├── manifest.json           # Manifeste PWA
├── sw.js                   # Service Worker
├── technicalDescription.md # Ce fichier
├── css/
│   └── style.css           # Styles globaux (1 539 lignes)
├── js/
│   ├── config.js           # Configuration globale
│   ├── app.js              # Point d'entrée et orchestrateur
│   ├── auth.js             # Authentification locale
│   ├── carte.js            # Carte Leaflet
│   ├── sites.js            # Gestion des sites (liste + fiches)
│   ├── marees.js           # Données et affichage marées
│   ├── mareesite.js        # Moteur plongeabilité par site
│   ├── navigation.js       # GPS, cap et distance
│   ├── meteo.js            # Météo marine Open-Meteo
│   ├── bathy.js            # Bathymétrie LiDAR
│   ├── prevision.js        # Prévision de plongeabilité
│   └── port.js             # Gestion port (seuil + bateaux)
├── data/
│   ├── sites.geojson       # Catalogue des sites (GeoJSON)
│   ├── marees.json         # Prédictions marée FES2022 (annuel)
│   ├── bathy_sites.json    # Profils LiDAR par site
│   └── thumbs/             # Miniatures photographiques des sites
├── libs/
│   ├── leaflet/            # Leaflet.js + CSS + images (local)
│   └── turf/               # Turf.js (local)
└── icons/                  # Icônes PWA (192px, 512px) + logo login
```

---

## Fichiers racine

### `index.html` *(415 lignes)*

Page HTML unique de l'application (SPA). Définit la structure complète :

- **Écran de login** — formulaire identifiant / mot de passe avec gestion d'erreur
- **Bandeau offline** — affiché automatiquement quand le réseau est absent
- **Header fixe** — bouton menu ☰, titre, horloge locale, boutons GPS 📍 et Prévision 🗓
- **Panneau latéral gauche** — liste des sites avec :
  - filtres par type (récif 🪸, épave ⚓, roche 🪨)
  - filtre par profondeur (< 10 m, < 20 m, toutes)
  - champ de recherche textuelle
- **Carte Leaflet** — conteneur `#map` plein écran
- **Widget port flottant** — état d'accès au port en temps réel
- **HUD navigation** — cap, distance, coordonnées GPS en degrés/minutes/secondes
- **Fiche site** (modale) — 4 onglets :
  - *Description* : caractéristiques, galerie miniatures
  - *Marée* : état de plongeabilité, fenêtre de plongée
  - *Bathymétrie* : profil LiDAR, mode transect libre
  - *Conditions* : météo marine courante
- **Modale Prévision** — sélection date/heure, liste triée des sites plongeables, mini-courbe marée, créneaux bateaux
- Chargement des modules JS dans l'ordre de dépendance : `config` → libs → modules → `app`

### `manifest.json`

Manifeste PWA standard (W3C). Paramètres :

| Clé | Valeur |
|---|---|
| `name` | SMPE — Sites de Plongée |
| `short_name` | SMPE Plongée |
| `display` | standalone |
| `theme_color` | #0c3e44 |
| `background_color` | #031F1B |
| `start_url` | ./index.html |
| `lang` | fr |
| Icônes | 192×192 et 512×512 (maskable) |

Permet l'installation sur l'écran d'accueil Android/iOS et le lancement sans chrome navigateur.

### `sw.js` *(216 lignes)* — Service Worker v8

Stratégie **Cache First** pour les assets statiques, **Network First** pour les ressources dynamiques.

**Configuration :**
- `CACHE_STATIC` : cache versionné `smpe-static-v8` pour les assets fixes
- `CACHE_DYNAMIC` : cache versionné `smpe-dynamic-v8` pour les tuiles cartographiques (limite : 300 entrées)

**Cycle de vie :**

| Événement | Comportement |
|---|---|
| `install` | Met en cache tous les `ASSETS_STATIQUES` (HTML, CSS, JS, données, icônes). Tolérant aux erreurs individuelles. Active immédiatement (`skipWaiting`). |
| `activate` | Supprime tous les anciens caches non reconnus. Prend le contrôle immédiat (`clients.claim`). Notifie les clients (`SW_UPDATED`). |
| `fetch` | Sert depuis le cache si disponible. Sinon fetch réseau + mise en cache dynamique avec LRU (300 entrées max). |

**Assets mis en cache à l'installation :**
```
/, index.html, manifest.json, css/style.css,
js/config.js, js/marees.js, js/mareesite.js, js/bathy.js,
js/carte.js, js/sites.js, js/navigation.js, js/meteo.js,
js/auth.js, js/app.js,
data/sites.geojson, data/marees.json, data/bathy_sites.json,
libs/leaflet/leaflet.css, libs/leaflet/leaflet.js,
libs/turf/turf.min.js,
icons/icon-192.png, icons/icon-512.png, icons/logo-smpe.png
```

---

## Styles — `css/style.css` *(1 539 lignes)*

Feuille de style principale de l'application.

- **Variables CSS** — palette de couleurs marine sombre (fond `#031F1B`, accent `#0c3e44`, texte clair)
- **Typographie** — Google Fonts : Oswald (titres) + Signika (corps), chargées en `preconnect`
- **Layout** — header fixe, panneau latéral rétractable, carte plein écran, z-index cohérents
- **Composants couverts :**
  - Écran de login (card centré, responsive)
  - Liste de sites et badges de type (`.badge-recif`, `.badge-epave`, `.badge-roche`)
  - Marqueurs Leaflet colorés par statut marée
  - Fiches sites et système d'onglets
  - HUD navigation (overlay semi-transparent)
  - Widget port flottant
  - Modales Prévision
  - Canvas bathymétrie et transect
  - Bandeau offline
  - Slider d'opacité overlay MNT
- **Responsive** — optimisé mobile (viewport fixé, no user-scalable)

---

## Modules JavaScript — `js/`

### `config.js` *(111 lignes)*

**Configuration globale** exposée dans l'objet `CONFIG`. Seul fichier à modifier pour adapter l'application à un autre club/zone.

```javascript
CONFIG.DATA       // chemins vers les 3 fichiers de données
CONFIG.CARTE      // centre (Baie de Saint-Malo), zooms min/max
CONFIG.TILES      // 5 fonds cartographiques avec URL et attributions
CONFIG.NAV        // vitesse bateau (6 nœuds), GPS continu
CONFIG.MAREES     // calibration FES2022 → ZH SHOM (MSL_SCALE, MSL_OFFSET_M)
CONFIG.PORT       // seuil d'entrée (2.0 m ZH) + tirants d'eau bateaux
CONFIG.METEO      // coordonnées Saint-Malo, timeout API
CONFIG.TYPE_SITE  // mapping type → badge CSS + emoji
```

**Calibration marées FES2022 → Zéro Hydrographique SHOM Saint-Malo :**
```
h_ZH (m) = hcm/100 × MSL_SCALE + MSL_OFFSET_M
         = hcm/100 × 0.9822     + 6.5278
```
Calibration OLS sur 27 points annuaire SHOM (17–23/04/2026). RMS résidus = 0.16 m.

Déclare également `SW_CACHE_VERSION = 'smpe-v9'` (à incrémenter à chaque mise à jour forcée du cache).

---

### `app.js` *(217 lignes)*

**Point d'entrée et orchestrateur.** Module `App` appelé au `DOMContentLoaded` après vérification d'authentification.

**Séquence d'initialisation :**
1. Démarrage de l'horloge locale (mise à jour toutes les secondes)
2. `Carte.init()` — instanciation de la carte Leaflet
3. `Marees.init()` — chargement et affichage du bandeau marée
4. `Bathy.init()` — chargement silencieux des profils LiDAR
5. `Sites.init()` → `Carte.afficherSites()` — chargement GeoJSON et marqueurs
6. `Navigation.demarrerGPS()` — suivi GPS en arrière-plan
7. `Sites.initOnglets()` — liaison des onglets de fiche
8. `Prevision.init()` — module prévision
9. `Port.init()` — widget port + créneaux bateaux
10. `_bindEvents()` — tous les événements UI (filtres, recherche, boutons, modales)
11. `_monitorOnline()` — surveillance connectivité (bandeau offline)

**Callback `_onSiteSelectionne(feature)` :**
- Centre la carte sur le site
- Active l'overlay LiDAR correspondant
- Charge la météo du site
- Met à jour le HUD navigation (distance live sans activer la navigation)
- Affiche le bouton « Naviguer »

---

### `auth.js` *(107 lignes)*

**Authentification locale côté client** (pas de serveur).

| Paramètre | Valeur |
|---|---|
| Login valide | `smpe` |
| Vérification | Hash SHA-256 via Web Crypto API |
| Stockage session | `localStorage` (clé `smpe_auth`) |
| Durée session | 6 heures (persiste après fermeture de l'onglet) |

**Fonctions exposées :**
- `Auth.isAuthenticated()` — vérifie si la session est encore valide
- `Auth.login(login, password)` — calcule le hash et compare, stocke la session si OK
- `Auth.logout()` — supprime la session et recharge la page

> Pour changer le mot de passe : calculer `SHA-256("nouveauMotDePasse")` et remplacer `HASH_PASSWORD`.

---

### `carte.js` *(255 lignes)*

**Module Leaflet** — initialisation et contrôle de la carte interactive.

**Fonds de carte disponibles (contrôle de couches) :**
| Couche | Source |
|---|---|
| OSM | OpenStreetMap (fallback universel) |
| ESRI Ocean | ESRI Ocean Basemap + Ocean Reference (groupe) |
| IGN Plan V2 | Géoportail WMTS (sans clé) |
| SHOM | Cartes littorales SHOM/IGN (Géoportail, sans clé) |
| OpenSeaMap | Overlay nautique (marqueurs marins) |

**Fonctions principales :**
- `Carte.init()` — instanciation + couches + contrôle layers
- `Carte.afficherSites(geojson, callback)` — marqueurs colorés par type et état marée
- `Carte.majEtatsMaree(map)` — met à jour la couleur de chaque marqueur
- `Carte.afficherGPS(lat, lon)` — marqueur GPS avec cercle de précision
- `Carte.centrerSurSite(lat, lon)` — zoom doux sur un site
- `Carte.toggleOverlayBathy(siteID)` — superpose l'image MNT LiDAR avec slider d'opacité
- `Carte.ajouterWidgetPort(el)` — insère le widget port sur la carte

---

### `sites.js` *(592 lignes)*

**Module central des sites** — le plus volumineux de l'application.

**Données :**
- Charge `sites.geojson` au démarrage
- Rafraîchit les états marée toutes les **60 secondes**

**Liste des sites :**
- Rendu HTML de la liste filtrée
- Filtres cumulables : type + profondeur + recherche textuelle
- Badge coloré par état marée (vert/orange/rouge/gris)
- Clic → sélection du site + ouverture fiche

**Fiche détaillée (modale) — 4 onglets :**

| Onglet | Contenu |
|---|---|
| Description | Nom, type, profondeur, coefficient marée, texte descriptif, galerie miniatures |
| Marée | État de plongeabilité (feux vert/orange/rouge), prochaine fenêtre, détail du code marée |
| Bathymétrie | Canvas profil LiDAR (profMin/profMax en fonction de la marée actuelle), mode transect libre |
| Conditions | Météo marine courante (via `Meteo.chargerPourSite()`) |

**Mode transect libre :**
- Permet de cliquer 2 points sur la carte pour définir un transect personnalisé
- Calcule et affiche le profil de fond sur ce transect à partir des données LiDAR

---

### `marees.js` *(385 lignes)*

**Module marées** — lit les données FES2022 pré-calculées.

**Format `marees.json` attendu (entrée journalière) :**
```json
{
  "PM1_h": "07:55",    "PM1_coeff": 98,   "PM1_hcm": 660,
  "BM1_h": "01:30",                        "BM1_hcm": -680,
  "PM2_h": "20:15",    "PM2_coeff": 96,   "PM2_hcm": 650,
  "BM2_h": "14:10",                        "BM2_hcm": -670
}
```

**Normalisation à l'init :**
```javascript
haut_m = hcm / 100 * CONFIG.MAREES.MSL_SCALE + CONFIG.MAREES.MSL_OFFSET_M
```

**Affichage header :**
- PM/BM suivants avec heure et coefficient
- Hauteur actuelle en temps réel (interpolation sinusoïdale)
- Courbe de marée du jour (canvas, mise à jour en direct)

**API exposée :**
- `Marees.init()` — chargement et démarrage du rafraîchissement
- `Marees.getAujourd()` — entrée marée du jour (utilisée par `MaréeSite` et `Prevision`)
- `Marees.getEntree(dateKey)` — entrée pour une date donnée

---

### `mareesite.js` *(392 lignes)*

**Moteur d'aide au choix de site** basé sur les codes marée du GeoJSON.

**Convention des codes marée (champ `maree_code` dans `sites.geojson`) :**
```
PMME_R15'   → Pleine Mer, Morte-Eau, Retard 15 min
BMVE_A2h30  → Basse Mer, Vive-Eau, Avance 2h30
PMVE_H      → Pleine Mer, Vive-Eau, à l'étale
```

| Segment | Signification |
|---|---|
| `PM` / `BM` | Pleine Mer / Basse Mer |
| `ME` / `VE` | Morte-Eau (coeff ≤ 70) / Vive-Eau (coeff > 70) |
| `R` / `A` / `H` | Retard / Avance / à l'Heure (étale) |
| durée | Minutes (`15'`) ou heures (`2h30`) |

**Résultats de statut :**
| Statut | Condition |
|---|---|
| 🟢 `vert` | Dans la fenêtre de plongée maintenant |
| 🟠 `orange` | Fenêtre dans moins de 2 heures |
| 🔴 `rouge` | Fenêtre passée ou trop loin |
| ⚫ `gris` | Données insuffisantes (pas de code ou pas de marées) |

**API exposée :**
- `MaréeSite.calculer(properties, entreeMaree)` — statut d'un site
- `MaréeSite.calculerTous(geojson, entreeMaree)` — `Map<siteID, statut>` pour tous les sites

---

### `navigation.js` *(245 lignes)*

**Module GPS et navigation vers un site.**

**GPS :**
- `Navigation.demarrerGPS()` — `watchPosition` avec haute précision, timeout 15 s, âge max 5 s
- `Navigation.arreterGPS()` — libère le watch
- Met à jour le marqueur sur la carte à chaque position reçue

**HUD navigation (overlay) :**
- Coordonnées en degrés/minutes/secondes (DMS) — lat N/S, lon E/W
- Distance au site en mètres (< 1 km) ou km
- Cap en degrés vers le site (calculé via `turf.bearing`)
- Bouton « Naviguer » → active l'affichage du trait de cap sur la carte

**API exposée :**
- `Navigation.setSiteDestination(feature)` — définit le site cible (distance live sans navigation active)
- `Navigation.demarrerNavigation()` / `Navigation.arreterNavigation()`

---

### `meteo.js` *(201 lignes)*

**Module météo marine** via l'API [Open-Meteo](https://open-meteo.com) (gratuit, sans clé).

**Variables récupérées :**

| Catégorie | Variables |
|---|---|
| Courante | Température, code météo WMO, vent (vitesse, direction, rafales), visibilité |
| Marine | Hauteur de houle significative, période, direction, température mer |

**Optimisations :**
- Cache en mémoire TTL 30 minutes (évite les requêtes répétées lors de changements d'onglet)
- Partage du cache si les coordonnées du site sont proches

**Décodage WMO :** 20 codes couverts (ciel dégagé → orage avec grêle), affichés avec emoji.

**API exposée :**
- `Meteo.chargerPourSite(lat, lon)` — déclenche la requête et rend l'onglet Conditions

---

### `bathy.js` *(283 lignes)*

**Module bathymétrie LiDAR LITTO3D.**

**Source des données :** `data/bathy_sites.json` — généré par `r/01_process_las.R` depuis les fichiers LAS bruts.

**Structure d'une entrée `bathy_sites.json` :**
```json
{
  "siteID": "site-001",
  "profMin": -18.5,
  "profMax": -2.1,
  "transect": {
    "dist_m": [0, 5, 10, ...],
    "z_m": [-2.1, -5.3, -10.2, ...]
  }
}
```

**Rendu canvas (`Bathy.dessiner`) :**
- Axes distance (m) et profondeur (m ZH)
- Courbe de fond colorée (gradient bleu/cyan)
- Trait horizontal de niveau de marée actuelle (bleu clair)
- Profondeurs relatives à la marée affichées

**API exposée :**
- `Bathy.init()` — chargement du JSON
- `Bathy.get(siteID)` — données brutes d'un site
- `Bathy.dessiner(canvas, siteID, hMaree)` — rendu du profil

---

### `prevision.js` *(344 lignes)*

**Module Prévision de plongeabilité** (modale dédiée).

**Fonctionnement :**
1. L'utilisateur sélectionne une **date** et une **heure**
2. Le module récupère l'entrée marée de `marees.json` pour cette date
3. Interpole la hauteur de marée à l'heure choisie (même algorithme que `marees.js`)
4. Appelle `MaréeSite.calculerTous()` avec un objet marée fictif à cet instant
5. Affiche les sites **triés** : vert → orange → rouge → gris
6. Affiche la **mini-courbe de marée** avec un repère à l'heure choisie (canvas)
7. Affiche les **créneaux port** pour chaque bateau (via `Port.creneauxJour()`)

**API exposée :**
- `Prevision.init()` — liaison des contrôles UI de la modale

---

### `port.js` *(248 lignes)*

**Module port** — franchissement du seuil selon marée et tirant d'eau.

**Condition d'accès :**
```
hauteur_maree (m ZH) ≥ CONFIG.PORT.seuilZH + tirant_bateau
```

**Bateaux configurés (`CONFIG.PORT.bateaux`) :**
| Bateau | Tirant d'eau |
|---|---|
| Maclow | 1.3 m |
| Cassiopée | 1.1 m |
| Neptune | 0.7 m |

**Widget flottant (carte) :**
- Affiche l'état d'accès en temps réel (🟢 accessible / 🔴 bloqué)
- Hauteur actuelle vs hauteur minimale requise

**Section Prévision :**
- Reconstruit la courbe de hauteur journalière (pas 5 min, interpolation sinusoïdale)
- Calcule les plages horaires ouvertes/fermées pour chaque bateau
- Affiche sous forme de blocs temporels colorés

**API exposée :**
- `Port.init()` — initialisation widget + liaison Prévision
- `Port.majWidget()` — mise à jour en temps réel du widget carte
- `Port.creneauxJour(entree)` — calcule les créneaux de la journée

---

## Données — `data/`

### `sites.geojson`

GeoJSON de type `FeatureCollection`. Chaque feature représente un site de plongée.

**Propriétés attendues par l'application :**

| Champ | Type | Description |
|---|---|---|
| `siteID` | string | Identifiant unique du site |
| `nom` | string | Nom du site |
| `type` | string | `récif`, `épave` ou `roche` |
| `profMin` | number | Profondeur minimale (m) |
| `profMax` | number | Profondeur maximale (m) |
| `maree_code` | string | Code(s) de plongeabilité (ex. `PMME_R15'/BMVE_A2h30`) |
| `description` | string | Texte descriptif libre |
| `photos` | array | Liste de noms de fichiers miniatures (dossier `thumbs/`) |

### `marees.json`

Objet JSON indexé par date ISO (`"YYYY-MM-DD"`). Généré par `r/04_marees_fes.py` (modèle FES2022).

Couvre l'année entière pour permettre le fonctionnement hors-ligne sur toute la saison.

**Structure d'une entrée :**
```json
"2026-04-20": {
  "PM1_h": "07:55",  "PM1_coeff": 98,  "PM1_hcm": 660,
  "BM1_h": "01:30",                     "BM1_hcm": -680,
  "PM2_h": "20:15",  "PM2_coeff": 96,  "PM2_hcm": 650,
  "BM2_h": "14:10",                     "BM2_hcm": -670
}
```

### `bathy_sites.json`

Tableau JSON de profils bathymétriques LiDAR par site. Généré par `r/01_process_las.R` depuis les fichiers LAS bruts LITTO3D de la Baie de Saint-Malo.

### `thumbs/`

Miniatures photographiques des sites (format JPEG/WebP), référencées par le champ `photos` du GeoJSON. Chargées dans l'onglet Description de la fiche site.

---

## Bibliothèques locales — `libs/`

### `leaflet/`
Copie locale de **Leaflet.js** (carte interactive). Inclus localement pour garantir le fonctionnement hors-ligne. Comprend :
- `leaflet.js` — bibliothèque principale
- `leaflet.css` — styles des composants Leaflet
- `images/` — icônes des marqueurs par défaut (marker-icon.png, marker-shadow.png, etc.)

### `turf/`
Copie locale de **Turf.js** (géométrie géospatiale). Utilisé dans `navigation.js` pour :
- `turf.bearing(from, to)` — calcul du cap en degrés
- `turf.distance(from, to)` — calcul de la distance en km

---

## Icônes — `icons/`

| Fichier | Usage |
|---|---|
| `icon-192.png` | Icône PWA (manifest, écran d'accueil Android) |
| `icon-512.png` | Icône PWA haute résolution (splash screen) |
| `logo-smpe.png` | Logo affiché sur l'écran de login |

---

## Flux de données

```
marees.json ──────────────────► marees.js ──► bandeau header
                                     │
                                     ├──────► mareesite.js ──► badges liste + onglet Marée
                                     │
                                     └──────► prevision.js ──► planning plongeabilité
                                                   │
                                              port.js ──────► widget port + créneaux

sites.geojson ──────────────────► sites.js ──► liste + fiches
                                     │
                                     └──────► carte.js ──────► marqueurs + overlay

bathy_sites.json ────────────────► bathy.js ──► canvas profil + overlay MNT carte

Geolocation API ─────────────────► navigation.js ──► HUD + trait de cap

Open-Meteo API ──────────────────► meteo.js ──────► onglet Conditions
```

---

## Dépendances entre modules JS

```
config.js          (aucune dépendance)
  └── marees.js    (config)
  └── mareesite.js (config, marees)
  └── bathy.js     (config)
  └── carte.js     (config, leaflet)
  └── sites.js     (config, carte, marees, mareesite, bathy, meteo)
  └── navigation.js(config, carte, turf)
  └── meteo.js     (config)
  └── prevision.js (config, marees, mareesite, sites, port)
  └── port.js      (config, marees)
  └── auth.js      (aucune dépendance)
  └── app.js       (tous les modules ci-dessus)
```

---

## Génération des données (scripts hors `pwa/`)

| Script | Produit | Destination |
|---|---|---|
| `r/01_process_las.R` | `bathy_sites.json` | `pwa/data/` |
| `r/04_marees_fes.py` | `marees.json` | `pwa/data/` |
| `r/02_process_bdd.R` | `sites.geojson` | `pwa/data/` |

Le script `sync_docs.sh` à la racine synchronise les fichiers du dossier `pwa/` vers `docs/` (déploiement GitHub Pages).
