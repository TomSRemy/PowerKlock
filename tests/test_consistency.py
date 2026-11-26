"""Figures that must agree across pages, and the weight of the home page.
  1. France's daily average for today and yesterday: same value on Today (spot cards), Day-ahead (table) and the
     data file (the published average, which counts the repeated hour of a 25-hour day)
  2. the home page (Today, Expert view) downloads less than 20 MB on first load
  3. the same lists everywhere: alert kinds in both forms (js/alerts.js, js/onboarding.js), the sender
     (scripts/alerts.py) and the database check (latest migration); news subjects in the site (js/news.js) and the
     database check. A kind or subject added in one place only fails here, before it reaches members.
Serves the repository itself, like test_site_logic.py.   python3 tests/test_consistency.py"""
import functools
import http.server
import json
import os
import re
import sys
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('SMOKE_PORT', '8799')) + 2
BUDGET_MB = 20   # Expert view, every section loaded: 16.6 MB on 26 Oct 2026 (39.8 before the light files)
fails = []


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def num(s):
    m = re.search(r'-?\d[\d\s ]*[,.]\d+', s or '')
    return float(m.group(0).replace(' ', '').replace(' ', '').replace(',', '.')) if m else None


def last_check(name):
    """The values allowed by a database check, from the last migration that (re)defines it."""
    vals = None
    for f in sorted(os.listdir(os.path.join(ROOT, 'warehouse', 'migrations'))):
        s = open(os.path.join(ROOT, 'warehouse', 'migrations', f)).read()
        for m in re.finditer(r'add constraint ' + name + r'\b(.*?);', s, re.S):
            vals = set(re.findall(r"'(\w+)'", m.group(1)))
    return vals or set()


def block_keys(path, start, pat):
    s = open(os.path.join(ROOT, path)).read()
    i = s.index(start)
    return set(re.findall(pat, s[i:s.index('\n  };', i) if '{' in start else s.index('\n];', i)]))


def same_lists():
    al = {
        'js/alerts.js': block_keys('js/alerts.js', 'const KINDS = {', r'\n    (\w+): \{ label'),
        'js/onboarding.js': block_keys('js/onboarding.js', 'const AL = {', r'\n    (\w+): \[T\('),
        'scripts/alerts.py': set(re.findall(r"'(\w+)'", re.search(r'^KINDS = \((.*?)\)', open(os.path.join(ROOT, 'scripts', 'alerts.py')).read(), re.M).group(1))),
        'database (alert_rule_kind_check)': last_check('alert_rule_kind_check'),
    }
    subj = {'js/news.js': block_keys('js/news.js', 'const PK_INTERESTS = [', r"\['([a-z_]+)', '"),   # group names start with a capital
            'database (news_profile_interests_check)': last_check('news_profile_interests_check')}
    for what, d in (('alert kinds', al), ('news subjects', subj)):
        ref = set().union(*d.values())
        bad = {k: sorted(ref - v) for k, v in d.items() if ref - v}
        if bad or not all(d.values()):
            fails.append(f'{what} differ: missing ' + '; '.join(f'{k}: {v}' for k, v in bad.items()))
        else:
            print(f'ok   {what}: the same {len(ref)} everywhere ({", ".join(d)})')


def main():
    same_lists()
    srv = serve()
    base = f'http://127.0.0.1:{PORT}/index.html'
    paris = datetime.now(ZoneInfo('Europe/Paris')).date()
    files = {}
    for d in (paris, paris - timedelta(days=1)):
        p = os.path.join(ROOT, 'data', 'history', 'daily', d.isoformat() + '.json')
        if os.path.exists(p):
            z = (json.load(open(p)).get('zones') or {}).get('FR') or {}
            if z.get('avg') is not None:
                files[d.isoformat()] = z['avg']
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 1440, 'height': 900})
        pg.add_init_script("localStorage.setItem('pk-lang','fr');localStorage.setItem('pk-first-done','1');sessionStorage.setItem('pk-view-morning','2')")
        sizes = []
        pg.on('response', lambda r: sizes.append(r) if r.url.startswith(f'http://127.0.0.1:{PORT}/') else None)
        pg.goto(base + '#today')
        pg.wait_for_timeout(9000)
        total = 0
        for r in sizes:
            try:
                total += len(r.body()) if r.status == 200 else 0
            except Exception:   # noqa: BLE001 — a body already gone counts as nothing
                pass
        mb = total / 1e6
        (fails.append(f'home page weighs {mb:.1f} MB (budget {BUDGET_MB} MB)') if mb > BUDGET_MB else print(f'ok   home page {mb:.1f} MB (budget {BUDGET_MB} MB)'))
        # Today's spot cards: title (date) → average
        cards = pg.evaluate("""[...document.querySelectorAll('#mrn2 .mrn-3d .mu-day')].map(d => [ (d.querySelector('.mu-day-dl')||{}).textContent || '', (d.querySelector('.mu-day-avg')||{}).textContent || '' ])""")
        today_vals = [num(v) for _, v in cards if num(v) is not None]
        pg.goto(base + '#markets/spot')
        pg.wait_for_timeout(7000)
        fr_row = pg.evaluate("(()=>{const r=[...document.querySelectorAll('#prices-tbody tr.zone-row')].find(r=>/\\bFR\\b/.test(r.cells[0]&&r.cells[0].textContent)); return r ? r.cells[2].textContent : null})()")
        b.close()
    srv.shutdown()
    for d, v in files.items():
        if not any(abs(x - v) < 0.006 for x in today_vals):
            fails.append(f'Today shows {today_vals} for France, the published average of {d} is {v}')
        else:
            print(f'ok   Today = published average for {d} ({v})')
    if fr_row is not None and files:
        latest = max(files)
        if abs((num(fr_row) or -1) - files[latest]) >= 0.006:
            fails.append(f'Day-ahead shows {fr_row} for France, the published average of {latest} is {files[latest]}')
        else:
            print(f'ok   Day-ahead = published average for {latest} ({files[latest]})')
    for f in fails:
        print('FAIL', f)
    print('PASSED (0 failed)' if not fails else f'FAILED ({len(fails)})')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
