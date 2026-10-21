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
//   · template    — or the user's own .potx / .pptx (kept in IndexedDB): the
//                   slides are then created inside it, on its own layouts
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
    host.style.cssText = `position:fixed;left:-30000px;top:0;width:1600px;background:${opt.template ? 'transparent' : T.card};padding:24px;z-index:-1;box-sizing:border-box`;
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
        const cv = await window.html2canvas(host, { backgroundColor: opt.template ? null : T.card, scale: 1.5, logging: false, useCORS: true });
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

  // ── the deck's content, independent of how it is laid out ──
  async function collect(board, opt, progress) {
    const specs = [{ k: 'title', title: board.name, sub: dateEn() }];
    const items = board.items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let k = 0;
    for (const it of items) {
      k++; progress(k, items.length);
      if (it.t === 's') { specs.push({ k: 'section', title: it.title || 'Section' }); continue; }
      if (it.t === 'n') { if ((it.text || '').trim()) specs.push({ k: 'note', title: it.title || 'Note', text: it.text }); continue; }
      const w = PKW.get(it.wid); if (!w) continue;
      const p = PKW.params(w.id, it.p), title = it.title || (w.titleFn ? w.titleFn(p) : w.title);
      let r;
      try { r = await renderCard(w, it, p, opt); } catch (e) { console.warn('[pptx]', w.id, e); continue; }
      specs.push({ k: 'card', title, sub: r.sub, src: w.source, r });
    }
    return specs;
  }
  const fit = (box, ratio) => { let w = box.w, h = box.w / ratio; if (h > box.h) { h = box.h; w = box.h * ratio; } return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }; };
  const fileName = board => board.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pptx';
  function addNative(pptx, s, native, box, T, F) {
    const opts = { x: box.x, y: box.y, w: box.w, h: box.h, showLegend: true, legendPos: 'b', legendFontFace: F, legendFontSize: 10, legendColor: T.tx2,
      catAxisLabelColor: T.tx3, valAxisLabelColor: T.tx3, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valGridLine: { color: T.bd, size: 0.5 }, catGridLine: { style: 'none' },
      lineSize: 2, lineDataSymbol: 'none', barGapWidthPct: 40, catAxisLabelFrequency: Math.max(1, Math.round(native[0].data[0].labels.length / 12)) };
    if (native.length === 1) {
      const g = native[0];
      s.addChart(g.type === 'bar' ? pptx.ChartType.bar : pptx.ChartType.line, g.data, Object.assign(opts, { chartColors: g.colors, barDir: 'col' }));
    } else {
      s.addChart(native.map(g => ({ type: g.type === 'bar' ? pptx.ChartType.bar : pptx.ChartType.line, data: g.data,
        options: { chartColors: g.colors, barDir: 'col', secondaryValAxis: g.secondary, secondaryCatAxis: g.secondary } })),
        Object.assign(opts, { valAxes: [{ showValAxisTitle: false }, { showValAxisTitle: false, valGridLine: { style: 'none' } }], catAxes: [{ catAxisTitle: '' }, { catAxisHidden: true }] }));
    }
  }

  // ── deck in the site's layout (no template) ──
  async function buildPlain(board, specs, opt) {
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
    let n = 0;
    for (const sp of specs) {
      const s = pptx.addSlide(); n++; s.background = { color: T.bg };
      if (sp.k === 'title') {
        bar(s, 0.25); logo(s, true);
        s.addText(sp.title, { x: 0.9, y: 2.6, w: 11.5, h: 1.0, fontFace: F, fontSize: 40, bold: true, color: T.tx });
        s.addText(sp.sub, { x: 0.9, y: 3.6, w: 11.5, h: 0.5, fontFace: F, fontSize: 18, color: ACC });
        s.addText(opt.footer || 'PowerKlock', { x: 0.9, y: 6.6, w: 11.5, h: 0.4, fontFace: F, fontSize: 11, color: T.tx3 });
      } else if (sp.k === 'section') {
        bar(s, 0.25); logo(s);
        s.addText(sp.title, { x: 0.9, y: 3.0, w: 11.5, h: 1.0, fontFace: F, fontSize: 34, bold: true, color: T.tx });
      } else if (sp.k === 'note') {
        bar(s, 0.12); logo(s);
        s.addText(sp.title, { x: 0.45, y: 0.25, w: 11.2, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: T.tx });
        s.addText(sp.text, { x: 0.45, y: 1.2, w: 12.4, h: 5.6, fontFace: F, fontSize: 16, color: T.tx2, valign: 'top' });
        footer(s, '', n);
      } else {
        const r = sp.r;
        bar(s, 0.12); logo(s);
        s.addText(sp.title, { x: 0.45, y: 0.22, w: 11.2, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: T.tx });
        if (sp.sub) s.addText(sp.sub, { x: 0.45, y: 0.8, w: 11.2, h: 0.4, fontFace: F, fontSize: 12, color: T.tx2 });
        const box = { x: 0.45, y: 1.3, w: 12.45, h: 5.55 };
        if (r.native) addNative(pptx, s, r.native, box, T, F);
        else if (r.img) s.addImage(Object.assign({ data: r.img }, fit(box, r.ratio)));   // proportions kept
        else s.addText('Not available at export time', { x: 0.45, y: 3.2, w: 12.4, h: 0.6, fontFace: F, fontSize: 16, color: T.tx3, align: 'center' });
        footer(s, sp.src, n);
      }
    }
    const name = fileName(board);
    await pptx.writeFile({ fileName: name });
    return name;
  }

  // ════ deck built inside the user's own PowerPoint template ════
  // The template's slides are dropped; new slides use its layouts (Title,
  // Section header, Title only, Title and content), so master, logos,
  // fonts and footers are the template's own and can be re-applied later.
  const ZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const NS = { p: 'http://schemas.openxmlformats.org/presentationml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', ct: 'http://schemas.openxmlformats.org/package/2006/content-types', pr: 'http://schemas.openxmlformats.org/package/2006/relationships' };
  const RT = t => 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + t;
  const EMU = 914400;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const parse = s => new DOMParser().parseFromString(s, 'application/xml');
  const ser = d => new XMLSerializer().serializeToString(d);
  const tags = (el, t) => Array.from(el.getElementsByTagName(t));
  const resolve = (base, target) => { if (target.startsWith('/')) return target.slice(1); const parts = base.split('/').slice(0, -1); target.split('/').forEach(x => { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x); }); return parts.join('/'); };
  const relsOf = f => f.replace(/([^/]+)$/, '_rels/$1.rels');

  // placeholders of a layout or master: { type, idx, g: {x,y,w,h} | null }
  function phs(doc) {
    return tags(doc, 'p:sp').map(sp => {
      const ph = tags(sp, 'p:ph')[0]; if (!ph) return null;
      const off = tags(sp, 'a:off')[0], ext = tags(sp, 'a:ext')[0];
      return { type: ph.getAttribute('type'), idx: ph.getAttribute('idx'), g: off && ext ? { x: +off.getAttribute('x'), y: +off.getAttribute('y'), w: +ext.getAttribute('cx'), h: +ext.getAttribute('cy') } : null };
    }).filter(Boolean);
  }
  const kind = t => t === 'title' || t === 'ctrTitle' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? t : t === 'pic' || t === 'chart' || t === 'tbl' || t === 'clipArt' || t === 'media' || t === 'dgm' ? 'other' : 'body';

  async function readTemplate(buf) {
    await load(ZIP, () => window.JSZip);
    const zip = await window.JSZip.loadAsync(buf);
    if (!zip.file('ppt/presentation.xml')) throw new Error('This file is not a PowerPoint presentation or template');
    const pres = parse(await zip.file('ppt/presentation.xml').async('string')), sz = tags(pres, 'p:sldSz')[0];
    const layouts = [], masters = {};
    const files = Object.keys(zip.files).filter(f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f)).sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
    for (const f of files) {
      const d = parse(await zip.file(f).async('string')), rf = zip.file(relsOf(f));
      let master = null;
      if (rf) { const rel = tags(parse(await rf.async('string')), 'Relationship').find(r => /slideMaster$/.test(r.getAttribute('Type'))); if (rel) master = resolve(f, rel.getAttribute('Target')); }
      if (master && !masters[master] && zip.file(master)) masters[master] = phs(parse(await zip.file(master).async('string')));
      const cs = tags(d, 'p:cSld')[0];
      layouts.push({ f, type: d.documentElement.getAttribute('type') || 'cust', name: cs && cs.getAttribute('name') || '', master, ph: phs(d) });
    }
    if (!layouts.length) throw new Error('No slide layouts found in this file');
    return { zip, W: +sz.getAttribute('cx'), H: +sz.getAttribute('cy'), layouts, masters };
  }
  function layoutInfo(t) {
    const want = { title: 'Title', secHead: 'Section header', titleOnly: 'Title only', obj: 'Title and content' };
    return Object.keys(want).filter(k => t.layouts.some(l => l.type === k)).map(k => want[k]);
  }

  async function buildTemplate(board, specs, opt, tplBuf) {
    const t = await readTemplate(tplBuf), zip = t.zip, { W, H } = t, T = THEMES[opt.theme], F = opt.font || 'Arial';
    const pick = (...ty) => ty.map(x => t.layouts.find(l => l.type === x)).find(Boolean) || t.layouts[0];
    const L = { title: pick('title', 'secHead', 'titleOnly', 'obj'), section: pick('secHead', 'title', 'titleOnly'), card: pick('titleOnly', 'obj', 'blank'), note: pick('obj', 'titleOnly') };
    // geometry of a layout placeholder, the master's when the layout does not move it
    const geo = (l, p) => p.g || ((t.masters[l.master] || []).find(m => kind(m.type) === kind(p.type)) || {}).g || null;
    const find = (l, k) => l.ph.find(p => kind(p.type) === k && (k !== 'body' || p.type !== 'subTitle' || l.type === 'title'));
    function contentBox(l, withBody) {
      const b = withBody && find(l, 'body'), gb = b && geo(l, b);
      if (gb && gb.h > H * 0.3) return Object.assign({}, gb);
      const tp = find(l, 'title'), gt = tp && geo(l, tp), gap = H * 0.02;
      const foot = ['dt', 'ftr', 'sldNum'].map(k => { const p = l.ph.find(x => x.type === k) || (t.masters[l.master] || []).find(x => x.type === k); return p && (p.g || geo(l, p)); }).filter(Boolean);
      const bottom = (foot.length ? Math.min(...foot.map(g => g.y)) : H * 0.93) - gap;
      const box = { x: gt ? gt.x : W * 0.05, w: gt ? gt.w : W * 0.9, y: (gt ? gt.y + gt.h : H * 0.15) + gap };
      box.h = bottom - box.y;
      return box.h > H * 0.35 ? box : { x: W * 0.05, w: W * 0.9, y: H * 0.18, h: H * 0.72 };
    }

    // drop the template's own slides (and their notes, sections, custom shows)
    const pres = parse(await zip.file('ppt/presentation.xml').async('string'));
    const prels = parse(await zip.file('ppt/_rels/presentation.xml.rels').async('string'));
    const ct = parse(await zip.file('[Content_Types].xml').async('string'));
    tags(prels, 'Relationship').filter(r => /\/slide$/.test(r.getAttribute('Type'))).forEach(r => r.parentNode.removeChild(r));
    Object.keys(zip.files).filter(f => /^ppt\/(slides|notesSlides)\//.test(f)).forEach(f => zip.remove(f));
    tags(ct, 'Override').filter(o => /^\/ppt\/(slides|notesSlides)\//.test(o.getAttribute('PartName'))).forEach(o => o.parentNode.removeChild(o));
    Array.from(pres.getElementsByTagName('*')).filter(e => e.localName === 'sectionLst' || e.localName === 'custShowLst').forEach(e => e.parentNode && e.parentNode.removeChild(e));
    const old = tags(pres, 'p:sldIdLst')[0]; if (old) old.parentNode.removeChild(old);
    const lst = pres.createElementNS(NS.p, 'p:sldIdLst');
    pres.documentElement.insertBefore(lst, tags(pres, 'p:sldSz')[0]);
    tags(ct, 'Override').forEach(o => { if (o.getAttribute('PartName') === '/ppt/presentation.xml') o.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'); });
    const addDefault = (ext, type) => { if (!tags(ct, 'Default').some(d => d.getAttribute('Extension').toLowerCase() === ext)) { const d = ct.createElementNS(NS.ct, 'Default'); d.setAttribute('Extension', ext); d.setAttribute('ContentType', type); ct.documentElement.insertBefore(d, ct.documentElement.firstChild); } };
    const addOverride = (part, type) => { const o = ct.createElementNS(NS.ct, 'Override'); o.setAttribute('PartName', part); o.setAttribute('ContentType', type); ct.documentElement.appendChild(o); };
    addDefault('png', 'image/png'); addDefault('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // editable charts: drawn by PptxGenJS on a deck of the template's size, then moved in
    const frames = {};
    const natives = specs.filter(s => s.k === 'card' && s.r.native);
    if (natives.length) {
      const px = new window.PptxGenJS();
      px.defineLayout({ name: 'TPL', width: W / EMU, height: H / EMU }); px.layout = 'TPL';
      natives.forEach(sp => { sp.box = contentBox(L.card, false); if (sp.sub) { sp.box.y += H * 0.05; sp.box.h -= H * 0.05; }
        addNative(px, px.addSlide(), sp.r.native, { x: sp.box.x / EMU, y: sp.box.y / EMU, w: sp.box.w / EMU, h: sp.box.h / EMU }, T, F); });
      const hz = await window.JSZip.loadAsync(await px.write({ outputType: 'arraybuffer' }));
      for (let i = 0; i < natives.length; i++) {
        const sf = `ppt/slides/slide${i + 1}.xml`, sx = await hz.file(sf).async('string');
        const rel = tags(parse(await hz.file(relsOf(sf)).async('string')), 'Relationship').find(r => /\/chart$/.test(r.getAttribute('Type')));
        const cf = resolve(sf, rel.getAttribute('Target')), part = `ppt/charts/pkx_chart${i + 1}.xml`;
        zip.file(part, await hz.file(cf).async('uint8array'));
        const crf = hz.file(relsOf(cf));
        if (crf) {
          const crels = parse(await crf.async('string'));
          for (const r of tags(crels, 'Relationship')) {
            const src = resolve(cf, r.getAttribute('Target')), dst = `ppt/embeddings/pkx_sheet${i + 1}.xlsx`;
            if (hz.file(src)) { zip.file(dst, await hz.file(src).async('uint8array')); r.setAttribute('Target', '../embeddings/pkx_sheet' + (i + 1) + '.xlsx'); }
          }
          zip.file(relsOf(part), ser(crels));
        }
        addOverride('/' + part, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml');
        frames[specs.indexOf(natives[i])] = { part, xml: (sx.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/) || [''])[0] };
      }
    }

    // slides
    const para = s => `<a:p><a:r><a:rPr lang="en-GB" dirty="0"/><a:t>${esc(s)}</a:t></a:r></a:p>`;
    const phXml = p => `<p:ph${p.type ? ` type="${p.type}"` : ''}${p.idx != null ? ` idx="${p.idx}"` : ''}/>`;
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i], n = i + 1, l = L[sp.k === 'title' ? 'title' : sp.k], shapes = [], rels = [[`rId1`, RT('slideLayout'), '../slideLayouts/' + l.f.split('/').pop()]];
      let id = 2;
      const ph = (p, body) => shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Placeholder ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phXml(p)}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`);
      const box = (g, body, sz) => shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(g.x)}" y="${Math.round(g.y)}"/><a:ext cx="${Math.round(g.w)}" cy="${Math.round(g.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body.replace(/<a:rPr lang="en-GB" dirty="0"\/>/g, `<a:rPr lang="en-GB" sz="${sz}" dirty="0"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr></a:solidFill></a:rPr>`)}</p:txBody></p:sp>`);
      const title = find(l, 'title'), body = l.ph.find(p => kind(p.type) === 'body');
      if (title) ph(title, para(sp.title));
      if (sp.k === 'title') { if (body) ph(body, para(sp.sub)); }
      else if (sp.k === 'note') { const paras = sp.text.split(/\n/).map(para).join(''); if (body) ph(body, paras); else box(contentBox(l, false), paras, 1600); }
      else if (sp.k === 'card') {
        const r = sp.r, b = sp.box || contentBox(l, false);
        if (!sp.box && sp.sub) { b.y += H * 0.05; b.h -= H * 0.05; }
        if (sp.sub) box({ x: b.x, y: b.y - H * 0.05, w: b.w, h: H * 0.04 }, para(sp.sub), 1200);
        if (frames[i]) {
          rels.push(['rId2', RT('chart'), '../charts/' + frames[i].part.split('/').pop()]);
          shapes.push(frames[i].xml.replace(/r:id="[^"]+"/, 'r:id="rId2"').replace(/<p:cNvPr id="\d+"/, `<p:cNvPr id="${id++}"`));
        } else if (r.img) {
          const media = `ppt/media/pkx_img${n}.png`, g = fit(b, r.ratio);
          zip.file(media, r.img.split(',')[1], { base64: true });
          rels.push(['rId2', RT('image'), '../media/' + media.split('/').pop()]);
          shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="${esc(sp.title)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round(g.x)}" y="${Math.round(g.y)}"/><a:ext cx="${Math.round(g.w)}" cy="${Math.round(g.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
        }
        const ftr = l.ph.find(p => p.type === 'ftr'), foot = [sp.src ? 'Source: ' + sp.src : '', opt.footer || ''].filter(Boolean).join(' · ');
        if (ftr && foot) ph(ftr, para(foot));
      }
      const num = l.ph.find(p => p.type === 'sldNum');
      if (num && sp.k !== 'title' && sp.k !== 'section') ph(num, `<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-GB"/><a:t>${n}</a:t></a:fld></a:p>`);
      const f = `ppt/slides/slide${n}.xml`;
      zip.file(f, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
      zip.file(relsOf(f), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.pr}">${rels.map(([a, b, c]) => `<Relationship Id="${a}" Type="${b}" Target="${c}"/>`).join('')}</Relationships>`);
      addOverride('/' + f, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
      const rel = prels.createElementNS(NS.pr, 'Relationship');
      rel.setAttribute('Id', 'rIdPkx' + n); rel.setAttribute('Type', RT('slide')); rel.setAttribute('Target', 'slides/slide' + n + '.xml');
      prels.documentElement.appendChild(rel);
      const sid = pres.createElementNS(NS.p, 'p:sldId');
      sid.setAttribute('id', String(255 + n)); sid.setAttributeNS(NS.r, 'r:id', 'rIdPkx' + n);
      lst.appendChild(sid);
    }
    zip.file('ppt/presentation.xml', ser(pres));
    zip.file('ppt/_rels/presentation.xml.rels', ser(prels));
    zip.file('[Content_Types].xml', ser(ct));
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
    const name = fileName(board), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return name;
  }

  // the template is kept in this browser (IndexedDB: templates can weigh several MB)
  function idb(op, val) {
    return new Promise(res => {
      try {
        const rq = indexedDB.open('pk-pptx', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onerror = () => res(null);
        rq.onsuccess = () => { try { const tx = rq.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
          const q = op === 'get' ? st.get('template') : op === 'del' ? st.delete('template') : st.put(val, 'template');
          q.onsuccess = () => res(op === 'get' ? q.result || null : true); q.onerror = () => res(null); } catch (_) { res(null); } };
      } catch (_) { res(null); }
    });
  }

  async function exportBoard(board, opt, progress) {
    opt = Object.assign(getOpts(), opt || {});
    progress = progress || (() => {});
    await load(LIB, () => window.PptxGenJS);
    const tpl = opt.useTemplate === false ? null : (opt.templateBuf || (opt.useTemplate ? ((await idb('get')) || {}).buf : null));
    opt.template = !!tpl;
    const specs = await collect(board, opt, progress);
    return tpl ? buildTemplate(board, specs, opt, tpl) : buildPlain(board, specs, opt);
  }

  // ── options window ──
  async function open(board, progress) {
    const o = getOpts();
    let tpl = await idb('get');
    return new Promise((resolve, reject) => {
      const bg = document.createElement('div');
      bg.id = 'pkx-modal';
      bg.innerHTML = `<div class="pkx-box" role="dialog" aria-label="PowerPoint export">
        <div class="pkx-h"><b>Export “${esc(board.name)}” to PowerPoint</b><button type="button" class="pkx-x" aria-label="Close">✕</button></div>
        <div class="pkx-row"><span>Template</span><span class="pkx-tpl"></span><label class="pk-btn-ghost pkx-file">Upload .potx / .pptx<input type="file" accept=".potx,.pptx,application/vnd.openxmlformats-officedocument.presentationml.template,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden></label></div>
        <div class="pkx-row"><span>Charts on</span><label><input type="radio" name="pkx-t" value="dark"${o.theme === 'dark' ? ' checked' : ''}> Dark background</label><label><input type="radio" name="pkx-t" value="light"${o.theme === 'light' ? ' checked' : ''}> White background</label></div>
        <div class="pkx-row"><span>Charts</span><label><input type="radio" name="pkx-c" value="image"${o.charts === 'image' ? ' checked' : ''}> Pictures, exactly as the cards</label><label><input type="radio" name="pkx-c" value="native"${o.charts === 'native' ? ' checked' : ''}> Editable PowerPoint charts when possible</label></div>
        <div class="pkx-brand">
          <div class="pkx-sub">Your brand</div>
          <div class="pkx-row"><span>Logo</span><label class="pk-btn-ghost pkx-lfile">Choose an image<input type="file" accept="image/png,image/jpeg,image/svg+xml" hidden></label><span class="pkx-logo">${o.logo ? '<img src="' + o.logo + '" alt=""><button type="button" class="pkx-rm">remove</button>' : 'none'}</span></div>
          <div class="pkx-row"><span>Accent colour</span><input type="color" class="pkx-acc" value="${esc(o.accent)}"><span>Font</span><select class="pkx-font">${['Arial', 'Calibri', 'Aptos', 'Segoe UI', 'Helvetica'].map(f => `<option${f === o.font ? ' selected' : ''}>${f}</option>`).join('')}</select></div>
        </div>
        <div class="pkx-row"><span>Footer</span><input type="text" class="pkx-foot" maxlength="60" value="${esc(o.footer || '')}"></div>
        <div class="pkx-note"></div>
        <div class="pkx-f"><button type="button" class="pk-btn-ghost pkx-cancel">Cancel</button><button type="button" class="pk-btn-primary pkx-go">Export</button></div></div>`;
      document.body.appendChild(bg);
      const q = s => bg.querySelector(s), close = () => bg.remove();
      let logo = o.logo, useTpl = !!tpl;
      function showTpl() {
        q('.pkx-tpl').innerHTML = tpl ? `<label><input type="checkbox" class="pkx-use"${useTpl ? ' checked' : ''}> <b>${esc(tpl.name)}</b></label> <span class="pkx-dim">${esc((tpl.info || []).join(' · '))}</span> <button type="button" class="pkx-tdel">remove</button>` : '<span class="pkx-dim">none — the site\'s layout is used</span>';
        q('.pkx-file').firstChild.textContent = tpl ? 'Replace' : 'Upload .potx / .pptx';
        q('.pkx-brand').hidden = !!(tpl && useTpl);
        q('.pkx-note').textContent = tpl && useTpl
          ? 'Slides are created in your template, on its own layouts (title, section header, title only): master, logo, fonts and footers are the template\'s, and it can be re-applied in PowerPoint later. Pick the chart background that matches the template. The template stays in this browser.'
          : 'Pictures keep their proportions: resize them by a corner in PowerPoint. Editable charts can be restyled with your PowerPoint theme; cards with bands, maps or tables stay pictures. Settings are kept in this browser.';
      }
      showTpl();
      q('.pkx-file input').addEventListener('change', async e => {
        const f = e.target.files[0]; if (!f) return;
        q('.pkx-tpl').innerHTML = '<span class="pkx-dim">Reading…</span>';
        try {
          const buf = await f.arrayBuffer(), t = await readTemplate(buf.slice(0));
          tpl = { name: f.name, buf, info: [Math.round(t.W / EMU * 100) / 100 + '×' + Math.round(t.H / EMU * 100) / 100 + ' in'].concat(layoutInfo(t)) };
          useTpl = true;
          if (!(await idb('put', tpl))) tpl.info.push('not kept: browser storage unavailable');
        } catch (err) { q('.pkx-tpl').innerHTML = '<span class="pkx-err">' + esc(err.message || err) + '</span>'; e.target.value = ''; return; }
        e.target.value = ''; showTpl();
      });
      q('.pkx-lfile input').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { logo = r.result; q('.pkx-logo').innerHTML = '<img src="' + logo + '" alt="">'; }; r.readAsDataURL(f); });
      bg.addEventListener('change', e => { if (e.target.classList.contains('pkx-use')) { useTpl = e.target.checked; showTpl(); } });
      bg.addEventListener('click', async e => {
        if (e.target === bg || e.target.closest('.pkx-x, .pkx-cancel')) { close(); resolve(null); }
        if (e.target.closest('.pkx-rm')) { logo = null; q('.pkx-logo').textContent = 'none'; }
        if (e.target.closest('.pkx-tdel')) { await idb('del'); tpl = null; useTpl = false; showTpl(); }
      });
      q('.pkx-go').addEventListener('click', async () => {
        const opt = { theme: q('input[name=pkx-t]:checked').value, charts: q('input[name=pkx-c]:checked').value, accent: q('.pkx-acc').value, font: q('.pkx-font').value, footer: q('.pkx-foot').value.trim(), logo };
        saveOpts(opt); close();
        try { resolve(await exportBoard(board, Object.assign({}, opt, { useTemplate: !!(tpl && useTpl), templateBuf: tpl && useTpl ? tpl.buf : null }), progress)); } catch (e) { reject(e); }
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
  .pkx-dim { color: var(--text3); font-size: 11px; } .pkx-err { color: var(--down); font-size: 11.5px; }
  .pkx-tdel { background: none; border: 0; color: var(--text3); font-size: 11px; cursor: pointer; text-decoration: underline; }
  .pkx-tpl { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  .pkx-f { display: flex; justify-content: flex-end; gap: 8px; }
  /* white export: the site's colours turned light inside the off-screen card */
  .pkx-light { --bg: #FFFFFF; --bg2: #FFFFFF; --bg3: #F3F4F6; --text: #111827; --text2: #374151; --text3: #6B7280; --text4: #9CA3AF; --border: #E5E7EB; --border2: #D1D5DB;
    --tx: #111827; --tx2: #374151; --tx3: #6B7280; --bd: #E5E7EB; color: #111827; }
  .pkx-light .kpi-card, .pkx-light .kf-t, .pkx-light .chart-container, .pkx-light .fuel-card { background: #F3F4F6 !important; border-color: #E5E7EB !important; }
  .pkx-light [style*="color:#fff"], .pkx-light [style*="color: #fff"], .pkx-light [style*="color:#FFF"] { color: #111827 !important; }
  .pkx-light table td, .pkx-light table th { color: #374151; border-color: #E5E7EB !important; }
  `;
  document.head.appendChild(css);
  // ── for other pages (e.g. the PPA pricer report): a picture of an element, and a deck from ready specs ──
  async function snap(el) {
    await load(H2C, () => window.html2canvas);
    const cv = await window.html2canvas(el, { backgroundColor: '#0F1419', scale: 1.5, logging: false, useCORS: true, ignoreElements: e => e.matches && e.matches('button, .pkw-star, .pk-tool, .pk-gf-group') });
    return { img: cv.toDataURL('image/png'), ratio: cv.width / cv.height };
  }
  // specs: [{ k: 'section' | 'note' | 'card', title, text, sub, src, r: { img, ratio } }]; the user's export settings, template when one is kept
  async function deck(name, specs, extra) {
    const opt = Object.assign(getOpts(), extra || {});
    await load(LIB, () => window.PptxGenJS);
    const tpl = opt.useTemplate === false ? null : ((await idb('get')) || {}).buf;
    opt.template = !!tpl;
    const board = { name };
    const all = [{ k: 'title', title: name, sub: dateEn() }].concat(specs);
    return tpl ? buildTemplate(board, all, opt, tpl) : buildPlain(board, all, opt);
  }
  window.PKExport = { pptx: exportBoard, open, snap, deck };
})();
