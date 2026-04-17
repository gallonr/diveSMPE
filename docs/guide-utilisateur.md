# Guide utilisateur — SMPE Plongée

Application de catalogue et d'aide à la navigation pour les sites de plongée de la Baie de Saint-Malo.

---

## Installer l'application sur la tablette

L'application fonctionne dans le navigateur — **Chrome** est recommandé sur Android.

1. Connecter la tablette au **WiFi du centre** de plongée
2. Ouvrir Chrome et aller à l'adresse fournie par le responsable (ex. `http://192.168.1.10`)
3. Chrome propose d'installer l'application : appuyer sur **"Ajouter à l'écran d'accueil"**
4. L'icône SMPE apparaît sur l'écran — l'application est prête à être utilisée hors ligne

> Une fois installée, l'application fonctionne **sans réseau**. Il suffit de la mettre à jour avant chaque sortie en se connectant au WiFi du centre.

---

## L'écran principal

```
┌─────────────────────────────────────────┐
│ ☰  SMPE Plongée   10:32   📍 🗓 🌊 🌬  │  ← Barre d'outils
├─────────────────────────────────────────┤
│  3,45 m  |  BM 11h20 (0,85 m)  |  C 98 │  ← Bandeau marées
├─────────────────────────────────────────┤
│                                         │
│           Carte interactive             │
│                                         │
│  ● Sites de plongée                     │
│                                         │
└─────────────────────────────────────────┘
```

### Barre d'outils (haut de l'écran)

| Bouton | Fonction |
|--------|----------|
| **☰** | Ouvrir la liste des sites |
| **📍** | Centrer la carte sur votre position GPS |
| **🗓** | Prévision plongeabilité (choisir une date/heure) |
| **🌊** | Courbe de marée (J-1 à J+2) |
| **🌬** | Météo marine (nécessite le réseau) |

### Bandeau marées (toujours visible)

Affiche en permanence :
- La **hauteur d'eau actuelle** (en mètres, mise à jour toutes les minutes)
- La **prochaine PM ou BM** (heure + hauteur)
- Le **coefficient de marée** du jour
- Un indicateur **"Étale dans Xmin"** quand on approche de l'étale (±2h)

---

## Trouver un site

### Depuis la carte

Les sites sont affichés par des marqueurs colorés selon leur type :
- 🪸 **Récif** — marqueur vert
- ⚓ **Épave** — marqueur rouge
- 🪨 **Roche** — marqueur gris

Appuyer sur un marqueur pour ouvrir la fiche du site.

### Depuis la liste

1. Appuyer sur **☰** en haut à gauche
2. Utiliser la **barre de recherche** (nom du site)
3. Filtrer par type : **Tous / Récif / Épave / Roche**
4. Filtrer par profondeur : **≤ 6 m / ≤ 10 m / ≤ 20 m / +20 m**

Chaque site dans la liste affiche un **badge coloré** indiquant si la plongée est possible maintenant :

| Couleur | Signification |
|---------|---------------|
| 🟢 Vert | Fenêtre de plongée active |
| 🟠 Orange | Fenêtre dans moins de 2h |
| 🔴 Rouge | Hors fenêtre de plongée |
| ⚪ Gris | Pas d'information marée pour ce site |

---

## Fiche site

La fiche s'ouvre en bas de l'écran (mobile) ou sur la droite (tablette en paysage). Elle contient trois onglets.

### Onglet Infos

- **Type de plongée**, niveau requis, accessibilité, mouillage
- **Bloc marée** : fenêtre de plongée optimale avec l'heure et le statut
- **Profondeurs actuelles** (si données LiDAR disponibles) : profondeur min/max corrigée avec la hauteur de marée en cours
- **Commentaire** du responsable technique

#### Saisir les horaires de plongée

Deux champs permettent de saisir l'heure de début et de fin de plongée. La durée est calculée automatiquement.

### Onglet Bathymétrie

Affiche la carte de fond du site issue du LiDAR LITTO3D (données IGN, résolution 5 m).

**Miniature MNT** — vue de dessus colorée selon la profondeur (bleu foncé = profond).

**Profil bathymétrique** — coupe Est→Ouest du fond, avec les profondeurs en mètres (zéro hydrographique).

#### Tracer un transect libre

1. Appuyer sur **✏️ Tracer un transect**
2. Cliquer le **point A** sur la miniature
3. Cliquer le **point B** sur la miniature
4. Le profil se recalcule selon cet axe
5. Appuyer sur **↺ Défaut** pour revenir au transect Est→Ouest

**Opacité de l'overlay** — le curseur permet de superposer la bathymétrie sur la carte en réglant la transparence.

### Onglet Conditions

- **Accès vent** : orientations de vent à éviter
- **Houle** : sensibilité du site à la houle
- **Météo en temps réel** : vent, vagues, visibilité (si réseau disponible)

---

## Navigation GPS

### Activer le GPS

Appuyer sur **📍** dans la barre d'outils. La carte se centre sur votre position et un marqueur pulsant vert apparaît.

### Naviguer vers un site

1. Ouvrir la fiche d'un site
2. Appuyer sur **🧭 Naviguer vers ce site**
3. Un HUD de navigation apparaît en bas de la carte :

```
📍  48°41.2'N  /  2°02.1'W
CAP          VITESSE        DIST. SITE
247°         6 kt           1,2 Nm
```

- **Cap** : direction à suivre vers le site (degrés magnétiques)
- **Vitesse** : vitesse GPS détectée (ou 6 nœuds par défaut)
- **Distance** : distance au site en milles nautiques

Une ligne verte pointillée relie votre position au site sur la carte.

---

## Marées

Appuyer sur **🌊** pour ouvrir la fenêtre marées.

- **Courbe graphique** sur 4 jours (J-1 à J+2) avec l'heure actuelle indiquée
- **Tableau PM/BM** : horaires, hauteurs et coefficients

Les hauteurs sont exprimées en mètres au-dessus du **zéro hydrographique** (ZH SHOM Saint-Malo), calculées à partir du modèle FES2022 (CNES/LEGOS).

---

## Prévision plongeabilité

Appuyer sur **🗓** pour simuler les conditions à une date et heure futures.

1. Choisir une **date**
2. Choisir une **heure**
3. Appuyer sur **Calculer**

L'application affiche :
- La hauteur de marée prévue à ce moment
- La liste des **sites plongeables** à cette heure (fenêtre marée compatible)

Utile pour préparer une sortie plusieurs jours à l'avance.

---

## Météo marine

Appuyer sur **🌬** pour ouvrir la météo (nécessite le réseau 4G ou WiFi).

Données fournies par **Open-Meteo** pour la Baie de Saint-Malo :
- Vent : direction et force (nœuds)
- Vagues : hauteur significative, direction
- Visibilité

En l'absence de réseau, le message "Météo non disponible offline" s'affiche.

---

## Mode hors ligne

Dès que l'application a été ouverte une fois sur WiFi, elle fonctionne **sans réseau** :

- Carte, sites, marées, bathymétrie → disponibles offline
- Météo → non disponible offline
- Un bandeau orange **"Mode hors-ligne — données locales"** s'affiche en haut de l'écran

### Mettre à jour l'application avant une sortie

1. Se connecter au WiFi du centre de plongée
2. Ouvrir l'application dans Chrome
3. Laisser charger quelques secondes — la mise à jour se fait automatiquement en arrière-plan
4. Fermer et rouvrir l'application pour appliquer la mise à jour

---

## Questions fréquentes

**Les profondeurs affichées sont-elles exactes ?**
Les cotes de fond sont issues du LiDAR LITTO3D (IGN), avec une résolution de 5 m. La profondeur affichée dans l'onglet Infos intègre la hauteur de marée actuelle (modèle FES2022 calibré sur l'annuaire SHOM). Tolérance : ±20 cm sur la marée, ±0,5 m sur le fond.

**15 sites n'ont pas de miniature bathymétrique — pourquoi ?**
Le fichier LiDAR disponible ne couvre pas l'ensemble de la baie. Ces sites sont en dehors de l'emprise des données LITTO3D.

**L'heure de l'étale ne correspond pas à celle du SHOM.**
Le modèle FES2022 a une précision de ±5 minutes sur les horaires. Pour des plongées techniques, se référer à l'annuaire officiel SHOM.

**La carte ne charge plus les tuiles OSM/OpenSeaMap.**
Normal en mode offline — seules les tuiles déjà consultées sont mises en cache. Parcourir la zone en WiFi avant la sortie pour pré-charger les tuiles.
