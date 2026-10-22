#!/usr/bin/env python3
"""France as a whole: our production forecast against the TSO day-ahead forecast (ENTSO-E).

Truth    national solar and wind output, hourly MW (RTE éCO2mix, data/history/fr_hourly)
ENTSO-E  day-ahead forecast of solar and wind (onshore + offshore) published the day before
         (ENTSO-E transparency, via Energy-Charts), hourly MW
Ours     the forecast tool's model on the forecast issued the day before (Open-Meteo previous runs,
         best model + Météo-France / ICON / GFS): one point per region weighted by the region's
         installed capacity (national registry), offshore farms as their own points; then
           N0  generic model × installed capacity
           N1  + monthly level learned walk-forward
           N2  + regression on the forecast variables, the day-ahead price and the models'
               disagreement, recent months weighing more (the v6 recipe of fcst_backtest.py)
         and the blend of N2 with ENTSO-E (average)
Score    walk-forward by month (corrections learned on the months before, at least 6), error in
         % of the installed capacity (Energy-Charts yearly, interpolated), solar on daylight hours

Writes data/history/fcst_national.json    python scripts/fcst_national.py
"""
import json
import os
import urllib.parse
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

import fcst_backtest as FB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'fcst_national.json')
START, END = FB.START, FB.END
PARIS = ZoneInfo('Europe/Paris')
# (lat, lon, solar GW, onshore wind GW, offshore wind GW) — national registry of installations (ODRÉ), 2026
POINTS = {
    'Nouvelle-Aquitaine': (45.2, 0.3, 7.46, 2.30, 0), 'Occitanie': (43.7, 2.1, 5.63, 1.84, 0),
    'Auvergne-Rhône-Alpes': (45.5, 4.6, 4.36, 0.80, 0), "Provence-Alpes-Côte d'Azur": (43.9, 6.0, 3.03, 0.10, 0),
    'Grand Est': (48.7, 5.6, 2.77, 5.25, 0), 'Pays de la Loire': (47.4, -0.8, 2.47, 1.48, 0),
    'Centre-Val de Loire': (47.5, 1.7, 2.28, 1.89, 0), 'Bourgogne-Franche-Comté': (47.2, 4.8, 2.01, 1.25, 0),
    'Hauts-de-France': (50.0, 2.8, 1.29, 6.86, 0), 'Bretagne': (48.2, -2.9, 1.21, 1.50, 0),
    'Normandie': (49.1, 0.2, 0.81, 1.18, 0), 'Île-de-France': (48.7, 2.5, 0.60, 0.15, 0),
    'Offshore Saint-Nazaire / Yeu': (47.1, -2.6, 0, 0, 0.98), 'Offshore Fécamp / Courseulles': (49.8, 0.1, 0, 0, 0.74),
    'Offshore Saint-Brieuc': (48.85, -2.55, 0, 0, 0.50),
}
M_SOLAR = ('best_match', 'meteofrance_seamless', 'icon_seamless', 'gfs_seamless')
M_WIND = ('best_match', 'icon_seamless', 'gfs_seamless')


def paris_hour(unix):
    return datetime.fromtimestamp(unix, timezone.utc).astimezone(PARIS).strftime('%Y-%m-%dT%H')


def entsoe():
    """ENTSO-E day-ahead forecast for France, hourly MW {hour: [solar, wind]}"""
    def fetch():
        out = {}
        d = date.fromisoformat(START).replace(day=1)
        end = date.fromisoformat(END)
        while d <= end:
            nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
            for k, pt in enumerate(('solar', 'wind_onshore', 'wind_offshore')):
                j = FB.get('https://api.energy-charts.info/public_power_forecast?' + urllib.parse.urlencode(
                    {'country': 'fr', 'production_type': pt, 'forecast_type': 'day-ahead', 'start': d.isoformat(), 'end': (nxt.toordinal() - 1 and date.fromordinal(nxt.toordinal() - 1)).isoformat()}))
                if not j or not j.get('unix_seconds'):
                    continue
                acc = {}
                for t, v in zip(j['unix_seconds'], j['forecast_values']):
                    if v is None:
                        continue
                    a = acc.setdefault(paris_hour(t), [0.0, 0]); a[0] += v; a[1] += 1
                for h, (s, n) in acc.items():
                    o = out.setdefault(h, [None, None])
                    i = 0 if k == 0 else 1
                    o[i] = (o[i] or 0) + s / n
            d = nxt
        return out
    return FB.cached('entsoe_fr_dayahead', fetch)


def actual():
    out = {}
    for y in range(int(START[:4]), int(END[:4]) + 1):
        try:
            days = json.load(open(os.path.join(ROOT, 'data', 'history', 'fr_hourly', f'{y}.json')))['days']
        except OSError:
            continue
        for d, v in days.items():
            for h in range(24):
                s = v['s'][h] if v.get('s') else None; w = v['w'][h] if v.get('w') else None
                out[f'{d}T{h:02d}'] = [s, w]
    return out


def capacity():
    """installed GW by year (Energy-Charts), interpolated by day; extrapolated with the last pace"""
    cc = json.load(open(os.path.join(ROOT, 'data', 'history', 'country_capture.json')))['countries']['FR']['years']
    ys = sorted(int(y) for y in cc if cc[y].get('solarGW'))
    def at(key, d):
        x = d.year + (d.timetuple().tm_yday - 0.5) / 366 - 0.5   # yearly value read at mid-year
        pts = [(y, cc[str(y)][key]) for y in ys]
        for (y0, v0), (y1, v1) in zip(pts, pts[1:]):
            if y0 <= x <= y1:
                return v0 + (v1 - v0) * (x - y0) / (y1 - y0)
        (y0, v0), (y1, v1) = pts[-2], pts[-1]
        return v1 + (v1 - v0) * (x - y1)
    return at


def weather(tech):
    names = list(POINTS)
    def fetch():
        lat = ','.join(str(POINTS[n][0]) for n in names); lon = ','.join(str(POINTS[n][1]) for n in names)
        if tech == 'solar':
            hourly = 'global_tilted_irradiance_previous_day1,temperature_2m_previous_day1,shortwave_radiation_previous_day1'; models = M_SOLAR
        else:
            hourly = 'wind_speed_100m_previous_day1,wind_speed_120m_previous_day1'; models = M_WIND
        res = FB.get('https://previous-runs-api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode({
            'latitude': lat, 'longitude': lon, 'hourly': hourly, 'models': ','.join(models), 'tilt': 30, 'azimuth': 0,
            'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris', 'start_date': START, 'end_date': END}))
        return [r['hourly'] for r in (res if isinstance(res, list) else [res])]
    return names, FB.cached(f'nat_wx_{tech}', fetch)


def frame(tech):
    names, W = weather(tech)
    act, ent, cap = actual(), entsoe(), capacity()
    T = W[0]['time']
    wts = np.array([POINTS[n][2] if tech == 'solar' else POINTS[n][3] + POINTS[n][4] for n in names]); wts = wts / wts.sum()
    models = M_SOLAR if tech == 'solar' else M_WIND
    rows = []
    for i, t in enumerate(T):
        k = t[:13]; a = act.get(k); e = ent.get(k)
        if not a or a[0 if tech == 'solar' else 1] is None or not e or e[0 if tech == 'solar' else 1] is None:
            continue
        per = []
        for m in models:
            vals = []
            for p, H in enumerate(W):
                if tech == 'solar':
                    g = H.get(f'global_tilted_irradiance_previous_day1_{m}'); tt = H.get('temperature_2m_previous_day1_best_match')
                    v = FB.solar_lf(g[i], tt[i]) if g and g[i] is not None else None
                else:
                    ws = H.get(f'wind_speed_100m_previous_day1_{m}')
                    v = FB.wind_lf(ws[i] * 1.2 ** 0.14) if ws and ws[i] is not None else None
                if v is None:
                    break
                vals.append(v)
            if len(vals) == len(W):
                per.append(float(np.dot(wts, vals)))
        if not per:
            continue
        d = date.fromisoformat(t[:10])
        C = cap('solarGW' if tech == 'solar' else 'windGW', d) * 1000
        cs = FB.clear_sky_ghi(t, 46.5)
        rows.append({'t': t, 'ym': t[:7], 'm': int(t[5:7]), 'h': int(t[11:13]), 'C': C, 'y': a[0 if tech == 'solar' else 1] / C,
                     'ent': e[0 if tech == 'solar' else 1] / C, 'n0': per[0], 'mu': float(np.mean(per)), 'sd': float(np.std(per)),
                     'cs': cs, 'p': FB.price(t)})
    return rows


def walk(rows, tech):
    months = sorted({r['ym'] for r in rows})
    for k, mth in enumerate(months):
        test = [r for r in rows if r['ym'] == mth]
        if k < 6:
            for r in test:
                r['n1'] = r['n2'] = None
            continue
        tr = [r for r in rows if r['ym'] < mth and (tech != 'solar' or r['cs'] > 0)]
        free = [r for r in tr if r['p'] is None or r['p'] > 5]
        sc = sum(r['y'] for r in free) / max(1e-9, sum(r['mu'] for r in free))
        def feats(r):
            p = r['p']; neg = 1.0 if p is not None and p <= 0 else 0.0; low = 1.0 if p is not None and 0 < p <= 10 else 0.0
            base = [1, r['mu'], r['mu'] ** 2, r['n0'], r['sd'], r['mu'] * r['sd'], neg * r['mu'], low * r['mu'], neg,
                    np.sin(2 * np.pi * r['m'] / 12), np.cos(2 * np.pi * r['m'] / 12)]
            if tech == 'solar':
                base += [r['cs'] / 1000, r['mu'] * np.sin(2 * np.pi * r['m'] / 12)]
            return base
        now = int(mth[:4]) * 12 + int(mth[5:7])
        w = np.array([0.5 ** ((now - (int(r['ym'][:4]) * 12 + int(r['ym'][5:7]))) / 6.0) for r in tr])
        X = np.array([feats(r) for r in tr]); Y = np.array([r['y'] for r in tr])
        lam = 1e-3 * np.eye(X.shape[1]); lam[0, 0] = 0
        beta = np.linalg.solve(X.T @ (w[:, None] * X) + w.sum() * lam, X.T @ (w * Y))
        for r in test:
            r['n1'] = min(1.0, r['mu'] * sc)
            r['n2'] = 0.0 if tech == 'solar' and r['cs'] <= 0 else float(min(1.0, max(0.0, np.array(feats(r)) @ beta)))
    for r in rows:
        r['mix'] = None if r.get('n2') is None else (r['n2'] + r['ent']) / 2
    return rows


def score(rows, key, tech):
    rr = [r for r in rows if r.get('n2') is not None and (tech != 'solar' or r['cs'] > 0)]
    e = np.array([r[key] - r['y'] for r in rr])
    days = {}
    for r in rr:
        a = days.setdefault(r['t'][:10], [0.0, 0.0, 0.0]); a[0] += r[key] * r['C']; a[1] += r['y'] * r['C']; a[2] += r['C']
    de = [abs(a[0] - a[1]) / (a[2] / len(rr) * 0 + a[2]) for a in days.values()]
    return {'nmae': float(np.mean(np.abs(e))), 'bias': float(np.mean(e)), 'rmse': float(np.sqrt(np.mean(e ** 2))), 'nmae_day': float(np.mean(de)), 'n': len(rr)}


def main():
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'period': [START, END], 'results': {}, 'monthly': {}, 'sample': {}}
    for tech in ('solar', 'wind'):
        rows = walk(frame(tech), tech)
        res = {k: score(rows, k, tech) for k in ('ent', 'n0', 'n1', 'n2', 'mix')}
        out['results'][tech] = res
        print(tech, {k: (round(v['nmae'] * 100, 2), round(v['bias'] * 100, 2), round(v['nmae_day'] * 100, 2)) for k, v in res.items()})
        mon = {}
        for r in rows:
            if r.get('n2') is None or (tech == 'solar' and r['cs'] <= 0):
                continue
            a = mon.setdefault(r['ym'], {'ent': [], 'n2': [], 'mix': []})
            for k in a:
                a[k].append(abs(r[k] - r['y']))
        out['monthly'][tech] = {m: {k: round(float(np.mean(v)) * 100, 2) for k, v in a.items()} for m, a in sorted(mon.items())}
        d0 = '2026-03-16' if tech == 'solar' else '2026-02-02'
        out['sample'][tech] = [[r['t'], round(r['y'] * r['C']), round(r['ent'] * r['C']), round(r['n2'] * r['C']) if r.get('n2') is not None else None]
                               for r in rows if d0 <= r['t'][:10] < str(np.datetime64(d0) + np.timedelta64(7, 'D'))]
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
