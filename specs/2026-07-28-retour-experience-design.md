# Design — Formulaire retour d'expérience post-plongée

Date : 2026-07-28
Contexte : demande issue d'une réunion utilisateurs. Point #1 sur 3 (voir aussi le point #2 type de mouillage, déjà spécifié dans `2026-07-28-type-mouillage-design.md`, et le point #3 export marées xlsx).

## Problème

Après chaque plongée, on veut recueillir un retour d'expérience structuré (date, heures exactes de mise à l'eau et de sortie d'eau, état de la mer, vent, courant ressenti, bateau utilisé) afin de constituer, au fil du temps, une base de données exploitable pour affiner les fenêtres de plongée recommandées par site (actuellement dérivées uniquement du champ `tpsEtale`/`maree` saisi manuellement dans la BDD, cf. `mareesite.js`).

## Contexte d'usage (clarifié en brainstorming)

- **2 tablettes, une par bateau**, mais **3 bateaux** au total : Maclow, Cassiopée, Neptune.
- Les utilisateurs remplissent le plus souvent depuis leur **téléphone en 4G** (pas uniquement les tablettes offline des bateaux) — la connectivité est donc généralement disponible, avec des coupures possibles (4G inégale, cf. CLAUDE.md). Le formulaire doit fonctionner malgré une coupure ponctuelle, sans être conçu comme 100% offline-first.
- L'app n'a qu'**un seul login partagé** pour tout le club (`auth.js`) — pas de comptes individuels. L'identité du répondant est donc un champ texte libre optionnel, pas une authentification.

## Décisions d'architecture

### Stockage centralisé : Google Sheets

Les 2 tablettes/3 bateaux doivent alimenter une base commune. Choix retenu : **Google Sheets via Google Apps Script (Web App)**, plutôt qu'une vraie base SQL (Cloudflare D1) :
- Aucune base à administrer, schéma ou migrations à gérer.
- Données visibles/éditables directement dans un tableur — cohérent avec l'usage actuel du club (BDD sites en XLSX).
- Analyse ultérieure très simple depuis R (`googlesheets4::read_sheet()`), qui est le domaine de confort de l'utilisateur (cf. CLAUDE.md : "R est le domaine de l'utilisateur").

### Passage par le Worker Cloudflare existant (pas d'appel direct à Apps Script depuis le client)

Le projet a déjà un Cloudflare Worker (`cloudflare-worker/mf-wms-proxy.js`) qui sert à ne jamais exposer de secret côté client. On applique le même principe :

```
PWA (fetch POST JSON)
   ↓
Cloudflare Worker — nouvelle route /retour-experience
   ↓ (ajoute le secret Apps Script côté serveur, jamais exposé au client)
Google Apps Script Web App (doPost)
   ↓
Google Sheet "retours_plongee" (nouvelle ligne)
```

- Nouveau fichier ou extension de `mf-wms-proxy.js` : route `/retour-experience`, méthode POST, CORS restreint aux mêmes `ALLOWED_ORIGINS` déjà définis.
- Secret partagé (`APPSCRIPT_SECRET`) stocké en variable d'environnement Worker (comme `MF_TOKEN_PAAROME`/`MF_TOKEN_AROMEPI`), jamais dans le code client.
- Le Worker transmet le JSON reçu à l'URL Apps Script avec le secret en en-tête ; Apps Script vérifie le secret avant d'écrire dans le Sheet.

### Résilience réseau : file d'attente locale, pas de mode offline complet

- À la soumission : tentative d'envoi immédiat au Worker.
- En cas d'échec réseau : la soumission est mise en attente dans `localStorage` (clé dédiée, tableau JSON de soumissions en attente).
- Au chargement de l'app et sur l'évènement `online`, tentative automatique de vidage de la file d'attente.
- Un petit indicateur visuel signale s'il y a des soumissions en attente de synchronisation (ex. badge sur le bouton d'accès au formulaire).

## Modèle de champs du formulaire

| Champ | Type | Obligatoire | Détail |
|---|---|---|---|
| Site | Sélection parmi les sites du catalogue | Oui | Pré-rempli si ouvert depuis la fiche site ; sélection manuelle (recherche) si ouvert depuis le menu général |
| Date de la plongée | Date | Oui | Par défaut aujourd'hui, modifiable, pas de date future |
| Heure de mise à l'eau | Heure (HH:MM) | Oui | |
| Heure de sortie d'eau | Heure (HH:MM) | Oui | Doit être postérieure à l'heure de mise à l'eau (validation simple) |
| Bateau | Boutons : Maclow / Cassiopée / Neptune | Oui | |
| État de la mer | Boutons — échelle de Douglas (degrés 0-4, cf. ci-dessous) | Oui | |
| Vent | Boutons — échelle de Beaufort (regroupée, cf. ci-dessous) | Oui | |
| Courant ressenti | Boutons — 3 classes : Pas de courant / Modéré / Fort | Oui | Ressenti seulement, aucune mesure précise n'est demandée |
| Rempli par | Texte libre | Non | Nom du moniteur/plongeur, pour recontacter en cas de donnée à vérifier |
| Commentaire | Texte libre | Non | Visibilité, faune, incident mineur, tout ce que les champs structurés ne couvrent pas |

### Échelle état de mer (Douglas, degrés 0-4 pertinents en baie abritée)

| Bouton | Hauteur significative |
|---|---|
| 0 Calme | 0 m |
| 1 Ridée | 0 – 0,10 m |
| 2 Belle | 0,10 – 0,50 m |
| 3 Peu agitée | 0,50 – 1,25 m |
| 4 Agitée | 1,25 – 2,50 m |

### Échelle vent (Beaufort regroupé)

| Bouton | Vitesse |
|---|---|
| Calme / très léger (0-1) | 0 – 5 km/h |
| Léger / petite brise (2-3) | 6 – 19 km/h |
| Jolie brise / bonne brise (4-5) | 20 – 38 km/h |
| Vent frais et plus (6+) | > 39 km/h |

### Échelle courant

3 classes : **Pas de courant** / **Modéré** / **Fort** (ressenti par le plongeur, aucune valeur chiffrée saisie).

## Calculs automatiques à partir de l'heure saisie

Dès que site + date + heure de mise à l'eau (et/ou de sortie) sont renseignés, le formulaire calcule et affiche automatiquement, **côté client**, en réutilisant les données marées déjà chargées offline (`data/marees.json` via le module `marees.js`) :

- **Hauteur d'eau** à l'heure de mise à l'eau et à l'heure de sortie d'eau — via `Marees.getHauteurAt(date)` (existe déjà, prend une `Date` JS quelconque et interpole sinusoïdalement).
- **Coefficient du jour** — présent dans l'entrée retournée par `Marees.getEntreePourDate(date)` (`PM1_coeff`/`PM2_coeff`).
- **Durée avant/après l'étale** (pleine mer ou basse mer la plus proche), pour l'heure de mise à l'eau et pour l'heure de sortie d'eau séparément.

### Nouvelle fonction publique dans `marees.js`

`mareesite.js` (`MaréeSite`) est spécialisé dans l'évaluation de compatibilité avec le code marée du site (`PMME_R15'` etc.), pas dans le calcul brut de proximité à l'étale la plus proche. On ajoute donc une fonction dédiée et réutilisable dans `marees.js` plutôt que de dupliquer le parsing d'heures :

```js
/**
 * Étale (PM ou BM) la plus proche d'une heure donnée.
 * Retourne { type: 'PM'|'BM', heure: 'HH:MM', coeff, deltaMin, avantApres: 'avant'|'après'|'à l'étale' }
 * ou null si les données marée du jour sont absentes.
 */
function getEtaleProche(date) { ... }
```

Cette fonction est ajoutée à l'objet retourné par le module (`return { init, ouvrirModal, ..., getEtaleProche }`).

Ces valeurs calculées sont affichées en lecture seule dans le formulaire (rappel visuel pour l'utilisateur) **et** envoyées avec la soumission, pour que l'analyse R n'ait pas à recalculer l'interpolation marée a posteriori.

## Schéma de données envoyées (ligne Google Sheet "retours_plongee")

| Colonne | Origine |
|---|---|
| timestampSoumission | Généré à l'envoi |
| datePlongee | Saisie |
| siteID, siteNom | Saisie (sélection site) |
| bateau | Saisie |
| rempliPar | Saisie (optionnel) |
| heureMiseEau, heureSortieEau | Saisie |
| dureePlongeeMin | Calculé (sortie − mise à l'eau) |
| etatMerDegre, etatMerLabel | Saisie (bouton Douglas) |
| ventBeaufort, ventLabel | Saisie (bouton Beaufort) |
| courantClasse | Saisie (bouton courant) |
| hauteurEauMiseEau_m, hauteurEauSortieEau_m | Calculé (`Marees.getHauteurAt`) |
| coefficientJour | Calculé (`Marees.getEntreePourDate`) |
| etaleMiseEauType, etaleMiseEauDeltaMin | Calculé (`Marees.getEtaleProche`) |
| etaleSortieEauType, etaleSortieEauDeltaMin | Calculé (`Marees.getEtaleProche`) |
| commentaire | Saisie (optionnel) |

## Points d'entrée dans la PWA

1. **Depuis la fiche site** (`pwa/index.html`, à côté de `btn-naviguer`) : nouveau bouton `📝 Retour d'expérience` — ouvre le formulaire avec le site pré-rempli (`p.siteID`/`p.siteNom` du site actif).
2. **Depuis le menu général** (`header-more-menu`, à côté de `btn-cgu`) : nouvel item `📝 Retour d'expérience` — ouvre le formulaire avec sélection manuelle du site (utile pour un remplissage différé, une fois de retour au centre).

## Fichiers impactés (aperçu)

- `pwa/js/retourexperience.js` — **nouveau module** (IIFE, pattern existant) : logique du formulaire, calculs, file d'attente locale, envoi au Worker.
- `pwa/js/marees.js` — ajout de `getEtaleProche(date)` à l'API publique.
- `pwa/js/config.js` — ajout des échelles Douglas/Beaufort/courant, liste des bateaux, URL du nouvel endpoint Worker.
- `pwa/index.html` — nouveau bouton fiche site + item menu + markup du formulaire (modale, sur le modèle des modales marées/météo existantes).
- `pwa/css/style.css` — styles du formulaire et des boutons d'échelle.
- `pwa/js/app.js` — initialisation du module + listeners des 2 points d'entrée.
- `cloudflare-worker/mf-wms-proxy.js` (ou nouveau fichier worker) — route `/retour-experience`.
- `google-apps-script/retour-experience.gs` (nouveau dossier, committé au dépôt comme `cloudflare-worker/`) — `doPost` qui écrit dans le Sheet.
- `pwa/sw.js` — bump `VERSION` (nouveaux fichiers statiques).

## Hors périmètre (cette phase)

- Pas de pipeline d'analyse R automatisé qui ajuste réellement les fenêtres de plongée (`tpsEtale`/`maree`) à partir des retours collectés — cette spec couvre uniquement la **collecte fiable** des données. L'exploitation pour ajuster les sites sera un projet ultérieur, une fois assez de retours accumulés.
- Pas d'édition/suppression d'un retour déjà soumis depuis la PWA (correction éventuelle directement dans le Google Sheet).
- Pas de compte utilisateur individuel ni de rôle moniteur/plongeur distinct (le champ "rempli par" est déclaratif, non authentifié).
- Pas de synchronisation multi-appareils de la file d'attente locale (chaque tablette/téléphone gère sa propre file en attente ; pas de fusion entre appareils).

## Plan de test manuel

1. Remplir le formulaire depuis la fiche d'un site avec connexion 4G active → vérifier l'apparition de la ligne dans le Google Sheet avec toutes les valeurs calculées correctes (hauteur d'eau, coefficient, delta étale) en comparant à `Marees.getEntreePourDate` pour la date choisie.
2. Couper le réseau (mode avion) avant soumission → vérifier la mise en file d'attente locale, puis remettre le réseau → vérifier la synchronisation automatique.
3. Ouvrir le formulaire depuis le menu général sans site pré-sélectionné → vérifier que la recherche/sélection de site fonctionne et alimente bien `siteID`/`siteNom`.
4. Vérifier la validation heure sortie > heure mise à l'eau (message d'erreur si incohérent).
5. Vérifier sur tablette (après `./sync_docs.sh`) que le SW recharge le nouveau cache (bump `VERSION`).
