#!/usr/bin/env python3
"""France M0: official CRE values, PowerKlock's estimate and a forecast.

1. Official — CRE open data "Données nécessaires au calcul des compléments de
   rémunération" (Publication_donnees_CR.xlsx): annual and monthly M0,
   monthly M0 wind and solar profiles, contractual-winter M0, steps with a
   negative day-ahead price, capacity reference prices.
2. Estimate (month to date and months the CRE has not published yet) — the
   CRE method on PowerKlock data: mean of the day-ahead prices ≥ 0, weighted
   at the market time step by national wind / solar output (RTE éCO2mix),
   negative steps left out; base M0 = arithmetic mean of the prices ≥ 0.
3. Forecast for the coming months — forward baseload of the month × the
   ratio M0 / mean day-ahead price of the same calendar month over the last
   three years (CRE M0 when published, else the estimate); range = lowest and
   highest of the three years.

Writes data/cre_m0.json.
"""
import io
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timezone

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'cre_m0.json')
URL = 'https://www.cre.fr/fileadmin/Documents/Open_data/Transition_energetique_et_appels_d_offres/Publication_donnees_CR.xlsx'
PAGE = 'https://www.cre.fr/documents/open-data/donnees-necessaires-au-calcul-des-complements-de-remuneration.html'
MOIS = {'janvier': 1, 'fevrier': 2, 'février': 2, 'mars': 3, 'avril': 4, 'mai': 5, 'juin': 6, 'juillet': 7,
        'aout': 8, 'août': 8, 'septembre': 9, 'octobre': 10, 'novembre': 11, 'decembre': 12, 'décembre': 12}


def num(v):
    try:
        return float(v) if v not in (None, '', '-') else None
    except (TypeError, ValueError):
        return None


def month_key(y, m):
    try:
        y = int(y)
    except (TypeError, ValueError):
        return None
    mm = MOIS.get(str(m).strip().lower())
    return f'{y}-{mm:02d}' if mm else None


def official(xlsx_bytes):
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True, read_only=True)
    sheet = lambda pat: next((ws for ws in wb.worksheets if re.search(pat, ws.title, re.I)), None)
    out = {'annual': {}, 'monthly': {}, 'wind': {}, 'solar': {}, 'winter': {}, 'negSteps': {}, 'capacity': []}
    ws = sheet(r'^M0 annuels')
    for r in ws.iter_rows(values_only=True):
        if isinstance(r[0], (int, float)) and num(r[1]) is not None:
            out['annual'][str(int(r[0]))] = round(num(r[1]), 3)
    ws = sheet(r'^M0 mensuels$')
    for r in ws.iter_rows(values_only=True):
        k = month_key(r[0], r[1])
        v = num(r[3]) if len(r) > 3 and num(r[3]) is not None else num(r[2])
        if k and v is not None:
            out['monthly'][k] = round(v, 3)
    for key, pat in (('wind', r'profil éolien'), ('solar', r'profil solaire')):
        ws = sheet(pat)
        for r in ws.iter_rows(values_only=True):
            k = month_key(r[0], r[1])
            v = next((num(r[i]) for i in (4, 3, 2) if len(r) > i and num(r[i]) is not None), None)   # final > corrective > on time
            if k and v is not None:
                out[key][k] = round(v, 3)
    ws = sheet(r'hivers')
    for r in ws.iter_rows(values_only=True):
        if isinstance(r[0], str) and re.fullmatch(r'\d{4}/\d{4}', r[0].strip()) and num(r[1]) is not None:
            out['winter'][r[0].strip()] = round(num(r[1]), 3)
    ws = sheet(r'prix\s*<\s*0')
    for r in ws.iter_rows(values_only=True):
        k = month_key(r[0], r[1])
        if not k or str(r[2]).strip().lower() != 'oui':
            continue
        step = r[4]
        quarter = (hasattr(step, 'minute') and step.minute % 60) or k >= '2026-05'
        n = out['negSteps'].setdefault(k, {'steps': 0, 'hours': 0.0, 'min': None})
        n['steps'] += 1
        n['hours'] += 0.25 if quarter else 1.0
        p = num(r[5])
        if p is not None and (n['min'] is None or p < n['min']):
            n['min'] = p
    ws = sheet(r'capacit')
    for r in ws.iter_rows(values_only=True):
        if isinstance(r[0], (int, float)) and r[0] > 2000 and (num(r[2]) is not None or num(r[3]) is not None):
            out['capacity'].append({'delivery': int(r[0]), 'auction': int(r[1]) if isinstance(r[1], (int, float)) else None,
                                    'secondYear': num(r[2]), 'standard': num(r[3])})
    return out


def load_json(path):
    try:
        with open(os.path.join(ROOT, path)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def prices(day):
    d = load_json(f'data/history/daily/{day}.json')
    h = ((d or {}).get('zones') or {}).get('FR', {}).get('hourly')
    if not isinstance(h, list) or len(h) not in (24, 96):
        return None
    return [x for x in h for _ in range(4)] if len(h) == 24 else h


def estimates(months):
    """CRE method on PowerKlock data for the given YYYY-MM months. Where the production of the parks under
    complément de rémunération is published (ODRÉ, scripts/fetch_cr_production.py), the same method weighted
    with that real profile gives windCR / solarCR."""
    res = {}
    cr = (load_json('data/history/cr_production.json') or {}).get('days') or {}
    for ym in months:
        f = load_json(f'data/history/rte/{ym}.json')
        if not f:
            continue
        a = {'pAll': 0.0, 'nAll': 0, 'pPos': 0.0, 'nPos': 0, 'w': 0.0, 'wp': 0.0, 's': 0.0, 'sp': 0.0, 'days': 0, 'negQ': 0,
             'wA': 0.0, 'wpA': 0.0, 'sA': 0.0, 'spA': 0.0, 'wC': 0.0, 'wpC': 0.0, 'sC': 0.0, 'spC': 0.0, 'dC': 0}
        for day, r in sorted((f.get('days') or {}).items()):
            p = prices(day)
            sol, win = r.get('solar') or [], r.get('wind') or []
            if not p or len(sol) != 96 or len(win) != 96:
                continue
            a['days'] += 1
            c = cr.get(day)
            if c:
                a['dC'] += 1
            for q in range(96):
                v = p[q]
                if v is None:
                    continue
                a['pAll'] += v; a['nAll'] += 1
                # capture price: every step, negative prices included
                wa, sa = max(0.0, win[q] or 0.0), max(0.0, sol[q] or 0.0)
                a['wA'] += wa; a['wpA'] += wa * v; a['sA'] += sa; a['spA'] += sa * v
                if v < 0:
                    a['negQ'] += 1
                    continue
                a['pPos'] += v; a['nPos'] += 1
                if c:
                    cw, cs = max(0.0, c['wind'][q] or 0.0), max(0.0, c['solar'][q] or 0.0)
                    a['wC'] += cw; a['wpC'] += cw * v; a['sC'] += cs; a['spC'] += cs * v
                w, s = max(0.0, win[q] or 0.0), max(0.0, sol[q] or 0.0)
                a['w'] += w; a['wp'] += w * v; a['s'] += s; a['sp'] += s * v
        if not a['nAll']:
            continue
        res[ym] = {'base': round(a['pPos'] / a['nPos'], 3) if a['nPos'] else None,
                   'baseAll': round(a['pAll'] / a['nAll'], 3),
                   'wind': round(a['wp'] / a['w'], 3) if a['w'] else None,
                   'solar': round(a['sp'] / a['s'], 3) if a['s'] else None,
                   'windCap': round(a['wpA'] / a['wA'], 3) if a['wA'] else None,
                   'solarCap': round(a['spA'] / a['sA'], 3) if a['sA'] else None,
                   'days': a['days'], 'negHours': a['negQ'] / 4}
        if a['dC'] == a['days'] and a['wC']:   # the whole month covered by the published parks' output
            # the parks' own profile reproduces the CRE M0 to a few cents (39 months: solar 0.08 €, wind 0.14 € mean gap,
            # against 1.06 € and 0.28 € with the national output): it becomes the estimate, the national one is kept
            res[ym]['windNat'], res[ym]['solarNat'] = res[ym]['wind'], res[ym]['solar']
            res[ym]['wind'] = round(a['wpC'] / a['wC'], 3)
            res[ym]['solar'] = round(a['spC'] / a['sC'], 3) if a['sC'] else res[ym]['solar']
            res[ym]['profile'] = 'cr'
    return res


def month_forwards(today):
    """Forward baseload per delivery month from the France forward strip."""
    mk = load_json('data/fr_market.json') or {}
    rows = mk.get('forwardCurve') or []
    by = {}
    for r in rows:
        c, v = r.get('contract') or '', r.get('value')
        if v is None:
            continue
        m = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})\b', c)
        if m:
            by[('M', 2000 + int(m.group(2)), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].index(m.group(1)) + 1)] = v
            continue
        m = re.search(r'Q([1-4]) (\d{2})', c)
        if m:
            by[('Q', 2000 + int(m.group(2)), int(m.group(1)))] = v
            continue
        m = re.search(r'Cal(\d{4})', c)
        if m:
            by[('Y', int(m.group(1)), 0)] = v
    out = {}
    for k in range(1, 15):
        y, mo = today.year + (today.month - 1 + k) // 12, (today.month - 1 + k) % 12 + 1
        q = (mo - 1) // 3 + 1
        if ('M', y, mo) in by:
            out[f'{y}-{mo:02d}'] = (by[('M', y, mo)], 'month')
            continue
        if ('Q', y, q) in by:
            qv = by[('Q', y, q)]
            known = [by[('M', y, m)] for m in range((q - 1) * 3 + 1, q * 3 + 1) if ('M', y, m) in by]
            # months of a quarter not quoted on their own share what the quarter leaves
            rest = (3 * qv - sum(known)) / (3 - len(known)) if len(known) < 3 else qv
            out[f'{y}-{mo:02d}'] = (round(rest, 2), 'quarter')
            continue
        if ('Y', y, 0) in by:
            qs = [by.get(('Q', y, i)) for i in range(1, 5)]
            known = [v for v in qs if v is not None]
            rest = (4 * by[('Y', y, 0)] - sum(known)) / (4 - len(known)) if len(known) < 4 else by[('Y', y, 0)]
            out[f'{y}-{mo:02d}'] = (round(rest, 2), 'calendar')
    return out, (rows[0].get('date') if rows else None)


def main():
    try:
        req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 (PowerKlock data fetch)'})
        with urllib.request.urlopen(req, timeout=90) as r:
            off = official(r.read())
    except Exception as e:
        print(f'::warning::CRE workbook not read: {e}')
        old = load_json('data/cre_m0.json') or {}
        off = old.get('official') or {'annual': {}, 'monthly': {}, 'wind': {}, 'solar': {}, 'winter': {}, 'negSteps': {}, 'capacity': []}
    today = date.today()
    this = f'{today.year}-{today.month:02d}'
    # estimates: every month with RTE data (comparison with CRE) — 36 last months
    months = sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, 'data', 'history', 'rte')) if re.fullmatch(r'\d{4}-\d{2}\.json', f))
    est = estimates(months)
    # ratios M0 / mean day-ahead price, same calendar month, last three years
    def ratio(ym, tech):
        e = est.get(ym)
        if not e or not e['baseAll']:
            return None
        if tech in ('windCap', 'solarCap'):
            v = e[tech]
        else:
            v = off[tech].get(ym) if tech in ('wind', 'solar') else off['monthly'].get(ym)
            if v is None:
                v = e[tech] if tech in ('wind', 'solar') else e['base']
        return v / e['baseAll'] if v is not None and e['baseAll'] > 0 else None
    fwd, fwd_date = month_forwards(today)
    forecast = []
    for ym, (f, src) in sorted(fwd.items()):
        mo = int(ym[5:])
        rec = {'month': ym, 'forward': f, 'from': src}
        for tech in ('base', 'wind', 'solar', 'windCap', 'solarCap'):
            past = [f'{y}-{mo:02d}' for y in range(today.year - 4, today.year + 1) if f'{y}-{mo:02d}' < this]
            rs = [r for r in (ratio(k, tech) for k in past) if r is not None][-3:]
            if rs:
                m = sum(rs) / len(rs)
                rec[tech] = round(f * m, 2)
                rec[tech + 'Lo'] = round(f * min(rs), 2)
                rec[tech + 'Hi'] = round(f * max(rs), 2)
                rec[tech + 'Ratio'] = round(m, 4)
        forecast.append(rec)
    out = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': {'official': 'CRE — open data, données nécessaires au calcul des compléments de rémunération (' + PAGE + ')',
                   'estimate': 'PowerKlock — CRE method on ENTSO-E day-ahead prices, weighted by the output of the parks under complément de rémunération (ODRÉ) where published, else by RTE éCO2mix national output; capture prices (windCap, solarCap) = same weighting with every step, negative prices included',
                   'forecast': 'PowerKlock — forward baseload × M0 / mean price ratio of the same month over the last three years'},
        'method': 'CRE: mean of the day-ahead prices ≥ 0, weighted at the market time step (15 min since May 2026, hourly before) by the national profile; negative steps left out.',
        'official': off, 'estimate': est, 'forecast': forecast, 'forwardDate': fwd_date, 'currentMonth': this,
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    lastm = sorted(off['solar'])[-1] if off['solar'] else '-'
    print(f'CRE: {len(off["monthly"])} months base, solar to {lastm}; estimates {len(est)}; forecast {len(forecast)} months')
    for m in sorted(est)[-4:]:
        print('  est', m, est[m], '| CRE', off['monthly'].get(m), off['wind'].get(m), off['solar'].get(m))
    for r in forecast[:4]:
        print('  fc', r)
    return 0


if __name__ == '__main__':
    sys.exit(main())
