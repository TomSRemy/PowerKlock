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
import json
import http.server
import os
import re
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('SMOKE_PORT', '8799'))
# charts fed live from Open-Meteo in the browser (rate-limited per address): not drawn = a warning, not a failure
LIVE_CANVASES = {'wx-forecast-canvas', 'hdd-canvas', 'hdd-cum', 'fc-hourly', 'fc-daily'}
# accepted, with the reason; anything else of the same kind fails the test
KNOWN_WARNINGS = {
    '[analysis] fullscreen #0: no overlay (custom handler?)',   # Market analysis opens its own full-page view
}
LIVE_WIDGETS = {'cb-intraday', 'cb-days', 'cb-fr-avg', 'kpi-fr-load', 'kpi-fr-net', 'kpi-hdd', 'wx-forecast', 'hdd', 'hdd-cum',
                'imb-intraday', 'imb-days', 'imb-dist', 'load-day'}


def _fc_neg_on_trial():
    """True while the live record of the price forecast does not justify showing it (same rule as js/pk-forecast.js):
    price: 30 days scored and a mean error at least 15 % below « tomorrow = today »;
    negative hours: 10 real negative days, 70 % of them flagged, at most 30 % false alarms."""
    try:
        with open(os.path.join(ROOT, 'data', 'neg_forecast.json'), encoding='utf-8') as f:
            live = json.load(f).get('live') or {}
    except (OSError, ValueError):
        return False
    lv = (live.get('models') or {}).get(live.get('current'))
    if not lv:
        return True
    price_ok = lv.get('days', 0) >= 30 and lv.get('naive_mae') and lv.get('mae') is not None and lv['mae'] <= 0.85 * lv['naive_mae']
    neg_ok = (lv.get('days_negative', 0) >= 10 and lv.get('caught', 0) / lv['days_negative'] >= 0.7
              and lv.get('days_flagged') and lv.get('false_alarms', 0) / lv['days_flagged'] <= 0.3)
    return not (price_ok or neg_ok)


# widgets hidden on purpose until their record justifies them: they show a marked "on trial" message instead of a chart.
# Accepted only while the data really says so; once the record is good enough, the chart must draw like any other.
TRIAL_WIDGETS = {'fc-neg': _fc_neg_on_trial}


# A day-ahead price not received yet from ENTSO-E is a data gap (data/data_gaps.json, Data status), not a broken page:
# the widget says so in plain words and, when it can, draws the latest delivery day that has the price
# (js/pk-core.js PK.gapText / PK.markGap). The element carries data-pk-gap="<day>:<zone,zone>" and, when an earlier
# day is drawn, data-pk-shown="<day>". Accepted only when the daily files confirm it: the day is the current delivery
# day (today or tomorrow, Paris time, one day of slack for a run that crosses midnight), none of the zones has a
# price in data/history/daily/<day>.json, and the day drawn instead does have it. A widget that claims a gap while
# the data is there, or that shows nothing at all, still fails.
def _paris_today():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo('Europe/Paris')).date()


def _zone_price(day, zone):
    try:
        with open(os.path.join(ROOT, 'data', 'history', 'daily', day + '.json'), encoding='utf-8') as f:
            z = (json.load(f).get('zones') or {}).get(zone)
    except (OSError, ValueError):
        return None
    return z.get('avg') if isinstance(z, dict) else None


def gap_problem(gap, shown, text):
    """None when the marker is true to the data files, else what is wrong with it"""
    from datetime import date, timedelta
    m = re.fullmatch(r'(\d{4}-\d{2}-\d{2}):([A-Z0-9_,]+)', gap or '')
    if not m:
        return f'unreadable gap marker {gap!r}'
    day, zones = m.group(1), m.group(2).split(',')
    t = _paris_today()
    if not (t - timedelta(days=1) <= date.fromisoformat(day) <= t + timedelta(days=1)):
        return f'gap claimed for {day}, not the current delivery day (older holes are filled by scripts/heal_price_gaps.py)'
    have = [z for z in zones if _zone_price(day, z) is not None]
    if have:
        return f'says the {",".join(have)} price of {day} is missing, but data/history/daily/{day}.json has it'
    if shown and not any(_zone_price(shown, z) is not None for z in zones):
        return f'draws {shown} instead, which has no {",".join(zones)} price either'
    if len((text or '').strip()) < 30:
        return 'no message for the reader'
    return None


GAP_JS = """[...document.querySelectorAll('[data-pk-gap]')].filter(e => e.offsetParent !== null || e.closest('.pkd-item'))
    .map(e => ({ gap: e.dataset.pkGap, shown: e.dataset.pkShown || '', text: e.innerText || e.textContent || '' }))"""
gaps_seen = {}


def check_gaps(page, tag):
    for g in page.evaluate(GAP_JS):
        bad = gap_problem(g['gap'], g['shown'], g['text'])
        if bad:
            errors.append(f"[{tag}] data gap marker: {bad}")
        else:
            gaps_seen.setdefault(g['gap'], set()).add(tag)


# Messages from third-party endpoints that CI cannot always reach.
NOISE = re.compile(r'Failed to load resource|net::ERR_|favicon|opendata\.elia|odre\.opendatasoft|open-meteo|supabase', re.I)

errors, warnings = [], []
# on a phone the page scrolls inside .main, not the document: a block wider than the screen shows as .main scrolling sideways
WIDER = "Math.max(document.documentElement.scrollWidth, (document.querySelector('.main') || {}).scrollWidth || 0) > 392"


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
    pages = [pg for pg in pages if f'id="page-{pg}"' in html]   # menu entries that open a tab of another page have no page of their own
    subs = sorted(set(re.findall(r'data-subdomain-panel="([\w-]+)"', html)))

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 1440, 'height': 900})
        p.add_init_script("try { localStorage.setItem('pk-lang', 'en') } catch (e) {}")   # the checks read English labels
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
                    line = f"[{where['v']}] fullscreen #{k}: no overlay (custom handler?)"
                    (warnings if line in KNOWN_WARNINGS else errors).append(line)
                p.evaluate("document.getElementById('pk-fs-overlay') && document.getElementById('pk-fs-overlay').remove()")

        for s in subs:
            where['v'] = 'prices/' + s
            p.evaluate(f"prSelectSubdomain('{s}')")
            p.wait_for_timeout(2500)
            fullscreen_buttons(f'[data-subdomain-panel="{s}"]')
        def check_views(scope, label, width):
            # every view tab of the page (views.js): charts drawn, no overflow, no empty space under charts
            n = p.evaluate(f"[...document.querySelectorAll('{scope} .pk-views .tab-btn')].length")
            for k in range(max(1, n)):
                if n:
                    p.evaluate(f"[...document.querySelectorAll('{scope} .pk-views .tab-btn')][{k}].click()")
                    p.wait_for_timeout(2200)
                tab = p.evaluate(f"((document.querySelectorAll('{scope} .pk-views .tab-btn')[{k}]) || {{}}).textContent || ''")
                # folded sections (the morning brief draws theirs when first opened): opened, so their charts are judged too
                if p.evaluate(f"(() => {{ const h = [...document.querySelectorAll('{scope} .hist-section-strong.collapsed > .hist-section-header')]; h.forEach(x => x.click()); return h.length; }})()"):
                    p.wait_for_timeout(2500)
                r = p.evaluate(f"""(() => {{
                    const root = document.querySelector('{scope}');
                    const vis = e => e.offsetParent !== null;
                    const undrawn = [...root.querySelectorAll('canvas')].filter(c => vis(c) && c.id && !c.closest('.leaflet-container') && !(window.Chart && Chart.getChart(c))
                        && !c.parentElement.querySelector('.no-data-msg')).map(c => c.id);
                    const gaps = [...root.querySelectorAll('.fuel-grid-2 > .chart-container')].filter(vis).map(card => {{
                        const c = card.querySelector('canvas'); if (!c || !vis(c) || !c.getBoundingClientRect().height) return null;   // a hidden chart is not a gap
                        const g = card.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom; return g > 90 ? (c.id || '?') + ' ' + Math.round(g) + 'px' : null; }}).filter(Boolean);
                    return {{ overflow: document.documentElement.scrollWidth > {width} + 2, undrawn, gaps }};
                }})()""")
                if r['undrawn']:
                    # a chart below the fold is drawn when it comes into view (IntersectionObserver): bring each one there
                    for c in r['undrawn']:
                        p.evaluate(f"(document.getElementById('{c}') || {{scrollIntoView(){{}}}}).scrollIntoView({{block: 'center'}})")
                        p.wait_for_timeout(1500)
                    drawn = lambda c: p.evaluate(f"!!(window.Chart && Chart.getChart(document.getElementById('{c}')))")
                    for _ in range(13):   # some read dozens of daily files: up to 8 s more
                        if all(drawn(c) for c in r['undrawn']): break
                        p.wait_for_timeout(500)
                    r['undrawn'] = [c for c in r['undrawn'] if not drawn(c)]
                tag = f"{label}{(' › ' + tab) if tab else ''}"
                check_gaps(p, tag)
                if r['overflow']:
                    errors.append(f"[{tag}] wider than the screen ({width}px)")
                # deterministic layout defects fail the test (a known one is listed in KNOWN_WARNINGS with its reason)
                for c in r['undrawn']:
                    line = f"[{tag}] canvas {c} not drawn"
                    (warnings if line in KNOWN_WARNINGS or c in LIVE_CANVASES else errors).append(line)
                for g in r['gaps']:
                    line = f"[{tag}] empty space under chart {g}"
                    (warnings if line in KNOWN_WARNINGS else errors).append(line)

        for pg in pages:
            if pg == 'prices':
                continue
            where['v'] = pg
            # a group's name in the menu folds its pages (it does not open one): pages are opened directly here,
            # the menu itself is checked by tests/test_site_logic.py and the French pass below
            p.evaluate(f"showPage('{pg}')")
            p.wait_for_timeout(3500)
            fullscreen_buttons(f'#page-{pg}')
            check_views(f'#page-{pg}', pg, 1440)
        for s in subs:
            if s in ('genmix',):
                continue
            where['v'] = 'prices/' + s
            p.evaluate("showPage('prices')")
            p.evaluate(f"prSelectSubdomain('{s}')")
            p.wait_for_timeout(2000)
            check_views(f'[data-subdomain-panel="{s}"]', 'prices/' + s, 1440)

        # Tools that compute in the page: they must give a result, not only draw
        where['v'] = 'tools'
        if p.evaluate("!!document.getElementById('pp-cr-kpis')"):
            p.evaluate("showPage('ppapricer')"); p.wait_for_timeout(3000)
            p.evaluate("[...document.querySelectorAll('#page-ppapricer .pk-views .tab-btn')].find(b => /M0/.test(b.textContent)).click()"); p.wait_for_timeout(6000)
            t = p.evaluate("document.getElementById('pp-cr-kpis').innerText")
            if '%' not in t or 'NaN' in t:
                errors.append(f"[tools] M0 contract: no result ({t[:80]!r})")
        if p.evaluate("!!document.getElementById('cf-ex')"):
            p.evaluate("showPage('carbonfoot')"); p.wait_for_timeout(1500)
            p.evaluate("document.getElementById('cf-example').click()"); p.wait_for_timeout(9000)
            p.evaluate("[...document.querySelectorAll('#page-carbonfoot .pk-views .tab-btn')].find(b => b.textContent === 'Carbon').click()"); p.wait_for_timeout(1500)
            p.evaluate("(document.querySelector('#cf-ex td[data-a]') || {click(){}}).click()"); p.wait_for_timeout(800)
            if 'g/kWh' not in p.evaluate("document.getElementById('cf-ex-detail').innerText"):
                errors.append('[tools] carbon explorer: a click on the matrix opens no detail')

        # Quick search opens and finds a chart
        where['v'] = 'search'
        p.keyboard.press('Control+k')
        p.wait_for_timeout(300)
        p.keyboard.type('gas storage')
        p.wait_for_timeout(300)
        if not p.evaluate("document.querySelectorAll('#pk-search .pk-s-row').length"):
            errors.append('[search] no result for "gas storage"')
        p.keyboard.press('Escape')
        p.keyboard.press('Control+k'); p.wait_for_timeout(300); p.keyboard.type('prix négatifs'); p.wait_for_timeout(300)
        if not p.evaluate("document.querySelectorAll('#pk-search .pk-s-row').length"):
            errors.append('[search] no result for "prix négatifs" (French words)')
        p.keyboard.press('Escape')

        # Phone width: nothing wider than the screen (separate page: the
        # fullscreen tests leave the desktop window in fullscreen mode)
        ph = b.new_page(viewport={'width': 390, 'height': 844})
        ph.add_init_script("try { localStorage.setItem('pk-lang', 'en') } catch (e) {}")
        ph.on('pageerror', lambda e: errors.append(f"[phone] JS error: {str(e)[:300]}"))
        ph.goto(f'http://127.0.0.1:{PORT}/index.html')
        ph.wait_for_timeout(5000)
        for pg in pages:
            if pg == 'prices':
                continue
            ph.evaluate(f"showPage('{pg}')")
            ph.wait_for_timeout(1500)
            if ph.evaluate(WIDER):
                errors.append(f"[phone/{pg}] wider than the screen (390px)")
        # Today's Expert view, where most of the morning's tables and lists live
        ph.evaluate("showPage('morning')"); ph.wait_for_timeout(1500)
        ph.evaluate("document.querySelectorAll('#page-morning button').forEach(b => { if (/Expert/.test(b.textContent)) b.click(); })")
        ph.wait_for_timeout(3000)
        if ph.evaluate(WIDER):
            errors.append("[phone/morning expert] wider than the screen (390px)")
        ph.close()

        # French, the default language: every address of the menu opens its page without an error,
        # the browser Back button stays on the site, and no number keeps the English decimal point
        fr = b.new_page(viewport={'width': 1440, 'height': 900})
        fr.add_init_script("try { localStorage.setItem('pk-lang', 'fr') } catch (e) {}")
        fr.on('pageerror', lambda e: errors.append(f"[fr] JS error: {str(e)[:300]}"))
        fr.goto(f'http://127.0.0.1:{PORT}/index.html')
        fr.wait_for_timeout(7000)
        routes = fr.evaluate("[...new Set(PKNav.entries().map(e => e.route))]")
        for r in routes:
            fr.evaluate(f"PKNav.go('{r}')")
            fr.wait_for_timeout(1000)
            st = fr.evaluate("[location.hash, !!(document.querySelector('.page.active') || document.querySelector('#page-mydash.active'))]")
            if st[0] != '#' + r or not st[1]:
                errors.append(f"[fr/{r}] address or page not shown: {st}")
        fr.go_back(); fr.wait_for_timeout(800)
        if fr.evaluate("location.hash") != '#' + routes[-2]:
            errors.append('[fr] browser Back does not go to the previous page')
        fr.evaluate("PKNav.go('today')"); fr.wait_for_timeout(2500)
        dots = fr.evaluate(r"(document.querySelector('.page.active').innerText.match(/(^|[^\w.])\d+\.\d+(?![\w.]?\d)/g) || []).length")
        if dots:
            errors.append(f"[fr/today] {dots} numbers still with a decimal point")
        fr.close()

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
            // a widget drawn on its own canvas without Chart.js (js/spiral.js) marks it data-pk-drawn="1" once painted
            const own = !!el.querySelector('canvas[data-pk-drawn="1"]');
            return { wid: it.wid, chart: !!ch || html || own, kpi: !!el.querySelector('.pkd-kpi .pkd-kpi-v:not(.pkd-kpi-na)'),
                     trial: ((el.querySelector('.no-data-msg[data-pk-trial]') || {}).dataset || {}).pkTrial || '',
                     gap: ((el.querySelector('.no-data-msg[data-pk-gap], .pkd-kpi[data-pk-gap]') || {}).dataset || {}).pkGap || '',
                     gapText: (el.querySelector('.no-data-msg[data-pk-gap], .pkd-kpi[data-pk-gap]') || {}).innerText || '',
                     msg: (el.querySelector('.no-data-msg, .pkd-empty-w, .pkd-loading') || {}).innerText || '' };
        })""")
        for r in res:
            trial = TRIAL_WIDGETS.get(r['wid'])
            if trial and (r['trial'] == r['wid']) != trial():
                # the message and the record disagree: hidden although it has proved itself, or drawn although it has not
                errors.append(f"[catalogue] {r['wid']}: {'on trial' if r['trial'] else 'shown'}, but its live record says the opposite")
                continue
            if r['chart'] or r['kpi'] or (trial and r['trial'] == r['wid'] and len(r['msg'].strip()) > 40):
                continue
            # the price of the day not received yet: its message is the right state (the marker is checked below)
            if r['gap'] and not gap_problem(r['gap'], '', r['gapText']):
                continue
            line = f"[catalogue] {r['wid']}: not drawn ({r['msg'].strip()[:120] or 'empty'})"
            (warnings if r['wid'] in LIVE_WIDGETS else errors).append(line)
        check_gaps(p, 'catalogue')

        # the public landing page (landing.html, js/landing.js): every figure loads from data/landing.json, no JS
        # error, nothing wider than the screen, in French and in English, on a phone and on a computer
        for lang in ('fr', 'en'):
            for wd in (390, 1280):
                lp = b.new_page(viewport={'width': wd, 'height': 860})
                lp.add_init_script(f"try {{ localStorage.setItem('pk-lang', '{lang}') }} catch (e) {{}}")
                tag = f'landing/{lang}/{wd}'
                lp.on('pageerror', lambda e, t=tag: errors.append(f"[{t}] JS error: {str(e)[:300]}"))
                lp.goto(f'http://127.0.0.1:{PORT}/landing.html', wait_until='load')
                lp.wait_for_timeout(2500)
                h = lp.evaluate('document.documentElement.scrollHeight')
                for y in range(0, h, 400):
                    lp.evaluate(f'scrollTo(0, {y})')
                    lp.wait_for_timeout(60)
                st = lp.evaluate("""() => ({ nodata: document.documentElement.classList.contains('pk-nodata'), sw: document.documentElement.scrollWidth,
                    map: !!(window.Chart && Chart.getChart(document.getElementById('c-map'))) })""")
                if st['nodata']:
                    errors.append(f"[{tag}] data/landing.json or the map outline did not load")
                if st['sw'] > wd:
                    errors.append(f"[{tag}] wider than the screen ({st['sw']}px)")
                if not st['map']:
                    errors.append(f"[{tag}] the Europe map is not drawn")
                lp.close()
        b.close()
    srv.shutdown()

    print(f"Pages {len(pages)} · sub-pages {len(subs)} · catalogue widgets {len(ids)}")
    for g, where_ in sorted(gaps_seen.items()):
        print('GAP  ', g, '(price not received yet, confirmed by the data files) shown as such on:', ', '.join(sorted(where_)))
    for w in warnings:
        print('WARN ', w)
    for e in errors:
        print('ERROR', e)
    print('FAILED' if errors else 'PASSED', f'({len(errors)} errors, {len(warnings)} warnings)')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
