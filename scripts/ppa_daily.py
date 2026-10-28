#!/usr/bin/env python3
"""PPA benchmark, every day: the site's own pricer (Tools › PPA pricer, js/tool-ppa.js) run on
the day's data with its default settings, for French solar and wind, and kept day after day.

The pricer is not copied in Python: the site is served locally and PKPpa.compute() is called in
a headless browser, exactly as tests/test_ppa_frozen.py does, so the benchmark is the price a
reader of the site sees that day. The series shows how the PPA price moves with the forwards,
the capture rates and the GO.

Writes data/history/ppa_benchmark.json:
  {"updated", "note", "days": {"2026-10-25": {"tenor": "2027-2028-2029",
     "solar": {"ppa", "build", "pct", "fpc", "wx", "eu", "blend", "blend4", "lo", "hi", "ref", "go", "imb"}, "wind": {…}}, …}}
  (€/MWh; ppa = the published price = blend4 from the switch day (before it: the capacity trend; days["def"] says
   which), build = capacity trend, pct = past discount (a reference only),
   fpc = forward shape, wx = weather simulation, eu = European price model (from 2026-10-28),
   blend = mean of build, fpc and wx, blend4 = average of build, fpc, wx and eu weighted by the inverse of their past error for solar, equal for wind
   (data/history/ppa_weights.json; from 2026-10-28),
   lo / hi = the capacity trend's price at 10 % and 90 % of 10,000 simulated futures (P10–P90) whose capture drift is
             the measured spread of the published average's errors (since 28 Oct. 2026: tool-ppa.js o.mcBand), moved by
   ppa − build so the band sits around the published price,
   ref = forward baseload of the tenor, go = guarantee of origin, imb = imbalance)

    python scripts/ppa_daily.py            # today (Paris), overwrites the day if run again
    python scripts/ppa_daily.py --redefine
        once, on the switch day: every past day without blend4 is recomputed (that day's Cal settlements, today's
        model, flagged rebuilt), then every day's ppa = blend4 and its band moved with it, so the history reads one
        definition and the 7-day alerts see no false jump
    python scripts/ppa_daily.py --rebuild 365
        the past days without a run, rebuilt: same Cal contracts as today, each day's Cal settlements
        (data/history/fr_market_calchain.json), today's capture, imbalance and GO model; flagged "rebuilt"
"""
import functools
import http.server
import json
import os
import sys
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'ppa_benchmark.json')
PORT = int(os.environ.get('PPA_DAILY_PORT', '8811'))
CASES = {'solar': {'tech': 'solar'}, 'wind': {'tech': 'wind'}}


def run(rebuild=None):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    got, errs = {}, []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            p = b.new_page(viewport={'width': 1440, 'height': 900})
            p.on('pageerror', lambda e: errs.append(str(e)))
            p.goto(f'http://127.0.0.1:{PORT}/index.html#tools/ppa')
            p.wait_for_function('window.PKPpa && PKPpa.state', timeout=90000)
            p.wait_for_timeout(5000)
            # the blends (three model methods; four with the European model) and the P10–P90 band of the default one (its Monte Carlo)
            p.evaluate("""() => { window.extra = o => {
                const r = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
                const m = [o.ppaBuild, o.ppaFpc, o.ppaWx].filter(v => v != null && isFinite(v));
                const m4 = [o.ppaBuild, o.ppaFpc, o.ppaWx, o.ppaEu].filter(v => v != null && isFinite(v));
                let lo = null, hi = null;
                const mcB = o.mcBand || o.mc;   // the band's futures: capture drift = the published average's measured spread
                if (mcB && mcB.Us && mcB.Us.length) {
                  const u = Float64Array.from(mcB.Us).sort(), q = a => u[Math.min(u.length - 1, Math.max(0, Math.round(a * (u.length - 1))))];
                  const adj = - o.refW * (o.add || 0) / 100 - o.imb + o.goW - o.margin;
                  lo = q(0.10) + adj; hi = q(0.90) + adj;
                }
                return { wx: r(o.ppaWx), eu: r(o.ppaEu), blend: m.length ? r(m.reduce((a, b) => a + b, 0) / m.length) : null,
                         // the published average: the four methods with their weights (inverse of their past error for solar)
                         blend4: m4.length === 4 ? r(PKPpa.avg4Of ? PKPpa.avg4Of(o) : m4.reduce((a, b) => a + b, 0) / 4) : null, lo: r(lo), hi: r(hi) };
              }; }""")
            for name, over in CASES.items():
                got[name] = p.evaluate("""async over => {
                    const S = PKPpa.state, keep = {};
                    Object.keys(over).forEach(k => { keep[k] = S[k]; });
                    Object.assign(S, over);
                    const o = await PKPpa.compute();
                    Object.assign(S, keep);
                    const r = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
                    return Object.assign(extra(o), { ppa: r(o.ppa), build: r(o.ppaBuild), pct: r(o.ppaPct), fpc: r(o.ppaFpc), ref: r(o.refP),
                             go: r(o.goP), imb: r(o.imb), tenor: (o.tenor || []).join('-') });
                }""", over)
            if rebuild:
                got['rebuilt'] = p.evaluate("""async days => {
                    const S = PKPpa.state, out = {}, r = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
                    for (const [d, fwd] of days) {
                      out[d] = {};
                      for (const tech of ['solar', 'wind']) {
                        const keep = { tech: S.tech, fwd: S.fwd };
                        S.tech = tech; S.fwd = fwd;
                        const o = await PKPpa.compute();
                        S.tech = keep.tech; S.fwd = keep.fwd;
                        out[d][tech] = Object.assign(extra(o), { ppa: r(o.ppa), build: r(o.ppaBuild), pct: r(o.ppaPct), fpc: r(o.ppaFpc), ref: r(o.refP), go: r(o.goP), imb: r(o.imb) });
                      }
                    }
                    return out;
                }""", rebuild)
            b.close()
    finally:
        srv.shutdown()
    return got, errs


def past_days(n, years, have):
    """[[day, {year: Cal settlement}]] for the last n days with every Cal of `years` quoted and no run yet"""
    with open(os.path.join(ROOT, 'data', 'history', 'fr_market_calchain.json')) as f:
        ch = json.load(f)['FR']['years']
    by = {str(y): dict(zip(ch[str(y)]['dates'], ch[str(y)]['values'])) for y in years if str(y) in ch}
    if len(by) < len(years):
        return []
    days = sorted(set.intersection(*[set(v) for v in by.values()]))[-n:]
    return [[d, {y: by[y][d] for y in by}] for d in days if d not in have]


NOTE = ('PowerKlock PPA benchmark: the average of 4 methods of the site\'s pricer (capacity trend, forward shape, weather '
        'simulation, European price model), default settings (France, baseload pay-as-produced, curtailed at prices <= 0), '
        'run once a day on that day\'s forwards, capture rates and GO prices. EUR/MWh. Days flagged rebuilt: same Cal '
        'contracts, that day\'s Cal settlements, the current model.')


def headline(x):
    """the published price = the 4-method average; the capacity trend's P10-P90 band moved around it"""
    if not x or x.get('blend4') is None or x.get('build') is None:
        return
    shift = x['blend4'] - x['build']
    x['ppa'] = x['blend4']
    for k in ('lo', 'hi'):
        if x.get(k) is not None:
            x[k] = round(x[k] + shift, 2)


def redefine():
    """the switch day: one definition over the whole history (see the module's docstring)"""
    with open(OUT) as f:
        j = json.load(f)
    todo = [d for d, v in j['days'].items() if any((v.get(t) or {}).get('blend4') is None for t in ('solar', 'wind'))]
    with open(os.path.join(ROOT, 'data', 'history', 'fr_market_calchain.json')) as f:
        ch = json.load(f)['FR']['years']
    days = []
    for d in todo:
        ys = j['days'][d].get('tenor', '').split('-')
        # each Cal's last settlement on or before the day (a weekend run has none of its own)
        last = {}
        for y in ys:
            if y in ch:
                ok = [(t, v) for t, v in zip(ch[y]['dates'], ch[y]['values']) if t <= d and v is not None]
                if ok:
                    last[y] = ok[-1][1]
        if len(last) == len(ys):
            days.append([d, last])
    print('recomputing', len(days), 'of', len(todo), 'days without the 4-method average')
    got, errs = run(days) if days else ({}, [])
    for d, v in (got.get('rebuilt') or {}).items():
        j['days'][d].update({'rebuilt': True, 'solar': v['solar'], 'wind': v['wind']})
    for d, v in j['days'].items():
        if v.get('def') == 'blend4':
            continue
        for t in ('solar', 'wind'):
            headline(v.get(t))
        if all((v.get(t) or {}).get('blend4') is not None for t in ('solar', 'wind')):
            v['def'] = 'blend4'
    left = [d for d, v in j['days'].items() if v.get('def') != 'blend4']
    j['note'] = NOTE
    j['switch'] = datetime.now(ZoneInfo('Europe/Paris')).date().isoformat()
    with open(OUT, 'w') as f:
        json.dump(j, f, separators=(',', ':'))
    print('switched; days still on the old definition (no Cal settlement that day):', left[:10], len(left), '· JS errors:', len(errs))
    return 0


def main():
    rebuild = None
    if '--rebuild' in sys.argv:
        n = int(sys.argv[sys.argv.index('--rebuild') + 1])
        try:
            with open(OUT) as f:
                have = json.load(f).get('days', {})
        except (OSError, ValueError):
            have = {}
        have = {d for d, v in have.items() if not v.get('rebuilt')}
        tenor = [2027, 2028, 2029]
        last = max(have) if have else None
        if last:
            with open(OUT) as f:
                tenor = [int(y) for y in json.load(f)['days'][last]['tenor'].split('-')]
        rebuild = past_days(n, tenor, have)
        print('rebuilding', len(rebuild), 'days')
    if '--redefine' in sys.argv:
        return redefine()
    got, errs = run(rebuild)
    for k in ('solar', 'wind'):
        headline(got.get(k))
    for v in (got.get('rebuilt') or {}).values():
        for k in ('solar', 'wind'):
            headline(v.get(k))
    if not got.get('solar') or got['solar'].get('ppa') is None or not got.get('wind') or got['wind'].get('ppa') is None:
        print('pricer gave no price', got, errs[:3])
        return 1
    day = datetime.now(ZoneInfo('Europe/Paris')).date().isoformat()
    try:
        with open(OUT) as f:
            j = json.load(f)
    except (OSError, ValueError):
        j = {'days': {}}
    tenor = got['solar'].pop('tenor', '')
    got['wind'].pop('tenor', None)
    j['days'][day] = {'tenor': tenor, 'def': 'blend4', 'solar': got['solar'], 'wind': got['wind']}
    for d, v in (got.get('rebuilt') or {}).items():
        if d != day:
            j['days'][d] = {'tenor': tenor, 'rebuilt': True, 'def': 'blend4', 'solar': v['solar'], 'wind': v['wind']}
    j['days'] = dict(sorted(j['days'].items()))
    j['updated'] = datetime.now(ZoneInfo('UTC')).strftime('%Y-%m-%dT%H:%M:%SZ')
    j['note'] = NOTE
    with open(OUT, 'w') as f:
        json.dump(j, f, separators=(',', ':'))
    print(day, tenor, 'solar', got['solar']['ppa'], 'wind', got['wind']['ppa'], '· JS errors:', len(errs))
    return 0


if __name__ == '__main__':
    sys.exit(main())
