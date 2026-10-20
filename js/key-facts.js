// ════════════════════════════════════════════════════════════════════
// KEY FIGURES — the "enriched card" of My Dashboard: a few figures
// computed from a chart's own data, shown above it, with the min and max
// marked on the chart. Works on any line or bar chart of the catalogue.
//   k = { on, series (dataset label), facts: ['last','chg','min','max','mean','win'],
//         rise: 'bad' | 'good' | 'neutral' | 'auto' }
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const FACTS = [['last', 'Latest value'], ['chg', 'Change vs previous point'], ['win', 'Change over the period'], ['min', 'Minimum'], ['max', 'Maximum'], ['mean', 'Average']];
  const DEFAULT = ['last', 'chg', 'min', 'max'];
  const isBand = d => /^_/.test(d.label || '') || (d.fill && typeof d.fill === 'string' && /^[-+]\d/.test(d.fill)) || (d.borderWidth === 0 && d.type !== 'bar');
  // datasets that can carry the key figures
  function candidates(ch) {
    return (ch && ch.data.datasets || []).map((d, i) => ({ d, i })).filter(({ d, i }) => !isBand(d) && !ch.getDatasetMeta(i).hidden && (d.data || []).some(v => num(v) != null));
  }
  function num(v) { if (v == null) return null; if (typeof v === 'number') return isFinite(v) ? v : null; if (typeof v === 'object' && 'y' in v) return num(v.y); if (Array.isArray(v)) return num(v[1]); return null; }
  function unitOf(ch, d) {
    const ax = ch.options.scales && ch.options.scales[d.yAxisID || 'y'];
    return (ax && ax.title && ax.title.display !== false && ax.title.text) || '';
  }
  function compute(ch, k) {
    k = k || {};
    const cs = candidates(ch); if (!cs.length) return null;
    // default series: the chart's main line — solid, then thickest, then the last drawn
    const main = cs.slice().sort((a, b) => ((a.d.borderDash && a.d.borderDash.length) ? 1 : 0) - ((b.d.borderDash && b.d.borderDash.length) ? 1 : 0) || (b.d.borderWidth || 1) - (a.d.borderWidth || 1) || b.i - a.i)[0];
    const c = cs.find(x => x.d.label === k.series) || main, d = c.d, labels = ch.data.labels || [];
    const lab = i => { const l = labels[i]; if (l != null && String(l).trim()) return String(l); try { const t = ch.scales.x && ch.scales.x.getLabelForValue(i); if (t != null && String(t).trim()) return String(t); } catch (_) {} return ''; };
    const pts = (d.data || []).map((v, i) => ({ v: num(v), l: v && typeof v === 'object' && v.x != null ? String(v.x) : lab(i), i })).filter(p => p.v != null);
    if (!pts.length) return null;
    const unit = unitOf(ch, d);
    let rise = k.rise || 'auto';
    if (rise === 'auto') rise = /€|price|eur/i.test(unit + ' ' + d.label) ? 'bad' : 'neutral';
    const last = pts[pts.length - 1], prev = pts[pts.length - 2], first = pts[0];
    const min = pts.reduce((a, b) => b.v < a.v ? b : a), max = pts.reduce((a, b) => b.v > a.v ? b : a);
    const mean = pts.reduce((a, b) => a + b.v, 0) / pts.length;
    return { series: d.label, ds: c.i, unit, rise, color: d.borderColor || d.backgroundColor, last, prev, first, min, max, mean, n: pts.length };
  }
  const fmt = v => { const a = Math.abs(v); return (a >= 1000 ? Math.round(v).toLocaleString('en-GB') : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(a >= 1 ? 2 : 3)); };
  const tone = (dv, rise) => !dv || rise === 'neutral' ? '' : (dv > 0) === (rise === 'good') ? 'good' : 'bad';
  function html(f, k) {
    if (!f) return '';
    const want = (k && k.facts && k.facts.length ? k.facts : DEFAULT), u = f.unit ? `<span class="kf-u">${f.unit.replace(/[<>&]/g, '')}</span>` : '';
    const chip = (dv, base, lbl) => { const t = tone(dv, f.rise); const pct = base ? ` (${(dv / Math.abs(base) * 100 >= 0 ? '+' : '') + (dv / Math.abs(base) * 100).toFixed(1)} %)` : '';
      return `<span class="kf-chip ${t}">${dv > 0 ? '▲' : dv < 0 ? '▼' : '='} ${(dv >= 0 ? '+' : '') + fmt(dv)}${pct}</span><span class="kf-l">${lbl}</span>`; };
    const parts = [];
    if (want.includes('last')) parts.push(`<div class="kf-big"><div class="kf-v">${fmt(f.last.v)}${u}</div><div class="kf-l">${f.series.replace(/[<>&]/g, '')}${f.last.l ? ' · ' + f.last.l : ''}</div>${want.includes('chg') && f.prev ? '<div class="kf-c">' + chip(f.last.v - f.prev.v, f.prev.v, 'vs ' + f.prev.l) + '</div>' : ''}</div>`);
    const tile = (t, v, sub, cls) => `<div class="kf-t ${cls || ''}"><div class="kf-tl">${t}</div><div class="kf-tv">${v}</div><div class="kf-l">${sub}</div></div>`;
    if (want.includes('chg') && !want.includes('last') && f.prev) parts.push(tile('Change', chip(f.last.v - f.prev.v, f.prev.v, ''), 'vs ' + f.prev.l));
    if (want.includes('win')) { const dv = f.last.v - f.first.v; parts.push(tile('Over the period', `<span class="kf-chip ${tone(dv, f.rise)}">${(dv >= 0 ? '+' : '') + fmt(dv)}</span>`, f.first.l + ' → ' + f.last.l)); }
    if (want.includes('min')) parts.push(tile('Minimum', fmt(f.min.v), f.min.l, 'kf-min'));
    if (want.includes('max')) parts.push(tile('Maximum', fmt(f.max.v), f.max.l, 'kf-max'));
    if (want.includes('mean')) parts.push(tile('Average', fmt(f.mean), f.n + ' points'));
    return `<div class="kf">${parts.join('')}</div>`;
  }
  // min and max marked on the chart (annotation plugin)
  function mark(ch, f, k) {
    if (!ch || !f) return;
    const want = (k && k.facts && k.facts.length ? k.facts : DEFAULT);
    // edit the raw config (ch.options is a resolver proxy: writing into it recurses)
    const o = ch.config.options || (ch.config.options = {});
    o.plugins = o.plugins || {};
    const ann = (o.plugins.annotation = o.plugins.annotation || {});
    ann.annotations = ann.annotations || {};
    const yAxis = ch.data.datasets[f.ds].yAxisID || 'y', x = p => (ch.data.labels && ch.data.labels.length ? p.i : p.l);
    const pt = (p, col) => ({ type: 'point', xValue: x(p), yValue: p.v, yScaleID: yAxis, radius: 5, backgroundColor: col, borderColor: '#0F1419', borderWidth: 1.5 });
    if (want.includes('min')) ann.annotations.kfMin = pt(f.min, '#14D3A9'); else delete ann.annotations.kfMin;
    if (want.includes('max')) ann.annotations.kfMax = pt(f.max, '#ED6965'); else delete ann.annotations.kfMax;
    try { ch.update('none'); } catch (_) {}
  }
  // plain-text lines (PowerPoint export)
  function lines(f, k) {
    if (!f) return [];
    const want = (k && k.facts && k.facts.length ? k.facts : DEFAULT), u = f.unit ? ' ' + f.unit : '', out = [];
    if (want.includes('last')) out.push(`${f.series}: ${fmt(f.last.v)}${u} (${f.last.l})`);
    if (want.includes('chg') && f.prev) out.push(`Change vs ${f.prev.l}: ${(f.last.v - f.prev.v >= 0 ? '+' : '') + fmt(f.last.v - f.prev.v)}`);
    if (want.includes('win')) out.push(`Over the period: ${(f.last.v - f.first.v >= 0 ? '+' : '') + fmt(f.last.v - f.first.v)}`);
    if (want.includes('min')) out.push(`Minimum ${fmt(f.min.v)} (${f.min.l})`);
    if (want.includes('max')) out.push(`Maximum ${fmt(f.max.v)} (${f.max.l})`);
    if (want.includes('mean')) out.push(`Average ${fmt(f.mean)}`);
    return out;
  }
  window.PKFacts = { FACTS, DEFAULT, candidates, compute, html, mark, lines };

  const css = document.createElement('style');
  css.textContent = `
  .pkd-body.kf-on { display: flex; flex-direction: column; }
  .pkd-body.kf-on .pkd-canvas { flex: 1; min-height: 0; height: auto; }
  .kf { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 8px; }
  .kf-big { flex: 1 1 180px; min-width: 0; padding: 6px 10px; border-left: 3px solid var(--accent); }
  .kf-v { font: 600 22px 'JetBrains Mono', monospace; color: var(--text); line-height: 1.1; }
  .kf-u { font: 400 11px 'JetBrains Mono', monospace; color: var(--text3); margin-left: 4px; }
  .kf-l { font: 10.5px 'JetBrains Mono', monospace; color: var(--text3); margin-top: 2px; }
  .kf-c { margin-top: 4px; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .kf-chip { font: 600 11px 'JetBrains Mono', monospace; color: var(--text2); }
  .kf-chip.good { color: var(--up); } .kf-chip.bad { color: var(--down); }
  .kf-t { flex: 0 1 130px; min-width: 0; background: #1c242e; border: 1px solid var(--border); border-left: 3px solid var(--kpi-flat); border-radius: 6px; padding: 6px 10px; }
  .kf-t.kf-min { border-left-color: #14D3A9; } .kf-t.kf-max { border-left-color: #ED6965; }
  .kf-tl { font: 600 9.5px 'Outfit', sans-serif; letter-spacing: .1em; text-transform: uppercase; color: var(--text3); }
  .kf-tv { font: 600 15px 'JetBrains Mono', monospace; color: var(--text); margin-top: 2px; }
  `;
  document.head.appendChild(css);
})();
