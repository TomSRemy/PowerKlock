// ════════════════════════════════════════════════════════════════════
// notes.js · notes taken on the site, for the team and for Claude
//   "Note" button bottom right (or key N) on every page. A note keeps the page, the tab open,
//   the address, the page's settings (zone, year…), the element it is attached to ("Aim at an
//   element": a chart, table or text, outlined in yellow), the author and the time. A numbered pin
//   stays on the element. Stored in Supabase (public.site_note, warehouse/migrations/019), team only;
//   scripts/notes_sync.py copies them every hour to data/site_notes.json for Claude and writes back
//   its replies (config/note_replies.json). Not signed in: kept in this browser until sign-in.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const LKEY = 'pk-notes-local';
  let lang = 'fr'; try { lang = localStorage.getItem('pk-lang') === 'en' ? 'en' : 'fr'; } catch (_) {}
  const T = (fr, en) => lang === 'en' ? en : fr;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const off = () => /^#(solo|board)=/.test(location.hash) || /[?&]embed/.test(location.search);

  let notes = [], team = false, client = null, open = false, view = 'page', target = null, aiming = false, busy = false;

  // ── storage ─────────────────────────────────────────────────────────
  const localGet = () => { try { return JSON.parse(localStorage.getItem(LKEY) || '[]') || []; } catch (_) { return []; } };
  const localSet = a => { try { localStorage.setItem(LKEY, JSON.stringify(a)); } catch (_) {} };

  async function connect() {
    team = false; client = null;
    const A = window.PKAccount;
    if (A && A.configured) {
      try {
        await A.ready();
        if (A.user) {
          client = A.client();
          const { data } = await client.rpc('is_team');
          team = data === true;
        }
      } catch (e) { console.warn('[notes]', e); }
    }
    await reload();
  }

  async function reload() {
    if (team) {
      const loc = localGet();
      if (loc.length) {   // notes written before signing in go up once
        const rows = loc.map(n => { const r = Object.assign({}, n); delete r.id; delete r.local; delete r.author_email; return r; });
        const { error } = await client.from('site_note').insert(rows);
        if (!error) localSet([]);
      }
      const { data, error } = await client.from('site_note').select('*').order('created_at', { ascending: true }).limit(1000);
      notes = error ? [] : data;
    } else notes = localGet();
    render();
  }

  async function add(n) {
    if (team) {
      const { data, error } = await client.from('site_note').insert(n).select().single();
      if (error) throw error;
      notes.push(data);
    } else {
      const r = Object.assign({ id: 'l' + Date.now(), created_at: new Date().toISOString(), status: 'open', local: true }, n);
      notes.push(r); localSet(notes.filter(x => x.local));
    }
  }
  async function patch(n, fields) {
    if (team && !n.local) { const { error } = await client.from('site_note').update(fields).eq('id', n.id); if (error) throw error; }
    Object.assign(n, fields); if (n.local) localSet(notes.filter(x => x.local));
  }
  async function remove(n) {
    if (team && !n.local) { const { error } = await client.from('site_note').delete().eq('id', n.id); if (error) throw error; }
    notes = notes.filter(x => x !== n); localSet(notes.filter(x => x.local));
  }

  // ── where am I ──────────────────────────────────────────────────────
  const route = () => location.hash.replace(/^#/, '').split('?')[0];
  const activePage = () => document.querySelector('.page.active');
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const txt = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  function pageName() {   // as the menu says it: section › entry › sub-entry
    const nav = document.getElementById('sidebar'), out = [];
    const a = nav && (nav.querySelector('.sidebar-subitem.active') || nav.querySelector('.pk-nv-item.active') || nav.querySelector('.pk-nv-item.has-active-subitem'));
    if (a) {
      const sec = a.closest('.sidebar-section'), lab = sec && sec.querySelector('.sidebar-section-label');
      if (lab) out.push(txt(lab));
      if (a.classList.contains('sidebar-subitem')) { const w = a.closest('.pk-nav-wrap'), g = w && w.previousElementSibling; if (g && g.classList.contains('pk-nav-group')) out.push(txt(g)); }
      out.push(txt(a));
    } else { const pg = activePage(); if (pg) out.push((window.PKNav && window.PKNav.pageLabel(pg.id.replace(/^page-/, ''))) || pg.id.replace(/^page-/, '')); }
    return out.filter((x, i) => x && x !== out[i - 1]).join(' › ');
  }
  function tabName() {
    const pg = activePage(); if (!pg) return '';
    const sel = 'button.active, button.on, .active[data-tab], [role=tab][aria-selected=true], [class*="tab"].active, [class*="tab"].on';
    const out = [];
    pg.querySelectorAll(sel).forEach(b => { const t = txt(b); if (visible(b) && /\p{L}{2}/u.test(t) && t.length < 40 && !out.includes(t)) out.push(t); });
    return out.slice(0, 3).join(' · ');
  }
  function settings() {
    const pg = activePage(), s = {};
    const els = [...(pg ? pg.querySelectorAll('select[id], input[id]') : []), ...document.querySelectorAll('.topbar select[id]')];
    els.forEach(el => {
      if (!visible(el) || /^(hidden|password|text|search|email|file)$/.test(el.type)) return;
      s[el.id] = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? txt(el.selectedOptions[0]) : el.value) : el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    });
    if (pg) s._page = pg.id.replace(/^page-/, '');
    return s;
  }

  // ── elements a note can be attached to ──────────────────────────────
  // a card (chart, table, KPI, section) first; a bare heading or paragraph only outside cards
  const CARD = '.chart-container, .fuel-card, .kpi-card, .kpi, .hist-section, .grid-stack-item, .pk-card, .ma-panel, .table-wrap, table, section, .sidebar-item, .sidebar-subitem, .sidebar-section-label, .pk-nv-search, .topbar select';
  const TEXT = 'h1, h2, h3, h4, p, li, .table-title';
  function blockOf(el) {
    const pg = activePage();
    if (!el || !el.closest || el.closest('#pk-notes, #pk-notes-fab')) return null;
    const big = e => { const r = e.getBoundingClientRect(); return r.width >= 60 && r.height >= 20; };
    for (let e = el; e && e !== pg && e !== document.body; e = e.parentElement) if (e.matches(CARD) && big(e)) return e;
    for (let e = el; e && e !== pg && e !== document.body; e = e.parentElement) if (e.matches(TEXT) && big(e)) return e;
    return null;
  }
  function describe(el) {
    const t = ['.table-title', '.chart-title', '.hist-section-title', '.ma-box-title', 'h1, h2, h3, h4', '.kpi-label', 'caption', 'th'].map(q => el.querySelector(q)).find(Boolean);
    let label = (t && txt(t)) || el.getAttribute('aria-label') || (el.matches('h1,h2,h3,p') ? txt(el) : '') || el.id || '';
    if (t && t.querySelector('.pk-hs-meta')) label = txt(t).replace(txt(t.querySelector('.pk-hs-meta')), '').trim();
    label = label.slice(0, 90);
    const canvas = el.matches('canvas') ? el : el.querySelector('canvas[id]');
    const kind = canvas ? T('graphique', 'chart') : el.matches('table') || el.querySelector('table') ? T('tableau', 'table') : T('bloc', 'block');
    const id = el.id || (canvas && canvas.id) || ((el.querySelector('[id]') || {}).id) || '';
    return { id, label: label || T('élément sans titre', 'untitled element'), kind, path: cssPath(el) };
  }
  function cssPath(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 6; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + CSS.escape(e.id)); break; }
      const i = [...e.parentElement.children].filter(c => c.tagName === e.tagName).indexOf(e) + 1;
      parts.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    }
    return parts.join(' > ');
  }
  function findTarget(n) {
    let el = null;
    if (n.target_id) el = document.getElementById(n.target_id);
    if (el) el = el.matches('canvas') ? (el.closest('.chart-container, .fuel-card, .grid-stack-item') || el) : el;
    if (!el && n.settings && n.settings._path) { try { el = document.querySelector(n.settings._path); } catch (_) {} }
    return el && visible(el) ? el : null;
  }

  // ── interface ───────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  #pk-notes-fab{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:950;display:flex;align-items:center;gap:7px;background:var(--accent);color:#04121a;font:600 13px Inter,system-ui,sans-serif;border:0;border-radius:999px;padding:9px 14px;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer}
  #pk-notes-fab:hover{filter:brightness(1.08)}
  #pk-notes-fab b{background:#04121a;color:var(--accent);border-radius:999px;font-size:11px;padding:0 6px;line-height:17px}
  #pk-notes{position:fixed;right:18px;bottom:calc(66px + env(safe-area-inset-bottom,0px));z-index:951;width:380px;max-width:calc(100vw - 32px);max-height:min(78vh,720px);overflow:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.45);padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:var(--text)}
  #pk-notes .ph{display:flex;justify-content:space-between;align-items:center;gap:8px}#pk-notes .ph b{font:600 14px Outfit,Inter,sans-serif}
  #pk-notes .ctx{font-size:11.5px;color:var(--text3);background:var(--bg3);border-radius:7px;padding:6px 8px;line-height:1.5}#pk-notes .ctx b{color:var(--text2);font-weight:500}
  #pk-notes .tabs{display:flex;gap:2px;border-bottom:1px solid var(--border2)}
  #pk-notes .tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:5px 8px;font-size:12px;color:var(--text3);cursor:pointer}
  #pk-notes .tabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
  #pk-notes .att{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;color:var(--text3)}
  #pk-notes .chip{border:1px solid var(--warn);color:var(--warn);border-radius:999px;padding:1px 9px;font-size:11.5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #pk-notes .btn{border:1px solid var(--border2);border-radius:7px;padding:4px 10px;color:var(--text2);font-size:12px;background:none;cursor:pointer}
  #pk-notes .btn:hover{color:var(--text);border-color:var(--border3)}
  #pk-notes .btn.pri{background:var(--accent);border-color:var(--accent);color:#04121a;font-weight:600}
  #pk-notes .btn.x{border:0;padding:2px 6px;font-size:15px;line-height:1}
  #pk-notes textarea{width:100%;min-height:80px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:var(--text);font:12.5px/1.45 Inter,system-ui,sans-serif;padding:8px;resize:vertical;box-sizing:border-box}
  #pk-notes textarea:focus{outline:none;border-color:var(--accent)}
  #pk-notes .row{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
  #pk-notes .who{margin-right:auto;font-size:11px;color:var(--text3)}
  #pk-notes .list{display:flex;flex-direction:column;gap:8px}
  #pk-notes .note{border:1px solid var(--border2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
  #pk-notes .note.flash{border-color:var(--warn)}
  #pk-notes .note .h{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--text3);align-items:flex-start}
  #pk-notes .note .h a{color:var(--text2);text-decoration:none}#pk-notes .note .h a:hover{color:var(--accent)}
  #pk-notes .note .b{white-space:pre-wrap;word-break:break-word;color:var(--text)}
  #pk-notes .n{display:inline-flex;flex:none;width:18px;height:18px;border-radius:50%;background:var(--warn);color:#111;font-weight:700;font-size:11px;align-items:center;justify-content:center;margin-right:6px}
  #pk-notes .n.ok{background:var(--accent)}
  #pk-notes .st{font-size:11px;border-radius:999px;padding:0 7px;border:1px solid;background:none;cursor:pointer;white-space:nowrap}
  #pk-notes .st.open{color:var(--warn);border-color:var(--warn)}#pk-notes .st.done,#pk-notes .st.wontfix{color:var(--accent);border-color:var(--accent)}
  #pk-notes .reply{font-size:11.5px;color:var(--text2);border-left:2px solid var(--accent);padding-left:8px;white-space:pre-wrap}
  #pk-notes .del{background:none;border:0;color:var(--text3);cursor:pointer;font-size:11px;padding:0}#pk-notes .del:hover{color:var(--down)}
  #pk-notes .empty{color:var(--text3);font-size:12px;padding:6px 0}
  #pk-notes .warn{font-size:11.5px;color:var(--warn);background:var(--warn-dim);border-radius:7px;padding:6px 8px}
  .pk-note-pin{position:fixed;z-index:940;width:22px;height:22px;border-radius:50%;background:var(--warn);color:#111;font:700 11.5px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px rgba(251,191,36,.25);cursor:pointer;border:0;padding:0}
  .pk-note-pin.ok{background:var(--accent);box-shadow:0 0 0 4px rgba(20,211,169,.2)}
  #pk-note-aim{position:fixed;z-index:960;pointer-events:none;border:2px solid var(--warn);border-radius:10px;box-shadow:0 0 0 9999px rgba(0,8,16,.3);transition:all .08s}
  #pk-note-bar{position:fixed;left:50%;top:calc(var(--ticker-h,0px) + 64px);transform:translateX(-50%);z-index:961;background:var(--bg3);color:var(--text);border:1px solid var(--warn);border-radius:999px;padding:6px 14px;font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
  #pk-notes[hidden],#pk-notes-fab[hidden],#pk-note-aim[hidden]{display:none}
  body.pk-aiming, body.pk-aiming *{cursor:crosshair!important}
  @media (max-width:640px){#pk-notes-fab{padding:9px 12px}#pk-notes-fab span{display:none}#pk-notes{right:16px;left:16px;width:auto}}
  @media print{#pk-notes-fab,#pk-notes,.pk-note-pin{display:none!important}}`;
  document.head.appendChild(css);

  const PEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
  let fab, panel, draft = '';
  const fmt = iso => { try { return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); } catch (_) { return ''; } };
  const who = n => n.local ? T('toi (ce navigateur)', 'you (this browser)') : (n.author_email || '').split('@')[0].split(/[._]/)[0].replace(/^./, c => c.toUpperCase()) || '—';
  const onPage = () => notes.filter(n => n.route === route());
  const isOpen = n => n.status === 'open';

  function build() {
    fab = document.createElement('button');
    fab.id = 'pk-notes-fab'; fab.type = 'button'; fab.title = T('Prendre une note sur cette page (N)', 'Take a note on this page (N)');
    fab.onclick = () => toggle();
    document.body.appendChild(fab);
    panel = document.createElement('div');
    panel.id = 'pk-notes'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notes');
    document.body.appendChild(panel);
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', e => { if (e.target.id === 'pk-note-txt') draft = e.target.value; });
    panel.addEventListener('keydown', e => { if (e.target.id === 'pk-note-txt' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
  }

  function render() {
    if (!fab) return;
    const hide = off();
    fab.hidden = hide; if (hide) { panel.hidden = true; pins(); return; }
    const mine = onPage().filter(isOpen).length;
    fab.innerHTML = PEN + '<span>' + T('Note', 'Note') + '</span>' + (mine ? '<b>' + mine + '</b>' : '');
    pins();
    if (!open) { panel.hidden = true; return; }
    panel.hidden = false;
    const tab = tabName(), set = settings(), shown = Object.entries(set).filter(([k]) => k[0] !== '_').slice(0, 4);
    const lists = { page: onPage().filter(isOpen), all: notes.filter(isOpen), done: notes.filter(n => !isOpen(n)).reverse() };
    const list = lists[view];
    const numOf = n => onPage().indexOf(n) + 1;
    panel.innerHTML = `
      <div class="ph"><b>Notes</b><span><button class="btn" data-a="copy" title="${T('Copie les notes à faire, avec leur contexte, pour les coller dans une conversation avec Claude', 'Copies the open notes with their context, to paste into a conversation with Claude')}">${T('Copier pour Claude', 'Copy for Claude')}</button> <button class="btn x" data-a="close" aria-label="${T('Fermer', 'Close')}">✕</button></span></div>
      ${team ? '' : `<div class="warn">${window.PKAccount && window.PKAccount.user ? T('Ce compte n’est pas dans l’équipe : les notes restent dans ce navigateur.', 'This account is not in the team: notes stay in this browser.') : T('Non connecté : les notes restent dans ce navigateur et partiront dans Supabase à la connexion.', 'Not signed in: notes stay in this browser and go to Supabase once you sign in.')}</div>`}
      <div class="ctx">${T('Page', 'Page')} <b>${esc(pageName())}</b>${tab ? ' · ' + T('onglet', 'tab') + ' <b>' + esc(tab) + '</b>' : ''}${shown.map(([k, v]) => ' · ' + esc(k.replace(/^(pk-|fr-|hist-)/, '')) + ' <b>' + esc(v) + '</b>').join('')} · ${T('adresse', 'address')} <b>#${esc(route())}</b></div>
      <div class="att">${T('Attachée à', 'Attached to')} ${target ? `<span class="chip" title="${esc(target.label)}">${esc(target.label)} (${esc(target.kind)})</span><button class="btn" data-a="untarget">${T('Retirer', 'Remove')}</button>` : `<span>${T('la page', 'the page')}</span>`}<button class="btn" data-a="aim">${target ? T('Viser un autre élément', 'Aim at another element') : T('Viser un élément', 'Aim at an element')}</button></div>
      <textarea id="pk-note-txt" maxlength="4000" placeholder="${T('Ce que tu veux changer, ajouter, corriger…', 'What you would change, add or fix…')}">${esc(draft)}</textarea>
      <div class="row"><span class="who">${team ? T('Partagée avec l’équipe et Claude', 'Shared with the team and Claude') : ''}</span><button class="btn" data-a="cancel">${T('Annuler', 'Cancel')}</button><button class="btn pri" data-a="save" ${busy ? 'disabled' : ''}>${T('Enregistrer', 'Save')} · Ctrl+Entrée</button></div>
      <div class="tabs" role="tablist">${[['page', T('Cette page', 'This page'), lists.page.length], ['all', T('Tout le site', 'Whole site'), lists.all.length], ['done', T('Faites', 'Done'), lists.done.length]].map(([k, l, c]) => `<button role="tab" data-v="${k}" class="${view === k ? 'on' : ''}" aria-selected="${view === k}">${l} (${c})</button>`).join('')}</div>
      <div class="list">${list.length ? list.map(n => item(n, numOf(n))).join('') : `<div class="empty">${view === 'done' ? T('Rien de fait pour l’instant.', 'Nothing done yet.') : T('Aucune note à faire ici.', 'No open note here.')}</div>`}</div>`;
  }

  function item(n, num) {
    const here = n.route === route();
    const title = n.target_label || n.page || '#' + n.route;
    const place = here ? '' : ` <a href="#${esc(n.route)}" data-a="goto" data-id="${esc(n.id)}" title="${T('Aller à la page', 'Go to the page')}">${esc(n.page || '#' + n.route)}${n.tab ? ' · ' + esc(n.tab) : ''}</a>`;
    const stLabel = { open: T('à faire', 'to do'), done: T('fait', 'done'), wontfix: T('pas retenu', 'not kept') }[n.status] || n.status;
    return `<div class="note" data-id="${esc(n.id)}">
      <div class="h"><span><span class="n${isOpen(n) ? '' : ' ok'}">${isOpen(n) ? (here && num ? num : '•') : '✓'}</span>${esc(title)}${place}</span><button class="st ${esc(n.status)}" data-a="status" data-id="${esc(n.id)}" title="${T('Changer l’état', 'Change the status')}">${stLabel}</button></div>
      <div class="b">${esc(n.body)}</div>
      ${n.reply ? `<div class="reply">Claude : ${esc(n.reply)}</div>` : ''}
      <div class="h"><span>${esc(who(n))} · ${fmt(n.created_at)}</span>${n.local || (team && window.PKAccount.user && n.author === window.PKAccount.user.id) ? `<button class="del" data-a="del" data-id="${esc(n.id)}">${T('Supprimer', 'Delete')}</button>` : ''}</div></div>`;
  }

  const byId = id => notes.find(n => String(n.id) === String(id));
  async function onPanelClick(e) {
    const b = e.target.closest('[data-a],[data-v]'); if (!b) return;
    if (b.dataset.v) { view = b.dataset.v; return render(); }
    const a = b.dataset.a, n = b.dataset.id ? byId(b.dataset.id) : null;
    try {
      if (a === 'close') toggle(false);
      else if (a === 'cancel') { draft = ''; target = null; toggle(false); }
      else if (a === 'save') await save();
      else if (a === 'aim') startAim();
      else if (a === 'untarget') { target = null; render(); }
      else if (a === 'copy') copy(b);
      else if (a === 'status' && n) { const next = isOpen(n) ? 'done' : 'open'; await patch(n, { status: next, done_at: next === 'open' ? null : new Date().toISOString() }); render(); }
      else if (a === 'del' && n) {
        if (b.dataset.sure) { await remove(n); render(); }
        else { b.dataset.sure = '1'; b.textContent = T('Confirmer ?', 'Confirm?'); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = T('Supprimer', 'Delete'); } }, 3000); }
      } else if (a === 'goto') { e.preventDefault(); view = 'page'; if (window.PKNav) window.PKNav.go(n.route); else location.hash = n.route; }
    } catch (err) { console.warn('[notes]', err); flash(T('Échec : ', 'Failed: ') + (err.message || err)); }
  }
  function flash(msg) { const w = document.createElement('div'); w.className = 'warn'; w.textContent = msg; panel.prepend(w); setTimeout(() => w.remove(), 5000); }

  async function save() {
    const body = (draft || '').trim(); if (!body || busy) return;
    busy = true;
    const set = settings(); if (target) set._path = target.path;
    try {
      await add({ route: route(), page: pageName(), tab: tabName() || null, target_id: target ? target.id || null : null, target_label: target ? target.label + ' (' + target.kind + ')' : null, settings: set, body: body.slice(0, 4000) });
      draft = ''; target = null; view = 'page';
    } catch (err) { busy = false; render(); return flash(T('Pas enregistrée : ', 'Not saved: ') + (err.message || err)); }
    busy = false; render();
  }

  function copy(btn) {
    const open_ = notes.filter(isOpen);
    const lines = [T('Notes PowerKlock à traiter', 'PowerKlock notes to handle') + ' (' + open_.length + ')', ''];
    open_.forEach((n, i) => {
      const s = Object.entries(n.settings || {}).filter(([k]) => k[0] !== '_').map(([k, v]) => k + '=' + v).join(', ');
      lines.push((i + 1) + '. [' + (n.page || '') + (n.tab ? ' › ' + n.tab : '') + '] #' + n.route + (n.target_label ? ' · ' + T('élément', 'element') + ' : ' + n.target_label + (n.target_id ? ' (id ' + n.target_id + ')' : '') : ''));
      if (s) lines.push('   ' + T('réglages', 'settings') + ' : ' + s);
      lines.push('   ' + n.body.replace(/\n/g, '\n   ') + '   — ' + who(n) + ', ' + fmt(n.created_at) + (n.id && !n.local ? ' · note ' + n.id : ''));
    });
    const text = lines.join('\n');
    const done = () => { btn.textContent = T('Copié ✓', 'Copied ✓'); setTimeout(() => { if (btn.isConnected) btn.textContent = T('Copier pour Claude', 'Copy for Claude'); }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { draft = text; render(); });
    else { draft = text; render(); }
  }

  function toggle(on) {
    open = on === undefined ? !open : on;
    if (open) { view = 'page'; }
    render();
    if (open) { const t = document.getElementById('pk-note-txt'); if (t) t.focus(); }
  }

  // ── aiming at an element ────────────────────────────────────────────
  let aimBox, aimBar, aimEl = null;
  function startAim() {
    aiming = true; panel.hidden = true; document.body.classList.add('pk-aiming');
    aimBox = document.createElement('div'); aimBox.id = 'pk-note-aim'; aimBox.hidden = true;
    aimBar = document.createElement('div'); aimBar.id = 'pk-note-bar'; aimBar.textContent = T('Clique sur un graphique, un tableau ou un texte · Échap pour annuler', 'Click a chart, a table or a text · Esc to cancel');
    document.body.append(aimBox, aimBar);
    document.addEventListener('mousemove', aimMove, true);
    document.addEventListener('click', aimClick, true);
  }
  function aimMove(e) {
    aimEl = blockOf(e.target);
    if (!aimEl) { aimBox.hidden = true; return; }
    const r = aimEl.getBoundingClientRect();
    Object.assign(aimBox.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' }); aimBox.hidden = false;
  }
  function aimClick(e) {
    e.preventDefault(); e.stopPropagation();
    const el = blockOf(e.target) || aimEl;
    stopAim();
    if (el) target = describe(el);
    render();
    const t = document.getElementById('pk-note-txt'); if (t) t.focus();
  }
  function stopAim() {
    aiming = false; document.body.classList.remove('pk-aiming');
    document.removeEventListener('mousemove', aimMove, true);
    document.removeEventListener('click', aimClick, true);
    if (aimBox) aimBox.remove(); if (aimBar) aimBar.remove(); aimBox = aimBar = aimEl = null;
  }

  // ── pins on the elements ────────────────────────────────────────────
  let pinEls = [], raf = 0;
  function pins() {
    pinEls.forEach(p => p.remove()); pinEls = [];
    if (off() || aiming) return;
    const list = onPage();
    list.forEach((n, i) => {
      if (!isOpen(n)) return;
      const el = findTarget(n); if (!el) return;
      const p = document.createElement('button');
      p.type = 'button'; p.className = 'pk-note-pin'; p.textContent = i + 1; p.title = n.body.slice(0, 140);
      p._el = el;
      p.onclick = () => { open = true; view = 'page'; render(); const c = panel.querySelector('.note[data-id="' + CSS.escape(String(n.id)) + '"]'); if (c) { c.classList.add('flash'); c.scrollIntoView({ block: 'nearest' }); setTimeout(() => c.classList.remove('flash'), 1600); } };
      document.body.appendChild(p); pinEls.push(p);
    });
    place();
  }
  function place() {
    raf = 0;
    pinEls.forEach(p => {
      const r = p._el.getBoundingClientRect();
      const show = r.width > 0 && r.bottom > 60 && r.top < innerHeight;
      p.style.display = show ? '' : 'none';
      if (show) { p.style.left = Math.max(4, r.left - 8) + 'px'; p.style.top = Math.max(4, r.top - 8) + 'px'; }
    });
  }
  const schedule = () => { if (pinEls.length && !raf) raf = requestAnimationFrame(place); };
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);

  // ── wiring ──────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (aiming) { stopAim(); render(); } else if (open) toggle(false); return; }
    if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey || off()) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault(); toggle(true);
  });
  let lastRoute = null;
  const changed = () => { if (route() !== lastRoute) { lastRoute = route(); if (open && !draft) target = null; } setTimeout(render, 60); };
  addEventListener('hashchange', changed);
  addEventListener('popstate', changed);
  if (window.PK && PK.onPage) PK.onPage('*', changed);

  function init() {
    build(); render();
    connect();
    if (window.PKAccount && PKAccount.onChange) PKAccount.onChange(() => connect());
    setInterval(() => { if (team && !open) reload(); }, 10 * 60 * 1000);   // replies from Claude
    setInterval(() => { if (!aiming && onPage().some(n => isOpen(n) && (n.target_id || (n.settings && n.settings._path)))) pins(); }, 1500);   // charts drawn late, tabs
  }
  window.PKNotes = { list: () => notes.slice(), open: () => toggle(true), get team() { return team; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
