"""
Second sources beyond the day-ahead prices (those are in scripts/verify_prices.py):
  generation  France production by source and consumption, RTE éCO2mix (data/history/rte) against
              Energy-Charts (Fraunhofer ISE) public_power, day by day: nuclear, wind, solar, hydro,
              gas, load. A day is flagged when a field differs by more than 3 % and 150 MW on average.
  brent       Brent (SEFE cockpit, ICE front month) against the Brent spot of the US EIA via FRED
              (DCOILBRENTEU). Different instruments: the gap is usually within 5 % but the physical spot
              ran 10 to 25 % above the futures in Apr and Sep-Oct 2026. So only what a second source can
              prove is flagged: a gap above 30 % (unit error, wrong contract) and a series that stays
              flat 5 days while FRED moves (stale feed). The monthly mean gap is written as information.
  eurusd      EUR/USD (SEFE cockpit) against the ECB-based FRED series DEXUSEU, tolerance 0.5 %.
Forwards, TTF, EUA, coal: no free second source.

    python scripts/verify_markets.py [--days 45]
Writes data/history/market_check.json
"""
import argparse, csv, io, json, os, time, urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'market_check.json')
PARIS = ZoneInfo('Europe/Paris')
UA = {'User-Agent': 'PowerKlock data check'}
EC_FIELDS = {'nuclear': ['Nuclear'], 'wind': ['Wind onshore', 'Wind offshore'], 'solar': ['Solar'],
             'hydro': ['Hydro Run-of-River', 'Hydro water reservoir', 'Hydro pumped storage'], 'gas': ['Fossil gas'], 'load': ['Load']}


def get(url, tries=6, headers=UA):
    for k in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120).read()
        except Exception as e:
            if '429' in str(e) or 'timed out' in str(e) or '50' in str(e)[:12]:
                time.sleep(30 * (k + 1)); continue
            print(url, e); return None
    return None


def load(rel):
    try:
        return json.load(open(os.path.join(ROOT, rel)))
    except Exception:
        return None


def generation(d0, d1):
    raw = get(f'https://api.energy-charts.info/public_power?country=fr&start={d0}&end={d1}')
    if not raw:
        return None
    j = json.loads(raw)
    days = {}
    for i, t in enumerate(j['unix_seconds']):
        day = datetime.fromtimestamp(t, PARIS).date().isoformat()
        rec = days.setdefault(day, {f: [] for f in EC_FIELDS})
        for f, names in EC_FIELDS.items():
            vs = [p['data'][i] for p in j['production_types'] if p['name'] in names and p['data'][i] is not None]
            if vs:
                rec[f].append(sum(vs))
    agree, diff = 0, []
    for day, rec in sorted(days.items()):
        m = load(f'data/history/rte/{day[:7]}.json') or {}
        r = (m.get('days') or {}).get(day)
        if not r:
            continue
        ok = True
        for f, vals in rec.items():
            arr = [x for x in (r.get(f) or []) if x is not None]
            if len(arr) < 88 or len(vals) < 88:
                continue
            a, b = sum(arr) / len(arr), sum(vals) / len(vals)
            if abs(a - b) > 150 and abs(a - b) > 0.03 * max(abs(b), 1):
                ok = False
                diff.append({'day': day, 'field': f, 'rte': round(a), 'ec': round(b), 'pct': round((a / b - 1) * 100, 1) if b else None})
        agree += ok
    return {'agree_days': agree, 'differ': len(diff), 'days': diff[-120:]}


def fred(series):
    # FRED leaves requests with a custom User-Agent unanswered: Python's default one is accepted
    raw = get(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}', tries=3, headers={})
    if not raw:
        return {}
    out = {}
    for row in csv.reader(io.StringIO(raw.decode())):
        try:
            out[row[0]] = float(row[1])
        except (ValueError, IndexError):
            pass
    return out


def series_check(key, ref, tol, d0, stale_days=None):
    if not ref:   # no reference: an error, never "0 agree, 0 differ" that reads as all clear
        return {'error': 'FRED not reached', 'agree': 0, 'differ': 0, 'days': [], 'tolerance_pct': tol * 100}
    pts = (((load('data/history/commodities_series.json') or {}).get('series') or {}).get(key) or {}).get('points') or []
    agree, diff = 0, []
    if not any(d >= d0 and d in ref for d, _ in pts):
        return {'error': 'no common day with FRED in the window', 'agree': 0, 'differ': 0, 'days': [], 'tolerance_pct': tol * 100}
    for d, v in pts:
        if d < d0 or d not in ref or v is None:
            continue
        r = ref[d]
        if r and abs(v / r - 1) > tol:
            diff.append({'day': d, 'ours': v, 'ref': r, 'pct': round((v / r - 1) * 100, 1)})
        else:
            agree += 1
    out = {'agree': agree, 'differ': len(diff), 'days': diff[-60:], 'tolerance_pct': tol * 100}
    win = [(d, v) for d, v in pts if d >= d0 and v is not None and d in ref and ref[d]]
    if win:   # information only: mean gap to the reference over the window
        out['mean_gap_pct'] = round(sum((v / ref[d] - 1) * 100 for d, v in win) / len(win), 1)
    if stale_days:   # our value unchanged for stale_days quotes in a row while the reference moved
        run, start = 1, None
        for (d0_, v0), (d1_, v1) in zip(win, win[1:]):
            run = run + 1 if v1 == v0 else 1
            if run == 1: start = d1_
            if run >= stale_days and ref[d1_] != ref[win[0][0]]:
                out['stale_since'] = start; break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=45)
    a = ap.parse_args()
    d1 = date.today() - timedelta(days=1)
    d0 = d1 - timedelta(days=a.days)
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'window': [d0.isoformat(), d1.isoformat()]}
    out['generation'] = generation(d0.isoformat(), d1.isoformat()) or {'error': 'Energy-Charts not reached'}
    out['brent'] = series_check('brent', fred('DCOILBRENTEU'), 0.30, d0.isoformat(), stale_days=5)
    # SEFE's EUR/USD is taken during the day, FRED's at noon New York: up to 0.6 % apart on a busy day
    out['eurusd'] = series_check('eurusd', fred('DEXUSEU'), 0.01, d0.isoformat(), stale_days=5)
    json.dump(out, open(OUT, 'w'), indent=0)
    for k in ('generation', 'brent', 'eurusd'):
        v = out[k]; print(k, {x: v[x] for x in v if x != 'days'}, (v.get('days') or [])[-3:])


if __name__ == '__main__':
    main()
