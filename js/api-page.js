// ════════════════════════════════════════════════════════════════════
// GENERAL › API — how other applications use PowerKlock
//   1 · data      : documented JSON files (data/api.json)
//   2 · embed     : any catalogue chart in an iframe (index.html?embed=…)
//   3 · images    : PNG of every chart, refreshed twice a day (png branch)
//   4 · dashboard : a whole dashboard of the reader, as a link or an iframe (#solo=…)
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = PK.esc;   // js/pk-core.js
  const SITE = location.origin + location.pathname.replace(/index\.html$/, ''),   // the address the site is served from
        RAW = 'https://raw.githubusercontent.com/TomSRemy/PowerKlock/png/';
  let wired = false;

  function copyBtn(text) { return `<button type="button" class="pk-btn-ghost api-copy" data-copy="${esc(text)}">Copy</button>`; }
  function wireCopies(root) {
    root.querySelectorAll('.api-copy').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.copy, ok = () => { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy'; }, 1600); };
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(ok).catch(() => { const i = document.createElement('textarea'); i.value = t; document.body.appendChild(i); i.select(); try { document.execCommand('copy'); ok(); } catch (_) {} i.remove(); });
    }));
  }

  async function data() {
    const j = await fetch(DATA_BASE + 'api.json').then(r => r.ok ? r.json() : null).catch(() => null);
    const host = $('api-data'); if (!host) return;
    if (!j) { host.innerHTML = '<div class="fuel-note">Index not available.</div>'; return; }
    host.innerHTML = `<div style="overflow-x:auto"><table class="fuel-table api-table"><thead><tr><th style="text-align:left">Dataset</th><th style="text-align:left">Content</th><th style="text-align:left">Refresh</th><th style="text-align:left">Source</th><th></th></tr></thead><tbody>` +
      j.datasets.map(d => `<tr><td style="text-align:left"><b>${esc(d.title)}</b><div class="api-url">${esc(d.url.replace(SITE, ''))}</div></td><td style="text-align:left;white-space:normal">${esc(d.content)}</td><td style="text-align:left">${esc(d.refresh)}</td><td style="text-align:left;white-space:normal">${esc(d.source)}</td>
        <td>${copyBtn(d.url)}${d.example ? ` <a class="pk-btn-ghost" href="${esc(d.example)}" target="_blank" rel="noopener">Example ↗</a>` : d.url.includes('{') ? '' : ` <a class="pk-btn-ghost" href="${esc(d.url)}" target="_blank" rel="noopener">Open ↗</a>`}</td></tr>`).join('') +
      `</tbody></table></div><div class="fuel-note">${esc(j.usage)} Machine-readable index: <a href="${SITE}data/api.json" target="_blank" rel="noopener">data/api.json</a>. Forwards, commodity and GO prices, weather forecasts and news come from third parties and are not part of the API.</div>`;
    wireCopies(host);
  }

  function embedUrl() {
    const id = $('api-chart').value, w = PKW.get(id); if (!w) return '';
    const p = new URLSearchParams({ embed: id });
    (w.params || []).forEach(d => { const e = $('api-p-' + d.key); if (e && e.value !== String((w.defaults || {})[d.key])) p.set(d.key, e.value); });
    if (!$('api-title').checked) p.set('title', '0');
    return SITE + 'index.html?' + p.toString();
  }
  function renderParams() {
    const w = PKW.get($('api-chart').value), host = $('api-params'); if (!w || !host) return;
    host.innerHTML = (w.params || []).map(d => `<label class="cf-field"><span>${esc(d.label)}</span><select id="api-p-${esc(d.key)}">${d.options.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String((w.defaults || {})[d.key]) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`).join('') || '<div class="fuel-note">This chart has no parameter.</div>';
    host.querySelectorAll('select').forEach(s => s.addEventListener('change', update));
    $('api-desc').textContent = w.desc || '';
    update();
  }
  function update() {
    const url = embedUrl(), h = $('api-h').value || 420, id = $('api-chart').value;
    const iframe = `<iframe src="${url}" width="100%" height="${h}" style="border:0;border-radius:8px" loading="lazy" title="PowerKlock"></iframe>`;
    const png = RAW + id + '.png';
    $('api-out').innerHTML = `<div class="api-line"><span>Link</span><code>${esc(url)}</code>${copyBtn(url)}</div><div class="api-line"><span>iframe</span><code>${esc(iframe)}</code>${copyBtn(iframe)}</div><div class="api-line"><span>PNG</span><code>${esc(png)}</code>${copyBtn(png)}</div>`;
    wireCopies($('api-out'));
    const local = url.replace(SITE, location.origin + location.pathname.replace(/index\.html$/, ''));
    $('api-preview').innerHTML = `<iframe src="${esc(local)}" style="width:100%;height:${h}px;border:0;border-radius:8px;background:#0F1419" loading="lazy" title="Preview"></iframe>`;
    const img = $('api-png'); img.innerHTML = `<img src="${esc(png)}" alt="PNG of the chart" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fuel-note',textContent:'Image not generated yet: the workflow Render chart images publishes them twice a day.'}))">`;
  }
  function charts() {
    const sel = $('api-chart'); if (!sel || !window.PKW) return;
    const cats = Object.fromEntries(PKW.CATEGORIES);
    const list = PKW.list().slice().sort((a, b) => (cats[a.category] || '').localeCompare(cats[b.category] || '') || a.title.localeCompare(b.title));
    let html = '', cur = null;
    list.forEach(w => { if (w.category !== cur) { if (cur) html += '</optgroup>'; cur = w.category; html += `<optgroup label="${esc(cats[cur] || cur)}">`; } html += `<option value="${esc(w.id)}">${esc(w.title)}</option>`; });
    sel.innerHTML = html + '</optgroup>';
    sel.value = PKW.get('fr-cal-history') ? 'fr-cal-history' : list[0].id;
    sel.addEventListener('change', renderParams);
    $('api-h').addEventListener('change', update); $('api-title').addEventListener('change', update);
    renderParams();
  }
  // a whole dashboard: the reader's own dashboards, as a link and an iframe of the dashboard alone
  async function dashOut() {
    const id = $('api-dash').value, h = $('api-dash-h').value || 900, out = $('api-dash-out');
    const url = await PKDash.soloLink(id, SITE + 'index.html'); if (!url) { out.innerHTML = ''; return; }
    const iframe = `<iframe src="${url}" width="100%" height="${h}" style="border:0;border-radius:8px" loading="lazy" title="PowerKlock dashboard"></iframe>`;
    out.innerHTML = `<div class="api-line"><span>Link</span><code>${esc(url.slice(0, 90))}…</code>${copyBtn(url)}</div><div class="api-line"><span>iframe</span><code>${esc(iframe.slice(0, 90))}…</code>${copyBtn(iframe)}</div>`;
    wireCopies(out);
  }
  function dashboards() {
    const sel = $('api-dash'); if (!sel || !window.PKDash || !PKDash.boards) return;
    const B = PKDash.boards();
    sel.innerHTML = B.map(b => `<option value="${esc(b.id)}">${esc(b.name)} · ${b.n} chart${b.n > 1 ? 's' : ''}</option>`).join('');
    sel.addEventListener('change', dashOut); $('api-dash-h').addEventListener('change', dashOut);
    if (B.length) dashOut();
  }
  function wire() { if (wired) return; wired = true; data(); charts(); dashboards(); }
  window.addEventListener('load', () => setTimeout(() => {
    PK.onPage('api', wire);
  }, 0));
})();
