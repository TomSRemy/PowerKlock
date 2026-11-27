#!/usr/bin/env python3
"""PPA test bench on delivery PERIODS (not only calendar years): six pricing approaches for a short fixed-price PPA whose
plant stops at negative prices, replayed walk-forward on French national solar and wind, one common grid.

Extends the existing replays (ppa_backtest.py, ppa_backtest_detail.py, ppa_lab.py: calendar years only) without
replacing them: the same formulas, written on "pseudo-years" = the 12-month blocks that end at the pricing date, so a
delivery from April N to November N+1 is priced like a calendar year is. For a delivery starting in January the blocks
are the calendar years and methods 1-3 give the figures of ppa_backtest_detail.py (checked by --check).

Contract convention ('curt'): the plant produces nothing in the hours priced strictly below 0 EUR/MWh (an hour at 0 is
produced and paid 0, as scripts/ppa_lab.py since 1 Nov. 2026); those hours STAY in the market baseload. The price of
the PPA = revenue of the produced hours / produced MWh; capture rate = that price / baseload of all hours.
'all' = every hour produced and paid. 'dash' = the PPA Dashboard convention (hours <= 0 left out of capture AND
baseload), kept to measure what it costs.

Protocol (no look-ahead)
  - pricing date = first day of the delivery (or --lead months before); only hours before it are read;
  - installed fleets: year-end figures known at the pricing date, the later ones extrapolated at the last yearly pace;
  - a training block with at least half of its days in 2022 (gas crisis) is left out, a delivery touching 2022 is
    not scored (as the existing benches);
  - deliveries: every quarter start from 2019, 6, 12 and 20 months (April N -> November N+1 included); a 12-month
    delivery starting in January is a calendar year;
  - forward level: the realised monthly baseload stands in for the forward curve (the bench measures the capture, not
    the forward), months weighted by the realised paid output.

Approaches
  1 dash        PPA Dashboard: 1 - P74 of the past blocks' discounts (reference; 'dash' in its own convention,
                'dash_curt' in the contract's)
  2 step        Step by step: capture vs ln(installed GW), anchored on the last block (reference)
  3 fpc         classic FPC: expected profile on the skeleton + cannibalisation (1)-(3) projected on ln(GW), applied
                afterwards (site settings: per season, solar fleet as driver, solar skeleton half-life 1 year);
                fpc_plain = the textbook version (yearly term, own fleet, plain skeleton)
  4 fpc_inj     FPC with the cannibalisation INSIDE the hourly curve: each cell of the curve (month x day type x hour)
                carries three figures (mean price, mean of the price's positive part, probability the price is >= 0),
                each moved to the delivery fleet by a slope on ln(solar GW) and averaged on the recent blocks; only
                the weather covariance left inside a cell is added afterwards
  5 wx_mc       corrected weather Monte Carlo: blocks of 7 real days drawn in the same season (output shape hour by
                hour, consumption of the same days), price drawn from the distribution of the recent prices at that
                residual load (so negative prices appear), extrapolated below the lowest residual load seen
  6 fpc_mc      FPC whose projection is simulated: slope, year-to-year surprise, fleet pace and weather year of the
                profile drawn -> a distribution of the future discount
  + hybrid      see docs/ppa_bench_results.md

Writes data/history/ppa_bench.json (every delivery, every method) and prints the tables.
    python scripts/ppa_bench.py [--sims 100] [--lead 0] [--thr 0] [--check] [--md]
(--lead 6: priced 6 months before the delivery starts; --thr 0.001: the plant also stops at 0 EUR/MWh; both write a
separate file; --check: a calendar year gives the figures of ppa_backtest_detail.py; --md: the tables of the note)
"""
import json
import math
import os
import sys
from datetime import date

import numpy as np
from scipy.signal import lfilter
from scipy.stats import norm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_backtest as B   # noqa: E402  (loader, installed fleets, logfit)
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_bench.json')
Y0 = 2016
THR = float(_argv[_argv.index('--thr') + 1]) if '--thr' in _argv else 0.0   # the plant stops strictly below THR EUR/MWh (--thr 0.001: stops at 0 too)
TECH = {'s': 'solar', 'w': 'wind'}
SUMMER = np.array([4 <= m <= 9 for m in range(1, 13)])
LENGTHS = (6, 12, 20)
FIRST_START = (2019 - Y0) * 12


# ── data: one row per calendar day, 24 hours ────────────────────────────────
def _days():
    A = B.load(range(Y0, date.today().year + 1))
    day0 = date(Y0, 1, 1).toordinal()
    nd = int(A[:, 9].max()) - day0 + 1
    M = {k: np.full((nd, 24), np.nan) for k in 'PLSW'}
    nav, cnt = np.full(nd, np.nan), np.zeros(nd, int)
    di, h = (A[:, 9] - day0).astype(int), A[:, 3].astype(int)
    for k, col in zip('PLSW', (4, 5, 6, 7)):
        M[k][di, h] = A[:, col]
    nav[di] = A[:, 8]
    np.add.at(cnt, di, 1)
    dd = [date.fromordinal(day0 + i) for i in range(nd)]
    return M, nav, cnt == 24, dd


_M, NAV, VALID, DD = _days()
P, L, S, W = _M['P'], _M['L'], _M['S'], _M['W']
ND = len(DD)
VV = {'s': S, 'w': W}
YEAR = np.array([d.year for d in DD])
MON = np.array([d.month for d in DD])
YM = (YEAR - Y0) * 12 + MON - 1
DT = np.array([0 if d.weekday() < 5 else (1 if d.weekday() == 5 else 2) for d in DD])
XDAY = np.array([d.year + (d.timetuple().tm_yday - 0.5) / (366 if d.year % 4 == 0 else 365) for d in DD])
NYM = int(YM.max()) + 1
MAVG = np.array([np.nanmean(P[VALID & (YM == k)]) if (VALID & (YM == k)).any() else np.nan for k in range(NYM)])
R = P / MAVG[YM][:, None]                      # hourly price / its month's average
POS = (P >= THR)


def _complete(k):
    y, m = Y0 + k // 12, k % 12 + 1
    n = (date(y + (m == 12), m % 12 + 1, 1) - date(y, m, 1)).days
    return (VALID & (YM == k)).sum() >= n - 1 and date(y + (m == 12), m % 12 + 1, 1) <= date.today()


LAST_YM = max(k for k in range(NYM) if _complete(k))


def ymlabel(k):
    return f'{Y0 + k // 12}-{k % 12 + 1:02d}'


def cap_at(t, x, known):
    """installed GW of technology t at time x (year-end of y = y + 1), as known at time `known`: the year-ends already
    published joined by straight lines, then the last yearly pace"""
    ys = [y for y in sorted(B.CAP[t]) if y + 1 <= known + 1e-9 and B.CAP[t][y]]
    xs, cs = np.array([y + 1 for y in ys], float), np.array([B.CAP[t][y] for y in ys], float)
    x = np.asarray(x, float)
    return np.where(x <= xs[-1], np.interp(x, xs, cs), cs[-1] + (cs[-1] - cs[-2]) * (x - xs[-1]))


# ── the realised, month by month ────────────────────────────────────────────
def _truth():
    out = {}
    for t, V in VV.items():
        for k in range(NYM):
            d = np.where(VALID & (YM == k))[0]
            if not len(d) or not _complete(k):
                continue
            p, v, pos = P[d], V[d], POS[d]
            base, e, ep = p.mean(), v.sum(), (v * pos).sum()
            p2 = p > 0
            out[(t, k)] = {'all': (v * p).sum() / e / base, 'curt': (v * p * pos).sum() / ep / base, 'paid': ep / e,
                           'dash': (v * p * p2).sum() / (v * p2).sum() / p[p2].mean(),
                           'curt_le0': (v * p * p2).sum() / (v * p2).sum() / base,
                           'negH': int((~pos).sum()), 'base': base, 'mwh': e,
                           'shape': p.mean(0) / base, 'wh': v.sum(0) / e}
    return out


TRUTH = _truth()


def cells(X, days):
    """mean of X (days x 24) by month x day type x hour over the given days; NaN where a cell has no day"""
    key = (MON[days] - 1) * 3 + DT[days]
    s, n = np.zeros((36, 24)), np.zeros(36)
    np.add.at(s, key, X[days])
    np.add.at(n, key, 1)
    with np.errstate(invalid='ignore', divide='ignore'):
        return (s / n[:, None]).reshape(12, 3, 24)


def rate(days, V, Pr, conv, pos=None):
    v, p = V[days], Pr[days]
    if conv == 'all':
        return float((v * p).sum() / v.sum() / p.mean())
    k = (p >= THR) if pos is None else pos[days]
    return float((v * p * k).sum() / (v * k).sum() / p.mean())


def wavg(vals, w):
    """weighted mean over the first axis, ignoring NaN"""
    vals = np.asarray(vals, float)
    w = np.asarray(w, float).reshape((-1,) + (1,) * (vals.ndim - 1)) * np.isfinite(vals)
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.nansum(vals * w, 0) / w.sum(0)


# ── what is known at a pricing date ─────────────────────────────────────────
class Ctx:
    def __init__(self, d0, n, lead=0):
        self.d0, self.n, self.p0 = d0, n, d0 - lead
        self.xP = Y0 + self.p0 / 12
        self.months = list(range(d0, d0 + n))
        self.step = [(k - self.p0) // 12 + 1 for k in self.months]
        self.ddays = np.where(VALID & (YM >= d0) & (YM < d0 + n))[0]
        self.pday = int(np.where(YM >= self.p0)[0][0])          # first day NOT known
        self.bd, self.xb, self.train = {}, {}, []
        for k in range(self.p0 // 12):
            d = np.where(VALID & (YM >= self.p0 - 12 * (k + 1)) & (YM < self.p0 - 12 * k))[0]
            self.bd[k], self.xb[k] = d, self.xP - k
            if len(d) >= 330 and (YEAR[d] == 2022).mean() < 0.5:
                self.train.append(k)
        self.train = sorted(self.train, reverse=True)           # oldest first, as the lists of years of the replays
        self.blk = np.full(ND, -1)
        for k, d in self.bd.items():
            self.blk[d] = k
        self._c = {}

    def cap(self, t, x):
        return cap_at(t, x, self.xP)

    def memo(self, key, fn):
        if key not in self._c:
            self._c[key] = fn()
        return self._c[key]

    def stats(self, k):
        """a block's hourly cells: mean price ratio, mean positive part, probability of a price >= THR"""
        return self.memo(('st', k), lambda: (cells(R, self.bd[k]), cells(np.where(POS, R, 0.0), self.bd[k]), cells(POS.astype(float), self.bd[k])))

    def profile(self, t, ks):
        """expected load factor by month x hour over the blocks ks (output / the block's end fleet), pooled over days"""
        s, n = np.zeros((12, 24)), np.zeros(12)
        for k in ks:
            d = self.bd[k]
            np.add.at(s, MON[d] - 1, VV[t][d] / (float(self.cap(t, self.xb[k])) * 1000))
            np.add.at(n, MON[d] - 1, 1)
        return s / n[:, None]


# ── 1, 2: the references ────────────────────────────────────────────────────
def m_dash(c, t, conv):
    V = VV[t]
    if conv == 'dash':
        sd = []
        for k in c.train:
            d = c.bd[k]
            p2 = P[d] > 0
            sd.append(1 - (V[d] * P[d] * p2).sum() / (V[d] * p2).sum() / P[d][p2].mean())
    else:
        sd = [1 - rate(c.bd[k], V, P, conv) for k in c.train]
    return [1 - float(np.percentile(sd, 74))] * c.n


def m_step(c, t, conv):
    V = VV[t]
    if conv == 'dash':
        r = []
        for k in c.train:
            d = c.bd[k]
            p2 = P[d] > 0
            r.append((V[d] * P[d] * p2).sum() / (V[d] * p2).sum() / P[d][p2].mean())
    else:
        r = [rate(c.bd[k], V, P, conv) for k in c.train]
    caps = [float(c.cap(t, c.xb[k])) for k in c.train]
    b = B.logfit(caps, r) if len(r) >= 2 else 0
    return [r[-1] + b * (math.log(float(c.cap(t, c.xP + s))) - math.log(caps[-1])) for s in c.step]


def ref_pred(c, t, fn, own):
    """a reference method: one figure per pseudo-year, no hourly curve, no curtailed volume"""
    return {'all': fn(c, t, 'all'), 'curt': fn(c, t, 'dash' if own else 'curt'), 'paid': [None] * c.n, 'negH': [None] * c.n, 'shape': None}


# ── 3: classic FPC (ppa_backtest_detail.m_fpc on blocks) ────────────────────
def fpc_core(c, t, half, seasonal, driver):
    V, tr = VV[t], c.train
    w = [0.5 ** ((k - tr[-1]) / half) if half else 1.0 for k in tr]
    co = wavg([c.stats(k)[0] for k in tr], w)
    co = np.where(np.isfinite(co), co, 1.0)
    mcb = []
    for k in tr:
        d = c.bd[k]
        yavg = P[d].mean()
        mcb.append([P[d[MON[d] == m]].mean() / yavg if (MON[d] == m).any() else np.nan for m in range(1, 13)])
    mc = wavg(mcb, w)
    mc = np.where(np.isfinite(mc), mc, 1.0)
    dd = c.ddays
    mi, jm = MON[dd] - 1, YM[dd] - c.d0
    sk = mc[mi][:, None] * co[mi, DT[dd], :]

    def forward(prof):
        pv = prof[mi]
        f = {'all': [], 'curt': [], 'paid': [], 'negH': [], 'shape': []}
        for j in range(c.n):
            q = jm == j
            s_, p_ = sk[q], pv[q]
            ok = s_ >= THR
            f['all'].append((p_ * s_).sum() / p_.sum() / s_.mean() - 1)
            f['curt'].append((p_ * s_ * ok).sum() / (p_ * ok).sum() / s_.mean() - 1)
            f['paid'].append((p_ * ok).sum() / p_.sum())
            f['negH'].append(float((~ok).sum()))
            f['shape'].append(s_.mean(0) / s_.mean())
        return f
    f = forward(c.profile(t, tr))
    # (3) decorrelated: the skeleton recalibrated on each realised month, block by block
    dec = np.full((ND, 24), np.nan)
    for k in tr:
        d = c.bd[k]
        cd = co[MON[d] - 1, DT[d], :]
        s, n = np.zeros(NYM), np.zeros(NYM)
        np.add.at(s, YM[d], cd.sum(1))
        np.add.at(n, YM[d], 24)
        dec[d] = cd / (s / np.maximum(n, 1))[YM[d]][:, None] * MAVG[YM[d]][:, None]
    groups = (SUMMER, ~SUMMER) if seasonal else (np.ones(12, bool),)
    caps = [float(c.cap(driver or t, c.xb[k])) for k in tr]
    dln = [math.log(float(c.cap(driver or t, c.xP + s))) - math.log(caps[-1]) for s in c.step]
    cs = {conv: [] for conv in ('all', 'curt')}
    for g in groups:
        for conv in cs:
            row = []
            for k in tr:
                d = c.bd[k][g[MON[c.bd[k]] - 1]]
                row.append(rate(d, V, P, conv) - rate(d, V, dec, conv))
            cs[conv].append(row)
    gm = np.array([0 if (not seasonal or SUMMER[k % 12]) else 1 for k in c.months])
    out = {'f': f, 'cs': cs, 'caps': caps, 'dln': dln, 'gm': gm, 'forward': forward, 'tr': tr}
    for conv in cs:
        bs = [B.logfit(caps, row) if len(tr) >= 3 else 0.0 for row in cs[conv]]
        out['b_' + conv] = bs
        out[conv] = [1 + f[conv][j] + cs[conv][gm[j]][-1] + bs[gm[j]] * dln[j] for j in range(c.n)]
    return out


def m_fpc(c, t, plain=False):
    o = c.memo(('fpc', t, plain), lambda: fpc_core(c, t, None, False, None) if plain else fpc_core(c, t, 1 if t == 's' else None, True, 's'))
    return {'all': o['all'], 'curt': o['curt'], 'paid': o['f']['paid'], 'negH': o['f']['negH'], 'shape': o['f']['shape']}


# ── 6: FPC with its projection simulated ────────────────────────────────────
def m_fpc_mc(c, t, n_draws, rng):
    o = c.memo(('fpc', t, False), lambda: fpc_core(c, t, 1 if t == 's' else None, True, 's'))
    tr, caps, n = o['tr'], np.array(o['caps']), len(o['tr'])
    x = np.log(caps)
    fk = [o['forward'](c.profile(t, [k])) for k in tr]            # the forward term on each weather year's own profile
    # fleet pace: realised yearly growth / the growth of the year before, on the year-ends known
    ys = [y for y in sorted(B.CAP['s']) if y + 1 <= c.xP + 1e-9]
    g = np.diff([B.CAP['s'][y] for y in ys])
    q = np.clip(g[1:] / np.maximum(g[:-1], 1e-6), 0.3, 3.0)[-6:]
    cap_last, capT = caps[-1], [float(c.cap('s', c.xP + s)) for s in c.step]
    smax = max(c.step)
    res = {}
    kp = rng.integers(0, n, n_draws)
    qd = q[rng.integers(0, len(q), n_draws)] if len(q) else np.ones(n_draws)
    boot = rng.integers(0, n, (n_draws, n))
    ie = rng.integers(0, max(n - 1, 1), (n_draws, smax))
    dln = np.array([[math.log(max(cap_last + (cT - cap_last) * qq, 0.5 * cap_last)) - math.log(cap_last) for cT in capT] for qq in qd])
    for conv in ('all', 'curt'):
        draws = np.zeros((n_draws, c.n))
        for gi, row in enumerate(o['cs'][conv]):
            row = np.array(row)
            b0 = o['b_' + conv][gi]
            inc = np.diff(row) - b0 * np.diff(x) if n >= 2 else np.zeros(1)      # year-to-year surprises around the trend
            bx, by = x[boot], row[boot]
            sxx = ((bx - bx.mean(1, keepdims=True)) ** 2).sum(1)
            with np.errstate(invalid='ignore', divide='ignore'):
                bb = ((bx - bx.mean(1, keepdims=True)) * (by - by.mean(1, keepdims=True))).sum(1) / sxx
            few = np.array([len(set(r_)) < 3 for r_ in boot]) | ~np.isfinite(bb)
            bb = np.where(few, b0, bb) if n >= 3 else np.zeros(n_draws)
            eta = np.cumsum(inc[ie], 1)                                          # surprises add up year after year
            for j in range(c.n):
                if o['gm'][j] == gi:
                    fj = np.array([fk[k][conv][j] for k in range(n)])[kp]
                    draws[:, j] = 1 + fj + row[-1] + bb * dln[:, j] + eta[:, c.step[j] - 1]
        res[conv] = np.clip(draws, 0.02, 1.6)
    base = m_fpc(c, t)
    return {'all': list(np.median(res['all'], 0)), 'curt': list(np.median(res['curt'], 0)), 'paid': base['paid'], 'negH': base['negH'],
            'shape': base['shape'], 'draws': res['curt']}


# ── 4: FPC with the cannibalisation inside the hourly curve ────────────────
INJ_HALF_LEVEL, INJ_HALF_SLOPE = 1.0, 2.0     # set before any result: level on the recent blocks, slope a little longer


def m_fpc_inj(c, t):
    V, tr = VV[t], c.train
    x = np.array([math.log(float(c.cap('s', c.xb[k]))) for k in tr])
    age = np.array([k - tr[-1] for k in tr], float)
    wl, ws = 0.5 ** (age / INJ_HALF_LEVEL), 0.5 ** (age / INJ_HALF_SLOPE)
    st = [c.stats(k) for k in tr]
    # slope of each figure on ln(solar GW), pooled by season x (weekday, weekend) x hour, within each cell across blocks
    grp = (~SUMMER).astype(int)[:, None] * 2 + np.array([0, 1, 1])[None, :]      # 12 x 3 -> 0..3
    slopes = []
    for i in range(3):
        Yk = np.array([s[i] for s in st])                                        # blocks x 12 x 3 x 24
        b = np.zeros((4, 24))
        if len(tr) >= 3:
            ok = np.isfinite(Yk)
            wk = ws[:, None, None, None] * ok
            xm = (wk * x[:, None, None, None]).sum(0) / wk.sum(0)
            ym_ = np.nansum(wk * np.where(ok, Yk, 0), 0) / wk.sum(0)
            dx, dy = x[:, None, None, None] - xm, np.where(ok, Yk, 0) - ym_
            num, den = (wk * dx * dy).sum(0), (wk * dx * dx).sum(0)
            for g in range(4):
                b[g] = num[grp == g].sum(0) / np.maximum(den[grp == g].sum(0), 1e-12)
        slopes.append(b[grp])                                                     # 12 x 3 x 24
    # weather covariance inside a cell: realised - the block's own cells priced on its mean output per cell
    kap = {k_: [] for k_ in ('all', 'curt', 'paid')}
    for g in (SUMMER, ~SUMMER):
        rows = {k_: [] for k_ in kap}
        for k, (A_, Bp, Q) in zip(tr, st):
            d = c.bd[k][g[MON[c.bd[k]] - 1]]
            vb = cells(V, c.bd[k])[MON[d] - 1, DT[d], :]
            a, bp, qq = A_[MON[d] - 1, DT[d], :], Bp[MON[d] - 1, DT[d], :], Q[MON[d] - 1, DT[d], :]
            rows['all'].append(rate(d, V, P, 'all') - (vb * a).sum() / vb.sum() / a.mean())
            rows['curt'].append(rate(d, V, P, 'curt') - (vb * bp).sum() / (vb * qq).sum() / a.mean())
            rows['paid'].append((V[d] * POS[d]).sum() / V[d].sum() - (vb * qq).sum() / vb.sum())
        for k_ in kap:
            b = B.logfit(np.exp(x), rows[k_]) if len(tr) >= 3 else 0.0
            kap[k_].append((np.array(rows[k_]), b))
    prof = c.profile(t, tr)
    dd = c.ddays
    mi, jm, dti = MON[dd] - 1, YM[dd] - c.d0, DT[dd]
    out = {k_: [] for k_ in ('all', 'curt', 'paid', 'negH', 'shape')}
    cur = {}
    for j in range(c.n):
        s = c.step[j]
        if s not in cur:
            xT = math.log(float(c.cap('s', c.xP + s)))
            tg = [wavg([st[i][f] + slopes[f] * (xT - x[i]) for i in range(len(tr))], wl) for f in range(3)]
            A_ = np.where(np.isfinite(tg[0]), tg[0], 1.0)
            Q = np.clip(np.where(np.isfinite(tg[2]), tg[2], 1.0), 0.0, 1.0)
            Bp = np.maximum(np.where(np.isfinite(tg[1]), tg[1], 1.0), np.maximum(A_, 0.0)) * (Q > 0)
            kp = [{k_: float(wavg(kap[k_][gi][0] + kap[k_][gi][1] * (xT - x), wl)) for k_ in kap} for gi in (0, 1)]
            cur[s] = (A_, Bp, Q, kp)
        A_, Bp, Q, kp = cur[s]
        q = jm == j
        a, bp, qq, pv = A_[mi[q], dti[q], :], Bp[mi[q], dti[q], :], Q[mi[q], dti[q], :], prof[mi[q]]
        kj = kp[0 if SUMMER[c.months[j] % 12] else 1]
        base = max(a.mean(), 0.2)
        paid = float(np.clip((pv * qq).sum() / pv.sum() + kj['paid'], 0.05, 1.0))
        out['all'].append((pv * a).sum() / pv.sum() / base + kj['all'])
        out['curt'].append((pv * bp).sum() / max((pv * qq).sum(), 1e-9) / base + kj['curt'])
        out['paid'].append(paid)
        out['negH'].append(float((1 - qq).sum()))
        out['shape'].append(a.mean(0) / a.mean())
    return out


# ── 5: corrected weather Monte Carlo ────────────────────────────────────────
WX = {'groups': 'month', 'floor': True, 'link': True}     # see docs/ppa_bench_results.md: both fixes chosen on the deliveries ended before 2024


def _price_model(c):
    """distribution of the hourly price ratio at a residual load, on the last two blocks, by time of day (night, day,
    evening) and by month (the month and its two neighbours: a rule learnt on a whole season mixes months whose
    average residual load differs, which flattens it) or by season (WX groups = 'season', as ppa_backtest_detail)"""
    d = np.concatenate([c.bd[k] for k in c.train[-2:]])
    d.sort()
    xr = ((L[d] - S[d] - W[d] - NAV[d][:, None]) / 1000).ravel()
    rr = R[d].ravel()
    hh = np.tile(np.arange(24), len(d))
    tod = np.select([hh < 9, hh < 17], [0, 1], 2)
    mm = np.repeat(MON[d] - 1, 24)
    qs = np.linspace(0, 1, 41)
    model, z, zok = {}, np.zeros(len(rr)), np.zeros(len(rr), bool)
    ng = 12 if WX['groups'] == 'month' else 2
    for gm in range(ng):
        near = (np.minimum((mm - gm) % 12, (gm - mm) % 12) <= 1) if ng == 12 else (SUMMER[mm].astype(int) == gm)
        for td in range(3):
            i = np.where(near & (tod == td))[0]
            o = i[np.argsort(xr[i])]
            nb = max(5, len(o) // 80)
            parts = np.array_split(o, nb)
            cen = np.array([xr[p].mean() for p in parts])
            tab = np.array([np.quantile(rr[p], qs) for p in parts])
            for p in parts:                                   # rank of each hour inside its bin, for the persistence
                own = p[mm[p] == gm] if ng == 12 else p
                z[own] = norm.ppf((np.searchsorted(np.sort(rr[p]), rr[own]) + 0.5) / (len(p) + 1))
                zok[own] = True
            lo, hi = o[:max(40, len(o) // 5)], o[-max(40, len(o) // 5):]
            model[gm * 3 + td] = {'cen': cen, 'edges': (cen[1:] + cen[:-1]) / 2, 'tab': tab,
                                  'lo': max(float(np.polyfit(xr[lo], rr[lo], 1)[0]), 0.0), 'hi': max(float(np.polyfit(xr[hi], rr[hi], 1)[0]), 0.0)}
    # at the same French residual load the price is lower when France's own wind and solar are high (the neighbours'
    # are too, and they are not in the residual load): the rank of the price inside its bin follows the load factors
    capd = {t: c.cap(t, XDAY) * 1000 for t in 'sw'}
    link = {}
    for td in range(3):
        i = np.where((tod == td) & zok)[0]
        cols, srt = [], []
        for t in 'ws':
            lf = (VV[t][d] / capd[t][d][:, None]).ravel()[i]
            so = np.sort(lf)
            srt.append(so)
            cols.append(norm.ppf((np.searchsorted(so, lf) + 0.5) / (len(so) + 1)))
        X = np.array(cols).T
        beta = np.linalg.lstsq(X, z[i], rcond=None)[0] if WX['link'] else np.zeros(2)
        e = z[i] - X @ beta
        z[i] = e / e.std()
        link[td] = {'beta': beta, 'sd': float(e.std()), 'sorted': srt}
    k = zok[1:] & zok[:-1]
    rho = float(np.clip(np.corrcoef(z[1:][k], z[:-1][k])[0, 1], 0.0, 0.98))
    # negative prices stay close to zero once plants stop (ppa_floor_test.py): never below the lowest 1 % seen, at least -5 % of the month's average
    floor = min(float(np.quantile(rr, 0.01)), -0.05) if WX['floor'] else -np.inf
    return model, rho, floor, link


def wx_sim(c, n_sims, rng):
    """both technologies from the same simulated periods"""
    T = c.ddays
    nT = len(T)
    recent = set(c.train[-2:])
    src_w, src_n = np.zeros((n_sims, nT), int), np.zeros((n_sims, nT), int)
    for w0 in range(0, nT, 7):
        ln_ = min(7, nT - w0)
        cw, cn = [], []
        for k in range(12):
            for s in (-2, -1, 0, 1, 2):
                a = int(T[w0]) - 364 * (k + 1) + 7 * s              # same weekday, same season
                if a < 0 or a + ln_ > c.pday or not VALID[a:a + ln_].all():
                    continue
                cw.append(a)
                if abs(s) <= 1 and c.blk[a] in recent and c.blk[a + ln_ - 1] in recent:
                    cn.append(a)
        cn = cn or cw
        pw, pn = rng.integers(0, len(cw), n_sims), rng.integers(0, len(cn), n_sims)
        src_w[:, w0:w0 + ln_] = np.array(cw)[pw][:, None] + np.arange(ln_)[None, :]
        src_n[:, w0:w0 + ln_] = np.array(cn)[pn][:, None] + np.arange(ln_)[None, :]
    capd = {t: c.cap(t, XDAY) * 1000 for t in 'sw'}                 # the fleet of each past and delivery day (MW)
    lf = {t: VV[t][src_w] / capd[t][src_w][:, :, None] for t in 'sw'}
    lb = {k: L[d].mean() for k, d in c.bd.items() if len(d)}
    lref = lb[c.train[-1]]
    lvl = np.array([lref / lb[k] if k in lb else 1.0 for k in range(-1, max(lb) + 1)])   # index blk + 1
    load = L[src_w] * lvl[c.blk[src_w] + 1][:, :, None]
    prod = {t: lf[t] * capd[t][T][None, :, None] for t in 'sw'}
    x = (load - prod['s'] - prod['w'] - NAV[src_n][:, :, None]) / 1000
    model, rho, floor, link = c.memo('pm', lambda: _price_model(c))
    eps = rng.standard_normal((n_sims, nT * 24))
    zz = lfilter([math.sqrt(1 - rho * rho)], [1, -rho], eps, axis=1).reshape(n_sims, nT, 24)
    for td, hs in enumerate((slice(0, 9), slice(9, 17), slice(17, 24))):
        lk = link[td]
        zz[:, :, hs] *= lk['sd']
        for bi, t in enumerate('ws'):
            so = lk['sorted'][bi]
            zz[:, :, hs] += lk['beta'][bi] * norm.ppf((np.searchsorted(so, lf[t][:, :, hs]) + 0.5) / (len(so) + 1))
    u = norm.cdf(zz)
    gmon = (MON[T] - 1) if WX['groups'] == 'month' else SUMMER[MON[T] - 1].astype(int)
    g = (gmon * 3)[:, None] + np.select([np.arange(24) < 9, np.arange(24) < 17], [0, 1], 2)[None, :]
    r = np.zeros_like(x)
    for gi, m in model.items():
        k = np.broadcast_to(g == gi, x.shape)
        xx, uu = x[k], u[k] * 40
        b = np.searchsorted(m['edges'], xx)
        lo = np.minimum(uu.astype(int), 39)
        v = m['tab'][b, lo] * (1 - (uu - lo)) + m['tab'][b, lo + 1] * (uu - lo)
        v += m['lo'] * np.minimum(xx - m['cen'][0], 0) + m['hi'] * np.maximum(xx - m['cen'][-1], 0)
        r[k] = np.maximum(v, floor)
    jm = YM[T] - c.d0
    res = {}
    for t in 'sw':
        o = {k_: [] for k_ in ('all', 'curt', 'paid', 'negH', 'shape')}
        draws = np.zeros((n_sims, c.n))
        for j in range(c.n):
            q = jm == j
            rj, vj = r[:, q, :], prod[t][:, q, :]
            ok = rj >= THR
            base = np.maximum(rj.mean((1, 2)), 0.2)
            e = vj.sum((1, 2))
            ep = np.maximum((vj * ok).sum((1, 2)), 1e-9)
            cu = (vj * rj * ok).sum((1, 2)) / ep / base
            draws[:, j] = cu
            o['all'].append(float(((vj * rj).sum((1, 2)) / e / base).mean()))
            o['curt'].append(float(cu.mean()))
            o['paid'].append(float((ep / e).mean()))
            o['negH'].append(float((~ok).sum((1, 2)).mean()))
            sh = rj.mean((0, 1))
            o['shape'].append(sh / sh.mean())
        o['draws'] = draws
        res[t] = o
    return res


# ── scoring: one grid for every method ──────────────────────────────────────
def evaluate(c, t, pred):
    act = [TRUTH[(t, k)] for k in c.months]
    w = np.array([a['mwh'] * a['paid'] for a in act])
    base = np.array([a['base'] for a in act])
    ac = np.array([a['curt'] for a in act])
    pc = np.array(pred['curt'], float)
    e = (pc - ac) * base
    o = {'err': float((w * e).sum() / w.sum()), 'pts': float((w * (pc - ac)).sum() / w.sum() * 100),
         'value': float((w * ac * base).sum() / w.sum()), 'rate': float((w * pc).sum() / w.sum()), 'base': float((w * base).sum() / w.sum()), 'months': [round(float(v), 3) for v in e],
         'mpts': [round(float(v) * 100, 2) for v in pc - ac]}
    qk = np.array(c.months) // 3
    o['quarters'] = [round(float((w[qk == q] * e[qk == q]).sum() / w[qk == q].sum()), 3) for q in np.unique(qk)]
    wa = np.array([a['mwh'] for a in act])
    o['err_all'] = float((wa * (np.array(pred['all'], float) - np.array([a['all'] for a in act])) * base).sum() / wa.sum())
    if pred.get('shape') is not None:
        sh = np.array([(a['wh'] * np.abs(np.asarray(s_) - a['shape'])).sum() for a, s_ in zip(act, pred['shape'])])
        o['shape'] = float((wa * sh).sum() / wa.sum() * 100)                 # % of the month's baseload, output-weighted
        o['shape_eur'] = float((wa * sh * base).sum() / wa.sum())
    if pred['paid'][0] is not None:
        o['paid_pts'] = float((wa * (np.array(pred['paid'], float) - np.array([a['paid'] for a in act]))).sum() / wa.sum() * 100)
        o['negH'] = [float(np.sum(pred['negH'])), int(sum(a['negH'] for a in act))]
        o['paid'] = float((wa * np.array(pred['paid'], float)).sum() / wa.sum())
    if pred.get('draws') is not None:
        vals = (pred['draws'] * (w * base)[None, :]).sum(1) / w.sum() - o['value']      # the draws' errors, EUR/MWh
        o['mc'] = [round(float(np.percentile(vals, q)), 3) for q in (10, 25, 50, 75, 90)]
        o['pit'] = float((vals < 0).mean())                                           # share of draws below the realised
    return o


# the lowest mean |error| on the deliveries ENDED before 2024 (pick_hybrid), judged on the later ones; the hourly
# curve and the stopped volume come from fpc_inj (lowest shape and paid-share errors of the methods without draws)
HYBRID = {'s': ('step_curt', 'fpc_mc'), 'w': ('fpc_inj', 'wx_mc', 'fpc_mc')}
REFS = ('dash', 'dash_curt', 'step', 'step_curt')
CANDIDATES = ('step_curt', 'fpc', 'fpc_inj', 'wx_mc', 'fpc_mc')


def combine(preds, names):
    o = {k_: list(np.mean([np.array(preds[n][k_], float) for n in names], 0)) for k_ in ('all', 'curt')}
    o.update({k_: preds['fpc_inj'][k_] for k_ in ('paid', 'negH', 'shape')})
    return o


def windows(lengths=LENGTHS):
    out = []
    for d0 in range(FIRST_START, LAST_YM + 1, 3):
        for n in lengths:
            if d0 + n - 1 > LAST_YM:
                continue
            if any((Y0 + k // 12) == 2022 for k in range(d0, d0 + n)):
                continue
            out.append((d0, n))
    return out


def family(d0, n):
    if n == 12:
        return 'cal12' if d0 % 12 == 0 else 'roll12'
    return f'm{n}'


def run(n_sims, lead, lengths=LENGTHS, verbose=True):
    rows = []
    for d0, n in windows(lengths):
        c = Ctx(d0, n, lead)
        if len(c.train) < 3:
            continue
        rng = np.random.default_rng(1000 * d0 + n)
        wx = wx_sim(c, n_sims, rng)
        for t in 'sw':
            preds = {'dash': ref_pred(c, t, m_dash, True), 'dash_curt': ref_pred(c, t, m_dash, False),
                     'step': ref_pred(c, t, m_step, True), 'step_curt': ref_pred(c, t, m_step, False),
                     'fpc_plain': m_fpc(c, t, True), 'fpc': m_fpc(c, t), 'fpc_inj': m_fpc_inj(c, t), 'wx_mc': wx[t],
                     'fpc_mc': m_fpc_mc(c, t, 2000, rng)}
            preds['hybrid'] = combine(preds, HYBRID[t])
            row = {'tech': TECH[t], 'start': ymlabel(d0), 'n': n, 'family': family(d0, n), 'priced': ymlabel(c.p0), 'd0': d0,
                   'blocks': len(c.train), 'm': {k: evaluate(c, t, p) for k, p in preds.items()}}
            rows.append(row)
            if verbose:
                print(f"{TECH[t]:5s} {row['start']} {n:2d}m  value {row['m']['fpc']['value']:6.1f} | " +
                      ' '.join(f"{k} {v['err']:+.1f}" for k, v in row['m'].items()), flush=True)
    return rows


# ── tables ──────────────────────────────────────────────────────────────────
def dist(v):
    v = np.array(v, float)
    return {'n': len(v), 'bias': float(v.mean()), 'mae': float(np.abs(v).mean()), 'p10': float(np.percentile(v, 10)),
            'p50': float(np.percentile(v, 50)), 'p90': float(np.percentile(v, 90)), 'min': float(v.min()), 'max': float(v.max())}


def summarise(rows, fams=('cal12', 'roll12', 'm20', 'm6', 'all')):
    out = {}
    methods = list(rows[0]['m'])
    for tech in ('solar', 'wind'):
        for fam in fams:
            rs = [r for r in rows if r['tech'] == tech and (fam == 'all' or r['family'] == fam)]
            if not rs:
                continue
            for k in methods:
                ms = [r['m'][k] for r in rs]
                s = dist([m['err'] for m in ms])
                s['pts'] = dist([m['pts'] for m in ms])
                s['mae_q'] = float(np.mean([abs(x) for m in ms for x in m['quarters']]))
                s['mae_m'] = float(np.mean([abs(x) for m in ms for x in m['months']]))
                s['month'] = dist([x for m in ms for x in m['months']])
                s['quarter'] = dist([x for m in ms for x in m['quarters']])
                s['mae_all'] = float(np.mean([abs(m['err_all']) for m in ms]))
                if 'shape' in ms[0]:
                    s['shape'], s['shape_eur'] = float(np.mean([m['shape'] for m in ms])), float(np.mean([m['shape_eur'] for m in ms]))
                if 'paid_pts' in ms[0]:
                    s['paid_bias'], s['paid_mae'] = float(np.mean([m['paid_pts'] for m in ms])), float(np.mean([abs(m['paid_pts']) for m in ms]))
                    s['negH'] = [float(np.mean([m['negH'][0] for m in ms])), float(np.mean([m['negH'][1] for m in ms]))]
                if 'mc' in ms[0]:
                    s['cover80'] = float(np.mean([m['mc'][0] <= 0 <= m['mc'][4] for m in ms]))    # realised inside the draws' P10-P90
                    s['cover50'] = float(np.mean([m['mc'][1] <= 0 <= m['mc'][3] for m in ms]))
                    s['width80'] = float(np.mean([m['mc'][4] - m['mc'][0] for m in ms]))
                out.setdefault(tech, {}).setdefault(fam, {})[k] = s
    return out


def pick_hybrid(rows, before=(2024 - Y0) * 12):
    """the pair or trio of candidates with the lowest mean |error| on the deliveries that ENDED before 2024 (monthly
    means of the stored errors: the average of methods has the average of their errors)"""
    import itertools
    res = {}
    for tech in ('solar', 'wind'):
        rs = [r for r in rows if r['tech'] == tech and r['d0'] + r['n'] <= before]
        for k in (1, 2, 3):
            for combo in itertools.combinations(CANDIDATES, k):
                res[(tech, combo)] = (float(np.mean([abs(np.mean([r['m'][m]['err'] for m in combo])) for r in rs])), len(rs))
    return res


QS = (10, 25, 50, 75, 90)


def band(rows, method='hybrid', min_past=6):
    """the band and how often it held, on the method's errors in capture points (prediction - realised, % of baseload).
    'walk': at each pricing date the quantiles of the errors of the same technology's deliveries already finished,
    applied to the new delivery; 'k80': how much that band must be widened around its median for 80 % of the realised
    to fall inside. 'final': the quantiles on every delivery, on those starting from 2023 and by length, to build
    today's band:  price at quantile q = (central capture - error_q) x forward"""
    out = {}
    for tech in ('solar', 'wind'):
        rs = sorted([r for r in rows if r['tech'] == tech], key=lambda r: r['d0'])
        cases = []
        for r in rs:
            past = [q['m'][method]['pts'] for q in rs if q['d0'] + q['n'] <= r['d0']]
            if len(past) >= min_past:
                cases.append((np.percentile(past, QS), r['m'][method]['pts'], r['m'][method]['base']))

        def held(k):
            h = [(q[2] + k * (q[0] - q[2]) <= e <= q[2] + k * (q[4] - q[2]), q[2] + k * (q[1] - q[2]) <= e <= q[2] + k * (q[3] - q[2]),
                  e <= q[2] + k * (q[3] - q[2]), e <= q[2] + k * (q[4] - q[2]), k * (q[4] - q[0]) / 100 * b) for q, e, b in cases]
            return np.array(h, float).mean(0)
        h = held(1.0)
        k80 = next((float(k) for k in np.arange(1.0, 8.01, 0.25) if held(k)[0] >= 0.8), None)

        def fin(sel):
            return {'n': len(sel), 'q': [float(v) for v in np.percentile([r['m'][method]['pts'] for r in sel], QS)]} if len(sel) >= 5 else None
        r23 = [r for r in rs if r['d0'] >= (2023 - Y0) * 12]
        out[tech] = {'walk': {'n': len(cases), 'inside80': float(h[0]), 'inside50': float(h[1]), 'held_p75': float(h[2]), 'held_p90': float(h[3]),
                              'width_eur': float(h[4]), 'k80': k80, 'width_eur_k80': float(held(k80)[4]) if k80 else None},
                     'final': fin(rs), 'final2023': fin(r23), 'final2023_n': {n: fin([r for r in r23 if r['n'] == n]) for n in LENGTHS}}
    return out


def md(out):
    """the tables of docs/ppa_bench_results.md"""
    S_, rows = out['summary'], out['rows']
    f = lambda v, p=2, sg=False: '' if v is None or (isinstance(v, float) and math.isnan(v)) else (f'{v:+.{p}f}' if sg else f'{v:.{p}f}')
    L_ = []
    for tech in ('solar', 'wind'):
        for fam, lab in (('all', 'toutes livraisons'), ('cal12', 'annees civiles'), ('roll12', '12 mois non civils'), ('m20', '20 mois'), ('m6', '6 mois')):
            d = S_[tech][fam]
            L_.append(f"\n**{tech}, {lab} (n = {next(iter(d.values()))['n']})**\n")
            L_.append('| methode | biais | MAE | P10 | P50 | P90 | MAE trim. | MAE mois | forme horaire % | part payee (pts) | h < 0 prevues / reelles | couverture P10-P90 des tirages |')
            L_.append('|---|---|---|---|---|---|---|---|---|---|---|---|')
            for k, s in d.items():
                L_.append(f"| {k} | {f(s['bias'], 2, True)} | {f(s['mae'])} | {f(s['p10'], 1, True)} | {f(s['p50'], 1, True)} | {f(s['p90'], 1, True)} | {f(s['mae_q'])} | {f(s['mae_m'])} | "
                          f"{f(s.get('shape'), 1)} | {f(s.get('paid_bias'), 1, True)} | {'%.0f / %.0f' % tuple(s['negH']) if 'negH' in s else ''} | {f(s['cover80'] * 100, 0) + ' %' if 'cover80' in s else ''} |")
    L_.append('\n**Avant / apres la rupture (livraisons finies avant 2024, puis les autres), MAE et biais en EUR/MWh**\n')
    L_.append('| methode | solaire avant | solaire apres | eolien avant | eolien apres |')
    L_.append('|---|---|---|---|---|')
    cut = (2024 - Y0) * 12
    for k in rows[0]['m']:
        cells_ = []
        for tech in ('solar', 'wind'):
            for post in (False, True):
                v = [r['m'][k]['err'] for r in rows if r['tech'] == tech and (r['d0'] + r['n'] > cut) == post]
                cells_.append(f'{np.mean(np.abs(v)):.2f} ({np.mean(v):+.2f}), n={len(v)}')
        L_.append(f'| {k} | ' + ' | '.join(cells_) + ' |')
    L_.append('\n**Erreur mensuelle par saison (MAE EUR/MWh, toutes livraisons)**\n')
    L_.append('| methode | solaire ete | solaire hiver | eolien ete | eolien hiver |')
    L_.append('|---|---|---|---|---|')
    for k in rows[0]['m']:
        cells_ = []
        for tech in ('solar', 'wind'):
            for summer in (True, False):
                v = [e for r in rows if r['tech'] == tech for j, e in enumerate(r['m'][k]['months']) if SUMMER[(r['d0'] + j) % 12] == summer]
                cells_.append(f'{np.mean(np.abs(v)):.2f} ({np.mean(v):+.2f})')
        L_.append(f'| {k} | ' + ' | '.join(cells_) + ' |')
    L_.append('\n**Realise par annee et par convention (taux de capture, % du baseload)**\n')
    L_.append('| annee | h < 0 | h <= 0 | solaire: tout paye | arret < 0 | arret <= 0 | PPA Dashboard | eolien: tout paye | arret < 0 | arret <= 0 | PPA Dashboard |')
    L_.append('|---|---|---|---|---|---|---|---|---|---|---|')
    for y in sorted(set(YEAR)):
        d = np.where(VALID & (YEAR == y))[0]
        p = P[d]
        row = [str(y) + (' (au ' + DD[d[-1]].isoformat() + ')' if y == date.today().year else ''), str(int((p < 0).sum())), str(int((p <= 0).sum()))]
        for t in 'sw':
            v, p2 = VV[t][d], p > 0
            row += [f'{rate(d, v_, P, c_) * 100:.1f}' for v_, c_ in ((VV[t], 'all'), (VV[t], 'curt'))]
            row += [f'{(v * p * p2).sum() / (v * p2).sum() / p.mean() * 100:.1f}', f'{(v * p * p2).sum() / (v * p2).sum() / p[p2].mean() * 100:.1f}']
        L_.append('| ' + ' | '.join(row) + ' |')
    L_.append('\n**Bande (erreurs de la methode hybride, points de capture)**\n')
    L_.append('| techno | n (walk-forward) | realise dans P10-P90 | dans P25-P75 | prix P75 tenu | prix P90 tenu | largeur P10-P90 EUR/MWh | facteur pour 80 % | largeur elargie | q10 / q25 / q50 / q75 / q90, toutes | idem, livraisons depuis 2023 |')
    L_.append('|---|---|---|---|---|---|---|---|---|---|---|')
    for tech, b in out['band'].items():
        w = b['walk']
        L_.append(f"| {tech} | {w['n']} | {w['inside80'] * 100:.0f} % | {w['inside50'] * 100:.0f} % | {w['held_p75'] * 100:.0f} % | {w['held_p90'] * 100:.0f} % | {w['width_eur']:.1f} | x {w['k80']} | {w['width_eur_k80']:.1f} | "
                  + ' / '.join(f'{v:+.1f}' for v in b['final']['q']) + f" (n={b['final']['n']}) | " + ' / '.join(f'{v:+.1f}' for v in b['final2023']['q']) + f" (n={b['final2023']['n']}) |")
    L_.append('')
    L_.append('| techno | duree | n | q10 | q25 | q50 | q75 | q90 |')
    L_.append('|---|---|---|---|---|---|---|---|')
    for tech, b in out['band'].items():
        for n, v in b['final2023_n'].items():
            if v:
                L_.append(f"| {tech} | {n} mois | {v['n']} | " + ' | '.join(f'{x:+.1f}' for x in v['q']) + ' |')
    return '\n'.join(L_)


def check():
    """a calendar year through the block formulas = ppa_backtest_detail on the same year"""
    _a, sys.argv = sys.argv, ['x']
    import ppa_backtest_detail as BD
    sys.argv = _a
    worst = 0.0
    for Y in (2021, 2024, 2025):
        c = Ctx((Y - Y0) * 12, 12)
        train = [y for y in B.YEARS if y < Y and y != 2022]
        for t in 'sw':
            V = B.S if t == 's' else B.W
            _, fm, _ = BD.m_fpc(t, Y, train, V, 'all')
            mine = m_fpc(c, t)['all']
            d = max(abs(mine[m - 1] - fm[m]) for m in range(1, 13))
            s1, s2 = BD.m_step(t, Y, train, V, 'all'), m_step(c, t, 'all')[0]
            d1, d2 = BD.m_dashboard(t, Y, train, V, 'all'), m_dash(c, t, 'all')[0]
            worst = max(worst, d, abs(s1 - s2), abs(d1 - d2))
            print(f'{TECH[t]} {Y}: fpc monthly max gap {d:.5f} | step {s1:.4f} vs {s2:.4f} | dashboard {d1:.4f} vs {d2:.4f}')
    print('worst gap', worst)
    return worst < 5e-3


def main():
    if '--check' in sys.argv:
        sys.exit(0 if check() else 1)
    n_sims = int(sys.argv[sys.argv.index('--sims') + 1]) if '--sims' in sys.argv else 100
    lead = int(sys.argv[sys.argv.index('--lead') + 1]) if '--lead' in sys.argv else 0
    rows = run(n_sims, lead)
    summ = summarise(rows)
    out = {'updated': date.today().isoformat(), 'lead': lead, 'sims': n_sims, 'stop_below': THR, 'last_month': ymlabel(LAST_YM),
           'note': 'err = predicted - realised value of one produced MWh (EUR/MWh), plant stopped below 0, realised monthly baseload as the forward; pts = the same in points of baseload',
           'hybrid': {TECH[t]: list(v) for t, v in HYBRID.items()}, 'summary': summ, 'band': band(rows), 'rows': rows,
           'pick': {f'{k[0]}|{"+".join(k[1])}': v for k, v in pick_hybrid(rows).items()},
           'truth_years': {TECH[t]: {y: {k_: round(float(np.average([TRUTH[(t, k)][k_] for k in range((y - Y0) * 12, (y - Y0) * 12 + 12) if (t, k) in TRUTH],
                                                                    weights=[TRUTH[(t, k)]['mwh'] for k in range((y - Y0) * 12, (y - Y0) * 12 + 12) if (t, k) in TRUTH])), 4)
                                             for k_ in ('paid',)} for y in range(Y0, date.today().year + 1)} for t in 'sw'}}
    name = OUT if lead == 0 and THR == 0 else OUT.replace('.json', (f'_lead{lead}' if lead else '') + ('_stop_le0' if THR > 0 else '') + '.json')
    with open(name, 'w') as f:
        json.dump(out, f, separators=(',', ':'), default=float)
    for tech in summ:
        for fam in summ[tech]:
            print(f'\n{tech} {fam} (n={next(iter(summ[tech][fam].values()))["n"]})  EUR/MWh: bias MAE P10 P50 P90 | MAE quarter, month | shape % | paid pts | cover80')
            for k, s in summ[tech][fam].items():
                print(f"  {k:10s} {s['bias']:+6.2f} {s['mae']:5.2f} {s['p10']:+6.2f} {s['p50']:+6.2f} {s['p90']:+6.2f} | {s['mae_q']:5.2f} {s['mae_m']:5.2f} | "
                      f"{s.get('shape', float('nan')):5.1f} | {s.get('paid_bias', float('nan')):+5.1f} | {s.get('cover80', float('nan')):.2f}")
    print('band', out['band'])
    if '--md' in sys.argv:
        print(md(out))
    print('wrote', name)


if __name__ == '__main__':
    main()
