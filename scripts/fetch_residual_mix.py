#!/usr/bin/env python3
"""European residual mixes (AIB) for market-based Scope 2 accounting.

The Association of Issuing Bodies publishes, each year in May/June, the
residual mix of every country for the previous year: the generation mix left
once every guarantee of origin cancelled for consumers is taken out. The
GHG Protocol uses it as the emission factor of electricity not covered by a
contractual instrument (market-based method).

Writes data/residual_mix.json:
  {"updated", "source", "years": {"2025": {"CC": {
      "rm_co2", "prod_co2", "supplier_co2",           # g CO2/kWh (direct)
      "rm": {"re", "nuclear", "fossil", "untracked", "solar", "wind", "hydro",
             "biomass", "coal", "lignite", "gas", "oil"}  # shares, 0–1
  }}}}
Countries without a residual mix (full disclosure: AT, CH) have rm_co2 null.

Needs openpyxl.
"""
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'residual_mix.json')
BASE = 'https://www.aib-net.org'
PAGES = {  # year → page listing the results workbook
    2025: BASE + '/facts/european-residual-mix',
    2024: BASE + '/facts/european-residual-mix/2024',
    2023: BASE + '/facts/european-residual-mix/2023',
    2022: BASE + '/facts/european-residual-mix/2022',
}
UA = {'User-Agent': 'Mozilla/5.0 (PowerKlock data fetch)'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def workbook_url(year, page):
    html = get(page).decode('utf-8', 'replace')
    links = re.findall(r'href="([^"]+\.xlsx)"', html)
    links = [l for l in links if str(year) in l or 'RM%20calculation' in l] or links
    if not links:
        return None
    u = links[0]
    return u if u.startswith('http') else BASE + u


def num(v):
    if v is None or isinstance(v, str):
        t = str(v).strip().replace(',', '.')
        try:
            return float(t[:-1]) / 100 if t.endswith('%') else float(t)
        except (TypeError, ValueError):
            return None
    return float(v) if isinstance(v, (int, float)) else None


def find_sheet(wb, *words):
    for ws in wb.worksheets:
        if all(w.lower() in ws.title.lower() for w in words):
            return ws
    return None


def table(ws):
    """→ (header list, {country code: row list}) for a sheet whose rows start with a 2-letter code."""
    header, rows = None, {}
    for r in ws.iter_rows(values_only=True):
        if not any(c is not None for c in r):
            continue
        first = str(r[0]).strip() if r[0] is not None else ''
        if header is None and any(isinstance(c, str) and re.search(r'RE ?total|CO2', c, re.I) for c in r[1:]):
            header = [str(c).strip() if c is not None else '' for c in r]
            continue
        if header and re.fullmatch(r'[A-Z]{2}', first):
            rows[first] = list(r)
    return header or [], rows


def parse(year, data):
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    out = {}
    co2 = find_sheet(wb, 'co2')
    if co2 is not None:
        h, rows = table(co2)
        for cc, r in rows.items():
            out.setdefault(cc, {}).update({'prod_co2': num(r[1]), 'rm_co2': num(r[2]), 'supplier_co2': num(r[3]) if len(r) > 3 else None})
    rm = find_sheet(wb, 'residual mix') or find_sheet(wb, 'residual')
    for ws in wb.worksheets:   # the composition sheet is "Residual Mixes", not the "… Comparison" one
        if re.fullmatch(r'residual mix(es)?( \d{4})?', ws.title.strip(), re.I):
            rm = ws
    if rm is not None:
        h, rows = table(rm)
        col = lambda *names: next((i for i, c in enumerate(h) if any(re.fullmatch(n, c.strip(), re.I) for n in names)), None)
        idx = {'re': col(r'RE ?total'), 'nuclear': col(r'nuclear'), 'fossil': col(r'FO ?total'), 'untracked': col(r'untracked ?%?'),
               'solar': col(r'RE solar'), 'wind': col(r'RE wind'), 'hydro': col(r'RE hydro'), 'biomass': col(r'RE biomass'),
               'coal': col(r'FO hard coal'), 'lignite': col(r'FO lignite'), 'gas': col(r'FO gas'), 'oil': col(r'FO oil')}
        ico2 = col(r'CO2.*')
        for cc, r in rows.items():
            shares = {k: (num(r[i]) if i is not None and i < len(r) else None) for k, i in idx.items()}
            if all(not v for k, v in shares.items() if k != 'untracked'):   # NA or all zero: full disclosure
                shares = None
            out.setdefault(cc, {})['rm'] = shares
            if out[cc].get('rm_co2') is None and ico2 is not None and ico2 < len(r):
                out[cc]['rm_co2'] = num(r[ico2])
            if shares is None and not out[cc].get('rm_co2'):
                out[cc]['rm_co2'] = None    # full disclosure (AT, CH, NL 2025): no residual mix
    for cc, v in out.items():
        for k in ('prod_co2', 'rm_co2', 'supplier_co2'):
            v[k] = None if v.get(k) is None else round(v[k], 2)
        if v.get('rm'):
            v['rm'] = {k: (None if x is None else round(x, 4)) for k, x in v['rm'].items()}
    return out


def main():
    old = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            old = json.load(f).get('years', {})
    years = dict(old)
    for y, page in PAGES.items():
        try:
            url = workbook_url(y, page)
            if not url:
                print(f'::warning::{y}: no workbook link on {page}')
                continue
            res = parse(y, get(url))
            if res:
                years[str(y)] = res
                fr = res.get('FR', {})
                print(f'{y}: {len(res)} countries · FR residual {fr.get("rm_co2")} g/kWh · {url}')
        except Exception as e:  # keep the years already stored
            print(f'::warning::{y}: {e}')
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'AIB — European Residual Mixes (Association of Issuing Bodies), yearly results workbooks',
                   'unit': 'g CO2/kWh', 'years': dict(sorted(years.items()))}, f, separators=(',', ':'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
