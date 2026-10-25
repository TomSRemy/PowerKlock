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


  // the week as one card per market: its prices (value, 7-day move, 60-day line) with what explains them, then what the
  // market notes and the news expect for the coming week; the context (France first) across the top
  const css3 = `
  .wk2{container-type:inline-size;display:flex;flex-direction:column;gap:10px;font-size:12.5px;line-height:1.45;color:var(--text2)}
  .wk2-ctx{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:9px 12px;display:flex;flex-direction:column;gap:3px}
  .wk2-ctx-h{display:flex;align-items:center;gap:8px;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
  .wk2-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .wk2-m{border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;min-width:0}
  .wk2-mh{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .wk2-mn{font:600 11px 'JetBrains Mono',monospace;color:var(--text);text-transform:uppercase;letter-spacing:.06em}
  .wk2-q{display:grid;grid-template-columns:minmax(0,1fr) auto 74px;align-items:center;column-gap:10px;padding:2px 0}
  .wk2-qn{color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wk2-qn small{display:block;font-weight:400;font-size:10.5px;color:var(--text3)}
  .wk2-qv{text-align:right;font:600 15px 'JetBrains Mono',monospace;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap}.wk2-qv small{font-size:10px;font-weight:400;color:var(--text3)}
  .wk2-qv .wk-chip{display:block;margin-top:2px;text-align:right;background:none;padding:0}
  .wk2-q .wk-sp{height:28px;margin:0}
  .wk2-l{font-size:12px;border-top:1px dashed var(--border);padding-top:6px;display:flex;flex-direction:column;gap:3px}.wk2-l b{color:var(--text);font-weight:600}
  .wk2-o{font-size:11.5px;color:var(--text3);margin-top:auto;border-top:1px solid var(--border);padding-top:6px}.wk2-o b{color:var(--text2);font-weight:600}
  @container (max-width:640px){.wk2-grid{grid-template-columns:1fr}}`;
  if (!document.getElementById('wk2-css')) { const s = document.createElement('style'); s.id = 'wk2-css'; s.textContent = css3; document.head.appendChild(s); }

  async function brief(host) {
    const [cs, chain, sum, nt] = await Promise.all([get('history/commodities_series.json'), get('history/fr_market_calchain.json'), window.pkSummary ? window.pkSummary().catch(() => null) : null, notes()]);
    const S = cs && cs.series || {}, P = k => (S[k] || {}).points || [];
    const yrs = chain && chain.FR && chain.FR.years, ck = yrs && Object.keys(yrs).sort()[0];
    const calP = ck ? yrs[ck].dates.map((d, i) => [d, yrs[ck].values[i]]) : [];
    const spotP = ((sum && sum.zones && sum.zones.FR) || []).filter(r => r.avg != null).map(r => [r.d, r.avg]);
    const wkPct = pts => { const l = last(pts); return l ? pct(l[1], back(pts, 7)) : null; };
    const mean = a => a.length ? a.reduce((x, p) => x + p[1], 0) / a.length : null;
    // one price line: name (and where it sits in its 60-day range), value, 7-day move, 60-day line
    const quote = (name, pts, u, spot) => {
      if (!pts.length) return '';
      const l = last(pts), prev7 = since(pts, 13).slice(0, -7);
      const w = spot ? pct(mean(since(pts, 6)), mean(prev7)) : wkPct(pts), c = wc(w);
      const rg = spot ? '' : range(pts).replace(/^, /, ''), v = spot ? mean(since(pts, 6)) : l[1];
      return `<div class="wk2-q" title="${spot ? 'Moyenne des 7 derniers jours contre les 7 précédents' : 'Variation sur 7 jours'} · mini-courbe : 60 jours"><span class="wk2-qn">${name}<small>${spot ? 'moyenne 7 jours' : rg}</small></span>
        <span class="wk2-qv">${nf(v, v >= 100 ? 1 : 2)} <small>${u}</small><span class="wk-chip ${c}">${c === 'wk-fl' ? '→ stable' : arrow(w) + ' ' + fr(w) + ' %'}</span></span>${spark(since(pts, 60), c)}</div>`;
    };
    const dg = await get('market_digest.json'), fresh = dg && Date.now() - Date.parse(dg.updated) < 5 * 864e5;
    const ctxT = fresh ? (dg.context || []) : [], OL = fresh ? (dg.outlook || {}) : {};
    // the week ahead, market by market: [chip, text]
    const look = (k, tones) => { const o = OL[k];
      if (o && o.text) return [`<span class="wk-chip ${o.tone === 'up' ? 'wk-up' : o.tone === 'down' ? 'wk-dn' : 'wk-fl'}">${o.tone === 'up' ? '↑ haussier' : o.tone === 'down' ? '↓ baissier' : '→ neutre'}</span>`, esc(o.text.replace(/\.?\s*$/, '.'))];
      const up = (tones || []).filter(t => t > 0).length, dn = (tones || []).filter(t => t < 0).length;
      return !up && !dn ? ['', 'pas de signal pour la semaine à venir.'] : [`<span class="wk-chip ${up > dn ? 'wk-up' : dn > up ? 'wk-dn' : 'wk-fl'}">${up > dn ? '↑ haussier' : dn > up ? '↓ baissier' : '→ partagé'}</span>`, 'd’après les commentaires de marché reçus.']; };
    const M = [];   // [name, quotes html, lines[], [chip, text]]
    if (P('brent').length) M.push(['Pétrole', quote('Brent', P('brent'), '$/b'), [], look('oil', nt.brent)]);
    if (P('ttf').length) { const st = last(P('agsi')), ly = st ? back(P('agsi'), 365) : null;
      M.push(['Gaz', quote('TTF', P('ttf'), '€/MWh'), st ? [`<span><b>Stocks UE :</b> ${nf(st[1], 1)} %${ly != null ? `, ${fr(st[1] - ly)} pts sur un an${st[1] < ly ? ' : moins de marge pour l’hiver, un soutien aux prix' : ' : marge confortable pour l’hiver'}` : ''}.</span>`] : [], look('gas', nt.ttf)]); }
    if (calP.length || spotP.length) {
      const lines = [];
      if (calP.length) { const l = last(calP), w0 = back(calP, 7), dFR = w0 != null ? l[1] - w0 : null;
        const ty = cs && cs.calYears && cs.calYears.ttf && cs.calYears.ttf[ck], tP = ty ? ty.dates.map((d, i) => [d, ty.values[i]]) : null, dT = tP ? last(tP)[1] - back(tP, 7) : null, gas = dT != null ? dT * 2 : null;
        if (dFR != null) lines.push(`<span><b>Cal ${ck} :</b> ${fr(dFR, 2)} €/MWh sur 7 jours.</span>`);
        if (gas != null && dFR != null) lines.push(`<span><b>Part du gaz :</b> le gaz Cal ${ck} (${fr(dT, 2)} €/MWh) pèse ≈ ${fr(gas)} €/MWh sur le coût d’une centrale gaz : ${Math.abs(dFR - gas) < 1 ? 'le mouvement français vient surtout du gaz' : dFR - gas > 0 ? 'la France monte plus que le gaz seul (nucléaire, demande)' : 'la France monte moins que le gaz seul (nucléaire, demande plus détendus)'}.</span>`); }
      if (spotP.length) { const neg = ((sum.zones.FR) || []).slice(-7).reduce((a, r) => a + (r.negH || 0), 0), ls = last(spotP);
        lines.push(`<span><b>Spot :</b> ${nf(ls[1], 1)} €/MWh le ${new Date(ls[0] + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/\.$/, '')}${neg ? `, ${nf(neg, neg % 1 ? 1 : 0)} h de prix négatifs sur 7 jours` : ''}.</span>`); }
      M.push(['Électricité France', quote(ck ? 'Cal ' + ck : 'Cal+1', calP, '€/MWh') + quote('Spot', spotP, '€/MWh', true), lines, look('power', nt.cal)]); }
    if (P('eua').length) { const eua = last(P('eua')), d = eua[1] - (back(P('eua'), 7) || eua[1]);
      M.push(['Carbone et charbon', quote('EUA', P('eua'), '€/t') + quote('Charbon API2', P('coal'), '$/t'), [`<span><b>Effet du CO₂ :</b> ${Math.abs(d) < 0.5 ? 'quasi nul' : `${fr(0.37 * d)} €/MWh`} sur le coût d’une centrale gaz.</span>`], look('carbon', nt.eua)]); }
    if (!M.length) { host.innerHTML = '<div class="fuel-note">Données de marché indisponibles.</div>'; return; }
    let ctx = '';
    if (ctxT.length) { const u = ctxT.filter(c => c.tone === 'up').length - ctxT.filter(c => c.tone === 'down').length;
      ctx = `<div class="wk2-ctx"><div class="wk2-ctx-h">Contexte <span class="wk-chip ${u > 0 ? 'wk-up' : u < 0 ? 'wk-dn' : 'wk-fl'}">${u > 0 ? '↑ haussier' : u < 0 ? '↓ baissier' : '→ neutre'}</span></div>` +
        ctxT.map(c => `<span class="wk-l"><b>${esc(c.topic)} :</b> ${esc(c.text.replace(/\.?\s*$/, '.'))}</span>`).join('') +
        (nt.ctx.length ? `<span class="wk-l"><b>Analystes :</b> ${verdict(nt.ctx, null, true).replace(/^.*les analystes voient/, 'ils voient').replace(/<\/?span[^>]*>/g, '')}.</span>` : '') + '</div>'; }
    host.innerHTML = `<div class="wk wk2">${ctx}<div class="wk2-grid">${M.map(([n, q, ls, [chip, txt]]) => `<div class="wk2-m"><div class="wk2-mh"><span class="wk2-mn">${n}</span>${chip}</div>${q}${ls.length ? `<div class="wk2-l">${ls.join('')}</div>` : ''}<div class="wk2-o"><b>Semaine à venir :</b> ${txt}</div></div>`).join('')}</div>
      <div class="wk-foot">Rouge = prix en hausse, vert = en baisse ; mini-courbes sur 60 jours. « Semaine à venir » : ce que les commentaires de marché des fournisseurs d’énergie et l’actualité laissent attendre.</div></div>`;
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
    PKW.register({ id: 'market-brief', kind: 'html', title: 'Marchés de l’énergie · la semaine', category: 'intel', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'Ce qui a bougé cette semaine sur le pétrole, le gaz, le carbone et l’électricité, et pourquoi : les prix et leur tendance, le contexte en France et dans le monde, et si les analystes avaient vu juste.', html: brief });
    PKW.register({ id: 'next-30-days', kind: 'html', title: 'France power · the next 30 days', category: 'forwards', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'What the coming month looks like for French power: month-ahead forward, weather week by week against normal (temperature, wind, sun), nuclear availability and gas storage, with what each means for prices.', html: next30 });
  }
  window.PKBrief = { brief, next30 };
})();
