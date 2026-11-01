#!/usr/bin/env python3
"""
audit_site.py : audit automatique (sans IA) d'un site / SPA.
Navigue sur chaque page/onglet, mesure les styles réels et produit :
  audit_out/rapport.md   (actions classées)
  audit_out/data.json    (toutes les mesures brutes)
  audit_out/shots/*.png  (captures d'écran)

Installation (une fois) :
  pip install playwright
  playwright install chromium   (repli automatique sur Google Chrome s'il est installé)
Lancement :
  python scripts/audit_site.py                       (serveur local http://127.0.0.1:8811/index.html, français)
  python scripts/audit_site.py --url https://tomsremy.github.io/PowerKlock/ --lang en

Calibrage PowerKlock (2026-10-31) :
  · la navigation est une SPA à adresses (#markets/spot/negative) : le niveau 1 est la liste des adresses du menu
    (PKNav.entries()), ouverte par PKNav.go(route) ; le clic sur le texte d'un lien échoue (groupes repliés, libellés
    traduits) ;
  · le niveau 2 est la barre d'onglets de vue de la page (.tabs-nav .tab-btn, views.js) et les tableaux de bord
    (.pkd-tab) ; les onglets qui ouvrent une vue déjà mesurée (même page, même onglet) ne sont pas mesurés deux fois ;
  · tuiles = .kpi-card, .chart-container, .news-card… (le sélecteur générique [class*=box] attrapait les conteneurs) ;
  · les mesures de texte portent sur la page active (main .page.active), pas sur le menu commun à toutes les pages ;
  · le bouton "↺ Annuler le zoom" n'apparaît qu'une fois le graphique zoomé (js/zoom-reset.js, global) : un
    graphique est conforme s'il a le zoom rectangle activé ;
  · une passe de largeur (1024, 1180, 1280 px) vérifie l'absence de scroll horizontal sur chaque vue.
"""
import argparse
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from playwright.sync_api import sync_playwright

# ----------------------------- CONFIG -----------------------------
BASE_URL = "http://127.0.0.1:8811/index.html"

# Niveau 1 : adresses du menu (PKNav.entries()), cf. js/nav-v2.js. Repli générique si PKNav absent.
NAV_ROUTES_JS = "() => window.PKNav ? [...new Map(PKNav.entries().map(e => [e.route, e])).values()] : []"
NAV_SELECTORS = ".sidebar a, .sidebar button"
# Niveau 2 : onglets de vue de la page active, et tableaux de bord
SUBNAV_SELECTORS = "main .page.active .tabs-nav .tab-btn, #page-mydash.active .pkd-tab:not(.pkd-tab-new):not(.pkd-tab-add)"
# page active (prix : le sous-domaine affiché), pour les mesures de texte et de structure
ROOT_SELECTOR = "main .page.active"

TILE_SELECTOR = (".kpi-card, .chart-container, .news-card, .mrn2-tile, .pp-mcard, .bl-blk, .bl-k, .ma-kpi-card, "
                 ".fc-map-card, .mrn-cfcard, .pkd-item, .hist-stat")
CHART_SELECTOR = "canvas"
TABLE_SELECTOR = "table"
CHART_TITLE = ".table-title, .hist-section-title, .pkd-title, .bl-t, .mu-day-t, .ma-lbl, h3, h4"

VIEWPORTS = {"desktop": (1440, 900), "mobile": (390, 844)}
EXTRA_WIDTHS = (1024, 1180, 1280)
EXTRA_VIEWS = [("zone France (tableau de bord)", "switchDashboard('france', document.querySelector('.nav-tab[data-dash=france]'))")]
WAIT_AFTER_CLICK_MS = 2200
MAX_PAGES = 200
MIN_TEXT_CHARS = 250       # en dessous : page "vide"
MIN_FONT_PX = 11           # en dessous : texte difficile à lire
MIN_CONTRAST = 4.5
BAD_TEXT = re.compile(r"\b(NaN|undefined|null|Infinity|\[object Object\])\b|(?<![\w-])--(?![\w-])")

OUT = Path("audit_out")
SHOTS = OUT / "shots"

# ----------------------------- JS INJECTÉ -----------------------------
JS_DISCOVER = """
(sel) => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll(sel).forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const label = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g,' ');
    if (!label || label.length > 40) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    el.setAttribute('data-audit-id', 'a' + i);
    out.push({label, id: 'a' + i, href: el.getAttribute('href') || '', visible: r.width > 0 && r.height > 0});
  });
  return out;
}
"""

JS_ANALYSE = r"""
(cfg) => {
  const px = v => parseFloat(v) || 0;
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05; };
  const parseRGBA = c => { const m = c.match(/[\d.]+/g); if (!m) return null;
    return {r:+m[0], g:+m[1], b:+m[2], a: m[3] !== undefined ? +m[3] : 1}; };
  const lum = ({r,g,b}) => { const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const bgOf = el => { let e = el; while (e) { const c = parseRGBA(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return c; e = e.parentElement; } return {r:255,g:255,b:255,a:1}; };
  const contrast = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); };
  const cssPath = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0,2).join('.');
    return s; };

  const res = {};
  const body = (cfg.root && document.querySelector(cfg.root)) || document.body;
  const text = (body.innerText || '').trim();
  res.collapsed = body.querySelectorAll('.hist-section.collapsed').length;
  res.sections = body.querySelectorAll('.hist-section').length;
  res.noDataMsgs = [...body.querySelectorAll('.no-data-msg, .pkd-empty-w')].filter(vis).map(e => (e.innerText||'').trim().slice(0,60));
  res.textLength = text.length;
  res.title = document.title;
  res.badText = [];
  const bt = new RegExp(cfg.badText, 'g');
  (text.match(bt) || []).slice(0, 10).forEach(t => res.badText.push(t));
  res.scrollW = document.documentElement.scrollWidth; res.clientW = document.documentElement.clientWidth;
  { const mm = document.querySelector('main.main'); if (mm && mm.scrollWidth > mm.clientWidth + 4) { res.scrollW = Math.max(res.scrollW, res.clientW + mm.scrollWidth - mm.clientWidth); } }
  res.scrollH = document.documentElement.scrollHeight; res.clientH = document.documentElement.clientHeight;

  // Titres
  res.headings = [...body.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(h => ({
    tag: h.tagName, text: (h.innerText||'').trim().slice(0,60),
    size: px(getComputedStyle(h).fontSize), weight: getComputedStyle(h).fontWeight,
    color: getComputedStyle(h).color, family: getComputedStyle(h).fontFamily.split(',')[0].replace(/["']/g,'')
  }));

  // Polices, tailles, couleurs de texte
  const fonts = {}, sizes = {}, colors = {}, lowC = [], small = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n; let count = 0;
  while ((n = walker.nextNode()) && count < 6000) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || !vis(el)) continue;
    count++;
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g,'').trim();
    fonts[fam] = (fonts[fam]||0) + t.length;
    const sz = px(cs.fontSize); sizes[sz] = (sizes[sz]||0) + t.length;
    colors[cs.color] = (colors[cs.color]||0) + t.length;
    const fg = parseRGBA(cs.color), bg = bgOf(el);
    if (fg) { const c = contrast({...fg}, bg);
      if (c < cfg.minContrast && t.length > 1) lowC.push({el: cssPath(el), text: t.slice(0,40), ratio: +c.toFixed(2), color: cs.color}); }
    if (sz < cfg.minFont && t.length > 2) small.push({el: cssPath(el), text: t.slice(0,40), size: sz});
  }
  res.fonts = fonts; res.sizes = sizes; res.colors = colors;
  res.lowContrast = lowC.slice(0, 25); res.lowContrastCount = lowC.length;
  res.smallText = small.slice(0, 25); res.smallTextCount = small.length;

  // Tuiles
  const tiles = [...body.querySelectorAll(cfg.tile)].filter(vis).filter(el => {
    const r = el.getBoundingClientRect(); if (r.width <= 60 || r.height <= 30) return false;
    if (r.width >= window.innerWidth * 0.98 && el.querySelector(cfg.tile)) return false;  // simple conteneur pleine largeur
    return true; });
  // garder les plus externes seulement
  const tileSet = new Set(tiles);
  const outer = tiles.filter(el => { let p = el.parentElement; while (p) { if (tileSet.has(p)) return false; p = p.parentElement; } return true; });
  res.tiles = outer.slice(0, 80).map(el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { el: cssPath(el), w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderRadius, padding: cs.padding, bg: cs.backgroundColor,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, shadow: cs.boxShadow === 'none' ? 'none' : 'yes',
      empty: (el.innerText||'').trim().length < 2 && !el.querySelector('canvas,svg,img'), text: (el.innerText||'').trim().slice(0,30) }; });

  // Graphiques
  const charts = [];
  body.querySelectorAll(cfg.chart).forEach(cv => {
    if (!vis(cv)) return;
    const r = cv.getBoundingClientRect();
    const info = { w: Math.round(r.width), h: Math.round(r.height), el: cssPath(cv), blank: null, chartjs: null, hasReset: false, title: '' };
    try { const ctx = cv.getContext('2d'); const d = ctx.getImageData(0,0,cv.width,cv.height).data; let nz = 0;
      for (let i = 3; i < d.length; i += 40) if (d[i] > 0) nz++; info.blank = nz / (d.length/40) < 0.003; } catch(e) {}
    try { if (window.Chart) { const c = Chart.getChart ? Chart.getChart(cv) : null;
      if (c) { const o = c.options || {}; const sc = o.scales || {}; const ax = Object.values(sc)[0] || {};
        info.chartjs = { type: c.config.type, legend: o.plugins && o.plugins.legend ? (o.plugins.legend.display !== false ? (o.plugins.legend.position||'top') : 'off') : 'default',
          tension: (c.data.datasets[0]||{}).tension, borderWidth: (c.data.datasets[0]||{}).borderWidth, pointRadius: (c.data.datasets[0]||{}).pointRadius,
          gridColor: ax.grid ? ax.grid.color : null, tickFont: ax.ticks && ax.ticks.font ? ax.ticks.font.size : null,
          tickColor: ax.ticks ? (ax.ticks.color||null) : null, datasets: c.data.datasets.length, points: (c.data.datasets[0]&&c.data.datasets[0].data||[]).length,
          fontFamily: (window.Chart.defaults && window.Chart.defaults.font) ? window.Chart.defaults.font.family : null,
          hasZoom: !!(o.plugins && o.plugins.zoom) }; } } } catch(e) {}
    try { const c3 = (window.Chart && Chart.getChart) ? Chart.getChart(cv) : null;
      if (c3) { const nums = c3.data.datasets.map(d => (d.data || []).filter(v => v !== null && v !== undefined && !(typeof v === 'number' && isNaN(v))).length);
        info.noData = nums.length === 0 || nums.every(n => n === 0);
        info.seriesColors = c3.data.datasets.map(d => ({label: String(d.label || ''), color: String(Array.isArray(d.borderColor) ? d.borderColor[0] : (d.borderColor || (Array.isArray(d.backgroundColor) ? d.backgroundColor[0] : d.backgroundColor) || ''))}));
        const sc2 = c3.options.scales || {}; const axes = Object.values(sc2);
        info.axisTitles = axes.filter(a => a && a.display !== false).map(a => !!(a.title && a.title.display && a.title.text));
        info.axisHasTitle = axes.length ? axes.some(a => a && a.title && a.title.display && a.title.text) : false; } } catch(e) {}
    info.aria = !!(cv.getAttribute('aria-label') || cv.getAttribute('role') === 'img' || (cv.closest('figure') && cv.closest('figure').querySelector('figcaption')));
    info.lowContrastSeries = [];
    try { const c2 = (window.Chart && Chart.getChart) ? Chart.getChart(cv) : null;
      if (c2) { const bgc = bgOf(cv); const tmp = document.createElement('canvas').getContext('2d');
        c2.data.datasets.forEach((ds, i) => { let col = ds.borderColor || ds.backgroundColor; if (Array.isArray(col)) col = col[0]; if (typeof col !== 'string') return;
          tmp.fillStyle = '#000'; tmp.fillStyle = col; const rgb = parseRGBA(tmp.fillStyle.startsWith('#') ?
            'rgb(' + [1,3,5].map(k => parseInt(tmp.fillStyle.slice(k,k+2),16)).join(',') + ')' : tmp.fillStyle);
          if (rgb && contrast(rgb, bgc) < 3) info.lowContrastSeries.push((ds.label || ('serie ' + i)) + ' ' + col); }); } } catch(e) {}
    let p = cv.parentElement, depth = 0;
    while (p && depth < 4) { if ([...p.querySelectorAll('button')].some(b => /↺|reset/i.test(b.innerText||b.title||''))) { info.hasReset = true; break; } p = p.parentElement; depth++; }
    // PowerKlock : le bouton ↺ n'apparaît qu'une fois zoomé (js/zoom-reset.js) ; conforme si le zoom rectangle est actif
    try { const cz = Chart.getChart(cv); const z = cz && cz.options.plugins && cz.options.plugins.zoom;
      info.dragZoom = !!(z && z.zoom && ((z.zoom.drag && z.zoom.drag.enabled) || (z.zoom.wheel && z.zoom.wheel.enabled)));
      if (info.dragZoom && Chart.registry && Chart.registry.plugins.get('pkZoomReset')) info.hasReset = true; } catch(e) {}
    const card = cv.closest('.ma-panel-row, .mu-day, .bl-blk') || cv.closest(cfg.tile) || cv.closest('.hist-section');
    if (card) { const h = card.querySelector(cfg.chartTitle); if (h) info.title = (h.innerText||'').trim().slice(0,50);
      info.source = !!card.querySelector('.source-badge, .chart-source, .pk-src, .bl-src, [class*=source]') || /source/i.test(card.innerText || ''); }
    info.noDataMsg = !!(cv.parentElement && cv.parentElement.querySelector('.no-data-msg'));
    charts.push(info);
  });
  res.charts = charts;

  // Tableaux
  res.tables = [...body.querySelectorAll(cfg.table)].filter(vis).map(t => {
    const th = t.querySelector('th'), td = t.querySelector('td'); const tcs = td ? getComputedStyle(td) : null, hcs = th ? getComputedStyle(th) : null;
    return { rows: t.rows.length, cols: t.rows[0] ? t.rows[0].cells.length : 0, font: tcs ? px(tcs.fontSize) : null, tdPad: tcs ? tcs.padding : null,
      thPad: hcs ? hcs.padding : null, thColor: hcs ? hcs.color : null, thWeight: hcs ? hcs.fontWeight : null, el: cssPath(t) }; });

  // Boutons / contrôles
  const btns = [...body.querySelectorAll('button, [role=button], a.btn, .btn')].filter(vis);
  const bstyles = {};
  btns.forEach(b => { const cs = getComputedStyle(b); const k = [cs.borderRadius, cs.padding, px(cs.fontSize)].join(' | '); bstyles[k] = (bstyles[k]||0) + 1; });
  res.buttonStyles = bstyles; res.buttonCount = btns.length;
  res.tinyClickTargets = btns.filter(b => { const r = b.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).length;

  // Images cassées, liens vides
  res.brokenImages = [...body.querySelectorAll('img')].filter(i => vis(i) && (!i.complete || i.naturalWidth === 0)).map(i => i.src.slice(0,100));
  res.emptyLinks = [...body.querySelectorAll('a')].filter(a => { const h = a.getAttribute('href'); return !h || h === '#'; }).length;

  // Éléments débordants
  res.overflowing = [...document.querySelectorAll('body *')].filter(el => { if (!vis(el)) return false; const r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 4 && getComputedStyle(el).position !== 'fixed'; }).slice(0, 8).map(cssPath);

  // Contenu sous la ligne de flottaison
  // gabarit : blocs de premier niveau de la page, en traversant les enveloppes (onglets de vue, sous-domaines)
  const WRAP = /(^|\s)(subdomain-panel|tab-panel|pk-views-panel|pk-view|tabs-content|page-body)(\s|$)/;
  const flat = el => [...el.children].filter(vis).flatMap(c => (WRAP.test(c.className || '') || (!c.className && c.tagName === 'DIV' && c.children.length > 1)) ? flat(c) : [c]);
  const sig = [];
  flat(body).forEach(c => { const cn = typeof c.className === 'string' ? c.className : ''; const cl = cn.trim().split(/\s+/)[0] || '';
    let kind = 'DIV';
    if (/pr-tabs-sticky|pr-tabs-bar|pk-tabbar/.test(cn)) kind = 'BAR';
    else if (/tabs-nav|pk-views-nav/.test(cn)) kind = 'TABS';
    else if (/hist-section/.test(cn)) { const k = [];
      if (c.querySelector('.kpi-card, .kpi-strip, .hist-stat')) k.push('kpi'); if (c.querySelector(cfg.chart)) k.push('chart');
      if (c.querySelector(cfg.table)) k.push('table'); kind = 'SECTION(' + (k.join('+') || 'text') + ')'; }
    else if (c.querySelector(cfg.chart)) kind = 'CHART'; else if (c.querySelector(cfg.table)) kind = 'TABLE';
    else if (/kpi|stat|metric/i.test(cn)) kind = 'KPI';
    else if (c.querySelector('select, input')) kind = 'FILTERS'; else if (/^H[1-6]$/.test(c.tagName)) kind = 'HEAD';
    sig.push(kind + (cl ? ':' + cl : '')); });
  res.structure = sig.slice(0, 20);
  res.hiddenCount = [...body.querySelectorAll('*')].filter(el => getComputedStyle(el).display === 'none' && el.children.length > 2 && !/script|style|template/i.test(el.tagName)).length;
  res.interactiveCount = body.querySelectorAll('button, a, select, input').length;

  // Langue : html lang + segments de texte visibles (libellés, titres, boutons, paragraphes)
  res.htmlLang = document.documentElement.lang || '';
  const segs = []; const w2 = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); let m2;
  while ((m2 = w2.nextNode()) && segs.length < 500) {
    const t = m2.textContent.trim().replace(/\s+/g, ' ');
    if (t.length < 4 || !/[a-zA-ZÀ-ÿ]{3,}/.test(t)) continue;
    const el = m2.parentElement; if (!el || !vis(el) || /SCRIPT|STYLE/.test(el.tagName)) continue;
    segs.push({t: t.slice(0, 120), el: cssPath(el)});
  }
  res.segments = segs;
  res.hasUpdateDate = /(mis à jour|maj|actualis|updated|last update|dernière|as of|au \d{1,2}[\/.-]\d{1,2}|\d{4}-\d{2}-\d{2})/i.test(text);
  res.hasSource = /(source|entso-?e|rte|eex|epex|commerg|ember)/i.test(text);
  const noLab = [...body.querySelectorAll('button, [role=button], a, select, input')].filter(el => vis(el) &&
    !(el.innerText||'').trim() && !el.getAttribute('aria-label') && !el.title && !el.labels?.length);
  res.focusableNoLabel = noLab.length;
  res.noLabelEls = noLab.slice(0, 6).map(e => cssPath(e) + (e.tagName === 'SELECT' && e.options[0] ? '[' + e.options[0].text.slice(0, 15) + ']' : ''));
  // Filtres (selects, champs) : pour comparer entre pages
  res.filters = [...body.querySelectorAll('select')].filter(vis).map(s => ({
    label: (s.getAttribute('aria-label') || (s.labels && s.labels[0] && s.labels[0].innerText) || s.id || s.name || '').trim().slice(0, 30),
    n: s.options.length, first: s.options[0] ? s.options[0].text.slice(0, 15) : '', x: Math.round(s.getBoundingClientRect().left), y: Math.round(s.getBoundingClientRect().top) }));
  res.inputs = [...document.querySelectorAll('input')].filter(vis).length;

  // Spinners / chargements bloqués
  res.stuckLoading = (text.match(/\b(chargement|loading|en cours)\b[^\n]{0,20}/gi) || []).slice(0, 3)
    .concat([...body.querySelectorAll('[class*=spinner],[class*=skeleton],[class*=loading]')].filter(vis).slice(0, 3).map(cssPath));

  // Unités, formats de nombres et de dates (cohérence)
  res.units = {}; (text.match(/(€|EUR|eur|USD|\$|£)\s?\/\s?(MWh|mwh|MW|kWh|t|tCO2|MW\/an)|(GWh|TWh|MWh|MW|GW|kW|kWh)\b|tCO2(e)?(\/MWh)?|gCO2(eq)?\/kWh/g) || [])
    .forEach(u => { const k = u.replace(/\s/g, ''); res.units[k] = (res.units[k] || 0) + 1; });
  res.numFmt = { comma: (text.match(/\b\d{1,3}(?: | | )?\d*,\d{1,3}\b/g) || []).length, dot: (text.match(/\b\d+\.\d{1,3}\b/g) || []).length };
  res.dateFmts = {};
  [['ISO', /\b\d{4}-\d{2}-\d{2}\b/g], ['JJ/MM/AAAA', /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g], ['JJ/MM', /\b\d{1,2}\/\d{1,2}\b(?!\/)/g],
   ['JJ mois', /\b\d{1,2}\s(janv|févr|fév|mars|avr|mai|juin|juil|août|sept|oct|nov|déc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-zéû.]*/gi]]
    .forEach(([k, re]) => { const n = (text.match(re) || []).length; if (n) res.dateFmts[k] = n; });

  // Focus clavier visible ? (premier bouton)
  res.focusIssue = false;
  try { const b = [...body.querySelectorAll('button, a[href], select, input')].find(vis);
    if (b) { b.focus(); const cs = getComputedStyle(b); const none = (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0) && cs.boxShadow === 'none';
      res.focusIssue = none && document.activeElement === b; b.blur(); } } catch (e) {}

  // Empreinte du contenu (détection de pages doublons) + URL courante
  res.fingerprint = (text.toLowerCase().replace(/[\d\s.,:%€\/\-]+/g, ' ').split(' ').filter(w => w.length > 3)).slice(0, 400).join(' ');
  res.url = location.href; res.docTitle = document.title;
  return res;
}
"""

JS_HEAD = r"""
() => {
  const out = {};
  out.viewportMeta = !!document.querySelector('meta[name=viewport]');
  out.description = !!document.querySelector('meta[name=description]');
  out.favicon = !!document.querySelector('link[rel*=icon]');
  out.manifest = !!document.querySelector('link[rel=manifest]');
  out.themeColor = !!document.querySelector('meta[name=theme-color]');
  out.lang = document.documentElement.lang;
  let hex = 0, vars = 0, px = 0, sheets = 0, unreadable = 0;
  [...document.styleSheets].forEach(s => { try { const t = [...s.cssRules].map(r => r.cssText).join('\n'); sheets++;
      hex += (t.match(/#[0-9a-f]{3,8}\b/gi) || []).length; vars += (t.match(/var\(--/g) || []).length; px += (t.match(/\b\d+px\b/g) || []).length; } catch (e) { unreadable++; } });
  document.querySelectorAll('[style]').forEach(el => { const t = el.getAttribute('style'); hex += (t.match(/#[0-9a-f]{3,8}\b/gi) || []).length; });
  out.css = { hex, vars, px, sheets, unreadable, inlineStyles: document.querySelectorAll('[style]').length };
  out.cssVars = [...new Set([...document.styleSheets].flatMap(s => { try { return [...s.cssRules].flatMap(r => (r.cssText.match(/--[\w-]+(?=\s*:)/g) || [])); } catch (e) { return []; } }))].length;
  return out;
}
"""


# ----------------------------- HELPERS -----------------------------
def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "page"


def top(d, n=5):
    return sorted(d.items(), key=lambda kv: -kv[1])[:n]


JS_SETTLE = r"""
async (root) => {
  // fait défiler la page pour déclencher les graphiques dessinés à l'entrée dans l'écran, puis ouvre les sections repliées
  const el = document.querySelector(root) || document.body;
  const collapsed = el.querySelectorAll('.hist-section.collapsed').length;
  // PowerKlock : la page défile dans main.main (body en overflow hidden), pas dans le document
  const sc = document.querySelector('main.main') || document.scrollingElement;
  for (let y = 0; y < sc.scrollHeight; y += 700) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 120)); }
  el.querySelectorAll('.hist-section.collapsed > .hist-section-header').forEach(h => h.click());
  await new Promise(r => setTimeout(r, 900));
  for (let y = 0; y < sc.scrollHeight; y += 700) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 100)); }
  sc.scrollTop = 0;
  return collapsed;
}
"""


def analyse_page(page, label, vp_name, listeners, root=ROOT_SELECTOR, shoot=True):
    page.wait_for_timeout(WAIT_AFTER_CLICK_MS)
    collapsed = 0
    try:
        collapsed = page.evaluate(JS_SETTLE, root)
        page.wait_for_timeout(1200)
    except Exception:
        pass
    cfg = {"tile": TILE_SELECTOR, "chart": CHART_SELECTOR, "table": TABLE_SELECTOR, "chartTitle": CHART_TITLE, "root": root,
           "badText": BAD_TEXT.pattern, "minContrast": MIN_CONTRAST, "minFont": MIN_FONT_PX}
    data = page.evaluate(JS_ANALYSE, cfg)
    data["collapsedByDefault"] = collapsed
    data["label"] = label
    data["viewport"] = vp_name
    data["console"] = list(listeners["console"])
    data["failed"] = list(listeners["failed"])
    data["jsErrors"] = list(listeners["errors"])
    data["screenshot"] = None
    if shoot:
        shot = SHOTS / f"{vp_name}_{slug(label)}.png"
        try:
            # capture pleine hauteur : main.main défile seul ; la fenêtre est agrandie à la hauteur du contenu le temps de
            # la capture (dérouler main par CSS décalait la mise en page)
            vw = page.viewport_size
            extra = page.evaluate("() => { const m = document.querySelector('main.main'); return m ? Math.max(0, m.scrollHeight - m.clientHeight) : 0; }")
            if extra:
                page.set_viewport_size({"width": vw["width"], "height": min(vw["height"] + extra, 12000)})
                page.wait_for_timeout(700)
            page.screenshot(path=str(shot), full_page=True)
            if extra:
                page.set_viewport_size(vw)
                page.wait_for_timeout(300)
            data["screenshot"] = str(shot)
        except Exception:
            pass
    return data


def clear(lis):
    for k in lis:
        lis[k].clear()


def go_route(page, route):
    page.keyboard.press("Escape")   # ferme une fenêtre restée ouverte (sinon elle recouvre les captures suivantes)
    page.evaluate("r => PKNav.go(r)", route)


def click_sub(page, k):
    page.evaluate("([sel, k]) => { const b = [...document.querySelectorAll(sel)].filter(e => e.offsetParent)[k]; if (b) b.click(); return !!b; }",
                  [SUBNAV_SELECTORS, k])


def subtabs(page):
    return page.evaluate("""(sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map((b, k) => ({
        k, label: (b.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40), active: b.classList.contains('active') }))""", SUBNAV_SELECTORS)


def view_key(page):
    # identifie la vue affichée : page active + sous-domaine + onglet actif (évite de mesurer deux fois la même vue)
    return page.evaluate("""() => { const pg = document.querySelector('main .page.active'); if (!pg) return location.hash;
        const sub = [...pg.querySelectorAll('[data-subdomain-panel]')].find(e => e.offsetParent);
        const t = pg.querySelector('.tabs-nav .tab-btn.active, .pkd-tab.active');
        return pg.id + '/' + (sub ? sub.dataset.subdomainPanel : '') + '/' + (t ? t.textContent.trim() : ''); }""")


def crawl(url, headed, lang="fr", only=None):
    results = []
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=not headed)
        except Exception:
            browser = p.chromium.launch(headless=not headed, channel="chrome")
        for vp_name, (w, h) in VIEWPORTS.items():
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            ctx.add_init_script(f"try {{ localStorage.setItem('pk-lang', '{lang}') }} catch (e) {{}}")
            page = ctx.new_page()
            lis = {"console": [], "failed": [], "errors": []}
            page.on("console", lambda m, L=lis: L["console"].append(f"{m.type}: {m.text[:200]}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e, L=lis: L["errors"].append(str(e)[:300]))
            page.on("requestfailed", lambda r, L=lis: L["failed"].append(f"{r.url[:120]} ({r.failure})"))
            page.on("response", lambda r, L=lis: L["failed"].append(f"{r.status} {r.url[:120]}") if r.status >= 400 else None)

            print(f"[{vp_name}] ouverture {url}")
            t0 = time.time()
            page.goto(url, wait_until="networkidle", timeout=90000)
            load_ms = int((time.time() - t0) * 1000)
            # temps avant le premier graphique dessiné (performance perçue)
            try:
                page.wait_for_function("() => window.Chart && [...document.querySelectorAll('canvas')].some(c => c.offsetParent && Chart.getChart(c))",
                                       timeout=20000)
                first_chart_ms = int((time.time() - t0) * 1000)
            except Exception:
                first_chart_ms = None
            page.wait_for_timeout(2500)
            home = analyse_page(page, "Accueil", vp_name, lis, root="body")
            home["depth"] = 0
            home["loadMs"] = load_ms
            home["firstChartMs"] = first_chart_ms
            home["head"] = page.evaluate(JS_HEAD)
            results.append(home)

            routes = page.evaluate(NAV_ROUTES_JS)
            if only:
                routes = [r for r in routes if any(r["route"].startswith(o) for o in only)]
            print(f"[{vp_name}] {len(routes)} adresses de navigation (PKNav)")
            seen = set()
            done = 0
            for ent in routes:
                if done >= MAX_PAGES:
                    break
                route = ent["route"]
                clicks = 1 if "/" not in route else 2   # entrée de menu (groupe déplié), puis onglet de groupe
                clear(lis)
                try:
                    go_route(page, route)
                except Exception as e:
                    results.append({"label": route, "viewport": vp_name, "unreachable": True, "error": str(e)[:150], "depth": 1})
                    continue
                page.wait_for_timeout(600)
                key = view_key(page)
                tabs = subtabs(page)
                act = next((t["label"] for t in tabs if t["active"]), "")
                label = route + (f" > {act}" if act else "")
                if key not in seen:
                    seen.add(key)
                    d = analyse_page(page, label, vp_name, lis)
                    d.update(depth=1, route=route, clicks_to_reach=clicks)
                    results.append(d)
                    done += 1
                    print(f"  - {label}: {d['textLength']} car., {len(d['charts'])} graphs, {len(d['tiles'])} tuiles")
                # niveau 2 : les autres onglets de vue
                for t in tabs:
                    if t["active"] or not t["label"] or done >= MAX_PAGES:
                        continue
                    clear(lis)
                    try:
                        go_route(page, route)
                        page.wait_for_timeout(500)
                        click_sub(page, t["k"])
                    except Exception as e:
                        results.append({"label": f"{route} > {t['label']}", "viewport": vp_name, "unreachable": True, "error": str(e)[:150], "depth": 2})
                        continue
                    page.wait_for_timeout(400)
                    key2 = view_key(page)
                    if key2 in seen:
                        continue
                    seen.add(key2)
                    lab2 = f"{route} > {t['label']}"
                    d = analyse_page(page, lab2, vp_name, lis)
                    d.update(depth=2, route=route, tab=t["k"], clicks_to_reach=clicks + 1)
                    results.append(d)
                    done += 1
                    print(f"  - {lab2}: {d['textLength']} car., {len(d['charts'])} graphs, {len(d['tiles'])} tuiles")
            # vues hors menu : le tableau de bord France s'ouvre par le choix de zone de la barre du haut (js/scope.js)
            for lab, js in EXTRA_VIEWS:
                clear(lis)
                try:
                    page.evaluate(js)
                    page.wait_for_timeout(600)
                except Exception as e:
                    results.append({"label": lab, "viewport": vp_name, "unreachable": True, "error": str(e)[:150], "depth": 1})
                    continue
                if view_key(page) in seen:
                    continue
                d = analyse_page(page, lab, vp_name, lis)
                d.update(depth=1, clicks_to_reach=2)
                results.append(d)
                print(f"  - {lab}: {d['textLength']} car., {len(d['charts'])} graphs, {len(d['tiles'])} tuiles")
            # largeurs intermédiaires : aucune vue plus large que l'écran
            if vp_name == "desktop":
                for wd in EXTRA_WIDTHS:
                    page.set_viewport_size({"width": wd, "height": 900})
                    for r in [x for x in results if x.get("viewport") == "desktop" and x.get("route")]:
                        try:
                            go_route(page, r["route"])
                            page.wait_for_timeout(700)
                            if r.get("tab") is not None:
                                click_sub(page, r["tab"])
                                page.wait_for_timeout(900)
                            sw = page.evaluate("""() => { const d = document.documentElement, m = document.querySelector('main.main');
                                const extra = m && getComputedStyle(m).overflowX !== 'hidden' ? Math.max(0, m.scrollWidth - m.clientWidth) : 0;
                                return [d.scrollWidth + extra, d.clientWidth]; }""")
                            if sw[0] > sw[1] + 2:
                                results.append({"label": r["label"], "viewport": f"w{wd}", "widthOverflow": sw})
                        except Exception:
                            pass
                    print(f"[w{wd}] largeur vérifiée")
                page.set_viewport_size({"width": w, "height": h})
            ctx.close()
        browser.close()
    return results


# ----------------------------- LANGUE -----------------------------
FR_WORDS = set("le la les un une des du de d l et ou en au aux dans sur pour par avec sans sous entre vers chez est sont été être a ont avoir "
                "ce cette ces son sa ses leur leurs mon ma mes notre nos votre vos qui que quoi dont où ne pas plus très aussi mais donc car "
                "prix jour jours mois année années heure heures semaine données moyenne moyen min max volume production consommation "
                "marché électricité énergie mix éolien solaire nucléaire hydraulique charbon gaz tout tous toutes voir afficher masquer "
                "chargement erreur aucune aucun filtre période zone date depuis jusqu".split())
EN_WORDS = set("the a an of and or in on at to for by with without from between is are was were be been has have had this that these those "
               "its their his her our your my who which what where not no more very also but so because price prices day days month months "
               "year years hour hours week data average mean volume generation load demand market electricity energy wind solar nuclear "
               "hydro coal gas all show hide view loading error none filter period zone date since until today yesterday last next "
               "forecast spread capture negative positive high low".split())


def seg_lang(text):
    words = re.findall(r"[a-zA-ZÀ-ÿ']+", text.lower())
    words = [w.strip("'") for w in words]
    fr = sum(1 for w in words if w in FR_WORDS)
    en = sum(1 for w in words if w in EN_WORDS)
    if any(c in text.lower() for c in "éèêàçùôîâû"):
        fr += 2
    if fr == en:
        return None
    return "fr" if fr > en else "en"


def language_audit(desk, add, A, V):
    glob = Counter(); page_stats = {}
    for r in desk:
        c = Counter(); minor = defaultdict(list)
        for s in r.get("segments", []):
            lg = seg_lang(s["t"])
            if lg:
                c[lg] += 1; minor[lg].append(s)
        page_stats[r["label"]] = (c, minor)
        glob.update(c)
    tot = sum(glob.values())
    if not tot:
        return
    main = glob.most_common(1)[0][0]
    other = "en" if main == "fr" else "fr"
    share = glob[other] / tot
    langs = {r.get("htmlLang", "") for r in desk}
    add(A, "INFO", "Langue dominante", "Global", f"{main.upper()} {100-share*100:.0f}% / {other.upper()} {share*100:.0f}% ({tot} segments) ; <html lang> = {sorted(langs)}")
    dom_attr = next(iter(langs), "")
    if dom_attr and not dom_attr.lower().startswith(main):
        add(A, "P2", "Attribut <html lang> incohérent", "Global", f"lang='{dom_attr}' mais contenu majoritairement {main.upper()}")
    if not dom_attr:
        add(A, "P3", "Attribut <html lang> manquant", "Global", f"à définir ({main})")
    if share > 0.15:
        add(V, "P1", "Site bilingue non maîtrisé", "Global",
            f"{share*100:.0f}% du texte en {other.upper()} : choisir UNE langue d'interface (ou un sélecteur FR/EN) ; termes métier (PPA, spread, capture rate) tolérés")
    for label, (c, minor) in page_stats.items():
        n = sum(c.values())
        if n < 5:
            continue
        mi = c[other] / n
        if 0 < c[other] and mi > 0.2:
            ex = " | ".join(s["t"][:40] for s in minor[other][:3])
            add(A, "P2", "Page mélangeant FR et EN", label, f"{mi*100:.0f}% en {other.upper()} ({c[other]}/{n}) ex. : {ex}")
        elif 0 < c[other] <= 3 and mi <= 0.2:
            ex = " | ".join(f"'{s['t'][:40]}' ({s['el']})" for s in minor[other][:3])
            add(A, "P3", f"Libellés isolés en {other.upper()}", label, ex)


# ----------------------------- ANALYSE -----------------------------
def structure_kind(sig):
    out = []
    for k in (s.split(":")[0] for s in sig):
        if k == "DIV":
            continue
        if not out or out[-1] != k:
            out.append(k)
    return " > ".join(out)


def build_report(results, url):
    A, V = [], []   # A = à faire (correctifs), V = à valider (changements forts)
    desk = [r for r in results if r.get("viewport") == "desktop" and not r.get("unreachable")]
    mob = [r for r in results if r.get("viewport") == "mobile" and not r.get("unreachable")]
    unreachable = [r for r in results if r.get("unreachable")]
    # L'accueil est souvent identique à la première page : ne pas compter deux fois
    for vp_list in (desk, mob):
        home = next((r for r in vp_list if r["label"] == "Accueil"), None)
        if home:
            twin = next((r for r in vp_list if r is not home and (r.get("route") == "today" or r.get("fingerprint") == home.get("fingerprint"))), None)
            if twin:
                for k in ("head", "loadMs", "firstChartMs"):
                    if k in home:
                        twin[k] = home[k]
                vp_list.remove(home)

    def add(lst, prio, cat, page, msg):
        lst.append((prio, cat, page, msg))

    # 1. Bugs techniques
    for r in desk + mob:
        pg = f"{r['label']} [{r['viewport']}]"
        for e in r["jsErrors"]:
            add(A, "P0", "Bug JS", pg, e)
        for f in set(r["failed"]):
            add(A, "P0", "Requête en échec", pg, f)
        for c in set(c for c in r["console"] if c.startswith("error")):
            add(A, "P1", "Erreur console", pg, c)
        if r["badText"]:
            add(A, "P0", "Valeur cassée affichée", pg, ", ".join(sorted(set(r["badText"]))))
        for b in r["brokenImages"]:
            add(A, "P1", "Image cassée", pg, b)
        if r["scrollW"] > r["clientW"] + 4:
            add(A, "P1", "Scroll horizontal", pg, f"{r['scrollW']}px > {r['clientW']}px ; éléments : {', '.join(r['overflowing'][:4])}")
        for ch in r["charts"]:
            if ch.get("noDataMsg"):
                continue   # le graphique affiche déjà un message "pas de données"
            if ch["blank"] and ch.get("chartjs") is None:
                add(A, "P0", "Graphique vide (canvas jamais dessiné)", pg, f"{ch['title'] or ch['el']} ({ch['w']}x{ch['h']})")
            elif ch["blank"]:
                add(A, "P0", "Graphique vide", pg, f"{ch['title'] or ch['el']} ({ch['w']}x{ch['h']})")
            elif ch.get("noData"):
                add(A, "P0", "Graphique sans données (axes seuls)", pg, f"{ch['title'] or ch['el']} : afficher un message 'Pas de données' ou masquer")
        if r["stuckLoading"]:
            add(A, "P1", "Chargement affiché après attente", pg, "; ".join(r["stuckLoading"]))
        for t in r["tiles"]:
            if t["empty"]:
                add(A, "P1", "Tuile vide", pg, t["el"])
        if r["emptyLinks"] > 2:
            add(A, "P2", "Liens vides (#)", pg, f"{r['emptyLinks']} liens")
    for r in unreachable:
        add(A, "P1", "Page non atteignable au clic", f"{r['label']} [{r['viewport']}]", r["error"])
    for r in results:
        if r.get("widthOverflow"):
            add(A, "P1", "Scroll horizontal (largeur intermédiaire)", f"{r['label']} [{r['viewport']}]", f"{r['widthOverflow'][0]}px > {r['widthOverflow'][1]}px")
    for r in desk:
        if r.get("collapsedByDefault"):
            add(V, "P3", "Sections repliées par défaut", r["label"], f"{r['collapsedByDefault']} section(s) sur {r.get('sections', '?')} fermées à l'ouverture")
        nosrc = [c for c in r["charts"] if c.get("source") is False]
        if nosrc:
            add(A, "P2", "Graphique sans source sous le titre", r["label"], ", ".join((c["title"] or c["el"])[:40] for c in nosrc[:4]))

    # 2. Pages vides / peu intéressantes / peu visibles
    for r in desk:
        pg = r["label"]
        dense = len(r["charts"]) + len(r["tables"]) + len(r["tiles"])
        if r["textLength"] < MIN_TEXT_CHARS or dense == 0:
            add(V, "P1", "Page vide ou pauvre", pg, f"{r['textLength']} caractères, {dense} blocs de contenu : fusionner, enrichir ou supprimer")
        elif dense <= 2 and r["textLength"] < 600:
            add(V, "P2", "Page peu intéressante", pg, f"seulement {dense} blocs : à fusionner avec une page voisine ?")
        if r.get("clicks_to_reach", 0) >= 3:
            add(V, "P2", "Page enfouie", pg, f"{r['clicks_to_reach']} clics depuis l'accueil : exposer dans la navigation principale ou un raccourci")
        if r["hiddenCount"] > 15:
            add(V, "P3", "Beaucoup de contenu masqué", pg, f"{r['hiddenCount']} blocs display:none")
        if r["lowContrastCount"] > 0:
            ex = r["lowContrast"][0]
            add(A, "P1", "Texte peu visible (contraste)", pg, f"{r['lowContrastCount']} textes < {MIN_CONTRAST}:1 (ex. '{ex['text']}' = {ex['ratio']}:1, {ex['color']})")
        if r["smallTextCount"] > 0:
            ex = r["smallText"][0]
            add(A, "P1", f"Texte trop petit (< {MIN_FONT_PX}px)", pg, f"{r['smallTextCount']} occurrences (ex. '{ex['text']}' = {ex['size']}px)")
        if r["tinyClickTargets"] > 3:
            add(A, "P2", "Cibles cliquables < 24px", pg, f"{r['tinyClickTargets']} boutons")

    # 3. Cohérence typographique et couleurs (globale)
    fonts, sizes, colors = Counter(), Counter(), Counter()
    for r in desk:
        for k, v in r["fonts"].items(): fonts[k] += v
        for k, v in r["sizes"].items(): sizes[k] += v
        for k, v in r["colors"].items(): colors[k] += v
    tot = sum(fonts.values()) or 1
    main_fonts = [f for f, v in fonts.items() if v / tot > 0.02]
    if len(main_fonts) > 3:
        add(V, "P2", "Trop de polices", "Global", f"{len(main_fonts)} polices utilisées : " + ", ".join(f"{f} ({fonts[f]*100//tot}%)" for f in main_fonts))
    stot = sum(sizes.values()) or 1
    used_sizes = sorted([float(s) for s, v in sizes.items() if v / stot > 0.005])
    if len(used_sizes) > 8:
        add(V, "P2", "Échelle typographique trop large", "Global", f"{len(used_sizes)} tailles : {used_sizes} : viser 6 à 7 paliers max")
    ctot = sum(colors.values()) or 1
    used_colors = [c for c, v in colors.items() if v / ctot > 0.01]
    if len(used_colors) > 7:
        add(V, "P2", "Trop de couleurs de texte", "Global", f"{len(used_colors)} couleurs : {used_colors}")
    # tailles proches (ex. 11 / 11.5 / 12)
    close = [(a, b) for a, b in zip(used_sizes, used_sizes[1:]) if 0 < b - a <= 0.6]
    if close:
        add(A, "P2", "Tailles quasi identiques", "Global", f"paires à unifier : {close}")

    # Titres : hiérarchie et styles
    h_style = defaultdict(Counter)
    for r in desk:
        for h in r["headings"]:
            h_style[h["tag"]][(h["size"], h["weight"], h["family"], h["color"])] += 1
    for tag, c in h_style.items():
        if len(c) > 2:
            add(A, "P2", f"Style de {tag} incohérent", "Global", f"{len(c)} variantes : " + "; ".join(f"{k} x{v}" for k, v in c.most_common(4)))
    for r in desk:
        tags = [h["tag"] for h in r["headings"]]
        if "H1" not in tags and r["headings"]:
            add(A, "P3", "Pas de H1", r["label"], "hiérarchie de titres à revoir")
        if tags.count("H1") > 1:
            add(A, "P3", "Plusieurs H1", r["label"], f"{tags.count('H1')} H1")
        if not r["headings"]:
            add(V, "P2", "Aucun titre visible", r["label"], "la page n'annonce pas son contenu")

    # Tuiles : fingerprint
    fp = Counter(); fp_pages = defaultdict(set)
    for r in desk:
        for t in r["tiles"]:
            k = (t["radius"], t["bg"], t["border"], t["shadow"])
            fp[k] += 1; fp_pages[k].add(r["label"])
    if fp:
        ref, n_ref = fp.most_common(1)[0]
        total = sum(fp.values())
        add(A, "INFO", "Tuile de référence", "Global", f"radius={ref[0]}, bg={ref[1]}, border={ref[2]}, ombre={ref[3]} ({n_ref}/{total} tuiles)")
        for k, n in fp.most_common()[1:]:
            if n >= 1:
                add(A, "P2", "Tuile hors norme", ", ".join(sorted(fp_pages[k]))[:120],
                    f"radius={k[0]}, bg={k[1]}, border={k[2]}, ombre={k[3]} ({n} tuiles) : aligner sur la référence")
    pad = Counter(t["padding"] for r in desk for t in r["tiles"])
    if len(pad) > 4:
        add(A, "P2", "Paddings de tuiles dispersés", "Global", f"{len(pad)} valeurs : {pad.most_common(6)}")

    # Boutons
    bs = Counter()
    for r in desk:
        for k, v in r["buttonStyles"].items(): bs[k] += v
    if len(bs) > 8:
        add(V, "P2", "Trop de styles de boutons", "Global", f"{len(bs)} variantes (radius | padding | taille) : " + str(bs.most_common(5)))

    # Tableaux : NORME TABLE
    tstyle = Counter(); tpages = defaultdict(set)
    for r in desk:
        for t in r["tables"]:
            k = (t["font"], t["tdPad"], t["thPad"], t["thColor"], t["thWeight"])
            tstyle[k] += 1; tpages[k].add(r["label"])
    if len(tstyle) > 1:
        ref = tstyle.most_common(1)[0][0]
        for k, n in tstyle.most_common()[1:]:
            add(A, "P2", "Tableau hors norme", ", ".join(sorted(tpages[k]))[:120], f"{k} vs référence {ref} ({n} tableaux)")

    # Graphiques : cohérence Chart.js
    cj = []
    for r in desk:
        for ch in r["charts"]:
            if ch.get("chartjs"):
                cj.append((r["label"], ch))
    if cj:
        def vote(key):
            return Counter(str(c["chartjs"].get(key)) for _, c in cj)
        for key, nice in [("legend", "position de légende"), ("tension", "lissage des courbes"), ("borderWidth", "épaisseur de trait"),
                          ("gridColor", "couleur de grille"), ("tickFont", "taille des ticks"), ("tickColor", "couleur des ticks"),
                          ("fontFamily", "police des graphiques"), ("pointRadius", "taille des points")]:
            v = vote(key)
            if len(v) > 1:
                add(A, "P2", f"Graphiques : {nice} incohérent", "Global", " ; ".join(f"{k} x{n}" for k, n in v.most_common(5)))
        for lbl, ch in cj:
            if not ch["hasReset"]:
                add(A, "P2", "Graphique sans bouton ↺ Reset", lbl, f"{ch['title'] or ch['el']}")
            if not ch["chartjs"].get("hasZoom"):
                add(V, "P3", "Graphique sans plugin zoom", lbl, f"{ch['title'] or ch['el']}")
    heights = Counter(ch["h"] // 20 * 20 for r in desk for ch in r["charts"])
    if len(heights) > 6:
        add(V, "P3", "Hauteurs de graphiques très variées", "Global", f"{sorted(heights.items())}")
    for r in desk:
        for ch in r["charts"]:
            if not ch["title"]:
                add(A, "P2", "Graphique sans titre", r["label"], ch["el"])
            if ch["h"] < 120:
                add(A, "P2", "Graphique écrasé", r["label"], f"{ch['w']}x{ch['h']}")

    # Structures de pages
    kinds = defaultdict(list)
    for r in desk:
        kinds[structure_kind(r["structure"])].append(r["label"])
    if len(kinds) > 3:
        lines = "; ".join(f"[{len(v)} pages] {k or '(vide)'} : {', '.join(v[:4])}" for k, v in sorted(kinds.items(), key=lambda kv: -len(kv[1]))[:6])
        add(V, "P1", f"{len(kinds)} structures de pages différentes", "Global", f"viser 3 gabarits max (ex. Vue d'ensemble / Analyse / Référence) : {lines}")
    else:
        add(A, "INFO", f"{len(kinds)} structures de pages", "Global", "; ".join(f"{k}: {len(v)} pages" for k, v in kinds.items()))

    # Données difficiles à trouver : pages profondes + peu de liens entrants (une seule entrée)
    for r in desk:
        if r.get("clicks_to_reach", 0) >= 3 and (r["charts"] or r["tables"]):
            add(V, "P2", "Données difficiles à trouver", r["label"], f"{len(r['charts'])} graphs / {len(r['tables'])} tableaux à {r['clicks_to_reach']} clics : ajouter recherche globale, raccourci ou lien depuis l'accueil")

    # Accessibilité des graphiques et transparence des données (WCAG 1.1.1 / 1.4.11, heuristique "visibilité de l'état du système")
    for r in desk:
        if r["charts"] and not r["hasUpdateDate"]:
            add(A, "P2", "Date de mise à jour absente", r["label"], "afficher la date de dernière donnée / dernière MAJ près des graphiques")
        if (r["charts"] or r["tables"]) and not r["hasSource"]:
            add(A, "P2", "Source des données absente", r["label"], "ajouter une ligne 'Source : ...' sous chaque graphique ou en pied de page")
        if r["focusableNoLabel"] > 0:
            add(A, "P2", "Contrôles sans libellé accessible", r["label"], f"{r['focusableNoLabel']} boutons/liens/champs sans texte, aria-label ni title : {', '.join(r.get('noLabelEls', []))}")
        na = [c for c in r["charts"] if not c.get("aria")]
        if na:
            add(A, "P3", "Graphiques sans alternative texte (WCAG 1.1.1)", r["label"], f"{len(na)} canvas sans aria-label/role=img : ajouter un résumé court")
        for c in r["charts"]:
            if c.get("lowContrastSeries"):
                add(A, "P2", "Séries peu contrastées sur le fond (< 3:1, WCAG 1.4.11)", r["label"], "; ".join(c["lowContrastSeries"][:3]))

    # --- Contrôles transverses supplémentaires ---
    # Pages doublons (même contenu textuel)
    def sim(a, b):
        sa, sb = set(a.split()), set(b.split())
        return len(sa & sb) / max(1, len(sa | sb))
    for i, a in enumerate(desk):
        for b in desk[i + 1:]:
            if a["fingerprint"] and sim(a["fingerprint"], b["fingerprint"]) > 0.85 and a["label"] != b["label"]:
                add(V, "P1", "Pages quasi identiques", f"{a['label']} / {b['label']}", f"{sim(a['fingerprint'], b['fingerprint'])*100:.0f}% de contenu commun : fusionner ou différencier")
    # Deep links : l'URL change-t-elle selon la page ?
    urls = {r["url"] for r in desk if r.get("url")}
    if len(desk) > 2 and len(urls) <= 1:
        add(V, "P1", "Aucun lien profond", "Global", "l'URL ne change jamais d'une page à l'autre : impossible de partager ou d'ajouter une vue en favori (ajouter #page ou ?page=)")
    titles = Counter(r.get("docTitle", "") for r in desk)
    if len(desk) > 2 and len(titles) == 1:
        add(A, "P3", "Titre d'onglet identique sur toutes les pages", "Global", f"'{next(iter(titles))}' : adapter document.title à la page")
    # Filtres : présence et options cohérentes
    fl = defaultdict(list)
    for r in desk:
        for f in r["filters"]:
            fl[f["label"] or "(sans nom)"].append((r["label"], f["n"], f["x"], f["y"]))
    for lab, rows in fl.items():
        if len({n for _, n, _, _ in rows}) > 1:
            add(A, "P2", "Filtre avec options différentes selon les pages", lab, "; ".join(f"{p}: {n} options" for p, n, _, _ in rows[:6]))
        if len({(x // 40, y // 40) for _, _, x, y in rows}) > 2:
            add(A, "P3", "Filtre positionné différemment selon les pages", lab, "; ".join(f"{p} ({x},{y})" for p, _, x, y in rows[:5]))
        if len(rows) < len(desk) and len(rows) >= len(desk) * 0.5:
            miss = sorted({r["label"] for r in desk} - {p for p, *_ in rows})
            add(V, "P2", "Filtre absent sur certaines pages", lab, "manque sur : " + ", ".join(miss[:6]))
    # Couleur par série cohérente entre graphiques
    col = defaultdict(Counter)
    for r in desk:
        for ch in r["charts"]:
            for s in ch.get("seriesColors", []):
                if s["label"] and s["color"]:
                    col[s["label"]][s["color"]] += 1
    for lab, c in col.items():
        if len(c) > 1:
            add(A, "P2", "Même série, couleurs différentes", lab, " ; ".join(f"{k} x{v}" for k, v in c.most_common(4)))
    palette = Counter(s["color"] for r in desk for ch in r["charts"] for s in ch.get("seriesColors", []))
    if len(palette) > 14:
        add(V, "P2", "Palette de séries trop large", "Global", f"{len(palette)} couleurs de séries distinctes : définir une palette de 8 à 10 teintes")
    # Axes sans titre / unité
    for r in desk:
        nt = [c for c in r["charts"] if c.get("chartjs") and not c.get("axisHasTitle")]
        if nt:
            add(A, "P3", "Axes sans titre ni unité", r["label"], f"{len(nt)} graphique(s) : ajouter l'unité (EUR/MWh, MW, %) en titre d'axe ou de graphique")
    # Unités, formats de nombres et de dates
    units = Counter()
    for r in desk:
        units.update(r.get("units", {}))
    price = {k: v for k, v in units.items() if "MWh" in k and ("€" in k or "EUR" in k.upper())}
    if len(price) > 1:
        add(A, "P2", "Unité de prix écrite de plusieurs façons", "Global", " ; ".join(f"{k} x{v}" for k, v in price.items()))
    comma = sum(r["numFmt"]["comma"] for r in desk); dot = sum(r["numFmt"]["dot"] for r in desk)
    if comma and dot and min(comma, dot) / (comma + dot) > 0.1:
        add(A, "P2", "Séparateur décimal mixte (virgule et point)", "Global", f"virgule x{comma}, point x{dot} : choisir un format selon la langue")
    dfm = Counter()
    for r in desk:
        dfm.update(r.get("dateFmts", {}))
    if len(dfm) > 2:
        add(A, "P2", "Formats de date multiples", "Global", " ; ".join(f"{k} x{v}" for k, v in dfm.items()))
    # Clavier
    nf = [r["label"] for r in desk if r.get("focusIssue")]
    if nf:
        add(A, "P2", "Focus clavier invisible (WCAG 2.4.7)", ", ".join(nf[:6]), "ajouter :focus-visible { outline: 2px solid var(--accent) }")
    # Performance
    for r in desk:
        if r.get("loadMs", 0) > 3000:
            add(A, "P1", "Chargement initial lent", r["label"], f"{r['loadMs']} ms (objectif < 3000)")
        if r.get("firstChartMs"):
            add(A, "INFO", "Premier graphique dessiné", r["label"], f"{r['firstChartMs']} ms après l'ouverture")
    # Tête de page, PWA, dette CSS
    hd = next((r["head"] for r in desk if r.get("head")), None)
    if hd:
        if not hd["viewportMeta"]: add(A, "P1", "Meta viewport absente", "Global", "le site ne s'adapte pas au mobile")
        if not hd["favicon"]: add(A, "P3", "Favicon absent", "Global", "ajouter <link rel=icon>")
        if not hd["manifest"]: add(V, "P3", "Pas de manifest PWA", "Global", "installable sur mobile si ajouté")
        if not hd["description"]: add(A, "P3", "Meta description absente", "Global", "utile pour le partage de lien")
        c = hd["css"]
        if c["hex"] > 40 and c["hex"] > c["vars"]:
            add(V, "P2", "Dette de design tokens", "Global", f"{c['hex']} couleurs hex en dur vs {c['vars']} usages de var(--) ({hd['cssVars']} variables définies, {c['inlineStyles']} styles inline) : migrer vers des variables CSS")
        if c["unreadable"]:
            add(A, "INFO", "Feuilles de style illisibles (CORS)", "Global", f"{c['unreadable']} feuille(s) externe(s) non analysées")

    # Langue
    language_audit(desk, add, A, V)

    # Mobile vs desktop
    for m in mob:
        d = next((x for x in desk if x["label"] == m["label"]), None)
        if d and len(m["charts"]) < len(d["charts"]):
            add(A, "P2", "Graphiques manquants sur mobile", m["label"], f"{len(d['charts'])} desktop vs {len(m['charts'])} mobile")

    return A, V, kinds, (fonts, sizes, colors)


def write_report(results, A, V, kinds, typo, url):
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3, "INFO": 4}
    A.sort(key=lambda x: (order[x[0]], x[1])); V.sort(key=lambda x: (order[x[0]], x[1]))
    desk = [r for r in results if r.get("viewport") == "desktop" and not r.get("unreachable")]
    L = [f"# Audit UX / visuel : {url}", f"Généré le {time.strftime('%Y-%m-%d %H:%M')}", "",
         f"- Pages analysées (desktop) : **{len(desk)}**",
         f"- Actions à faire (correctifs) : **{len([a for a in A if a[0] != 'INFO'])}**",
         f"- Actions à valider (changements forts) : **{len(V)}**", ""]
    L += ["## Synthèse des priorités", "| Prio | À faire | À valider |", "|---|---|---|"]
    for p in ["P0", "P1", "P2", "P3"]:
        L.append(f"| {p} | {len([a for a in A if a[0]==p])} | {len([v for v in V if v[0]==p])} |")
    L += ["", "P0 = bug bloquant ; P1 = important ; P2 = cohérence ; P3 = confort", ""]

    def section(title, items):
        L.append(f"## {title}")
        if not items:
            L.append("Rien à signaler."); L.append(""); return
        cur = None
        for prio, cat, page, msg in items:
            if cat != cur:
                L.append(f"\n### {cat}"); cur = cat
            L.append(f"- [{prio}] **{page}** : {msg}")
        L.append("")

    section("A. À FAIRE (correctifs sans débat)", A)
    section("B. À VALIDER (modifications fortes)", V)

    L += ["## Inventaire des gabarits de pages"]
    for k, v in sorted(kinds.items(), key=lambda kv: -len(kv[1])):
        L.append(f"- `{k or '(vide)'}` ({len(v)}) : {', '.join(v)}")
    fonts, sizes, colors = typo
    L += ["", "## Typographie et couleurs (usage réel)",
          "- Polices : " + ", ".join(f"{k} ({v})" for k, v in top(fonts)),
          "- Tailles : " + ", ".join(f"{k}px ({v})" for k, v in top(sizes, 10)),
          "- Couleurs de texte : " + ", ".join(f"{k} ({v})" for k, v in top(colors, 8)), ""]
    L += ["## Pages par densité (desktop)", "| Page | Caractères | Tuiles | Graphs | Tableaux | Clics |", "|---|---|---|---|---|---|"]
    for r in sorted(desk, key=lambda r: r["textLength"]):
        L.append(f"| {r['label']} | {r['textLength']} | {len(r['tiles'])} | {len(r['charts'])} | {len(r['tables'])} | {r.get('clicks_to_reach', 0)} |")
    (OUT / "rapport.md").write_text("\n".join(L), encoding="utf-8")


def main():
    global OUT, SHOTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=BASE_URL)
    ap.add_argument("--headed", action="store_true", help="afficher le navigateur")
    ap.add_argument("--lang", default="fr", help="langue du site (localStorage pk-lang), fr par défaut")
    ap.add_argument("--only", nargs="*", help="préfixes d'adresses à auditer (ex. markets/spot tools)")
    ap.add_argument("--report-only", action="store_true", help="refaire rapport.md depuis data.json, sans navigateur")
    ap.add_argument("--viewports", default=",".join(VIEWPORTS), help="ex. desktop ou mobile (deux passes en parallèle)")
    ap.add_argument("--out", default="audit_out", help="dossier de sortie (audit_out)")
    ap.add_argument("--merge", nargs="*", help="avec --report-only : data.json de plusieurs dossiers (passes desktop et mobile)")
    args = ap.parse_args()

    OUT = Path(args.out)
    SHOTS = OUT / "shots"
    OUT.mkdir(exist_ok=True, parents=True)
    SHOTS.mkdir(exist_ok=True, parents=True)
    for k in [k for k in VIEWPORTS if k not in args.viewports.split(",")]:
        del VIEWPORTS[k]
    if args.report_only:
        results = []
        for d in (args.merge or [str(OUT)]):
            results += json.loads((Path(d) / "data.json").read_text(encoding="utf-8"))
        if args.merge:
            (OUT / "data.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
    else:
        results = crawl(args.url, args.headed, args.lang, args.only)
        (OUT / "data.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
    A, V, kinds, typo = build_report(results, args.url)
    write_report(results, A, V, kinds, typo, args.url)
    print(f"\nTerminé : {OUT/'rapport.md'}  ({len(A)} correctifs, {len(V)} à valider)")


if __name__ == "__main__":
    sys.exit(main())
