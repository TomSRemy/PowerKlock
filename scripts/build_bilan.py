"""data/history/bilan.json: the yearly review of the French power system, RTE "Bilan électrique" style, rebuilt every
day so the current year reads "to date" and every past year is complete.

Per year (2015 → this year), and for this year also the same period of the year before:
  consumption, peak, production by source, low-carbon share, net exports, exports by border (physical, from 2020),
  direct CO₂ (tonnes and g/kWh), spot (average, negative hours, hours above 100 €, highest day), installed capacity
Per month, every year: production by source, consumption, spot average, negative hours (for the monthly charts)
Sources: RTE éCO2mix daily (history/rte/fr_daily.json), day-ahead history (history/summary.json, France),
Energy-Charts physical flows (history/flows), installed capacity (history/capacity.json).
Checked on 2025 against RTE's Bilan électrique 2025: nuclear 373.0 TWh (RTE 373.0), production 545.8 (547.5),
net exports 93.2 (92.3), spot 61.1 €/MWh (61), negative hours 509 (513).   python scripts/build_bilan.py"""
import collections
import glob
import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo

H = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'history')
SRC = {'nuclear': 'nuclearAvg', 'hydro': 'hydroAvg', 'wind': 'windAvg', 'solar': 'solarAvg', 'bio': 'bioAvg', 'gas': 'gasAvg', 'coal': 'coalAvg', 'oil': 'oilAvg'}
FOSSIL = ('gas', 'coal', 'oil')
r1 = lambda v, n=1: None if v is None else round(v, n)   # noqa: E731


def main():
    rows = json.load(open(os.path.join(H, 'rte', 'fr_daily.json')))['rows']
    summ = json.load(open(os.path.join(H, 'summary.json')))['zones'].get('FR', [])
    px = {r['d']: r for r in summ if r.get('avg') is not None}
    last = max(r['d'] for r in rows)
    today = datetime.now(ZoneInfo('Europe/Paris')).date().isoformat()
    last = min(last, today)
    cut = last[5:]   # the current year runs to this day: the comparison year is cut at the same day

    def agg(year, upto=None):
        t = collections.Counter()
        days, peak, peak_d, co2_t = 0, 0, None, 0.0
        for r in rows:
            if r['d'][:4] != str(year) or (upto and r['d'][5:] > upto) or r['d'] > last:
                continue
            days += 1
            prod_gwh = 0.0
            for k, f in SRC.items():
                v = r.get(f) or 0
                t[k] += v * 24 / 1e6
                prod_gwh += v * 24 / 1e3
            t['load'] += (r.get('loadAvg') or 0) * 24 / 1e6
            t['exch'] += (r.get('exchAvg') or 0) * 24 / 1e6
            t['export_days'] += 1 if (r.get('exchAvg') or 0) < 0 else 0
            co2_t += (r.get('co2Avg') or 0) * prod_gwh   # g/kWh × GWh = t
            if (r.get('loadMax') or 0) > peak:
                peak, peak_d = r['loadMax'], r['d']
        if not days:
            return None
        prod = sum(t[k] for k in SRC)
        p = [px[d] for d in sorted(px) if d[:4] == str(year) and (not upto or d[5:] <= upto) and d <= last]
        # the production mix the way EEX publishes it (the residual-mix files): pumped-storage output left out, it is
        # stored energy, not primary production
        ps = sum((r.get('hydroPSAvg') or 0) * 24 / 1e6 for r in rows if r['d'][:4] == str(year) and (not upto or r['d'][5:] <= upto) and r['d'] <= last)
        prod_x = prod - ps
        mix_eex_way = {k: r1(100 * (t[k] - (ps if k == 'hydro' else 0)) / prod_x, 2) for k in SRC} if prod_x > 0 else None
        out = {'days': days, 'load': r1(t['load']), 'peak_gw': r1(peak / 1000), 'peak_day': peak_d, 'production': r1(prod),
               'by_source': {k: r1(t[k], 2) for k in SRC}, 'low_carbon_pct': r1(100 * (prod - sum(t[k] for k in FOSSIL)) / prod) if prod else None,
               'net_export': r1(-t['exch']), 'export_days_pct': r1(100 * t['export_days'] / days),
               'co2_mt': r1(co2_t / 1e6, 2), 'pumped_storage_twh': r1(ps, 2), 'production_ex_ps': r1(prod_x), 'mix_ex_ps': mix_eex_way, 'co2_g_kwh': r1(co2_t / (prod * 1e6) * 1e3) if prod else None}
        if p:
            mx = max(p, key=lambda r: r['avg'])
            out['spot'] = {'avg': r1(sum(r['avg'] for r in p) / len(p), 2), 'neg_h': r1(sum(r.get('negH') or 0 for r in p), 0), 'high_h': r1(sum(r.get('highH') or 0 for r in p), 0),
                           'max_day': mx['d'], 'max_day_avg': r1(mx['avg'], 2), 'days': len(p)}
        return out

    def borders(year, upto=None):
        acc = collections.Counter()
        n = 0
        for fp in sorted(glob.glob(os.path.join(H, 'flows', f'{year}-*.json'))):
            for d, z in (json.load(open(fp)).get('days') or {}).items():
                if (upto and d[5:] > upto) or d > last or 'FR' not in z:
                    continue
                n += 1
                for nb, arr in z['FR'].items():
                    vals = [v for v in arr if v is not None]
                    if vals:
                        acc[nb] += sum(vals) / len(vals) * 24 / 1e6   # MW → TWh (+ import, − export)
        return {nb: r1(-v, 2) for nb, v in acc.items()} if n else None   # positive = net export to that neighbour

    def months(year):
        m = collections.defaultdict(lambda: collections.Counter())
        for r in rows:
            if r['d'][:4] == str(year) and r['d'] <= last:
                mm = r['d'][:7]
                for k, f in SRC.items():
                    m[mm][k] += (r.get(f) or 0) * 24 / 1e6
                m[mm]['load'] += (r.get('loadAvg') or 0) * 24 / 1e6
        sp = collections.defaultdict(list)
        neg = collections.Counter()
        for d, r in px.items():
            if d[:4] == str(year) and d <= last:
                sp[d[:7]].append(r['avg'])
                neg[d[:7]] += r.get('negH') or 0
        return {mm: dict({k: r1(v, 2) for k, v in m[mm].items()}, spot=r1(sum(sp[mm]) / len(sp[mm]), 2) if sp[mm] else None, neg_h=r1(neg[mm], 0)) for mm in sorted(m)}

    cap = {}
    try:
        c = json.load(open(os.path.join(H, 'capacity.json')))['countries']['FR']
        groups = {'nuclear': ['Nuclear'], 'solar': ['Solar AC', 'Solar'], 'wind_on': ['Wind onshore'], 'wind_off': ['Wind offshore'], 'hydro': ['Hydro Run-of-River', 'Hydro water reservoir', 'Hydro pumped storage'],
                  'gas': ['Fossil gas'], 'bio': ['Biomass']}
        for i, y in enumerate(c['years']):
            cap[str(y)] = {g: r1(sum((c['types'].get(t) or [None] * 99)[i] or 0 for t in ts), 2) for g, ts in groups.items()}
    except Exception as e:   # noqa: BLE001 — capacity is optional
        print('capacity skipped:', e)

    y0 = int(last[:4])
    years = {}
    for y in range(2015, y0 + 1):
        a = agg(y)
        if a:
            a['complete'] = y < y0
            a['borders'] = borders(y) if y >= 2020 else None
            a['capacity'] = cap.get(str(y))
            years[str(y)] = a
    cur = {'year': y0, 'to': last, 'now': years.get(str(y0)), 'prev_same_period': agg(y0 - 1, cut), 'prev_borders_same_period': borders(y0 - 1, cut)}
    out = {'updated': datetime.now(ZoneInfo('Europe/Paris')).isoformat(timespec='minutes'), 'to': last,
           'source': 'RTE éCO2mix (production, consumption, exchanges, CO₂), ENTSO-E day-ahead, Energy-Charts (flows by border, capacity)',
           'current': cur, 'years': years, 'months': {str(y): months(y) for y in range(2015, y0 + 1)},   # every year: its monthly charts and the events they show
           'check_2025': {'note': 'PowerKlock vs RTE Bilan électrique 2025', 'nuclear': [r1(years.get('2025', {}).get('by_source', {}).get('nuclear')), 373.0],
                          'production': [years.get('2025', {}).get('production'), 547.5], 'net_export': [years.get('2025', {}).get('net_export'), 92.3],
                          'spot': [years.get('2025', {}).get('spot', {}).get('avg'), 61.0], 'neg_h': [years.get('2025', {}).get('spot', {}).get('neg_h'), 513]}}
    path = os.path.join(H, 'bilan.json')
    with open(path, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('Wrote', path, f'({os.path.getsize(path) // 1024} KB) · to {last} · check 2025:', out['check_2025'])


if __name__ == '__main__':
    main()
