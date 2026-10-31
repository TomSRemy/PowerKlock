"""
A second source for the day-ahead prices: each stored day is compared with Energy-Charts
(Fraunhofer ISE, which republishes the same EPEX / Nord Pool results), on the quarter-hours (or hours) both sources
hold. A day that differs by more than 0.5 €/MWh on its average is listed; scripts/heal_price_gaps.py asks ENTSO-E again for those days
and scripts/check_data_gaps.py shows the ones that stay different on Data status.

Days are market days (CET), as ENTSO-E publishes them for every zone of the European coupling. Energy-Charts cuts
its requests on each zone's local day (one hour later in Greece, Romania, Bulgaria, Finland and the Baltic states,
one hour earlier in Portugal): a request from d0 to d1 misses the last Paris hour of d1 there (or the first of d0 in
Portugal), and comparing a 23-hour mean with our 24-hour mean flagged days whose prices were identical (31 Oct. 2026:
RO, LV, LT, GR, BG, EE, FI on 30 Oct., PT on 31 Aug.). So one more day is asked on each side, and a day is compared
only when Energy-Charts covers every slot we hold.

    python scripts/verify_prices.py [--days 60 | --since 2020-01-01] [--zones BG,RO]
With --zones only those zones are compared again; the others keep their last result.
Writes data/history/price_check.json
"""
import argparse, json, os, time, urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
OUT = os.path.join(ROOT, 'data', 'history', 'price_check.json')
PARIS = ZoneInfo('Europe/Paris')
EC = {'FR': 'FR', 'DE_LU': 'DE-LU', 'BE': 'BE', 'NL': 'NL', 'ES': 'ES', 'PT': 'PT', 'IT_NORD': 'IT-North', 'CH': 'CH', 'AT': 'AT',
      'PL': 'PL', 'CZ': 'CZ', 'DK_W': 'DK1', 'DK_E': 'DK2', 'HU': 'HU', 'SI': 'SI', 'FI': 'FI',
      'BG': 'BG', 'GR': 'GR', 'HR': 'HR', 'RO': 'RO', 'RS': 'RS', 'SK': 'SK', 'ME': 'ME', 'EE': 'EE', 'LT': 'LT', 'LV': 'LV',
      'NO_1': 'NO1', 'SE': 'SE1', 'IT_SICI': 'IT-South'}   # IT_SICI holds Italy South (EIC 10Y1001A1001A788)
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
    ap.add_argument('--zones', default='ALL')
    a = ap.parse_args()
    only = None if a.zones.upper() == 'ALL' else {z.strip() for z in a.zones.split(',') if z.strip()}
    d1 = date.today() - timedelta(days=1)
    d0 = date.fromisoformat(a.since) if a.since else d1 - timedelta(days=a.days)
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'source': 'Energy-Charts (Fraunhofer ISE) day-ahead prices',
           'window': [d0.isoformat(), d1.isoformat()], 'tolerance': TOL, 'zones': {}}
    if only:   # other zones: their last result is kept, with the date it was made
        try:
            prev = json.load(open(OUT))
            for z, v in (prev.get('zones') or {}).items():
                if z not in only:
                    out['zones'][z] = dict(v, checked=v.get('checked') or prev.get('updated'))
        except (OSError, ValueError, AttributeError):
            pass
    for z, bzn in EC.items():
        if only and z not in only:
            continue
        by = {}   # Paris day → {quarter-hour slot: [Energy-Charts values]}
        # a year per request at most, one day more on each side (local-day cut of Energy-Charts, see above)
        s = d0 - timedelta(days=1)
        while s <= d1 + timedelta(days=1):
            e = min(s + timedelta(days=364), d1 + timedelta(days=1))
            j = ec_prices(bzn, s.isoformat(), e.isoformat()) or {}
            ts, ps = j.get('unix_seconds') or [], j.get('price') or []
            for k, (t, v) in enumerate(zip(ts, ps)):
                if v is None:
                    continue
                step = (ts[k + 1] - t) if k + 1 < len(ts) else (t - ts[k - 1] if k else 900)
                step = 3600 if step >= 3600 else 900
                for q in range(0, step, 900):          # an hourly price covers its four quarter-hours
                    dt = datetime.fromtimestamp(t + q, PARIS)
                    by.setdefault(dt.date().isoformat(), {}).setdefault(dt.hour * 4 + dt.minute // 15, []).append(v)
            s = e + timedelta(days=1)
            time.sleep(8)
        agree, diff, known = 0, [], []
        for day, slots in sorted(by.items()):
            if not (d0.isoformat() <= day <= d1.isoformat()):
                continue
            fp = os.path.join(DAILY, day + '.json')
            if not os.path.exists(fp):
                continue
            zz = (json.load(open(fp)).get('zones') or {}).get(z)
            if not isinstance(zz, dict) or zz.get('avg') is None:
                continue
            arr = zz.get('hourly') or []
            if len(arr) in (23, 24, 25):   # an hourly series: each hour stands for its four quarter-hours
                arr = [v for v in arr[:24] for _ in range(4)]
            ours = {i: v for i, v in enumerate(arr) if v is not None}
            if len(ours) < 92 or any(i not in slots for i in ours):
                continue   # Energy-Charts does not cover the whole day yet: compared on a later run
            o = sum(ours.values()) / len(ours)
            ec = sum(sum(slots[i]) / len(slots[i]) for i in ours) / len(ours)
            row = {'day': day, 'ours': round(o, 2), 'ec': round(ec, 2)}
            if abs(o - ec) > TOL and (z, day) in KNOWN:
                known.append(dict(row, why=KNOWN[(z, day)]))
            elif abs(o - ec) > TOL:
                diff.append(row)
            else:
                agree += 1
        out['zones'][z] = {'agree': agree, 'differ': len(diff), 'days': diff[-120:], 'explained': known, 'checked': out['updated']}
        print(f'{z:8s} agree {agree:5d}  differ {len(diff):4d}', diff[-3:])
    json.dump(out, open(OUT, 'w'), indent=0)


if __name__ == '__main__':
    main()
