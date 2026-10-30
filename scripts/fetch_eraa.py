#!/usr/bin/env python3
"""ENTSO-E's European Resource Adequacy Assessment (ERAA), the official pan-European projections, for the PPA
scenario generator's merit order: installed capacity by zone, technology and target year, yearly demand, the Core
flow-based domains' export / import reach by zone, and the fuel and CO2 price assumptions. Republished every year
(one edition a year); the newest edition found is kept, its consolidated version (post-consultation or final) and its
national-trends (NECP-based) scenario.

Source: entsoe.eu/eraa/<edition>/modelling-data, "Dashboard - Raw data" (CC-BY-4.0); the 2024 edition came as xlsx,
the 2026 one as csv: both read.

Writes data/history/eraa.json
    {"edition", "version", "source", "capacity": {zone: {target year: {technology: MW}}},
     "demand_twh": {zone: {target year: TWh}}, "fb_core": {zone: {target year: {"exp": MW, "imp": MW}}},
     "commodities": {fuel: {year: [price, unit]}}}
    python scripts/fetch_eraa.py
"""
import collections
import csv
import io
import json
import sys
import warnings
import zipfile
from datetime import date
from pathlib import Path

import openpyxl
import requests

BASE = 'https://eepublicdownloads.blob.core.windows.net/public-cdn-container/clean-documents/sdc-documents/ERAA/ERAA_{y}/Dashboard_raw_data.zip'
OUT = Path('data/history/eraa.json')
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}
warnings.simplefilter('ignore')


def table(z, stem):
    """the rows of the file whose name starts with stem (xlsx or csv), as dicts with lower-case keys"""
    key = stem.lower().replace(' ', '').replace('_', '')
    name = next(n for n in z.namelist() if n.split('/')[-1].lower().replace(' ', '').replace('_', '').startswith(key))
    if name.endswith('.csv'):
        rows = list(csv.DictReader(io.StringIO(z.read(name).decode('utf-8-sig', errors='replace'))))
    else:
        ws = openpyxl.load_workbook(io.BytesIO(z.read(name)), read_only=True, data_only=True).worksheets[0]
        raw = [r for r in ws.iter_rows(values_only=True) if r and any(x is not None for x in r)]
        rows = [dict(zip([str(x) for x in raw[0]], r)) for r in raw[1:]]
    return [{k.lower(): v for k, v in r.items() if k} for r in rows]


def get(r, *names):
    for n in names:
        if r.get(n) not in (None, ''):
            return r[n]
    return None


def pick(rows):
    """the newest consolidated version, national-trends scenario"""
    vs = sorted({str(get(r, 'data_version')) for r in rows if get(r, 'data_version')})
    best = [v for v in vs if 'post' in v.lower() or 'final' in v.lower()]
    v = max(best or vs, key=lambda s: (s[:9], 'post' in s.lower()))
    out = [r for r in rows if str(get(r, 'data_version')) == v]
    sc = {get(r, 'study_scenario') for r in out}
    if 'NECP-based' in sc:
        out = [r for r in out if get(r, 'study_scenario') == 'NECP-based']
    return out, v


def main():
    z, edition = None, None
    for y in range(date.today().year + 1, 2023, -1):
        r = requests.get(BASE.format(y=y), headers=UA, timeout=300)
        if r.status_code == 200 and r.content[:2] == b'PK':
            z, edition = zipfile.ZipFile(io.BytesIO(r.content)), y
            break
    if z is None:
        sys.exit('ERAA: no edition found')
    rows, version = pick(table(z, 'GenerationCapacities'))
    cap = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(float)))
    for r in rows:
        st = str(get(r, 'operational_status', 'status') or '')
        if 'out of market' in st.lower() or st == 'Non-Market':
            continue
        v = get(r, 'value', 'capacity_mw')
        if v is not None:
            cap[get(r, 'market_node')][str(get(r, 'target year', 'target_year'))][get(r, 'technology')] += float(v)
    rows, _ = pick(table(z, 'Aggregated_Demand'))
    dem = collections.defaultdict(dict)
    for r in rows:
        if str(get(r, 'measure_type', 'type_ws')).upper() == 'AVG' and 'twh' in str(get(r, 'measure') or 'TWh').lower():
            dem[get(r, 'market_node')][str(get(r, 'target_year'))] = round(float(get(r, 'value', 'demand_twh')), 2)
    rows, _ = pick(table(z, 'FlowBased_Core_KPI'))
    fb = collections.defaultdict(lambda: collections.defaultdict(lambda: {'exp': [], 'imp': []}))
    for r in rows:
        ahc = str(get(r, 'ahc_status', 'ahc') or '')
        if get(r, 'module') == 'Adequacy' and ahc.lower().replace(' ', '_') in ('with_ahc', 'ahc'):
            zone = get(r, 'element', 'study_zone'); ie = str(get(r, 'imp_exp', 'import_export')).lower()
            fb[zone][str(get(r, 'year'))]['exp' if ie.startswith('exp') else 'imp'].append(float(get(r, 'sum of value', 'net_exchange_mw')))
    fbm = {zn: {ty: {k: round(sum(v) / len(v)) for k, v in d.items() if v} for ty, d in t.items()} for zn, t in fb.items()}
    rows, _ = pick(table(z, 'Commodity'))
    com = collections.defaultdict(dict)
    for r in rows:
        v = get(r, 'value', 'price')
        if v is not None:
            com[get(r, 'fuel')][str(get(r, 'year'))] = [round(float(v), 3), get(r, 'unit')]
    OUT.write_text(json.dumps({'edition': edition, 'version': version,
                               'source': f'ENTSO-E, European Resource Adequacy Assessment (ERAA_{edition} downloads, {version}, national trends), '
                                         'modelling data, dashboard raw data (CC-BY-4.0); flow-based reach: mean of the adequacy domains with '
                                         'advanced hybrid coupling',
                               'capacity': cap, 'demand_twh': dem, 'fb_core': fbm, 'commodities': com}, separators=(',', ':')))
    print('ERAA', edition, version, len(cap), 'zones;', 'fb', len(fbm), 'zones')


if __name__ == '__main__':
    main()
