"""
Second sources beyond the day-ahead prices (those are in scripts/verify_prices.py):
  generation  France production by source and consumption, RTE éCO2mix (data/history/rte) against
              Energy-Charts (Fraunhofer ISE) public_power, day by day: nuclear, wind, solar, hydro,
              gas, load. A day is flagged when a field differs by more than 3 % and 150 MW on average.
  brent       Brent (SEFE cockpit, ICE front month) against the Brent spot of the US EIA via FRED
              (DCOILBRENTEU): different instruments, so only a gap above 6 % is flagged (unit error,
              wrong contract, stale series).
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


def get(url, tries=6):
    for k in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
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
    raw = get(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}')
    if not raw:
        return {}
    out = {}
    for row in csv.reader(io.StringIO(raw.decode())):
        try:
            out[row[0]] = float(row[1])
        except (ValueError, IndexError):
            pass
    return out


def series_check(key, ref, tol, d0):
    pts = (((load('data/history/commodities_series.json') or {}).get('series') or {}).get(key) or {}).get('points') or []
    agree, diff = 0, []
    for d, v in pts:
        if d < d0 or d not in ref or v is None:
            continue
        r = ref[d]
        if r and abs(v / r - 1) > tol:
            diff.append({'day': d, 'ours': v, 'ref': r, 'pct': round((v / r - 1) * 100, 1)})
        else:
            agree += 1
    return {'agree': agree, 'differ': len(diff), 'days': diff[-60:], 'tolerance_pct': tol * 100}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=45)
    a = ap.parse_args()
    d1 = date.today() - timedelta(days=1)
    d0 = d1 - timedelta(days=a.days)
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'window': [d0.isoformat(), d1.isoformat()]}
    out['generation'] = generation(d0.isoformat(), d1.isoformat()) or {'error': 'Energy-Charts not reached'}
    out['brent'] = series_check('brent', fred('DCOILBRENTEU'), 0.06, d0.isoformat())
    out['eurusd'] = series_check('eurusd', fred('DEXUSEU'), 0.005, d0.isoformat())
    json.dump(out, open(OUT, 'w'), indent=0)
    for k in ('generation', 'brent', 'eurusd'):
        v = out[k]; print(k, {x: v[x] for x in v if x != 'days'}, (v.get('days') or [])[-3:])


if __name__ == '__main__':
    main()
