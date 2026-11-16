// share-in.js · a LinkedIn post sent to PowerKlock lands in News › Posts to read, ready to add.
// It arrives as ?share_url= / ?share_text= (Android: PowerKlock installed from the browser shows in the share sheet,
// manifest.webmanifest share_target), or ?share= (the iPhone shortcut, the desktop bookmark button). The link waits in
// this tab through a sign-in; the reader adds a note and confirms: nothing is saved without that click.
(function () {
  'use strict';
  const KEY = 'pk-share-pending', T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const q = new URLSearchParams(location.search);
  const raw = ['share_url', 'share_text', 'share_title', 'share'].map(k => q.get(k)).filter(Boolean).join(' ');
  let url = (raw.match(/https:\/\/([a-z]+\.)?linkedin\.com\/[^\s"'<>]+/i) || [])[0];
  if (raw) history.replaceState(null, '', location.pathname + location.hash);
  if (url) { try { sessionStorage.setItem(KEY, url.split('?')[0]); } catch (_) {} }
  try { url = sessionStorage.getItem(KEY); } catch (_) { url = url && url.split('?')[0]; }
  if (!url) return;
  let busy = false;
  async function go() {
    const A = window.PKAccount; if (busy || !A || !A.configured) return;
    busy = true;
    try {
      if (!await A.ready()) { if (window.PKDash && PKDash.openAccount) PKDash.openAccount(); return; }   // resumes after sign-in (onChange)
      for (let i = 0; i < 40 && document.documentElement.classList.contains('pk-public'); i++) await new Promise(r => setTimeout(r, 250));
      if (document.documentElement.classList.contains('pk-public')) return;   // an account waiting for approval cannot add posts yet
      if (!/^#intel\/news/.test(location.hash)) location.hash = '#intel/news';
      let f = null;
      for (let i = 0; i < 60 && !(f = document.getElementById('news-post-url')); i++) await new Promise(r => setTimeout(r, 250));
      if (!f) return;
      f.value = url; f.dispatchEvent(new Event('change'));
      try { sessionStorage.removeItem(KEY); } catch (_) {}
      if (window.newsSetView) newsSetView('feed'); const sec = document.getElementById('hs-news-posts'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const msg = document.getElementById('news-post-msg'); if (msg) { msg.textContent = T('Post reçu : ajoutez une note si vous voulez, puis « Ajouter ».', 'Post received: add a note if you like, then “Add”.'); msg.className = 'news-add-msg ok'; }
      const note = document.getElementById('news-post-note'); if (note) setTimeout(() => note.focus(), 400);
    } finally { busy = false; }
  }
  function start() { go(); if (window.PKAccount && PKAccount.onChange) PKAccount.onChange(() => go()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
