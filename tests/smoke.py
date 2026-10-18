#!/usr/bin/env python3
"""
PowerKlock smoke tests — run before anything reaches the live site.

Serves the repository with a local HTTP server, opens it in headless
Chromium and checks that:
  1. the site boots without a JavaScript error;
  2. every page, sub-page and dashboard view opens without an error;
  3. every visible fullscreen button opens the overlay (no error toast);
  4. every chart and key figure of the dashboard catalogue draws.

Charts fed by live third-party APIs (RTE éCO2mix, Elia, Open-Meteo) can be
unreachable from CI: their failures are reported as warnings, not errors.

    pip install playwright && python -m playwright install chromium
    python tests/smoke.py            # exit code 1 on any error
"""
import functools
import http.server
import os
import re
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('SMOKE_PORT', '8799'))
LIVE_WIDGETS = {'cb-intraday', 'cb-days', 'cb-fr-avg', 'kpi-fr-load', 'kpi-fr-net', 'kpi-hdd', 'wx-forecast', 'hdd', 'hdd-cum',
                'imb-intraday', 'imb-days', 'imb-dist', 'load-day'}
# Messages from third-party endpoints that CI cannot always reach.
NOISE = re.compile(r'Failed to load resource|net::ERR_|favicon|opendata\.elia|odre\.opendatasoft|open-meteo|supabase', re.I)

errors, warnings = [], []


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    srv = serve()
    html = open(os.path.join(ROOT, 'index.html')).read()
    pages = list(dict.fromkeys(re.findall(r'id="nav-([\w-]+)"', html)))
    subs = sorted(set(re.findall(r'data-subdomain-panel="([\w-]+)"', html)))

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 1440, 'height': 900})
        where = {'v': 'boot'}
        p.on('pageerror', lambda e: errors.append(f"[{where['v']}] JS error: {str(e)[:300]}"))
        p.on('console', lambda m: (m.type == 'error' and not NOISE.search(m.text)) and warnings.append(f"[{where['v']}] console: {m.text[:200]}"))
        p.goto(f'http://127.0.0.1:{PORT}/index.html')
        p.wait_for_timeout(6000)

        def fullscreen_buttons(scope):
            n = p.evaluate(f"[...document.querySelectorAll('{scope} button.pk-tool-fs')].filter(b => b.offsetParent).length")
            for k in range(n):
                p.evaluate(f"[...document.querySelectorAll('{scope} button.pk-tool-fs')].filter(b => b.offsetParent)[{k}].click()")
                p.wait_for_timeout(700)
                state = p.evaluate("""(() => { const e = document.getElementById('pk-fs-error'); if (e) { const t = e.textContent; e.remove(); return 'error: ' + t; }
                    return document.getElementById('pk-fs-overlay') ? 'ok' : 'none'; })()""")
                if state.startswith('error'):
                    errors.append(f"[{where['v']}] fullscreen #{k}: {state}")
                elif state == 'none':
                    warnings.append(f"[{where['v']}] fullscreen #{k}: no overlay (custom handler?)")
                p.evaluate("document.getElementById('pk-fs-overlay') && document.getElementById('pk-fs-overlay').remove()")

        for s in subs:
            where['v'] = 'prices/' + s
            p.evaluate(f"prSelectSubdomain('{s}')")
            p.wait_for_timeout(2500)
            fullscreen_buttons(f'[data-subdomain-panel="{s}"]')
        for pg in pages:
            if pg == 'prices':
                continue
            where['v'] = pg
            p.evaluate(f"document.getElementById('nav-{pg}').click()")
            p.wait_for_timeout(3500)
            fullscreen_buttons(f'#page-{pg}')
        for d in ('france', 'mydash'):
            where['v'] = d
            p.evaluate(f"switchDashboard('{d}', document.querySelector('.nav-tab[data-dash={d}]'))")
            p.wait_for_timeout(3500)

        # Every catalogue widget on one dashboard.
        where['v'] = 'catalogue'
        ids = p.evaluate("PKW.list().map(w => w.id)")
        p.evaluate("""(() => {
            const items = PKW.list().map((w, k) => ({ i: 'w' + k, t: 'w', wid: w.id, w: Math.max(4, w.size.w), h: w.size.h }));
            localStorage.setItem('pk-dash-v2', JSON.stringify({ v: 2, active: 't', boards: [{ id: 't', name: 'Smoke', items }] }));
        })()""")
        p.reload()
        p.wait_for_timeout(5000)
        p.evaluate("switchDashboard('mydash', document.querySelector('.nav-tab[data-dash=mydash]'))")
        p.wait_for_timeout(3000)
        for k, wid in enumerate(ids):
            p.evaluate(f"document.querySelector('.grid-stack-item[data-i=\"w{k}\"]').scrollIntoView()")
            p.wait_for_timeout(250)
        p.wait_for_timeout(8000)
        res = p.evaluate("""[...document.querySelectorAll('#pkd-grid .pkd-item[data-kind="w"]')].map(el => {
            const it = el._item, c = el.querySelector('canvas'), ch = c && Chart.getChart(c);
            const txt = el.querySelector('.pkd-body').innerText;
            const html = !c && !el.querySelector('.no-data-msg, .pkd-empty-w, .pkd-loading, .pkd-kpi') && txt.trim().length > 40;
            return { wid: it.wid, chart: !!ch || html, kpi: !!el.querySelector('.pkd-kpi .pkd-kpi-v:not(.pkd-kpi-na)'),
                     msg: (el.querySelector('.no-data-msg, .pkd-empty-w, .pkd-loading') || {}).innerText || '' };
        })""")
        for r in res:
            if r['chart'] or r['kpi']:
                continue
            line = f"[catalogue] {r['wid']}: not drawn ({r['msg'].strip()[:120] or 'empty'})"
            (warnings if r['wid'] in LIVE_WIDGETS else errors).append(line)
        b.close()
    srv.shutdown()

    print(f"Pages {len(pages)} · sub-pages {len(subs)} · catalogue widgets {len(ids)}")
    for w in warnings:
        print('WARN ', w)
    for e in errors:
        print('ERROR', e)
    print('FAILED' if errors else 'PASSED', f'({len(errors)} errors, {len(warnings)} warnings)')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
