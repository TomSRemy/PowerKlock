// ── GEOJSON CHOROPLETH
let geoLayer = null;

// Mapping from GeoJSON country names / ISO to our zone codes
const ISO_TO_ZONE = {
  'FR':'FR','DE':'DE_LU','BE':'BE','NL':'NL','ES':'ES','PT':'PT',
  'IT':'IT_NORD','CH':'CH','AT':'AT','CZ':'CZ','SK':'SK','HU':'HU',
  'PL':'PL','RO':'RO','HR':'HR','SI':'SI','RS':'RS','BG':'BG',
  'GR':'GR','MK':'MK','ME':'ME','DK':'DK_W','SE':'SE','NO':'NO_1',
  'FI':'FI','EE':'EE','LV':'LV','LT':'LT','GB':'GB','MT':'MT',
  'BA':'RS', // Bosnia → use Serbia as proxy
  'AL':'GR', // Albania → Greece proxy
  'XK':'RS', // Kosovo → Serbia proxy
};

function getZoneForISO(iso) {
  const code = ISO_TO_ZONE[iso];
  if (!code) return null;
  const data = getZoneData();
  return data.find(z => z.code === code || z.code === code.replace('_LU','') || z.code === code.split('_')[0]);
}

function geoStyle(feature) {
  const iso = feature.properties.iso_a2 || feature.properties.ISO_A2;
  const zone = getZoneForISO(iso);
  const data = getZoneData();
  const prices = data.map(z => z.today).filter(v => v !== null);
  const mn = Math.min(...prices);
  const mx = Math.max(...prices);

  let fillColor = '#0e151d';
  let fillOpacity = 0.3;

  if (zone) {
    fillOpacity = 0.82;
    if (mapView === 'price') fillColor = priceToColor(zone.today, mn, mx);
    else if (mapView === 'spark') fillColor = (zone.spark||0) >= 0 ? '#22c55e' : '#ef4444';
    else if (mapView === 'neg') fillColor = negToColor(zone.negHrs || zone.neg || 0);
    else fillColor = deltaToColor(zone.vsYday || zone.vsY);
  }

  return {
    fillColor,
    fillOpacity,
    color: 'rgba(220,232,245,0.15)',  // subtle white borders
    weight: 1,
    opacity: 1,
  };
}

function onEachFeature(feature, layer) {
  const iso = feature.properties.iso_a2 || feature.properties.ISO_A2;
  const zone = getZoneForISO(iso);
  if (!zone) return;

  layer.on({
    mouseover: (e) => {
      e.target.setStyle({ weight: 2, color: 'rgba(220,232,245,0.5)', fillOpacity: 0.9 });
      e.target.bringToFront();
    },
    mouseout: (e) => {
      if (geoLayer) geoLayer.resetStyle(e.target);
    },
    click: (e) => {
      showMapDetail(zone);
      leafletMap.fitBounds(e.target.getBounds(), { padding: [40, 40] });
    }
  });

  // Tooltip
  layer.bindTooltip(`
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#dce8f5;background:#0e151d;border:1px solid #223344;border-radius:5px;padding:6px 10px;line-height:1.6">
      <b style="color:#dce8f5">${zone.name}</b><br>
      <span style="color:${(zone.today||0)<30?'#10b981':(zone.today||0)>100?'#f05060':'#dce8f5'}">${(zone.today||0).toFixed(1)} €/MWh</span>
      ${(zone.vsYday||zone.vsY) !== null ? `<span style="color:#7a9ab8"> · ${(zone.vsYday||zone.vsY||0)>=0?'▲':'▼'}${Math.abs(zone.vsYday||zone.vsY||0).toFixed(1)}</span>` : ''}
      ${(zone.negHrs||zone.neg||0)>0 ? `<br><span style="color:#e8a020">${zone.negHrs||zone.neg}h negative</span>` : ''}
    </div>
  `, { sticky: true, className: 'geo-tooltip' });
}

async function loadEUGeoJSON() {
  try {
    // Use Natural Earth 110m countries (lightweight, ~200KB)
    const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
    const r = await fetch(url);
    const geo = await r.json();

    // Filter to Europe only -- use geometry centroid, more reliable than LABEL_X
    const euFeatures = geo.features.filter(f => {
      const p = f.properties;
      const iso = p.iso_a2 || p.ISO_A2 || '';
      // Explicit include list for EU bidding zones + neighbors
      const euISOs = new Set(['FR','DE','BE','NL','ES','PT','IT','CH','AT','CZ','SK','HU',
        'PL','RO','HR','SI','RS','BG','GR','MK','ME','DK','SE','NO','FI','EE','LV','LT',
        'GB','MT','BA','AL','XK','LU','IE','IS','UA','MD','BY','RU','TR']);
      if (euISOs.has(iso)) return true;
      // Fallback: centroid lon/lat check
      const lon = p.LABEL_X || p.longitude || 0;
      const lat = p.LABEL_Y || p.latitude || 0;
      return lon > -25 && lon < 50 && lat > 28 && lat < 73;
    });

    const euGeo = { type: 'FeatureCollection', features: euFeatures };

    if (geoLayer) leafletMap.removeLayer(geoLayer);
    geoLayer = L.geoJSON(euGeo, {
      style: geoStyle,
      onEachFeature,
    }).addTo(leafletMap);

    // Add price labels on top of each country
    addMapPriceLabels();

    console.log('✅ GeoJSON loaded:', euFeatures.length, 'countries');
  } catch(e) {
    console.warn('GeoJSON load failed, using markers only:', e.message);
  }
}

function addMapPriceLabels() {
  // Remove old labels
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];

  const data = getZoneData();
  data.forEach(zone => {
    const code = zone.code || '';
    const coords = ZONE_COORDS[code];
    if (!coords) return;

    let val, unit;
    if (mapView === 'price') { val = zone.today?.toFixed(1); unit = '€'; }
    else if (mapView === 'spark') { val = (zone.spark||0)>=0?'+'+zone.spark?.toFixed(1):zone.spark?.toFixed(1); unit='€'; }
    else if (mapView === 'neg') { val = (zone.negHrs||0)+'h'; unit=''; }
    else { val = (zone.vsYday||0)>=0?'+'+zone.vsYday?.toFixed(1):zone.vsYday?.toFixed(1); unit='€'; }

    const textColor = mapView==='price'
      ? (zone.today<20?'#10b981':zone.today>100?'#fca5a5':'#fff')
      : '#fff';

    const label = L.divIcon({
      className: '',
      html: `<div style="text-align:center;pointer-events:none;transform:translate(-50%,-50%);white-space:nowrap">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;color:${textColor};text-shadow:0 1px 3px rgba(0,0,0,.8)">${val}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:8px;color:rgba(255,255,255,.6);text-shadow:0 1px 2px rgba(0,0,0,.8)">${zone.code}</div>
      </div>`,
      iconSize: [50, 24],
      iconAnchor: [25, 12],
    });
    const m = L.marker(coords, { icon: label, interactive: false, zIndexOffset: 1000 }).addTo(leafletMap);
    mapMarkers.push(m);
  });
}

function refreshGeoLayer() {
  if (!geoLayer) return;
  geoLayer.setStyle(geoStyle);
  addMapPriceLabels();
}

function setMapView(view, btn) {
  mapView = view;
  document.querySelectorAll('#map-view-tabs .day-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateMapMarkers();
  renderMapLegend();
  refreshGeoLayer();
}

function initLeafletMap() {
  if (mapInitialized) return;
  mapInitialized = true;

  // Dark tile layer — CartoDB Dark Matter (free, no key)
  leafletMap = L.map('leaflet-map', {
    center: [50, 10],
    zoom: 4,
    zoomControl: true,
    attributionControl: true,
    minZoom: 3,
    maxZoom: 8,
  });

  // Base dark tile (no labels — we draw our own)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(leafletMap);

  // Load EU GeoJSON for choropleth + borders
  loadEUGeoJSON();
  updateMapMarkers();
  renderMapLegend();
  renderMapKPIs();
}

function getZoneData() {
  const data = pricesData && pricesData.length ? pricesData : getDemoData();
  return data;
}

function updateMapMarkers() {
  if (!leafletMap) return;
  // Markers disabled — choropleth only
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];
  // Just refresh geo layer
  refreshGeoLayer();
  return;
  const data = getZoneData();

  const prices = data.map(z => z.today).filter(v => v !== null);
  const mn = Math.min(...prices);
  const mx = Math.max(...prices);

  data.forEach(zone => {
    const code = zone.code || zone.flag;
    const coords = ZONE_COORDS[code] || ZONE_COORDS[zone.code?.replace('-','_')];
    if (!coords) return;

    let fillColor, value, unit;
    if (mapView === 'price') {
      fillColor = priceToColor(zone.today, mn, mx);
      value = zone.today?.toFixed(1);
      unit = '€/MWh';
    } else if (mapView === 'spark') {
      fillColor = zone.spark >= 0 ? 'rgba(16,185,129,.7)' : 'rgba(240,80,96,.7)';
      value = zone.spark?.toFixed(1);
      unit = '€/MWh CSS';
    } else if (mapView === 'neg') {
      fillColor = negToColor(zone.negHrs || zone.neg || 0);
      value = (zone.negHrs || zone.neg || 0);
      unit = 'h neg.';
    } else {
      fillColor = deltaToColor(zone.vsYday || zone.vsY);
      value = (zone.vsYday || zone.vsY)?.toFixed(1);
      unit = '€ vs yday';
    }

    // Circle marker
    const radius = 28 + Math.min(20, Math.abs(zone.today || 0) / 5);
    const marker = L.circleMarker(coords, {
      radius: 22,
      fillColor,
      fillOpacity: 0.85,
      color: 'rgba(255,255,255,.2)',
      weight: 1,
      className: 'map-zone-marker',
    }).addTo(leafletMap);

    // Label inside circle
    const label = L.divIcon({
      className: '',
      html: `<div style="
        text-align:center;
        font-family:'IBM Plex Mono',monospace;
        pointer-events:none;
        transform:translate(-50%,-50%);
        white-space:nowrap;
      ">
        <div style="font-size:9px;color:rgba(255,255,255,.7);font-weight:500">${code}</div>
        <div style="font-size:11px;color:#fff;font-weight:700;line-height:1.1">${value ?? '--'}</div>
      </div>`,
      iconSize: [60, 30],
      iconAnchor: [30, 15],
    });
    const labelMarker = L.marker(coords, { icon: label, interactive: false }).addTo(leafletMap);
    mapMarkers.push(labelMarker);

    // Popup on click
    marker.bindPopup(`
      <div style="font-family:'IBM Plex Sans',sans-serif;min-width:180px">
        <div style="font-size:13px;font-weight:600;color:#dce8f5;margin-bottom:8px">${zone.name} <span style="font-size:10px;color:#7a9ab8">${code}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><div style="font-size:9px;color:#3d5a7a;text-transform:uppercase;letter-spacing:.06em">DA Price</div><div style="font-size:14px;font-weight:700;color:#dce8f5">${zone.today?.toFixed(1)} €/MWh</div></div>
          <div><div style="font-size:9px;color:#3d5a7a;text-transform:uppercase;letter-spacing:.06em">vs Yday</div><div style="font-size:14px;font-weight:700;color:${(zone.vsYday||zone.vsY||0)>=0?'#f05060':'#10b981'}">${(zone.vsYday||zone.vsY||0)>=0?'+':''}${(zone.vsYday||zone.vsY||0).toFixed(1)}</div></div>
          <div><div style="font-size:9px;color:#3d5a7a;text-transform:uppercase;letter-spacing:.06em">Min @h</div><div style="font-size:12px;color:#10b981">${zone.min?.toFixed(1)} @${zone.minHr||zone.minH||0}h</div></div>
          <div><div style="font-size:9px;color:#3d5a7a;text-transform:uppercase;letter-spacing:.06em">Max @h</div><div style="font-size:12px;color:#f05060">${zone.max?.toFixed(1)} @${zone.maxHr||zone.maxH||0}h</div></div>
          <div><div style="font-size:9px;color:#3d5a7a;text-transform:uppercase;letter-spacing:.06em">Neg Hrs</div><div style="font-size:12px;color:${(zone.negHrs||zone.neg||0)>0?'#e8a020':'#3d5a7a'}">${zone.negHrs||zone.neg||0}h</div></div>
          <div><div style="font-size:9px;color:#3d5a7a;text-transform:uppercase;letter-spacing:.06em">Spark CSS</div><div style="font-size:12px;color:${(zone.spark||0)>=0?'#10b981':'#f05060'}">${(zone.spark||0)>=0?'+':''}${(zone.spark||0).toFixed(1)}</div></div>
        </div>
      </div>
    `, { className: 'map-popup' });

    marker.on('click', () => showMapDetail(zone));
    mapMarkers.push(marker);
  });
}

function renderMapLegend() {
  const el = document.getElementById('map-legend');
  if (!el) return;
  if (mapView === 'price') {
    const data2 = getZoneData();
    const prices2 = data2.map(z=>z.today).filter(v=>v!==null);
    const mn2 = Math.floor(Math.min(...prices2)/10)*10;
    const mx2 = Math.ceil(Math.max(...prices2)/10)*10;
    const step = Math.round((mx2-mn2)/5/10)*10 || 10;
    const steps = Array.from({length:6}, (_,i) => mn2 + i*step);
    el.innerHTML = steps.map((v,i) => {
      const col = priceToColor(v, mn2, mx2);
      return `<div style="display:flex;align-items:center;gap:6px">
        <div style="width:14px;height:8px;border-radius:2px;background:${col}"></div>
        <span style="font-size:10px;color:#7a9ab8;font-family:'IBM Plex Mono',monospace">${v} €</span>
      </div>`;
    }).join('');
  } else if (mapView === 'neg') {
    el.innerHTML = [0,2,4,6,8,12].map((v,i,a) => {
      const col = negToColor(v);
      return `<div style="display:flex;align-items:center;gap:6px">
        <div style="width:14px;height:8px;border-radius:2px;background:${col}"></div>
        <span style="font-size:10px;color:#7a9ab8;font-family:'IBM Plex Mono',monospace">${v}h</span>
      </div>`;
    }).join('');
  } else if (mapView === 'delta') {
    el.innerHTML = [
      {l:'▲ +30€',c:'rgba(240,80,96,.9)'},{l:'▲ +15€',c:'rgba(240,80,96,.5)'},
      {l:'≈ 0',c:'#1a2d3f'},
      {l:'▼ -15€',c:'rgba(16,185,129,.5)'},{l:'▼ -30€',c:'rgba(16,185,129,.9)'},
    ].map(s=>`<div style="display:flex;align-items:center;gap:6px">
      <div style="width:14px;height:8px;border-radius:2px;background:${s.c}"></div>
      <span style="font-size:10px;color:#7a9ab8;font-family:'IBM Plex Mono',monospace">${s.l}</span>
    </div>`).join('');
  } else {
    el.innerHTML = [
      {l:'CSS > 0',c:'rgba(16,185,129,.8)'},{l:'CSS < 0',c:'rgba(240,80,96,.8)'},
    ].map(s=>`<div style="display:flex;align-items:center;gap:6px">
      <div style="width:14px;height:8px;border-radius:2px;background:${s.c}"></div>
      <span style="font-size:10px;color:#7a9ab8;font-family:'IBM Plex Mono',monospace">${s.l}</span>
    </div>`).join('');
  }
}

function renderMapKPIs() {
  const el = document.getElementById('map-kpis');
  if (!el) return;
  const data = getZoneData();
  const sorted = [...data].sort((a,b)=>b.today-a.today);
  const avg = data.reduce((s,z)=>s+z.today,0)/data.length;
  const negZones = data.filter(z=>(z.negHrs||z.neg||0)>0).length;
  const fr = data.find(z=>z.code==='FR');
  const de = data.find(z=>z.code==='DE'||z.code==='DE_LU');

  el.innerHTML = [
    {l:'EU Average', v:avg.toFixed(1)+'€', sub:'€/MWh', cls:''},
    {l:'Highest', v:(sorted[0]?.today?.toFixed(1)||'--')+'€', sub:sorted[0]?.code||'--', cls:'down'},
    {l:'Lowest', v:(sorted[sorted.length-1]?.today?.toFixed(1)||'--')+'€', sub:sorted[sorted.length-1]?.code||'--', cls:'up'},
    {l:'Zones neg. prices', v:negZones, sub:'zones', cls:'warn'},
  ].map(k=>`<div class="kpi-card">
    <div class="kl">${k.l}</div>
    <div class="kv ${k.cls}" style="font-size:17px">${k.v}</div>
    <div class="kd" style="color:var(--tx3)">${k.sub}</div>
  </div>`).join('');
}

function showMapDetail(zone) {
  const el = document.getElementById('map-detail');
  const title = document.getElementById('map-detail-title');
  const kpis = document.getElementById('map-detail-kpis');
  if (!el || !title || !kpis) return;

  el.style.display = 'block';
  title.textContent = `${zone.name} (${zone.code}) — Day-Ahead Detail`;

  kpis.innerHTML = [
    {l:'DA Price', v:(zone.today||0).toFixed(2)+' €/MWh', cls:(zone.today||0)<30?'up':(zone.today||0)>100?'down':''},
    {l:'vs Yday', v:((zone.vsYday||zone.vsY||0)>=0?'+':'')+((zone.vsYday||zone.vsY)||0).toFixed(2)+' €', cls:(zone.vsYday||zone.vsY||0)>=0?'down':'up'},
    {l:'Min', v:(zone.min||0).toFixed(2)+' €', cls:'up', sub:'@'+(zone.minHr||zone.minH||0)+'h'},
    {l:'Max', v:(zone.max||0).toFixed(2)+' €', cls:'down', sub:'@'+(zone.maxHr||zone.maxH||0)+'h'},
    {l:'Neg Hours', v:(zone.negHrs||zone.neg||0)+'h', cls:(zone.negHrs||zone.neg||0)>0?'warn':''},
  ].map(k=>`<div class="kpi-card">
    <div class="kl">${k.l}</div>
    <div class="kv ${k.cls}" style="font-size:15px">${k.v}</div>
    ${k.sub?`<div class="kd" style="color:var(--tx3)">${k.sub}</div>`:''}
  </div>`).join('');

  // Hourly chart for selected zone
  const hourly = zone.hourly && zone.hourly.length ? zone.hourly
    : genHourly24(zone.today||50, zone.min||0, zone.max||100);
  const labels = makeTimeLabels(hourly.length);
  const col = (zone.today||0) >= 0 ? C_UP : C_DN;

  mkChart('map-detail-chart', {
    type:'line',
    data:{ labels, datasets:[{
      label:'Hourly Price (€/MWh)',
      data: hourly,
      borderColor: col,
      borderWidth:2,
      pointRadius:0,
      fill:true,
      backgroundColor: rgba(col,.1),
      tension:0,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>ctx.raw.toFixed(2)+' €/MWh'}}, zoom:ZOOM_CFG },
      scales:{
        x:{grid:GRID, ticks:{color:C_TX3}},
        y:{grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(0)+'€'}}
      }
    }
  });
  setTimeout(()=>{ addFullscreen('map-detail-chart'); addDownload('map-detail-chart','hourly-'+zone.code); },100);
}

// Leaflet popup styling (injected once)
const mapStyle = document.createElement('style');
mapStyle.textContent = `
  .map-popup .leaflet-popup-content-wrapper {
    background:#0e151d;border:1px solid #223344;border-radius:8px;color:#dce8f5;box-shadow:0 8px 32px rgba(0,0,0,.5);
  }
  .map-popup .leaflet-popup-tip { background:#0e151d; }
  .map-popup .leaflet-popup-content { margin:14px; }
  .map-popup .leaflet-popup-close-button { color:#7a9ab8!important;font-size:16px!important; }
  .leaflet-control-zoom a { background:#0e151d!important;border-color:#223344!important;color:#7a9ab8!important; }
  .leaflet-control-zoom a:hover { background:#131d28!important;color:#dce8f5!important; }
  .leaflet-bar { border:1px solid #223344!important;border-radius:6px!important;overflow:hidden; }
  .leaflet-attribution-flag { display:none!important; }
  .geo-tooltip { background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important; }
  .geo-tooltip .leaflet-tooltip-content { padding:0; }
`;
document.head.appendChild(mapStyle);


const DATA_BASE = (() => {
  const loc = window.location.href.toLowerCase();
  if (loc.includes('github.io') || loc.includes('localhost') || loc.includes('127.0.0.1')) {
    return './data/';
  }
  return null;
})();

async function fetchJSON(file) {
  if (!DATA_BASE) return null;
  try {
    const r = await fetch(DATA_BASE + file + '?t=' + Date.now());
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

