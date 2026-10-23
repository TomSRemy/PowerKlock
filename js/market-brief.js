// ════════════════════════════════════════════════════════════════════
// MARKET BRIEF and NEXT 30 DAYS (catalogue widgets, any dashboard)
//   market-brief  the week in energy markets, in the order of a broker's
//                 morning note: context (market-moving news), oil, gas,
//                 carbon, power spot, power forwards — each with its move
//   next-30-days  what the coming month looks like for French power: the
//                 month-ahead forward, weather week by week against normal
//                 (temperature, wind, sun), nuclear availability, gas
//                 storage — and what each means for prices
// Data: data/history/commodities_series.json, fr_market_calchain.json,
// fr_forward_monthly.json, data/weather_outlook.json, data/news.json,
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

  async function spotWeek() {
    // French day-ahead baseload, last 7 days vs the 7 before (daily files)
    const days = [], t = new Date(); for (let k = 1; k <= 15; k++) { const d = new Date(t); d.setUTCDate(d.getUTCDate() - k + 1); days.push(iso(d)); }
    const js = await Promise.all(days.map(d => get('history/daily/' + d + '.json')));
    const v = js.map((j, i) => j && j.zones && j.zones.FR && j.zones.FR.avg != null ? { d: days[i], avg: j.zones.FR.avg, neg: j.zones.FR.negH || 0 } : null).filter(Boolean);
    if (v.length < 8) return null;
    const a = v.slice(0, 7), b = v.slice(7, 14), m = x => x.reduce((s, y) => s + y.avg, 0) / x.length;
    return { last: v[0], wk: m(a), prev: b.length ? m(b) : null, neg: a.reduce((s, y) => s + y.neg, 0) };
  }

  // a note's section against the market it talks about: the tone of its words (tight, rising… / easing, falling…)
  // vs the move of the matching price in the week before the note, and what the price did since
  const UPW = /\b(tight\w*|tense|tension\w*|ris(e|es|ing)|higher|increas\w*|support\w*|firm\w*|bullish|pressure\w*|spik\w*|jump\w*|surg\w*|climb\w*|strong\w*|gain\w*|deteriorat\w*|disrupt\w*|risk\w*)\b/gi;
  const DNW = /\b(eas(e|es|ed|ing)|fall\w*|fell|lower\w*|declin\w*|drop\w*|bearish|weak\w*|loosen\w*|relief|soft\w*|improv\w*|calm\w*|resilient|ample|comfortable|down\w*)\b/gi;
  function checkNote(x, date, S, chain) {
    const nm = (x.name || '').toLowerCase(), key = /oil/.test(nm) ? 'brent' : /gas/.test(nm) ? 'ttf' : /co2|co₂|carbon/.test(nm) ? 'eua' : /electric|power/.test(nm) ? 'cal' : null;
    if (!key) return '';
    let pts = null, unit = '', label = '';
    if (key === 'cal') { const yrs = chain && chain.FR && chain.FR.years, k = yrs && Object.keys(yrs).sort()[0]; if (!k) return ''; pts = yrs[k].dates.map((d, i) => [d, yrs[k].values[i]]); unit = '€/MWh'; label = 'Cal ' + k + ' FR'; }
    else { pts = (S[key] || {}).points; unit = key === 'brent' ? '$/b' : key === 'eua' ? '€/t' : '€/MWh'; label = { brent: 'Brent', ttf: 'TTF', eua: 'EUA' }[key]; }
    if (!pts || !pts.length) return '';
    const at = d => { let v = null; for (const [t, y] of pts) { if (t <= d) v = y; else break; } return v; };
    const dd = new Date(date + 'T12:00:00Z'); dd.setUTCDate(dd.getUTCDate() - 7); const wk = iso(dd);
    const p0 = at(wk), p1 = at(date), pn = pts[pts.length - 1][1];
    if (p0 == null || p1 == null) return '';
    const before = pct(p1, p0), after = pct(pn, p1);
    const txt = (x.headline || '') + ' ' + (x.points || []).join(' ');
    const tone = (txt.match(UPW) || []).length - (txt.match(DNW) || []).length;
    const toneW = tone > 0 ? 'tone ↑ (tight, rising)' : tone < 0 ? 'tone ↓ (easing, falling)' : 'tone neutral';
    const agree = tone === 0 || Math.abs(before) < 1 ? '' : (tone > 0) === (before > 0) ? ' · <span style="color:var(--up)">in line with the market</span>' : ' · <span style="color:var(--down)">against the market move</span>';
    return `<div class="mb-note">${label} ${sg(before)} % in the week to the note (${p1.toFixed(2)} ${unit}), ${sg(after)} % since · ${toneW}${agree}</div>`;
  }

  async function brief(host) {
    const [cs, chain, news, sp] = await Promise.all([get('history/commodities_series.json'), get('history/fr_market_calchain.json'), get('news.json'), spotWeek()]);
    const S = cs && cs.series || {}, P = k => (S[k] || {}).points || [];
    const out = [];
    // context: the strongest market-moving articles of the last 72 h
    const movers = ((news && news.items) || []).filter(n => Date.now() - Date.parse(n.date) < 72 * 3600e3 && (n.impact || 0) >= 3 && (n.tags || []).some(t => ['geopolitics', 'regulation', 'gas', 'markets'].includes(t)))
      .sort((a, b) => (b.impact || 0) - (a.impact || 0)).slice(0, 3);
    if (movers.length) out.push(sec('🌍', 'Context', '<ul>' + movers.map(n => `<li><a href="${/^https?:\/\//.test(n.link) ? esc(n.link) : '#'}" target="_blank" rel="noopener" style="color:var(--text)">${esc(n.title)}</a> <span class="mb-note">${esc(n.source)}</span></li>`).join('') + '</ul>'));
    // oil
    const br = last(P('brent'));
    if (br) { const w = pct(br[1], back(P('brent'), 7)); out.push(sec('🛢', `Oil · Brent <b>${br[1].toFixed(2)} $/b</b>`, `<span class="${cls(w)}">${sg(w)} %</span> over a week (${esc(br[0])}).`)); }
    // gas
    const ttf = last(P('ttf')), st = last(P('agsi'));
    if (ttf) { const w = pct(ttf[1], back(P('ttf'), 7)); const stLY = st ? back(P('agsi'), 365) : null;
      out.push(sec('🔵', `Gas · TTF <b>${ttf[1].toFixed(2)} €/MWh</b>`, `<span class="${cls(w)}">${sg(w)} %</span> over a week.` + (st ? ` EU storage ${st[1].toFixed(1)} % full${stLY != null ? `, ${sg(st[1] - stLY)} points vs a year ago` : ''}${stLY != null && st[1] < stLY ? ': less buffer for the winter, a support for gas and power prices' : ''}.` : ''))); }
    // carbon
    const eua = last(P('eua'));
    if (eua) { const w = pct(eua[1], back(P('eua'), 7)); out.push(sec('🌿', `Carbon · EUA <b>${eua[1].toFixed(2)} €/t</b>`, `<span class="${cls(w)}">${sg(w)} %</span> over a week: ${word(w, 'adds to', 'takes from', 'little effect on', 1)} the cost of gas and coal plants (≈ ${(0.37 * Math.abs(eua[1] - (back(P('eua'), 7) || eua[1]))).toFixed(1)} €/MWh for a gas plant).`)); }
    // power spot
    if (sp) { const w = pct(sp.wk, sp.prev);
      out.push(sec('⚡', `Power spot · France <b>${sp.wk.toFixed(1)} €/MWh</b> over 7 days`, `${w != null && Math.abs(w) < 0.05 ? 'stable' : `<span class="${cls(w)}">${sg(w)} %</span>`} vs the week before; last day ${sp.last.avg.toFixed(1)} €/MWh (${esc(sp.last.d)})${sp.neg ? `, ${sp.neg.toFixed(sp.neg % 1 ? 1 : 0)} h of negative prices in the week` : ''}.`)); }
    // power forwards: Cal+1 France and Germany, with gas and carbon alongside
    const yrs = chain && chain.FR && chain.FR.years;
    if (yrs) { const k = Object.keys(yrs).sort()[0], s = yrs[k], ptsFR = s.dates.map((d, i) => [d, s.values[i]]);
      const fr = last(ptsFR), frW = back(ptsFR, 7), dFR = fr && frW != null ? fr[1] - frW : null;
      const de = chain.DE && chain.DE.years && chain.DE.years[k]; const ptsDE = de ? de.dates.map((d, i) => [d, de.values[i]]) : null;
      const dDE = ptsDE ? last(ptsDE)[1] - back(ptsDE, 7) : null;
      const ty = cs && cs.calYears && cs.calYears.ttf && cs.calYears.ttf[k]; const ptsT = ty ? ty.dates.map((d, i) => [d, ty.values[i]]) : null;
      const dT = ptsT ? last(ptsT)[1] - back(ptsT, 7) : null;
      const gasPart = dT != null ? dT * 2.0 : null;   // a gas plant burns ~2 MWh of gas per MWh of power
      out.push(sec('📈', `Power forwards · Cal ${k} France <b>${fr[1].toFixed(2)} €/MWh</b>`, `<span class="${cls(dFR)}">${sg(dFR, 2)} €</span> over a week${dDE != null ? `; Germany ${sg(dDE, 2)} €` : ''}.` +
        (dT != null ? ` Gas Cal ${k} ${sg(dT, 2)} €/MWh, worth about ${sg(gasPart, 1)} €/MWh on a gas plant's cost: the French move is ${Math.abs(dFR - gasPart) < 1 ? 'mostly gas' : dFR - gasPart > 0 ? 'stronger than gas alone (French fundamentals: nuclear, demand)' : 'weaker than gas alone (French fundamentals easing)'}.` : '')));
    }
    // SEFE's daily energy report (public cockpit, the forwards' source): gas and power commentaries, set against the market
    try {
      const fm = await get('fr_market.json'), mi = fm && fm.marketInsights, d = (fm && (fm.marketInsightsDate || fm.lastUpdate) || '').slice(0, 10);
      if (mi && (mi.gas || mi.power) && d) {
        const plain = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&pound;/g, '£').replace(/&euro;/g, '€').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
        const part = (name, h) => { const t = plain(h); if (!t) return ''; const sents = t.split(/(?<=\.)\s+(?=[A-Z])/); const x = { name, headline: sents[0], points: sents.slice(1) };
          return `<li><b style="color:var(--text)">${name}</b>: ${esc(x.headline)}${checkNote(x, d, S, chain)}${x.points.length ? `<details><summary class="mb-note">read on (${x.points.length} sentences)</summary><p style="margin:4px 0">${esc(x.points.join(' '))}</p></details>` : ''}</li>`; };
        out.push(sec('📰', `SEFE · daily energy report · ${new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`, '<ul>' + part('Gas', mi.gas) + part('Electricity', mi.power) + '</ul><div class="mb-note">Source: SEFE Energy, daily energy report (public cockpit).</div>'));
      }
    } catch (_) {}
    // the latest market note received by e-mail (ENGIE Energy Market News), for signed-in users: third-party text, never in the public files
    try {
      const cl = window.PKAccount && PKAccount.user && PKAccount.client && PKAccount.client();
      if (cl) { const r = await cl.from('market_note').select('source, note_date, subject, sections').order('note_date', { ascending: false }).limit(1);
        const n = r.data && r.data[0];
        if (n && (n.sections || []).length) out.push(sec('📰', `${esc(n.source)} · ${new Date(n.note_date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`,
          '<ul>' + n.sections.map(x => `<li><b style="color:var(--text)">${esc(x.name)}</b>: ${esc(x.headline)}${checkNote(x, n.note_date, S, chain)}${(x.points || []).length ? `<details><summary class="mb-note">${x.points.length} point${x.points.length > 1 ? 's' : ''}</summary><ul>${x.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}</li>`).join('') + '</ul>')); }
    } catch (_) {}
    host.innerHTML = out.length ? `<div class="mb">${out.join('')}<div class="mb-note">Moves over 7 days, latest settlements. Red = price up.</div></div>` : '<div class="fuel-note">Market data not available.</div>';
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
    PKW.register({ id: 'market-brief', kind: 'html', title: 'Energy markets · the week', category: 'intel', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'The week in energy markets, like a broker’s morning note: market-moving news, oil, gas and storage, carbon, French power spot and forwards, each with its move and what drives it.', html: brief });
    PKW.register({ id: 'next-30-days', kind: 'html', title: 'France power · the next 30 days', category: 'forwards', page: 'morning', source: 'PowerKlock', size: { w: 6, h: 8 },
      desc: 'What the coming month looks like for French power: month-ahead forward, weather week by week against normal (temperature, wind, sun), nuclear availability and gas storage, with what each means for prices.', html: next30 });
  }
  window.PKBrief = { brief, next30 };
})();
