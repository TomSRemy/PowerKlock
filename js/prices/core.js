// js/prices/core.js — Prices: config, shared formats (PK_FMT), state, clock, navigation (showPage).
// Part of the former js/prices.js (lines 1–297), split without changes: plain scripts loaded in this order
// by index.html, sharing their globals as before.
// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
// Prices come from the data files written by the collection jobs (data/): the browser never calls ENTSO-E.

// Calendar date in Europe/Paris (YYYY-MM-DD). Day-ahead delivery days are
// CET/CEST days, so "today" must not be derived from the UTC date (which
// lags by 1-2h around midnight).
// Current Europe/Paris wall-clock hour as a fraction (e.g. 14.25 = 14:15).
window.pkParisHour = function() {
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
  return h + m / 60;
};

// ════════════════════════════════════════════
// PK_FMT — Shared formatting helpers (used by prices.js + js/hist/)
// Single source of truth for number/delta/neg-hours formatting and
// semantic color thresholds. Keep in sync with brief decisions.
// ════════════════════════════════════════════
window.PK_FMT = (function() {
  // Decimal separator: point. Thousands separator: thin space.
  // Always 2 decimals for prices (€/MWh).
  function num(v, decimals) {
    if (v == null || isNaN(v)) return '--';
    const d = decimals == null ? 2 : decimals;
    const fixed = Number(v).toFixed(d);
    const [intPart, decPart] = fixed.split('.');
    // Insert thin space (U+202F) every 3 digits from right; handle minus sign.
    const sign = intPart.startsWith('-') ? '-' : '';
    const absInt = sign ? intPart.slice(1) : intPart;
    const withSep = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
    return sign + withSep + (decPart != null ? '.' + decPart : '');
  }

  // Signed delta: "▲ +1.50" / "▼ -1.50" / "● 0.00".
  // Returns {html, color}. Caller wraps with <span style="color:..."> if needed.
  // priceContext = true means "lower is better for buyer": down=green, up=red.
  function delta(v, opts) {
    opts = opts || {};
    const priceContext = opts.priceContext !== false; // default true
    if (v == null || isNaN(v)) return { text: '–', color: 'var(--tx3)' };
    const abs = Math.abs(v);
    let arrow, color;
    if (v > 0) {
      arrow = '▲';
      color = priceContext ? 'var(--dn)' : 'var(--up)';
    } else if (v < 0) {
      arrow = '▼';
      color = priceContext ? 'var(--up)' : 'var(--dn)';
    } else {
      arrow = '●';
      color = 'var(--tx3)';
    }
    const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
    return { text: `${arrow} ${sign}${num(abs, 2)}`, color };
  }

  // Negative hours: compact variable format.
  //   - h <= 0      → '–'
  //   - h < 1       → 'XXmin'   (15-min granularity)
  //   - h < 100     → 'XhYY' (or 'Xh' when minutes are 0)
  //   - h >= 100    → 'XXXh'    (integer hours)
  function negHours(h) {
    if (h == null || isNaN(h) || h <= 0) return '–';
    if (h >= 100) return `${Math.round(h)}h`;
    const totalMin = Math.round(h * 60 / 15) * 15;
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hrs === 0) return `${mins}min`;
    if (mins === 0) return `${hrs}h`;
    return `${hrs}h${String(mins).padStart(2,'0')}`;
  }

  // %REN color thresholds (harmonised T1 + T2):
  //   < 35   → red
  //   35-65  → orange
  //   > 65   → green
  function renColor(pct) {
    if (pct == null || isNaN(pct)) return 'var(--tx3)';
    if (pct < 35) return '#ED6965';
    if (pct <= 65) return '#FBBF24';
    return '#14D3A9';
  }

  // SPREAD INTRADAY color thresholds (T2):
  //   < 80   → neutral grey
  //   80-150 → light green
  //   > 150  → intense green
  function spreadColor(v) {
    if (v == null || isNaN(v)) return 'var(--tx3)';
    if (v < 80) return 'var(--tx2)';
    if (v <= 150) return '#14D3A9';
    return '#0FAC8A';
  }

  // NEG HOURS color (Daily T1 + Historical T2 share same logic):
  //   - 0/null → muted
  //   - light  → warn (orange)
  //   - heavy  → red (>50h in window, or >2h on a single day)
  function negColor(h, opts) {
    opts = opts || {};
    const heavy = opts.heavyThreshold != null ? opts.heavyThreshold : 50;
    const light = opts.lightThreshold != null ? opts.lightThreshold : 0.001;
    if (h == null || isNaN(h) || h <= 0) return 'var(--tx3)';
    if (h > heavy) return '#ED6965';
    if (h > light) return 'var(--warn)';
    return 'var(--tx2)';
  }

  return { num, delta, negHours, renColor, spreadColor, negColor };
})();

// Zone config
const ZONES = [
  { code:'IT_SOUTH', flag:'🇮🇹', name:'Italy South', eic:'10Y1001A1001A788' },
  { code:'IT_NORD',  flag:'🇮🇹', name:'Italy North',  eic:'10Y1001A1001A73I' },
  { code:'HU',       flag:'🇭🇺', name:'Hungary',      eic:'10YHU-MAVIR----U' },
  { code:'SI',       flag:'🇸🇮', name:'Slovenia',     eic:'10YSI-ELES-----O' },
  { code:'RO',       flag:'🇷🇴', name:'Romania',      eic:'10YRO-TEL------P' },
  { code:'HR',       flag:'🇭🇷', name:'Croatia',      eic:'10YHR-HEP------M' },
  { code:'RS',       flag:'🇷🇸', name:'Serbia',       eic:'10YCS-SERBIATSOV' },
  { code:'GR',       flag:'🇬🇷', name:'Greece',       eic:'10YGR-HTSO-----Y' },
  { code:'MK',       flag:'🇲🇰', name:'N. Macedonia', eic:'10YMK-MEPSO----8' },
  { code:'BG',       flag:'🇧🇬', name:'Bulgaria',     eic:'10YCA-BULGARIA-R' },
  { code:'ME',       flag:'🇲🇪', name:'Montenegro',   eic:'10YCS-CG-TSO---S' },
  { code:'CH',       flag:'🇨🇭', name:'Switzerland',  eic:'10YCH-SWISSGRIDZ' },
  { code:'AT',       flag:'🇦🇹', name:'Austria',      eic:'10YAT-APG------L' },
  { code:'LT',       flag:'🇱🇹', name:'Lithuania',    eic:'10YLT-1001A0008Q' },
  { code:'LV',       flag:'🇱🇻', name:'Latvia',       eic:'10YLV-1001A00074' },
  { code:'EE',       flag:'🇪🇪', name:'Estonia',      eic:'10Y1001A1001A39I' },
  { code:'FI',       flag:'🇫🇮', name:'Finland',      eic:'10YFI-1--------U' },
  { code:'PT',       flag:'🇵🇹', name:'Portugal',     eic:'10YPT-REN------W' },
  { code:'SK',       flag:'🇸🇰', name:'Slovakia',     eic:'10YSK-SEPS-----K' },
  { code:'ES',       flag:'🇪🇸', name:'Spain',        eic:'10YES-REE------0' },
  { code:'DK_W',     flag:'🇩🇰', name:'Denmark West', eic:'10YDK-1--------W' },
  { code:'CZ',       flag:'🇨🇿', name:'Czechia',      eic:'10YCZ-CEPS-----N' },
  { code:'NO_2',     flag:'🇳🇴', name:'Norway Central',eic:'10YNO-2--------T' },
  { code:'DE_LU',    flag:'🇩🇪', name:'Germany',      eic:'10Y1001A1001A82H' },
  { code:'NL',       flag:'🇳🇱', name:'Netherlands',  eic:'10YNL----------L' },
  { code:'BE',       flag:'🇧🇪', name:'Belgium',      eic:'10YBE----------2' },
  { code:'NO_3',     flag:'🇳🇴', name:'Norway N-Mid', eic:'10YNO-3--------J' },
  { code:'NO_1',     flag:'🇳🇴', name:'Norway North', eic:'10YNO-1--------2' },
  { code:'SE_3',     flag:'🇸🇪', name:'Sweden N-Mid', eic:'10Y1001A1001A46L' },
  { code:'FR',       flag:'🇫🇷', name:'France',       eic:'10YFR-RTE------C' },
  { code:'GB',       flag:'🇬🇧', name:'Great Britain', eic:'10YGB----------A' },
  { code:'DK_E',     flag:'🇩🇰', name:'Denmark East', eic:'10YDK-2--------M' },
];

// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
let currentPage = 'prices';
let pricesData = [];
let newsData = [];
let convUnit = 'MW';
let newsFilter = 'all';

// ════════════════════════════════════════════
// CLOCK
// ════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const cet = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const h = String(cet.getHours()).padStart(2,'0');
  const m = String(cet.getMinutes()).padStart(2,'0');
  const s = String(cet.getSeconds()).padStart(2,'0');
  // Paris is UTC+1 (CET) in winter, UTC+2 (CEST) in summer — a hardcoded
  // "CET" label was wrong half the year. Derive the live offset instead of
  // assuming one, so it's always correct through the DST transitions.
  const utcNow = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetH = Math.round((cet - utcNow) / 3600000);
  const tzLabel = offsetH === 1 ? 'CET' : offsetH === 2 ? 'CEST' : `UTC${offsetH >= 0 ? '+' : ''}${offsetH}`;
  document.getElementById('clock').textContent = `${h}:${m}:${s} ${tzLabel} (UTC${offsetH >= 0 ? '+' : ''}${offsetH})`;
}
setInterval(updateClock, 1000);
updateClock();

// ════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  const nav = document.getElementById('nav-' + id);
  if (nav) nav.classList.add('active');
  currentPage = id;

  // Reached directly from the France/My Dashboard view (possible on mobile,
  // where the sidebar stays reachable as an off-canvas drawer even while
  // those views are open) — restore the normal "All" dashboard state.
  window.PK_ZONE_SCOPE = null;
  if (window.FRDash) window.FRDash.close();
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('sidebar-special-hidden');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.dash === 'all'));
  // Lazy load
  if (id === 'genmix' && !window._genmixLoaded) loadGenMix();
  if (id === 'news' && !window._newsLoaded) loadNews();
  if (id === 'crossborder' && !window._cbLoaded) loadCrossBorder();
  if (id === 'load' && !window._loadLoaded) loadLoad();
  if (id === 'overview') loadOverview();
  if (id === 'converter') { updateConverter(); updateCapacity(); }
  if (id === 'analysis' && typeof loadMarketAnalysis === 'function') loadMarketAnalysis();
  if (window.PK) PK.pageShown(id);   // modules subscribe with PK.onPage(id, fn) (js/pk-core.js)
}

function switchSection(sec) {
  document.querySelectorAll('.topbar-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (sec === 'power') showPage('prices');
}

// ── SIDEBAR COLLAPSIBLE ──
function toggleSection(secId) {
  const sec = document.getElementById(secId);
  if (!sec) return;
  const items = sec.querySelector('.sidebar-section-items');
  if (sec.classList.contains('collapsed')) {
    sec.classList.remove('collapsed');
    items.style.maxHeight = items.scrollHeight + 'px';
  } else {
    items.style.maxHeight = items.scrollHeight + 'px';
    requestAnimationFrame(() => { sec.classList.add('collapsed'); });
  }
}

// Init max-heights on load
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sidebar-section-items').forEach(el => {
    const sec = el.closest('.sidebar-section');
    if (sec && sec.classList.contains('collapsed')) {
      el.style.maxHeight = '0px';
    } else {
      el.style.maxHeight = el.scrollHeight + 'px';
    }
  });
});

// ── DASHBOARD TABS ──
// Scope de zone global. null = vue européenne (onglet All), 'FR' = cockpit France.
// Les modules qui veulent se restreindre à une zone lisent window.PK_ZONE_SCOPE.
window.PK_ZONE_SCOPE = null;

function switchDashboard(tab, btn) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const sidebar = document.getElementById('sidebar');
  // Tous les accès DOM sont défensifs : les coquilles page-france / page-mydash
  // ont déjà été absentes du HTML, ce qui bloquait l'application entière.
  const setActive = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', on);
  };

  if (tab === 'all') {
    window.PK_ZONE_SCOPE = null;
    if (window.FRDash) window.FRDash.close();
    if (sidebar) sidebar.classList.remove('sidebar-special-hidden');
    setActive('page-france', false);
    setActive('page-mydash', false);
    showPage('prices');
    return;
  }

  if (tab === 'france') {
    // On desktop this fully hides the sidebar column. On mobile the sidebar
    // is an off-canvas drawer (closed by default), so it must stay reachable
    // via the burger button — sidebar-special-hidden is a desktop-only rule.
    if (sidebar) sidebar.classList.add('sidebar-special-hidden');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    setActive('page-france', true);
    if (typeof loadFranceDashboard === 'function') loadFranceDashboard();
    return;
  }

  if (tab === 'mydash') {
    window.PK_ZONE_SCOPE = null;
    if (window.FRDash) window.FRDash.close();
    if (sidebar) sidebar.classList.add('sidebar-special-hidden');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    setActive('page-mydash', true);
    if (window.PKDash) PKDash.open();
    return;
  }
}

function todayStr() {
  const now = new Date();
  const cet = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const y = cet.getFullYear();
  const m = String(cet.getMonth() + 1).padStart(2, '0');
  const d = String(cet.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

