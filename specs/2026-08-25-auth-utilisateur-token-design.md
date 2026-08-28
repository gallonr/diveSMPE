# Design — Compte utilisateur (email + token) en remplacement du login partagé

Date : 2026-08-25
Contexte : l'app n'a aujourd'hui qu'un login partagé pour tout le club (`smpe` / `smpe2026`, cf. `auth.js`). On remplace ce compte générique par un compte individuel par plongeur : email + lien magique (token), sans mot de passe à retenir/partager.

## Problème

Le mot de passe unique est partagé par tout le club — impossible de savoir qui s'est connecté, ni de retirer l'accès à une seule personne sans changer le mot de passe pour tout le monde. Le champ "rempli par" du formulaire retour d'expérience (`retourexperience.js`) est en plus une saisie libre non authentifiée, alors qu'on pourrait le déduire directement de l'identité connectée.

## Contexte d'usage (clarifié en brainstorming)

- Le login actuel protège l'accès à toute la PWA (`Auth.init` dans `index.html:697`), pas seulement le formulaire retour d'expérience.
- Contrainte clé du projet : fonctionnement 100% offline en mer (cf. CLAUDE.md). Toute solution d'authentification doit permettre de démarrer l'app sans réseau une fois la première connexion faite.
- Club fermé : les comptes sont provisionnés à la main par un admin, pas d'auto-inscription libre.
- Le cycle de mise à jour existant (BDD → build → sync → tablette sur WiFi au centre avant sortie) est le moment naturel où une tablette repasse en ligne — c'est le point d'ancrage choisi pour la revalidation.

## Décisions d'architecture

### Lien magique, token signé sans état, session glissante de 90 jours

Trois choix validés en clarification :
1. **Lien magique à usage répété** plutôt qu'un code OTP à chaque connexion ou un token permanent saisi manuellement — cohérent avec l'usage en mer (une fois connecté au centre sur WiFi, la tablette reste identifiée sans redemander de lien).
2. **Liste fermée gérée manuellement** (onglet Google Sheet) plutôt qu'auto-inscription libre.
3. **Session longue durée (90 jours), glissante**, revalidée silencieusement quand la tablette est en ligne, plutôt qu'une session courte (redemande un lien à quasi chaque sortie, incompatible avec l'offline) ou illimitée (aucun moyen de faire jouer une révocation).

Le token est **signé, sans état côté serveur** (HMAC), plutôt qu'un token opaque stocké dans une table de tokens :
- Pas de table de tokens à gérer, pas de recherche à la vérification — juste un calcul de signature.
- Le levier de révocation attendu ("gestion des membres par email") est déjà couvert par la colonne `actif` de l'onglet utilisateurs — inutile de pouvoir révoquer un lien précis indépendamment du compte.
- Compromis assumé : l'expiration du token part de sa **génération**, pas du clic sur le lien (un seul champ `exp`, pas de distinction lien/session). Un email non relevé pendant 3 semaines réduit d'autant la session utile — acceptable pour ce contexte.

### Détail de la révocation

- L'état vit dans une seule colonne `actif` (VRAI/FAUX) de l'onglet "utilisateurs". Révoquer = l'admin passe la ligne à FAUX (ou la supprime).
- Le token signé reste cryptographiquement valide jusqu'à ses 90 jours indépendamment de `actif` — la signature ne "sait" pas qu'un compte a été désactivé après coup. La révocation prend donc effet via une **revalidation silencieuse** :
  - À chaque démarrage de l'app, si `navigator.onLine`, la PWA lance en tâche de fond `POST /auth/verify {token}`. L'app démarre immédiatement sur la session locale existante (pas d'attente réseau, contrainte offline préservée).
  - Réponse `{ok:true}` → la fenêtre de 90 jours est prolongée à partir de maintenant (session glissante) et `nom`/`email` sont rafraîchis.
  - Réponse `{ok:false}` (compte désactivé) → déconnexion immédiate (mêmes effets que `logout()`), message affiché une fois au retour à l'écran de login.
  - Échec réseau (timeout, pas de réponse) → ignoré silencieusement, ce n'est **pas** une révocation, la session locale continue.
- Fenêtre d'exposition assumée : entre la désactivation et le prochain passage en ligne de la tablette concernée, l'accès reste valide localement. En pratique, alignée sur le rythme déjà en place (WiFi au centre avant chaque sortie) — équivalent en pratique au système actuel où changer le mot de passe partagé demande aussi une action manuelle sur chaque appareil.
- Levier de révocation globale (urgence, ex. secret compromis) : faire tourner `AUTH_TOKEN_SECRET` invalide immédiatement tous les tokens existants, tout le monde doit redemander un lien.

### Passage par le Worker Cloudflare existant, nouvel Apps Script dédié

Même principe que `retour-experience.gs` : jamais d'appel direct client → Apps Script.

```
PWA (fetch POST JSON)
   ↓
Cloudflare Worker — nouvelles routes /auth/request-link, /auth/verify
   ↓ (ajoute AUTH_APPSCRIPT_SECRET côté serveur, jamais exposé au client)
Google Apps Script Web App dédié (auth.gs) — doPost(e), routage sur payload.action
   ↓
Google Sheet, onglet "utilisateurs" (même classeur que retours_plongee)
```

- Déploiement Apps Script **séparé** de `retour-experience.gs` (cloisonnement des secrets), mais **même classeur Google Sheet**, nouvel onglet — pas besoin d'un second classeur juste pour une table de lecture.
- Deux secrets distincts côté nouvel Apps Script :
  - `AUTH_APPSCRIPT_SECRET` — secret de transport Worker ↔ Apps Script (authentifie l'appel du Worker), même rôle que `APPSCRIPT_SECRET` existant.
  - `AUTH_TOKEN_SECRET` — clé HMAC qui signe les tokens émis, jamais transmise au client.
- Format du token : `base64url(JSON.stringify({email, exp})) + '.' + hex(HMAC-SHA256(payload, AUTH_TOKEN_SECRET))`, via `Utilities.computeHmacSha256Signature` (pas de lib externe, cohérent avec le style existant de `retour-experience.gs`).

### Actions Apps Script (`auth.gs`, `doPost`)

| `action` | Entrée | Comportement | Réponse |
|---|---|---|---|
| `request-link` | `{email}` | Cherche la ligne email (comparaison insensible à la casse/espaces) dans "utilisateurs", vérifie `actif`. Si ok : génère le token (`exp` = maintenant + 90 jours), envoie l'email via `MailApp.sendEmail` (lien `?token=...` + token en texte brut en repli). | `{ok:true}` ou `{ok:false, error:'Email non reconnu ou inactif'}` |
| `verify` | `{token}` | Décode le token, vérifie la signature HMAC et `exp`, relit la ligne du Sheet pour confirmer `actif` (c'est ici que la révocation prend effet). | `{ok:true, email, nom}` ou `{ok:false, error}` |

### Schéma de l'onglet "utilisateurs"

| Colonne | Détail |
|---|---|
| email | Clé de recherche, comparaison insensible à la casse/espaces |
| nom | Utilisé pour pré-remplir "rempli par" dans le formulaire retour d'expérience |
| actif | VRAI/FAUX — levier de révocation |

Peuplé et maintenu à la main par un admin, directement dans le Sheet (pas d'UI d'administration dans la PWA).

## Fallback lien magique → PWA installée

Une PWA ajoutée à l'écran d'accueil (mode standalone) peut ne pas ouvrir un lien cliqué depuis l'app Mail — le lien peut s'ouvrir dans le navigateur au lieu de l'app installée (comportement inégal selon OS/navigateur, notamment iOS). Mitigation retenue : l'email contient **à la fois** le lien cliquable **et** le token brut en texte affiché, et l'écran de login propose un second champ "coller le token reçu par email" avec un bouton "Valider" qui appelle le même chemin de vérification que le clic sur le lien.

## Changements côté PWA

- **`pwa/js/auth.js`** — réécrit : supprime `VALID_LOGIN`/`HASH_PASSWORD`/`sha256`. Ajoute `demanderLien(email)` (→ `/auth/request-link`), `validerToken(token)` (→ `/auth/verify`, stocke `{email, nom, token, ts}` dans `localStorage`), revalidation silencieuse en tâche de fond dans `init()` (voir section révocation), `getUser()` pour exposer `{email, nom}` aux autres modules.
- **`pwa/index.html`** — formulaire login : un champ email + bouton "Recevoir mon lien", plus un champ "coller le token" en repli. Lecture de `?token=` dans l'URL au chargement, puis `history.replaceState` pour nettoyer l'URL après traitement.
- **`pwa/js/config.js`** — nouvelle section `CONFIG.AUTH = { workerUrl }` (même Worker que `CONFIG.RETOUR_EXPERIENCE.workerUrl`).
- **`pwa/js/retourexperience.js`** — "rempli par" devient pré-rempli en lecture seule depuis `Auth.getUser().nom` ; suppression de l'input texte libre `re-rempli-par` et de sa validation associée (`_construireDonnees`).
- **`pwa/sw.js`** — bump `VERSION` (contenu de `auth.js`/`index.html` modifié).

## Changements côté infrastructure

- **`cloudflare-worker/mf-wms-proxy.js`** (ou nouveau fichier worker) — branche `path === 'auth'`, sous-routes `request-link`/`verify`, relais vers `env.AUTH_APPSCRIPT_URL` avec `env.AUTH_APPSCRIPT_SECRET`, même pattern que `handleRetourExperience`. Nouvelles variables d'environnement Worker : `AUTH_APPSCRIPT_URL`, `AUTH_APPSCRIPT_SECRET`.
- **`google-apps-script/auth.gs`** (nouveau fichier, nouveau déploiement Web App séparé de `retour-experience.gs`) — `doPost` routé sur `action`, Script Properties `AUTH_TOKEN_SECRET` et `SHEET_ID`.

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| Email non reconnu / inactif | Message explicite à l'écran de login, invite à contacter le club |
| Pas de réseau à la demande de lien | Message "connexion internet requise" (cohérent : il faut être en ligne pour recevoir un email) |
| Token invalide, expiré, ou mal collé | "Lien invalide ou expiré, redemandez un lien" |
| Revalidation silencieuse — échec réseau | Ignoré, pas de déconnexion |
| Revalidation silencieuse — `ok:false` explicite | Déconnexion immédiate, message affiché une fois au retour à l'écran de login |

## Migration

- Peupler l'onglet "utilisateurs" avec l'ensemble des membres actuels **avant** de couper l'accès `smpe`/`smpe2026` — une coupure sans peuplement préalable bloque tout le monde.
- Coupure nette recommandée à la mise en prod (pas de code de compatibilité double-système à maintenir puis retirer), sous réserve que le Sheet soit peuplé au moment du déploiement — point opérationnel à confirmer avant `./sync_docs.sh`, pas un choix d'architecture.

## Hors périmètre (cette phase)

- Pas d'UI d'administration des comptes dans la PWA — gestion directe dans le Google Sheet.
- Pas de révocation d'un lien/token individuel indépendamment du compte email (cf. compromis assumé plus haut).
- Pas de rôles différenciés (moniteur/plongeur) — un compte = un email actif, sans niveau de permission.
- Pas de notification temps réel d'une révocation à une tablette actuellement ouverte et en ligne — la revalidation n'agit qu'au (re)démarrage de l'app.

## Plan de test manuel

1. Demander un lien avec un email présent et `actif=VRAI` dans le Sheet → vérifier réception de l'email (lien + token texte) et login réussi au clic.
2. Demander un lien avec un email absent ou `actif=FAUX` → vérifier le message d'erreur, aucun email envoyé.
3. Coller manuellement le token reçu (au lieu de cliquer le lien) → vérifier que le login fonctionne par ce chemin aussi.
4. Couper le réseau (mode avion) après un premier login réussi, fermer/rouvrir l'app → vérifier démarrage immédiat sur la session locale sans blocage.
5. Repasser en ligne, désactiver le compte (`actif=FAUX`) dans le Sheet, recharger l'app → vérifier la déconnexion automatique au prochain démarrage en ligne.
6. Repasser en ligne avec un compte resté actif → vérifier que la fenêtre de session est bien prolongée (inspecter `ts` en localStorage).
7. Tester un token expiré (modifier manuellement `exp` dans un token de test) et un token malformé collé → vérifier le message d'erreur adapté dans les deux cas.
8. Vérifier que "rempli par" dans le formulaire retour d'expérience est bien pré-rempli en lecture seule avec le nom de l'utilisateur connecté.
9. Vérifier sur tablette (après `./sync_docs.sh`) que le SW recharge le nouveau cache (bump `VERSION`).

## Addendum 2026-08-28 — liaison du token à l'appareil (`device_id`)

Problème identifié : le token signé est un bearer token sans liaison à l'appareil. Un poste partagé (ex. ordinateur du club) permet à quiconque de copier le lien/token reçu par email (ou lu dans `localStorage`) et de l'utiliser sur un autre appareil, obtenant un accès personnel non autorisé (session glissante 90 jours).

Correctif : `auth.js` génère un `device_id` aléatoire (`crypto.randomUUID()`, clé `smpe_device_id` en localStorage, distincte de la session, jamais envoyée par email). Il est transmis à `/auth/request-link` et `/auth/verify` (y compris la revalidation silencieuse), embarqué dans le payload signé du token (`{email, exp, device_id}`), et revérifié par `_verifierToken` : un token dont le `device_id` de payload ne correspond pas à celui envoyé par le client est rejeté, même si la signature HMAC est valide.

Limite assumée : une copie complète de `localStorage` (et pas seulement du token) vers un autre navigateur contournerait la protection — hors périmètre, cohérent avec le niveau de menace « interne au club » déjà accepté ailleurs (cf. commentaire sur la comparaison non constant-time du secret dans `auth.gs`).

Fichiers modifiés : `pwa/js/auth.js`, `google-apps-script/auth.gs` (redéploiement manuel requis, cf. `google-apps-script/README-auth.md`), `pwa/sw.js` (bump `VERSION`).

### Bug découvert en testant le device binding — parsing du token après un clic

En testant le correctif ci-dessus, le clic sur le lien magique échouait ("Lien invalide ou expiré") alors que coller le même token dans le champ dédié fonctionnait. Cause, dans `_verifierToken` (`auth.gs`), préexistante au `device_id` :

- Le token a la forme `<JSON encodé via encodeURIComponent>:<signature hex>`.
- Un token **collé** depuis le texte de l'email reste sous cette forme encodée : un seul `:` littéral (le vrai séparateur), les `:` du JSON étant encore `%3A`.
- Un token **cliqué** est lu par `URLSearchParams`, qui décode tout le `%`-encodage d'un coup — y compris les `%3A` internes au JSON (`"email":`, `"exp":`, `"device_id":`). Résultat : plusieurs `:` littéraux, et un payload déjà en clair au lieu de la forme encodée qui a servi à signer.

Deux conséquences, deux correctifs dans `_verifierToken` :
1. `indexOf(':')` tombait sur le premier `:` du JSON au lieu du vrai séparateur → remplacé par `lastIndexOf(':')` (la signature hex n'en contient jamais).
2. Une fois le bon découpage fait, la signature HMAC ne matchait toujours pas côté clic car elle avait été calculée sur la forme **encodée**, reçue en clair après décodage navigateur → normalisation ajoutée : `decodeURIComponent` (no-op si déjà décodé) puis `encodeURIComponent` pour reconstituer la forme canonique signée, avant comparaison HMAC.

Validé par simulation (Node, reproduisant `URLSearchParams` + HMAC-SHA256) puis par test réel (clic sur un lien reçu par email, sur le même appareil que la demande).

### Échec persistant en conditions réelles → migration vers base64url

Après le correctif ci-dessus, un **nouveau** lien (généré après redéploiement) échouait encore au clic, alors que coller le même token fonctionnait — signe que le token lui-même était valide (signature, `device_id` OK) mais que la chaîne recevait une transformation supplémentaire quelque part entre l'envoi de l'email et l'ouverture du lien dans le navigateur (probablement un client mail/webmail ou un scanner de liens de type "safe links" qui ré-échappe ou ré-encode l'URL). Plutôt que de rustiner encore le format `JSON encodé + ':' + signature`, le format du token a été changé pour **base64url** (alphabet `[A-Za-z0-9_-]` + `.` comme séparateur, façon JWT) :

- Aucun caractère du token n'est un caractère réservé en URI → rien à percent-encoder, donc rien qu'une réécriture d'URL (clic normal, ré-encodage complet, redirecteur type Outlook Safe Links) puisse modifier différemment selon le chemin emprunté.
- Implémenté avec `Utilities.base64EncodeWebSafe`/`base64DecodeWebSafe` (natif Apps Script, pas de lib externe, padding `=` géré manuellement), cohérent avec le style existant (HMAC déjà fait sans lib externe).
- Validé par simulation Node sur 4 scénarios : clic normal, lien entièrement ré-encodé, lien passé par un redirecteur type "safe links", collage direct — les 4 donnent le même résultat.

Fichier modifié : `google-apps-script/auth.gs` uniquement (`pwa/js/auth.js` ne parse jamais la structure interne du token, aucun changement requis côté client). Redéploiement manuel requis.
