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
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

  // ── the week, in French, in the dashboard's style: six tiles (price, 7-day move, 60-day line), then a digest,
  //    one line per market with one sub-line per topic, and on the right what the market notes received said
  //    (rising or easing tone) against what the price really did over the same week
  const css2 = `
  .wk{container-type:inline-size;display:flex;flex-direction:column;gap:10px;font-size:12.5px;line-height:1.45;color:var(--text2)}
  .wk-tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
  .wk-tile{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:7px 9px;min-width:0}
  .wk-tn{font:600 10px 'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .wk-tv{font:600 17px 'JetBrains Mono',monospace;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap}
  .wk-tv small{font-size:10px;color:var(--text3);font-weight:400}
  .wk-tc{font:600 11px 'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
  .wk-sp{display:block;width:100%;height:24px;margin-top:3px}
  .wk-up{color:var(--down)} .wk-dn{color:var(--up)} .wk-fl{color:var(--text3)}
  .wk-row{display:grid;grid-template-columns:92px 84px minmax(0,1fr) 230px;column-gap:14px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--border)}
  .wk-row:last-child{border-bottom:0} .wk-row.wk-hr{padding:2px 0 5px}
  .wk-hd{font:600 9.5px 'JetBrains Mono',monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
  .wk-cn{border-left:1px solid var(--border);padding-left:12px;align-self:stretch}
  .wk-k{font:600 11px 'JetBrains Mono',monospace;color:var(--text);text-transform:uppercase;letter-spacing:.04em}
  .wk-chip{display:inline-block;font:600 10.5px 'JetBrains Mono',monospace;border-radius:4px;padding:1px 6px;white-space:nowrap}
  .wk-chip.wk-up{background:rgba(237,105,101,.14)} .wk-chip.wk-dn{background:rgba(20,211,169,.14)} .wk-chip.wk-fl{background:rgba(122,147,171,.14)}
  .wk-l{display:block} .wk-l b{color:var(--text);font-weight:600}
  .wk-n{font-size:11.5px;color:var(--text3)} .wk-n b{font-weight:600} .wk-ok{color:var(--accent)} .wk-ko{color:#fbbf24}
  .wk-foot{font-size:11px;color:var(--text3)}
  @container (max-width:760px){.wk-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.wk-row{grid-template-columns:auto minmax(0,1fr);row-gap:3px}.wk-hr{display:none}.wk-tx,.wk-cn{grid-column:1/-1}.wk-cn{border-left:0;padding-left:0}.wk-cn:before{content:'Analystes vs prix · ';font-size:11px;color:var(--text3)}}`;
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


  async function brief(host) {
    const [cs, chain, sum, nt] = await Promise.all([get('history/commodities_series.json'), get('history/fr_market_calchain.json'), window.pkSummary ? window.pkSummary().catch(() => null) : null, notes()]);
    const S = cs && cs.series || {}, P = k => (S[k] || {}).points || [];
    const yrs = chain && chain.FR && chain.FR.years, ck = yrs && Object.keys(yrs).sort()[0];
    const calP = ck ? yrs[ck].dates.map((d, i) => [d, yrs[ck].values[i]]) : [];
    const spotP = ((sum && sum.zones && sum.zones.FR) || []).filter(r => r.avg != null).map(r => [r.d, r.avg]);
    const wkPct = pts => { const l = last(pts); return l ? pct(l[1], back(pts, 7)) : null; };
    // tiles
    const T = [['Brent', P('brent'), '$/b'], ['TTF', P('ttf'), '€/MWh'], ['EUA', P('eua'), '€/t'], ['Charbon API2', P('coal'), '$/t'], ['Spot France', spotP, '€/MWh', true], [ck ? 'Cal ' + String(ck).slice(-2) + ' France' : 'Cal+1 France', calP, '€/MWh']]
      .filter(t => t[1].length).map(([k, pts, u, spot]) => {
        const l = last(pts), w = spot ? pct(since(pts, 6).reduce((a, p) => a + p[1], 0) / since(pts, 6).length, since(pts, 13).slice(0, -7).reduce((a, p) => a + p[1], 0) / Math.max(1, since(pts, 13).slice(0, -7).length)) : wkPct(pts), c = wc(w);
        return `<div class="wk-tile" title="${spot ? 'Moyenne des 7 derniers jours contre les 7 précédents' : 'Variation sur 7 jours'}"><div class="wk-tn">${k}</div><div class="wk-tv">${nf(l[1], l[1] >= 100 ? 1 : 2)} <small>${u}</small></div><div class="wk-tc ${c}">${c === 'wk-fl' ? '→ stable' : arrow(w) + ' ' + fr(w) + ' %'}${spot ? ' <span class="wk-fl" style="font-weight:400">moy. 7 j</span>' : ''}</div>${spark(since(pts, 60), c)}</div>`; });
    // digest rows: [key, chip move, chip class, lines[], notes column]
    const R = [];
    // context: a short French text per topic, France first, written each morning and evening from the market notes,
    // the news and the week's prices (scripts/market_digest.py), never a list of articles
    const dg = await get('market_digest.json'), ctxT = dg && Date.now() - Date.parse(dg.updated) < 5 * 864e5 ? (dg.context || []) : [];
    if (ctxT.length) { const u = ctxT.filter(c => c.tone === 'up').length - ctxT.filter(c => c.tone === 'down').length;
      R.push(['Contexte', u > 0 ? '↑ haussier' : u < 0 ? '↓ baissier' : '→ neutre', u > 0 ? 'wk-up' : u < 0 ? 'wk-dn' : 'wk-fl',
        ctxT.map(c => `<span class="wk-l"><b>${esc(c.topic)} :</b> ${esc(c.text.replace(/\.?\s*$/, '.'))}</span>`), verdict(nt.ctx, null, true)]); }
    const br = last(P('brent'));
    if (br) { const w = wkPct(P('brent')); R.push(['Pétrole', arrow(w) + ' ' + fr(w) + ' %', wc(w), [`<span class="wk-l"><b>Brent :</b> ${nf(br[1])} $/b${range(P('brent'))}.</span>`], verdict(nt.brent, w)]); }
    const ttf = last(P('ttf'));
    if (ttf) { const w = wkPct(P('ttf')), st = last(P('agsi')), ly = st ? back(P('agsi'), 365) : null;
      R.push(['Gaz', arrow(w) + ' ' + fr(w) + ' %', wc(w), [`<span class="wk-l"><b>TTF :</b> ${nf(ttf[1])} €/MWh${range(P('ttf'))}.</span>`,
        st ? `<span class="wk-l"><b>Stocks UE :</b> ${nf(st[1], 1)} %${ly != null ? `, ${fr(st[1] - ly)} pts sur un an${st[1] < ly ? ' : moins de marge pour l’hiver, un soutien aux prix' : ' : marge confortable pour l’hiver'}` : ''}.</span>` : ''].filter(Boolean), verdict(nt.ttf, w)]); }
    if (calP.length) { const l = last(calP), w0 = back(calP, 7), dFR = w0 != null ? l[1] - w0 : null, wP = pct(l[1], w0);
      const ty = cs && cs.calYears && cs.calYears.ttf && cs.calYears.ttf[ck], tP = ty ? ty.dates.map((d, i) => [d, ty.values[i]]) : null, dT = tP ? last(tP)[1] - back(tP, 7) : null, gas = dT != null ? dT * 2 : null;
      const lines = [`<span class="wk-l"><b>Cal ${ck} France :</b> ${nf(l[1])} €/MWh, ${fr(dFR, 2)} € sur 7 jours${range(calP)}.</span>`];
      if (gas != null) lines.push(`<span class="wk-l"><b>Part du gaz :</b> le gaz Cal ${ck} (${fr(dT, 2)} €/MWh) pèse ≈ ${fr(gas)} €/MWh sur le coût d’une centrale gaz : ${Math.abs(dFR - gas) < 1 ? 'le mouvement français vient surtout du gaz' : dFR - gas > 0 ? 'la France monte plus que le gaz seul (nucléaire, demande)' : 'la France monte moins que le gaz seul (nucléaire, demande plus détendus)'}.</span>`);
      const sp = since(spotP, 6); if (sp.length) { const neg = ((sum.zones.FR) || []).slice(-7).reduce((a, r) => a + (r.negH || 0), 0), ls = last(spotP);
        lines.push(`<span class="wk-l"><b>Spot :</b> ${nf(sp.reduce((a, p) => a + p[1], 0) / sp.length, 1)} €/MWh en moyenne sur 7 jours, ${nf(ls[1], 1)} €/MWh le ${new Date(ls[0] + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/\.$/, '')}${neg ? `, ${nf(neg, neg % 1 ? 1 : 0)} h de prix négatifs` : ''}.</span>`); }
      R.push(['Électricité', arrow(wP) + ' ' + fr(dFR, 1) + ' €', wc(wP), lines, verdict(nt.cal, wP)]); }
    const eua = last(P('eua'));
    if (eua) { const w = wkPct(P('eua')), d = eua[1] - (back(P('eua'), 7) || eua[1]);
      R.push(['Carbone', arrow(w) + ' ' + fr(w) + ' %', wc(w), [`<span class="wk-l"><b>EUA :</b> ${nf(eua[1])} €/t${range(P('eua'))}.</span>`,
        `<span class="wk-l"><b>Effet :</b> ${Math.abs(d) < 0.5 ? 'quasi nul' : `${fr(0.37 * d)} €/MWh`} sur le coût d’une centrale gaz.</span>`], verdict(nt.eua, w)]); }
    if (!T.length && !R.length) { host.innerHTML = '<div class="fuel-note">Données de marché indisponibles.</div>'; return; }
    host.innerHTML = `<div class="wk"><div class="wk-tiles">${T.join('')}</div>
      <div><div class="wk-row wk-hr"><span class="wk-hd">Marché</span><span class="wk-hd">7 jours</span><span class="wk-hd">Ce qui s’est passé</span><span class="wk-hd">Les analystes ont-ils vu juste ?</span></div>
      ${R.map(([k, m, c, ls, v]) => `<div class="wk-row"><span class="wk-k">${k}</span><span class="wk-cm"><span class="wk-chip ${c}">${m}</span></span><span class="wk-tx">${ls.join('')}</span><span class="wk-cn">${v}</span></div>`).join('')}</div>
      <div class="wk-foot">Rouge = prix en hausse, vert = en baisse. Mini-courbes : 60 jours. Dernière colonne : les commentaires de marché publiés par des fournisseurs d’énergie ces 10 derniers jours (rapport quotidien, lettre hebdomadaire) annonçaient-ils une hausse ou une baisse ? On compare au mouvement réel du prix sur 7 jours : ✓ vu juste, ✗ raté.</div></div>`;
  }

  async function next30(host) {
    const [wx, fm, cs] = await Promise.all([get('weather_outlook.json'), get('history/fr_forward_monthly.json'), get('history/commodities_series.json')]);
    const out = [];
    // month-ahead forward
    if (fm && fm.months) { const ks = Object.keys(fm.months).sort(), m1 = ks[0], m2 = ks[1], v1 = fm.months[m1], v2 = m2 && fm.months[m2];
      const lbl = k => new Date(k + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      out.push(sec('📅', `Month ahead · ${lbl(m1)} <b>${(+v1.value).toFixed(2)} €/MWh</b>`, `${v1.peakRatio ? `peak about ${(v1.value * v1.peakRatio).toFixed(0)} €/MWh. ` : ''}${v2 ? `${lbl(m2)} ${(+v2.value).toFixed(2)} €/MWh. ` : ''}Settlements of ${esc(fm.asOf || '')}.`));
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
        out.push(sec('🌤', 'Weather · France, the next 4 weeks against normal', `<div class="mb-wk">${weeks.map((w, k) => `<div><b>Week ${k + 1} · ${new Date(w.from + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</b>${w.dT == null ? '–' : `<span class="${w.dT < 0 ? 'mb-up' : 'mb-dn'}">${sg(w.dT)} °C</span>`} · wind ${w.wind == null ? '–' : `<span class="${w.wind < 0 ? 'mb-up' : 'mb-dn'}">${sg(w.wind, 0)} %</span>`} · sun ${w.sun == null ? '–' : sg(w.sun, 0) + ' %'}</div>`).join('')}</div><div style="margin-top:5px">${take.join('; ')}.</div>`));
      }
    }
    // nuclear and gas storage
    const S = cs && cs.series || {}, P = k => (S[k] || {}).points || [];
    const av = last(P('fr_nuc_avail')), fc = last(P('fr_nuc_avail_fc'));
    if (av) out.push(sec('⚛', `Nuclear · France <b>${(av[1] / 1000).toFixed(1)} GW</b> available`, `of 63 GW installed${fc ? `; operator forecast ${(fc[1] / 1000).toFixed(1)} GW (${sg((fc[1] - av[1]) / 1000)} GW): ${fc[1] > av[1] + 2000 ? 'reactors coming back, a weight on winter prices' : fc[1] < av[1] - 2000 ? 'more outages announced, a support for prices' : 'little change announced'}` : ''}.`));
    const st = last(P('agsi'));
    if (st) { const ly = back(P('agsi'), 365); out.push(sec('🔵', `Gas storage · EU <b>${st[1].toFixed(1)} %</b> full`, `${ly != null ? `${sg(st[1] - ly)} points vs a year ago. ` : ''}${st[1] < 80 ? 'Below the 80 % comfort mark heading into winter: gas, and French power through the gas plants, stay sensitive to cold spells.' : 'Comfortable level for the start of winter.'}`)); }
    host.innerHTML = out.length ? `<div class="mb">${out.join('')}<div class="mb-note">Weather: ensemble outlook against the 2016–2025 normal (Open-Meteo, RTE fit); forwards: latest settlements; nuclear: operator data.</div></div>` : '<div class="fuel-note">Outlook data not available.</div>';
  }

  if (window.PKW) {
    PKW.register({ id: 'market-brief', kind: 'html', title: 'Marchés de l’énergie · la semaine', category: 'intel', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'Ce qui a bougé cette semaine sur le pétrole, le gaz, le carbone et l’électricité, et pourquoi : les prix et leur tendance, le contexte en France et dans le monde, et si les analystes avaient vu juste.', html: brief });
    PKW.register({ id: 'next-30-days', kind: 'html', title: 'France power · the next 30 days', category: 'forwards', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'What the coming month looks like for French power: month-ahead forward, weather week by week against normal (temperature, wind, sun), nuclear availability and gas storage, with what each means for prices.', html: next30 });
  }
  window.PKBrief = { brief, next30 };
})();
