"""
PPA pricer on frozen data: the same inputs must give the same prices, to the cent. A change in these
figures means the pricing changed: deliberate (update EXPECTED below and say why in the commit) or a bug.

    python3 tests/test_ppa_frozen.py           (serves the repository on SMOKE_PORT + 2)
    python3 tests/test_ppa_frozen.py --print   (prints the figures, to update EXPECTED)

The data files the pricer reads that still change are frozen in tests/fixtures/ppa (gzip, taken on
2026-11-21 from main); the past years of data/history/fr_hourly are final and read from the repository. The clock is
fixed on 2026-11-21 12:00 UTC, so "this year" and the tenor do not move.
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
         'history/ppa_bias.json', 'history/ppa_error_replay.json', 'history/ppa_weights.json']   # all frozen on 2026-11-21
# technology, method settings → figures (€/MWh), 2 decimals
CASES = {
    'solar · defaults': {},
    'wind · defaults': {'tech': 'wind'},
    'solar · past discount, P80': {'method': 'pct', 'pct': 80},
}
EXPECTED = {   # fixtures of 2026-11-21; 21 Nov. 2026 (PPA review, branch, NOT yet approved by Tom for the live site): the published price's risk premium (lot 3): its model error grows from the replay's own mean lead to the middle of delivery (12.8 months, not 12), its draws let the captured price move as a share of the spot (the generator's capture of each year, no fitted sensitivity), it is hedged by default at the ratio that minimises the premium (5 % steps: solar 60 %, wind 95 %) and a part year with the forward of its months (gen solar 40.03 -> 40.50, wind 65.65 -> 66.20; build, pct and fpc do not move); 21 Nov. 2026 (PPA review, on a branch, NOT yet approved by Tom for the live site): the published price's model-error premium grows as the square root of the horizon beyond the replay's 12 months, and its hedge and volume premiums are drawn on the generator's own capture instead of the capacity trend's (gen solar 40.44 → 40.03, wind 65.93 → 65.65); 21 Nov. 2026 (Tom, PPA review): the forward shape's forward term (2) stops strictly below 0 on its own curve, as its terms (1) and (3) already did (solar fpc 36.54 → 41.78, wind 68.08 → 68.32; the published price 'gen' does not move); 21 Nov. 2026 (Tom): fixtures refreshed from main (clock 2026-11-21 12:00 UTC) and the published price (scenario generator, 'gen') added, so the test protects the real site price; ppa_error_replay.json (the generator's dynamic premium) and ppa_weights.json frozen too; the old fr_capture fixture still stopped at prices ≤ 0 while fr_hourly stops strictly below 0, so the methods mixed two rules (solar build 53.66 → 41.70, fpc 39.78 → 36.54, P80 43.43 → 24.63; wind build 77.07 → 66.54, fpc 73.93 → 68.08; gen solar 40.44, wind 65.93; forwards and fleet of 21 Nov.); before, fixtures of 2026-10-25; 21 Nov. 2026 (Tom): past bias no longer removed from capacity trend and forward shape (it measured the 2024 fall of the solar capture, and replayed on 2026 it worsened 8 cases in 8; still applied to weather simulation and European model): solar fpc 33.74 → 39.78, wind build 74.20 → 77.07; 1 Nov. 2026 (Tom), the Monte Carlo's captured price moves with the spot by its measured sensitivity (same month a year apart, 3 years) instead of as a share of it, and the forward's volatility by maturity (Cal+1 to Cal+3): capacity trend solar 53.22 → 54.68, wind 74.52 → 74.18; then the sensitivity measured on recent years only (both years since two years before the clock): solar 54.68 → 53.66, wind 74.18 → 74.20; 1 Nov. 2026 (Tom): the park stops strictly below 0 €/MWh, an hour at 0 is produced and paid 0 (forward shape solar 40.35 → 33.74, wind 76.48 → 73.93; the other methods read the frozen daily sums); since 28 Oct. 2026 (decided by Tom): capacity trend × quoted-month factor k, forward shape with recent skeleton (solar) and c per season, past-bias correction (ppa_bias.json); 30 Oct. 2026: wind's forward-shape cannibalisation driven by the solar fleet (wind fpc 75.12 → 74.84); the decorrelated pricing (3) stopped at prices ≤ 0 on its own curve, as the test bench (solar fpc 33.24 → 41.37, wind 74.84 → 76.80); 29 Oct. 2026: the French fleet at the last year's pace, never below the PPE3 path (solar build 54.31 → 53.22, wind 74.46 → 74.52; ref and pct move with the paid-share weights of the tenor years)
    'solar · defaults': {'ppa': 41.7, 'build': 41.7, 'pct': 28.74, 'fpc': 41.78, 'gen': 40.5, 'ref': 77.61, 'go': 1.9, 'tenor': '2027-2028-2029'},
    'wind · defaults': {'ppa': 66.54, 'build': 66.54, 'pct': 69.12, 'fpc': 68.32, 'gen': 66.2, 'ref': 76.91, 'go': 1.9, 'tenor': '2027-2028-2029'},
    'solar · past discount, P80': {'ppa': 24.63, 'build': 41.7, 'pct': 24.63, 'fpc': 41.78, 'gen': 40.5, 'ref': 76.76, 'go': 1.9, 'tenor': '2027-2028-2029'},
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
        p.clock.set_fixed_time('2026-11-21T12:00:00Z')
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
                return { ppa: r(o.ppa), build: r(o.ppaBuild), pct: r(o.ppaPct), fpc: r(o.ppaFpc), gen: r(o.ppaGen), ref: r(o.refP), go: r(o.goP), tenor: (o.tenor || []).join('-') };
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
