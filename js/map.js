// ── GEOJSON CHOROPLETH
let geoLayer = null;
// Map state — these previously lived in the (now unloaded) globals.js.
// Declared here so map.js is self-contained and never hits ReferenceErrors.
let mapInitialized = false;
let leafletMap = null;
let mapMarkers = [];
let mapView = 'price';

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

// Approximate [lat, lon] centroid for each bidding zone in ZONES (prices.js)
// — used to place the price labels drawn on top of the choropleth. Was
// referenced here but never defined anywhere in the codebase, which threw
// a ReferenceError every time the map labels needed a (re)draw.
const ZONE_COORDS = {
  FR: [46.6, 2.5], DE_LU: [51.0, 10.0], BE: [50.6, 4.5], NL: [52.2, 5.3],
  ES: [40.0, -3.7], PT: [39.5, -8.0], GB: [54.0, -2.5], CH: [46.8, 8.2],
  AT: [47.5, 14.5], CZ: [49.8, 15.5], SK: [48.7, 19.5], HU: [47.1, 19.5],
  IT_NORD: [45.46, 9.19], IT_SOUTH: [40.85, 14.3], IT_SICI: [37.6, 14.0], RO: [45.9, 24.97],
  HR: [45.3, 16.0], SI: [46.05, 14.5], RS: [44.0, 20.9], BG: [42.7, 25.3],
  GR: [39.0, 22.0], MK: [41.6, 21.7], ME: [42.7, 19.3],
  DK_W: [56.0, 9.0], DK_E: [55.5, 12.0], SE_3: [59.3, 17.5],
  NO_1: [60.1, 11.0], NO_2: [59.5, 8.0], NO_3: [63.4, 10.4],
  FI: [63.0, 26.0], EE: [58.9, 25.0], LV: [56.9, 24.6], LT: [55.2, 23.9],
};

// The Natural Earth GeoJSON used here sets `ISO_A2` to the literal string
// "-99" for a handful of countries — France, Norway and Kosovo among them —
// a long-standing upstream quirk (those countries have dependencies/status
// complications that break the plain ISO_A2 field). `ISO_A2_EH` ("Expanded
// Hierarchy") is Natural Earth's own fix for this and has the real code.
// Without this fallback, every lookup for those countries' features failed:
// France rendered as an uncolored "no data" shape and had no click handler
// at all, despite its price data being loaded correctly.
function isoFromFeature(feature) {
  const p = feature.properties || {};
  const iso = p.iso_a2 || p.ISO_A2;
  if (iso && iso !== '-99') return iso;
  return p.ISO_A2_EH || iso || null;
}

function getZoneForISO(iso) {
  const code = ISO_TO_ZONE[iso];
  if (!code) return null;
  const data = getZoneData();
  return data.find(z => z.code === code || z.code === code.replace('_LU','') || z.code === code.split('_')[0]);
}

// ── Colour scales for the choropleth + legend ──
// These were referenced throughout this file (geoStyle, renderMapLegend) but
// never defined anywhere in the codebase — every call threw a ReferenceError,
// which aborted the GeoJSON style callback and broke the whole map.
function _lerpRGB(c0, c1, t) {
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// Low price → green, mid → amber, high price → red (same palette as the
// rest of the app: #14D3A9 up/good, #FBBF24 warn, #ED6965 down/bad).
function priceToColor(value, min, max) {
  if (value === null || value === undefined || isNaN(value)) return '#1e2d3d';
  const range = max - min;
  let t = range > 0 ? (value - min) / range : 0.5;
  t = Math.max(0, Math.min(1, t));
  return t <= 0.5
    ? _lerpRGB([20, 211, 169], [251, 191, 36], t / 0.5)
    : _lerpRGB([251, 191, 36], [237, 105, 101], (t - 0.5) / 0.5);
}

// Negative-price hours → neutral at 0h, ramping to amber as hours climb.
function negToColor(hours) {
  const t = Math.max(0, Math.min(1, (Number(hours) || 0) / 12));
  return _lerpRGB([30, 45, 61], [238, 155, 2], t);
}

// vs. yesterday delta → neutral at 0, red for rising prices, green for falling.
function deltaToColor(delta) {
  const d = Number(delta);
  if (delta === null || delta === undefined || isNaN(d)) return '#1e2d3d';
  const t = Math.max(-1, Math.min(1, d / 30));
  return t >= 0
    ? _lerpRGB([30, 45, 61], [237, 105, 101], t)
    : _lerpRGB([30, 45, 61], [20, 211, 169], -t);
}

function geoStyle(feature) {
  const iso = isoFromFeature(feature);
  const zone = getZoneForISO(iso);
  const data = getZoneData();
  const prices = data.map(z => z.today).filter(v => v !== null);
  const mn = Math.min(...prices);
  const mx = Math.max(...prices);

  let fillColor = '#0f1419';
  let fillOpacity = 0.3;

  if (zone) {
    fillOpacity = 0.82;
    if (mapView === 'price') fillColor = priceToColor(zone.today, mn, mx);
    else if (mapView === 'spark') fillColor = zone.spark == null ? '#1e2d3d' : (zone.spark >= 0 ? '#22c55e' : '#ef4444');
    else if (mapView === 'neg') fillColor = negToColor(zone.negHrs || zone.neg || 0);
    else fillColor = deltaToColor(zone.vsYday || zone.vsY);
  }

  return {
    fillColor,
    fillOpacity,
    color: 'rgba(230,238,248,0.45)',  // was 0.15 — too faint to read as a border between two similarly-priced zones
    weight: 1.1,
    opacity: 1,
  };
}

// Zoom in on a clicked zone. Some Natural Earth polygons bundle overseas
// territories into the same feature — France's geometry includes French
// Guiana (South America, ~7000km from mainland France) — so fitBounds() on
// the raw polygon computed a bounding box spanning the Atlantic and zoomed
// the map OUT to a world view instead of in on the country just clicked.
// Center on our own curated mainland centroid at a fixed country-level zoom
// instead; only fall back to the (capped) raw bounds when a zone has none.
function focusZoneOnMap(zone, layer) {
  const coords = ZONE_COORDS[zone.code];
  if (coords) {
    leafletMap.setView(coords, Math.max(leafletMap.getZoom(), 6), { animate: true });
    return;
  }
  const bounds = layer.getBounds();
  if (bounds.isValid()) {
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
  }
}

function onEachFeature(feature, layer) {
  const iso = isoFromFeature(feature);
  const zone = getZoneForISO(iso);
  if (!zone) return;

  layer.on({
    mouseover: (e) => {
      e.target.setStyle({ weight: 2.2, color: 'rgba(255,255,255,0.85)', fillOpacity: 0.9 });
      e.target.bringToFront();
    },
    mouseout: (e) => {
      if (geoLayer) geoLayer.resetStyle(e.target);
    },
    click: (e) => {
      showMapDetail(zone);
      focusZoneOnMap(zone, e.target);
    }
  });

  // Tooltip
  layer.bindTooltip(`
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#FFFFFF;background:#0f1419;border:1px solid #243447;border-radius:5px;padding:6px 10px;line-height:1.6">
      <b style="color:#FFFFFF">${zone.name}</b><br>
      <span style="color:${(zone.today||0)<30?'#14D3A9':(zone.today||0)>100?'#ED6965':'#FFFFFF'}">${(zone.today||0).toFixed(1)} €/MWh</span>
      ${(zone.vsYday||zone.vsY) !== null ? `<span style="color:#B8C9D9"> · ${(zone.vsYday||zone.vsY||0)>=0?'▲':'▼'}${Math.abs(zone.vsYday||zone.vsY||0).toFixed(1)}</span>` : ''}
      ${(zone.negHrs||zone.neg||0)>0 ? `<br><span style="color:#EE9B00">${zone.negHrs||zone.neg}h negative</span>` : ''}
    </div>
  `, { sticky: true, className: 'geo-tooltip' });
}

async function loadEUGeoJSON() {
  try {
    // 50m countries (~3MB, fetched once) instead of 110m (~200KB) — the 110m
    // set only gave France's whole outline 74 vertices total, which made
    // every border render as a handful of straight diagonal segments (very
    // visible on mountainous borders like the France/Spain Pyrenees). 50m
    // gives the same shape ~800 points, close enough to the real coastline/
    // border shape to read as smooth at this map's zoom range (3–8).
    const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
    const r = await fetch(url);
    const geo = await r.json();

    // Filter to Europe only -- use geometry centroid, more reliable than LABEL_X
    const euFeatures = geo.features.filter(f => {
      const p = f.properties;
      const iso = isoFromFeature(f) || '';
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
      smoothFactor: 0.6, // default 1.0 simplifies further than needed now that the source data itself has enough detail
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
    else if (mapView === 'spark') { val = zone.spark == null ? '–' : (zone.spark>=0?'+'+zone.spark.toFixed(1):zone.spark.toFixed(1)); unit = zone.spark == null ? '' : '€'; }
    else if (mapView === 'neg') { val = (zone.negHrs||0)+'h'; unit=''; }
    else { val = (zone.vsYday||0)>=0?'+'+zone.vsYday?.toFixed(1):zone.vsYday?.toFixed(1); unit='€'; }

    const textColor = mapView==='price'
      ? (zone.today<20?'#14D3A9':zone.today>100?'#fca5a5':'#fff')
      : '#fff';

    // A pill badge (translucent dark backing + thin border) reads cleanly
    // regardless of the choropleth colour underneath it — the old version
    // relied only on a text-shadow, which washed out on the brighter mid-tones
    // of the price gradient.
    const label = L.divIcon({
      className: '',
      html: `<div style="text-align:center;pointer-events:none;transform:translate(-50%,-50%);white-space:nowrap;background:rgba(8,12,18,.62);border:1px solid rgba(255,255,255,.10);border-radius:6px;padding:2px 7px;backdrop-filter:blur(1px);box-shadow:0 2px 6px rgba(0,0,0,.35)">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;color:${textColor};line-height:1.25">${val}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:8px;color:rgba(255,255,255,.55);letter-spacing:.03em">${zone.code}</div>
      </div>`,
      iconSize: [56, 28],
      iconAnchor: [28, 14],
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

  // Dark tile layer.
  leafletMap = L.map('leaflet-map', {
    center: [50, 10],
    zoom: 4,
    zoomControl: true,
    attributionControl: true,
    minZoom: 3,
    maxZoom: 8,
  });

  // Base dark tile — CARTO's basemaps.cartocdn.com now requires an API key
  // for every layer (it used to be free/anonymous), so every tile came back
  // as a grey "API KEY REQUIRED" placeholder. Switched to Esri's dark grey
  // canvas basemap, which is still free and keyless; it has its own light
  // country labels baked in (no separate "_nolabels" variant like CARTO had),
  // but that's a cosmetic tradeoff against the map being blank.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 16,
    className: 'pk-map-tiles',
  }).addTo(leafletMap);

  // The Esri basemap on its own is plain neutral grey — darken/desaturate it
  // a touch via CSS (below) and lay a faint teal radial tint on top so it
  // reads as part of this app's palette instead of a generic drop-in map.
  const tint = document.createElement('div');
  tint.style.cssText = 'position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%, rgba(20,211,169,.07), rgba(10,14,20,.22) 72%);mix-blend-mode:overlay;pointer-events:none;z-index:250;';
  document.getElementById('leaflet-map').appendChild(tint);

  // Load EU GeoJSON for choropleth + borders
  loadEUGeoJSON();
  updateMapMarkers();
  renderMapLegend();
  renderMapKPIs();
}

function getZoneData() {
  const data = (pricesData && pricesData.length) ? pricesData : [];   // no demo fallback: empty until prices load
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
        <div style="font-size:13px;font-weight:600;color:#FFFFFF;margin-bottom:8px">${zone.name} <span style="font-size:10px;color:#B8C9D9">${code}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><div style="font-size:9px;color:#7A93AB;text-transform:uppercase;letter-spacing:.06em">DA Price</div><div style="font-size:14px;font-weight:700;color:#FFFFFF">${zone.today?.toFixed(1)} €/MWh</div></div>
          <div><div style="font-size:9px;color:#7A93AB;text-transform:uppercase;letter-spacing:.06em">vs Yday</div><div style="font-size:14px;font-weight:700;color:${(zone.vsYday||zone.vsY||0)>=0?'#ED6965':'#14D3A9'}">${(zone.vsYday||zone.vsY||0)>=0?'+':''}${(zone.vsYday||zone.vsY||0).toFixed(1)}</div></div>
          <div><div style="font-size:9px;color:#7A93AB;text-transform:uppercase;letter-spacing:.06em">Min @h</div><div style="font-size:12px;color:#14D3A9">${zone.min?.toFixed(1)} @${zone.minHr||zone.minH||0}h</div></div>
          <div><div style="font-size:9px;color:#7A93AB;text-transform:uppercase;letter-spacing:.06em">Max @h</div><div style="font-size:12px;color:#ED6965">${zone.max?.toFixed(1)} @${zone.maxHr||zone.maxH||0}h</div></div>
          <div><div style="font-size:9px;color:#7A93AB;text-transform:uppercase;letter-spacing:.06em">Neg Hrs</div><div style="font-size:12px;color:${(zone.negHrs||zone.neg||0)>0?'#EE9B00':'#7A93AB'}">${zone.negHrs||zone.neg||0}h</div></div>
          <div><div style="font-size:9px;color:#7A93AB;text-transform:uppercase;letter-spacing:.06em">Spark CSS</div><div style="font-size:12px;color:${(zone.spark||0)>=0?'#14D3A9':'#ED6965'}">${(zone.spark||0)>=0?'+':''}${(zone.spark||0).toFixed(1)}</div></div>
        </div>
      </div>
    `, { className: 'map-popup' });

    marker.on('click', () => showMapDetail(zone));
    mapMarkers.push(marker);
  });
}

// Continuous vertical gradient bar (thermometer-style) — reads much more
// like a real map legend than a stack of discrete swatches, and actually
// shows the colour scale continuously instead of implying 6 hard bands.
function _mapGradientLegendHTML(colorFn, mn, mx, fmt) {
  const stops = 10;
  const grad = Array.from({ length: stops + 1 }, (_, i) => {
    const t = i / stops;
    return colorFn(mn + t * (mx - mn)) + ' ' + Math.round(t * 100) + '%';
  }).join(', ');
  return `
    <div style="display:flex;gap:10px;align-items:stretch;height:130px">
      <div style="width:10px;border-radius:5px;background:linear-gradient(to top, ${grad});flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)"></div>
      <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;color:#B8C9D9;font-family:'IBM Plex Mono',monospace">
        <span>${fmt(mx)}</span>
        <span style="color:#7A93AB">${fmt((mn + mx) / 2)}</span>
        <span>${fmt(mn)}</span>
      </div>
    </div>`;
}

function renderMapLegend() {
  const el = document.getElementById('map-legend');
  const titleEl = document.getElementById('map-legend-title');
  if (!el) return;
  if (mapView === 'price') {
    if (titleEl) titleEl.textContent = 'Scale (€/MWh)';
    const data2 = getZoneData();
    const prices2 = data2.map(z=>z.today).filter(v=>v!==null);
    const mn2 = Math.floor(Math.min(...prices2)/10)*10;
    const mx2 = Math.ceil(Math.max(...prices2)/10)*10;
    el.innerHTML = _mapGradientLegendHTML((v) => priceToColor(v, mn2, mx2), mn2, mx2, (v) => Math.round(v) + '€');
  } else if (mapView === 'neg') {
    if (titleEl) titleEl.textContent = 'Scale (hours)';
    el.innerHTML = _mapGradientLegendHTML(negToColor, 0, 12, (v) => Math.round(v) + 'h');
  } else if (mapView === 'delta') {
    if (titleEl) titleEl.textContent = 'Scale (Δ vs yday)';
    el.innerHTML = _mapGradientLegendHTML(deltaToColor, -30, 30, (v) => (v > 0 ? '+' : '') + Math.round(v) + '€');
  } else {
    if (titleEl) titleEl.textContent = 'Spark spread';
    el.innerHTML = [
      {l:'CSS > 0',c:'rgba(16,185,129,.8)'},{l:'CSS < 0',c:'rgba(240,80,96,.8)'},
    ].map(s=>`<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
      <div style="width:14px;height:14px;border-radius:4px;background:${s.c}"></div>
      <span style="font-size:10px;color:#B8C9D9;font-family:'IBM Plex Mono',monospace">${s.l}</span>
    </div>`).join('');
  }
}

function renderMapKPIs() {
  const el = document.getElementById('map-kpis');
  if (!el) return;
  const data = getZoneData();
  if (!data.length) { el.innerHTML = '<div class="fuel-note" style="grid-column:1/-1"><span class="spinner"></span> Loading day-ahead prices…</div>'; return; }
  const sorted = [...data].sort((a,b)=>b.today-a.today);
  const avg = data.reduce((s,z)=>s+z.today,0)/data.length;
  const negZones = data.filter(z=>(z.negHrs||z.neg||0)>0).length;
  const fr = data.find(z=>z.code==='FR');
  const de = data.find(z=>z.code==='DE'||z.code==='DE_LU');

  const valid = data.filter(z => z.today != null);
  const hi = sorted[0], lo = sorted[sorted.length - 1];
  const day = window._currentPriceDate ? new Date(window._currentPriceDate + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';
  const card = (l, v, u, m, tone) => `<div class="kpi-card ${tone ? 'kpi-' + tone : 'kpi-flat'}"><div class="kpi-label">${l}</div><div class="kpi-value">${v}<span class="kpi-unit">${u}</span></div><div class="kpi-meta">${m}</div></div>`;
  el.innerHTML =
    card('Panel average', avg.toFixed(2), '€/MWh', `${valid.length} zones · ${day}`) +
    card('Highest', hi ? hi.today.toFixed(2) : '--', '€/MWh', hi ? hi.code : '', 'down') +
    card('Lowest', lo ? lo.today.toFixed(2) : '--', '€/MWh', lo ? lo.code : '', 'up') +
    card('Spread', hi && lo ? (hi.today - lo.today).toFixed(2) : '--', '€/MWh', 'highest − lowest zone') +
    card('France', fr ? fr.today.toFixed(2) : '--', '€/MWh', fr && fr.vsYday != null ? `${fr.vsYday >= 0 ? '▲ +' : '▼ '}${fr.vsYday.toFixed(2)} vs J-1` : '') +
    card('Negative prices', negZones, negZones === 1 ? 'zone' : 'zones', 'at least one negative slot', negZones ? 'down' : null);
  // Default the side panel to France instead of leaving it empty.
  const content = document.getElementById('map-detail-content');
  if (fr && content && content.style.display === 'none' && !window._mapDetailAuto) {
    window._mapDetailAuto = true;
    try { showMapDetail(fr); } catch (_) {}
  }
}

function showMapDetail(zone) {
  const placeholder = document.getElementById('map-detail-placeholder');
  const content = document.getElementById('map-detail-content');
  const title = document.getElementById('map-detail-title');
  const kpis = document.getElementById('map-detail-kpis');
  if (!content || !title || !kpis) return;

  if (placeholder) placeholder.style.display = 'none';
  content.style.display = 'block';
  const flagEmoji = (typeof FLAG_MAP !== 'undefined' && FLAG_MAP[zone.code]) || '';
  title.innerHTML = `${flagEmoji} ${zone.name}<div style="font-size:10px;font-weight:500;color:var(--tx3);margin-top:2px">${zone.code} · Day-Ahead</div>`;

  kpis.innerHTML = [
    {l:'DA Price', v:(zone.today||0).toFixed(2)+' €/MWh', cls:(zone.today||0)<30?'up':(zone.today||0)>100?'down':''},
    {l:'vs Yday', v:((zone.vsYday||zone.vsY||0)>=0?'+':'')+((zone.vsYday||zone.vsY)||0).toFixed(2)+' €', cls:(zone.vsYday||zone.vsY||0)>=0?'down':'up'},
    {l:'Min', v:(zone.min||0).toFixed(2)+' €', cls:'up', sub:'@'+(zone.minHr||zone.minH||0)+'h'},
    {l:'Max', v:(zone.max||0).toFixed(2)+' €', cls:'down', sub:'@'+(zone.maxHr||zone.maxH||0)+'h'},
    {l:'Neg Hours', v:(zone.negHrs||zone.neg||0)+'h', cls:(zone.negHrs||zone.neg||0)>0?'warn':''},
  ].map(k=>`<div class="kpi-card ${k.cls === 'down' ? 'kpi-down' : k.cls === 'up' ? 'kpi-up' : 'kpi-flat'}" style="padding:10px 12px">
    <div class="kpi-label">${k.l}</div>
    <div class="kpi-value" style="font-size:16px">${k.v}</div>
    ${k.sub?`<div class="kpi-meta">${k.sub}</div>`:''}
  </div>`).join('');

  // Hourly chart for selected zone
  const hourly = zone.hourly && zone.hourly.length ? zone.hourly : [];
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
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>ctx.raw.toFixed(2)+' €/MWh'}},
        zoom:ZOOM_CFG,
        annotation: { annotations: (() => { const a = nowLineAnnotation({ slots: hourly.length, labels, chartDate: window._currentPriceDate }); return a ? { nowLine: a } : {}; })() }
      },
      scales:{
        x:{grid:GRID, ticks:{color:C_TX3, maxTicksLimit:7, maxRotation:0}},
        y:{grid:GRID, ticks:{color:C_TX3, callback:v=>v.toFixed(0)+'€'}}
      }
    }
  });
  setTimeout(()=>{ addFullscreen('map-detail-chart'); addDownload('map-detail-chart','hourly-'+zone.code); },100);
}

function closeMapDetail() {
  const placeholder = document.getElementById('map-detail-placeholder');
  const content = document.getElementById('map-detail-content');
  if (content) content.style.display = 'none';
  if (placeholder) placeholder.style.display = 'flex';
  if (geoLayer) geoLayer.resetStyle();
}
window.closeMapDetail = closeMapDetail;

// Leaflet popup styling (injected once)
const mapStyle = document.createElement('style');
mapStyle.textContent = `
  .map-popup .leaflet-popup-content-wrapper {
    background:#0f1419;border:1px solid #243447;border-radius:8px;color:#FFFFFF;box-shadow:0 8px 32px rgba(0,0,0,.5);
  }
  .map-popup .leaflet-popup-tip { background:#0f1419; }
  .map-popup .leaflet-popup-content { margin:14px; }
  .map-popup .leaflet-popup-close-button { color:#B8C9D9!important;font-size:16px!important; }
  .leaflet-control-zoom a { background:#0f1419!important;border-color:#243447!important;color:#B8C9D9!important; }
  .leaflet-control-zoom a:hover { background:#131d28!important;color:#FFFFFF!important; }
  .leaflet-bar { border:1px solid #243447!important;border-radius:6px!important;overflow:hidden; }
  .leaflet-attribution-flag { display:none!important; }
  .geo-tooltip { background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important; }
  .geo-tooltip .leaflet-tooltip-content { padding:0; }
  .pk-map-tiles { filter: grayscale(.25) brightness(.74) contrast(1.08) saturate(.9); }
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
