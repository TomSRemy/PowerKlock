// « Ask PowerKlock » (News › Ask): answers a question from the site's own content, with its sources.
// 1. the caller must be signed in with an approved account: its Supabase token is checked by the database itself
//    (public.ask_take(), warehouse migration 031), which also counts its questions of the day (15 at most);
// 2. the question is matched against the site's published files (articles, official texts, consultations, the
//    newsletter, our market context): the best passages only, never the whole web;
// 3. a free Workers AI model writes a short answer from those passages only, each sentence pointing to its source;
//    the model goes from the most precise to the lightest as the day's questions add up, so the free daily
//    allocation lasts (the newsletter keeps its share).
// Nothing is stored: the question and the answer live in the reader's page only.

const MODELS = [   // [questions of the day already answered, model]: the first whose threshold is not reached
  [30, '@cf/meta/llama-4-scout-17b-16e-instruct'],
  [90, '@cf/meta/llama-3.1-8b-instruct-fp8'],
  [220, '@cf/meta/llama-3.2-3b-instruct'],
];
const ORIGINS = /^https:\/\/(www\.)?powerklock\.com$|^https:\/\/[a-z0-9-]+\.tom-s-remy\.workers\.dev$|^http:\/\/localhost(:\d+)?$/;
const STOP = new Set(('le la les un une des du de d l à a au aux en et ou sur dans pour par avec sans ce ces cette qui que quoi quel quelle quels quelles ' +
  'est sont été être ont a-t-il il elle ils on nous vous je mon ma mes ton ta tes son sa ses leur leurs plus moins très tout tous toute toutes ' +
  'quoi comment pourquoi quand où combien y-a-t-il dernier dernière derniers dernières récent récents récentes ' +
  'the a an of to in on for and or with what which who how why when where is are was were be been has have do does did about latest recent').split(' '));

export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
const MORE_STOP = 'change changement changements changer mois semaine jour jours annee an ans ci la-dessus actuel actuelle actuellement nouveau nouvelle nouveaux nouvelles ' +
  'derniere dernieres dernier derniers recent recente recents recentes decision decisions info infos information informations point savoir dire dit fait faire ' +
  'question sujet sujets concernant propos ete etre avoir peut doit doivent news actualite actualites article articles';
const STOP2 = new Set([...STOP, ...MORE_STOP.split(' ')].map(w => norm(w)));
const stem = w => w.length > 4 ? w.replace(/(aux|eaux)$/, 'al').replace(/(s|x)$/, '') : w;
// words a reader uses for what the files call otherwise (« papier » → the research items, « PPA » → power purchase agreement…)
const SYN = { ppa: 'ppa power purchase agreement contrat achat', papier: 'publication scientifique recherche', paper: 'publication scientifique recherche',
  etude: 'etude rapport publication', cr: 'complement remuneration', oa: 'obligation achat', turpe: 'turpe tarif reseau', aie: 'aie iea', iea: 'aie iea',
  negatif: 'negatif negative', stockage: 'stockage batterie storage', batterie: 'batterie stockage bess' };
export const terms = q => [...new Set(norm(q).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP2.has(w)).map(stem))];
const words = t => norm(t).split(/[^a-z0-9]+/).filter(Boolean).map(stem);

export function model(answered) {
  const m = MODELS.find(([n]) => answered < n);
  return m ? m[1] : null;
}

const TOPIC_WORDS = { support: 'soutien renouvelables complement remuneration obligation achat prix negatifs ecretement', regulation: 'regulation reglementation',
  renewables: 'renouvelables solaire eolien', markets: 'marche prix', gas: 'gaz', power: 'electricite', carbon: 'carbone co2', deal: 'transaction acquisition', build: 'projet mise en service' };

// the site's content as passages: [{title, text, source, date, link, kind, topics}]
export function passages(news, cons, letter, digest) {
  const out = [];
  for (const i of (news && news.items) || []) {
    out.push({ title: i.title, text: i.snippet || '', source: i.source, date: (i.date || '').slice(0, 10), link: i.link,
      kind: (i.tags || []).includes('official') ? 'texte officiel' : (i.tags || []).includes('research') ? 'publication scientifique' : (i.tags || []).includes('report') ? 'rapport' : 'article',
      topics: i.topics || [], extra: (i.other_sources || []).map(o => o.source).join(', ') });
  }
  for (const c of (cons && cons.items) || []) {
    out.push({ title: c.title, text: `Consultation publique${c.deadline ? ', réponses jusqu’au ' + c.deadline : ''}.`, source: c.source, date: c.opened || '', link: c.link, kind: 'consultation', topics: [c.theme || ''] });
  }
  for (const p of Object.values((letter && letter.profiles) || {})) {
    for (const s of p.stories || []) if (s.what) out.push({ title: s.title, text: s.what + (s.for_you ? ' ' + s.for_you : ''), source: (s.sources || [])[0] || 'PowerKlock', date: (letter.date || ''), link: s.link, kind: 'article', topics: s.tags || [] });
  }
  if (letter && letter.brief) out.push({ title: 'Le point du matin PowerKlock', text: letter.brief, source: 'PowerKlock', date: letter.date || '', link: 'https://www.powerklock.com/#intel/news', kind: 'analyse PowerKlock', topics: ['markets'] });
  for (const c of (digest && digest.context) || []) out.push({ title: `Contexte de marché · ${c.topic}`, text: c.text, source: 'PowerKlock (notes de marché)', date: digest.asof || '', link: 'https://www.powerklock.com/#today', kind: 'analyse PowerKlock', topics: ['markets'] });
  const by = new Map();   // the same link once (the newsletter repeats articles): the longest text wins
  for (const p of out) { const o = by.get(p.link); if (!o || (p.text || '').length > (o.text || '').length) by.set(p.link, p); }
  return [...by.values()].map(p => {
    const ti = words(p.title), tx = words(`${p.text} ${p.kind} ${(p.topics || []).map(t => TOPIC_WORDS[t] || t).join(' ')} ${p.extra || ''}`);
    return Object.assign(p, { _ti: ti, _tx: tx, _all: new Set(ti.concat(tx)), _flat: ' ' + ti.concat(['|'], tx).join(' ') + ' ' });
  });
}

// the passages that answer best (BM25-like): a word counts by its rarity in the whole site (« rémunération » far more
// than « prix »), in the title three times more than in the text; the question's words found side by side count
// double; a passage must hold most of the question's weight; fresher first on a tie
export function search(q, docs, n = 8) {
  const raw = terms(q); if (!raw.length) return [];
  const groups = raw.map(w => [w, ...((SYN[w] || '').split(' ').filter(Boolean).map(stem))]);
  const N = docs.length || 1, idf = w => Math.log(1 + N / (1 + docs.reduce((c, d) => c + (d._all.has(w) ? 1 : 0), 0)));
  const gw = groups.map(g => Math.max(...g.map(idf)));
  const total = gw.reduce((a, b) => a + b, 0);
  const phrases = raw.slice(1).map((w, k) => ` ${raw[k]} ${w} `);
  const scored = docs.map(d => {
    let s = 0, got = 0;
    groups.forEach((g, k) => {
      const inT = g.some(w => d._ti.includes(w)), inX = g.some(w => d._tx.includes(w));
      if (inT || inX) { got += gw[k]; s += gw[k] * ((inT ? 3 : 0) + (inX ? 1 : 0)); }
    });
    for (const ph of phrases) if (d._flat.includes(ph)) s *= 1.5;
    return { d, s, got };
  }).filter(x => x.got >= 0.6 * total);
  scored.sort((a, b) => b.s - a.s || (b.d.date || '').localeCompare(a.d.date || ''));
  return scored.slice(0, n).map(x => { const { _ti, _tx, _all, _flat, ...d } = x.d; return d; });
}

const SYSTEM = `Tu es l'assistant de veille de PowerKlock (marché français et européen de l'électricité), pour des directeurs du secteur.
Tu reçois une question et des passages numérotés tirés du site (articles, textes officiels, consultations, analyses PowerKlock).
Réponds dans la langue de la question, en 2 à 5 phrases claires, uniquement à partir de ces passages : chaque phrase finit par le
numéro de sa source entre crochets, par exemple [2]. Aucun fait, chiffre, date ni acteur absent des passages. Si les passages ne
répondent pas à la question, dis-le en une phrase, sans inventer. Pas de conseil, pas de formule creuse.
Réponds en JSON seulement : {"answer": "<texte>", "used": [<numéros utilisés>]}`;

async function json(url, ttl = 600) {
  const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
  return r.ok ? r.json() : null;
}

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGINS.test(o) ? o : 'https://www.powerklock.com', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', Vary: 'Origin' };
}
const reply = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

async function db(env, fn, token, body = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.ok ? r.json() : { ok: false, reason: r.status === 401 ? 'signed out' : 'database ' + r.status };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(req, { error: 'signed out' }, 401);
    if (req.method === 'GET') return reply(req, await db(env, 'ask_left', token));   // the questions left today, for the counter
    if (req.method !== 'POST') return reply(req, { error: 'method' }, 405);
    let q = '';
    try { q = String((await req.json()).q || '').trim().slice(0, 300); } catch { /* empty question */ }
    if (q.length < 3) return reply(req, { error: 'empty' }, 400);
    const site = env.SITE || 'https://www.powerklock.com';
    const [news, cons, letter, digest] = await Promise.all(['news.json', 'consultations.json', 'newsletter.json', 'market_digest.json'].map(f => json(`${site}/data/${f}`).catch(() => null)));
    const found = search(q, passages(news, cons, letter, digest));
    // a question the site has nothing on costs no question and no AI
    if (!found.length) return reply(req, { answer: null, sources: [], none: true });
    const take = await db(env, 'ask_take', token);
    if (!take.ok) return reply(req, { error: take.reason || 'refused', left: take.left }, take.reason === 'quota' || take.reason === 'day' ? 429 : 403);
    const m = model((take.total || 1) - 1);
    if (!m) return reply(req, { error: 'day', left: 0 }, 429);
    const ctx = found.map((d, k) => `[${k + 1}] ${d.title} (${d.kind}, ${d.source}${d.date ? ', ' + d.date : ''})\n${(d.text || '').slice(0, 600)}`).join('\n\n');
    let answer = null, used = [];
    try {
      const r = await env.AI.run(m, { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Question : ${q}\n\nPassages :\n${ctx}` }], max_tokens: 500 });
      const txt = typeof r === 'string' ? r : (r.response ?? '');
      const o = typeof txt === 'object' ? txt : JSON.parse((String(txt).match(/\{[\s\S]*\}/) || ['{}'])[0]);
      answer = String(o.answer || '').trim() || null;
      used = (o.used || []).map(Number).filter(n => n >= 1 && n <= found.length);
    } catch (e) {
      return reply(req, { error: 'ai', detail: String(e).slice(0, 200), left: take.left }, 502);
    }
    if (!used.length && answer) used = [...answer.matchAll(/\[(\d+)\]/g)].map(x => +x[1]).filter(n => n >= 1 && n <= found.length);
    const sources = found.map((d, k) => ({ n: k + 1, title: d.title, source: d.source, date: d.date, link: d.link, kind: d.kind, topics: d.topics, used: used.includes(k + 1) }));
    return reply(req, { answer, sources, model: m.split('/').pop(), left: take.left });
  },
};
