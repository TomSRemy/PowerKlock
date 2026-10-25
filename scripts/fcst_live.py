#!/usr/bin/env python3
"""France: PowerKlock's combined solar and wind forecast for today and tomorrow, with its P10–P90 band.

The model fitted by fcst_national.py ("stack": the forecast tool's physics at 15 points weighted by the
installed fleet, each region's and each weather model's own load factor, the TSO day-ahead forecast as one
more input) is applied to the latest weather forecasts (Open-Meteo, the same models) and to the TSO forecast
of data/forecast.json. Walk-forward since 2024, it beats the TSO forecast alone: solar 3.4 vs 4.3 %, wind
2.6 vs 2.9 % of installed capacity. Band = P10 / P90 of its past errors at the same level (80 % of the hours
fell inside it).

Before the TSO publishes tomorrow's forecast (late afternoon), tomorrow runs on the weather-only variant
("n3", same physics, no TSO input; walk-forward: solar 4.0 vs TSO 4.3 %, wind 3.1 vs 2.9 %), flagged
"weatherOnly", so the price model can run in the morning; the evening runs take the TSO input back.

The day-ahead price enters the model (curtailment at negative prices); before the auction, the chance of
a negative price (data/neg_forecast.json) stands in for it.

Writes data/fr_fc_combined.json        python scripts/fcst_live.py
"""
import json
import os
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

import fcst_backtest as FB
import fcst_national as N

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'fr_fc_combined.json')


def load(p):
    try:
        return json.load(open(os.path.join(ROOT, p)))
    except (OSError, ValueError):
        return None


def hourly(a):
    """quarter-hour (or hourly) array of a day → 24 hourly means"""
    if not a:
        return [None] * 24
    k = max(1, len(a) // 24)
    out = []
    for h in range(24):
        v = [x for x in a[h * k:(h + 1) * k] if x is not None]
        out.append(sum(v) / len(v) if v else None)
    return out


def main():
    nat = load('data/history/fcst_national.json'); fc = load('data/forecast.json')
    if not nat or 'live' not in nat or not fc:
        raise SystemExit('model or TSO forecast missing')
    today = datetime.now(ZoneInfo('Europe/Paris')).date()
    days = sorted(set(fc['zones']['FR']['days']) | {today.isoformat(), (today + timedelta(days=1)).isoformat()})
    neg = (load('data/neg_forecast.json') or {}).get('days', {})
    prices = {}
    for y in {d[:4] for d in days}:
        j = load(f'data/history/fr_hourly/{y}.json')
        if j:
            prices.update({d: v.get('p') for d, v in j['days'].items()})
    cap = N.capacity()
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'method': __doc__.split('\n\n')[1].replace('\n', ' '), 'unit': 'MW', 'days': {}, 'skill': {}}
    for tech in ('solar', 'wind'):
        L = nat['live'][tech]; beta = np.array(L['beta']); wts = np.array(L['weights']); models = L['models']
        pts = [N.POINTS[n] for n in L['points']]
        hourly_v = 'global_tilted_irradiance,temperature_2m' if tech == 'solar' else 'wind_speed_100m'
        res = FB.get('https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode({
            'latitude': ','.join(str(p[0]) for p in pts), 'longitude': ','.join(str(p[1]) for p in pts), 'hourly': hourly_v,
            'models': ','.join(models), 'tilt': 30, 'azimuth': 0, 'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris',
            'start_date': days[0], 'end_date': days[-1]}))
        W = res if isinstance(res, list) else [res]
        T = W[0]['hourly']['time']
        r_ = nat['results'][tech]
        out['skill'][tech] = {'combined': round(r_['stack']['nmae'] * 100, 2), 'tso': round(r_['ent']['nmae'] * 100, 2), 'coverage': L['coverage']}
        for d in days:
            z = fc['zones']['FR']['days'].get(d) or {}
            ent = hourly(z.get(tech))
            weather_only = False
            C = cap('solarGW' if tech == 'solar' else 'windGW', date.fromisoformat(d)) * 1000
            pr = prices.get(d) or [None] * 24
            np_ = (neg.get(d) or {}).get('prob') or [None] * 24
            mid, lo, hi = [], [], []
            for h in range(24):
                t = f'{d}T{h:02d}:00'
                if t not in T:
                    mid.append(None); lo.append(None); hi.append(None); continue
                kind = 'stack' if ent[h] is not None else 'n3'   # no TSO forecast for that hour yet: weather only
                if kind == 'n3' and 'n3' not in L:
                    mid.append(None); lo.append(None); hi.append(None); continue
                weather_only = weather_only or kind == 'n3'
                i = T.index(t)
                M = []
                for m in models:
                    v = []
                    for H in W:
                        hh = H['hourly']
                        if tech == 'solar':
                            g, tt = hh.get(f'global_tilted_irradiance_{m}'), hh.get(f'temperature_2m_{m}') or hh.get('temperature_2m_best_match')
                            x = FB.solar_lf(g[i], tt[i] if tt and tt[i] is not None else 15) if g and g[i] is not None else None
                        else:
                            ws = hh.get(f'wind_speed_100m_{m}')
                            x = FB.wind_lf(ws[i] * 1.2 ** 0.14) if ws and ws[i] is not None else None
                        v.append(x)
                    M.append(v)
                M = np.array([[np.nan if x is None else x for x in row] for row in M], dtype=float)
                if np.isnan(M).all():
                    mid.append(None); lo.append(None); hi.append(None); continue
                M = np.where(np.isnan(M), np.nanmean(M, axis=0, keepdims=True), M)   # a model missing at a point: the others' mean
                per = M @ wts
                cs = FB.clear_sky_ghi(t, 46.5)
                r = {'m': int(d[5:7]), 'mu': float(per.mean()), 'sd': float(per.std()), 'n0': float(per[0]), 'cs': cs, 'M': M,
                     'p': pr[h] if pr and h < len(pr) else None, 'negp': None, 'ent': ent[h] / C if ent[h] is not None else 0.0}
                if r['p'] is None and np_[h] is not None:
                    r['negp'] = np_[h]
                bk, bd = (beta, L['band']) if kind == 'stack' else (np.array(L['n3']['beta']), L['n3']['band'])
                y = 0.0 if tech == 'solar' and cs <= 0 else float(min(1.0, max(0.0, np.array(N.feats(r, tech, wts, kind)) @ bk)))
                q = next((b for b in bd if b[0] <= y < b[1]), bd[-1])
                mid.append(round(y * C)); lo.append(round(max(0.0, y + q[2]) * C)); hi.append(round(min(1.0, y + q[3]) * C))
            o = out['days'].setdefault(d, {})
            o[tech] = {'mid': mid, 'p10': lo, 'p90': hi, 'tso': [None if x is None else round(x) for x in ent]}
            if weather_only:
                o[tech]['weatherOnly'] = True
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print({d: {t: round(sum(x or 0 for x in v[t]['mid']) / 1000, 1) for t in v} for d, v in out['days'].items()}, out['skill'])


if __name__ == '__main__':
    main()
