"""
PPA pricer on frozen data: the same inputs must give the same prices, to the cent. A change in these
figures means the pricing changed: deliberate (update EXPECTED below and say why in the commit) or a bug.

    python3 tests/test_ppa_frozen.py           (serves the repository on SMOKE_PORT + 2)
    python3 tests/test_ppa_frozen.py --print   (prints the figures, to update EXPECTED)

The data files the pricer reads that still change are frozen in tests/fixtures/ppa (gzip, taken on
2026-10-25); the past years of data/history/fr_hourly are final and read from the repository. The clock is
fixed on 2026-10-25 08:00 UTC, so "this year" and the tenor do not move.
To refresh the fixtures: copy the files listed in FILES from data/ (gzip), then run with --print.
"""
import functools, gzip, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures', 'ppa')
PORT = int(os.environ.get('SMOKE_PORT', '8799')) + 2
FILES = ['history/fr_capture.json', 'fr_market.json', 'go_prices.csv', 'history/capacity.json', 'history/fr_market_calchain.json',
         'history/fr_imbalance_cost.json', 'history/country_capture.json', 'history/hourly_cannib.json', 'history/fr_forward_monthly.json',
         'history/ppa_forecast.json', 'history/fr_regional_capture.json', 'cre_m0.json', 'history/ppa_backtest.json',
         'history/ppa_bias.json']   # ppa_bias.json frozen on 2026-10-28 (the others on 2026-10-25)
# technology, method settings → figures (€/MWh), 2 decimals
CASES = {
    'solar · defaults': {},
    'wind · defaults': {'tech': 'wind'},
    'solar · past discount, P80': {'method': 'pct', 'pct': 80},
}
EXPECTED = {   # fixtures of 2026-10-25; since 28 Oct. 2026 (decided by Tom): capacity trend × quoted-month factor k, forward shape with recent skeleton (solar) and c per season, past-bias correction (ppa_bias.json); 30 Oct. 2026: wind's forward-shape cannibalisation driven by the solar fleet (wind fpc 75.12 → 74.84); the decorrelated pricing (3) stopped at prices ≤ 0 on its own curve, as the test bench (solar fpc 33.24 → 41.37, wind 74.84 → 76.80)
    'solar · defaults': {'ppa': 54.31, 'build': 54.31, 'pct': 46.19, 'fpc': 41.37, 'ref': 84.05, 'go': 1.84, 'tenor': '2027-2028-2029'},
    'wind · defaults': {'ppa': 74.46, 'build': 74.46, 'pct': 81.12, 'fpc': 76.8, 'ref': 83.24, 'go': 1.84, 'tenor': '2027-2028-2029'},
    'solar · past discount, P80': {'ppa': 43.18, 'build': 54.31, 'pct': 43.18, 'fpc': 41.37, 'ref': 83.01, 'go': 1.84, 'tenor': '2027-2028-2029'},
}
fails = []


def check(name, ok, detail=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else ' · ' + str(detail)))
    if not ok:
        fails.append(name)


def main():
    show = '--print' in sys.argv

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    frozen = {f: gzip.open(os.path.join(FIX, f.replace('/', '__') + '.gz')).read() for f in FILES}
    got = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.clock.set_fixed_time('2026-10-25T08:00:00Z')
        def serve(body, kind):
            return lambda route: route.fulfill(status=200, body=body, content_type=kind)
        for f, body in frozen.items():
            p.route(f'**/data/{f}*', serve(body, 'text/csv' if f.endswith('.csv') else 'application/json'))
        p.goto(f'http://127.0.0.1:{PORT}/index.html#tools/ppa')
        p.wait_for_function('window.PKPpa && PKPpa.state', timeout=60000)
        p.wait_for_timeout(4000)
        for name, over in CASES.items():
            got[name] = p.evaluate("""async over => {
                const S = PKPpa.state, keep = {};
                Object.keys(over).forEach(k => { keep[k] = S[k]; });
                Object.assign(S, over);
                const o = await PKPpa.compute();
                Object.assign(S, keep);
                const r = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
                return { ppa: r(o.ppa), build: r(o.ppaBuild), pct: r(o.ppaPct), fpc: r(o.ppaFpc), ref: r(o.refP), go: r(o.goP), tenor: (o.tenor || []).join('-') };
            }""", over)
        check('no JavaScript error', not errs, errs[:3])
        b.close()
    srv.shutdown()
    if show:
        print('EXPECTED = {')
        for k, v in got.items():
            print(f'    {k!r}: {v!r},')
        print('}')
        return 0
    for name, v in got.items():
        exp = EXPECTED.get(name)
        check(f'PPA pricer, {name}: same figures as on the frozen data', exp == v, f'expected {exp}, got {v}')
    print('FAILED' if fails else 'PASSED', f'({len(fails)} failed)')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
