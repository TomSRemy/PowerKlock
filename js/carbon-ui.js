// ════════════════════════════════════════════════════════════════
// carbon-ui.js — UI carbone greffée sur les patterns EXISTANTS de PowerKlock.
// ────────────────────────────────────────────────────────────────
// Ne réinvente rien :
//   • board + drill row = structure EXACTE de renderPricesTableBody / togglePriceRow
//   • graphe = Chart.js avec annotation{} + ZOOM_CFG (libs.js) + double-clic reset
//             + bouton ↺, et nowLineAnnotation (palette.js) pour la ligne NOW
//   • lignes "bon moment" = 2 annotations horizontales (moy période pondérée + N-1)
//   • zones = filtre global _userZones ; période = carb-date-from/to (miroir gmh)
// Réutilise carbon.js (productionIntensity / coverage / consumptionIntensity)
// et carbon-ghg.js (résiduel).
//
// Globals attendus (déjà présents) : Chart, ZOOM_CFG, nowLineAnnotation, FLAG_MAP,
//   _userZones, getGenMixDefaultZones, fetchHistoricalDaily/fetchJSON,
//   productionIntensity, coverage, consumptionIntensity.
//
// ⚠ SEAMS DATA : les adaptateurs ci-dessous (zoneCodeMix, hourlyMixOf, flowsOf)
//   sont à brancher sur tes JSON réels. Tout le reste suit le template.
// ════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── adaptateurs data (à brancher) ───────────────────────────────
  // mix snapshot d'une zone (byCode si dispo, sinon buckets legacy -> codes)
  function zoneCodeMix(ze) {
    if (!ze) return {};
    if (ze.byCode) return ze.byCode;
    const g = ze.genmix || ze;
    return { B14: g.nuclear || 0, B16: g.solar || 0, B19: g.wind || 0,
             B11: g.hydro || 0, B04: g.fossil || 0, B01: g.biomass || 0, B20: g.other || 0 };
  }
  // mix horaire { Bxx:[N] } d'une zone (byCodeActual si dispo)
  function hourlyMixOf(ze) { return (ze && ze.byCodeActual) || null; }
  // flux transfrontaliers d'une zone : [{partner,imports,exports,net}]
  function flowsOf(zoneCode, crossborder) { return (crossborder && crossborder[zoneCode]) || []; }

  // Résiduel illustratif (en attendant le branchement flux GO -> residualMixEndogenous).
  // off=officiel AIB, est=estimation, mae=erreur back-test. À remplacer par les vraies valeurs.
  const RESID = {
    FR:{off:58,est:52,mae:4}, DE_LU:{off:380,est:468,mae:88}, ES:{off:300,est:265,mae:35},
    BE:{off:300,est:280,mae:30}, GB:{off:380,est:355,mae:40}, IT_NORD:{off:420,est:395,mae:45},
    CH:{off:null,est:null,mae:null}, NL:{off:null,est:null,mae:null}, AT:{off:null,est:null,mae:null},
  };
  // N-1 même période : à remplacer par la vraie moyenne période année précédente.
  function prevYearAvg(periodAvg) { return periodAvg * 1.12; }

  // ── état drill (miroir de _rowCharts / _openRow de prices) ───────
  const _carbCharts = {};
  let _carbOpenRow = null;
  let _carbRows = [];

  // ── rampe carbone (cohérente carte/mockup) ──────────────────────
  function cColor(v) {
    const st = [[20,'#0E9F6E'],[60,'#14D3A9'],[120,'#9BD46A'],[200,'#FBBF24'],[300,'#ED8936'],[450,'#ED6965'],[650,'#B91C1C']];
    if (v <= st[0][0]) return st[0][1];
    if (v >= st[st.length-1][0]) return st[st.length-1][1];
    for (let i=0;i<st.length-1;i++){ const [a,ca]=st[i],[b,cb]=st[i+1];
      if (v>=a&&v<=b){ const t=(v-a)/(b-a);
        const A=[1,3,5].map(j=>parseInt(ca.slice(j,j+2),16)), B=[1,3,5].map(j=>parseInt(cb.slice(j,j+2),16));
        return '#'+A.map((x,k)=>Math.round(x+(B[k]-x)*t).toString(16).padStart(2,'0')).join(''); } }
    return '#888';
  }

  function _slotAt(hours, h){ const m={}; for (const f in hours) m[f]=(hours[f]||[])[h]||0; return m; }
  function _slotTotal(hours, h, r){ if(!hours) return 1; let s=0; for(const f in hours) s+=(hours[f]||[])[h]||0; return s||1; }
  function _importUplift(r, h){ // effet import simple (illustratif) ; remplacer par flow-tracing
    const net = (r.flows||[]).reduce((s,f)=>s+(f.net||0),0); // net>0 = importateur
    const evening = Math.exp(-Math.pow((h-19)/4,2));
    return net>0 ? 6*evening : 4*evening;
  }
  function _flowsMap(zonesData){ const m={}; zonesData.forEach(z=>m[z.code]=z.flows||[]); return m; }

  // ════════════════════════════════════════════════════════════════
  // BOARD — structure EXACTE de la table prices (drill row incluse)
  // ════════════════════════════════════════════════════════════════
  function renderCarbonBoard(zonesData) {
    const tbody = document.getElementById('carb-board-body');
    if (!tbody) return;
    const prodIntByZone = {}, totByZone = {};
    zonesData.forEach(z => {
      prodIntByZone[z.code] = productionIntensity(z.mixByCode, true);
      totByZone[z.code] = Object.values(z.mixByCode).reduce((a,b)=>a+(b||0),0);
    });
    const flows = _flowsMap(zonesData);
    const rows = zonesData.map(z => {
      const pi = prodIntByZone[z.code];
      const cov = coverage(z.mixByCode, true);
      const ci = consumptionIntensity(z.code, totByZone, prodIntByZone, flows);
      return Object.assign({}, z, { pi, ci, cov });
    }).sort((a,b)=>a.ci-b.ci);
    _carbRows = rows;

    tbody.innerHTML = rows.map((r,i) => {
      const fr = r.code === 'FR';
      const flag = (window.FLAG_MAP && FLAG_MAP[r.code]) || '';
      return `<tr class="zone-row" data-row-idx="${i}" data-zone="${r.code}" style="cursor:pointer" onclick="toggleCarbonRow(${i},event)" title="Cliquer pour détailler l'heure">
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:${fr?'var(--accent)':'var(--tx2)'};text-align:left"><svg class="row-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;opacity:0.45;vertical-align:0;transition:transform 0.15s ease"><polyline points="9 18 15 12 9 6"/></svg>${flag} ${r.code}</td>
      <td style="font-size:11px;color:var(--tx2);text-align:left">${r.name}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${cColor(r.ci)};text-align:right">${r.ci.toFixed(0)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2);text-align:right">${r.pi.toFixed(0)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--up);text-align:right">${r.cov.lowCPct.toFixed(0)}%</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--tx2);text-align:right">${r.cov.renPct.toFixed(0)}%</td>
      <td style="font-family:'JetBrains Mono',monospace;color:${r.cov.fosPct>30?'var(--down)':'var(--tx3)'};text-align:right">${r.cov.fosPct.toFixed(0)}%</td>
    </tr>
    <tr id="carb-detail-${i}" style="display:none">
      <td colspan="7" style="padding:0;background:#141a22;border-bottom:2px solid var(--bd2)">
        <div style="padding:14px 16px" id="carb-detail-inner-${i}"></div>
      </td>
    </tr>`;
    }).join('');
  }

  // ── drill toggle (miroir exact de togglePriceRow) ────────────────
  function toggleCarbonRow(idx, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    if (_carbOpenRow != null && _carbOpenRow !== idx) {
      const prev = document.getElementById(`carb-detail-${_carbOpenRow}`);
      if (prev) prev.style.display = 'none';
      if (_carbCharts[_carbOpenRow]) { _carbCharts[_carbOpenRow].destroy(); delete _carbCharts[_carbOpenRow]; }
      _clearOpen();
    }
    const d = document.getElementById(`carb-detail-${idx}`);
    if (!d) return;
    const open = d.style.display !== 'none';
    if (open) {
      d.style.display = 'none'; _carbOpenRow = null;
      if (_carbCharts[idx]) { _carbCharts[idx].destroy(); delete _carbCharts[idx]; }
      _clearOpen(); return;
    }
    d.style.display = 'table-row'; _carbOpenRow = idx; _clearOpen();
    const tr = document.querySelector(`#carb-board-body tr.zone-row[data-row-idx="${idx}"]`);
    if (tr) tr.classList.add('is-open');
    buildCarbonDrill(idx);
    setTimeout(() => d.scrollIntoView({ behavior:'smooth', block:'nearest' }), 50);
  }
  function _clearOpen(){ document.querySelectorAll('#carb-board-body tr.zone-row.is-open').forEach(t=>t.classList.remove('is-open')); }

  // ── contenu drill : KPI + chart (annotations) + mix + flux + résiduel ──
  function buildCarbonDrill(idx) {
    const r = _carbRows[idx]; if (!r) return;
    const inner = document.getElementById(`carb-detail-inner-${idx}`); if (!inner) return;
    const hours = r.hourlyMix || null;
    const N = hours ? ((Object.values(hours)[0] || []).length || 24) : 24;
    const ciArr = [], piArr = [];
    for (let h=0; h<N; h++) {
      const slot = hours ? _slotAt(hours, h) : r.mixByCode;
      const pi = productionIntensity(slot, true);
      piArr.push(pi); ciArr.push(pi + _importUplift(r, h));
    }
    let wn=0, wd=0;
    for (let h=0; h<N; h++) { const w=_slotTotal(hours,h,r); wn+=ciArr[h]*w; wd+=w; }
    const periodAvg = wd ? wn/wd : ciArr.reduce((a,b)=>a+b,0)/N;
    const n1 = prevYearAvg(periodAvg);
    const res = RESID[r.code] || { off:null, est:null, mae:null };
    const flag = (window.FLAG_MAP && FLAG_MAP[r.code]) || '';

    inner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--tx2)">${flag} ${r.name} · intensité horaire</div>
        <button class="pk-btn-ghost" onclick="event.stopPropagation();(function(){var c=window.__carbCharts&&__carbCharts[${idx}];if(c&&c.resetZoom)c.resetZoom();})()" title="Reset zoom">↺ Reset</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
        ${_kpi('Intensité conso', r.ci.toFixed(0)+' g', cColor(r.ci))}
        ${_kpi('Intensité prod', r.pi.toFixed(0)+' g', cColor(r.pi))}
        ${_kpi('Bas-carbone', r.cov.lowCPct.toFixed(0)+' %', 'var(--up)')}
        ${_kpi('Résiduel est.', res.est!=null?res.est+' g':'n/a', 'var(--warn)')}
        ${_kpi('Résiduel AIB', res.off!=null?res.off+' g':'n/a', 'var(--up)')}
      </div>
      <div style="position:relative;height:230px;margin-bottom:14px"><canvas id="carb-chart-${idx}"></canvas></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>${_mixTable(r, hours)}</div>
        <div>${_flowsTable(r)}${_residualBlock(r, res)}</div>
      </div>`;

    const ctx = document.getElementById(`carb-chart-${idx}`);
    if (!ctx || typeof Chart === 'undefined') return;
    const labels = Array.from({length:N}, (_,h) => N>24
      ? String(Math.floor(h*24/N)).padStart(2,'0')+'h'
      : String(h).padStart(2,'0')+'h');
    // annotations : moy période (seuil bon moment) + N-1 + NOW
    const annotations = {
      moy:{ type:'line', yMin:periodAvg, yMax:periodAvg, borderColor:'#FFFD82', borderWidth:1.1, borderDash:[4,3],
        label:{ display:true, content:'moy '+periodAvg.toFixed(0), position:'end', color:'#0A1218',
          backgroundColor:'#FFFD82', font:{size:9,weight:'700',family:"'JetBrains Mono',monospace"}, padding:{top:1,bottom:1,left:4,right:4} } },
      n1:{ type:'line', yMin:n1, yMax:n1, borderColor:'#7A93AB', borderWidth:1, borderDash:[2,3],
        label:{ display:true, content:'N-1 '+n1.toFixed(0), position:'end', color:'#7A93AB',
          font:{size:9,family:"'JetBrains Mono',monospace"} } },
    };
    if (typeof nowLineAnnotation === 'function') {
      const nl = nowLineAnnotation({ slots:N, labels, label:'NOW', mode:'single' });
      if (nl) annotations.now = nl;
    }
    _carbCharts[idx] = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[
        { label:'Intensité conso', data:ciArr, borderColor:'#A87DC4', backgroundColor:'rgba(168,125,196,.08)', borderWidth:2, pointRadius:0, fill:true, tension:.25 },
        { label:'Intensité prod', data:piArr, borderColor:'#7A93AB', borderWidth:1.3, borderDash:[4,3], pointRadius:0, tension:.25 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:100},
        interaction:{ mode:'index', intersect:false },
        onClick:(evt)=>{ if (evt && evt.native && evt.native.detail===2){ const c=_carbCharts[idx]; if (c && c.resetZoom) c.resetZoom(); } },
        plugins:{
          legend:{ display:true, labels:{ color:'#4A6280', font:{size:10}, boxWidth:16, usePointStyle:true, pointStyle:'line' } },
          tooltip:{ mode:'index', intersect:false, callbacks:{ label:c=>` ${c.dataset.label}: ${c.parsed.y!=null?c.parsed.y.toFixed(0)+' gCO2/kWh':'n/a'}` } },
          annotation:{ annotations },
          zoom:(typeof ZOOM_CFG!=='undefined')?ZOOM_CFG:undefined,
        },
        scales:{
          x:{ grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#4A6280',font:{size:9},maxTicksLimit:12} },
          y:{ grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#4A6280',font:{size:10}},
              title:{display:true,text:'gCO2eq/kWh',color:'#4A6280',font:{size:10}}, grace:'12%', beginAtZero:true },
        },
      },
    });
  }

  // ── petits builders (table norm respectée) ───────────────────────
  function _kpi(label, val, color){
    return `<div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:7px;padding:8px 10px">
      <div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.07em">${label}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:${color};margin-top:3px">${val}</div></div>`;
  }
  function _mixTable(r, hours){
    const mix = r.mixByCode, tot = Object.values(mix).reduce((a,b)=>a+(b||0),0)||1;
    const F = window.CARBON_FACTORS || {};
    const rows = Object.keys(mix).filter(k=>mix[k]>0).sort((a,b)=>mix[b]-mix[a]).map(k=>{
      const f = F[k] || { fr:k, color:'#7A93AB', co2:'?' };
      return `<tr><td style="padding:3px 8px;color:var(--tx2)"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${f.color};margin-right:6px"></span>${f.fr}</td>
        <td style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${(mix[k]/tot*100).toFixed(0)}%</td>
        <td style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--tx3)">${f.co2}</td></tr>`;
    }).join('');
    return `<table style="width:100%;font-size:11px;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Filière</th>
        <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Part</th>
        <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">gCO2/kWh</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }
  function _flowsTable(r){
    const flows = (r.flows||[]).slice().sort((a,b)=>Math.abs(b.net||0)-Math.abs(a.net||0));
    if (!flows.length) return `<div style="font-size:10px;color:var(--tx4);margin-bottom:10px">Flux transfrontaliers indisponibles.</div>`;
    const rows = flows.map(f=>{
      const imp = f.imports||0, exp = f.exports||0, dir = (f.net||0)>0?'Import':'Export';
      const col = (f.net||0)>0?'var(--down)':'var(--up)';
      return `<tr><td style="padding:3px 8px;font-family:'JetBrains Mono',monospace;color:var(--tx2)">${f.partner||''}</td>
        <td style="padding:3px 8px;text-align:right;color:${col}">${dir}</td>
        <td style="padding:3px 8px;text-align:right;font-family:'JetBrains Mono',monospace;color:${col}">${(f.net||0)>0?'+':''}${Math.round(f.net||0)}</td></tr>`;
    }).join('');
    return `<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:10px">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Frontière</th>
        <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Sens</th>
        <th style="text-align:right;padding:4px 8px;color:var(--tx3);font-weight:600;border-bottom:1px solid var(--bd)">Net MW</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }
  function _residualBlock(r, res){
    const delta = (res.off!=null && res.est!=null) ? (res.est-res.off) : null;
    return `<div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:7px;padding:10px">
      <div style="font-size:10px;color:var(--cat-carbon,#A87DC4);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Mix résiduel · GHG Scope 2 market-based</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:var(--tx3)">Officiel AIB</span><span style="font-family:'JetBrains Mono',monospace;color:var(--tx2)">${res.off!=null?res.off+' g':'n/a'}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:var(--tx3)">Estimation live</span><span style="font-family:'JetBrains Mono',monospace;color:var(--warn)">${res.est!=null?res.est+' g':'n/a'}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:var(--tx3)">Écart (±MAE)</span><span style="font-family:'JetBrains Mono',monospace;color:var(--tx2)">${delta!=null?(delta>=0?'+':'')+delta+' g (±'+res.mae+')':'–'}</span></div>
    </div>`;
  }

  // ════════════════════════════════════════════════════════════════
  // ORCHESTRATION : période (carb-date-from/to, miroir gmh) + zones (_userZones)
  // ════════════════════════════════════════════════════════════════
  // Construit zonesData à partir d'un snapshot genmix + crossborder, filtré par _userZones.
  function buildZonesData(genmix, crossborder, names) {
    const sel = window._userZones || (typeof getGenMixDefaultZones==='function' ? new Set(getGenMixDefaultZones()) : null);
    const out = [];
    const countries = (genmix && genmix.countries) || {};
    for (const code in countries) {
      if (sel && !sel.has(code)) continue;
      out.push({
        code,
        name: (names && names[code]) || code,
        mixByCode: zoneCodeMix(countries[code]),
        hourlyMix: hourlyMixOf(countries[code]),
        flows: flowsOf(code, (crossborder && crossborder.countries) || {}),
      });
    }
    return out;
  }

  // Recharge sur la période choisie (range gmh) puis re-render.
  async function reloadCarbon() {
    const from = document.getElementById('carb-date-from')?.value;
    const to   = document.getElementById('carb-date-to')?.value;
    try {
      let genmix, crossborder = null;
      if (to && typeof fetchHistoricalDaily === 'function') {
        // période : on prend le snapshot de fin de range (le drill horaire = jour de fin),
        // cohérent avec genmix-historical (Stack drill day = range end).
        const daily = await fetchHistoricalDaily(to);
        genmix = { countries: {} };
        const zones = (daily && daily.zones) || {};
        for (const c in zones) genmix.countries[c] = zones[c]; // byCodeActual + buckets
      } else if (typeof fetchJSON === 'function') {
        genmix = await fetchJSON('genmix.json');
        crossborder = await fetchJSON('crossborder.json');
      }
      const names = window.ZONE_NAMES || {};
      const zonesData = buildZonesData(genmix, crossborder, names);
      renderCarbonBoard(zonesData);
      const meta = document.getElementById('carb-board-meta');
      if (meta) meta.textContent = (from && to) ? `${from} → ${to}` : 'snapshot live';
    } catch (e) {
      console.warn('[carbon-ui] reload failed:', e);
    }
  }

  function initCarbon() {
    const f = document.getElementById('carb-date-from'), t = document.getElementById('carb-date-to');
    if (f) f.addEventListener('change', reloadCarbon);
    if (t) t.addEventListener('change', reloadCarbon);
    // bouton de remise à zéro de la période (revient au snapshot live)
    const clr = document.getElementById('carb-date-clear');
    if (clr) clr.addEventListener('click', () => { if(f)f.value=''; if(t)t.value=''; reloadCarbon(); });
    reloadCarbon();
  }

  // ── exports (style PowerKlock : globals) ─────────────────────────
  window.toggleCarbonRow = toggleCarbonRow;
  window.renderCarbonBoard = renderCarbonBoard;
  window.reloadCarbon = reloadCarbon;
  window.initCarbon = initCarbon;
  window.__carbCharts = _carbCharts;       // pour le bouton ↺ inline
})();
