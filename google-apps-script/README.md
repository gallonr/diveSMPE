# google-apps-script/retour-experience.gs

Backend Google Sheets pour le formulaire "Retour d'expérience post-plongée"
(cf. `specs/2026-07-28-retour-experience-design.md`).

## Mise en place (une fois)

1. Créer un Google Sheet nommé par exemple `retours_plongee_smpe`.
2. Y créer un onglet nommé exactement `retours_plongee`, avec cette ligne
   d'en-tête (dans cet ordre) :

   ```
   timestampSoumission | datePlongee | siteID | siteNom | bateau | rempliPar |
   heureMiseEau | heureSortieEau | dureePlongeeMin | etatMerDegre |
   etatMerLabel | ventBeaufort | ventLabel | courantClasse |
   hauteurEauMiseEau_m | hauteurEauSortieEau_m | coefficientJour |
   etaleMiseEauType | etaleMiseEauDeltaMin | etaleSortieEauType |
   etaleSortieEauDeltaMin | commentaire
   ```

3. Dans le Sheet : Extensions > Apps Script → coller `retour-experience.gs`.
4. Apps Script : Fichier > Propriétés du projet > Propriétés du script :
   - `APPSCRIPT_SECRET` — générer une chaîne aléatoire longue (ex.
     `openssl rand -hex 32`), à reporter aussi côté Worker Cloudflare.
   - `SHEET_ID` — l'ID dans l'URL du Sheet
     (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).
5. Déployer > Nouveau déploiement > Application Web :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
6. Copier l'URL `/exec` → à mettre dans la variable d'environnement
   `APPSCRIPT_URL` du Worker Cloudflare (`cloudflare-worker/mf-wms-proxy.js`).

## Analyse depuis R

```r
library(googlesheets4)
gs4_auth()  # une fois, ouvre le navigateur
df <- read_sheet("https://docs.google.com/spreadsheets/d/<SHEET_ID>")
```
