#!/usr/bin/env python3
"""France weather and renewables outlook for the next 5 weeks vs normal.

Forecast: Open-Meteo ensemble API, GFS ensemble (0.5°, 31 members, 35 days)
plus the last 7 days. Normals: Open-Meteo historical archive (ERA5),
2016–2025, same calendar day, smoothed over ±3 days.

Series (France):
  temp    population-weighted mean temperature (°C)
  solar   solar production (GWh/day): weighted daily irradiation × k, k fitted
          on RTE's solar output of the last 30 days (season and capacity)
  wind    wind production (GWh/day): hourly 100 m wind → fleet power curve
          (logistic) → weighted capacity factor × C, C fitted on RTE's wind
          output of the last 365 days
  precip  precipitation over the main hydro basins (mm/day), a proxy of
          hydro inflows

Normals for solar and wind apply today's fitted k / C to the 2016–2025
weather: "what an average year's weather gives with today's fleet".

Writes data/weather_outlook.json; caches the archive in
data/history/weather_archive.json (refreshed weekly).
"""
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'weather_outlook.json')
ARCHIVE = os.path.join(ROOT, 'data', 'history', 'weather_archive.json')
FR_DAILY = os.path.join(ROOT, 'data', 'history', 'rte', 'fr_daily.json')
ENS = 'https://ensemble-api.open-meteo.com/v1/ensemble'
ARC = 'https://archive-api.open-meteo.com/v1/archive'
NORMAL_YEARS = (2016, 2025)

# (name, lat, lon, weight)
TEMP = [('Paris', 48.86, 2.35, .30), ('Lyon', 45.76, 4.84, .09), ('Marseille', 43.30, 5.37, .09), ('Lille', 50.63, 3.06, .09),
        ('Toulouse', 43.60, 1.44, .08), ('Bordeaux', 44.84, -0.58, .08), ('Nantes', 47.22, -1.55, .08), ('Strasbourg', 48.57, 7.75, .07),
        ('Rennes', 48.11, -1.68, .06), ('Clermont', 45.78, 3.08, .06)]
WIND = [('Somme', 49.90, 2.30, .22), ('Marne', 48.95, 4.36, .22), ('Aude', 43.18, 3.00, .10), ('Indre', 46.80, 1.70, .10),
        ('Côtes-d\'Armor', 48.50, -2.80, .08), ('Deux-Sèvres', 46.30, -0.46, .10), ('Saint-Nazaire offshore', 47.10, -2.60, .10), ('Aisne', 49.60, 3.60, .08)]
SOLAR = [('Bordeaux', 44.84, -0.58, .18), ('Toulouse', 43.60, 1.44, .18), ('Montpellier', 43.61, 3.88, .14), ('Marseille', 43.30, 5.37, .14),
         ('Lyon', 45.76, 4.84, .12), ('Nantes', 47.22, -1.55, .09), ('Strasbourg', 48.57, 7.75, .07), ('Paris', 48.86, 2.35, .08)]
HYDRO = [('Alpes du Nord', 45.30, 6.40, .30), ('Alpes du Sud', 44.40, 6.50, .15), ('Pyrénées', 42.90, 0.20, .20),
         ('Massif central', 45.20, 2.80, .20), ('Jura / Rhône', 46.30, 5.90, .15)]


def get(url, params, tries=5):
    q = url + '?' + urllib.parse.urlencode(params)
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(q, headers={'User-Agent': 'PowerKlock/1.0'}), timeout=180) as r:
                return json.load(r)
        except Exception as e:
            print('   retry', k + 1, str(e)[:120])
            time.sleep(10 * (k + 1))
    raise RuntimeError('Open-Meteo unreachable: ' + url)


def cf(v):
    """Fleet power curve, wind speed in m/s at 100 m → capacity factor.
    Logistic centred on 8.5 m/s: R² 0.95 against RTE's daily wind output
    over a year (a cubic 3–12 m/s curve gave 0.74)."""
    if v is None or v > 25:
        return 0.0
    return 1 / (1 + 2.718281828 ** (-(v - 8.5) / 1.4))


def wmean(values, weights):
    pairs = [(v, w) for v, w in zip(values, weights) if v is not None]
    sw = sum(w for _, w in pairs)
    return sum(v * w for v, w in pairs) / sw if sw else None


def pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    i = (len(xs) - 1) * p
    lo, hi = int(i), min(int(i) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


# ── archive (normals and fit) ──
def archive():
    if os.path.exists(ARCHIVE):
        with open(ARCHIVE) as f:
            a = json.load(f)
        if (datetime.now(timezone.utc) - datetime.fromisoformat(a['updated'].replace('Z', '+00:00'))).days < 7:
            return a
    start, end = f'{NORMAL_YEARS[0]}-01-01', (date.today() - timedelta(days=6)).isoformat()
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'start': start, 'end': end, 'series': {}}

    def daily_group(key, pts, var):
        series = []
        for name, lat, lon, w in pts:
            j = get(ARC, {'latitude': lat, 'longitude': lon, 'start_date': start, 'end_date': end, 'daily': var, 'timezone': 'Europe/Paris'})
            series.append(j['daily'][var])
            days = j['daily']['time']
            time.sleep(1)
        ws = [p[3] for p in pts]
        out['series'][key] = {'days': days, 'values': [wmean([s[i] for s in series], ws) for i in range(len(days))]}
        print(f'  archive {key}: {len(days)} days')

    daily_group('temp', TEMP, 'temperature_2m_mean')
    daily_group('rad', SOLAR, 'shortwave_radiation_sum')
    daily_group('precip', HYDRO, 'precipitation_sum')
    # wind: hourly 100 m → daily mean capacity factor per site → weighted
    per_site = []
    for name, lat, lon, w in WIND:
        j = get(ARC, {'latitude': lat, 'longitude': lon, 'start_date': start, 'end_date': end, 'hourly': 'wind_speed_100m',
                      'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris'})
        t, v = j['hourly']['time'], j['hourly']['wind_speed_100m']
        acc = {}
        for ti, vi in zip(t, v):
            if vi is None:
                continue
            d = ti[:10]
            s = acc.setdefault(d, [0.0, 0])
            s[0] += cf(vi)
            s[1] += 1
        per_site.append({d: s[0] / s[1] for d, s in acc.items() if s[1] >= 20})
        time.sleep(1)
    days = sorted(set().union(*[set(p) for p in per_site]))
    out['series']['cf'] = {'days': days, 'values': [wmean([p.get(d) for p in per_site], [x[3] for x in WIND]) for d in days]}
    print(f'  archive cf: {len(days)} days')
    os.makedirs(os.path.dirname(ARCHIVE), exist_ok=True)
    with open(ARCHIVE, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    return out


def normals(series):
    """Day-of-year (MM-DD) mean over NORMAL_YEARS, smoothed ±3 days."""
    by = {}
    for d, v in zip(series['days'], series['values']):
        if v is None or not (NORMAL_YEARS[0] <= int(d[:4]) <= NORMAL_YEARS[1]):
            continue
        by.setdefault(d[5:], []).append(v)
    base = date(2001, 1, 1)
    keys = [(base + timedelta(days=i)).strftime('%m-%d') for i in range(365)]
    raw = {k: sum(by[k]) / len(by[k]) for k in keys if k in by}
    sm = {}
    for i, k in enumerate(keys):
        win = [raw.get(keys[(i + j) % 365]) for j in range(-3, 4)]
        win = [x for x in win if x is not None]
        sm[k] = sum(win) / len(win) if win else None
    sm['02-29'] = sm['02-28']
    return sm


def fit(series, target, days=120):
    """y = k·x through the origin over the last `days` common days."""
    xs = dict(zip(series['days'], series['values']))
    common = sorted(d for d in target if d in xs and xs[d] is not None)[-days:]
    pairs = [(xs[d], target[d]) for d in common]
    sxx = sum(x * x for x, _ in pairs)
    if not sxx:
        return None, 0, None
    k = sum(x * y for x, y in pairs) / sxx
    ym = sum(y for _, y in pairs) / len(pairs)
    sst = sum((y - ym) ** 2 for _, y in pairs)
    sse = sum((y - k * x) ** 2 for x, y in pairs)
    return k, len(pairs), (1 - sse / sst) if sst else None


# ── forecast ──
def ensemble_daily(pts, var):
    j = get(ENS, {'latitude': ','.join(str(p[1]) for p in pts), 'longitude': ','.join(str(p[2]) for p in pts),
                  'daily': var, 'models': 'gfs05', 'forecast_days': 35, 'past_days': 7, 'timezone': 'Europe/Paris'})
    j = j if isinstance(j, list) else [j]
    days = j[0]['daily']['time']
    keys = [k for k in j[0]['daily'] if k.startswith(var)]
    # members[m][i] = weighted value of member m on day i
    members = []
    for k in keys:
        members.append([wmean([loc['daily'][k][i] for loc in j], [p[3] for p in pts]) for i in range(len(days))])
    return days, members


def ensemble_wind():
    j = get(ENS, {'latitude': ','.join(str(p[1]) for p in WIND), 'longitude': ','.join(str(p[2]) for p in WIND),
                  'hourly': 'wind_speed_100m', 'wind_speed_unit': 'ms', 'models': 'gfs05', 'forecast_days': 35, 'past_days': 7,
                  'timezone': 'Europe/Paris'})
    j = j if isinstance(j, list) else [j]
    times = j[0]['hourly']['time']
    keys = [k for k in j[0]['hourly'] if k.startswith('wind_speed_100m')]
    days = sorted(set(t[:10] for t in times))
    members = []
    for k in keys:
        acc = {}
        for loc, (_, _, _, w) in zip(j, WIND):
            for t, v in zip(times, loc['hourly'][k]):
                if v is None:
                    continue
                s = acc.setdefault(t[:10], {}).setdefault(id(loc), [0.0, 0, w])
                s[0] += cf(v)
                s[1] += 1
        members.append([wmean([s[0] / s[1] for s in acc.get(d, {}).values()], [s[2] for s in acc.get(d, {}).values()]) if d in acc else None for d in days])
    return days, members


def summarise(days, members, scale=1.0):
    out = {'mean': [], 'p10': [], 'p90': []}
    for i in range(len(days)):
        vals = [m[i] * scale for m in members if m[i] is not None]
        out['mean'].append(round(sum(vals) / len(vals), 2) if vals else None)
        out['p10'].append(round(pct(vals, .1), 2) if vals else None)
        out['p90'].append(round(pct(vals, .9), 2) if vals else None)
    return out


def main():
    arc = archive()
    rte = {}
    if os.path.exists(FR_DAILY):
        with open(FR_DAILY) as f:
            for r in json.load(f).get('rows', []):
                rte[r['d']] = r
    solar_gwh = {d: r['solarAvg'] * 24 / 1000 for d, r in rte.items() if r.get('solarAvg') is not None}
    wind_gwh = {d: r['windAvg'] * 24 / 1000 for d, r in rte.items() if r.get('windAvg') is not None}
    k_sol, n_sol, r2_sol = fit(arc['series']['rad'], solar_gwh, days=30)   # season-dependent: recent month
    k_wind, n_wind, r2_wind = fit(arc['series']['cf'], wind_gwh, days=365)
    print(f'  fit solar k={k_sol:.3f} GWh per MJ/m² (n={n_sol}, R²={r2_sol:.2f}); wind C={k_wind:.1f} GWh at CF=1 (n={n_wind}, R²={r2_wind:.2f})')

    nm = {key: normals(arc['series'][key]) for key in ('temp', 'rad', 'precip', 'cf')}
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'source': 'Open-Meteo: GFS ensemble (31 members, 35 days) and ERA5 archive; RTE éCO2mix for the solar / wind calibration',
           'license': 'Open-Meteo data CC BY 4.0 (non-commercial API tier)',
           'normal_years': list(NORMAL_YEARS), 'today': date.today().isoformat(),
           'fit': {'solar_gwh_per_mj': round(k_sol, 4), 'solar_r2': round(r2_sol, 3), 'wind_gwh_at_cf1': round(k_wind, 1), 'wind_r2': round(r2_wind, 3), 'days': n_sol},
           'series': {}}

    def add(key, days, members, scale, normal_key, unit, label):
        s = summarise(days, members, scale)
        s['normal'] = [round(nm[normal_key][d[5:]] * scale, 2) if nm[normal_key].get(d[5:]) is not None else None for d in days]
        if key == 'solar':
            s['actual'] = [round(solar_gwh[d], 1) if d in solar_gwh else None for d in days]
        if key == 'wind':
            s['actual'] = [round(wind_gwh[d], 1) if d in wind_gwh else None for d in days]
        s.update({'days': days, 'unit': unit, 'label': label})
        out['series'][key] = s

    d, m = ensemble_daily(TEMP, 'temperature_2m_mean'); add('temp', d, m, 1, 'temp', '°C', 'Temperature, population-weighted')
    d, m = ensemble_daily(SOLAR, 'shortwave_radiation_sum'); add('solar', d, m, k_sol, 'rad', 'GWh/day', 'Solar production')
    d, m = ensemble_wind(); add('wind', d, m, k_wind, 'cf', 'GWh/day', 'Wind production')
    d, m = ensemble_daily(HYDRO, 'precipitation_sum'); add('precip', d, m, 1, 'precip', 'mm/day', 'Precipitation over hydro basins')
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('weather_outlook.json:', ', '.join(f'{k} {len(v["days"])} days' for k, v in out['series'].items()))


if __name__ == '__main__':
    main()
