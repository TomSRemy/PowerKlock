#!/usr/bin/env python3
"""Prices of activated balancing energy in France (ENTSO-E A84), day by day.

The price RTE paid (upward) or received (downward) for the balancing energy it activated:
aFRR (secondary reserve) and mFRR (manual, tertiary), against the day-ahead spot. It explains
the imbalance price of the Imbalance page: when the system is short, upward activations set it.

Writes data/history/fr_activation.json:
  {"updated", "source", "diag": [...], "days": {"YYYY-MM-DD": {"afrr": {"up", "upMax", "down", "downMin", "n"},
   "mfrr": {...}, "spot"}}}   (€/MWh, means of the quarter-hours with an activation; Paris days)

    ENTSOE_TOKEN=… python scripts/fetch_fr_activation.py            # last 14 days (120 if no file yet)
    ENTSOE_TOKEN=… python scripts/fetch_fr_activation.py --days 120
"""
import json, os, sys
from datetime import date, datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_fr_imbalance_cost import fetch, series, text_in, DIAG, FR, PARIS, ROOT   # same ENTSO-E access and XML reading

OUT = os.path.join(ROOT, 'data', 'history', 'fr_activation.json')
PRODUCTS = {'A96': 'afrr', 'A97': 'mfrr'}


def window(d0, d1):
    a = datetime(d0.year, d0.month, d0.day, tzinfo=PARIS).astimezone(timezone.utc)
    b = datetime(d1.year, d1.month, d1.day, tzinfo=PARIS).astimezone(timezone.utc)
    return a.strftime('%Y%m%d%H%M'), b.strftime('%Y%m%d%H%M')


def spot(day):
    try:
        h = json.load(open(os.path.join(ROOT, 'data', 'history', 'daily', f'{day}.json')))['zones']['FR'].get('avg')
        return round(h, 2) if h is not None else None
    except Exception:
        return None


def main():
    old = json.load(open(OUT)) if os.path.exists(OUT) else {'days': {}}
    n = int(sys.argv[sys.argv.index('--days') + 1]) if '--days' in sys.argv else (14 if old['days'] else 120)
    end = date.today()
    days = old['days']
    d = end - timedelta(days=n)
    while d < end:
        nxt = min(d + timedelta(days=7), end)   # a week per request
        p0, p1 = window(d, nxt)
        for bt, prod in PRODUCTS.items():
            xml = fetch({'documentType': 'A84', 'processType': 'A16', 'businessType': bt, 'controlArea_Domain': FR, 'periodStart': p0, 'periodEnd': p1})
            ser = series(xml, 'activation_Price.amount', lambda ts: ('up' if text_in(ts, 'flowDirection.direction') == 'A01' else 'down',))
            by = {}
            for (direction,), pts in ser.items():
                for t, v in pts.items():
                    day = t.astimezone(PARIS).date().isoformat()
                    by.setdefault(day, {}).setdefault(direction, []).append(v)
            for day, dd in by.items():
                rec = {'n': sum(len(v) for v in dd.values())}
                if dd.get('up'):
                    rec.update(up=round(sum(dd['up']) / len(dd['up']), 2), upMax=round(max(dd['up']), 2))
                if dd.get('down'):
                    rec.update(down=round(sum(dd['down']) / len(dd['down']), 2), downMin=round(min(dd['down']), 2))
                days.setdefault(day, {})[prod] = rec
        d = nxt
    for day in days:
        days[day]['spot'] = spot(day)
    if not any(v.get('afrr') or v.get('mfrr') for v in days.values()):
        json.dump({'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'diag': DIAG[-20:], 'days': {}}, open(OUT, 'w'), indent=1)
        sys.exit('no activation price returned (see diag in the file)')
    json.dump({'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
               'source': 'ENTSO-E Transparency, prices of activated balancing energy (A84), France, aFRR (A96) and mFRR (A97)',
               'diag': DIAG[-10:], 'days': dict(sorted(days.items())[-400:])}, open(OUT, 'w'), separators=(',', ':'))
    print(len(days), 'days', sorted(days)[-1], days[sorted(days)[-1]])


if __name__ == '__main__':
    main()
