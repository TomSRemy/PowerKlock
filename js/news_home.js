// ── News › Top stories (« À la une ») and the live feed's filter bar ──
// Top stories reads the articles (data/news.json) and today's newsletter (data/newsletter.json: lead story, the reader's
// profile stories, markets, figure of the day, the week ahead). Its sections follow the reader's choices: the newsletter
// profile and interests (public.news_profile, when signed in) and the layout kept in this browser (pk-news-home).
// Clicking a section title or a subject pill opens the live feed filtered on it.

const NH_RUBS = [
  { id: 'renewables', fr: 'Renouvelables et stockage', en: 'Renewables and storage', topics: ['renewables', 'build'], tag: 'renewables' },
  { id: 'support', fr: 'Soutien aux renouvelables', en: 'Renewable support', topics: ['support'], tag: 'support' },   // CR, OA, tenders, negative prices
  { id: 'power', fr: 'Électricité et marchés', en: 'Power and markets', topics: ['power', 'markets'], tag: 'power' },
  { id: 'regulation', fr: 'Régulation', en: 'Regulation', topics: ['regulation'], tag: 'regulation' },
  { id: 'gas', fr: 'Gaz et carbone', en: 'Gas and carbon', topics: ['gas', 'carbon'], tag: 'gas' },
  { id: 'deal', fr: 'Transactions', en: 'Deals', topics: ['deal'], tag: 'deal' },
  { id: 'intl', fr: 'Europe et international', en: 'Europe and international', intl: true },
  { id: 'research', fr: 'Recherche', en: 'Research', research: true, tag: 'research' },   // papers: OpenAlex, arXiv, HAL, e-mail alerts
  { id: 'mine', fr: 'Mes mots-clés', en: 'My keywords', mine: true, tag: 'mine' },
];
const NH_DEFAULT = ['renewables', 'support', 'power', 'regulation', 'intl', 'research', 'mine'];

function _nhPrefs() {
  let p = null; try { p = JSON.parse(localStorage.getItem('pk-news-home') || 'null'); } catch (_) {}
  p = Object.assign({ rubs: null, custom: [], france: true, aside: { mk: true, cons: true, fig: true }, asideOff: false, closed: {} }, p || {});
  if (!p.rubs) {   // first visit: the sections follow the newsletter interests, else the default set
    const ints = (typeof _nlMe !== 'undefined' && _nlMe && _nlMe.interests) || [];
    const fromInts = NH_RUBS.filter(r => r.topics && r.topics.some(t => ints.includes(t))).map(r => r.id);
    p.rubs = fromInts.length ? fromInts.concat(['support', 'intl', 'research', 'mine'].filter(x => !fromInts.includes(x))) : NH_DEFAULT.slice();
  } else if (!p.support) {   // Renewable support (Nov. 2026): after the first section in layouts saved before it existed
    if (!p.rubs.includes('support')) p.rubs.splice(Math.min(1, p.rubs.length), 0, 'support');
    p.support = 1; _nhSave(p);
  }
  if (!p.research) {   // the Research section (Nov. 2026) appears once in layouts saved before it existed
    if (!p.rubs.includes('research')) p.rubs.splice(Math.max(0, p.rubs.indexOf('mine')) || p.rubs.length, 0, 'research');
    p.research = 1; _nhSave(p);
  }
  return p;
}
function _nhSave(p) { try { localStorage.setItem('pk-news-home', JSON.stringify(p)); } catch (_) {} }
const _nhAgo = d => {
  const h = (Date.now() - d) / 36e5;
  if (h < 1) return _newsT('il y a ' + Math.max(1, Math.round(h * 60)) + ' min', Math.max(1, Math.round(h * 60)) + ' min ago');
  if (h < 20) return _newsT('il y a ' + Math.round(h) + ' h', Math.round(h) + ' h ago');
  if (h < 44) return _newsT('hier', 'yesterday');
  return _newsDay(d);
};
const _nhClock = d => (Date.now() - d < 864e5) ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : _newsDay(d);
const _nhSnip = (s, title) => { s = (s || '').trim(); if (!s || /^the post |appeared first on/i.test(s) || s.length < 40) return ''; return s.toLowerCase().startsWith((title || '').toLowerCase().slice(0, 30)) ? '' : s; };
const _nhA = (url, inner, cls) => `<a${cls ? ` class="${cls}"` : ''} href="${_newsEsc(/^https?:\/\//.test(url || '') ? url : '#')}" target="_blank" rel="noopener noreferrer">${inner}</a>`;

// the reader's edition of today's newsletter: the stories of their subjects (js/news.js › _nlMine)
function _nhProfile(E) { return E && E.profiles && Object.keys(E.profiles).length ? _nlMine(E) : null; }

async function renderNewsHome() {
  const host = document.getElementById('nh'); if (!host || typeof newsData === 'undefined' || !newsData) return;
  if (_nlData === undefined) { try { const r = await fetch(DATA_BASE + 'newsletter.json?t=' + Date.now()); _nlData = r.ok ? await r.json() : null; } catch (_) { _nlData = null; } }
  if (_nlMe === undefined && typeof _nlLoadMe === 'function') await _nlLoadMe();
  const E = _nlData || {}, pref = _nhPrefs(), en = window.PKI18n && PKI18n.lang === 'en', L = a => Array.isArray(a) ? (en ? a[1] : a[0]) : (a || '');
  const items = newsData || [], byLink = l => items.find(i => i.link === l), seen = new Set(), kw = _newsKw();
  const prof = _nhProfile(E);
  // ── the lead: the admin's pick, else the reader's first story, else the most important article ──
  const pin = [...(_newsPins || [])].map(byLink).find(Boolean);
  const st = ((prof && prof.stories) || []).filter(s => s && s.title);
  // a text always follows the lead's title: the story's summary, else the essentials' line on it, else the outlet's
  // extract, else who covers it; without a pick, the first story that has a text leads
  const dig = ((E.digest && (E.digest.items || E.digest)) || []);
  const textOf = s => { if (!s) return ''; const it = byLink(s.link), d = Array.isArray(dig) ? dig.find(x => x && x.link === s.link) : null;
    return (en && s.what_en) || s.what || (d && ((en && d.text_en) || d.text)) || _nhSnip(it && it.snippet, s.title) || ''; };
  // a story one can read leads: it has a text, and its article is free or has a free equivalent
  const readable = s => { const it = byLink(s.link); return !_NEWS_PAID.test(((s.sources || [])[0] || '') + ' ' + (it ? it.source : '')) || (s.free || (it && it.free) || []).length; };
  let lead = pin ? { title: pin.title, link: pin.link, what: (_newsPinNotes || {})[pin.link] || '', tags: pin.topics || pin.tags, sources: [pin.source] } : (st.find(s => textOf(s) && !s.ctx && readable(s)) || st.find(s => textOf(s) && readable(s)) || st.find(s => textOf(s)) || st[0]);
  if (!lead && items[0]) lead = { title: items[0].title, link: items[0].link, tags: items[0].topics || items[0].tags, sources: [items[0].source] };
  const leadItem = lead && byLink(lead.link);
  if (lead) seen.add(lead.link);
  let leadWhat = lead ? textOf(lead) : '';
  if (lead && !leadWhat) {
    const outlets = [...new Set([(lead.sources || [])[0] || (leadItem && leadItem.source)].concat(((leadItem && leadItem.other_sources) || []).map(o => o.source)).filter(Boolean))];
    leadWhat = outlets.length > 1 ? _newsT(`Un sujet suivi par ${outlets.length} médias : ${outlets.slice(0, 4).join(', ')}.`, `A story covered by ${outlets.length} outlets: ${outlets.slice(0, 4).join(', ')}.`)
      : _newsT(`Publié par ${outlets[0] || 'la source'}${leadItem ? ' le ' + _newsDay(leadItem.date) : ''}`.replace(/\.?$/, '.') + ' Lire l’article pour le détail.', `Published by ${outlets[0] || 'the source'}${leadItem ? ' on ' + _newsDay(leadItem.date) : ''}`.replace(/\.?$/, '.') + ' Read the article for the details.');
  }
  const th = tags => { const t = _NL_TH.find(x => (tags || []).includes(x[0])); return t ? _newsT(t[1], t[2]) : ''; };
  const leadH = lead ? `<section class="nh-lead"><span class="nh-k nh-k-lead">${pin && pin.link === lead.link ? _newsT('À la une · choisi par la rédaction', 'Top story · editor’s pick') : _newsT('À la une', 'Top story')}${th(lead.tags) ? ' · ' + _newsEsc(th(lead.tags)) : ''}</span>
    <h2>${_nhA(lead.link, _newsEsc(lead.title))}</h2>${lead.what || lead.for_you
      ? `<p class="nh-ret"><b>${_newsT('À retenir.', 'Takeaway.')}</b> ${_newsEsc(_newsKeep(lead, en))}</p>`
      : leadWhat ? `<p class="nh-chapo">${_newsEsc(leadWhat)}</p>` : ''}
    <span class="nh-src">${_newsEsc((lead.sources || []).slice(0, 2).join(' · '))}${leadItem ? ' · ' + _nhAgo(leadItem.date) : ''} · ${_nhA(lead.link, _newsT('Lire l’article', 'Read the article'), 'nh-read')}${_newsPinBtn({ link: lead.link })}${_newsPinNoteBtn({ link: lead.link })}</span>
    ${_newsFree(leadItem || lead)}</section>` : '';
  // ── the essentials: the reader's other stories of the day ──
  let ess = st.filter(s => !seen.has(s.link)).slice(0, 5);
  // always five: the edition's stories first, then the most important articles of the last 48 h (papers aside)
  if (ess.length < 5) ess = ess.concat(items.filter(i => !seen.has(i.link) && !ess.some(s => s.link === i.link) && Date.now() - i.date < 48 * 36e5 && !(i.tags || []).includes('research'))
    .sort((a, b) => ((b.impact || 0) - 0.35 * (Date.now() - b.date) / 864e5) - ((a.impact || 0) - 0.35 * (Date.now() - a.date) / 864e5))
    .slice(0, 5 - ess.length).map(i => ({ title: i.title, link: i.link, sources: [i.source] })));
  ess.forEach(s => seen.add(s.link));
  const essH = ess.length ? `<section class="nh-ess"><div class="nh-k">${_newsT('L’essentiel du jour', 'Today’s essentials')}${prof && (prof.interests || []).length ? ` <span class="nh-prof">· ${_newsT('selon vos sujets', 'from your subjects')}</span>` : ''}</div>
    <ol>${ess.map(s => `<li><span>${_nhA(s.link, _newsEsc(s.title))} <span class="nh-src">· ${_newsEsc((s.sources || [])[0] || '')}</span></span></li>`).join('')}</ol></section>` : '';
  // ── the sections, in the reader's order; one article appears once, in its first section ──
  const now = Date.now(), fresh = i => now - i.date < ((i.tags || []).includes('research') ? 45 : 7) * 864e5;   // papers: the last 45 days
  const score = i => (i.impact || 0) - 0.35 * (now - i.date) / 864e5 + (pref.france && _newsIsFr(i) ? 1.2 : 0);
  const pick = (pred, n) => { const out = items.filter(i => !seen.has(i.link) && fresh(i) && pred(i)).sort((a, b) => score(b) - score(a)).slice(0, n); out.forEach(i => seen.add(i.link)); return out; };
  const rubDef = id => NH_RUBS.find(r => r.id === id) || (pref.custom || []).find(c => c.id === id);
  const rubs = (pref.rubs || []).map(rubDef).filter(Boolean).filter(r => !r.mine || kw.length);
  // a short summary under each title: the newsletter's when the article is in an edition, else the essentials' line,
  // else the outlet's own extract (not when it only repeats the title)
  const allSt = Object.values(E.profiles || {}).flatMap(p => p.stories || []);
  const sumOf = i => { const s = allSt.find(x => x.link === i.link && x.what && !x.ctx); return s ? textOf(s) : textOf({ link: i.link, title: i.title }); };
  const secH = rubs.map(r => {
    const isR = i => (i.tags || []).includes('research');
    const base = r.mine ? i => _newsMine(i, kw) : r.intl ? i => !_newsIsFr(i) : r.f ? i => _nhMatch(i, r.f) : r.research ? isR : i => _newsSubj(i).some(t => r.topics.includes(t));
    const hasSup = rubs.some(x => x.id === 'support');
    const pred = r.research ? base : r.id === 'renewables' && hasSup ? i => !isR(i) && base(i) && !_newsSubj(i).includes('support')   // support texts go to their own section
      : i => !isR(i) && base(i);   // papers only in their own section
    const its = pick(pred, 4); if (!its.length) return '';
    return `<section class="nh-sec" style="grid-row: span ${its.length + 1}"><h3><button type="button" class="nh-sec-t" data-rub="${_newsEsc(r.id)}" title="${_newsT('Voir tout le fil de cette rubrique', 'See the whole feed of this section')}">${_newsEsc(r.label || _newsT(r.fr, r.en))} <span aria-hidden="true">→</span></button></h3>
      ${its.map(i => { const sum = sumOf(i); return `<div class="nh-it">${_nhA(i.link, `<span class="nh-it-t" title="${_newsEsc(i.title)}">${_newsEsc(i.title)}</span>`)}${sum ? `<p class="nh-it-s">${_newsEsc(sum)}</p>` : ''}<span class="nh-it-m"><span class="nh-src" title="${_newsEsc(i.source)}"><span class="nh-src-n">${_newsEsc(i.source)}</span><span class="nh-src-d"> · ${_nhAgo(i.date)}</span></span>${_newsPills(i)}${_newsPinBtn(i)}</span>${_newsFree(i, 'news-free-row')}</div>`; }).join('')}</section>`;
  }).join('');
  // ── the latest, a teaser of the live feed ──
  const latest = items.filter(i => !seen.has(i.link) && !(i.tags || []).includes('research') && (!pref.france || _newsIsFr(i))).sort((a, b) => b.date - a.date).slice(0, 10);
  const contH = `<section class="nh-cont"><div class="nh-k">${_newsT('En continu', 'Live feed')}</div><div class="nh-rows">${latest.map(i => `<div class="nh-row"><span class="nh-h">${_nhClock(i.date)}</span><span>${_nhA(i.link, _newsEsc(i.title))} <span class="nh-src">· ${_newsEsc(i.source)}</span></span></div>`).join('')}</div>
    <button type="button" class="nh-more" data-rub="all">${_newsT('Tout le fil, avec recherche et filtres', 'The whole feed, with search and filters')} →</button></section>`;
  // ── the side column: markets, what not to miss, figure of the day; each block folds, the column hides ──
  const blk = (id, title, body) => body ? `<section class="nh-blk${pref.closed[id] ? ' closed' : ''}" data-blk="${id}"><button type="button" class="nh-blk-h" aria-expanded="${!pref.closed[id]}"><span class="nh-k">${title}</span><span class="nh-chev" aria-hidden="true">▾</span></button><div class="nh-blk-b">${body}</div></section>` : '';
  const num = (v, d = 2) => v == null ? '–' : v.toLocaleString(en ? 'en-GB' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const mkB = (E.markets || []).length ? `<table class="nh-mk">${E.markets.map(r => {
    const c = r.chg || 0, up = c > 0, dn = c < 0, red = r.hours ? dn : up, green = r.hours ? up : dn;
    const ch = r.hours ? (r.chg == null ? '' : !c ? '=' : (up ? '+' : '−') + num(Math.abs(c), 0) + ' h') : r.show === 'abs' ? (r.chg == null ? '' : (up ? '+' : dn ? '−' : '= ') + num(Math.abs(c), 1)) : r.pct == null ? '' : (up ? '+' : dn ? '−' : '') + num(Math.abs(r.pct), r.pct && Math.abs(r.pct) >= 100 ? 0 : 1) + ' %';
    return `<tr><td><a href="#${_newsEsc(r.page || 'today')}">${_newsEsc(L(r.label).replace(/ aujourd.hui$| today$/i, ''))}</a></td><td class="nh-v" title="${_newsEsc(r.unit || '')}">${num(r.value, r.hours ? 0 : 2)}${r.hours ? ' h' : ''}</td><td class="nh-c ${red ? 'up' : green ? 'dn' : ''}">${ch}</td></tr>`; }).join('')}</table><div class="nh-note">${_newsT('Sources', 'Sources')} : ${_newsEsc([...new Set(E.markets.map(r => r.src).filter(Boolean))].join(', '))}</div>` : '';
  const today = _newsToday();
  const wk = (E.week_ahead || []).filter(w => w.date >= today).slice(0, 5);
  const consB = wk.length ? wk.map(w => { const n = _newsLeft(w.date), t = Array.isArray(w.title) ? L(w.title) : (en && w.title_en) || w.title;
    const lab = n === 0 ? _newsT('auj.', 'today') : n <= 14 ? 'J-' + n : _newsDay(w.date + 'T12:00:00Z');
    return `<div class="nh-due"><b class="${n <= 3 ? 'soon' : ''}">${lab}</b>${w.link ? _nhA(w.link, _newsEsc(t)) : `<span>${_newsEsc(t)}</span>`}</div>`; }).join('') +
    `<button type="button" class="nh-more" data-view="official">${_newsT('Toutes les consultations', 'All consultations')} →</button>` : '';
  const figB = E.figure ? `<div class="nh-fig"><b class="${E.figure.dir === 'dn' ? 'dn' : 'up'}">${_newsEsc(E.figure.value)}</b><p>${_newsEsc(en ? E.figure.text_en : E.figure.text)}</p></div>` : '';
  const aside = [pref.aside.mk && blk('mk', _newsT('Marchés ce matin', 'Markets this morning'), mkB), pref.aside.cons && blk('cons', _newsT('À ne pas rater', 'Not to miss'), consB), pref.aside.fig && blk('fig', _newsT('Le chiffre du jour', 'Figure of the day'), figB)].filter(Boolean).join('');
  host.innerHTML = `<div class="nh-tools"><span class="nh-date">${(d => d.charAt(0).toUpperCase() + d.slice(1))(new Date().toLocaleDateString(en ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }))}</span>
      <button type="button" class="nh-btn" id="nh-perso">⚙ ${_newsT('Personnaliser', 'Customise')}</button>
      ${aside ? `<button type="button" class="nh-btn" id="nh-aside-t">${pref.asideOff ? _newsT('Afficher la colonne', 'Show the column') + ' ⇤' : _newsT('Masquer la colonne', 'Hide the column') + ' ⇥'}</button>` : ''}</div>
    <div class="nh-grid${pref.asideOff || !aside ? ' noaside' : ''}"><div class="nh-main">${(en && E.brief_en) || E.brief ? `<section class="nh-brief"><div class="nh-k">${_newsT('Le point du matin', 'The morning brief')}</div>${String((en && E.brief_en) || E.brief).split(/\n\s*\n/).map((x, k, a) => `<p>${_newsEsc(x)}${k === a.length - 1 ? ' ' : '</p>'}`).join('')}<a class="nh-brief-a" href="#today">${_newsT('Ce qui a bougé et pourquoi, marché par marché', 'What moved and why, market by market')} →</a></p>${(E.brief_links || []).length ? `<p class="nh-brief-src">${_newsT('À lire', 'Read')} : ${E.brief_links.map(x => _nhA(x.link, `${_newsEsc(x.source)}`)).join(' · ')}</p>` : ''}</section>` : ''}<div class="nh-top">${leadH}${essH}</div><div class="nh-secs">${secH}</div>${contH}</div>${aside && !pref.asideOff ? `<aside class="nh-aside">${aside}</aside>` : ''}</div>`;
  _nhWire(host);
}
window.renderNewsHome = renderNewsHome;

function _nhWire(host) {
  host.querySelectorAll('.nh-blk-h').forEach(b => b.addEventListener('click', () => {
    const sec = b.closest('.nh-blk'), id = sec.dataset.blk, p = _nhPrefs(); p.closed[id] = !p.closed[id]; _nhSave(p);
    sec.classList.toggle('closed', !!p.closed[id]); b.setAttribute('aria-expanded', String(!p.closed[id])); }));
  const at = host.querySelector('#nh-aside-t'); if (at) at.addEventListener('click', () => { const p = _nhPrefs(); p.asideOff = !p.asideOff; _nhSave(p); renderNewsHome(); });
  const pe = host.querySelector('#nh-perso'); if (pe) pe.addEventListener('click', _nhCustomise);
  host.querySelectorAll('[data-rub]').forEach(b => b.addEventListener('click', () => _nhOpenFeed(b.dataset.rub)));
  host.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { newsSetView(b.dataset.view); window.scrollTo({ top: 0 }); }));
}

// does an article match a section saved from the feed's filters?
function _nhMatch(i, f) {
  if (f.tag && f.tag !== 'all' && !(f.tag === 'mine' ? _newsMine(i, _newsKw()) : _NEWS_TOPICS.includes(f.tag) ? _newsSubj(i).includes(f.tag) : (i.tags || []).includes(f.tag))) return false;
  if (f.q && !(i.title + ' ' + i.snippet + ' ' + i.source).toLowerCase().includes(f.q)) return false;
  if (f.src && i.source !== f.src) return false;
  if (f.cty && !(i.countries || []).includes(f.cty)) return false;
  if (f.fr && !_newsIsFr(i)) return false;
  return true;
}

// the live feed, filtered on a section of the home page (or on a saved filter)
function _nhOpenFeed(id) {
  const p = _nhPrefs(), r = NH_RUBS.find(x => x.id === id) || (p.custom || []).find(c => c.id === id);
  _nfResetAll(true);
  if (r && r.f) {
    const f = r.f, set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v || ''; };
    set('news-search', f.q); set('news-src', f.src); set('news-cty', f.cty); set('news-per', f.per);
    const fr = document.getElementById('news-fr'); if (fr) { fr.checked = !!f.fr; try { localStorage.setItem('pk-news-fr', f.fr ? '1' : '0'); } catch (_) {} }
    _nfFilter(f.tag || 'all');
  } else if (r && r.intl) {
    const fr = document.getElementById('news-fr'); if (fr) { fr.checked = false; try { localStorage.setItem('pk-news-fr', '0'); } catch (_) {} }
    _nfFilter('all');
  } else _nfFilter(r && r.tag ? r.tag : 'all');
  newsSetView('feed');
  window.scrollTo({ top: 0 });
}
function _nfFilter(tag) {
  const b = document.querySelector(`.news-filters .filter-btn[data-tag="${tag}"]`) || document.querySelector('.news-filters .filter-btn[data-tag="all"]');
  if (b) filterNews(b.dataset.tag, b);
}

// ── the « Customise » panel: the newsletter profile, the sections and their order, France first, the side column ──
function _nhCustomise() {
  const p = _nhPrefs();
  const signed = !!(window.PKAccount && PKAccount.user);
  let ints = _nlInterests().interests.slice();
  const all = NH_RUBS.map(r => r.id).concat((p.custom || []).map(c => c.id)), order = p.rubs.concat(all.filter(x => !p.rubs.includes(x)));
  const name = id => { const r = NH_RUBS.find(x => x.id === id) || (p.custom || []).find(c => c.id === id); return r ? (r.label || _newsT(r.fr, r.en)) : id; };
  // the newsletter by e-mail (public.news_profile, signed in only): which editions, and to which address
  let mailD = !!(_nlMe && _nlMe.daily), mailW = !!(_nlMe && _nlMe.weekly), mailTo = (_nlMe && _nlMe.email_to) || '';
  const acct = (window.PKAccount && PKAccount.user && PKAccount.user.email) || '';
  // the keywords box (its input is wired by js/news.js) comes into the panel and goes back to its holder when it closes
  const mine = document.querySelector('.news-mine');
  const back = () => { const home = document.getElementById('news-kw-home'); if (mine && home) home.appendChild(mine); };
  const ov = document.createElement('div'); ov.className = 'nh-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', _newsT('Personnaliser ma Veille', 'Customise my News'));
  const draw = () => {
    ov.innerHTML = `<div class="nh-panel"><div class="nh-ph"><b>${_newsT('Personnaliser ma Veille', 'Customise my News')}</b><button type="button" class="nh-x" aria-label="${_newsT('Fermer', 'Close')}">✕</button></div>
      <p class="nh-note">${signed ? _newsT('Vos sujets et la priorité France sont ceux de votre newsletter : les changer ici les change aussi pour le mail.', 'Your subjects and France first are those of your newsletter: changing them here changes the e-mail too.') : _newsT('Connectez-vous pour retrouver ces choix partout et dans votre newsletter. Sans compte, ils restent dans ce navigateur.', 'Sign in to keep these choices everywhere and in your newsletter. Without an account, they stay in this browser.')}</p>
      <div class="nh-k">${_newsT('Mes sujets', 'My subjects')}</div>
      ${PK_INTERESTS.map(([gf, ge, list]) => `<div class="nh-g">${_newsT(gf, ge)}</div><div class="nh-chips">${list.map(([k, fr, en]) => `<button type="button" class="nh-chip${ints.includes(k) ? ' on' : ''}" data-int="${k}">${ints.includes(k) ? '✓ ' : ''}${_newsT(fr, en)}</button>`).join('')}</div>`).join('')}
      <div class="nh-k">${_newsT('Mes mots-clés', 'My keywords')}</div><div id="nh-kw-slot"></div>
      ${signed ? `<div class="nh-k">${_newsT('Recevoir par e-mail', 'Receive by e-mail')}</div>
      <label class="nh-cb"><input type="checkbox" id="nh-md"${mailD ? ' checked' : ''}> 7 O’Klock ${_newsT('(chaque matin de semaine, 7 h)', '(every weekday, 7:00)')}</label>
      <label class="nh-cb"><input type="checkbox" id="nh-mw"${mailW ? ' checked' : ''}> PowerBrunch ${_newsT('(le lundi, 10 h)', '(Monday, 10:00)')}</label>
      <label class="nh-to"><span>${_newsT('Adresse de réception', 'Delivery address')}</span><input type="email" id="nh-to" class="fuel-select" maxlength="200" value="${_newsEsc(mailTo)}" placeholder="${_newsEsc(acct)}"><small>${_newsT('Vide : l’adresse de votre compte', 'Empty: your account’s address')}</small></label>` : ''}
      <div class="nh-k">${_newsT('Rubriques de ma page À la une', 'Sections of my Top stories page')}</div>
      <div class="nh-rl">${order.map((id, k) => { const on = p.rubs.includes(id), cus = (p.custom || []).some(c => c.id === id);
        return `<div class="nh-r${on ? ' on' : ''}"><label><input type="checkbox" data-rshow="${_newsEsc(id)}"${on ? ' checked' : ''}> ${_newsEsc(name(id))}</label><span>
          <button type="button" class="nh-mv" data-mv="${k}" data-d="-1" aria-label="${_newsT('Monter', 'Move up')}"${k ? '' : ' disabled'}>▲</button><button type="button" class="nh-mv" data-mv="${k}" data-d="1" aria-label="${_newsT('Descendre', 'Move down')}"${k < order.length - 1 ? '' : ' disabled'}>▼</button>${cus ? `<button type="button" class="nh-mv" data-del="${_newsEsc(id)}" aria-label="${_newsT('Supprimer', 'Delete')}">✕</button>` : ''}</span></div>`; }).join('')}</div>
      <p class="nh-note">${_newsT('Pour ajouter une rubrique : dans En continu, choisissez vos filtres puis « ☆ Ajouter à ma page d’accueil ». « Mes mots-clés » apparaît quand vous en avez saisi (En continu › Outils).', 'To add a section: in the Live feed, choose your filters, then « ☆ Add to my home page ». « My keywords » shows once you have typed some (Live feed › Tools).')}</p>
      <div class="nh-k">${_newsT('Priorité', 'Priority')}</div>
      <label class="nh-cb"><input type="checkbox" id="nh-fr"${p.france ? ' checked' : ''}> ${_newsT('La France d’abord', 'France first')}</label>
      <div class="nh-k">${_newsT('Colonne de droite', 'Side column')}</div>
      ${[['mk', _newsT('Marchés ce matin', 'Markets this morning')], ['cons', _newsT('À ne pas rater', 'Not to miss')], ['fig', _newsT('Le chiffre du jour', 'Figure of the day')]].map(([k, l]) => `<label class="nh-cb"><input type="checkbox" data-aside="${k}"${p.aside[k] ? ' checked' : ''}> ${l}</label>`).join('')}
      <div class="nh-pf"><span class="news-add-msg" id="nh-msg"></span><button type="button" class="pk-btn-ghost" id="nh-cancel">${_newsT('Annuler', 'Cancel')}</button><button type="button" class="nh-save" id="nh-ok">${_newsT('Enregistrer', 'Save')}</button></div></div>`;
    const slot = ov.querySelector('#nh-kw-slot'); if (slot && mine) slot.appendChild(mine);
    ov.querySelectorAll('[data-int]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.int; ints = ints.includes(k) ? ints.filter(x => x !== k) : ints.concat(k); draw(); }));
    ov.querySelectorAll('[data-rshow]').forEach(c => c.addEventListener('change', () => { const id = c.dataset.rshow; p.rubs = c.checked ? order.filter(x => x === id || p.rubs.includes(x)) : p.rubs.filter(x => x !== id); draw(); }));
    ov.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => { const k = +b.dataset.mv, j = k + +b.dataset.d; [order[k], order[j]] = [order[j], order[k]]; p.rubs = order.filter(x => p.rubs.includes(x)); draw(); }));
    ov.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.del; p.custom = p.custom.filter(c => c.id !== id); p.rubs = p.rubs.filter(x => x !== id); order.splice(order.indexOf(id), 1); draw(); }));
    const fr = ov.querySelector('#nh-fr'); fr.addEventListener('change', () => { p.france = fr.checked; });
    const md = ov.querySelector('#nh-md'), mw = ov.querySelector('#nh-mw'), mt = ov.querySelector('#nh-to');
    if (md) md.addEventListener('change', () => { mailD = md.checked; });
    if (mw) mw.addEventListener('change', () => { mailW = mw.checked; });
    if (mt) mt.addEventListener('input', () => { mailTo = mt.value.trim(); });
    ov.querySelectorAll('[data-aside]').forEach(c => c.addEventListener('change', () => { p.aside[c.dataset.aside] = c.checked; }));
    const close = () => { back(); ov.remove(); document.removeEventListener('keydown', esc); };
    ov.querySelector('.nh-x').addEventListener('click', close); ov.querySelector('#nh-cancel').addEventListener('click', close);
    ov.querySelector('#nh-ok').addEventListener('click', async () => {
      const msg = ov.querySelector('#nh-msg');
      if (mailTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mailTo)) { msg.textContent = _newsT('Adresse e-mail invalide.', 'Invalid e-mail address.'); msg.className = 'news-add-msg ko'; return; }
      _nhSave(p);
      try { localStorage.setItem('pk-nl-interests', JSON.stringify({ interests: ints, france: p.france })); } catch (_) {}
      if (signed && typeof _nlSave === 'function') {
        await _nlSave({ interests: ints, france: p.france, daily: mailD, weekly: mailW, email_to: mailTo || null }, msg);
        if (/ko/.test(msg.className)) return;   // not saved: the panel stays open with the reason
      }
      close(); renderNewsHome();
    });
  };
  const esc = e => { if (e.key === 'Escape') { back(); ov.remove(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  ov.addEventListener('click', e => { if (e.target === ov) { back(); ov.remove(); document.removeEventListener('keydown', esc); } });
  draw(); document.body.appendChild(ov);
  const first = ov.querySelector('.nh-x'); if (first) first.focus();
}

// ── the live feed's bar: the filters panel, the active filters as removable labels, « add to my home page » ──
const _nfVal = id => ((document.getElementById(id) || {}).value || '');
const _nfChk = id => !!(document.getElementById(id) || {}).checked;
function _nfTokens(n) {
  const host = document.getElementById('nf-tokens'); if (!host) return;
  const toks = [], tagBtn = document.querySelector(`.news-filters .filter-btn[data-tag="${newsFilter}"]`);
  if (newsFilter && newsFilter !== 'all') toks.push(['tag', tagBtn ? tagBtn.textContent.trim() : newsFilter]);
  if (_nfVal('news-search').trim()) toks.push(['q', '« ' + _nfVal('news-search').trim() + ' »']);
  if (_newsFr()) toks.push(['fr', 'France']);
  const sel = id => { const el = document.getElementById(id); return el && el.value ? el.options[el.selectedIndex].text.replace(/ \(\d+\)$/, '') : ''; };
  if (_nfVal('news-per')) toks.push(['per', sel('news-per')]);
  if (_nfVal('news-cty')) toks.push(['cty', sel('news-cty')]);
  if (_nfVal('news-src')) toks.push(['src', sel('news-src')]);
  if (_nfChk('news-offonly')) toks.push(['off', _newsT('Textes officiels', 'Official texts')]);
  if (_nfChk('news-freeonly')) toks.push(['free', _newsT('Accès libre', 'Free to read')]);
  host.innerHTML = toks.map(([k, l]) => `<button type="button" class="nf-tok" data-tok="${k}" title="${_newsT('Retirer ce filtre', 'Remove this filter')}">${_newsEsc(l)} ✕</button>`).join('');
  const cnt = ['per', 'cty', 'src', 'off', 'free', 'fr'].filter(k => toks.some(t => t[0] === k)).length, b = document.getElementById('nf-n');
  if (b) { b.hidden = !cnt; b.textContent = cnt; }
}
function _nfResetAll(quiet) {
  ['news-search', 'news-per', 'news-cty', 'news-src'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['news-offonly', 'news-freeonly'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
  if (!quiet) _nfFilter('all');
}
document.addEventListener('click', e => {
  const tok = e.target.closest && e.target.closest('[data-tok]');
  if (tok) {
    const k = tok.dataset.tok, clr = id => { const el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = false; else el.value = ''; } };
    if (k === 'tag') _nfFilter('all'); else if (k === 'q') clr('news-search'); else if (k === 'per') clr('news-per'); else if (k === 'cty') clr('news-cty'); else if (k === 'src') clr('news-src');
    else if (k === 'off') clr('news-offonly'); else if (k === 'free') clr('news-freeonly');
    else if (k === 'fr') { clr('news-fr'); try { localStorage.setItem('pk-news-fr', '0'); } catch (_) {} }
    renderNews(newsData); return;
  }
  const fb = e.target.closest && e.target.closest('#nf-fbtn');
  const pop = document.getElementById('nf-pop');
  if (fb && pop) { pop.hidden = !pop.hidden; fb.setAttribute('aria-expanded', String(!pop.hidden)); return; }
  if (e.target.closest && e.target.closest('#nf-done') && pop) { pop.hidden = true; document.getElementById('nf-fbtn').setAttribute('aria-expanded', 'false'); return; }
  if (e.target.closest && e.target.closest('#nf-reset')) { _nfResetAll(); return; }
  if (pop && !pop.hidden && !(e.target.closest && e.target.closest('#nf-pop'))) { pop.hidden = true; const f = document.getElementById('nf-fbtn'); if (f) f.setAttribute('aria-expanded', 'false'); }
  if (e.target.closest && e.target.closest('#nf-save')) {
    const tagBtn = document.querySelector(`.news-filters .filter-btn[data-tag="${newsFilter}"]`);
    const f = { tag: newsFilter, q: _nfVal('news-search').trim().toLowerCase(), src: _nfVal('news-src'), cty: _nfVal('news-cty'), per: _nfVal('news-per'), fr: _newsFr() };
    const label = [newsFilter !== 'all' && tagBtn ? tagBtn.textContent.trim() : '', f.q ? '« ' + f.q + ' »' : '', f.src].filter(Boolean).join(' · ') || _newsT('Mon fil', 'My feed');
    const p = _nhPrefs(), id = 'c' + Date.now(); p.custom = (p.custom || []).concat({ id, label, f }); p.rubs = [id].concat(p.rubs); _nhSave(p);
    const b = e.target.closest('#nf-save'), old = b.textContent; b.textContent = '✓ ' + _newsT('Ajouté à votre page À la une', 'Added to your Top stories page');
    setTimeout(() => { b.textContent = old; }, 2600);
  }
}, false);
// « +n » beside the pills (inside a link) unfolds the other subjects, each then clickable
const _nfMore = e => {
  const b = e.target.closest && e.target.closest('.nf-pmore'); if (!b || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault(); e.stopPropagation();
  const box = b.closest('.nf-pills'); box.classList.add('open'); b.setAttribute('aria-expanded', 'true');
  const first = box.querySelector('.nf-extra'); if (first) first.focus();
};
document.addEventListener('click', _nfMore, true);
document.addEventListener('keydown', _nfMore, true);
// a subject pill (inside a link) filters the feed on its subject
const _nfPill = e => {
  const b = e.target.closest && e.target.closest('[data-ftag]'); if (!b || (e.type === 'keydown' && e.key !== 'Enter')) return;
  e.preventDefault(); e.stopPropagation();
  _nhOpenFeed(NH_RUBS.find(r => r.tag === b.dataset.ftag) ? NH_RUBS.find(r => r.tag === b.dataset.ftag).id : null);
  _nfFilter(b.dataset.ftag);
};
document.addEventListener('click', _nfPill, true);
document.addEventListener('keydown', _nfPill, true);
