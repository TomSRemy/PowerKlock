#!/usr/bin/env python3
"""Weather and renewables outlook for the next 5 weeks vs normal, by country.

Forecast: Open-Meteo ensemble API, GFS ensemble (0.5°, 31 members, 35 days)
plus the last days. Normals: Open-Meteo historical archive (ERA5),
2016–2025, same calendar day, smoothed over ±3 days.

Series per country (when it makes sense and data exist):
  temp    population-weighted mean temperature (°C)
  solar   solar production (GWh/day) = weighted daily irradiation × k
  wind    wind production (GWh/day) = weighted capacity factor (hourly 100 m
          wind through a logistic fleet power curve) × C
  precip  precipitation over the main hydro basins (mm/day), hydro proxy
k and C are fitted on actual output: RTE éCO2mix for France (solar on the
last 30 days, wind on the last year), ENTSO-E daily averages from
history/summary.json elsewhere (the days available in the last year).
Normals for solar and wind apply today's k / C to the 2016–2025 weather.

Writes data/weather_outlook.json. Cache: data/history/weather_archive.json
holds the day-of-year normals (computed once) and the last 400 days of
weather used for the fit (refreshed every two weeks).
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'weather_outlook.json')
CACHE = os.path.join(ROOT, 'data', 'history', 'weather_archive.json')
FR_DAILY = os.path.join(ROOT, 'data', 'history', 'rte', 'fr_daily.json')
SUMMARY = os.path.join(ROOT, 'data', 'history', 'summary.json')
ENS = 'https://ensemble-api.open-meteo.com/v1/ensemble'
ARC = 'https://archive-api.open-meteo.com/v1/archive'
FC = 'https://api.open-meteo.com/v1/forecast'
PAST_DAYS = 14   # observed / actual days shown before the forecast
NORMAL_YEARS = (2016, 2025)
RECENT_DAYS = 400

# country → name, price zone of the calibration data, point groups (name, lat, lon, weight)
COUNTRIES = {
    'FR': {'name': 'France', 'zone': 'FR',
           'temp': [('Paris', 48.86, 2.35, .30), ('Lyon', 45.76, 4.84, .09), ('Marseille', 43.30, 5.37, .09), ('Lille', 50.63, 3.06, .09),
                    ('Toulouse', 43.60, 1.44, .08), ('Bordeaux', 44.84, -0.58, .08), ('Nantes', 47.22, -1.55, .08), ('Strasbourg', 48.57, 7.75, .07),
                    ('Rennes', 48.11, -1.68, .06), ('Clermont', 45.78, 3.08, .06)],
           'wind': [('Somme', 49.90, 2.30, .22), ('Marne', 48.95, 4.36, .22), ('Aude', 43.18, 3.00, .10), ('Indre', 46.80, 1.70, .10),
                    ("Côtes-d'Armor", 48.50, -2.80, .08), ('Deux-Sèvres', 46.30, -0.46, .10), ('Saint-Nazaire offshore', 47.10, -2.60, .10), ('Aisne', 49.60, 3.60, .08)],
           'solar': [('Bordeaux', 44.84, -0.58, .18), ('Toulouse', 43.60, 1.44, .18), ('Montpellier', 43.61, 3.88, .14), ('Marseille', 43.30, 5.37, .14),
                     ('Lyon', 45.76, 4.84, .12), ('Nantes', 47.22, -1.55, .09), ('Strasbourg', 48.57, 7.75, .07), ('Paris', 48.86, 2.35, .08)],
           'precip': [('Alpes du Nord', 45.30, 6.40, .30), ('Alpes du Sud', 44.40, 6.50, .15), ('Pyrénées', 42.90, 0.20, .20),
                      ('Massif central', 45.20, 2.80, .20), ('Jura / Rhône', 46.30, 5.90, .15)]},
    'DE': {'name': 'Germany', 'zone': 'DE_LU',
           'temp': [('Berlin', 52.52, 13.40, .18), ('Hamburg', 53.55, 9.99, .10), ('Munich', 48.14, 11.58, .15), ('Cologne', 50.94, 6.96, .20),
                    ('Frankfurt', 50.11, 8.68, .14), ('Stuttgart', 48.78, 9.18, .12), ('Leipzig', 51.34, 12.37, .11)],
           'wind': [('Schleswig-Holstein', 54.50, 9.50, .25), ('Lower Saxony', 52.80, 8.00, .30), ('Brandenburg', 52.40, 13.50, .20), ('North Sea offshore', 54.30, 6.50, .25)],
           'solar': [('Munich', 48.14, 11.58, .25), ('Stuttgart', 48.78, 9.18, .20), ('Nuremberg', 49.45, 11.08, .15), ('Leipzig', 51.34, 12.37, .20), ('Cologne', 50.94, 6.96, .20)]},
    'ES': {'name': 'Spain', 'zone': 'ES',
           'temp': [('Madrid', 40.42, -3.70, .35), ('Barcelona', 41.39, 2.17, .25), ('Valencia', 39.47, -0.38, .15), ('Seville', 37.39, -5.98, .15), ('Bilbao', 43.26, -2.93, .10)],
           'wind': [('Zaragoza', 41.65, -0.90, .30), ('Castilla y León', 41.60, -4.70, .30), ('Galicia', 42.90, -8.00, .20), ('Albacete', 39.00, -1.90, .20)],
           'solar': [('Badajoz', 38.88, -6.97, .30), ('Seville', 37.39, -5.98, .25), ('Ciudad Real', 38.98, -3.93, .25), ('Murcia', 37.98, -1.13, .20)],
           'precip': [('Pyrenees', 42.50, 0.50, .40), ('Miño-Sil', 42.30, -7.90, .30), ('Duero', 41.50, -5.50, .30)]},
    'BE': {'name': 'Belgium', 'zone': 'BE',
           'temp': [('Brussels', 50.85, 4.35, .50), ('Antwerp', 51.22, 4.40, .30), ('Liège', 50.63, 5.57, .20)],
           'wind': [('Belgian offshore', 51.60, 2.90, .60), ('Flanders', 51.00, 3.70, .40)],
           'solar': [('Brussels', 50.85, 4.35, .40), ('Antwerp', 51.22, 4.40, .30), ('Liège', 50.63, 5.57, .30)]},
    'NL': {'name': 'Netherlands', 'zone': 'NL',
           'no_fit': {'solar': 'ENTSO-E publishes only a small part of Dutch solar (daily peaks near 0.1 GW for some 25 GW installed): no reliable calibration.'},
           'temp': [('Amsterdam', 52.37, 4.90, .40), ('Rotterdam', 51.92, 4.48, .35), ('Eindhoven', 51.44, 5.48, .25)],
           'wind': [('Dutch offshore', 52.60, 4.00, .50), ('Flevoland', 52.50, 5.50, .30), ('Groningen', 53.22, 6.57, .20)],
           'solar': [('Eindhoven', 51.44, 5.48, .35), ('Utrecht', 52.09, 5.12, .35), ('Groningen', 53.22, 6.57, .30)]},
    'IT': {'name': 'Italy', 'zone': None,
           'temp': [('Milan', 45.46, 9.19, .35), ('Rome', 41.90, 12.50, .30), ('Naples', 40.85, 14.27, .20), ('Turin', 45.07, 7.69, .15)],
           'precip': [('Central Alps', 46.30, 10.00, .60), ('Northern Apennines', 44.20, 10.80, .40)]},
    'CH': {'name': 'Switzerland', 'zone': None,
           'temp': [('Zurich', 47.37, 8.54, .50), ('Geneva', 46.20, 6.15, .30), ('Bern', 46.95, 7.45, .20)],
           'precip': [('Bernese Alps', 46.60, 8.00, .60), ('Valais', 46.30, 7.50, .40)]},
    'AT': {'name': 'Austria', 'zone': None,
           'temp': [('Vienna', 48.21, 16.37, .50), ('Graz', 47.07, 15.44, .25), ('Linz', 48.31, 14.29, .25)],
           'precip': [('Tyrol', 47.20, 11.40, .50), ('Salzburg Alps', 47.30, 13.50, .50)]},
}
LABEL = {'temp': ('Temperature, population-weighted', '°C'), 'solar': ('Solar production', 'GWh/day'),
         'wind': ('Wind production', 'GWh/day'), 'precip': ('Precipitation over hydro basins', 'mm/day')}
VAR = {'temp': 'temperature_2m_mean', 'solar': 'shortwave_radiation_sum', 'precip': 'precipitation_sum'}


def get(url, params, tries=6):
    q = url + '?' + urllib.parse.urlencode(params)
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(q, headers={'User-Agent': 'PowerKlock/1.0'}), timeout=240) as r:
                data = json.load(r)
            time.sleep(2)
            return data
        except urllib.error.HTTPError as e:
            body = ''
            try:
                body = e.read().decode('utf-8', 'replace')[:300]
            except Exception:
                pass
            if e.code == 429 and 'Daily' in body:   # the daily quota: waiting will not help, keep the last file
                raise RuntimeError('Open-Meteo daily limit reached: ' + body)
            wait = 65 if e.code == 429 else 10 * (k + 1)
            print(f'   HTTP {e.code}, waiting {wait}s')
            time.sleep(wait)
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


# ── archive: weighted daily series of a point group ──
def archive_series(pts, kind, start, end):
    if kind == 'wind':
        per_site = []
        for name, lat, lon, w in pts:
            j = get(ARC, {'latitude': lat, 'longitude': lon, 'start_date': start, 'end_date': end, 'hourly': 'wind_speed_100m',
                          'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris'})
            acc = {}
            for t, v in zip(j['hourly']['time'], j['hourly']['wind_speed_100m']):
                if v is None:
                    continue
                s = acc.setdefault(t[:10], [0.0, 0])
                s[0] += cf(v)
                s[1] += 1
            per_site.append({d: s[0] / s[1] for d, s in acc.items() if s[1] >= 20})
        days = sorted(set().union(*[set(p) for p in per_site]))
        return days, [wmean([p.get(d) for p in per_site], [x[3] for x in pts]) for d in days]
    var = VAR[kind]
    series, days = [], []
    for name, lat, lon, w in pts:
        j = get(ARC, {'latitude': lat, 'longitude': lon, 'start_date': start, 'end_date': end, 'daily': var, 'timezone': 'Europe/Paris'})
        series.append(j['daily'][var])
        days = j['daily']['time']
    return days, [wmean([s[i] for s in series], [p[3] for p in pts]) for i in range(len(days))]


def doy_normals(days, values):
    by = {}
    for d, v in zip(days, values):
        if v is not None and NORMAL_YEARS[0] <= int(d[:4]) <= NORMAL_YEARS[1]:
            by.setdefault(d[5:], []).append(v)
    base = date(2001, 1, 1)
    keys = [(base + timedelta(days=i)).strftime('%m-%d') for i in range(365)]
    raw = {k: sum(by[k]) / len(by[k]) for k in keys if k in by}
    sm = {}
    for i, k in enumerate(keys):
        win = [raw.get(keys[(i + j) % 365]) for j in range(-3, 4)]
        win = [x for x in win if x is not None]
        sm[k] = round(sum(win) / len(win), 4) if win else None
    sm['02-29'] = sm['02-28']
    return sm


def load_cache():
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            c = json.load(f)
        if 'countries' in c:
            return c
        # previous single-country format (France, full daily series since 2016)
        conv = {'countries': {'FR': {'normals': {}, 'recent': {}}}}
        for kind, key in (('temp', 'temp'), ('solar', 'rad'), ('precip', 'precip'), ('wind', 'cf')):
            s = c.get('series', {}).get(key)
            if s:
                conv['countries']['FR']['normals'][kind] = doy_normals(s['days'], s['values'])
                if kind in ('solar', 'wind'):
                    lim = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
                    keep = [(d, v) for d, v in zip(s['days'], s['values']) if d >= lim]
                    conv['countries']['FR']['recent'][kind] = {'end': c.get('end', ''), 'days': [d for d, _ in keep], 'values': [v for _, v in keep]}
        return conv
    return {'countries': {}}


def save_cache(cache):
    cache['updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, 'w') as f:
        json.dump(cache, f, separators=(',', ':'))


def refresh_cache(cache):
    today = date.today()
    end = (today - timedelta(days=6)).isoformat()
    for cc, conf in COUNTRIES.items():
        c = cache['countries'].setdefault(cc, {'normals': {}, 'recent': {}})
        for kind in ('temp', 'solar', 'wind', 'precip'):
            if kind not in conf:
                continue
            if kind not in c['normals']:
                print(f'  {cc} {kind}: normals {NORMAL_YEARS[0]}–{NORMAL_YEARS[1]}')
                d, v = archive_series(conf[kind], kind, f'{NORMAL_YEARS[0]}-01-01', f'{NORMAL_YEARS[1]}-12-31')
                c['normals'][kind] = doy_normals(d, v)
                save_cache(cache)
            rec = c['recent'].get(kind)
            if kind in ('solar', 'wind') and (not rec or rec.get('end', '') < (today - timedelta(days=20)).isoformat()):
                print(f'  {cc} {kind}: last {RECENT_DAYS} days')
                d, v = archive_series(conf[kind], kind, (today - timedelta(days=RECENT_DAYS)).isoformat(), end)
                c['recent'][kind] = {'end': end, 'days': d, 'values': [None if x is None else round(x, 4) for x in v]}
                save_cache(cache)
    save_cache(cache)
    return cache


def targets():
    """Actual daily output (GWh) per country for the fit: RTE for France, ENTSO-E summary elsewhere."""
    out = {}
    if os.path.exists(FR_DAILY):
        with open(FR_DAILY) as f:
            rows = json.load(f).get('rows', [])
        out['FR'] = {'solar': {r['d']: r['solarAvg'] * 24 / 1000 for r in rows if r.get('solarAvg') is not None},
                     'wind': {r['d']: r['windAvg'] * 24 / 1000 for r in rows if r.get('windAvg') is not None}}
    if os.path.exists(SUMMARY):
        with open(SUMMARY) as f:
            zones = json.load(f).get('zones', {})
        for cc, conf in COUNTRIES.items():
            if cc == 'FR' or not conf['zone']:
                continue
            rows = zones.get(conf['zone'], [])
            out[cc] = {'solar': {r['d']: r['solarAvg'] * 24 / 1000 for r in rows if r.get('solarAvg')},
                       'wind': {r['d']: r['windAvg'] * 24 / 1000 for r in rows if r.get('windAvg')}}
    return out


def fit(rec, target, days):
    """y = k·x through the origin over the last `days` common days (at least 20)."""
    xs = dict(zip(rec['days'], rec['values']))
    common = sorted(d for d in target if d in xs and xs[d] is not None)[-days:]
    if len(common) < 20:
        return None, len(common), None
    pairs = [(xs[d], target[d]) for d in common]
    sxx = sum(x * x for x, _ in pairs)
    k = sum(x * y for x, y in pairs) / sxx
    ym = sum(y for _, y in pairs) / len(pairs)
    sst = sum((y - ym) ** 2 for _, y in pairs)
    sse = sum((y - k * x) ** 2 for x, y in pairs)
    return k, len(pairs), round(1 - sse / sst, 3) if sst else None


# ── forecast ──
def ensemble(pts, kind):
    loc = {'latitude': ','.join(str(p[1]) for p in pts), 'longitude': ','.join(str(p[2]) for p in pts),
           'models': 'gfs05', 'forecast_days': 35, 'past_days': 7, 'timezone': 'Europe/Paris'}
    ws = [p[3] for p in pts]
    if kind == 'wind':
        j = get(ENS, dict(loc, hourly='wind_speed_100m', wind_speed_unit='ms'))
        j = j if isinstance(j, list) else [j]
        times = j[0]['hourly']['time']
        days = sorted(set(t[:10] for t in times))
        members = []
        for key in [k for k in j[0]['hourly'] if k.startswith('wind_speed_100m')]:
            per_loc = []
            for l in j:
                acc = {}
                for t, v in zip(times, l['hourly'][key]):
                    if v is None:
                        continue
                    s = acc.setdefault(t[:10], [0.0, 0])
                    s[0] += cf(v)
                    s[1] += 1
                per_loc.append({d: s[0] / s[1] for d, s in acc.items() if s[1] >= 12})
            members.append([wmean([pl.get(d) for pl in per_loc], ws) for d in days])
        return days, members
    var = VAR[kind]
    j = get(ENS, dict(loc, daily=var))
    j = j if isinstance(j, list) else [j]
    days = j[0]['daily']['time']
    keys = [k for k in j[0]['daily'] if k.startswith(var)]
    members = [[wmean([l['daily'][key][i] for l in j], ws) for i in range(len(days))] for key in keys]
    return days, members


def observed(pts, kind):
    """Last PAST_DAYS days of temperature / precipitation (Open-Meteo best-match analysis)."""
    j = get(FC, {'latitude': ','.join(str(p[1]) for p in pts), 'longitude': ','.join(str(p[2]) for p in pts),
                 'daily': VAR[kind], 'past_days': PAST_DAYS, 'forecast_days': 1, 'timezone': 'Europe/Paris'})
    j = j if isinstance(j, list) else [j]
    days = j[0]['daily']['time']
    return {d: wmean([l['daily'][VAR[kind]][i] for l in j], [p[3] for p in pts]) for i, d in enumerate(days)}


def summarise(days, members, scale):
    out = {'mean': [], 'p10': [], 'p90': []}
    for i in range(len(days)):
        vals = [m[i] * scale for m in members if m[i] is not None]
        out['mean'].append(round(sum(vals) / len(vals), 2) if vals else None)
        out['p10'].append(round(pct(vals, .1), 2) if vals else None)
        out['p90'].append(round(pct(vals, .9), 2) if vals else None)
    return out


def main():
    cache = refresh_cache(load_cache())
    tg = targets()
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'source': 'Open-Meteo: GFS ensemble (31 members, 35 days) and ERA5 archive; output calibrated on RTE éCO2mix (France) and ENTSO-E (other countries)',
           'license': 'Open-Meteo data CC BY 4.0 (non-commercial API tier)', 'normal_years': list(NORMAL_YEARS),
           'today': date.today().isoformat(), 'countries': {}}
    for cc, conf in COUNTRIES.items():
        c = cache['countries'][cc]
        entry = {'name': conf['name'], 'fit': {}, 'series': {}, 'notes': dict(conf.get('no_fit', {}))}
        for kind in ('temp', 'wind', 'solar', 'precip'):
            if kind not in conf:
                continue
            scale = 1.0
            if kind in conf.get('no_fit', {}):
                continue
            if kind in ('solar', 'wind'):
                t = (tg.get(cc) or {}).get(kind) or {}
                k, n, r2 = fit(c['recent'][kind], t, 30 if (kind == 'solar' and cc == 'FR') else 365)
                if k is None:
                    print(f'  {cc} {kind}: {n} days of actual output, not enough to calibrate — skipped')
                    entry['notes'][kind] = f'Only {n} days of actual {kind} output in the last year: not enough to calibrate.'
                    continue
                scale = k
                entry['fit'][kind] = {'factor': round(k, 3), 'r2': r2, 'days': n, 'source': 'RTE' if cc == 'FR' else 'ENTSO-E'}
            days, members = ensemble(conf[kind], kind)
            # show the last PAST_DAYS days before the forecast, with actual values
            first = date.fromisoformat(next(d for d, *v in zip(days, *members) if any(x is not None for x in v)))
            lead = [(first - timedelta(days=i)).isoformat() for i in range(PAST_DAYS, 0, -1)]
            members = [[None] * len(lead) + [x for d, x in zip(days, m) if d >= first.isoformat()] for m in members]
            days = lead + [d for d in days if d >= first.isoformat()]
            s = summarise(days, members, scale)
            nm = c['normals'][kind]
            s['normal'] = [round(nm[d[5:]] * scale, 2) if nm.get(d[5:]) is not None else None for d in days]
            if kind in ('solar', 'wind'):
                t = (tg.get(cc) or {}).get(kind) or {}
                s['actual'] = [round(t[d], 1) if d in t else None for d in days]
            else:
                try:
                    obs = observed(conf[kind], kind)
                    today = date.today().isoformat()
                    s['actual'] = [round(obs[d], 2) if d in obs and obs[d] is not None and d < today else None for d in days]
                except Exception as e:
                    print(f'  {cc} {kind}: observed values unavailable ({e})')
            s.update({'days': days, 'unit': LABEL[kind][1], 'label': LABEL[kind][0]})
            entry['series'][kind] = s
        out['countries'][cc] = entry
        print(f'{cc}: ' + ', '.join(entry['series']) + ('  fit ' + json.dumps(entry['fit']) if entry['fit'] else ''))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
