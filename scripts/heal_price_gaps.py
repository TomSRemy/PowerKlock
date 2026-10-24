"""Fill the holes of the day-ahead history: a main zone missing from a past day's file is fetched
again from ENTSO-E and merged into that file (the other zones are left as they are), then the
summary index is rebuilt. Runs after every data fetch; does nothing when there is no hole.

    ENTSOE_TOKEN=… python scripts/heal_price_gaps.py [--days 400]
"""
import json, os, sys
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enrich_summary as es

KEY = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'PT', 'IT_NORD', 'CH', 'AT', 'GB']
DAILY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'history', 'daily')


def main():
    days = int(sys.argv[sys.argv.index('--days') + 1]) if '--days' in sys.argv else 400
    token = os.environ.get('ENTSOE_TOKEN')
    if not token:
        sys.exit('ENTSOE_TOKEN missing')
    healed = 0
    for k in range(1, days + 1):   # yesterday and before: today and tomorrow are the main fetch's job
        d = date.today() - timedelta(days=k)
        fp = os.path.join(DAILY, d.isoformat() + '.json')
        if not os.path.exists(fp):
            continue
        snap = json.load(open(fp))
        zones = snap.setdefault('zones', {})
        holes = [z for z in KEY if not (isinstance(zones.get(z), dict) and zones[z].get('avg') is not None)
                 and (z != 'GB' or 'GB' in zones)]   # GB only when the file ever had it (not published since Brexit)
        if not holes:
            continue
        got = {}
        for z in holes:
            try:
                h = es.fetch_prices_for_date(token, z, d)
            except Exception as e:
                print(f'{d} {z}: {e}'); h = None
            if h:
                got[z] = h
        if not got:
            print(f'{d}: {holes} still missing'); continue
        part = es.build_daily_snapshot(d.isoformat(), got, {})
        for z, v in (part.get('zones') or {}).items():
            zones[z] = v
        json.dump(snap, open(fp, 'w'), separators=(',', ':'))
        healed += 1
        print(f'{d}: filled {sorted(got)}')
    if healed:
        es.recalc_summary_from_daily()
    print(f'{healed} day(s) healed')


if __name__ == '__main__':
    main()
