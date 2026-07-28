# Design — Type de mouillage (fixe/ancre/gueuse)

Date : 2026-07-28
Contexte : demande issue d'une réunion utilisateurs. Point #2 sur 3 (voir aussi les demandes formulaire retour d'expérience et export marées xlsx, traitées séparément).

## Problème

Le champ `mouillage` existe déjà dans la BDD (`bdd/bddAtlasPlongeeSMPE.xlsx`) et dans `data/sites.geojson`, mais en texte libre (ex: `"Ancre - Tête de roche"`, `"Fixe"`, ou vide pour 58 des 60 sites). Il n'est affiché que comme texte brut sur la fiche site (`f-mouillage`) et n'est pas filtrable. Les utilisateurs veulent pouvoir distinguer et filtrer les sites selon le type de mouillage : **fixe / ancre / gueuse**, en complément du filtre existant type de site (roche/épave).

## Décisions

- **Cardinalité** : un seul type de mouillage par site (pas de multi-valeurs).
- **Source de la donnée** : le champ `mouillage` existant est reformulé directement en vocabulaire contrôlé — pas de nouvelle colonne. Les détails texte libre actuels (ex. "Tête de roche") ne sont pas conservés séparément ; la colonne ne contiendra plus que `fixe`, `ancre`, `gueuse`, ou vide (non renseigné).
- **UI PWA** : mouillage devient à la fois un **filtre** (cohérent avec le pattern existant de boutons chips) et un **badge affiché** sur la fiche détaillée et sur chaque ligne de la liste des sites.

## Modèle de données

Aucune nouvelle colonne. `bdd/bddAtlasPlongeeSMPE.xlsx`, feuille `site`, colonne `mouillage` :
- Valeurs autorisées : `fixe`, `ancre`, `gueuse`, ou cellule vide (non renseigné).
- `r/02_process_bdd.R` sélectionne déjà cette colonne (`cols_voulues`, ligne ~78) — aucun changement de code nécessaire pour le passage XLSX → GeoJSON.
- **Ajout** : une validation en fin de `r/02_process_bdd.R` (dans le même esprit que les validations bbox existantes) qui vérifie que toutes les valeurs non-NA de `mouillage` appartiennent à `{fixe, ancre, gueuse}` et émet un `warning()` listant les `siteID` en anomalie (ex. anciennes valeurs texte libre pas encore reformulées).

## PWA

### Config (`pwa/js/config.js`)

Nouvel objet `TYPE_MOUILLAGE`, sur le modèle exact de `TYPE_SITE` (ligne ~154) :

```js
TYPE_MOUILLAGE: {
  fixe:   { classe: 'badge-fixe',   emoji: '⚓' },
  ancre:  { classe: 'badge-ancre',  emoji: '🔗' },
  gueuse: { classe: 'badge-gueuse', emoji: '🪝' },
  default:{ classe: 'badge-default', emoji: '❔' },
},
```

### `pwa/js/sites.js`

- Nouvelle fonction `_getMouillageInfo(mouillage)` miroir de `_getTypeInfo(typeSite)`.
- Ligne de liste (`_afficherListe`, ~ligne 70-86) : ajout d'un badge/emoji mouillage à côté du badge type existant.
- Fiche détaillée (`_ouvrirFiche`) : `f-mouillage` passe de texte brut (`_val(p.mouillage)`) à un badge (même traitement que `fiche-badge-type`), avec fallback "non renseigné" si vide.
- `filtrer(terme, typeFilter, profFilter, mouillageFilter)` : nouveau 4ᵉ paramètre. Filtre par égalité stricte (`p.mouillage === mouillageFilter`) quand différent de `'all'`.

### `pwa/index.html`

Nouvelle rangée de boutons chips sous la barre de filtre profondeur (~ligne 187-193), même pattern que `filter-btn`/`filter-prof-btn` :

```html
<div class="filter-bar filter-bar-mouillage">
  <button class="filter-mouillage-btn active" data-mouillage="all">Tous mouillages</button>
  <button class="filter-mouillage-btn" data-mouillage="fixe">Fixe</button>
  <button class="filter-mouillage-btn" data-mouillage="ancre">Ancre</button>
  <button class="filter-mouillage-btn" data-mouillage="gueuse">Gueuse</button>
</div>
```

### `pwa/js/app.js`

- Nouvelle variable d'état `_filtreMouillage` (défaut `'all'`).
- Listener sur `.filter-mouillage-btn`, même pattern que les listeners `.filter-btn` / `.filter-prof-btn` existants (~ligne 192-210) : toggle `active`, met à jour `_filtreMouillage`, appelle `Sites.filtrer(_termeRecherche, _filtreType, _filtreProf, _filtreMouillage)`.
- Les deux autres appels à `Sites.filtrer(...)` (recherche, filtre type, filtre profondeur) sont mis à jour pour passer `_filtreMouillage` en 4ᵉ argument.

### CSS (`pwa/css/style.css`)

3 nouvelles classes à côté de `.badge-roche`/`.badge-epave`/`.badge-recif` (~ligne 376-378) :

```css
.badge-fixe   { background: #3d6b8a; color: #fff; }
.badge-ancre  { background: #8a6d3d; color: #fff; }
.badge-gueuse { background: #6b4a8a; color: #fff; }
```

`filter-mouillage-btn` réutilise le CSS existant de `.filter-btn` / `.filter-prof-btn` (mêmes classes ou classes miroir selon ce que le CSS actuel factorise).

### Versioning Service Worker

Bump de `VERSION` dans `pwa/sw.js` — `config.js`, `sites.js`, `app.js`, `index.html`, `style.css` sont tous modifiés (règle du `CLAUDE.md` du projet).

## Hors périmètre

- Pas de saisie/édition du mouillage depuis la PWA — reste géré uniquement via le XLSX au centre.
- Pas de migration automatique des valeurs texte libre existantes (2 sites) — reformulées manuellement en même temps que le reste de la BDD.
- Pas de valeur multiple par site.

## Plan de test manuel

1. `Rscript r/build_all.R` après reformulation d'au moins quelques lignes `mouillage` dans le XLSX → vérifier que `data/sites.geojson` contient bien les nouvelles valeurs et qu'aucun warning de validation n'est levé pour ces sites.
2. Sur `pwa/index.html` en local (`npx http-server`) : vérifier badge mouillage sur fiche détaillée + liste, et filtrage correct par bouton (Fixe/Ancre/Gueuse/Tous).
3. Vérifier que le filtre mouillage se combine correctement avec le filtre type de site et le filtre profondeur (ET logique entre les 3).
4. Vérifier sur tablette (après `./sync_docs.sh`) que le SW recharge bien le nouveau cache (bump `VERSION` visible).
