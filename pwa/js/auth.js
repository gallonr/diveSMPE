/**
 * auth.js — Authentification locale (login + mot de passe hashé SHA-256)
 *
 * Identifiants par défaut :
 *   login    : smpe
 *   password : smpe2026
 *
 * Pour changer le mot de passe, calculez le SHA-256 du nouveau mot de passe
 * et remplacez la valeur de HASH_PASSWORD ci-dessous.
 * Exemple JS : const hash = await sha256("nouveauMotDePasse");
 */

const Auth = (() => {

  const VALID_LOGIN    = 'smpe';
  const HASH_PASSWORD  = 'cc45ac040c800aa7093a3f804b8dd284213bb5df03419526c00ba91881d565af';
  const SESSION_KEY    = 'smpe_auth';
  const SESSION_EXPIRY = 8 * 60 * 60 * 1000; // 8 heures en ms

  // ── Hash SHA-256 via Web Crypto API ──────────────────────────

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Vérifie si la session est encore valide ──────────────────

  function isAuthenticated() {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (!stored) return false;
      const { ts } = JSON.parse(stored);
      return (Date.now() - ts) < SESSION_EXPIRY;
    } catch {
      return false;
    }
  }

  // ── Tente de connecter l'utilisateur ────────────────────────

  async function login(loginInput, passwordInput) {
    const hash = await sha256(passwordInput);
    if (loginInput.trim().toLowerCase() === VALID_LOGIN && hash === HASH_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
      return true;
    }
    return false;
  }

  // ── Déconnexion ──────────────────────────────────────────────

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  // ── Affiche l'écran de login ─────────────────────────────────

  function showLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function hideLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ── Initialisation ───────────────────────────────────────────

  function init(onSuccess) {
    if (isAuthenticated()) {
      hideLoginScreen();
      if (onSuccess) onSuccess();
      return;
    }

    showLoginScreen();

    const form      = document.getElementById('login-form');
    const errorMsg  = document.getElementById('login-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const loginVal = document.getElementById('login-input').value;
      const passVal  = document.getElementById('login-password').value;

      const ok = await login(loginVal, passVal);
      if (ok) {
        hideLoginScreen();
        if (onSuccess) onSuccess();
      } else {
        errorMsg.textContent = '❌ Identifiants incorrects';
        errorMsg.classList.remove('hidden');
        document.getElementById('login-password').value = '';
        setTimeout(() => errorMsg.classList.add('hidden'), 3000);
      }
    });
  }

  return { init, logout, isAuthenticated };

})();
