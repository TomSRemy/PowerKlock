"""
Rebuild the day-ahead price history of some zones from ENTSO-E, a year per request.

Why: for Germany-Luxembourg and Austria ENTSO-E sends two day-ahead series for each day; the
readers kept the second (another auction) instead of the European market coupling (classification
sequence 1), so the stored prices were off SMARD and Energy-Charts on most days. This script asks
ENTSO-E again (one request per zone and year), keeps sequence 1 for every day, places the slots on
the local clock (clock-change days included, scripts/pk_time.py) and replaces the price fields of
each daily file. The zone's production arrays and the other zones are left as they are. Then the
summary index is rebuilt.

    ENTSOE_TOKEN=… python scripts/repair_prices.py --zones DE_LU,AT --from 2020-01-01
Writes data/history/repair_log.json (days changed, largest change per zone).
"""
import argparse, json, os, sys, time
from datetime import date, datetime, timedelta, timezone
from xml.etree import ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enrich_summary as es
from pk_time import local_slots

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
NS = {'ns': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}


def periods(xml):
    """every period of the document: (market day, sequence, slots, all points of the day)"""
    out = []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return out
    for ts in root.findall('.//ns:TimeSeries', NS):
        seq = es._seq_of(ts, NS)
        for per in ts.findall('ns:Period', NS):
            res = per.findtext('ns:resolution', 'PT60M', NS)
            if res not in ('PT15M', 'PT60M'):
                continue
            rm = 15 if res == 'PT15M' else 60
            st = es._parse_dt(per.findtext('ns:timeInterval/ns:start', '', NS))
            en = es._parse_dt(per.findtext('ns:timeInterval/ns:end', '', NS))
            if not st or not en:
                continue
            pts = {}
            for p in per.findall('ns:Point', NS):
                try:
                    pts[int(p.findtext('ns:position', '0', NS))] = round(float(p.findtext('ns:price.amount', '', NS)), 4)
                except ValueError:
                    pass
            if not pts:
                continue
            n = int(round((en - st).total_seconds() / 60 / rm))

            def carry(k, pts=pts):
                last, o = None, []
                for i in range(1, k + 1):
                    last = pts.get(i, last)
                    o.append(last)
                return o
            slots = local_slots({'start': st, 'end': en, 'res_minutes': rm}, carry)
            day = (st + timedelta(hours=12)).date().isoformat()   # the market day (CET), as the daily files
            out.append((day, seq, slots, [v for v in carry(n) if v is not None]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zones', default='DE_LU,AT')
    ap.add_argument('--from', dest='frm', default='2020-01-01')
    ap.add_argument('--to', default=None)
    a = ap.parse_args()
    token = os.environ.get('ENTSOE_TOKEN') or sys.exit('ENTSOE_TOKEN missing')
    end = date.fromisoformat(a.to) if a.to else date.today() + timedelta(days=1)
    log = {'run': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'zones': {}}
    for z in a.zones.split(','):
        eic = es.ZONES_EIC.get(z)
        if not eic:
            continue
        best = {}   # day → (seq, slots, points)
        d = date.fromisoformat(a.frm)
        while d < end:
            nxt = min(date(d.year + 1, d.month, d.day) - timedelta(days=1), end)   # under a year per request
            p0, p1 = (d - timedelta(days=1)).strftime('%Y%m%d') + '2200', nxt.strftime('%Y%m%d') + '2200'
            try:
                xml = es._entsoe_fetch(token, {'documentType': 'A44', 'in_Domain': eic, 'out_Domain': eic, 'periodStart': p0, 'periodEnd': p1})
            except Exception as e:
                print(f'{z} {d}→{nxt}: {e}'); xml = ''
            for day, seq, slots, allp in periods(xml):
                if day not in best or seq < best[day][0]:
                    best[day] = (seq, slots, allp)
            print(f'{z} {d} → {nxt}: {len(best)} days so far')
            d = nxt
            time.sleep(1)
        changed, worst = 0, (0, '')
        for day, (seq, slots, allp) in sorted(best.items()):
            fp = os.path.join(DAILY, day + '.json')
            if not os.path.exists(fp) or not allp:
                continue
            snap = json.load(open(fp))
            part = es.build_daily_snapshot(day, {z: slots}, {}).get('zones', {}).get(z)
            if not part:
                continue
            part['avg'] = round(sum(allp) / len(allp), 2)   # the day's average on every point (92, 96 or 100)
            zones = snap.setdefault('zones', {})
            old = (zones.get(z) or {}).get('avg')
            if old is not None and abs(old - part['avg']) < 0.005 and (zones.get(z) or {}).get('hourly') == part['hourly']:
                continue
            zones.setdefault(z, {}).update(part)   # prices only: production arrays stay
            json.dump(snap, open(fp, 'w'), separators=(',', ':'))
            changed += 1
            if old is not None and abs(old - part['avg']) > worst[0]:
                worst = (round(abs(old - part['avg']), 2), day)
        log['zones'][z] = {'days_read': len(best), 'days_changed': changed, 'largest_change': worst}
        print(z, log['zones'][z])
    es.recalc_summary_from_daily()
    json.dump(log, open(os.path.join(ROOT, 'data', 'history', 'repair_log.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
