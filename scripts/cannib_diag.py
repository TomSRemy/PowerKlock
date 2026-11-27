#!/usr/bin/env python3
"""Cannibalisation diagnostic: why the projected capture rate of French solar and wind stays imprecise, and what
improves it. Everything is replayed walk-forward (a delivery year is priced with the years before it only).

1. Target split. The yearly capture rate is the product of two things that move for different reasons:
       capture = season × intra
       season  = Σ output_m × baseload_m ÷ (Σ output_m × baseload_year)   the months' price shape (gas, nuclear, winter)
       intra   = Σ value_m ÷ Σ output_m × baseload_m                       the value lost inside the months: cannibalisation
2. Penetration metrics compared on the same target: installed GW (log), GW ÷ load, output share, midday share of the
   load, of the load net of nuclear ('residual demand'), and the same over the coupled region (FR + DE + ES + BE).
3. Projection models, walk-forward, 1 to 3 years ahead:
       B0  today's capacity trend: capture = a + b·ln(GW France), anchored on the last year (2022 left out)
       S1  the same on the intra term, × the average season term
       S2  intra on France's own midday share of residual demand (solar ÷ load net of nuclear, 11:00-15:00), × the average
           season term; the share of the delivery year = midday output per GW (last three years) × its fleet
       S2w the same, slope learnt on the last 4 years only
       S3  intra on the region's midday share of residual demand, France alone, last 4 years
       P1  the same, panel of FR, DE, ES, BE with country effects, last 4 years
       P2  P1 + the country's own share minus the region's
       P3  panel, every year, hinge (no effect under a threshold chosen on the training years)
       S4  intra on the share of France's solar output produced in 'surplus hours' (hours when solar + wind + nuclear
           of the region cover more than θ of its load; θ chosen on the training years), projected by replaying the
           last three weather years hour by hour with the fleets of the delivery year (no price model)
       S5  the mean of S2 and S4
4. Error ladder (France): what the error becomes when the forecast is given, one after the other, the real fleet,
   the real season term, the regional metric, the real regional share (weather, demand, nuclear, neighbours' fleets).
5. Drivers of what is left, month by month (France): nuclear, gas, baseload level, pumping, exports, wind, load,
   sunshine, neighbours' solar, share of output at negative prices; judged by leaving one year out.

Reads files of the repository only (scripts/cannib_diag_data.py). Writes data/history/cannib_diag.json
    python scripts/cannib_diag.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import cannib_diag_data as D   # noqa: E402

OUT = os.path.join(D.H, 'cannib_diag.json')
REGION = ('FR', 'DE', 'ES', 'BE')            # the Netherlands' solar is mostly behind the meter: left out, as in the pricer
TARGETS = (2021, 2023, 2024, 2025, 2026)     # 2022 (gas crisis) is not a target, as in the test bench
HORIZONS = (1, 2, 3)
WINDOW = 4
FIRST = 2016

P = D.load_panel()
M = {c: D.monthly(P, c) for c in D.COUNTRIES}
CAP = D.capacities()
FLEX = json.load(open(os.path.join(D.H, 'flex_share.json')))
THIS = max(y for y, _ in M['FR'])


def _phys():
    """monthly physical sums without needing a price (neighbours' prices start in 2020, their output in 2016)"""
    out = {}
    for c in REGION:
        acc = {}
        for d, v in P[c].items():
            if not all(v.get(k) and len(v[k]) == 24 and None not in v[k] for k in 'swl'):
                continue
            n = v['n'] if v.get('n') and None not in v['n'] else [0] * 24
            a = acc.setdefault((int(d[:4]), int(d[5:7])), np.zeros(8))
            a += [sum(v['s'][D.MID]) / 4, sum(v['l'][D.MID]) / 4, sum(n[D.MID]) / 4, sum(v['w'][D.MID]) / 4,
                  sum(v['s']) / 24, sum(v['l']) / 24, sum(v['w']) / 24, sum(n) / 24]
        out[c] = acc
    return out


PH = _phys()


def _hourly():
    """{year: {'m': month of each day, country: {'s','w','n','l': days × 24}}} on the days complete for the four countries"""
    out = {}
    ok = lambda v: all(v.get(k) and len(v[k]) == 24 and None not in v[k] for k in 'swl')
    for d, v in sorted(P['FR'].items()):
        if not ok(v) or not all(d in P[c] and ok(P[c][d]) for c in REGION[1:]):
            continue
        a = out.setdefault(int(d[:4]), {'m': [], **{c: {k: [] for k in 'swln'} for c in REGION}})
        a['m'].append(int(d[5:7]))
        for c in REGION:
            for k in 'swl':
                a[c][k].append(P[c][d][k])
            n = P[c][d].get('n')
            a[c]['n'].append(n if n and None not in n else [0] * 24)
    for a in out.values():
        a['m'] = np.array(a['m'])
        for c in REGION:
            for k in 'swln':
                a[c][k] = np.array(a[c][k], float)
    return out


HY = _hourly()
THETAS = (0.7, 0.8, 0.9)


def surplus(yw, ms, fleet=None):
    """share of France's solar output in the hours when the region's solar + wind + nuclear exceed θ of its load, on the
    weather, demand and nuclear of year yw (months ms); fleet = {country: GW} rescales each country's solar output"""
    a = HY[yw]
    k = np.isin(a['m'], ms)
    sc = {c: (fleet[c] / gw(c, 's', yw) if fleet else 1.0) for c in REGION}
    num = sum(a[c]['s'][k] * sc[c] + a[c]['w'][k] + a[c]['n'][k] for c in REGION)
    r = num / sum(a[c]['l'][k] for c in REGION)
    s = a['FR']['s'][k] * sc['FR']
    return {th: float((s * (r > th)).sum() / s.sum()) for th in THETAS}


def gw(c, t, y, mid=True):
    """installed GW of year y: mid-year (mean of two year-ends) or year-end. Years after the last known one: France from
    the national register's growth to date (flex_share.json), the others at their last yearly pace"""
    k = CAP[c][t]
    last = max(k)

    def end(yy):
        if yy in k:
            return k[yy]
        if yy > last:
            if c == 'FR':
                f = FLEX['fleet']['solar' if t == 's' else 'wind']['years']
                if str(yy) in f and str(last) in f and not f[str(yy)].get('projected'):
                    return k[last] + f[str(yy)]['tot'] - f[str(last)]['tot']
            return k[last] + (yy - last) * (k[last] - k[last - 1])
        return k[min(k)]
    return (end(y) + end(y - 1)) / 2 if mid else end(y)


def gw_extrap(c, t, N, y, mid=True):
    """the fleet of y as seen from the end of N: the last yearly pace carried on"""
    e = lambda yy: gw(c, t, yy, False) if yy <= N else gw(c, t, N, False) + (yy - N) * (gw(c, t, N, False) - gw(c, t, N - 1, False))
    return (e(y) + e(y - 1)) / 2 if mid else e(y)


def months_of(c, y):
    return [m for m in range(1, 13) if (y, m) in M[c]]


def agg(c, y, ms=None):
    """one country-year (or the same months of it): capture, season and intra terms, penetration metrics"""
    ms = [m for m in (ms or months_of(c, y)) if (y, m) in M[c]]
    if len(ms) < 6:
        return None
    r = [M[c][(y, m)] for m in ms]
    days = sum(x['days'] for x in r)
    base = sum(x['base'] * x['days'] for x in r) / days
    o = {'months': len(ms), 'base': base, 'negH': sum(x['negH'] for x in r)}
    for t in 'sw':
        e, ep = sum(x[t + 'MWh'] for x in r), sum(x['paid_' + t] for x in r)
        o['all_' + t] = sum(x['val_' + t] for x in r) / e / base
        o['curt_' + t] = sum(x['valc_' + t] for x in r) / ep / base
        o['S_all_' + t] = sum(x[t + 'MWh'] * x['base'] for x in r) / e / base
        o['S_curt_' + t] = sum(x['paid_' + t] * x['base'] for x in r) / ep / base
        o['I_all_' + t] = o['all_' + t] / o['S_all_' + t]
        o['I_curt_' + t] = o['curt_' + t] / o['S_curt_' + t]
        o['negShare_' + t] = 1 - ep / e
    o.update(metrics(c, y, ms))
    return o


def metrics(c, y, ms):
    tot = lambda cc, i: sum(PH[cc][(y, m)][i] for m in ms if (y, m) in PH[cc])
    o = {}
    if c in PH:
        o['mid'] = tot(c, 0) / tot(c, 1)
        o['res'] = tot(c, 0) / (tot(c, 1) - tot(c, 2))
        o['gen'] = tot(c, 4) / tot(c, 5)
        o['wgen'] = tot(c, 6) / tot(c, 5)
        o['wres'] = tot(c, 6) / (tot(c, 5) - tot(c, 7))
        o['capLoad'] = gw(c, 's', y) * 1000 / (tot(c, 5) / len(ms)) * 30.4   # GW per GW of average load (sums are per-day means)
    o['reg'] = sum(tot(cc, 0) for cc in REGION) / sum(tot(cc, 1) - tot(cc, 2) for cc in REGION)
    o['regw'] = sum(tot(cc, 0) for cc in REGION) / sum(tot(cc, 1) - tot(cc, 2) - tot(cc, 3) for cc in REGION)
    o['regMid'] = sum(tot(cc, 0) for cc in REGION) / sum(tot(cc, 1) for cc in REGION)
    o['regWres'] = sum(tot(cc, 6) for cc in REGION) / sum(tot(cc, 5) - tot(cc, 7) for cc in REGION)
    if y in HY:
        for th, v in surplus(y, ms).items():
            o['sur%d' % round(th * 100)] = v
    o['lnGW'] = float(np.log(gw(c, 's', y, False)))
    o['lnGWmid'] = float(np.log(gw(c, 's', y)))
    o['lnGWw'] = float(np.log(gw(c, 'w', y, False)))
    o['lnGWreg'] = float(np.log(sum(gw(cc, 's', y) for cc in REGION)))
    return o


def complete(c, y):
    return y < THIS and len(months_of(c, y)) == 12


A = {c: {y: agg(c, y) for y in range(FIRST, THIS + 1) if agg(c, y)} for c in REGION}


def proj_reg(N, y, true_cap, ms, which='reg'):
    """the region's midday share for year y seen from N: each country's midday output per GW (mean of the last three
    years, same months) × its fleet of y, over the residual demand of the last three years"""
    yrs = [yy for yy in (N, N - 1, N - 2) if yy >= FIRST and yy != 2022] or [N]
    num = den = 0.0
    for c in REGION:
        k = np.mean([sum(PH[c][(yy, m)][0] for m in ms if (yy, m) in PH[c]) / gw(c, 's', yy) for yy in yrs])
        num += k * (gw(c, 's', y) if true_cap else gw_extrap(c, 's', N, y))
        den += np.mean([sum(PH[c][(yy, m)][1] - PH[c][(yy, m)][2] - (PH[c][(yy, m)][3] if which == 'regw' else 0) for m in ms if (yy, m) in PH[c]) for yy in yrs])
    return num / den


def proj_own(c, N, y, true_cap, ms):
    yrs = [yy for yy in (N, N - 1, N - 2) if yy >= FIRST and yy != 2022] or [N]
    k = np.mean([sum(PH[c][(yy, m)][0] for m in ms if (yy, m) in PH[c]) / gw(c, 's', yy) for yy in yrs])
    den = np.mean([sum(PH[c][(yy, m)][1] - PH[c][(yy, m)][2] for m in ms if (yy, m) in PH[c]) for yy in yrs])
    return k * (gw(c, 's', y) if true_cap else gw_extrap(c, 's', N, y)) / den


def ols(X, y):
    X = np.c_[np.ones(len(y)), np.array(X, float)]
    b, *_ = np.linalg.lstsq(X, np.array(y, float), rcond=None)
    return b


def panel_slope(rows, keys):
    """country effects + common slopes: rows = [(country, {x…}, y)]; returns the slopes"""
    cs = sorted({r[0] for r in rows})
    X = [[1.0 * (r[0] == c) for c in cs] + [r[1][k] for k in keys] for r in rows]
    b, *_ = np.linalg.lstsq(np.array(X), np.array([r[2] for r in rows]), rcond=None)
    return b[len(cs):]


def forecast(model, tech, conv, c, N, y, true_cap=True, season='mean', true_x=False):
    """capture rate of country c, year y, seen from the end of year N (months of y available to date)"""
    ms = months_of(c, y)
    tgt = agg(c, y, ms)
    if N == 2022 and model == 'B0':
        N = 2021                                   # the pricer never anchors on 2022
    anc = agg(c, N, ms)                            # the anchor year, on the same months as the target
    if not tgt or not anc:
        return None
    kI, kS, kC = f'I_{conv}_{tech}', f'S_{conv}_{tech}', f'{conv}_{tech}'
    hist = [yy for yy in sorted(A[c]) if yy <= N and complete(c, yy)]
    capT = 'w' if (tech == 'w' and model in ('B0', 'S1')) else 's'
    g = lambda yy: (gw(c, capT, yy, False) if (true_cap or yy <= N) else gw_extrap(c, capT, N, yy, False))
    if model == 'B0':
        h = [yy for yy in hist if yy != 2022]
        if len(h) < 3:
            return None
        b = ols([[np.log(gw(c, capT, yy, False))] for yy in h], [A[c][yy][kC] for yy in h])
        return anc[kC] + b[1] * (np.log(g(y)) - np.log(g(N)))
    # season term: the mean of the past years (2022 out), the realised one (oracle), or the last year's
    hs = [yy for yy in hist if yy != 2022][-5:]
    S = tgt[kS] if season == 'oracle' else float(np.mean([agg(c, yy, ms)[kS] for yy in hs])) if hs else anc[kS]
    if model == 'S1':
        if len(hist) < 3:
            return None
        b = ols([[np.log(gw(c, capT, yy, False))] for yy in hist], [A[c][yy][kI] for yy in hist])
        return (anc[kI] + b[1] * (np.log(g(y)) - np.log(g(N)))) * S
    xr = tgt['reg'] if true_x else proj_reg(N, y, true_cap, ms)
    xo = (tgt.get('res') if true_x else proj_own(c, N, y, true_cap, ms))
    wr = tgt['regWres'] if true_x else float(np.mean([agg(c, yy, ms)['regWres'] for yy in hist[-3:]]))   # wind: no trend assumed
    if model in ('S2', 'S2w'):
        hh = hist if model == 'S2' else hist[-WINDOW:]
        if len(hh) < 3:
            return None
        b = ols([[A[c][yy]['res']] for yy in hh], [A[c][yy][kI] for yy in hh])
        return (anc[kI] + b[1] * (xo - anc['res'])) * S
    if model in ('S4', 'S5'):
        if len(hist) < 3 or tech != 's':
            return None
        fit = []
        for th in THETAS:                          # θ: the best fit on the training years
            k = 'sur%d' % round(th * 100)
            b = ols([[A[c][yy][k]] for yy in hist], [A[c][yy][kI] for yy in hist])
            sse = sum((b[0] + b[1] * A[c][yy][k] - A[c][yy][kI]) ** 2 for yy in hist)
            fit.append((sse, th, k, b[1]))
        _, th, k, sl = min(fit)
        if true_x:
            xs = tgt[k]
        else:
            fleet = {cc: (gw(cc, 's', y) if true_cap else gw_extrap(cc, 's', N, y)) for cc in REGION}
            wy = [yy for yy in (N, N - 1, N - 2, N - 3) if yy in HY and yy != 2022][:3]
            xs = float(np.mean([surplus(yy, ms, fleet)[th] for yy in wy]))
        p4 = (anc[kI] + sl * (xs - anc[k])) * S
        if model == 'S4':
            return p4
        p2 = forecast('S2', tech, conv, c, N, y, true_cap, season, true_x)
        return None if p2 is None else (p4 + p2) / 2
    win = [yy for yy in range(N - WINDOW + 1, N + 1)]
    if model == 'S3':
        h = [yy for yy in win if yy in A[c] and complete(c, yy)]
        if len(h) < 3:
            return None
        b = ols([[A[c][yy]['reg']] for yy in h], [A[c][yy][kI] for yy in h])
        return (anc[kI] + b[1] * (xr - anc['reg'])) * S
    if model in ('P1', 'P2', 'P3'):
        yrs = win if model != 'P3' else list(range(FIRST, N + 1))
        rows = [(cc, A[cc][yy], A[cc][yy][kI]) for cc in REGION for yy in yrs if yy in A[cc] and complete(cc, yy)]
        if len({r[0] for r in rows}) < 2 or len(rows) < 8:
            return forecast('S3', tech, conv, c, N, y, true_cap, season, true_x)     # before the neighbours' prices: France alone
        if model == 'P1':
            keys = ['reg'] + (['regWres'] if tech == 'w' else [])
            b = panel_slope(rows, keys)
            d = b[0] * (xr - anc['reg']) + (b[1] * (wr - anc['regWres']) if tech == 'w' else 0)
            return (anc[kI] + d) * S
        if model == 'P2':
            rows2 = [(cc, dict(a, dev=a['res'] - a['reg']), v) for cc, a, v in rows]
            b = panel_slope(rows2, ['reg', 'dev'])
            return (anc[kI] + b[0] * (xr - anc['reg']) + b[1] * ((xo - xr) - (anc['res'] - anc['reg']))) * S
        best = None                                # P3: hinge, threshold chosen on the training rows
        for x0 in np.arange(0.15, 0.45, 0.025):
            r3 = [(cc, {'h': max(a['reg'] - x0, 0)}, v) for cc, a, v in rows]
            b = panel_slope(r3, ['h'])
            cs = sorted({r[0] for r in r3})
            Xm = np.array([[1.0 * (r[0] == k) for k in cs] + [r[1]['h']] for r in r3])
            full, *_ = np.linalg.lstsq(Xm, np.array([r[2] for r in r3]), rcond=None)
            sse = float(((Xm @ full - np.array([r[2] for r in r3])) ** 2).sum())
            if best is None or sse < best[0]:
                best = (sse, x0, b[0])
        _, x0, sl = best
        return (anc[kI] + sl * (max(xr - x0, 0) - max(anc['reg'] - x0, 0))) * S
    return None


MODELS = ('B0', 'S1', 'S2', 'S2w', 'S3', 'P1', 'P2', 'P3', 'S4', 'S5')


def walk(c='FR', **kw):
    """{tech: {conv: {model: {h: [{year, pred, actual, errPts, errEur}]}}}}"""
    out = {}
    for tech in 'sw':
        for conv in ('all', 'curt'):
            for mdl in MODELS:
                if (tech == 'w' and mdl in ('S2', 'S2w', 'P2', 'S4', 'S5')) or (c != 'FR' and mdl in ('S4', 'S5')):
                    continue
                for h in HORIZONS:
                    rows = []
                    for y in TARGETS:
                        tgt = agg(c, y)
                        if not tgt or (y - h) not in A[c]:
                            continue
                        p = forecast(mdl, tech, conv, c, y - h, y, **kw)
                        if p is None:
                            continue
                        a = tgt[f'{conv}_{tech}']
                        rows.append({'year': y, 'pred': round(float(p), 4), 'actual': round(a, 4), 'errPts': round(float(p - a) * 100, 2),
                                     'errEur': round(float(p - a) * tgt['base'], 2)})
                    out.setdefault(tech, {}).setdefault(conv, {}).setdefault(mdl, {})[h] = rows
    return out


def mae(rows, years=None, k='errEur'):
    v = [abs(r[k]) for r in rows if years is None or r['year'] in years]
    return round(float(np.mean(v)), 2) if v else None


def summary(W, years):
    return {t: {cv: {m: {h: {'eur': mae(r, years), 'pts': mae(r, years, 'errPts'), 'n': len([x for x in r if x['year'] in years])}
                         for h, r in hh.items()} for m, hh in mm.items()} for cv, mm in tt.items()} for t, tt in W.items()}


# ── 2. metrics compared: how well each one orders the intra term, leaving one year out ─────────────────────────────
def metric_test():
    out = {}
    for tech, keys in (('s', ('lnGW', 'lnGWmid', 'capLoad', 'gen', 'mid', 'res', 'lnGWreg', 'regMid', 'reg', 'regw', 'sur70', 'sur80', 'sur90')),
                       ('w', ('lnGWw', 'wgen', 'wres', 'regWres', 'lnGW', 'reg'))):
        for conv in ('all', 'curt'):
            for target in ('capture', 'intra'):
                kT = f'{conv}_{tech}' if target == 'capture' else f'I_{conv}_{tech}'
                res = {}
                for scope, cs, y0 in (('FR 2016+', ('FR',), FIRST), ('panel 2020+', REGION, 2020)):
                    rows = [(c, y, A[c][y]) for c in cs for y in A[c] if y >= y0 and (complete(c, y) or y == THIS)]
                    for k in keys:
                        # leave one year out, country effects, linear and quadratic in the metric
                        for form in ('lin', 'quad'):
                            pr, ac = [], []
                            for yo in sorted({r[1] for r in rows}):
                                tr, te = [r for r in rows if r[1] != yo], [r for r in rows if r[1] == yo]
                                cl = sorted({r[0] for r in tr})
                                f = lambda r: [1.0 * (r[0] == c) for c in cl] + [r[2][k]] + ([r[2][k] ** 2] if form == 'quad' else [])
                                b, *_ = np.linalg.lstsq(np.array([f(r) for r in tr]), np.array([r[2][kT] for r in tr]), rcond=None)
                                pr += [float(np.dot(f(r), b)) for r in te]
                                ac += [r[2][kT] for r in te]
                            pr, ac = np.array(pr), np.array(ac)
                            res.setdefault(scope, {})[f'{k}:{form}'] = {'r2': round(float(1 - ((pr - ac) ** 2).sum() / ((ac - ac.mean()) ** 2).sum()), 3),
                                                                        'maePts': round(float(np.abs(pr - ac).mean() * 100), 2), 'n': len(ac)}
                out.setdefault(tech, {}).setdefault(conv, {})[target] = res
    return out


# ── 5. what is left, month by month (France) ─────────────────────────────────────────────────────────────────────
def drivers():
    com = D.commodities_monthly()
    beh = FLEX.get('behaviour', {})
    out = {}
    for tech in 'sw':
        for conv in ('all', 'curt'):
            rows = []
            for (y, m), r in sorted(M['FR'].items()):
                cr = r[('cr_' if conv == 'all' else 'crc_') + tech]
                if cr is None or (tech == 's' and m in (11, 12, 1, 2)):
                    continue
                ph = {c: PH[c].get((y, m)) for c in REGION}
                if any(v is None for v in ph.values()):
                    continue
                reg = sum(v[0] for v in ph.values()) / sum(v[1] - v[2] for v in ph.values())
                neigh = sum(ph[c][0] for c in REGION[1:]) / sum(ph[c][1] - ph[c][2] for c in REGION[1:])
                k = gw('FR', 's', y) if tech == 's' else gw('FR', 'w', y)
                f = {'reg': reg, 'own': r['sMid'] / (r['lMid'] - r['nMid']), 'neighSolar': neigh,
                     'nuclear': r['nMid'] / r['lMid'], 'load': r['l'] / 1000, 'wind': r['wMid'] / r['lMid'],
                     'pumping': r['pumpMid'] / 1000, 'exports': r.get('expMid', 0) / 1000, 'hydro': r.get('hyd', 0) / 1000,
                     'level': r['base'], 'sunshine': (r['s'] if tech == 's' else r['w']) / 1000 / k,
                     'ttf': com['ttf'].get((y, m)), 'eua': com['eua'].get((y, m)),
                     'negShare': r['negShare_' + tech], 'lnGW': np.log(gw('FR', 's', y)),
                     'regWind': sum(v[6] for v in ph.values()) / sum(v[5] - v[7] for v in ph.values()),
                     'keptAtNeg': (beh.get(str(y), {}).get('solarLarge' if tech == 's' else 'wind') or {}).get('kept')}
                rows.append((y, m, cr, f))
            res = {}
            for scope, y0, extra in (('2016+', FIRST, ()), ('2020+ (gas, CO2, curtailment known)', 2020, ('ttf', 'eua', 'keptAtNeg'))):
                rr = [r for r in rows if r[0] >= y0 and all(r[3][k] is not None for k in extra)]
                yrs = np.array([r[0] for r in rr])
                yv = np.array([r[2] for r in rr])
                mon = np.array([[1.0 * (r[1] == m) for m in sorted({x[1] for x in rr})] for r in rr])

                def cv(keys, quad=()):
                    X = np.c_[mon, np.array([[r[3][k] for k in keys] + [r[3][k] ** 2 for k in quad] for r in rr], float).reshape(len(rr), -1)]
                    pr = np.zeros(len(yv))
                    for yo in np.unique(yrs):
                        tr, te = yrs != yo, yrs == yo
                        mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-9
                        Z = lambda a: np.c_[a[:, :mon.shape[1]], (a[:, mon.shape[1]:] - mu[mon.shape[1]:]) / sd[mon.shape[1]:]]
                        G = Z(X[tr])
                        b = np.linalg.solve(G.T @ G + 1e-3 * np.eye(G.shape[1]), G.T @ yv[tr])
                        pr[te] = Z(X[te]) @ b
                    return float(1 - ((pr - yv) ** 2).sum() / ((yv - yv.mean()) ** 2).sum()), float(np.abs(pr - yv).mean() * 100)
                base_keys = {'s': ['reg'], 'w': ['reg', 'regWind']}[tech]
                r0 = cv([])
                r1 = cv(base_keys, ['reg'])
                o = {'n': len(rr), 'monthsOnly': {'r2': round(r0[0], 3), 'maePts': round(r0[1], 2)},
                     'lnGW': {'r2': round(cv(['lnGW'])[0], 3), 'maePts': round(cv(['lnGW'])[1], 2)},
                     'ownShare': {'r2': round(cv(['own'], ['own'])[0], 3), 'maePts': round(cv(['own'], ['own'])[1], 2)},
                     'regionShare': {'r2': round(r1[0], 3), 'maePts': round(r1[1], 2)}, 'added': {}}
                cand = ['own', 'neighSolar', 'nuclear', 'load', 'wind', 'pumping', 'exports', 'hydro', 'level', 'sunshine', 'negShare'] + list(extra)
                for k in cand:
                    if k in base_keys:
                        continue
                    r2 = cv(base_keys + [k], ['reg'])
                    o['added'][k] = {'dR2': round(r2[0] - r1[0], 3), 'dMaePts': round(r2[1] - r1[1], 2)}
                allk = [k for k in cand if k not in ('negShare',)]
                ra = cv(base_keys + allk, ['reg'])
                o['allDrivers'] = {'r2': round(ra[0], 3), 'maePts': round(ra[1], 2)}
                res[scope] = o
            out.setdefault(tech, {})[conv] = res
    return out


def ladder(years):
    """France: mean absolute error (€/MWh and points) as the forecast is given more of the truth, per horizon"""
    steps = (('B0 today, fleet extrapolated', dict(model='B0', true_cap=False)),
             ('B0 + real fleet', dict(model='B0', true_cap=True)),
             ('S2 residual-demand share, intra × mean season, real fleet', dict(model='S2', true_cap=True)),
             ('S2 + real season term', dict(model='S2', true_cap=True, season='oracle')),
             ('S2 + real share (weather, demand, nuclear of the year)', dict(model='S2', true_cap=True, season='oracle', true_x=True)),
)
    out = {}
    for tech in 'sw':
        for conv in ('all', 'curt'):
            for h in HORIZONS:
                line = []
                for name, kw in steps:
                    e, e2 = [], []
                    for y in years:
                        tgt = agg('FR', y)
                        p = forecast(kw['model'], tech, conv, 'FR', y - h, y, kw.get('true_cap', True), kw.get('season', 'mean'), kw.get('true_x', False))
                        if p is not None:
                            e.append(abs(p - tgt[f'{conv}_{tech}']) * tgt['base'])
                            e2.append(abs(p - tgt[f'{conv}_{tech}']) * 100)
                    line.append({'step': name, 'eur': round(float(np.mean(e)), 2) if e else None, 'pts': round(float(np.mean(e2)), 2) if e2 else None, 'n': len(e)})
                out.setdefault(tech, {}).setdefault(conv, {})[h] = line
    return out


def main():
    res = {'note': 'walk-forward; errors = predicted − realised yearly capture rate; € = × the year\'s baseload; 2026 to date',
           'region': REGION, 'targets': TARGETS, 'thisYear': THIS,
           'history': {c: {y: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in a.items()} for y, a in A[c].items()} for c in REGION}}
    # season vs intra: how much of the year-to-year change of the capture rate each term carries (France)
    var = {}
    for tech in 'sw':
        for conv in ('all', 'curt'):
            ys = [y for y in sorted(A['FR']) if y - 1 in A['FR']]
            dC = np.array([np.log(A['FR'][y][f'{conv}_{tech}'] / A['FR'][y - 1][f'{conv}_{tech}']) for y in ys])
            dS = np.array([np.log(A['FR'][y][f'S_{conv}_{tech}'] / A['FR'][y - 1][f'S_{conv}_{tech}']) for y in ys])
            dI = dC - dS
            var[f'{tech}_{conv}'] = {'sdCapturePts': round(float(dC.std() * 100), 2), 'sdSeasonPts': round(float(dS.std() * 100), 2), 'sdIntraPts': round(float(dI.std() * 100), 2),
                                     'meanIntraPts': round(float(dI.mean() * 100), 2), 'meanSeasonPts': round(float(dS.mean() * 100), 2),
                                     'intraDetrendedSdPts': round(float(np.std(dI - np.poly1d(np.polyfit(ys, dI, 2))(ys)) * 100), 2)}
    res['seasonVsIntra'] = var
    # is the comparison with the neighbours fair? the fall of the solar intra term 2020 → 2025 per unit of each metric
    res['slopes2020_2025'] = {c: {k: round((A[c][2025]['I_all_s'] - A[c][2020]['I_all_s']) / (A[c][2025][k] - A[c][2020][k]), 2) for k in ('res', 'mid', 'gen', 'reg')}
                              for c in REGION}
    res['metrics'] = metric_test()
    W_ext = walk(true_cap=False)
    W_true = walk(true_cap=True)
    res['walk'] = {'fleetExtrapolated': W_ext, 'fleetReal': W_true}
    res['mae'] = {f'{name} {lab}': summary(W, ys) for name, W in (('fleetExtrapolated', W_ext), ('fleetReal', W_true))
                  for lab, ys in (('2021-2026', TARGETS), ('2023-2026', (2023, 2024, 2025, 2026)), ('2024-2026', (2024, 2025, 2026)), ('2023-2025 complete', (2023, 2024, 2025)))}
    res['maeNeighbours'] = {c: summary(walk(c, true_cap=False), (2023, 2024, 2025, 2026)) for c in ('DE', 'ES', 'BE')}
    res['ladder'] = {'2023-2026': ladder((2023, 2024, 2025, 2026)), '2021-2026': ladder(TARGETS)}
    res['drivers'] = drivers()
    with open(OUT, 'w') as f:
        json.dump(res, f, separators=(',', ':'), default=float)
    # ── console ──
    print('season vs intra (France, yearly log-changes, points):', json.dumps(var))
    for lab in ('fleetExtrapolated 2023-2026', 'fleetExtrapolated 2021-2026', 'fleetExtrapolated 2024-2026', 'fleetExtrapolated 2023-2025 complete', 'fleetReal 2023-2026'):
        print('\nMAE €/MWh (pts)', lab)
        for t in 'sw':
            for cv in ('all', 'curt'):
                print(' ', t, cv, ' | '.join('%s %s' % (m, ' '.join('%s(%s)' % (v['eur'], v['pts']) for v in hh.values())) for m, hh in res['mae'][lab][t][cv].items()))
    print('slopes of the solar intra term 2020→2025 per unit of metric:', json.dumps(res['slopes2020_2025']))
    print('\nneighbours as targets (fleet extrapolated, 2023-2026), MAE points h1 h2 h3')
    for c, s in res['maeNeighbours'].items():
        for t in 'sw':
            print(' ', c, t, 'all', ' | '.join('%s %s' % (m, ' '.join(str(v['pts']) for v in hh.values())) for m, hh in s[t]['all'].items()))
    print('\nladder 2023-2026')
    for t in 'sw':
        for cv in ('all', 'curt'):
            for h in HORIZONS:
                print(' ', t, cv, 'h%d' % h, ' → '.join('%s' % x['eur'] for x in res['ladder']['2023-2026'][t][cv][h]), '  | 2021-2026:', ' → '.join('%s' % x['eur'] for x in res['ladder']['2021-2026'][t][cv][h]))
    print('\nmetrics, leave-one-year-out R² (linear | quadratic)')
    for t in 'sw':
        for tg in ('capture', 'intra'):
            for sc, r in res['metrics'][t]['all'][tg].items():
                ks = sorted({k.split(':')[0] for k in r})
                print(' ', t, tg, sc, ' '.join('%s %.2f|%.2f' % (k, r[k + ':lin']['r2'], r[k + ':quad']['r2']) for k in ks))
    print('\ndrivers (France, monthly)')
    for t in 'sw':
        for cv in ('all', 'curt'):
            for sc, o in res['drivers'][t][cv].items():
                print(' ', t, cv, sc, 'n', o['n'], 'months', o['monthsOnly']['r2'], 'lnGW', o['lnGW']['r2'], 'own', o['ownShare']['r2'], 'region', o['regionShare']['r2'], 'all', o['allDrivers']['r2'],
                      ' '.join('%s %+.3f' % (k, v['dR2']) for k, v in sorted(o['added'].items(), key=lambda kv: -kv[1]['dR2'])))


if __name__ == '__main__':
    main()
