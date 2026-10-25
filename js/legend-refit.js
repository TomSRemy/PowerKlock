// ════════════════════════════════════════════════════════════════════
// Axes follow the legend, everywhere: hide a series in a legend and a value
// axis that the chart pinned (explicit min / max) refits to the series still
// shown, show it again and the pinned range comes back. Charts on automatic
// axes already do this in Chart.js; pinned ones kept 2022 squashing the rest.
// Opt out per chart with options.plugins.pkLegendRefit = false.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.Chart || !Chart.register) return;
  const isNum = v => typeof v === 'number' && isFinite(v);
  function visVector(ch) {
    return ch.data.datasets.map((_, i) => (ch.isDatasetVisible(i) ? 1 : 0)).join('');
  }
  function snapshot(ch) {
    const axes = {};
    Object.keys(ch.scales || {}).forEach(id => {
      const sc = ch.scales[id], o = ch.options.scales && ch.options.scales[id];
      if (!o || sc.type === 'category' || sc.type === 'time' || sc.type === 'timeseries' || o.stacked) return;
      if (!isNum(o.min) && !isNum(o.max)) return;
      axes[id] = { min: o.min, max: o.max, wrote: null };
    });
    return { vis: visVector(ch), axes };
  }
  function visibleRange(ch, axisId) {
    let lo = Infinity, hi = -Infinity;
    ch.data.datasets.forEach((_, i) => {
      if (!ch.isDatasetVisible(i)) return;
      const m = ch.getDatasetMeta(i);
      if (!m || m.vAxisID !== axisId || !m._parsed) return;
      const ax = m.vScale && m.vScale.axis;
      m._parsed.forEach(p => {
        if (!p) return;
        const vals = [p[ax]];
        if (p._custom && isNum(p._custom.barStart)) vals.push(p._custom.barStart, p._custom.barEnd);
        vals.forEach(v => { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
      });
    });
    return isFinite(lo) ? [lo, hi] : null;
  }
  // Runs after each update (Chart.js has already read the axis options by
  // beforeUpdate): when the pinned range must change, write it and redraw once.
  function refit(ch) {
    const st = ch.$pkRefit;
    if (!st || (ch.options.plugins && ch.options.plugins.pkLegendRefit === false)) return false;
    const changed = visVector(ch) !== st.vis;
    let dirty = false;
    Object.keys(st.axes).forEach(id => {
      const a = st.axes[id], o = ch.options.scales && ch.options.scales[id];
      if (!o) return;
      // The page set a new pinned range itself (preset, new data): adopt it.
      if (a.wrote ? (o.min !== a.wrote[0] || o.max !== a.wrote[1]) : (o.min !== a.min || o.max !== a.max)) {
        a.min = o.min; a.max = o.max; a.wrote = null;
      }
      let lo = a.min, hi = a.max;
      if (changed) {
        const r = visibleRange(ch, id);
        if (!r) return;
        const pad = Math.max((r[1] - r[0]) * 0.05, Math.abs(r[1]) * 0.01, 0.5);
        if (isNum(a.min)) lo = (a.min === 0 && r[0] >= 0) ? 0 : r[0] - pad;   // a zero-based axis stays zero-based
        if (isNum(a.max)) hi = r[1] + pad;
      }
      if (o.min !== lo || o.max !== hi) { o.min = lo; o.max = hi; dirty = true; }
      a.wrote = changed ? [lo, hi] : null;
    });
    return dirty;
  }
  Chart.register({
    id: 'pkLegendRefit',
    afterUpdate(ch) {
      try {
        if (!ch.$pkRefit) { ch.$pkRefit = snapshot(ch); return; }
        if (ch.$pkRefitBusy) return;
        if (refit(ch)) { ch.$pkRefitBusy = true; try { ch.update('none'); } finally { ch.$pkRefitBusy = false; } }
      } catch (_) {}
    },
  });
})();
