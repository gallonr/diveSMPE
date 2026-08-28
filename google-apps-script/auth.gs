/**
 * auth.gs — Google Apps Script Web App
 * Authentification par lien magique (email + token signé) pour la PWA
 * diveSMPE, en remplacement de l'ancien login partagé (cf.
 * specs/2026-08-25-auth-utilisateur-token-design.md). Relayé par le Worker
 * Cloudflare (routes /auth/request-link, /auth/verify), jamais appelé
 * directement par la PWA. Déploiement séparé de retour-experience.gs
 * (secrets distincts), mais pointe vers le même Google Sheet.
 *
 * Déploiement :
 *  1. https://script.google.com/ → Nouveau projet, coller ce fichier.
 *  2. Fichier > Propriétés du projet > Propriétés du script, ajouter :
 *       AUTH_APPSCRIPT_SECRET = <secret partagé avec le Worker Cloudflare>
 *       AUTH_TOKEN_SECRET     = <clé HMAC de signature des tokens, distincte
 *                                du secret ci-dessus — ex. openssl rand -hex 32>
 *       SHEET_ID              = <ID du Google Sheet, même valeur que pour
 *                                retour-experience.gs>
 *       PWA_URL                = https://gallonr.github.io/diveSMPE/
 *  3. Dans le Sheet cible, créer un onglet nommé exactement "utilisateurs"
 *     avec une ligne d'en-tête : email | nom | actif
 *  4. Déployer > Nouveau déploiement > Type "Application Web" :
 *       Exécuter en tant que : Moi
 *       Qui a accès : Tout le monde
 *  5. Copier l'URL de déploiement (se terminant par /exec) → variable
 *     d'environnement AUTH_APPSCRIPT_URL du Worker Cloudflare (jamais dans
 *     le code client de la PWA).
 */

const SESSION_DUREE_MS = 90 * 24 * 60 * 60 * 1000; // 90 jours

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty('AUTH_APPSCRIPT_SECRET');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _respond(false, 'JSON invalide');
  }

  // Note : comparaison non constant-time — acceptable pour la menace interne
  // au club (même choix que retour-experience.gs).
  if (!expectedSecret || payload.secret !== expectedSecret) {
    return _respond(false, 'Secret invalide');
  }

  if (payload.action === 'request-link') return _demanderLien(payload, props);
  if (payload.action === 'verify') return _verifier(payload, props);
  return _respond(false, 'Action inconnue');
}

function _demanderLien(payload, props) {
  const email = String(payload.email || '').trim().toLowerCase();
  const deviceId = String(payload.device_id || '');
  if (!email) return _respond(false, 'Email requis');
  if (!deviceId) return _respond(false, 'device_id requis');

  const utilisateur = _trouverUtilisateur(email, props);
  if (!utilisateur || !utilisateur.actif) {
    return _respond(false, 'Email non reconnu ou inactif');
  }

  const exp = Date.now() + SESSION_DUREE_MS;
  const token = _construireToken(email, exp, deviceId, props.getProperty('AUTH_TOKEN_SECRET'));
  const pwaUrl = props.getProperty('PWA_URL') || 'https://gallonr.github.io/diveSMPE/';
  // `token` est en base64url (alphabet [A-Za-z0-9_-] + '.') : aucun caractère
  // n'y nécessite d'encodage URI, donc rien à casser même si un client mail
  // ou un scanner de liens ("safe links") ré-encode/redirige l'URL en route.
  const lien = pwaUrl + '?token=' + token;

  MailApp.sendEmail({
    to: email,
    subject: 'Votre lien de connexion — SMPE Plongée',
    body: 'Bonjour ' + utilisateur.nom + ',\n\n'
      + "Cliquez sur ce lien pour vous connecter à l'application SMPE Plongée :\n"
      + lien + '\n\n'
      + "Si le lien ne s'ouvre pas dans l'application installée sur votre tablette, "
      + 'copiez plutôt ce code et collez-le dans le champ "Coller le token" '
      + "de l'écran de connexion :\n\n"
      + token + '\n\n'
      + 'Ce lien est valable 90 jours.',
  });

  return _respond(true, '');
}

function _verifier(payload, props) {
  const token = String(payload.token || '');
  const deviceId = String(payload.device_id || '');
  const donnees = _verifierToken(token, deviceId, props.getProperty('AUTH_TOKEN_SECRET'));
  if (!donnees) return _respond(false, 'Token invalide ou expiré');

  const utilisateur = _trouverUtilisateur(donnees.email, props);
  if (!utilisateur || !utilisateur.actif) {
    return _respond(false, 'Compte désactivé');
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, email: utilisateur.email, nom: utilisateur.nom }))
    .setMimeType(ContentService.MimeType.JSON);
}

function _trouverUtilisateur(email, props) {
  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return null;
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('utilisateurs');
  if (!sheet) return null;

  const lignes = sheet.getDataRange().getValues(); // lignes[0] = en-tête
  for (let i = 1; i < lignes.length; i++) {
    const ligneEmail = String(lignes[i][0] || '').trim().toLowerCase();
    if (ligneEmail === email) {
      const nom = String(lignes[i][1] || '');
      const actifBrut = String(lignes[i][2] || '').trim().toUpperCase();
      const actif = lignes[i][2] === true || actifBrut === 'VRAI' || actifBrut === 'TRUE';
      return { email: email, nom: nom, actif: actif };
    }
  }
  return null;
}

// Token = base64url(JSON) + '.' + signature hex. Le base64url (alphabet
// [A-Za-z0-9_-]) ne contient aucun caractère réservé en URI : rien à
// percent-encoder, donc rien qu'un client mail / scanner de liens / clic
// navigateur puisse décoder différemment selon le chemin (clic vs collage).
// Ancien format (JSON + encodeURIComponent, séparateur ':') abandonné après
// des échecs de clic en conditions réelles (le décodage variait selon que
// le lien passait par un simple clic ou une réécriture par le client mail).
// Cf. specs/2026-08-25-auth-utilisateur-token-design.md.
function _construireToken(email, exp, deviceId, secret) {
  const payloadB64 = _b64UrlEncode(JSON.stringify({ email: email, exp: exp, device_id: deviceId }));
  return payloadB64 + '.' + _hmacHex(payloadB64, secret);
}

// `deviceId` = identifiant local envoyé par le client qui présente le token
// (pas celui du payload signé). Un token copié/collé sur un autre appareil
// porte un `device_id` de payload différent de celui de l'appareil qui
// tente de le vérifier : rejeté ici, même si la signature HMAC est valide.
function _verifierToken(token, deviceId, secret) {
  const idx = String(token).lastIndexOf('.');
  if (idx === -1) return null;
  const payloadB64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!secret || sig !== _hmacHex(payloadB64, secret)) return null;

  let donnees;
  try {
    donnees = JSON.parse(_b64UrlDecode(payloadB64));
  } catch (err) {
    return null;
  }
  if (!donnees.email || !donnees.exp || Date.now() > donnees.exp) return null;
  if (!donnees.device_id || donnees.device_id !== deviceId) return null;
  return donnees;
}

function _b64UrlEncode(str) {
  return Utilities.base64EncodeWebSafe(str).replace(/=+$/, '');
}

function _b64UrlDecode(str) {
  let s = String(str);
  const pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  else if (pad !== 0) throw new Error('base64url invalide');
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString();
}

function _hmacHex(payloadStr, secret) {
  const sigBytes = Utilities.computeHmacSha256Signature(payloadStr, secret);
  return sigBytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function _respond(ok, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, error: error || undefined }))
    .setMimeType(ContentService.MimeType.JSON);
}
