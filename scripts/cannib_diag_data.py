#!/usr/bin/env python3
"""Cannibalisation diagnostic, data layer: one hourly panel (price, solar, wind, load, nuclear) for France and
its neighbours, and the monthly figures the diagnostic works on.

France 2016+: data/history/fr_hourly (RTE éCO2mix × ENTSO-E) and data/history/rte (pumping, exchanges, hydro).
Germany, Spain, Belgium, the Netherlands 2020+: prices from data/history/daily (Paris delivery day), solar, wind, load,
nuclear and pumping from data/history/region_hourly (Energy-Charts). No network call: only files already in the
repository. Used by scripts/cannib_diag.py.
"""
import json
import os
import pickle
from datetime import date, timedelta

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
ZONE = {'DE': 'DE_LU', 'ES': 'ES', 'BE': 'BE', 'NL': 'NL'}
COUNTRIES = ('FR', 'DE', 'ES', 'BE', 'NL')
MID = slice(11, 15)        # the four midday hours the repository already uses (11:00-15:00 Paris time)
CACHE = os.environ.get('CANNIB_CACHE', '/tmp/cannib_panel.pkl')


def _h24(a):
    if not a or len(a) % 24:
        return None
    k = len(a) // 24
    out = []
    for h in range(24):
        x = [v for v in a[h * k:(h + 1) * k] if v is not None]
        out.append(sum(x) / len(x) if x else None)
    return out


def load_panel(first=2016, last=None):
    """{country: {day: {'p','s','w','l','n' (+ FR: 'pump','exp','hyd'; others: 'pump')}: [24]}}"""
    if os.path.exists(CACHE):
        return pickle.load(open(CACHE, 'rb'))
    last = last or date.today().year
    P = {c: {} for c in COUNTRIES}
    for y in range(first, last + 1):
        try:
            fr = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
        except OSError:
            continue
        for d, v in fr.items():
            P['FR'][d] = {k: v.get(k) for k in 'pswln'}
        for m in range(1, 13):
            try:
                rte = json.load(open(os.path.join(H, 'rte', f'{y}-{m:02d}.json')))['days']
            except OSError:
                continue
            for d, v in rte.items():
                if d in P['FR']:
                    pu, ex, hy = _h24(v.get('pumping')), _h24(v.get('exchanges')), _h24(v.get('hydro'))
                    P['FR'][d]['pump'] = [abs(x) if x is not None else None for x in pu] if pu else None
                    P['FR'][d]['exp'] = [-x if x is not None else None for x in ex] if ex else None   # éCO2mix: > 0 = imports
                    P['FR'][d]['hyd'] = hy
        try:
            rg = json.load(open(os.path.join(H, 'region_hourly', f'{y}.json')))['countries']
        except OSError:
            rg = {}
        d0 = date(y, 1, 1)
        while d0.year == y:
            d = d0.isoformat()
            d0 += timedelta(days=1)
            try:
                z = json.load(open(os.path.join(H, 'daily', d + '.json')))['zones']
            except (OSError, KeyError):
                z = {}
            for c, zn in ZONE.items():
                row = {k: (rg.get(c, {}).get(k, {}) or {}).get(d) for k in 'swln'}
                if not row['s'] or not row['l']:
                    continue
                row['pump'] = (rg.get(c, {}).get('psc', {}) or {}).get(d)
                row['p'] = _h24((z.get(zn) or {}).get('hourly'))
                P[c][d] = row
    pickle.dump(P, open(CACHE, 'wb'))
    return P


def _ok(v, keys):
    return all(v.get(k) and len(v[k]) == 24 and None not in v[k] for k in keys)


def monthly(P, c):
    """{(y, m): figures} for one country; months with fewer than 25 complete days are dropped"""
    acc = {}
    for d, v in P[c].items():
        if not _ok(v, 'psw') or not _ok(v, 'l'):
            continue
        acc.setdefault((int(d[:4]), int(d[5:7])), []).append(v)
    out = {}
    for (y, m), days in acc.items():
        if len(days) < 25:
            continue
        p = np.array([v['p'] for v in days], float)
        s = np.array([v['s'] for v in days], float)
        w = np.array([v['w'] for v in days], float)
        ld = np.array([v['l'] for v in days], float)
        n = np.array([(v.get('n') if v.get('n') and None not in v['n'] else [0] * 24) for v in days], float)
        pump = np.array([[x or 0 for x in (v.get('pump') or [0] * 24)] for v in days], float)
        base = p.mean()
        paid = p >= 0
        r = {'days': len(days), 'base': base, 'negH': int((p < 0).sum()), 'nonposH': int((p <= 0).sum()),
             'sMWh': s.sum(), 'wMWh': w.sum(), 'lMWh': ld.sum(),
             'n': n.mean(), 'l': ld.mean(), 'w': w.mean(), 's': s.mean(),
             'sMid': s[:, MID].mean(), 'lMid': ld[:, MID].mean(), 'nMid': n[:, MID].mean(), 'wMid': w[:, MID].mean(),
             'pumpMid': np.abs(pump[:, MID]).mean(), 'pumpMax': float(np.percentile(np.abs(pump), 99)),
             'pMid': p[:, MID].mean()}
        for t, V in (('s', s), ('w', w)):
            r['val_' + t] = (V * p).sum()                                   # € of the month's output, every hour paid
            r['cr_' + t] = r['val_' + t] / V.sum() / base if base > 0 and V.sum() > 0 else None
            e = (V * paid).sum()
            r['paid_' + t] = e
            r['valc_' + t] = (V * p * paid).sum()
            r['crc_' + t] = r['valc_' + t] / e / base if base > 0 and e > 0 else None   # 'curt': paid hours, all-hours baseload
            r['negShare_' + t] = 1 - e / V.sum() if V.sum() > 0 else None  # share of the output delivered at a price < 0
        # hour-by-hour surplus: share of midday hours where solar + wind + nuclear exceed the load
        r['surplusMid'] = float(((s + w + n)[:, MID] > ld[:, MID]).mean())
        if c == 'FR':
            ex = np.array([[x or 0 for x in (v.get('exp') or [0] * 24)] for v in days], float)
            hy = np.array([[x or 0 for x in (v.get('hyd') or [0] * 24)] for v in days], float)
            r['expMid'] = ex[:, MID].mean()
            r['hyd'] = hy.mean()
        out[(y, m)] = r
    return out


def capacities():
    """{country: {'s': {year: GW}, 'w': {...}}} end-of-year installed capacity (data/history/capacity.json);
    France: RTE (ODRÉ) for solar and wind, as the pricer"""
    caps = json.load(open(os.path.join(H, 'capacity.json')))['countries']
    out = {}
    for c, d in caps.items():
        t = d['types']
        sol = t.get('Solar AC') or t.get('Solar') or t.get('Solar DC') or []
        won, wof = t.get('Wind onshore') or [], t.get('Wind offshore') or []
        o = {'s': {}, 'w': {}}
        for i, y in enumerate(d['years']):
            if i < len(sol) and sol[i]:
                o['s'][y] = sol[i]
            ww = (won[i] if i < len(won) and won[i] else 0) + (wof[i] if i < len(wof) and wof[i] else 0)
            if ww:
                o['w'][y] = ww
        out[c] = o
    return out


def commodities_monthly():
    """{'ttf'|'eua'|'nuc': {(y, m): mean}} from data/history/commodities_series.json (TTF and nuclear availability from
    2019, EUA from mid-December 2019)"""
    s = json.load(open(os.path.join(H, 'commodities_series.json')))['series']
    out = {}
    for k, name in (('ttf', 'ttf'), ('eua', 'eua'), ('fr_nuc_avail', 'nuc')):
        acc = {}
        for d, v in s[k]['points']:
            if v is not None:
                acc.setdefault((int(d[:4]), int(d[5:7])), []).append(v)
        out[name] = {ym: sum(v) / len(v) for ym, v in acc.items()}
    return out


if __name__ == '__main__':
    P = load_panel()
    for c in COUNTRIES:
        M = monthly(P, c)
        ys = sorted({y for y, _ in M})
        print(c, len(P[c]), 'days', ys[0], ys[-1], len(M), 'months')
