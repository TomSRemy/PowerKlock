// games.js · Games › Play: the button that releases or calls back the sheep (js/esheep.js); the two other games are plain links.
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  function label(b) { b.textContent = window.eSheepActive && eSheepActive() ? T('Rappeler les moutons', 'Call the sheep back') : T('Lâcher les moutons', 'Release the sheep'); }
  function start() {
    const b = document.getElementById('pk-game-sheep'); if (!b) return;
    label(b);
    b.addEventListener('click', () => { if (window.eSheepToggle) eSheepToggle(); label(b); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
