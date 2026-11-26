// « Ask PowerKlock » (News › Ask): answers a question from the site's own content, with its sources.
// 1. the caller must be signed in with an approved account: its Supabase token is checked by the database itself
//    (public.ask_take(), warehouse migrations 031 and 036), which also counts its questions of the day (30 at most);
// 2. a small free model first reads the question (terms in French and English, span, kind of content, summary or not);
//    those terms are matched against the whole news archive (news.article) and the site's files (consultations, the
//    newsletter, our market context): the best passages only, never the whole web;
// 3. a free Workers AI model writes a short answer from those passages only, each sentence pointing to its source;
//    the model goes from the most precise to the lightest as the day's questions add up, so the free daily
//    allocation lasts (the newsletter keeps its share).
// Nothing is stored: the question and the answer live in the reader's page only.
// It also receives, on POST /share, a LinkedIn post sent from the phone's share sheet (see share() below).

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
  'question sujet sujets concernant propos ete etre avoir peut doit doivent news actualite actualites article articles ' +
  // words of a natural question that no passage carries (the owner, 25 Nov. 2026: « l'IA ne répond presque à aucune question »)
  'si se ne pas passe passer arrive arriver haut bas encore toujours tendance tendances impact impacts effet effets situation niveau ' +
  'explique expliquer quoi sont-ils est-il est-elle ils elles qu cela ca ceci aujourd hui france francais francaise ' +
  'resume resumer resumes resume-moi synthese synthetiser moi me vue niveau cote angle domaine principaux principales grandes evolutions ' +
  'summarise summarize summary happened past last';
const STOP2 = new Set([...STOP, ...MORE_STOP.split(' ')].map(w => norm(w)));
const stem = w => w.length > 4 ? w.replace(/(aux|eaux)$/, 'al').replace(/(s|x)$/, '') : w;
// words a reader uses for what the files call otherwise (« papier » → the research items, « PPA » → power purchase agreement…)
const SYN = { ppa: 'ppa power purchase agreement contrat achat', papier: 'publication scientifique recherche', paper: 'publication scientifique recherche',
  etude: 'etude rapport publication', cr: 'complement remuneration', oa: 'obligation achat', turpe: 'turpe tarif reseau', aie: 'aie iea', iea: 'aie iea',
  negatif: 'negatif negative', stockage: 'stockage batterie storage', batterie: 'batterie stockage bess',
  spot: 'spot day-ahead prix', nucleaire: 'nucleaire edf reacteur disponibilite', edf: 'edf nucleaire', gaz: 'gaz ttf peg gnl', ttf: 'ttf gaz',
  capacite: 'capacite mecanisme', garanty: 'garantie origine go', garantie: 'garantie origine go', go: 'garantie origine', froid: 'froid temperature meteo vague',
  cal: 'cal calendar forward terme',
  // « juridique » is how a reader says what the files call official texts, regulation, decrees, deliberations
  juridique: 'juridique reglementation regulation officiel arrete decret loi deliberation consultation cre ordonnance directive reglement',
  juridiqu: 'juridique reglementation regulation officiel arrete decret loi deliberation consultation cre ordonnance directive reglement',
  reglementaire: 'reglementation regulation officiel arrete decret loi deliberation consultation cre', legal: 'legal regulation officiel arrete decret loi deliberation',
  regulation: 'regulation reglementation officiel arrete decret deliberation cre', forward: 'forward terme cal', solaire: 'solaire photovoltaique pv', eolien: 'eolien vent offshore', rentable: 'rentable rentabilite prix capture' };
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
  // the day's prices (the newsletter's tiles): what a question on a price or a level can be answered from
  const mk = (letter && letter.markets) || [];
  if (mk.length) out.push({ title: 'Marchés ce matin PowerKlock (prix, forwards, gaz, garanties d’origine)', text: mk.map(r => `${(r.label || [])[0] || ''} : ${r.value} ${r.unit || ''}` + (r.pct != null ? ` (${r.pct > 0 ? '+' : ''}${r.pct} % sur la séance précédente)` : r.chg != null ? ` (${r.chg > 0 ? '+' : ''}${r.chg})` : '') + (r.src ? `, source ${r.src}` : '')).join(' ; ') + '. Spot day-ahead, Cal forward, gaz PEG.',
    source: 'PowerKlock', date: letter.date || '', link: 'https://www.powerklock.com/#today', kind: 'données de marché PowerKlock', topics: ['markets'] });
  if (letter && letter.brief) out.push({ title: 'Le point du matin PowerKlock', text: letter.brief, source: 'PowerKlock', date: letter.date || '', link: 'https://www.powerklock.com/#intel/news', kind: 'analyse PowerKlock', topics: ['markets'] });
  for (const [k, c] of Object.entries((digest && digest.outlook) || {})) if (c && c.text) out.push({ title: `Tendance de la semaine · ${k}`, text: c.text, source: 'PowerKlock (notes de marché)', date: digest.asof || '', link: 'https://www.powerklock.com/#today', kind: 'analyse PowerKlock', topics: ['markets'] });
  for (const c of (digest && digest.context) || []) out.push({ title: `Contexte de marché · ${c.topic}`, text: c.text, source: 'PowerKlock (notes de marché)', date: digest.asof || '', link: 'https://www.powerklock.com/#today', kind: 'analyse PowerKlock', topics: ['markets'] });
  const by = new Map();   // the same link once (the newsletter repeats articles): the longest text wins
  for (const p of out) { const o = by.get(p.link); if (!o || (p.text || '').length > (o.text || '').length) by.set(p.link, p); }
  return [...by.values()].map(p => {
    const ti = words(p.title), tx = words(`${p.text} ${p.kind} ${(p.topics || []).map(t => TOPIC_WORDS[t] || t).join(' ')} ${p.extra || ''}`);
    return Object.assign(p, { _ti: ti, _tx: tx, _all: new Set(ti.concat(tx)), _flat: ' ' + ti.concat(['|'], tx).join(' ') + ' ' });
  });
}

// two words one or two typing slips apart (Levenshtein distance ≤ 2)
function near(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= 2;
}

// the passages that answer best (BM25-like): a word counts by its rarity in the whole site (« rémunération » far more
// than « prix »), in the title three times more than in the text; the question's words found side by side count
// double; a passage must hold most of the question's weight (less for a long question); fresher first on a tie
export function search(q, docs, n = 8) {
  // « sur 15 jours », « depuis 2 semaines », « ce mois » : only the passages of that span (the owner, 25 Nov. 2026)
  const span = norm(q).match(/(\d+)\s*(jours?|j\b|semaines?|mois|days?|weeks?|months?)/);
  if (span) {
    const k = +span[1] * (/^(sem|week)/.test(span[2]) ? 7 : /^(mois|month)/.test(span[2]) ? 30 : 1);
    const from = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
    docs = docs.filter(d => !d.date || d.date >= from);
    q = norm(q).replace(span[0], ' ');
  }
  const has = w => docs.some(d => d._all.has(w));
  // a typo (« jurifdique ») is read as the nearest known word; a word no passage holds is left out rather than sinking
  // the whole question
  const fix = w => has(w) || SYN[w] ? w : (Object.keys(SYN).find(k => k.length > 4 && k.slice(0, 4) === w.slice(0, 4) && near(k, w)) || null);
  const raw = terms(q).filter(w => !/^\d{1,2}$/.test(w) || /cal|y\+|m\+/.test(norm(q))).map(fix).filter(Boolean); if (!raw.length) return [];
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
  });
  // most of the question's weight first; a long natural question rarely has it all in one passage: then 45 %, then 30 %
  // (at least three passages, the model says itself when they do not answer)
  let best = [];
  for (const share of [0.6, 0.45, 0.3]) {
    best = scored.filter(x => x.got >= share * total && x.s > 0);
    if (best.length >= 3) break;
  }
  best.sort((a, b) => b.s - a.s || (b.d.date || '').localeCompare(a.d.date || ''));
  return best.slice(0, n).map(x => { const { _ti, _tx, _all, _flat, ...d } = x.d; return d; });
}

// ── the question read by the model first (the owner, 25 Nov. 2026: « flexible et intelligente », no list of words known in
//    advance): what to look for, in French and English, over which span and in which kind of content ──
const PLAN = `Tu prépares une recherche dans la veille de PowerKlock (électricité, gaz, carbone, renouvelables, stockage, réseaux,
régulation, en France et en Europe). Les contenus sont des titres et résumés d'articles, de textes officiels (arrêtés, décrets,
délibérations de la CRE, directives), de consultations publiques, de publications et d'analyses de marché PowerKlock.
Lis la question et réponds en JSON seulement :
{"terms": [12 à 20 mots ou expressions courtes, en français ET en anglais, qu'on trouverait dans les titres ou résumés des contenus
qui répondent : les notions de la question, leurs synonymes et termes techniques, les acteurs et institutions concernés (CRE, RTE,
EDF, ministère, Commission européenne…), les sigles (PPA, CfD, TURPE, ARENH…)],
 "days": <le nombre de jours si la question donne une période (« 15 jours » : 15, « ce mois » : 30, « cette semaine » : 7), sinon null>,
 "kinds": [parmi "officiel", "consultation", "article", "recherche", "analyse" ; [] si tous ; « juridique » ou « réglementaire » :
 ["officiel", "consultation", "article"]],
 "summary": <true si la question demande un résumé, un point, une synthèse ou « ce qui s'est passé » sur une période ou un thème>}`;
const PLAN_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const KIND = { officiel: ['texte officiel'], consultation: ['consultation'], article: ['article', 'rapport'], recherche: ['publication scientifique', 'rapport'],
  analyse: ['analyse PowerKlock', 'données de marché PowerKlock'] };

export function readPlan(txt) {
  try {
    const o = typeof txt === 'object' ? txt : JSON.parse((String(txt).match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const terms_ = (Array.isArray(o.terms) ? o.terms : []).map(t => String(t).trim()).filter(t => t.length > 1).slice(0, 24);
    const days = Number.isFinite(+o.days) && +o.days > 0 ? Math.min(400, Math.round(+o.days)) : null;
    const kinds = (Array.isArray(o.kinds) ? o.kinds : []).map(k => norm(k).trim()).filter(k => KIND[k]);
    return terms_.length || days ? { terms: terms_, days, kinds, summary: !!o.summary } : null;
  } catch { return null; }
}

// the passages for a plan: each of its terms counts by its rarity, in the title three times more than in the text; no share
// of the question to reach (the model chose the terms); a summary of a span or a kind of content also takes the newest
// passages of that span and kind, so « what happened in law over 15 days » sees every text of the 15 days
export function planSearch(plan, docs, n = 10) {
  if (plan.days) { const from = new Date(Date.now() - plan.days * 864e5).toISOString().slice(0, 10); docs = docs.filter(d => !d.date || d.date >= from); }
  if (plan.kinds.length) { const ok = new Set(plan.kinds.flatMap(k => KIND[k])); docs = docs.filter(d => ok.has(d.kind)); }
  const groups = plan.terms.map(t => words(t).filter(w => w.length > 1 && !STOP2.has(w))).filter(g => g.length);
  const N = docs.length || 1, idf = w => Math.log(1 + N / (1 + docs.reduce((c, d) => c + (d._all.has(w) ? 1 : 0), 0)));
  const gw = groups.map(g => Math.max(...g.map(idf)));
  const scored = docs.map(d => {
    let s = 0;
    groups.forEach((g, k) => {
      const ph = ' ' + g.join(' ') + ' ';
      const inT = g.length > 1 ? (' ' + d._ti.join(' ') + ' ').includes(ph) : d._ti.includes(g[0]);
      const inX = g.length > 1 ? (' ' + d._tx.join(' ') + ' ').includes(ph) : d._tx.includes(g[0]);
      if (inT || inX) s += gw[k] * ((inT ? 3 : 0) + (inX ? 1 : 0));
    });
    // our own analysis and the day's prices explain a market move better than one article: a little ahead on a tie
    if (/PowerKlock/.test(d.kind)) s *= 1.6;
    return { d, s };
  });
  const strip = x => { const { _ti, _tx, _all, _flat, ...d } = x.d; return d; };
  const hits = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s || (b.d.date || '').localeCompare(a.d.date || ''));
  let out = hits.slice(0, n);
  if (plan.summary && (plan.days || plan.kinds.length) && out.length < n) {
    const have = new Set(out.map(x => x.d.link));
    out = out.concat(scored.filter(x => !have.has(x.d.link)).sort((a, b) => (b.d.date || '').localeCompare(a.d.date || '')).slice(0, n - out.length));
  }
  return out.map(strip);
}

const SYSTEM = `Tu es l'assistant de veille de PowerKlock (marché français et européen de l'électricité), pour des directeurs du secteur.
Tu reçois une question et des passages numérotés tirés du site (articles, textes officiels, consultations, analyses PowerKlock).
Réponds dans la langue de la question, uniquement à partir de ces passages : 2 à 5 phrases claires pour une question précise ;
pour un résumé ou un point sur une période, 6 à 12 phrases regroupées par thème, les plus importantes d'abord. Chaque phrase finit par le
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

// ── POST /share: a LinkedIn post sent from the phone's share sheet without leaving LinkedIn (the owner, 26 Nov. 2026;
//    warehouse migration 044). The shortcut sends the post's link (alone, or inside the text LinkedIn shares) and a
//    note, with the reader's personal send key as « Authorization: Bearer pks_… ». public.share_post() checks the key
//    (an approved account, 50 posts a day), keeps only a LinkedIn link without its tracking part, and adds it to News ›
//    LinkedIn posts in the key owner's name: the link, the author read from the link, the note; never the post's text.
//    The answer is a short French sentence the shortcut shows as its notification.
const linkedinAuthor = url => { const m = url.match(/linkedin\.com\/(?:posts|in)\/([a-z0-9-]+?)(?:-[0-9a-z]*\d[0-9a-z]*)?(?:_|\/|$)/i);
  return m ? m[1].split('-').filter(w => !/\d/.test(w)).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : ''; };
async function unshorten(u) {
  try {
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (PowerKlock share)' } });
    const loc = r.headers.get('Location');
    const page = loc || await r.text();   // lnkd.in answers a redirect, or a small page that names the address
    return (String(page).match(/https:\/\/([a-z]+\.)?linkedin\.com\/[^\s"'<>]+/i) || [])[0] || null;
  } catch { return null; }
}
async function share(req, env) {
  const text = (msg, status = 200) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (req.method !== 'POST') return text('Envoyez le post avec POST.', 405);
  const key = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!/^pks_[0-9a-f]{48}$/.test(key)) return text('Clé d’envoi manquante ou mal copiée : recopiez-la depuis Mon compte.', 401);
  let body = {};
  const raw = await req.text();
  try { body = JSON.parse(raw); } catch { body = { url: raw }; }   // JSON {url, note}, or the shared text alone
  const all = [body.url, body.text, body.input].filter(Boolean).map(String).join(' ');
  let url = (all.match(/(?:https?:\/\/)?([a-z]+\.)?linkedin\.com\/[^\s"'<>]+/i) || [])[0];
  // the LinkedIn app often shares a short link (lnkd.in/…): follow it to the post's own address
  const short = !url && (all.match(/(?:https?:\/\/)?lnkd\.in\/[A-Za-z0-9_-]+/i) || [])[0];
  if (short) url = await unshorten(short.replace(/^(?!https?:)/, 'https://'));
  if (url && !/^https:/i.test(url)) url = 'https://' + url.replace(/^http:\/\//i, '');
  // what arrived, in the message, so a failed share says what the phone sent (its first 90 characters, no key)
  if (!url) return text(`Pas de lien LinkedIn dans ce partage (reçu : « ${all.replace(/\s+/g, ' ').trim().slice(0, 90) || 'rien'} »).`, 400);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/share_post`, {
    method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: key, p_url: url, p_author: linkedinAuthor(url) || null, p_note: String(body.note || '').slice(0, 200) || null }) });
  const j = r.ok ? await r.json() : { ok: false, reason: 'database ' + r.status };
  if (j.ok) return text(j.already ? 'Déjà dans PowerKlock ✓' : 'Ajouté à PowerKlock ✓');
  const why = { 'unknown key': 'Clé d’envoi inconnue : elle a peut-être été remplacée. Recopiez-la depuis Mon compte.', 'not approved': 'Votre compte attend validation.',
    quota: '50 posts envoyés aujourd’hui : la suite demain.', 'not a linkedin link': 'Ce n’est pas un lien LinkedIn.' }[j.reason];
  return text(why || 'Pas enregistré pour l’instant : réessayez plus tard.', j.reason === 'quota' ? 429 : 400);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (new URL(req.url).pathname === '/share') return share(req, env);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply(req, { error: 'signed out' }, 401);
    if (req.method === 'GET') return reply(req, await db(env, 'ask_left', token));   // the questions left today, for the counter
    if (req.method !== 'POST') return reply(req, { error: 'method' }, 405);
    let q = '';
    try { q = String((await req.json()).q || '').trim().slice(0, 300); } catch { /* empty question */ }
    if (q.length < 3) return reply(req, { error: 'empty' }, 400);
    const site = env.SITE || 'https://www.powerklock.com';
    const [news, cons, letter, digest] = await Promise.all(['news.json', 'consultations.json', 'newsletter.json', 'market_digest.json'].map(f => json(`${site}/data/${f}`).catch(() => null)));
    // the whole archive (news.article, the search engine of News › Archives): the articles that hold any of the
    // question's words, ranked here with the rest of the site's content
    // 1. the model reads the question: terms (French and English), span, kind of content, summary or not
    let plan = null;
    try {
      const r = await env.AI.run(PLAN_MODEL, { messages: [{ role: 'system', content: PLAN }, { role: 'user', content: q }], max_tokens: 400 });
      plan = readPlan(typeof r === 'string' ? r : (r.response ?? ''));
    } catch { /* the words of the question alone */ }
    let archive = [];
    try {
      // the words as typed and the model's terms (the archive's index keeps accents), without the empty ones; prefixes find the plurals
      const typed = [...new Set((q + ' ' + (plan ? plan.terms.join(' ') : '')).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOP2.has(norm(w))))].slice(0, 40).join(' ');
      const a = await db(env, 'news_search', token, { p_query: typed, p_any: true, p_limit: 120 });
      archive = ((a && a.items) || []).map(i => ({ link: i.link, title: i.title, snippet: i.summary || '', source: i.source, date: i.date,
        tags: [i.kind === 'official' ? 'official' : i.kind === 'research' ? 'research' : i.kind === 'report' ? 'report' : 'article'], topics: i.topics || [] }));
    } catch { /* the files alone */ }
    const seen = new Set(((news && news.items) || []).map(i => i.link));
    const all = { items: ((news && news.items) || []).concat(archive.filter(i => !seen.has(i.link))) };
    const docs = passages(all, cons, letter, digest);
    // 2. the passages the model's plan points to, else those holding the question's own words
    let found = plan ? planSearch(plan, docs, plan.summary ? 25 : 10) : [];
    if (!found.length) found = search(q, docs);
    // a question the site has nothing on costs no question and no AI
    if (!found.length) return reply(req, { answer: null, sources: [], none: true });
    const take = await db(env, 'ask_take', token);
    if (!take.ok) return reply(req, { error: take.reason || 'refused', left: take.left }, take.reason === 'quota' || take.reason === 'day' ? 429 : 403);
    const m = model((take.total || 1) - 1);
    if (!m) return reply(req, { error: 'day', left: 0 }, 429);
    const ctx = found.map((d, k) => `[${k + 1}] ${d.title} (${d.kind}, ${d.source}${d.date ? ', ' + d.date : ''})\n${(d.text || '').slice(0, found.length > 12 ? 350 : 600)}`).join('\n\n');
    let answer = null, used = [];
    try {
      const r = await env.AI.run(m, { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Question : ${q}\n\nPassages :\n${ctx}` }], max_tokens: plan && plan.summary ? 1000 : 500 });
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
