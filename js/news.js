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
  await Promise.all([_newsLoadSections(), _newsLoadPersonal(), _newsLoadDigest(), _newsLoadCons(), _newsLoadPins()]);
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
  _newsWireViews(); _askWire(); _askLoadCount();
  if (typeof renderNewsHome === 'function') renderNewsHome();
  renderNewsOfficial();
  renderNewsCover();
}

// ── Two views (The feed / Official texts) and, in the feed, two displays (by story / all articles) and two orders ──
let _newsMode = 'list', _newsSort = 'recent', _newsOffSrc = '', _offQ = '', _offTopic = '';
const _newsStore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) {} return null; };
function newsSetView(v) {
  v = ['feed', 'official', 'letter', 'posts', 'sources', 'ask', 'archive'].includes(v) ? v : 'home';
  document.querySelectorAll('#news-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.nv === v));
  const f = document.getElementById('news-v-feed'), o = document.getElementById('news-v-official');
  if (f) f.hidden = v !== 'feed'; if (o) o.hidden = v !== 'official';
  const h = document.getElementById('news-v-home'); if (h) h.hidden = v !== 'home';
  if (v === 'home' && typeof renderNewsHome === 'function') renderNewsHome();
  const l = document.getElementById('news-v-letter'); if (l) l.hidden = v !== 'letter';
  if (v === 'letter') renderNewsLetter();
  // LinkedIn posts and the sources have their own tabs (the owner, 24 Nov. 2026)
  const ps = document.getElementById('news-v-posts'); if (ps) ps.hidden = v !== 'posts';
  if (v === 'posts' && typeof renderNewsPosts === 'function') renderNewsPosts();
  const sr = document.getElementById('news-v-sources'); if (sr) sr.hidden = v !== 'sources';
  const ar = document.getElementById('news-v-archive'); if (ar) ar.hidden = v !== 'archive';
  if (v === 'archive') renderNewsArchive();
  if (v === 'ask') { askOpen(); return; }   // an old saved view: the question panel now opens beside the page
  _newsStore('pk-news-view', v);
}
window.newsSetView = newsSetView;
function _newsWireViews() {
  const tabs = document.getElementById('news-tabs');
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = '1';
    tabs.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => newsSetView(b.dataset.nv)));
    newsSetView(_newsStore('pk-news-view') || 'home');
    _newsMode = _newsStore('pk-news-mode') === 'topics' ? 'topics' : 'list';
    _newsSort = _newsStore('pk-news-sort') === 'important' ? 'important' : 'recent';
    const sync = () => {
      document.querySelectorAll('[data-nm]').forEach(b => b.classList.toggle('active', b.dataset.nm === _newsMode));
      document.querySelectorAll('[data-ns]').forEach(b => b.classList.toggle('active', b.dataset.ns === _newsSort));
    };
    document.querySelectorAll('[data-nm]').forEach(b => b.addEventListener('click', () => { _newsMode = b.dataset.nm; _newsStore('pk-news-mode', _newsMode); sync(); renderNews(newsData); }));
    document.querySelectorAll('[data-ns]').forEach(b => b.addEventListener('click', () => { _newsSort = b.dataset.ns; _newsStore('pk-news-sort', _newsSort); sync(); renderNews(newsData); }));
    sync();
    const sb = document.getElementById('news-src-btn');
    if (sb) sb.addEventListener('click', () => { newsSetView('sources'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    if (_newsMode !== 'list' || _newsSort !== 'recent') renderNews(newsData);
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
// Official texts: one bar for the whole tab (search, subjects) filters consultations, texts and publications; each block keeps
// its own bubbles (consultation theme, text type, major report)
const _offPills = i => _newsPills(i).replace(/data-ftag=/g, 'data-otag=');
const _offTheme = i => i.theme || 'other';   // scripts/fetch_news.py cons_theme(): the consultations' themes
const _offMatch = i => (!_offQ || ((i.title || '') + ' ' + (i.snippet || '') + ' ' + (i.source || '')).toLowerCase().includes(_offQ))
  && (!_offTopic || _newsSubj(i).includes(_offTopic)) && (!_newsConsTheme || _offTheme(i) === _newsConsTheme);
const _offThPill = (k, cls = '') => { const t = _NEWS_CONS_THEMES[k] || _NEWS_CONS_THEMES.other;
  return `<span class="nl-pill cons-th${cls}" role="button" tabindex="0" data-oth="${_newsEsc(k)}" title="${_newsT('Voir ce thème', 'See this theme')}">${_newsEsc(_newsT(t[0], t[1]))}</span>`; };
function _renderOffBar(pool) {
  const bar = document.getElementById('news-off-bar'); if (!bar) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const cons = ((_newsCons && _newsCons.items) || []).filter(c => !c.deadline || c.deadline >= today);
  const cnt = {}; pool.map(_offTheme).concat(cons.map(c => c.theme || 'other')).forEach(k => { cnt[k] = (cnt[k] || 0) + 1; });
  const keys = Object.keys(_NEWS_CONS_THEMES).filter(k => cnt[k]);
  if (!bar.dataset.on) {
    bar.dataset.on = '1';
    bar.innerHTML = `<div class="nf-bar off-bar"><input type="search" id="off-q" class="nf-q" placeholder="${_newsT('Chercher un texte, une consultation, un rapport, ou poser une question…', 'Search a text, a consultation, a report, or ask a question…')}"><div class="off-chips"></div></div>`;
    let t; bar.querySelector('#off-q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { _offQ = _askIsQ(e.target.value) ? '' : e.target.value.trim().toLowerCase(); renderNewsOfficial(); renderNewsCons(); }, 200); });
    bar.addEventListener('click', e => { const b = e.target.closest('[data-ot]'); if (!b) return;
      if (b.dataset.ot === 'x') _offTopic = ''; else _newsConsTheme = b.dataset.ot === _newsConsTheme ? '' : b.dataset.ot; renderNewsOfficial(); renderNewsCons(); });
  }
  const lab = k => { const x = _NL_TH.find(y => y[0] === k); return x ? _newsT(x[1], x[2]) : _newsTagL(k); };
  if (typeof _askWire === 'function') _askWire();
  bar.querySelector('.off-chips').innerHTML = [['', _newsT('Tous les thèmes', 'All themes')]].concat(keys.map(k => [k, `${_newsEsc(_newsT(..._NEWS_CONS_THEMES[k]))} <small>${cnt[k]}</small>`]))
    .map(([k, l]) => `<button type="button" class="filter-btn${k === (_newsConsTheme || '') ? ' active' : ''}" data-ot="${k}">${l}</button>`).join('')
    + (_offTopic ? `<button type="button" class="filter-btn active" data-ot="x">${_newsEsc(lab(_offTopic))} ×</button>` : '');
}
document.addEventListener('click', e => {   // a subject bubble in this tab filters this tab
  const b = e.target.closest && e.target.closest('[data-otag]'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); _offTopic = b.dataset.otag === _offTopic ? '' : b.dataset.otag; renderNewsOfficial(); renderNewsCons();
}, true);
document.addEventListener('click', e => {   // a theme bubble (consultation, text, publication) filters the whole tab on that theme
  const b = e.target.closest && e.target.closest('[data-oth]'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); _newsConsTheme = b.dataset.oth === _newsConsTheme ? '' : b.dataset.oth; renderNewsOfficial(); renderNewsCons();
}, true);

function renderNewsOfficial() {
  const host = document.getElementById('news-off'), pub = document.getElementById('news-pub'); if (!host) return;
  const month = Date.now() - 30 * 864e5;
  const offAll = (newsData || []).filter(i => (i.tags || []).includes('official') && i.date >= month).sort((a, b) => b.date - a.date);
  const pubAll = (newsData || []).filter(i => i.date >= month && !(i.tags || []).includes('official') && ((i.tags || []).includes('report') || /^(rte|eex)$/i.test(i.cls || '') || /^(RTE|EEX)\b/.test(i.source))).sort((a, b) => b.date - a.date).slice(0, 40);
  _renderOffBar(offAll.concat(pubAll));
  const all = offAll.filter(i => _offMatch(i));
  const n = document.getElementById('news-tab-off-n'); if (n) n.textContent = offAll.length ? offAll.length : '';
  const cnt = {}; all.forEach(i => { const k = _newsOffKind(i); cnt[k] = (cnt[k] || 0) + 1; });
  if (_newsOffSrc && !cnt[_newsOffSrc]) _newsOffSrc = '';
  const keys = Object.keys(_NEWS_OFF_K).filter(k => cnt[k]);
  const chips = keys.length > 1 ? `<div class="cons-chips">${[['', _newsT('Tous', 'All'), all.length]].concat(keys.map(k => [k, _newsT(..._NEWS_OFF_K[k]), cnt[k]])).map(([k, l, c]) => `<button type="button" class="filter-btn${k === _newsOffSrc ? ' active' : ''}" data-os="${k}">${l} <small>${c}</small></button>`).join('')}</div>` : '';
  const rows = all.filter(i => !_newsOffSrc || _newsOffKind(i) === _newsOffSrc);
  host.innerHTML = all.length ? chips + `<div class="news-off-wrap"><table class="news-off-t"><thead><tr><th>${_newsT('Date', 'Date')}</th><th>${_newsT('Source', 'Source')}</th><th>${_newsT('Type', 'Type')}</th><th>${_newsT('Texte', 'Text')}</th></tr></thead><tbody>${rows.map(i => `<tr><td class="news-off-d">${_newsDay(i.date)}</td><td>${_newsEsc(_newsT(..._NEWS_OFF_K[_newsOffKind(i)]))}</td><td>${_newsTextType(i.title) ? `<span class="news-tag">${_newsEsc(_newsTextType(i.title))}</span>` : ''}</td><td><a href="${_newsEsc(i.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc(i.title)}</a><div class="off-pills">${_offThPill(_offTheme(i))}${_offPills(Object.assign({}, i, { topics: _newsSubj(i).filter(t => t !== 'regulation') }))}</div></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="news-src-help">${_newsT('Aucun texte officiel sur l’énergie dans les 30 derniers jours collectés.', 'No energy text in the last 30 days collected.')}</div>`;
  host.querySelectorAll('[data-os]').forEach(b => b.addEventListener('click', () => { _newsOffSrc = b.dataset.os; renderNewsOfficial(); }));
  if (pub) {
    const p = pubAll.filter(i => _offMatch(i)).slice(0, 30);
    const major = i => (i.tags || []).includes('major') ? `<span class="nl-pill off-major">${_newsT('Rapport majeur', 'Major report')}</span>` : '';
    pub.innerHTML = p.length ? `<ul class="news-pub">${p.map(i => `<li><span class="news-off-d">${_newsDay(i.date)}</span><a href="${_newsEsc(i.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc(i.title)}</a><small>${_newsEsc(i.source)}${(i.other_sources || []).length ? ' · +' + i.other_sources.length + ' ' + _newsT('médias', 'outlets') : ''}</small><span class="off-pills">${major(i)}${_offThPill(_offTheme(i))}${_offPills(i)}</span>${_newsFree(i)}</li>`).join('')}</ul>`
      : `<div class="news-src-help">${_newsT('Aucune publication dans les 30 derniers jours collectés.', 'No publication in the last 30 days collected.')}</div>`;
  }
}

// ── Archives: the search engine on everything the watch ever collected (news.article, public.news_search(), warehouse
// migrations 035–036): words, period, type, subject; no AI, so no limit. Approved accounts only ──
const _arc = { q: '', per: 0, kind: '', topic: '', order: 'relevance', offset: 0, items: [], total: 0 };
async function renderNewsArchive() {
  const host = document.getElementById('news-archive'); if (!host) return;
  const A = window.PKAccount; if (A && A.configured) await A.ready();
  if (!A || !A.user) { host.innerHTML = `<div class="news-src-help">${_newsT('Connectez-vous avec un compte validé pour chercher dans les archives de la veille.', 'Sign in with an approved account to search the watch’s archives.')}</div>`; return; }
  if (host.dataset.on) return;
  host.dataset.on = '1';
  const opt = (v, l) => `<option value="${v}">${l}</option>`;
  const topics = (typeof _NL_TH !== 'undefined' ? _NL_TH : []).map(t => opt(t[0], _newsT(t[1], t[2]))).join('');
  host.innerHTML = `<div class="nf-bar arc-bar"><input type="search" id="arc-q" class="nf-q" placeholder="${_newsT('Chercher dans toutes les archives : complément de rémunération, prix négatifs, TURPE…', 'Search all the archives: contracts for difference, negative prices, grid tariffs…')}">
      <select id="arc-per" class="fuel-select">${opt(0, _newsT('Toute la période', 'All time'))}${opt(7, _newsT('7 derniers jours', 'Last 7 days'))}${opt(30, _newsT('30 derniers jours', 'Last 30 days'))}${opt(90, _newsT('3 derniers mois', 'Last 3 months'))}${opt(365, _newsT('12 derniers mois', 'Last 12 months'))}</select>
      <select id="arc-kind" class="fuel-select">${opt('', _newsT('Tous les types', 'All types'))}${opt('article', _newsT('Articles', 'Articles'))}${opt('official', _newsT('Textes officiels', 'Official texts'))}${opt('report', _newsT('Rapports', 'Reports'))}${opt('research', _newsT('Recherche', 'Research'))}</select>
      <select id="arc-topic" class="fuel-select">${opt('', _newsT('Tous les sujets', 'All subjects'))}${topics}</select>
      <select id="arc-order" class="fuel-select">${opt('relevance', _newsT('Plus pertinents', 'Most relevant'))}${opt('date', _newsT('Plus récents', 'Most recent'))}</select></div>
    <div class="arc-n" id="arc-n"></div><div class="arc-list" id="arc-list"></div><div class="arc-more" id="arc-more"></div>`;
  let t;
  const go = () => { clearTimeout(t); t = setTimeout(() => { _arc.offset = 0; _arcLoad(); }, 250); };
  host.querySelector('#arc-q').addEventListener('input', e => { _arc.q = e.target.value.trim(); go(); });
  [['arc-per', 'per'], ['arc-kind', 'kind'], ['arc-topic', 'topic'], ['arc-order', 'order']].forEach(([id, k]) => host.querySelector('#' + id).addEventListener('change', e => { _arc[k] = e.target.value; go(); }));
  _arcLoad();
}
async function _arcLoad() {
  const cl = window.PKAccount && PKAccount.client && PKAccount.client(); if (!cl) return;
  const n = document.getElementById('arc-n'), list = document.getElementById('arc-list'), more = document.getElementById('arc-more'); if (!list) return;
  if (!_arc.offset) list.innerHTML = `<div class="fuel-note"><span class="spinner"></span> ${_newsT('Recherche…', 'Searching…')}</div>`;
  const since = +_arc.per ? new Date(Date.now() - _arc.per * 864e5).toISOString().slice(0, 10) : null;
  const { data, error } = await cl.rpc('news_search', { p_query: _arc.q || null, p_kind: _arc.kind || null, p_topic: _arc.topic || null, p_since: since, p_order: _arc.q ? _arc.order : 'date', p_limit: 50, p_offset: _arc.offset });
  if (error || !data || data.error) { list.innerHTML = `<div class="news-src-help">${error || (data && data.error === 'not approved') ? _newsT('Les archives s’ouvrent une fois votre compte validé.', 'The archives open once your account is approved.') : ''}</div>`; n.textContent = ''; more.innerHTML = ''; return; }
  _arc.items = _arc.offset ? _arc.items.concat(data.items) : data.items; _arc.total = data.total;
  const kindL = { article: _newsT('article', 'article'), official: _newsT('texte officiel', 'official text'), report: _newsT('rapport', 'report'), research: _newsT('recherche', 'research') };
  n.textContent = _newsT(`${data.total} résultat${data.total > 1 ? 's' : ''}`, `${data.total} result${data.total === 1 ? '' : 's'}`) + (_arc.q ? '' : ' · ' + _newsT('les plus récents d’abord', 'most recent first'));
  list.innerHTML = _arc.items.length ? _arc.items.map(i => `<div class="arc-it"><span class="arc-d">${_newsEsc(i.date || '')}</span><div><a href="${_newsEsc(i.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc(i.title)}</a>
      ${i.summary ? `<p>${_newsEsc(i.summary)}</p>` : ''}<span class="arc-m"><span class="nh-src">${_newsEsc(i.source || '')} · ${kindL[i.kind] || i.kind}${i.n_outlets > 1 ? ' · +' + (i.n_outlets - 1) + ' ' + _newsT('médias', 'outlets') : ''}</span>${_newsPills({ topics: i.topics || [], tags: [] })}</span></div></div>`).join('')
    : `<div class="news-src-help">${_newsT('Rien trouvé : essayez d’autres mots, ou une période plus large.', 'Nothing found: try other words, or a longer period.')}</div>`;
  more.innerHTML = _arc.items.length < _arc.total ? `<button type="button" class="pk-btn-ghost" id="arc-more-b">${_newsT('Plus de résultats', 'More results')}</button>` : '';
  const b = document.getElementById('arc-more-b'); if (b) b.addEventListener('click', () => { _arc.offset = _arc.items.length; _arcLoad(); });
}

// ── Ask PowerKlock (workers/ask): a question answered from the site's own content, each sentence with its source;
// approved accounts only, 30 questions a day each; the answers stay in this page only ──
const ASK_URL = 'https://powerklock-ask.tom-s-remy.workers.dev';
let _askLog = [], _askLeft = null;
async function renderNewsAsk() {
  const host = document.getElementById('news-ask'); if (!host) return;
  const A = window.PKAccount;
  if (A && A.configured) await A.ready();
  const token = await _askToken();   // the reader's Supabase session: the Worker checks it with the database
  if (!token) { host.innerHTML = `<div class="news-src-help">${_newsT('Connectez-vous avec un compte validé pour poser une question à PowerKlock.', 'Sign in with an approved account to ask PowerKlock a question.')}</div>`; return; }
  const hints = [_newsT('Qu’est-ce qui a changé sur le complément de rémunération ?', 'What changed on the contracts for difference?'), _newsT('Où en est l’arrêt aux prix négatifs ?', 'Where does the stop at negative prices stand?'),
    _newsT('Ce que dit le World Energy Outlook sur le nucléaire', 'What the World Energy Outlook says on nuclear'), _newsT('Les appels d’offres biométhane', 'The biomethane tenders')];
  if (!host.dataset.on) {
    host.dataset.on = '1';
    host.innerHTML = `<form class="ask-f"><input type="text" id="ask-q" maxlength="300" autocomplete="off" placeholder="${_newsT('Posez une question sur l’actualité, les textes, les consultations…', 'Ask about the news, the texts, the consultations…')}" aria-label="${_newsT('Votre question', 'Your question')}"><button type="submit" class="ask-go">${_newsT('Demander', 'Ask')}</button></form>
      <div class="ask-hints">${hints.map(h => `<button type="button" class="ask-hint">${_newsEsc(h)}</button>`).join('')}</div>
      <div class="ask-meta" id="ask-meta"></div><div class="ask-log" id="ask-log"></div>
      <p class="ask-claude">${_newsT('Vous avez Claude ? Ajoutez-y PowerKlock (prix, forwards, textes, consultations, sans limite de ce côté) : Compte › Connecteur pour Claude.', 'Have Claude? Add PowerKlock to it (prices, forwards, texts, consultations, no limit on this side): Account › Connector for Claude.')}</p>`;
    host.querySelector('.ask-f').addEventListener('submit', e => { e.preventDefault(); const q = host.querySelector('#ask-q').value.trim(); if (q.length > 2) _askGo(q); });
    host.querySelectorAll('.ask-hint').forEach(b => b.addEventListener('click', () => { host.querySelector('#ask-q').value = b.textContent; _askGo(b.textContent); }));
    await _askLoadCount();
  }
  _askDraw();
}
async function _askToken() {
  try { const cl = window.PKAccount && PKAccount.client && PKAccount.client(); const { data } = cl ? await cl.auth.getSession() : { data: null }; return data && data.session ? data.session.access_token : null; } catch (_) { return null; }
}
// the panel beside the page (✦ in the News bar, or a question typed in a search box)
function askOpen(q) {
  const d = document.getElementById('ask-drawer'); if (!d) return;
  d.hidden = false; document.body.classList.add('ask-on');
  renderNewsAsk().then(() => { const i = document.getElementById('ask-q'); if (q && i) { i.value = q; _askGo(q); } else if (i) i.focus(); });
}
window.askOpen = askOpen;
function _askClose() { const d = document.getElementById('ask-drawer'); if (d) d.hidden = true; document.body.classList.remove('ask-on'); }
// a question rather than search words: a « ? », or how a question starts (French and English)
const _askIsQ = t => (t = (t || '').trim()).length > 12 && (/\?$/.test(t) || /^(qu['’]est|que |quel|quelle|quels|quelles|comment|pourquoi|combien|o[uù] en est|est-ce|y a-t-il|faut-il|what|why|how|which|who|when|where|is |are |does |do |can )/i.test(t));
function _askSugg(input, holderId) {
  if (!input || input.dataset.ask) return; input.dataset.ask = '1';
  const box = document.createElement('div'); box.className = 'ask-sugg'; box.id = holderId; box.hidden = true;
  input.insertAdjacentElement('afterend', box);
  const sync = () => { const v = input.value.trim(), on = _askIsQ(v); box.hidden = !on;
    if (on) box.innerHTML = `<button type="button">✦ ${_newsT('Demander à PowerKlock', 'Ask PowerKlock')} : « ${_newsEsc(v.slice(0, 90))} »</button>`; };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && _askIsQ(input.value)) { e.preventDefault(); askOpen(input.value.trim()); } });
  box.addEventListener('click', () => askOpen(input.value.trim()));
}
function _askWire() {
  const o = document.getElementById('ask-open'); if (o && !o.dataset.w) { o.dataset.w = '1'; o.addEventListener('click', () => { const d = document.getElementById('ask-drawer'); if (d && !d.hidden) _askClose(); else askOpen(); }); }
  const c = document.getElementById('ask-close'); if (c && !c.dataset.w) { c.dataset.w = '1'; c.addEventListener('click', _askClose); }
  if (!document.body.dataset.askEsc) { document.body.dataset.askEsc = '1'; document.addEventListener('keydown', e => { if (e.key === 'Escape') _askClose(); }); }
  _askSugg(document.getElementById('news-search'), 'ask-sugg-feed');
  _askSugg(document.getElementById('off-q'), 'ask-sugg-off');
}
// « Approfondir dans Claude »: Claude opens with the question and the sources PowerKlock found (the reader's own Claude)
function _askClaude(x) {
  const src = (x.sources || []).slice(0, 8).map(s => `${s.n}. ${s.title} (${s.source}${s.date ? ', ' + s.date : ''}) ${s.link}`).join('\n');
  const p = _newsT(`Question sur le marché de l’électricité (France, Europe) : ${x.q}\n\nSources trouvées par PowerKlock :\n${src}\n\nRéponds en t’appuyant d’abord sur ces sources, cite-les, puis complète avec ce que tu sais en le signalant.`,
    `Question on the power market (France, Europe): ${x.q}\n\nSources found by PowerKlock:\n${src}\n\nAnswer from these sources first and cite them, then add what you know, saying so.`);
  return 'https://claude.ai/new?q=' + encodeURIComponent(p.slice(0, 3500));
}
// the questions left today, on the ✦ button from the start (signed in only)
async function _askLoadCount() {
  if (_askLeft != null) return _askCount();
  const token = await _askToken(); if (!token) return;
  try { const r = await fetch(ASK_URL, { headers: { Authorization: 'Bearer ' + token } }); const j = await r.json(); _askLeft = j && j.ok === false ? -1 : (j && j.left != null ? j.left : null); } catch (_) { /* the button stays without a count */ }
  _askCount();
}
function _askCount() {
  const o = document.getElementById('ask-open'); if (!o) return;
  o.textContent = '✦ ' + _newsT('Demander', 'Ask') + (_askLeft != null && _askLeft >= 0 ? ` · ${_askLeft}` : '');
  o.title = _askLeft != null && _askLeft >= 0 ? _newsT(`${_askLeft} question${_askLeft > 1 ? 's' : ''} restante${_askLeft > 1 ? 's' : ''} aujourd’hui`, `${_askLeft} question${_askLeft === 1 ? '' : 's'} left today`) : o.title;
}
function _askDraw() {
  _askCount();
  const meta = document.getElementById('ask-meta'), log = document.getElementById('ask-log'); if (!meta || !log) return;
  meta.textContent = _askLeft === -1 ? _newsT('Votre compte attend validation : les questions s’ouvrent une fois l’accès validé.', 'Your account is waiting for approval: questions open once access is approved.')
    : _newsT('Cherche dans les articles, textes officiels, consultations, publications et papiers des 45 derniers jours, la newsletter et notre analyse de marché', 'Searches the articles, official texts, consultations, publications and papers of the last 45 days, the newsletter and our market analysis')
      + (_askLeft != null ? ' · ' + _newsT(`${_askLeft} question${_askLeft > 1 ? 's' : ''} restante${_askLeft > 1 ? 's' : ''} aujourd’hui`, `${_askLeft} question${_askLeft === 1 ? '' : 's'} left today`) : '');
  log.innerHTML = _askLog.map(x => {
    const src = (x.sources || []).filter(s => s.used || !(x.sources || []).some(t => t.used));
    const body = x.wait ? `<div class="ask-a ask-wait"><span class="spinner"></span> ${_newsT('Je cherche dans le site…', 'Searching the site…')}</div>`
      : x.err ? `<div class="ask-no">${_newsEsc(x.err)}</div>`
      : x.none || !x.answer ? `<div class="ask-no">${_newsT('Rien sur ce sujet dans les contenus du site des 45 derniers jours. Essayez d’autres mots, ou le fil En continu.', 'Nothing on this in the site’s content of the last 45 days. Try other words, or the Live feed.')}</div>`
      : `<div class="ask-a">${_newsEsc(x.answer).replace(/\[(\d+)\]/g, '<sup>$1</sup>')}</div>
        <div class="ask-src">${src.map(s => `<a href="${_newsEsc(s.link)}" target="_blank" rel="noopener noreferrer"><b>${s.n}</b><span>${_newsEsc(s.title)}<small>${_newsEsc(s.source)}${s.date ? ' · ' + _newsEsc(s.date) : ''} · ${_newsEsc(s.kind)}</small></span></a>`).join('')}</div>
        <div class="ask-m">${_newsT('Réponse écrite à partir des sources ci-dessus seulement', 'Answer written from the sources above only')} · ${_newsT('modèle', 'model')} ${_newsEsc(x.model || '')} · <a href="${_newsEsc(_askClaude(x))}" target="_blank" rel="noopener noreferrer">${_newsT('Approfondir dans Claude', 'Go further in Claude')} ↗</a></div>`;
    return `<div class="ask-qa"><div class="ask-q">${_newsEsc(x.q)}</div>${body}</div>`;
  }).join('');
}
async function _askGo(q) {
  const token = await _askToken();
  if (!token) return renderNewsAsk();
  const x = { q, wait: true }; _askLog.unshift(x); _askDraw();
  try {
    const r = await fetch(ASK_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) });
    const j = await r.json().catch(() => ({}));
    x.wait = false;
    if (r.ok) Object.assign(x, j);
    else x.err = j.error === 'quota' ? _newsT('Vous avez posé vos 30 questions du jour : la suite demain.', 'You have asked your 30 questions of the day: more tomorrow.')
      : j.error === 'day' ? _newsT('Le quota gratuit du jour est atteint pour tout le monde : réessayez demain.', 'Today’s free allowance is used up for everyone: try again tomorrow.')
      : j.error === 'not approved' ? _newsT('Votre compte attend validation.', 'Your account is waiting for approval.')
      : _newsT('Pas de réponse pour l’instant (le service d’IA est indisponible) : réessayez plus tard.', 'No answer for now (the AI service is unavailable): try again later.');
    if (j.left != null) _askLeft = j.left;
  } catch (_) {
    x.wait = false; x.err = _newsT('Le service n’est pas joignable pour l’instant.', 'The service cannot be reached for now.');
  }
  _askDraw();
}

// ── Newsletter (data/newsletter.json, scripts/news_letter.py): one edition per reading profile (config/news_profiles.json),
// the profile chosen here is kept in this browser; the morning e-mail sends the same edition ──
let _nlData, _nlWeek, _nlEd = 'daily', _nlMe;
// the subjects a reader can follow (public.news_profile.interests; the categories of scripts/fetch_news.py), in three groups:
// the newsletter, the lead story and the Top stories page are built from them (the owner's choice, 24 Nov. 2026: interests,
// not reading profiles); also the first sign-in (js/onboarding.js) and Settings
const PK_INTERESTS = [
  ['Marchés', 'Markets', [['markets', 'Prix et marchés (spot, forwards)', 'Prices and markets (spot, forwards)'], ['gas', 'Gaz', 'Gas'], ['carbon', 'Carbone (CO₂)', 'Carbon (CO₂)']]],
  ['Renouvelables et contrats', 'Renewables and contracts', [['renewables', 'Renouvelables', 'Renewables'], ['support', 'Soutien aux EnR (CR, appels d’offres, prix négatifs)', 'Renewable support (CfDs, tenders, negative prices)'], ['deal', 'PPA et transactions', 'PPAs and deals'], ['build', 'Nouveaux projets et stockage', 'New projects and storage']]],
  ['Cadre et contexte', 'Framework and context', [['regulation', 'Régulation, CRE et textes officiels', 'Regulation, CRE and official texts'], ['power', 'Système électrique : réseau, nucléaire, production', 'Power system: grid, nuclear, generation'], ['geopolitics', 'Géopolitique', 'Geopolitics'], ['report', 'Rapports et études', 'Reports and studies'], ['assoc', 'Fédérations et associations', 'Trade bodies and associations']]],
];
window.PK_INTERESTS = PK_INTERESTS;
const _NL_INTERESTS = PK_INTERESTS.flatMap(g => g[2]);
// the reader's subjects: their account's, else this browser's (a visitor)
function _nlInterests() {
  if (_nlMe && (_nlMe.interests || []).length) return { interests: _nlMe.interests, france: !!_nlMe.france };
  try { const v = JSON.parse(localStorage.getItem('pk-nl-interests') || 'null'); if (v) return { interests: v.interests || [], france: !!v.france }; } catch (_) {}
  return { interests: [], france: !!(_nlMe && _nlMe.france) };
}
// the reader's own edition, chosen among every profile's stories (each already written by the AI) by their subjects: same
// rule as the e-mail (scripts/morning_mail.py › tailor): +3 per subject, the profile's rank as a tie-break, France first
// when asked, the admin's pinned story first; n stories, each once
function _nlMine(E) {
  const P = (E && E.profiles) || {}, { interests, france } = _nlInterests(), n = E && E.weekly ? 6 : 5, seen = new Set(), pool = [];
  Object.keys(P).forEach(p => (P[p].stories || []).forEach((st, k) => {
    if (!st || seen.has(st.link)) return; seen.add(st.link);
    const tags = st.tags || [];
    let sc = 3 * tags.filter(t => interests.includes(t)).length - 0.3 * k;
    if (france) sc += tags.includes('fr') ? 2 : -1.5;
    if (E.pinned && st.link === E.pinned) sc += 100;
    pool.push([sc, st]);
  }));
  const first = P[Object.keys(P)[0]] || {};
  return { id: 'mine', stories: pool.sort((x, y) => y[0] - x[0]).slice(0, n).map(x => x[1]), headline: first.headline, headline_en: first.headline_en,
    name: interests.length ? ['Vos sujets', 'Your subjects'] : ['Édition générale', 'General edition'], short: interests.length ? ['vos sujets', 'your subjects'] : ['générale', 'general'], interests };
}
// _nlMe: this reader's row of public.news_profile (warehouse migration 024), when signed in
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
  const row = Object.assign({ profiles: [], exclude: [], interests: [], france: false, daily: false, weekly: false, email_to: null }, _nlMe || {}, patch, { user_id: A.user.id, updated_at: new Date().toISOString() });
  const { error } = await A.client().from('news_profile').upsert(row, { onConflict: 'user_id' });
  if (msgEl) { msgEl.textContent = error ? _newsT('Non enregistré : ', 'Not saved: ') + error.message : _newsT('Enregistré.', 'Saved.'); msgEl.className = 'news-add-msg ' + (error ? 'ko' : 'ok'); }
  if (!error) _nlMe = row;
}
// the subject of an article, in a pill at its right (same choice as the e-mail, scripts/morning_mail.py)
const _NL_TH = [['support', 'Soutien EnR', 'Renewable support'], ['renewables', 'Renouvelables', 'Renewables'], ['gas', 'Gaz', 'Gas'], ['carbon', 'Carbone', 'Carbon'], ['deal', 'Transactions', 'Deals'], ['build', 'Projets', 'Projects'],
  ['regulation', 'Régulation', 'Regulation'], ['markets', 'Marchés', 'Markets'], ['power', 'Électricité', 'Power'], ['geopolitics', 'Géopolitique', 'Geopolitics']];
function _nlPill(tags, official) {
  tags = tags || [];
  if (official) tags = tags.filter(t => ['renewables', 'gas', 'carbon'].includes(t)).length ? tags.filter(t => ['renewables', 'gas', 'carbon'].includes(t)) : ['regulation'];
  const t = _NL_TH.find(x => tags.includes(x[0]));
  return t ? `<span class="nl-pill nl-p-${t[0]}">${_newsT(t[1], t[2])}</span>` : '';
}
const _nlConsPill = k => { const t = _NEWS_CONS_THEMES[k || 'other'] || _NEWS_CONS_THEMES.other; return `<span class="nl-pill">${_newsEsc(_newsT(t[0], t[1]))}</span>`; };
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
  const ed = _nlMine(E);
  const day = new Date(E.date + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const num = (v, d = 2) => v == null ? '–' : v.toLocaleString(en ? 'en-GB' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const a = (u, t) => `<a href="${_newsEsc(u)}" target="_blank" rel="noopener noreferrer">${_newsEsc(t)}</a>`;
  const ddm = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const sec = {
    markets: () => (E.markets || []).length ? `<div class="nl-tiles">${E.markets.map(r => { const c = r.chg || 0, up = c > 0, dn = c < 0, red = r.hours ? dn : up, green = r.hours ? up : dn;   // more hours at 0 € or below: lower prices, in green
      const ch = r.hours ? (r.chg == null ? '' : !c ? _newsT('stable', 'unchanged') : (up ? '▲ +' : '▼ −') + num(Math.abs(c), 0) + ' h') : r.show === 'abs' ? (r.chg == null ? '' : (up ? '▲ +' : dn ? '▼ −' : '= ') + num(Math.abs(c), 1) + ' €') : r.pct == null ? '' : (up ? '▲ +' : dn ? '▼ −' : '') + num(Math.abs(r.pct), 1) + ' %';
      return `<a class="nl-tile" href="#${_newsEsc(r.page || 'today')}"><span>${_newsEsc(L(r.label))}</span><b>${num(r.value, r.hours ? (Number.isInteger(r.value) ? 0 : 1) : 2)}${r.hours ? ' h' : ''}</b><small>${r.hours ? '' : _newsEsc(r.unit)} <i class="${red ? 'up' : green ? 'dn' : ''}">${ch}</i></small>${r.sub ? `<small class="nl-sub">${_newsEsc(L(r.sub))}</small>` : ''}</a>`; }).join('')}</div>
      <div class="nl-src">${_newsT('Sources', 'Sources')} : ${[...new Set(E.markets.map(r => r.src).filter(Boolean))].join(', ')}. ${E.weekly ? _newsT('Variation sur la semaine.', 'Change over the week.') : _newsT('Variation sur la séance précédente.', 'Change on the previous session.')}</div>` : '',
    digest: () => E.digest && (E.digest.items || []).length ? `<ol class="nl-dg">${E.digest.items.map(x => `<li>${_newsEsc((en && x.text_en) || x.text || x.title)} <a href="${_newsEsc(x.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc((x.sources || []).slice(0, 2).join(' · '))} ↗</a></li>`).join('')}</ol>` : '',
    top: () => { const shown = new Set(ed.stories.map(x => x.link).concat(((E.digest || {}).items || []).map(x => x.link))), T = (E.top || []).filter(o => !shown.has(o.link));
      return T.length ? `<ul class="nl-ul">${T.map(o => `<li><span>${a(o.link, o.title)} <span class="nl-src">· ${_newsEsc(o.source)}${o.n > 1 ? ' +' + (o.n - 1) : ''}</span></span>${_nlPill(o.tags)}</li>`).join('')}</ul>` : ''; },
    stories: () => ed.stories.length ? ed.stories.map((s, k) => `<article class="nl-story"><div class="nl-st-h"><h3>${k + 1}. ${a(s.link, s.title)}</h3>${_nlPill(s.tags)}</div>
      ${_newsKeep(s, en) ? `<p class="nl-for"><b>${_newsT('À retenir', 'Takeaway')} ·</b> ${_newsEsc(_newsKeep(s, en))}</p>` : ''}
      <div class="nl-src">${s.sources.slice(0, 4).map(_newsEsc).join(' · ')}${s.sources.length > 4 ? ' +' + (s.sources.length - 4) : ''}</div></article>`).join('') : '',
    official: () => (E.official || []).length ? `<ul class="nl-ul">${E.official.map(o => `<li><span>${a(o.link, o.title)} <span class="nl-src">· ${_newsEsc(o.source)}, ${ddm(o.date)}</span></span>${_nlPill(o.tags, true)}</li>`).join('')}</ul>` : '',
    cons: () => (E.cons || []).length ? `<table class="nl-cons"><tbody>${E.cons.map(c => { const n = c.deadline ? _newsLeft(c.deadline) : null;
      return `<tr><td class="nl-num ${n != null && n <= 7 ? 'dn' : ''}">${n == null ? '' : n === 0 ? _newsT('auj.', 'today') : 'J-' + n}</td><td>${a(c.link, c.title)} <span class="nl-src">· ${_newsEsc(c.source)}</span></td><td class="nl-pc">${_nlConsPill(c.theme)}</td></tr>`; }).join('')}</tbody></table>` : '',
    pubs: () => (E.pubs || []).length ? `<ul class="nl-ul">${E.pubs.map(o => `<li><span>${a(o.link, o.title)} <span class="nl-src">· ${_newsEsc(o.source)}</span></span>${_nlPill(o.tags)}</li>`).join('')}</ul>` : '',
    agenda: () => (E.agenda || []).length ? `<ul class="nl-ul">${E.agenda.map(e => `<li><b>${ddm(e.date)}</b> · ${_newsEsc(L(e.title))}</li>`).join('')}</ul>` : '',
    post: () => E.post ? `<ul class="nl-ul">${((E.posts || []).length ? E.posts : [E.post]).map(p => `<li>${a(p.url, (p.author || 'LinkedIn') + (p.note ? ' · ' + p.note : ''))}</li>`).join('')}</ul>` : '',
  };
  const WK = { digest: ['La semaine en 5 sujets', 'The week in 5 stories'], stories: ['Les sujets de la semaine', 'The week’s stories'], top: ['Les articles de la semaine', 'The week’s articles'], post: ['Les posts de la semaine', 'The week’s posts'] };
  const title = k => _newsT(...(E.weekly && WK[k] ? WK[k] : _NL_SEC[k]));
  // the journal layout of the e-mail (scripts/morning_mail.py, journal()): week's chart, lead story with its chart, figure
  // of the day, the other stories, in brief, the days ahead, this day in past years
  const jours = en ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  const wd = d => jours[(new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7];
  const thL = tags => { const t = _NL_TH.find(x => (tags || []).includes(x[0])); return t ? `<span class="nl-th nl-p-${t[0]}">${_newsT(t[1], t[2])}</span>` : ''; };
  const S = ed.stories || [], parts = [];
  const wc = null;   // no chart any more (the owner's choice, 23 Nov. 2026)
  if (E.weekly && wc) parts.push(`<section class="nl-sec"><h2>${_newsT('Le graphique de la semaine', 'The week’s chart')}</h2><p class="nl-ct">${_newsT('Spot France', 'France spot')} : ${wc.pct < 0 ? '−' : '+'}${num(Math.abs(wc.pct || 0), 0)} % ${_newsT('sur la semaine', 'over the week')}</p>
    <img class="nl-img" src="${DATA_BASE + _newsEsc(wc.img)}" alt="">${(wc.marks || []).map(m => `<p class="nl-mark"><b>${m.n}</b> ${wd(m.date)} ${ddm(m.date)} · ${_newsEsc(en ? m.title_en || m.title : m.title)}</p>`).join('')}
    <div class="nl-src">${_newsT('Moyennes journalières publiées (ENTSO-E).', 'Published daily averages (ENTSO-E).')}${(wc.marks || []).length ? ' ' + _newsT('Les repères situent les événements de la semaine ; ils n’expliquent pas à eux seuls le prix.', 'The markers place the week’s events; they do not explain the price on their own.') : ''}</div></section>`);
  if (S[0]) { const h = S[0], ch = null;
    parts.push(`<section class="nl-sec nl-hero"><h2>${E.weekly ? _newsT('Le sujet de la semaine', 'Story of the week') : _newsT('À la une', 'Lead story')} ${thL(h.tags)}</h2>
      <div class="nl-hero-in">${ch ? `<figure class="nl-hero-ch"><figcaption>${_newsEsc(ch.title)}</figcaption><img class="nl-img" src="${DATA_BASE + _newsEsc(ch.img)}" alt="${_newsEsc(ch.title)}"><div class="nl-src">${_newsT('Source', 'Source')} : ${_newsEsc(ch.src)} · <a href="#${_newsEsc(ch.page)}">${_newsT('voir sur PowerKlock', 'see on PowerKlock')}</a></div></figure>` : ''}
      <div class="nl-hero-t"><h3>${a(h.link, h.title)}</h3>
      ${_newsKeep(h, en) ? `<p class="nl-ret"><b>${_newsT('À retenir.', 'Takeaway.')}</b> ${_newsEsc(_newsKeep(h, en))}</p>` : ''}<div class="nl-src">${h.sources.slice(0, 3).map(_newsEsc).join(' · ')}</div>${_newsFree(h)}</div></div></section>`); }
  if (E.figure && !E.weekly) parts.push(`<section class="nl-sec nl-fig"><b class="${E.figure.dir === 'dn' ? 'dn' : 'up'}">${_newsEsc(E.figure.value)}</b><div><h2>${_newsT('Le chiffre du jour', 'Figure of the day')}</h2><p>${_newsEsc(en ? E.figure.text_en : E.figure.text)}</p></div></section>`);
  if (S.length > 1) parts.push(`<section class="nl-sec">${S.slice(1).map(h => `<article class="nl-story">${thL(h.tags)}<h3>${a(h.link, h.title)}</h3>${_newsKeep(h, en) ? `<p class="nl-ret"><b>${_newsT('À retenir.', 'Takeaway.')}</b> ${_newsEsc(_newsKeep(h, en))}</p>` : ''}<div class="nl-src">${h.sources.slice(0, 3).map(_newsEsc).join(' · ')}</div>${_newsFree(h)}</article>`).join('')}</section>`);
  const shownL = new Set(S.map(x => x.link)), brief = (E.top || []).filter(o => !shownL.has(o.link)).slice(0, E.weekly ? 6 : 4);
  if (brief.length) parts.push(`<section class="nl-sec"><h2>${E.weekly ? _newsT('La semaine en bref', 'The week in brief') : _newsT('En bref', 'In brief')}</h2>${brief.map(o => `<p class="nl-brief">${thL(o.tags)} ${a(o.link, o.title)} <span class="nl-src">${_newsEsc(o.source)}</span></p>`).join('')}</section>`);
  if ((E.week_ahead || []).length) parts.push(`<section class="nl-sec nl-ahead"><h2>${E.weekly ? _newsT('La semaine qui vient', 'The week ahead') : _newsT('Cette semaine', 'This week')}</h2><table>${E.week_ahead.map(x => `<tr><td>${wd(x.date)} ${new Date(x.date + 'T12:00:00Z').getUTCDate()}</td><td>${x.kind === 'cons' ? _newsT('Fin de consultation : ', 'Consultation closes: ') : ''}${x.link ? a(x.link, en && x.title_en ? x.title_en : x.title) : _newsEsc(en && x.title_en ? x.title_en : x.title)}</td></tr>`).join('')}</table></section>`);
  if (E.weekly && E.on_this_day && (E.on_this_day.past || []).length) parts.push(`<section class="nl-sec"><h2>${_newsT('Ce jour-là', 'This day')}</h2><p>${_newsT('Le spot France ce jour-là, année après année', 'France spot on this day, year after year')} : ${E.on_this_day.past.slice().sort((x, y) => x.year - y.year).map(x => `${x.year} : <b>${num(x.value, 0)} €</b>`).join(' · ')}${E.on_this_day.today != null ? ' · ' + _newsT('cette année', 'this year') + ` : <b>${num(E.on_this_day.today, 0)} €</b>` : ''}</p></section>`);
  const body = parts.join('');
  const W = E.weather, wx = W ? `<span class="nl-wx"><img src="${DATA_BASE}newsletter_img/icon_${W.kind}.png" alt="" width="28" height="28"><span><b>${_newsEsc(L(W.label))}</b><small>${_newsEsc(L(W.sub))}</small></span></span>` : '';
  const head = (en && ed.headline_en) || ed.headline;
  const eds = _nlWeek ? `<div class="nl-profiles">${[['daily', '7 O’Klock'], ['weekly', 'PowerBrunch']].map(([k, l]) => `<button type="button" class="tab-btn${(k === 'weekly') === !!E.weekly ? ' active' : ''}" data-nle="${k}" translate="no">${l}</button>`).join('')}</div>` : '';
  const mineN = ed.interests.length;
  host.innerHTML = eds + `<div class="nl-mine">${mineN ? _newsT('Votre édition, selon vos ' + mineN + ' sujets', 'Your edition, from your ' + mineN + ' subjects') : _newsT('Édition générale : choisissez vos sujets pour recevoir la vôtre', 'General edition: choose your subjects to get your own')} · <a href="#" id="nl-goto-me">${_newsT('Modifier', 'Change')}</a></div>
    <div class="nl-paper"><header class="nl-head"><div><span translate="no" class="nl-brand">PowerKlock</span><span>${_newsEsc(day)}</span></div>
      <div class="nl-tt"><h1 translate="no">${E.weekly ? 'PowerBrunch' : '7 O’Klock'}</h1>${wx}</div><div>${E.weekly ? _newsT('La semaine servie à point : ce qu’il fallait retenir, à lire au calme', 'Last week, well done: what mattered, to read at leisure') : _newsT('Marchés, régulation, énergie : l’essentiel à 7 h', 'Markets, regulation, energy: what matters at 7:00')}</div>${sec.markets()}</header>${(en && E.brief_en) || E.brief ? `<section class="nl-sec nl-brief"><h2>${_newsT('Le point du matin', 'The morning brief')}</h2>${String((en && E.brief_en) || E.brief).split(/\n\s*\n/).map(x => `<p>${_newsEsc(x)}</p>`).join('')}${(E.brief_links || []).length ? `<p class="nh-brief-src">${_newsT('À lire', 'Read')} : ${E.brief_links.map(x => `<a href="${_newsEsc(x.link)}" target="_blank" rel="noopener noreferrer">${_newsEsc(x.source)}</a>`).join(' · ')}</p>` : ''}</section>` : ''}
      ${body}
      <footer class="nl-foot">${_newsT('Sujets choisis selon vos centres d’intérêt ; résumés rédigés automatiquement à partir des titres et extraits, chaque sujet renvoie à ses articles. Le même contenu part par e-mail chaque matin de semaine à 7 h.', 'Stories chosen from your subjects; summaries written automatically from the titles and extracts, each story links to its articles. The same content goes out by e-mail every weekday at 7:00.')}</footer></div>`;
  const A = window.PKAccount, me = _nlMe;
  host.insertAdjacentHTML('beforeend', `<div class="news-side nl-me"><div class="news-side-t">${_newsT('Ma newsletter par e-mail', 'My newsletter by e-mail')}</div>` + (A && A.user && me ? `
    <div class="nl-me-f">${_newsT('Mes sujets : votre édition est faite à partir d’eux', 'My subjects: your edition is built from them')}${PK_INTERESTS.map(([gf, ge, list]) => `<div class="nl-me-g">${_newsT(gf, ge)}</div><div class="nl-me-row nl-me-chips">${list.map(([k, fr, en]) => `<label class="nl-chip"><input type="checkbox" name="nl-int" value="${k}"${(me.interests || []).includes(k) ? ' checked' : ''}><span>${_newsT(fr, en)}</span></label>`).join('')}</div>`).join('')}
      <label><input type="checkbox" id="nl-fr"${me.france ? ' checked' : ''}> ${_newsT('Surtout la France (le reste passe après)', 'France first (the rest comes after)')}</label></div>
    <div class="nl-me-f">${_newsT('Recevoir par e-mail', 'Receive by e-mail')}<div class="nl-me-row"><label><input type="checkbox" id="nl-daily"${me.daily ? ' checked' : ''}> <b translate="no">7 O’Klock</b> · ${_newsT('chaque matin de semaine, 7 h', 'every weekday, 7:00')}</label>
      <label><input type="checkbox" id="nl-weekly"${me.weekly ? ' checked' : ''}> <b translate="no">PowerBrunch</b> · ${_newsT('le lundi à 10 h, la semaine écoulée', 'Monday at 10:00, the week before')}</label></div></div>
    <label class="nl-me-f">${_newsT('Adresse (vide = celle du compte)', 'Address (empty = the account’s)')}<input type="email" id="nl-to" class="fuel-select" maxlength="200" value="${_newsEsc(me.email_to || '')}" placeholder="${_newsEsc(A.user.email || '')}"></label>
    <label class="nl-me-f">${_newsT('Mots à écarter, séparés par des virgules', 'Words to leave out, comma separated')}<input type="text" id="nl-ex" class="fuel-select" maxlength="400" value="${_newsEsc((me.exclude || []).join(', '))}" placeholder="${_newsT('ex. pétrole, crypto', 'e.g. oil, crypto')}"></label>
    <div class="nl-me-help">${_newsT('Vos mots-clés (Veille › Personnaliser) ajoutent une rubrique « Vos mots-clés » à votre e-mail.', 'Your keywords (News › Customise) add a “Your keywords” section to your e-mail.')}</div>
    <div class="nl-me-row"><button type="button" class="pk-btn-primary" id="nl-save">${_newsT('Enregistrer', 'Save')}</button><span class="news-add-msg" id="nl-msg"></span></div>`
    : `<div class="nl-me-help">${_newsT('Connectez-vous pour recevoir chaque matin l’édition de vos sujets, à l’adresse de votre choix.', 'Sign in to receive the edition of your subjects every morning, at the address of your choice.')} <a href="#" id="nl-signin">${_newsT('Se connecter', 'Sign in')}</a></div>`) + `</div>`);
  const si = document.getElementById('nl-signin'); if (si) si.addEventListener('click', e => { e.preventDefault(); if (window.PKDash && PKDash.openAccount) PKDash.openAccount(); });
  const sv = document.getElementById('nl-save');
  if (sv) sv.addEventListener('click', () => {
    const to = document.getElementById('nl-to').value.trim(), msg = document.getElementById('nl-msg');
    if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { msg.textContent = _newsT('Adresse e-mail non valide.', 'Invalid e-mail address.'); msg.className = 'news-add-msg ko'; return; }
    _nlSave({ profiles: [], daily: document.getElementById('nl-daily').checked, weekly: document.getElementById('nl-weekly').checked,
      interests: [...host.querySelectorAll('input[name="nl-int"]:checked')].map(x => x.value), france: document.getElementById('nl-fr').checked, email_to: to || null, exclude: [...new Set(document.getElementById('nl-ex').value.split(',').map(x => x.trim()).filter(Boolean))].slice(0, 25) }, msg);
  });
  host.querySelectorAll('[data-nle]').forEach(b => b.addEventListener('click', () => { _nlEd = b.dataset.nle; renderNewsLetter(); }));
  const gm = document.getElementById('nl-goto-me'); if (gm) gm.addEventListener('click', e => { e.preventDefault(); const t = host.querySelector('.nl-me'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

// ── The feed's top, « façon journal » (approved 19 Nov. 2026): the lead story of the morning's newsletter with its
// chart on the left, three more stories, and beside the feed the price tiles and the figure of the day. Same choice
// as the newsletter (data/newsletter.json, the profile chosen in the Newsletter tab, else Origination); a story the
// admin pinned comes first. ──
async function renderNewsUne() {
  const host = document.getElementById('news-une'); if (!host) return;
  if (_nlData === undefined) { try { const r = await fetch(DATA_BASE + 'newsletter.json?t=' + Date.now()); _nlData = r.ok ? await r.json() : null; } catch (_) { _nlData = null; } }
  const E = _nlData, P = (E && E.profiles) || {};
  if (!E || !Object.keys(P).length) { host.hidden = true; return; }
  const en = window.PKI18n && PKI18n.lang === 'en', L = a => Array.isArray(a) ? (en ? a[1] : a[0]) : (a || '');
  const S = _nlMine(E).stories.slice();
  const pinItem = [...(_newsPins || [])].map(l => (newsData || []).find(i => i.link === l)).find(Boolean);
  let lead = S[0], chart = null;
  if (pinItem && (!lead || lead.link !== pinItem.link)) { lead = { title: pinItem.title, link: pinItem.link, what: pinItem.snippet, tags: pinItem.tags, sources: [pinItem.source].concat((pinItem.other_sources || []).map(o => o.source)) }; chart = null; }
  if (!lead) { host.hidden = true; return; }
  const num = (v, d = 2) => v == null ? '–' : v.toLocaleString(en ? 'en-GB' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const a = (u, t) => `<a href="${_newsEsc(u)}" target="_blank" rel="noopener noreferrer">${_newsEsc(t)}</a>`;
  const th = tags => { const t = _NL_TH.find(x => (tags || []).includes(x[0])); return t ? `<span class="news-une-th nl-p-${t[0]}">${_newsT(t[1], t[2])}</span>` : ''; };
  const byLink = l => (newsData || []).find(i => i.link === l);
  const others = S.filter(x => x.link !== lead.link).concat((E.top || []).filter(o => !S.some(x => x.link === o.link) && o.link !== lead.link)).slice(0, 3);
  host.hidden = false;
  host.innerHTML = `<article class="news-une-lead${chart ? '' : ' nochart'}">${chart ? `<figure class="news-une-ch"><figcaption>${_newsEsc(chart.title)}</figcaption><img src="${DATA_BASE + _newsEsc(chart.img)}" alt="${_newsEsc(chart.title)}"><div class="nl-src">${_newsT('Source', 'Source')} : ${_newsEsc(chart.src)} · <a href="#${_newsEsc(chart.page)}">${_newsT('voir sur PowerKlock', 'see on PowerKlock')}</a></div></figure>` : ''}
    <div class="news-une-t"><span class="news-une-k">${pinItem && lead.link === pinItem.link ? _newsT('À la une · choisi par la rédaction', 'Lead story · editor’s pick') : _newsT('À la une', 'Lead story')} ${th(lead.tags)}</span>
      <h2>${a(lead.link, lead.title)}</h2>
      ${_newsKeep(lead, en) ? `<p class="nl-ret"><b>${_newsT('À retenir.', 'Takeaway.')}</b> ${_newsEsc(_newsKeep(lead, en))}</p>` : ''}
      <span class="nl-src">${(lead.sources || []).slice(0, 3).map(_newsEsc).join(' · ')}${_newsAdmin ? ' · ' + _newsPinBtn({ link: lead.link }) : ''}</span>${_newsFree(byLink(lead.link))}</div></article>
    <div class="news-une-more">${others.map(o => `<article>${th(o.tags)}<h3>${a(o.link, o.title)}</h3><span class="nl-src">${_newsEsc((o.sources || [o.source]).slice(0, 2).join(' · '))}</span>${_newsFree(byLink(o.link))}</article>`).join('')}</div>`;
  const dg = document.getElementById('hs-news-digest'); if (dg) dg.hidden = true;     // the lead replaces « L'essentiel » on top of the feed
  const mk = document.getElementById('news-mk'), mkBox = document.getElementById('news-side-mk');
  if (mk && (E.markets || []).length) { mkBox.hidden = false;
    mk.innerHTML = `<div class="news-mk">${E.markets.map(r => { const c = r.chg || 0, up = c > 0, dn = c < 0, red = r.hours ? dn : up, green = r.hours ? up : dn;
      const ch = r.hours ? (r.chg == null ? '' : !c ? _newsT('stable', 'unchanged') : (up ? '▲ +' : '▼ −') + num(Math.abs(c), 0) + ' h') : r.show === 'abs' ? (r.chg == null ? '' : (up ? '▲ +' : dn ? '▼ −' : '= ') + num(Math.abs(c), 1) + ' €') : r.pct == null ? '' : (up ? '▲ +' : dn ? '▼ −' : '') + num(Math.abs(r.pct), 1) + ' %';
      return `<a class="nl-tile" href="#${_newsEsc(r.page || 'today')}"><span>${_newsEsc(L(r.label))}</span><b>${num(r.value, r.hours ? (Number.isInteger(r.value) ? 0 : 1) : 2)}${r.hours ? ' h' : ''}</b><small>${r.hours ? '' : _newsEsc(r.unit)} <i class="${red ? 'up' : green ? 'dn' : ''}">${ch}</i></small></a>`; }).join('')}</div>`; }
  const fg = document.getElementById('news-fig'), fgBox = document.getElementById('news-side-fig');
  if (fg && E.figure) { fgBox.hidden = false; fg.innerHTML = `<div class="nl-fig"><b class="${E.figure.dir === 'dn' ? 'dn' : 'up'}">${_newsEsc(E.figure.value)}</b><p>${_newsEsc(en ? E.figure.text_en : E.figure.text)}</p></div>`; }
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
        host.appendChild(b);
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

// « Mettre à la une »: the admin pins a story (public.news_pin, warehouse migration 027); the newsletter and the News page
// lead with it for 36 hours. Others only see which one is pinned.
let _newsAdmin = false, _newsPins = new Set(), _newsPinNotes = {};
async function _newsLoadPins() {
  const A = window.PKAccount; _newsAdmin = false; _newsPins = new Set();
  if (!A || !A.configured) return;
  try {
    await A.ready(); if (!A.user) return;
    const cl = A.client();
    const [adm, pins] = await Promise.all([cl.rpc('is_news_admin'), cl.from('news_pin').select('link, pinned_at, note').gte('pinned_at', new Date(Date.now() - 36 * 3600e3).toISOString())]);
    _newsAdmin = !!(adm && adm.data);
    _newsPins = new Set(((pins && pins.data) || []).map(r => r.link));
    _newsPinNotes = Object.fromEntries(((pins && pins.data) || []).filter(r => r.note).map(r => [r.link, r.note]));
  } catch (e) { console.warn('[news] pins not read:', e); }
}
// the admin edits the line under a pinned title
const _newsPinNoteBtn = item => _newsAdmin && _newsPins.has(item.link) ? `<button type="button" class="news-pinb" data-pinnote="${_newsEsc(item.link)}" title="${_newsT('Modifier le résumé affiché sous le titre', 'Edit the summary shown under the title')}">✎ ${_newsT('Résumé', 'Summary')}</button>` : '';
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-pinnote]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const cl = window.PKAccount && PKAccount.client && PKAccount.client(), link = b.dataset.pinnote; if (!cl) return;
  const v = window.prompt(_newsT('Résumé à afficher sous le titre : collez le chapô public de l’article ou écrivez une ligne (vide pour retirer).', 'Summary under the title: paste the article’s public summary or write one line (empty to remove).'), _newsPinNotes[link] || '');
  if (v === null) return;
  const note = v.trim().slice(0, 600) || null;
  const r = await cl.from('news_pin').update({ note }).eq('link', link);
  if (r.error) { b.textContent = _newsT('Non enregistré : ', 'Not saved: ') + r.error.message; return; }
  if (note) _newsPinNotes[link] = note; else delete _newsPinNotes[link];
  if (typeof renderNewsHome === 'function') renderNewsHome();
}, true);
const _newsPinBtn = item => _newsAdmin ? `<button type="button" class="news-pinb${_newsPins.has(item.link) ? ' on' : ''}" data-pin="${_newsEsc(item.link)}" title="${_newsPins.has(item.link) ? _newsT('Retirer de la une', 'Remove from the top') : _newsT('Mettre à la une (newsletter et page Veille, 36 h)', 'Put at the top (newsletter and News page, 36 h)')}">${_newsPins.has(item.link) ? _newsT('À la une ✓', 'At the top ✓') : _newsT('Mettre à la une', 'Put at the top')}</button>`
  : (_newsPins.has(item.link) ? `<span class="news-pinb on">${_newsT('À la une', 'At the top')}</span>` : '');
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-pin]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const cl = window.PKAccount && PKAccount.client && PKAccount.client(), link = b.dataset.pin; if (!cl) return;
  const item = (newsData || []).find(i => i.link === link) || {};
  b.disabled = true;
  // pinning: a line to show under the title (the public summary pasted from the page, or one written by the admin);
  // paid papers refuse automated reading, so for them this is the only text the lead can have
  let note = null;
  if (!_newsPins.has(link)) {
    note = window.prompt(_newsT('Résumé à afficher sous le titre (facultatif) : collez le chapô public de l’article ou écrivez une ligne.', 'Summary to show under the title (optional): paste the article’s public summary or write one line.'), '');
    if (note === null) { b.disabled = false; return; }   // cancelled
    note = note.trim().slice(0, 600) || null;
  }
  const r = _newsPins.has(link) ? await cl.from('news_pin').delete().eq('link', link) : await cl.from('news_pin').upsert({ link, title: String(item.title || '').slice(0, 400), note, pinned_at: new Date().toISOString() }, { onConflict: 'link' });
  if (r.error) { b.disabled = false; b.textContent = _newsT('Non enregistré : ', 'Not saved: ') + r.error.message; return; }
  if (_newsPins.has(link)) { _newsPins.delete(link); delete _newsPinNotes[link]; } else { _newsPins.add(link); if (note) _newsPinNotes[link] = note; }
  renderNews(newsData); if (typeof renderNewsUne === 'function') renderNewsUne(); if (typeof renderNewsHome === 'function') renderNewsHome();
}, true);

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

// a paid outlet's article: the same story at outlets readable for free (scripts/fetch_news.py, free_coverage). Inside a card
// that is itself a link, so each outlet is a span opened by the click handler below.
// « À retenir »: the story's summary, then its concrete fact when it adds one (one block, the owner's choice)
const _NEWS_GENERIC = /^\s*(l.|un |une |des |les |le |la )?(impacts?|int[ée]r[êe]ts?|enjeux?|opportunit[ée]s?|cons[ée]quences?|effets?|nouvel(le)?s?|analyser|[ée]tudier|pr[ée]voir|surveiller|suivre|à suivre|anticiper|v[ée]rifier|implications?|potentiel|impact|interest|opportunit|new|watch|monitor|consider)\b/i;
function _newsKeep(h, en) {
  const w = ((en && h.what_en) || h.what || '').trim();
  let y = ((en && h.for_you_en) || h.for_you || '').trim();
  if (_NEWS_GENERIC.test(y) || y.split(/\s+/).length < 4 || w.toLowerCase().includes(y.toLowerCase().slice(0, 40))) y = '';   // a generic line adds nothing
  return w ? w + (y ? (/[.!?…]$/.test(w) ? ' ' : '. ') + y : '') : y;
}
function _newsFree(item, cls) {
  // a major publication (World Energy Outlook, Bilan prévisionnel…): a link to the report itself, on the publisher's site
  const rep = item && item.report_link ? `<div class="news-free news-report${cls ? ' ' + cls : ''}"><span>${_newsT('Le rapport', 'The report')} :</span> <span class="news-free-a" role="link" tabindex="0" data-open="${_newsEsc(item.report_link)}">${_newsEsc(item.report_name || _newsT('sur le site de l’éditeur', 'on the publisher’s site'))} ↗</span></div>` : '';
  const f = (item && item.free) || []; if (!f.length) return rep;
  return rep + `<div class="news-free${cls ? ' ' + cls : ''}"><span>${_newsT('Aussi en accès libre', 'Also free to read')} :</span> ${f.map(o => `<span class="news-free-a" role="link" tabindex="0" data-open="${_newsEsc(o.link)}" title="${_newsEsc(o.title || o.source)}">${_newsEsc(o.source)} ↗</span>`).join(' · ')}</div>`;
}
const _newsOpen = e => {
  const b = e.target.closest && e.target.closest('[data-open]'); if (!b || (e.type === 'keydown' && e.key !== 'Enter')) return;
  e.preventDefault(); e.stopPropagation();
  if (/^https?:\/\//.test(b.dataset.open)) window.open(b.dataset.open, '_blank', 'noopener');
};
document.addEventListener('click', _newsOpen, true);
document.addEventListener('keydown', _newsOpen, true);

// ── Posts to read: LinkedIn posts pasted by the team (public.news_post, warehouse migration 023). Only the link, the
// author and a note are kept; votes go to public.news_vote like the articles' and pick the week's best for Monday's digest.
let _newsPosts = [];
const _newsAuthorOf = url => { const m = url.match(/linkedin\.com\/(?:posts|in)\/([a-z0-9-]+?)(?:-[0-9a-z]*\d[0-9a-z]*)?(?:_|\/|$)/i);
  return m ? m[1].split('-').filter(w => !/\d/.test(w)).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : ''; };
async function renderNewsPosts() {
  const sec = document.getElementById('hs-news-posts'), host = document.getElementById('news-posts'); if (!sec || !host) return;
  const A = window.PKAccount;
  const off = msg => { sec.hidden = false; host.innerHTML = `<div class="news-src-help">${msg}</div>`; };
  if (!A || !A.configured) { off(_newsT('Les posts partagés par l’équipe ne sont pas disponibles ici.', 'The posts shared by the team are not available here.')); return; }
  await A.ready();
  if (!A.user) { off(_newsT('Connectez-vous pour lire et partager les posts LinkedIn de l’équipe.', 'Sign in to read and share the team’s LinkedIn posts.')); return; }
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
const _NEWS_CONS_THEMES = { support: ['Soutien aux renouvelables (CR, OA, prix négatifs)', 'Renewable support (CfD, feed-in, negative prices)'], cee: ['Efficacité énergétique', 'Energy efficiency'], tariffs: ['Tarifs', 'Tariffs'], grid: ['Réseau et raccordement', 'Grid and connection'],
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
  const row = c => `<a class="cons-row" href="${_newsEsc(c.link)}" target="_blank" rel="noopener noreferrer">${due(c)}<span class="cons-t">${_newsEsc(c.title)}<small>${_offThPill(c.theme || 'other')} · ${_newsEsc(c.source)} · ${_newsT('ouverte le ', 'opened ')}${fmt(c.opened)}</small></span></a>`;
  const counts = {}; all.forEach(c => { if (!c.deadline || c.deadline >= today) counts[c.theme || 'other'] = (counts[c.theme || 'other'] || 0) + 1; });
  const keys = Object.keys(_NEWS_CONS_THEMES).filter(k => counts[k]);
  const pick = c => (!_newsConsTheme || (c.theme || 'other') === _newsConsTheme) && (!_offQ || ((c.title || '') + ' ' + (c.source || '')).toLowerCase().includes(_offQ));
  const shown = open.filter(pick);
  const closed = all.filter(c => c.deadline && c.deadline < today && pick(c)).slice(-8).reverse();
  host.innerHTML = (shown.length ? `<div class="cons-list">${shown.map(row).join('')}</div>` : `<div class="news-src-help">${_newsT('Aucune consultation ouverte en ce moment.', 'No consultation open right now.')}</div>`) +
    (closed.length ? `<details class="cons-closed"><summary>${_newsT('Récemment closes', 'Recently closed')} (${closed.length})</summary><div class="cons-list">${closed.map(row).join('')}</div></details>` : '') + _newsIcsHow();
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
    newsSetView('sources'); window.scrollTo({ top: 0, behavior: 'smooth' });
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
    _newsT(`<div class="news-src-help"><b>Ajouter une source pour tout le monde</b> : utilisez le formulaire ci-dessus (connecté). Les sources de la liste de l’équipe restent dans <a href="${edit}" target="_blank" rel="noopener">config/news_sources.json</a> sur GitHub.<br>
    <b>Suivre des sujets pour vous</b> : saisissez-les dans À la une › Personnaliser › Mes mots-clés ; les articles correspondants reçoivent une étoile et sont listés sous ★ Mes mots-clés (gardés dans ce navigateur seulement).<br>
    <b>Impossible</b> : LinkedIn (pas de flux public, et ses conditions interdisent la lecture automatique des pages) et les sites sur abonnement sans flux (Contexte, Montel) : leurs articles apparaissent quand la recherche de presse les trouve. RTE n’a pas de flux d’actualités : ses actualités arrivent par la recherche de presse.</div>`,
    `<div class="news-src-help"><b>Add a source for everyone</b>: use the form above (signed in). The sources of the team list stay in <a href="${edit}" target="_blank" rel="noopener">config/news_sources.json</a> on GitHub.<br>
    <b>Follow subjects for yourself</b>: type them in Top stories › Customise › My keywords; matching articles are starred and listed under ★ My keywords (kept in this browser only).<br>
    <b>Not possible</b>: LinkedIn (no public feed, and its terms forbid reading pages automatically) and subscription sites without a feed (Contexte, Montel): their articles still appear when the press search finds them. RTE has no news feed: its news come through the press search.</div>`);
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
  const q0 = ((document.getElementById('news-search') || {}).value || '').trim(), q = _askIsQ(q0) ? '' : q0.toLowerCase();   // a question goes to Ask PowerKlock, not to the filter
  const kw = _newsKw();
  const kn = document.getElementById('news-kw-n');
  if (kn) kn.textContent = kw.length ? (items || []).filter(i => _newsMine(i, kw)).length + ' matching' : '';
  const frOnly = _newsFr();
  _newsFillSelects(items || []);
  const src = (document.getElementById('news-src') || {}).value || '', cty = (document.getElementById('news-cty') || {}).value || '';
  const per = +((document.getElementById('news-per') || {}).value || 0), since = per ? Date.now() - per * 864e5 : 0;
  const offOnly = !!(document.getElementById('news-offonly') || {}).checked, freeOnly = !!(document.getElementById('news-freeonly') || {}).checked;
  let filtered = (items || []).filter(i => (!frOnly || _newsIsFr(i)) &&
    (newsFilter === 'all' || newsFilter === 'movers' || (newsFilter === 'mine' ? _newsMine(i, kw) :
      newsFilter === 'section' ? _newsSubj(i).some(t => (_newsSectionTags || []).includes(t)) || (i.tags || []).some(t => (_newsSectionTags || []).includes(t) && !_NEWS_TOPICS.includes(t)) :
      _NEWS_TOPICS.includes(newsFilter) ? _newsSubj(i).includes(newsFilter) : (i.tags || []).includes(newsFilter))) &&
    (!since || i.date >= since) && (!offOnly || (i.tags || []).includes('official')) && (!freeOnly || !_NEWS_PAID.test(i.source)) &&
    (!src || i.source === src) && (!cty || (i.countries || []).includes(cty) || (cty === 'FR' && _newsIsFr(i))) &&   // France: same rule as the France focus
    (!q || (i.title + ' ' + i.snippet + ' ' + i.source).toLowerCase().includes(q)));
  // market movers: what moves prices or the renewable business, last 72 h, highest impact first (readers' votes count)
  if (newsFilter === 'movers') filtered = filtered.filter(i => (i.impact || 0) >= 3 && Date.now() - i.date < 72 * 3600e3).sort((a, b) => (b.impact || 0) - (a.impact || 0));
  else if (_newsSort === 'recent') filtered = filtered.slice().sort((a, b) => b.date - a.date);
  if (typeof _nfTokens === 'function') _nfTokens(filtered.length);
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
        <small>${_newsEsc(item.source)}${more ? ` +${more}` : ''}</small>${_newsFree(item, 'news-free-row')}</span>
        <span class="news-row-f">${_newsPills(item)}${_newsPinBtn(item)}<span class="news-vote" data-link="${_newsEsc(item.link)}">${_newsVoteBtns(item.link)}</span></span></a>`;
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
      ${also}${_newsFree(item)}
      <div class="news-card-f"><div class="news-vote" data-link="${_newsEsc(item.link)}">${_newsVoteBtns(item.link)}</div>${_newsPinBtn(item)}</div>
    </a>`;
  }).join('');
}

// the article's own subjects (scripts/fetch_news.py « topics », from its words); older files: its tags
const _NEWS_TOPICS = ['regulation', 'renewables', 'markets', 'gas', 'deal', 'build', 'geopolitics', 'carbon', 'power'];
const _NEWS_PAID = /greenunivers|montel|wind ?power ?monthly|les echos|contexte|recharge/i;
const _newsSubj = i => i.topics || (i.tags || []).filter(t => _NEWS_TOPICS.includes(t)).sort((a, b) => _NEWS_TOPICS.indexOf(a) - _NEWS_TOPICS.indexOf(b));
// up to two subject pills, then « +n »; a pill filters the feed on its subject
function _newsPills(item) {
  const t = _newsSubj(item); if (!t.length) return '';
  const lab = k => { const x = _NL_TH.find(y => y[0] === k); return x ? _newsT(x[1], x[2]) : _newsTagL(k); };
  const pill = (k, n) => `<span class="nl-pill nl-p-${k} nf-pill${n > 1 ? ' nf-extra' : ''}" role="button" tabindex="0" data-ftag="${k}" title="${_newsT('Voir tous les articles de ce sujet', 'See every article on this subject')}">${_newsEsc(lab(k))}</span>`;
  return `<span class="nf-pills">${t.map(pill).join('')}${t.length > 2 ? `<span class="nf-pmore" role="button" tabindex="0" aria-expanded="false" title="${_newsT('Voir les autres sujets', 'Show the other subjects')} : ${_newsEsc(t.slice(2).map(lab).join(' · '))}">+${t.length - 2}</span>` : ''}</span>`;
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
