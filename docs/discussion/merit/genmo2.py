"""Generator replay with the merit order: real past weeks (same weekday, ±7 days, 7-day blocks, every variable of the
same day) on the delivery year's fleets, priced by the merit order, knowing nothing of the delivery year."""
import sys, json, os
from datetime import date, timedelta
import numpy as np
sys.path.insert(0, '/home/ubuntu/PowerKlock/.claude/worktrees/bridge-cse_019SBz1eD5ytFRZxqbyv9hcG/scripts')
import ppa_merit as M
sys.path.insert(0, M.ROOT + '/scripts'); _a, sys.argv = sys.argv, ['x']
import ppa_lab as L
sys.argv = _a

YS = {y: M.year(y) for y in range(2020, 2027)}
COMPLETE = [y for y in YS if len(YS[y]['days']) >= 340 and y < 2026]

def jao_feats(D):
    fr, rs = D['fr'], D['rest']; m = D['month'][:, None] * np.ones((1, 24)); h = np.ones((len(D['days']), 1)) * np.arange(24)[None, :]
    X = [np.ones_like(m), rs['wind'] / 1e4, rs['solar'] / 1e4, rs['load'] / 1e4, fr['wind'] / 1e4, fr['solar'] / 1e4, fr['load'] / 1e4, fr['avail'] / 1e4,
         rs['nuclear'] / 1e4, (rs['lignite'] + rs['coal'] + rs['gas']) / 1e4] + [(m == k).astype(float) for k in range(2, 13)] + [((h >= a) & (h < a + 6)).astype(float) for a in (6, 12, 18)]
    return np.stack([x.ravel() for x in X], 1)

def jao_fit(years, key):
    Xs, ys = [], []
    for y in years:
        X = jao_feats(YS[y]); j = YS[y]['fr'][key].ravel(); ok = np.isfinite(j) & np.isfinite(X).all(1)
        if ok.sum() > 2000:
            Xs.append(X[ok]); ys.append(j[ok])
    if not Xs:
        return None
    return np.linalg.lstsq(np.concatenate(Xs), np.concatenate(ys), rcond=None)[0]

def cap_vre(c, t, y):
    """installed GW (solar 's' / wind 'w') of country c at the end of year y, from capacity.json"""
    if c == 'FR':
        return L.cap('FR', t, y)
    if t == 's':
        return M.capacity(c, 'Solar AC', y) or M.capacity(c, 'Solar DC', y)
    return M.capacity(c, 'Wind onshore', y) + M.capacity(c, 'Wind offshore', y)

def cap_guess(c, t, Y, A):
    """the delivery year's fleet as the last year's pace (as the generator)"""
    a, b = cap_vre(c, t, A), cap_vre(c, t, A - 1) or cap_vre(c, t, A)
    return a + (a - b) * (Y - A)

def cf(Yd, z, t, c_list):
    """load factor series of zone z (sum of countries) on its own year's fleet"""
    y = Yd['y']; capg = sum(cap_vre(c, 't'[0] if False else t, y) for c in c_list)
    return Yd[z]['solar' if t == 's' else 'wind'] / (capg * 1000)

def mm(a, month):
    return np.array([a[month == k].mean() for k in range(1, 13)])

def assemble(Y, A, src, Yrows, h_known):
    """the delivery year's hourly inputs from the drawn days src [(year, row)]"""
    days = [date(Y, 1, 1) + timedelta(i) for i in range(len(src))]
    month = np.array([d.month for d in days])
    D = {'y': A, 'days': [d.isoformat() for d in days], 'month': month, 'fr': {}, 'rest': {}}
    dem = YS[Y] if os.environ.get('DEM_TRUE') == '1' else YS[int(os.environ.get('DEM_FROM', A))]
    for z, cl in (('fr', ('FR',)), ('rest', M.REST)):
        cfs, cfw, lv = {}, {}, {}
        for y in set(s[0] for s in src):
            Yd = YS[y]
            cfs[y] = Yd[z]['solar'] / (sum(cap_vre(c, 's', y) for c in cl) * 1000)
            cfw[y] = Yd[z]['wind'] / (sum(cap_vre(c, 'w', y) for c in cl) * 1000)
            lv[y] = mm(Yd[z]['load'], Yd['month'])
        # output per GW levelled to the last known year (as the generator, 'year' form)
        ls = {y: cfs[A].mean() / cfs[y].mean() if y in cfs and A in cfs else 1.0 for y in cfs}
        if A not in cfs:
            YA = YS[A]
            a_s = (YA[z]['solar'] / (sum(cap_vre(c, 's', A) for c in cl) * 1000)).mean(); a_w = (YA[z]['wind'] / (sum(cap_vre(c, 'w', A) for c in cl) * 1000)).mean()
            ls = {y: a_s / cfs[y].mean() for y in cfs}; lw = {y: a_w / cfw[y].mean() for y in cfw}
        else:
            lw = {y: cfw[A].mean() / cfw[y].mean() for y in cfw}
        if os.environ.get('LEVEL', 'trend') == 'trend':
            # as the published generator: a straight line through the pool years' mean output per GW (keeps a dull
            # or sunny year as it was), the ratio of its value at the last known year to its value at the weather year
            def _cfm(y, tt):
                Yd_ = YS[y]; caps_ = sum(cap_vre(c, tt, y) for c in cl) * 1000
                return float((Yd_[z]['solar' if tt == 's' else 'wind'] / caps_).mean())
            ys_ = sorted(set([y for y in COMPLETE if y <= A and y != 2022]))
            for tt, lev in (('s', ls), ('w', lw)):
                xs_ = np.array(ys_); vs_ = np.array([_cfm(y, tt) for y in ys_])
                if len(xs_) >= 3:
                    a_, b_ = np.polyfit(xs_, vs_, 1)
                    for y in list(lev):
                        lev[y] = (a_ * A + b_) / (a_ * y + b_)
        Af = int(os.environ.get('FLEET_FROM', A))
        fs = sum(cap_guess(c, 's', Y, Af) for c in cl) * 1000; fw = sum(cap_guess(c, 'w', Y, Af) for c in cl) * 1000
        if os.environ.get('FLEET_TRUE') == '1':
            fs = sum(cap_vre(c, 's', Y) for c in cl) * 1000; fw = sum(cap_vre(c, 'w', Y) for c in cl) * 1000
        dm = mm(dem[z]['load'], dem['month'])
        for k in YS[A][z]:
            rows = []
            for (y, r), d in zip(src, days):
                Yd = YS[y]
                if k == 'solar':
                    rows.append(cfs[y][r] * (1.0 if os.environ.get('LEVEL_OFF') == '1' else ls[y]) * fs)
                elif k == 'wind':
                    rows.append(cfw[y][r] * (1.0 if os.environ.get('LEVEL_OFF') == '1' else lw[y]) * fw)
                elif k == 'load':
                    rows.append(Yd[z]['load'][r] / lv[y][Yd['month'][r] - 1] * dm[d.month - 1])
                elif k in ('avail',) and os.environ.get('AVAIL_TRUE') == '1':
                    rows.append(Yd[z][k][r])
                elif k == 'nuclear' and z == 'rest' and os.environ.get('AVAIL_TRUE') == '1':
                    rows.append(Yd[z][k][r])
                elif k in ('avail',):
                    rows.append(np.full(24, mm(dem['fr']['avail'][:, 0], dem['month'])[d.month - 1]))
                elif k == 'nuclear' and z == 'rest':
                    rows.append(np.full(24, mm(dem['rest']['nuclear'].mean(1), dem['month'])[d.month - 1]))
                elif k in ('gb', 'ext') and os.environ.get('EXO_LEVEL') == '1':
                    # exchanges outside the model: the drawn day's shape, the last known year's level (as output per GW)
                    v = Yd[z][k][r]
                    rows.append(v - np.mean(Yd[z][k]) + np.mean(YS[A][z][k]))
                elif k in ('jmax', 'jmin') and os.environ.get('JAO_LEVEL', '1') == '1':
                    # the drawn day's limit (its grid and weather situation) at the last known year's level
                    v = Yd[z][k][r]
                    jy = [y_ for y_ in COMPLETE if y_ <= A and np.isfinite(np.nanmean(YS[y_][z][k]))][-int(os.environ.get('JAO_N', 1)):]
                    ref = float(np.mean([np.nanmean(YS[y_][z][k]) for y_ in jy])) if jy else np.nan
                    if os.environ.get('JAO_FROM'):
                        ref = np.nanmean(YS[int(os.environ['JAO_FROM'])][z][k])
                    own = np.nanmean(Yd[z][k])
                    rows.append(v * (ref / own) if np.isfinite(ref) and np.isfinite(own) and own != 0 else (np.full(24, ref) if np.isfinite(ref) else v))
                else:
                    rows.append(Yd[z][k][r])
            D[z][k] = np.array(rows)
    D['price'] = np.zeros((len(days), 24)); D['de'] = np.full((len(days), 24), np.nan)
    return D

def draw(Y, pool, rng, window=7, weeks=7):
    days = [date(Y, 1, 1) + timedelta(i) for i in range((date(Y + 1, 1, 1) - date(Y, 1, 1)).days)]
    idx = {y: {d: i for i, d in enumerate(YS[y]['days'])} for y in pool}
    src = []; i = 0
    while i < len(days):
        d0 = days[i]; cand = []
        for y in pool:
            for k in range(-window, window + 1):
                try:
                    dd = date(y, d0.month, d0.day) + timedelta(k)
                except ValueError:
                    continue
                if dd.weekday() != d0.weekday():
                    continue
                r = idx[y].get(dd.isoformat())
                if r is not None and r + weeks <= len(YS[y]['days']):
                    cand.append((y, r))
        if not cand:   # the year's edges: any same-weekday day within ±14 days, the block cut at its year's end
            for y in pool:
                for k in range(-14, 15):
                    try:
                        dd = date(y, d0.month, min(d0.day, 28)) + timedelta(k)
                    except ValueError:
                        continue
                    r = idx[y].get(dd.isoformat())
                    if dd.weekday() == d0.weekday() and r is not None:
                        cand.append((y, r))
        y, r = cand[rng.integers(len(cand))]
        n_ = len(YS[y]['days'])
        for k in range(min(weeks, len(days) - i)):
            src.append((y, min(r + k, n_ - 1)))
        i += weeks
    return src

def known_costs(A):
    """fuel prices of December of the last known year, held flat (as the generator)"""
    s = M.series(); out = {}
    for k in ('ttf', 'eua', 'coal', 'brent', 'eurusd'):
        v = [x for d, x in s[k].items() if d.startswith(f'{A}-12')]
        out[k] = float(np.mean(v)) if v else None
    return out

def replay(Y, h, prm, n=10, seed=7):
    A = max(y for y in COMPLETE if y <= Y - h)
    Ap = int(os.environ.get('PP_FROM', A))
    NP = int(os.environ.get('NPREV', 2))
    prev = [y for y in COMPLETE if y <= Ap and (y != 2022 or os.environ.get('WITH2022') == '1')][-NP:]
    Yp = YS[prev[0]]
    for yy in prev[1:]:
        Yp = M.merge(Yp, YS[yy])
    pp = M.prev_params(Yp)
    pp['kmin'] = M.kmin_all(YS, A + 1)
    pool = [y for y in COMPLETE if y <= A and y != 2022]
    rng = np.random.default_rng(seed + Y * 10 + h)
    kc = known_costs(int(os.environ.get('FUEL_FROM', A)))
    M_series = M.series()
    res = []
    for _ in range(n):
        src = draw(Y, pool, rng)
        D = assemble(Y, A, src, None, None)
        # flat known fuel prices for the delivery year (the cost functions read the series by day)
        saved = {k: {d: M_series[k].get(d) for d in D['days']} for k in kc}
        for k, v in kc.items():
            if v is not None and os.environ.get('FUEL_TRUE') != '1':
                for d in D['days']:
                    M_series[k][d] = v
        p = dict(prm); p['rF'] = 0.2 if A >= 2024 else 0.0
        D['y'] = Y if os.environ.get('CAP_Y') == '1' else A   # capacities of the last known year
        if os.environ.get('JAO') == 'model':
            # France's export / import limit explained by the hour's situation (fit on the known years with JAO data)
            for key in ('jmax', 'jmin'):
                b = jao_fit([y for y in COMPLETE if y <= A], key)
                if b is not None:
                    X = jao_feats(D)
                    D['fr'][key] = (X @ b).reshape(D['fr'][key].shape)
        try:
            pf, _ = M.run(D, pp, p)
        finally:
            for k, dd in saved.items():
                for d, v in dd.items():
                    if v is None:
                        M_series[k].pop(d, None)
                    else:
                        M_series[k][d] = v
        res.append((D, pf))
    return res, A

def months(D, pf, t):
    v = D['fr'][t]; m = D['month']; out = {}
    for k in range(1, 13):
        s = m == k; P = pf[s]; vs = v[s]; base = P.mean()
        pos = P > 0
        out[k] = {'all': (vs * P).sum() / vs.sum() / base, 'curt': (vs[pos] * P[pos]).sum() / max(vs[pos].sum(), 1) / base, 'paid': vs[pos].sum() / vs.sum()}
    return out


def score_year(Y, h, prm, n=10):
    res, A = replay(Y, h, prm, n)
    out = {}
    for t, tt in (('solar', 's'), ('wind', 'w')):
        ms = [months(D, pf, t) for D, pf in res]
        P = {k: float(np.nanmean([m[k]['curt'] for m in ms])) for k in range(1, 13)}
        act = L.actual(tt, Y)
        out[t] = (L.score(P, act, 'curt') or {}).get('eur')
    return out, A

if __name__ == '__main__':
    prm = {'nuc_curve': True, 'th_curve': True, 'th_season': True, 'ps_use': 0.1, 'ps_fr': 0.1, 'rR': 0.9, 'eff': os.environ.get('EFF', 'jao_k'), 'kall': True, 'pool2': True, 'neg_obs': True, 'resp_bid': (-3.0, 3.0)}
    gen = json.load(open(M.ROOT + '/data/history/ppa_generator_test.json'))['rows']
    G = {(r['tech'], r['year'], r['h']): r['err']['gen'] for r in gen}
    rows = []
    for Y in (2023, 2024, 2025):
        for h in (1, 2, 3):
            if not [y for y in COMPLETE if y <= Y - h and y != 2022]:
                continue
            o, A = score_year(Y, h, prm, n=int(os.environ.get('N', 10)))
            for t in ('solar', 'wind'):
                rows.append((t, Y, h, o[t], G.get((t, Y, h))))
                print(t, Y, h, 'known up to', A, 'merit %+.2f | generator %s' % (o[t], '%+.2f' % G[(t, Y, h)] if (t, Y, h) in G else '-'), flush=True)
    for t in ('solar', 'wind'):
        r = [x for x in rows if x[0] == t and x[4] is not None]
        print(t, 'MAE merit %.2f (bias %+.2f) | generator %.2f (bias %+.2f) on the same %d cases' % (np.mean([abs(x[3]) for x in r]), np.mean([x[3] for x in r]), np.mean([abs(x[4]) for x in r]), np.mean([x[4] for x in r]), len(r)))
