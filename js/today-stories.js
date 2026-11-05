// ════════════════════════════════════════════════════════════════════
// today-stories.js · window.PKStories — the morning in stories, as on
// Instagram (notes 113 and 114), at the very top of Today in every view.
//   · a row of circles, one per section (prices, nuclear, wind & sun, gas
//     & CO₂, exchanges, forwards): coloured ring = not seen today, grey =
//     seen (localStorage 'pk-st-seen', per Paris day)
//   · a tap opens the viewer: one card per key figure, 5 s each, progress
//     segments on top; tap right = next, left = previous; at the end of a
//     section the next one slides in; swipe left / right = next / previous
//     section, swipe down = close; press and hold = pause (overlays hide)
//   · desktop: phone-sized (9:16) on a dimmed backdrop, ‹ › arrows, ← →,
//     Space, Esc; a click on the backdrop closes
//   · prefers-reduced-motion: no auto-advance, no transition
// The figures and sentences are the ones Today already computes (MRN.k,
// js/morning.js: tiles, « What moved », Discovery's story); no new data.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const DUR = 5000;
  const T = (fr, en) => (!window.PKI18n || PKI18n.lang !== 'en') ? fr : en;
  const N = (v, d) => v == null || !isFinite(v) ? '–' : v.toFixed(d);
  const S = (v, d) => v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '−') + N(Math.abs(v), d);
  const last = pts => pts && pts.length ? pts[pts.length - 1] : null;
  const back = (pts, days) => { if (!pts || !pts.length) return null; const t = new Date(pts[pts.length - 1][0] + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - days);
    const k = t.toISOString().slice(0, 10); let v = null; for (const [d, x] of pts) { if (d <= k) v = x; else break; } return v; };
  const since = (pts, days) => { const l = last(pts); if (!l) return []; const t = new Date(l[0] + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - days); const k = t.toISOString().slice(0, 10); return pts.filter(p => p[0] >= k).map(p => p[1]); };
  const day = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(T('fr-FR', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const B = t => '<b>' + t + '</b>';
  // tone of a move: 'up' when it pushes prices up (red), 'down' when it eases them (green); inv for a quantity whose rise lowers prices
  const tone = (d, eps, inv) => d == null || Math.abs(d) < eps ? '' : (d > 0) !== !!inv ? 'up' : 'down';

  const ICONS = {
    price: '<path d="M17 6.5A7 7 0 1 0 17 17.5"/><path d="M4 10h9M4 14h9"/>',
    nuclear: '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
    windsun: '<circle cx="17" cy="6" r="2.6"/><path d="M17 1.5v1M21.5 6h-1M20.2 2.8l-.7.7"/><path d="M2 11h11a3 3 0 1 0-3-3"/><path d="M2 15h15a3 3 0 1 1-3 3"/><path d="M2 19h6"/>',
    gas: '<path d="M12 22c4 0 7-3 7-7 0-3-2-5.5-4-7.5.2 2.5-1 4-2.5 4.5C13 9 12 5 9 2c.5 4-4 6.5-4 12 0 4.5 3 8 7 8z"/>',
    exch: '<path d="M4 8h15l-4-4"/><path d="M20 16H5l4 4"/>',
    fwd: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    why: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
    ahead: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  };
  const icon = (k, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

  // ── the sections and their cards, from the facts Today already holds ──
  function build(k) {
    // js/morning.js's helpers (global declarations of the page's scripts)
    const out = [], P = k.P, st = typeof _mrnDayStats === 'function' ? _mrnDayStats : () => null,
      mean = typeof _mrnMean === 'function' ? _mrnMean : a => { const v = (a || []).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const card = (label, big, unit, chg, ctone, sent, curve, cTone) => ({ label, big, unit, chg, tone: ctone, sent, curve: (curve || []).filter(v => v != null), cTone: cTone || ctone });
    // prices
    const sT = st(k.today), sY = st(k.yday), sM = st(k.tomorrow), H = h => T(h + ' h', String(h).padStart(2, '0') + ':00');
    const pc = [];
    if (sT) { const d = sY ? sT.base - sY.base : null;
      pc.push(card(T('Spot France · aujourd’hui', 'France spot · today'), N(sT.base, 1), '€/MWh', d == null ? '' : S(d, 1) + ' € ' + T('vs hier', 'vs yesterday'), tone(d, 0.5),
        T(`Heure la moins chère ${B(H(sT.minH))} (${N(sT.min, 1)} €), la plus chère ${B(H(sT.maxH))} (${N(sT.max, 1)} €).`, `Cheapest hour ${B(H(sT.minH))} (${N(sT.min, 1)} €), dearest ${B(H(sT.maxH))} (${N(sT.max, 1)} €).`) +
        (sT.zero ? ' ' + T(`${sT.zero} h à 0 € ou moins, quand le vent et le soleil produisent plus que la France ne consomme.`, `${sT.zero} h at 0 € or below, when wind and sun produce more than France consumes.`) : ''), k.today)); }
    if (sM) { const d = sT ? sM.base - sT.base : null;
      pc.push(card(T('Spot France · demain', 'France spot · tomorrow'), N(sM.base, 1), '€/MWh', d == null ? '' : S(d, 1) + ' € ' + T('vs aujourd’hui', 'vs today'), tone(d, 0.5),
        T(`L’heure la plus chère : ${B(H(sM.maxH))} (${N(sM.max, 0)} €).`, `The dearest hour: ${B(H(sM.maxH))} (${N(sM.max, 0)} €).`) + (sM.zero ? ' ' + T(`${sM.zero} h à 0 € ou moins.`, `${sM.zero} h at 0 € or below.`) : ''), k.tomorrow)); }
    else if (k.fc && k.fc.price) { const m = mean(k.fc.price), d = sT && m != null ? m - sT.base : null;
      pc.push(card(T('Demain · prévision', 'Tomorrow · forecast'), '≈ ' + N(m, 0), '€/MWh', d == null ? '' : S(d, 0) + ' € ' + T('vs aujourd’hui', 'vs today'), tone(d, 0.5),
        T('Le prix de demain sort vers 13 h ; d’ici là, la prévision PowerKlock.', 'Tomorrow’s price comes out around 13:00; until then, the PowerKlock forecast.'), k.fc.price)); }
    if (pc.length) out.push({ id: 'price', name: T('Prix', 'Prices'), icon: 'price', cards: pc });
    // nuclear: more available lowers prices
    const nu = P('fr_nuc_avail'), nl = last(nu), nf = last(P('fr_nuc_avail_fc'));
    if (nl) { const b7 = back(nu, 7), d = b7 != null ? (nl[1] - b7) / 1000 : null;
      out.push({ id: 'nuclear', name: T('Nucléaire', 'Nuclear'), icon: 'nuclear', cards: [card(T('Nucléaire disponible', 'Nuclear available'), N(nl[1] / 1000, 1), 'GW', d == null ? '' : S(d, 1) + ' GW ' + T('sur 7 jours', 'over 7 days'), tone(d, 0.3, true),
        (nf ? (nf[1] - nl[1] > 1500 ? T(`${N((nf[1] - nl[1]) / 1000, 1)} GW de moins que ce qu’annonçait l’exploitant : il faut plus de gaz, ce qui pousse les prix vers le haut. `, `${N((nf[1] - nl[1]) / 1000, 1)} GW less than the operator announced: more gas is needed, which pushes prices up. `) : T('En ligne avec ce qu’annonçait l’exploitant. ', 'In line with what the operator announced. ')) : '') +
        T('Le nucléaire fait l’essentiel de la production française : chaque réacteur compte.', 'Nuclear makes most of France’s power: every reactor counts.'), since(nu, 60))] }); }
    // wind and sun, the last published day of RTE éCO2mix: more output lowers prices
    const rows = ((k.rted && k.rted.rows) || []).filter(r => r.windAvg != null), R = last(rows), R0 = rows[rows.length - 2];
    if (R) { const ws = [], m30 = f => mean(rows.slice(-31, -1).map(r => r[f]));
      [['windAvg', T('Éolien', 'Wind'), T('Plus de vent, moins de gaz appelé : les prix baissent.', 'More wind, less gas needed: prices fall.'), '#14D3A9'],
        ['solarAvg', T('Solaire', 'Solar'), T('Le soleil pèse surtout à midi, où il fait baisser le prix des heures pleines.', 'Sun weighs mostly at midday, where it lowers the price of those hours.'), '#FBBF24']].forEach(([f, n, why, col]) => {
        if (R[f] == null) return; const d = R0 && R0[f] != null ? (R[f] - R0[f]) / 1000 : null, a = m30(f);
        ws.push(card(n + ' · ' + T('moyenne du ', 'average of ') + day(R.d), N(R[f] / 1000, 1), 'GW', d == null ? '' : S(d, 1) + ' GW ' + T('vs la veille', 'vs the day before'), tone(d, 0.2, true),
          (a ? T(`Moyenne des 30 jours précédents : ${B(N(a / 1000, 1) + ' GW')}. `, `Average of the 30 days before: ${B(N(a / 1000, 1) + ' GW')}. `) : '') + why, rows.slice(-30).map(r => r[f] / 1000), col)); });
      if (ws.length) out.push({ id: 'windsun', name: T('Vent & soleil', 'Wind & sun'), icon: 'windsun', cards: ws }); }
    // gas and CO₂
    const gc = [], ttf = P('ttf'), tl = last(ttf), eua = P('eua'), el = last(eua), ag = P('agsi'), al = last(ag);
    if (tl) { const b = back(ttf, 7), c = b ? (tl[1] / b - 1) * 100 : null;
      gc.push(card(T('Gaz TTF', 'TTF gas'), N(tl[1], 1), '€/MWh', c == null ? '' : S(c, 1) + ' % ' + T('sur 7 jours', 'over 7 days'), tone(c, 0.5),
        T(`Quand le vent et le soleil manquent, les centrales au gaz fixent le prix de l’électricité : à ce niveau, une centrale coûte environ ${B(N(tl[1] / 0.55, 0) + ' €')} par MWh produit, avant le CO₂.`, `When wind and sun are short, gas plants set the power price: at this level a plant costs about ${B(N(tl[1] / 0.55, 0) + ' €')} per MWh produced, before CO₂.`), since(ttf, 60))); }
    if (el) { const b = back(eua, 7), c = b ? (el[1] / b - 1) * 100 : null;
      gc.push(card(T('CO₂ · EUA', 'CO₂ · EUA'), N(el[1], 1), '€/t', c == null ? '' : S(c, 1) + ' % ' + T('sur 7 jours', 'over 7 days'), tone(c, 0.5),
        T(`Le droit d’émettre une tonne de CO₂. Il ajoute environ ${B(N(0.37 * el[1], 0) + ' €')} au coût d’un MWh produit au gaz.`, `The right to emit one tonne of CO₂. It adds about ${B(N(0.37 * el[1], 0) + ' €')} to the cost of a MWh made from gas.`), since(eua, 60))); }
    if (al) { const ly = back(ag, 365), d = ly != null ? al[1] - ly : null;
      gc.push(card(T('Stocks de gaz UE', 'EU gas storage'), N(al[1], 1), '%', d == null ? '' : S(d, 1) + ' pts ' + T('sur un an', 'on a year'), tone(d, 0.5, true),
        d != null && d < 0 ? T('Moins de gaz en stock qu’il y a un an : moins de marge avant l’hiver.', 'Less gas in storage than a year ago: less margin before winter.') : T('Les stocks font la marge de l’Europe pour l’hiver.', 'Storage is Europe’s margin for the winter.'), since(ag, 60))); }
    if (gc.length) out.push({ id: 'gas', name: T('Gaz & CO₂', 'Gas & CO₂'), icon: 'gas', cards: gc });
    // exchanges and consumption, the last published day: more imports or more demand push prices up
    const xr = ((k.rted && k.rted.rows) || []).filter(r => r.exchAvg != null), X = last(xr), X0 = xr[xr.length - 2];
    if (X) { const xc = [], d = X0 ? (X.exchAvg - X0.exchAvg) / 1000 : null;
      xc.push(card(T('Solde des échanges · ', 'Net exchanges · ') + day(X.d), N(X.exchAvg / 1000, 1), 'GW', d == null ? '' : S(d, 1) + ' GW ' + T('vs la veille', 'vs the day before'), tone(d, 0.3),
        X.exchAvg < 0 ? T('Négatif : la France exporte plus qu’elle n’importe.', 'Negative: France exports more than it imports.') : T('Positif : la France importe plus qu’elle n’exporte.', 'Positive: France imports more than it exports.'), xr.slice(-30).map(r => r.exchAvg / 1000)));
      if (X.loadAvg != null) { const dl = X0 && X0.loadAvg != null ? (X.loadAvg - X0.loadAvg) / 1000 : null;
        xc.push(card(T('Consommation · ', 'Consumption · ') + day(X.d), N(X.loadAvg / 1000, 1), 'GW', dl == null ? '' : S(dl, 1) + ' GW ' + T('vs la veille', 'vs the day before'), tone(dl, 0.3),
          T(`Pointe à ${B(N(X.loadMax / 1000, 1) + ' GW')}. Plus de consommation, plus de centrales appelées : les prix montent.`, `Peak at ${B(N(X.loadMax / 1000, 1) + ' GW')}. More demand, more plants called: prices rise.`), xr.slice(-30).map(r => r.loadAvg / 1000))); }
      out.push({ id: 'exch', name: T('Échanges', 'Exchanges'), icon: 'exch', cards: xc }); }
    // forwards
    const fc = [];
    (k.cals || []).slice(0, 2).forEach((c, i) => { const l = last(c.pts); if (!l) return; const b = back(c.pts, 7), d = b != null ? l[1] - b : null;
      let sent = T(`Un MWh livré toute l’année ${c.y}, acheté aujourd’hui. C’est le prix auquel entreprises et fournisseurs se couvrent ; il suit surtout le gaz de l’an prochain.`, `A MWh delivered all through ${c.y}, bought today. It is the price companies and suppliers hedge at; it follows next year’s gas above all.`);
      const ty = i === 0 && k.cs && k.cs.calYears && k.cs.calYears.ttf && k.cs.calYears.ttf[c.y];
      if (ty) { const tP = ty.dates.map((x, j) => [x, ty.values[j]]), tb = back(tP, 7), tl2 = last(tP); if (tb != null && tl2) sent += ' ' + T(`Le gaz seul pèserait ${B('≈ ' + S(2 * (tl2[1] - tb), 1) + ' €')} sur la semaine.`, `Gas alone would weigh ${B('≈ ' + S(2 * (tl2[1] - tb), 1) + ' €')} on the week.`); }
      fc.push(card('Cal ' + c.y + ' · France', N(l[1], 1), '€/MWh', d == null ? '' : S(d, 1) + ' € ' + T('sur 7 jours', 'over 7 days'), tone(d, 0.3), sent, since(c.pts, 60))); });
    if (fc.length) out.push({ id: 'fwd', name: T('Forwards', 'Forwards'), icon: 'fwd', cards: fc });
    // why it moves: the market notes' points (France first), one card each, right after the prices
    const esc = window.PK && PK.esc ? PK.esc : x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const isEn = !((!window.PKI18n || PKI18n.lang !== 'en'));
    const ctx = (k.ctx || []).filter(c => c && c.text).slice(0, 4);
    if (ctx.length) {
      const why = { id: 'why', name: T('Pourquoi', 'Why'), icon: 'why', cards: ctx.map(c => ({ kind: 'text', label: esc(isEn ? (c.topic_en || c.topic) : c.topic) + ' · ' + T('ce qui a bougé', 'what moved'),
        tone: c.tone === 'up' ? 'up' : c.tone === 'down' ? 'down' : '', sent: esc(isEn ? (c.text_en || c.text) : c.text) })) };
      const ip = out.findIndex(x => x.id === 'price'); out.splice(ip + 1, 0, why);
    }
    // the week ahead: the market notes' call for each market
    const LK = k.look || {}, MK = [['power', T('Électricité', 'Power')], ['gas', T('Gaz', 'Gas')], ['oil', T('Pétrole', 'Oil')], ['carbon', 'CO₂']].filter(([m]) => LK[m] && LK[m].tone);
    if (MK.length) out.push({ id: 'ahead', name: T('À venir', 'Ahead'), icon: 'ahead', cards: [{ kind: 'list', label: T('La semaine à venir · notes de marché', 'The week ahead · market notes'),
      items: MK.map(([m, n]) => ({ n, tone: LK[m].tone, text: esc(isEn ? (LK[m].text_en || LK[m].text) : LK[m].text) })) }] });
    return out;
  }

  // ── seen today ──
  const seenGet = () => { try { const o = JSON.parse(localStorage.getItem('pk-st-seen') || 'null'); return o && o.d === today() ? o.s : []; } catch (_) { return []; } };
  const seenAdd = id => { const s = seenGet(); if (!s.includes(id)) s.push(id); try { localStorage.setItem('pk-st-seen', JSON.stringify({ d: today(), s })); } catch (_) {} };

  let SEC = [], V = null;
  function render(k, host) {
    host = host || document.getElementById('mrn-stories'); if (!host) return;
    SEC = build(k); const seen = seenGet();
    if (!SEC.length) { host.hidden = true; return; }
    host.hidden = false; host.setAttribute('aria-label', T('Stories du matin', 'Morning stories'));
    host.innerHTML = SEC.map((s, i) => `<button type="button" class="pk-st-c" role="listitem" data-i="${i}" aria-label="${T('Voir la story', 'View the story')} ${s.name}${seen.includes(s.id) ? ' (' + T('vue', 'seen') + ')' : ''}">` +
      `<span class="pk-st-ring${seen.includes(s.id) ? ' seen' : ''}"><span class="pk-st-in">${icon(s.icon, 24)}</span></span><span class="pk-st-l">${s.name}</span></button>`).join('');
    host.querySelectorAll('.pk-st-c').forEach(b => b.addEventListener('click', () => open(+b.dataset.i, b)));
  }
  function refreshRings() {
    const seen = seenGet();
    document.querySelectorAll('#mrn-stories .pk-st-c').forEach(b => { const s = SEC[+b.dataset.i]; if (s) b.querySelector('.pk-st-ring').classList.toggle('seen', seen.includes(s.id)); });
  }

  // ── the viewer ──
  function spark(vals, t) {
    if (vals.length < 2) return '';
    const W = 100, H = 40, lo = Math.min(...vals), hi = Math.max(...vals), sx = W / (vals.length - 1), sy = v => H - 3 - (v - lo) / ((hi - lo) || 1) * (H - 6);
    const col = t === 'up' ? 'var(--down,#ED6965)' : t === 'down' ? 'var(--up,#14D3A9)' : t && t[0] === '#' ? t : '#B8C9D9';
    const pts = vals.map((v, i) => (i * sx).toFixed(2) + ',' + sy(v).toFixed(2)).join(' ');
    return `<svg class="pk-stv-sp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${H} ${pts} ${W},${H}" fill="${col}" fill-opacity=".1"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function open(si, opener) {
    if (!SEC[si]) return;
    if (!V) mount();
    V.opener = opener || null; V.si = si; V.ci = 0;
    V.el.hidden = false; document.documentElement.classList.add('pk-stv-open');
    show('none'); V.el.querySelector('.pk-stv-x').focus({ preventScroll: true });
  }
  function close() {
    if (!V || V.el.hidden) return;
    V.el.hidden = true; V.el.classList.remove('paused', 'held'); document.documentElement.classList.remove('pk-stv-open');
    refreshRings(); if (V.opener) try { V.opener.focus({ preventScroll: true }); } catch (_) {}
  }
  function show(dir) {
    const s = SEC[V.si], c = s.cards[V.ci], st = V.el.querySelector('.pk-stv-stage');
    seenAdd(s.id);
    V.el.querySelector('.pk-stv-bars').innerHTML = s.cards.map((_, i) => `<span class="pk-stv-seg"><i class="${i < V.ci ? 'done' : i === V.ci ? 'run' : ''}"></i></span>`).join('');
    V.el.querySelector('.pk-stv-av').innerHTML = icon(s.icon, 16);
    V.el.querySelector('.pk-stv-name').textContent = s.name;
    const cl = c.tone === 'up' ? 'up' : c.tone === 'down' ? 'dn' : '';
    const body = V.el.querySelector('.pk-stv-body'), tok = V.tok = (V.tok || 0) + 1;
    body.classList.remove('go');
    const chip = t => `<span class="pk-stv-chip ${t === 'up' ? 'up' : t === 'down' ? 'dn' : ''}">${t === 'up' ? '↑ ' + T('haussier', 'bullish') : t === 'down' ? '↓ ' + T('baissier', 'bearish') : '→ ' + T('neutre', 'neutral')}</span>`;
    let words0 = 1500;
    if (c.kind === 'text') {          // a market note's point: what moved, and its direction
      body.innerHTML = `<div class="pk-stv-lab a" style="--d:0ms">${c.label}</div><div class="a" style="--d:250ms;margin:12px 0 4px">${chip(c.tone)}</div><p class="pk-stv-sent pk-stv-big-sent">${c.sent}</p>`;
      words0 = 600;
    } else if (c.kind === 'list') {   // the week ahead, market by market, one after the other
      body.innerHTML = `<div class="pk-stv-lab a" style="--d:0ms">${c.label}</div>` + c.items.map((it, i) => `<div class="pk-stv-row a" style="--d:${400 + i * 900}ms"><div class="pk-stv-rh"><b>${it.n}</b>${chip(it.tone)}</div><div class="pk-stv-rt">${it.text}</div></div>`).join('');
      words0 = -1;
    } else {
      // the figure counts from where it was (the change tells by how much) to where it is
      const m = String(c.big).match(/^(\D*?)(-?\d+(?:\.(\d+))?)/), cv = c.chg ? parseFloat(String(c.chg).replace('−', '-').replace(/^\+/, '')) : null;
      const num = m ? parseFloat(m[2]) : null, dec = m && m[3] ? m[3].length : 0;
      const from = num == null ? null : cv == null || !isFinite(cv) ? 0 : /%/.test(c.chg.split(' ')[1] || '') ? num / (1 + cv / 100) : num - cv;
      body.innerHTML = `<div class="pk-stv-lab a" style="--d:0ms">${c.label}</div><div class="pk-stv-big a" style="--d:150ms">${m ? m[1] : ''}<span class="pk-stv-num" translate="no">${m ? m[2] : c.big}</span><small>${c.unit}</small></div>` +
        // the arrow says the direction of the figure, the colour its effect on prices (red pushes them up, green eases them)
        (c.chg ? `<div class="pk-stv-chg ${cl} a pop" style="--d:1250ms">${c.chg[0] === '+' ? '▲ ' : c.chg[0] === '−' ? '▼ ' : ''}${c.chg}</div>` : '') + spark(c.curve, c.cTone) + `<p class="pk-stv-sent">${c.sent}</p>`;
      const el = body.querySelector('.pk-stv-num');
      if (num != null && !reduced()) {
        const fmt = v => (!window.PKI18n || PKI18n.lang !== 'en') ? v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
        const t0 = performance.now() + 250, dur = 900; el.textContent = fmt(from);
        const step = now => { if (V.tok !== tok) return; const x = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - x, 3);
          el.textContent = fmt(from + (num - from) * e); if (x < 1) requestAnimationFrame(step); else { el.classList.add('punch'); } };
        requestAnimationFrame(step);
      }
    }
    // the sentence comes in word by word (the words inside its bold parts too)
    let nw = 0;
    if (words0 >= 0) body.querySelectorAll('.pk-stv-sent').forEach(p => {
      const walk = n => [...n.childNodes].forEach(ch => {
        if (ch.nodeType === 3) { const frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(w => { if (!w) return; if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
            const sp = document.createElement('span'); sp.className = 'w'; sp.style.setProperty('--d', (words0 + nw++ * 75) + 'ms'); sp.textContent = w; frag.appendChild(sp); });
          ch.replaceWith(frag); }
        else if (ch.nodeType === 1) walk(ch); });
      walk(p); });
    // the card stays as long as it takes to read it
    const listWords = c.kind === 'list' ? c.items.reduce((a, it) => a + String(it.text).split(/\s+/).length, 0) : 0;
    V.dur = Math.min(14000, Math.max(4500, c.kind === 'list' ? 1500 + c.items.length * 900 + listWords * 55 : words0 + nw * 75 + 2200));
    void body.offsetWidth; body.classList.add('go');
    V.el.querySelector('.pk-stv-count').textContent = (V.ci + 1) + ' / ' + s.cards.length;
    V.el.querySelector('.pk-stv-prev').disabled = V.si === 0 && V.ci === 0;
    st.setAttribute('aria-label', s.name + ' · ' + c.label);
    st.classList.remove('in-next', 'in-prev'); void st.offsetWidth;
    if (dir !== 'none' && !reduced()) st.classList.add(dir === 'prev' ? 'in-prev' : 'in-next');
    const run = V.el.querySelector('.pk-stv-seg i.run');
    run.style.animationDuration = V.dur + 'ms';
    if (reduced()) run.classList.add('done');
    else run.addEventListener('animationend', () => { if (!V.el.hidden) next(); }, { once: true });
  }
  function next() { const s = SEC[V.si]; if (V.ci < s.cards.length - 1) { V.ci++; show('card'); } else nextSec(); }
  function prev() { if (V.ci > 0) { V.ci--; show('card'); } else if (V.si > 0) { V.si--; V.ci = SEC[V.si].cards.length - 1; show('prev'); } else show('card'); }
  function nextSec() { if (V.si < SEC.length - 1) { V.si++; V.ci = 0; show('next'); } else close(); }
  function prevSec() { if (V.si > 0) { V.si--; V.ci = 0; show('prev'); } else { V.ci = 0; show('card'); } }
  const PAUSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
  function pause(on) { const b = V.el.querySelector('.pk-stv-pause'); V.el.classList.toggle('paused', on); b.setAttribute('aria-pressed', on); b.innerHTML = on ? PLAY : PAUSE; b.setAttribute('aria-label', on ? T('Reprendre', 'Resume') : T('Pause', 'Pause')); }

  function mount() {
    const el = document.createElement('div');
    el.className = 'pk-stv'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', T('Stories du matin', 'Morning stories'));
    el.innerHTML = `<button type="button" class="pk-stv-arr pk-stv-prev" aria-label="${T('Précédent', 'Previous')}">‹</button>` +
      `<div class="pk-stv-stage" aria-live="polite"><div class="pk-stv-bars" aria-hidden="true"></div>` +
      `<div class="pk-stv-hd"><span class="pk-stv-av"></span><b class="pk-stv-name"></b><span class="pk-stv-when">· ${T('ce matin', 'this morning')}</span><span class="pk-stv-count"></span>` +
      `<button type="button" class="pk-stv-pause" aria-pressed="false" aria-label="${T('Pause', 'Pause')}">${PAUSE}</button><button type="button" class="pk-stv-x" aria-label="${T('Fermer', 'Close')}">✕</button></div>` +
      `<div class="pk-stv-body"></div><div class="pk-stv-hint" aria-hidden="true"><span>‹ ${T('précédent', 'previous')}</span><span>${T('maintenir : pause', 'hold: pause')}</span><span>${T('suivant', 'next')} ›</span></div></div>` +
      `<button type="button" class="pk-stv-arr pk-stv-next" aria-label="${T('Suivant', 'Next')}">›</button>`;
    document.body.appendChild(el);
    V = { el };
    const stage = el.querySelector('.pk-stv-stage');
    el.querySelector('.pk-stv-x').addEventListener('click', close);
    el.querySelector('.pk-stv-prev').addEventListener('click', prev);
    el.querySelector('.pk-stv-next').addEventListener('click', next);
    el.querySelector('.pk-stv-pause').addEventListener('click', () => pause(!el.classList.contains('paused')));
    // the backdrop: only a press that starts and ends on it (a tap on the card re-renders it, and the browser then aims its click at the backdrop)
    let bd = false;
    el.addEventListener('pointerdown', e => { bd = e.target === el; });
    el.addEventListener('click', e => { if (e.target === el && bd) close(); bd = false; });
    // taps, holds and swipes on the card
    let P0 = null, hold = null;
    stage.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      P0 = { x: e.clientX, y: e.clientY, held: false, id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      clearTimeout(hold); hold = setTimeout(() => { if (P0) { P0.held = true; el.classList.add('paused', 'held'); } }, 220);
    });
    const end = (e, cancel) => {
      clearTimeout(hold); if (!P0) return; const p = P0; P0 = null;
      if (p.held) { el.classList.remove('held'); if (!el.querySelector('.pk-stv-pause[aria-pressed="true"]')) el.classList.remove('paused'); return; }
      if (cancel) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (dy > 70 && dy > Math.abs(dx)) { close(); return; }
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) nextSec(); else prevSec(); return; }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) { const r = stage.getBoundingClientRect(); if (e.clientX - r.left < r.width / 3) prev(); else next(); }
    };
    stage.addEventListener('pointerup', e => end(e, false));
    stage.addEventListener('pointercancel', e => end(e, true));
    stage.addEventListener('contextmenu', e => e.preventDefault());   // a long press is a pause, not a menu
    document.addEventListener('keydown', e => {
      if (!V || el.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === ' ' || e.key === 'Spacebar') { if (e.target.closest && e.target.closest('button') && e.target !== el.querySelector('.pk-stv-x')) return; e.preventDefault(); pause(!el.classList.contains('paused')); }
      else if (e.key === 'Tab') {   // keep the focus inside the viewer
        const f = [...el.querySelectorAll('button:not([disabled])')].filter(b => b.offsetParent !== null); if (!f.length) return;
        const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    });
  }

  const css = document.createElement('style');
  css.textContent = `
  .pk-stories{display:flex;gap:14px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;padding:10px 2px 6px;margin:0 0 6px;-webkit-overflow-scrolling:touch}
  .pk-stories::-webkit-scrollbar{display:none}
  .pk-st-c{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:5px;width:72px;background:none;border:0;padding:0;cursor:pointer;color:var(--text2,#B8C9D9);font:500 11px/1.25 inherit;text-align:center}
  .pk-st-ring{display:block;width:62px;height:62px;border-radius:50%;padding:3px;box-sizing:border-box;background:conic-gradient(from 210deg,#F4B740,#ED6965,#7FC8F8,#F4B740)}
  .pk-st-ring.seen{background:#2a3644}
  .pk-st-in{display:flex;width:100%;height:100%;border-radius:50%;box-sizing:border-box;align-items:center;justify-content:center;background:var(--bg2,#111821);border:3px solid var(--bg,#0b1016);color:var(--text,#E6EDF3)}
  .pk-st-c:hover .pk-st-in{color:#F4B740}.pk-st-c:focus-visible{outline:none}.pk-st-c:focus-visible .pk-st-ring{box-shadow:0 0 0 2px #7FC8F8}
  .pk-st-l{display:block;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  html.pk-stv-open,html.pk-stv-open body{overflow:hidden}
  html.pk-stv-open .es-hotspot,html.pk-stv-open .es-gamespot,html.pk-stv-open .es-volleyspot{display:none!important}
  .pk-stv{position:fixed;inset:0;z-index:10050;background:rgba(3,6,10,.86);display:flex;align-items:center;justify-content:center;gap:18px}
  .pk-stv[hidden]{display:none}
  .pk-stv-stage{position:relative;height:min(92vh,860px);aspect-ratio:9/16;max-width:100vw;background:linear-gradient(180deg,#121b26,#0b1016 70%);border:1px solid #243140;border-radius:16px;overflow:hidden;padding:12px 16px 16px;box-sizing:border-box;display:flex;flex-direction:column;color:#E6EDF3;touch-action:none;user-select:none;-webkit-user-select:none;transform-origin:center;backface-visibility:hidden}
  .pk-stv-stage.in-next{animation:pkStNext .38s cubic-bezier(.2,.7,.2,1)} .pk-stv-stage.in-prev{animation:pkStPrev .38s cubic-bezier(.2,.7,.2,1)}
  @keyframes pkStNext{from{transform:perspective(1400px) translateX(55%) rotateY(-55deg);opacity:.35}to{transform:none;opacity:1}}
  @keyframes pkStPrev{from{transform:perspective(1400px) translateX(-55%) rotateY(55deg);opacity:.35}to{transform:none;opacity:1}}
  .pk-stv-bars{display:flex;gap:4px;margin-bottom:10px}
  .pk-stv-seg{flex:1;height:3px;border-radius:2px;background:rgba(230,237,243,.25);overflow:hidden}
  .pk-stv-seg i{display:block;height:100%;width:0;background:#E6EDF3}
  .pk-stv-seg i.done{width:100%} .pk-stv-seg i.run{animation:pkStFill ${DUR}ms linear forwards}
  .pk-stv.paused .pk-stv-seg i.run{animation-play-state:paused}
  @keyframes pkStFill{from{width:0}to{width:100%}}
  .pk-stv-hd{display:flex;align-items:center;gap:8px;font-size:13px;min-height:32px}
  .pk-stv-av{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;flex:0 0 auto;background:radial-gradient(#111821 58%,transparent 60%),conic-gradient(from 210deg,#F4B740,#ED6965,#7FC8F8,#F4B740)}
  .pk-stv-when{color:#8A9BAD;white-space:nowrap}.pk-stv-count{margin-left:auto;color:#8A9BAD;font:500 11px 'JetBrains Mono',monospace}
  .pk-stv-hd button{background:none;border:0;color:#E6EDF3;font-size:16px;line-height:1;width:34px;height:34px;border-radius:50%;cursor:pointer;flex:0 0 auto}
  .pk-stv-hd button:hover,.pk-stv-hd button:focus-visible{background:rgba(230,237,243,.12);outline:none}
  .pk-stv-hd button svg{display:block;margin:auto}
  .pk-stv-body{flex:1;display:flex;flex-direction:column;justify-content:center;padding:6px 2px 24px;min-height:0}
  .pk-stv-lab{font-size:14px;color:#B8C9D9;text-transform:none}
  .pk-stv-big{font:600 clamp(34px,9vh,56px)/1.1 'JetBrains Mono',monospace;margin:10px 0 6px;letter-spacing:-.02em;white-space:nowrap}
  .pk-stv-big small{font-size:.32em;color:#8A9BAD;font-weight:500;margin-left:6px;letter-spacing:0}
  .pk-stv-chg{font:600 14px 'JetBrains Mono',monospace;color:#B8C9D9}.pk-stv-chg.up{color:var(--down,#ED6965)}.pk-stv-chg.dn{color:var(--up,#14D3A9)}
  .pk-stv-sp{width:100%;height:clamp(80px,18vh,150px);margin:18px 0 6px}
  .pk-stv-sent{font-size:15px;line-height:1.55;color:#C9D6E2;margin:10px 0 0}.pk-stv-sent b{color:#fff}
  .pk-stv-big-sent{font-size:19px;line-height:1.5;color:#E6EDF3}
  .pk-stv-chip{display:inline-block;font:600 12px 'JetBrains Mono',monospace;padding:3px 9px;border-radius:99px;background:rgba(184,201,217,.12);color:#B8C9D9}
  .pk-stv-chip.up{background:rgba(237,105,101,.16);color:#ED6965}.pk-stv-chip.dn{background:rgba(20,211,169,.14);color:#14D3A9}
  .pk-stv-row{margin-top:16px;padding-left:10px;border-left:3px solid #243140}.pk-stv-rh{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:15px}
  .pk-stv-rt{font-size:13.5px;line-height:1.5;color:#C9D6E2;margin-top:5px}
  /* the card plays: each part comes in on its own beat (--d), the figure lands with a punch, the curve draws itself */
  .pk-stv-body .a{opacity:0;transform:translateY(10px)}
  .pk-stv-body.go .a{animation:pkStA .5s cubic-bezier(.2,.8,.2,1) var(--d,0ms) forwards}
  .pk-stv-body.go .a.pop{animation:pkStPop .5s cubic-bezier(.3,1.6,.5,1) var(--d,0ms) forwards}
  .pk-stv-body .w{opacity:0;filter:blur(4px)}
  .pk-stv-body.go .w{animation:pkStW .4s ease var(--d,0ms) forwards}
  .pk-stv-num{display:inline-block}.pk-stv-num.punch{animation:pkStPunch .45s cubic-bezier(.3,1.6,.5,1)}
  .pk-stv-sp{clip-path:inset(0 100% 0 0)}
  .pk-stv-body.go .pk-stv-sp{animation:pkStClip 1.3s cubic-bezier(.4,.1,.2,1) .6s forwards}
  @keyframes pkStA{to{opacity:1;transform:none}}
  @keyframes pkStPop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:none}}
  @keyframes pkStW{to{opacity:1;filter:none}}
  @keyframes pkStPunch{40%{transform:scale(1.12)}100%{transform:none}}
  @keyframes pkStClip{to{clip-path:inset(0 0 0 0)}}
  .pk-stv.paused .pk-stv-body *{animation-play-state:paused}
  .pk-stv-hint{position:absolute;left:16px;right:16px;bottom:10px;display:flex;justify-content:space-between;font-size:10px;color:#5d7083;pointer-events:none}
  .pk-stv.held .pk-stv-hd,.pk-stv.held .pk-stv-bars,.pk-stv.held .pk-stv-hint,.pk-stv.held .pk-stv-arr{opacity:0;transition:opacity .15s}
  .pk-stv-arr{width:44px;height:44px;border-radius:50%;border:0;background:rgba(230,237,243,.14);color:#E6EDF3;font-size:26px;line-height:1;cursor:pointer;flex:0 0 auto}
  .pk-stv-arr:hover,.pk-stv-arr:focus-visible{background:rgba(230,237,243,.26);outline:none}.pk-stv-arr:disabled{opacity:.3;cursor:default}
  @media (max-width:640px),(max-aspect-ratio:3/4){.pk-stv{background:#0b1016}.pk-stv-arr{display:none}
    .pk-stv-stage{width:100vw;height:100vh;height:100dvh;aspect-ratio:auto;border:0;border-radius:0;padding-top:max(10px,env(safe-area-inset-top))}}
  @media (prefers-reduced-motion:reduce){.pk-stv-stage.in-next,.pk-stv-stage.in-prev,.pk-stv-seg i.run{animation:none}.pk-stv-seg i.run{width:100%}
    .pk-stv-body .a,.pk-stv-body .w{opacity:1;transform:none;filter:none;animation:none!important}.pk-stv-sp{clip-path:none;animation:none!important}}
  `;
  document.head.appendChild(css);

  window.PKStories = { render, open, close, _build: build };
})();
