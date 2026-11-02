#!/usr/bin/env python3
"""Who keeps producing at negative prices in France, and how it changes (Tom 1 Nov. 2026: the share of solar and
wind that does not stop below 0 € drives the zero and negative hours; it must be computed from public data and
updated, not copied from a study).

1. Register (ODRÉ, registre national des installations, every wind park and every solar plant above 36 kW, with its
   commissioning date and size). The register carries no contract, so the support is deduced, as the Selfee
   gisement study did (same results: wind purchase-obligation exits 0.81 / 0.80 / 0.59 / 1.05 / 1.11 GW in
   2026–2030):
     wind onshore commissioned up to 2018: purchase obligation (OA) for 15 years, later: complément de rémunération
     (CR) for 20 years; offshore: 20 years;
     solar: OA up to 100 kW (500 kW from 2022) and all plants commissioned up to 2011, else tender / CR, 20 years.
   Per year: capacity under OA, under CR, out of support (merchant), OA exits; and, with config/flex_rules.json, the
   OA capacity reached by the stop orders.
2. Measured behaviour (ODRÉ courbes de production éolien-solaire complément de rémunération = all wind and solar
   above 250 kWc, the CRE reference; national output and prices from data/history/fr_hourly): for each year, the
   output kept at negative prices ÷ the output that would have been produced (rebuilt from the neighbouring hours,
   or the day's shape for solar), for wind, large solar and small solar (national − reference); and the energy not
   produced at negative prices.
3. Wind: kept share κ = s + α (1 − s), s = OA share not reached by stop orders. α (what the rest keeps) is measured
   each year; the projection carries the mean α of the last three years, with new parks on CR at the register's
   last three years' pace. Two cases: stop orders as observed (the 2025 rule did not change OA wind output) and
   stop orders applied in full (every OA park above the threshold stops).

Out  data/history/flex_share.json
"""
import csv
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'flex_share.json')
RULES = os.path.join(ROOT, 'config', 'flex_rules.json')
ODRE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/'
REG = 'registre-national-installation-production-stockage-electricite-agrege'
CRP = 'courbes-de-production-mensuelles-eolien-solaire-complement-de-remuneration'
Y0, Y1 = 2018, 2035


def get(ds, fmt, **q):
    req = urllib.request.Request(f'{ODRE}{ds}/exports/{fmt}?{urllib.parse.urlencode(q)}', headers={'User-Agent': 'PowerKlock data fetch'})
    return urllib.request.urlopen(req, timeout=300).read()


def register():
    rows = json.loads(get(REG, 'json', select='filiere,technologie,puismaxinstallee,datemiseenservice_date',
                          where="(filiere='Eolien' and nbinstallations=1) or (filiere='Solaire' and nbinstallations=1 and puismaxinstallee>36)"))
    out = []
    for r in rows:
        s, kw = r.get('datemiseenservice_date'), r.get('puismaxinstallee') or 0
        if not s or kw <= 0:
            continue
        y, mw = int(s[:4]), kw / 1000
        if r['filiere'] == 'Eolien':
            off = 'Mer' in (r.get('technologie') or '')
            sup, end = ('CR', y + 20) if off or y >= 2019 else ('OA', y + 15)
            out.append(('wind', sup, y, end, mw))
        else:
            sup = 'OA' if y <= 2011 or mw <= (0.5 if y >= 2022 else 0.1) else 'CR'
            out.append(('solar', sup, y, y + 20, mw))
    if len(out) < 50000:
        sys.exit(f'register: only {len(out)} plants, previous file kept')
    return out


def threshold(rules, tech, sup, Y, proposed):
    """lowest stop-order size (MW) in force for most of year Y"""
    t = None
    for r in rules:
        if tech in r['techs'] and sup in r['support'] and (r['status'] == 'law' or proposed) and r['kind'] == 'stop' and date.fromisoformat(r['from']) <= date(Y, 7, 1):
            t = r['minMW'] if t is None else min(t, r['minMW'])
    return t


def fleet(reg, rules):
    pace = {}
    for tech in ('wind', 'solar'):
        last = max(y for t, _, y, _, _ in reg if t == tech)
        full = last - 1   # the current year is partial
        pace[tech] = sum(mw for t, _, y, _, mw in reg if t == tech and full - 2 <= y <= full) / 3
    res = {}
    for tech in ('wind', 'solar'):
        rows = [r for r in reg if r[0] == tech]
        last = max(r[2] for r in rows)
        res[tech] = {'paceGW': round(pace[tech] / 1000, 2), 'years': {}}
        for Y in range(Y0, Y1 + 1):
            live = [r for r in rows if r[2] <= Y]
            new = pace[tech] * max(0, Y - last)   # future parks: CR, at the recent pace
            tot = sum(r[4] for r in live) + new
            oa = [r for r in live if r[1] == 'OA' and r[3] > Y]
            e = {'tot': tot, 'oa': sum(r[4] for r in oa), 'cr': sum(r[4] for r in live if r[1] == 'CR' and r[3] > Y) + new,
                 'exits': sum(r[4] for r in rows if r[1] == 'OA' and r[3] == Y),
                 'exitsCR': sum(r[4] for r in rows if r[1] == 'CR' and r[3] == Y)}
            e['merchant'] = tot - e['oa'] - e['cr']
            for k, prop in (('oaStop', False), ('oaStopProp', True)):
                t = threshold(rules, tech, 'OA', Y, prop)
                e[k] = sum(r[4] for r in oa if t is not None and r[4] >= t)
            res[tech]['years'][Y] = {k: round(v / 1000, 3) for k, v in e.items()}
            res[tech]['years'][Y]['projected'] = Y > last
    return res


def cr_hourly():
    txt = get(CRP, 'csv', select='date,heure,prod_eolienne_mw,prod_solaire_mw', delimiter=';').decode('utf-8-sig')
    acc = {}
    for r in csv.DictReader(io.StringIO(txt), delimiter=';'):
        try:
            k, w, s = (r['date'], int(r['heure'][:2])), float(r['prod_eolienne_mw']), float(r['prod_solaire_mw'])
        except (TypeError, ValueError):
            continue
        a = acc.setdefault(k, [0.0, 0.0, 0])
        a[0] += w; a[1] += s; a[2] += 1
    if len(acc) < 20000:
        sys.exit(f'CR production: only {len(acc)} hours, previous file kept')
    return {k: (v[0] / v[2], v[1] / v[2]) for k, v in acc.items()}


def solar_pot(S, P, month):
    """the day's output without stops: the month's mean shape of clean days, scaled on the day's hours at P ≥ 0"""
    out, bad = S.copy(), P < 0
    clean = ~bad.any(1)
    for m in range(1, 13):
        dm = month == m
        ref = dm & clean & (S.sum(1) > 0)
        if ref.sum() < 3:
            ref = clean & (np.abs(month - m) <= 1) & (S.sum(1) > 0)
        if not ref.any():
            continue
        shape = (S[ref] / S[ref].sum(1, keepdims=True)).mean(0)
        for i in np.where(dm & ~clean)[0]:
            ok = ~bad[i] & (shape > 0.01)
            if ok.sum() >= 2 and S[i, ok].sum() > 0:
                out[i, bad[i]] = np.maximum(S[i, bad[i]], S[i, ok].sum() / shape[ok].sum() * shape[bad[i]])
    return out


def wind_pot(W, P):
    """each run of negative hours bridged by a straight line between the hours around it"""
    w, p = W.ravel(), P.ravel()
    out, bad, n, i = w.copy(), p < 0, len(w), 0
    while i < n:
        if not bad[i]:
            i += 1
            continue
        j = i
        while j < n and bad[j]:
            j += 1
        # the hour on each side is already ramping down (parks stop ahead of and after the block): bridge from one
        # hour further out (closes most of the gap with RTE's estimate: 2025 wind 1.10 TWh against 1.3)
        lo, hi = max(0, i - 1), min(n, j + 1)
        a = w[lo - 1] if lo > 0 else w[hi] if hi < n else w[i]
        b = w[hi] if hi < n else a
        out[lo:hi] = np.maximum(w[lo:hi], a + (b - a) * np.arange(1, hi - lo + 1) / (hi - lo + 1))
        i = j
    return out.reshape(W.shape)


def behaviour(H):
    res = {}
    for Y in range(2020, date.today().year + 1):
        fn = os.path.join(ROOT, 'data', 'history', 'fr_hourly', f'{Y}.json')
        if not os.path.exists(fn):
            continue
        days = json.load(open(fn))['days']
        ds = [d for d in sorted(days) if all((d, h) in H for h in range(24)) and len(days[d].get('p') or []) == 24
              and None not in days[d]['p'] and len(days[d].get('s') or []) == 24 and None not in days[d]['s']]
        if len(ds) < 60:
            continue
        P = np.array([days[d]['p'] for d in ds], float)
        Sn = np.array([days[d]['s'] for d in ds], float)
        W = np.array([[H[(d, h)][0] for h in range(24)] for d in ds])
        SL = np.array([[H[(d, h)][1] for h in range(24)] for d in ds])
        SS = np.maximum(Sn - SL, 0)
        month = np.array([int(d[5:7]) for d in ds])
        neg = P < 0
        e = {'days': len(ds), 'negHours': int(neg.sum())}
        for k, X, pot in (('wind', W, wind_pot(W, P)), ('solarLarge', SL, solar_pot(SL, P, month)), ('solarSmall', SS, solar_pot(SS, P, month))):
            pn = pot[neg].sum()
            e[k] = {'kept': round(float(X[neg].sum() / pn), 3) if pn > 0 else None,
                    'lostTWh': round(float((pot - X).sum()) / 1e6, 3),   # wind: the bridged hours around the blocks included
                    'potNegTWh': round(float(pn) / 1e6, 3), 'potTWh': round(float(pot.sum()) / 1e6, 2)}
        res[Y] = e
    return res


def project(fl, beh):
    """wind: κ = s + α (1 − s); α measured, carried as the mean of the last three measured years"""
    yrs, al = fl['wind']['years'], {}
    for Y, e in beh.items():
        k, s = e['wind']['kept'], yrs[Y]['oa'] / yrs[Y]['tot']
        if k is not None and e['days'] > 200 and s < 1:
            al[Y] = (k - s) / (1 - s)
    if not al:
        return {}
    last = sorted(al)[-3:]
    a = sum(al[y] for y in last) / len(last)
    out = {'alpha': {y: round(v, 3) for y, v in al.items()}, 'alphaUsed': round(a, 3), 'alphaYears': last, 'years': {}}
    for Y, e in yrs.items():
        s = e['oa'] / e['tot']
        s_full = max(0.0, e['oa'] - e['oaStop']) / e['tot']
        s_prop = max(0.0, e['oa'] - e['oaStopProp']) / e['tot']
        out['years'][Y] = {'rigid': round(s, 3), 'kept': round(s + a * (1 - s), 3),
                           'keptRules': round(s_full + a * (1 - s_full), 3), 'keptProposed': round(s_prop + a * (1 - s_prop), 3)}
    return out


def main():
    rules = json.load(open(RULES))['rules']
    fl = fleet(register(), rules)
    beh = behaviour(cr_hourly())
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'source': f'ODRÉ — {REG}; ODRÉ — {CRP}; RTE éCO2mix and EPEX day-ahead (data/history/fr_hourly)',
           'rules': rules, 'fleet': fl, 'behaviour': beh, 'wind': project(fl, beh)}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    for Y in sorted(beh):
        b = beh[Y]
        print(Y, b['negHours'], 'h <0 | kept: wind', b['wind']['kept'], 'large solar', b['solarLarge']['kept'], 'small solar', b['solarSmall']['kept'],
              '| lost TWh', b['wind']['lostTWh'], b['solarLarge']['lostTWh'], b['solarSmall']['lostTWh'])
    w = out['wind']
    print('alpha', w.get('alpha'), 'used', w.get('alphaUsed'))
    for Y in range(2024, 2031):
        f = fl['wind']['years'][Y]
        print(Y, 'wind OA', f['oa'], 'GW, exits', f['exits'], '| kept', w['years'][Y])


if __name__ == '__main__':
    main()
