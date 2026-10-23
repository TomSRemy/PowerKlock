#!/usr/bin/env python3
"""Germany, Belgium, Spain: the France method (scripts/fcst_national.py) applied to each neighbour.

Points: a handful per country spread over where its solar and wind fleets stand (equal weights to start;
the model learns each point's own weight, so the exact split matters little). Truth: hourly output on the
Paris clock (data/history/region_hourly, Energy-Charts). TSO forecast: ENTSO-E day-ahead (Energy-Charts).
Capacity: Energy-Charts yearly (data/history/country_capture.json), last pace extended.
Walk-forward by month as for France; the fitted combined model is kept for the live run
(scripts/fcst_live.py --neighbours).

Writes data/history/fcst_neighbours.json      python scripts/fcst_neighbours.py [DE BE ES]
"""
import json
import os
import sys
import urllib.parse
from datetime import date

import numpy as np

import fcst_backtest as FB
import fcst_national as N

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'fcst_neighbours.json')
EC = {'DE': 'de', 'BE': 'be', 'ES': 'es'}
CAPKEY = {'DE': 'DE', 'BE': 'BE', 'ES': 'ES'}
# (lat, lon, solar weight, wind weight)
PTS = {
    'DE': {'Schleswig-Holstein': (54.3, 9.6, 0.5, 2), 'Lower Saxony': (52.8, 8.5, 1, 2), 'Brandenburg': (52.4, 13.6, 1, 1.5), 'Saxony-Anhalt': (51.9, 11.6, 0.8, 1.5),
           'North Rhine-Westphalia': (51.4, 7.4, 1, 1), 'Bavaria': (48.8, 11.5, 2.5, 0.3), 'Baden-Württemberg': (48.5, 9.0, 1.5, 0.2),
           'North Sea offshore': (54.4, 6.6, 0, 1.5), 'Baltic offshore': (54.7, 13.9, 0, 0.3)},
    'BE': {'Flanders west': (51.0, 3.2, 1, 1), 'Flanders east': (51.1, 4.6, 1.5, 0.8), 'Wallonia': (50.4, 4.8, 1, 1),
           'Belgian offshore': (51.6, 2.9, 0, 1.5)},
    'ES': {'Galicia': (42.8, -8.0, 0.1, 1.2), 'Castilla y León': (41.8, -4.5, 0.8, 1.5), 'Aragón': (41.6, -0.9, 0.8, 1.2), 'Castilla-La Mancha': (39.4, -3.2, 1.5, 1),
           'Andalucía': (37.5, -5.0, 1.5, 0.8), 'Extremadura': (38.9, -6.3, 1.5, 0.1), 'Murcia–Valencia': (38.4, -1.0, 1, 0.3), 'Catalonia': (41.6, 1.5, 0.4, 0.5)},
}


def actual(cc):
    out = {}
    for y in range(int(N.START[:4]), int(N.END[:4]) + 1):
        try:
            c = json.load(open(os.path.join(ROOT, 'data', 'history', 'region_hourly', f'{y}.json')))['countries'][cc]
        except (OSError, KeyError):
            continue
        for d, s in c['s'].items():
            w = c['w'].get(d)
            for h in range(24):
                out[f'{d}T{h:02d}'] = [s[h] if s else None, w[h] if w else None]
    return out


def entsoe(cc):
    def fetch():
        out = {}
        d = date.fromisoformat(N.START).replace(day=1); end = date.fromisoformat(N.END)
        while d <= end:
            nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
            for k, pt in enumerate(('solar', 'wind_onshore', 'wind_offshore')):
                if pt == 'wind_offshore' and cc == 'ES':
                    continue
                j = FB.get('https://api.energy-charts.info/public_power_forecast?' + urllib.parse.urlencode(
                    {'country': EC[cc], 'production_type': pt, 'forecast_type': 'day-ahead', 'start': d.isoformat(), 'end': date.fromordinal(nxt.toordinal() - 1).isoformat()}))
                if not j or not j.get('unix_seconds'):
                    continue
                acc = {}
                for t, v in zip(j['unix_seconds'], j['forecast_values']):
                    if v is None:
                        continue
                    a = acc.setdefault(N.paris_hour(t), [0.0, 0]); a[0] += v; a[1] += 1
                for h, (s, n) in acc.items():
                    o = out.setdefault(h, [None, None]); i = 0 if k == 0 else 1
                    o[i] = (o[i] or 0) + s / n
            d = nxt
        return out
    return FB.cached(f'entsoe_{cc}_dayahead', fetch)


def capacity(cc):
    cy = json.load(open(os.path.join(ROOT, 'data', 'history', 'country_capture.json')))['countries'][CAPKEY[cc]]['years']
    def at(key, d):
        ys = sorted(int(y) for y in cy if cy[y].get(key))
        x = d.year + (d.timetuple().tm_yday - 0.5) / 366 - 0.5
        pts = [(y, cy[str(y)][key]) for y in ys]
        for (y0, v0), (y1, v1) in zip(pts, pts[1:]):
            if y0 <= x <= y1:
                return v0 + (v1 - v0) * (x - y0) / (y1 - y0)
        (y0, v0), (y1, v1) = pts[-2], pts[-1]
        return v1 + (v1 - v0) * (x - y1)
    return at


def run(cc):
    pts = PTS[cc]
    # France's machinery, pointed at this country
    N.POINTS = {n: (p[0], p[1], p[2], p[3], 0) for n, p in pts.items()}
    N.actual = lambda: actual(cc)
    N.entsoe = lambda: entsoe(cc)
    N.capacity = lambda: capacity(cc)
    _w = N.weather
    def weather(tech, _cc=cc):
        names = list(N.POINTS)
        def fetch():
            lat = ','.join(str(N.POINTS[n][0]) for n in names); lon = ','.join(str(N.POINTS[n][1]) for n in names)
            if tech == 'solar':
                hourly = 'global_tilted_irradiance_previous_day1,temperature_2m_previous_day1'; models = N.M_SOLAR
            else:
                hourly = 'wind_speed_100m_previous_day1'; models = N.M_WIND
            res = FB.get('https://previous-runs-api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode({
                'latitude': lat, 'longitude': lon, 'hourly': hourly, 'models': ','.join(models), 'tilt': 30, 'azimuth': 0,
                'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris', 'start_date': N.START, 'end_date': N.END}))
            return [r['hourly'] for r in (res if isinstance(res, list) else [res])]
        return names, FB.cached(f'nb_wx_{_cc}_{tech}', fetch)
    N.weather = weather
    res, live = {}, {}
    for tech in ('solar', 'wind'):
        rows, wts = N.frame(tech)
        if len(rows) < 24 * 200:
            print(cc, tech, 'too few hours', len(rows)); continue
        rows = N.walk(rows, tech, wts)
        res[tech] = {k: N.score(rows, k, tech) for k in ('ent', 'n2', 'n3', 'mix', 'stack')}
        last = max(r['ym'] for r in rows); now = int(last[:4]) * 12 + int(last[5:7]) + 1
        tr = [r for r in rows if tech != 'solar' or r['cs'] > 0]
        q, cov = N.band(rows, tech)
        live[tech] = {'beta': [round(float(x), 6) for x in N.fit(tr, tech, wts, 'stack', now)], 'points': list(N.POINTS), 'coords': [[N.POINTS[n][0], N.POINTS[n][1]] for n in N.POINTS],
                      'weights': [round(float(x), 5) for x in wts], 'models': list(N.M_SOLAR if tech == 'solar' else N.M_WIND), 'band': q, 'coverage': cov, 'fitted_to': last}
        print(cc, tech, {k: round(v['nmae'] * 100, 2) for k, v in res[tech].items()}, 'band coverage', cov)
    N.weather = _w
    return res, live


def main():
    ccs = sys.argv[1:] or list(PTS)
    try:
        out = json.load(open(OUT))
    except (OSError, ValueError):
        out = {'protocol': __doc__.split('Writes')[0].strip(), 'period': [N.START, N.END], 'results': {}, 'live': {}}
    for cc in ccs:
        r, l = run(cc)
        if r:
            out['results'][cc] = r; out['live'][cc] = l
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
