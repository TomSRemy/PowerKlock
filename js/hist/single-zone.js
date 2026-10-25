// js/hist/single-zone.js — Historical prices: block 2, single-zone section and its tabs.
// Part of the former js/hist.js (lines 3994–7964), split without changes: the parts are plain scripts loaded
// in this order by index.html and share their globals as before.
// ════════════════════════════════════════════
// BLOCK 2 · SINGLE ZONE SECTION (insta tabs)
// Tabs: Lines · YoY · Seasonal · Hourly · Weekly · Volatility
// ════════════════════════════════════════════

// Per-tab submenu rendering: pills for the active tab go in the same slot in both
// drill-down and FS, with consistent YoY-style design (rounded 14px pills).
// Handles: YoY (sub-modes + hourly mode), Volatility (3 metrics), Distribution (2 modes).
function _hszRenderYoYSubmenu() {
  const tab = HSZ.tab;
  const mode = HSZ.yoyMode;
  const hourlyMode = HSZ.hourlyMode;

  // Universal pill template: pkPill (rounded capsules, JetBrains Mono).
  // All sub-toggles in the app use this style for visual consistency.
  const pill = (handler, id, label, active) =>
    window.pkPill({
      label,
      active,
      onClick: `event.stopPropagation();${handler}('${id}')`,
    });
  const sep = `<span style="width:1px;height:14px;background:rgba(255,255,255,0.18);margin:0 4px"></span>`;

  let html = '';
  let showSubmenu = false;

  if (tab === 'yoy') {
    showSubmenu = true;
    HSZ.yoyModes.forEach(m => { html += pill('setHistYoyMode', m.id, m.label, mode === m.id); });
    if (mode === 'hourly') {
      html += sep
           + pill('setHistHourlyMode', 'yoy',     'Annual average', hourlyMode === 'yoy')
           + pill('setHistHourlyMode', 'quarter', 'By quarter',     hourlyMode === 'quarter')
           + pill('setHistHourlyMode', 'hodshape','Hour-of-day shape', hourlyMode === 'hodshape');
    }
  } else if (tab === 'vol' || tab === 'volatility') {
    showSubmenu = true;
    const cur = window._volMetric || 'sigma';
    html += pill('_setVolMetric', 'sigma', 'σ rolling',       cur === 'sigma');
    html += pill('_setVolMetric', 'dod',   'Day-on-day Δ',    cur === 'dod');
    html += pill('_setVolMetric', 'range', 'Intra-day range', cur === 'range');
  } else if (tab === 'dist' || tab === 'distribution') {
    showSubmenu = true;
    const cur = window._distMode || 'cumulative';
    html += pill('_setDistMode', 'cumulative', 'Cumulative',       cur === 'cumulative');
    html += pill('_setDistMode', 'histo',      'Histogram + KDE',  cur === 'histo');
  }

  ['ho-detail-tab-submenu', 'fs-ho-tab-submenu'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (showSubmenu) {
      el.style.display = 'flex';
      el.innerHTML = html;
    } else {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  });
}

// Global setter — switches YoY sub-mode and re-renders
window.setHistYoyMode = function(mode) {
  if (!HSZ.yoyModes.find(m => m.id === mode)) return;
  HSZ.yoyMode = mode;
  HSZ.tab = 'yoy';  // defensive: pills only visible on yoy anyway
  _hszRenderYoYSubmenu();
  // Re-render via the registered callback (handles inline + fullscreen)
  if (typeof _hszRerender === 'function') _hszRerender();
};

const HSZ = {
  zone: 'FR',
  tab: 'lines',
  // YoY sub-mode: 'hourly' | 'daily' | 'weekly' | 'monthly'
  yoyMode: 'daily',
  // Hourly internal mode (only used when yoyMode === 'hourly')
  hourlyMode: 'quarter',  // 'quarter' | 'yoy'
  tabs: [
    { id: 'lines',   label: 'Lines' },
    { id: 'yoy',     label: 'YoY' },
    { id: 'weekday', label: 'Weekday' },
    { id: 'vol',     label: 'Volatility' },
    { id: 'dist',    label: 'Distribution' },
  ],
  // YoY sub-modes (rendered as pills below the tab when YoY is active)
  yoyModes: [
    { id: 'hourly',  label: 'Hourly' },
    { id: 'daily',   label: 'Daily' },
    { id: 'weekly',  label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
  ],
};

// _HSZ_TARGET: indirection layer used by _hszRender* so the renderers can
// write to the drill-down canvas inside an opened ho-table row (or the
// fullscreen canvas). The legacy hsz-canvas block has been removed; this
// target is mutated by _buildHoTabChart before rendering, then restored.
// Keys:
//   canvasId      → which canvas to draw on
//   tabsId        → unused (legacy); kept for future
//   togglePrefix  → prefix for hourly-toggle/quarter-grid ids (must be unique
//                   per concurrent rendering host to avoid DOM collisions)
//   getWindow()   → returns the active window key (e.g. '3M', '1Y')
//   getHourlyMode() → 'quarter' | 'yoy'
//   getZone()     → active zone code
//   getTab()      → active tab id
//   getYPreset()  → active Y range preset ('focus'|'standard'|'all')
const _HSZ_TARGET = {
  canvasId: null,
  tabsId: null,
  togglePrefix: 'ho-detail',
  getWindow: () => HIST.windows['ho'] || '3M',
  getHourlyMode: () => HSZ.hourlyMode,
  getYoyMode: () => HSZ.yoyMode,
  getZone: () => HSZ.zone,
  getTab:  () => HSZ.tab,
  getYPreset: () => _hszYPreset,
  // Unfiltered zone series — used by rolling-window computations so that the
  // last N days of context are not lost when the user shrinks the window.
  // Populated by _hszRenderTab from the summary it receives.
  getFullSeries: () => null,
};
function _hszCtx() { return _HSZ_TARGET; }
// Expose for cross-module access (e.g. histHodRenderShape needs to know
// the active canvasId to detect fullscreen context)
window._HSZ_TARGET = _HSZ_TARGET;

// State callback: the drill-down row registers a "rerender" function so that
// shared controls (Y presets, hourly mode toggle) can refresh the active chart
// without knowing which row owns it.
let _HSZ_RERENDER = null;
function _setHszRerender(fn) { _HSZ_RERENDER = fn; }
function _hszRerender() { if (typeof _HSZ_RERENDER === 'function') _HSZ_RERENDER(); }

function setHistHourlyMode(mode) {
  HSZ.hourlyMode = mode;
  if (typeof _hszRenderYoYSubmenu === 'function') _hszRenderYoYSubmenu();
  _hszRerender();
}
window.setHistHourlyMode = setHistHourlyMode;

// _hszRenderTab: shared dispatcher used by the drill-down row.
// `filtered` = filtered series, `zone` = zone code, `tab` = active tab id,
// `summary` = the fetchSummary() result (needed by YoY / Seasonal renderers).
// The renderers read `_hszCtx()` for canvas/window/etc., so make sure the
// caller has set _HSZ_TARGET appropriately before invoking.
// ─────────────────────────────────────────────────────────────
// Title helper · sets the HTML title block above the chart canvas.
// Hybrid style: small green uppercase "eyebrow" + sans-serif title + muted subtitle.
// Chart.js native title/subtitle are NOT used anywhere on Historical drill-down
// charts — we rely on this HTML block instead (multi-style typography).
// ─────────────────────────────────────────────────────────────
// Helper: format a title with an optional discrete description after a pipe ("Title | description")
// The description appears in a smaller, grey weight to keep the main title prominent.
function _titleWithDescription(title, description) {
  if (!description) return title;
  return `${title} <span style="color:var(--tx3);font-weight:400;font-size:0.78em;margin-left:6px">| ${description}</span>`;
}

// ─────────────────────────────────────────────────────────────
// Analyst banner — amber warning-style bar under each chart
// Contains: line 1 (numbers + factual finding) + market read (verdict)
// Pure market analyst tone: describe what the data says about the market.
// No PPA / BESS / contracting language.
// ─────────────────────────────────────────────────────────────
function _buildAnalystBanner(mode, p) {
  const W = (txt) => `<b style="color:#fff;font-weight:700">${txt}</b>`;     // white bold = key number
  const A = (txt) => `<b style="font-weight:700">${txt}</b>`;                 // amber bold = secondary / extreme
  const ICON = `<span style="font-size:13px;margin-right:6px;vertical-align:-1px">◈</span>`;
  const VR_OPEN = `<span style="display:block;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(251,191,36,0.22);font-style:italic;color:rgba(255,255,255,0.82)">Market read : `;
  const VR_CLOSE = `</span>`;

  // Helper: format date as "DD MMM" from YYYY-MM-DD
  const fmtD = (d) => {
    if (!d) return '--';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  let line1 = '', verdict = '';

  if (mode === 'lines') {
    const { avg, sigma, min, max, minDate, maxDate } = p;
    const sigmaRegime = sigma < 15 ? 'low' : sigma < 30 ? 'normal' : 'high';
    const levelTier = avg < 40 ? 'bearish baseline' : avg < 70 ? 'neutral baseline' : 'bullish baseline';
    line1 = `Period averaged ${W(avg.toFixed(2) + ' €/MWh')} with ${W(sigmaRegime + ' volatility')} (σ ${W(sigma.toFixed(2))}). Prices spanned ${A(min.toFixed(2))} on ${A(fmtD(minDate))} to ${A(max.toFixed(2) + ' €/MWh')} on ${A(fmtD(maxDate))}.`;
    const sigmaWord = sigma < 15 ? 'calm regime' : sigma < 30 ? 'normal regime' : 'stressed regime';
    const desc = (avg < 40 && sigma > 30) ? 'Low absolute level combined with wide swings.'
              : (avg > 70 && sigma > 30) ? 'High level combined with wide swings.'
              : (sigma > 30) ? 'Wide day-to-day swings across the period.'
              : (avg < 40) ? 'Low absolute level, contained dispersion.'
              : (avg > 70) ? 'High level, contained dispersion.'
              : 'Levels and dispersion both close to historical norms.';
    verdict = `${VR_OPEN}<b>${levelTier}, ${sigmaWord}</b>. ${desc}${VR_CLOSE}`;
  }

  else if (mode === 'yoyDaily' || mode === 'yoyWeekly' || mode === 'yoyMonthly') {
    const { curMean, prevMean, delta, period } = p;
    const pct = prevMean ? (delta / Math.abs(prevMean)) * 100 : 0;
    const verb = delta > 0 ? '+' : '';
    const periodLabel = mode === 'yoyDaily' ? 'This year' : mode === 'yoyWeekly' ? 'Weekly average' : 'This month';
    line1 = `${periodLabel} ${W(curMean.toFixed(2) + ' €/MWh')}, ${A(verb + delta.toFixed(2) + ' €/MWh (' + verb + pct.toFixed(1) + '%)')} vs Y-1.`;
    let read;
    if (Math.abs(pct) < 5) {
      read = `<b>Stable year-on-year</b>. Spread within ±5%.`;
    } else if (pct > 15) {
      read = `<b>Sharply higher year-on-year</b>. Gap to Y-1 exceeds 15%.`;
    } else if (pct > 5) {
      read = `<b>Higher year-on-year</b>. Current level sits above Y-1.`;
    } else if (pct < -15) {
      read = `<b>Sharply lower year-on-year</b>. Gap to Y-1 exceeds 15% on the downside.`;
    } else {
      read = `<b>Lower year-on-year</b>. Current level sits below Y-1.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'yoyHourlyAnnual') {
    const { peakHour, peakVal, floorHour, floorVal, prevFloorVal, prevPeakHour } = p;
    line1 = `Peak at ${W(peakHour + 'h (' + peakVal.toFixed(2) + ' €/MWh)')}, floor at ${W(floorHour + 'h (' + floorVal.toFixed(2) + ' €/MWh)')}.`;
    const midday = (floorHour >= 11 && floorHour <= 16);
    const floorDeeper = (prevFloorVal != null && floorVal < prevFloorVal - 5);
    const peakShifted = (prevPeakHour != null && peakHour > prevPeakHour);
    let read;
    if (midday && floorDeeper) {
      read = `<b>Midday floor deepening</b>. Solar surplus widens the gap to last year; peak sits in the evening.`;
    } else if (midday && peakShifted) {
      read = `<b>Peak shifting later</b>. Midday floor steady, evening hours extending into the night.`;
    } else if (midday) {
      read = `<b>Duck-curve profile</b>. Midday floor and evening peak define the day.`;
    } else if (peakHour <= 10) {
      read = `<b>Morning-peak profile</b>. Demand concentrated in the early hours.`;
    } else {
      read = `<b>Evening-peak profile</b>. Demand concentrated late in the day.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'yoyHourlyQuarter') {
    const { strongestQuarterLabel, strongestPeakVal, strongestPeakHour,
            weakestQuarterLabel, weakestFloorVal, weakestFloorHour } = p;
    line1 = `Strongest peak in ${W(strongestQuarterLabel)} at ${W(strongestPeakHour + 'h (' + strongestPeakVal.toFixed(2) + ' €/MWh)')}, weakest floor in ${W(weakestQuarterLabel)} at ${W(weakestFloorHour + 'h (' + weakestFloorVal.toFixed(2) + ' €/MWh)')}.`;
    const seasonalGap = strongestPeakVal - weakestFloorVal;
    let read;
    if (seasonalGap > 100) {
      read = `<b>Highly polarised quarters</b>. Spread between strongest peak and weakest floor exceeds 100 €/MWh.`;
    } else if (seasonalGap > 50) {
      read = `<b>Pronounced quarterly contrast</b>. Quarters show meaningfully different intraday shapes.`;
    } else {
      read = `<b>Balanced quarterly regime</b>. Intraday shape close across quarters.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'weekday') {
    const { mostExpName, mostExpMedian, cheapestName, cheapestMedian } = p;
    const discount = mostExpMedian > 0 ? (1 - cheapestMedian / mostExpMedian) * 100 : 0;
    line1 = `${W(mostExpName)} most expensive (median ${W(mostExpMedian.toFixed(2) + ' €/MWh')}), ${W(cheapestName)} cheapest (median ${W(cheapestMedian.toFixed(2) + ' €/MWh')}). Weekend discount ${W('~' + discount.toFixed(0) + '%')}.`;
    let read;
    if (discount > 30) {
      read = `<b>Wide weekday-weekend gap</b>. Weekend prices sit more than 30% below the most expensive day.`;
    } else if (discount > 15) {
      read = `<b>Moderate weekday-weekend gap</b>. Spread between weekday and weekend is contained.`;
    } else {
      read = `<b>Flat weekly pattern</b>. Weekday and weekend prices move close together.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'volatility') {
    const { metricLabel, periodMean, regime, daysAbove, threshold, peakVal, peakDate, unit } = p;
    line1 = `${metricLabel} averaged ${W(periodMean.toFixed(2) + ' ' + unit + ' (' + regime + ' regime)')}, ${A(daysAbove + ' days')} above ${W(threshold.toFixed(2) + ' ' + unit)}, peak ${A(peakVal != null ? peakVal.toFixed(2) + ' ' + unit : '--')}${peakDate ? ' on ' + A(fmtD(peakDate)) : ''}.`;
    let read;
    if (regime === 'high') {
      read = `<b>Stressed regime</b>. Day-to-day swings sit well above historical norms.`;
    } else if (regime === 'moderate') {
      read = `<b>Normal regime</b>. Dispersion within historical bounds.`;
    } else {
      read = `<b>Calm regime</b>. Day-to-day swings well below historical norms.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'cumulative') {
    const { median, p95, p5 } = p;
    const skew = (p95 - median) > (median - p5);
    line1 = `Half the days under ${W(median.toFixed(2) + ' €/MWh')}, 95% under ${W(p95.toFixed(2) + ' €/MWh')}. Distribution ${W(skew ? 'right-skewed' : 'symmetric')}.`;
    let read;
    if (skew && median < 60) {
      read = `<b>Right-skewed with quiet baseline</b>. Most days sit low; upper tail stretches with occasional spikes.`;
    } else if (skew) {
      read = `<b>Right-skewed distribution</b>. Long tail above the median weights the average.`;
    } else {
      read = `<b>Symmetric distribution</b>. Upside and downside dispersion close to balanced.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  else if (mode === 'histo') {
    const { mostFreqBucket, mean, median } = p;
    const skewPct = median > 0 ? ((mean - median) / Math.abs(median)) * 100 : 0;
    const skewWord = Math.abs(skewPct) < 3 ? 'symmetric' : (skewPct > 0 ? 'positive skew' : 'negative skew');
    line1 = `Most common range ${W(mostFreqBucket)} (mode). Mean ${W(mean.toFixed(2) + ' €/MWh')} ${mean > median ? '>' : '≤'} median ${W(median.toFixed(2) + ' €/MWh')} — ${W(skewWord)}.`;
    let read;
    if (skewPct > 5) {
      read = `<b>Mean above median</b>. Upper-tail values pull the mean above the typical day.`;
    } else if (skewPct < -5) {
      read = `<b>Mean below median</b>. Lower-tail values pull the mean below the typical day.`;
    } else {
      read = `<b>Mean and median aligned</b>. No material skew in the distribution.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  // ── Daily drill-down (single zone, single day) ──
  // Mirrors the 2-line layout used by Historical modes: facts on line 1,
  // italic "Market read :" verdict on line 2.
  else if (mode === 'dailyDrill') {
    const { zone, dayLabel, today, j1Avg, delta, deltaPct,
            peakAvg, offPkAvg, peakRatio,
            min, max, minSlot, maxSlot,
            negHours, negMins, negMin, negSlots,
            bandIdSuffix } = p;
    const sign = v => v >= 0 ? '+' : '';

    // ── Line 1 · facts ──
    const factParts = [];
    if (today != null) {
      let s = `Day printed ${W(today.toFixed(2) + ' €/MWh')}`;
      if (delta != null) {
        s += `, ${A(sign(delta) + delta.toFixed(2) + ' €/MWh')} vs J-1`;
        if (deltaPct != null) s += ` (${A(sign(deltaPct) + deltaPct.toFixed(1) + '%')})`;
      }
      factParts.push(s);
    }
    if (peakAvg != null && offPkAvg != null) {
      factParts.push(`peak ${W(peakAvg.toFixed(2))} / off-pk ${W(offPkAvg.toFixed(2))} €/MWh` +
                     (peakRatio != null ? ` (ratio ${A(peakRatio.toFixed(2) + 'x')})` : ''));
    }
    if (min != null && max != null) {
      factParts.push(`range ${A(min.toFixed(2))} on ${A(minSlot || '--')} → ${A(max.toFixed(2) + ' €/MWh')} on ${A(maxSlot || '--')}`);
    }
    if (negHours != null && (negHours > 0 || (negMins != null && negMins > 0))) {
      const dur = negHours + 'h' + (negMins > 0 ? String(negMins).padStart(2,'0') : '');
      factParts.push(`${A('negative-price episode')} ${A(dur)} below zero, min ${A(negMin != null ? negMin.toFixed(2) + ' €/MWh' : '--')}`);
    }
    line1 = factParts.join('. ') + (factParts.length ? '.' : '');

    // ── Line 2 · verdict (market read) ──
    let read;
    const isNeg = negHours != null && negHours > 0;
    const bigMove = (deltaPct != null && Math.abs(deltaPct) >= 15);
    const isFlat = (peakRatio != null && peakRatio < 1.20);
    const isInverted = (peakRatio != null && peakRatio < 1.0);
    const isPeakier = (peakRatio != null && peakRatio > 1.6);

    if (isNeg && isInverted) {
      read = `<b>Renewable stress event</b>. Solar surplus pushed prices through zero and inverted the peak/off-peak relationship.`;
    } else if (isNeg) {
      read = `<b>Negative-price episode</b>. Renewable oversupply during the day; storage and flexible offtake captured rents.`;
    } else if (isInverted) {
      read = `<b>Inverted profile (duck curve)</b>. Off-peak more expensive than peak — solar-driven midday floor.`;
    } else if (isFlat && bigMove && delta > 0) {
      read = `<b>Tight day, sharply higher vs J-1</b>. Limited intraday swings but level reset upward.`;
    } else if (isFlat) {
      read = `<b>Flatter-than-normal day</b>. Peak/off-peak gap compressed vs the 1.30x baseline.`;
    } else if (isPeakier && bigMove) {
      read = `<b>Peaky day with sharp move</b>. Pronounced intraday shape on top of a strong directional shift vs J-1.`;
    } else if (isPeakier) {
      read = `<b>Peakier-than-normal day</b>. Wide intraday swings around the average.`;
    } else if (bigMove && delta > 0) {
      read = `<b>Sharp upside vs J-1</b>. Daily level reset higher with a normal profile shape.`;
    } else if (bigMove && delta < 0) {
      read = `<b>Sharp downside vs J-1</b>. Daily level reset lower with a normal profile shape.`;
    } else {
      read = `<b>Normal day</b>. Level and shape both close to the prior session.`;
    }

    // The band-stats sentence (P50 / vs median) is injected later by
    // _loadAndApplyRowBand into the #row-market-read-band-* placeholder
    // we leave embedded inside the verdict.
    const bandSpan = bandIdSuffix
      ? ` <span class="row-market-read-band" id="row-market-read-band-${bandIdSuffix}"></span>`
      : '';
    verdict = `${VR_OPEN}${read}${bandSpan}${VR_CLOSE}`;
  }

  // ── Compare zones modes (used by Daily + Historical compare-zones charts) ──
  else if (mode === 'ccLines' || mode === 'ccProfile' || mode === 'ccBands' || mode === 'ccSpread' || mode === 'ccHeatmap') {
    const { cheap, pricey, frGap, loadedAvg, zoneCount, view } = p;
    const cheapStr  = cheap  ? `${W(cheap.z + ' ' + cheap.avg.toFixed(2) + ' €/MWh')}`  : '--';
    const priceyStr = pricey ? `${W(pricey.z + ' ' + pricey.avg.toFixed(2) + ' €/MWh')}` : '--';
    const spread    = (cheap && pricey) ? (pricey.avg - cheap.avg) : null;
    line1 = `${W(zoneCount)} zones · avg ${W(loadedAvg != null ? loadedAvg.toFixed(2) + ' €/MWh' : '--')}. Cheapest ${cheapStr}, most expensive ${priceyStr}` +
      (spread != null ? `. Spread ${A(spread.toFixed(2) + ' €/MWh')}.` : '.');
    // Verdict depends on spread magnitude and FR positioning
    let read;
    if (spread != null && cheap && cheap.avg > 0) {
      const spreadPct = (spread / cheap.avg) * 100;
      const frPart = (frGap != null && frGap > 0)
        ? ` FR sits ${A('+' + frGap.toFixed(2) + ' €/MWh')} above ${cheap.z}.`
        : (frGap != null && frGap <= 0)
          ? ` FR is the cheapest market.`
          : '';
      if (spreadPct > 100) {
        read = `<b>Highly fragmented zones</b>. Spread exceeds 100% of the cheapest level.${frPart}`;
      } else if (spreadPct > 40) {
        read = `<b>Pronounced cross-zone divergence</b>. Arbitrage potential significant.${frPart}`;
      } else if (spreadPct > 15) {
        read = `<b>Moderate cross-zone gap</b>. Zones diverge but stay within a common band.${frPart}`;
      } else {
        read = `<b>Tightly aligned zones</b>. European prices move close together.${frPart}`;
      }
    } else {
      read = `<b>Insufficient data</b>. Add zones to enable comparison.`;
    }
    verdict = `${VR_OPEN}${read}${VR_CLOSE}`;
  }

  if (!line1) return '';
  return `<div class="ho-analyst-banner" style="margin-top:32px;padding:11px 14px;font-size:11.5px;border-radius:3px;color:#FBBF24;background:rgba(251,191,36,0.08);border-left:3px solid #FBBF24;line-height:1.6">${ICON}${line1}${verdict}</div>`;
}
// Expose globally so prices.js can reuse the same builder for Compare Zones (Daily)
if (typeof window !== 'undefined') window._buildAnalystBanner = _buildAnalystBanner;

// Insert/replace the analyst banner under a chart canvas (inline or fullscreen)
function _renderAnalystBanner(html) {
  const ctx = _hszCtx();
  const canvas = document.getElementById(ctx.canvasId);
  if (!canvas) return;
  // Detect whether we're in fullscreen mode
  const isFs = (ctx.canvasId === 'ho-fs-chart');
  // Clean all existing banners across all scopes (inline + FS)
  _clearAllAnalystBanners();
  if (!html) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const banner = tmp.firstElementChild;
  if (!banner) return;
  if (isFs) {
    // Fullscreen: insert in ho-fs-chart-pane, AFTER the canvas wrapper but BEFORE ho-fs-legend
    const pane = document.getElementById('ho-fs-chart-pane');
    const legend = document.getElementById('ho-fs-legend');
    if (pane && legend) {
      pane.insertBefore(banner, legend);
    } else if (pane) {
      pane.appendChild(banner);
    }
  } else {
    // Inline: use the fixed anchor div in the drill DOM (#ho-detail-analyst-banner).
    // Unified mechanism with Daily drill (anchor + innerHTML). Falls back to the
    // legacy chart-parent insertion if the anchor isn't found (defensive).
    const anchor = document.getElementById('ho-detail-analyst-banner');
    if (anchor) {
      anchor.innerHTML = banner.outerHTML;
      return;
    }
    const wrap = canvas.parentNode;
    const container = wrap ? wrap.parentNode : null;
    if (!wrap || !container) return;
    if (wrap.nextSibling) container.insertBefore(banner, wrap.nextSibling);
    else container.appendChild(banner);
  }
}
if (typeof window !== 'undefined') window._renderAnalystBanner = _renderAnalystBanner;

// Remove every analyst banner in the active detail or fullscreen scope.
// Called when switching tab/sub-mode so banners from the previous view don't linger.
function _clearAllAnalystBanners() {
  const scopes = ['ho-detail-row', 'ho-fs-overlay', 'pk-fs-overlay'];
  scopes.forEach(id => {
    const root = document.getElementById(id);
    if (!root) return;
    root.querySelectorAll('.ho-analyst-banner').forEach(el => el.remove());
  });
}

// Align a zone-legend ribbon's inner padding with the active chart's drawing area
// (chart.chartArea.left/right). Chart.js renders asynchronously, so chartArea is
// not always available immediately after creation. We poll via requestAnimationFrame
// for up to ~10 frames (~160ms) until chartArea is populated, then apply paddings.
// Also re-applies on window resize so the alignment stays valid.
function _alignLegendToChartArea(legendId, attempts) {
  attempts = attempts || 0;
  const apply = () => {
    const chart = HIST.charts[_hszCtx().canvasId];
    const canvas = document.getElementById(_hszCtx().canvasId);
    const inner = document.getElementById(legendId + '-inner');
    if (!chart || !canvas || !inner) return false;
    if (!chart.chartArea || chart.chartArea.left == null) return false;
    const canvasW = canvas.clientWidth;
    const padLeft = Math.max(0, chart.chartArea.left);
    const padRight = Math.max(0, canvasW - chart.chartArea.right);
    inner.style.paddingLeft = padLeft + 'px';
    inner.style.paddingRight = padRight + 'px';
    return true;
  };
  if (apply()) {
    // Hook resize re-alignment (only once per legend)
    const legendEl = document.getElementById(legendId);
    if (legendEl && !legendEl._pkResizeHooked) {
      legendEl._pkResizeHooked = true;
      const onResize = () => apply();
      window.addEventListener('resize', onResize);
      // Cleanup when legend removed (MutationObserver on parent)
      const parent = legendEl.parentNode;
      if (parent && typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(() => {
          if (!document.contains(legendEl)) {
            window.removeEventListener('resize', onResize);
            obs.disconnect();
          }
        });
        obs.observe(parent, { childList: true });
      }
    }
    return;
  }
  // Retry up to 10 frames
  if (attempts < 10) {
    requestAnimationFrame(() => _alignLegendToChartArea(legendId, attempts + 1));
  }
}

function _setHoTitle({ eyebrow, title, subtitle }) {
  const fs = _hoFsIsOpen();
  const prefix = fs ? 'ho-fs' : 'ho-detail';
  const ey = document.getElementById(prefix + '-eyebrow');
  const ti = document.getElementById(prefix + '-title');
  const su = document.getElementById(prefix + '-subtitle');
  if (ey) ey.textContent = eyebrow || '';
  // Title and subtitle: HTML supported so renderers can render structured content
  // (e.g. "Title | discrete description" in title, formula + stats in subtitle).
  // Renderers are responsible for not interpolating user-controlled input raw.
  if (ti) ti.innerHTML = title || '';
  if (su) su.innerHTML = subtitle || '';
  const otherPrefix = fs ? 'ho-detail' : 'ho-fs';
  const oey = document.getElementById(otherPrefix + '-eyebrow');
  const oti = document.getElementById(otherPrefix + '-title');
  const osu = document.getElementById(otherPrefix + '-subtitle');
  if (oey) oey.textContent = eyebrow || '';
  if (oti) oti.innerHTML = title || '';
  if (osu) osu.innerHTML = subtitle || '';
}
if (typeof window !== 'undefined') {
  window._setHoTitle = _setHoTitle;
  window._titleWithDescription = _titleWithDescription;
}

async function _hszRenderTab(filtered, zone, tab, summary) {
  // Backward-compat: legacy 'weekly' tab id → renamed to 'weekday'
  if (tab === 'weekly') tab = 'weekday';
  // Clear ALL analyst banners from the previous tab/mode before rendering this one.
  // (Each renderer will then insert its own banner if needed.)
  _clearAllAnalystBanners();
  // Expose unfiltered zone series for rolling-window stats (7D/30D, sigma, etc.)
  // so they aren't truncated when the user shrinks the visible window.
  const fullZoneSeries = (summary && summary.zones && summary.zones[zone]) || [];
  _HSZ_TARGET.getFullSeries = () => fullZoneSeries;
  const tabLabels = {
    lines: 'Lines', yoy: 'YoY', weekday: 'Weekday', vol: 'Volatility', dist: 'Distribution',
  };
  _setHoTitle({
    eyebrow: `Prices · ${tabLabels[tab] || tab} · ${zone}`,
    title: '',
    subtitle: '',
  });
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (canvas) {
    canvas.style.display = '';
    if (canvas.parentNode) canvas.parentNode.style.display = '';
  }

  const togPrefix = _hszCtx().togglePrefix;
  // Cleanup Hourly-specific UI unless we're on YoY · Hourly mode
  const isHourlySubmode = (tab === 'yoy' && _hszCtx().getYoyMode() === 'hourly');
  if (!isHourlySubmode) {
    _hszHideHourlyToggle();
    const qg = document.getElementById(togPrefix + '-quarter-grid');
    if (qg) qg.remove();
    const ql = document.getElementById(togPrefix + '-quarter-legend');
    if (ql) ql.remove();
  }
  // Cleanup Weekday HTML legend unless we're on Weekday tab
  if (tab !== 'weekday' && tab !== 'weekly') {
    const wdLg = document.getElementById(togPrefix + '-weekday-legend');
    if (wdLg) wdLg.remove();
  }
  // Cleanup Volatility-specific UI unless we're on Volatility tab
  if (tab !== 'vol' && tab !== 'volatility') {
    const volLg = document.getElementById(togPrefix + '-vol-legend');
    if (volLg) volLg.remove();
  }
  // Cleanup Distribution-specific UI (formula strip + legend) unless we're on Distribution tab
  if (tab !== 'dist' && tab !== 'distribution') {
    const df = document.getElementById(togPrefix + '-dist-formula');
    if (df) df.remove();
    const dl = document.getElementById(togPrefix + '-dist-legend');
    if (dl) dl.remove();
  }

  // Persist last series + summary for breakdown rerenders (Volatility toggle, etc.)
  window._HO_LAST_SERIES = window._HO_LAST_SERIES || {};
  window._HO_LAST_SERIES[zone] = filtered;
  window._HO_LAST_SUMMARY = summary;
  // Map our HSZ tab/yoyMode to the dispatcher (read by _renderHoBreakdown)
  // Note: tab is normalised above (weekly→weekday)
  HSZ.tab = tab;

  // Dispatch render by tab
  let renderResult = null;
  if (tab === 'lines')         renderResult = _hszRenderLines(filtered, zone);
  else if (tab === 'yoy') {
    const mode = _hszCtx().getYoyMode();
    if (mode === 'hourly')       renderResult = _hszRenderHourly(filtered, zone);
    else if (mode === 'weekly')  renderResult = _hszRenderWeeklyYoY(filtered, zone, summary);
    else if (mode === 'monthly') renderResult = _hszRenderSeasonal(filtered, zone, summary);
    else                          renderResult = _hszRenderYoY(filtered, zone, summary);  // default = daily
  }
  else if (tab === 'weekday')  renderResult = _hszRenderWeekly(filtered, zone);
  else if (tab === 'vol')      renderResult = _hszRenderVolatility(filtered, zone);
  else if (tab === 'dist')     renderResult = _hszRenderDist(filtered, zone, summary);

  // Normalise tab id for the breakdown dispatcher (vol → volatility, dist → distribution)
  const bdTab = tab === 'vol' ? 'volatility' : (tab === 'dist' ? 'distribution' : tab);
  const oldTab = HSZ.tab;
  HSZ.tab = bdTab;
  try { _renderHoBreakdown(zone, filtered, summary); } catch (e) { console.warn('Breakdown render failed:', e); }
  HSZ.tab = oldTab;

  return renderResult;
}

function _hszPlaceholder(msg) {
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (!canvas) return;
  const wrap = canvas.parentNode;
  const old = wrap.querySelector('.no-data-msg');
  if (old) old.remove();
  canvas.style.display = 'none';
  const div = document.createElement('div');
  div.className = 'no-data-msg';
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--tx3);font-size:12px;font-style:italic;letter-spacing:0.04em;text-align:center;padding:0 20px';
  div.innerHTML = msg;
  wrap.appendChild(div);
}

// HSZ Y zoom preset state (kept per-zone but for simplicity at module level)
let _hszYPreset = 'standard';  // 'focus' | 'standard' | 'all'

function setHszYPreset(preset) {
  _hszYPreset = preset;
  _hszRerender();
}
window.setHszYPreset = setHszYPreset;

// Min / max markers and the y range follow the series shown: each of Daily avg, 7D and 30D rolling
// gets its own ▼ / ▲ when visible; the scale fits what is on screen (hiding Daily avg no longer
// leaves its extremes squashing the rolling lines).
function _hoFollowVisible(ci, opt) {
  const pick = ['Daily avg', '7D rolling', '30D rolling'], short = { 'Daily avg': 'daily', '7D rolling': '7D', '30D rolling': '30D' };
  const ann = ((ci.options.plugins || {}).annotation || {}).annotations; if (!ann) return;
  Object.keys(ann).forEach(k => { if (/^(minPt|maxPt|mm_)/.test(k)) delete ann[k]; });
  let lo = Infinity, hi = -Infinity;
  ci.data.datasets.forEach((d, i) => {
    if (!ci.isDatasetVisible(i)) return;
    const v = (d.data || []).map(x => x == null || isNaN(x) ? null : +x), ok = v.filter(x => x != null);
    if (!ok.length) return;
    lo = Math.min(lo, ...ok); hi = Math.max(hi, ...ok);
    if (!pick.includes(d.label)) return;
    const mn = Math.min(...ok), mx = Math.max(...ok), col = d.borderColor || '#7FC8F8', tag = short[d.label];
    const mk = (val, up) => ({ type: 'point', xValue: v.indexOf(val), yValue: val, backgroundColor: up ? _HIST_UP : _HIST_DN, radius: 5, borderColor: col, borderWidth: 2,
      label: { display: true, content: `${up ? '▲ Max' : '▼ Min'} ${tag} ${val.toFixed(2)}`, color: '#fff', font: { size: 10, weight: '600' }, backgroundColor: up ? _HIST_UP : _HIST_DN, position: 'center', yAdjust: up ? -20 : 20, padding: 4, borderRadius: 3 } });
    ann['mm_min_' + tag] = mk(mn, false); ann['mm_max_' + tag] = mk(mx, true);
  });
  if (!(opt && opt.keepScale) && isFinite(lo) && isFinite(hi)) { const pad = Math.max(1, hi - lo) * 0.1; ci.options.scales.y.min = Math.floor(lo - pad); ci.options.scales.y.max = Math.ceil(hi + pad); }
}

function _computeYRange(validAvgs, validMaxes, validMins, preset, roll7, roll30) {
  // Returns {yMin, yMax} based on the preset:
  //  - 'focus':    tight range around the rolling 7D/30D lines (the trend)
  //                avg/ribbon may be clipped — pure trend view
  //  - 'standard': avg ± 30% margin (default, balanced, shows ribbon)
  //  - 'all':      real daily max/min extremes (shows outliers + ribbon)
  if (!validAvgs.length) return { yMin: null, yMax: null };

  if (preset === 'focus' && roll7 && roll30) {
    // Use min/max of the smoothed rolling lines (filtered for nulls)
    const allRolls = [...roll7, ...roll30].filter(v => v != null && !isNaN(v));
    if (allRolls.length) {
      const rMin = Math.min(...allRolls);
      const rMax = Math.max(...allRolls);
      const rRange = Math.max(rMax - rMin, 10);
      const margin = rRange * 0.15;  // 15% margin around the trend
      const yMax = Math.ceil((rMax + margin) / 5) * 5;
      const yMin = Math.floor((rMin - margin) / 5) * 5;
      return { yMin, yMax };
    }
  }

  const avgMin = Math.min(...validAvgs);
  const avgMax = Math.max(...validAvgs);
  const avgRange = Math.max(avgMax - avgMin, 20);
  let yMin = null, yMax = null;

  if (preset === 'all' && validMaxes.length && validMins.length) {
    yMax = Math.ceil(Math.max(...validMaxes) * 1.05 / 25) * 25;
    yMin = Math.floor(Math.min(...validMins) * 1.05 / 25) * 25;
  } else {
    // Standard
    const margin = avgRange * 0.3;
    yMax = Math.ceil((avgMax + margin) / 10) * 10;
    yMin = Math.floor((avgMin - margin) / 10) * 10;
    if (avgMin < 0 && yMin > avgMin) yMin = Math.floor(avgMin * 1.1 / 10) * 10;
  }
  return { yMin, yMax };
}

// _hszInjectYPresets removed — Y preset bar is rendered directly inside the
// drill-down row by _openHoRow (see ho-detail-* IDs).

function _hszResetZoom() {
  const ch = HIST.charts[_hszCtx().canvasId];
  if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
}
window._hszResetZoom = _hszResetZoom;

function _hszRenderLines(filtered, zone) {
  const labels = filtered.map(d => d.d);
  const avgs   = filtered.map(d => d.avg);
  const maxes  = filtered.map(d => d.max);
  const mins   = filtered.map(d => d.min);
  // Rolling 7D/30D computed on the FULL zone series — so a 7D window still
  // shows a meaningful "30D rolling" line based on the 30 days ending at
  // each visible point (most of those days are outside the visible window).
  const fullSeries = _hszCtx().getFullSeries() || [];
  const roll7  = _rollingWithContext(filtered, fullSeries, 7);
  const roll30 = _rollingWithContext(filtered, fullSeries, 30);
  const color = zoneColor(zone);

  // ── Palette differentiation ──
  // Daily avg  → zone colour (primary line, thick 2.2px)
  // 7D rolling → white-ish dashed thin (subtle short-term trend)
  // 30D rolling→ amber #FBBF24 thick solid (long-term trend, never collides with zone colour)
  // Ribbon max/min → very faint, hidden in Focus
  const dailyCol   = color;
  const roll7Col   = 'rgba(255,255,255,0.55)';
  const roll30Col  = '#FBBF24';

  // Convert zone color to rgba for ribbon fill (ultra-discreet)
  let ribbonFill = 'rgba(20,211,169,0.05)';
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    ribbonFill = `rgba(${r},${g},${b},0.04)`;
  }
  const maxBorder = 'rgba(251,191,36,0.35)';
  const minBorder = 'rgba(237,105,101,0.35)';

  // Compute Y range based on preset (Focus uses rolling lines range)
  const validAvgs  = avgs.filter(v => v != null);
  const validMaxes = maxes.filter(v => v != null && !isNaN(v));
  const validMins  = mins.filter(v => v != null && !isNaN(v));
  let { yMin, yMax } = _computeYRange(validAvgs, validMaxes, validMins, _hszCtx().getYPreset(), roll7, roll30);

  // ── Focus mode safety: ensure Daily avg stays visible ──
  // Even in Focus (which targets rolling lines), clamp Y bounds so the
  // primary Daily series is never clipped: extend by 10% on either side
  // if needed. Daily *must* always be visible.
  if (_hszCtx().getYPreset() === 'focus' && validAvgs.length) {
    const dailyMin = Math.min(...validAvgs);
    const dailyMax = Math.max(...validAvgs);
    const span = Math.max(1, dailyMax - dailyMin);
    const pad = span * 0.10;
    if (yMin == null || dailyMin - pad < yMin) yMin = dailyMin - pad;
    if (yMax == null || dailyMax + pad > yMax) yMax = dailyMax + pad;
  }

  // In Focus mode, hide the ribbon entirely (we want pure trend view)
  const showRibbon = _hszCtx().getYPreset() !== 'focus';

  // Min/max avg markers (now with explicit ▼ Min / ▲ Max labels)
  // NOTE: chartjs-plugin-annotation v3+ uses `display: true` on the label,
  // not `enabled: true` (v2 syntax). Wrong key = label silently hidden.
  const annotations = {};
  if (validAvgs.length) {
    const minVal = Math.min(...validAvgs);
    const maxVal = Math.max(...validAvgs);
    annotations.minPt = {
      type: 'point', xValue: avgs.indexOf(minVal), yValue: minVal,
      backgroundColor: _HIST_DN, radius: 5, borderColor: '#fff', borderWidth: 1,
      label: {
        display: true,
        content: `▼ Min ${minVal.toFixed(2)}`,
        color: '#fff',
        font: { size: 10, weight: '600' },
        backgroundColor: _HIST_DN,
        position: 'center',
        yAdjust: 20,
        padding: 4,
        borderRadius: 3,
      },
    };
    annotations.maxPt = {
      type: 'point', xValue: avgs.indexOf(maxVal), yValue: maxVal,
      backgroundColor: _HIST_UP, radius: 5, borderColor: '#fff', borderWidth: 1,
      label: {
        display: true,
        content: `▲ Max ${maxVal.toFixed(2)}`,
        color: '#fff',
        font: { size: 10, weight: '600' },
        backgroundColor: _HIST_UP,
        position: 'center',
        yAdjust: -20,
        padding: 4,
        borderRadius: 3,
      },
    };
  }

  // ── Date formatter helper (DD-MM-YYYY, UK style) ──
  // Reads original ISO labels and reformats to DD-MM-YYYY for display.
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
  };

  // ── HTML title block (hybrid style: eyebrow + title + subtitle) ──
  // Build a short data summary as subtitle.
  const validAvgsOnly = avgs.filter(v => v != null);
  const periodAvg = validAvgsOnly.length
    ? (validAvgsOnly.reduce((a, b) => a + b, 0) / validAvgsOnly.length)
    : null;
  // Compute sigma + min/max with dates for analyst banner
  let sigma = null;
  if (validAvgsOnly.length >= 2) {
    const s = _stdDev(validAvgsOnly);
    if (s != null && !isNaN(s)) sigma = s;
  }
  let minV = null, maxV = null, minDate = null, maxDate = null;
  for (const d of filtered) {
    if (d.avg == null || isNaN(d.avg)) continue;
    if (minV == null || d.avg < minV) { minV = d.avg; minDate = d.d; }
    if (maxV == null || d.avg > maxV) { maxV = d.avg; maxDate = d.d; }
  }
  _setHoTitle({
    eyebrow: `Prices · Lines · ${zone}`,
    title: _titleWithDescription('Daily prices with 7-day and 30-day moving averages', 'Daily average prices over the selected period'),
    subtitle: '',
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Ribbon: max-min daily envelope (faint, hidden in Focus)
        {
          label: 'Daily max',
          data: maxes,
          borderColor: maxBorder,
          backgroundColor: ribbonFill,
          borderWidth: 0.8,
          pointRadius: 0,
          tension: 0,
          spanGaps: true,
          fill: '+1',
          order: 5,
          hidden: !showRibbon,
        },
        {
          label: 'Daily min',
          data: mins,
          borderColor: minBorder,
          backgroundColor: 'transparent',
          borderWidth: 0.8,
          pointRadius: 0,
          tension: 0,
          spanGaps: true,
          fill: false,
          order: 5,
          hidden: !showRibbon,
        },
        // Main 3 lines (order matters for stacking)
        { label: 'Daily avg', data: avgs,   borderColor: dailyCol,  borderWidth: 2.2, pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 3 },
        { label: '7D rolling', data: roll7, borderColor: roll7Col,  borderWidth: 1.5, pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order: 2 },
        { label: '30D rolling', data: roll30, borderColor: roll30Col, borderWidth: 2.4, pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 1 },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        // Title/subtitle now rendered as HTML via _setHoTitle above the canvas
        // (hybrid eyebrow + title + subtitle style — multi-style impossible in plugins.title).
        title: { display: false },
        legend: {
          // In FS mode, the dedicated HTML legend below the chart serves this role
          // and the top-right is occupied by toggle buttons (KPIs/Table/Chart-only).
          // In inline mode, keep the native Chart.js legend.
          display: (_hszCtx().canvasId !== 'ho-fs-chart'),
          position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 12, boxHeight: 2, padding: 10,
            usePointStyle: false,
          },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const index = legendItem.datasetIndex;
            // Clicking Daily max or Daily min toggles BOTH (they are a pair)
            const lbl = ci.data.datasets[index].label;
            if (lbl === 'Daily max' || lbl === 'Daily min') {
              const maxIdx = ci.data.datasets.findIndex(d => d.label === 'Daily max');
              const minIdx = ci.data.datasets.findIndex(d => d.label === 'Daily min');
              const wasVisible = ci.isDatasetVisible(maxIdx);
              ci.setDatasetVisibility(maxIdx, !wasVisible);
              ci.setDatasetVisibility(minIdx, !wasVisible);
            } else {
              const wasVisible = ci.isDatasetVisible(index);
              ci.setDatasetVisibility(index, !wasVisible);
            }
            _hoFollowVisible(ci);
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: (items) => items.length ? fmtDate(items[0].label) : '',
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          }
        },
        annotation: { annotations },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        // Double-click resets the zoom
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID },
          ticks: {
            color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 8,
            callback: function(value) {
              const lbl = this.getLabelForValue(value);
              return _fmtTickUK(lbl);
            },
          },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin, max: yMax,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    }
  });
  // ▼ / ▲ on the rolling averages too (the scale keeps the chosen preset until a series is hidden)
  { const ch = HIST.charts[_hszCtx().canvasId]; if (ch) { _hoFollowVisible(ch, { keepScale: true }); ch.update('none'); } }
  // Analyst banner under the chart
  if (periodAvg != null && sigma != null && minV != null && maxV != null) {
    _renderAnalystBanner(_buildAnalystBanner('lines', {
      avg: periodAvg, sigma, min: minV, max: maxV, minDate, maxDate,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · YoY: same calendar window vs Y-1/Y-2 with historical envelopes.
// Auto-switches to "calendar overlay" mode for windows >= 2Y.
function _hszRenderYoY(filtered, zone, summary) {
  const color = zoneColor(zone);
  const all = summary.zones[zone] || [];
  if (!filtered.length || !all.length) return _hszPlaceholder('Not enough data for YoY');

  // Determine if we're in "long window" mode (2Y, 5Y, All) → calendar overlay
  const w = _hszCtx().getWindow();
  const longWindow = ['2Y', '5Y', 'All'].includes(w);

  if (longWindow) {
    // ── CALENDAR OVERLAY: one line per year, X axis = Jan..Dec ──
    return _hszRenderYoYCalendar(filtered, zone, summary, all);
  }

  // ── SUPERPOSITION MODE: current vs Y-1 vs Y-2 aligned by MM-DD ──
  const curFrom = filtered[0].d;
  const curTo   = filtered[filtered.length - 1].d;

  // Build lookup maps for Y-1 and Y-2 sliced by shifted date window,
  // then re-key by month-day so we align with current[i] regardless of
  // leap-year / missing-day mismatches.
  const sliceWindow = (fromStr, toStr) => all.filter(e => e.d >= fromStr && e.d <= toStr);
  const ny1Arr = sliceWindow(_shiftYearsISO(curFrom, 1), _shiftYearsISO(curTo, 1));
  const ny2Arr = sliceWindow(_shiftYearsISO(curFrom, 2), _shiftYearsISO(curTo, 2));
  const ny1ByMMDD = {};
  ny1Arr.forEach(e => { ny1ByMMDD[e.d.slice(5)] = e.avg; });
  const ny2ByMMDD = {};
  ny2Arr.forEach(e => { ny2ByMMDD[e.d.slice(5)] = e.avg; });

  // Use REAL DATES (current period) as labels so X axis is informative.
  const labels = filtered.map(d => d.d);

  // Align Y-1/Y-2 to current by MM-DD (NOT by index) so they stay
  // mathematically inside the P0–P100 envelope built from the same buckets.
  const cur   = filtered.map(d => d.avg);
  const prev1 = filtered.map(d => ny1ByMMDD[d.d.slice(5)] ?? null);
  const prev2 = filtered.map(d => ny2ByMMDD[d.d.slice(5)] ?? null);

  // Build historical envelopes from years strictly older than the current period start
  const histYears = all.filter(e => e.d < curFrom);
  const env = _historicalEnvelope(filtered, histYears);

  // Aggregate means for subtitle / commentary
  const curMean = _meanIgnoreNull(cur);
  const p1Mean  = _meanIgnoreNull(prev1);
  const p2Mean  = _meanIgnoreNull(prev2);

  // ── Bands ──
  // Outer (P0–P100, Min–Max absolute) → very faint background ribbon
  // Inner (P5–P95, typical regime)    → a bit more visible
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);

  // ── Date formatter (DD-MM-YYYY, UK style) ──
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
  };

  // ── Y-preset handling (Focus / Standard / All) ──
  // Focus    = clip Y to current+Y-1+Y-2 range AND hide both bands (pure line comparison)
  // Standard = include P5–P95 band (typical historical regime)
  // All      = include full Min–Max band (default behaviour)
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');
  let yMin = null, yMax = null;
  const currentLines = [...cur, ...prev1, ...prev2].filter(v => v != null && !isNaN(v));
  if (preset === 'focus' && currentLines.length) {
    const lo = Math.min(...currentLines);
    const hi = Math.max(...currentLines);
    const pad = Math.max(5, (hi - lo) * 0.10);
    yMin = lo - pad;
    yMax = hi + pad;
  } else if (preset === 'standard') {
    const all95 = [...currentLines, ...env.p5Line.filter(v => v != null), ...env.p95Line.filter(v => v != null)];
    if (all95.length) {
      yMin = Math.min(...all95);
      yMax = Math.max(...all95);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  } // 'all' → no clamp, chart auto-fits including Min-Max envelope

  // ── Subtitle cleared : analyst banner under the chart covers the content ──
  const haveYoY = (curMean != null && p1Mean != null);
  const yoyDelta = haveYoY ? curMean - p1Mean : null;

  // HTML title block (hybrid style)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Daily`,
    title: _titleWithDescription('Daily profile', 'Current year vs Y-1, Y-2, and historical range (Min-Max, P5-P95)'),
    subtitle: '',
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // ── Outer band: Min–Max absolute (P0–P100) — ultra-faint background ──
        // Single legend entry "Min–Max range" toggles BOTH max+min lines via _bandPair.
        {
          label: 'Min–Max range', data: env.p100Line,
          borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
          borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
          fill: '+1', order: 8, _bandPair: 'outer',
          hidden: hideBands,
        },
        {
          label: '_outer_min', data: env.p0Line,
          borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
          borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
          fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true,
          hidden: hideBands,
        },
        // ── Inner band: typical regime (P5–P95) ──
        {
          label: 'Typical range (P5–P95)', data: env.p95Line,
          borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
          borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
          fill: '+1', order: 7, _bandPair: 'inner',
          hidden: hideBands,
        },
        {
          label: '_inner_min', data: env.p5Line,
          borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
          borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
          fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true,
          hidden: hideBands,
        },
        // ── Historical median (thin reference line) ──
        {
          label: 'Hist median', data: env.medianLine,
          borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
        },
        // ── Y-2 — fine, dashed, subordinate ──
        {
          label: 'Y-2', data: prev2,
          borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
        },
        // ── Y-1 — fine, dashed, subordinate ──
        {
          label: 'Y-1', data: prev1,
          borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
        },
        // ── Current — the star ──
        {
          label: 'Current period', data: cur,
          borderColor: color, borderWidth: 2.4, pointRadius: 0,
          tension: 0, spanGaps: true, fill: false, order: 1,
        },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        // Title/subtitle now rendered as HTML via _setHoTitle above the canvas.
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            // Hide only the synthetic "lower bound" duplicate entries from the legend
            // — the user toggles a whole band via the visible upper-bound entry.
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          // Custom click handler: clicking a band entry toggles BOTH members of the pair
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          // Don't show synthetic duplicate band lines in tooltip
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: {
            title: (items) => items.length ? fmtDate(items[0].label) : '',
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID },
          ticks: {
            color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 8,
            callback: function(value) {
              const lbl = this.getLabelForValue(value);
              return _fmtTickUK(lbl);
            },
          },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  // Analyst banner
  if (haveYoY) {
    _renderAnalystBanner(_buildAnalystBanner('yoyDaily', {
      curMean, prevMean: p1Mean, delta: yoyDelta,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · YoY Calendar Overlay (long windows: 2Y+) ──
function _hszRenderYoYCalendar(filtered, zone, summary, all) {
  const color = zoneColor(zone);
  // Group entries by year-month and compute monthly avg per year
  const byYearMonth = {};
  all.forEach(e => {
    if (e.avg == null) return;
    const [y, m] = e.d.split('-');
    const key = y;
    if (!byYearMonth[key]) byYearMonth[key] = Array(12).fill(null);
    if (!byYearMonth[key][parseInt(m) - 1]) byYearMonth[key][parseInt(m) - 1] = [];
    byYearMonth[key][parseInt(m) - 1].push(e.avg);
  });
  // Flatten to monthly avg per year
  const byYear = {};
  Object.keys(byYearMonth).forEach(y => {
    byYear[y] = byYearMonth[y].map(monthArr => {
      if (!monthArr) return null;
      const v = monthArr.filter(x => x != null);
      return v.length ? v.reduce((a,b)=>a+b,0) / v.length : null;
    });
  });
  const years = Object.keys(byYear).sort();
  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Color palette for past years (purple → teal → amber → coral)
  const yearColors = ['rgba(123,75,156,0.5)', 'rgba(63,166,180,0.6)', 'rgba(186,117,23,0.6)', 'rgba(212,83,126,0.55)', 'rgba(20,158,117,0.55)'];

  const datasets = years.map((y, i) => {
    const isCurrent = i === years.length - 1;
    return {
      label: y,
      data: byYear[y],
      borderColor: isCurrent ? color : yearColors[i % yearColors.length],
      borderWidth: isCurrent ? 3 : 1.5,
      pointRadius: isCurrent ? 4 : 3,
      pointBackgroundColor: isCurrent ? color : yearColors[i % yearColors.length],
      tension: 0,
      spanGaps: true,
      fill: false,
    };
  });

  // HTML title block (hybrid style)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Daily`,
    title: 'Monthly averages by year · calendar overlay',
    subtitle: `${years.length} years aligned by month · current year highlighted`,
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: { display: (_hszCtx().canvasId !== 'ho-fs-chart'), position: 'top', align: 'end', labels: { color: _HIST_TX3, font: { size: 10 }, boxWidth: 12, boxHeight: 2, padding: 10 } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` } },
      },
    },
  });
}

// ── HSZ · YoY · Weekly: weekly averages aligned across years (ISO week 1..53) ──
// Question business: "Comment ce profil hebdomadaire se compare-t-il à l'année dernière ?"
// One point per ISO week. Up to 53 X values. Current vs Y-1 vs Y-2 lines + historical envelope.
function _hszRenderWeeklyYoY(filtered, zone, summary) {
  const color = zoneColor(zone);
  const all = summary.zones[zone] || [];
  if (!all.length) return _hszPlaceholder('No weekly data');

  // ISO week number helper (Mon=1..Sun=7, week 01 contains the first Thursday of the year)
  function isoWeek(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: String(d.getUTCFullYear()), week: weekNo };
  }

  // Aggregate average prices per ISO week per year
  // byYear[year] = Array(53) of weekly avgs (W01..W53), W00 unused
  const byYear = {};
  const counters = {};
  all.forEach(e => {
    if (e.avg == null) return;
    const { year, week } = isoWeek(e.d);
    if (!byYear[year]) {
      byYear[year] = Array(54).fill(null);
      counters[year] = Array(54).fill(0).map(() => ({ sum: 0, n: 0 }));
    }
    counters[year][week].sum += e.avg;
    counters[year][week].n   += 1;
  });
  Object.keys(byYear).forEach(y => {
    for (let w = 1; w <= 53; w++) {
      const c = counters[y][w];
      if (c.n > 0) byYear[y][w] = c.sum / c.n;
    }
  });
  const years = Object.keys(byYear).sort();
  if (years.length === 0) return _hszPlaceholder('Not enough data');

  const currentYear = years[years.length - 1];
  const priorYears = years.slice(0, -1);
  const yMinus1 = priorYears.length >= 1 ? priorYears[priorYears.length - 1] : null;
  const yMinus2 = priorYears.length >= 2 ? priorYears[priorYears.length - 2] : null;
  // Historical envelope: ALL prior years (including Y-1 and Y-2) so that the
  // Y-1/Y-2 lines never visually escape the Min–Max range — the envelope
  // represents "the historical span excluding the current year".
  const envYears = priorYears;

  // X-axis: weeks 1..53
  const labels = [];
  for (let w = 1; w <= 53; w++) labels.push('W' + String(w).padStart(2, '0'));

  // Envelope per week (P0/P100 outer + P5/P95 inner + median)
  const p0Line   = Array(53).fill(null);
  const p100Line = Array(53).fill(null);
  const p5Line   = Array(53).fill(null);
  const p95Line  = Array(53).fill(null);
  const medianLine = Array(53).fill(null);
  for (let w = 1; w <= 53; w++) {
    const vals = envYears.map(y => byYear[y][w]).filter(v => v != null);
    if (vals.length) {
      const sorted = [...vals].sort((a, b) => a - b);
      p0Line[w-1]   = sorted[0];
      p100Line[w-1] = sorted[sorted.length - 1];
      if (sorted.length < 4) {
        p5Line[w-1]  = sorted[0];
        p95Line[w-1] = sorted[sorted.length - 1];
      } else {
        p5Line[w-1]  = _percentile(sorted, 0.05);
        p95Line[w-1] = _percentile(sorted, 0.95);
      }
      medianLine[w-1] = _percentile(sorted, 0.5);
    }
  }

  // Extract year-series aligned to W01..W53
  const seriesFor = (y) => {
    if (!y) return null;
    const out = Array(53).fill(null);
    for (let w = 1; w <= 53; w++) out[w-1] = byYear[y][w];
    return out;
  };
  const curArr = seriesFor(currentYear);
  const y1Arr  = seriesFor(yMinus1);
  const y2Arr  = seriesFor(yMinus2);

  // Means for analyst banner
  const curMean = _meanIgnoreNull(curArr);
  const y1Mean  = y1Arr ? _meanIgnoreNull(y1Arr) : null;
  const y2Mean  = y2Arr ? _meanIgnoreNull(y2Arr) : null;
  const haveYoYWk = (curMean != null && y1Mean != null);
  const yoyDeltaWk = haveYoYWk ? curMean - y1Mean : null;

  // HTML title block
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Weekly`,
    title: _titleWithDescription('Weekly profile', 'Current year vs Y-1, Y-2, and historical range (Min-Max, P5-P95)'),
    subtitle: '',
  });

  // ── Bands & Y-presets ──
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');
  let yMin = null, yMax = null;
  const currentLines = [
    ...(curArr || []), ...(y1Arr || []), ...(y2Arr || [])
  ].filter(v => v != null && !isNaN(v));
  if (preset === 'focus' && currentLines.length) {
    const lo = Math.min(...currentLines);
    const hi = Math.max(...currentLines);
    const pad = Math.max(5, (hi - lo) * 0.10);
    yMin = lo - pad; yMax = hi + pad;
  } else if (preset === 'standard') {
    const all95 = [...currentLines, ...p5Line.filter(v => v != null), ...p95Line.filter(v => v != null)];
    if (all95.length) {
      yMin = Math.min(...all95);
      yMax = Math.max(...all95);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  }

  const datasets = [
    // Outer Min–Max
    {
      label: 'Min–Max range', data: p100Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 8, _bandPair: 'outer', hidden: hideBands,
    },
    {
      label: '_outer_min', data: p0Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true, hidden: hideBands,
    },
    // Inner P5–P95
    {
      label: 'Typical range (P5–P95)', data: p95Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 7, _bandPair: 'inner', hidden: hideBands,
    },
    {
      label: '_inner_min', data: p5Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true, hidden: hideBands,
    },
    // Historical median
    {
      label: 'Hist median', data: medianLine,
      borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
    },
  ];
  if (yMinus2) {
    datasets.push({
      label: yMinus2, data: y2Arr,
      borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4,
      pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
    });
  }
  if (yMinus1) {
    datasets.push({
      label: yMinus1, data: y1Arr,
      borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4,
      pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
    });
  }
  datasets.push({
    label: currentYear + ' (current)', data: curArr,
    borderColor: color, borderWidth: 2.4,
    pointRadius: 0,
    tension: 0, spanGaps: true, fill: false, order: 1,
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 14 },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  if (haveYoYWk) {
    _renderAnalystBanner(_buildAnalystBanner('yoyWeekly', {
      curMean, prevMean: y1Mean, delta: yoyDeltaWk,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Seasonal: monthly P5-P95 + Min-Max envelopes + median + Y-1, Y-2, current ──
function _hszRenderSeasonal(filtered, zone, summary) {
  const color = zoneColor(zone);
  const all = summary.zones[zone] || [];
  if (!all.length) return _hszPlaceholder('No seasonal data');

  // Pivot: monthly avg per year { year: [12 monthly avgs] }
  const byYM = {};
  all.forEach(e => {
    if (e.avg == null) return;
    const ymKey = e.d.slice(0, 7);
    if (!byYM[ymKey]) byYM[ymKey] = [];
    byYM[ymKey].push(e.avg);
  });
  const byYear = {};
  Object.keys(byYM).forEach(ymKey => {
    const [y, m] = ymKey.split('-');
    if (!byYear[y]) byYear[y] = Array(12).fill(null);
    byYear[y][parseInt(m) - 1] = _meanIgnoreNull(byYM[ymKey]);
  });
  const years = Object.keys(byYear).sort();
  if (years.length === 0) return _hszPlaceholder('No seasonal data');

  const currentYear = years[years.length - 1];
  const priorYears = years.slice(0, -1);
  // Y-1 and Y-2 (the 2 most recent past years; might not exist if too few years)
  const yMinus1 = priorYears.length >= 1 ? priorYears[priorYears.length - 1] : null;
  const yMinus2 = priorYears.length >= 2 ? priorYears[priorYears.length - 2] : null;
  // Historical envelope: ALL prior years (including Y-1 and Y-2) so that the
  // Y-1/Y-2 lines never visually escape the Min–Max range — the envelope
  // represents "the historical span excluding the current year".
  const envYears = priorYears;

  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build envelopes per month: P0/P100 (absolute Min/Max) AND P5/P95 (typical)
  const p0Line   = Array(12).fill(null);
  const p100Line = Array(12).fill(null);
  const p5Line   = Array(12).fill(null);
  const p95Line  = Array(12).fill(null);
  const medianLine = Array(12).fill(null);
  for (let m = 0; m < 12; m++) {
    const vals = envYears.map(y => byYear[y][m]).filter(v => v != null);
    if (vals.length) {
      const sorted = [...vals].sort((a, b) => a - b);
      p0Line[m]   = sorted[0];
      p100Line[m] = sorted[sorted.length - 1];
      if (sorted.length < 4) {
        p5Line[m]  = sorted[0];
        p95Line[m] = sorted[sorted.length - 1];
      } else {
        p5Line[m]  = _percentile(sorted, 0.05);
        p95Line[m] = _percentile(sorted, 0.95);
      }
      medianLine[m] = _percentile(sorted, 0.5);
    }
  }

  // Mean of current year for subtitle
  const curMean = _meanIgnoreNull(byYear[currentYear]);
  const y1Mean  = yMinus1 ? _meanIgnoreNull(byYear[yMinus1]) : null;
  const y2Mean  = yMinus2 ? _meanIgnoreNull(byYear[yMinus2]) : null;

  // ── Bands ──
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);

  // ── Y-preset handling (Focus / Standard / All) ──
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');
  let yMin = null, yMax = null;
  const currentLines = [
    ...(byYear[currentYear] || []),
    ...(yMinus1 ? byYear[yMinus1] : []),
    ...(yMinus2 ? byYear[yMinus2] : []),
  ].filter(v => v != null && !isNaN(v));
  if (preset === 'focus' && currentLines.length) {
    const lo = Math.min(...currentLines);
    const hi = Math.max(...currentLines);
    const pad = Math.max(5, (hi - lo) * 0.10);
    yMin = lo - pad;
    yMax = hi + pad;
  } else if (preset === 'standard') {
    const all95 = [...currentLines, ...p5Line.filter(v => v != null), ...p95Line.filter(v => v != null)];
    if (all95.length) {
      yMin = Math.min(...all95);
      yMax = Math.max(...all95);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  }

  // Analyst banner data
  const haveYoYMo = (curMean != null && y1Mean != null);
  const yoyDeltaMo = haveYoYMo ? curMean - y1Mean : null;

  // HTML title block (hybrid style)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Monthly`,
    title: _titleWithDescription('Monthly profile', 'Current year vs Y-1, Y-2, and historical range (Min-Max, P5-P95)'),
    subtitle: '',
  });

  const datasets = [
    // ── Outer band: Min–Max absolute (P0–P100) ──
    {
      label: 'Min–Max range', data: p100Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 8, _bandPair: 'outer', hidden: hideBands,
    },
    {
      label: '_outer_min', data: p0Line,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true, hidden: hideBands,
    },
    // ── Inner band: typical regime (P5–P95) ──
    {
      label: 'Typical range (P5–P95)', data: p95Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 7, _bandPair: 'inner', hidden: hideBands,
    },
    {
      label: '_inner_min', data: p5Line,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true, hidden: hideBands,
    },
    // ── Historical median ──
    {
      label: 'Hist median', data: medianLine,
      borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
    },
  ];

  // ── Y-2 — fine, dashed, subordinate ──
  if (yMinus2) {
    datasets.push({
      label: yMinus2,
      data: byYear[yMinus2],
      borderColor: 'rgba(168,125,196,0.60)',
      borderWidth: 1.4, pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
    });
  }
  // ── Y-1 — fine, dashed, subordinate ──
  if (yMinus1) {
    datasets.push({
      label: yMinus1,
      data: byYear[yMinus1],
      borderColor: 'rgba(255,255,255,0.55)',
      borderWidth: 1.4, pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
    });
  }
  // ── Current — the star: thick + saturated zone colour ──
  datasets.push({
    label: currentYear + ' (current)',
    data: byYear[currentYear],
    borderColor: color,
    borderWidth: 2.4, pointRadius: 0,
    tension: 0, spanGaps: true, fill: false, order: 1,
  });

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}`,
          },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } } },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  if (haveYoYMo) {
    _renderAnalystBanner(_buildAnalystBanner('yoyMonthly', {
      curMean, prevMean: y1Mean, delta: yoyDeltaMo,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Hourly: intraday profile, toggleable Quarter / YoY ──
// Quarter mode: 4 mini-charts (Q1..Q4) each with 24h profile + Y-1 + Y-2 ghosts.
// YoY mode: 1 chart with 24h profile of the whole period vs Y-1 / Y-2.
// Data source: summary.intraday[zone][year] = {Q1: [24h], Q2: [...], ..., all: [...]}
async function _hszRenderHourly(filtered, zone) {
  if (!filtered.length) return _hszPlaceholder('No data');

  const summary = await fetchSummary();
  const intraday = summary?.intraday?.[zone];
  if (!intraday) {
    return _hszPlaceholder('No intraday profile data — run enrich_summary.py to populate it');
  }

  const mode = _hszCtx().getHourlyMode() || 'quarter';

  // Render the mode toggle UI in the chart area header (above the canvas/grid)
  _hszInjectHourlyToggle(mode);

  if (mode === 'quarter') {
    _hszRenderHourlyQuarter(zone, intraday);
  } else if (mode === 'hodshape') {
    _hszRenderHourlyHodShape(zone);
  } else {
    _hszRenderHourlyYoY(zone, intraday, summary);
  }
}

/**
 * Hour-of-day shape · YoY sub-mode of Hourly.
 * Replaces the canvas host with the HOD-shape module's own container,
 * then calls window.histHodRenderShape(zone) which fully owns its DOM.
 * The module re-renders cleanly when the user switches back to this mode.
 *
 * Works for both inline drill (canvas = ho-detail-chart) and fullscreen
 * (canvas = ho-fs-chart). The single #histhod-shape host is moved between
 * the two parents on context switch — preserves state machine, no ID
 * collision, no double-render.
 */
function _hszRenderHourlyHodShape(zone) {
  const canvasId = _HSZ_TARGET.canvasId || 'ho-detail-chart';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  // Unmount Annual avg animation module if it was active
  if (typeof window.histAnnualUnmount === 'function') window.histAnnualUnmount();
  // Stop Quarter mini-chart animation if it was running
  if (_HSZ_Q_ANIM.timer) { clearInterval(_HSZ_Q_ANIM.timer); _HSZ_Q_ANIM.timer = null; }
  _HSZ_Q_ANIM.playing = false;
  _HSZ_Q_ANIM.ended = false;
  _HSZ_Q_ANIM.visibleCount = 0;
  // Hide the legacy canvas in the active context
  canvas.style.display = 'none';
  // Relax the parent's fixed 340px height so the HOD viz (taller — filters bar
  // + chart + year label) doesn't overflow into the analyst banner below.
  // We remember the original height to restore it when leaving HOD mode.
  if (!parent.dataset.hodOriginalHeight) {
    parent.dataset.hodOriginalHeight = parent.style.height || '340px';
  }
  parent.style.height = 'auto';
  parent.style.minHeight = '340px';
  // Cleanup rogue artifacts from other Hourly modes (Quarter grid + legend)
  ['ho-detail-quarter-grid', 'ho-fs-quarter-grid',
   'ho-detail-quarter-legend', 'ho-fs-quarter-legend'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  // Find existing host (anywhere in the DOM) or create one
  let host = document.getElementById('histhod-shape');
  if (!host) {
    host = document.createElement('div');
    host.id = 'histhod-shape';
    host.style.width = '100%';
  }
  // If host lives under a different parent (context switch between inline
  // ↔ fullscreen), move it to the current parent
  if (host.parentElement !== parent) {
    parent.appendChild(host);
  }
  host.style.display = '';
  if (typeof window.histHodRenderShape === 'function') {
    window.histHodRenderShape(zone);
  } else {
    host.innerHTML = '<div style="padding:24px;color:var(--tx3);font-family:\'JetBrains Mono\',monospace;font-size:11px">Hour-of-day shape module not loaded</div>';
  }
}

// Restore the parent's original height when leaving HOD mode (called from
// Quarter and YoY renderers below)
function _hszRestoreHodParentHeight() {
  ['ho-detail-chart', 'ho-fs-chart'].forEach(canvasId => {
    const c = document.getElementById(canvasId);
    const p = c && c.parentElement;
    if (p && p.dataset.hodOriginalHeight) {
      p.style.height = p.dataset.hodOriginalHeight;
      p.style.minHeight = '';
      delete p.dataset.hodOriginalHeight;
    }
  });
}

// Legacy: previously injected a "By quarter / YoY global" toggle into the
// actions row. NOW SUPERSEDED by the YoY sub-menu pills (rendered by
// _hszRenderYoYSubmenu when on YoY tab with Hourly sub-mode). This stub stays
// for back-compat but does nothing — the slot remains hidden.
function _hszInjectHourlyToggle(_mode) {
  return;
}

// Cleanup helper: hide toggle slot
function _hszHideHourlyToggle() {
  ['ho-detail-toggle-slot', 'ho-fs-toggle-slot'].forEach(id => {
    const s = document.getElementById(id);
    if (s) { s.style.display = 'none'; s.innerHTML = ''; }
  });
}

// Determine "current year" and "Y-1/Y-2" years from the intraday data
// based on the current filter window's last date if possible.
function _hszPickIntradayYears(intraday) {
  const years = Object.keys(intraday).filter(k => /^\d{4}$/.test(k)).sort();
  if (!years.length) return { cur: null, n1: null, n2: null };
  const cur = years[years.length - 1];
  const n1 = years.length >= 2 ? years[years.length - 2] : null;
  const n2 = years.length >= 3 ? years[years.length - 3] : null;
  return { cur, n1, n2 };
}

// ──────────────────────────────────────────────────────────────────
// Quarter mode animation state — mirrors the YoY annual animation UX
// (Play / Pause / Replay button, cumulative year-by-year reveal at
// 1.2s cadence, but applied to the 4 mini-charts in parallel).
// ──────────────────────────────────────────────────────────────────
const _HSZ_Q_ANIM = {
  zone: null,
  intraday: null,
  years: [],        // sorted ascending list of all years available
  visibleCount: 0,  // how many years currently visible (cumulative)
  playing: false,
  ended: false,
  timer: null,
  ctx: null,        // {canvasId, togglePrefix, isFullscreen}
};
const _HSZ_Q_ANIM_INTERVAL_MS = 1200;

function _hszQAnimStop() {
  if (_HSZ_Q_ANIM.timer) { clearInterval(_HSZ_Q_ANIM.timer); _HSZ_Q_ANIM.timer = null; }
  _HSZ_Q_ANIM.playing = false;
  _HSZ_Q_ANIM.ended = false;
  _HSZ_Q_ANIM.visibleCount = 0;
  _hszQAnimRefreshButton();
}

function _hszQAnimEnd() {
  if (_HSZ_Q_ANIM.timer) { clearInterval(_HSZ_Q_ANIM.timer); _HSZ_Q_ANIM.timer = null; }
  _HSZ_Q_ANIM.playing = false;
  _HSZ_Q_ANIM.ended = true;
  _hszQAnimRefreshButton();
}

function _hszQAnimRefreshButton() {
  const btn = document.getElementById('hsz-q-play-btn');
  if (!btn) return;
  if (_HSZ_Q_ANIM.playing) btn.innerHTML = '⏸ Pause';
  else if (_HSZ_Q_ANIM.ended) btn.innerHTML = '↻ Replay';
  else btn.innerHTML = '▶ Play';
}

// The Play button and the timer run after the drill-down has restored
// _HSZ_TARGET (canvasId back to null): draw again on the target saved at the
// last render, otherwise the button vanished and nothing moved.
function _hszQAnimRender() {
  const saved = _HSZ_Q_ANIM.ctx, prev = { ..._HSZ_TARGET };
  if (saved && !_HSZ_TARGET.canvasId) Object.assign(_HSZ_TARGET, saved);
  try { _hszRenderHourlyQuarter(_HSZ_Q_ANIM.zone, _HSZ_Q_ANIM.intraday); }
  finally { Object.assign(_HSZ_TARGET, prev); }
}

function _hszQAnimTogglePlay() {
  if (_HSZ_Q_ANIM.playing) {
    _hszQAnimStop();
    // Redraw with all years visible (steady state)
    _hszQAnimRender();
    return;
  }
  // Start (or replay) the animation
  _HSZ_Q_ANIM.playing = true;
  _HSZ_Q_ANIM.ended = false;
  _HSZ_Q_ANIM.visibleCount = 1; // first year already visible at T=0
  _hszQAnimRefreshButton();
  _hszQAnimRender();

  _HSZ_Q_ANIM.timer = setInterval(() => {
    // Drill-down closed or another mode drawn: stop quietly.
    if (!document.getElementById('hsz-q-play-btn')) { _hszQAnimStop(); return; }
    _HSZ_Q_ANIM.visibleCount += 1;
    if (_HSZ_Q_ANIM.visibleCount >= _HSZ_Q_ANIM.years.length) {
      _HSZ_Q_ANIM.visibleCount = _HSZ_Q_ANIM.years.length;
      _hszQAnimRender();
      _hszQAnimEnd();
      return;
    }
    _hszQAnimRender();
  }, _HSZ_Q_ANIM_INTERVAL_MS);
}

// Public wiring for the inline onclick handler in the Play button
window._hszQAnimTogglePlay = _hszQAnimTogglePlay;

// Quarter mode: 4 mini-charts grid (Q1..Q4)
function _hszRenderHourlyQuarter(zone, intraday) {
  // Update animation context (only reset visibleCount if zone/data changed,
  // otherwise an in-flight animation is just re-rendering itself)
  const ctx = _hszCtx();
  const zoneChanged = (_HSZ_Q_ANIM.zone !== zone) || (_HSZ_Q_ANIM.intraday !== intraday);
  _HSZ_Q_ANIM.zone = zone;
  _HSZ_Q_ANIM.intraday = intraday;
  if (ctx.canvasId) _HSZ_Q_ANIM.ctx = { ...ctx };   // a copy: the drill-down resets the live target after drawing
  // Build full year list from intraday data
  const allYears = Object.keys(intraday).filter(k => /^\d{4}$/.test(k)).sort();
  _HSZ_Q_ANIM.years = allYears;
  if (zoneChanged) {
    // Switching zone: stop any in-flight anim, reset state, show all years
    if (_HSZ_Q_ANIM.timer) { clearInterval(_HSZ_Q_ANIM.timer); _HSZ_Q_ANIM.timer = null; }
    _HSZ_Q_ANIM.playing = false;
    _HSZ_Q_ANIM.ended = false;
    _HSZ_Q_ANIM.visibleCount = 0; // 0 = all years shown (steady state)
  }

  // Unmount Annual avg animation module if it was active
  if (typeof window.histAnnualUnmount === 'function') window.histAnnualUnmount();
  // Cleanup hodshape host if it was active
  const hodHost = document.getElementById('histhod-shape');
  if (hodHost) hodHost.style.display = 'none';
  // Inject Play / Pause / Replay button in the active toggle slot — mirrors YoY UX.
  // Use the active context slot ('ho-detail-toggle-slot' or 'ho-fs-toggle-slot').
  ['ho-detail-toggle-slot', 'ho-fs-toggle-slot'].forEach(id => {
    const s = document.getElementById(id);
    if (!s) return;
    const isActive = (id === 'ho-detail-toggle-slot' && _hszCtx().canvasId === 'ho-detail-chart')
                  || (id === 'ho-fs-toggle-slot' && _hszCtx().canvasId === 'ho-fs-chart');
    if (isActive && _HSZ_Q_ANIM.years.length >= 2) {
      // Only show Play if there are at least 2 years to walk through
      let label;
      if (_HSZ_Q_ANIM.playing) label = '⏸ Pause';
      else if (_HSZ_Q_ANIM.ended) label = '↻ Replay';
      else label = '▶ Play';
      s.innerHTML = `<button id="hsz-q-play-btn" onclick="_hszQAnimTogglePlay()" style="background:transparent;border:1px solid var(--bd);color:var(--tx2);font-size:10px;padding:4px 10px;border-radius:4px;cursor:pointer;font-family:'JetBrains Mono',monospace">${label}</button>`;
      s.style.display = '';
    } else {
      s.innerHTML = '';
      s.style.display = 'none';
    }
  });
  // Restore the parent's original height (relaxed during HOD mode)
  _hszRestoreHodParentHeight();

  const color = zoneColor(zone);
  const yearsPick = _hszPickIntradayYears(intraday);
  if (!yearsPick.cur) return _hszPlaceholder('No intraday data');

  // Effective cur/n1/n2 — overridden when animation is running so the 4 mini-charts
  // walk through years cumulatively (oldest → newest) instead of always showing
  // the latest year + Y-1 + Y-2.
  let cur, n1, n2;
  const animActive = _HSZ_Q_ANIM.playing || (_HSZ_Q_ANIM.ended && _HSZ_Q_ANIM.visibleCount > 0);
  if (animActive) {
    const visible = _HSZ_Q_ANIM.years.slice(0, _HSZ_Q_ANIM.visibleCount);
    // Latest visible year acts as the "current" (drawn solid, used for stats)
    cur = visible[visible.length - 1] || null;
    // The two previous visible years (if any) become Y-1 / Y-2 ghosts
    n1 = visible.length >= 2 ? visible[visible.length - 2] : null;
    n2 = visible.length >= 3 ? visible[visible.length - 3] : null;
  } else {
    cur = yearsPick.cur;
    n1  = yearsPick.n1;
    n2  = yearsPick.n2;
  }
  if (!cur) return _hszPlaceholder('No intraday data');


  if (HIST.charts[_hszCtx().canvasId]) {
    HIST.charts[_hszCtx().canvasId].destroy();
    delete HIST.charts[_hszCtx().canvasId];
  }
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (!canvas) return;
  canvas.style.display = 'none';
  const wrap = canvas.parentNode;

  // Clean previous grid
  const oldGrid = document.getElementById(_hszCtx().togglePrefix + '-quarter-grid');
  if (oldGrid) oldGrid.remove();
  // Clean previous global legend
  const oldLg = document.getElementById(_hszCtx().togglePrefix + '-quarter-legend');
  if (oldLg) oldLg.remove();

  // HTML title block (hybrid F)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Hourly · By quarter`,
    title: _titleWithDescription('Intraday 24h profile by quarter', 'Q1, Q2, Q3, Q4 side-by-side — current year vs Y-1 and Y-2'),
    subtitle: `Each panel shows the average price for every hour of day, aggregated over one quarter. Current ${cur}${n1 ? ', Y-1 ' + n1 : ''}${n2 ? ', Y-2 ' + n2 : ''}.`,
  });

  // Global legend bar — inserted AFTER the wrap (canvas container) so it doesn't
  // get clipped by wrap's fixed 340px height. The neg-prices banner sits after.
  const legendEl = document.createElement('div');
  legendEl.id = _hszCtx().togglePrefix + '-quarter-legend';
  legendEl.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:14px;font-size:10px;color:var(--tx3);margin:8px 0;font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap';
  legendEl.innerHTML = `
    <span><span style="display:inline-block;width:14px;height:2.4px;background:${color};vertical-align:middle;margin-right:5px"></span>${cur} (current)</span>
    ${n1 ? `<span><span style="display:inline-block;width:14px;height:1px;border-top:1.4px dashed rgba(255,255,255,0.55);vertical-align:middle;margin-right:5px"></span>${n1} (Y-1)</span>` : ''}
    ${n2 ? `<span><span style="display:inline-block;width:14px;height:1px;border-top:1.4px dashed rgba(168,125,196,0.7);vertical-align:middle;margin-right:5px"></span>${n2} (Y-2)</span>` : ''}
  `;
  // Place the legend right after the canvas wrap (so before the rest of detail content)
  if (wrap.nextSibling) wrap.parentNode.insertBefore(legendEl, wrap.nextSibling);
  else wrap.parentNode.appendChild(legendEl);

  // 2×2 grid — placed AFTER the legend (i.e. AFTER the canvas wrap)
  const grid = document.createElement('div');
  grid.id = _hszCtx().togglePrefix + '-quarter-grid';
  // Equal-height rows: each cell occupies exactly 1fr of the grid's height so
  // empty quarters (e.g. Q3/Q4 when current year hasn't reached them yet)
  // still match the height of populated ones.
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:14px;height:520px;margin-bottom:8px';

  const Qmeta = [
    { id: 'Q1', label: 'Q1 · Winter', sub: 'Jan-Mar', color: '#A87DC4' },
    { id: 'Q2', label: 'Q2 · Spring', sub: 'Apr-Jun', color: '#14D3A9' },
    { id: 'Q3', label: 'Q3 · Summer', sub: 'Jul-Sep', color: '#FBBF24' },
    { id: 'Q4', label: 'Q4 · Autumn', sub: 'Oct-Dec', color: '#ED6965' },
  ];

  Qmeta.forEach(q => {
    const cell = document.createElement('div');
    cell.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid var(--bd);border-radius:6px;padding:10px;display:flex;flex-direction:column;min-height:0;overflow:hidden';
    cell.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-shrink:0">
        <span style="font-size:9px;font-weight:600;color:${q.color};font-family:'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase">${q.label} <span style="color:var(--tx3);font-weight:500">${q.sub}</span></span>
        <span id="hsz-q-meta-${q.id}" style="font-size:9px;color:var(--tx3);font-family:'JetBrains Mono',monospace"></span>
      </div>
      <div style="flex:1;position:relative;min-height:0">
        <canvas id="hsz-q-canvas-${q.id}"></canvas>
      </div>
    `;
    grid.appendChild(cell);
  });

  // Place the grid right after the legend (i.e. AFTER the canvas wrap)
  if (legendEl.nextSibling) legendEl.parentNode.insertBefore(grid, legendEl.nextSibling);
  else legendEl.parentNode.appendChild(grid);

  // Also hide the canvas wrap entirely (saves 340px of empty space)
  wrap.style.display = 'none';

  // Y-preset (shared across all 4 quarters)
  const preset = _hszCtx().getYPreset();

  const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}h`);
  const quarterStats = {};   // for analyst banner
  Qmeta.forEach(q => {
    const curRaw = intraday[cur]?.[q.id];
    const n1Raw  = n1 ? intraday[n1]?.[q.id] : null;
    const n2Raw  = n2 ? intraday[n2]?.[q.id] : null;

    const curProfile = _hszSanitiseHourlyProfile(curRaw);
    const n1Profile  = _hszSanitiseHourlyProfile(n1Raw);
    const n2Profile  = _hszSanitiseHourlyProfile(n2Raw);

    // Compute quarterly peak / floor / mean (current year) for analyst banner
    if (curProfile && curProfile.some(v => v != null)) {
      let pv = null, ph = null, fv = null, fh = null;
      for (let h = 0; h < 24; h++) {
        const v = curProfile[h];
        if (v == null || isNaN(v)) continue;
        if (pv == null || v > pv) { pv = v; ph = h; }
        if (fv == null || v < fv) { fv = v; fh = h; }
      }
      quarterStats[q.id] = {
        label: q.label, peakVal: pv, peakHour: ph, floorVal: fv, floorHour: fh,
        mean: _meanIgnoreNull(curProfile),
      };
    }

    const cellMeta = document.getElementById(`hsz-q-meta-${q.id}`);

    // If current is empty but Y-1 or Y-2 have data, render those (typical
    // case: current=2026, Q3/Q4 not happened yet but historical context useful).
    const hasAny = (curProfile && curProfile.some(v => v != null))
                 || (n1Profile && n1Profile.some(v => v != null))
                 || (n2Profile && n2Profile.some(v => v != null));
    if (!hasAny) {
      if (cellMeta) cellMeta.textContent = 'no data';
      return;
    }

    if (curProfile && curProfile.some(v => v != null)) {
      const curMean = _meanIgnoreNull(curProfile);
      if (cellMeta) cellMeta.textContent = `${cur} avg ${curMean != null ? curMean.toFixed(1) : '--'} €/MWh`;
    } else if (cellMeta) {
      cellMeta.textContent = `${cur} not in period · showing history`;
      cellMeta.style.color = 'var(--tx3)';
    }

    const datasets = [];
    if (n2Profile) {
      datasets.push({
        label: n2 + ' (Y-2)', data: n2Profile,
        borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4,
        pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
      });
    }
    if (n1Profile) {
      datasets.push({
        label: n1 + ' (Y-1)', data: n1Profile,
        borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4,
        pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
      });
    }
    if (curProfile && curProfile.some(v => v != null)) {
      datasets.push({
        label: cur + ' (current)', data: curProfile,
        borderColor: q.color, borderWidth: 2.4,
        pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 1,
      });
    }

    // ── Y-presets: clip Y axis (per mini-chart) ──
    let yMin = null, yMax = null;
    const allVals = [];
    datasets.forEach(d => d.data.forEach(v => { if (v != null && !isNaN(v)) allVals.push(v); }));
    if (preset === 'focus' && curProfile && curProfile.some(v => v != null)) {
      // Focus on current only — but include Y-1/Y-2 mean line
      const focusVals = [];
      datasets.forEach(d => d.data.forEach(v => { if (v != null && !isNaN(v)) focusVals.push(v); }));
      if (focusVals.length) {
        const lo = Math.min(...focusVals);
        const hi = Math.max(...focusVals);
        const pad = Math.max(5, (hi - lo) * 0.10);
        yMin = lo - pad;
        yMax = hi + pad;
      }
    }
    // Standard / All let Chart.js auto-fit

    mkHistChart(`hsz-q-canvas-${q.id}`, {
      type: 'line',
      data: { labels: hours, datasets },
      options: {
        ...baseOptions(''),
        plugins: {
          title: { display: false },
          subtitle: { display: false },
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` },
          },
          zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
            zoom: {
              drag: {
                enabled: true,
                backgroundColor: 'rgba(20,211,169,0.12)',
                borderColor: 'rgba(20,211,169,0.5)',
                borderWidth: 1,
              },
              wheel: { enabled: false },
              pinch: { enabled: true },
              mode: 'xy',
            },
            pan: { enabled: false },
            limits: { y: { min: 'original', max: 'original' } },
          } : {},
        },
        onClick: (evt) => {
          if (evt.native && evt.native.detail === 2) {
            const ch = HIST.charts[`hsz-q-canvas-${q.id}`];
            if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
          }
        },
        scales: {
          x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 9 }, maxTicksLimit: 8 } },
          y: {
            grid: { color: _HIST_GRID },
            ticks: { color: _HIST_TX3, font: { size: 9 } },
            min: yMin != null ? yMin : undefined,
            max: yMax != null ? yMax : undefined,
          },
        },
      },
    });
  });

  // Analyst banner Quarter — find strongest peak / weakest floor across quarters
  const qWith = Object.values(quarterStats).filter(s => s.peakVal != null && s.floorVal != null);
  if (qWith.length) {
    const strongest = qWith.reduce((a, b) => (a.peakVal > b.peakVal ? a : b));
    const weakest   = qWith.reduce((a, b) => (a.floorVal < b.floorVal ? a : b));
    const html = _buildAnalystBanner('yoyHourlyQuarter', {
      strongestQuarterLabel: strongest.label,
      strongestPeakVal: strongest.peakVal,
      strongestPeakHour: strongest.peakHour,
      weakestQuarterLabel: weakest.label,
      weakestFloorVal: weakest.floorVal,
      weakestFloorHour: weakest.floorHour,
    });
    if (html) {
      // Insert after the grid
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const banner = tmp.firstElementChild;
      if (banner && grid.nextSibling) grid.parentNode.insertBefore(banner, grid.nextSibling);
      else if (banner) grid.parentNode.appendChild(banner);
    }
  }
}

// YoY mode: single chart with 24h profile of period vs Y-1 / Y-2
// As of the multi-year animation refactor, this delegates to histAnnualMount
// which builds a multi-year stack (one curve per year in summary.intraday) and
// supports Play / Compare / Highlight multi (mirrors Hour-of-day shape UX).
function _hszRenderHourlyYoY(zone, intraday, summary) {
  const { cur } = _hszPickIntradayYears(intraday);
  if (!cur) return _hszPlaceholder('No intraday data');

  // Stop Quarter mini-chart animation if it was running
  if (_HSZ_Q_ANIM.timer) { clearInterval(_HSZ_Q_ANIM.timer); _HSZ_Q_ANIM.timer = null; }
  _HSZ_Q_ANIM.playing = false;
  _HSZ_Q_ANIM.ended = false;
  _HSZ_Q_ANIM.visibleCount = 0;

  // Remove the quarter grid + global legend if present, show the main canvas
  const oldGrid = document.getElementById(_hszCtx().togglePrefix + '-quarter-grid');
  if (oldGrid) oldGrid.remove();
  const oldLg = document.getElementById(_hszCtx().togglePrefix + '-quarter-legend');
  if (oldLg) oldLg.remove();
  // Cleanup hodshape host if it was active
  const hodHost = document.getElementById('histhod-shape');
  if (hodHost) hodHost.style.display = 'none';
  // Empty HOD-specific toggle slot (Play/PNG/GIF buttons) — histAnnualMount
  // will refill it with the Annual-specific actions
  ['ho-detail-toggle-slot', 'ho-fs-toggle-slot'].forEach(id => {
    const s = document.getElementById(id);
    if (s) { s.innerHTML = ''; s.style.display = 'none'; }
  });
  // Restore the parent's original height (relaxed during HOD mode)
  _hszRestoreHodParentHeight();
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (canvas) {
    canvas.style.display = '';
    if (canvas.parentNode) canvas.parentNode.style.display = '';
  }

  // ── Delegate to the Annual animation module ──
  // It handles: title block, filters bar (Compare + Highlight), year-label
  // overlay, multi-year datasets, Play animation, GIF/PNG download.
  if (typeof window.histAnnualMount === 'function') {
    window.histAnnualMount(zone, intraday, summary, {
      canvasId: _hszCtx().canvasId,
      isFullscreen: (_hszCtx().canvasId === 'ho-fs-chart'),
    });
    // Also render the analyst banner via the canonical helper · re-uses
    // existing logic so the "Peak at... / Market read..." amber stays.
    _renderHourlyYoYBanner(zone, intraday, summary);
    return;
  }

  // ── FALLBACK · legacy static rendering (if module not loaded) ──
  return _hszRenderHourlyYoYStatic(zone, intraday, summary);
}

// Extracted: render the analyst banner for Annual avg using the existing
// _buildAnalystBanner('yoyHourly', ...) so the message stays consistent.
function _renderHourlyYoYBanner(zone, intraday, summary) {
  const { cur, n1 } = _hszPickIntradayYears(intraday);
  const curProfile = _hszSanitiseHourlyProfile(intraday[cur]?.all);
  const n1Profile  = n1 ? _hszSanitiseHourlyProfile(intraday[n1]?.all) : null;
  if (!curProfile) return;
  // Compute peak / floor for the banner
  let peakVal = -Infinity, peakHour = 0, floorVal = Infinity, floorHour = 0;
  for (let h = 0; h < 24; h++) {
    if (curProfile[h] == null) continue;
    if (curProfile[h] > peakVal)  { peakVal = curProfile[h];  peakHour = h; }
    if (curProfile[h] < floorVal) { floorVal = curProfile[h]; floorHour = h; }
  }
  let prevFloorVal = null, prevPeakHour = null;
  if (n1Profile) {
    let pv = -Infinity, fv = Infinity, ph = 0;
    for (let h = 0; h < 24; h++) {
      if (n1Profile[h] == null) continue;
      if (n1Profile[h] > pv) { pv = n1Profile[h]; ph = h; }
      if (n1Profile[h] < fv) { fv = n1Profile[h]; }
    }
    prevFloorVal = fv;
    prevPeakHour = ph;
  }
  if (typeof window._buildAnalystBanner === 'function' && typeof window._renderAnalystBanner === 'function') {
    window._renderAnalystBanner(window._buildAnalystBanner('yoyHourly', {
      peakHour, peakVal, floorHour, floorVal, prevFloorVal, prevPeakHour,
    }));
  }
}

// Legacy static renderer · preserved as fallback in case the Annual animation
// module fails to load. NOT called by default — only if histAnnualMount is
// undefined. Body left as-is from the pre-refactor version.
function _hszRenderHourlyYoYStatic(zone, intraday, summary) {
  const color = zoneColor(zone);
  const { cur, n1, n2 } = _hszPickIntradayYears(intraday);
  if (!cur) return _hszPlaceholder('No intraday data');

  // Sanitise sparse-data years (e.g. 2024 with 1 point every 2h → interpolated)
  const curProfile = _hszSanitiseHourlyProfile(intraday[cur]?.all);
  const n1Profile  = n1 ? _hszSanitiseHourlyProfile(intraday[n1]?.all) : null;
  const n2Profile  = n2 ? _hszSanitiseHourlyProfile(intraday[n2]?.all) : null;

  if (!curProfile) return _hszPlaceholder('No "all" intraday profile for the current year');

  // ── Historical distribution (P0-P100 outer + P5-P95 inner + median) ──
  // Computed by enrich_summary.py on all years EXCEPT current.
  // If missing (older summary.json), fall back to no-bands mode.
  const dist = summary?.intradayDist?.[zone];
  const hasBands = !!(dist && Array.isArray(dist.p0) && dist.p0.length === 24);

  const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}h`);

  // ── Y-preset (compute first so we can pass hideBands to datasets) ──
  const preset = _hszCtx().getYPreset();
  const hideBands = (preset === 'focus');

  // Convert zone color to rgba for band fills
  const outerFill = _toRgba(color, 0.04);
  const innerFill = _toRgba(color, 0.10);

  const datasets = [];

  if (hasBands) {
    // Outer Min–Max (P0–P100)
    datasets.push({
      label: 'Min–Max range', data: dist.p100,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: outerFill,
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 8, _bandPair: 'outer', hidden: hideBands,
    });
    datasets.push({
      label: '_outer_min', data: dist.p0,
      borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'transparent',
      borderWidth: 0.8, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 8, _bandPair: 'outer', _hideFromLegend: true, hidden: hideBands,
    });
    // Inner P5–P95
    datasets.push({
      label: 'Typical range (P5–P95)', data: dist.p95,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: innerFill,
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: '+1', order: 7, _bandPair: 'inner', hidden: hideBands,
    });
    datasets.push({
      label: '_inner_min', data: dist.p5,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, tension: 0, spanGaps: true,
      fill: false, order: 7, _bandPair: 'inner', _hideFromLegend: true, hidden: hideBands,
    });
    // Historical median
    datasets.push({
      label: 'Hist median', data: dist.p50,
      borderColor: 'rgba(255,255,255,0.30)', borderWidth: 1, pointRadius: 0,
      tension: 0, spanGaps: true, fill: false, borderDash: [2,3], order: 6,
    });
  }

  if (n2Profile) {
    datasets.push({
      label: n2 + ' (Y-2)', data: n2Profile,
      borderColor: 'rgba(168,125,196,0.65)', borderWidth: 1.4,
      pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [8,4], order: 4,
    });
  }
  if (n1Profile) {
    datasets.push({
      label: n1 + ' (Y-1)', data: n1Profile,
      borderColor: 'rgba(255,255,255,0.55)', borderWidth: 1.4,
      pointRadius: 0, tension: 0, spanGaps: true, fill: false, borderDash: [4,3], order: 3,
    });
  }
  datasets.push({
    label: cur + ' (current)', data: curProfile,
    borderColor: color, borderWidth: 2.4,
    pointRadius: 0, tension: 0, spanGaps: true, fill: false, order: 1,
  });

  // Stats for analyst banner: peak hour, floor hour, peak val, floor val for current and prev year
  const curMean = _meanIgnoreNull(curProfile);
  const n1Mean  = n1Profile ? _meanIgnoreNull(n1Profile) : null;
  const n2Mean  = n2Profile ? _meanIgnoreNull(n2Profile) : null;
  let peakHour = null, peakVal = null, floorHour = null, floorVal = null;
  let prevPeakHour = null, prevFloorVal = null;
  if (curProfile && curProfile.length === 24) {
    for (let h = 0; h < 24; h++) {
      const v = curProfile[h];
      if (v == null || isNaN(v)) continue;
      if (peakVal == null || v > peakVal) { peakVal = v; peakHour = h; }
      if (floorVal == null || v < floorVal) { floorVal = v; floorHour = h; }
    }
  }
  if (n1Profile && n1Profile.length === 24) {
    let pV = null, fV = null;
    for (let h = 0; h < 24; h++) {
      const v = n1Profile[h];
      if (v == null || isNaN(v)) continue;
      if (pV == null || v > pV) { pV = v; prevPeakHour = h; }
      if (fV == null || v < fV) { fV = v; prevFloorVal = v; }
    }
  }

  // HTML title block (hybrid F)
  _setHoTitle({
    eyebrow: `Prices · YoY · ${zone} · Hourly · Annual average`,
    title: _titleWithDescription('Intraday 24h profile', 'Average price by hour of day — current year vs Y-1 and Y-2'),
    subtitle: '',
  });

  // Y-preset: focus uses current+Y-1+Y-2 lines (NOT bands which would dominate)
  let yMin = null, yMax = null;
  if (preset === 'focus') {
    const focusVals = [];
    [curProfile, n1Profile, n2Profile].forEach(p => {
      if (p) p.forEach(v => { if (v != null && !isNaN(v)) focusVals.push(v); });
    });
    if (focusVals.length) {
      const lo = Math.min(...focusVals);
      const hi = Math.max(...focusVals);
      const pad = Math.max(5, (hi - lo) * 0.10);
      yMin = lo - pad;
      yMax = hi + pad;
    }
  } else if (preset === 'standard' && hasBands) {
    // Standard: include P5-P95 band
    const vals = [];
    [curProfile, n1Profile, n2Profile].forEach(p => {
      if (p) p.forEach(v => { if (v != null && !isNaN(v)) vals.push(v); });
    });
    dist.p5.forEach(v => { if (v != null) vals.push(v); });
    dist.p95.forEach(v => { if (v != null) vals.push(v); });
    if (vals.length) {
      yMin = Math.min(...vals);
      yMax = Math.max(...vals);
      const pad = Math.max(5, (yMax - yMin) * 0.05);
      yMin -= pad; yMax += pad;
    }
  }

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: { labels: hours, datasets },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: _HIST_TX3, font: { size: 10 }, boxWidth: 14, boxHeight: 2, padding: 12,
            // Hide the synthetic "lower bound" duplicate entries from the legend
            filter: (item, chartData) => {
              const ds = chartData.datasets[item.datasetIndex];
              return !ds || !ds._hideFromLegend;
            },
          },
          // Clicking a band entry toggles BOTH members of the pair
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const ds = ci.data.datasets[idx];
            if (ds && ds._bandPair) {
              const pair = ds._bandPair;
              const newVisible = !ci.isDatasetVisible(idx);
              ci.data.datasets.forEach((d, i) => {
                if (d._bandPair === pair) ci.setDatasetVisibility(i, newVisible);
              });
            } else {
              ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
            }
            ci.update();
          },
        },
        tooltip: {
          mode: 'index', intersect: false,
          // Filter out the synthetic duplicate band lines from the tooltip
          filter: (item) => {
            const ds = item.chart.data.datasets[item.datasetIndex];
            return !ds || !ds._hideFromLegend;
          },
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' €/MWh' : 'n/a'}` },
        },
        zoom: (typeof window.Chart !== 'undefined' && window.Chart.registry && window.Chart.registry.plugins.get('zoom')) ? {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(20,211,169,0.12)',
              borderColor: 'rgba(20,211,169,0.5)',
              borderWidth: 1,
            },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: 'xy',
          },
          pan: { enabled: false },
          limits: { y: { min: 'original', max: 'original' } },
        } : {},
      },
      onClick: (evt) => {
        if (evt.native && evt.native.detail === 2) {
          const ch = HIST.charts[_hszCtx().canvasId];
          if (ch && typeof ch.resetZoom === 'function') ch.resetZoom();
        }
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } } },
        y: {
          grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } },
          min: yMin != null ? yMin : undefined,
          max: yMax != null ? yMax : undefined,
          title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } },
        },
      },
    },
  });
  if (peakHour != null && floorHour != null && peakVal != null && floorVal != null) {
    _renderAnalystBanner(_buildAnalystBanner('yoyHourlyAnnual', {
      peakHour, peakVal, floorHour, floorVal, prevFloorVal, prevPeakHour,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Weekly: avg per day-of-week (Mon..Sun) ──
// ── HSZ · Weekly: box plot per day-of-week (P10/P25/P50/P75/P90) ──
// Chart.js core doesn't natively support box plots — we render it as a stack of:
//  - floating bar dataset for the IQR (P25 to P75)
//  - line overlays for whiskers (P10/P90) and outliers (min/max)
//  - thick median line via a bar dataset
function _hszRenderWeekly(filtered, zone) {
  if (!filtered.length) return _hszPlaceholder('No data');

  // Group avg values by day-of-week (Mon=0..Sun=6)
  const byDow = Array.from({length: 7}, () => []);
  filtered.forEach(e => {
    if (e.avg == null) return;
    const dt = new Date(e.d);
    let dow = dt.getUTCDay();
    dow = (dow + 6) % 7;
    byDow[dow].push(e.avg);
  });

  const stats = byDow.map(arr => _boxStats(arr));
  if (stats.every(s => s == null)) return _hszPlaceholder('Not enough data');

  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // ── Compute summary stats for HTML title block ──
  const wdMean = _meanIgnoreNull([].concat(byDow[0], byDow[1], byDow[2], byDow[3], byDow[4]));
  const weMean = _meanIgnoreNull([].concat(byDow[5], byDow[6]));
  const periodValues = filtered.map(e => e.avg).filter(v => v != null);
  const periodMedian = periodValues.length ? _percentile([...periodValues].sort((a,b)=>a-b), 0.5) : null;

  // Find cheapest / most expensive day by median
  let cheapestIdx = null, mostExpIdx = null;
  let cheapestMed = Infinity, mostExpMed = -Infinity;
  stats.forEach((s, i) => {
    if (!s) return;
    if (s.p50 < cheapestMed) { cheapestMed = s.p50; cheapestIdx = i; }
    if (s.p50 > mostExpMed)  { mostExpMed  = s.p50; mostExpIdx  = i; }
  });

  // Subtitle removed: analyst banner under chart conveys the analysis
  const totalObs = stats.reduce((sum, s) => sum + (s ? s.n : 0), 0);

  _setHoTitle({
    eyebrow: `Prices · Weekday · ${zone} · ${totalObs} days observed`,
    title: _titleWithDescription('Price distribution by day of the week', 'Boxplot Mon → Sun · median, P25-P75, P5-P95, min/max'),
    subtitle: '',
  });

  // ── Y range ──
  const validStats = stats.filter(s => s);
  const p90Max = Math.max(...validStats.map(s => s.p90));
  const p10Min = Math.min(...validStats.map(s => s.p10));
  const dataMax = Math.max(...validStats.map(s => s.max));
  const dataMin = Math.min(...validStats.map(s => s.min));
  const yTop = (dataMax > p90Max * 1.5) ? Math.ceil(p90Max * 1.4 / 10) * 10 : Math.ceil(dataMax * 1.05 / 10) * 10;
  const yBot = (dataMin < p10Min * 0.5 || dataMin < 0) ? Math.floor(Math.min(dataMin * 1.05, p10Min - Math.abs(p10Min) * 0.2) / 10) * 10 : Math.floor(Math.max(0, dataMin - Math.abs(dataMin) * 0.05) / 10) * 10;

  // ── Colour ramp by price (gradient green→amber→red across median ranking) ──
  // Sort days by p50, assign colours: cheapest=green, most expensive=red
  const orderedByMed = stats
    .map((s, i) => ({ s, i }))
    .filter(o => o.s)
    .sort((a, b) => a.s.p50 - b.s.p50);
  const colourByIdx = Array(7).fill(null);
  orderedByMed.forEach((o, rank) => {
    const t = orderedByMed.length === 1 ? 0.5 : rank / (orderedByMed.length - 1);
    // 3-stop gradient: green #14D3A9 → amber #E88728 → red #ED6965
    let r, g, b;
    if (t < 0.5) {
      const k = t * 2;
      r = Math.round(20  + (232 - 20)  * k);
      g = Math.round(211 + (135 - 211) * k);
      b = Math.round(169 + (40  - 169) * k);
    } else {
      const k = (t - 0.5) * 2;
      r = Math.round(232 + (237 - 232) * k);
      g = Math.round(135 + (105 - 135) * k);
      b = Math.round(40  + (101 - 40)  * k);
    }
    colourByIdx[o.i] = `rgb(${r},${g},${b})`;
  });

  // Median line color (same family as the box for visual link)
  const fillForBox = (idx, alpha) => {
    const c = colourByIdx[idx] || 'rgba(255,255,255,0.5)';
    const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (!m) return c;
    return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  };

  // ── Custom plugin: render box plots + weekend background tint + period median ──
  const boxPlotPlugin = {
    id: 'boxPlot',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const yScale = scales.y;

      // 1. Tinted background for weekend (Sat = idx 5, Sun = idx 6)
      const xSatLeft  = xScale.getPixelForValue(5) - (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2;
      const xSunRight = xScale.getPixelForValue(6) + (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2;
      ctx.fillStyle = 'rgba(168,125,196,0.06)';
      ctx.fillRect(xSatLeft, chartArea.top, xSunRight - xSatLeft, chartArea.bottom - chartArea.top);

      // 2. Vertical separator between Fri and Sat
      const xSepX = xScale.getPixelForValue(5) - (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xSepX, chartArea.top);
      ctx.lineTo(xSepX, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // "WEEKEND" label at top of tinted zone
      ctx.fillStyle = 'rgba(168,125,196,0.7)';
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('WEEKEND', (xSatLeft + xSunRight) / 2, chartArea.top + 2);

      // 3. Period median horizontal line
      if (periodMedian != null && periodMedian >= yScale.min && periodMedian <= yScale.max) {
        const yMed = yScale.getPixelForValue(periodMedian);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yMed);
        ctx.lineTo(chartArea.right, yMed);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Period median ${periodMedian.toFixed(1)}`, chartArea.right - 110, yMed - 8);
      }

      const boxHalfWidth = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) * 0.22;

      // 4. Box plots
      stats.forEach((s, i) => {
        if (!s) return;
        const boxColor = colourByIdx[i] || '#94A8BD';
        const xPx = xScale.getPixelForValue(i);
        const yP25 = yScale.getPixelForValue(s.p25);
        const yP75 = yScale.getPixelForValue(s.p75);
        const yP10 = yScale.getPixelForValue(s.p10);
        const yP90 = yScale.getPixelForValue(s.p90);
        const yP50 = yScale.getPixelForValue(s.p50);

        // IQR box (P25-P75) — coloured by price rank
        ctx.fillStyle = fillForBox(i, 0.22);
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(xPx - boxHalfWidth, yP75, boxHalfWidth * 2, yP25 - yP75);
        ctx.fill();
        ctx.stroke();

        // Median line (white, thick, for high contrast against the colored box)
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(xPx - boxHalfWidth, yP50);
        ctx.lineTo(xPx + boxHalfWidth, yP50);
        ctx.stroke();

        // Whiskers (P10-P90) — dashed for clarity
        ctx.strokeStyle = fillForBox(i, 0.7);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(xPx, yP25);
        ctx.lineTo(xPx, yP10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(xPx, yP75);
        ctx.lineTo(xPx, yP90);
        ctx.stroke();
        ctx.setLineDash([]);
        // Whisker caps
        const capWidth = boxHalfWidth * 0.45;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xPx - capWidth, yP10);
        ctx.lineTo(xPx + capWidth, yP10);
        ctx.moveTo(xPx - capWidth, yP90);
        ctx.lineTo(xPx + capWidth, yP90);
        ctx.stroke();

        // Min / Max outlier dots
        if (s.min >= yScale.min && s.min <= yScale.max) {
          const yMin = yScale.getPixelForValue(s.min);
          ctx.fillStyle = _HIST_DN;
          ctx.beginPath();
          ctx.arc(xPx, yMin, 3, 0, 2 * Math.PI);
          ctx.fill();
        }
        if (s.max >= yScale.min && s.max <= yScale.max) {
          const yMax = yScale.getPixelForValue(s.max);
          ctx.fillStyle = _HIST_WARN;
          ctx.beginPath();
          ctx.arc(xPx, yMax, 3, 0, 2 * Math.PI);
          ctx.fill();
        }

        // 5. Low-confidence warning (n < 5)
        if (s.n < 5) {
          ctx.fillStyle = '#FBBF24';
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`⚠ n=${s.n}`, xPx, chartArea.bottom + 4);
        }
      });
    },
  };

  // ── Custom HTML legend above the chart (rendered separately into a div) ──
  // Render legend by injecting into a sibling div BEFORE the canvas. We use the
  // togglePrefix to find the right container.
  const legendId = _hszCtx().togglePrefix + '-weekday-legend';
  const oldLg = document.getElementById(legendId);
  if (oldLg) oldLg.remove();
  const canvas = document.getElementById(_hszCtx().canvasId);
  if (canvas && canvas.parentNode) {
    const lg = document.createElement('div');
    lg.id = legendId;
    lg.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:14px;font-size:10px;color:var(--tx3);margin-bottom:6px;font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap';
    lg.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:10px;background:linear-gradient(to right,#14D3A9,#E88728,#ED6965);border-radius:2px"></span>Box P25-P75 (color = price rank)</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;height:2px;background:#fff"></span>Median (P50)</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;border-top:1.4px dashed rgba(255,255,255,0.55)"></span>Whiskers P10-P90</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;border-top:1px dashed rgba(255,255,255,0.5)"></span>Period median ${periodMedian != null ? periodMedian.toFixed(1) + ' €' : ''}</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:6px;height:6px;background:#FBBF24;border-radius:50%;display:inline-block"></span>Max <span style="width:6px;height:6px;background:#ED6965;border-radius:50%;display:inline-block;margin-left:4px"></span>Min</span>
    `;
    canvas.parentNode.insertBefore(lg, canvas);
  }

  mkHistChart(_hszCtx().canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Box plot',
          data: stats.map(s => s ? s.p50 : null),
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidth: 0,
          barPercentage: 0.001,
          categoryPercentage: 1,
        },
      ],
    },
    options: {
      ...baseOptions('€/MWh'),
      plugins: {
        title: { display: false },
        subtitle: { display: false },
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            label: (ctx) => {
              const s = stats[ctx.dataIndex];
              if (!s) return '';
              const out = [
                ` Min:    ${s.min.toFixed(1)} €/MWh`,
                ` P10:    ${s.p10.toFixed(1)} €/MWh`,
                ` P25:    ${s.p25.toFixed(1)} €/MWh`,
                ` Median: ${s.p50.toFixed(1)} €/MWh`,
                ` P75:    ${s.p75.toFixed(1)} €/MWh`,
                ` P90:    ${s.p90.toFixed(1)} €/MWh`,
                ` Max:    ${s.max.toFixed(1)} €/MWh`,
                ` n = ${s.n}${s.n < 5 ? ' ⚠ low confidence' : ''}`,
              ];
              return out;
            },
          },
        },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      layout: {
        padding: { bottom: 18 },  // room for the ⚠ n=X warning under boxes
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: yBot, max: yTop, title: { display: true, text: '€/MWh', color: _HIST_TX3, font: { size: 10 } } },
      },
    },
    plugins: [boxPlotPlugin],
  });
  // Analyst banner
  if (mostExpIdx != null && cheapestIdx != null) {
    _renderAnalystBanner(_buildAnalystBanner('weekday', {
      mostExpName: labels[mostExpIdx],
      mostExpMedian: stats[mostExpIdx].p50,
      cheapestName: labels[cheapestIdx],
      cheapestMedian: stats[cheapestIdx].p50,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Volatility: rolling σ on 7D / 30D windows ──
// ── Volatility metric state ────────────────────────────────────────────────
window._volMetric = window._volMetric || 'sigma';  // 'sigma' | 'dod' | 'range'
function _setVolMetric(m) {
  window._volMetric = m;
  // Rerender the active tab (which is volatility)
  const zone = window._HO_OPEN_ZONE;
  if (zone && window._HO_LAST_SERIES && window._HO_LAST_SERIES[zone] && _HSZ_RERENDER) {
    _HSZ_RERENDER();
  }
}
window._setVolMetric = _setVolMetric;

// Each metric's metadata: label, formula, explanation, thresholds (low/high), unit
const _VOL_METRICS = {
  sigma: {
    label: 'σ rolling',
    short: 'σ',
    unit: '€/MWh',
    formula: 'σ_N(D) = stddev of daily avg prices on [D-N+1 .. D]',
    explanation: 'Day-to-day variability over a rolling window. A high σ means daily prices diverge a lot from their mean; a low σ means they stay close to it.',
    thresholds: [15, 30],
    thresholdLabels: ['stable', 'moderate', 'volatile'],
    thresholdColors: ['rgba(20,211,169,0.4)', 'rgba(251,191,36,0.4)', 'rgba(237,105,101,0.4)'],
  },
  dod: {
    label: 'Day-on-day Δ',
    short: 'Δ DoD',
    unit: '€/MWh',
    formula: 'ΔDoD_N(D) = mean of |P_d - P_{d-1}| on [D-N+1 .. D]',
    explanation: 'Average absolute change from one day to the next. A high Δ means prices jump significantly day-to-day; a low Δ means they barely move.',
    thresholds: [10, 25],
    thresholdLabels: ['stable', 'moderate', 'volatile'],
    thresholdColors: ['rgba(20,211,169,0.4)', 'rgba(251,191,36,0.4)', 'rgba(237,105,101,0.4)'],
  },
  range: {
    label: 'Intra-day range',
    short: 'Range',
    unit: '€/MWh',
    formula: 'Range_N(D) = mean of (max_h - min_h) per day on [D-N+1 .. D]',
    explanation: 'Average gap between the highest and lowest hourly prices each day. A wide range means strong intraday swings; a narrow range means flat days.',
    thresholds: [50, 100],
    thresholdLabels: ['narrow', 'moderate', 'wide'],
    thresholdColors: ['rgba(20,211,169,0.4)', 'rgba(251,191,36,0.4)', 'rgba(237,105,101,0.4)'],
  },
};

// Rolling mean of abs day-on-day deltas
function _rollingDoDWithContext(filtered, fullSeries, window) {
  const out = filtered.map(() => null);
  if (!fullSeries.length) return out;
  // Build a date-indexed map of full series for lookup
  const idx = new Map();
  fullSeries.forEach((e, i) => idx.set(e.d, i));
  filtered.forEach((e, fi) => {
    const i = idx.get(e.d);
    if (i == null || i < window) return;
    const deltas = [];
    for (let j = i - window + 1; j <= i; j++) {
      const p = fullSeries[j]?.avg;
      const prev = fullSeries[j - 1]?.avg;
      if (p != null && prev != null) deltas.push(Math.abs(p - prev));
    }
    if (deltas.length >= window / 2) {
      out[fi] = deltas.reduce((a,b) => a+b, 0) / deltas.length;
    }
  });
  return out;
}

// Rolling mean of intra-day range (max - min per day)
function _rollingRangeWithContext(filtered, fullSeries, window) {
  const out = filtered.map(() => null);
  if (!fullSeries.length) return out;
  const idx = new Map();
  fullSeries.forEach((e, i) => idx.set(e.d, i));
  filtered.forEach((e, fi) => {
    const i = idx.get(e.d);
    if (i == null || i < window - 1) return;
    const ranges = [];
    for (let j = i - window + 1; j <= i; j++) {
      const day = fullSeries[j];
      if (day?.max != null && day?.min != null) ranges.push(day.max - day.min);
    }
    if (ranges.length >= window / 2) {
      out[fi] = ranges.reduce((a,b) => a+b, 0) / ranges.length;
    }
  });
  return out;
}

function _hszRenderVolatility(filtered, zone) {
  const color = zoneColor(zone);
  if (!filtered.length) return _hszPlaceholder('No data');

  const metricId = window._volMetric || 'sigma';
  const meta = _VOL_METRICS[metricId];
  const labels = filtered.map(d => d.d);
  const fullSeries = _hszCtx().getFullSeries() || [];

  // Compute the two rolling series (7D and 30D) for the selected metric
  let s7, s30;
  if (metricId === 'sigma') {
    s7  = _rollingSigmaWithContext(filtered, fullSeries, 7);
    s30 = _rollingSigmaWithContext(filtered, fullSeries, 30);
  } else if (metricId === 'dod') {
    s7  = _rollingDoDWithContext(filtered, fullSeries, 7);
    s30 = _rollingDoDWithContext(filtered, fullSeries, 30);
  } else {  // range
    s7  = _rollingRangeWithContext(filtered, fullSeries, 7);
    s30 = _rollingRangeWithContext(filtered, fullSeries, 30);
  }

  // Period-level stats on the 7D series (more reactive than 30D)
  const valid7  = s7.filter(v => v != null && !isNaN(v));
  const period7Mean = valid7.length ? valid7.reduce((a,b)=>a+b,0) / valid7.length : 0;
  // Count days above the "volatile" threshold
  const [t1, t2] = meta.thresholds;
  const daysAboveHigh = valid7.filter(v => v > t2).length;
  // Find top 5 spikes (highest values in s7), keep their date labels
  const indexedS7 = s7.map((v, i) => ({ v, i, d: labels[i] }))
    .filter(o => o.v != null && !isNaN(o.v));
  const topSpikes = [...indexedS7].sort((a,b) => b.v - a.v).slice(0, 3);
  // Period max
  const periodMax = topSpikes.length ? topSpikes[0] : null;

  // Determine current regime label based on period mean
  let regime;
  if (period7Mean < t1) regime = meta.thresholdLabels[0];
  else if (period7Mean < t2) regime = meta.thresholdLabels[1];
  else regime = meta.thresholdLabels[2];

  // Title with discrete description suffix ("Title | description")
  // Subtitle keeps only the formula (italic, smaller); stats + verdict go in the analyst banner below the chart.
  const titleHtml = _titleWithDescription(`${meta.label} — 7-day and 30-day rolling`, meta.explanation);
  const formulaSubtitle = `<span style="color:var(--tx3);font-style:italic;font-size:10px">${meta.formula}</span>`;

  _setHoTitle({
    eyebrow: `Prices · Volatility · ${zone} · ${meta.short}`,
    title: titleHtml,
    subtitle: formulaSubtitle,
  });

  // Y-axis: small headroom (5%) since min/max points no longer have labels
  const allVals = [...s7, ...s30].filter(v => v != null && !isNaN(v));
  const valMax = allVals.length ? Math.max(...allVals) : t2;
  const headroom = Math.max(valMax * 0.05, 3);
  const yMaxData = Math.ceil((valMax + headroom) / 5) * 5;

  // ── Toggle pills are rendered by _hszRenderYoYSubmenu (unified location, top of header) ──
  _hszRenderYoYSubmenu();

  // ── Annotation: top 5 spikes with anti-collision algorithm ──
  // ── Min/Max markers per curve: 4 points (max 7D, min 7D, max 30D, min 30D) ──
  // No labels — values shown via hover tooltip on the chart's curves.
  // Toggleable via the legend (state: window._volShowSpikes).
  if (window._volShowSpikes === undefined) window._volShowSpikes = true;
  const showSpikes = window._volShowSpikes;
  const spikeAnnotations = {};
  if (showSpikes) {
    const find = (series, label) => {
      let maxV = null, maxD = null, minV = null, minD = null;
      series.forEach((v, i) => {
        if (v == null || isNaN(v)) return;
        if (maxV == null || v > maxV) { maxV = v; maxD = labels[i]; }
        if (minV == null || v < minV) { minV = v; minD = labels[i]; }
      });
      return { maxV, maxD, minV, minD };
    };
    const s7stats  = find(s7,  '7D');
    const s30stats = find(s30, '30D');
    if (s7stats.maxV != null) spikeAnnotations.max7 = {
      type: 'point', xValue: s7stats.maxD, yValue: s7stats.maxV,
      backgroundColor: '#ED6965', borderColor: '#000', borderWidth: 1, radius: 4,
      // Hover label: shows "Max 7D: <value> on <date>"
      label: {
        display: false,
        content: ['Max 7D', `${s7stats.maxV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s7stats.maxD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#ED6965', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: -28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
    if (s7stats.minV != null) spikeAnnotations.min7 = {
      type: 'point', xValue: s7stats.minD, yValue: s7stats.minV,
      backgroundColor: '#14D3A9', borderColor: '#000', borderWidth: 1, radius: 4,
      label: {
        display: false,
        content: ['Min 7D', `${s7stats.minV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s7stats.minD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#14D3A9', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: 28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
    if (s30stats.maxV != null) spikeAnnotations.max30 = {
      type: 'point', xValue: s30stats.maxD, yValue: s30stats.maxV,
      backgroundColor: '#ED6965', borderColor: '#000', borderWidth: 1, radius: 3.5,
      label: {
        display: false,
        content: ['Max 30D', `${s30stats.maxV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s30stats.maxD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#ED6965', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: -28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
    if (s30stats.minV != null) spikeAnnotations.min30 = {
      type: 'point', xValue: s30stats.minD, yValue: s30stats.minV,
      backgroundColor: '#14D3A9', borderColor: '#000', borderWidth: 1, radius: 3.5,
      label: {
        display: false,
        content: ['Min 30D', `${s30stats.minV.toFixed(2)} ${meta.unit}`, _fmtShortDate(s30stats.minD)],
        color: '#fff', backgroundColor: 'rgba(11,15,21,0.95)',
        borderColor: '#14D3A9', borderWidth: 1, borderRadius: 4,
        font: { size: 10, family: 'JetBrains Mono', weight: '600' },
        padding: 6, position: 'start', yAdjust: 28,
      },
      enter(ctx) { ctx.element.options.label.display = true; ctx.chart.update(); },
      leave(ctx) { ctx.element.options.label.display = false; ctx.chart.update(); },
    };
  }

  // ── Custom HTML legend above the chart with Spikes toggle ──
  const legendId = _hszCtx().togglePrefix + '-vol-legend';
  const oldLg = document.getElementById(legendId);
  if (oldLg) oldLg.remove();
  const canvasEl = document.getElementById(_hszCtx().canvasId);
  if (canvasEl && canvasEl.parentNode) {
    const lg = document.createElement('div');
    lg.id = legendId;
    lg.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:12px;font-size:10px;color:var(--tx3);margin-bottom:6px;font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap';
    lg.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;height:2px;background:${_HIST_WARN}"></span>7D rolling</span>
      <span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:14px;height:2.5px;background:${color}"></span>30D rolling</span>
      <button onclick="event.stopPropagation();window._volShowSpikes=!window._volShowSpikes;if(_HSZ_RERENDER)_HSZ_RERENDER()"
        title="Show/hide min and max markers · hover them for exact values"
        style="background:${showSpikes?'rgba(255,255,255,0.06)':'transparent'};border:1px solid ${showSpikes?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.10)'};color:${showSpikes?'var(--tx)':'var(--tx3)'};padding:3px 8px;border-radius:3px;font-size:9px;cursor:pointer;font-family:inherit;font-weight:600;letter-spacing:.04em;text-transform:uppercase;display:inline-flex;align-items:center;gap:6px">
        <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#ED6965;display:inline-block"></span>Max</span>
        <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#14D3A9;display:inline-block"></span>Min</span>
        ${showSpikes ? '✓' : ''}
      </button>
    `;
    // FS-aware insertion: in FS, place in chart-pane BEFORE the canvas wrapper
    const isFs = (_hszCtx().canvasId === 'ho-fs-chart');
    if (isFs) {
      const pane = document.getElementById('ho-fs-chart-pane');
      const canvasWrapFs = canvasEl.parentNode;
      if (pane && canvasWrapFs) {
        pane.insertBefore(lg, canvasWrapFs);
      }
    } else {
      canvasEl.parentNode.insertBefore(lg, canvasEl);
    }
  }

  mkHistChart(_hszCtx().canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // 7D — thin orange (reactive line, holds the spikes)
        { label: '7D rolling', data: s7,  borderColor: _HIST_WARN, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0, spanGaps: true, fill: false },
        // 30D — thicker zone color (trend line)
        { label: '30D rolling', data: s30, borderColor: color,    backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0, spanGaps: true, fill: false },
      ],
    },
    options: {
      ...baseOptions(meta.unit),
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + ' ' + meta.unit : 'n/a'}` } },
        annotation: {
          annotations: {
            // Regime zones in the background (reinforced alpha 0.10)
            zoneStable:   { type: 'box', yMin: 0,  yMax: Math.min(t1, yMaxData), backgroundColor: 'rgba(20,211,169,0.10)', borderWidth: 0 },
            zoneModerate: { type: 'box', yMin: t1, yMax: Math.min(t2, yMaxData), backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 0 },
            zoneVolatile: { type: 'box', yMin: t2, yMax: yMaxData,                backgroundColor: 'rgba(237,105,101,0.10)', borderWidth: 0 },
            // Threshold reference lines — labels positioned 'start' (left edge, inside the chart area)
            // with a small background so they read against the colored zones.
            refLow: yMaxData >= t1 ? { type: 'line', yMin: t1, yMax: t1, borderColor: 'rgba(20,211,169,0.55)', borderWidth: 1, borderDash: [3,3],
              label: { display: true, content: `${meta.short}=${t1} · ${meta.thresholdLabels[0]}/${meta.thresholdLabels[1]}`,
                color: '#14D3A9', font: { size: 9, family: 'JetBrains Mono', weight: '600' },
                position: 'start', backgroundColor: 'rgba(11,15,21,0.7)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 },
                yAdjust: -8 } } : undefined,
            refHigh: yMaxData >= t2 ? { type: 'line', yMin: t2, yMax: t2, borderColor: 'rgba(237,105,101,0.55)', borderWidth: 1, borderDash: [3,3],
              label: { display: true, content: `${meta.short}=${t2} · ${meta.thresholdLabels[1]}/${meta.thresholdLabels[2]}`,
                color: '#ED6965', font: { size: 9, family: 'JetBrains Mono', weight: '600' },
                position: 'start', backgroundColor: 'rgba(11,15,21,0.7)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 },
                yAdjust: -8 } } : undefined,
            ...spikeAnnotations,
          },
        },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      scales: {
        x: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 }, maxTicksLimit: 8,
          callback: function(value) {
            const lbl = this.getLabelForValue(value);
            return _fmtTickUK(lbl);
          }
        } },
        y: { grid: { color: _HIST_GRID }, ticks: { color: _HIST_TX3, font: { size: 10 } }, min: 0, max: yMaxData, title: { display: true, text: meta.unit, color: _HIST_TX3, font: { size: 10 } } },
      },
    },
  });
  // Analyst banner
  if (period7Mean != null) {
    _renderAnalystBanner(_buildAnalystBanner('volatility', {
      metricLabel: meta.label,
      periodMean: period7Mean,
      regime,
      daysAbove: daysAboveHigh,
      threshold: t2,
      peakVal: periodMax ? periodMax.v : null,
      peakDate: periodMax ? periodMax.d : null,
      unit: meta.unit,
    }));
  } else {
    _renderAnalystBanner('');
  }
}

// ── HSZ · Distribution: histogram of daily avgs for the selected zone ──
// ── Distribution metric state ──────────────────────────────────────────────
window._distMode = window._distMode || 'cumulative';  // 'cumulative' | 'histo'
function _setDistMode(m) {
  window._distMode = m;
  const zone = window._HO_OPEN_ZONE;
  if (zone && _HSZ_RERENDER) _HSZ_RERENDER();
}
window._setDistMode = _setDistMode;

// Default fallback thresholds (used if summary.distThresholds[zone] is missing — typical
// for old summary.json before re-running enrich). Tuned roughly on FR multi-year history.
const _DIST_DEFAULT_THR = { p0: -50, p10: 10, p25: 25, p50: 50, p75: 75, p95: 110, p100: 200, n: 0 };

// Gaussian kernel + KDE evaluator (Silverman rule of thumb for bandwidth)
function _kde(values, xGrid) {
  const n = values.length;
  if (!n) return xGrid.map(() => 0);
  const mean = values.reduce((a,b)=>a+b,0) / n;
  const sd = Math.sqrt(values.reduce((s,v)=>s+(v-mean)*(v-mean),0) / n);
  if (sd === 0) return xGrid.map(() => 0);
  // Silverman's rule: h = 1.06 · σ · n^(-1/5)
  const h = 1.06 * sd * Math.pow(n, -1/5);
  const norm = 1 / (Math.sqrt(2 * Math.PI) * h);
  return xGrid.map(x => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const u = (x - values[i]) / h;
      s += Math.exp(-0.5 * u * u);
    }
    return (s * norm) / n;
  });
}

function _hszRenderDist(filtered, zone, summary) {
  const color = zoneColor(zone);
  if (!filtered.length) return _hszPlaceholder('No data');

  const avgs = filtered.map(d => d.avg).filter(v => v != null && !isNaN(v));
  if (avgs.length < 3) return _hszPlaceholder('Not enough data points');

  const mode = window._distMode || 'cumulative';

  // ── Period-level stats ──
  const sorted = [...avgs].sort((a, b) => a - b);
  const mean    = avgs.reduce((a, b) => a + b, 0) / avgs.length;
  const median  = _percentile(sorted, 0.5);
  const stddev  = Math.sqrt(avgs.reduce((a, v) => a + (v - mean) ** 2, 0) / avgs.length);
  const p5      = _percentile(sorted, 0.05);
  const p95     = _percentile(sorted, 0.95);
  const minV    = sorted[0];
  const maxV    = sorted[sorted.length - 1];

  // ── Zone-historical thresholds (auto-calibrated, fall back to defaults) ──
  const thr = (summary?.distThresholds?.[zone]) || _DIST_DEFAULT_THR;
  // 4 business categories defined by P25, P75, P95 of the zone's full history
  // Negative anchor = 0 (always meaningful regardless of zone)
  const T_NEG = 0;
  const T_LOW = thr.p25;
  const T_HIGH = thr.p75;
  const T_EXTREME = thr.p95;

  // Count days in each business category for subtitle
  const nNeg     = avgs.filter(v => v < T_NEG).length;
  const nLow     = avgs.filter(v => v >= T_NEG && v < T_LOW).length;
  const nNormal  = avgs.filter(v => v >= T_LOW && v < T_HIGH).length;
  const nHigh    = avgs.filter(v => v >= T_HIGH && v < T_EXTREME).length;
  const nExtreme = avgs.filter(v => v >= T_EXTREME).length;
  const pct = n => ((n / avgs.length) * 100).toFixed(1) + '%';

  // ── Toggle pills are rendered by _hszRenderYoYSubmenu (unified location, top of header) ──
  _hszRenderYoYSubmenu();

  // ── Formula strip removed: formula is now part of the subtitle (line 1 italic gray) ──
  // Defensive: remove any stale formula strip from BOTH possible prefixes (inline + FS)
  // in case the user toggled between modes/views and a previous render left it behind.
  ['ho-detail-dist-formula', 'ho-fs-dist-formula'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  const canvasEl = document.getElementById(_hszCtx().canvasId);

  // ── Title block: "Title | discrete description" + subtitle (formula italic only) ──
  // Stats + verdict go in the analyst banner under the chart.
  const titleHtml = (mode === 'cumulative')
    ? _titleWithDescription('Cumulative price distribution', 'For any price level, what % of days fell below it. A steep curve means prices were concentrated in a narrow range; a flat curve means prices were spread out.')
    : _titleWithDescription('Daily average price distribution', 'Frequency of daily prices by price range. Tall bars show the most common price levels; gaps or secondary peaks reveal less common regimes.');
  const formulaLine = (mode === 'cumulative')
    ? `F(x) = days with price ≤ x  /  total · 100%`
    : `count(x) = days with price ∈ [x, x+bin_size]  ·  KDE: density(x) = (1/n·h) · Σ K((x-xᵢ)/h)`;
  // Compute mostFreqBucket for histo banner (used in both modes for context)
  const mostFreqBucket = (() => {
    const range = maxV - minV;
    const BIN = range < 30 ? 2 : range < 80 ? 5 : range < 200 ? 10 : 20;
    const bins = {};
    avgs.forEach(v => {
      const k = Math.floor(v / BIN) * BIN;
      bins[k] = (bins[k] || 0) + 1;
    });
    let best = null, bestC = 0;
    Object.entries(bins).forEach(([k, c]) => { if (c > bestC) { best = +k; bestC = c; } });
    return best != null ? `${best.toFixed(2)} → ${(best+BIN).toFixed(2)} €/MWh` : '—';
  })();
  // p5 for cumulative skew computation (banner)
  const distP5 = sorted.length ? _percentile(sorted, 0.05) : null;
  _setHoTitle({
    eyebrow: `Prices · Distribution · ${zone} · ${avgs.length} days observed`,
    title: titleHtml,
    subtitle: `<span style="color:var(--tx3);font-style:italic">${formulaLine}</span>`,
  });

  // ── Compute shared chart X range (used for both legend ribbon widths and chart axis) ──
  // Round to outer multiples of 10 for clean axis ticks.
  const rawXMin = Math.min(minV, T_NEG - 5);
  const rawXMax = Math.max(maxV, T_EXTREME + 10);
  const chartXMin = Math.floor(rawXMin / 10) * 10;
  const chartXMax = Math.ceil(rawXMax / 10) * 10;
  const xSpan = chartXMax - chartXMin || 1;

  // ── Render legend HTML above the chart, aligned with the chart's coloured zones ──
  // Each tile's width is proportional to its PRICE RANGE on the x-axis (not its day count),
  // so the ribbon visually echoes the bands behind the chart curve.
  const legendId = _hszCtx().togglePrefix + '-dist-legend';
  const oldLg = document.getElementById(legendId);
  if (oldLg) oldLg.remove();
  if (canvasEl && canvasEl.parentNode) {
    const lg = document.createElement('div');
    lg.id = legendId;
    lg.style.cssText = 'margin-top:14px;margin-bottom:2px;font-family:\'JetBrains Mono\',monospace';
    // Width proportion: each category's price-range size divided by total chart x span
    // (Negative covers [chartXMin..0], Low covers [0..P25], etc.)
    const widths = {
      neg:     Math.max(0, T_NEG - chartXMin) / xSpan,
      low:     Math.max(0, T_LOW - T_NEG) / xSpan,
      normal:  Math.max(0, T_HIGH - T_LOW) / xSpan,
      high:    Math.max(0, T_EXTREME - T_HIGH) / xSpan,
      extreme: Math.max(0, chartXMax - T_EXTREME) / xSpan,
    };
    // Minimum visible width so tiles never collapse to 0px even with extreme ratios
    const minPct = 6;
    const tile = (widthPct, bg, borderBottom, label, count, rangeTxt) => {
      const w = Math.max(widthPct * 100, minPct);
      return `<div style="flex:${w} ${w} 0;min-width:0;background:${bg};border-bottom:2px solid ${borderBottom};padding:6px 8px;display:flex;flex-direction:column;gap:2px;justify-content:center;overflow:hidden">
        <div style="font-size:10px;font-weight:600;color:var(--tx);letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><strong>${label}</strong> · ${count}d (${pct(count)})</div>
        <div style="font-size:9px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rangeTxt}</div>
      </div>`;
    };
    // Outer wrapper has placeholder L/R padding — will be adjusted post-render
    // to match the actual Chart.js chartArea (left = Y-axis label + ticks width,
    // right = right margin). This gives pixel-perfect alignment of the legend
    // tiles with the coloured zone bands behind the chart.
    lg.innerHTML = `<div id="${legendId}-inner" style="padding-left:50px;padding-right:12px;transition:padding 0.15s"><div style="display:flex;gap:2px;border-radius:3px;overflow:hidden">
      ${tile(widths.neg,     'rgba(237,105,101,0.18)', 'rgba(237,105,101,0.6)', 'Negative', nNeg,     `< 0.00 €/MWh`)}
      ${tile(widths.low,     'rgba(20,211,169,0.18)',  'rgba(20,211,169,0.6)',  'Low',      nLow,     `0.00 → ${T_LOW.toFixed(2)} €/MWh`)}
      ${tile(widths.normal,  'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.35)', 'Normal',  nNormal,  `${T_LOW.toFixed(2)} → ${T_HIGH.toFixed(2)} €/MWh`)}
      ${tile(widths.high,    'rgba(251,191,36,0.18)',  'rgba(251,191,36,0.6)',  'High',     nHigh,    `${T_HIGH.toFixed(2)} → ${T_EXTREME.toFixed(2)} €/MWh`)}
      ${tile(widths.extreme, 'rgba(237,105,101,0.22)', 'rgba(237,105,101,0.7)', 'Extreme',  nExtreme, `> ${T_EXTREME.toFixed(2)} €/MWh`)}
    </div></div>`;
    // Insert in the right place depending on inline vs fullscreen
    const isFs = (_hszCtx().canvasId === 'ho-fs-chart');
    if (isFs) {
      // FS: insert in chart-pane BEFORE the canvas wrapper (which is the parent of the canvas)
      const pane = document.getElementById('ho-fs-chart-pane');
      const canvasWrapFs = canvasEl.parentNode;
      if (pane && canvasWrapFs) {
        pane.insertBefore(lg, canvasWrapFs);
      }
    } else {
      canvasEl.parentNode.insertBefore(lg, canvasEl);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE 1: CUMULATIVE (CDF)
  // ─────────────────────────────────────────────────────────────────────────
  if (mode === 'cumulative') {
    // X grid: use the shared chart range (rounded to outer multiples of 10)
    const xMin = chartXMin;
    const xMax = chartXMax;
    const N_POINTS = 100;
    const xGrid = [];
    for (let i = 0; i < N_POINTS; i++) xGrid.push(xMin + (xMax - xMin) * (i / (N_POINTS - 1)));
    // CDF: for each x, % of values <= x
    const cdf = xGrid.map(x => {
      let n = 0;
      for (let i = 0; i < sorted.length; i++) { if (sorted[i] <= x) n++; else break; }
      return (n / sorted.length) * 100;
    });

    // Annotations: zones + threshold labels + P50/P95 crosshairs
    // Label positions: P25 at TOP (low-price side); P75 and P95 at BOTTOM (high-price side, less crowded)
    // P50 and P95 crosshair labels positioned directly BELOW their point.
    const annotations = {
      // Background category zones (reinforced alpha 0.10)
      bandNeg:     { type: 'box', xMin, xMax: T_NEG,      backgroundColor: 'rgba(237,105,101,0.10)', borderWidth: 0 },
      bandLow:     { type: 'box', xMin: T_NEG, xMax: T_LOW,     backgroundColor: 'rgba(20,211,169,0.08)', borderWidth: 0 },
      bandNormal:  { type: 'box', xMin: T_LOW, xMax: T_HIGH,    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 0 },
      bandHigh:    { type: 'box', xMin: T_HIGH, xMax: T_EXTREME, backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 0 },
      bandExtreme: { type: 'box', xMin: T_EXTREME, xMax,        backgroundColor: 'rgba(237,105,101,0.13)', borderWidth: 0 },
      // Threshold vertical lines: P25 label at TOP, P75/P95 labels at BOTTOM
      thrZero:    T_NEG >= xMin && T_NEG <= xMax ? { type: 'line', xMin: T_NEG, xMax: T_NEG, borderColor: 'rgba(255,255,255,0.25)', borderWidth: 1, borderDash: [2,3] } : undefined,
      thrLow:     { type: 'line', xMin: T_LOW, xMax: T_LOW, borderColor: 'rgba(20,211,169,0.55)', borderWidth: 1, borderDash: [3,3],
        label: { display: true, content: `P25 · ${T_LOW.toFixed(0)} €`, color: '#14D3A9', font: { size: 9, family: 'JetBrains Mono', weight: '600' }, position: 'end', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: 12 } },
      thrHigh:    { type: 'line', xMin: T_HIGH, xMax: T_HIGH, borderColor: 'rgba(251,191,36,0.55)', borderWidth: 1, borderDash: [3,3],
        label: { display: true, content: `P75 · ${T_HIGH.toFixed(0)} €`, color: '#FBBF24', font: { size: 9, family: 'JetBrains Mono', weight: '600' }, position: 'start', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: -12 } },
      thrExtreme: { type: 'line', xMin: T_EXTREME, xMax: T_EXTREME, borderColor: 'rgba(237,105,101,0.55)', borderWidth: 1, borderDash: [3,3],
        label: { display: true, content: `P95 · ${T_EXTREME.toFixed(0)} €`, color: '#ED6965', font: { size: 9, family: 'JetBrains Mono', weight: '600' }, position: 'start', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2, padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: -12 } },
      // 50% horizontal + median crosshair (label BELOW the point)
      h50: { type: 'line', yMin: 50, yMax: 50, borderColor: 'rgba(20,211,169,0.35)', borderWidth: 1, borderDash: [2,3] },
      medianPoint: { type: 'point', xValue: median, yValue: 50, backgroundColor: '#14D3A9', borderColor: '#000', borderWidth: 1, radius: 5 },
      medianLabel: { type: 'label', xValue: median, yValue: 50, content: `P50 = ${median.toFixed(1)} €`, color: '#14D3A9', backgroundColor: 'rgba(11,15,21,0.90)', borderColor: 'rgba(20,211,169,0.5)', borderWidth: 1, borderRadius: 3, font: { size: 10, family: 'JetBrains Mono', weight: '600' }, padding: 5, xAdjust: 0, yAdjust: 22 },
      // 95% horizontal + P95 crosshair (label BELOW the point)
      h95: { type: 'line', yMin: 95, yMax: 95, borderColor: 'rgba(251,191,36,0.35)', borderWidth: 1, borderDash: [2,3] },
      p95Point: { type: 'point', xValue: p95, yValue: 95, backgroundColor: '#FBBF24', borderColor: '#000', borderWidth: 1, radius: 5 },
      p95Label: { type: 'label', xValue: p95, yValue: 95, content: `P95 = ${p95.toFixed(1)} €`, color: '#FBBF24', backgroundColor: 'rgba(11,15,21,0.92)', borderColor: 'rgba(251,191,36,0.5)', borderWidth: 1, borderRadius: 3, font: { size: 10, family: 'JetBrains Mono', weight: '600' }, padding: 5, xAdjust: 0, yAdjust: 22 },
    };

    mkHistChart(_hszCtx().canvasId, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Cumulative %',
          data: xGrid.map((x, i) => ({ x, y: cdf[i] })),
          borderColor: color,
          backgroundColor: _toRgba(color, 0.08),
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0,
          fill: 'origin',
        }],
      },
      options: {
        ...baseOptions('Cumulative %'),
        layout: { padding: { bottom: 8 } },
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', axis: 'x', intersect: false,
            backgroundColor: 'rgba(11,15,21,0.95)',
            borderColor: 'rgba(20,211,169,0.4)', borderWidth: 1,
            titleColor: '#14D3A9', titleFont: { size: 11, family: 'JetBrains Mono', weight: '600' },
            bodyColor: 'var(--tx)', bodyFont: { size: 11, family: 'JetBrains Mono' },
            padding: 8, displayColors: false,
            callbacks: {
              title: ctx => ctx[0] ? `Price ≤ ${ctx[0].parsed.x.toFixed(1)} €/MWh` : '',
              label: ctx => `  ${ctx.parsed.y.toFixed(1)}% of days`,
              afterLabel: ctx => {
                // Bonus: tell the user which category this price falls into
                const p = ctx.parsed.x;
                if (p < 0) return '  → Negative zone';
                if (p < T_LOW) return `  → Low zone (under P25)`;
                if (p < T_HIGH) return `  → Normal zone (P25–P75)`;
                if (p < T_EXTREME) return `  → High zone (P75–P95)`;
                return `  → Extreme zone (over P95)`;
              },
            },
          },
          annotation: { annotations },
          zoom: _zoomConfig({ mode: 'xy' }),
        },
        scales: {
          x: {
            type: 'linear',
            min: xMin, max: xMax,
            grid: { color: _HIST_GRID },
            ticks: { color: _HIST_TX3, font: { size: 10 }, stepSize: 10, maxRotation: 0, autoSkip: true, maxTicksLimit: 20 },
            title: { display: true, text: 'Daily avg (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
          },
          y: {
            min: 0, max: 100,
            grid: { color: _HIST_GRID },
            ticks: { color: _HIST_TX3, font: { size: 10 }, callback: v => v + '%' },
            title: { display: true, text: '% of days under', color: _HIST_TX3, font: { size: 10 } },
          },
        },
      },
    });
    // Post-render: align legend tiles with chart's drawing area (chartArea.left/right)
    // for pixel-perfect alignment with the coloured zones behind the curve.
    _alignLegendToChartArea(legendId);
    // Analyst banner (Cumulative mode)
    _renderAnalystBanner(_buildAnalystBanner('cumulative', {
      median, p95, p5: distP5,
    }));
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE 2: HISTOGRAM + KDE OVERLAY
  // ─────────────────────────────────────────────────────────────────────────
  // Bin size: adaptive
  const range = maxV - minV;
  const BIN_SIZE = range < 30 ? 2 : range < 80 ? 5 : range < 200 ? 10 : 20;
  const binMin = Math.floor(Math.min(minV, T_NEG - 5) / BIN_SIZE) * BIN_SIZE;
  const binMax = Math.ceil(Math.max(maxV, T_EXTREME + 10) / BIN_SIZE) * BIN_SIZE;
  const bins = [], counts = [];
  for (let b = binMin; b < binMax; b += BIN_SIZE) {
    bins.push(b);
    counts.push(avgs.filter(v => v >= b && v < b + BIN_SIZE).length);
  }
  // Color bars by business category (based on bin lower bound)
  const catColor = b => {
    if (b < T_NEG) return _toRgba('#ED6965', 0.65);
    if (b < T_LOW) return _toRgba('#14D3A9', 0.55);
    if (b < T_HIGH) return _toRgba(color, 0.65);
    if (b < T_EXTREME) return _toRgba('#FBBF24', 0.55);
    return _toRgba('#ED6965', 0.55);
  };
  const catBorder = b => {
    if (b < T_NEG) return '#ED6965';
    if (b < T_LOW) return '#14D3A9';
    if (b < T_HIGH) return color;
    if (b < T_EXTREME) return '#FBBF24';
    return '#ED6965';
  };
  const barColors = bins.map(catColor);
  const barBorders = bins.map(catBorder);

  // KDE curve over the same x range
  const xGrid = bins.map(b => b + BIN_SIZE / 2);
  const density = _kde(avgs, xGrid);
  // Scale density to peak-match the histogram for visual co-location
  const maxCount = Math.max(...counts);
  const maxDensity = Math.max(...density);
  const kdeScale = maxDensity > 0 ? (maxCount * 0.95) / maxDensity : 1;
  const kdeScaled = density.map(d => d * kdeScale);

  // Annotations: zones + threshold lines + mean + median
  const annotations = {
    // Background category zones aligned with histogram bins (use xValue indices)
    // Note: bar chart x is categorical, so we use the bin index. Compute boundaries.
    bandNeg:     { type: 'box', xMin: -0.5, xMax: bins.findIndex(b => b >= T_NEG) - 0.5,            backgroundColor: 'rgba(237,105,101,0.10)', borderWidth: 0 },
    bandLow:     { type: 'box', xMin: bins.findIndex(b => b >= T_NEG) - 0.5, xMax: bins.findIndex(b => b >= T_LOW) - 0.5, backgroundColor: 'rgba(20,211,169,0.08)', borderWidth: 0 },
    bandNormal:  { type: 'box', xMin: bins.findIndex(b => b >= T_LOW) - 0.5, xMax: bins.findIndex(b => b >= T_HIGH) - 0.5, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 0 },
    bandHigh:    { type: 'box', xMin: bins.findIndex(b => b >= T_HIGH) - 0.5, xMax: bins.findIndex(b => b >= T_EXTREME) - 0.5, backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 0 },
    bandExtreme: { type: 'box', xMin: bins.findIndex(b => b >= T_EXTREME) - 0.5, xMax: bins.length - 0.5, backgroundColor: 'rgba(237,105,101,0.13)', borderWidth: 0 },
    // μ (mean) and Median: labels positioned at TOP of chart to avoid mid-chart clutter
    meanLine: {
      type: 'line', scaleID: 'x',
      value: bins.findIndex(b => b + BIN_SIZE > mean) - 0.5,
      borderColor: 'rgba(255,255,255,0.45)', borderWidth: 1, borderDash: [3,3],
      label: { display: true, content: `μ ${mean.toFixed(1)} €`, color: 'rgba(255,255,255,0.85)',
        font: { size: 9, family: 'JetBrains Mono', weight: '600' },
        position: 'start', backgroundColor: 'rgba(11,15,21,0.92)', borderRadius: 2,
        padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: 8 },
    },
    medianLine: {
      type: 'line', scaleID: 'x',
      value: bins.findIndex(b => b + BIN_SIZE > median) - 0.5,
      borderColor: '#14D3A9', borderWidth: 1.5, borderDash: [4,2],
      label: { display: true, content: `Med ${median.toFixed(1)} €`, color: '#14D3A9',
        font: { size: 9, family: 'JetBrains Mono', weight: '600' },
        position: 'start', backgroundColor: 'rgba(11,15,21,0.95)', borderColor: 'rgba(20,211,169,0.5)', borderWidth: 1, borderRadius: 2,
        padding: { top: 2, bottom: 2, left: 5, right: 5 }, yAdjust: 26 },
    },
  };

  mkHistChart(_hszCtx().canvasId, {
    type: 'bar',
    data: {
      labels: bins.map(b => String(b)),
      datasets: [
        {
          type: 'bar',
          label: 'Days',
          data: counts,
          backgroundColor: barColors,
          borderColor: barBorders,
          borderWidth: 1,
          order: 2,
        },
        {
          type: 'line',
          label: 'KDE density (scaled)',
          data: kdeScaled,
          borderColor: '#FBBF24',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      ...baseOptions('Days'),
      layout: { padding: { bottom: 8 } },
      interaction: { mode: 'index', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', axis: 'x', intersect: false,
          backgroundColor: 'rgba(11,15,21,0.95)',
          borderColor: 'rgba(20,211,169,0.4)', borderWidth: 1,
          titleColor: '#14D3A9', titleFont: { size: 11, family: 'JetBrains Mono', weight: '600' },
          bodyColor: 'var(--tx)', bodyFont: { size: 11, family: 'JetBrains Mono' },
          padding: 8, displayColors: false,
          callbacks: {
            title: ctx => {
              if (!ctx[0]) return '';
              const b = bins[ctx[0].dataIndex];
              // Category badge in the title
              let cat = 'Normal';
              if (b < T_NEG) cat = 'Negative';
              else if (b < T_LOW) cat = 'Low';
              else if (b < T_HIGH) cat = 'Normal';
              else if (b < T_EXTREME) cat = 'High';
              else cat = 'Extreme';
              return `${b} → ${b + BIN_SIZE} €/MWh · ${cat}`;
            },
            label: ctx => {
              if (ctx.dataset.type === 'bar') {
                const cum = counts.slice(0, ctx.dataIndex + 1).reduce((a,b)=>a+b,0);
                const cumPct = (cum / avgs.length) * 100;
                return [
                  `  ${ctx.parsed.y} day${ctx.parsed.y > 1 ? 's' : ''} (${((ctx.parsed.y / avgs.length) * 100).toFixed(1)}%)`,
                  `  Cumulative: ${cumPct.toFixed(1)}%`,
                ];
              }
              return null;
            },
          },
        },
        annotation: { annotations },
        zoom: _zoomConfig({ mode: 'y' }),
      },
      scales: {
        x: {
          grid: { color: _HIST_GRID, display: false },
          ticks: { color: _HIST_TX3, font: { size: 10 }, autoSkip: false, maxRotation: 0 },
          title: { display: true, text: 'Daily avg (€/MWh)', color: _HIST_TX3, font: { size: 10 } },
        },
        y: {
          grid: { color: _HIST_GRID },
          ticks: { color: _HIST_TX3, font: { size: 10 } },
          title: { display: true, text: 'Days count', color: _HIST_TX3, font: { size: 10 } },
          beginAtZero: true,
          suggestedMax: Math.ceil(maxCount * 1.10),
        },
      },
    },
  });
  // Post-render: align legend tiles with chart's drawing area
  _alignLegendToChartArea(legendId);
  // Analyst banner (Histo+KDE mode)
  _renderAnalystBanner(_buildAnalystBanner('histo', {
    mostFreqBucket, mean, median,
  }));
}

// Helper: mean ignoring null / NaN
function _meanIgnoreNull(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a,b)=>a+b,0) / v.length : null;
}

// Sanitise an hourly profile. Some historical years have only partial data
// (data import bug → 1h vs 0.25h misalignment, or truncated days). Without
// this fix the chart renders saw-tooth lines or flat-copies the last valid
// value, both visually misleading.
//
// Strategy:
//   • Compute validity ratio overall AND check trailing/leading null run.
//   • If validity >= 80% AND no trailing/leading run > 20% → as-is.
//   • If 40% <= validity AND trailing/leading run ≤ 20% → linearly interpolate
//     internal nulls only (safe: we have anchors on both sides).
//   • Otherwise → return null (renderer drops the series — better than lying).
function _hszSanitiseHourlyProfile(arr) {
  if (!arr || arr.length === 0) return null;
  const n = arr.length;
  const isValid = v => v != null && !isNaN(v);
  const validCount = arr.filter(isValid).length;
  const ratio = validCount / n;
  if (ratio < 0.4) return null;
  // Leading run of nulls
  let leadNull = 0;
  while (leadNull < n && !isValid(arr[leadNull])) leadNull++;
  // Trailing run of nulls
  let trailNull = 0;
  while (trailNull < n && !isValid(arr[n - 1 - trailNull])) trailNull++;
  // If a long contiguous block at start or end is missing → data is broken,
  // not a sparse-sampling case. Drop rather than fabricate.
  const longRunThreshold = Math.floor(n * 0.2); // 20% of the series
  if (leadNull > longRunThreshold || trailNull > longRunThreshold) return null;
  if (ratio >= 0.8) return arr.slice();
  // Internal interpolation only (both sides have anchors)
  const out = arr.slice();
  for (let i = 0; i < n; i++) {
    if (isValid(out[i])) continue;
    let prevI = -1;
    for (let j = i - 1; j >= 0; j--) if (isValid(arr[j])) { prevI = j; break; }
    let nextI = -1;
    for (let j = i + 1; j < n; j++) if (isValid(arr[j])) { nextI = j; break; }
    if (prevI === -1 || nextI === -1) continue; // safety, should not happen here
    const w = (i - prevI) / (nextI - prevI);
    out[i] = arr[prevI] * (1 - w) + arr[nextI] * w;
  }
  return out;
}
if (typeof window !== 'undefined') window._hszSanitiseHourlyProfile = _hszSanitiseHourlyProfile;

// ── Stats helpers shared across multiple chart variants ──
function _percentile(sortedArr, p) {
  // sortedArr must be sorted ascending. p in [0,1].
  if (!sortedArr.length) return null;
  if (p <= 0) return sortedArr[0];
  if (p >= 1) return sortedArr[sortedArr.length - 1];
  const idx = p * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function _boxStats(arr) {
  // Returns {p10, p25, p50, p75, p90, min, max, n} from a numeric array
  const v = arr.filter(x => x != null && !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return {
    n:   v.length,
    p10: _percentile(v, 0.10),
    p25: _percentile(v, 0.25),
    p50: _percentile(v, 0.50),
    p75: _percentile(v, 0.75),
    p90: _percentile(v, 0.90),
    min: v[0],
    max: v[v.length - 1],
  };
}

function _stdDev(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  if (v.length < 2) return null;
  const m = v.reduce((a,b)=>a+b,0) / v.length;
  const variance = v.reduce((a,b)=>a + (b-m)*(b-m), 0) / v.length;
  return Math.sqrt(variance);
}

// Group an array of {d:'YYYY-MM-DD', avg, ...} entries by YYYY-MM key
function _groupByMonth(entries) {
  const m = {};
  entries.forEach(e => {
    const k = e.d.slice(0, 7);
    if (!m[k]) m[k] = [];
    m[k].push(e);
  });
  return m;
}

// Group entries by year
function _groupByYear(entries) {
  const m = {};
  entries.forEach(e => {
    const y = e.d.slice(0, 4);
    if (!m[y]) m[y] = [];
    m[y].push(e);
  });
  return m;
}

// Get the day-of-period index for an entry within a sub-period (used for YoY alignment)
// Returns 0-based index of entry.d within the period [from, to]
function _dayOfPeriod(dateStr, fromStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const f = new Date(fromStr + 'T00:00:00Z');
  return Math.floor((d - f) / 86400000);
}

// Shift date string by N years
function _shiftYearsISO(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y - years}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// Compute period historical min/max envelope by day-of-period.
// Returns {minLine: [...], maxLine: [...], medianLine: [...]} aligned with `currentSeries` length.
// `allHistory` should be entries from years OTHER than the current one.
// Uses P5/P95 by default (not absolute min/max) to avoid extreme outliers
// (e.g. 2022 gas crisis) crushing the Y axis.
function _historicalEnvelope(currentSeries, allHistory) {
  const len = currentSeries.length;
  // For each day-of-period (0..len-1), collect all historical values that fall on same month-day
  const buckets = Array.from({length: len}, () => []);
  currentSeries.forEach((cur, idx) => {
    const mmdd = cur.d.slice(5); // 'MM-DD'
    allHistory.forEach(h => {
      if (h.d.slice(5) === mmdd && h.avg != null) {
        buckets[idx].push(h.avg);
      }
    });
  });
  // Robust band (P5–P95) — typical regime
  const p5Line  = buckets.map(b => {
    if (!b.length) return null;
    if (b.length < 4) return Math.min(...b);
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.05);
  });
  const p95Line = buckets.map(b => {
    if (!b.length) return null;
    if (b.length < 4) return Math.max(...b);
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.95);
  });
  // Full band (P0–P100) — absolute min/max ever observed for this calendar day
  const minLine = buckets.map(b => b.length ? Math.min(...b) : null);
  const maxLine = buckets.map(b => b.length ? Math.max(...b) : null);
  const medianLine = buckets.map(b => {
    if (!b.length) return null;
    const s = [...b].sort((a, b) => a - b);
    return _percentile(s, 0.5);
  });
  // Backwards-compat aliases: maxLine/minLine map to the P5-P95 band by default
  // (consumers that don't read p0/p100 keep the typical-regime behaviour).
  return {
    minLine: p5Line, maxLine: p95Line, medianLine,
    p5Line, p95Line, p0Line: minLine, p100Line: maxLine,
    sampleCount: buckets.map(b => b.length),
  };
}

// hex/rgb color helper: convert "#RRGGBB" to rgba string
function _toRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) {
    return `rgba(20,211,169,${alpha})`;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Zoom plugin config: click-and-drag rectangle zoom (XY), no wheel zoom.
// Reset via double-click on the chart or via dedicated reset button.
// Falls back to {} if chartjs-plugin-zoom is not loaded.
function _zoomConfig(opts = {}) {
  if (typeof window.Chart === 'undefined' || !window.Chart.registry || !window.Chart.registry.plugins.get('zoom')) {
    return {};
  }
  // Same literal ZOOM_CFG (libs.js) as every other chart in the app, so the
  // drag-rectangle colour/opacity/pinch behaviour is identical everywhere —
  // this used to be its own slightly-different copy (0.15 vs 0.08 opacity).
  if (!opts.mode || opts.mode === 'xy') return ZOOM_CFG;
  return Object.assign({}, ZOOM_CFG, { zoom: Object.assign({}, ZOOM_CFG.zoom, { mode: opts.mode }) });
}

// Reusable reset zoom button HTML — pass the JS expression to call.
// Usage: _resetZoomBtn("HIST.charts['hsz-canvas']") or _resetZoomBtn("_rowCharts[0]") etc.
function _resetZoomBtn(chartRefExpr, label) {
  return `<button onclick="event.stopPropagation();(function(){var c=${chartRefExpr};if(c&&c.resetZoom)c.resetZoom();})()" title="Reset zoom to original view"
    style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--tx3);padding:3px 10px;font-size:9px;border-radius:3px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.04em;text-transform:uppercase">↺ ${label || 'Reset'}</button>`;
}

// Generic onClick handler for charts: double-click resets the zoom.
function _dblClickResetZoom(canvasId, chartsObj) {
  return (evt) => {
    if (evt && evt.native && evt.native.detail === 2) {
      const c = chartsObj ? chartsObj[canvasId] : null;
      if (c && typeof c.resetZoom === 'function') c.resetZoom();
    }
  };
}

