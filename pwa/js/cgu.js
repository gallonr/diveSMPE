/**
 * cgu.js — Modale Conditions Générales d'Utilisation
 *
 * Expose : Cgu.open()
 * Appelée depuis :
 *   - le lien « CGU » dans l'écran de login (auth.js)
 *   - le bouton ⚖ dans le header (index.html)
 */

const Cgu = (() => {

  function open() {
    const modal = document.getElementById('modal-cgu');
    if (modal) modal.classList.remove('hidden');
  }

  function close() {
    const modal = document.getElementById('modal-cgu');
    if (modal) modal.classList.add('hidden');
  }

  function init() {
    // Bouton fermeture dans la modale
    const btnClose = document.getElementById('btn-close-cgu');
    if (btnClose) btnClose.addEventListener('click', close);

    // Fermeture au clic sur le fond de la modale
    const modal = document.getElementById('modal-cgu');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });
    }

    // Bouton header ⚖
    const btnHeader = document.getElementById('btn-cgu');
    if (btnHeader) btnHeader.addEventListener('click', open);

    // Lien CGU dans l'écran de login
    const linkLogin = document.getElementById('link-cgu-login');
    if (linkLogin) linkLogin.addEventListener('click', (e) => { e.preventDefault(); open(); });
  }

  return { init, open, close };

})();
