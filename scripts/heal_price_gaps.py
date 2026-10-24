"""Fill the holes of the day-ahead history: a main zone missing from a past day's file is fetched
again from ENTSO-E and merged into that file (the other zones are left as they are), then the
summary index is rebuilt. Runs after every data fetch; does nothing when there is no hole.

    ENTSOE_TOKEN=… python scripts/heal_price_gaps.py [--days 400]
"""
import json, os, sys, time
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enrich_summary as es

LOG = []
KEY = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'PT', 'IT_NORD', 'CH', 'AT', 'GB']
DAILY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'history', 'daily')


def main():
    days = int(sys.argv[sys.argv.index('--days') + 1]) if '--days' in sys.argv else 400
    token = os.environ.get('ENTSOE_TOKEN')
    if not token:
        sys.exit('ENTSOE_TOKEN missing')
    healed, calls, CAP = 0, 0, 120   # at most 120 requests a run, one every 0.3 s: far under ENTSO-E's 400 a minute; a big hole is filled over a few runs
    for k in range(1, days + 1):   # yesterday and before, newest first: today and tomorrow are the main fetch's job
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
            if calls >= CAP:
                break
            calls += 1; time.sleep(0.3)
            try:
                h = es.fetch_prices_for_date(token, z, d)
            except Exception as e:
                print(f'{d} {z}: {e}'); h = None
            if h:
                got[z] = h
                LOG.append({'day': d.isoformat(), 'zone': z, 'result': 'filled', 'points': len(h)})
            else:   # what ENTSO-E answered, to see why (no document, other resolution, error)
                try:
                    st = date.fromisoformat(d.isoformat())
                    raw = es._entsoe_fetch(token, {'documentType': 'A44', 'in_Domain': es.ZONES_EIC.get(z), 'out_Domain': es.ZONES_EIC.get(z),
                                                   'periodStart': st.strftime('%Y%m%d') + '0000', 'periodEnd': (st + timedelta(days=1)).strftime('%Y%m%d') + '0000'})
                    import re as _re
                    info = 'resolutions ' + ','.join(sorted(set(_re.findall(r'<resolution>([^<]+)</resolution>', raw or '')))) + ' · ' + (raw or '')[:160].replace('\n', ' ')
                except Exception as e:
                    info = 'error: ' + str(e)[:200]
                LOG.append({'day': d.isoformat(), 'zone': z, 'result': 'empty', 'answer': info})
        if not got:
            print(f'{d}: {holes} still missing'); continue
        part = es.build_daily_snapshot(d.isoformat(), got, {})
        for z, v in (part.get('zones') or {}).items():
            zones[z] = v
        json.dump(snap, open(fp, 'w'), separators=(',', ':'))
        healed += 1
        print(f'{d}: filled {sorted(got)}')
    if calls >= CAP:
        print(f'request cap reached ({CAP}): the rest at the next run')
    if healed:
        es.recalc_summary_from_daily()
    print(f'{healed} day(s) healed')
    if LOG:
        json.dump({'run': date.today().isoformat(), 'log': LOG[-200:]}, open(os.path.join(os.path.dirname(DAILY), 'heal_log.json'), 'w'), indent=0)


if __name__ == '__main__':
    main()
