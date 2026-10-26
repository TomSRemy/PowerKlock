// News come from data/news.json, written every 3 hours by
// scripts/fetch_news.py (GitHub Actions) from the sources of
// config/news_sources.json: RSS/Atom feeds, the CRE news page, press searches.
// No client-side proxy and no placeholder articles: if the file is missing
// the page says so.
async function loadNews() {
  window._newsLoaded = true;
  const badge = document.getElementById('news-updated');
  try {
    const r = await fetch(DATA_BASE + 'news.json?t=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    newsData = (j.items || []).map(i => Object.assign({}, i, { date: new Date(i.date) }))
      .sort((a, b) => b.date - a.date);
    const upd = j.updated ? new Date(j.updated).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '';
    window._newsSources = j.sources || null;
    const nSrc = j.sources ? j.sources.filter(s => s.kind !== 'search').length : new Set(newsData.map(n => n.source)).size;
    if (badge) badge.textContent = `${newsData.length} articles · ${nSrc} sources${j.sources ? ' + ' + j.sources.filter(s => s.kind === 'search').length + ' searches' : ''} · ${upd}`;
  } catch (e) {
    newsData = [];
    if (badge) badge.textContent = 'News feed unavailable';
  }
  _newsWireKw();
  renderNews(newsData);
  renderNewsSources();
  renderNewsAdd();
}

// Personal keywords: kept in this browser, matching articles get a star
function _newsKw() { try { return (localStorage.getItem('pk-news-kw') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean); } catch (_) { return []; } }
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
  inp.value = _newsKw().join(', ');
  inp.addEventListener('change', () => { try { localStorage.setItem('pk-news-kw', inp.value); } catch (_) {} renderNews(newsData); });
}

function renderNewsSources() {
  const host = document.getElementById('news-sources'); if (!host) return;
  const src = window._newsSources;
  const edit = 'https://github.com/TomSRemy/PowerKlock/edit/main/config/news_sources.json';
  const rows = src ? src.map(s => `<tr><td>${_newsEsc(s.kind === 'search' ? 'search: ' + s.name : s.name)}${s.added ? ' <span class="news-q">added from the site</span>' : ''}</td><td>${s.kind === 'feed' ? 'RSS feed' : s.kind === 'page' ? 'web page' : 'press search (GDELT)'}</td><td class="${s.ok ? 'ok' : 'ko'}">${s.ok ? s.n + ' articles' : 'failed: ' + _newsEsc(s.error || '')}</td></tr>`).join('') : '';
  host.innerHTML = (src ? `<div style="overflow-x:auto"><table class="news-src-t"><thead><tr><th>Source</th><th>Read as</th><th>Last run</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="news-src-help">The source list appears after the next news run.</div>') +
    `<div class="news-src-help"><b>Add a source for everyone</b>: use the form above (signed in). The sources of the team list stay in <a href="${edit}" target="_blank" rel="noopener">config/news_sources.json</a> on GitHub.<br>
    <b>Follow subjects for yourself</b>: type them in ★ My keywords above; matching articles are starred and listed under ★ My keywords (kept in this browser only).<br>
    <b>Not possible</b>: LinkedIn (no public feed, and its terms forbid reading pages automatically) and subscription sites without a feed (Contexte, Montel): their articles still appear when the press search finds them. RTE has no news feed: its news come through the press search.</div>`;
}

// Add a source from the site: public.news_source (warehouse migration 012), read by
// scripts/fetch_news.py at the next hourly run. Signed-in users only (RLS).
const _NEWS_TAGS = ['power', 'gas', 'carbon', 'regulation', 'markets', 'fr'];
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
    if (si) si.addEventListener('click', e => { e.preventDefault(); if (typeof window.switchDashboard === 'function') window.switchDashboard('mydash'); setTimeout(() => { const b = document.getElementById('pkd-acc-btn'); if (b) b.click(); }, 400); });
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
    <div class="news-add-tags">Topics: ${_NEWS_TAGS.map(t => `<label><input type="checkbox" value="${t}"> ${t === 'fr' ? 'France' : t}</label>`).join('')}</div>
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
    (newsFilter === 'all' || newsFilter === 'movers' || (newsFilter === 'mine' ? _newsMine(i, kw) : (i.tags || []).includes(newsFilter))) &&
    (!src || i.source === src) && (!cty || (i.countries || []).includes(cty) || (cty === 'FR' && _newsIsFr(i))) &&   // France: same rule as the France focus
    (!q || (i.title + ' ' + i.snippet + ' ' + i.source).toLowerCase().includes(q)));
  // market movers: what moves prices or the renewable business, last 72 h, highest impact first (readers' votes count)
  if (newsFilter === 'movers') filtered = filtered.filter(i => (i.impact || 0) >= 3 && Date.now() - i.date < 72 * 3600e3).sort((a, b) => (b.impact || 0) - (a.impact || 0));
  const grid = document.getElementById('news-grid');
  if (!items || !items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No news available — data/news.json could not be loaded.</div>';
    return;
  }
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${frOnly && newsFilter === 'all' ? 'No French news at the last run.' : newsFilter === 'mine' && !kw.length ? 'Type your keywords above to follow your subjects.' : newsFilter === 'watch' ? 'No press-search results at the last run.' : 'No articles for this filter.'}</div>`;
    return;
  }
  grid.innerHTML = filtered.map(item => {
    const link = /^https?:\/\//.test(item.link || '') ? item.link : '#';
    const tagsHtml = (item.tags || []).map(t => `<span class="news-tag">${_newsIc(t)}${_newsEsc(t)}</span>`).join(' ');
    const mine = _newsMine(item, kw);
    return `<a class="news-card${mine ? ' mine' : ''}" href="${_newsEsc(link)}" target="_blank" rel="noopener noreferrer">
      <div class="news-meta">
        <span class="news-source ${_newsEsc(item.cls)}">${_newsEsc(item.source)}</span>
        <span class="news-time" title="${_newsEsc(item.date.toLocaleString('en-GB', { timeZone: 'Europe/Paris' }))}">${formatTimeAgo(item.date)}</span>
      </div>
      <div class="news-title">${mine ? '<span class="news-star">★</span>' : ''}${_newsEsc(item.title)}</div>
      <div class="news-snippet">${_newsEsc(item.snippet)}</div>
      <div>${tagsHtml}${item.query ? ` <span class="news-q">search: ${_newsEsc(item.query)}</span>` : ''}${(item.countries || []).length ? ` <span class="news-q">${_newsEsc(item.countries.join(' · '))}</span>` : ''}</div>
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
  if (!item) item = { title: link, source: '', tags: [] };
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
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
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
    <div><span style="color:#A87DC4">${_newsIc('carbon')}Carbon</span><br>
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
  remit:      () => renderRemit(),
  wxcities:   () => { if (typeof loadWeather === 'function') loadWeather(); },
  wxhdd:      () => typeof renderHDD!=="undefined"&&renderHDD(),
  status:     () => { if (window.PKStatus) PKStatus.renderStatusPage(); },
  capacity:   () => { if (typeof renderCapacity === 'function') renderCapacity(); },
  regions:    () => { if (typeof renderRegions === 'function') renderRegions(); },
  frsystem:   () => { if (typeof renderFrSystem === 'function') renderFrSystem(); },
  morning:    () => { if (typeof renderMorning === 'function') renderMorning(); },
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
