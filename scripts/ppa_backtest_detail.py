#!/usr/bin/env python3
"""Detailed replay of the PPA pricer's four methods (France, national solar and wind).

Same set-up as scripts/ppa_backtest.py (each delivery year Y priced with the complete
years before it, 2022 left out, capacity of Y extrapolated), with more detail:
  · month by month: each method's capture rate per month of Y against the realised one
    (PPA Dashboard and Step by step only give a yearly figure: the same value every month);
  · hour of the day: the price shape each method expects (FPC skeleton, weather simulation)
    against the realised one, by season;
  · market conditions: errors grouped by season, negative-price hours and nuclear output;
  · error distribution per method and year: mean, standard deviation, min, max;
  · two conventions for the hours at prices ≤ 0:
      all  — every hour counts, a negative price is a negative revenue
      curt — curtailment: output at prices ≤ 0 is not produced and not paid;
             capture over the paid hours, baseload over all hours (as the Cal settles)

Writes data/history/ppa_backtest_detail.json
    python scripts/ppa_backtest_detail.py [--sims 40]
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
_argv, sys.argv = sys.argv, ['ppa_backtest.py']
import ppa_backtest as B   # noqa: E402  (loads the hourly arrays)
import prod_model as PM    # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_backtest_detail.json')
yr, mo, ty, hr, P, L, S, W, NAV, DAY = B.yr, B.mo, B.ty, B.hr, B.P, B.L, B.S, B.W, B.NAV, B.DAY
CONVS = ('all', 'curt')
METHODS = ('dashboard', 'step', 'fpc', 'weather')


def rate(i, V, Pr, conv):
    """capture rate of the hours i: all hours, or curtailment (paid hours over all-hours baseload)"""
    if conv == 'all':
        return float((V[i] * Pr[i]).sum() / V[i].sum() / Pr[i].mean())
    j = i & (Pr > 0)
    return float((V[j] * Pr[j]).sum() / V[j].sum() / Pr[i].mean())


def paid_share(i, V):
    return float(V[i & (P > 0)].sum() / V[i].sum())


def m_dashboard(t, Y, train, V, conv):
    return 1 - float(np.percentile([1 - rate(yr == y, V, P, conv) for y in train], 74))


def m_step(t, Y, train, V, conv):
    r = [rate(yr == y, V, P, conv) for y in train]
    last = train[-1]
    b = B.logfit([B.CAP[t][y] for y in train], r)
    return r[-1] + b * (math.log(B.cap_guess(t, Y, last)) - math.log(B.CAP[t][last]))


FPC_DRIVER = 's'                    # the fleet whose growth drives the cannibalisation term
FPC_HALF = {'s': 1, 'w': None}      # solar: skeleton weights halve every year back; wind: plain average
SUMMER = set(range(4, 10))


def shape_coef_w(train, weights):
    """B.shape_coef with year weights"""
    co, mc = {}, {}
    rel = P / B.mavg
    for m in range(1, 13):
        for d in range(3):
            for h in range(24):
                num = den = 0.0
                for y in train:
                    i = (yr == y) & (mo == m) & (ty == d) & (hr == h)
                    if i.any():
                        num += weights[y] * rel[i].mean(); den += weights[y]
                co[(m, d, h)] = num / den if den else 1.0
        num = den = 0.0
        for y in train:
            i = (yr == y) & (mo == m)
            if i.any():
                num += weights[y] * P[i].mean() / P[yr == y].mean(); den += weights[y]
        mc[m] = num / den if den else 1.0
    return co, mc


def m_fpc(t, Y, train, V, conv):
    """yearly and monthly: expected profile on the FPC skeleton + cannibalisation (1) − (3) projected per season
    (summer April–September, winter October–March); solar's skeleton leans towards the recent years
    (walk-forward, scripts/ppa_fpc_variants.py: solar 7.64 → 5.84 €/MWh, wind 6.23 → 4.94 on 2024–2026)"""
    half = FPC_HALF[t]
    co, mc = shape_coef_w(train, {y: 0.5 ** ((train[-1] - y) / half) if half else 1.0 for y in train})
    days = [date.fromordinal(o) for o in range(date(Y, 1, 1).toordinal(), date(Y + 1, 1, 1).toordinal())]
    prof = {}
    for m in range(1, 13):
        for h in range(24):
            i = np.isin(yr, train) & (mo == m) & (hr == h)
            lf = V[i] / np.array([B.CAP[t][int(y)] for y in yr[i]])
            prof[(m, h)] = lf.mean() if i.any() else 0
    sk, pv, mm, hh = [], [], [], []
    for d in days:
        wd = d.weekday()
        dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
        for h in range(24):
            sk.append(mc[d.month] * co[(d.month, dt_, h)]); pv.append(prof[(d.month, h)]); mm.append(d.month); hh.append(h)
    sk, pv, mm, hh = np.array(sk), np.array(pv), np.array(mm), np.array(hh)
    f = (pv * sk).sum() / pv.sum() / sk.mean() - 1
    fm = {m: (pv[mm == m] * sk[mm == m]).sum() / pv[mm == m].sum() / sk[mm == m].mean() - 1 for m in range(1, 13)}
    last = train[-1]
    fulls = {}
    for y in train:
        i = yr == y
        full = np.zeros_like(P)
        full[i] = B.decorrelated(y, co)
        fulls[y] = full
    cterm = {}
    for months in (SUMMER, set(range(1, 13)) - SUMMER):
        cs = []
        for y in train:
            k = (yr == y) & np.isin(mo, list(months))
            cs.append(rate(k, V, P, conv) - rate(k, V, fulls[y], conv))
        # driven by the solar fleet, for wind too (scripts/ppa_fpc_driver_test.py: wind curt 1.64 → 1.31 €/MWh, complete years)
        b = B.logfit([B.CAP[FPC_DRIVER][y] for y in train], cs) if len(train) >= 3 else 0
        for m in months:
            cterm[m] = cs[-1] + b * (math.log(B.cap_guess(FPC_DRIVER, Y, last)) - math.log(B.CAP[FPC_DRIVER][last]))
    # the year's term: each season's, weighted by the output's value on the skeleton in that season
    wv = {m: (pv[mm == m] * sk[mm == m]).sum() for m in range(1, 13)}
    c = sum(wv[m] * cterm[m] for m in wv) / sum(wv.values())
    # expected price shape by season × hour (skeleton, % of the season's average)
    shape = {}
    for sname, ms in (('summer', range(4, 10)), ('winter', [10, 11, 12, 1, 2, 3])):
        k = np.isin(mm, list(ms))
        shape[sname] = [float(sk[k & (hh == h)].mean() / sk[k].mean()) for h in range(24)]
    return 1 + f + c, {m: 1 + fm[m] + cterm[m] for m in range(1, 13)}, shape


WX_NOISE = {'s': True, 'w': False}    # solar: each hour's price scattered by a residual of the recent years
WX_DEMAND2 = {'s': False, 'w': True}   # wind: consumption and nuclear drawn from the last two complete years
# the hour's price is floored at zero: since 2025 most plants stop at negative prices, so the price settles at about zero
# instead of diving (Jan.–Oct. 2026: 74 % of the hours ≤ 0 € between −1 € and 0); scripts/ppa_floor_test.py, error over
# 1–3 years in the all-hours convention: solar 9.02 → 8.13, wind 3.85 → 3.83 (the curtailed one does not change)
WX_FLOOR = True
# (scripts/ppa_wx_align_test.py, mean error over 1–3 years, curt: solar 3.82 → 2.44 with the noise, wind 2.95 → 2.70
#  with the two-year demand; the other choice made each worse); js/ppa-wx.js applies the same rule


def m_weather(t, Y, train, V, n_sims):
    """yearly and monthly capture rates for both conventions, from the same simulated years"""
    recent = train[-2:]
    grp = ((mo >= 4) & (mo <= 9)).astype(int) * 3 + np.select([hr < 9, hr < 17], [0, 1], 2)
    net = np.round((L - S - W - NAV) / 1000).astype(int)
    tab = {}
    tr = np.isin(yr, recent)
    for g in range(6):
        for b in np.unique(net[tr & (grp == g)]):
            i = tr & (grp == g) & (net == b)
            if i.sum() >= 20:
                tab[(g, int(b))] = float((P[i] / B.mavg[i]).mean())

    res = {}
    if WX_NOISE[t]:
        for g in range(6):
            i = tr & (grp == g)
            for v, bb in zip(P[i] / B.mavg[i], net[i]):
                f = tab.get((g, int(bb)))
                if f is not None and f > 0.05:
                    res.setdefault(g, []).append(float(v / f))

    def look(g, b):
        k = 0
        while (g, b) not in tab and k < 150:
            b += -1 if b > 0 else 1
            k += 1
        return tab.get((g, b), 1.0)
    model, days = PM.calibrate(train)
    sims = PM.simulate(model, days, n_sims, seed=Y, year=Y)
    last = train[-1]
    cs, cw = B.cap_guess('s', Y, last) * 1000, B.cap_guess('w', Y, last) * 1000
    i_last = np.isin(yr, train[-2:]) if WX_DEMAND2[t] else yr == last
    dem = {}
    for o_ in np.unique(DAY[i_last]):
        j = i_last & (DAY == o_)
        if j.sum() != 24:
            continue
        d = date.fromordinal(int(o_))
        wd = d.weekday()
        dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
        dem.setdefault((d.month, dt_), []).append((L[j], NAV[j][0]))
    R = random.Random(Y)
    yearly = {c: [] for c in CONVS}
    monthly = {c: {m: [] for m in range(1, 13)} for c in CONVS}
    shp = {'summer': np.zeros(24), 'winter': np.zeros(24)}
    shn = {'summer': 0, 'winter': 0}
    for sim in sims:
        acc = np.zeros((13, 5))     # per month: Σv·pr, Σv, Σpr, n, Σv·pr (pr > 0) ; index 0 = year
        accp = np.zeros(13)         # Σv (pr > 0)
        d0 = date(Y, 1, 1)
        for k, (m, fs, fw, hs, hw) in enumerate(sim):
            d = date.fromordinal(d0.toordinal() + k)
            wd = d.weekday()
            dt_ = 0 if wd < 5 else (1 if wd == 5 else 2)
            Ld, nav = R.choice(dem.get((m, dt_)) or dem[(m, 0)])
            sname = 'summer' if 4 <= m <= 9 else 'winter'
            prs = []
            for h in range(24):
                s_, w_ = hs[h] * cs, hw[h] * cw
                g = (1 if 4 <= m <= 9 else 0) * 3 + (0 if h < 9 else 1 if h < 17 else 2)
                pr = look(g, int(round((Ld[h] - s_ - w_ - nav) / 1000)))
                if res.get(g):
                    pr *= res[g][R.randrange(len(res[g]))]
                if WX_FLOOR:
                    pr = max(pr, 0.0)  # negative hours settle at about zero
                prs.append(pr)
                v = hs[h] if t == 's' else hw[h]
                for ix in (0, m):
                    acc[ix] += (v * pr, v, pr, 1, v * pr if pr > 0 else 0)
                    accp[ix] += v if pr > 0 else 0
            shp[sname] += np.array(prs)
            shn[sname] += 1
        for ix in range(13):
            num, den, ps, pn, nump = acc[ix]
            if den <= 0 or pn <= 0:
                continue
            ra, rc = num / den / (ps / pn), (nump / accp[ix] / (ps / pn)) if accp[ix] > 0 else None
            if ix == 0:
                yearly['all'].append(ra); yearly['curt'].append(rc)
            else:
                monthly['all'][ix].append(ra)
                if rc is not None:
                    monthly['curt'][ix].append(rc)
    shape = {k: list(shp[k] / shn[k] / (shp[k] / shn[k]).mean()) for k in shp if shn[k]}
    return ({c: float(np.mean(yearly[c])) for c in CONVS},
            {c: {m: float(np.mean(v)) for m, v in monthly[c].items() if v} for c in CONVS}, shape)


def stats(v):
    v = np.array(v, float)
    return {'mean': round(float(v.mean()), 4), 'std': round(float(v.std(ddof=1)), 4) if len(v) > 1 else None,
            'min': round(float(v.min()), 4), 'max': round(float(v.max()), 4), 'mae': round(float(np.abs(v).mean()), 4), 'n': int(len(v))}


def main():
    n_sims = int(sys.argv[sys.argv.index('--sims') + 1]) if '--sims' in sys.argv else 40
    targets = [y for y in B.TARGETS if y != 2022]
    out = {'updated': date.today().isoformat(), 'targets': targets, 'methods': list(METHODS), 'convs': list(CONVS),
           'note': 'error = predicted − actual capture rate (fraction of baseload); positive = too optimistic', 'rows': []}
    for t, V, tech in (('s', S, 'solar'), ('w', W, 'wind')):
        for Y in targets:
            train = [y for y in B.YEARS if y < Y and y != 2022]
            iY = yr == Y
            wy, wm, wsh = m_weather(t, Y, train, V, n_sims)
            for conv in CONVS:
                act = rate(iY, V, P, conv)
                actm = {m: rate(iY & (mo == m), V, P, conv) for m in range(1, 13)}
                fy, fm, fsh = m_fpc(t, Y, train, V, conv)
                pred = {'dashboard': m_dashboard(t, Y, train, V, conv), 'step': m_step(t, Y, train, V, conv), 'fpc': fy, 'weather': wy[conv]}
                predm = {'dashboard': {m: pred['dashboard'] for m in range(1, 13)}, 'step': {m: pred['step'] for m in range(1, 13)}, 'fpc': fm, 'weather': wm[conv]}
                months = []
                for m in range(1, 13):
                    i = iY & (mo == m)
                    months.append({'m': m, 'actual': actm[m], 'pred': {k: predm[k].get(m) for k in METHODS},
                                   'negH': int((P[i] <= 0).sum()), 'nuclearGW': round(float(NAV[i].mean()) / 1000, 1),
                                   'base': round(float(P[i].mean()), 1), 'paid': round(paid_share(i, V), 4)})
                # realised price shape by season × hour (% of the season's average)
                rshape = {}
                for sname, ms in (('summer', range(4, 10)), ('winter', [10, 11, 12, 1, 2, 3])):
                    k = iY & np.isin(mo, list(ms))
                    rshape[sname] = [float(P[k & (hr == h)].mean() / P[k].mean()) for h in range(24)]
                out['rows'].append({'tech': tech, 'year': Y, 'conv': conv, 'actual': act, 'paid': round(paid_share(iY, V), 4), 'pred': pred, 'months': months,
                                    'shape': {'actual': rshape, 'fpc': fsh, 'weather': wsh}})
                print(tech, Y, conv, 'actual %.3f' % act, ' '.join('%s %.3f' % (k, pred[k]) for k in METHODS), flush=True)
    # summaries: yearly error distribution, monthly errors per year, by condition, by calendar month
    summ = {}
    for tech in ('solar', 'wind'):
        for conv in CONVS:
            rs = [r for r in out['rows'] if r['tech'] == tech and r['conv'] == conv]
            s = summ.setdefault(tech, {}).setdefault(conv, {})
            s['yearly'] = {k: stats([r['pred'][k] - r['actual'] for r in rs]) for k in METHODS}
            s['monthlyByYear'] = {k: {r['year']: stats([mm['pred'][k] - mm['actual'] for mm in r['months'] if mm['pred'][k] is not None]) for r in rs} for k in METHODS}
            allm = [(r['year'], mm) for r in rs for mm in r['months']]
            s['monthlyAll'] = {k: stats([mm['pred'][k] - mm['actual'] for _, mm in allm if mm['pred'][k] is not None]) for k in METHODS}
            s['byMonth'] = {k: {m: stats([mm['pred'][k] - mm['actual'] for _, mm in allm if mm['m'] == m and mm['pred'][k] is not None])['mean'] for m in range(1, 13)} for k in METHODS}
            # conditions: terciles of negative hours and of nuclear output over the replay months
            for cond, key in (('negH', 'negH'), ('nuclear', 'nuclearGW')):
                vals = sorted(mm[key] for _, mm in allm)
                q1, q2 = vals[len(vals) // 3], vals[2 * len(vals) // 3]
                grp = {'low': [], 'mid': [], 'high': []}
                for _, mm in allm:
                    grp['low' if mm[key] < q1 else 'mid' if mm[key] < q2 else 'high'].append(mm)
                s[cond] = {'cuts': [q1, q2], **{g: {k: stats([mm['pred'][k] - mm['actual'] for mm in v if mm['pred'][k] is not None])['mae'] for k in METHODS} for g, v in grp.items()}}
            s['season'] = {sn: {k: stats([mm['pred'][k] - mm['actual'] for _, mm in allm if (4 <= mm['m'] <= 9) == (sn == 'summer') and mm['pred'][k] is not None])['mae'] for k in METHODS} for sn in ('summer', 'winter')}
            # hour-of-day shape error (FPC skeleton and weather simulation), mean |expected − realised| per hour
            s['shapeErr'] = {k: {sn: [round(float(np.mean([abs(r['shape'][k][sn][h] - r['shape']['actual'][sn][h]) for r in rs])), 3) for h in range(24)] for sn in ('summer', 'winter')} for k in ('fpc', 'weather')}
    out['summary'] = summ
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(json.dumps({t: {c: {'yearly': v['yearly'], 'monthlyAll': v['monthlyAll'], 'season': v['season'], 'negH': v['negH'], 'nuclear': v['nuclear']} for c, v in d.items()} for t, d in summ.items()}, indent=1))


if __name__ == '__main__':
    main()
