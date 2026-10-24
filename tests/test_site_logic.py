"""
Site logic checked in a browser, value by value (tests/smoke.py checks that pages draw; this checks what they say):
French formats, table sorting on French numbers, chart colours, capture price, navigation, PPA pricer output.

    python3 tests/test_site_logic.py        (serves the repository itself on SMOKE_PORT + 1)
"""
import http.server, os, sys, threading, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('SMOKE_PORT', '8799')) + 1
fails = []


def check(name, ok, detail=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else ' · ' + str(detail)[:300]))
    if not ok:
        fails.append(name)


def main():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{PORT}/index.html'
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 1440, 'height': 900})
        p.add_init_script("try { localStorage.setItem('pk-lang', 'fr') } catch (e) {}")
        errs = []
        p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.goto(url)
        p.wait_for_timeout(8000)

        # ── French formats (js/i18n.js) ──
        t = lambda s: p.evaluate('s => PKI18n.tr(s)', s)
        check('1,234.5 € → 1 234,5 €', t('1,234.5 €') == '1 234,5 €', repr(t('1,234.5 €')))
        check('a translated text is not formatted twice', t(t('1.234 €')) == '1,234 €', repr(t(t('1.234 €'))))
        check('versions, codes and times left alone', t('v0.20.3 · Cal2027 · 07:42') == 'v0.20.3 · Cal2027 · 07:42', t('v0.20.3 · Cal2027 · 07:42'))
        check('template: computed sentence in French', t('Oct 2026 so far: 153.1 €/MWh · high · +76.8 vs 12-month mean')
              == 'oct. 2026 à date : 153,1 €/MWh · haut · +76,8 vs moyenne 12 mois', t('Oct 2026 so far: 153.1 €/MWh · high · +76.8 vs 12-month mean'))
        check('day and month names next to a date', t('Sat, 24 Oct 2026') == 'sam. 24 oct. 2026', t('Sat, 24 Oct 2026'))
        check('English label behind a French one (KPI colour rules)', p.evaluate("pkEN(PKI18n.tr('Market analysis'))") == 'Market analysis')

        # ── table sorting reads French numbers (js/libs.js sortGenericTable) ──
        order = p.evaluate("""(() => {
            const t = document.createElement('table'); t.innerHTML = '<thead><tr><th>v</th></tr></thead><tbody id="pk-t-sort"></tbody>';
            document.body.appendChild(t);
            const tb = t.querySelector('tbody');
            ['1 234,5', '−0,22', '12,5', '300'].forEach(v => { const tr = document.createElement('tr'); tr.innerHTML = '<td>' + v + '</td>'; tb.appendChild(tr); });
            sortGenericTable('pk-t-sort', 0, t.querySelector('th'));
            const r = [...tb.querySelectorAll('td')].map(td => td.textContent); t.remove(); return r; })()""")
        nums = [float(x.replace(' ', '').replace('−', '-').replace(',', '.')) for x in order]
        check('table sort on French numbers', nums in (sorted(nums), sorted(nums, reverse=True)), order)

        # ── chart colours: series 9 to 30 distinct (js/palette.js) ──
        lab = p.evaluate("_hexToLab('#14D3A9')")
        check('colour distance computed (Lab)', all(isinstance(v, (int, float)) for v in lab), lab)
        check('30 series, 30 colours', p.evaluate("new Set([...Array(30)].map((_, i) => getSeriesColor(i))).size") == 30)

        # ── capture price (js/analysis.js) ──
        cp = p.evaluate("_renCapture([10, 0, 30], [50, -10, 20])")
        check('capture price: output-weighted', abs(cp - 27.5) < 1e-9, cp)
        cp = p.evaluate("_renCapture([10, 10], [40, 40, 60, 60])")   # 4 prices for 2 output slots: averaged
        check('capture price: prices averaged on the output time step', abs(cp - 50) < 1e-9, cp)

        # ── navigation (js/nav-v2.js) ──
        p.evaluate("PKNav.go('tools/ppa')"); p.wait_for_timeout(1500)
        p.evaluate("PKNav.go('system/generation/outages')"); p.wait_for_timeout(1500)
        p.go_back(); p.wait_for_timeout(1200)
        check('Back goes to the previous page', p.evaluate("[location.hash, document.querySelector('.page.active').id]") == ['#tools/ppa', 'page-ppapricer'],
              p.evaluate("[location.hash, document.querySelector('.page.active').id]"))
        p.evaluate("history.pushState(null, '', '#nowhere/old'); dispatchEvent(new PopStateEvent('popstate'))"); p.wait_for_timeout(1200)
        check('unknown address: Today and a message', p.evaluate("[location.hash, !!document.querySelector('.pk-nv-notice')]") == ['#today', True])

        # ── menu: a group's name folds and unfolds its pages without leaving the page ──
        p.evaluate("PKNav.go('markets/spot/negative')"); p.wait_for_timeout(1200)
        isopen = lambda: p.evaluate("document.querySelector('.pk-nav-wrap[data-entry=\"markets/spot\"]').classList.contains('open')")
        p.click('.pk-nav-group[data-route="markets/spot"]'); p.wait_for_timeout(400); a1 = isopen()
        p.click('.pk-nav-group[data-route="markets/spot"]'); p.wait_for_timeout(400); a2 = isopen()
        check('menu: a group name folds then unfolds, the page stays', (a1, a2, p.evaluate("location.hash")) == (False, True, '#markets/spot/negative'), (a1, a2))

        # ── PPA pricer: the four methods give a price, all in a plausible range ──
        p.evaluate("PKNav.go('tools/ppa')"); p.wait_for_timeout(9000)
        vals = p.evaluate("[...document.querySelectorAll('#pp-resbar .pp-rb b')].map(b => parseFloat(b.textContent.replace(/[\\s\\u202f]/g, '').replace(',', '.')))")
        check('PPA pricer: at least 3 methods priced', len([v for v in vals if v == v]) >= 3, vals)
        check('PPA pricer: prices between 0 and 300 €/MWh', all(0 < v < 300 for v in vals if v == v), vals)

        # ── shared dashboard address left alone ──
        q = b.new_page(); q.goto(url + '#solo=jAAAA'); q.wait_for_timeout(5000)
        check('#solo= address not rewritten', q.evaluate("location.hash").startswith('#solo='), q.evaluate("location.hash"))
        check('no JavaScript error', not errs, errs)
        b.close()
    srv.shutdown()
    print('FAILED' if fails else 'PASSED', f'({len(fails)} failed)')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
