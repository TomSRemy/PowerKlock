"""
A second source for the day-ahead prices: each stored day is compared with Energy-Charts
(Fraunhofer ISE, which republishes the same EPEX / Nord Pool results). A day that differs by more
than 0.5 €/MWh on its average is listed; scripts/heal_price_gaps.py asks ENTSO-E again for those days
and scripts/check_data_gaps.py shows the ones that stay different on Data status.

Days are market days (CET), as ENTSO-E publishes them for every zone of the European coupling.

    python scripts/verify_prices.py [--days 60 | --since 2020-01-01]
Writes data/history/price_check.json
"""
import argparse, json, os, sys, time, urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
OUT = os.path.join(ROOT, 'data', 'history', 'price_check.json')
PARIS = ZoneInfo('Europe/Paris')
EC = {'FR': 'FR', 'DE_LU': 'DE-LU', 'BE': 'BE', 'NL': 'NL', 'ES': 'ES', 'PT': 'PT', 'IT_NORD': 'IT-North', 'CH': 'CH', 'AT': 'AT',
      'PL': 'PL', 'CZ': 'CZ', 'DK_W': 'DK1', 'DK_E': 'DK2', 'HU': 'HU', 'SI': 'SI', 'FI': 'FI',
      'BG': 'BG', 'GR': 'GR', 'HR': 'HR', 'RO': 'RO', 'RS': 'RS', 'SK': 'SK', 'ME': 'ME', 'EE': 'EE', 'LT': 'LT', 'LV': 'LV',
      'NO_1': 'NO1', 'SE': 'SE1', 'IT_SICI': 'IT-Sicily'}
# not published by Energy-Charts: MK (North Macedonia), GB (no longer on ENTSO-E since 2021), MT
TOL = 0.5
# differences that are explained, not errors: listed apart, not flagged
KNOWN = {('AT', '2024-06-26'): 'partial decoupling of the European day-ahead market (SDAC): the two sources keep different auction results'}


def ec_prices(bzn, d0, d1):
    url = f'https://api.energy-charts.info/price?bzn={bzn}&start={d0}&end={d1}'
    for k in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'PowerKlock price check'}), timeout=120))
        except Exception as e:
            if '429' in str(e) or 'timed out' in str(e):
                time.sleep(30 * (k + 1)); continue
            print(bzn, e); return None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=60)
    ap.add_argument('--since', default=None)
    a = ap.parse_args()
    d1 = date.today() - timedelta(days=1)
    d0 = date.fromisoformat(a.since) if a.since else d1 - timedelta(days=a.days)
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'source': 'Energy-Charts (Fraunhofer ISE) day-ahead prices',
           'window': [d0.isoformat(), d1.isoformat()], 'tolerance': TOL, 'zones': {}}
    for z, bzn in EC.items():
        by = {}
        # a year per request at most
        s = d0
        while s <= d1:
            e = min(s + timedelta(days=364), d1)
            j = ec_prices(bzn, s.isoformat(), e.isoformat())
            for t, v in zip((j or {}).get('unix_seconds') or [], (j or {}).get('price') or []):
                if v is not None:
                    by.setdefault(datetime.fromtimestamp(t, PARIS).date().isoformat(), []).append(v)
            s = e + timedelta(days=1)
            time.sleep(8)
        agree, diff, known = 0, [], []
        for day, vs in sorted(by.items()):
            if len(vs) < 23:
                continue
            fp = os.path.join(DAILY, day + '.json')
            if not os.path.exists(fp):
                continue
            zz = (json.load(open(fp)).get('zones') or {}).get(z)
            if not isinstance(zz, dict) or zz.get('avg') is None:
                continue
            ec = sum(vs) / len(vs)
            if abs(zz['avg'] - ec) > TOL and (z, day) in KNOWN:
                known.append({'day': day, 'ours': zz['avg'], 'ec': round(ec, 2), 'why': KNOWN[(z, day)]})
            elif abs(zz['avg'] - ec) > TOL:
                diff.append({'day': day, 'ours': zz['avg'], 'ec': round(ec, 2)})
            else:
                agree += 1
        out['zones'][z] = {'agree': agree, 'differ': len(diff), 'days': diff[-120:], 'explained': known}
        print(f'{z:8s} agree {agree:5d}  differ {len(diff):4d}', diff[-3:])
    json.dump(out, open(OUT, 'w'), indent=0)


if __name__ == '__main__':
    main()
