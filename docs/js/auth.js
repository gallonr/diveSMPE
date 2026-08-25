/**
 * auth.js — Authentification par compte individuel (email + lien magique)
 *
 * Remplace l'ancien login partagé. Chaque plongeur demande un lien de
 * connexion envoyé par email (Worker Cloudflare → Apps Script dédié, cf.
 * specs/2026-08-25-auth-utilisateur-token-design.md). La session est
 * conservée localement 90 jours, glissante, revalidée en tâche de fond dès
 * que l'app est en ligne (jamais bloquant, pour rester utilisable hors
 * ligne en mer).
 */

const Auth = (() => {

  const SESSION_KEY   = 'smpe_auth_v2';
  const SESSION_DUREE_MS = 90 * 24 * 60 * 60 * 1000; // 90 jours, glissant

  let _session = null; // { email, nom, token, ts } une fois connecté

  // ── Session locale ───────────────────────────────────────────

  function _lireSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!stored || !stored.token || !stored.ts) return null;
      if ((Date.now() - stored.ts) >= SESSION_DUREE_MS) return null;
      return stored;
    } catch {
      return null;
    }
  }

  function _ecrireSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // quota dépassé ou stockage indisponible (navigation privée) — la
      // session reste valide pour l'onglet courant, juste pas persistée
    }
  }

  function isAuthenticated() {
    return _lireSession() !== null;
  }

  function getUser() {
    return _session ? { email: _session.email, nom: _session.nom } : null;
  }

  // ── Appels réseau ────────────────────────────────────────────

  async function _appelWorker(action, body) {
    const url = CONFIG.AUTH.workerUrl;
    if (!url) return { ok: false, error: 'workerUrl non configurée' };
    try {
      const res = await fetch(`${url}/auth/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json().catch(() => ({ ok: false, error: 'Réponse invalide' }));
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  async function demanderLien(email) {
    return _appelWorker('request-link', { email: String(email).trim().toLowerCase() });
  }

  async function validerToken(token) {
    const res = await _appelWorker('verify', { token });
    if (res.ok) {
      _session = { email: res.email, nom: res.nom, token, ts: Date.now() };
      _ecrireSession(_session);
    }
    return res;
  }

  // ── Revalidation silencieuse (non bloquante) ────────────────

  function _revaliderEnArrierePlan() {
    if (!navigator.onLine || !_session) return;
    _appelWorker('verify', { token: _session.token }).then(res => {
      if (res.ok) {
        _session = { email: res.email, nom: res.nom, token: _session.token, ts: Date.now() };
        _ecrireSession(_session);
      } else if (res.error !== 'network') {
        // Refus explicite du serveur (compte désactivé) — jamais déclenché
        // par un simple souci réseau, seulement par une réponse ok:false.
        try { localStorage.setItem('smpe_auth_revoque', '1'); } catch {}
        logout();
      }
    });
  }

  // ── Déconnexion ──────────────────────────────────────────────

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  // ── Affichage écran de login ─────────────────────────────────

  function showLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
    let revoque = false;
    try { revoque = !!localStorage.getItem('smpe_auth_revoque'); } catch {}
    if (revoque) {
      try { localStorage.removeItem('smpe_auth_revoque'); } catch {}
      _afficherMessage('login-error', 'Votre accès a été révoqué. Contactez le club.');
    }
  }

  function hideLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function _afficherMessage(elementId, msg) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  // ── Lecture du token dans l'URL (retour du lien magique) ────

  function _extraireTokenURL() {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (token) {
      params.delete('token');
      const reste = params.toString();
      history.replaceState({}, '', location.pathname + (reste ? `?${reste}` : ''));
    }
    return token;
  }

  // ── Initialisation ───────────────────────────────────────────

  function init(onSuccess) {
    const session = _lireSession();
    if (session) {
      _session = session;
      onSuccess();
      _revaliderEnArrierePlan();
      return;
    }

    showLoginScreen();

    async function _valider(token) {
      _afficherMessage('login-info', '');
      _afficherMessage('login-error', '');
      const res = await validerToken(token);
      if (res.ok) {
        hideLoginScreen();
        onSuccess();
      } else {
        _afficherMessage('login-error', 'Lien invalide ou expiré, redemandez un lien.');
      }
    }

    const tokenURL = _extraireTokenURL();
    if (tokenURL) _valider(tokenURL);

    const formLien = document.getElementById('form-demande-lien');
    formLien.addEventListener('submit', async (e) => {
      e.preventDefault();
      _afficherMessage('login-error', '');
      const email = document.getElementById('login-email').value;
      const btn = document.getElementById('btn-demander-lien');
      btn.disabled = true;
      const res = await demanderLien(email);
      btn.disabled = false;
      if (res.ok) {
        _afficherMessage('login-info', 'Lien envoyé — vérifiez vos emails.');
      } else if (res.error === 'network') {
        _afficherMessage('login-error', 'Connexion internet requise pour recevoir le lien.');
      } else {
        _afficherMessage('login-error', "Cet email n'est pas reconnu, contactez le club.");
      }
    });

    const formToken = document.getElementById('form-coller-token');
    formToken.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = document.getElementById('login-token').value.trim();
      if (token) _valider(token);
    });
  }

  return { init, logout, isAuthenticated, getUser };

})();
