#!/usr/bin/env python3
"""Historical replay of the PPA pricer's four methods (France, national solar and wind).

For each delivery year Y, each method is run as it could have been at the start
of Y: history = the complete years before Y (2022 left out), installed capacity
of Y extrapolated from the two previous years. It predicts the capture rate of
Y (capture price ÷ baseload, all hours); the error against the realised capture
rate measures the method, independently of the forward level.

  PPA Dashboard     1 − P74 of the past discounts
  Step by step      capture rate vs ln(capacity), fitted on the past years,
                    anchored on the last one
  Asset-specific    FPC profile cost of the expected profile + cannibalisation
  FPC               (historical − decorrelated) projected with capacity
  MC weather        simulated weather (model calibrated on the past years) on
                    the capacity of Y, prices from the net residual load curve
                    of the last two past years

Writes data/history/ppa_backtest.json.
    python scripts/ppa_backtest.py [--sims 40]
"""
import json
import math
import os
import random
import sys
from datetime import date

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import prod_model as PM   # noqa: E402

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_backtest.json')
YEARS = list(range(2016, date.today().year))
TARGETS = [y for y in YEARS if y >= 2019]


def load():
    rows = []
    for y in YEARS:
        D = json.load(open(os.path.join(ROOT, 'data', 'history', 'fr_hourly', f'{y}.json')))['days']
        for d, v in sorted(D.items()):
            if not all(v.get(k) for k in 'plswn'):
                continue
            nav = max(x for x in v['n'] if x is not None)
            wd = date.fromisoformat(d).weekday()
            t = 0 if wd < 5 else (1 if wd == 5 else 2)
            for h in range(24):
                if None in (v['p'][h], v['l'][h], v['s'][h], v['w'][h]):
                    continue
                rows.append((y, int(d[5:7]), t, h, v['p'][h], v['l'][h], v['s'][h], v['w'][h], nav, date.fromisoformat(d).toordinal()))
    return np.array(rows, float)


A = load()
yr, mo, ty, hr, P, L, S, W, NAV, DAY = A.T
cap = json.load(open(os.path.join(ROOT, 'data', 'history', 'capacity.json')))['countries']['FR']
CAP = {'s': {y: cap['types']['Solar AC'][i] for i, y in enumerate(cap['years'])},
       'w': {y: (cap['types']['Wind onshore'][i] or 0) + (cap['types']['Wind offshore'][i] or 0) for i, y in enumerate(cap['years'])}}
key = yr * 100 + mo
mavg = np.zeros_like(P)
for k in np.unique(key):
    i = key == k
    mavg[i] = P[i].mean()


def rate(i, V, Pr):
    return float((V[i] * Pr[i]).sum() / V[i].sum() / Pr[i].mean())


def cap_guess(t, Y, last):
    c = CAP[t]
    return c[last] + (c[last] - c[last - 1]) * (Y - last)


def shape_coef(train):
    co = {}
    idx = np.isin(yr, train)
    for m in range(1, 13):
        for d in range(3):
            for h in range(24):
                i = idx & (mo == m) & (ty == d) & (hr == h)
                co[(m, d, h)] = float((P[i] / mavg[i]).mean()) if i.any() else 1.0
    mc = {}
    for m in range(1, 13):
        v = []
        for y in train:
            i = (yr == y) & (mo == m)
            if i.any():
                v.append(P[i].mean() / P[yr == y].mean())
        mc[m] = float(np.mean(v)) if v else 1.0
    return co, mc


def decorrelated(y, co):
    i = yr == y
    c = np.array([co[(int(m), int(d), int(h))] for m, d, h in zip(mo[i], ty[i], hr[i])])
    pt = np.zeros(i.sum())
    ks = key[i]
    for k in np.unique(ks):
        j = ks == k
        pt[j] = c[j] / c[j].mean() * mavg[i][j]
    return pt


def logfit(xs, ys):
    xs, ys = np.log(np.array(xs)), np.array(ys)
    b = np.polyfit(xs, ys, 1)
    return b[0]


def m_dashboard(t, Y, train, V):
    sd = [1 - rate(yr == y, V, P) for y in train]
    return 1 - float(np.percentile(sd, 74))


def m_step(t, Y, train, V):
    r = [rate(yr == y, V, P) for y in train]
    last = train[-1]
    b = logfit([CAP[t][y] for y in train], r) if len(train) >= 2 else 0
    return r[-1] + b * (math.log(cap_guess(t, Y, last)) - math.log(CAP[t][last]))


def m_fpc(t, Y, train, V):
    co, mc = shape_coef(train)
    # (2) expected profile (average load factor by month × hour) on the skeleton of Y
    days = [date.fromordinal(o) for o in range(date(Y, 1, 1).toordinal(), date(Y + 1, 1, 1).toordinal())]
    prof = {}
    for m in range(1, 13):
        for h in range(24):
            i = np.isin(yr, train) & (mo == m) & (hr == h)
            lf = V[i] / np.array([CAP[t][int(y)] for y in yr[i]])
            prof[(m, h)] = lf.mean() if i.any() else 0
    sk, pv = [], []
    for d in days:
        wd = d.weekday(); dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
        for h in range(24):
            sk.append(mc[d.month] * co[(d.month, dt_, h)]); pv.append(prof[(d.month, h)])
    sk, pv = np.array(sk), np.array(pv)
    f = (pv * sk).sum() / pv.sum() / sk.mean() - 1
    # (1) − (3) on the past years, projected with capacity
    cs = []
    for y in train:
        i = yr == y
        pt = decorrelated(y, co)
        cs.append(rate(i, V, P) - (V[i] * pt).sum() / V[i].sum() / pt.mean())
    last = train[-1]
    b = logfit([CAP[t][y] for y in train], cs) if len(train) >= 3 else 0
    c = cs[-1] + b * (math.log(cap_guess(t, Y, last)) - math.log(CAP[t][last]))
    return 1 + f + c


def m_weather(t, Y, train, V, n_sims):
    recent = train[-2:]
    # price curve: ratio to the month average vs net residual load (GW), by season × time of day
    grp = ((mo >= 4) & (mo <= 9)).astype(int) * 3 + np.select([hr < 9, hr < 17], [0, 1], 2)
    net = np.round((L - S - W - NAV) / 1000).astype(int)
    tab = {}
    tr = np.isin(yr, recent)
    for g in range(6):
        for b in np.unique(net[tr & (grp == g)]):
            i = tr & (grp == g) & (net == b)
            if i.sum() >= 20:
                tab[(g, int(b))] = float((P[i] / mavg[i]).mean())

    def look(g, b):
        k = 0
        while (g, b) not in tab and k < 150:
            b += -1 if b > 0 else 1
            k += 1
        return tab.get((g, b), 1.0)
    model, days = PM.calibrate(train)
    sims = PM.simulate(model, days, n_sims, seed=Y, year=Y)
    last = train[-1]
    cs, cw = cap_guess('s', Y, last) * 1000, cap_guess('w', Y, last) * 1000
    # demand days of the last past year, by month and day type
    i_last = yr == last
    dem = {}
    for o_ in np.unique(DAY[i_last]):
        j = i_last & (DAY == o_)
        if j.sum() != 24:
            continue
        d = date.fromordinal(int(o_)); wd = d.weekday(); dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
        dem.setdefault((d.month, dt_), []).append((L[j], NAV[j][0]))
    R = random.Random(Y)
    rates = []
    for sim in sims:
        num = den = ps = pn = 0.0
        d0 = date(Y, 1, 1)
        for k, (m, fs, fw, hs, hw) in enumerate(sim):
            d = date.fromordinal(d0.toordinal() + k); wd = d.weekday(); dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
            Ld, nav = R.choice(dem.get((m, dt_)) or dem[(m, 0)])
            for h in range(24):
                s_, w_ = hs[h] * cs, hw[h] * cw
                g = (1 if 4 <= m <= 9 else 0) * 3 + (0 if h < 9 else 1 if h < 17 else 2)
                pr = look(g, int(round((Ld[h] - s_ - w_ - nav) / 1000)))
                v = hs[h] if t == 's' else hw[h]
                num += v * pr; den += v; ps += pr; pn += 1
        rates.append(num / den / (ps / pn))
    return float(np.mean(rates)), float(np.percentile(rates, 10)), float(np.percentile(rates, 90))


# ── cross-country: the slope of cannibalisation learnt on several markets ──
# penetration = installed GW ÷ GW of average load, so that 90 GW in Germany and
# 30 GW in France are comparable; country fixed effects keep each market's own level.
CC = None


def cc_points(t, before):
    """(country, year, ln penetration, capture rate) of complete years before `before`, 2022 left out"""
    global CC
    if CC is None:
        try:
            CC = json.load(open(os.path.join(ROOT, 'data', 'history', 'country_capture.json')))['countries']
        except OSError:
            CC = {}
    pts = []
    for c, d in CC.items():
        for y, f in d['years'].items():
            y = int(y)
            gw, r, ld = f.get('solarGW' if t == 's' else 'windGW'), f.get('solarRate' if t == 's' else 'windRate'), f.get('avgLoadGW')
            if y < before and y != 2022 and f.get('complete') and gw and r and ld:
                pts.append((c, y, math.log(gw / ld), r))
    return pts


def fr_load(y):
    return float(L[yr == y].mean()) / 1000


def pooled_slope(pts):
    """within-country slope of capture rate on ln penetration"""
    by = {}
    for c, y, x, r in pts:
        by.setdefault(c, []).append((x, r))
    num = den = 0.0
    for c, v in by.items():
        if len(v) < 2:
            continue
        mx, mr = np.mean([a for a, _ in v]), np.mean([b for _, b in v])
        num += sum((a - mx) * (b - mr) for a, b in v)
        den += sum((a - mx) ** 2 for a, _ in v)
    return num / den if den else 0.0


def fr_pts(t, train, V):
    return [('FR', y, math.log(CAP[t][y] / fr_load(y)), rate(yr == y, V, P)) for y in train]


def m_multi(t, Y, train, V, others=None):
    """step by step with the slope learnt on France and its neighbours, anchored on France's last year"""
    pts = fr_pts(t, train, V) + [p for p in cc_points(t, Y) if others is None or p[0] in others]
    b = pooled_slope(pts)
    last = train[-1]
    r_last = rate(yr == last, V, P)
    x_last = math.log(CAP[t][last] / fr_load(last))
    x_y = math.log(cap_guess(t, Y, last) / fr_load(last))
    return r_last + b * (x_y - x_last)


def m_multi_level(t, Y, train, V):
    """pooled curve with a French offset averaged over the French years (less tied to the last year)"""
    pts = fr_pts(t, train, V) + cc_points(t, Y)
    b = pooled_slope(pts)
    fr = [(x, r) for c, y, x, r in pts if c == 'FR']
    a = np.mean([r - b * x for x, r in fr])
    last = train[-1]
    return a + b * math.log(cap_guess(t, Y, last) / fr_load(last))


def add_multi():
    """adds the cross-country variants to an existing replay without re-running the weather simulations"""
    out = json.load(open(OUT))
    for row in out['rows']:
        t, V = ('s', S) if row['tech'] == 'solar' else ('w', W)
        row['multi'] = m_multi(t, row['year'], row['train'], V)
        row['multiLevel'] = m_multi_level(t, row['year'], row['train'], V)
        row['multiDE'] = m_multi(t, row['year'], row['train'], V, others={'DE'})
    meths = ('dashboard', 'step', 'fpc', 'weather', 'multi', 'multiLevel', 'multiDE')
    for tech in ('solar', 'wind'):
        rs = [r for r in out['rows'] if r['tech'] == tech and r['year'] != 2022]
        out['mae'][tech] = {m: round(float(np.mean([abs(r[m] - r['actual']) for r in rs])), 4) for m in meths}
        out['mae'][tech + 'Recent'] = {m: round(float(np.mean([abs(r[m] - r['actual']) for r in rs if r['year'] >= 2023])), 4) for m in meths}
        out['mae'][tech + 'Bias'] = {m: round(float(np.mean([r[m] - r['actual'] for r in rs])), 4) for m in meths}
        for r in [r for r in out['rows'] if r['tech'] == tech]:
            print(tech, r['year'], 'actual %.3f' % r['actual'], ' '.join('%s %.3f' % (m, r[m]) for m in meths))
    print(json.dumps({k: v for k, v in out['mae'].items()}, indent=1))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))


def main():
    if '--add-multi' in sys.argv:
        return add_multi()
    n_sims = int(sys.argv[sys.argv.index('--sims') + 1]) if '--sims' in sys.argv else 40
    out = {'updated': date.today().isoformat(), 'convention': 'all hours', 'targets': TARGETS, 'rows': []}
    for t, V in (('s', S), ('w', W)):
        for Y in TARGETS:
            train = [y for y in YEARS if y < Y and y != 2022]
            if len(train) < 3:
                continue
            real = rate(yr == Y, V, P)
            row = {'tech': 'solar' if t == 's' else 'wind', 'year': Y, 'actual': real, 'train': train,
                   'dashboard': m_dashboard(t, Y, train, V), 'step': m_step(t, Y, train, V), 'fpc': m_fpc(t, Y, train, V)}
            mw, lo, hi = m_weather(t, Y, train, V, n_sims)
            row.update({'weather': mw, 'weatherP10': lo, 'weatherP90': hi})
            out['rows'].append(row)
            print(f"{row['tech']:5s} {Y}: actual {real:.3f} | dashboard {row['dashboard']:.3f} step {row['step']:.3f} fpc {row['fpc']:.3f} weather {mw:.3f} [{lo:.3f}–{hi:.3f}]", flush=True)
    # mean absolute error by method and technology
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        rs = [r for r in out['rows'] if r['tech'] == tech]
        out['mae'][tech] = {m: round(float(np.mean([abs(r[m] - r['actual']) for r in rs])), 4) for m in ('dashboard', 'step', 'fpc', 'weather')}
        out['mae'][tech + 'Recent'] = {m: round(float(np.mean([abs(r[m] - r['actual']) for r in rs if r['year'] >= 2023])), 4) for m in ('dashboard', 'step', 'fpc', 'weather')}
    print(json.dumps(out['mae'], indent=1))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
