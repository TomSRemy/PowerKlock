// ════════════════════════════════════════════════════════════════════
// MARKET BRIEF and NEXT 30 DAYS (catalogue widgets, any dashboard)
//   market-brief  the week in energy markets, in the order of a broker's
//                 morning note: context (France first, written from the market
//                 notes and news, data/market_digest.json), oil, gas,
//                 carbon, power spot, power forwards — each with its move
//   next-30-days  what the coming month looks like for French power: the
//                 month-ahead forward, weather week by week against normal
//                 (temperature, wind, sun), nuclear availability, gas
//                 storage — and what each means for prices
// Data: data/history/commodities_series.json, fr_market_calchain.json,
// fr_forward_monthly.json, data/weather_outlook.json, data/market_digest.json,
// data/history/daily (spot), all already on the site.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const cache = {};
  const get = p => cache[p] || (cache[p] = fetch(DATA_BASE + p).then(r => r.ok ? r.json() : null).catch(() => null));
  const esc = PK.esc;   // js/pk-core.js
  const sg = (v, d = 1) => v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  const pct = (a, b) => a != null && b ? (a / b - 1) * 100 : null;
  const iso = d => d.toISOString().slice(0, 10);
  const back = (pts, days) => { if (!pts || !pts.length) return null; const t = new Date(pts[pts.length - 1][0] + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - days); const k = iso(t); let v = null; for (const [d, x] of pts) { if (d <= k) v = x; else break; } return v; };
  const last = pts => pts && pts.length ? pts[pts.length - 1] : null;
  const word = (v, up, down, flat = 'stable', eps = 0.5) => v == null ? '' : Math.abs(v) < eps ? flat : v > 0 ? up : down;
  const css = `
  .mb{display:flex;flex-direction:column;gap:9px;font-size:12.5px;line-height:1.5;color:var(--text2)}
  .mb-sec{display:grid;grid-template-columns:22px 1fr;gap:2px 8px;align-items:baseline;padding-bottom:8px;border-bottom:1px solid var(--border)}
  .mb-sec:last-child{border-bottom:0}
  .mb-ic{font-size:14px;text-align:center} .mb-h{font:600 12.5px 'Outfit',sans-serif;color:var(--text)} .mb-h b{color:var(--accent);font-weight:600}
  .mb-t{grid-column:2} .mb-t ul{margin:2px 0 0 14px;padding:0} .mb-t li{margin-bottom:2px}
  .mb-up{color:var(--down)} .mb-dn{color:var(--up)}
  .mb-wk{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4px}
  .mb-wk>div{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:11.5px}
  .mb-wk b{display:block;font-size:10.5px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.05em}
  .mb-note{font-size:11px;color:var(--text3)}
  @media (max-width:700px){.mb-wk{grid-template-columns:repeat(2,1fr)}}`;
  if (!document.getElementById('mb-css')) { const s = document.createElement('style'); s.id = 'mb-css'; s.textContent = css; document.head.appendChild(s); }
  const cls = v => v == null ? '' : v >= 0 ? 'mb-up' : 'mb-dn';   // a price up is shown in red, as on the forward tables
  const sec = (ic, head, body) => `<div class="mb-sec"><span class="mb-ic">${ic}</span><div class="mb-h">${head}</div><div class="mb-t">${body}</div></div>`;

  // ── the week, in French: shared pieces (chips, mini-curves, the tone of the market notes received)
  const css2 = `
  .wk{display:flex;flex-direction:column;gap:10px;font-size:12.5px;line-height:1.45;color:var(--text2)}
  .wk-sp{display:block;width:100%;height:24px;margin-top:3px}
  .wk-up{color:var(--down)} .wk-dn{color:var(--up)} .wk-fl{color:var(--text3)}
  .wk-chip{display:inline-block;font:600 10.5px 'JetBrains Mono',monospace;border-radius:4px;padding:1px 6px;white-space:nowrap}
  .wk-chip.wk-up{background:rgba(237,105,101,.14)} .wk-chip.wk-dn{background:rgba(20,211,169,.14)} .wk-chip.wk-fl{background:rgba(122,147,171,.14)}
  .wk-l{display:block} .wk-l b{color:var(--text);font-weight:600}
  .wk-n{font-size:11.5px;color:var(--text3)} .wk-n b{font-weight:600} .wk-ok{color:var(--accent)} .wk-ko{color:#fbbf24}
  .wk-foot{font-size:11px;color:var(--text3)}`;
  if (!document.getElementById('wk-css')) { const s = document.createElement('style'); s.id = 'wk-css'; s.textContent = css2; document.head.appendChild(s); }
  const fr = (v, d = 1) => v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d).replace('.', ',');
  const nf = (v, d = 2) => v == null ? '–' : v.toFixed(d).replace('.', ',');
  const wc = (v, eps = 0.5) => v == null || Math.abs(v) < eps ? 'wk-fl' : v > 0 ? 'wk-up' : 'wk-dn';
  const arrow = (v, eps = 0.5) => v == null || Math.abs(v) < eps ? '→' : v > 0 ? '↑' : '↓';
  function spark(pts, c) {
    const s = pts.map(p => p[1]).filter(v => v != null); if (s.length < 2) return '';
    const W = 100, H = 24, lo = Math.min(...s), hi = Math.max(...s), sx = W / (s.length - 1), sy = v => H - 2 - (v - lo) / ((hi - lo) || 1) * (H - 4);
    const d = s.map((v, i) => (i ? 'L' : 'M') + (i * sx).toFixed(1) + ' ' + sy(v).toFixed(1)).join(' ');
    const col = c === 'wk-up' ? 'var(--down)' : c === 'wk-dn' ? 'var(--up)' : 'var(--text3)';
    return `<svg class="wk-sp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L ${W} ${H} L 0 ${H} Z" fill="${col}" fill-opacity=".12"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const since = (pts, days) => { if (!pts.length) return []; const t = new Date(pts[pts.length - 1][0] + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - days); const k = iso(t); return pts.filter(p => p[0] >= k); };
  // where the price sits in its 60-day range, in words
  const range = pts => { const s = since(pts, 60).map(p => p[1]); if (s.length < 10) return ''; const v = s[s.length - 1], lo = Math.min(...s), hi = Math.max(...s);
    return v >= hi - 1e-9 ? ', au plus haut sur 60 jours' : v <= lo + 1e-9 ? ', au plus bas sur 60 jours' : (v - lo) / ((hi - lo) || 1) > 0.85 ? ', près du plus haut sur 60 jours' : (v - lo) / ((hi - lo) || 1) < 0.15 ? ', près du plus bas sur 60 jours' : ''; };
  // the market notes received in the last 10 days (signed-in users only for the e-mailed one; the daily report is public):
  // per market, the tone of what each said — never their text, only rising / easing / neutral
  const UPW = /\b(tight\w*|tense|tension\w*|ris(e|es|ing)|higher|increas\w*|support\w*|firm\w*|bullish|pressure\w*|spik\w*|jump\w*|surg\w*|climb\w*|strong\w*|gain\w*|deteriorat\w*|disrupt\w*|risk\w*)\b/gi;
  const DNW = /\b(eas(e|es|ed|ing)|fall\w*|fell|lower\w*|declin\w*|drop\w*|bearish|weak\w*|loosen\w*|relief|soft\w*|improv\w*|calm\w*|resilient|ample|comfortable|down\w*)\b/gi;
  const tone = t => (String(t).match(UPW) || []).length - (String(t).match(DNW) || []).length;
  async function notes() {
    const out = { ctx: [], brent: [], ttf: [], eua: [], cal: [] }, add = (name, txt) => {
      const n = String(name).toLowerCase(), k = /context|macro|geopol/.test(n) ? 'ctx' : /oil|brent/.test(n) ? 'brent' : /gas/.test(n) ? 'ttf' : /co2|co₂|carbon/.test(n) ? 'eua' : /electric|power/.test(n) ? 'cal' : null;
      if (k && txt) out[k].push(tone(txt)); };
    try { const fm = await get('fr_market.json'), mi = fm && fm.marketInsights, d = (fm && (fm.marketInsightsDate || fm.lastUpdate) || '').slice(0, 10);
      if (mi && d && Date.now() - Date.parse(d) < 10 * 864e5) { const plain = h => String(h || '').replace(/<[^>]+>/g, ' '); add('gas', plain(mi.gas)); add('power', plain(mi.power)); } } catch (_) {}
    try { const cl = window.PKAccount && PKAccount.user && PKAccount.client && PKAccount.client();
      if (cl) { const r = await cl.from('market_note').select('note_date, sections').order('note_date', { ascending: false }).limit(1), n = r.data && r.data[0];
        if (n && Date.now() - Date.parse(n.note_date) < 10 * 864e5) (n.sections || []).forEach(x => add(x.name, (x.headline || '') + ' ' + (x.points || []).join(' '))); } } catch (_) {}
    return out;
  }
  // the right-hand column: what the notes said against what the price did
  function verdict(tones, move, isCtx) {
    if (!tones || !tones.length) return '<span class="wk-n">pas de commentaire d’analyste reçu cette semaine</span>';
    const up = tones.filter(t => t > 0).length, dn = tones.filter(t => t < 0).length;
    if (isCtx) return `<span class="wk-n">les analystes voient un risque ${up > dn ? '<b class="wk-up">haussier</b>' : dn > up ? '<b class="wk-dn">baissier</b>' : 'équilibré'} pour les prix</span>`;
    const exp = up && dn ? 'avis partagés' : up ? 'hausse attendue' : dn ? 'baisse attendue' : 'pas de sens annoncé';
    if ((up && dn) || (!up && !dn) || move == null || Math.abs(move) < 0.5) return `<span class="wk-n">Analystes : ${exp} · prix ${move == null ? '–' : fr(move) + ' % sur 7 jours'}</span>`;
    const ok = (up > 0) === (move > 0);
    return `<span class="wk-n"><b class="${ok ? 'wk-ok' : 'wk-ko'}">${ok ? '✓ vu juste' : '✗ raté'}</b> · analystes : ${exp} ; le prix a fait ${fr(move)} % sur 7 jours</span>`;
  }


  // ── What moved and why: per market, the trend for the week ahead (bubble + its source), what happened and why, without
  //    the levels the tiles above already show; then whether the market notes' calls came true (data/history/digest_outlook.json)
  const css3 = `
  .why3{display:flex;flex-direction:column;font-size:13px;line-height:1.5;color:var(--text2)}
  .why3-r{display:grid;grid-template-columns:130px minmax(0,1fr);gap:14px;padding:8px 0;border-bottom:1px solid var(--border);align-items:baseline}
  .why3-r:last-of-type{border-bottom:0}
  .why3-k{display:flex;flex-direction:column;align-items:flex-start;gap:4px;font:600 11px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--text)}
  .why3-k .wk-chip{text-transform:none;letter-spacing:0}
  .why3-k .why3-src{text-transform:none;letter-spacing:0;font-family:Inter,sans-serif;font-weight:400;margin-top:0}
  .why3-b .wk-chip{font-size:10.5px} .why3-src{display:block;font-size:10px;color:var(--text3);margin-top:2px}
  .why3 b{color:var(--text);font-weight:600}
  .why3-line{display:block} .why3-line+.why3-line{margin-top:4px}
  .why4{gap:12px}
  .why4-ctx{border:1px solid var(--border);border-radius:10px;padding:10px 14px;background:var(--bg3, rgba(255,255,255,.02));display:grid;gap:6px;color:var(--text)}
  .why4-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .why4-h .why3-src{margin:0}
  .why4-n{font:600 11px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--text)}
  .why4-t .why4-h .wk-chip{margin-left:auto}
  .why4-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:10px;align-items:stretch}
  .why4-t{border:1px solid var(--border);border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:6px;min-width:0}
  .why4-v{font-size:17px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums}
  .why4-v small{font-size:11.5px;font-weight:500;color:var(--text3);margin-left:6px}
  .why4-x{flex:1}
  .why4-next{margin-top:auto;min-height:5.4em;font-size:12px;line-height:1.45;color:var(--text2);background:var(--bg3, rgba(255,255,255,.03));border-radius:8px;padding:7px 9px}
  .why4-next.none{color:var(--text3);font-style:italic}
  .why4-t > .why3-src{margin-top:2px}
  .why3-next{display:block;font-size:12px;color:var(--text3);margin-top:8px;padding-top:6px;border-top:1px dashed var(--border, rgba(255,255,255,.08))} .why3-next b{color:var(--text2)}
  .why3-an{margin-top:8px;background:var(--bg3);border-radius:8px;padding:8px 12px;font-size:12.5px} .why3-an .wk-ok{color:var(--accent)} .why3-an .wk-ko{color:#fbbf24}
  @media (max-width:700px){.why3-r{grid-template-columns:1fr;gap:3px}.why3-k{flex-direction:row;align-items:center;flex-wrap:wrap}}`;
  if (!document.getElementById('why3-css')) { const st = document.createElement('style'); st.id = 'why3-css'; st.textContent = css3; document.head.appendChild(st); }
  const isFr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const T = (fr, en) => isFr() ? fr : en;
  const n1 = (v, d = 1) => v == null || !isFinite(v) ? '–' : v.toFixed(d);   // js/i18n.js writes it the French way
  const s1 = (v, d = 1) => v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  const pos60 = pts => { const s = since(pts, 60).map(p => p[1]); if (s.length < 10) return null; const v = s[s.length - 1], lo = Math.min(...s), hi = Math.max(...s), r = (v - lo) / ((hi - lo) || 1);
    return v >= hi - 1e-9 ? T('au plus haut sur 60 jours', 'at a 60-day high') : v <= lo + 1e-9 ? T('au plus bas sur 60 jours', 'at a 60-day low') : r > 0.85 ? T('près du plus haut sur 60 jours', 'near its 60-day high') : r < 0.15 ? T('près du plus bas sur 60 jours', 'near its 60-day low') : null; };
  const wk = pts => { const l = last(pts); return l ? pct(l[1], back(pts, 7)) : null; };
  const goCsv = () => cache.go || (cache.go = fetch(DATA_BASE + 'go_prices.csv').then(r => r.ok ? r.text() : '').catch(() => ''));
  function goSeries(txt, year) {
    const rows = txt.trim().split(/\r?\n/), head = (rows.shift() || '').split(','), ix = k => head.indexOf(k);
    return rows.map(l => l.split(',')).filter(c => c[ix('product')] === 'GO AIB Renewable' && c[ix('year')] === String(year)).map(c => {
      const b = parseFloat(c[ix('bid')]), a = parseFloat(c[ix('ask')]); return [c[ix('mail_date')], isFinite(b) && isFinite(a) ? (a + b) / 2 : isFinite(b) ? b : isFinite(a) ? a : null]; })
      .filter(x => x[1] != null).sort((x, y) => x[0].localeCompare(y[0]));
  }

  async function brief(host) {
    const [cs, chain, sum, nt, dg, hist, go, auct] = await Promise.all([get('history/commodities_series.json'), get('history/fr_market_calchain.json'),
      window.pkSummary ? window.pkSummary().catch(() => null) : null, notes(), get('market_digest.json'), get('history/digest_outlook.json'), goCsv(), get('go_auctions.json')]);
    const S = cs && cs.series || {}, P = k => (S[k] || {}).points || [];
    const fresh = dg && Date.now() - Date.parse(dg.updated) < 5 * 864e5, ctxT = fresh ? (dg.context || []) : [], OL = fresh ? (dg.outlook || {}) : {};
    const NOTE = T('notes de marché', 'market notes'), PRICE = T('tendance des prix', 'price trend');
    const chip = t => `<span class="wk-chip ${t === 'up' ? 'wk-up' : t === 'down' ? 'wk-dn' : 'wk-fl'}">${t === 'up' ? '↑ ' + T('haussier', 'bullish') : t === 'down' ? '↓ ' + T('baissier', 'bearish') : '→ ' + T('neutre', 'neutral')}</span>`;
    const byPrice = c => c == null || Math.abs(c) < 1 ? 'flat' : c > 0 ? 'up' : 'down';
    const txt = o => { if (!o) return ''; const t = String((isFr() ? o.text : (o.text_en || o.text)) || '').replace(/\.?\s*$/, '.'); return esc(t.charAt(0).toUpperCase() + t.slice(1)); };
    // the bubble: the notes' call for the week ahead when there is one, else the direction prices took over 7 days
    const look = (key, tones, move) => { const o = OL[key];
      if (o && o.tone) return [o.tone, NOTE, o];
      const up = (tones || []).filter(x => x > 0).length, dn = (tones || []).filter(x => x < 0).length;
      if (up || dn) return [up > dn ? 'up' : dn > up ? 'down' : 'flat', NOTE, null];
      return [byPrice(move), PRICE, null]; };
    const R = [];   // [label, [tone, source, outlook], text]
    if (ctxT.length) { const u = ctxT.filter(c => c.tone === 'up').length - ctxT.filter(c => c.tone === 'down').length;
      R.push([T('Contexte', 'Context'), [u > 0 ? 'up' : u < 0 ? 'down' : 'flat', NOTE, null],
        ctxT.map(c => `<span class="why3-line"><b>${esc(isFr() ? c.topic : (c.topic_en || c.topic))}</b> : ${esc(String((isFr() ? c.text : (c.text_en || c.text)) || '').replace(/\.?\s*$/, '.'))}</span>`).join('')]); }
    // power: the next calendar year against what gas alone would add, the two following years, the spot's direction
    const yrs = chain && chain.FR && chain.FR.years, ys = yrs ? Object.keys(yrs).sort().slice(0, 3) : [];
    if (ys.length) {
      const pts = y => yrs[y].dates.map((d, i) => [d, yrs[y].values[i]]), p1 = pts(ys[0]), l = last(p1), w0 = back(p1, 7), dFR = w0 != null ? l[1] - w0 : null;
      const ty = cs && cs.calYears && cs.calYears.ttf && cs.calYears.ttf[ys[0]], tP = ty ? ty.dates.map((d, i) => [d, ty.values[i]]) : null, dT = tP ? last(tP)[1] - back(tP, 7) : null, gas = dT != null ? dT * 2 : null;
      const parts = [];
      if (gas != null && dFR != null) parts.push(T(`Sur le Cal ${ys[0]}, le gaz seul pèserait <b>≈ ${s1(gas)} €</b> sur la semaine : `, `On Cal ${ys[0]}, gas alone would weigh <b>≈ ${s1(gas)} €</b> on the week: `) +
        (Math.abs(dFR - gas) < 1 ? T('le mouvement français vient du gaz.', 'the French move comes from gas.') : dFR - gas > 0 ? T('la France monte plus que le gaz seul (nucléaire, demande).', 'France rises more than gas alone (nuclear, demand).') : T('la France monte moins que le gaz seul (nucléaire et demande détendus).', 'France rises less than gas alone (nuclear and demand relaxed).')));
      if (ys.length > 1) { const w1 = wk(p1), wl = ys.slice(1).map(y => wk(pts(y))).filter(v => v != null);
        if (wl.length && w1 != null) parts.push(Math.max(...wl.map(Math.abs)) < Math.abs(w1) / 2 ? T(`Les années ${ys.slice(1).join(' et ')} bougent beaucoup moins.`, `${ys.slice(1).join(' and ')} move much less.`) : T(`Les années ${ys.slice(1).join(' et ')} suivent.`, `${ys.slice(1).join(' and ')} follow.`)); }
      const sp = ((sum && sum.zones && sum.zones.FR) || []).filter(r => r.avg != null), a7 = sp.slice(-7), b7 = sp.slice(-14, -7);
      if (a7.length && b7.length) { const m = a7.reduce((x, r) => x + r.avg, 0) / a7.length, mb = b7.reduce((x, r) => x + r.avg, 0) / b7.length;
        parts.push(m < mb * 0.9 ? T('Le spot recule sur la semaine.', 'Spot eases over the week.') : m > mb * 1.1 ? T('Le spot monte sur la semaine.', 'Spot rises over the week.') : T('Le spot reste stable sur la semaine.', 'Spot holds over the week.')); }
      R.push([T('Électricité', 'Power'), look('power', nt.cal, wk(p1)), parts.join(' '), `Cal ${String(ys[0]).slice(2)} ${n1(l[1])} €<small>${s1(wk(p1))} % ${T('sur 7 j', 'on 7 d')}</small>`]);
    }
    // French nuclear: available now, against the operator's forecast, a week and a year ago (less nuclear = more gas called)
    const nu = P('fr_nuc_avail'), nl = last(nu), nf = last(P('fr_nuc_avail_fc'));
    if (nl) { const w = back(nu, 7), yb = back(nu, 365), gw = v => n1(v / 1000), parts = [];
      parts.push(T(`Disponible <b>${gw(nl[1])} GW</b>`, `Available <b>${gw(nl[1])} GW</b>`) + (w != null ? T(` (${s1((nl[1] - w) / 1000)} GW sur la semaine`, ` (${s1((nl[1] - w) / 1000)} GW on the week`) + (yb != null ? T(`, ${s1((nl[1] - yb) / 1000)} GW sur un an)`, `, ${s1((nl[1] - yb) / 1000)} GW on a year)`) : ')') : '') + '.');
      if (nf) { const gap = nl[1] - nf[1];
        parts.push(Math.abs(gap) < 1000 ? T(`En ligne avec la prévision de l’exploitant (${gw(nf[1])} GW).`, `In line with the operator’s forecast (${gw(nf[1])} GW).`)
          : gap < 0 ? T(`<b>${gw(-gap)} GW</b> sous la prévision de l’exploitant (${gw(nf[1])} GW) : plus de gaz appelé, un soutien aux prix.`, `<b>${gw(-gap)} GW</b> below the operator’s forecast (${gw(nf[1])} GW): more gas called, a support for prices.`)
          : T(`<b>${gw(gap)} GW</b> au-dessus de la prévision de l’exploitant (${gw(nf[1])} GW) : moins de gaz appelé, des prix détendus.`, `<b>${gw(gap)} GW</b> above the operator’s forecast (${gw(nf[1])} GW): less gas called, softer prices.`)); }
      const mv = w != null && w ? (nl[1] / w - 1) * 100 : null;
      // the week ahead, from the history: how availability usually moves over the next 7 days at this time of year (last 5 years),
      // and what is still missing against the operator's forecast
      const md = nl[0].slice(5), y0 = +nl[0].slice(0, 4), chg = [];
      for (let yy = y0 - 5; yy < y0; yy++) { const a = nu.find(p => p[0] >= yy + '-' + md), d7 = a && nu.find(p => p[0] >= iso(new Date(Date.parse(a[0] + 'T12:00:00Z') + 7 * 864e5))); if (a && d7 && a[1] != null && d7[1] != null) chg.push(d7[1] - a[1]); }
      const avg = chg.length >= 3 ? chg.reduce((x, y) => x + y, 0) / chg.length : null, miss = nf ? nf[1] - nl[1] : null;
      const nxt = avg == null ? null : { text: `${Math.abs(avg) < 500 ? 'à cette période, la disponibilité bouge peu d’une semaine à l’autre' : `à cette période, le nucléaire disponible ${avg > 0 ? 'gagne' : 'perd'} en moyenne ${n1(Math.abs(avg) / 1000)} GW en 7 jours (${y0 - chg.length}–${y0 - 1})`}${miss != null && miss > 1000 ? `, et ${n1(miss / 1000)} GW annoncés par l’exploitant ne sont pas encore là : leur retour pèserait sur les prix, leur retard les soutiendrait` : ''}.`,
        text_en: `${Math.abs(avg) < 500 ? 'at this time of year availability moves little from one week to the next' : `at this time of year nuclear availability ${avg > 0 ? 'gains' : 'loses'} ${n1(Math.abs(avg) / 1000)} GW in 7 days on average (${y0 - chg.length}–${y0 - 1})`}${miss != null && miss > 1000 ? `, and ${n1(miss / 1000)} GW announced by the operator are not back yet: their return would weigh on prices, a delay would support them` : ''}.` };
      R.push([T('Nucléaire', 'Nuclear'), ((l2) => [l2[0], l2[1], l2[2] || nxt])(look('nuclear', null, mv == null ? null : -mv)), parts.join(' '), `${gw(nl[1])} GW<small>${T('sur 63', 'of 63')}</small>`]); }
    const ttf = P('ttf'), st = last(P('agsi')), ly = st ? back(P('agsi'), 365) : null;
    if (ttf.length) { const ps = pos60(ttf), parts = [];
      if (ps) parts.push(T('TTF ', 'TTF ') + ps + '.');
      if (st && ly != null) parts.push(T(`Stocks UE <b>${s1(st[1] - ly)} pts</b> sur un an`, `EU storage <b>${s1(st[1] - ly)} pts</b> on a year`) + (st[1] < ly ? T(' : moins de marge pour l’hiver, un soutien aux prix.', ': less margin for winter, a support for prices.') : T(' : marge confortable pour l’hiver.', ': comfortable margin for winter.')));
      R.push([T('Gaz', 'Gas'), look('gas', nt.ttf, wk(ttf)), parts.join(' '), `TTF ${n1(last(ttf)[1])} €<small>${s1(wk(ttf))} % ${T('sur 7 j', 'on 7 d')}</small>`]); }
    const br = P('brent');
    if (br.length) { const ps = pos60(br); R.push([T('Pétrole', 'Oil'), look('oil', nt.brent, wk(br)), ps ? 'Brent ' + ps + '.' : '', `Brent ${n1(last(br)[1])} $<small>${s1(wk(br))} % ${T('sur 7 j', 'on 7 d')}</small>`]); }
    const eua = P('eua'), coal = P('coal');
    if (eua.length) { const e = last(eua), d = e[1] - (back(eua, 7) || e[1]), parts = [];
      parts.push(T(`EUA : <b>${Math.abs(d) < 0.5 ? T('effet quasi nul', '') : s1(0.37 * d) + ' €'}</b>${Math.abs(d) < 0.5 ? '' : ' sur le coût d’une centrale gaz'} sur la semaine.`, `EUA: <b>${Math.abs(d) < 0.5 ? 'almost no effect' : s1(0.37 * d) + ' €'}</b>${Math.abs(d) < 0.5 ? '' : ' on a gas plant’s cost'} over the week.`));
      const c = last(coal); if (c) { const ps = pos60(coal); parts.push(T(`Charbon API2 <b>${n1(c[1])} $/t</b> (${s1(wk(coal))} %)`, `Coal API2 <b>${n1(c[1])} $/t</b> (${s1(wk(coal))} %)`) + (ps ? ', ' + ps : '') + '.'); }
      R.push([T('Carbone, charbon', 'Carbon, coal'), look('carbon', nt.eua, wk(eua)), parts.join(' '), `EUA ${n1(e[1])} €<small>${s1(wk(eua))} % ${T('sur 7 j', 'on 7 d')}</small>`]); }
    const val0 = a => { const bt = a.by_technology || [], v = bt.reduce((x, r) => x + (r.allocated_mwh || 0), 0); return v ? bt.reduce((x, r) => x + (r.allocated_mwh || 0) * (r.price_eur_mwh || 0), 0) / v : null; };
    if (go) {
      const y = new Date().getUTCFullYear(), g = goSeries(go, y + 1), parts = [];
      // broker prices (weekly mid), the production years quoted
      const yrsGo = [y, y + 1, y + 2].map(yy => [yy, goSeries(go, yy)]).filter(x => x[1].length);
      if (yrsGo.length) parts.push(T('Courtier : ', 'Broker: ') + yrsGo.map(([yy, s]) => { const l = s[s.length - 1], p = s.length > 1 ? s[s.length - 2][1] : null; return `Cal ${String(yy).slice(2)} <b>${n1(l[1], 3)} €/MWh</b>${p != null ? ' (' + s1(l[1] - p, 3) + ')' : ''}`; }).join(' · ') + T(' sur la semaine.', ' on the week.'));
      if (g.length > 2) { let k = 0; const sgn = Math.sign(g[g.length - 1][1] - g[g.length - 2][1]); for (let i = g.length - 1; i > 0 && Math.sign(g[i][1] - g[i - 1][1]) === sgn && sgn; i--) k++;
        if (sgn) parts.push(T(`${k} semaine${k > 1 ? 's' : ''} de ${sgn < 0 ? 'baisse' : 'hausse'} sur le Cal ${y + 1}.`, `${k} week${k > 1 ? 's' : ''} ${sgn < 0 ? 'down' : 'up'} on Cal ${y + 1}.`)); }
      const a = auct && Array.isArray(auct.auctions) && auct.auctions[auct.auctions.length - 1];
      if (a) { const bt = a.by_technology || [], vol = bt.reduce((x, r) => x + (r.allocated_mwh || 0), 0), val = bt.reduce((x, r) => x + (r.allocated_mwh || 0) * (r.price_eur_mwh || 0), 0);
        if (vol) parts.push(T(`Enchère GO France (${a.auction_month}) : <b>${n1(val / vol, 3)} €/MWh</b> sur ${n1(vol / 1e6, 2)} TWh.`, `France GO auction (${a.auction_month}): <b>${n1(val / vol, 3)} €/MWh</b> on ${n1(vol / 1e6, 2)} TWh.`)); }
      const c4 = g.length > 4 ? (g[g.length - 1][1] / g[g.length - 5][1] - 1) * 100 : null;
      // the week ahead for GO: the broker trend over 4 weeks and the next French state auction (EEX, monthly)
      const nm = new Date(); nm.setUTCMonth(nm.getUTCMonth() + 1); const mo = nm.toLocaleDateString(isFr() ? 'fr-FR' : 'en-GB', { month: 'long', timeZone: 'UTC' });
      const goNext = { text: `${c4 == null ? '' : Math.abs(c4) < 2 ? 'prix courtier stable sur 4 semaines' : `prix courtier ${c4 > 0 ? 'en hausse' : 'en baisse'} de ${n1(Math.abs(c4))} % sur 4 semaines`}${a ? `${c4 == null ? '' : ' ; '}prochaine enchère d’État française en ${mo} (dernière : ${n1(val0(a), 3)} €/MWh), un repère pour le marché` : ''}.`,
        text_en: `${c4 == null ? '' : Math.abs(c4) < 2 ? 'broker price flat over 4 weeks' : `broker price ${c4 > 0 ? 'up' : 'down'} ${n1(Math.abs(c4))} % over 4 weeks`}${a ? `${c4 == null ? '' : '; '}next French state auction in ${mo} (last: ${n1(val0(a), 3)} €/MWh), a reference for the market` : ''}.` };
      if (parts.length) R.push(['GO', [byPrice(c4), PRICE, goNext], parts.map(x => `<span class="why3-line">${x}</span>`).join(''), g.length ? `Cal ${String(y + 1).slice(2)} ${n1(g[g.length - 1][1], 3)} €<small>${g.length > 1 ? s1(g[g.length - 1][1] - g[g.length - 2][1], 3) + ' ' + T('sur la sem.', 'on the week') : ''}</small>` : '']);   // one fact per line
    }
    if (!R.length) { host.innerHTML = `<div class="fuel-note">${T('Données de marché indisponibles.', 'Market data not available.')}</div>`; return; }
    // the notes' record: each day's call against what the price did over the following 7 days (right: up and +1 % or more,
    // down and −1 % or less, flat and within ±2 %), one call per week
    let an = '';
    const H = hist || {}, MK = { oil: P('brent'), gas: ttf, carbon: eua, power: ys.length ? yrs[ys[0]].dates.map((d, i) => [d, yrs[ys[0]].values[i]]) : [] };
    const after = (pts, d, days) => { const i = pts.findIndex(p => p[0] >= d); if (i < 0) return null; const t0 = new Date(d + 'T12:00:00Z'); t0.setUTCDate(t0.getUTCDate() + days); const k = iso(t0); const j = pts.findIndex(p => p[0] >= k); return j < 0 ? null : (pts[j][1] / pts[i][1] - 1) * 100; };
    const weeks = {}; Object.keys(H).sort().forEach(d => { const t0 = new Date(d + 'T12:00:00Z'); weeks[t0.getUTCFullYear() + '-' + Math.floor((t0 - Date.UTC(t0.getUTCFullYear(), 0, 1)) / 6048e5)] = d; });
    let ok = 0, all = 0, lastLine = '';
    Object.values(weeks).forEach(d => Object.entries(H[d]).forEach(([m, tone]) => { const c = MK[m] && after(MK[m], d, 7); if (c == null) return;
      const right = tone === 'up' ? c >= 1 : tone === 'down' ? c <= -1 : Math.abs(c) <= 2; all++; if (right) ok++;
      lastLine = T(`le ${new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${{ oil: 'pétrole', gas: 'gaz', power: 'électricité', carbon: 'carbone' }[m]} ${tone === 'up' ? 'en hausse' : tone === 'down' ? 'en baisse' : 'stable'} : <b class="${right ? 'wk-ok' : 'wk-ko'}">${right ? '✓ vu juste' : '✗ raté'}</b> (${s1(c)} %)`,
        `on ${new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${m} ${tone === 'up' ? 'up' : tone === 'down' ? 'down' : 'flat'}: <b class="${right ? 'wk-ok' : 'wk-ko'}">${right ? '✓ right' : '✗ wrong'}</b> (${s1(c)} %)`); }));
    const first = Object.keys(H).sort()[0];
    an = all >= 6 ? T(`<b>Les notes de marché ont-elles vu juste ?</b> ${ok} fois sur ${all} sur ${Object.keys(weeks).length} semaines ; dernier appel jugé : ${lastLine}.`, `<b>Did the market notes get it right?</b> ${ok} times out of ${all} over ${Object.keys(weeks).length} weeks; last call judged: ${lastLine}.`)
      : first ? T(`<b>Les notes de marché ont-elles vu juste ?</b> Bilan dès que 3 semaines d’appels auront été comparées aux prix (suivi depuis le ${new Date(first + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })}).`,
        `<b>Did the market notes get it right?</b> The score shows once 3 weeks of calls can be checked against prices (tracked since ${new Date(first + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}).`) : '';
    // the context in full on top, then one tile per market: name and call, the key figure, today's text, and the week ahead
    // in a box pinned to the bottom of the tile, the same height in every tile (an empty box says there is no call)
    const ctxR = R.filter(r => r[0] === T('Contexte', 'Context')), mk = R.filter(r => r[0] !== T('Contexte', 'Context'));
    const ctx = ctxR.map(([k, [tone, src], text]) => `<div class="why4-ctx"><div class="why4-h"><span class="why4-n">${k}</span>${chip(tone)}<span class="why3-src">${src}</span></div><div>${text}</div></div>`).join('');
    host.innerHTML = `<div class="why3 why4">${ctx}<div class="why4-g">${mk.map(([k, [tone, src, o], text, fig]) => `<div class="why4-t"><div class="why4-h"><span class="why4-n">${k}</span>${chip(tone)}</div>` +
      (fig ? `<div class="why4-v">${fig}</div>` : '') + `<div class="why4-x">${text}</div>` +
      `<div class="why4-next${o ? '' : ' none'}">${o ? `<b>${T('Semaine à venir', 'Week ahead')}</b> : ${txt(o)}` : `<b>${T('Semaine à venir', 'Week ahead')}</b> : ${T('pas de note cette semaine', 'no call this week')}`}</div><span class="why3-src">${src}</span></div>`).join('')}</div>${an ? `<div class="why3-an">${an}</div>` : ''}</div>`;
    // every « week ahead » box the height of the tallest, so they line up at the bottom of all the tiles
    const eq = () => { const bx = [...host.querySelectorAll('.why4-next')]; bx.forEach(b => { b.style.minHeight = ''; }); const h = Math.max(...bx.map(b => b.offsetHeight)); if (h > 0) bx.forEach(b => { b.style.minHeight = h + 'px'; }); };
    requestAnimationFrame(eq); if (!host.dataset.eq) { host.dataset.eq = '1'; window.addEventListener('resize', () => requestAnimationFrame(eq)); }
  }

  async function next30(host) {
    const [wx, fm, cs] = await Promise.all([get('weather_outlook.json'), get('history/fr_forward_monthly.json'), get('history/commodities_series.json')]);
    const out = [];
    // month-ahead forward
    if (fm && fm.months) { const ks = Object.keys(fm.months).sort(), m1 = ks[0], m2 = ks[1], v1 = fm.months[m1], v2 = m2 && fm.months[m2];
      const lbl = k => new Date(k + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      out.push(sec(PK.icon('calendar', 14), `Month ahead · ${lbl(m1)} <b>${(+v1.value).toFixed(2)} €/MWh</b>`, `${v1.peakRatio ? `peak about ${(v1.value * v1.peakRatio).toFixed(0)} €/MWh. ` : ''}${v2 ? `${lbl(m2)} ${(+v2.value).toFixed(2)} €/MWh. ` : ''}Settlements of ${esc(fm.asOf || '')}.`));
    }
    // weather, week by week against normal
    const F = wx && wx.countries && wx.countries.FR && wx.countries.FR.series;
    if (F && F.temp) {
      const days = F.temp.days, today = (wx.today || iso(new Date()));
      const i0 = days.findIndex(d => d > today); const weeks = [];
      for (let w = 0; w < 4 && i0 >= 0; w++) {
        const ix = days.map((d, i) => i).filter(i => i >= i0 + w * 7 && i < i0 + (w + 1) * 7);
        const avg = (k, f) => { const v = ix.map(i => F[k] && F[k][f] ? F[k][f][i] : null).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
        if (!ix.length) break;
        weeks.push({ from: days[ix[0]], dT: avg('temp', 'mean') != null && avg('temp', 'normal') != null ? avg('temp', 'mean') - avg('temp', 'normal') : null,
          wind: pct(avg('wind', 'mean'), avg('wind', 'normal')), sun: pct(avg('solar', 'mean'), avg('solar', 'normal')) });
      }
      if (weeks.length) {
        const cold = weeks.filter(w => w.dT != null && w.dT < -1).length, windy = weeks.filter(w => w.wind != null && w.wind > 10).length, calm = weeks.filter(w => w.wind != null && w.wind < -10).length;
        const take = [cold ? `${cold} week${cold > 1 ? 's' : ''} colder than normal: more heating demand, a support for prices` : weeks.some(w => w.dT > 1) ? 'milder than normal: less heating demand' : 'temperatures close to normal',
          ...[windy ? `wind above normal in ${windy} week${windy > 1 ? 's' : ''} (${weeks.map((w, k) => w.wind > 10 ? 'week ' + (k + 1) : null).filter(Boolean).join(', ')}): lower prices, more negative hours at midday` : null,
            calm ? `wind below normal in ${calm} week${calm > 1 ? 's' : ''} (${weeks.map((w, k) => w.wind < -10 ? 'week ' + (k + 1) : null).filter(Boolean).join(', ')}): more gas burnt, firmer prices` : null].filter(Boolean)];
        if (!windy && !calm) take.push('wind close to normal');
        out.push(sec(PK.icon('cloud', 14), 'Weather · France, the next 4 weeks against normal', `<div class="mb-wk">${weeks.map((w, k) => `<div><b>Week ${k + 1} · ${new Date(w.from + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</b>${w.dT == null ? '–' : `<span class="${w.dT < 0 ? 'mb-up' : 'mb-dn'}">${sg(w.dT)} °C</span>`} · wind ${w.wind == null ? '–' : `<span class="${w.wind < 0 ? 'mb-up' : 'mb-dn'}">${sg(w.wind, 0)} %</span>`} · sun ${w.sun == null ? '–' : sg(w.sun, 0) + ' %'}</div>`).join('')}</div><div style="margin-top:5px">${take.join('; ')}.</div>`));
      }
    }
    // nuclear and gas storage
    const S = cs && cs.series || {}, P = k => (S[k] || {}).points || [];
    const av = last(P('fr_nuc_avail')), fc = last(P('fr_nuc_avail_fc'));
    if (av) out.push(sec('⚛', `Nuclear · France <b>${(av[1] / 1000).toFixed(1)} GW</b> available`, `of 63 GW installed${fc ? `; operator forecast ${(fc[1] / 1000).toFixed(1)} GW (${sg((fc[1] - av[1]) / 1000)} GW): ${fc[1] > av[1] + 2000 ? 'reactors coming back, a weight on winter prices' : fc[1] < av[1] - 2000 ? 'more outages announced, a support for prices' : 'little change announced'}` : ''}.`));
    const st = last(P('agsi'));
    if (st) { const ly = back(P('agsi'), 365); out.push(sec(PK.icon('tank', 14), `Gas storage · EU <b>${st[1].toFixed(1)} %</b> full`, `${ly != null ? `${sg(st[1] - ly)} points vs a year ago. ` : ''}${st[1] < 80 ? 'Below the 80 % comfort mark heading into winter: gas, and French power through the gas plants, stay sensitive to cold spells.' : 'Comfortable level for the start of winter.'}`)); }
    host.innerHTML = out.length ? `<div class="mb">${out.join('')}<div class="mb-note">Weather: ensemble outlook against the 2016–2025 normal (Open-Meteo, RTE fit); forwards: latest settlements; nuclear: operator data.</div></div>` : '<div class="fuel-note">Outlook data not available.</div>';
  }

  if (window.PKW) {
    PKW.register({ id: 'market-brief', kind: 'html', title: 'Energy markets · what moved and why', category: 'intel', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'Power, gas, oil, carbon, coal and guarantees of origin: what moved this week and why, the trend for the week ahead (market notes, or prices without a note), and whether the notes’ calls came true.', html: brief });
    PKW.register({ id: 'next-30-days', kind: 'html', title: 'France power · the next 30 days', category: 'forwards', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'What the coming month looks like for French power: month-ahead forward, weather week by week against normal (temperature, wind, sun), nuclear availability and gas storage, with what each means for prices.', html: next30 });
  }
  window.PKBrief = { brief, next30 };
})();
