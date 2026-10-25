// ════════════════════════════════════════════════════════════════════
// today-widgets.js · the Today blocks in the chart catalogue
// ────────────────────────────────────────────────────────────────────
// Every block of Today (Quick look, Discovery, Expert) registered as a
// PKW widget, so a dashboard can hold it and the three Today views exist
// as dashboard templates (js/dashboard.js 'today-quick', 'today-learn',
// 'today-expert'). The widgets call the same functions as the Today page
// (js/morning.js) and share one fetch of its figures (_mrnFactsP).
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.PKW || typeof _mrnFactsP !== 'function') return;
  const SRC = 'ENTSO-E · SEFE · RTE · PowerKlock';
  let seq = 0;
  const nid = p => 'tdw-' + p + '-' + (++seq);
  const fail = host => { host.innerHTML = '<div class="fuel-note">' + _mT('Indisponible pour le moment.', 'Not available right now.') + '</div>'; };
  // html widget: the Today figures, then fn(host, k); a failed fetch says so in the card
  const withK = fn => async (host, p) => { let k; try { k = await _mrnFactsP(); } catch (e) { fail(host); return; } return fn(host, k, p); };
  const R = def => PKW.register(Object.assign({ category: 'today', page: 'morning', source: SRC }, def));

  // ── Quick look ──
  R({ id: 'today-spot', title: 'France spot · today and tomorrow', size: { w: 7, h: 5 },
    desc: 'Day-ahead price hour by hour over 48 hours; tomorrow hatched with the PowerKlock forecast until its price is published (around 13:00).',
    params: [{ key: 'detail', label: 'Negative-price chance', options: [['no', 'Hidden'], ['yes', 'Shown']] }], defaults: { detail: 'no' },
    async draw(cid, p) { const k = await _mrnFactsP(); _mrnSpotChart(k, cid, p.detail === 'yes');
      return { sub: k.tomorrow ? _mT('Demain publié', 'Tomorrow published') : _mT('Demain : prévision jusqu’à la publication vers 13 h', 'Tomorrow: forecast until it is published around 13:00') }; } });
  R({ id: 'today-days', kind: 'html', title: 'France spot · the day in figures', size: { w: 12, h: 2 },
    desc: 'Today and tomorrow: base, peak, lowest and highest hour, hours at 0 € or below, against the day before.',
    html: withK((host, k) => { host.innerHTML = '<div class="mrn3-days"></div>'; _mrnSpot(k, host.firstChild); }) });
  R({ id: 'today-moved', kind: 'html', title: 'What moved', size: { w: 5, h: 5 },
    desc: 'One line per market: spot, forwards against gas, gas storage, oil, nuclear against the operator forecast.',
    html: withK((host, k) => { host.innerHTML = '<ul class="mrn3-lines"></ul>'; _mrnQuick(k, host.firstChild); }) });
  R({ id: 'today-tiles', kind: 'html', title: 'Today · key prices', size: { w: 12, h: 3 },
    desc: 'Cal+1 France, TTF, EUA, Brent, renewable GO and nuclear available: the move on the day and on 7 days, 60-day curve; a click opens it full size.',
    html: withK((host, k) => { host.innerHTML = '<div class="mrn2-tiles mrn3-tiles">' + _mrnTileList(k).join('') + '</div>'; }) });

  // ── Discovery ──
  R({ id: 'today-sentence', kind: 'html', title: 'The day in one sentence', size: { w: 12, h: 2 },
    desc: 'Whether power is cheap or expensive today, and why next year’s price moves.',
    html: withK((host, k) => { host.innerHTML = '<p class="mrn3-sent"></p>'; _mrnLearn(k, { sent: host.firstChild }); }) });
  R({ id: 'today-tiles-explained', kind: 'html', title: 'Three prices, explained', size: { w: 12, h: 4 },
    desc: 'Cal+1, gas and nuclear available, each with one line on what it is and why it matters.',
    html: withK((host, k) => { host.innerHTML = '<div class="mrn3-ltiles"></div>'; _mrnLearnTiles(_mrnTileList(k), host.firstChild); }) });
  R({ id: 'today-hours', kind: 'html', title: 'Today’s price hour by hour', size: { w: 6, h: 6 },
    desc: 'France day-ahead today, hours at 0 € or below in green, expensive hours in red, with a line on why.',
    html: withK((host, k) => { const cid = nid('hours');
      host.innerHTML = `<div style="position:relative;height:calc(100% - 46px);min-height:160px"><canvas id="${cid}" style="width:100%;height:100%"></canvas></div><div class="fuel-note"></div>`;
      _mrnLearn(k, { day: cid, note: host.lastChild }); }) });
  R({ id: 'today-means', kind: 'html', title: 'What it means', size: { w: 6, h: 6 },
    desc: 'For a solar park, a wind park, a power purchase and the nuclear fleet.',
    html: withK((host, k) => { host.innerHTML = '<div class="mrn3-learn"></div>'; _mrnLearn(k, { means: host.firstChild }); }) });
  R({ id: 'today-glossary', kind: 'html', title: 'Glossary', size: { w: 12, h: 3 },
    desc: 'Spot, Cal, TTF, EUA, guarantee of origin, capture rate in one line each.',
    html: withK((host, k) => { host.innerHTML = '<dl class="mrn3-gloss"></dl>'; _mrnLearn(k, { gloss: host.firstChild }); }) });

  // ── Expert ──
  R({ id: 'today-weeks', kind: 'html', title: 'The next 4 weeks · France', size: { w: 12, h: 4 }, source: 'Open-Meteo · AGSI · RTE',
    desc: 'Weather against normal week by week, EU gas storage against its winter mark, next-month forward against the spot so far.',
    html: withK((host, k) => { host.innerHTML = '<div></div>'; return _mrnWeeks(k, host.firstChild); }) });
  R({ id: 'today-brief', kind: 'html', title: 'What moved and why', size: { w: 6, h: 7 }, source: 'PowerKlock',
    desc: 'The reasons behind the prices, market by market, with the trend for the week ahead.',
    async html(host) { if (!window.PKBrief) { fail(host); return; } host.innerHTML = '<div></div>'; return PKBrief.brief(host.firstChild); } });
  R({ id: 'today-news', kind: 'html', title: 'In the news · market movers', size: { w: 6, h: 7 }, source: 'News feeds · PowerKlock',
    desc: 'Last 48 hours, highest market impact first (geopolitics, regulation, deals, new capacity, gas); your ★ keywords first.',
    async html(host) { host.innerHTML = '<div></div>'; return _mrnNews(host.firstChild); } });
  R({ id: 'today-fund', kind: 'html', title: 'Fundamentals · the PowerKlock index', size: { w: 12, h: 7 }, source: 'PowerKlock · RTE · Open-Meteo',
    desc: 'The index as a calculation (expected demand against low-carbon supply, coverage, gas plant cost, expected spot against the last 7 days and the forward), then week by week the low-carbon supply stacked against demand.',
    html: withK((host, k) => { const cid = nid('fund'); host.innerHTML = `<div class="mrn-fund-calc"></div><div style="position:relative;height:calc(100% - 120px);min-height:200px;margin-top:10px"><canvas id="${cid}" style="width:100%;height:100%"></canvas></div>`; _mrnFund(k, host.firstChild, cid); }) });
  R({ id: 'today-rtiles', kind: 'html', title: 'Renewables · PPA benchmark, M0, tenders', size: { w: 12, h: 3 }, source: 'PowerKlock · RTE · CRE',
    desc: 'PowerKlock PPA benchmark solar and wind over 3 years, the latest M0 solar and wind, the latest CRE tender prices; a click opens each one full size.',
    async html(host) { host.innerHTML = '<div class="mrn2-tiles mrn3-tiles mrn-rtiles"></div>'; return _mrnRenTiles(host.firstChild); } });
  R({ id: 'today-gotable', kind: 'html', title: 'Guarantees of origin · prices', size: { w: 6, h: 5 }, source: 'Commerg · EEX',
    desc: 'Renewable AIB broker mid by production year with the change on the week and 4 weeks, and the latest French auction against the previous one.',
    async html(host) { host.innerHTML = '<div class="mrn3-tbl"></div>'; return _mrnGoTable(host.firstChild); } });
  R({ id: 'today-system', kind: 'html', title: 'Power system now · France', size: { w: 12, h: 2 }, source: 'RTE éCO2mix',
    desc: 'Latest quarter-hour: CO₂, consumption, nuclear, wind + solar, exchanges, against yesterday.',
    async html(host) { host.innerHTML = '<div class="mrn2-tiles mrn2-tiles-sm"></div>'; return _mrnTiles2(host.firstChild); } });
})();
