// gate.js · the public page. A visitor without an approved account (public.user_access, warehouse migration 022)
// sees Today › Expert only, in dark, under a bar with one button to sign in or create an account; a signed-in
// account still waiting for approval sees the same page with a notice. An approved account gets the whole site
// and never comes back here. The index.html head script decides first (window.pkGateOn, class pk-public, cached
// approval 'pk-approved') so the page does not flash; this file confirms with the account and keeps visitors on Today.
// The data files stay public (they are the site's API): the gate keeps the site simple for visitors, it is not a lock.
(function () {
  'use strict';
  if (!window.pkGateOn) return;
  const H = document.documentElement, HOME = '#today?v=2';
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const onToday = () => /^#today(\?|$)/.test(location.hash);
  const authHash = () => /access_token=|error_description=|[?&]code=/.test(location.hash + location.search);
  const cache = v => { try { if (v) localStorage.setItem('pk-approved', '1'); else localStorage.removeItem('pk-approved'); } catch (_) {} };
  let state = H.classList.contains('pk-public') ? 'guest' : 'open';

  function bar() {
    let el = document.getElementById('pk-gate');
    if (!el) { el = document.createElement('div'); el.id = 'pk-gate'; document.body.prepend(el); }
    const A = window.PKAccount, mail = A && A.user && A.user.email ? A.user.email : '';
    el.innerHTML = `<div class="pk-gate-in"><img src="assets/logo-header.png" alt="PowerKlock" translate="no"><span class="pk-gate-beta">${T('bêta', 'beta')}</span><span class="pk-gate-sp"></span>` +
      (state === 'pending'
        ? `<span class="pk-gate-m"><b>${T('Votre compte attend validation.', 'Your account is waiting for approval.')}</b><span>${T('Vous recevrez un e-mail une fois l’accès ouvert', 'You will get an e-mail once access is open')} · ${PK.esc(mail)}</span></span><button type="button" class="pk-gate-out" id="pk-gate-out">${T('Se déconnecter', 'Sign out')}</button>`
        : `<span class="pk-gate-m"><b>${T('Pour en voir plus, connectez-vous.', 'To see more, sign in.')}</b><span>${T('Lien par e-mail, sans mot de passe. Nouveaux comptes activés après validation.', 'A link by e-mail, no password. New accounts are activated after approval.')}</span></span><button type="button" class="pk-gate-go" id="pk-gate-go"><span class="pk-gate-lg">${T('Se connecter ou créer un compte', 'Sign in or create an account')}</span><span class="pk-gate-sm">${T('Connexion', 'Sign in')}</span></button>`) + '</div>';
    const go = el.querySelector('#pk-gate-go'); if (go) go.addEventListener('click', signIn);
    const out = el.querySelector('#pk-gate-out'); if (out) out.addEventListener('click', () => window.PKAccount && PKAccount.signOut());
  }
  function signIn() { if (window.PKDash && PKDash.openAccount) PKDash.openAccount(); }

  function lock(s) {
    state = s; cache(false);
    H.classList.add('pk-public'); H.removeAttribute('data-theme');
    // back from the e-mail link the address still holds the token for a moment (js/dashboard.js clears it): wait for it
    setTimeout(() => { if (state !== 'open' && !authHash() && !onToday()) location.hash = HOME; expert(0); }, authHash() ? 1500 : 0);
    bar();
  }
  // Today opens on its last view (Quick look by default): a visitor gets Expert, the full page
  function expert(n) {
    if (state === 'open') return;
    const b = [...document.querySelectorAll('#page-morning .pk-views .tab-btn')].find(x => (window.pkEN ? pkEN(x.textContent.trim()) : x.textContent.trim()) === 'Expert');
    if (b) { if (!b.classList.contains('active')) b.click(); return; }
    if (n < 40) setTimeout(() => expert(n + 1), 250);
  }
  function open(approved) {
    const was = state !== 'open';
    state = 'open'; cache(approved);
    H.classList.remove('pk-public');
    const el = document.getElementById('pk-gate'); if (el) el.remove();
    if (was) { try { if (localStorage.getItem('pk-theme') === 'light') H.setAttribute('data-theme', 'light'); } catch (_) {} }
  }

  async function check() {
    const A = window.PKAccount;
    if (!A || !A.configured) return open(false);
    const u = await A.ready();
    if (!u) return lock('guest');
    const { data, error } = await A.client().from('user_access').select('status').eq('user_id', u.id).maybeSingle();
    if (error) { console.warn('[gate] access not read:', error.message); return open(false); }   // never lock the owner out on a database hiccup
    if (data && data.status === 'approved') return open(true);
    lock('pending');
  }

  // a visitor stays on Today › Expert: links to other pages open the sign-in instead
  window.addEventListener('hashchange', () => { if (state !== 'open' && !authHash() && !onToday()) location.replace(location.pathname + location.search + HOME); });
  document.addEventListener('click', e => {
    if (state === 'open' || !e.target.closest) return;
    const a = e.target.closest('a[href^="#"], [data-route]');
    if (!a || a.closest('#pk-gate') || a.closest('.pkd-modal')) return;
    e.preventDefault(); e.stopPropagation();
    if (state === 'guest') signIn();
  }, true);

  function start() {
    if (state !== 'open') bar();
    check();
    if (window.PKAccount && PKAccount.onChange) PKAccount.onChange(() => check());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
