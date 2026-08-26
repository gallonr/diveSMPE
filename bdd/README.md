# bdd/ — BDD sites

Depuis le 2026-08-26, la BDD des sites de plongée n'est plus un fichier XLSX
versionné dans ce dépôt (dépôt public — la BDD complète y était librement
téléchargeable). Elle vit désormais dans un **Google Sheet**, lu directement
par `r/02_process_bdd.R` via `googlesheets4`.

## Mise en place (une fois)

1. Créer un nouveau Google Sheet (ou réutiliser celui déjà utilisé pour
   `retour-experience.gs` / `auth.gs`, dans un onglet dédié).
2. Créer un onglet nommé exactement `site`, avec en première ligne les noms
   de colonnes exacts attendus par `r/02_process_bdd.R` :

   ```
   siteID | siteNom | latitude | longitude | typeSite | accessibilite |
   typePlongee | niveauPlongee | accesVent | houle | mouillage | maree |
   tpsEtale | commentaire | photoSite
   ```

   La colonne `mouillage` utilise un vocabulaire contrôlé (cf.
   `specs/2026-07-28-type-mouillage-design.md`) : uniquement `fixe`, `ancre`,
   `gueuse`, ou vide si non renseigné. `r/02_process_bdd.R` émet un
   avertissement au build si une autre valeur (ex. ancien texte libre comme
   "Ancre - Tête de roche") est détectée. Cette colonne n'est pas encore
   entièrement remplie pour tous les sites — la PWA gère l'absence de
   valeur (pas de badge affiché tant que la case est vide).

3. Importer les données de l'ancien `bddAtlasPlongeeSMPE.xlsx` (Fichier >
   Importer, ou copier/coller les valeurs) dans cet onglet.
4. Copier `r/config_local.R.example` vers `r/config_local.R` et renseigner
   `GOOGLE_SHEET_BDD_ID` (visible dans l'URL du Sheet).
5. Restreindre le partage du Sheet aux personnes qui en ont réellement besoin
   (moniteurs référents), pas "Tout le monde avec le lien".

## Authentification

`r/02_process_bdd.R` appelle `googlesheets4::gs4_auth()` : au premier lancement,
un navigateur s'ouvre pour autoriser l'accès avec votre compte Google ; le
token est ensuite mis en cache localement (pas besoin de se reconnecter à
chaque build).

## Révocation / mise à jour de la BDD

Toute modification (ajout/suppression de site, correction) se fait
directement dans le Google Sheet — le prochain `build_all.R` la répercute
automatiquement dans `data/sites.geojson`.
