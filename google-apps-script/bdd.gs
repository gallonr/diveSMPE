/**
 * bdd.gs — Google Apps Script Web App
 * Relais lecture de l'onglet "site" du Google Sheet BDD (même Sheet que
 * auth.gs / retour-experience.gs, ou un Sheet dédié — cf. bdd/README.md).
 * Appelé uniquement par le Worker Cloudflare (route GET /sites), jamais
 * directement par la PWA.
 *
 * Déploiement :
 *  1. https://script.google.com/ → Nouveau projet, coller ce fichier
 *     (ou l'ajouter au projet Apps Script existant lié au même Sheet).
 *  2. Fichier > Propriétés du projet > Propriétés du script, ajouter :
 *       BDD_APPSCRIPT_SECRET = <secret partagé avec le Worker Cloudflare>
 *       SHEET_ID              = <ID du Google Sheet BDD (dans son URL)>
 *  3. L'onglet "site" doit exister avec les colonnes décrites dans
 *     bdd/README.md (première ligne = en-têtes).
 *  4. Déployer > Nouveau déploiement > Type "Application Web" :
 *       Exécuter en tant que : Moi
 *       Qui a accès : Tout le monde
 *  5. Copier l'URL de déploiement (se terminant par /exec) → variable
 *     d'environnement BDD_APPSCRIPT_URL du Worker Cloudflare (jamais dans
 *     le code client de la PWA).
 */

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty('BDD_APPSCRIPT_SECRET');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _respond(false, null, 'JSON invalide');
  }

  // Note: comparaison non constant-time — acceptable pour ce modèle de
  // menace interne club (même choix que retour-experience.gs).
  if (!expectedSecret || payload.secret !== expectedSecret) {
    return _respond(false, null, 'Secret invalide');
  }

  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return _respond(false, null, 'SHEET_ID non configuré');

  try {
    const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('site');
    if (!sheet) return _respond(false, null, 'Onglet site introuvable');

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return _respond(true, [], null);

    const headers = values[0];
    const rows = values.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

    return _respond(true, rows, null);
  } catch (err) {
    return _respond(false, null, 'Erreur lecture Sheet : ' + err.message);
  }
}

function _respond(ok, rows, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok, rows: rows || [], error: error || undefined }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Diagnostic — permet de vérifier que le déploiement Web App répond bien
// via un simple GET dans le navigateur, indépendamment de la logique métier.
// Ex : ouvrir l'URL /exec directement dans un navigateur connecté au bon compte.
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'bdd.gs déployé et accessible' }))
    .setMimeType(ContentService.MimeType.JSON);
}
