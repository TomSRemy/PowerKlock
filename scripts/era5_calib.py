#!/usr/bin/env python3
"""What a park would have produced, hour by hour, over many years — and how to correct it.

The pricing of a single park (with or without its own history) rests on a synthetic history:
ERA5 reanalysis weather at the park (Open-Meteo archive, hourly since 1940) through the
physical model of the production forecast tool. This script learns, from the REAL output of
every French region (RTE éCO2mix, load factor, monthly, 2018 → 2025), how far that simulation
is from reality, month by month: the prior the tool applies when the park has no history.

  factor[tech][region][month] = Σ actual load factor ÷ Σ simulated load factor (centre of the
                                region, south-facing 30° panels / generic onshore curve at 100 m)
  also: year-by-year spread of the yearly factor (how stable the correction is), and the
  national factor

Writes data/history/era5_calib.json     python scripts/era5_calib.py
"""
import json
import os
import urllib.parse

import numpy as np

import fcst_backtest as FB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'era5_calib.json')
Y0, Y1 = 2018, 2025
# mainland regions: (lat min, lat max, lon min, lon max), INSEE code
REG = {
    'Auvergne-Rhône-Alpes': ((44.6, 46.2, 3.2, 6.2), '84'), 'Bourgogne-Franche-Comté': ((46.4, 47.9, 3.3, 6.6), '27'),
    'Bretagne': ((47.7, 48.6, -4.0, -1.6), '53'), 'Centre-Val de Loire': ((46.6, 48.6, 0.3, 2.8), '24'),
    'Grand Est': ((47.7, 49.9, 3.8, 7.6), '44'), 'Hauts-de-France': ((49.2, 50.9, 1.7, 4.0), '32'),
    'Île-de-France': ((48.4, 49.1, 1.8, 3.2), '11'), 'Normandie': ((48.6, 49.7, -1.4, 1.5), '28'),
    'Nouvelle-Aquitaine': ((43.4, 46.8, -1.3, 2.2), '75'), 'Occitanie': ((42.6, 44.8, 0.0, 4.4), '76'),
    'Pays de la Loire': ((46.8, 48.2, -1.9, 0.6), '52'), "Provence-Alpes-Côte d'Azur": ((43.3, 44.8, 4.7, 7.0), '93'),
}


def actual_monthly(region):
    """monthly mean load factor of solar and onshore+offshore wind (RTE, consolidated and definitive data)"""
    def fetch():
        out = {}
        for ds in ('eco2mix-regional-cons-def',):
            url = ('https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/' + ds + '/exports/json?' + urllib.parse.urlencode({
                'select': "date_format(date_heure, 'yyyy-MM') as ym, avg(tch_solaire) as s, avg(tch_eolien) as w",
                'where': f'libelle_region="{region}" and date_heure>="{Y0}-01-01" and date_heure<"{Y1 + 1}-01-01"',
                'group_by': "date_format(date_heure, 'yyyy-MM')", 'timezone': 'Europe/Paris'}))
            for r in FB.get(url):
                if r.get('ym'):
                    out[r['ym']] = [None if r['s'] is None else r['s'] / 100, None if r['w'] is None else r['w'] / 100]
        return out
    return FB.cached('era5_act_' + region.replace(' ', '_').replace("'", ''), fetch)


def simulated_monthly(region, box):
    """monthly mean simulated load factor over a 2 × 2 grid of the region, ERA5"""
    def fetch():
        a, b, c, d = box
        pts = [((a + b) / 2, (c + d) / 2)]   # the region's centre (light on the archive's request quota)
        res = FB.get('https://archive-api.open-meteo.com/v1/archive?' + urllib.parse.urlencode({
            'latitude': ','.join(f'{p[0]:.3f}' for p in pts), 'longitude': ','.join(f'{p[1]:.3f}' for p in pts),
            'start_date': f'{Y0}-01-01', 'end_date': f'{Y1}-12-31', 'hourly': 'global_tilted_irradiance,temperature_2m,wind_speed_100m',
            'tilt': 30, 'azimuth': 0, 'wind_speed_unit': 'ms', 'timezone': 'Europe/Paris', 'models': 'era5'}))
        res = res if isinstance(res, list) else [res]
        acc = {}
        for r in res:
            h = r['hourly']
            for t, g, tt, w in zip(h['time'], h['global_tilted_irradiance'], h['temperature_2m'], h['wind_speed_100m']):
                o = acc.setdefault(t[:7], [0.0, 0.0, 0])
                if g is not None:
                    o[0] += FB.solar_lf(g, tt)
                if w is not None:
                    o[1] += FB.wind_lf(w)
                o[2] += 1
        return {k: [v[0] / v[2], v[1] / v[2]] for k, v in acc.items() if v[2]}
    return FB.cached('era5_sim_' + region.replace(' ', '_').replace("'", ''), fetch)


def main():
    out = {'source': 'RTE éCO2mix regional load factors (definitive/consolidated) vs ERA5 reanalysis through the forecast tool model (Open-Meteo archive)',
           'years': [Y0, Y1], 'solar': {}, 'wind': {}, 'codes': {r: c for r, (_, c) in REG.items()}, 'stability': {}, 'national': {}}
    nat = {'solar': [{}, {}], 'wind': [{}, {}]}
    for region, (box, code) in REG.items():
        act, sim = actual_monthly(region), simulated_monthly(region, box)
        for k, tech in enumerate(('solar', 'wind')):
            num, den, yr = {}, {}, {}
            for ym, a in act.items():
                s = sim.get(ym)
                if a[k] is None or not s or s[k] <= 0:
                    continue
                if tech == 'wind' and a[k] == 0:
                    continue
                m = int(ym[5:7]); y = ym[:4]
                num[m] = num.get(m, 0) + a[k]; den[m] = den.get(m, 0) + s[k]
                yy = yr.setdefault(y, [0, 0]); yy[0] += a[k]; yy[1] += s[k]
                nat[tech][0][m] = nat[tech][0].get(m, 0) + a[k]; nat[tech][1][m] = nat[tech][1].get(m, 0) + s[k]
            if len(num) < 12:
                continue
            out[tech][region] = {str(m): round(num[m] / den[m], 3) for m in sorted(num)}
            yf = {y: round(v[0] / v[1], 3) for y, v in sorted(yr.items()) if v[1] > 0}
            out['stability'].setdefault(tech, {})[region] = {'yearly_factor': yf, 'sd': round(float(np.std(list(yf.values()))), 3)}
            print(tech, region, 'months', out[tech][region], 'yearly', yf)
    for tech in ('solar', 'wind'):
        out['national'][tech] = {str(m): round(nat[tech][0][m] / nat[tech][1][m], 3) for m in sorted(nat[tech][0])}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)


if __name__ == '__main__':
    main()
