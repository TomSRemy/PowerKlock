#!/usr/bin/env python3
"""Day-ahead arbitrage value of a grid battery in France, per delivery day.

Reads the French day-ahead prices already in the repository (data/history/daily/<D>.json, 96 quarter-hours,
Paris delivery day) and writes data/history/bess_da.json: what 1 MW of battery (1 h, 2 h and 4 h) earns on the
day-ahead market alone, month by month since 2022 and day by day for the last 120 days.

Method (one delivery day at a time, so nothing is known about the days after it):
  * "perfect": linear programme (HiGHS). The battery sees the day's 96 prices and picks the best charge / discharge
    schedule under its limits. Day-ahead prices are published before the day starts, so this is the upper bound of what
    a well-built set of day-ahead bids can reach on the day, not a forecast.
  * "naive": no price knowledge of the day. It charges in the h cheapest and discharges in the h dearest hours of the
    average profile of the previous 30 days (h = the duration in hours), then is paid at the real prices.
    This is a floor that any trading desk beats.
The truth for a real battery sits between the two (bid curves, forecast errors, exclusive blocks, intraday re-trading).

Modelling choices that differ from a monthly "perfect foresight" run (and why):
  * horizon = the delivery day: a monthly horizon lets the battery shift energy to a day whose prices are not yet
    known when the day-ahead bids for the first day must be placed, which inflates the result;
  * losses on both legs (eta = sqrt(round-trip efficiency)), the grid fee on the energy drawn from the grid
    (charge / eta is NOT used: the variable is the grid-side power, the battery stores eta x that);
  * wear cost per MWh discharged is inside the objective (the schedule changes with it), reported separately: the
    "gross" figures use wear = 0, the "net" ones the wear cost below;
  * a cap on full cycles per day (warranty) and a start = end state of charge, so every day stands alone.
Not modelled: ancillary services, intraday, imbalance, degradation of capacity, ramp limits, market impact.

    python scripts/bess_optim.py            # incremental: the last 10 days, the rest is kept
    python scripts/bess_optim.py --full     # everything again from 2022-01-01
"""
import argparse
import bisect
import glob
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
OUT = os.path.join(ROOT, 'data', 'history', 'bess_da.json')

START = '2022-01-01'
DURATIONS = (1, 2, 4)          # hours of energy per MW of power
PARAMS = {
    'rte': 0.85,               # round-trip efficiency (AC to AC), the convention of the Battery spreads section
    'soc_min': 0.0, 'soc_max': 1.0,   # usable window of the rated energy (rated energy = usable energy)
    'soc_start': 0.5,          # start = end of every day
    'max_cycles_day': 2.0,     # full equivalent cycles per day
    'grid_withdrawal': 7.0,    # EUR/MWh paid on energy drawn from the grid (TURPE, HTB, off-peak mix) - assumption
    'grid_injection': 0.0,     # EUR/MWh on injection (nil at HTB) - assumption
    'wear': 15.0,              # EUR per MWh discharged: battery price / lifetime throughput - assumption
    'trailing_days': 30,       # window of the naive schedule
}
DT = 0.25                      # hours per step (96 quarter-hours)


def day_prices(path):
    """96 FR quarter-hour prices of one file, or None if the day is incomplete."""
    try:
        z = json.load(open(path))['zones'].get('FR')
    except (OSError, ValueError, KeyError):
        return None
    if not z or not z.get('hourly') or len(z['hourly']) != 96 or any(v is None for v in z['hourly']):
        return None
    return np.array(z['hourly'], dtype=float)


def optimise_day(p, hours, wear, prm=PARAMS, detail=False):
    """Best schedule of 1 MW / `hours` MWh on prices p (EUR/MWh, T steps). Returns (revenue EUR, MWh discharged),
    and with detail=True also the schedule: MW drawn from the grid, MW sent to it, state of charge (MWh) per step."""
    T = len(p)
    eta = prm['rte'] ** 0.5
    e = float(hours)
    s0 = prm['soc_start'] * e
    gw, gi = prm['grid_withdrawal'], prm['grid_injection']
    # x = [c_0..c_T-1 (MW from grid), d_0..d_T-1 (MW to grid), s_1..s_T (MWh)]
    cost = np.concatenate([(p + gw) * DT, -(p - gi - wear) * DT, np.zeros(T)])
    rows, cols, vals = [], [], []
    for t in range(T):
        rows += [t, t, t]
        cols += [t, T + t, 2 * T + t]
        vals += [-eta * DT, DT / eta, 1.0]
        if t:
            rows.append(t)
            cols.append(2 * T + t - 1)
            vals.append(-1.0)
    A_eq = coo_matrix((vals, (rows, cols)), shape=(T, 3 * T)).tocsr()
    b_eq = np.zeros(T)
    b_eq[0] = s0
    bounds = [(0, 1.0)] * (2 * T) + [(prm['soc_min'] * e, prm['soc_max'] * e)] * (T - 1) + [(s0, s0)]
    # discharged energy per day <= cycles x energy
    A_ub = coo_matrix(([DT] * T, ([0] * T, list(range(T, 2 * T)))), shape=(1, 3 * T)).tocsr()
    r = linprog(cost, A_ub=A_ub, b_ub=[prm['max_cycles_day'] * e], A_eq=A_eq, b_eq=b_eq, bounds=bounds, method='highs')
    if not r.success:
        return None
    c, d = r.x[:T], r.x[T:2 * T]
    rev = float(np.sum((p - gi) * d * DT) - np.sum((p + gw) * c * DT))
    if detail:
        return rev, float(np.sum(d) * DT), c, d, r.x[2 * T:]
    return rev, float(np.sum(d) * DT)


def cooptimise_day(p, fcr, hours, wear, prm=PARAMS, res_h=0.25, cap=1.0, afrr=None, res_a=1.0):
    """Day-ahead, FCR and (optionally) aFRR capacity in one schedule of 1 MW / `hours` MWh.
    p: 96 quarter-hour prices (EUR/MWh); fcr: the 6 FCR block prices (EUR per MW per 4-hour block), or None;
    afrr: {'up': 6 block prices, 'down': 6 block prices} in EUR per MW per hour (4-hour blocks), or None.
    In each block the battery holds f MW for FCR (symmetric), u MW of upward and w MW of downward aFRR, and trades
    the rest: discharge + f + u <= 1 and charge + f + w <= 1 at every quarter-hour. The state of charge keeps res_h
    hours of f both ways (15 minutes of full FCR activation) and res_a hours of u below / of w above (1 hour of aFRR
    by default, a cautious reading of the prequalification of storage). Activation energy is left out (FCR about
    energy-neutral; aFRR activation is paid on its own market, not modelled). cap: the most MW FCR may take
    (1 = price taker). Wear is paid per MWh discharged.
    Returns (day-ahead revenue EUR, FCR revenue EUR, MWh discharged, mean MW in FCR, aFRR revenue EUR,
    mean MW in aFRR up, mean MW in aFRR down) or None."""
    T = len(p)
    B = 6
    per = T // B
    fcr = np.zeros(B) if fcr is None else np.asarray(fcr, dtype=float)
    au = np.zeros(B) if not afrr else np.asarray(afrr.get('up') or [0] * B, dtype=float) * 24 / B   # EUR/MW/h → per block
    ad = np.zeros(B) if not afrr else np.asarray(afrr.get('down') or [0] * B, dtype=float) * 24 / B
    eta = prm['rte'] ** 0.5
    e = float(hours)
    s0 = prm['soc_start'] * e
    gw, gi = prm['grid_withdrawal'], prm['grid_injection']
    F, U, Wd = 3 * T, 3 * T + B, 3 * T + 2 * B
    n = 3 * T + 3 * B
    # x = [c (T), d (T), s (T), f (B), u (B), w (B)]
    cost = np.concatenate([(p + gw) * DT, -(p - gi - wear) * DT, np.zeros(T), -fcr, -au, -ad])
    rows, cols, vals = [], [], []
    for t in range(T):
        rows += [t, t, t]
        cols += [t, T + t, 2 * T + t]
        vals += [-eta * DT, DT / eta, 1.0]
        if t:
            rows.append(t)
            cols.append(2 * T + t - 1)
            vals.append(-1.0)
    A_eq = coo_matrix((vals, (rows, cols)), shape=(T, n)).tocsr()
    b_eq = np.zeros(T)
    b_eq[0] = s0
    ur, uc, uv, ub = [], [], [], []
    k = 0

    def row(pairs, rhs):
        nonlocal k
        for var, coef in pairs:
            ur.append(k)
            uc.append(var)
            uv.append(coef)
        ub.append(rhs)
        k += 1
    for t in range(T):
        bk = t // per
        row([(T + t, 1.0), (F + bk, 1.0), (U + bk, 1.0)], 1.0)                       # discharge + FCR + aFRR up <= 1
        row([(t, 1.0), (F + bk, 1.0), (Wd + bk, 1.0)], 1.0)                          # charge + FCR + aFRR down <= 1
        row([(2 * T + t, -1.0), (F + bk, res_h), (U + bk, res_a)], -prm['soc_min'] * e)   # energy kept to go up
        row([(2 * T + t, 1.0), (F + bk, res_h), (Wd + bk, res_a)], prm['soc_max'] * e)    # room kept to go down
    row([(T + t, DT) for t in range(T)], prm['max_cycles_day'] * e)                   # cycles
    A_ub = coo_matrix((uv, (ur, uc)), shape=(k, n)).tocsr()
    zero = (0, 0)
    bounds = ([(0, 1.0)] * (2 * T) + [(prm['soc_min'] * e, prm['soc_max'] * e)] * (T - 1) + [(s0, s0)]
              + [(0, cap) if fcr.any() else zero] * B + [(0, 1.0) if au.any() else zero] * B + [(0, 1.0) if ad.any() else zero] * B)
    r = linprog(cost, A_ub=A_ub, b_ub=ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method='highs')
    if not r.success:
        return None
    c, d = r.x[:T], r.x[T:2 * T]
    f, u, w = r.x[F:F + B], r.x[U:U + B], r.x[Wd:Wd + B]
    da = float(np.sum((p - gi) * d * DT) - np.sum((p + gw) * c * DT))
    return da, float(np.dot(fcr, f)), float(np.sum(d) * DT), float(np.mean(f)), float(np.dot(au, u) + np.dot(ad, w)), float(np.mean(u)), float(np.mean(w))

def naive_day(p, trailing, hours, prm=PARAMS):
    """Fixed schedule from the average profile of the previous days; paid at the real prices of the day."""
    T = len(p)
    eta = prm['rte'] ** 0.5
    e = float(hours)
    prof = trailing.reshape(24, 4).mean(axis=1)            # EUR/MWh per hour of the day
    k = int(round(hours))
    cheap, dear = set(np.argsort(prof)[:k].tolist()), set(np.argsort(prof)[-k:].tolist())
    soc = prm['soc_min'] * e          # starts empty and leftover energy is worth nothing: no free energy from the start state
    rev = disch = 0.0
    for t in range(T):
        h = t // 4
        if h in cheap:
            c = min(1.0, (prm['soc_max'] * e - soc) / (eta * DT))      # MW from the grid
            c = max(c, 0.0)
            soc += eta * c * DT
            rev -= (p[t] + prm['grid_withdrawal']) * c * DT
        elif h in dear:
            d = min(1.0, (soc - prm['soc_min'] * e) * eta / DT)         # MW to the grid
            d = max(d, 0.0)
            soc -= d * DT / eta
            rev += (p[t] - prm['grid_injection']) * d * DT
            disch += d * DT
    return rev, disch


def run(days, prices, prm=PARAMS):
    """Daily results for the given days. Each: {d, <h>h: {pf, pf_w, pf_e, nv, nv_e}} in EUR per MW of power."""
    out = []
    for d in days:
        p = prices[d]
        row = {'d': d}
        trail = [prices[x] for x in sorted(prices) if x < d][-prm['trailing_days']:]
        for h in DURATIONS:
            g = optimise_day(p, h, 0.0, prm)
            w = optimise_day(p, h, prm['wear'], prm)
            if g is None or w is None:
                row = None
                break
            res = {'pf': round(g[0], 2), 'pf_e': round(g[1], 3),                      # gross, MWh discharged
                   'pw': round(w[0] - prm['wear'] * w[1], 2), 'pw_e': round(w[1], 3)}  # net of wear, MWh discharged
            if len(trail) >= 10:
                nv = naive_day(p, np.mean(trail, axis=0), h, prm)
                res['nv'] = round(nv[0], 2)
                res['nv_e'] = round(nv[1], 3)
            row[f'{h}h'] = res
        if row:
            out.append(row)
    return out


def example(d, p, prm=PARAMS):
    """The last delivery day, quarter-hour by quarter-hour: price and the net-of-wear schedule of each duration
    (for the page's typical-day chart)."""
    out = {'d': d, 'price': [round(float(v), 2) for v in p]}
    for h in DURATIONS:
        r = optimise_day(p, h, prm['wear'], prm, detail=True)
        if r is None:
            continue
        rev, mwh, c, dch, soc = r
        out[f'{h}h'] = {'rev': round(rev, 2), 'wear': round(prm['wear'] * mwh, 2),   # EUR per MW: market revenue, wear cost
                        'charge': [round(float(v), 3) for v in c], 'discharge': [round(float(v), 3) for v in dch],
                        'soc': [round(float(v) / h, 3) for v in soc]}
    return out


def aggregate(rows):
    """Monthly means per MW of power (EUR per MW and per month, cycles per day)."""
    by = {}
    for r in rows:
        by.setdefault(r['d'][:7], []).append(r)
    months = []
    for m in sorted(by):
        rs = by[m]
        item = {'m': m, 'days': len(rs)}
        for h in DURATIONS:
            k = f'{h}h'
            ent = {}
            for f in ('pf', 'pw', 'nv'):
                v = [r[k][f] for r in rs if f in r[k]]
                if v:
                    ent[f] = round(sum(v) / len(v), 2)                          # EUR per MW per day
            for f in ('pf_e', 'pw_e', 'nv_e'):
                v = [r[k][f] for r in rs if f in r[k]]
                if v:
                    ent[f.replace('_e', '_cyc')] = round(sum(v) / len(v) / h, 3)  # cycles per day
            item[k] = ent
        months.append(item)
    return months


# ── PowerKlock BESS index, France, 1 MW / 2 h (data/history/bess_index.json) ──
# Two figures, both in k€ per MW of power per year:
#  · forward: the day-ahead value of the battery over the Cal strip of the PPA benchmark (2027-2029), as of each day:
#    trailing 12 months of the perfect schedule net of wear × mean Cal of the strip ÷ mean published daily average
#    of those 12 months. Rebuilt for past days from that day's forwards (fr_market_calchain.json).
#  · realised: per delivery day, what the whole MW earned in each market (day-ahead net of wear; FCR, the sum of the
#    6 French block prices; aFRR, up + down capacity price × 24 h when published), and the best of them: a battery
#    small enough not to move the price, choosing each day the market that pays most. Not a stack: one MW sold once.
INDEX_OUT = os.path.join(ROOT, 'data', 'history', 'bess_index.json')
STRIP = (2027, 2028, 2029)


def build_index(rows, prices=None, k='2h'):
    def load(p):
        try:
            return json.load(open(os.path.join(ROOT, 'data', 'history', p)))
        except (OSError, ValueError):
            return {}
    res, chain = load('reserves_fr.json'), load('fr_market_calchain.json').get('FR', {}).get('years', {})
    avg = {}
    for r in rows:
        try:
            v = json.load(open(os.path.join(DAILY, r['d'] + '.json')))['zones']['FR'].get('avg')
            if v is not None:
                avg[r['d']] = float(v)
        except (OSError, ValueError, KeyError):
            pass
    # Cal price of each strip year on each trading day (carried forward over days without a quote)
    cal = {}
    for y in STRIP:
        c = chain.get(str(y)) or {}
        cal[y] = dict(zip(c.get('dates', []), c.get('values', [])))
    ds = sorted(rows, key=lambda r: r['d'])
    dlist = [r['d'] for r in ds]
    pw = [r[k]['pw'] for r in ds]
    fwd, last = {}, {y: None for y in STRIP}
    trade_days = sorted(set().union(*[set(cal[y]) for y in STRIP])) if all(cal[y] for y in STRIP) else []
    for t in trade_days:
        for y in STRIP:
            if t in cal[y] and cal[y][t] is not None:
                last[y] = float(cal[y][t])
        if any(v is None for v in last.values()):
            continue
        j = bisect.bisect_left(dlist, t)            # delivery days strictly before the trading day
        if j < 300:
            continue
        win = range(max(0, j - 365), j)
        ltm = sum(pw[i] for i in win) / len(win) * 365 / 1000
        av = [avg[dlist[i]] for i in win if dlist[i] in avg]
        if len(av) < 300:
            continue
        base = sum(av) / len(av)
        strip = sum(last.values()) / len(STRIP)
        fwd[t] = {'v': round(ltm * strip / base, 1), 'ltm': round(ltm, 1), 'base': round(base, 2), 'strip': round(strip, 2),
                  'y': {str(y): round(ltm * last[y] / base, 1) for y in STRIP}}
    fcr, af = res.get('fcr', {}), res.get('afrr', {})
    real = {}
    for r in ds:
        d = r['d']
        e = {'da': round(r[k]['pw'], 1)}
        if d in fcr:
            e['fcr'] = round(fcr[d], 1)
        a = af.get(d) or {}
        if a:
            e['afrr'] = round((a.get('up', 0) + a.get('down', 0) + a.get('sym', 0)) * 24, 1)
        if len(e) > 1:                               # the best market needs at least one reserve price that day
            m = max(e, key=e.get)
            e['best'], e['mkt'] = e[m], m
        blocks = (res.get('fcr_blocks') or {}).get(d)
        if prices is not None and d in prices and blocks and len(blocks) == 6:
            h = int(k[:-1])
            co = cooptimise_day(prices[d], blocks, h, PARAMS['wear'])
            if co:
                da_, fc_, mwh, fm = co[:4]
                e['co'] = round(da_ + fc_ - PARAMS['wear'] * mwh, 1)        # net of wear
                e['co_da'] = round(da_ - PARAMS['wear'] * mwh, 1)
                e['co_fcr'] = round(fc_, 1)
                e['co_f'] = round(fm, 3)
        real[d] = e
    months = {}
    for d, e in real.items():
        mo = months.setdefault(d[:7], {'n': 0, 'nb': 0, 'da': 0, 'fcr': [], 'afrr': [], 'best': 0, 'share': {}, 'co': [], 'co_da': [], 'co_fcr': [], 'co_f': []})
        if 'co' in e:
            for x in ('co', 'co_da', 'co_fcr', 'co_f'):
                mo[x].append(e[x])
        mo['n'] += 1
        mo['da'] += e['da']
        if 'fcr' in e:
            mo['fcr'].append(e['fcr'])
        if 'afrr' in e:
            mo['afrr'].append(e['afrr'])
        if 'best' in e:
            mo['nb'] += 1
            mo['best'] += e['best']
            mo['share'][e['mkt']] = mo['share'].get(e['mkt'], 0) + 1
    def ann(v):
        return round(v * 365 / 1000, 1)
    mrows = []
    for m in sorted(months):
        mo = months[m]
        mrows.append({'m': m, 'days': mo['n'], 'da': ann(mo['da'] / mo['n']),
                      'fcr': ann(sum(mo['fcr']) / len(mo['fcr'])) if len(mo['fcr']) >= 5 else None,
                      'afrr': ann(sum(mo['afrr']) / len(mo['afrr'])) if len(mo['afrr']) >= 5 else None,
                      'best': ann(mo['best'] / mo['nb']) if mo['nb'] >= 5 else None,
                      'share': {x: round(c / mo['nb'] * 100) for x, c in mo['share'].items()} if mo['nb'] else {},
                      **({'co': ann(sum(mo['co']) / len(mo['co'])), 'co_da': ann(sum(mo['co_da']) / len(mo['co_da'])),
                          'co_fcr': ann(sum(mo['co_fcr']) / len(mo['co_fcr'])), 'co_f': round(sum(mo['co_f']) / len(mo['co_f']), 2)}
                         if len(mo['co']) >= 5 else {})})
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    doc = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'battery': '1 MW, ' + k.replace('h', ' h'),
           'strip': '-'.join(map(str, STRIP)),
           'note': 'kEUR per MW per year. forward: day-ahead value over the Cal strip, rebuilt from each day\'s forwards. '
                   'realised: per delivery day, EUR per MW per day in each market and the best one (not a stack).',
           'forward': fwd, 'computed_on': today,
           'realised': {d: real[d] for d in dlist[-400:]}, 'months': mrows}
    with open(INDEX_OUT, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    return doc


# ── the same battery across Europe (data/history/bess_europe.json): day-ahead alone over 12 months, and the
#    co-optimised value with the reserves published for each zone (FCR blocks of the common auction; aFRR capacity
#    for Germany), last 30 days and by month. One MW, 2 h, net of wear, price taker. ──
EU_OUT = os.path.join(ROOT, 'data', 'history', 'bess_europe.json')
EU_ZONES = ('FR', 'DE_LU', 'BE', 'NL', 'AT', 'CH', 'CZ', 'DK_W', 'PL', 'ES', 'IT_NORD', 'SE')


def build_europe(days=370, k=2):
    try:
        eu = json.load(open(os.path.join(ROOT, 'data', 'history', 'reserves_fr.json'))).get('eu', {})
    except (OSError, ValueError):
        eu = {}
    files = sorted(glob.glob(os.path.join(DAILY, '*.json')))[-days:]
    W = PARAMS['wear']
    acc = {z: {} for z in EU_ZONES}
    for f in files:
        d = os.path.basename(f)[:-5]
        try:
            zs = json.load(open(f))['zones']
        except (OSError, ValueError, KeyError):
            continue
        res = eu.get(d) or {}
        for z in EU_ZONES:
            h = (zs.get(z) or {}).get('hourly')
            if not h or len(h) != 96 or any(v is None for v in h):
                continue
            p = np.array(h, dtype=float)
            r = optimise_day(p, k, W)
            if r is None:
                continue
            e = {'da': r[0] - W * r[1]}
            fb = (res.get('fcr') or {}).get(z)
            af = res.get('afrr_de') if z == 'DE_LU' else None
            if fb or af:
                co = cooptimise_day(p, fb, k, W, afrr=af)
                if co:
                    e.update(co=co[0] + co[1] + co[4] - W * co[2], co_da=co[0] - W * co[2], co_fcr=co[1], co_afrr=co[4], f=co[3])
            acc[z][d] = e
    ann = lambda v: round(v * 365 / 1000, 1)   # noqa: E731
    out = {}
    for z, by in acc.items():
        if not by:
            continue
        ds = sorted(by)
        last30 = ds[-30:]
        co30 = [by[d] for d in last30 if 'co' in by[d]]
        e = {'da30': ann(np.mean([by[d]['da'] for d in last30])), 'da365': ann(np.mean([by[d]['da'] for d in ds[-365:]])), 'last': ds[-1]}
        if len(co30) >= 20:
            for key in ('co', 'co_da', 'co_fcr', 'co_afrr'):
                e[key + '30'] = ann(np.mean([x[key] for x in co30]))
            e['f30'] = round(float(np.mean([x['f'] for x in co30])), 2)
        months = {}
        for d in ds:
            months.setdefault(d[:7], []).append(by[d])
        e['months'] = {m: {'da': ann(np.mean([x['da'] for x in v])), **({'co': ann(np.mean([x['co'] for x in v if 'co' in x]))} if sum('co' in x for x in v) >= 10 else {})}
                       for m, v in sorted(months.items()) if len(v) >= 10}
        out[z] = e
    doc = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'battery': f'1 MW, {k} h',
           'note': 'kEUR per MW per year. da: day-ahead alone, perfect schedule net of wear. co: day-ahead + FCR (+ aFRR capacity '
                   'for DE_LU) in one schedule a day, price taker. 30 = last 30 delivery days.',
           'zones': out}
    with open(EU_OUT, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--full', action='store_true', help='recompute everything from 2022-01-01')
    ap.add_argument('--recent', type=int, default=10, help='days recomputed in incremental mode')
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(DAILY, '*.json')))
    prices = {}
    for f in files:
        d = os.path.basename(f)[:-5]
        if d >= '2021-11-01':                      # a 60-day lead for the trailing window
            p = day_prices(f)
            if p is not None:
                prices[d] = p
    days_all = [d for d in sorted(prices) if d >= START]
    if not days_all:
        print('no French prices found', file=sys.stderr)
        return 1
    # the delivery day after today is published in the afternoon: keep only days with complete prices
    old = {}
    if os.path.exists(OUT) and not a.full:
        try:
            old = {r['d']: r for r in json.load(open(OUT)).get('days', [])}
        except (OSError, ValueError):
            old = {}
    todo = days_all if (a.full or not old) else sorted(set(days_all[-a.recent:]) | (set(days_all) - set(old)))
    new = {r['d']: r for r in run(todo, prices)}
    merged = {**{d: r for d, r in old.items() if d in prices}, **new}
    rows = [merged[d] for d in sorted(merged)]
    ltm = rows[-365:]
    summary = {}
    for h in DURATIONS:
        k = f'{h}h'
        n = len(ltm)
        summary[k] = {f: round(sum(r[k][f] for r in ltm if f in r[k]) / max(n, 1) * 365 / 1000, 1) for f in ('pf', 'pw', 'nv')}
        summary[k]['cycles_day'] = round(sum(r[k]['pf_e'] for r in ltm) / max(n, 1) / h, 2)
    # the year ahead: the 12-month value scaled by each calendar forward against the 12-month baseload. Spreads move
    # with the price level (thermal plants set the evening peak), so a dearer year pays a battery more; first-order only
    # the published daily average of each delivery day (a 25-hour day keeps 96 quarter-hours: never the series mean)
    def day_avg(d):
        try:
            v = json.load(open(os.path.join(DAILY, d + '.json')))['zones']['FR'].get('avg')
            return float(v) if v is not None else None
        except (OSError, ValueError, KeyError):
            return None
    avgs = [v for v in (day_avg(r['d']) for r in ltm) if v is not None]
    base = float(np.mean(avgs)) if avgs else float(np.mean([prices[r['d']].mean() for r in ltm]))
    path = {}
    try:
        fc = json.load(open(os.path.join(ROOT, 'data', 'fr_market.json'))).get('forwardCurve') or []
        cal = {int(x['contract'].split('Cal')[1][:4]): float(x['value']) for x in fc if 'Cal' in x.get('contract', '') and x.get('value')}
        for y, v in sorted(cal.items()):
            path[str(y)] = {k: round(summary[k]['pw'] * v / base, 1) for k in summary} | {'cal': v}
    except (OSError, ValueError, KeyError, IndexError):
        path = {}
    doc = {
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
        'source': 'PowerKlock day-ahead prices, France (ENTSO-E)',
        'params': PARAMS,
        'unit': 'EUR per MW of power per day; summary in kEUR per MW per year (last 365 days)',
        'first': rows[0]['d'], 'last': rows[-1]['d'], 'n': len(rows),
        'summary_ltm': summary,
        'base_ltm': round(base, 2),
        'da_path': path,
        'months': aggregate(rows),
        'days': rows[-120:],
        'example': example(days_all[-1], prices[days_all[-1]]),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'))
    os.replace(tmp, OUT)
    if len(rows) >= 400:                         # the index needs the whole history (the job always runs --full)
        ix = build_index(rows, prices)
        if ix['forward']:
            fl = max(ix['forward'])
            print(f"BESS index: forward {ix['forward'][fl]['v']} kEUR/MW/yr on {fl}, {len(ix['forward'])} trading days")
    eu = build_europe()
    print('BESS Europe:', ', '.join(f"{z} {v.get('co30', v['da30'])}" for z, v in eu['zones'].items()))
    print(f'{len(rows)} days {rows[0]["d"]} to {rows[-1]["d"]}; last 365 days (kEUR/MW/yr):')
    for k, v in summary.items():
        print(' ', k, v)
    return 0


if __name__ == '__main__':
    sys.exit(main())
