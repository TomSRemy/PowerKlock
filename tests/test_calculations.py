"""
Calculations the site and the reports rely on, checked on hand-computed cases and on the published
reference (CRE). Run before any refactoring; no network, no browser.

    python3 tests/test_calculations.py
"""
import json, os, statistics, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
fails = []


def check(name, ok, detail=''):
    print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else ' · ' + str(detail)))
    if not ok:
        fails.append(name)


# ── capture rate (scripts/fetch_fr_regions_capture.py) ──
from fetch_fr_regions_capture import capture
# 3 hours: 10 MW at 50 €, 0 MW at −10 €, 30 MW at 20 €
#   base = (50 − 10 + 20) / 3 = 20 ; captured price = (10·50 + 30·20) / 40 = 27.5 → capture 1.375
#   positive hours only: base = 35, same captured price → 0.7857
r = capture({1: 10, 2: 0, 3: 30}, {1: 50, 2: -10, 3: 20})
check('capture rate, all hours', r and r['all'] == 1.375, r)
check('capture rate, curtailed at negative prices', r and r['curt'] == 1.375, r)
check('capture rate, against the positive-hour base', r and r['pos'] == 0.7857, r)
check('capture rate: no output, no rate', capture({1: 0}, {1: 30}) is None)
check('capture rate: hours without price ignored', capture({1: 10, 2: 10}, {1: 40})['all'] == 1.0)

# ── currencies (scripts/pk_fx.py) ──
import pk_fx
check('BGN at the fixed rate', abs(pk_fx.per_eur('BGN', '2021-06-01') - 1.95583) < 1e-9, pk_fx.per_eur('BGN', '2021-06-01'))
check('EUR stays EUR', pk_fx.to_eur(100.0, 'EUR', '2021-06-01') == 100.0)

# ── second sources (scripts/verify_markets.py): a check that compared nothing is an error, a stuck feed is seen ──
import verify_markets as V
pts = [['2026-10-%02d' % d, 100.0] for d in range(1, 15)]
V.load = lambda rel: {'series': {'brent': {'points': pts}}}
r = V.series_check('brent', {}, 0.30, '2026-10-01')
check('no reference: an error, not a pass', 'error' in r, r)
ref = {d: 100.0 + i for i, (d, _) in enumerate(pts)}   # the reference moves, ours is flat
r = V.series_check('brent', ref, 0.30, '2026-10-01', stale_days=5)
check('flat series while the reference moves: stale', 'stale_since' in r, r)
ref2 = {d: 150.0 for d, _ in pts}   # ours 100 = −33 %, over the 30 % tolerance
r = V.series_check('brent', ref2, 0.30, '2026-10-01')
check('gap over the tolerance flagged', r['differ'] == len(pts) and r['agree'] == 0, {k: r[k] for k in ('agree', 'differ')})

# ── M0 (data/cre_m0.json): PowerKlock's estimate against the CRE's published values, last 12 months ──
# Current gaps: base 0.07 mean / 0.34 max, wind 0.08 / 0.45, solar 0.19 / 1.17 €/MWh. The limits leave room
# for normal revisions and catch a broken method (clock-change days, a unit, a missing month: several €).
d = json.load(open(os.path.join(ROOT, 'data', 'cre_m0.json')))
for kind, key, lim_mean, lim_max in (('monthly', 'base', 0.15, 0.6), ('wind', 'wind', 0.2, 0.8), ('solar', 'solar', 0.4, 1.5)):
    ms = sorted(m for m in d['official'][kind] if m in d['estimate'] and d['estimate'][m].get(key) is not None)[-12:]
    gaps = [abs(d['estimate'][m][key] - d['official'][kind][m]) for m in ms]
    check(f'M0 {key}: estimate vs CRE, 12 months (mean ≤ {lim_mean}, max ≤ {lim_max} €/MWh)',
          len(gaps) >= 10 and statistics.mean(gaps) <= lim_mean and max(gaps) <= lim_max,
          f'{len(gaps)} months, mean {statistics.mean(gaps):.3f}, max {max(gaps):.3f}' if gaps else 'no month')

# ── stored day-ahead averages agree with their own quarter-hours (data/history/daily) ──
fp = sorted(f for f in os.listdir(os.path.join(ROOT, 'data', 'history', 'daily')) if f.endswith('.json'))[-30:]
import datetime as _dt
def clock_change(day):   # last Sunday of March or October: 92 or 100 quarter-hours, the stored 96 slots average the
    d = _dt.date.fromisoformat(day)   # repeated hour (or leave the skipped one empty) while avg counts every point
    return d.month in (3, 10) and d.weekday() == 6 and (d + _dt.timedelta(days=7)).month != d.month
bad = []
for f in fp:
    if clock_change(f[:10]):
        continue
    z = (json.load(open(os.path.join(ROOT, 'data', 'history', 'daily', f))).get('zones') or {}).get('FR') or {}
    vals = [v for v in (z.get('prices') or z.get('hourly') or []) if v is not None]
    if vals and z.get('avg') is not None and abs(sum(vals) / len(vals) - z['avg']) > 0.6:
        bad.append((f, z['avg'], round(sum(vals) / len(vals), 2)))
check('FR daily average = mean of its slots (30 last days, clock-change days apart)', not bad, bad[:3])

# ── holes check (scripts/check_data_gaps.py): runs on the repository data, every issue well formed, ids unique ──
import check_data_gaps as G
iss = G.checks()
check('holes check: every issue has id, dataset, what, repair', all(set(i) >= {'id', 'dataset', 'what', 'repair'} for i in iss), iss[:1])
check('holes check: ids unique', len({i['id'] for i in iss}) == len(iss), len(iss))

# ── site notes (scripts/notes_sync.py): replies file read safely, export keeps open + recent, first names only ──
import datetime as _ndt, tempfile as _tf, pathlib as _pl
import notes_sync as NS
with _tf.TemporaryDirectory() as _d:
    _p = _pl.Path(_d) / 'r.json'
    _p.write_text(json.dumps({'12': {'status': 'done', 'reply': 'ok'}, 'x': {}, '13': {'status': 'maybe'}, '14': {'reply': 'r'}}))
    _r = NS.load_replies(_p)
check('notes: replies keep numeric ids with a known status', _r == {12: {'status': 'done', 'reply': 'ok'}, 14: {'status': 'done', 'reply': 'r'}}, _r)
_now = _ndt.datetime(2026, 10, 25, tzinfo=_ndt.timezone.utc)
_row = lambda i, st, days_done=None: {'id': i, 'status': st, 'created_at': _now - _ndt.timedelta(days=90), 'author_email': 'tom.s.remy@example.com',
                                      'route': 'renewables/capture', 'body': 'b', 'done_at': _now - _ndt.timedelta(days=days_done) if days_done is not None else None}
_e = NS.export_rows([_row(1, 'done', 10), _row(2, 'open'), _row(3, 'done', 70)], _now)
check('notes: export keeps open notes and those closed < 60 days, open first', [n['id'] for n in _e['notes']] == [2, 1] and _e['open'] == 1, _e)
check('notes: no e-mail address in the public file', all('@' not in json.dumps(n) for n in _e['notes']) and _e['notes'][0]['author'] == 'Tom', _e['notes'][0])

print('FAILED' if fails else 'PASSED', f'({len(fails)} failed)')
sys.exit(1 if fails else 0)
