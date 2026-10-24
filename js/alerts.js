// ════════════════════════════════════════════════════════════════════
// ALERTS — negative prices, PP1 / PP2 days, baseload thresholds.
// A bell in the top bar: alerts triggered for today and tomorrow, and the
// user's rules (create, pause, delete). Signed-in users keep their rules in
// Supabase (public.alert_rule, owner-only) and receive e-mails from the
// evaluator (scripts/alerts.py, after each data fetch); without an account
// the rules stay in this browser and alerts show on the site only.
// The on-site check uses the same rules as scripts/alerts.py.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const LS = 'pk-alerts-v1';
  const KINDS = {
    neg_price: { label: 'Negative prices', help: 'At least N hours of negative day-ahead price in one of the zones.' },
    pp1: { label: 'PP1 day (France)', help: 'RTE signals a PP1 peak-period day (the day before, about 09:30).' },
    pp2: { label: 'PP2 day (France)', help: 'RTE signals a PP2 peak-period day (the day before, 09:30 or 19:00).' },
    base_above: { label: 'Baseload above', help: 'Daily baseload above a price.' },
    base_below: { label: 'Baseload below', help: 'Daily baseload below a price.' },
    fwd_fr: { label: 'Cal+1 France: French move', help: 'The part of the day’s French Cal+1 move that gas and CO₂ do not explain (Prices › Forward, analyst read) is above a threshold, up or down.' },
  };
  const esc = PK.esc;   // js/pk-core.js
  const zoneList = () => (typeof ZONES !== 'undefined' ? ZONES : []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const zoneName = c => ((typeof ZONES !== 'undefined' ? ZONES : []).find(z => z.code === c) || {}).name || c;
  const flagOf = c => ((typeof ZONES !== 'undefined' ? ZONES : []).find(z => z.code === c) || {}).flag || '';
  const base = () => (typeof DATA_BASE !== 'undefined' && DATA_BASE ? DATA_BASE : 'data/');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const fmtDay = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

  let rules = [], hits = [], cloud = false;

  // ── storage ──
  const local = { get() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (_) { return []; } },
    set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (_) {} } };
  async function client() {
    const A = window.PKAccount; if (!A || !A.configured) return null;
    await A.ready(); return A.user ? A.client() : null;
  }
  async function loadRules() {
    const c = await client();
    if (c) {
      const { data, error } = await c.from('alert_rule').select('*').order('created_at');
      if (!error) {
        cloud = true;
        // first sign-in on this browser: move the local rules to the account
        const loc = local.get();
        if (loc.length) {
          const ins = loc.map(r => ({ kind: r.kind, zones: r.zones, min_hours: r.min_hours, threshold: r.threshold, email: true, active: r.active !== false }));
          const res = await c.from('alert_rule').insert(ins).select('*');
          if (!res.error) { local.set([]); rules = (data || []).concat(res.data || []); return; }
        }
        rules = data || []; return;
      }
      console.warn('[alerts] cloud rules unavailable', error.message);
    }
    cloud = false; rules = local.get();
  }
  async function addRule(r) {
    const c = cloud && await client();
    if (c) { const { data, error } = await c.from('alert_rule').insert(r).select('*').single(); if (error) throw error; rules.push(data); }
    else { r.id = 'l' + Date.now(); r.active = true; rules.push(r); local.set(rules); }
  }
  async function updateRule(id, patch) {
    const c = cloud && await client();
    if (c) { const { error } = await c.from('alert_rule').update(patch).eq('id', id); if (error) throw error; }
    rules = rules.map(r => r.id === id ? Object.assign({}, r, patch) : r);
    if (!c) local.set(rules);
  }
  async function deleteRule(id) {
    const c = cloud && await client();
    if (c) { const { error } = await c.from('alert_rule').delete().eq('id', id); if (error) throw error; }
    rules = rules.filter(r => r.id !== id);
    if (!c) local.set(rules);
  }

  // ── evaluation (same logic as scripts/alerts.py) ──
  const files = {};
  const getDay = d => files[d] || (files[d] = fetch(base() + 'history/daily/' + d + '.json').then(r => r.ok ? r.json() : null).then(j => j && j.zones || null).catch(() => null));
  let ppP = null;
  const getPP = () => ppP || (ppP = fetch(base() + 'rte_pp.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).then(j => j && j.days || {}).catch(() => ({})));
  function stats(zones, z) {
    const h = zones && zones[z] && zones[z].hourly;
    if (!Array.isArray(h) || !h.length) return null;
    const v = h.filter(x => x != null); if (!v.length || v.every(x => x === 0)) return null;
    const per = h.length / 24, neg = h.map((x, i) => x != null && x < 0 ? i : -1).filter(i => i >= 0);
    const t = i => { const hh = i / per; return String(Math.floor(hh)).padStart(2, '0') + ':' + String(Math.round(hh % 1 * 60)).padStart(2, '0'); };
    return { base: v.reduce((s, x) => s + x, 0) / v.length, min: Math.min(...v), negH: neg.length / per, span: neg.length ? t(neg[0]) + ' and ' + t(neg[neg.length - 1] + 1) : '' };
  }
  async function evaluate() {
    const days = [today(), addDays(today(), 1)];
    const out = [];
    const pp = await getPP();
    for (const d of days) {
      const zones = await getDay(d);
      rules.filter(r => r.active !== false).forEach(r => {
        if (r.kind === 'fwd_fr') return;
        if (r.kind === 'pp1' || r.kind === 'pp2') {
          const e = pp[d]; if (e && e[r.kind]) out.push({ d, z: 'FR', kind: r.kind, text: fmtDay(d) + ' is a ' + r.kind.toUpperCase() + ' day (RTE peak-period signal)' });
          return;
        }
        (r.zones || []).forEach(z => {
          const st = stats(zones, z); if (!st) return;
          if (r.kind === 'neg_price' && st.negH >= (r.min_hours || 1)) out.push({ d, z, kind: r.kind, text: `${st.negH} h of negative prices on ${fmtDay(d)}, between ${st.span}, lowest ${st.min.toFixed(2)} €/MWh` });
          else if (r.kind === 'base_above' && r.threshold != null && st.base > r.threshold) out.push({ d, z, kind: r.kind, text: `baseload ${st.base.toFixed(2)} €/MWh on ${fmtDay(d)}, above ${r.threshold}` });
          else if (r.kind === 'base_below' && r.threshold != null && st.base < r.threshold) out.push({ d, z, kind: r.kind, text: `baseload ${st.base.toFixed(2)} €/MWh on ${fmtDay(d)}, below ${r.threshold}` });
        });
      });
    }
    // Cal+1 France: France-specific part of the latest daily move
    const fr = rules.filter(r => r.active !== false && r.kind === 'fwd_fr' && r.threshold != null);
    if (fr.length && window.PKFwdRead) {
      try {
        const o = await PKFwdRead.compute('1D');
        if (o && o.resid != null && o.Z.d >= addDays(today(), -3)) fr.forEach(r => { if (Math.abs(o.resid) >= r.threshold) out.push({ d: o.Z.d, z: 'FR', kind: 'fwd_fr', text: `Cal ${o.k} ${(o.dP >= 0 ? '+' : '') + o.dP.toFixed(2)} € on ${fmtDay(o.Z.d)}: ${(o.resid >= 0 ? '+' : '') + o.resid.toFixed(2)} € France-specific, gas and CO₂ explain ${(o.fromFuel + o.fromCo2 >= 0 ? '+' : '') + (o.fromFuel + o.fromCo2).toFixed(2)} €` }); });
      } catch (_) { /* forward data unavailable */ }
    }
    // one line per day, zone and kind
    const seen = new Set();
    hits = out.filter(h => { const k = h.d + h.z + h.kind; if (seen.has(k)) return false; seen.add(k); return true; });
    bell();
  }

  // ── top-bar bell ──
  function bell() {
    let b = document.getElementById('pk-alert-bell');
    if (!b) {
      b = document.createElement('button');
      b.id = 'pk-alert-bell'; b.type = 'button'; b.className = 'pk-alert-bell';
      b.title = 'Alerts';
      b.addEventListener('click', open);
      const anchor = document.getElementById('pk-scope-pill') || document.getElementById('pk-status-badge');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor); else document.body.appendChild(b);
    }
    const n = hits.length;
    b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>' + (n ? `<span class="pk-alert-n">${n}</span>` : '');
    b.classList.toggle('on', n > 0);
    b.title = n ? n + ' alert' + (n > 1 ? 's' : '') + ' for today and tomorrow' : 'Alerts';
  }

  // ── panel ──
  function close() { const m = document.getElementById('pk-alert-modal'); if (m) m.remove(); document.removeEventListener('keydown', escClose); }
  function escClose(e) { if (e.key === 'Escape') close(); }
  function ruleText(r) {
    const k = KINDS[r.kind] || { label: r.kind };
    const zs = r.kind === 'pp1' || r.kind === 'pp2' || r.kind === 'fwd_fr' ? 'France' : (r.zones || []).map(z => flagOf(z) + ' ' + z).join(', ');
    const cond = r.kind === 'neg_price' ? ` · ≥ ${r.min_hours || 1} h` : r.kind.startsWith('base_') ? ` · ${r.threshold} €/MWh` : r.kind === 'fwd_fr' ? ` · ±${r.threshold} €/MWh` : '';
    return `<div><b>${esc(k.label)}</b>${cond}</div><span>${esc(zs)}</span>`;
  }
  async function open() {
    close();
    const A = window.PKAccount, signed = !!(A && A.user);
    const bg = document.createElement('div');
    bg.id = 'pk-alert-modal';
    bg.innerHTML = `<div class="pkd-modal pk-al" role="dialog" aria-modal="true">
      <div class="pkd-modal-head"><div><div class="pkd-modal-title">Alerts</div>
        <div class="pkd-modal-sub">${signed ? 'E-mails go to ' + esc(A.user.email) + ' when an alert triggers.' : 'Rules are kept in this browser and shown here. <a href="#" id="pk-al-signin">Sign in</a> to get them by e-mail.'}</div></div>
        <button class="pkd-ic" data-close type="button" title="Close">✕</button></div>
      <div class="pkd-form">
        <div class="pk-al-sec">Today and tomorrow</div>
        <div id="pk-al-hits"></div>
        <div class="pk-al-sec">My alerts</div>
        <div id="pk-al-rules"></div>
        <div class="pk-al-sec">New alert</div>
        <label class="pkd-field"><span>Type</span><select id="pk-al-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <div class="pk-al-help" id="pk-al-help"></div>
        <div id="pk-al-zones-wrap"><div class="pk-al-lbl">Zones</div><div class="pk-al-zones" id="pk-al-zones">${zoneList().map(z => `<label class="pk-al-z"><input type="checkbox" value="${z.code}"${z.code === 'FR' ? ' checked' : ''}><span>${z.flag} ${esc(z.name)}</span></label>`).join('')}</div></div>
        <label class="pkd-field" id="pk-al-hours-wrap"><span>Minimum negative hours</span><input id="pk-al-hours" type="number" min="0.25" step="0.25" value="1"></label>
        <label class="pkd-field" id="pk-al-thr-wrap"><span>Price (€/MWh)</span><input id="pk-al-thr" type="number" step="1" value="150"></label>
        <div class="pkd-msg" id="pk-al-msg" role="status"></div>
        <div class="pkd-form-foot"><button type="button" class="pk-btn-ghost" data-close>Close</button><button type="button" class="pk-btn-primary" id="pk-al-add">Add alert</button></div>
      </div></div>`;
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(bg);
    document.addEventListener('keydown', escClose);
    const $ = s => bg.querySelector(s);
    const si = $('#pk-al-signin'); if (si) si.addEventListener('click', e => { e.preventDefault(); close(); if (typeof window.switchDashboard === 'function') window.switchDashboard('mydash'); setTimeout(() => { const b = document.getElementById('pkd-acc-btn'); if (b) b.click(); }, 400); });
    const sync = () => {
      const k = $('#pk-al-kind').value;
      $('#pk-al-help').textContent = KINDS[k].help + (k.startsWith('pp') ? ' PP data need the RTE account to be connected.' : '');
      $('#pk-al-zones-wrap').style.display = k.startsWith('pp') || k === 'fwd_fr' ? 'none' : '';
      $('#pk-al-hours-wrap').style.display = k === 'neg_price' ? '' : 'none';
      $('#pk-al-thr-wrap').style.display = k.startsWith('base_') || k === 'fwd_fr' ? '' : 'none';
      $('#pk-al-thr-wrap').querySelector('span').textContent = k === 'fwd_fr' ? 'French part of the move above (€/MWh, up or down)' : 'Price (€/MWh)';
      if (k === 'fwd_fr' && +$('#pk-al-thr').value > 20) $('#pk-al-thr').value = 2;
    };
    $('#pk-al-kind').addEventListener('change', sync); sync();
    const drawHits = () => {
      $('#pk-al-hits').innerHTML = hits.length ? hits.map(h => `<div class="pk-al-hit"><span class="pk-al-dot ${h.kind}"></span><div><b>${h.kind.startsWith('pp') ? 'France' : flagOf(h.z) + ' ' + esc(zoneName(h.z))}</b> · ${esc(h.text)}</div></div>`).join('')
        : `<div class="pk-al-empty">${rules.length ? 'Nothing triggered for today and tomorrow.' : 'No alert yet: add one below.'}</div>`;
    };
    const drawRules = () => {
      $('#pk-al-rules').innerHTML = rules.length ? rules.map(r => `<div class="pk-al-rule${r.active === false ? ' off' : ''}" data-id="${esc(r.id)}"><div class="pk-al-rt">${ruleText(r)}</div>
        <button type="button" class="pk-btn-ghost pk-al-tg" title="${r.active === false ? 'Resume' : 'Pause'}">${r.active === false ? 'Resume' : 'Pause'}</button>
        <button type="button" class="pk-btn-ghost pkd-danger pk-al-del" title="Delete">Delete</button></div>`).join('') : '<div class="pk-al-empty">None.</div>';
      bg.querySelectorAll('.pk-al-rule').forEach(row => {
        const id = row.dataset.id, r = rules.find(x => String(x.id) === id);
        row.querySelector('.pk-al-tg').addEventListener('click', async () => { await updateRule(r.id, { active: r.active === false }); await evaluate(); drawRules(); drawHits(); });
        row.querySelector('.pk-al-del').addEventListener('click', async () => { await deleteRule(r.id); await evaluate(); drawRules(); drawHits(); });
      });
    };
    drawHits(); drawRules();
    $('#pk-al-add').addEventListener('click', async () => {
      const k = $('#pk-al-kind').value, msg = $('#pk-al-msg');
      const zones = k.startsWith('pp') || k === 'fwd_fr' ? ['FR'] : Array.from(bg.querySelectorAll('#pk-al-zones input:checked')).map(i => i.value);
      if (!zones.length) { msg.textContent = 'Choose at least one zone.'; return; }
      const r = { kind: k, zones, min_hours: k === 'neg_price' ? +$('#pk-al-hours').value || 1 : null, threshold: k.startsWith('base_') || k === 'fwd_fr' ? +$('#pk-al-thr').value : null, email: true, active: true };
      try { await addRule(r); msg.textContent = 'Alert added' + (cloud ? ': you will get an e-mail when it triggers.' : ' (this browser only).'); await evaluate(); drawRules(); drawHits(); }
      catch (e) { msg.textContent = 'Could not save: ' + (e.message || e); }
    });
  }

  async function boot() {
    await loadRules();
    await evaluate();
    if (window.PKAccount && window.PKAccount.onChange) window.PKAccount.onChange(async () => { await loadRules(); await evaluate(); });
  }
  window.PKAlerts = { open, refresh: async () => { await loadRules(); await evaluate(); } };
  window.addEventListener('load', () => setTimeout(boot, 300));

  const css = document.createElement('style');
  css.textContent = `
  .pk-alert-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:28px;margin-right:8px;border-radius:7px;border:1px solid var(--border2,#243447);background:transparent;color:var(--text3,#7A93AB);cursor:pointer}
  .pk-alert-bell:hover{color:var(--text,#fff)} .pk-alert-bell.on{color:#FBBF24;border-color:rgba(251,191,36,.5)}
  .pk-alert-n{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ED6965;color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center}
  #pk-alert-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,8,12,.62);backdrop-filter:blur(2px)}
  .pk-al{width:min(560px,100%)}
  .pk-al-sec{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-weight:600;margin-top:4px}
  .pk-al-hit{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text2);padding:6px 0;border-bottom:1px solid var(--border)}
  .pk-al-hit b{color:var(--text)}
  .pk-al-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none;background:#60A5FA} .pk-al-dot.pp1,.pk-al-dot.pp2{background:#ED6965} .pk-al-dot.base_above{background:#F97316} .pk-al-dot.base_below{background:#14D3A9} .pk-al-dot.fwd_fr{background:#A78BFA}
  .pk-al-empty{font-size:12px;color:var(--text3)}
  .pk-al-rule{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)}
  .pk-al-rule.off{opacity:.5}
  .pk-al-rt{flex:1;min-width:0;font-size:12.5px;color:var(--text2);display:flex;flex-direction:column}
  .pk-al-rt b{color:var(--text)} .pk-al-rt span{font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pk-al-rule .pk-btn-ghost{font-size:10.5px;padding:4px 8px}
  .pk-al-help{font-size:11.5px;color:var(--text3);margin-top:-6px}
  .pk-al-lbl{font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
  .pk-al-zones{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 10px;max-height:150px;overflow-y:auto;padding:6px;border:1px solid var(--border2);border-radius:6px;background:var(--bg3)}
  .pk-al-z{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);cursor:pointer}
  .pk-al-z input{accent-color:var(--accent)}
  @media (max-width:760px){.pk-alert-bell{margin-right:4px}}
  `;
  document.head.appendChild(css);
})();
