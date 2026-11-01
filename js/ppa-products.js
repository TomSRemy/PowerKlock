// ════════════════════════════════════════════════════════════════════
// PPA PRICER · CONTRACT PRODUCTS FOR THE SAME PARK (buyer–aggregator side, Tom 1 Nov. 2026)
//   What the producer is paid per MWh = A % × index − B €/MWh.
//   A holds everything tied to the market (capture, profile, cannibalisation, the market risk premium, imbalance, GO);
//   B holds what is kept fixed whatever the market does (the margin and the management fees).
//   Index, fixed only once its product is liquid:
//     fixed price (no index) · Cal (the delivery year's Cal fixed at a chosen date, up to Cal+3) · month (each month's
//     forward fixed when it is quoted, M+1 to M+3) · spot (the hourly day-ahead price × the output of that hour) ·
//     M0 (the CRE monthly reference of the technology, for parks under complément de rémunération).
//   From the published method's numbers (js/tool-ppa.js o): the output's value per MWh at the Cal (genFair), its value
//   on the months' forwards (genProf), the risk premium with the price level (premiumGen) and without it (premNoPrice:
//   once the index is fixed the buyer hedges at that same price, so the level is the producer's until then).
//   A fair = expected market value net of imbalance and GO ÷ expected index; A prudent takes the premium off too.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fr = () => !window.PKI18n || PKI18n.lang !== 'en';
  const n2 = v => v == null || !isFinite(v) ? '–' : (fr() ? (+v).toFixed(2).replace('.', ',') : (+v).toFixed(2));
  const pc = v => v == null || !isFinite(v) ? '–' : (fr() ? (v * 100).toFixed(1).replace('.', ',') : (v * 100).toFixed(1)) + ' %';
  const S = { fees: 0.5 };
  // the park's gap to the M0 (basis risk): contract years drawn month by month from the months the M0 section uses
  // (park price and official M0 of the same month, js/ppa-cr.js), the ratio park ÷ M0 of each drawn year; its mean
  // and its quantile at the risk accepted. Run once per technology and curve (the M0 section loads the hourly files)
  let BASIS = { key: null, v: null };
  async function basis(o, alpha) {
    if (!window.PKPpaCR || !PKPpaCR.run) return null;
    const st = window.PKPpa && PKPpa.state, key = [st && st.tech, st && st.assetName, st && st.stopT, alpha].join('|');
    if (BASIS.key === key) return BASIS.v;
    try { await PKPpaCR.run(); } catch (e) { return null; }
    const L = PKPpaCR.last && PKPpaCR.last(); if (!L || !L.rows || L.rows.length < 12) return null;
    const byM = {}; L.rows.forEach(r => (byM[+r.ym.slice(5, 7)] = byM[+r.ym.slice(5, 7)] || []).push(r));
    if (Object.keys(byM).length < 12) return null;
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, R = [];
    for (let i = 0; i < 4000; i++) { let v = 0, m = 0; Object.values(byM).forEach(a => { const r = a[Math.floor(rnd() * a.length)], e = r.e / (r.eTyp || 1); v += e * r.price; m += e * r.m0; }); R.push(v / m); }
    R.sort((a, b) => a - b);
    const mean = R.reduce((a, b) => a + b, 0) / R.length, q = R[Math.floor(alpha * (R.length - 1))];
    BASIS = { key, v: { mean, q, n: L.rows.length } };
    return BASIS.v;
  }

  async function run() {
    const host = $('pp-prod-body'); if (!host || !window.PKPpa || !PKPpa.last) return;
    const o = PKPpa.last(); if (!o || o.genFair == null || o.genProf == null) { host.innerHTML = ''; return; }
    const B = (o.margin || 0) + S.fees, imb = o.imb || 0, go = o.goW || 0, V = o.genFair;
    const pr = o.premiumGen != null ? o.premiumGen : o.premium, pn = o.premNoPrice != null ? o.premNoPrice : pr;
    // the M0 of each delivery year (national capture of the generator × Cal), weighted as the pricer's years
    const bs = await basis(o, (o.alpha || 25) / 100);
    let m0 = null; try { const M = await PKPpa.m0Years(); const w = M ? M.reduce((a, r) => a + r.w, 0) : 0; if (w > 0) m0 = M.reduce((a, r) => a + r.m0 * r.w, 0) / w; } catch (e) { m0 = null; }
    const rows = [
      { k: 'fixed', idx: null, fair: V - imb + go, prud: V - pr - imb + go,
        name: fr() ? 'Prix fixe' : 'Fixed price', when: fr() ? 'à la signature' : 'at signing', left: fr() ? 'prix, capture, volume' : 'price, capture, volume' },
      { k: 'cal', idx: o.refW, fair: (V - imb + go) / o.refW, prud: (V - pn - imb + go) / o.refW,
        name: fr() ? 'Indexé Cal' : 'Cal-indexed', when: fr() ? 'Cal de l’année fixé à une date choisie, une fois coté (jusqu’à Cal+3)' : 'the year’s Cal fixed at a chosen date, once quoted (up to Cal+3)', left: fr() ? 'capture, profil, volume' : 'capture, profile, volume' },
      { k: 'month', idx: o.genProf, fair: (V - imb + go) / o.genProf, prud: (V - pn - imb + go) / o.genProf,
        name: fr() ? 'Indexé mois' : 'Month-indexed', when: fr() ? 'forward de chaque mois fixé une fois coté (M+1 à M+3)' : 'each month’s forward fixed once quoted (M+1 to M+3)', left: fr() ? 'cannibalisation dans le mois, volume' : 'cannibalisation within the month, volume' },
      { k: 'spot', idx: V, fair: (V - imb + go) / V, prud: (V - imb + go) / V,
        name: fr() ? 'Indexé spot' : 'Spot-indexed', when: fr() ? 'prix day-ahead de chaque heure × production de l’heure' : 'hourly day-ahead price × that hour’s output', left: fr() ? 'écarts' : 'imbalance' },
      // M0: the park earns its ratio to the M0 (mean of the drawn years; prudent = their quantile at the risk accepted)
      ...(m0 ? [{ k: 'm0', idx: m0, fair: (bs ? bs.mean * m0 : V) / m0 - (imb - go) / m0, prud: (bs ? bs.q * m0 : V - pn) / m0 - (imb - go) / m0,
        name: fr() ? 'Indexé M0 (complément de rémunération)' : 'M0-indexed (complément de rémunération)', when: fr() ? 'M0 officiel du mois (CRE)' : 'official monthly M0 (CRE)', left: fr() ? 'écart du parc au M0, écarts' : 'park’s gap to the M0, imbalance' }] : [])];
    const fmt = r => r.k === 'fixed' ? `${n2(r.prud - B)} €/MWh` : `${pc(r.prud)} × ${r.k === 'cal' ? 'Cal' : r.k === 'month' ? (fr() ? 'mois' : 'month') : r.k === 'spot' ? 'spot' : 'M0'} − ${n2(B)} €/MWh`;
    host.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th style="text-align:left">${fr() ? 'Produit' : 'Product'}</th><th style="text-align:left">${fr() ? 'Formule proposée (prudente)' : 'Proposed formula (prudent)'}</th><th>${fr() ? 'A juste' : 'A fair'}</th><th>${fr() ? 'A prudent' : 'A prudent'}</th><th>${fr() ? 'Index attendu €/MWh' : 'Expected index €/MWh'}</th><th style="text-align:left">${fr() ? 'Fixation' : 'Fixing'}</th><th style="text-align:left">${fr() ? 'Reste à ta charge' : 'Left with you'}</th></tr></thead><tbody>${rows.map(r => `<tr><td style="text-align:left">${r.name}</td><td style="text-align:left"><b>${fmt(r)}</b></td><td>${r.k === 'fixed' ? n2(r.fair - B) + ' €' : pc(r.fair)}</td><td>${r.k === 'fixed' ? n2(r.prud - B) + ' €' : pc(r.prud)}</td><td>${r.idx != null ? n2(r.idx) : '–'}</td><td style="text-align:left">${r.when}</td><td style="text-align:left">${r.left}</td></tr>`).join('')}</tbody></table></div>
      <div class="fuel-note">${fr()
        ? `Prix payé au producteur = A × index − B. <b>A</b> porte tout ce qui dépend du marché : la valeur captée de la production (${n2(V)} €/MWh au Cal), les écarts (${n2(imb)}), la GO (${n2(go)}) et, pour le prix prudent, la prime de risque de marché (${n2(pr)} € avec le niveau de prix, ${n2(pn)} € sans : une fois l’index fixé, tu te couvres à ce même prix). <b>B</b> = ta marge (${n2(o.margin || 0)}) + les frais de gestion (${n2(S.fees)}) = ${n2(B)} €/MWh, fixe quel que soit le marché. L’index n’est fixé qu’une fois son produit liquide. Hypothèses : le spot est payé heure par heure (prix day-ahead horaire × production de l’heure : le producteur porte la forme, tu gardes les écarts) ; le M0 attendu vient du générateur (Cal × capture nationale), et le risque de base (le parc contre le M0 officiel) vient de ${bs ? bs.n : '–'} mois réels tirés en années de contrat : ratio moyen ${bs ? pc(bs.mean) : '–'}, ${bs ? pc(bs.q) : '–'} au risque accepté.`
        : `Price paid to the producer = A × index − B. <b>A</b> holds everything tied to the market: the output's captured value (${n2(V)} €/MWh at the Cal), imbalance (${n2(imb)}), GO (${n2(go)}) and, for the prudent price, the market risk premium (${n2(pr)} € with the price level, ${n2(pn)} € without: once the index is fixed you hedge at that same price). <b>B</b> = your margin (${n2(o.margin || 0)}) + management fees (${n2(S.fees)}) = ${n2(B)} €/MWh, fixed whatever the market. The index is fixed only once its product is liquid. Assumptions: spot is paid hour by hour (hourly day-ahead price × that hour's output: the producer carries the shape, you keep imbalance); the expected M0 comes from the generator (Cal × national capture), and the basis risk (the park against the official M0) comes from ${bs ? bs.n : '–'} real months drawn as contract years: mean ratio ${bs ? pc(bs.mean) : '–'}, ${bs ? pc(bs.q) : '–'} at the risk accepted.`}</div>`;
  }
  function bind() { const f = $('pp-prod-fees'); if (f) { f.value = S.fees; f.addEventListener('change', () => { const v = parseFloat(f.value); S.fees = isFinite(v) && v >= 0 ? v : 0.5; run(); }); } }
  document.addEventListener('DOMContentLoaded', bind);
  document.addEventListener('pk-ppa-run', () => setTimeout(() => run().catch(e => console.warn('[ppa] products', e)), 40));
  window.PKPpaProducts = { run, state: S };
})();
