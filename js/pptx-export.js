// ════════════════════════════════════════════════════════════════════
// EXPORT A DASHBOARD TO POWERPOINT
// My Dashboard › ⤓ PowerPoint opens a small options window, then builds the
// deck: a title slide, a divider per section, one slide per card, notes as
// text slides. Options (kept in this browser):
//   · background  — dark (site) or white (charts redrawn in light colours)
//   · charts      — pictures of the cards exactly as on the dashboard (key
//                   figures, tables, mini-dashboards), or editable PowerPoint
//                   charts when a chart is plain lines / bars
//   · brand       — logo, accent colour, font, footer text
// Pictures keep their proportions (and stay locked in PowerPoint).
// PptxGenJS and html2canvas are loaded on demand.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  const H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const KEY = 'pk-pptx-opts';
  const THEMES = {
    dark: { bg: '0A0E13', card: '#0F1419', bd: '1E2D3D', tx: 'FFFFFF', tx2: 'B8C9D9', tx3: '7A93AB' },
    light: { bg: 'FFFFFF', card: '#FFFFFF', bd: 'E5E7EB', tx: '111827', tx2: '374151', tx3: '6B7280' },
  };
  const load = (src, test) => test() ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Library failed to load: ' + src.split('/').pop())); document.head.appendChild(s); });
  const dateEn = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const hex = c => { if (!c || typeof c !== 'string') return null; let m = c.match(/^#([0-9a-f]{6})/i); if (m) return m[1].toUpperCase(); m = c.match(/^#([0-9a-f]{3})$/i); if (m) return m[1].split('').map(x => x + x).join('').toUpperCase();
    m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase() : null; };
  function getOpts() { try { return Object.assign({ theme: 'dark', charts: 'image', accent: '#14D3A9', font: 'Arial', footer: 'PowerKlock', logo: null }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return { theme: 'dark', charts: 'image', accent: '#14D3A9', font: 'Arial', footer: 'PowerKlock', logo: null }; } }
  function saveOpts(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} }

  // ── light theme for a drawn chart: axes, grid, legend and white lines turned dark ──
  function lighten(ch) {
    const o = ch.config.options || {}, dark = '#4B5563';
    Object.values(o.scales || {}).forEach(sc => {
      if (!sc || typeof sc !== 'object') return;
      sc.ticks = Object.assign({}, sc.ticks, { color: dark });
      sc.grid = Object.assign({}, sc.grid, { color: 'rgba(17,24,39,.08)' });
      if (sc.title) sc.title = Object.assign({}, sc.title, { color: dark });
    });
    o.plugins = o.plugins || {};
    if (o.plugins.legend) o.plugins.legend.labels = Object.assign({}, o.plugins.legend.labels, { color: '#374151' });
    const white = c => typeof c === 'string' && (/^#f{3}(f{3})?$/i.test(c) || /^rgba?\(\s*2(4|5)\d,\s*2(4|5)\d,\s*2(4|5)\d/.test(c) || /^#F8FAFC$/i.test(c));
    ch.data.datasets.forEach(d => { if (white(d.borderColor)) d.borderColor = '#111827'; if (white(d.backgroundColor)) d.backgroundColor = '#111827'; if (white(d.pointBackgroundColor)) d.pointBackgroundColor = '#111827'; });
    try { ch.update('none'); } catch (_) {}
  }

  // ── one card drawn off screen, as on the dashboard (key figures included) ──
  async function renderCard(w, it, p, opt) {
    const T = THEMES[opt.theme], host = document.createElement('div');
    host.className = 'pkx-host' + (opt.theme === 'light' ? ' pkx-light' : '');
    host.style.cssText = `position:fixed;left:-30000px;top:0;width:1600px;background:${T.card};padding:24px;z-index:-1;box-sizing:border-box`;
    document.body.appendChild(host);
    const out = { img: null, ratio: null, sub: '', native: null };
    try {
      if (w.kind === 'html') {
        host.style.width = Math.max(900, Math.round(1600 * Math.min(12, (w.size && w.size.w) || 12) / 12)) + 'px';
        host.innerHTML = '<div class="pkx-html" style="min-height:300px"></div>';
        await w.html(host.firstChild, p);
        await new Promise(r => setTimeout(r, 600));
        host.querySelectorAll('canvas').forEach(c => { const ch = window.Chart && Chart.getChart(c); if (ch) { ch.options.animation = false; if (opt.theme === 'light') lighten(ch); } });
      } else {
        const cid = 'pkx-' + Math.random().toString(36).slice(2, 9), kOn = it.k && it.k.on && window.PKFacts;
        host.innerHTML = (kOn ? '<div class="pkx-kf"></div>' : '') + `<div style="position:relative;width:1552px;height:${kOn ? 640 : 760}px"><canvas id="${cid}" style="width:100%;height:100%"></canvas></div>`;
        const res = await PKW.draw(w.id, cid, p);
        out.sub = res && res.sub || '';
        const ch = window.Chart && Chart.getChart(document.getElementById(cid));
        if (ch) {
          ch.options.animation = false;
          if (opt.theme === 'light') lighten(ch);
          if (kOn) { const f = PKFacts.compute(ch, it.k); host.querySelector('.pkx-kf').innerHTML = PKFacts.html(f, it.k); if (f) PKFacts.mark(ch, f, it.k); }
          if (opt.charts === 'native') out.native = nativeChart(ch);
          try { ch.update('none'); } catch (_) {}
        }
        await new Promise(r => setTimeout(r, 150));
      }
      host.querySelectorAll('.pk-tool, .pkw-star, button').forEach(e => e.remove());
      if (!out.native) {
        await load(H2C, () => window.html2canvas);
        const cv = await window.html2canvas(host, { backgroundColor: T.card, scale: 1.5, logging: false, useCORS: true });
        out.img = cv.toDataURL('image/png'); out.ratio = cv.width / cv.height;
      }
    } finally {
      host.querySelectorAll('canvas').forEach(c => { const ch = window.Chart && Chart.getChart(c); if (ch) ch.destroy(); });
      host.remove();
    }
    return out;
  }

  // ── editable PowerPoint chart when the chart is plain lines / bars on categories ──
  function nativeChart(ch) {
    const type = ch.config.type, labels = (ch.data.labels || []).map(String);
    if (!labels.length || !['line', 'bar'].includes(type)) return null;
    const ds = ch.data.datasets.filter((d, i) => !ch.getDatasetMeta(i).hidden && !/^_/.test(d.label || ''));
    if (!ds.length || ds.some(d => (d.data || []).some(v => v != null && typeof v === 'object'))) return null;
    if (ds.some(d => d.fill && d.fill !== 'origin' && d.fill !== true)) return null;   // bands between series: keep the picture
    const groups = {};
    ds.forEach(d => { const t = d.type || type, ax = d.yAxisID || 'y', k = t + '|' + (ax === 'y' ? 'p' : 's'); (groups[k] = groups[k] || []).push(d); });
    const keys = Object.keys(groups); if (keys.length > 2 || new Set(keys.map(k => k.split('|')[1])).size !== keys.length && keys.length > 1) return null;
    return keys.map(k => ({ type: k.split('|')[0], secondary: k.endsWith('|s'),
      data: groups[k].map(d => ({ name: d.label || '', labels, values: (d.data || []).map(v => v == null ? null : +v) })),
      colors: groups[k].map(d => hex(d.borderColor && d.borderWidth !== 0 ? d.borderColor : (Array.isArray(d.backgroundColor) ? d.backgroundColor[0] : d.backgroundColor)) || '7FC8F8') }));
  }

  // ── slides ──
  async function exportBoard(board, opt, progress) {
    opt = Object.assign(getOpts(), opt || {});
    progress = progress || (() => {});
    await load(LIB, () => window.PptxGenJS);
    const T = THEMES[opt.theme], ACC = (hex(opt.accent) || '14D3A9'), F = opt.font || 'Arial';
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';   // 13.33 × 7.5 in
    pptx.title = board.name;
    const logo = (s, big) => { if (opt.logo) s.addImage({ data: opt.logo, x: big ? 10.9 : 11.75, y: big ? 0.5 : 0.25, w: big ? 1.9 : 1.15, h: big ? 0.8 : 0.48, sizing: { type: 'contain', w: big ? 1.9 : 1.15, h: big ? 0.8 : 0.48 } }); };
    const bar = (s, w) => s.addShape('rect', { x: 0, y: 0, w, h: 7.5, fill: { color: ACC }, line: { color: ACC } });
    const footer = (s, src, n) => {
      s.addShape('line', { x: 0.45, y: 7.0, w: 12.45, h: 0, line: { color: T.bd, width: 0.75 } });
      s.addText([src ? 'Source: ' + src : '', opt.footer || ''].filter(Boolean).join(' · '), { x: 0.45, y: 7.05, w: 10.5, h: 0.3, fontFace: F, fontSize: 9, color: T.tx3 });
      s.addText(String(n), { x: 12.2, y: 7.05, w: 0.7, h: 0.3, fontFace: F, fontSize: 9, color: T.tx3, align: 'right' });
    };
    let n = 1;
    const t = pptx.addSlide(); t.background = { color: T.bg }; bar(t, 0.25); logo(t, true);
    t.addText(board.name, { x: 0.9, y: 2.6, w: 11.5, h: 1.0, fontFace: F, fontSize: 40, bold: true, color: T.tx });
    t.addText(dateEn(), { x: 0.9, y: 3.6, w: 11.5, h: 0.5, fontFace: F, fontSize: 18, color: ACC });
    t.addText(opt.footer || 'PowerKlock', { x: 0.9, y: 6.6, w: 11.5, h: 0.4, fontFace: F, fontSize: 11, color: T.tx3 });
    const items = board.items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let k = 0;
    for (const it of items) {
      k++; progress(k, items.length);
      if (it.t === 's') {
        const s = pptx.addSlide(); n++; s.background = { color: T.bg }; bar(s, 0.25); logo(s);
        s.addText(it.title || 'Section', { x: 0.9, y: 3.0, w: 11.5, h: 1.0, fontFace: F, fontSize: 34, bold: true, color: T.tx });
        continue;
      }
      if (it.t === 'n') {
        if (!(it.text || '').trim()) continue;
        const s = pptx.addSlide(); n++; s.background = { color: T.bg }; bar(s, 0.12); logo(s);
        s.addText(it.title || 'Note', { x: 0.45, y: 0.25, w: 11.2, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: T.tx });
        s.addText(it.text, { x: 0.45, y: 1.2, w: 12.4, h: 5.6, fontFace: F, fontSize: 16, color: T.tx2, valign: 'top' });
        footer(s, '', n);
        continue;
      }
      const w = PKW.get(it.wid); if (!w) continue;
      const p = PKW.params(w.id, it.p), title = it.title || (w.titleFn ? w.titleFn(p) : w.title);
      let r;
      try { r = await renderCard(w, it, p, opt); } catch (e) { console.warn('[pptx]', w.id, e); continue; }
      const s = pptx.addSlide(); n++; s.background = { color: T.bg }; bar(s, 0.12); logo(s);
      s.addText(title, { x: 0.45, y: 0.22, w: 11.2, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: T.tx });
      if (r.sub) s.addText(r.sub, { x: 0.45, y: 0.8, w: 11.2, h: 0.4, fontFace: F, fontSize: 12, color: T.tx2 });
      const box = { x: 0.45, y: 1.3, w: 12.45, h: 5.55 };
      if (r.native) {
        const opts = { x: box.x, y: box.y, w: box.w, h: box.h, showLegend: true, legendPos: 'b', legendFontFace: F, legendFontSize: 10, legendColor: T.tx2,
          catAxisLabelColor: T.tx3, valAxisLabelColor: T.tx3, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valGridLine: { color: T.bd, size: 0.5 }, catGridLine: { style: 'none' },
          lineSize: 2, lineDataSymbol: 'none', barGapWidthPct: 40, catAxisLabelFrequency: Math.max(1, Math.round(r.native[0].data[0].labels.length / 12)) };
        if (r.native.length === 1) {
          const g = r.native[0];
          s.addChart(g.type === 'bar' ? pptx.ChartType.bar : pptx.ChartType.line, g.data, Object.assign(opts, { chartColors: g.colors, barDir: 'col' }));
        } else {
          s.addChart(r.native.map(g => ({ type: g.type === 'bar' ? pptx.ChartType.bar : pptx.ChartType.line, data: g.data,
            options: { chartColors: g.colors, barDir: 'col', secondaryValAxis: g.secondary, secondaryCatAxis: g.secondary } })),
            Object.assign(opts, { valAxes: [{ showValAxisTitle: false }, { showValAxisTitle: false, valGridLine: { style: 'none' } }], catAxes: [{ catAxisTitle: '' }, { catAxisHidden: true }] }));
        }
      } else if (r.img) {
        // keep the picture's proportions inside the content area
        let w2 = box.w, h2 = box.w / r.ratio;
        if (h2 > box.h) { h2 = box.h; w2 = box.h * r.ratio; }
        s.addImage({ data: r.img, x: box.x + (box.w - w2) / 2, y: box.y + (box.h - h2) / 2, w: w2, h: h2 });
      } else {
        s.addText('Not available at export time', { x: 0.45, y: 3.2, w: 12.4, h: 0.6, fontFace: F, fontSize: 16, color: T.tx3, align: 'center' });
      }
      footer(s, w.source, n);
    }
    const name = board.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pptx';
    await pptx.writeFile({ fileName: name });
    return name;
  }

  // ── options window ──
  function open(board, progress) {
    return new Promise((resolve, reject) => {
      const o = getOpts(), bg = document.createElement('div');
      bg.id = 'pkx-modal';
      bg.innerHTML = `<div class="pkx-box" role="dialog" aria-label="PowerPoint export">
        <div class="pkx-h"><b>Export “${String(board.name).replace(/[<>&"]/g, '')}” to PowerPoint</b><button type="button" class="pkx-x" aria-label="Close">✕</button></div>
        <div class="pkx-row"><span>Background</span><label><input type="radio" name="pkx-t" value="dark"${o.theme === 'dark' ? ' checked' : ''}> Dark (site)</label><label><input type="radio" name="pkx-t" value="light"${o.theme === 'light' ? ' checked' : ''}> White</label></div>
        <div class="pkx-row"><span>Charts</span><label><input type="radio" name="pkx-c" value="image"${o.charts === 'image' ? ' checked' : ''}> Pictures, exactly as the cards</label><label><input type="radio" name="pkx-c" value="native"${o.charts === 'native' ? ' checked' : ''}> Editable PowerPoint charts when possible</label></div>
        <div class="pkx-sub">Your brand</div>
        <div class="pkx-row"><span>Logo</span><label class="pk-btn-ghost pkx-file">Choose an image<input type="file" accept="image/png,image/jpeg,image/svg+xml" hidden></label><span class="pkx-logo">${o.logo ? '<img src="' + o.logo + '" alt="">' + '<button type="button" class="pkx-rm">remove</button>' : 'none'}</span></div>
        <div class="pkx-row"><span>Accent colour</span><input type="color" class="pkx-acc" value="${o.accent}"><span>Font</span><select class="pkx-font">${['Arial', 'Calibri', 'Aptos', 'Segoe UI', 'Helvetica'].map(f => `<option${f === o.font ? ' selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="pkx-row"><span>Footer</span><input type="text" class="pkx-foot" maxlength="60" value="${(o.footer || '').replace(/"/g, '&quot;')}"></div>
        <div class="pkx-note">Pictures keep their proportions: resize them by a corner in PowerPoint. Editable charts can be restyled with your PowerPoint theme; cards with bands, maps or tables stay pictures. Settings are kept in this browser.</div>
        <div class="pkx-f"><button type="button" class="pk-btn-ghost pkx-cancel">Cancel</button><button type="button" class="pk-btn-primary pkx-go">Export</button></div></div>`;
      document.body.appendChild(bg);
      const q = s => bg.querySelector(s), close = () => bg.remove();
      let logo = o.logo;
      q('.pkx-file input').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { logo = r.result; q('.pkx-logo').innerHTML = '<img src="' + logo + '" alt="">'; }; r.readAsDataURL(f); });
      bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('.pkx-x, .pkx-cancel')) { close(); resolve(null); } if (e.target.closest('.pkx-rm')) { logo = null; q('.pkx-logo').textContent = 'none'; } });
      q('.pkx-go').addEventListener('click', async () => {
        const opt = { theme: q('input[name=pkx-t]:checked').value, charts: q('input[name=pkx-c]:checked').value, accent: q('.pkx-acc').value, font: q('.pkx-font').value, footer: q('.pkx-foot').value.trim(), logo };
        saveOpts(opt); close();
        try { resolve(await exportBoard(board, opt, progress)); } catch (e) { reject(e); }
      });
    });
  }

  const css = document.createElement('style');
  css.textContent = `
  #pkx-modal { position: fixed; inset: 0; z-index: 10060; background: rgba(5,8,12,.6); display: flex; align-items: flex-start; justify-content: center; padding: 10vh 16px 16px; }
  .pkx-box { width: min(560px, 100%); background: var(--bg2); border: 1px solid var(--border2); border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
  .pkx-h { display: flex; justify-content: space-between; align-items: center; color: var(--text); font-size: 14px; }
  .pkx-x { background: none; border: 0; color: var(--text3); cursor: pointer; font-size: 14px; }
  .pkx-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font-size: 12px; color: var(--text2); }
  .pkx-row > span:first-child { width: 96px; font: 600 10px 'Outfit', sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--text3); }
  .pkx-row label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .pkx-row input[type=text], .pkx-row select { background: var(--bg3); border: 1px solid var(--border2); border-radius: 5px; color: var(--text); padding: 5px 8px; font-size: 12px; }
  .pkx-row input[type=text] { flex: 1; min-width: 0; }
  .pkx-acc { width: 44px; height: 28px; border: 0; background: none; padding: 0; }
  .pkx-sub { font: 700 10.5px 'Outfit', sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); margin-top: 4px; }
  .pkx-logo img { height: 28px; max-width: 120px; object-fit: contain; vertical-align: middle; background: #fff; border-radius: 3px; padding: 2px; }
  .pkx-rm { background: none; border: 0; color: var(--text3); font-size: 11px; cursor: pointer; text-decoration: underline; margin-left: 6px; }
  .pkx-note { font-size: 11px; color: var(--text3); line-height: 1.5; }
  .pkx-f { display: flex; justify-content: flex-end; gap: 8px; }
  /* white export: the site's colours turned light inside the off-screen card */
  .pkx-light { --bg: #FFFFFF; --bg2: #FFFFFF; --bg3: #F3F4F6; --text: #111827; --text2: #374151; --text3: #6B7280; --text4: #9CA3AF; --border: #E5E7EB; --border2: #D1D5DB;
    --tx: #111827; --tx2: #374151; --tx3: #6B7280; --bd: #E5E7EB; color: #111827; }
  .pkx-light .kpi-card, .pkx-light .kf-t, .pkx-light .chart-container, .pkx-light .fuel-card { background: #F3F4F6 !important; border-color: #E5E7EB !important; }
  .pkx-light [style*="color:#fff"], .pkx-light [style*="color: #fff"], .pkx-light [style*="color:#FFF"] { color: #111827 !important; }
  .pkx-light table td, .pkx-light table th { color: #374151; border-color: #E5E7EB !important; }
  `;
  document.head.appendChild(css);
  window.PKExport = { pptx: exportBoard, open };
})();
