// News come from data/news.json, written every 3 hours by
// scripts/fetch_news.py (GitHub Actions) from the sources of
// config/news_sources.json: RSS/Atom feeds, the CRE news page, press searches.
// No client-side proxy and no placeholder articles: if the file is missing
// the page says so.
async function loadNews() {
  window._newsLoaded = true;
  const badge = document.getElementById('news-updated');
  if (!window._newsAcctWired && window.PKAccount && PKAccount.configured) {
    window._newsAcctWired = true;
    PKAccount.onChange(async () => { await _newsLoadPersonal(); _newsApplyConfig(); _newsRefreshKwUI(); renderNewsPosts(); renderNews(newsData); if (_nlData !== undefined) { await _nlLoadMe(); renderNewsLetter(); } });
  }
  await Promise.all([_newsLoadSections(), _newsLoadPersonal(), _newsLoadDigest(), _newsLoadCons()]);
  try {
    const r = await fetch(DATA_BASE + 'news.json?t=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    newsData = (j.items || []).map(i => Object.assign({}, i, { date: new Date(i.date) }))
      .sort((a, b) => (b.impact || 0) - (a.impact || 0) || b.date - a.date);
    newsData = _newsRank(newsData);
    const upd = j.updated ? new Date(j.updated).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '';
    window._newsSources = j.sources || null;
    const nSrc = j.sources ? j.sources.filter(s => s.kind !== 'search').length : new Set(newsData.map(n => n.source)).size;
    if (badge) badge.textContent = `${newsData.length} articles · ${nSrc} sources${j.sources ? ' + ' + j.sources.filter(s => s.kind === 'search').length + ' searches' : ''} · ${upd}`;
  } catch (e) {
    newsData = [];
    if (badge) badge.textContent = 'News feed unavailable';
  }
  _newsWireKw();
  _newsApplyConfig();
  renderNewsDigest();
  renderNewsCons();
  renderNewsPosts();
  renderNews(newsData);
  renderNewsSources();
  renderNewsAdd();
  _newsWireViews();
  renderNewsConsMini();
  renderNewsOfficial();
  renderNewsCover();
}

// ── Two views (The feed / Official texts) and, in the feed, two displays (by story / all articles) and two orders ──
let _newsMode = 'topics', _newsSort = 'important', _newsOffSrc = '';
const _newsStore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) {} return null; };
function newsSetView(v) {
  v = ['official', 'letter'].includes(v) ? v : 'feed';
  document.querySelectorAll('#news-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.nv === v));
  const f = document.getElementById('news-v-feed'), o = document.getElementById('news-v-official');
  if (f) f.hidden = v !== 'feed'; if (o) o.hidden = v !== 'official';
  const l = document.getElementById('news-v-letter'); if (l) l.hidden = v !== 'letter';
  if (v === 'letter') renderNewsLetter();
  _newsStore('pk-news-view', v);
}
window.newsSetView = newsSetView;
function _newsWireViews() {
  const tabs = document.getElementById('news-tabs');
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = '1';
    tabs.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => newsSetView(b.dataset.nv)));
    newsSetView(_newsStore('pk-news-view') || 'feed');
    _newsMode = _newsStore('pk-news-mode') === 'list' ? 'list' : 'topics';
    _newsSort = _newsStore('pk-news-sort') === 'recent' ? 'recent' : 'important';
    const sync = () => {
      document.querySelectorAll('[data-nm]').forEach(b => b.classList.toggle('active', b.dataset.nm === _newsMode));
      document.querySelectorAll('[data-ns]').forEach(b => b.classList.toggle('active', b.dataset.ns === _newsSort));
    };
    document.querySelectorAll('[data-nm]').forEach(b => b.addEventListener('click', () => { _newsMode = b.dataset.nm; _newsStore('pk-news-mode', _newsMode); sync(); renderNews(newsData); }));
    document.querySelectorAll('[data-ns]').forEach(b => b.addEventListener('click', () => { _newsSort = b.dataset.ns; _newsStore('pk-news-sort', _newsSort); sync(); renderNews(newsData); }));
    sync();
    const sb = document.getElementById('news-src-btn');
    if (sb) sb.addEventListener('click', () => { const sec = document.getElementById('hs-news-src'); if (sec) { sec.classList.remove('collapsed'); const h = sec.querySelector('.hist-section-header'), bd = document.getElementById('hs-body-news-src'); if (h) h.classList.add('open'); if (bd) bd.classList.add('open'); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
    if (_newsMode !== 'topics' || _newsSort !== 'important') renderNews(newsData);
  }
}

const _NEWS_TAG_L = { renewables: ['renouvelables', 'renewables'], power: ['électricité', 'power'], gas: ['gaz', 'gas'], carbon: ['carbone', 'carbon'], regulation: ['régulation', 'regulation'], markets: ['marchés', 'markets'],
  geopolitics: ['géopolitique', 'geopolitics'], deal: ['transactions', 'deals'], build: ['nouvelles capacités', 'new capacity'], assoc: ['associations', 'associations'], report: ['rapports', 'reports'] };
const _newsTagL = t => _NEWS_TAG_L[t] ? _newsT(..._NEWS_TAG_L[t]) : t;
const _newsDay = d => { const en = window.PKI18n && PKI18n.lang === 'en'; return new Date(d).toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }); };
const _newsToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const _newsLeft = d => Math.round((new Date(d + 'T12:00:00Z') - new Date(_newsToday() + 'T12:00:00Z')) / 864e5);

// the three nearest deadlines, beside the feed; the full list is in Official texts
function renderNewsConsMini() {
  const box = document.getElementById('news-side-cons'), host = document.getElementById('news-cons-mini'); if (!box || !host) return;
  const today = _newsToday();
  const open = ((_newsCons && _newsCons.items) || []).filter(c => c.deadline && c.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (!open.length) { box.hidden = true; return; }
  box.hidden = false;
  const th = k => { const t = _NEWS_CONS_THEMES[k || 'other'] || _NEWS_CONS_THEMES.other; return _newsT(t[0], t[1]); };
  host.innerHTML = open.slice(0, 3).map(c => { const n = _newsLeft(c.deadline);
    return `<a class="news-cmini" href="${_newsEsc(c.link)}" target="_blank" rel="noopener noreferrer"><span class="cons-due${n <= 7 ? ' soon' : ''}">${n === 0 ? _newsT('auj.', 'today') : 'J-' + n}</span><span><small>${_newsEsc(c.source.split(' · ')[0])} · ${th(c.theme)}</small>${_newsEsc(c.title)}</span></a>`; }).join('') +
    `<button type="button" class="pk-btn-ghost news-side-more" id="news-cons-all">${_newsT('Toutes les consultations', 'All consultations')} (${open.length})</button>`;
  document.getElementById('news-cons-all').addEventListener('click', () => { newsSetView('official'); const s = document.getElementById('hs-news-cons'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

// where an official text comes from: the Journal officiel, EUR-Lex or the CRE
const _newsOffKind = i => /journal officiel/i.test(i.source) ? 'jo' : /eur-?lex|union europ|european union/i.test(i.source) ? 'eu' : /\bCRE\b/.test(i.source) || i.cls === 'cre' ? 'cre' : 'other';
const _NEWS_OFF_K = { jo: ['Journal officiel', 'Official Journal (FR)'], eu: ['UE', 'EU'], cre: ['CRE', 'CRE'], other: ['Autre', 'Other'] };
const _newsTextType = t => { const m = (t || '').match(/^(Décret|Arrêté|Ordonnance|Loi|Délibération|Décision|Avis|Règlement|Directive|Regulation|Directive|Decision)\b/i); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : ''; };
function renderNewsOfficial() {
  const host = document.getElementById('news-off'), pub = document.getElementById('news-pub'); if (!host) return;
  const month = Date.now() - 30 * 864e5;
  const all = (newsData || []).filter(i => (i.tags || []).includes('official') && i.date >= month).sort((a, b) => b.date - a.date);
  const n = document.getElementById('news-tab-off-n'); if (n) n.textContent = all.length ? all.length : '';
  const cnt = {}; all.forEach(i => { const k = _newsOffKind(i); cnt[k] = (cnt[k] || 0) + 1; });
  if (_newsOffSrc && !cnt[_newsOffSrc]) _newsOffSrc = '';
  const keys = Object.keys(_NEWS_OFF_K).filter(k => cnt[k]);
  const chips = keys.length > 1 ? `<div class="cons-chips">${[['', _newsT('Tous', 'All'), all.length]].concat(keys.map(k => [k, _newsT(..._NEWS_OFF_K[k]), cnt[k]])).map(([k, l, c]) => `<button type="button" class="filter-btn${k === _newsOffSrc ? ' active' : ''}" data-os="${k}">${l} <small>${c}</small></button>`).join('')}</div>` : '';
  const rows = all.filter(i => !_newsOffSrc || _newsOffKind(i) === _newsOffSrc);
  host.innerHTML = all.length ? chips + `<div class="news-off-wrap"><table class="news-off-t"><thead><tr><th>${_newsT('Date', 'Date')}</th><th>${_newsT('Source', 'Source')}</th><th>${_newsT('Type', 'Type')}</th><th>${_newsT('Texte', 'Text')}</th></tr></thead><tbody>${rows.map(i => `<tr><td class="news-off-d">${_newsDay(i.date)}</td><td>${_newsEsc(_newsT(..._NEWS_OFF_K[_newsOffKind(i)]))}</td><td>${_newsTextType(i.title) ? `<span class="news-tag">${_newsEsc(_newsTextType(i.title))}</span>` : ''}</td><td><a href="${_newsEsc(i.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc(i.title)}</a></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="news-src-help">${_newsT('Aucun texte officiel sur l’énergie dans les 30 derniers jours collectés.', 'No energy text in the last 30 days collected.')}</div>`;
  host.querySelectorAll('[data-os]').forEach(b => b.addEventListener('click', () => { _newsOffSrc = b.dataset.os; renderNewsOfficial(); }));
  if (pub) {
    const p = (newsData || []).filter(i => i.date >= month && !(i.tags || []).includes('official') && ((i.tags || []).includes('report') || /^(rte|eex)$/i.test(i.cls || '') || /^(RTE|EEX)\b/.test(i.source))).sort((a, b) => b.date - a.date).slice(0, 30);
    pub.innerHTML = p.length ? `<ul class="news-pub">${p.map(i => `<li><span class="news-off-d">${_newsDay(i.date)}</span><a href="${_newsEsc(i.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc(i.title)}</a><small>${_newsEsc(i.source)}</small></li>`).join('')}</ul>`
      : `<div class="news-src-help">${_newsT('Aucune publication dans les 30 derniers jours collectés.', 'No publication in the last 30 days collected.')}</div>`;
  }
}

// ── Newsletter (data/newsletter.json, scripts/news_letter.py): one edition per reading profile (config/news_profiles.json),
// the profile chosen here is kept in this browser; the morning e-mail sends the same edition ──
let _nlData, _nlWeek, _nlEd = 'daily', _nlMe;
const _NL_INTERESTS = [['renewables', 'Renouvelables, PPA, garanties d’origine', 'Renewables, PPAs, guarantees of origin'], ['markets', 'Marchés et prix', 'Markets and prices'],
  ['regulation', 'Régulation', 'Regulation'], ['gas', 'Gaz', 'Gas'], ['carbon', 'Carbone', 'Carbon'], ['deal', 'Transactions', 'Deals'], ['build', 'Nouvelles capacités', 'New capacity'],
  ['geopolitics', 'Géopolitique', 'Geopolitics'], ['report', 'Rapports', 'Reports'], ['assoc', 'Associations', 'Associations']];   // _nlMe: this reader's row of public.news_profile (warehouse migration 024), when signed in
async function _nlLoadMe() {
  const A = window.PKAccount; _nlMe = null;
  if (!A || !A.configured) return;
  try { await A.ready(); if (!A.user) return;
    const { data } = await A.client().from('news_profile').select('profiles, exclude, interests, france, daily, weekly, email_to').eq('user_id', A.user.id).maybeSingle();
    _nlMe = data || { profiles: [], exclude: [], interests: [], france: false, daily: false, weekly: false, email_to: null };
  } catch (e) { console.warn('[news] profile not read:', e); }
}
async function _nlSave(patch, msgEl) {
  const A = window.PKAccount; if (!A || !A.user) return;
  const row = Object.assign({ profiles: ['origination'], exclude: [], interests: [], france: false, daily: false, weekly: false, email_to: null }, _nlMe || {}, patch, { user_id: A.user.id, updated_at: new Date().toISOString() });
  const { error } = await A.client().from('news_profile').upsert(row, { onConflict: 'user_id' });
  if (msgEl) { msgEl.textContent = error ? _newsT('Non enregistré : ', 'Not saved: ') + error.message : _newsT('Enregistré.', 'Saved.'); msgEl.className = 'news-add-msg ' + (error ? 'ko' : 'ok'); }
  if (!error) _nlMe = row;
}
const _NL_SEC = { markets: ['Marchés en 30 secondes', 'Markets in 30 seconds'], digest: ['L’essentiel', 'The essentials'], top: ['Les articles principaux', 'Main articles'], stories: ['Les sujets du jour', 'Today’s stories'], official: ['Textes officiels', 'Official texts'],
  cons: ['Consultations : à vos réponses', 'Consultations: time to reply'], pubs: ['Publications et rapports', 'Publications and reports'], agenda: ['Agenda', 'Agenda'], post: ['À lire : le post de la semaine', 'Worth reading: post of the week'] };
async function renderNewsLetter() {
  const host = document.getElementById('news-letter'); if (!host) return;
  if (_nlData === undefined) {
    const get = async u => { try { const r = await fetch(u + '?t=' + Date.now()); return r.ok ? await r.json() : null; } catch (_) { return null; } };
    [_nlData, _nlWeek] = await Promise.all([get(DATA_BASE + 'newsletter.json'), get(DATA_BASE + 'newsletter_week.json'), _nlLoadMe()]);
  }
  const E = _nlEd === 'weekly' && _nlWeek ? _nlWeek : _nlData, P = (E && E.profiles) || {};
  if (!E || !E.profiles || !Object.keys(P).length) { host.innerHTML = `<div class="news-src-help">${_newsT('La première édition paraît demain à 7 h.', 'The first edition comes out tomorrow at 7:00.')}</div>`; return; }
  const en = window.PKI18n && PKI18n.lang === 'en', L = a => Array.isArray(a) ? (en ? a[1] : a[0]) : (a || '');
  let pid = _newsStore('pk-nl-profile') || (_nlMe && (_nlMe.profiles || [])[0]); if (!P[pid] || !E.profiles[pid]) pid = P.origination && E.profiles.origination ? 'origination' : Object.keys(E.profiles)[0];
  const prof = P[pid], ed = E.profiles[pid] || { stories: [] };
  const day = new Date(E.date + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const num = (v, d = 2) => v == null ? '–' : v.toLocaleString(en ? 'en-GB' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const a = (u, t) => `<a href="${_newsEsc(u)}" target="_blank" rel="noopener noreferrer">${_newsEsc(t)}</a>`;
  const ddm = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const sec = {
    markets: () => (E.markets || []).length ? `<div class="nl-tiles">${E.markets.map(r => { const c = r.chg || 0, up = c > 0, dn = c < 0, red = r.hours ? dn : up, green = r.hours ? up : dn;   // more hours at 0 € or below: lower prices, in green
      const ch = r.hours ? (r.chg == null ? '' : (up ? '▲ +' : dn ? '▼ −' : '= ') + num(Math.abs(c), 0) + ' h') : r.pct == null ? '' : (up ? '▲ +' : dn ? '▼ −' : '') + num(Math.abs(r.pct), 1) + ' %';
      return `<a class="nl-tile" href="#${_newsEsc(r.page || 'today')}"><span>${_newsEsc(L(r.label))}</span><b>${num(r.value, r.hours ? (Number.isInteger(r.value) ? 0 : 1) : 2)}</b><small>${_newsEsc(r.unit)} <i class="${red ? 'up' : green ? 'dn' : ''}">${ch}</i></small></a>`; }).join('')}</div>
      <div class="nl-src">${_newsT('Sources', 'Sources')} : ${[...new Set(E.markets.map(r => r.src).filter(Boolean))].join(', ')}. ${E.weekly ? _newsT('Variation sur la semaine.', 'Change over the week.') : _newsT('Variation sur la séance précédente.', 'Change on the previous session.')}</div>` : '',
    digest: () => E.digest && (E.digest.items || []).length ? `<ol class="nl-dg">${E.digest.items.map(x => `<li>${_newsEsc((en && x.text_en) || x.text || x.title)} <a href="${_newsEsc(x.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc((x.sources || []).slice(0, 2).join(' · '))} ↗</a></li>`).join('')}</ol>` : '',
    top: () => { const shown = new Set(ed.stories.map(x => x.link).concat(((E.digest || {}).items || []).map(x => x.link))), T = (E.top || []).filter(o => !shown.has(o.link));
      return T.length ? `<ul class="nl-ul">${T.map(o => `<li>${a(o.link, o.title)} <span class="nl-src">· ${_newsEsc(o.source)}${o.n > 1 ? ' +' + (o.n - 1) : ''}</span></li>`).join('')}</ul>` : ''; },
    stories: () => ed.stories.length ? ed.stories.map((s, k) => `<article class="nl-story"><h3>${k + 1}. ${a(s.link, s.title)}</h3>
      ${(en ? s.what_en : s.what) || s.what ? `<p><b>${_newsT('Ce qui s’est passé.', 'What happened.')}</b> ${_newsEsc((en && s.what_en) || s.what)}</p>` : ''}
      ${s.for_you ? `<p class="nl-for"><b>${_newsT('Pour vous', 'For you')}, ${_newsEsc(L(prof.short).toLowerCase())}.</b> ${_newsEsc((en && s.for_you_en) || s.for_you)}</p>` : ''}
      <div class="nl-src">${s.sources.slice(0, 4).map(_newsEsc).join(' · ')}${s.sources.length > 4 ? ' +' + (s.sources.length - 4) : ''}</div></article>`).join('') : '',
    official: () => (E.official || []).length ? `<ul class="nl-ul">${E.official.map(o => `<li>${a(o.link, o.title)} <span class="nl-src">· ${_newsEsc(o.source)}, ${ddm(o.date)}</span></li>`).join('')}</ul>` : '',
    cons: () => (E.cons || []).length ? `<table class="nl-cons"><tbody>${E.cons.map(c => { const n = c.deadline ? _newsLeft(c.deadline) : null;
      return `<tr><td class="nl-num ${n != null && n <= 7 ? 'dn' : ''}">${n == null ? '' : n === 0 ? _newsT('auj.', 'today') : 'J-' + n}</td><td>${a(c.link, c.title)} <span class="nl-src">· ${_newsEsc(c.source)}</span></td></tr>`; }).join('')}</tbody></table>` : '',
    pubs: () => (E.pubs || []).length ? `<ul class="nl-ul">${E.pubs.map(o => `<li>${a(o.link, o.title)} <span class="nl-src">· ${_newsEsc(o.source)}</span></li>`).join('')}</ul>` : '',
    agenda: () => (E.agenda || []).length ? `<ul class="nl-ul">${E.agenda.map(e => `<li><b>${ddm(e.date)}</b> · ${_newsEsc(L(e.title))}</li>`).join('')}</ul>` : '',
    post: () => E.post ? `<ul class="nl-ul">${((E.posts || []).length ? E.posts : [E.post]).map(p => `<li>${a(p.url, (p.author || 'LinkedIn') + (p.note ? ' · ' + p.note : ''))}</li>`).join('')}</ul>` : '',
  };
  const WK = { digest: ['La semaine en 5 sujets', 'The week in 5 stories'], stories: ['Les sujets de la semaine', 'The week’s stories'], top: ['Les articles de la semaine', 'The week’s articles'], post: ['Les posts de la semaine', 'The week’s posts'] };
  const title = k => _newsT(...(E.weekly && WK[k] ? WK[k] : _NL_SEC[k]));
  const body = (prof.order || Object.keys(sec)).map(k => { const h = sec[k] ? sec[k]() : ''; return h ? `<section class="nl-sec"><h2>${title(k)}</h2>${h}</section>` : ''; }).join('');
  const head = (en && ed.headline_en) || ed.headline;
  const eds = _nlWeek ? `<div class="nl-profiles">${[['daily', '7 O’Klock'], ['weekly', 'PowerBrunch']].map(([k, l]) => `<button type="button" class="tab-btn${(k === 'weekly') === !!E.weekly ? ' active' : ''}" data-nle="${k}" translate="no">${l}</button>`).join('')}</div>` : '';
  host.innerHTML = eds + `<div class="nl-profiles" role="group" aria-label="${_newsT('Profil', 'Profile')}">${Object.keys(P).filter(k => E.profiles[k]).map(k => `<button type="button" class="filter-btn${k === pid ? ' active' : ''}" data-nlp="${k}">${_newsEsc(L(P[k].name))}</button>`).join('')}</div>
    <div class="nl-paper"><header class="nl-head"><div><span translate="no" class="nl-brand">PowerKlock</span><span>${_newsEsc(day)}</span></div>
      <h1 translate="no">${E.weekly ? 'PowerBrunch' : '7 O’Klock'}</h1><div>${E.weekly ? _newsT('La semaine servie à point : ce qu’il fallait retenir, à lire au calme', 'Last week, well done: what mattered, to read at leisure') : _newsT('Marchés, régulation, énergie : l’essentiel à 7 h', 'Markets, regulation, energy: what matters at 7:00')}</div><div>${_newsT('Édition', 'Edition')} <b>${_newsEsc(L(prof.name))}</b>${E.monday ? ' · ' + _newsT('depuis vendredi', 'since Friday') : ''}</div></header>
      ${head ? `<section class="nl-sec nl-one"><h2>${_newsT('En une phrase', 'In one sentence')}</h2><p>${_newsEsc(head)}</p></section>` : ''}
      ${body}
      <footer class="nl-foot">${_newsT('Sujets choisis selon le profil ; résumés rédigés automatiquement à partir des titres et extraits, chaque sujet renvoie à ses articles. Le même contenu part par e-mail chaque matin de semaine à 7 h.', 'Stories chosen for the profile; summaries written automatically from the titles and extracts, each story links to its articles. The same content goes out by e-mail every weekday at 7:00.')}</footer></div>`;
  const A = window.PKAccount, me = _nlMe;
  host.insertAdjacentHTML('beforeend', `<div class="news-side nl-me"><div class="news-side-t">${_newsT('Ma newsletter par e-mail', 'My newsletter by e-mail')}</div>` + (A && A.user && me ? `
    <div class="nl-me-f">${_newsT('Profils reçus (un ou plusieurs : leurs sujets sont réunis, sans doublon)', 'Profiles received (one or more: their stories are combined, without duplicates)')}<div class="nl-me-row">${Object.keys(P).map(k => `<label><input type="checkbox" name="nl-prof" value="${k}"${((me.profiles || []).length ? me.profiles : [pid]).includes(k) ? ' checked' : ''}> ${_newsEsc(L(P[k].name))}</label>`).join('')}</div></div>
    <div class="nl-me-f">${_newsT('Ce qui m’intéresse le plus (ces sujets passent en tête)', 'What interests me most (these stories come first)')}<div class="nl-me-row">${_NL_INTERESTS.map(([k, fr, en]) => `<label><input type="checkbox" name="nl-int" value="${k}"${(me.interests || []).includes(k) ? ' checked' : ''}> ${_newsT(fr, en)}</label>`).join('')}</div>
      <label><input type="checkbox" id="nl-fr"${me.france ? ' checked' : ''}> ${_newsT('Surtout la France (le reste passe après)', 'France first (the rest comes after)')}</label></div>
    <div class="nl-me-f">${_newsT('Recevoir par e-mail', 'Receive by e-mail')}<div class="nl-me-row"><label><input type="checkbox" id="nl-daily"${me.daily ? ' checked' : ''}> <b translate="no">7 O’Klock</b> · ${_newsT('chaque matin de semaine, 7 h', 'every weekday, 7:00')}</label>
      <label><input type="checkbox" id="nl-weekly"${me.weekly ? ' checked' : ''}> <b translate="no">PowerBrunch</b> · ${_newsT('le lundi à 10 h, la semaine écoulée', 'Monday at 10:00, the week before')}</label></div></div>
    <label class="nl-me-f">${_newsT('Adresse (vide = celle du compte)', 'Address (empty = the account’s)')}<input type="email" id="nl-to" class="fuel-select" maxlength="200" value="${_newsEsc(me.email_to || '')}" placeholder="${_newsEsc(A.user.email || '')}"></label>
    <label class="nl-me-f">${_newsT('Mots à écarter, séparés par des virgules', 'Words to leave out, comma separated')}<input type="text" id="nl-ex" class="fuel-select" maxlength="400" value="${_newsEsc((me.exclude || []).join(', '))}" placeholder="${_newsT('ex. pétrole, crypto', 'e.g. oil, crypto')}"></label>
    <div class="nl-me-help">${_newsT('Vos mots-clés (Le fil › Mes mots-clés) ajoutent une rubrique « Vos mots-clés » à votre e-mail.', 'Profile: the one chosen above. Your keywords (The feed › My keywords) add a “Your keywords” section to your e-mail.')}</div>
    <div class="nl-me-row"><button type="button" class="pk-btn-primary" id="nl-save">${_newsT('Enregistrer', 'Save')}</button><span class="news-add-msg" id="nl-msg"></span></div>`
    : `<div class="nl-me-help">${_newsT('Connectez-vous pour recevoir chaque matin l’édition de votre profil, à l’adresse de votre choix.', 'Sign in to receive your profile’s edition every morning, at the address of your choice.')} <a href="#" id="nl-signin">${_newsT('Se connecter', 'Sign in')}</a></div>`) + `</div>`);
  const si = document.getElementById('nl-signin'); if (si) si.addEventListener('click', e => { e.preventDefault(); if (window.PKDash && PKDash.openAccount) PKDash.openAccount(); });
  const sv = document.getElementById('nl-save');
  if (sv) sv.addEventListener('click', () => {
    const to = document.getElementById('nl-to').value.trim(), msg = document.getElementById('nl-msg');
    if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { msg.textContent = _newsT('Adresse e-mail non valide.', 'Invalid e-mail address.'); msg.className = 'news-add-msg ko'; return; }
    const profs = [...host.querySelectorAll('input[name="nl-prof"]:checked')].map(x => x.value);
    if (!profs.length) { msg.textContent = _newsT('Cochez au moins un profil.', 'Tick at least one profile.'); msg.className = 'news-add-msg ko'; return; }
    _nlSave({ profiles: profs, daily: document.getElementById('nl-daily').checked, weekly: document.getElementById('nl-weekly').checked,
      interests: [...host.querySelectorAll('input[name="nl-int"]:checked')].map(x => x.value), france: document.getElementById('nl-fr').checked, email_to: to || null, exclude: [...new Set(document.getElementById('nl-ex').value.split(',').map(x => x.trim()).filter(Boolean))].slice(0, 25) }, msg);
  });
  host.querySelectorAll('[data-nle]').forEach(b => b.addEventListener('click', () => { _nlEd = b.dataset.nle; renderNewsLetter(); }));
  host.querySelectorAll('[data-nlp]').forEach(b => b.addEventListener('click', () => { _newsStore('pk-nl-profile', b.dataset.nlp); renderNewsLetter(); }));
}

// what the last run read, beside the feed
function renderNewsCover() {
  const host = document.getElementById('news-cover'); if (!host) return;
  const s = window._newsSources || [], ko = s.filter(x => !x.ok).length;
  const outlets = new Set((newsData || []).flatMap(i => [i.source].concat((i.other_sources || []).map(o => o.source)))).size;
  const off = (newsData || []).filter(i => (i.tags || []).includes('official')).length;
  host.innerHTML = `<b>${outlets}</b> ${_newsT('médias', 'outlets')} · <b>${off}</b> ${_newsT('textes officiels', 'official texts')}` +
    (s.length ? `<br>${s.length} ${_newsT('sources lues', 'sources read')}${ko ? ` · <span class="ko">${ko} ${_newsT('en échec', 'failing')}</span>` : ''}` : '');
}

// Personal keywords: synced to the account (public.news_keyword) when signed in, else kept in this browser only
let _newsCfg = null;           // { visible_sections, show_add_source, show_advanced } from public.news_user_config, or null = unrestricted
let _newsSectionDefs = null;   // [{slug, name, tags}] from public.news_section (admin-curated presets)
let _newsKwRemote = null;      // [{keyword, team, mine}] when signed in, else null (localStorage fallback)
let _newsSectionTags = null;   // tags of the curated section tab currently active, if any

async function _newsLoadSections() {
  const A = window.PKAccount;
  if (!A || !A.configured) return;
  try {
    await A.ready();
    const { data } = await A.client().from('news_section').select('slug, name, tags').order('sort');
    _newsSectionDefs = data || [];
  } catch (e) { console.warn('[news] sections not read:', e); }
}

async function _newsLoadPersonal() {
  const A = window.PKAccount;
  if (!A || !A.configured) { _newsCfg = null; _newsKwRemote = null; return; }
  await A.ready();
  if (!A.user) { _newsCfg = null; _newsKwRemote = null; return; }
  const cl = A.client();
  try {
    const [cfgR, kwR] = await Promise.all([
      cl.from('news_user_config').select('visible_sections, show_add_source, show_advanced').eq('user_id', A.user.id).maybeSingle(),
      cl.from('news_keyword').select('keyword, team, user_id'),
    ]);
    _newsCfg = (cfgR && cfgR.data) || null;
    _newsKwRemote = ((kwR && kwR.data) || []).map(r => ({ keyword: r.keyword, team: !!r.team, mine: r.user_id === A.user.id }));
  } catch (e) { console.warn('[news] personal config not read:', e); _newsCfg = null; _newsKwRemote = null; }
}

// Show only what the admin allowed this person (public.news_user_config): filter buttons, curated section tabs,
// the add-source panel, the country/source/France-focus controls. No row for this user = everything, as before.
function _newsApplyConfig() {
  const cfg = _newsCfg, host = document.querySelector('.news-filters');
  if (host) {
    host.querySelectorAll('.filter-btn[data-tag]').forEach(b => {
      b.style.display = (!cfg || !cfg.visible_sections || cfg.visible_sections.includes(b.dataset.tag)) ? '' : 'none';
    });
    host.querySelectorAll('.news-section-btn').forEach(b => b.remove());
    const adv = document.getElementById('news-advanced');
    if (cfg && cfg.visible_sections) {
      (_newsSectionDefs || []).filter(s => cfg.visible_sections.includes(s.slug)).forEach(s => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'filter-btn news-section-btn'; b.textContent = s.name;
        b.addEventListener('click', () => {
          newsFilter = 'section'; _newsSectionTags = s.tags || [];
          host.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          renderNews(newsData);
        });
        host.insertBefore(b, adv);
      });
    }
  }
  const addBtn = document.getElementById('news-add-btn'); if (addBtn) addBtn.style.display = (cfg && cfg.show_add_source === false) ? 'none' : '';
  const srcSec = document.getElementById('hs-news-src'); if (srcSec) srcSec.style.display = (cfg && cfg.show_add_source === false) ? 'none' : '';
  const adv = document.getElementById('news-advanced'); if (adv) adv.style.display = (cfg && cfg.show_advanced === false) ? 'none' : '';
  const teamWrap = document.getElementById('news-kw-team-wrap');
  if (teamWrap) teamWrap.style.display = (window.PKAccount && PKAccount.user) ? '' : 'none';
}

function _newsRefreshKwUI() {
  const inp = document.getElementById('news-kw');
  if (inp) inp.value = _newsKwRemote ? _newsKwRemote.filter(r => r.mine).map(r => r.keyword).join(', ') : _newsKw().join(', ');
  const teamCb = document.getElementById('news-kw-team');
  if (teamCb) teamCb.checked = _newsKwRemote ? _newsKwRemote.some(r => r.mine && r.team) : false;
}

async function _newsSaveKw(value, team) {
  const A = window.PKAccount;
  const list = [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))].slice(0, 25);
  if (!A || !A.configured || !A.user) { try { localStorage.setItem('pk-news-kw', value); } catch (_) {} renderNews(newsData); return; }
  const cl = A.client();
  const mineBefore = (_newsKwRemote || []).filter(r => r.mine).map(r => r.keyword);
  const toRemove = mineBefore.filter(k => !list.includes(k));
  try {
    if (toRemove.length) await cl.from('news_keyword').delete().eq('user_id', A.user.id).in('keyword', toRemove);
    if (list.length) await cl.from('news_keyword').upsert(list.map(k => ({ user_id: A.user.id, keyword: k.slice(0, 60), team: !!team })), { onConflict: 'user_id,keyword' });
  } catch (e) { console.warn('[news] keyword not saved:', e); }
  await _newsLoadPersonal();
  _newsRefreshKwUI();
  renderNews(newsData);
}

// most relevant first, but a fresh article beats an old one and one outlet cannot fill the top of the list:
// impact, minus 0.3 per day of age, minus 0.6 for each article of the same outlet already placed above
function _newsRank(items) {
  const now = Date.now(), left = items.slice(), out = [], seen = {};
  const score = i => (i.impact || 0) - 0.3 * (now - i.date) / 864e5 - 0.6 * (seen[i.source] || 0);
  while (left.length) {
    let k = 0, best = -Infinity;
    for (let j = 0; j < left.length; j++) { const v = score(left[j]); if (v > best) { best = v; k = j; } }
    const it = left.splice(k, 1)[0]; seen[it.source] = (seen[it.source] || 0) + 1; out.push(it);
  }
  return out;
}

// ── The essentials: data/news_digest.json (scripts/news_digest.py): one line per story, written by the site's AI proxy from the
// collected articles only; every line links to its story. On Monday, the week before in 5 stories next to today's.
let _newsDigest = null, _newsDigestView = null;
async function _newsLoadDigest() {
  try { const r = await fetch(DATA_BASE + 'news_digest.json?t=' + Date.now()); _newsDigest = r.ok ? await r.json() : null; } catch (_) { _newsDigest = null; }
}
function renderNewsDigest() {
  const sec = document.getElementById('hs-news-digest'), host = document.getElementById('news-digest'); if (!sec || !host) return;
  const D = _newsDigest || {}, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const monday = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); })();
  const daily = D.daily && D.daily.date >= (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 3); return d.toISOString().slice(0, 10); })() ? D.daily : null;
  const weekly = D.weekly && D.weekly.week === monday ? D.weekly : null;
  if (!daily && !weekly) { sec.hidden = true; return; }
  sec.hidden = false;
  const view = _newsDigestView || (weekly && (!daily || new Date().getDay() === 1) ? 'weekly' : 'daily'), E = view === 'weekly' ? weekly : daily;
  const en = window.PKI18n && PKI18n.lang === 'en';
  document.getElementById('news-digest-t').textContent = view === 'weekly' ? _newsT('La semaine en 5 sujets', 'The week in 5 stories') : _newsT('L’essentiel', 'The essentials');
  const day = s => new Date(s + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  document.getElementById('news-digest-m').textContent = view === 'weekly' ? _newsT('semaine du ', 'week of ') + day((() => { const d = new Date(E.week + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); })()) : day(E.date);
  const tabs = daily && weekly ? `<div class="news-dg-tabs">${[['daily', _newsT('Aujourd’hui', 'Today')], ['weekly', _newsT('La semaine', 'The week')]].map(([k, l]) => `<button type="button" class="filter-btn${k === view ? ' active' : ''}" data-dg="${k}">${l}</button>`).join('')}</div>` : '';
  const posts = view === 'weekly' && (E.posts || []).length ? `<div class="news-dg-posts"><b>${_newsT('Les posts les plus utiles de la semaine', 'The most useful posts of the week')}</b>${E.posts.map(p => `<a href="${_newsEsc(p.url)}" target="_blank" rel="noopener noreferrer">${_newsEsc(p.author || 'LinkedIn')}${p.note ? ' · ' + _newsEsc(p.note) : ''}</a>`).join('')}</div>` : '';
  host.innerHTML = tabs + `<ol class="news-dg">${E.items.map(l => `<li><span>${_newsEsc(en && l.text_en ? l.text_en : l.text)}</span> <a href="${_newsEsc(l.link)}" target="_blank" rel="noopener noreferrer" class="news-dg-src">${_newsEsc(l.sources.slice(0, 3).join(' · '))}${l.sources.length > 3 ? ' +' + (l.sources.length - 3) : ''} ↗</a></li>`).join('')}</ol>` + posts +
    `<div class="news-dg-note">${_newsT('Résumé automatique, rédigé par une IA à partir des seuls articles collectés : chaque ligne renvoie à sa source.', 'Automatic summary, written by an AI from the collected articles only: each line links to its source.')}</div>`;
  host.querySelectorAll('[data-dg]').forEach(b => b.addEventListener('click', () => { _newsDigestView = b.dataset.dg; renderNewsDigest(); }));
}

// who covers a story: official texts, specialised press (the feeds), general press (press searches), as a bar and a count
function _newsCoverage(item) {
  const all = [{ source: item.source, cls: item.cls, official: (item.tags || []).includes('official'), search: !!item.query }].concat(item.other_sources || []);
  if (all.length < 2) return '';
  const kind = o => o.official || o.cls === 'official' || o.cls === 'cre' ? 'off' : o.cls === 'search' || o.search ? 'gen' : 'spe';
  const n = { off: 0, spe: 0, gen: 0 }; all.forEach(o => n[kind(o)]++);
  const bar = ['off', 'spe', 'gen'].filter(k => n[k]).map(k => `<i class="cv-${k}" style="width:${(n[k] / all.length * 100).toFixed(0)}%"></i>`).join('');
  const lbl = { off: _newsT('officiel', 'official'), spe: _newsT('presse spécialisée', 'trade press'), gen: _newsT('presse générale', 'general press') };
  return `<div class="news-cov" title="${['off', 'spe', 'gen'].filter(k => n[k]).map(k => n[k] + ' ' + lbl[k]).join(' · ')}"><span class="news-covbar">${bar}</span><b>${all.length} ${_newsT('sources', 'sources')}</b> <span>${all.slice(1).map(o => _newsEsc(o.source)).join(' · ')}</span></div>`;
}

// ── Posts to read: LinkedIn posts pasted by the team (public.news_post, warehouse migration 023). Only the link, the
// author and a note are kept; votes go to public.news_vote like the articles' and pick the week's best for Monday's digest.
let _newsPosts = [];
const _newsAuthorOf = url => { const m = url.match(/linkedin\.com\/(?:posts|in)\/([a-z0-9-]+?)(?:-[0-9a-z]*\d[0-9a-z]*)?(?:_|\/|$)/i);
  return m ? m[1].split('-').filter(w => !/\d/.test(w)).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : ''; };
async function renderNewsPosts() {
  const sec = document.getElementById('hs-news-posts'), host = document.getElementById('news-posts'); if (!sec || !host) return;
  const A = window.PKAccount;
  if (!A || !A.configured) { sec.hidden = true; return; }
  await A.ready();
  if (!A.user) { sec.hidden = true; return; }
  const cl = A.client();
  const { data, error } = await cl.from('news_post').select('id, url, author, note, added_by, created_at').order('created_at', { ascending: false }).limit(40);
  if (error) { sec.hidden = true; return; }
  sec.hidden = false; _newsPosts = data || [];
  const ago = d => formatTimeAgo(new Date(d));
  host.innerHTML = `<div class="news-post-add">
      <input type="url" id="news-post-url" class="fuel-select" maxlength="600" placeholder="${_newsT('Lien du post LinkedIn (Partager › Copier le lien)', 'LinkedIn post link (Share › Copy link)')}">
      <input type="text" id="news-post-author" class="fuel-select" maxlength="80" placeholder="${_newsT('Auteur', 'Author')}">
      <input type="text" id="news-post-note" class="fuel-select" maxlength="200" placeholder="${_newsT('Pourquoi le lire, en une ligne', 'Why read it, in one line')}">
      <button type="button" class="pk-btn-primary" id="news-post-go">${_newsT('＋ Ajouter', '＋ Add')}</button></div>
    <div class="news-add-msg" id="news-post-msg"></div>
    <details class="news-post-how"><summary>${_newsT('Envoyer un post directement depuis LinkedIn', 'Send a post straight from LinkedIn')}</summary>
      <p><b>Android</b> · ${_newsT('dans Chrome, menu ⋮ › « Installer l’application » sur powerklock.com. Ensuite, sur un post LinkedIn : Partager › Envoyer via… › PowerKlock.', 'in Chrome, menu ⋮ › “Install app” on powerklock.com. Then on a LinkedIn post: Share › Send via… › PowerKlock.')}</p>
      <p><b>iPhone</b> · ${_newsT('un raccourci « Envoyer à PowerKlock » dans l’app Raccourcis (Partager › Envoyer à PowerKlock) : il ouvre powerklock.com/?share= suivi du lien du post.', 'a “Send to PowerKlock” shortcut in the Shortcuts app (Share › Send to PowerKlock): it opens powerklock.com/?share= followed by the post link.')}</p>
      <p><b>${_newsT('Ordinateur', 'Computer')}</b> · ${_newsT('glissez ce bouton dans la barre de favoris, puis cliquez dessus sur un post LinkedIn ouvert :', 'drag this button to the bookmarks bar, then click it on an open LinkedIn post:')} <a class="pk-btn-ghost news-post-bm" href="javascript:location.href='https://powerklock.com/?share='+encodeURIComponent(location.href)">→ PowerKlock</a></p>
    </details>
    <div class="news-posts">${_newsPosts.length ? _newsPosts.map(p => `<div class="news-post">
      <a href="${_newsEsc(p.url)}" target="_blank" rel="noopener noreferrer"><b>${_newsEsc(p.author || 'LinkedIn')}</b>${p.note ? `<span>${_newsEsc(p.note)}</span>` : ''}</a>
      <div class="news-post-f"><span class="news-time">${ago(p.created_at)}</span><div class="news-vote" data-link="${_newsEsc(p.url)}">${_newsVoteBtns(p.url)}</div>${p.added_by === A.user.id ? `<button type="button" class="pk-btn-ghost" data-pdel="${p.id}">✕</button>` : ''}</div></div>`).join('')
      : `<div class="news-src-help">${_newsT('Aucun post pour l’instant : collez le lien d’un post LinkedIn qui vaut la lecture.', 'No post yet: paste the link of a LinkedIn post worth reading.')}</div>`}</div>`;
  const url = document.getElementById('news-post-url'), au = document.getElementById('news-post-author'), msg = document.getElementById('news-post-msg');
  url.addEventListener('change', () => { if (!au.value) au.value = _newsAuthorOf(url.value.trim()); });
  document.getElementById('news-post-go').addEventListener('click', async () => {
    const u = url.value.trim().split('?')[0];
    if (!/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(u)) { msg.textContent = _newsT('Collez un lien linkedin.com.', 'Paste a linkedin.com link.'); msg.className = 'news-add-msg ko'; return; }
    const { error: e } = await cl.from('news_post').insert({ url: u, author: au.value.trim() || _newsAuthorOf(u) || null, note: document.getElementById('news-post-note').value.trim() || null });
    if (e) { msg.textContent = (/duplicate|unique/i.test(e.message) ? _newsT('Ce post est déjà dans la liste.', 'This post is already listed.') : _newsT('Non ajouté : ', 'Not added: ') + e.message); msg.className = 'news-add-msg ko'; return; }
    renderNewsPosts();
  });
  host.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', async () => { await cl.from('news_post').delete().eq('id', b.dataset.pdel); renderNewsPosts(); }));
}

// ── Open consultations (data/consultations.json, scripts/fetch_news.py): the deadline to reply, the nearest first ──
let _newsCons = null, _newsConsTheme = '';
const _NEWS_CONS_THEMES = { cee: ['Efficacité énergétique', 'Energy efficiency'], tariffs: ['Tarifs', 'Tariffs'], grid: ['Réseau et raccordement', 'Grid and connection'],
  market: ['Marché et sécurité d’approvisionnement', 'Market and security of supply'], renewables: ['Renouvelables et appels d’offres', 'Renewables and tenders'], gas: ['Gaz', 'Gas'], other: ['Autres', 'Other'] };
async function _newsLoadCons() {
  try { const r = await fetch(DATA_BASE + 'consultations.json?t=' + Date.now()); _newsCons = r.ok ? await r.json() : null; } catch (_) { _newsCons = null; }
}
// the consultation deadlines and dated events as a calendar to subscribe to (data/agenda.ics, scripts/agenda_ics.py)
function _newsIcsHow() {
  const url = 'https://powerklock.com/data/agenda.ics';
  return `<details class="cons-closed nl-ics"><summary>${_newsT('Ajouter ces dates à mon agenda (Outlook, Google, Apple)', 'Add these dates to my calendar (Outlook, Google, Apple)')}</summary>
    <p>${_newsT('Abonnez-vous à cette adresse : les dates limites des consultations et les événements datés du site apparaissent dans votre agenda et se mettent à jour seuls.', 'Subscribe to this address: consultation deadlines and the site’s dated events appear in your calendar and update by themselves.')}</p>
    <p><code>${url}</code> <button type="button" class="pk-btn-ghost" data-copy="${url}">${_newsT('Copier', 'Copy')}</button></p>
    <p><b>Outlook</b> · ${_newsT('Ajouter un calendrier › S’abonner à partir du web', 'Add calendar › Subscribe from web')} · <b>Google</b> · ${_newsT('Autres agendas › + › À partir de l’URL', 'Other calendars › + › From URL')} · <b>Apple</b> · ${_newsT('Fichier › Nouvel abonnement', 'File › New calendar subscription')}</p></details>`;
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
  try { navigator.clipboard.writeText(b.dataset.copy); b.textContent = _newsT('Copié', 'Copied'); } catch (_) {} });
function renderNewsCons() {
  const sec = document.getElementById('hs-news-cons'), host = document.getElementById('news-cons'); if (!sec || !host) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const all = (_newsCons && _newsCons.items) || [], open = all.filter(c => !c.deadline || c.deadline >= today);
  if (!all.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const en = window.PKI18n && PKI18n.lang === 'en';
  const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const left = d => Math.round((new Date(d + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 864e5);
  const due = c => { if (!c.deadline) return `<span class="cons-due">${_newsT('date limite non indiquée', 'no deadline given')}</span>`;
    const n = left(c.deadline);
    return `<span class="cons-due${n <= 7 ? ' soon' : ''}"><b>${fmt(c.deadline)}</b>${n === 0 ? _newsT('dernier jour', 'last day') : 'J-' + n}</span>`; };
  const th = k => { const t = _NEWS_CONS_THEMES[k || 'other'] || _NEWS_CONS_THEMES.other; return _newsT(t[0], t[1]); };
  const row = c => `<a class="cons-row" href="${_newsEsc(c.link)}" target="_blank" rel="noopener noreferrer">${due(c)}<span class="cons-t">${_newsEsc(c.title)}<small><span class="cons-th">${th(c.theme)}</span> · ${_newsEsc(c.source)} · ${_newsT('ouverte le ', 'opened ')}${fmt(c.opened)}</small></span></a>`;
  const counts = {}; all.forEach(c => { if (!c.deadline || c.deadline >= today) counts[c.theme || 'other'] = (counts[c.theme || 'other'] || 0) + 1; });
  const keys = Object.keys(_NEWS_CONS_THEMES).filter(k => counts[k]);
  if (_newsConsTheme && !counts[_newsConsTheme]) _newsConsTheme = '';
  const pick = c => !_newsConsTheme || (c.theme || 'other') === _newsConsTheme;
  const chips = keys.length > 1 ? `<div class="cons-chips">${[['', _newsT('Tous', 'All'), open.length]].concat(keys.map(k => [k, th(k), counts[k]])).map(([k, l, n]) => `<button type="button" class="filter-btn${k === _newsConsTheme ? ' active' : ''}" data-ct="${k}">${l} <small>${n}</small></button>`).join('')}</div>` : '';
  const shown = open.filter(pick);
  const closed = all.filter(c => c.deadline && c.deadline < today && pick(c)).slice(-8).reverse();
  host.innerHTML = chips + (shown.length ? `<div class="cons-list">${shown.map(row).join('')}</div>` : `<div class="news-src-help">${_newsT('Aucune consultation ouverte en ce moment.', 'No consultation open right now.')}</div>`) +
    (closed.length ? `<details class="cons-closed"><summary>${_newsT('Récemment closes', 'Recently closed')} (${closed.length})</summary><div class="cons-list">${closed.map(row).join('')}</div></details>` : '') + _newsIcsHow();
  host.querySelectorAll('[data-ct]').forEach(b => b.addEventListener('click', () => { _newsConsTheme = b.dataset.ct; renderNewsCons(); }));
  renderNewsConsMini();
}

function _newsKw() {
  if (_newsKwRemote) return _newsKwRemote.map(r => r.keyword.toLowerCase());
  try { return (localStorage.getItem('pk-news-kw') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean); } catch (_) { return []; }
}
function _newsMine(i, kw) { if (!kw.length) return false; const t = (i.title + ' ' + i.snippet).toLowerCase(); return kw.some(k => t.includes(k)); }
// France focus: French sources (tag fr) and articles about France; kept in this browser
const _NEWS_FR = /\b(France|French|Fran[cç]ais\w*|fran[cç]ais\w*|hexagone|Paris|EDF|Engie|TotalEnergies|Flamanville|Bugey|Gravelines|ARENH|Enedis|Elengy|Ademe|ADEME|PPE ?3?|PPE3)\b|\b(RTE|CRE|DGEC)\b/;
function _newsFr() { try { const v = localStorage.getItem('pk-news-fr'); return v == null ? (!window.PKI18n || PKI18n.lang !== 'en') : v === '1'; } catch (_) { return false; } }   // French site: France first by default
function _newsIsFr(i) { return (i.tags || []).includes('fr') || _NEWS_FR.test(i.title + ' ' + i.snippet); }
function _newsWireKw() {
  const fr = document.getElementById('news-fr');
  if (fr && !fr.dataset.wired) { fr.dataset.wired = '1'; fr.checked = _newsFr();
    fr.addEventListener('change', () => { try { localStorage.setItem('pk-news-fr', fr.checked ? '1' : '0'); } catch (_) {} renderNews(newsData); }); }
  const add = document.getElementById('news-add-btn');
  if (add && !add.dataset.wired) { add.dataset.wired = '1'; add.addEventListener('click', () => {
    const sec = document.getElementById('hs-news-src'); if (sec) { sec.classList.remove('collapsed'); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    const f = document.getElementById('news-add-name'); if (f) setTimeout(() => f.focus(), 350); }); }
  const inp = document.getElementById('news-kw'); if (!inp || inp.dataset.wired) return;
  inp.dataset.wired = '1';
  const teamCb = document.getElementById('news-kw-team');
  _newsRefreshKwUI();
  inp.addEventListener('change', () => _newsSaveKw(inp.value, teamCb && teamCb.checked));
  if (teamCb) teamCb.addEventListener('change', () => _newsSaveKw(inp.value, teamCb.checked));
}

function renderNewsSources() {
  const host = document.getElementById('news-sources'); if (!host) return;
  const src = window._newsSources;
  const edit = 'https://github.com/TomSRemy/PowerKlock/edit/main/config/news_sources.json';
  const rows = src ? src.map(s => `<tr><td>${_newsEsc(s.kind === 'search' ? 'search: ' + s.name : s.name)}${s.added ? ' <span class="news-q">added from the site</span>' : ''}</td><td>${s.kind === 'feed' ? 'RSS feed' : s.kind === 'page' ? 'web page' : s.kind === 'official' ? 'official texts (open data)' : 'press search (Google News)'}</td><td class="${s.ok ? 'ok' : 'ko'}">${s.ok ? s.n + ' articles' : 'failed: ' + _newsEsc(s.error || '')}</td></tr>`).join('') : '';
  host.innerHTML = (src ? `<div style="overflow-x:auto"><table class="news-src-t"><thead><tr><th>Source</th><th>Read as</th><th>Last run</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="news-src-help">The source list appears after the next news run.</div>') +
    `<div class="news-src-help"><b>Add a source for everyone</b>: use the form above (signed in). The sources of the team list stay in <a href="${edit}" target="_blank" rel="noopener">config/news_sources.json</a> on GitHub.<br>
    <b>Follow subjects for yourself</b>: type them in ★ My keywords above; matching articles are starred and listed under ★ My keywords (kept in this browser only).<br>
    <b>Not possible</b>: LinkedIn (no public feed, and its terms forbid reading pages automatically) and subscription sites without a feed (Contexte, Montel): their articles still appear when the press search finds them. RTE has no news feed: its news come through the press search.</div>`;
}

// Add a source from the site: public.news_source (warehouse migration 012), read by
// scripts/fetch_news.py at the next hourly run. Signed-in users only (RLS).
const _NEWS_TAGS = ['power', 'gas', 'carbon', 'regulation', 'markets', 'fr', 'assoc', 'report'];
async function renderNewsAdd() {
  const host = document.getElementById('news-add'); if (!host) return;
  const A = window.PKAccount;
  if (!A || !A.configured) { host.innerHTML = ''; return; }
  if (!host.dataset.sub && A.onChange) { host.dataset.sub = '1'; A.onChange(() => renderNewsAdd()); }
  await A.ready();
  const head = '<div class="news-add-t">Add a source for everyone</div>';
  if (!A.user) {
    host.innerHTML = `<div class="news-add">${head}<div class="news-add-msg"><a href="#" id="news-add-signin">Sign in</a> to add an RSS / Atom feed or a press search: it is read at the next hourly news run, for everyone.</div></div>`;
    const si = document.getElementById('news-add-signin');
    if (si) si.addEventListener('click', e => { e.preventDefault(); if (window.PKDash && PKDash.openAccount) PKDash.openAccount(); });
    return;
  }
  const cl = A.client();
  let rows = [];
  try { const r = await cl.from('news_source').select('id, user_id, kind, name, url, query, tags, created_at').order('created_at'); if (r.error) throw r.error; rows = r.data || []; }
  catch (e) { host.innerHTML = `<div class="news-add">${head}<div class="news-add-msg ko">Sources added from the site are not available yet (${_newsEsc(e.message || e)}).</div></div>`; return; }
  const st = window._newsSources || [];
  const status = r => { const s = st.find(x => x.added && (r.kind === 'feed' ? x.url === r.url : x.name === r.query));
    return s ? (s.ok ? `<span class="ok">${s.n} articles</span>` : `<span class="ko">failed: ${_newsEsc(s.error || '')}</span>`) : '<span>waiting for the next run</span>'; };
  host.innerHTML = `<div class="news-add">${head}
    <div class="news-add-row">
      <select id="news-add-kind" class="fuel-select" aria-label="Kind"><option value="feed">RSS / Atom feed</option><option value="search">Press search</option></select>
      <input type="text" id="news-add-name" class="fuel-select" maxlength="80" placeholder="Name, e.g. Montel news">
      <input type="text" id="news-add-val" class="fuel-select" maxlength="300" placeholder="Feed address, https://…/feed">
      <button type="button" class="pk-btn-primary" id="news-add-go">＋ Add</button><span></span>
    </div>
    <div class="news-add-tags">Topics: ${_NEWS_TAGS.map(t => `<label><input type="checkbox" value="${t}"> ${t === 'fr' ? 'France' : t === 'assoc' ? 'associations' : t}</label>`).join('')}</div>
    <div class="news-add-msg" id="news-add-msg">Read at the next hourly news run. A feed is any public RSS / Atom address; a press search follows a phrase across the world press (put an exact phrase in quotes).</div>
    ${rows.length ? `<div style="overflow-x:auto"><table class="news-src-t"><thead><tr><th>Added from the site</th><th>Read as</th><th>Last run</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${_newsEsc(r.name)}<div class="news-q">${_newsEsc(r.kind === 'feed' ? r.url : r.query)}</div></td><td>${r.kind === 'feed' ? 'RSS feed' : 'press search'}</td><td>${status(r)}</td><td>${r.user_id === A.user.id ? `<button type="button" class="pk-btn-ghost" data-del="${r.id}">✕ Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
  const kind = document.getElementById('news-add-kind'), val = document.getElementById('news-add-val'), msg = document.getElementById('news-add-msg');
  kind.addEventListener('change', () => { val.placeholder = kind.value === 'feed' ? 'Feed address, https://…/feed' : 'Phrase to follow, e.g. "prix négatifs" batteries'; });
  document.getElementById('news-add-go').addEventListener('click', async () => {
    const name = document.getElementById('news-add-name').value.trim(), v = val.value.trim(), k = kind.value;
    const tags = [...host.querySelectorAll('.news-add-tags input:checked')].map(x => x.value);
    const say = (t, c) => { msg.textContent = t; msg.className = 'news-add-msg ' + (c || ''); };
    if (!v) return say(k === 'feed' ? 'Enter the feed address.' : 'Enter the phrase to follow.', 'ko');
    if (k === 'feed' && !/^https?:\/\/\S+\.\S+/.test(v)) return say('The feed address must start with https://', 'ko');
    if (k === 'search' && /^https?:\/\//i.test(v)) return say('A press search follows a phrase, not a web address — add this as an RSS feed instead, or type a phrase to follow.', 'ko');
    const row = { kind: k, name: name || (k === 'feed' ? v.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : v).slice(0, 80), tags };
    if (k === 'feed') row.url = v; else row.query = v.slice(0, 200);
    say('Adding…');
    const { error } = await cl.from('news_source').insert(row);
    if (error) return say('Not added: ' + error.message, 'ko');
    await renderNewsAdd();
    const m = document.getElementById('news-add-msg'); if (m) { m.textContent = `“${row.name}” added: read at the next hourly news run, for everyone.`; m.className = 'news-add-msg ok'; }
  });
  host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const { error } = await cl.from('news_source').delete().eq('id', b.dataset.del);
    if (error) { msg.textContent = 'Not removed: ' + error.message; msg.className = 'news-add-msg ko'; return; }
    renderNewsAdd();
  }));
}

function _newsEsc(s) { return PK.esc(s); }   // js/pk-core.js (name kept: used by morning.js and the news cards)

function renderNews(items) {
  const q = ((document.getElementById('news-search') || {}).value || '').trim().toLowerCase();
  const kw = _newsKw();
  const kn = document.getElementById('news-kw-n');
  if (kn) kn.textContent = kw.length ? (items || []).filter(i => _newsMine(i, kw)).length + ' matching' : '';
  const frOnly = _newsFr();
  _newsFillSelects(items || []);
  const src = (document.getElementById('news-src') || {}).value || '', cty = (document.getElementById('news-cty') || {}).value || '';
  let filtered = (items || []).filter(i => (!frOnly || _newsIsFr(i)) &&
    (newsFilter === 'all' || newsFilter === 'movers' || (newsFilter === 'mine' ? _newsMine(i, kw) :
      newsFilter === 'section' ? (i.tags || []).some(t => (_newsSectionTags || []).includes(t)) : (i.tags || []).includes(newsFilter))) &&
    (!src || i.source === src) && (!cty || (i.countries || []).includes(cty) || (cty === 'FR' && _newsIsFr(i))) &&   // France: same rule as the France focus
    (!q || (i.title + ' ' + i.snippet + ' ' + i.source).toLowerCase().includes(q)));
  // market movers: what moves prices or the renewable business, last 72 h, highest impact first (readers' votes count)
  if (newsFilter === 'movers') filtered = filtered.filter(i => (i.impact || 0) >= 3 && Date.now() - i.date < 72 * 3600e3).sort((a, b) => (b.impact || 0) - (a.impact || 0));
  else if (_newsSort === 'recent') filtered = filtered.slice().sort((a, b) => b.date - a.date);
  const cnt = document.getElementById('news-count');
  if (cnt) cnt.textContent = items && items.length ? filtered.length + ' ' + (_newsMode === 'list' ? _newsT('articles', 'articles') : _newsT('sujets', 'stories')) : '';
  const grid = document.getElementById('news-grid');
  if (grid) grid.classList.toggle('news-list', _newsMode === 'list');
  if (!items || !items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No news available — data/news.json could not be loaded.</div>';
    return;
  }
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${frOnly && newsFilter === 'all' ? 'No French news at the last run.' : newsFilter === 'mine' && !kw.length ? 'Type your keywords above to follow your subjects.' : newsFilter === 'watch' ? 'No press-search results at the last run.' : 'No articles for this filter.'}</div>`;
    return;
  }
  if (_newsMode === 'list') {
    grid.innerHTML = filtered.map(item => {
      const link = /^https?:\/\//.test(item.link || '') ? item.link : '#', mine = _newsMine(item, kw), more = (item.other_sources || []).length;
      const t = new Date(item.date), recent = Date.now() - t < 864e5;
      return `<a class="news-row${mine ? ' mine' : ''}" href="${_newsEsc(link)}" target="_blank" rel="noopener noreferrer"><span class="news-row-d">${recent ? t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : _newsDay(t)}</span>
        <span class="news-row-b"><span class="news-row-t">${mine ? '<span class="news-star">★</span>' : ''}${(item.tags || []).includes('official') ? `<span class="news-off">${_newsT('Texte officiel', 'Official text')}</span>` : ''}${_newsEsc(item.title)}</span>
        <small>${_newsEsc(item.source)}${more ? ` +${more}` : ''} · ${(item.tags || []).filter(x => !['official', 'fr', 'watch'].includes(x)).slice(0, 2).map(x => _newsEsc(_newsTagL(x))).join(' · ')}</small></span>
        <span class="news-vote" data-link="${_newsEsc(item.link)}">${_newsVoteBtns(item.link)}</span></a>`;
    }).join('');
    return;
  }
  grid.innerHTML = filtered.map(item => {
    const link = /^https?:\/\//.test(item.link || '') ? item.link : '#';
    const tagsHtml = (item.tags || []).filter(t => t !== 'official').map(t => `<span class="news-tag">${_newsIc(t)}${_newsEsc(_newsTagL(t))}</span>`).join(' ');
    const mine = _newsMine(item, kw);
    const also = _newsCoverage(item);
    return `<a class="news-card${mine ? ' mine' : ''}" href="${_newsEsc(link)}" target="_blank" rel="noopener noreferrer">
      <div class="news-meta">
        <span class="news-source ${_newsEsc(item.cls)}">${_newsEsc(item.source)}</span>
        <span class="news-time" title="${_newsEsc(item.date.toLocaleString('en-GB', { timeZone: 'Europe/Paris' }))}">${formatTimeAgo(item.date)}</span>
      </div>
      <div class="news-title">${mine ? '<span class="news-star">★</span>' : ''}${(item.tags || []).includes('official') ? `<span class="news-off">${_newsT('Texte officiel', 'Official text')}</span>` : ''}${_newsEsc(item.title)}</div>
      <div class="news-snippet">${_newsEsc(item.snippet)}</div>
      <div>${tagsHtml}${item.query ? ` <span class="news-q">search: ${_newsEsc(item.query)}</span>` : ''}${(item.countries || []).length ? ` <span class="news-q">${_newsEsc(item.countries.join(' · '))}</span>` : ''}</div>
      ${also}
      <div class="news-vote" data-link="${_newsEsc(item.link)}">${_newsVoteBtns(item.link)}</div>
    </a>`;
  }).join('');
}

// selects of the sources and countries present in the feed
function _newsFillSelects(items) {
  const fill = (id, vals, all) => { const el = document.getElementById(id); if (!el || el.dataset.n == vals.length) return; const cur = el.value;
    el.innerHTML = `<option value="">${all}</option>` + vals.map(v => `<option value="${_newsEsc(v[0])}">${_newsEsc(v[1])}</option>`).join(''); el.value = cur; el.dataset.n = vals.length; };
  const cnt = {}; items.forEach(i => { cnt[i.source] = (cnt[i.source] || 0) + 1; });
  fill('news-src', Object.keys(cnt).sort((a, b) => a.localeCompare(b)).map(k => [k, k + ' (' + cnt[k] + ')']), 'All sources');
  const CN = { FR: 'France', EU: 'Europe / EU', DE: 'Germany', BE: 'Belgium', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', UK: 'United Kingdom' };
  const cc = [...new Set(['FR', ...items.flatMap(i => i.countries || [])])].sort((a, b) => Object.keys(CN).indexOf(a) - Object.keys(CN).indexOf(b));
  fill('news-cty', cc.map(c => [c, CN[c] || c]), 'All countries');
}

// line icons in the site's style (no emojis)
const _NEWS_IC = {"movers": "<polyline points=\"22 7 13.5 15.5 8.5 10.5 2 17\"/><polyline points=\"16 7 22 7 22 13\"/>", "geopolitics": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"2\" y1=\"12\" x2=\"22\" y2=\"12\"/><path d=\"M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z\"/>", "deal": "<rect x=\"2\" y=\"7\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16\"/>", "build": "<path d=\"M2 20h20\"/><path d=\"M5 20V10l7-5 7 5v10\"/><path d=\"M10 20v-5h4v5\"/>", "power": "<polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/>", "gas": "<path d=\"M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z\"/>", "carbon": "<path d=\"M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z\"/>", "regulation": "<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"16\" y1=\"13\" x2=\"8\" y2=\"13\"/><line x1=\"16\" y1=\"17\" x2=\"8\" y2=\"17\"/>", "markets": "<line x1=\"18\" y1=\"20\" x2=\"18\" y2=\"10\"/><line x1=\"12\" y1=\"20\" x2=\"12\" y2=\"4\"/><line x1=\"6\" y1=\"20\" x2=\"6\" y2=\"14\"/>", "watch": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/>", "up": "<path d=\"M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3\"/>", "down": "<path d=\"M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17\"/>"};
const _newsIc = k => _NEWS_IC[k] ? `<svg class="nic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${_NEWS_IC[k]}</svg>` : '';
window._newsIc = _newsIc;

// useful / not useful on each article (signed in): public.news_vote (warehouse migration 015); the news run learns from them
//   which sources, subjects and words matter (data/news_prefs.json) and ranks the next articles with it
const _newsVotes = (() => { try { return JSON.parse(localStorage.getItem('pk-news-votes') || '{}'); } catch (_) { return {}; } })();
const _newsT = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
function _newsVoteBtns(link) {
  const v = _newsVotes[link] || 0;
  return `<button type="button" class="nv${v === 1 ? ' on' : ''}" data-v="1" title="Useful: more like this">${_newsIc('up')}</button><button type="button" class="nv${v === -1 ? ' on' : ''}" data-v="-1" title="Not useful: fewer like this">${_newsIc('down')}</button>`;
}
let _newsAllP = null;
async function _newsVote(link, vote, box) {
  // the article: from the News page's list, else from news.json (Today and the dashboards vote before the News page is opened)
  let item = (typeof newsData !== 'undefined' && newsData || []).find(i => i.link === link);
  if (!item) { const j = await (_newsAllP || (_newsAllP = fetch(DATA_BASE + 'news.json').then(r => r.ok ? r.json() : null).catch(() => null))); item = ((j && j.items) || []).find(i => i.link === link); }
  if (!item) { const p = _newsPosts.find(x => x.url === link); item = p ? { title: (p.author || 'LinkedIn') + (p.note ? ' · ' + p.note : ''), source: 'LinkedIn', tags: ['post'] } : { title: link, source: '', tags: [] }; }
  const cl = window.PKAccount && window.PKAccount.user && window.PKAccount.client && window.PKAccount.client();
  if (!cl) { box.insertAdjacentHTML('beforeend', `<span class="nv-msg">${_newsT('connectez-vous pour voter', 'sign in to vote')}</span>`); setTimeout(() => { const m = box.querySelector('.nv-msg'); if (m) m.remove(); }, 2500); return; }
  const prev = _newsVotes[link] || 0, v = prev === vote ? 0 : vote;
  // shown at once, put back if the save fails
  box.querySelectorAll('.nv').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
  try {
    if (v === 0) { const r = await cl.from('news_vote').delete().eq('link', link); if (r.error) throw r.error; }
    else { const r = await cl.from('news_vote').upsert({ link, title: String(item.title).slice(0, 300), source: item.source, tags: item.tags || [], vote: v }, { onConflict: 'user_id,link' }); if (r.error) throw r.error; }
    if (v) _newsVotes[link] = v; else delete _newsVotes[link];
    try { localStorage.setItem('pk-news-votes', JSON.stringify(_newsVotes)); } catch (_) {}
    box.innerHTML = _newsVoteBtns(link);
  } catch (e) { box.innerHTML = _newsVoteBtns(link); box.insertAdjacentHTML('beforeend', `<span class="nv-msg">${_newsT('non enregistré : ', 'not saved: ')}${_newsEsc(e.message || e)}</span>`); }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.news-vote .nv'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const box = b.closest('.news-vote'); _newsVote(box.dataset.link, +b.dataset.v, box);
}, true);

function filterNews(tag, btn) {
  newsFilter = tag;
  _newsSectionTags = null;
  document.querySelectorAll('.news-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderNews(newsData);
}

function formatTimeAgo(date) {
  const diff = (Date.now() - date) / 1000;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

// ════════════════════════════════════════════
// OVERVIEW
// ════════════════════════════════════════════
function loadOverview() {
  const prices = (typeof pricesData !== 'undefined' && pricesData) ? pricesData : [];
  const fr = prices.find(d => d.code === 'FR'), de = prices.find(d => d.code === 'DE_LU'), be = prices.find(d => d.code === 'BE');
  const P = window.PKC, ttf = P && P.last('ttf'), eua = P && P.last('eua'), fx = P && P.last('eurusd');
  document.getElementById('overview-prices').innerHTML = [
    { label:'🇫🇷 France DA', val:fr && fr.today, unit:'€/MWh' },
    { label:'🇩🇪 Germany DA', val:de && de.today, unit:'€/MWh' },
    { label:'🇧🇪 Belgium DA', val:be && be.today, unit:'€/MWh' },
    { label:'TTF DA', val:ttf && ttf.v, unit:'€/MWh' },
    { label:'EUA ' + (P ? P.contractLabel('eua') : ''), val:eua && eua.v, unit:'€/t' },
    { label:'EUR/USD', val:fx && fx.v, unit:'', dp:4 },
  ].map(r => `<tr>
    <td style="font-family:Inter;text-align:left;color:var(--text2)">${r.label}</td>
    <td style="font-weight:600">${r.val != null ? r.val.toFixed(r.dp || 2) : '--'}</td>
    <td style="color:var(--text3);font-size:11px">${r.unit}</td>
  </tr>`).join('');
  const pct = l => l && l.pct != null ? `${l.pct >= 0 ? 'up' : 'down'} ${Math.abs(l.pct).toFixed(2)}% vs prior close` : '';
  document.getElementById('market-status').innerHTML = `
    <div style="margin-bottom:10px"><span style="color:var(--accent)">${_newsIc('power')}Power</span><br>
    ${fr ? `FR day-ahead at ${fr.today.toFixed(2)} €/MWh. ${fr.negHrs > 0 ? `${fr.negHrs}h of negative prices.` : 'No negative hours.'}` : 'Day-ahead prices not loaded.'}</div>
    <div style="margin-bottom:10px"><span style="color:#C4A57B">${_newsIc('gas')}Gas</span><br>
    ${ttf ? `TTF day-ahead at ${ttf.v.toFixed(2)} €/MWh, ${pct(ttf)}.` : 'Gas data not loaded.'}</div>
    <div><span style="color:#5FA8D3">${_newsIc('carbon')}Carbon</span><br>
    ${eua ? `EUA ${P.contractLabel('eua')} at ${eua.v.toFixed(2)} €/t, ${pct(eua)}.` : 'Carbon data not loaded.'}</div>
  `;
}

// ════════════════════════════════════════════
// CONVERTER
// ════════════════════════════════════════════
// Power and energy are converted within their own family only: MW → MWh
// needs a duration, so those results are labelled with the assumption.
const CONV_POWER = { MW: 1, GW: 1e3 };                     // in MW
const CONV_ENERGY = { MWh: 1, GWh: 1e3, TWh: 1e6 };        // in MWh

function setConvUnit(unit, btn) {
  convUnit = unit;
  document.querySelectorAll('.conv-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateConverter();
}

function _convFmt(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6) return v.toExponential(3);
  return v.toLocaleString('en-GB', { maximumFractionDigits: a >= 100 ? 1 : a >= 1 ? 3 : 6 });
}

function updateConverter() {
  const val = parseFloat(document.getElementById('conv-input').value) || 0;
  const isPower = convUnit in CONV_POWER;
  const base = val * (isPower ? CONV_POWER[convUnit] : CONV_ENERGY[convUnit]);   // MW or MWh
  const cards = [];
  if (isPower) {
    Object.keys(CONV_POWER).forEach(u => cards.push({ u, v: base / CONV_POWER[u], d: u === 'MW' ? 'Megawatt (power)' : 'Gigawatt = 1,000 MW' }));
    cards.push({ u: 'MWh / hour', v: base, d: 'energy delivered in one hour at full output' });
    cards.push({ u: 'TWh / year', v: base * 8760 / 1e6, d: 'at 100% load factor (8,760 h)' });
  } else {
    Object.keys(CONV_ENERGY).forEach(u => cards.push({ u, v: base / CONV_ENERGY[u], d: { MWh: 'Megawatt-hour (energy)', GWh: 'Gigawatt-hour = 1,000 MWh', TWh: 'Terawatt-hour = 1,000 GWh' }[u] }));
    cards.push({ u: 'MW average', v: base / 8760, d: 'if spread evenly over one year' });
  }
  document.getElementById('conv-results').innerHTML = cards.map(c => {
    const active = c.u === convUnit ? 'border-color:var(--accent)' : '';
    return `<div class="conv-result" style="${active}">
      <div class="conv-result-label">${c.u}</div>
      <div class="conv-result-value">${_convFmt(c.v)}</div>
      <div class="conv-result-desc">${c.d}</div>
    </div>`;
  }).join('');
}

function updateCapacity() {
  const mw = parseFloat(document.getElementById('cap-mw').value) || 0;
  const lf = parseFloat(document.getElementById('cap-lf').value) || 0;
  const annualMWh = mw * (lf/100) * 8760;
  const annualGWh = annualMWh / 1000;
  const annualTWh = annualGWh / 1000;
  const fLH = (lf/100) * 8760;

  document.getElementById('cap-results').innerHTML = `
    <div class="conv-result"><div class="conv-result-label">Annual Production</div><div class="conv-result-value">${annualTWh.toLocaleString('en-GB', { maximumFractionDigits: 3 })} TWh</div><div class="conv-result-desc">= ${annualGWh.toLocaleString('en-GB', { maximumFractionDigits: 1 })} GWh</div></div>
    <div class="conv-result"><div class="conv-result-label">Full-Load Hours</div><div class="conv-result-value">${Math.round(fLH).toLocaleString()}</div><div class="conv-result-desc">hours/year</div></div>
    <div class="conv-result" style="grid-column:1/-1"><div class="conv-result-label">Formula</div><div style="font-size:12px;color:var(--text2);margin-top:4px;font-family:JetBrains Mono">${mw} MW × ${lf}% × 8,760 h = ${Math.round(annualMWh).toLocaleString()} MWh/year</div></div>
  `;
}

function setLF(val, btn) {
  document.getElementById('cap-lf').value = val;
  // Only this button group (the selector used to clear every .day-tab on the site).
  btn.parentNode.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateCapacity();
}


// ── NEW SECTION LOADER ──
const NEW_PAGES = ['renewables','nuclear','imbalance','eua','euafwd','spark','goprices','wxcities','wxhdd','remit'];
const PAGE_LOADERS = {
  map: () => { if (window.PKMap) setTimeout(() => PKMap.open(), 50); },
  // Several `js/hist/` historical sections only re-render reactively, when the
  // user clicks a window/zone control (setHistWindow/setHistZone) — they were
  // never wired to render once on first page visit, so the chart stayed an
  // empty canvas until the user happened to click a pill button. Each loader
  // below now also fires that first render.
  renewables: () => { loadRenewables(); if (window.PKCaptureFwd) setTimeout(PKCaptureFwd.render, 300); },
  nuclear:    () => { drawNuclear(); if (window.PKW) PKW.draw('nuc-monthly-years', 'nuc-monthly', {}).then(r => { const e = document.getElementById('nuc-monthly-sub'); if (e && r && r.sub) e.textContent = r.sub; }); },
  imbalance:  () => drawImbalance(),
  analysis:   () => { if (typeof loadMarketAnalysis === 'function') loadMarketAnalysis(); },
  carbonintensity: () => { if (typeof initCarbon === 'function') initCarbon(); },
  eua:        () => { drawEUA(); if (window.PKW) PKW.draw('gas-storage-years', 'fuel-gas-years', {}).then(r => { const e = document.getElementById('fuel-gas-years-sub'); if (e && r && r.sub) e.textContent = r.sub; }); },
  euafwd:     () => drawEUAFwd(),
  spark:      () => typeof renderSpark!=="undefined"&&renderSpark(),
  goprices:   () => typeof renderGO!=="undefined"&&renderGO(),
  remit:      () => { if (typeof renderRemit === 'function') renderRemit(); if (window.PKRemitUnits) PKRemitUnits.render(); },
  wxcities:   () => { if (typeof loadWeather === 'function') loadWeather(); },
  wxhdd:      () => typeof renderHDD!=="undefined"&&renderHDD(),
  status:     () => { if (window.PKStatus) PKStatus.renderStatusPage(); },
  capacity:   () => { if (typeof renderCapacity === 'function') renderCapacity(); },
  regions:    () => { if (typeof renderRegions === 'function') renderRegions(); },
  frsystem:   () => { if (typeof renderFrSystem === 'function') renderFrSystem(); },
  morning:    () => { if (typeof renderMorning === 'function') renderMorning(); },
  regulation: () => { if (window.PKReg) PKReg.render(); },
  bilan:      () => { if (window.PKBilan) PKBilan.render(); },
};

// Weather pages: see js/meteo.js

// each page's loader, the first time the page is shown
PK.onPage('*', id => {
  const ldr = PAGE_LOADERS[id];
  if (ldr && !window['_loaded_' + id]) { window['_loaded_' + id] = true; ldr(); }
});

const FUELS = [
  {k:'nuclear',l:'Nuclear',c:'#A87DC4'},{k:'wind',l:'Wind',c:'#C4A57B'},
  {k:'solar',l:'Solar',c:'#FBBF24'},{k:'hydro',l:'Hydro',c:'#94D2BD'},
  {k:'fossil',l:'Fossil',c:'#ED6965'},{k:'biomass',l:'Biomass',c:'#94D2BD'},
];
const GO_CURRENT = [
  {tech:'Wind',cal:'Cal-26',bid:.51,ask:.55,delta:-.02},
  {tech:'Solar',cal:'Cal-26',bid:.38,ask:.41,delta:-.01},
  {tech:'Hydro',cal:'Cal-26',bid:.49,ask:.53,delta:-.02},
  {tech:'Renewable',cal:'Cal-26',bid:.45,ask:.48,delta:-.015},
];
const GO_FWD = [
  {p:'GO AIB Wind',b25:.52,a25:.56,b26:.51,a26:.55,b27:.48,a27:.52,d:-.02},
  {p:'GO AIB Solar',b25:.39,a25:.42,b26:.38,a26:.41,b27:.35,a27:.38,d:-.01},
  {p:'GO AIB Hydro',b25:.50,a25:.54,b26:.49,a26:.53,b27:.46,a27:.50,d:-.02},
  {p:'GO AIB Renewable',b25:.46,a25:.49,b26:.45,a26:.48,b27:.42,a27:.45,d:-.015},
  {p:'GO Ireland Wind',b25:.28,a25:.32,b26:.27,a26:.31,b27:.25,a27:.29,d:-.01},
];

// ── HELPERS
function genHourly24(base, min, max) {
  const p=[.6,.5,.45,.4,.4,.5,.7,.85,.9,.85,.75,.6,.55,.58,.65,.75,.88,.95,1,.95,.88,.82,.75,.68];
  const r = max - min;
  return p.map(v => min + v*r + (Math.random()-.5)*r*.08);
}
function drawLineSimple(ctx, w, h, data, color, mn, mx) {
  // Legacy shim -- find canvas from ctx and use Chart.js
  const canvas = ctx.canvas;
  if (!canvas || !canvas.id) return;
  mkChart(canvas.id, {
    type: 'line',
    data: {
      labels: data.map((_,i)=>i),
      datasets: [{ data, borderColor:color, borderWidth:2, pointRadius:0, fill:true,
        backgroundColor:(c2)=>{const g=c2.chart.ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,rgba(color,.2));g.addColorStop(1,rgba(color,0));return g;},
        tension: 0 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{enabled:true}, zoom:ZOOM_CFG },
      scales:{
        x:{display:false},
        y:{grid:GRID, ticks:{color:C_TX3}, min:mn, max:mx}
      }
    }
  });
  setTimeout(()=>{ addFullscreen(canvas.id); addDownload(canvas.id,canvas.id); },100);
}
