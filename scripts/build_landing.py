#!/usr/bin/env python3
"""Figures of the public landing page (landing.html), read from the site's own data files.

Writes data/landing.json (every number the page shows, so nothing on the page is typed by hand) and
data/geo/europe_simple.json (the Europe outline, lighter, for the price map). Run after the price fetch
(.github/workflows/fetch.yml); it only reads files already in data/.

Dates are delivery days in Paris time: data/history/daily/<D>.json holds the prices of delivery day D, and the
day's figure is the published daily average (avg), never the mean of the series.
"""
import datetime as dt
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

NAMES_FR = {
    'FR': 'France', 'DE_LU': 'Allemagne', 'BE': 'Belgique', 'NL': 'Pays-Bas', 'ES': 'Espagne', 'PT': 'Portugal',
    'IT_NORD': 'Italie Nord', 'IT_SICI': 'Sicile', 'CH': 'Suisse', 'AT': 'Autriche', 'PL': 'Pologne', 'CZ': 'Tchéquie',
    'SK': 'Slovaquie', 'HU': 'Hongrie', 'SI': 'Slovénie', 'HR': 'Croatie', 'RO': 'Roumanie', 'BG': 'Bulgarie',
    'GR': 'Grèce', 'RS': 'Serbie', 'DK_W': 'Danemark O.', 'DK_E': 'Danemark E.', 'SE': 'Suède', 'FI': 'Finlande',
    'NO_1': 'Norvège (Oslo)', 'EE': 'Estonie', 'LV': 'Lettonie', 'LT': 'Lituanie', 'MK': 'Macédoine du N.',
    'ME': 'Monténégro',
}


def load(path):
    with open(os.path.join(DATA, path), encoding='utf-8') as f:
        return json.load(f)


def to_n(series, n):
    """Mean of a series cut into n equal slices (96 quarter-hours or 24 hours to n points); None when missing."""
    s = list(series or [])
    if not s:
        return None
    out = []
    for i in range(n):
        lo, hi = int(i * len(s) / n), int((i + 1) * len(s) / n)
        part = [v for v in (s[lo:hi] or [s[min(lo, len(s) - 1)]]) if v is not None]
        out.append(round(sum(part) / len(part), 2) if part else None)
    return out


def points(series):
    return [[p[0], p[1]] if isinstance(p, list) else [p['date'], p['value']] for p in series['points']]


def main():
    files = sorted(glob.glob(os.path.join(DATA, 'history', 'daily', '????-??-??.json')))
    days = {os.path.basename(f)[:10]: f for f in files}
    # the latest delivery day with a French price, and the day before it
    order = sorted(days, reverse=True)
    def fr_of(d):
        z = (load(os.path.relpath(days[d], DATA)).get('zones') or {}).get('FR') or {}
        return z if z.get('avg') is not None and len(z.get('hourly') or []) >= 24 else None
    cur = next(d for d in order if fr_of(d))
    prev = next(d for d in order if d < cur and fr_of(d))
    cur_j, prev_j = load(os.path.relpath(days[cur], DATA)), load(os.path.relpath(days[prev], DATA))
    fr, frp = cur_j['zones']['FR'], prev_j['zones']['FR']
    pk = {
        'tom': {'date': cur, 'avg': fr['avg'], 'min': fr.get('min'), 'max': fr.get('max'), 'h': to_n(fr['hourly'], 96),
                'peak': fr.get('peakAvg'), 'off': fr.get('offAvg')},
        'tod_avg': frp['avg'], 'prev_date': prev, 'prev_h': to_n(frp['hourly'], 96),
    }

    # every bidding zone of the latest day, dearest first, with its change on the day before and its 24 hours
    eu = []
    for k, z in cur_j['zones'].items():
        if z.get('avg') is None or not z.get('hourly'):
            continue
        p = (prev_j['zones'].get(k) or {}).get('avg')
        h = to_n(z['hourly'], 24)
        eu.append([k, NAMES_FR.get(k, k), z['avg'], z.get('min'), z.get('max'),
                   round(z['avg'] - p, 2) if p is not None else None, [round(v) if v is not None else None for v in h]])
    pk['eu'] = sorted(eu, key=lambda e: -e[2])

    # the current year in France: negative hours per day and per month, prices by hour and month, the record day
    year = cur[:4]
    nd, heat = [], {}
    for d in sorted(x for x in days if x.startswith(year) and x <= cur):
        j = load(os.path.relpath(days[d], DATA))
        z = (j.get('zones') or {}).get('FR') or {}
        if z.get('avg') is None:
            continue
        nd.append([d, z.get('negH') or 0, z['avg']])
        h = to_n(z.get('hourly'), 24)
        if h:
            m = int(d[5:7]) - 1
            for i, v in enumerate(h):
                if v is not None:
                    heat.setdefault((m, i), []).append(v)
    pk['negD'] = nd
    pk['negYTD'] = round(sum(x[1] for x in nd), 1)
    pk['negDays'] = sum(1 for x in nd if x[1] > 0)
    months = sorted({x[0][:7] for x in nd})
    pk['negM'] = [[m, round(sum(x[1] for x in nd if x[0].startswith(m)), 1)] for m in months]
    last_m = int(cur[5:7])
    pk['heat'] = [[round(sum(heat[(m, h)]) / len(heat[(m, h)]), 1) if (m, h) in heat else None for h in range(24)] for m in range(last_m)]
    rec = max(nd, key=lambda x: (x[1], -x[2]))
    rz = load(os.path.relpath(days[rec[0]], DATA))['zones']['FR']
    pk['spring'] = {'date': rec[0], 'avg': rz['avg'], 'min': rz.get('min'), 'max': rz.get('max'), 'negH': rz.get('negH'),
                    'hourly': to_n(rz['hourly'], 96)}
    for k in ('solar', 'wind', 'nuclear', 'hydro', 'fossil'):
        pk['spring'][k] = to_n(rz.get(k), 24) or [0] * 24

    # the last 28 delivery days, newest first (96 points each)
    hist = []
    for d in order:
        if len(hist) >= 28 or d > cur:
            continue
        z = (load(os.path.relpath(days[d], DATA)).get('zones') or {}).get('FR') or {}
        if len(z.get('hourly') or []) >= 24:
            hist.append([round(v) if v is not None else None for v in to_n(z['hourly'], 96)])
    pk['hist'] = hist

    # M0, gas, carbon, nuclear available, the French mix and flows
    pk['m0'] = [[x['month'], x['base'], x['solarM0'], x['windM0'], x.get('complete', True)] for x in load('m0.json')['months'][-13:]]
    c = load('commodities.json')['series']
    ttf, nuc = points(c['ttf']), points(c['fr_nuc_avail'])
    pk['ttf'] = ttf[-60:]
    pk['eua'] = points(c['eua'])[-1]
    pk['nuc'] = nuc[-30:]
    mix = load('genmix.json')['countries']['FR']
    pk['mix'] = {k: mix.get(k, 0) for k in ('nuclear', 'hydro', 'wind', 'solar', 'fossil', 'biomass')}
    pk['flows'] = load('crossborder.json')['countries']['FR']

    # what drives the price: weekly means (Monday to Sunday) over the last 52 full weeks
    spot = {x[0]: x[2] for x in nd}
    for d in days:   # the previous year too
        if d[:4] != year and d >= f'{int(year) - 1}-01-01':
            z = (load(os.path.relpath(days[d], DATA)).get('zones') or {}).get('FR') or {}
            if z.get('avg') is not None:
                spot[d] = z['avg']
    ttf_d, nuc_d = dict(ttf), dict(nuc)
    end = dt.date.fromisoformat(cur)
    end -= dt.timedelta(days=(end.weekday() + 1) % 7)   # the last Sunday on or before the latest day
    start = end - dt.timedelta(days=7 * 52 - 1)
    drv = []
    for i in range(52):
        a = start + dt.timedelta(days=7 * i)
        wk = [(a + dt.timedelta(days=k)).isoformat() for k in range(7)]
        s = [spot[x] for x in wk if x in spot]
        t = [ttf_d[x] for x in wk if x in ttf_d]
        n = [nuc_d[x] for x in wk if x in nuc_d]
        drv.append([wk[0], round(sum(s) / len(s), 1) if s else None, round(sum(t) / len(t), 2) if t else None,
                    round(sum(n) / len(n) / 1000, 1) if n else None])
    pk['drv'] = drv

    # PPA benchmark of the pricer (Tools › PPA): the last six months
    pb = load(os.path.join('history', 'ppa_benchmark.json'))['days']
    keys = sorted(pb)[-183:]
    pk['ppa'] = {'tenor': pb[keys[-1]].get('tenor'),
                 'days': [[k, (pb[k].get('solar') or {}).get('ppa'), (pb[k].get('wind') or {}).get('ppa'), 1 if pb[k].get('rebuilt') else 0] for k in keys]}

    # news: latest headlines, and the counts
    news = load('news.json')
    items = sorted(news['items'], key=lambda i: i.get('date') or '', reverse=True)
    pk['news'] = [[i['source'], i['title'], (i.get('date') or '')[:10]] for i in items[:8]]
    pk['newsN'] = len(news['items'])
    pk['srcN'] = len(news['sources'])

    # pages of the site's menu (js/nav-v2.js), forward pages left out like on the page
    nav = open(os.path.join(ROOT, 'js', 'nav-v2.js'), encoding='utf-8').read()
    blk = nav[nav.index('const R = {'):]
    blk = blk[:blk.index('\n  };')]
    routes = re.findall(r"^\s+'([a-z0-9/_-]+)':", blk, re.M)
    pk['pagesN'] = len([r for r in routes if 'forward' not in r])
    pk['zonesN'] = len(pk['eu'])
    pk['updated'] = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    with open(os.path.join(DATA, 'landing.json'), 'w', encoding='utf-8') as f:
        json.dump(pk, f, ensure_ascii=False, separators=(',', ':'))

    # the Europe outline, lighter: rings inside the map's frame, simplified to about 0.15 degree
    geo = load(os.path.join('geo', 'europe.json'))
    feats = []
    for ft in geo['features']:
        g = ft['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        out = []
        for poly in polys:
            ring = poly[0]
            if not any(-25 <= c[0] <= 45 and 34 <= c[1] <= 72 for c in ring):
                continue
            r = []
            for c in ring:
                q = [round(c[0], 1), round(c[1], 1)]
                if not r or abs(q[0] - r[-1][0]) + abs(q[1] - r[-1][1]) >= 0.16:
                    r.append(q)
            if len(r) >= 6:
                if r[0] != r[-1]:
                    r.append(r[0])
                out.append([r])
        if out:
            feats.append({'type': 'Feature', 'properties': {'iso': ft['properties']['iso'], 'name': ft['properties']['name']},
                          'geometry': {'type': 'MultiPolygon', 'coordinates': out}})
    with open(os.path.join(DATA, 'geo', 'europe_simple.json'), 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': feats}, f, separators=(',', ':'))
    print(f"landing.json: delivery day {cur}, {len(pk['eu'])} zones, {pk['negYTD']} negative hours in {year}, "
          f"{pk['pagesN']} pages, {pk['newsN']} articles from {pk['srcN']} sources", file=sys.stderr)


if __name__ == '__main__':
    main()
