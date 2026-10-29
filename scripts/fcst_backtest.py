#!/usr/bin/env python3
"""Backtest of the production forecast tool (Tools › Production forecast) on real data.

Truth   RTE éCO2mix regional, definitive data: hourly load factor of solar and wind
        (tch_solaire, tch_eolien = production ÷ installed capacity) per region.
Weather Open-Meteo 'previous runs' archive: the forecast issued THE DAY BEFORE
        (…_previous_day1), best model, available from early 2024 — exactly what
        the tool would have shown the day before.
Test    walk-forward by month: every correction is learned on the months before the
        month it predicts (at least 6), from Feb 2024 to Aug 2026.
Score   nMAE = mean |forecast − actual| ÷ capacity, hourly (and on daily energy),
        bias = mean (forecast − actual) ÷ capacity; solar on daylight hours only.

Steps compared (each adds to the previous one)
  v0  the tool as published: generic model at one point (region centre)
  v1  same model averaged over a 3 × 3 grid of points (a fleet is spread out)
  v2  + monthly bias correction learned walk-forward (scale factor)
  v3  + learned shape: solar, correction by month × hour of day; wind, empirical
      power curve (binned forecast wind → actual load factor) instead of the
      generic curve
  v4  + regression on several forecast features (MOS): solar irradiance, clear-sky
      ratio, temperature, hour; wind: speed at 100 and 120 m and its cube
  v5  + the day-ahead price (known after the auction, the day before): hours at
      prices ≤ 0 € are curtailed by part of the fleet, so the forecast drops there
  v6  + several weather models (Météo-France, ICON, GFS next to the best model):
      their average and their disagreement as features; recent months weigh more
      (half-life 6 months) so the correction follows the fleet as it changes

  v3h the regional fleet mode of the tool: v1 + v3's shape relearned with recent months
      weighing more (half-life 6 months; tested 6, 12, 24 months and none: 6 is best on the
      last 6 months in 6 of 7 cases)

Truth after RTE's definitive regional data ends (31 Aug. 2026 today) comes from its real-time
regional data (eco2mix-regional-tr), so the correction is relearned every week up to yesterday;
the regional installed capacity is read from the same real-time data (output ÷ load factor).

Writes data/history/fcst_backtest.json and data/history/fcst_calib.json (the solar
correction by month × hour the tool applies, learned on hours priced above 10 €/MWh,
so the curtailment at negative prices does not leak into it)
    python scripts/fcst_backtest.py
"""
import json
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('PK_FC_CACHE', os.path.join(ROOT, '.cache', 'fcst'))
OUT = os.path.join(ROOT, 'data', 'history', 'fcst_backtest.json')
START = '2024-02-20'
END = os.environ.get('PK_FC_END') or (datetime.now(ZoneInfo('Europe/Paris')).date() - timedelta(days=1)).isoformat()   # learnt up to yesterday (PK_FC_END: a fixed end, to rerun on a cache)
HALF_LIFE = 6.0   # months: the regional fleet's correction follows the fleet as it changes
REGIONS = {   # name in éCO2mix → (lat min, lat max, lon min, lon max), techs tested
    'Occitanie': ((42.6, 44.8, 0.0, 4.4), ('solar', 'wind')),
    'Nouvelle-Aquitaine': ((43.4, 46.8, -1.3, 2.2), ('solar',)),
    "Provence-Alpes-Côte d'Azur": ((43.3, 44.8, 4.7, 7.0), ('solar',)),
    'Grand Est': ((47.7, 49.9, 3.8, 7.6), ('wind',)),
    'Hauts-de-France': ((49.2, 50.9, 1.7, 4.0), ('wind',)),
    'Centre-Val de Loire': ((46.6, 48.6, 0.3, 2.8), ('wind',)),
}


def get(url, tries=6):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001 — rate limits and timeouts: wait and retry
            if k == tries - 1:
                raise
            time.sleep(20 * (k + 1))


def cached(name, fn):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name + '.json')
    if os.path.exists(p):
        return json.load(open(p))
    v = fn()
    json.dump(v, open(p, 'w'))
    return v


# ── truth: RTE regional load factors, hourly (Paris clock) ─────────────────
def truth(region):
    def fetch():
        out = {}
        spans = [('eco2mix-regional-cons-def', f'{y}-01-01' if y > 2024 else '2024-02-19', f'{y}-12-31') for y in range(2024, int(END[:4]) + 1)]
        spans.append(('eco2mix-regional-tr', '2026-08-31', END))   # the real-time data start where the definitive ones stop
        for ds, y0, y1 in spans:
            w = f'libelle_region="{region}" and date_heure>="{y0}" and date_heure<="{y1}T23:59:59"'
            url = (f'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/{ds}/exports/json?'
                   + urllib.parse.urlencode({'select': 'date_heure,tch_solaire,tch_eolien', 'where': w, 'timezone': 'Europe/Paris'}))
            for r in get(url):
                k = r['date_heure'][:13]
                o = out.setdefault(k, [0, 0, 0, 0])
                if r.get('tch_solaire') is not None:
                    o[0] += r['tch_solaire']; o[1] += 1
                if r.get('tch_eolien') is not None:
                    o[2] += r['tch_eolien']; o[3] += 1
        return {k: [v[0] / v[1] / 100 if v[1] else None, v[2] / v[3] / 100 if v[3] else None] for k, v in out.items()}
    return cached(f'truth_{END}_' + region.replace(' ', '_').replace("'", ''), fetch)


def capacity(region):
    """installed solar and wind MW of the region, last 30 days of RTE real-time data: median of output ÷ load factor"""
    def fetch():
        d0 = (date.today() - timedelta(days=30)).isoformat()   # today's fleet, whatever END is
        w = f'libelle_region="{region}" and date_heure>="{d0}"'
        url = ('https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-regional-tr/exports/json?'
               + urllib.parse.urlencode({'select': 'solaire,eolien,tch_solaire,tch_eolien', 'where': w}))
        rows = get(url)
        out = {}
        for tech, prod, tch in (('solar', 'solaire', 'tch_solaire'), ('wind', 'eolien', 'tch_eolien')):
            v = [r[prod] / (r[tch] / 100) for r in rows if r.get(prod) is not None and r.get(tch) is not None and r[tch] > 5]
            out[tech] = round(float(np.median(v))) if len(v) >= 20 else None
        return out
    return cached(f'cap_{END}_' + region.replace(' ', '_').replace("'", ''), fetch)


# ── weather: day-ahead forecasts at the grid points ───────────────────────
def grid(box, n=3):
    a, b, c, d = box
    return [(round(a + (b - a) * i / (n - 1), 3), round(c + (d - c) * j / (n - 1), 3)) for i in range(n) for j in range(n)]


def weather(region, box):
    pts = grid(box)
    def fetch():
        lat = ','.join(str(p[0]) for p in pts); lon = ','.join(str(p[1]) for p in pts)
        v = ['global_tilted_irradiance', 'shortwave_radiation', 'temperature_2m', 'wind_speed_100m', 'wind_speed_120m']
        url = ('https://previous-runs-api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode({
            'latitude': lat, 'longitude': lon, 'hourly': ','.join(x + '_previous_day1' for x in v), 'tilt': 30, 'azimuth': 0,
            'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris', 'start_date': START, 'end_date': END}))
        res = get(url)
        res = res if isinstance(res, list) else [res]
        return [{'time': r['hourly']['time'], **{x: r['hourly'][x + '_previous_day1'] for x in v}} for r in res]
    return pts, cached(f'wx_{END}_' + region.replace(' ', '_').replace("'", ''), fetch)


MODELS = {'solar': ('meteofrance_seamless', 'icon_seamless', 'gfs_seamless'), 'wind': ('icon_seamless', 'gfs_seamless')}
def weather_models(region, box, tech):
    pts = grid(box)
    def fetch():
        lat = ','.join(str(p[0]) for p in pts); lon = ','.join(str(p[1]) for p in pts)
        var = 'global_tilted_irradiance_previous_day1' if tech == 'solar' else 'wind_speed_100m_previous_day1'
        url = ('https://previous-runs-api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode({
            'latitude': lat, 'longitude': lon, 'hourly': var, 'models': ','.join(MODELS[tech]), 'tilt': 30, 'azimuth': 0,
            'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris', 'start_date': START, 'end_date': END}))
        res = get(url)
        res = res if isinstance(res, list) else [res]
        return [{m: r['hourly'].get(var + '_' + m) for m in MODELS[tech]} for r in res]
    return cached(f'wxm_{tech}_{END}_' + region.replace(' ', '_').replace("'", ''), fetch)


# ── the tool's generic model (same as js/tool-forecast.js) ─────────────────
CURVE_MED = [0, 0, 0, .015, .045, .10, .18, .29, .43, .59, .75, .88, .96, 1]
def curve(v):
    if v is None or v < 0:
        return None
    if v >= 25:
        return 0.0
    i = int(v)
    if i >= len(CURVE_MED) - 1:
        return 1.0
    return CURVE_MED[i] + (CURVE_MED[i + 1] - CURVE_MED[i]) * (v - i)


def solar_lf(gti, t):
    if gti is None:
        return None
    tc = (15 if t is None else t) + gti * 25 / 800
    return max(0.0, min(1.0, gti / 1000 * (1 - 0.004 * (tc - 25)) * 0.86))


def wind_lf(v):
    c = curve(v)
    return None if c is None else c * 0.88


def clear_sky_ghi(ts, lat):
    """rough clear-sky irradiance (Haurwitz) for the hour centre, Paris clock → solar time ≈ UTC + lon/15"""
    d = date(int(ts[:4]), int(ts[5:7]), int(ts[8:10]))
    n = d.timetuple().tm_yday
    decl = 23.45 * math.sin(math.radians(360 * (284 + n) / 365))
    hour = int(ts[11:13]) + 0.5 - (2 if 3 < d.month < 11 else 1)   # ≈ UTC; ≈ solar time in France
    ha = 15 * (hour - 12)
    cz = (math.sin(math.radians(lat)) * math.sin(math.radians(decl)) + math.cos(math.radians(lat)) * math.cos(math.radians(decl)) * math.cos(math.radians(ha)))
    return 1098 * cz * math.exp(-0.057 / cz) if cz > 0.02 else 0.0


# ── French day-ahead prices, hourly (the auction closes the day before) ───────
_PR = {}
def price(t):
    y = t[:4]
    if y not in _PR:
        try:
            _PR[y] = json.load(open(os.path.join(ROOT, 'data', 'history', 'fr_prices', y + '.json')))['days']
        except OSError:
            _PR[y] = {}
    a = _PR[y].get(t[:10])
    if not a:
        return None
    k = len(a) // 24; h = int(t[11:13])
    v = [x for x in a[h * k:(h + 1) * k] if x is not None]
    return sum(v) / len(v) if v else None


# ── assembly ───────────────────────────────────────────────────────────────
def frame(region, box, tech):
    tr = truth(region)
    pts, wx = weather(region, box)
    wm = weather_models(region, box, tech)
    T = wx[0]['time']
    ci = len(pts) // 2   # centre point of the 3 × 3 grid
    rows = []
    lat_c = (box[0] + box[1]) / 2
    for i, t in enumerate(T):
        a = tr.get(t[:13])
        y = None if a is None else a[0 if tech == 'solar' else 1]
        if y is None:
            continue
        if tech == 'solar':
            g = [w['global_tilted_irradiance'][i] for w in wx]; tt = [w['temperature_2m'][i] for w in wx]
            sw = [w['shortwave_radiation'][i] for w in wx]
            if any(v is None for v in g + tt + sw):
                continue
            lf = [solar_lf(g[k], tt[k]) for k in range(len(g))]
            cs = clear_sky_ghi(t, lat_c)
            mm = []
            for m in MODELS['solar']:
                v = [w[m][i] if w[m] else None for w in wm]
                if all(x is not None for x in v):
                    mm.append(float(np.mean([solar_lf(v[k], tt[k]) for k in range(len(v))])))
            rows.append({'mm': mm, **{'t': t, 'y': y, 'p': price(t), 'v0': lf[ci], 'v1': float(np.mean(lf)), 'gti': float(np.mean(g)), 'ghi': float(np.mean(sw)),
                         'temp': float(np.mean(tt)), 'cs': cs, 'h': int(t[11:13]), 'm': int(t[5:7]), 'ym': t[:7]}})
        else:
            w1 = [w['wind_speed_100m'][i] for w in wx]; w2 = [w['wind_speed_120m'][i] for w in wx]
            if any(v is None for v in w1 + w2):
                continue
            lf = [wind_lf(v) for v in w2]
            mm = []
            for m in MODELS['wind']:
                v = [w[m][i] if w[m] else None for w in wm]
                if all(x is not None for x in v):
                    mm.append(float(np.mean([wind_lf(x * 1.2 ** 0.14) for x in v])))
            rows.append({'mm': mm, **{'t': t, 'y': y, 'p': price(t), 'v0': lf[ci], 'v1': float(np.mean(lf)), 'ws': float(np.mean(w2)), 'ws100': float(np.mean(w1)),
                         'ws_c': w2[ci], 'h': int(t[11:13]), 'm': int(t[5:7]), 'ym': t[:7]}})
    return rows


def month_no(ym):
    return int(ym[:4]) * 12 + int(ym[5:7])


def fleet_fit(tr, tech, ref):
    """the regional fleet's correction learned on the rows tr, month weights halving every HALF_LIFE months
    before the month ref ('YYYY-MM'); hours at prices ≤ 0 are kept: the fleet's curtailment there is part of what
    it produces (leaving them out made the solar forecast 0.4–0.9 points worse and biased it upward)
      solar  factor by month × hour of day (actual ÷ grid model), else by month, else overall
      wind   empirical power curve: mean actual load factor by 0.5 m/s bin of the grid-mean forecast wind"""
    w = {r['ym']: 0.5 ** ((month_no(ref) - month_no(r['ym'])) / HALF_LIFE) for r in tr}
    if tech == 'solar':
        f, fm, tot = {}, {}, [0.0, 0.0]
        for r in tr:
            if r['cs'] <= 0:
                continue
            k = w[r['ym']]
            for d, key in ((f, (r['m'], r['h'])), (fm, r['m'])):
                a = d.setdefault(key, [0.0, 0.0]); a[0] += k * r['y']; a[1] += k * r['v1']
            tot[0] += k * r['y']; tot[1] += k * r['v1']
        s = tot[0] / max(1e-9, tot[1])
        return {'s': min(3.0, s), 'f': {f'{m}|{h}': min(3.0, a[0] / a[1]) for (m, h), a in f.items() if a[1] > 0.3},
                'fm': {str(m): min(3.0, a[0] / a[1]) for m, a in fm.items() if a[1] > 1}}
    acc = {}
    for r in tr:
        b = int(r['ws'] * 2); a = acc.setdefault(b, [0.0, 0.0, 0]); k = w[r['ym']]
        a[0] += k * r['y']; a[1] += k; a[2] += 1
    lf = {b: a[0] / a[1] for b, a in acc.items() if a[2] >= 15}
    top = max(lf) if lf else 0
    return {'step': 0.5, 'lf': [round(lf[b], 4) if b in lf else None for b in range(top + 1)]}


def fleet_apply(model, r, tech):
    if tech == 'solar':
        if r['cs'] <= 0:
            return 0.0
        k = model['f'].get(f"{r['m']}|{r['h']}", model['fm'].get(str(r['m']), model['s']))
        return min(1.0, max(0.0, r['v1'] * k))
    c = model['lf']
    if not c:
        return r['v1']
    b = min(len(c) - 1, int(r['ws'] * 2))
    lo = b
    while lo > 0 and c[lo] is None:
        lo -= 1
    hi = b
    while hi < len(c) - 1 and c[hi] is None:
        hi += 1
    v = c[lo] if c[lo] is not None else c[hi]
    return float(v if v is not None else r['v1'])


def walk(rows, tech):
    """add v2, v3, v4 predictions, each month learned on the months before it (≥ 6)"""
    months = sorted({r['ym'] for r in rows})
    by = {m: [r for r in rows if r['ym'] == m] for m in months}
    for k, m in enumerate(months):
        test = by[m]
        if k < 6:
            for r in test:
                r['v2'] = r['v3'] = r['v3h'] = r['v4'] = r['v5'] = r['v6'] = None
            continue
        tr = [r for mm in months[:k] for r in by[mm]]
        if tech == 'solar':
            tr = [r for r in tr if r['cs'] > 0]
        # v2: one scale factor (Σ actual ÷ Σ forecast)
        s = sum(r['y'] for r in tr) / max(1e-9, sum(r['v1'] for r in tr))
        for r in test:
            r['v2'] = min(1.0, r['v1'] * s)
        # v3: shape
        if tech == 'solar':
            f = {}
            for r in tr:
                key = (r['m'], r['h']); a = f.setdefault(key, [0.0, 0.0]); a[0] += r['y']; a[1] += r['v1']
            for r in test:
                a = f.get((r['m'], r['h']))
                fac = a[0] / a[1] if a and a[1] > 0.5 else s
                r['v3'] = min(1.0, max(0.0, r['v1'] * min(3.0, fac)))
        else:
            bins = np.arange(0, 26, 0.5)
            xs = np.array([r['ws'] for r in tr]); ys = np.array([r['y'] for r in tr])
            idx = np.digitize(xs, bins)
            means = {b: ys[idx == b].mean() for b in set(idx) if (idx == b).sum() >= 15}
            keys = sorted(means)
            for r in test:
                b = int(np.digitize([r['ws']], bins)[0])
                if b in means:
                    r['v3'] = float(means[b])
                else:
                    near = min(keys, key=lambda q: abs(q - b)); r['v3'] = float(means[near])
        # v3h: the tool's regional fleet mode, the same shape relearned with recent months weighing more
        fm_ = fleet_fit([r for mm in months[:k] for r in by[mm]], tech, m)
        for r in test:
            r['v3h'] = fleet_apply(fm_, r, tech)
        # v4: MOS regression on forecast features
        def feats(r):
            if tech == 'solar':
                kt = r['ghi'] / r['cs'] if r['cs'] > 20 else 0.0
                return [1, r['v1'], r['gti'] / 1000, min(kt, 1.5), r['temp'] / 30, r['cs'] / 1000, r['v3'] if r.get('v3') is not None else r['v1']]
            return [1, r['v3'] if r.get('v3') is not None else r['v1'], r['ws'] / 10, r['ws100'] / 10, (r['ws'] / 10) ** 2, (r['ws'] / 10) ** 3, math.sin(2 * math.pi * r['m'] / 12), math.cos(2 * math.pi * r['m'] / 12)]
        # the training rows need their own v3 (in-sample shape) for the regression
        for r in tr:
            if tech == 'solar':
                a = f.get((r['m'], r['h'])); r['_v3'] = r['v1'] * min(3.0, a[0] / a[1]) if a and a[1] > 0.5 else r['v1'] * s
            else:
                b = int(np.digitize([r['ws']], bins)[0]); r['_v3'] = float(means.get(b, means[min(keys, key=lambda q: abs(q - b))]))
        X = np.array([feats({**r, 'v3': r['_v3']}) for r in tr]); Y = np.array([r['y'] for r in tr])
        lam = 1e-3 * np.eye(X.shape[1]); lam[0, 0] = 0
        beta = np.linalg.solve(X.T @ X + len(X) * lam, X.T @ Y)
        for r in test:
            if tech == 'solar' and r['cs'] <= 0:
                r['v4'] = 0.0
            else:
                r['v4'] = float(min(1.0, max(0.0, np.array(feats(r)) @ beta)))
        # v5: + day-ahead price terms (curtailment at prices ≤ 0)
        def feats5(r, v3):
            base = feats({**r, 'v3': v3})
            p = r.get('p'); neg = 1.0 if p is not None and p <= 0 else 0.0; low = 1.0 if p is not None and 0 < p <= 10 else 0.0
            return base + [neg * base[1], low * base[1], neg]
        X5 = np.array([feats5(r, r['_v3']) for r in tr])
        lam5 = 1e-3 * np.eye(X5.shape[1]); lam5[0, 0] = 0
        beta5 = np.linalg.solve(X5.T @ X5 + len(X5) * lam5, X5.T @ Y)
        for r in test:
            if tech == 'solar' and r['cs'] <= 0:
                r['v5'] = 0.0
            else:
                r['v5'] = float(min(1.0, max(0.0, np.array(feats5(r, r['v3'])) @ beta5)))
        # v6: + multi-model mean and spread, recent months weigh more
        nm = len(MODELS[tech])
        def feats6(r, v3):
            b = feats5(r, v3); mm = r.get('mm') or []
            if len(mm) == nm:
                allm = mm + [r['v1']]; mu = float(np.mean(allm)); sd = float(np.std(allm))
            else:
                mu, sd = r['v1'], 0.0
            return b + [mu, sd, mu * sd]
        ages = np.array([(int(m[:4]) * 12 + int(m[5:7])) for m in [r['ym'] for r in tr]])
        now_m = int(m_cur[:4]) * 12 + int(m_cur[5:7]) if (m_cur := m) else 0
        wts = 0.5 ** ((now_m - ages) / 6.0)
        X6 = np.array([feats6(r, r['_v3']) for r in tr]); W = wts[:, None]
        lam6 = 1e-3 * np.eye(X6.shape[1]); lam6[0, 0] = 0
        beta6 = np.linalg.solve(X6.T @ (W * X6) + wts.sum() * lam6, X6.T @ (wts * Y))
        for r in test:
            if tech == 'solar' and r['cs'] <= 0:
                r['v6'] = 0.0
            else:
                r['v6'] = float(min(1.0, max(0.0, np.array(feats6(r, r['v3'])) @ beta6)))
    return rows


def score(rows, key, tech):
    rr = [r for r in rows if r.get(key) is not None and r.get('v4') is not None and (tech != 'solar' or r['cs'] > 0)]
    if not rr:
        return None
    e = np.array([r[key] - r['y'] for r in rr])
    days = {}
    for r in rr:
        d = days.setdefault(r['t'][:10], [0.0, 0.0]); d[0] += r[key]; d[1] += r['y']
    de = np.array([v[0] - v[1] for v in days.values()]) / 24
    return {'nmae': float(np.mean(np.abs(e))), 'bias': float(np.mean(e)), 'rmse': float(np.sqrt(np.mean(e ** 2))),
            'nmae_day': float(np.mean(np.abs(de))), 'n': len(rr), 'corr': float(np.corrcoef([r[key] for r in rr], [r['y'] for r in rr])[0, 1])}


def main():
    out = {'protocol': __doc__.split('Steps')[0].strip(), 'period': [START, END], 'results': {}, 'samples': {}}
    calib, fleet = {}, {}
    for region, (box, techs) in REGIONS.items():
        cap = capacity(region)
        for tech in techs:
            rows = walk(frame(region, box, tech), tech)
            # the regional fleet mode of the tool: the correction learned on every month up to yesterday, its
            # walk-forward error over the last 6 complete months (v1 = grid alone, v3h = what the tool shows)
            last = max(r['ym'] for r in rows)
            nxt = f'{int(last[:4]) + (last[5:7] == "12")}-{int(last[5:7]) % 12 + 1:02d}'
            recent = sorted({r['ym'] for r in rows if r['ym'] < last})[-6:]
            rr = [r for r in rows if r['ym'] in recent]
            fleet.setdefault(region, {'box': box})[tech] = {
                'learnedTo': max(r['t'] for r in rows)[:10], 'capacityMW': cap.get(tech), 'model': fleet_fit(rows, tech, nxt),
                'error': {'months': [recent[0], recent[-1]] if recent else None, **{v: score(rr, v, tech) for v in ('v1', 'v3h')}}}
            if tech == 'solar':
                for r in rows:
                    if r['cs'] > 0 and r.get('p') is not None and r['p'] > 10:
                        a = calib.setdefault(f"{r['m']}|{r['h']}", [0.0, 0.0]); a[0] += r['y']; a[1] += r['mm'][0] if False else r['v1']
            res = {v: score(rows, v, tech) for v in ('v0', 'v1', 'v2', 'v3', 'v3h', 'v4', 'v5', 'v6')}
            neg = [r for r in rows if r.get('v5') is not None and r.get('p') is not None and r['p'] <= 0 and (tech != 'solar' or r['cs'] > 0)]
            if neg:
                res['neg_hours'] = {v: float(np.mean([abs(r[v] - r['y']) for r in neg])) for v in ('v4', 'v5', 'v6')}
                res['neg_hours']['n'] = len(neg)
            out['results'][f'{tech}|{region}'] = res
            print(tech, region, {v: (round(x['nmae'] * 100, 2), round(x['bias'] * 100, 2)) for v, x in res.items() if x and 'nmae' in x}, 'neg', {k: round(v * 100, 1) if k != 'n' else v for k, v in res.get('neg_hours', {}).items()})
            # one summer week and one winter week of the test period, for the charts
            for wk, d0 in (('summer', '2025-07-07'), ('winter', '2026-01-12')):
                sel = [r for r in rows if d0 <= r['t'][:10] < str(np.datetime64(d0) + np.timedelta64(7, 'D'))]
                out['samples'][f'{tech}|{region}|{wk}'] = [[r['t'], round(r['y'], 4), round(r['v0'], 4) if r['v0'] is not None else None, round(r['v6'], 4) if r.get('v6') is not None else None] for r in sel]
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    # only a monthly level is transferable to a single site: the hour-by-hour shape of a regional fleet
    # reflects its mix of orientations and trackers, not the bias of the weather forecast
    mon = {}
    for k, a in calib.items():
        m = k.split('|')[0]; b = mon.setdefault(m, [0.0, 0.0]); b[0] += a[0]; b[1] += a[1]
    fac = {m: round(min(1.4, max(0.7, a[0] / a[1])), 3) for m, a in mon.items() if a[1] > 2}
    with open(os.path.join(ROOT, 'data', 'history', 'fcst_calib.json'), 'w') as f:
        json.dump({'source': 'scripts/fcst_backtest.py: actual ÷ modelled solar load factor, RTE regional data (Occitanie, Nouvelle-Aquitaine, PACA) vs Open-Meteo day-ahead, hours above 10 €/MWh',
                   'period': [START, END], 'solar_month': fac,
                   'regional': {'note': 'Tools › Production forecast, regional fleet mode: Open-Meteo best model on a 3 × 3 grid of the region, '
                                        'generic model (tilt 30°, south; medium-wind curve at 120 m), then this correction (solar: actual ÷ model by '
                                        'month × hour; wind: actual load factor by 0.5 m/s bin of the grid-mean wind), months weighing half as much '
                                        'every 6 months back; × the installed capacity (RTE real-time, output ÷ load factor)',
                                'halfLifeMonths': HALF_LIFE, 'regions': fleet}}, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
