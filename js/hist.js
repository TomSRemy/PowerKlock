// ════════════════════════════════════════════════════════════════
// GENERATION MIX V2 · module complet
// 4 blocks: Live snapshot · Single zone deep-dive · Compare zones · Historical
// Inspired by Prices/Historical structure for consistency
// ════════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────────
const GM = {
  singleZone:  'FR',
  singleTab:   'donut',
  histZone:    'FR',
  histWindow:  '1M',
  openZone:    null,
};
window.GM = GM;

// Fuel meta — aligned with Daily DA and Historical
const GM_FUEL_META = {
  nuclear: { emoji: '⚛', label: 'Nuclear',  color: '#7B4B9C', co2: 12   },
  wind:    { emoji: '⌬', label: 'Wind',     color: '#14D3A9', co2: 11   },
  solar:   { emoji: '☀', label: 'Solar',    color: '#FBBF24', co2: 45   },
  hydro:   { emoji: '💧', label: 'Hydro',    color: '#3FA6B4', co2: 24   },
  biomass: { emoji: '🌿', label: 'Biomass',  color: '#94D2BD', co2: 230  },
  fossil:  { emoji: '🔥', label: 'Fossil',   color: '#ED6965', co2: 820  }, // gas+coal mix
  other:   { emoji: '◇', label: 'Other',    color: '#7A93AB', co2: 400  },
};

const GM_FUEL_ORDER = ['nuclear', 'wind', 'solar', 'hydro', 'biomass', 'fossil', 'other'];

const GM_ZONE_NAMES = {
  FR:'France', DE_LU:'Germany', ES:'Spain', BE:'Belgium',
  NL:'Netherlands', PT:'Portugal', GB:'Great Britain', IT_NORD:'Italy North',
};

// ── Compute stats for a zone snapshot (from _genmixData) ────────
function _gmStats(mix) {
  if (!mix || !mix.total) return null;
  const total = mix.total;
  const ren     = (mix.wind || 0) + (mix.solar || 0) + (mix.hydro || 0) + (mix.biomass || 0);
  const nuc     = mix.nuclear || 0;
  const fos     = mix.fossil || 0;
  const lowC    = ren + nuc;
  const renPct  = ren / total * 100;
  const lowCPct = lowC / total * 100;
  const fosPct  = fos / total * 100;
  // CO2 intensity proxy (g CO2eq / kWh) — weighted average by share
  let co2 = 0;
  GM_FUEL_ORDER.forEach(k => {
    const v = mix[k] || 0;
    co2 += (v / total) * (GM_FUEL_META[k]?.co2 || 0);
  });
  // Dominant fuel
  const dom = GM_FUEL_ORDER.reduce((best, k) =>
    (mix[k] || 0) > (mix[best] || 0) ? k : best, GM_FUEL_ORDER[0]);
  return { total, ren, nuc, fos, lowC, renPct, lowCPct, fosPct, co2, dom };
}

// ── Color helpers ───────────────────────────────────────────────
function _gmRenColor(pct) {
  if (pct >= 60) return '#14D3A9';
  if (pct >= 40) return '#FBBF24';
  return '#ED6965';
}
function _gmCo2Color(g) {
  if (g < 50)  return '#14D3A9';
  if (g < 150) return '#FBBF24';
  if (g < 400) return '#F97316';
  return '#ED6965';
}

// ════════════════════════════════════════════════════════════════
// BLOCK 1 · Multi-zone live snapshot table
// ════════════════════════════════════════════════════════════════
function renderGmMain() {
  const data = window._genmixData;
  if (!data || !Object.keys(data).length) {
    const tbody = document.getElementById('gm-table-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--tx3);padding:20px;font-size:11px">No GenMix data loaded — check genmix.json</td></tr>';
    return;
  }

  // Sort zones by total generation (desc)
  const zones = Object.keys(data)
    .filter(z => data[z]?.total > 0)
    .sort((a, b) => (data[b].total || 0) - (data[a].total || 0));

  // ── KPI strip ──
  const fr  = data['FR'] ? _gmStats(data['FR']) : null;
  if (fr) {
    _setText('gm-kpi-fr-total', (fr.total / 1000).toFixed(2), 'GW');
    const renEl = document.getElementById('gm-kpi-fr-ren');
    if (renEl) {
      const c = _gmRenColor(fr.renPct);
      renEl.innerHTML = `<span style="color:${c}">${fr.renPct.toFixed(1)}</span><span class="kpi-unit">%</span>`;
    }
    _setText('gm-kpi-fr-lowc', fr.lowCPct.toFixed(1), '%');
    const co2El = document.getElementById('gm-kpi-fr-co2');
    if (co2El) {
      const c = _gmCo2Color(fr.co2);
      co2El.innerHTML = `<span style="color:${c}">${Math.round(fr.co2)}</span><span class="kpi-unit">g/kWh</span>`;
    }
  }

  // EU-7 aggregated stats
  const allStats = zones.map(z => _gmStats(data[z])).filter(s => s);
  const euTotal = allStats.reduce((a, s) => a + s.total, 0);
  const euRen   = allStats.reduce((a, s) => a + s.ren, 0);
  const euRenPct = euTotal > 0 ? (euRen / euTotal * 100) : 0;
  _setText('gm-kpi-eu-total', (euTotal / 1000).toFixed(2), 'GW');
  const euRenEl = document.getElementById('gm-kpi-eu-ren');
  if (euRenEl) {
    const c = _gmRenColor(euRenPct);
    euRenEl.innerHTML = `<span style="color:${c}">${euRenPct.toFixed(1)}</span><span class="kpi-unit">%</span>`;
  }
  _setText('gm-kpi-eu-total-meta', `${zones.length} zones`);
  _setText('gm-kpi-eu-ren-meta', `avg across ${zones.length} zones`);

  // ── Table rows ──
  const tbody = document.getElementById('gm-table-tbody');
  if (!tbody) return;

  const fmt = (v, dp=2) => (v == null || isNaN(v)) ? '--' : v.toFixed(dp);
  const flagOf = z => (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
  const nameOf = z => GM_ZONE_NAMES[z] || z;

  const rowsHtml = zones.map(z => {
    const mix = data[z];
    const st  = _gmStats(mix);
    if (!st) return '';
    const renC  = _gmRenColor(st.renPct);
    const lowCC = _gmRenColor(st.lowCPct);
    const co2C  = _gmCo2Color(st.co2);
    const dom   = GM_FUEL_META[st.dom] || GM_FUEL_META.other;
    return `<tr class="gm-row" data-zone="${z}" style="cursor:pointer">
      <td style="text-align:left">${flagOf(z)} ${z}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600">${fmt(st.total / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${renC};font-weight:600">${fmt(st.renPct, 1)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${lowCC};font-weight:600">${fmt(st.lowCPct, 1)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.wind || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.solar || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.nuclear || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace">${fmt((mix.hydro || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${st.fosPct > 30 ? '#ED6965' : 'var(--tx2)'}">${fmt((mix.fossil || 0) / 1000)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace"><span style="color:${dom.color};font-size:11px">${dom.emoji} ${dom.label}</span></td>
      <td style="text-align:center;font-family:'JetBrains Mono',monospace;color:${co2C};font-weight:600">${Math.round(st.co2)}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rowsHtml;

  // Click handlers for expand
  tbody.querySelectorAll('.gm-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const z = tr.getAttribute('data-zone');
      _gmToggleRow(z);
    });
  });

  // Re-apply open state
  if (GM.openZone && data[GM.openZone]) {
    _gmOpenRow(GM.openZone);
  }
}

function _setText(id, val, unit) {
  const el = document.getElementById(id);
  if (!el) return;
  if (unit !== undefined) {
    el.innerHTML = `${val}<span class="kpi-unit">${unit}</span>`;
  } else {
    el.textContent = val;
  }
}

// ── Toggle / Open / Close detail row ─────────────────────
function _gmToggleRow(zone) {
  if (GM.openZone === zone) { _gmCloseRow(); return; }
  if (GM.openZone)          { _gmCloseRow(); }
  _gmOpenRow(zone);
}

function _gmCloseRow() {
  const existing = document.getElementById('gm-detail-row');
  if (existing) existing.remove();
  document.querySelectorAll('#gm-table-tbody tr.gm-row').forEach(r => r.classList.remove('is-open'));
  if (window._GM_DONUT_CHART) {
    try { window._GM_DONUT_CHART.destroy(); } catch (_) {}
    window._GM_DONUT_CHART = null;
  }
  if (window._GM_BAR_CHART) {
    try { window._GM_BAR_CHART.destroy(); } catch (_) {}
    window._GM_BAR_CHART = null;
  }
  GM.openZone = null;
}
window._gmCloseRow = _gmCloseRow;
window._gmToggleRow = _gmToggleRow;

function _gmOpenRow(zone) {
  const data = window._genmixData;
  if (!data?.[zone]) return;
  const mix = data[zone];
  const st  = _gmStats(mix);
  if (!st) return;

  const tbody = document.getElementById('gm-table-tbody');
  const row   = tbody.querySelector(`tr.gm-row[data-zone="${zone}"]`);
  if (!row) return;
  row.classList.add('is-open');
  GM.openZone = zone;

  const country = GM_ZONE_NAMES[zone] || zone;
  const flag    = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';
  const renC    = _gmRenColor(st.renPct);
  const lowCC   = _gmRenColor(st.lowCPct);
  const co2C    = _gmCo2Color(st.co2);
  const dom     = GM_FUEL_META[st.dom] || GM_FUEL_META.other;

  const detail = document.createElement('tr');
  detail.id = 'gm-detail-row';
  detail.innerHTML = `
    <td colspan="11" style="padding:0;background:var(--bg2);border-bottom:2px solid var(--bd2)">
      <div style="padding:14px 16px">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dom.color}"></span>
            <span style="font-size:14px;font-weight:700;color:var(--tx);letter-spacing:-.01em">${flag} ${zone} · ${country}</span>
            <span style="font-size:11px;color:var(--tx3);font-family:'JetBrains Mono',monospace">live snapshot · ${(st.total/1000).toFixed(2)} GW</span>
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="event.stopPropagation();_gmDownloadChart('${zone}')" title="Download charts as PNG"
              style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">📸 PNG</button>
            <button onclick="event.stopPropagation();_gmOpenFullscreen('${zone}')" title="Open in fullscreen"
              style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">⛶ Fullscreen</button>
            <button onclick="event.stopPropagation();_gmCloseRow()"
              style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">✕ Close</button>
          </div>
        </div>

        <!-- KPI strip 8 cards -->
        <div class="kpi-strip" style="grid-template-columns:repeat(8,1fr);margin-bottom:14px">
          <div class="kpi-card kpi-flat">
            <div class="kpi-label">Total</div>
            <div class="kpi-value">${(st.total/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${(st.total).toFixed(0)} MW</div>
          </div>
          <div class="kpi-card" style="border-left-color:${renC}">
            <div class="kpi-label">% Renewable</div>
            <div class="kpi-value" style="color:${renC}">${st.renPct.toFixed(1)}<span class="kpi-unit">%</span></div>
            <div class="kpi-meta">W+S+H+B</div>
          </div>
          <div class="kpi-card" style="border-left-color:${lowCC}">
            <div class="kpi-label">% Low-carbon</div>
            <div class="kpi-value" style="color:${lowCC}">${st.lowCPct.toFixed(1)}<span class="kpi-unit">%</span></div>
            <div class="kpi-meta">REN + nuclear</div>
          </div>
          <div class="kpi-card" style="border-left-color:#14D3A9">
            <div class="kpi-label">Wind</div>
            <div class="kpi-value">${((mix.wind||0)/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${(((mix.wind||0)/st.total)*100).toFixed(1)}% share</div>
          </div>
          <div class="kpi-card" style="border-left-color:#FBBF24">
            <div class="kpi-label">Solar</div>
            <div class="kpi-value">${((mix.solar||0)/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${(((mix.solar||0)/st.total)*100).toFixed(1)}% share</div>
          </div>
          <div class="kpi-card" style="border-left-color:#7B4B9C">
            <div class="kpi-label">Nuclear</div>
            <div class="kpi-value">${((mix.nuclear||0)/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${(((mix.nuclear||0)/st.total)*100).toFixed(1)}% share</div>
          </div>
          <div class="kpi-card" style="border-left-color:#ED6965">
            <div class="kpi-label">Fossil</div>
            <div class="kpi-value" style="color:${st.fosPct > 30 ? '#ED6965' : 'var(--tx)'}">${((mix.fossil||0)/1000).toFixed(2)}<span class="kpi-unit">GW</span></div>
            <div class="kpi-meta">${st.fosPct.toFixed(1)}% share</div>
          </div>
          <div class="kpi-card" style="border-left-color:${co2C}">
            <div class="kpi-label">CO₂ intensity</div>
            <div class="kpi-value" style="color:${co2C}">${Math.round(st.co2)}<span class="kpi-unit">g/kWh</span></div>
            <div class="kpi-meta">proxy from mix</div>
          </div>
        </div>

        <!-- 2 charts side by side: Donut (left) + Horizontal bars (right) -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:8px">
          <div>
            <div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;font-weight:600">Fuel mix · share</div>
            <div style="position:relative;height:280px">
              <canvas id="gm-detail-donut" style="width:100%;height:280px"></canvas>
            </div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;font-weight:600">Fuel mix · GW per source</div>
            <div style="position:relative;height:280px">
              <canvas id="gm-detail-bar" style="width:100%;height:280px"></canvas>
            </div>
          </div>
        </div>

        <!-- Breakdown collapsible -->
        <details style="margin-top:12px">
          <summary style="font-size:11px;font-weight:600;color:var(--tx2);cursor:pointer;letter-spacing:.05em;text-transform:uppercase;user-select:none;padding:6px 0">
            ▶ Breakdown table
          </summary>
          <div style="margin-top:8px;overflow-x:auto">
            ${_gmBuildBreakdownTable(mix, st)}
          </div>
        </details>
      </div>
    </td>`;
  row.after(detail);

  // Cache for fullscreen
  window._GM_LAST_ZONE = zone;
  window._GM_LAST_MIX  = mix;
  window._GM_LAST_ST   = st;

  // Build the 2 charts
  setTimeout(() => {
    _gmBuildDonut(mix, st, 'gm-detail-donut', false);
    _gmBuildBar(mix, st, 'gm-detail-bar', false);
  }, 30);
}
window._gmOpenRow = _gmOpenRow;

function _gmBuildBreakdownTable(mix, st) {
  const fmt = v => (v == null || isNaN(v)) ? '--' : v.toFixed(2);
  const rows = GM_FUEL_ORDER.map(k => {
    const v = mix[k] || 0;
    if (v <= 0) return null;
    const m = GM_FUEL_META[k];
    const pct = (v / st.total) * 100;
    return `<tr>
      <td style="padding:6px 8px;font-family:'JetBrains Mono',monospace"><span style="color:${m.color}">${m.emoji} ${m.label}</span></td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(v / 1000)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(v)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace">${pct.toFixed(2)}%</td>
      <td style="padding:6px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${m.co2}</td>
    </tr>`;
  }).filter(r => r).join('');
  return `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>
        <tr style="border-bottom:1px solid var(--bd)">
          <th style="padding:6px 8px;text-align:left;color:var(--tx3);font-weight:600">Source</th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">GW</th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">MW</th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">% Share</th>
          <th style="padding:6px 8px;text-align:right;color:var(--tx3);font-weight:600">g CO₂/kWh</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Chart builders ──────────────────────────────────────────────
function _gmBuildDonut(mix, st, canvasId, fullscreen) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  const labels = fuels.map(k => GM_FUEL_META[k].label);
  const dataArr = fuels.map(k => mix[k] || 0);
  const colors  = fuels.map(k => GM_FUEL_META[k].color);

  const targetVar = fullscreen ? '_GM_FS_DONUT_CHART' : '_GM_DONUT_CHART';
  if (window[targetVar]) {
    try { window[targetVar].destroy(); } catch (_) {}
  }

  window[targetVar] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: dataArr,
        backgroundColor: colors,
        borderColor: 'var(--bg2)',
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: 'rgba(184,201,217,.85)',
            font: { size: fullscreen ? 13 : 11, family: "'Inter', sans-serif" },
            usePointStyle: true,
            padding: 10,
            generateLabels: (chart) => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((l, i) => ({
                text: `${l} · ${(ds.data[i] / st.total * 100).toFixed(1)}%`,
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0,
                hidden: false,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          backgroundColor: '#0f1419',
          borderColor: 'rgba(255,255,255,.08)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed;
              const pct = (v / st.total * 100).toFixed(2);
              return `${ctx.label}: ${(v/1000).toFixed(2)} GW (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function _gmBuildBar(mix, st, canvasId, fullscreen) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  // Sort by value desc
  fuels.sort((a, b) => (mix[b] || 0) - (mix[a] || 0));
  const labels = fuels.map(k => `${GM_FUEL_META[k].emoji} ${GM_FUEL_META[k].label}`);
  const dataArr = fuels.map(k => (mix[k] || 0) / 1000);
  const colors  = fuels.map(k => GM_FUEL_META[k].color);

  const targetVar = fullscreen ? '_GM_FS_BAR_CHART' : '_GM_BAR_CHART';
  if (window[targetVar]) {
    try { window[targetVar].destroy(); } catch (_) {}
  }

  window[targetVar] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: dataArr,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1419',
          borderColor: 'rgba(255,255,255,.08)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.x;
              const pct = (v * 1000 / st.total * 100).toFixed(2);
              return `${v.toFixed(2)} GW (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(184,201,217,.6)', font: { size: fullscreen ? 12 : 10, family: "'JetBrains Mono', monospace" } },
          grid:  { color: 'rgba(255,255,255,.04)' },
          title: { display: true, text: 'GW', color: 'rgba(184,201,217,.4)', font: { size: 10 } },
        },
        y: {
          ticks: { color: 'rgba(184,201,217,.85)', font: { size: fullscreen ? 13 : 11, family: "'Inter', sans-serif" } },
          grid:  { display: false },
        },
      },
    },
  });
}

// ── PNG download (both charts on one image — render via composite) ──
function _gmDownloadChart(zone) {
  // Simple version: download donut chart only (most representative)
  const chart = window._GM_DONUT_CHART;
  if (!chart) return;
  const bgFill = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0a0d12';
  const dataUrl = chart.toBase64Image('image/png', 1, bgFill);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `powerklock_genmix_${zone}_${new Date().toISOString().slice(0,10)}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
window._gmDownloadChart = _gmDownloadChart;

// ── Fullscreen overlay ─────────────────────────────────────────
function _gmOpenFullscreen(zone) {
  const mix = window._GM_LAST_MIX;
  const st  = window._GM_LAST_ST;
  if (!mix || !st) return;
  const country = GM_ZONE_NAMES[zone] || zone;
  const flag    = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone]) || '';

  let fs = document.getElementById('gm-fs-overlay');
  if (fs) fs.remove();

  fs = document.createElement('div');
  fs.id = 'gm-fs-overlay';
  fs.style.cssText = `
    position: fixed; inset: 0; background: var(--bg);
    z-index: 9999; display: flex; flex-direction: column;
    padding: 16px 24px 24px; overflow: hidden;
  `;
  fs.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-shrink:0">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--tx);letter-spacing:-0.01em">${flag} ${zone} — ${country}</div>
        <div style="font-size:12px;color:var(--tx2);margin-top:2px">Generation Mix · Live snapshot · ${(st.total/1000).toFixed(2)} GW total</div>
      </div>
      <button id="gm-fs-close-btn" style="background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);padding:8px 14px;font-size:12px;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:.04em;text-transform:uppercase">✕ Close (Esc)</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;flex:1;min-height:0">
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:18px;display:flex;flex-direction:column;min-height:0">
        <div style="font-size:11px;font-weight:700;color:var(--tx2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;flex-shrink:0">Fuel mix · share</div>
        <div style="flex:1;position:relative;min-height:0">
          <canvas id="gm-fs-donut" style="width:100%;height:100%"></canvas>
        </div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:18px;display:flex;flex-direction:column;min-height:0">
        <div style="font-size:11px;font-weight:700;color:var(--tx2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;flex-shrink:0">Fuel mix · GW per source</div>
        <div style="flex:1;position:relative;min-height:0">
          <canvas id="gm-fs-bar" style="width:100%;height:100%"></canvas>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(fs);
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    _gmBuildDonut(mix, st, 'gm-fs-donut', true);
    _gmBuildBar(mix, st, 'gm-fs-bar', true);
  }, 50);

  document.getElementById('gm-fs-close-btn').addEventListener('click', _gmCloseFullscreen);
  document.addEventListener('keydown', _gmFsEscHandler);
}
window._gmOpenFullscreen = _gmOpenFullscreen;

function _gmFsEscHandler(e) {
  if (e.key === 'Escape') _gmCloseFullscreen();
}
function _gmCloseFullscreen() {
  const fs = document.getElementById('gm-fs-overlay');
  if (fs) fs.remove();
  document.body.style.overflow = '';
  if (window._GM_FS_DONUT_CHART) { try { window._GM_FS_DONUT_CHART.destroy(); } catch(_) {} window._GM_FS_DONUT_CHART = null; }
  if (window._GM_FS_BAR_CHART)   { try { window._GM_FS_BAR_CHART.destroy(); }   catch(_) {} window._GM_FS_BAR_CHART = null; }
  document.removeEventListener('keydown', _gmFsEscHandler);
}
window._gmCloseFullscreen = _gmCloseFullscreen;

// ════════════════════════════════════════════════════════════════
// BLOCK 2 · Single zone deep-dive
// Insta tabs: Donut · Bars · Stacked · Capacity factor
// ════════════════════════════════════════════════════════════════
function setGmSingleZone(zone) {
  GM.singleZone = zone;
  renderGmSingle();
}
function setGmSingleTab(tab, btn) {
  GM.singleTab = tab;
  // Update active class
  const parent = btn.parentElement;
  parent.querySelectorAll('.hw-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderGmSingle();
}
window.setGmSingleZone = setGmSingleZone;
window.setGmSingleTab  = setGmSingleTab;

function renderGmSingle() {
  const zone = GM.singleZone;
  const data = window._genmixData;
  if (!data?.[zone]) return;
  const mix = data[zone];
  const st  = _gmStats(mix);
  if (!st) return;

  const periodEl = document.getElementById('gm-single-period');
  if (periodEl) periodEl.textContent = `${zone} · live · ${(st.total/1000).toFixed(2)} GW total`;

  const canvas = document.getElementById('gm-single-canvas');
  const legend = document.getElementById('gm-single-legend');
  if (!canvas) return;

  if (window._GM_SINGLE_CHART) {
    try { window._GM_SINGLE_CHART.destroy(); } catch (_) {}
    window._GM_SINGLE_CHART = null;
  }

  const tab = GM.singleTab;
  if (tab === 'donut') {
    _gmSingleDonut(canvas, mix, st);
    if (legend) legend.textContent = 'Click a legend item to toggle';
  } else if (tab === 'bars') {
    _gmSingleBars(canvas, mix, st);
    if (legend) legend.textContent = 'Bars sorted by generation in GW';
  } else if (tab === 'stacked') {
    _gmSingleStacked(canvas, mix, st);
    if (legend) legend.textContent = 'Stacked horizontal bar — 100% share';
  } else if (tab === 'capacity') {
    _gmSingleCapacityFactor(canvas, mix, st, zone);
    if (legend) legend.textContent = 'Capacity factor proxy: actual / estimated installed (rough)';
  }
}
window.renderGmSingle = renderGmSingle;

function _gmSingleDonut(canvas, mix, st) {
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  const labels = fuels.map(k => GM_FUEL_META[k].label);
  const data   = fuels.map(k => mix[k] || 0);
  const colors = fuels.map(k => GM_FUEL_META[k].color);
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: 'var(--bg2)', borderWidth: 2, hoverOffset: 10 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: 'rgba(184,201,217,.9)', font: { size: 12, family: "'Inter', sans-serif" }, usePointStyle: true, padding: 12,
            generateLabels: (chart) => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((l, i) => ({ text: `${l} · ${(ds.data[i] / st.total * 100).toFixed(1)}%`, fillStyle: ds.backgroundColor[i], strokeStyle: ds.backgroundColor[i], lineWidth: 0, hidden: false, index: i }));
            },
          },
        },
        tooltip: { backgroundColor: '#0f1419', borderColor: 'rgba(255,255,255,.08)', borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => `${ctx.label}: ${(ctx.parsed/1000).toFixed(2)} GW (${(ctx.parsed/st.total*100).toFixed(2)}%)` } },
      },
    },
  });
}

function _gmSingleBars(canvas, mix, st) {
  const fuels  = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  fuels.sort((a, b) => (mix[b] || 0) - (mix[a] || 0));
  const labels = fuels.map(k => `${GM_FUEL_META[k].emoji} ${GM_FUEL_META[k].label}`);
  const data   = fuels.map(k => (mix[k] || 0) / 1000);
  const colors = fuels.map(k => GM_FUEL_META[k].color);
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f1419', padding: 10, callbacks: { label: (ctx) => `${ctx.parsed.x.toFixed(2)} GW (${(ctx.parsed.x*1000/st.total*100).toFixed(2)}%)` } },
      },
      scales: {
        x: { ticks: { color: 'rgba(184,201,217,.6)', font: { size: 11, family: "'JetBrains Mono', monospace" } }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: 'GW', color: 'rgba(184,201,217,.4)' } },
        y: { ticks: { color: 'rgba(184,201,217,.9)', font: { size: 12, family: "'Inter', sans-serif" } }, grid: { display: false } },
      },
    },
  });
}

function _gmSingleStacked(canvas, mix, st) {
  // 100% stacked horizontal bar — one row showing all fuel shares
  const fuels = GM_FUEL_ORDER.filter(k => (mix[k] || 0) > 0);
  const datasets = fuels.map(k => ({
    label: GM_FUEL_META[k].label,
    data:  [(mix[k] || 0) / st.total * 100],
    backgroundColor: GM_FUEL_META[k].color,
    borderWidth: 0,
    barThickness: 60,
  }));
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'bar',
    data: { labels: [''], datasets },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: 'rgba(184,201,217,.9)', font: { size: 12 }, usePointStyle: true, padding: 12 } },
        tooltip: { backgroundColor: '#0f1419', padding: 10, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}%` } },
      },
      scales: {
        x: { stacked: true, max: 100, ticks: { color: 'rgba(184,201,217,.6)', callback: (v) => v + '%' }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { stacked: true, display: false, grid: { display: false } },
      },
    },
  });
}

function _gmSingleCapacityFactor(canvas, mix, st, zone) {
  // Rough installed-capacity assumptions per zone (in MW) — used as a proxy
  // for capacity factor (= actual generation / installed capacity)
  // Source: ENTSO-E TYNDP / approximate end-2024 values
  const installedMW = {
    FR:      { wind: 23000,  solar: 22000,  nuclear: 61400, hydro: 25700, fossil: 19000 },
    DE_LU:   { wind: 70000,  solar: 90000,  nuclear: 0,     hydro: 11000, fossil: 70000 },
    ES:      { wind: 31000,  solar: 27000,  nuclear: 7100,  hydro: 17000, fossil: 25000 },
    BE:      { wind: 6000,   solar: 8000,   nuclear: 3900,  hydro: 1400,  fossil: 8000  },
    NL:      { wind: 11000,  solar: 23000,  nuclear: 500,   hydro: 0,     fossil: 27000 },
    GB:      { wind: 30000,  solar: 16000,  nuclear: 5900,  hydro: 4700,  fossil: 36000 },
    PT:      { wind: 6000,   solar: 4500,   nuclear: 0,     hydro: 8000,  fossil: 5000  },
    IT_NORD: { wind: 12000,  solar: 35000,  nuclear: 0,     hydro: 22000, fossil: 50000 },
  };
  const inst = installedMW[zone] || installedMW.FR;
  const fuels = ['wind','solar','nuclear','hydro','fossil'];
  const labels = fuels.map(k => `${GM_FUEL_META[k].emoji} ${GM_FUEL_META[k].label}`);
  const dataCF = fuels.map(k => {
    const a = mix[k] || 0;
    const cap = inst[k] || 1;
    return Math.min(100, (a / cap) * 100);
  });
  const colors = fuels.map(k => GM_FUEL_META[k].color);
  window._GM_SINGLE_CHART = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data: dataCF, backgroundColor: colors, borderWidth: 0, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f1419', padding: 10, callbacks: { label: (ctx) => `${ctx.parsed.x.toFixed(1)}% capacity factor` } },
      },
      scales: {
        x: { max: 100, ticks: { color: 'rgba(184,201,217,.6)', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: 'Capacity factor proxy (%)', color: 'rgba(184,201,217,.4)' } },
        y: { ticks: { color: 'rgba(184,201,217,.9)', font: { size: 12 } }, grid: { display: false } },
      },
    },
  });
}

// ════════════════════════════════════════════════════════════════
// BLOCK 3 · Cross-zones compare
// Heatmap %fuel + Sorted %REN bar + Auto insights
// ════════════════════════════════════════════════════════════════
function renderGmCompare() {
  const data = window._genmixData;
  if (!data || !Object.keys(data).length) return;

  const zones = Object.keys(data).filter(z => data[z]?.total > 0)
                                 .sort((a, b) => (data[b].total || 0) - (data[a].total || 0));
  const fuels = GM_FUEL_ORDER;

  // ── Heatmap ──
  const heatCt = document.getElementById('gm-compare-heatmap');
  if (heatCt) {
    let html = '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    // Header
    html += '<thead><tr><th style="padding:8px;text-align:left;color:var(--tx3);font-weight:600">Zone</th>';
    fuels.forEach(k => {
      const m = GM_FUEL_META[k];
      html += `<th style="padding:8px;text-align:center;color:${m.color};font-weight:600;font-size:11px">${m.emoji} ${m.label}</th>`;
    });
    html += '<th style="padding:8px;text-align:right;color:var(--tx3);font-weight:600">Total</th></tr></thead>';
    html += '<tbody>';
    zones.forEach(z => {
      const mix = data[z]; const st = _gmStats(mix);
      if (!st) return;
      const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[z]) || '';
      html += `<tr style="border-top:1px solid var(--bd)"><td style="padding:8px;font-weight:600">${flag} ${z}</td>`;
      fuels.forEach(k => {
        const pct = ((mix[k] || 0) / st.total) * 100;
        // Heatmap cell colour intensity
        const m = GM_FUEL_META[k];
        const opacity = Math.min(0.85, pct / 50);  // 50% share → opaque
        const bg = `rgba(${_hexToRgb(m.color)},${opacity})`;
        const txc = opacity > 0.4 ? '#fff' : 'var(--tx2)';
        html += `<td style="padding:8px;text-align:center;background:${bg};color:${txc};font-family:'JetBrains Mono',monospace">${pct.toFixed(1)}%</td>`;
      });
      html += `<td style="padding:8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${(st.total/1000).toFixed(1)} GW</td></tr>`;
    });
    html += '</tbody></table>';
    heatCt.innerHTML = html;
  }

  // ── Sorted %REN bar ──
  const renBar = document.getElementById('gm-compare-renbar');
  if (renBar) {
    const ranked = zones.map(z => {
      const mix = data[z]; const st = _gmStats(mix);
      return st ? { z, renPct: st.renPct } : null;
    }).filter(Boolean).sort((a, b) => b.renPct - a.renPct);
    const max = Math.max(...ranked.map(r => r.renPct), 1);
    let html = '<div style="display:flex;flex-direction:column;gap:6px">';
    ranked.forEach(r => {
      const c = _gmRenColor(r.renPct);
      const w = (r.renPct / max * 100).toFixed(1);
      const flag = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[r.z]) || '';
      html += `<div style="display:flex;align-items:center;gap:10px">
        <div style="width:80px;font-size:11px;font-weight:600">${flag} ${r.z}</div>
        <div style="flex:1;background:rgba(255,255,255,0.04);border-radius:3px;height:18px;position:relative;overflow:hidden">
          <div style="width:${w}%;height:100%;background:${c};border-radius:3px;transition:width .3s"></div>
          <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${w > 30 ? '#fff' : 'var(--tx2)'}">${r.renPct.toFixed(1)}%</span>
        </div>
      </div>`;
    });
    html += '</div>';
    renBar.innerHTML = html;
  }

  // ── Auto insights ──
  const insightsEl = document.getElementById('gm-compare-insights');
  if (insightsEl) {
    const stats = zones.map(z => ({ z, ...(_gmStats(data[z]) || {}) }));
    const greenest = [...stats].sort((a, b) => (b.renPct || 0) - (a.renPct || 0))[0];
    const dirtiest = [...stats].sort((a, b) => (a.renPct || 0) - (b.renPct || 0))[0];
    const lowestCo2 = [...stats].sort((a, b) => (a.co2 || 1e9) - (b.co2 || 1e9))[0];
    const highestCo2 = [...stats].sort((a, b) => (b.co2 || 0) - (a.co2 || 0))[0];
    const biggestSolar = [...stats].sort((a, b) => (data[b.z]?.solar || 0) / (b.total || 1) - (data[a.z]?.solar || 0) / (a.total || 1))[0];
    const biggestWind  = [...stats].sort((a, b) => (data[b.z]?.wind  || 0) / (b.total || 1) - (data[a.z]?.wind  || 0) / (a.total || 1))[0];

    const insights = [
      { icon: '🌱', txt: `<strong>${greenest.z}</strong> has the highest renewable share at <strong style="color:#14D3A9">${greenest.renPct.toFixed(1)}%</strong>`, color: '#14D3A9' },
      { icon: '🔥', txt: `<strong>${dirtiest.z}</strong> has the lowest renewable share at <strong style="color:#ED6965">${dirtiest.renPct.toFixed(1)}%</strong>`, color: '#ED6965' },
      { icon: '✅', txt: `<strong>${lowestCo2.z}</strong> has the lowest CO₂ intensity at <strong style="color:#14D3A9">${Math.round(lowestCo2.co2)} g/kWh</strong>`, color: '#14D3A9' },
      { icon: '⚠', txt: `<strong>${highestCo2.z}</strong> has the highest CO₂ intensity at <strong style="color:#ED6965">${Math.round(highestCo2.co2)} g/kWh</strong>`, color: '#ED6965' },
      { icon: '☀', txt: `<strong>${biggestSolar.z}</strong> has the highest solar share at <strong style="color:#FBBF24">${((data[biggestSolar.z]?.solar||0)/biggestSolar.total*100).toFixed(1)}%</strong>`, color: '#FBBF24' },
      { icon: '⌬', txt: `<strong>${biggestWind.z}</strong> has the highest wind share at <strong style="color:#14D3A9">${((data[biggestWind.z]?.wind||0)/biggestWind.total*100).toFixed(1)}%</strong>`, color: '#14D3A9' },
    ];
    insightsEl.innerHTML = insights.map(i => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg3);border-left:3px solid ${i.color};border-radius:4px;font-size:12px;color:var(--tx)">
        <span style="font-size:14px;flex-shrink:0">${i.icon}</span>
        <span>${i.txt}</span>
      </div>
    `).join('');
  }
}
window.renderGmCompare = renderGmCompare;

// ── Hex to RGB ─────
function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

// ════════════════════════════════════════════════════════════════
// BLOCK 4 · Historical wind & solar trends
// ════════════════════════════════════════════════════════════════
function setGmHistZone(zone) {
  GM.histZone = zone;
  renderGmHistory();
}
function setGmHistWindow(w, btn) {
  GM.histWindow = w;
  const parent = btn.parentElement;
  parent.querySelectorAll('.hw-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderGmHistory();
}
window.setGmHistZone   = setGmHistZone;
window.setGmHistWindow = setGmHistWindow;

async function renderGmHistory() {
  const zone = GM.histZone;
  const w    = GM.histWindow;
  const canvas = document.getElementById('gm-hist-canvas');
  const periodEl = document.getElementById('gm-hist-period');

  if (periodEl) periodEl.textContent = `${zone} · ${w} · loading...`;

  // ──────────────────────────────────────────────────────────────
  // Fetch enriched summary.json — contains per-fuel daily avg/max
  // (windAvg, solarAvg, nuclearAvg, hydroAvg, fossilAvg, biomassAvg, ...Max)
  // Falls back to per-day fetch if summary lacks these fields (backward compat)
  // ──────────────────────────────────────────────────────────────
  let series = [];
  let fullZoneData = [];  // unfiltered series for rolling-window context
  try {
    if (!window._GM_HIST_SUMMARY_CACHE) {
      const r = await fetch('data/history/summary.json');
      if (r.ok) window._GM_HIST_SUMMARY_CACHE = await r.json();
    }
    const summary = window._GM_HIST_SUMMARY_CACHE;
    const zoneData = summary?.zones?.[zone];
    if (zoneData && zoneData.length) {
      fullZoneData = zoneData.map(e => ({
        d:         e.d,
        windAvg:   e.windAvg    ?? null,
        windMax:   e.windMax    ?? null,
        solarAvg:  e.solarAvg   ?? null,
        solarMax:  e.solarMax   ?? null,
        nuclearAvg:e.nuclearAvg ?? null,
        hydroAvg:  e.hydroAvg   ?? null,
        fossilAvg: e.fossilAvg  ?? null,
        biomassAvg:e.biomassAvg ?? null,
      }));
      // Filter by window
      const days = _gmHistDaysForWindow(w);
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const filtered = (w === 'All') ? fullZoneData : fullZoneData.filter(e => e.d >= cutoffStr);
      series = filtered.filter(s => s.windAvg != null || s.solarAvg != null);
    }
  } catch (e) {
    console.warn('GenMix history fetch error:', e);
  }

  // Backward-compatible fallback (slow path): fetch daily files if summary empty
  if (!series.length) {
    if (periodEl) periodEl.textContent = `${zone} · ${w} · fallback fetch (slow)`;
    const days = _gmHistDaysForWindow(w);
    const today = new Date();
    for (let i = 0; i < Math.min(days, 31); i++) {  // cap fallback at 31 days for safety
      const d = new Date(today); d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      try {
        const r = await fetch(`data/history/daily/${ds}.json`);
        if (!r.ok) continue;
        const j = await r.json();
        const z = j?.zones?.[zone];
        if (!z) continue;
        const meanOf = arr => {
          const vv = (arr || []).filter(v => v != null);
          return vv.length ? vv.reduce((a,b)=>a+b,0)/vv.length : null;
        };
        const maxOf = arr => {
          const vv = (arr || []).filter(v => v != null);
          return vv.length ? Math.max(...vv) : null;
        };
        if ((z.wind || z.solar) && (z.wind?.length || z.solar?.length)) {
          series.push({
            d: ds,
            windAvg:   meanOf(z.wind),  windMax:   maxOf(z.wind),
            solarAvg:  meanOf(z.solar), solarMax:  maxOf(z.solar),
            nuclearAvg:meanOf(z.nuclear),
            hydroAvg:  meanOf(z.hydro),
            fossilAvg: meanOf(z.fossil),
            biomassAvg:meanOf(z.biomass),
          });
        }
      } catch (e) { /* silent */ }
    }
    series.sort((a, b) => a.d.localeCompare(b.d));
  }

  if (!series.length) {
    if (periodEl) periodEl.textContent = `${zone} · ${w} · no data`;
    _setText('gm-hist-kpi-wind',  '--', 'GW');
    _setText('gm-hist-kpi-solar', '--', 'GW');
    _setText('gm-hist-kpi-windmax',  '--', 'GW');
    _setText('gm-hist-kpi-solarmax', '--', 'GW');
    _setText('gm-hist-kpi-cf', '--', '%');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#7A93AB';
      ctx.font = '13px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('No wind/solar history found for this zone & window', canvas.width / 2, canvas.height / 2);
      ctx.fillStyle = '#5A6F88';
      ctx.font = '11px Inter';
      ctx.fillText('Run enrich_summary.py to populate the summary, or check fetch_data.py', canvas.width / 2, canvas.height / 2 + 22);
    }
    return;
  }

  // KPIs
  const winds  = series.map(s => s.windAvg).filter(v => v != null);
  const solars = series.map(s => s.solarAvg).filter(v => v != null);
  const windMaxes  = series.map(s => s.windMax).filter(v => v != null);
  const solarMaxes = series.map(s => s.solarMax).filter(v => v != null);

  const windAvg   = winds.length  ? winds.reduce((a,b)=>a+b,0)/winds.length  : null;
  const solarAvg  = solars.length ? solars.reduce((a,b)=>a+b,0)/solars.length : null;
  const windPeak  = windMaxes.length  ? Math.max(...windMaxes)  : null;
  const solarPeak = solarMaxes.length ? Math.max(...solarMaxes) : null;
  const windCF    = (windAvg != null && windPeak != null && windPeak > 0) ? (windAvg / windPeak * 100) : null;

  _setText('gm-hist-kpi-wind',     windAvg  != null ? (windAvg/1000).toFixed(2)  : '--', 'GW');
  _setText('gm-hist-kpi-windmax',  windPeak != null ? (windPeak/1000).toFixed(2) : '--', 'GW');
  _setText('gm-hist-kpi-solar',    solarAvg != null ? (solarAvg/1000).toFixed(2) : '--', 'GW');
  _setText('gm-hist-kpi-solarmax', solarPeak!= null ? (solarPeak/1000).toFixed(2): '--', 'GW');
  _setText('gm-hist-kpi-cf',       windCF   != null ? windCF.toFixed(1)          : '--', '%');

  if (periodEl) periodEl.textContent = `${zone} · ${series[0].d} → ${series[series.length-1].d} · ${series.length} days`;

  // Chart
  if (window._GM_HIST_CHART) {
    try { window._GM_HIST_CHART.destroy(); } catch (_) {}
  }
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = series.map(s => s.d);
  const windData    = series.map(s => s.windAvg    != null ? s.windAvg    / 1000 : null);
  const solarData   = series.map(s => s.solarAvg   != null ? s.solarAvg   / 1000 : null);
  const nuclearData = series.map(s => s.nuclearAvg != null ? s.nuclearAvg / 1000 : null);
  const hydroData   = series.map(s => s.hydroAvg   != null ? s.hydroAvg   / 1000 : null);
  const fossilData  = series.map(s => s.fossilAvg  != null ? s.fossilAvg  / 1000 : null);
  // 7D rolling on wind, computed on the FULL zone series so a short window
  // (e.g. 7D) still gives a meaningful trend at the last visible point. Each
  // visible date looks up the 7 prior days from `fullZoneData`, even if those
  // days are outside the visible window.
  const r7Context = (filteredEntries, fullEntries, n, valKey) => {
    if (!filteredEntries.length) return [];
    const idx = new Map();
    fullEntries.forEach((e, i) => idx.set(e.d, i));
    const fullVals = fullEntries.map(e => (e[valKey] != null ? e[valKey] / 1000 : null));
    return filteredEntries.map(fe => {
      const i = idx.get(fe.d);
      if (i == null) return null;
      const slice = fullVals.slice(Math.max(0, i - n + 1), i + 1).filter(v => v != null);
      if (!slice.length) return null;
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  };
  const windR7 = r7Context(series, fullZoneData, 7, 'windAvg');

  // Build datasets — only include fuels with non-null data
  const datasets = [
    { label: 'Wind',        data: windData,    borderColor: '#14D3A9', backgroundColor: 'rgba(20,211,169,0.08)', borderWidth: 1.5, pointRadius: 0, tension: 0, fill: true, spanGaps: true },
    { label: 'Solar',       data: solarData,   borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1.5, pointRadius: 0, tension: 0, fill: true, spanGaps: true },
  ];
  if (nuclearData.some(v => v != null && v > 0)) datasets.push({ label: 'Nuclear', data: nuclearData, borderColor: '#7B4B9C', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [], pointRadius: 0, tension: 0, fill: false, spanGaps: true });
  if (hydroData.some(v => v != null && v > 0))   datasets.push({ label: 'Hydro',   data: hydroData,   borderColor: '#3FA6B4', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [], pointRadius: 0, tension: 0, fill: false, spanGaps: true });
  if (fossilData.some(v => v != null && v > 0))  datasets.push({ label: 'Fossil',  data: fossilData,  borderColor: '#ED6965', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [], pointRadius: 0, tension: 0, fill: false, spanGaps: true });
  datasets.push({ label: 'Wind 7D rolling', data: windR7, borderColor: '#94a3b8', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4,3], pointRadius: 0, tension: 0.2, fill: false, spanGaps: true });

  window._GM_HIST_CHART = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f1419', borderColor: 'rgba(255,255,255,.08)', borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? '--' : ctx.parsed.y.toFixed(2)} GW` } },
      },
      layout: { padding: { top: 16, bottom: 8 } },
      scales: {
        x: { type: 'category', ticks: { color: 'rgba(184,201,217,.5)', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,.03)' } },
        y: { grace: '5%', ticks: { color: 'rgba(184,201,217,.5)', font: { size: 10, family: "'JetBrains Mono', monospace" }, callback: v => v.toFixed(0) }, grid: { color: 'rgba(255,255,255,.04)' }, title: { display: true, text: 'GW', color: 'rgba(184,201,217,.4)', font: { size: 10 } } },
      },
    },
  });
}
window.renderGmHistory = renderGmHistory;

function _gmHistDaysForWindow(w) {
  const map = { '7D': 7, '1M': 31, '3M': 92, '1Y': 366, '2Y': 731, '5Y': 1827, 'All': 1827 };
  return map[w] || 31;
}

// ════════════════════════════════════════════════════════════════
// INIT — wire up on page load
// ════════════════════════════════════════════════════════════════
function _gmInit() {
  if (!window._genmixData) {
    // Retry shortly — genmix.json may still be loading
    setTimeout(_gmInit, 500);
    return;
  }
  renderGmMain();
  renderGmSingle();
  renderGmCompare();
  // Don't fetch history at init — only when block 4 is rendered for the first time
  // Trigger first render with default 1M
  renderGmHistory();
}
// Hook into page show
document.addEventListener('DOMContentLoaded', () => {
  // Re-render when the page is shown
  const observer = new MutationObserver(() => {
    const page = document.getElementById('page-genmix');
    if (page && page.classList.contains('active')) {
      _gmInit();
    }
  });
  const page = document.getElementById('page-genmix');
  if (page) {
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    // Also trigger if already active
    if (page.classList.contains('active')) _gmInit();
  }
  // Wire collapse/expand on hist-section headers (style aligned with Historical)
  document.querySelectorAll('#page-genmix .hist-section-header').forEach(h => {
    h.addEventListener('click', () => {
      h.classList.toggle('open');
      const body = h.nextElementSibling;
      if (body && body.classList.contains('hist-section-body')) {
        body.classList.toggle('open');
      }
    });
  });
});

// ── Backward-compat shim ──
// Legacy code (news.js, globals.js, prices.js, ticker.js) still calls
// loadGenMix() — keep it working by aliasing to the V2 init function.
window.loadGenMix = function() {
  window._genmixLoaded = true;
  if (typeof _gmInit === 'function') _gmInit();
};
