// tour.js · the guided tour (the owner's wish, 24 Nov. 2026): everything greyed but the place to look at, a bubble that
// says what it is for and what to set, Next / Skip. It runs once after the first sign-in (js/onboarding.js) and again from
// the account menu (« Guided tour »). Each step points at an element of the page; a step whose element is missing or hidden
// (a phone, a visitor) is skipped. On the Today page.
(function () {
  'use strict';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const shown = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.right > 8 && r.left < window.innerWidth - 8 && getComputedStyle(el).visibility !== 'hidden'; };   // on screen, not slid away (the phone menu)
  const first = sels => sels.map(s => document.querySelector(s)).find(shown) || null;
  const STEPS = [
    { at: ['#sidebar', '.mobile-burger'], t: T('Le menu', 'The menu'),
      d: el => T('Toutes les rubriques : Marchés (spot, forwards, gaz), Renouvelables (PPA, capture, M0), Système électrique, Outils et Veille.', 'Every section: Markets (spot, forwards, gas), Renewables (PPA, capture, M0), Power system, Tools and News.')
        + (el.matches('.mobile-burger') ? ' ' + T('Il s’ouvre avec ce bouton.', 'It opens with this button.') : '') },
    { at: ['#page-morning .pk-views'], t: T('Trois façons de lire la journée', 'Three ways to read the day'),
      d: T('Coup d’œil : l’essentiel en un écran. Découverte : chaque chiffre expliqué. Expert : tous les chiffres et les lectures d’analyste. Votre vue d’ouverture se règle dans Réglages › Affichage.', 'Quick look: the essentials on one screen. Discovery: each figure explained. Expert: every figure and the analyst reads. Your opening view is set in Settings › Display.') },
    { at: ['#pk-search-btn'], t: T('Rechercher et demander', 'Search and ask'),
      d: T('Trouvez une page ou un graphique (Ctrl+K). Tapez une question : PowerKlock y répond à partir de l’actualité, des textes officiels et des consultations, avec ses sources.', 'Find a page or a chart (Ctrl+K). Type a question: PowerKlock answers it from the news, official texts and consultations, with its sources.') },
    { at: ['#pk-alert-bell'], t: T('Vos alertes', 'Your alerts'),
      d: T('Le nombre d’alertes déclenchées aujourd’hui et demain. Un clic pour les voir ; les seuils se règlent dans Réglages › Alertes.', 'How many alerts triggered for today and tomorrow. Click to see them; thresholds are set in Settings › Alerts.') },
    { at: ['#pk-account-btn'], t: T('Votre compte et vos réglages', 'Your account and settings'),
      d: T('Sujets suivis, newsletter, alertes, affichage, connecteur pour Claude, mot de passe : tout est ici. Vous pouvez relancer cette visite depuis ce menu.', 'Subjects, newsletter, alerts, display, the connector for Claude, password: everything is here. You can start this tour again from this menu.') },
    { at: ['#pk-notes-fab'], t: T('Une remarque ?', 'A remark?'),
      d: T('Le bouton Note envoie une remarque sur la page en cours (un chiffre, un graphique, une idée). Elle arrive directement à l’équipe.', 'The Note button sends a remark on the current page (a figure, a chart, an idea). It goes straight to the team.') },
  ];
  let k = 0, steps = [], ov = null;
  function place() {
    const s = steps[k], el = first(s.at);
    if (!el) { next(); return; }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect(), pad = 6, vw = window.innerWidth, vh = window.innerHeight;
    const hole = ov.querySelector('.tour-hole'), tip = ov.querySelector('.tour-tip');
    Object.assign(hole.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + 2 * pad) + 'px', height: (Math.min(r.height, vh - 40) + 2 * pad) + 'px' });
    tip.innerHTML = `<div class="tour-n">${k + 1} / ${steps.length}</div><b>${s.t}</b><p>${typeof s.d === 'function' ? s.d(el) : s.d}</p>
      <div class="tour-f"><button type="button" class="tour-skip">${T('Passer la visite', 'Skip the tour')}</button><button type="button" class="tour-next">${k === steps.length - 1 ? T('Terminer', 'Finish') : T('Suivant', 'Next')}</button></div>`;
    tip.querySelector('.tour-skip').addEventListener('click', end);
    tip.querySelector('.tour-next').addEventListener('click', next);
    // the bubble beside the element: below when there is room, else above, else to its side; always on screen
    const tw = Math.min(320, vw - 24); tip.style.width = tw + 'px';
    const th = tip.offsetHeight;
    let top = r.bottom + 14, left = Math.min(Math.max(12, r.left), vw - tw - 12);
    if (top + th > vh - 12) top = r.top - th - 14;
    if (top < 12) { top = Math.min(Math.max(12, r.top), vh - th - 12); left = r.right + 14 + tw < vw ? r.right + 14 : Math.max(12, r.left - tw - 14); }
    Object.assign(tip.style, { top: top + 'px', left: left + 'px' });
    tip.querySelector('.tour-next').focus({ preventScroll: true });
  }
  function next() { k++; if (k >= steps.length) { end(); return; } place(); }
  function end() { if (ov) ov.remove(); ov = null; window.removeEventListener('resize', place); document.removeEventListener('keydown', key); }
  const key = e => { if (e.key === 'Escape') end(); else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); } };
  function start() {
    end();
    const go = () => {
      steps = STEPS.filter(s => first(s.at)); k = 0;
      if (!steps.length) return;
      ov = document.createElement('div'); ov.className = 'tour'; ov.setAttribute('translate', 'no');
      ov.innerHTML = '<div class="tour-block"></div><div class="tour-hole"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
      document.body.appendChild(ov);
      window.addEventListener('resize', place); document.addEventListener('keydown', key);
      place();
    };
    // on the Today page, the view tabs drawn
    if (!/^#today/.test(location.hash) && typeof showPage === 'function') { location.hash = '#today'; setTimeout(go, 700); } else go();
  }
  window.PKTour = { start };
})();
