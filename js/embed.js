// ════════════════════════════════════════════════════════════════════
// EMBED — one catalogue chart alone, for other apps (iframe) and for the
// daily PNG export (scripts/render_pngs.py).
//   index.html?embed=<chart id>&<param>=<value>…&title=0&source=0
// The page draws only that chart, full window, with today's data. Every
// chart of the catalogue (☆ on the site) can be embedded; the list is in
// General › API and in data/api.json.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const id = q.get('embed');
  if (!id) return;
  document.documentElement.classList.add('pk-embed-root');
  const css = document.createElement('style');
  css.textContent = `
  body.pk-embed > *:not(#pk-embed) { display: none !important; }
  body.pk-embed { background: var(--bg2, #0F1419); overflow: hidden; }
  #pk-embed { position: fixed; inset: 0; display: flex; flex-direction: column; padding: 14px 16px 10px; box-sizing: border-box; background: var(--bg2, #0F1419); }
  #pk-embed .pke-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  #pk-embed .pke-t { font: 700 13px 'Outfit', sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #fff; }
  #pk-embed .pke-s { font: 11px 'JetBrains Mono', monospace; color: #7A93AB; margin-top: 3px; }
  #pk-embed .pke-src { font: 600 10px 'JetBrains Mono', monospace; color: #B8C9D9; border: 1px solid #2c4054; border-radius: 4px; padding: 3px 8px; white-space: nowrap; text-decoration: none; }
  #pk-embed .pke-body { position: relative; flex: 1; min-height: 0; overflow: auto; }
  #pk-embed .pke-foot { font: 10px 'JetBrains Mono', monospace; color: #4A6280; margin-top: 6px; display: flex; justify-content: space-between; }
  #pk-embed .pke-foot a { color: #14D3A9; text-decoration: none; }
  #pk-embed button { display: none !important; }
  `;
  document.head.appendChild(css);

  window.addEventListener('load', () => setTimeout(async () => {
    document.body.classList.add('pk-embed');
    const w = window.PKW && PKW.get(id);
    const host = document.createElement('div');
    host.id = 'pk-embed';
    document.body.appendChild(host);
    if (!w) { host.innerHTML = '<div class="pke-t">Unknown chart</div><div class="pke-s">' + id.replace(/[<>&"]/g, '') + ' is not in the PowerKlock catalogue (General › API lists them).</div>'; document.body.dataset.embedReady = 'error'; return; }
    const p = {}; (w.params || []).forEach(d => { if (q.has(d.key)) p[d.key] = q.get(d.key); });
    const params = PKW.params(w.id, p);
    const title = q.get('title') === '0' ? '' : (w.titleFn ? w.titleFn(params) : w.title);
    const link = location.origin + location.pathname;
    host.innerHTML = (title ? `<div class="pke-head"><div><div class="pke-t"></div><div class="pke-s"></div></div>${q.get('source') === '0' ? '' : '<span class="pke-src"></span>'}</div>` : '') +
      `<div class="pke-body">${w.kind === 'html' ? '<div id="pke-html"></div>' : '<canvas id="pke-canvas" style="width:100%;height:100%"></canvas>'}</div>` +
      `<div class="pke-foot"><span class="pke-date"></span><a href="${link}" target="_blank" rel="noopener">PowerKlock ↗</a></div>`;
    const set = (sel, t) => { const e = host.querySelector(sel); if (e) e.textContent = t; };
    set('.pke-t', title); set('.pke-src', w.source || '');
    set('.pke-date', new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Paris');
    try {
      if (w.kind === 'html') await w.html(document.getElementById('pke-html'), params);
      else {
        const r = await PKW.draw(w.id, 'pke-canvas', params);
        if (r && r.sub) set('.pke-s', r.sub);
        const c = document.getElementById('pke-canvas'), ch = c && window.Chart && Chart.getChart(c);
        if (ch) { ch.options.animation = false; ch.resize(); }
      }
      // page tools (fullscreen, PNG, ☆) are not part of an embed
      host.querySelectorAll('.pk-tool, .pkw-star, .pk-chart-tools').forEach(e => e.remove());
      document.body.dataset.embedReady = '1';
    } catch (e) { console.warn('[embed]', e); set('.pke-s', 'Chart unavailable: ' + (e.message || e)); document.body.dataset.embedReady = 'error'; }
  }, 300));
})();
