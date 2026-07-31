/**
 * retour-experience.gs — Google Apps Script Web App
 * Reçoit les soumissions du formulaire "Retour d'expérience post-plongée"
 * (relayées par le Worker Cloudflare, jamais appelé directement par la PWA)
 * et les ajoute en ligne dans l'onglet "retours_plongee" du Google Sheet.
 *
 * Déploiement :
 *  1. https://script.google.com/ → Nouveau projet, coller ce fichier.
 *  2. Fichier > Propriétés du projet > Propriétés du script, ajouter :
 *       APPSCRIPT_SECRET = <secret partagé avec le Worker Cloudflare>
 *       SHEET_ID         = <ID du Google Sheet cible (dans son URL)>
 *  3. Dans le Sheet cible, créer un onglet nommé exactement "retours_plongee"
 *     avec une ligne d'en-tête reprenant HEADERS ci-dessous, dans le même ordre
 *     (appendRow() écrit par position, pas par nom de colonne).
 *  4. Déployer > Nouveau déploiement > Type "Application Web" :
 *       Exécuter en tant que : Moi
 *       Qui a accès : Tout le monde
 *  5. Copier l'URL de déploiement (se terminant par /exec) → variable
 *     d'environnement APPSCRIPT_URL du Worker Cloudflare (jamais dans le
 *     code client de la PWA).
 */

const HEADERS = [
  'timestampSoumission', 'datePlongee', 'siteID', 'siteNom', 'bateau', 'rempliPar',
  'heureMiseEau', 'heureSortieEau', 'dureePlongeeMin',
  'etatMerDegre', 'etatMerLabel', 'ventBeaufort', 'ventLabel', 'courantClasse',
  'hauteurEauMiseEau_m', 'hauteurEauSortieEau_m', 'coefficientJour',
  'etaleMiseEauType', 'etaleMiseEauDeltaMin', 'etaleSortieEauType', 'etaleSortieEauDeltaMin',
  'commentaire',
];

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty('APPSCRIPT_SECRET');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _respond(false, 'JSON invalide');
  }

  // Note: Non-constant-time comparison — acceptable for internal club threat model.
  if (!expectedSecret || payload.secret !== expectedSecret) {
    return _respond(false, 'Secret invalide');
  }

  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return _respond(false, 'SHEET_ID non configuré');

  const data = payload.data || {};
  const row = HEADERS.map(key => (data[key] !== undefined && data[key] !== null) ? data[key] : '');

  try {
    const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('retours_plongee');
    if (!sheet) return _respond(false, 'Onglet retours_plongee introuvable');
    sheet.appendRow(row);
  } catch (err) {
    return _respond(false, 'Erreur écriture Sheet : ' + err.message);
  }

  return _respond(true, '');
}

function _respond(ok, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok, error: error || undefined }))
    .setMimeType(ContentService.MimeType.JSON);
}
