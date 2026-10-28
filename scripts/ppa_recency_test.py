#!/usr/bin/env python3
"""Do the hourly price models see the market adapt? European price model and weather simulation learnt
with recent years weighing more (half-life 1 or 2 years) and with the current year to date, against
today's settings, priced 1, 2 and 3 years ahead (the benchmark's horizon).

Why: on solar 2027–29 the four methods spread by about 15 €/MWh (capacity trend 56, forward shape 41,
European 43, weather 46). The hourly models learn the price of an hour from past years equally weighted
and leave the current (incomplete) year out, so the recent adaptation of the market (curtailment at
prices ≤ 0, batteries, exports) reaches them late.

Protocol (realistic pricing date, 1 October of year Y − h): complete years up to Y − h − 1 are known; the
year to date is Y − h, January to September. Delivery years Y = 2024, 2025, 2026 (2026 to date), as
scripts/ppa_horizon_test.py; error = production-weighted error on the value of one MWh (€/MWh), both
conventions (curt: output stopped at prices ≤ 0; all: every hour paid). 2022 stays out as in the pricer.
  base     today's settings (data/history/ppa_forecast.json), complete years only
  ytd      + the year to date
  hl1/hl2  years weighted 0.5^(age / half-life), age 0 = the year to date, 1 = the last complete year…
The 4-method average is recomputed with each variant of the two hourly models (capacity trend and
forward shape unchanged, as in the test bench).

Writes data/history/ppa_recency_test.json
    python scripts/ppa_recency_test.py
"""
import inspect
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
import ppa_backtest as B             # noqa: E402
import ppa_backtest_detail as BD     # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_recency_test.json')
TARGETS = (2024, 2025, 2026)
HORIZONS = (1, 2, 3)
YTD_MONTHS = 9      # pricing on 1 October: January to September known
VARIANTS = {'base': (False, None), 'ytd': (True, None), 'hl2': (False, 2.0), 'hl1': (False, 1.0), 'ytd+hl2': (True, 2.0), 'ytd+hl1': (True, 1.0)}


# ── the year to date as a pseudo-year of the European model's data ─────────────────────────────
def ytd_key(y):
    key = f'{y}ytd'
    if key not in L.DATA and y in L.DATA:
        a = L.DATA[y]; k = a['month'] <= YTD_MONTHS; n = len(a['month'])
        L.DATA[key] = {f: (v[k] if isinstance(v, np.ndarray) and len(v) == n else [d for d, kk in zip(v, k) if kk] if f == 'days' else v) for f, v in a.items()}
        L.DATA[key]['complete'] = False
    return key


class WPriceModel(L.PriceModel):
    """L.PriceModel with year weights in the bins' means (lists kept for the draws)"""

    def __init__(self, years, weights, region=True, level=False):
        super().__init__(years, region, 'mean', level)
        xs, gs, rs, ws = [], [], [], []
        for y in years:
            a = L.DATA[y]; P = a['fr_p']; x = L.residual_share(a, region)
            lvl = {m: P[a['month'] == m].mean() for m in range(1, 13) if (a['month'] == m).any()}
            mavg = np.array([lvl[m] for m in a['month']])[:, None]
            ok = mavg[:, 0] > 5
            base = np.array([P[a['month'] == m].mean() for m in a['month']])
            g = L.grp(a['month']) + 6 * self.lclass(base)[:, None] * level
            r = (P / mavg)[ok].ravel()
            xs.append(x[ok].ravel()); gs.append(g[ok].ravel()); rs.append(r); ws.append(np.full(r.shape, weights[y]))
        x, g, r, w = np.concatenate(xs), np.concatenate(gs), np.concatenate(rs), np.concatenate(ws)
        b = np.clip(np.round(x / L.BIN).astype(int) - self.lo, 0, self.nb - 1)
        G = self.mean.shape[0]
        mean = np.full((G, self.nb), np.nan); mpos = mean.copy(); ppos = mean.copy()
        for gi in range(G):
            for bi in range(self.nb):
                k = (g == gi) & (b == bi)
                if k.sum() >= 15:
                    v, ww = r[k], w[k]
                    mean[gi, bi] = (v * ww).sum() / ww.sum(); mpos[gi, bi] = (v * (v > 0) * ww).sum() / ww.sum(); ppos[gi, bi] = ((v > 0) * ww).sum() / ww.sum()
        for gi in range(G):
            filled = np.where(~np.isnan(mean[gi]))[0]
            if not len(filled):
                mean[gi], mpos[gi], ppos[gi] = self.mean[gi], self.mpos[gi], self.ppos[gi]
                continue
            near = np.array([filled[np.abs(filled - bi).argmin()] for bi in range(self.nb)])
            mean[gi], mpos[gi], ppos[gi] = mean[gi, near], mpos[gi, near], ppos[gi, near]
        self.mean, self.mpos, self.ppos = mean, mpos, ppos


def weights_for(years, ref, hl):
    """age 0 = the year to date (or the pricing year), 1 = the year before…"""
    def age(y):
        return ref - (int(y[:4]) if isinstance(y, str) else y)
    return {y: (0.5 ** (age(y) / hl) if hl else 1.0) for y in years}


# ── weather simulation with year weights and the year to date in its price table ──────────────
_src = inspect.getsource(BD.m_weather)
_old = """    recent = train[-2:]
    grp = ((mo >= 4) & (mo <= 9)).astype(int) * 3 + np.select([hr < 9, hr < 17], [0, 1], 2)
    net = np.round((L - S - W - NAV) / 1000).astype(int)
    tab = {}
    tr = np.isin(yr, recent)
    for g in range(6):
        for b in np.unique(net[tr & (grp == g)]):
            i = tr & (grp == g) & (net == b)
            if i.sum() >= 20:
                tab[(g, int(b))] = float((P[i] / B.mavg[i]).mean())"""
_new = """    recent = train[-2:]
    grp = ((mo >= 4) & (mo <= 9)).astype(int) * 3 + np.select([hr < 9, hr < 17], [0, 1], 2)
    net = np.round((L - S - W - NAV) / 1000).astype(int)
    tab = {}
    tr = np.isin(yr, recent) | ((yr == _YTD) & (mo <= _YTDM) if _YTD else False)
    wt = np.ones(len(yr))
    if _HL:
        wt = 0.5 ** ((_REF - yr) / _HL)
    for g in range(6):
        for b in np.unique(net[tr & (grp == g)]):
            i = tr & (grp == g) & (net == b)
            if i.sum() >= 20:
                tab[(g, int(b))] = float(((P[i] / B.mavg[i]) * wt[i]).sum() / wt[i].sum())"""
assert _old in _src
_ns = dict(BD.__dict__)
exec(compile(_src.replace('def m_weather(', 'def m_weather_w(').replace(_old, _new), 'm_weather_w', 'exec'), _ns)


def weather(t, Y, train, V, ytd, hl, ref):
    _ns['_YTD'], _ns['_YTDM'], _ns['_HL'], _ns['_REF'] = (ref if ytd and ref != 2022 and ref in set(B.yr.astype(int).tolist()) else None), YTD_MONTHS, hl, ref
    return _ns['m_weather_w'](t, Y, train, V, 40)


def main():
    settings = json.load(open(os.path.join(H, 'ppa_forecast.json')))['settings']
    out = {'protocol': __doc__.split('Writes')[0].strip(), 'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        V = B.S if t == 's' else B.W
        st = {k: v for k, v in settings[t].items() if k != 'calError'}
        for Y in TARGETS:
            act = L.actual(t, Y)
            for h in HORIZONS:
                ref = Y - h                                      # the pricing year (1 October)
                known = [y for y in L.DATA if y < ref and L.DATA[y]['complete']]
                train = [y for y in known if y != 2022]
                if len(train) < 3:
                    continue
                last = max(known)
                capY = {c: {tt: L.cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
                lv = L.levels_for(Y, 'forward') if st['level'] == 'forward' else ({m: float(L.DATA[last]['fr_p'][L.DATA[last]['month'] == m].mean()) for m in range(1, 13)} if st['level'] == 'lastyear' else None)
                base_tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
                stp = {conv: BD.m_step(t, Y, train, V, conv) for conv in ('curt', 'all')}
                fpc = {conv: BD.m_fpc(t, Y, train, V, conv)[1] for conv in ('curt', 'all')}
                row = {'tech': tech, 'year': Y, 'h': h, 'pricingYear': ref, 'curt': {}, 'all': {}}
                for vn, (ytd, hl) in VARIANTS.items():
                    yrs = base_tr + ([ytd_key(ref)] if ytd and ref in L.DATA and (st['with2022'] or ref != 2022) else [])   # one 2022 rule: no 2022 year to date either
                    pm = WPriceModel(yrs, weights_for(yrs, ref, hl), st['regional'], st['level'] != 'none') if (ytd or hl) else L.PriceModel(yrs, st['regional'], 'mean', st['level'] != 'none')
                    L.DATA.pop(f'{ref}ytd', None)   # the pseudo-year only lives while the table is built (L iterates DATA's years)
                    m4, _, _ = L.regional(t, Y, known, pm, last, capY, 0, lv, st['regional'])
                    _, wmc, _ = weather(t, Y, train, V, ytd, hl, ref)
                    for conv in ('curt', 'all'):
                        reg = {m: m4[m][conv] for m in m4 if m4[m][conv] == m4[m][conv]}
                        P = {'step': {m: stp[conv] for m in range(1, 13)}, 'fpc': fpc[conv], 'weather': wmc[conv], 'regional': reg}
                        ks = [m for m in range(1, 13) if all(P[k].get(m) is not None for k in P)]
                        P['avg4'] = {m: float(np.mean([P[k][m] for k in ('step', 'fpc', 'weather', 'regional')])) for m in ks}
                        row[conv][vn] = {k: (L.score(P[k], act, conv) or {}).get('eur') for k in ('regional', 'weather', 'avg4')}
                out['rows'].append(row)
                print(tech, Y, f'h={h}', ' | '.join(f"{vn}: eu {row['curt'][vn]['regional']:+.2f} wx {row['curt'][vn]['weather']:+.2f} avg4 {row['curt'][vn]['avg4']:+.2f}" for vn in VARIANTS), flush=True)
    out['mae'] = {}
    for tech in ('solar', 'wind'):
        for conv in ('curt', 'all'):
            for h in HORIZONS:
                rs = [r for r in out['rows'] if r['tech'] == tech and r['h'] == h]
                out['mae'][f'{tech} {conv} h={h}'] = {vn: {k: round(float(np.mean([abs(r[conv][vn][k]) for r in rs if r[conv][vn].get(k) is not None])), 2) for k in ('regional', 'weather', 'avg4')} for vn in VARIANTS}
    for k, v in out['mae'].items():
        print('%-18s ' % k + ' | '.join(f"{vn}: eu {e['regional']:.2f} wx {e['weather']:.2f} avg4 {e['avg4']:.2f}" for vn, e in v.items()))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
