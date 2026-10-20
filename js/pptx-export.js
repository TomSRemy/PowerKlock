// ════════════════════════════════════════════════════════════════════
// EXPORT A DASHBOARD TO POWERPOINT
// One click in My Dashboard: every item of the board, in order —
// sections become divider slides, charts are redrawn off screen at high
// resolution with their title, one-line summary and source, notes become
// text slides. Site palette (dark), 16:9. PptxGenJS is loaded on demand.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  const C = { bg: '0A0E13', bg2: '0F1419', bd: '1E2D3D', acc: '14D3A9', tx: 'FFFFFF', tx2: 'B8C9D9', tx3: '7A93AB' };
  const FONT = 'Arial';
  let libP = null;
  function loadLib() {
    if (window.PptxGenJS) return Promise.resolve();
    if (!libP) libP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = LIB; s.onload = res; s.onerror = () => rej(new Error('PowerPoint library failed to load')); document.head.appendChild(s); });
    return libP;
  }
  const dateFr = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

  // PNG of a chart on the site's card background (charts are transparent)
  function opaque(ch) {
    const src = ch.canvas, c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.fillStyle = '#0F1419'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
    return c.toDataURL('image/png');
  }

  // Draw one catalogue widget off screen → { img (data URL), sub, text }
  async function renderWidget(w, p, title) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1600px;height:780px;background:#0f1419;padding:0;z-index:-1';
    document.body.appendChild(host);
    try {
      if (w.kind === 'html') {
        host.style.height = 'auto';
        const box = document.createElement('div'); box.style.cssText = 'width:1000px;min-height:600px;display:flex;flex-direction:column;padding:16px;color:#fff';
        host.appendChild(box);
        await w.html(box, p);
        await new Promise(r => setTimeout(r, 400));
        const cv = box.querySelector('canvas');
        let img = null;
        if (cv && window.Chart && Chart.getChart(cv)) { const ch = Chart.getChart(cv); ch.options.devicePixelRatio = 2; ch.resize(1000, 380); img = opaque(ch); }
        // text of the card (headings, figures, list items), without the canvas
        const lines = [];
        box.querySelectorAll('.mu-day-t, .mu-day-avg, .mu-day-chg, .mu-day-k > div, .mu-news li, .pkd-kpi, li, .kpi-card').forEach(e => { const t = e.innerText.replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim(); if (t && !lines.includes(t)) lines.push(t); });
        return { img, text: lines.slice(0, 12), sub: '' };
      }
      const cid = 'pkx-' + Math.random().toString(36).slice(2, 9);
      host.innerHTML = `<div style="position:relative;width:1600px;height:780px"><canvas id="${cid}" width="1600" height="780" style="width:1600px;height:780px"></canvas></div>`;
      const res = await PKW.draw(w.id, cid, p);
      const cv = document.getElementById(cid), ch = cv && window.Chart && Chart.getChart(cv);
      if (!ch) return { img: null, sub: res && res.sub || '', text: [] };
      ch.options.devicePixelRatio = 2; ch.options.animation = false;
      ch.resize(1600, 780); ch.update('none');
      await new Promise(r => setTimeout(r, 120));
      return { img: opaque(ch), sub: res && res.sub || '', text: [] };
    } finally {
      host.querySelectorAll('canvas').forEach(c => { const ch = window.Chart && Chart.getChart(c); if (ch) ch.destroy(); });
      host.remove();
    }
  }

  function header(slide, title, sub) {
    slide.background = { color: C.bg };
    slide.addShape('rect', { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: C.acc }, line: { color: C.acc } });
    slide.addText(title, { x: 0.45, y: 0.25, w: 12.4, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: C.tx });
    if (sub) slide.addText(sub, { x: 0.45, y: 0.85, w: 12.4, h: 0.45, fontFace: FONT, fontSize: 12, color: C.tx2 });
  }
  function footer(slide, src, n) {
    slide.addShape('line', { x: 0.45, y: 7.0, w: 12.45, h: 0, line: { color: C.bd, width: 0.75 } });
    slide.addText((src ? 'Source: ' + src + ' · ' : '') + 'PowerKlock', { x: 0.45, y: 7.05, w: 10.5, h: 0.3, fontFace: FONT, fontSize: 9, color: C.tx3 });
    slide.addText(String(n), { x: 12.2, y: 7.05, w: 0.7, h: 0.3, fontFace: FONT, fontSize: 9, color: C.tx3, align: 'right' });
  }

  async function exportBoard(board, opts) {
    opts = opts || {};
    const progress = opts.progress || (() => {});
    await loadLib();
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';   // 13.33 × 7.5 in
    pptx.title = board.name;
    let n = 1;
    // title slide
    const t = pptx.addSlide();
    t.background = { color: C.bg };
    t.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: C.acc }, line: { color: C.acc } });
    t.addText(board.name, { x: 0.9, y: 2.6, w: 11.5, h: 1.0, fontFace: FONT, fontSize: 40, bold: true, color: C.tx });
    t.addText(dateFr(), { x: 0.9, y: 3.6, w: 11.5, h: 0.5, fontFace: FONT, fontSize: 18, color: C.acc });
    t.addText('PowerKlock · European power markets', { x: 0.9, y: 6.6, w: 11.5, h: 0.4, fontFace: FONT, fontSize: 11, color: C.tx3 });
    const items = board.items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let k = 0;
    for (const it of items) {
      k++; progress(k, items.length);
      if (it.t === 's') {
        const s = pptx.addSlide(); n++;
        s.background = { color: C.bg };
        s.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: C.acc }, line: { color: C.acc } });
        s.addText(it.title || 'Section', { x: 0.9, y: 3.0, w: 11.5, h: 1.0, fontFace: FONT, fontSize: 34, bold: true, color: C.tx });
        continue;
      }
      if (it.t === 'n') {
        if (!(it.text || '').trim()) continue;
        const s = pptx.addSlide(); n++;
        header(s, it.title || 'Note', '');
        s.addText(it.text, { x: 0.45, y: 1.4, w: 12.4, h: 5.4, fontFace: FONT, fontSize: 16, color: C.tx2, valign: 'top' });
        footer(s, '', n);
        continue;
      }
      const w = PKW.get(it.wid); if (!w) continue;
      const p = PKW.params(w.id, it.p);
      const title = it.title || (w.titleFn ? w.titleFn(p) : w.title);
      let r;
      try { r = await renderWidget(w, p, title); } catch (e) { console.warn('[pptx]', w.id, e); continue; }
      const s = pptx.addSlide(); n++;
      header(s, title, r.sub);
      if (r.img && r.text.length) {
        s.addText(r.text.map(x => ({ text: x, options: { breakLine: true } })), { x: 0.45, y: 1.45, w: 4.3, h: 5.4, fontFace: FONT, fontSize: 12, color: C.tx2, valign: 'top', paraSpaceAfter: 6 });
        s.addImage({ data: r.img, x: 4.95, y: 1.45, w: 7.95, h: 3.02 });
      } else if (r.img) {
        s.addImage({ data: r.img, x: 0.45, y: 1.45, w: 12.45, h: 5.45 });
      } else if (r.text.length) {
        s.addText(r.text.map(x => ({ text: x, options: { bullet: true, breakLine: true } })), { x: 0.45, y: 1.45, w: 12.4, h: 5.4, fontFace: FONT, fontSize: 14, color: C.tx2, valign: 'top', paraSpaceAfter: 8 });
      } else {
        s.addText('Not available at export time', { x: 0.45, y: 3.2, w: 12.4, h: 0.6, fontFace: FONT, fontSize: 16, color: C.tx3, align: 'center' });
      }
      footer(s, w.source, n);
    }
    const name = board.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pptx';
    await pptx.writeFile({ fileName: name });
    return name;
  }

  window.PKExport = { pptx: exportBoard };
})();
