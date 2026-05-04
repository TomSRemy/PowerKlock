async function loadNews() {
  window._newsLoaded = true;
  const allItems = [];

  // Try RSS feeds via proxy
  const fetchFeed = async (src) => {
    try {
      const resp = await fetch(`${RSS_PROXY}${encodeURIComponent(src.url)}`);
      const data = await resp.json();
      if (data.status !== 'ok') return [];
      return (data.items || []).slice(0, 6).map(item => ({
        source: src.name,
        cls: src.cls,
        title: item.title,
        snippet: item.description?.replace(/<[^>]+>/g,'').slice(0,150) + '...',
        link: item.link,
        date: new Date(item.pubDate),
        tags: src.tags,
      }));
    } catch { return []; }
  };

  // Fetch all in parallel
  const results = await Promise.all(RSS_SOURCES.map(fetchFeed));
  results.forEach(items => allItems.push(...items));

  if (allItems.length === 0) {
    // Fallback: demo news items
    allItems.push(...getDemoNews());
  }

  newsData = allItems.sort((a,b) => b.date - a.date);
  document.getElementById('news-updated').textContent = `${newsData.length} articles loaded`;
  renderNews(newsData);
}

function getDemoNews() {
  const now = new Date();
  const ago = (h) => new Date(now - h * 3600000);
  return [
    { source:'ENTSO-E', cls:'entsoe', title:'ENTSO-E publishes Winter Outlook 2026: European power system remains resilient', snippet:'The Winter Outlook 2026 confirms European adequacy margins remain above threshold in all scenarios, with interconnection capacity playing a key role.', link:'https://www.entsoe.eu/news', date:ago(1), tags:['power','regulation'] },
    { source:'RTE', cls:'rte', title:'Écrêtement solaire record en France : 2,1 TWh perdus au T1 2026', snippet:'RTE publie son bilan du premier trimestre 2026. La surproduction photovoltaïque aux heures creuses a conduit à des prix négatifs sur 312 heures.', link:'https://www.rte-france.com', date:ago(2), tags:['power','markets'] },
    { source:'ACER', cls:'acer', title:'ACER recommends reform of capacity mechanism design across EU member states', snippet:'In its latest market monitoring report, ACER identifies design inconsistencies in national capacity mechanisms that distort cross-border competition.', link:'https://www.acer.europa.eu', date:ago(4), tags:['regulation','markets'] },
    { source:'CRE', cls:'cre', title:'CRE ouvre une consultation sur les tarifs de réseau pour la période 2025-2028', snippet:'Le régulateur français lance une consultation publique sur la révision des TURPE applicable aux gestionnaires de réseau de distribution.', link:'https://www.cre.fr', date:ago(6), tags:['regulation','fr'] },
    { source:'ENTSO-E', cls:'entsoe', title:'Cross-border capacity allocation reaches record levels in Q1 2026', snippet:'The Cross-Border Capacity Allocation report shows that available interconnection capacity increased by 12% year-on-year in the first quarter.', link:'https://www.entsoe.eu/news', date:ago(8), tags:['power','markets'] },
    { source:'RTE', cls:'rte', title:'Nucléaire : EPR2 programme update — six new units confirmed in Normandy', snippet:'Following the government review, RTE confirms the grid connection timeline for the first EPR2 unit is maintained at 2037 for the Penly site.', link:'https://www.rte-france.com', date:ago(10), tags:['power','fr'] },
    { source:'ACER', cls:'acer', title:'European gas storage reaches 58% ahead of summer injection season', snippet:'GIE data shows EU aggregate storage at 58.3%, slightly below the 5-year average of 61.2% for this time of year, ACER notes in weekly brief.', link:'https://www.acer.europa.eu', date:ago(14), tags:['gas','markets'] },
    { source:'ENTSO-E', cls:'entsoe', title:'REMIT: 47 new urgent market messages published this week across EU TSOs', snippet:'TSOs across Germany, France, Italy and Poland filed 47 UMMs this week, predominantly affecting gas-fired generation assets.', link:'https://www.entsoe.eu/news', date:ago(18), tags:['regulation','markets'] },
    { source:'CRE', cls:'cre', title:'Agrégation : publication du cadre réglementaire pour les BESS en marché de capacité', snippet:'La CRE précise les conditions d\'éligibilité des systèmes de stockage par batterie au mécanisme de capacité français à partir de 2027.', link:'https://www.cre.fr', date:ago(22), tags:['regulation','fr','power'] },
    { source:'RTE', cls:'rte', title:'Bilan mensuel : solde exportateur de la France en baisse de 18% sur avril 2026', snippet:'RTE publie le bilan mensuel. Le solde exportateur s\'établit à 3,2 TWh sur avril 2026, en recul face au même mois de l\'an dernier.', link:'https://www.rte-france.com', date:ago(26), tags:['power','markets','fr'] },
  ];
}

function renderNews(items) {
  const filtered = newsFilter === 'all' ? items : items.filter(i => i.tags?.includes(newsFilter));
  const grid = document.getElementById('news-grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No articles for this filter.</div>';
    return;
  }
  grid.innerHTML = filtered.map(item => {
    const timeAgo = formatTimeAgo(item.date);
    const tagsHtml = (item.tags || []).map(t => `<span class="news-tag">${t}</span>`).join(' ');
    return `<a class="news-card" href="${item.link}" target="_blank" rel="noopener">
      <div class="news-meta">
        <span class="news-source ${item.cls}">${item.source}</span>
        <span class="news-time">${timeAgo}</span>
      </div>
      <div class="news-title">${item.title}</div>
      <div class="news-snippet">${item.snippet}</div>
      <div>${tagsHtml}</div>
    </a>`;
  }).join('');
}

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
  const prices = pricesData.length > 0 ? pricesData : getDemoData();
  const fr = prices.find(d => d.code === 'FR') || prices[0];
  const de = prices.find(d => d.code === 'DE_LU') || prices[1];
  const be = prices.find(d => d.code === 'BE') || prices[2];

  document.getElementById('overview-prices').innerHTML = [
    { label:'🇫🇷 France DA', val:fr?.today, unit:'€/MWh' },
    { label:'🇩🇪 Germany DA', val:de?.today, unit:'€/MWh' },
    { label:'🇧🇪 Belgium DA', val:be?.today, unit:'€/MWh' },
    { label:'TTF D+1', val:45.14, unit:'€/MWh' },
    { label:'EUA', val:74.09, unit:'€/t' },
    { label:'EUR/USD', val:1.1680, unit:'' },
  ].map(r => `<tr>
    <td style="font-family:Inter;text-align:left;color:var(--text2)">${r.label}</td>
    <td style="font-weight:600">${r.val?.toFixed(2) || '--'}</td>
    <td style="color:var(--text3);font-size:11px">${r.unit}</td>
  </tr>`).join('');

  document.getElementById('market-status').innerHTML = `
    <div style="margin-bottom:10px"><span style="color:var(--accent)">⚡ Power</span><br>
    FR price ${fr?.today < 10 ? 'very low' : fr?.today < 50 ? 'below average' : 'elevated'} at ${fr?.today?.toFixed(1)} €/MWh. ${fr?.negHrs > 0 ? `${fr.negHrs}h of negative prices.` : 'No negative hours.'}</div>
    <div style="margin-bottom:10px"><span style="color:#60a5fa">⛽ Gas</span><br>
    TTF Day-Ahead at 45.14 €/MWh, up 2.35% vs prior close.</div>
    <div><span style="color:#a78bfa">🌿 Carbon</span><br>
    EUA at 74.09 €/t, near 6-month average.</div>
  `;
}

// ════════════════════════════════════════════
// CONVERTER
// ════════════════════════════════════════════
const CONV_FACTORS = {
  'MW':  { MW:1, GW:0.001, MWh:1, GWh:0.001, TWh:0.000001 },
  'GW':  { MW:1000, GW:1, MWh:1000, GWh:1, TWh:0.001 },
  'MWh': { MW:1, GW:0.001, MWh:1, GWh:0.001, TWh:0.000001 },
  'GWh': { MW:1000, GW:1, MWh:1000, GWh:1, TWh:0.001 },
  'TWh': { MW:1000000, GW:1000, MWh:1000000, GWh:1000, TWh:1 },
};

function setConvUnit(unit, btn) {
  convUnit = unit;
  document.querySelectorAll('.conv-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateConverter();
}

function updateConverter() {
  const val = parseFloat(document.getElementById('conv-input').value) || 0;
  const factors = CONV_FACTORS[convUnit] || CONV_FACTORS['MW'];
  const units = ['MW','GW','MWh','GWh','TWh'];
  const descs = {
    'MW':'Megawatt (capacity)','GW':'Gigawatt = 1,000 MW',
    'MWh':'Megawatt-hour (energy)','GWh':'Gigawatt-hour = 1,000 MWh','TWh':'Terawatt-hour = 1,000 GWh'
  };
  document.getElementById('conv-results').innerHTML = units.map(u => {
    const result = val * (factors[u] || 1);
    const disp = result >= 1e6 ? result.toExponential(2) : result >= 1000 ? result.toLocaleString('fr-FR', {maximumFractionDigits:1}) : result.toFixed(result < 0.01 ? 6 : 3);
    const active = u === convUnit ? 'border-color:var(--accent)' : '';
    return `<div class="conv-result" style="${active}" onclick="setConvUnit('${u}', document.querySelectorAll('.conv-tab')[${units.indexOf(u)}])">
      <div class="conv-result-label">${u}</div>
      <div class="conv-result-value">${disp}</div>
      <div class="conv-result-desc">${descs[u]}</div>
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
    <div class="conv-result"><div class="conv-result-label">Annual Production</div><div class="conv-result-value">${(annualTWh).toFixed(3)} TWh</div><div class="conv-result-desc">= ${annualGWh.toFixed(1)} GWh</div></div>
    <div class="conv-result"><div class="conv-result-label">Full-Load Hours</div><div class="conv-result-value">${Math.round(fLH).toLocaleString()}</div><div class="conv-result-desc">hours/year</div></div>
    <div class="conv-result" style="grid-column:1/-1"><div class="conv-result-label">Formula</div><div style="font-size:12px;color:var(--text2);margin-top:4px;font-family:JetBrains Mono">${mw} MW × ${lf}% × 8,760 h = ${Math.round(annualMWh).toLocaleString()} MWh/year</div></div>
  `;
}

function setLF(val, btn) {
  document.getElementById('cap-lf').value = val;
  document.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateCapacity();
}


// ── NEW SECTION LOADER ──
// (constants moved to prices.js)

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
        tension:0.3 }]
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
