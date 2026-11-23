#!/usr/bin/env python3
"""
inventory_site.py : relevé automatique de tout ce que le site affiche, vue par vue.

Pour chaque vue (adresse du menu × onglets de vue), le script ouvre la page dans Chromium (Playwright), déplie les
sections repliées, puis relève chaque graphique (canvas), tableau, carte KPI, section, carte, réglage et bloc de
texte, avec sa taille à l'écran. Il sert à deux choses :

  1. un inventaire de référence du site actuel ;
  2. la preuve « zéro perte » d'une nouvelle organisation : le même relevé sur la bêta (--beta), puis
     scripts/inventory_diff.py compare les deux et liste ce qui manquerait.

    python3 -m http.server 8821 --bind 127.0.0.1 &
    python3 scripts/inventory_site.py --out audit_out/inventory_current.json
    python3 scripts/inventory_site.py --beta --out audit_out/inventory_beta.json
    python3 scripts/inventory_diff.py audit_out/inventory_current.json audit_out/inventory_beta.json

Options : --lang fr|en, --width 1440, --only markets/spot (préfixe d'adresse), --requests (liste des fichiers lus).
"""
import argparse
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8821/index.html"
# adresses hors menu, à relever aussi (pages gardées pour les liens partagés)
EXTRA_ROUTES = ["games", "tools/bess-index", "markets/fuels/ttf", "renewables/m0", "markets/go/auctions", "tools/bess"]
WAIT_VIEW_MS = 1500

# Onglets de vue : barre collante de la page active, sous-onglets (méthodes du pricer), onglets des garanties
# d'origine, tableaux de bord.
JS_TABS = r"""
() => {
  const pg = document.querySelector('main .page.active'); if (!pg) return [];
  const vis = e => e.offsetParent !== null;
  const sel = '.pr-tabs-bar .tabs-nav .tab-btn, .pk-subviews .tab-btn, #go-tabs-nav .tab-btn, .pkd-tab:not(.pkd-tab-new):not(.pkd-tab-add)';
  return [...pg.querySelectorAll(sel)].filter(vis).map((b, k) => ({ k, label: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50),
    active: b.classList.contains('active'), sub: !!b.closest('.pk-subviews') }));
}
"""
JS_CLICK_TAB = r"""
(label) => {
  const pg = document.querySelector('main .page.active'); if (!pg) return false;
  const sel = '.pr-tabs-bar .tabs-nav .tab-btn, .pk-subviews .tab-btn, #go-tabs-nav .tab-btn, .pkd-tab:not(.pkd-tab-new):not(.pkd-tab-add)';
  const b = [...pg.querySelectorAll(sel)].filter(e => e.offsetParent !== null).find(e => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50) === label);
  if (b) b.click();
  return !!b;
}
"""
JS_VIEW_KEY = r"""
() => {
  const pg = document.querySelector('main .page.active'); if (!pg) return location.hash;
  const sub = [...pg.querySelectorAll('[data-subdomain-panel]')].find(e => e.offsetParent);
  const act = [...pg.querySelectorAll('.pr-tabs-bar .tabs-nav .tab-btn.active, .pk-subviews .tab-btn.active, #go-tabs-nav .tab-btn.active, .pkd-tab.active')]
    .filter(e => e.offsetParent !== null).map(e => (window.pkEN ? pkEN(e.textContent.trim()) : e.textContent.trim()));
  return pg.id + '/' + (sub ? sub.dataset.subdomainPanel : '') + '/' + act.join('>');
}
"""
# Déplie les sections repliées de la vue (leur contenu fait partie de la vue : il est à un clic)
JS_UNFOLD = r"""
() => {
  const pg = document.querySelector('main .page.active'); if (!pg) return 0;
  let n = 0;
  pg.querySelectorAll('.hist-section.collapsed').forEach(s => {
    if (s.offsetParent === null) return;
    n++;
    if (s.id && typeof window.toggleStrongSection === 'function' && s.classList.contains('hist-section-strong')) { try { toggleStrongSection(s.id); } catch (e) {} }
    if (s.classList.contains('collapsed')) { const h = s.querySelector('.hist-section-header, .hist-section-title'); if (h) h.click(); }
    if (s.classList.contains('collapsed')) s.classList.remove('collapsed');
  });
  pg.querySelectorAll('details:not([open])').forEach(d => { if (d.offsetParent !== null) { d.open = true; n++; } });
  return n;
}
"""
# signature de la vue : elle est relevée quand elle ne change plus (données chargées, graphiques dessinés)
JS_SETTLE = r"""
() => {
  const pg = document.querySelector('main .page.active'); if (!pg) return '';
  let shown = 0, drawn = 0;
  pg.querySelectorAll('canvas').forEach(c => { if (c.offsetParent === null) return; shown++; if (window.Chart && Chart.getChart && Chart.getChart(c)) drawn++; });
  const busy = [...pg.querySelectorAll('.spinner, .loading-row')].filter(e => e.offsetParent !== null).length;
  return [shown, drawn, busy, (pg.innerText || '').length, pg.querySelectorAll('.kpi-card, table tr').length].join('/');
}
"""
JS_ITEMS = r"""
() => {
  const pg = document.querySelector('main .page.active'); if (!pg) return { page: null, items: [] };
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const en = s => (window.pkEN ? pkEN(norm(s)) : norm(s));
  const lab = s => en(s).toLowerCase().replace(/[0-9]+([.,][0-9]+)?/g, '#').slice(0, 90);
  const vis = el => { if (!el || el.offsetParent === null) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
  const titleOf = el => {
    const card = el.closest('.chart-container, .fuel-card, .table-wrap, .pkd-item, .bl-blk, .mrn2-tile, .ma-panel-row, .pp-card, .hist-section');
    if (!card) return '';
    const t = card.querySelector('.table-title, .fuel-card-head .table-title, .pkd-title, .bl-t, .mu-day-t, .ma-lbl, h3, h4, .hist-section-title');
    return t ? norm(t.textContent).slice(0, 90) : '';
  };
  const secOf = el => { const s = el.closest('.hist-section[id]'); return s ? s.id : ''; };
  const page = pg.id, items = [], seen = new Set();
  // ids drawn at random at each load (day cards, dashboard tiles) cannot name an element from one visit to the next
  const rnd = id => /^(mu-day|pkd-[a-z]+|pk-tw)-[a-z0-9]{5,}$/.test(id || '');
  const host = el => { let e = el.parentElement; while (e && e !== pg && (!e.id || rnd(e.id))) e = e.parentElement; return e && e.id ? e.id : page; };
  const nth = {};
  const idx = k => { nth[k] = (nth[k] || 0) + 1; return nth[k] - 1; };
  const push = (kind, key, o) => { const k = kind + '|' + key; if (seen.has(k)) return; seen.add(k); items.push(Object.assign({ kind, key: k, sec: secOf(o.el) }, o, { el: undefined })); };

  // graphiques : un canvas dessiné (instance Chart.js ou pixels)
  pg.querySelectorAll('canvas').forEach(c => {
    const shown = vis(c), cid = rnd(c.id) ? '' : c.id;
    if (!shown && !cid) return;
    const [w, h] = box(c); if (shown && (w < 40 || h < 24)) return;
    const ch = window.Chart && Chart.getChart ? Chart.getChart(c) : null;
    let drawn = !!ch, pts = 0, type = '';
    if (ch) { type = ch.config.type; pts = (ch.data.datasets || []).reduce((a, d) => a + ((d.data || []).length), 0); }
    else { try { const t = document.createElement('canvas'); t.width = 48; t.height = 48; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 48, 48);
      const d = g.getImageData(0, 0, 48, 48).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; drawn = n > 12; type = 'canvas'; } catch (e) { type = 'canvas'; } }
    const title = titleOf(c), hk = host(c) + '/' + lab(title);
    const key = cid ? cid : hk + '/' + idx('c' + hk);
    push('chart', key, { el: c, id: cid, title, w, h, type, series: ch ? (ch.data.datasets || []).length : 0, pts, drawn, shown });
  });
  // cartes (Leaflet) et grands SVG (cartes, schémas)
  pg.querySelectorAll('.leaflet-container').forEach(m => { if (vis(m)) { const [w, h] = box(m); push('map', m.id || page + '/leaflet', { el: m, id: m.id || '', title: titleOf(m), w, h }); } });
  pg.querySelectorAll('svg').forEach(s => { if (!vis(s) || s.closest('.leaflet-container, button, a, .tab-btn, .sidebar')) return; const [w, h] = box(s); if (w < 160 || h < 60) return;
    const hk = s.id && !rnd(s.id) ? s.id : host(s); push('figure', hk + '/svg' + (s.id && !rnd(s.id) ? '' : idx('s' + hk)), { el: s, id: s.id || '', title: titleOf(s), w, h }); });
  // tableaux
  let nt = 0;
  pg.querySelectorAll('table').forEach(t => {
    if (!vis(t)) return;
    const head = [...t.querySelectorAll('thead th, tr:first-child th')].map(x => lab(x.textContent)).filter(Boolean).slice(0, 8).join(',');
    const host = t.id ? t : t.closest('[id]');
    const key = t.id ? t.id : (host && host !== pg && host.id ? host.id + '/t' : page + '/t') + '/' + head.slice(0, 60) + (head ? '' : (nt++));
    const [w, h] = box(t);
    push('table', key, { el: t, id: t.id || '', title: titleOf(t), w, h, rows: t.querySelectorAll('tbody tr').length || t.querySelectorAll('tr').length, head });
  });
  // cartes KPI et tuiles chiffrées
  pg.querySelectorAll('.kpi-card, .mrn2-tile, .pp-mcard, .bl-k, .ma-kpi-card, .hist-stat, .pkd-kpi, .mrn-cfcard, .fc-kpi, .cf-kpi').forEach(k => {
    if (!vis(k)) return;
    const l = k.querySelector('.kpi-label, .mrn2-tile-l, .mrn2-l, .pp-mcard-l, .bl-k-l, .ma-kpi-l, .hist-stat-label, .lbl, [class*="label"], [class*="-l"]');
    const label = norm(l ? l.textContent : (k.textContent || '').slice(0, 40));
    const [w, h] = box(k);
    push('kpi', page + '/' + secOf(k) + '/' + lab(label), { el: k, title: label.slice(0, 90), w, h, value: norm(k.textContent).slice(0, 80) });
  });
  // sections
  pg.querySelectorAll('.hist-section[id]').forEach(s => { if (!vis(s)) return; const t = s.querySelector('.hist-section-title'); const [w, h] = box(s);
    push('section', s.id, { el: s, id: s.id, title: t ? norm([...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ')).slice(0, 90) : '', w, h }); });
  // réglages : listes, champs, groupes de boutons de période
  pg.querySelectorAll('select[id], input[id], textarea[id]').forEach(c => { if (c.type === 'hidden' || !(vis(c) || (c.parentElement && vis(c.parentElement)))) return;
    push('control', c.id, { el: c, id: c.id, title: norm(c.getAttribute('aria-label') || c.title || c.name || ''), w: 0, h: 0 }); });
  // blocs de texte : notes de source, lectures, paragraphes (texte propre d'au moins 40 caractères)
  const SKIP = 'script, style, canvas, svg, table, select, option, button, .tab-btn, .kpi-card, .leaflet-container, noscript';
  const walker = document.createTreeWalker(pg, NodeFilter.SHOW_ELEMENT);
  let e;
  while ((e = walker.nextNode())) {
    if (e.closest(SKIP)) continue;
    let own = '';
    e.childNodes.forEach(n => { if (n.nodeType === 3) own += n.textContent; });
    own = norm(own);
    if (own.length < 40 || !vis(e)) continue;
    const full = norm(e.textContent);
    push('text', page + '/' + lab(full), { el: e, title: full.slice(0, 110), w: 0, h: 0, len: full.length });
  }
  return { page, items, scrollH: (document.querySelector('main.main') || document.documentElement).scrollHeight, clientW: document.documentElement.clientWidth,
    scrollW: Math.max(document.documentElement.scrollWidth, (document.querySelector('main.main') || {}).scrollWidth || 0),
    crumb: norm((([...pg.querySelectorAll('.pr-breadcrumb')].find(b => b.offsetParent !== null)) || {}).textContent || '') };
}
"""


def run(url, beta, lang, width, only, want_requests, light=False):
    views, errors, requests = [], [], {}
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True)
        except Exception:
            browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(viewport={"width": width, "height": 900}, device_scale_factor=1)
        init = f"try {{ localStorage.setItem('pk-lang', '{lang}'); localStorage.setItem('pk-beta', '{'1' if beta else '0'}');"
        init += " localStorage.setItem('pk-theme', 'light');" if light else ""
        init += " } catch (e) {}"
        ctx.add_init_script(init)
        page = ctx.new_page()
        cur = {"label": "boot"}
        page.on("pageerror", lambda e: errors.append({"view": cur["label"], "error": str(e)[:300]}))
        page.on("console", lambda m: errors.append({"view": cur["label"], "console": m.text[:300]}) if m.type == "error" else None)

        def on_resp(r):
            u = r.url
            if "/data/" in u or u.endswith(".json") or ".json?" in u or ".csv" in u:
                path = u.split("?")[0]
                path = path.split("/", 3)[3] if path.count("/") >= 3 else path
                requests.setdefault(path, {"status": r.status, "views": []})
                if cur["label"] not in requests[path]["views"]:
                    requests[path]["views"].append(cur["label"])
        if want_requests:
            page.on("response", on_resp)

        page.goto(url, wait_until="networkidle", timeout=120000)
        page.wait_for_timeout(3000)
        routes = page.evaluate("() => (window.PKBeta && PKBeta.on && PKBeta.routes ? PKBeta.routes() : (window.PKNav ? PKNav.entries() : [])).map(e => e.route)")
        routes = list(dict.fromkeys(routes + EXTRA_ROUTES))
        if only:
            routes = [r for r in routes if any(r.startswith(o) for o in only)]
        print(f"{len(routes)} adresses ({'bêta' if beta else 'site actuel'}, {lang}, {width} px)")
        seen = set()

        def settle(first_ms, max_ms=12000):
            # attend que la vue ne change plus : 3 relevés identiques à 500 ms d'écart, sans indicateur de chargement
            page.wait_for_timeout(first_ms)
            last, same, t = None, 0, first_ms
            while t < max_ms:
                sig = page.evaluate(JS_SETTLE)
                same = same + 1 if sig == last else 0
                last = sig
                part = sig.split("/")
                # stable, rien en cours de chargement, et tous les canvas affichés sont dessinés (sinon on patiente 7 s)
                if same >= 2 and part[2:3] == ["0"] and (part[0] == part[1] or t >= 7000):
                    break
                page.wait_for_timeout(500)
                t += 500

        def measure(route, label, tab=None):
            cur["label"] = label
            settle(WAIT_VIEW_MS)
            n = page.evaluate(JS_UNFOLD)
            if n:
                settle(700, 6000)
            d = page.evaluate(JS_ITEMS)
            d.update(route=route, label=label, tab=tab, hash=page.evaluate("() => location.hash"), unfolded=n)
            views.append(d)
            k = {}
            for it in d["items"]:
                k[it["kind"]] = k.get(it["kind"], 0) + 1
            print(f"  - {label}: " + ", ".join(f"{v} {kk}" for kk, v in sorted(k.items())))

        for route in routes:
            cur["label"] = route
            try:
                page.keyboard.press("Escape")
                ok = page.evaluate("r => (window.PKNav ? PKNav.go(r) : false)", route)
            except Exception as e:
                errors.append({"view": route, "error": "unreachable: " + str(e)[:200]})
                continue
            if ok is False:
                errors.append({"view": route, "error": "unknown route"})
                continue
            page.wait_for_timeout(700)
            key = page.evaluate(JS_VIEW_KEY)
            tabs = page.evaluate(JS_TABS)
            act = " > ".join(t["label"] for t in tabs if t["active"])
            if key not in seen:
                seen.add(key)
                measure(route, route + (f" > {act}" if act else ""))
            done = {t["label"] for t in tabs if t["active"]}
            queue = [t for t in tabs if not t["active"] and t["label"]]
            guard = 0
            while queue and guard < 40:
                guard += 1
                t = queue.pop(0)
                if t["label"] in done:
                    continue
                done.add(t["label"])
                try:
                    if t.get("parent"):   # un sous-onglet : son onglet de groupe d'abord
                        page.evaluate(JS_CLICK_TAB, t["parent"])
                        page.wait_for_timeout(300)
                    if not page.evaluate(JS_CLICK_TAB, t["label"]):
                        errors.append({"view": f"{route} > {t['label']}", "error": "tab not found"})
                        continue
                except Exception as e:
                    errors.append({"view": f"{route} > {t['label']}", "error": str(e)[:200]})
                    continue
                page.wait_for_timeout(500)
                key2 = page.evaluate(JS_VIEW_KEY)
                # un onglet de groupe (Méthodes) fait apparaître des sous-onglets : à relever aussi
                for t2 in page.evaluate(JS_TABS):
                    if t2["label"] and t2["label"] not in done and not any(q["label"] == t2["label"] for q in queue):
                        if t2["sub"]:
                            t2["parent"] = t["parent"] if t.get("parent") else t["label"]
                        queue.append(t2)
                if key2 in seen:
                    continue
                seen.add(key2)
                measure(route, f"{route} > " + (t["parent"] + " > " if t.get("parent") else "") + t["label"], tab=t["label"])
        ctx.close()
        browser.close()
    return views, errors, requests


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=BASE_URL)
    ap.add_argument("--beta", action="store_true")
    ap.add_argument("--lang", default="fr")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--requests", action="store_true")
    ap.add_argument("--light", action="store_true")
    ap.add_argument("--out", default="audit_out/inventory.json")
    a = ap.parse_args()
    t0 = time.time()
    views, errors, requests = run(a.url, a.beta, a.lang, a.width, a.only, a.requests, a.light)
    kinds = {}
    keys = set()
    for v in views:
        for it in v["items"]:
            if it["key"] not in keys:
                keys.add(it["key"])
                kinds[it["kind"]] = kinds.get(it["kind"], 0) + 1
    out = {"meta": {"url": a.url, "beta": a.beta, "lang": a.lang, "width": a.width, "views": len(views), "unique": kinds,
                    "seconds": round(time.time() - t0), "date": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())},
           "views": views, "errors": errors, "requests": requests}
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"\n{len(views)} vues, éléments distincts : {kinds}, {len(errors)} erreurs, {round(time.time() - t0)} s → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
