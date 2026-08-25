# google-apps-script/auth.gs

Backend d'authentification par lien magique (email + token signé) pour la
PWA diveSMPE (cf. `specs/2026-08-25-auth-utilisateur-token-design.md`).
Déploiement **séparé** de `retour-experience.gs` (secrets distincts), mais
lit/écrit le **même** Google Sheet (nouvel onglet).

## Mise en place (une fois)

1. Dans le Google Sheet déjà utilisé pour `retours_plongee`, créer un onglet
   nommé exactement `utilisateurs`, avec cette ligne d'en-tête :

   ```
   email | nom | actif
   ```

   Remplir une ligne par membre autorisé (`actif` = `VRAI` ou `FAUX`).

2. Dans le Sheet : Extensions > Apps Script → **Nouveau projet** (ne pas
   réutiliser celui de `retour-experience.gs`) → coller `auth.gs`.
3. Apps Script : Fichier > Propriétés du projet > Propriétés du script :
   - `AUTH_APPSCRIPT_SECRET` — chaîne aléatoire longue (ex.
     `openssl rand -hex 32`), à reporter côté Worker Cloudflare.
   - `AUTH_TOKEN_SECRET` — **une autre** chaîne aléatoire longue (clé de
     signature des tokens — ne jamais réutiliser `AUTH_APPSCRIPT_SECRET`).
   - `SHEET_ID` — même valeur que pour `retour-experience.gs`.
   - `PWA_URL` — `https://gallonr.github.io/diveSMPE/`
4. Déployer > Nouveau déploiement > Application Web :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
5. Copier l'URL `/exec` → variable d'environnement `AUTH_APPSCRIPT_URL` du
   Worker Cloudflare (`cloudflare-worker/mf-wms-proxy.js`).

## Révocation

Passer `actif` à `FAUX` sur la ligne du membre dans l'onglet `utilisateurs`.
Prend effet à la prochaine revalidation silencieuse de l'appareil concerné
(prochain démarrage de l'app en ligne) — voir la section "Détail de la
révocation" de la spec.
