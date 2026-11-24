// The PowerKlock connector for Claude: a remote MCP server (Streamable HTTP, JSON answers) at
//   https://powerklock-mcp.<account>.workers.dev/mcp/<personal token>
// Each approved account makes its personal link in the site (Account › Connector for Claude, public.mcp_new(), warehouse
// migration 033); the Worker checks it with public.mcp_check() (400 tool calls a day) and answers from the files the site
// already publishes (data/…): read only, the same figures as the site, each result with its source.
import { passages, search } from '../ask/index.js';

const PROTOCOL = '2025-03-26';
const paris = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;

async function data(env, path, ttl = 600) {
  const r = await fetch(`${env.SITE}/data/${path}`, { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) return null;
  return path.endsWith('.csv') ? r.text() : r.json();
}
const back = (pts, days) => { if (!pts.length) return null; const t = addDays(pts[pts.length - 1][0].slice(0, 10), -days); let v = null; for (const [d, x] of pts) if (d.slice(0, 10) <= t && x != null) v = x; return v; };

const TOOLS = [
  { name: 'search_news', description: 'Search the PowerKlock news watch (French and European power market): articles, official texts, consultations, reports, research papers of the last 45 days, the newsletter and PowerKlock market notes. Returns the best passages with source, date and link.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words or a question, French or English (e.g. « complément de rémunération », « negative prices », « TURPE »)' }, max: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }, required: ['query'] },
    run: async (env, a) => {
      const [news, cons, letter, digest] = await Promise.all(['news.json', 'consultations.json', 'newsletter.json', 'market_digest.json'].map(f => data(env, f).catch(() => null)));
      return search(a.query, passages(news, cons, letter, digest), Math.min(20, a.max || 10)).map(d => ({ title: d.title, kind: d.kind, source: d.source, date: d.date, link: d.link, text: (d.text || '').slice(0, 400) }));
    } },
  { name: 'official_texts', description: 'Energy texts published in the last days: Journal officiel, EUR-Lex, CRE deliberations and tenders, with their theme (energy efficiency, tariffs, grid, renewable support, renewables and tenders, market, gas).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 30, default: 30 }, theme: { type: 'string', enum: ['support', 'cee', 'tariffs', 'grid', 'renewables', 'market', 'gas', 'other'] } } },
    run: async (env, a) => {
      const n = await data(env, 'news.json'), since = addDays(paris(), -(a.days || 30));
      return ((n && n.items) || []).filter(i => (i.tags || []).includes('official') && (i.date || '').slice(0, 10) >= since && (!a.theme || (i.theme || 'other') === a.theme))
        .map(i => ({ date: i.date.slice(0, 10), title: i.title, source: i.source, theme: i.theme || 'other', link: i.link }));
    } },
  { name: 'consultations', description: 'Public consultations on energy (CRE, RTE, ministry): title, deadline to answer, theme, link.',
    inputSchema: { type: 'object', properties: { open_only: { type: 'boolean', default: true } } },
    run: async (env, a) => {
      const c = await data(env, 'consultations.json'), t = paris();
      return ((c && c.items) || []).filter(x => a.open_only === false || !x.deadline || x.deadline >= t).map(x => ({ title: x.title, deadline: x.deadline, opened: x.opened, theme: x.theme, source: x.source, link: x.link }));
    } },
  { name: 'day_ahead', description: 'Day-ahead (spot) prices of one delivery day (Paris time) for a bidding zone: base, peak, off-peak, min, max, hours at or below zero, and the generation mix. Source ENTSO-E.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, delivery day; default today' }, zone: { type: 'string', default: 'FR', description: 'FR, DE_LU, BE, NL, ES, IT_NORD, CH, AT, PL…' } } },
    run: async (env, a) => {
      let d = a.date || paris(), j = await data(env, `history/daily/${d}.json`, 900);
      if (!j && !a.date) { d = addDays(d, -1); j = await data(env, `history/daily/${d}.json`, 900); }
      if (!j) return { error: `no prices for ${d}` };
      const z = (j.zones || {})[a.zone || 'FR'];
      if (!z) return { error: `zone ${a.zone} not found`, zones: Object.keys(j.zones || {}) };
      return { delivery_day: d, zone: a.zone || 'FR', unit: '€/MWh', base: r2(z.avg), peak: r2(z.peakAvg), off_peak: r2(z.offAvg), min: r2(z.min), max: r2(z.max),
        hours_at_or_below_zero: z.negH, renewable_share_pct: z.renPct, main_fuel: z.domFuel, mix_MW: z.genmix ? Object.fromEntries(Object.entries(z.genmix).filter(([k]) => k !== 'byCode')) : null, source: 'ENTSO-E Transparency Platform, via PowerKlock' };
    } },
  { name: 'market_snapshot', description: 'This morning’s French market as in the PowerKlock newsletter: spot, peak-base, negative hours, Cal year-ahead, PEG gas, guarantees of origin (value, move), the morning brief, and PowerKlock’s market context and expected trend of the week per market.',
    inputSchema: { type: 'object', properties: {} },
    run: async env => {
      const [e, md] = await Promise.all([data(env, 'newsletter.json'), data(env, 'market_digest.json')]);
      return { date: e && e.date, markets: ((e && e.markets) || []).map(m => ({ market: (m.label || [])[0], value: m.value, unit: m.unit, change: m.chg, change_pct: m.pct, source: m.src })),
        morning_brief: e && e.brief, weather: e && e.weather && (e.weather.label || [])[0], context: md && md.context, week_ahead: md && md.outlook, context_date: md && md.asof };
    } },
  { name: 'forwards', description: 'Year-ahead and following calendar contracts (Cal) of a country: last settlement, change over 7 and 30 days.',
    inputSchema: { type: 'object', properties: { country: { type: 'string', enum: ['FR', 'DE', 'NL', 'UK'], default: 'FR' } } },
    run: async (env, a) => {
      const c = await data(env, 'history/fr_market_calchain.json'), Y = c && c[a.country || 'FR'] && c[a.country || 'FR'].years;
      if (!Y) return { error: 'no forward data' };
      return Object.keys(Y).sort().map(y => { const pts = Y[y].dates.map((d, i) => [d, Y[y].values[i]]), l = pts[pts.length - 1];
        return { contract: `Cal ${y}`, date: l[0], price: l[1], unit: '€/MWh', change_7d: r2(l[1] - back(pts, 7)), change_30d: r2(l[1] - back(pts, 30)) }; });
    } },
  { name: 'hydro_reservoirs', description: 'Hydro reservoir filling of a country (ENTSO-E): latest week in TWh, against the same week of past years (mean, rank).',
    inputSchema: { type: 'object', properties: { country: { type: 'string', default: 'FR', description: 'FR, CH, ES, PT, AT, IT, NO, SE, FI' } } },
    run: async (env, a) => {
      const h = await data(env, 'history/hydro_reservoirs.json', 3600), c = h && h.countries && h.countries[a.country || 'FR'];
      if (!c) return { error: 'country not found' };
      const W = Array.isArray(c.weeks) ? c.weeks : Object.entries(c.weeks).sort(), [d0, v0] = W[W.length - 1];
      const wk = d => { const t = new Date(d + 'T12:00:00Z'), j = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - j) / 864e5 + j.getUTCDay() + 1) / 7); };
      const same = W.filter(([d]) => wk(d) === wk(d0) && d.slice(0, 4) !== d0.slice(0, 4)), avg = same.reduce((s, x) => s + x[1], 0) / (same.length || 1);
      return { country: c.name, week_of: d0, stored_TWh: r2(v0 / 1e6), same_week_mean_TWh: r2(avg / 1e6), gap_pct: r1((v0 / avg - 1) * 100),
        past_years_TWh: Object.fromEntries(same.map(([d, v]) => [d.slice(0, 4), r2(v / 1e6)])), source: h.source };
    } },
  { name: 'guarantees_of_origin', description: 'Guarantees of origin: the latest weekly broker prices (Commerg, indications, not tradable) and the French state auctions (EEX) with price per technology.',
    inputSchema: { type: 'object', properties: {} },
    run: async env => {
      const [csv, au] = await Promise.all([data(env, 'go_prices.csv', 3600), data(env, 'go_auctions.json', 3600)]);
      const rows = String(csv || '').trim().split(/\r?\n/), head = (rows.shift() || '').split(','), ix = k => head.indexOf(k), last = rows.length ? rows[rows.length - 1].split(',')[ix('parsed_date')] : null;
      const broker = rows.map(r => r.split(',')).filter(r => r[ix('parsed_date')] === last).map(r => ({ product: r[ix('product')], year: r[ix('year')], bid: +r[ix('bid')] || null, ask: +r[ix('ask')] || null, change: +r[ix('delta')] || 0 }));
      const auctions = ((au && (au.auctions || au.items)) || au || []).slice(-4).map(x => { const t = x.by_technology || [], vol = t.reduce((s, y) => s + y.allocated_mwh, 0);
        return { auction_month: x.auction_month, allocated_TWh: r2(vol / 1e6), mean_price: vol ? r2(t.reduce((s, y) => s + y.allocated_mwh * y.price_eur_mwh, 0) / vol) : null, by_technology: Object.fromEntries(t.map(y => [y.technology, r2(y.price_eur_mwh)])) }; });
      return { broker_week: last, broker_source: 'Commerg Market Week (indications, not tradable)', broker, auctions, auctions_source: 'EEX, French state auctions', unit: '€/MWh' };
    } },
  { name: 'research_papers', description: 'Recent research papers on power markets (OpenAlex, arXiv, HAL, alerts): title, authors and journal, link.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'optional words to filter' } } },
    run: async (env, a) => {
      const n = await data(env, 'news.json'), items = ((n && n.items) || []).filter(i => (i.tags || []).includes('research'));
      const docs = items.map(i => ({ title: i.title, text: i.snippet || '', source: i.source, date: (i.date || '').slice(0, 10), link: i.link, kind: 'publication scientifique', topics: i.topics || [] }));
      const out = a.query ? search(a.query, passages({ items: items }, null, null, null), 20) : docs.slice(0, 20);
      return out.map(d => ({ title: d.title, authors_journal: d.text, source: d.source, date: d.date, link: d.link }));
    } },
  { name: 'warehouse_schema', description: 'The PowerKlock SQL warehouse: the tables and views this link may read (schemas analytics, market, meta, news) with their columns; news.article is the archive of every collected article, official text, report and paper (title, source, published, topics, theme, public summary, link) since the start. Read it before sql_query. analytics.* are ready-made views (day-ahead prices by 15 min, hour and day for every zone, capture prices, battery spreads, clean spark/dark, generation, French regions, cross-border flows, negative hours, installed capacity, PPA); meta.dictionary and meta.convention explain columns and units.',
    inputSchema: { type: 'object', properties: {} },
    run: async (env, a, token) => rpc(env, 'mcp_schema', { p_token: token }) },
  { name: 'sql_query', description: 'Run one read-only SQL query (SELECT or WITH, PostgreSQL) on the PowerKlock warehouse: schemas analytics, market, meta and news only (see warehouse_schema; news.article for the news history, searched with tsv @@ plainto_tsquery(\'simple\', \'words\') or title ilike); 5 seconds and 2,000 rows at most. Dates are delivery days in Paris time; prices in €/MWh. A member link does not reach the forward contracts (use the forwards tool for the latest ones).',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'e.g. select delivery_date, base, peak, neg_hours from analytics.da_price_daily where zone = \'FR\' order by delivery_date desc limit 30' } }, required: ['query'] },
    run: async (env, a, token) => rpc(env, 'mcp_sql', { p_token: token, p_query: String(a.query || '') }) },
];

async function rpc(env, fn, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('warehouse ' + r.status);
  return r.json();
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const json = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: body == null ? {} : { 'Content-Type': 'application/json' } });

async function check(env, token) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mcp_check`, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: token }) });
    return r.ok ? r.json() : { ok: false, reason: 'database ' + r.status };
  } catch (e) { return { ok: false, reason: 'database' }; }
}

async function handle(env, token, m) {
  const id = m.id ?? null;
  if (typeof m.method !== 'string') return fail(id, -32600, 'Invalid request');
  if (m.method.startsWith('notifications/')) return null;
  if (m.method === 'ping') return ok(id, {});
  if (m.method === 'initialize') {
    const c = await check(env, token);
    if (!c.ok) return fail(id, -32001, c.reason === 'quota' ? 'Daily limit reached (400 calls)' : 'This PowerKlock link is not valid: make a new one in the site (Account › Connector for Claude)');
    return ok(id, { protocolVersion: (m.params && m.params.protocolVersion) || PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'PowerKlock', version: '1.0.0' },
      instructions: 'PowerKlock: French and European power market data and news watch. Use search_news for news, regulation and consultations; day_ahead, forwards, market_snapshot, hydro_reservoirs and guarantees_of_origin for today’s figures; warehouse_schema then sql_query for history and any other calculation. Cite the source and link given in each result.' });
  }
  if (m.method === 'tools/list') return ok(id, { tools: TOOLS.map(({ run, ...t }) => t) });
  if (m.method === 'tools/call') {
    const t = TOOLS.find(x => x.name === (m.params && m.params.name));
    if (!t) return fail(id, -32602, 'Unknown tool');
    const c = await check(env, token);
    if (!c.ok) return ok(id, { isError: true, content: [{ type: 'text', text: c.reason === 'quota' ? 'Daily limit of the PowerKlock connector reached (400 calls): more tomorrow.' : 'PowerKlock link not valid or account not approved.' }] });
    try {
      const out = await t.run(env, (m.params && m.params.arguments) || {}, token);
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(out) }] });
    } catch (e) {
      return ok(id, { isError: true, content: [{ type: 'text', text: 'PowerKlock could not read this data: ' + String(e).slice(0, 200) }] });
    }
  }
  return fail(id, -32601, 'Method not found');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), mt = url.pathname.match(/^\/mcp\/([0-9a-f]{48})\/?$/);
    if (!mt) return json({ name: 'PowerKlock connector for Claude', how: 'Make your personal link in the PowerKlock site: Account › Connector for Claude.' }, url.pathname === '/' ? 200 : 404);
    if (req.method === 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    if (req.method === 'DELETE') return json(null, 200);
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    let body;
    try { body = await req.json(); } catch { return json(fail(null, -32700, 'Parse error'), 400); }
    const msgs = Array.isArray(body) ? body : [body];
    const out = (await Promise.all(msgs.map(m => handle(env, mt[1], m)))).filter(Boolean);
    if (!out.length) return json(null, 202);
    return json(Array.isArray(body) ? out : out[0]);
  },
};
