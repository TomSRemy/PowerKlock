#!/usr/bin/env python3
"""PPA pricer test bench: six approaches replayed month by month on French solar and
wind, a hybrid chosen on calibration years only, judged on years it never saw, and
monthly forecasts for the pricer.

Protocol (fixed before any result):
  · every delivery year Y is priced with data before Y only (capacity of Y extrapolated);
  · calibration years 2019, 2020, 2021, 2023 choose every setting and the hybrid;
  · verdict years 2024, 2025 and 2026 to date are never used to choose anything;
  · 2022 (gas crisis) is left out of the targets and of the price-model training;
  · the score is the error on the value of one MWh (€/MWh), weighted by production:
    capture-rate error × the month's baseload, months weighted by their output;
  · two contract conventions: 'curt' (output at prices ≤ 0 curtailed, not paid; capture
    over the paid hours against the all-hours baseload) and 'all' (every hour paid).

Approaches
  1 dashboard   PPA Dashboard: P74 of the past discounts, one yearly figure (reference)
  2 step        Step by step: capture rate vs ln(capacity), one yearly figure (reference)
  3 fpc         FPC: expected profile on the forward-curve shape + cannibalisation (1)−(3)
  4 regional    hourly price model on the REGIONAL residual load (France + Germany + Belgium
                + Spain: load − solar − wind − nuclear, ÷ load), learnt on recent years,
                applied to the fleet of Y over every past weather year (cannibalisation
                built into the hourly curve)
  5 regionalMC  the same price model, Monte Carlo: weeks of weather, demand and nuclear
                drawn as blocks from past years (block bootstrap), hourly prices drawn from
                the model's distribution, so negative prices and curtailment appear
  6 fpcMC       FPC with its cannibalisation projection simulated (distribution, same median)
  (+ weather    the current pricer's Monte Carlo on simulated weather, from ppa_backtest_detail.json)

Writes data/history/ppa_lab.json
    python scripts/ppa_lab.py [--sims 150]
"""
import json
import math
import os
import sys
from datetime import date, timedelta

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_backtest as B             # noqa: E402
import ppa_backtest_detail as BD     # noqa: E402
import fetch_country_capture as FCC  # noqa: E402
sys.argv = _argv

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_lab.json')
CAL, VERDICT = [2019, 2020, 2021, 2023], [2024, 2025]
NEIGH = ('DE', 'BE', 'ES')
PPE3 = {'s': {2030: 48.0, 2035: 67.5}, 'w': {2030: 31.0, 2035: 37.5}}
# neighbours' official 2030 targets, a ceiling on their extrapolated pace (GW): Spain PNIEC 2023-2030 (MITECO, Sept.
# 2024: 76 GW solar incl. 19 GW self-consumption, 62 GW wind incl. 3 offshore); Germany EEG 2023 §4 (215 GW solar,
# 115 GW onshore + 30 GW offshore wind). Without it Spain's last pace (+12 GW a year) passed its 2030 target in 2028.
TARGETS = {'ES': {'s': (2030, 76.0), 'w': (2030, 62.0)}, 'DE': {'s': (2030, 215.0), 'w': (2030, 145.0)}}
TECH = {'s': 'solar', 'w': 'wind'}
BIN = 0.025
RNG = np.random.default_rng(7)


# ── data ─────────────────────────────────────────────────────────────────────
def pumping_hours(y):
    """France pumped-storage and battery charging (MW, positive), {Paris day: [24]} from RTE éCO2mix"""
    out = {}
    for m in range(1, 13):
        try:
            d = json.load(open(os.path.join(ROOT, 'data', 'history', 'rte', f'{y}-{m:02d}.json')))['days']
        except OSError:
            continue
        for day, v in d.items():
            q = v.get('pumping') or []
            if len(q) >= 24:
                k = len(q) // 24
                out[day] = [abs(sum(x or 0 for x in q[h * k:(h + 1) * k]) / k) for h in range(24)]
    return out


def load_years():
    caps = FCC.capacity()
    Y = {}
    for y in range(2016, date.today().year + 1):
        try:
            fr = json.load(open(os.path.join(ROOT, 'data', 'history', 'fr_hourly', f'{y}.json')))['days']
            rg = json.load(open(os.path.join(ROOT, 'data', 'history', 'region_hourly', f'{y}.json')))['countries']
        except OSError:
            continue
        days = []
        for d, v in sorted(fr.items()):
            if not all(v.get(k) and None not in v[k] for k in 'pswln'):
                continue
            if not all(c in rg and d in rg[c]['l'] and None not in rg[c]['l'][d] for c in NEIGH):
                continue
            days.append(d)
        if len(days) < 28:
            continue
        a = {'days': days, 'month': np.array([int(d[5:7]) for d in days]), 'doy': np.array([doy(d) for d in days])}
        for k in 'pswln':
            a['fr_' + k] = np.array([fr[d][k] for d in days], float)
        for c in NEIGH:
            for k in 'swln':
                a[c + '_' + k] = np.array([[x or 0 for x in rg[c][k].get(d, [0] * 24)] for d in days], float)
        pu = pumping_hours(y)
        a['fr_pump'] = np.array([pu.get(d, [0] * 24) for d in days], float)
        a['complete'] = len(days) >= 340
        Y[y] = a
    return Y, caps


def doy(d):
    dd = date.fromisoformat(d)
    if dd.month == 2 and dd.day == 29:
        dd = dd - timedelta(days=1)
    return (date(2001, dd.month, dd.day) - date(2001, 1, 1)).days


DATA, CAPS = load_years()


def cap(c, t, y):
    """installed GW of country c, technology t, year y (FR: same source as the replay)"""
    if c == 'FR':
        return B.CAP[t].get(y)
    v = CAPS.get(c, {}).get(y, {})
    return v.get('solarGW' if t == 's' else 'windGW')


def cap_guess(c, t, Y, last):
    ys = [y for y in range(2010, last + 1) if cap(c, t, y)]
    if not ys:
        return None
    l = ys[-1]
    prev = cap(c, t, l - 1) or cap(c, t, l)
    return cap(c, t, l) + (cap(c, t, l) - prev) * (Y - l)


def cap_future(c, t, Y):
    """forecast capacity: France its last yearly pace, never below the PPE3 path; neighbours their last yearly pace"""
    ys = [y for y in range(2010, 2040) if cap(c, t, y) and (c != 'DE' or y <= date.today().year)]
    last = ys[-1]
    if Y <= last:
        return cap(c, t, Y)
    if c == 'FR':
        # the last year's pace, never below the PPE3 path (as js/tool-ppa.js capPath; the test bench's own pace)
        pts = [(last, cap(c, t, last))] + [(y, g) for y, g in PPE3[t].items() if y > last]
        ppe = None
        for (y0, g0), (y1, g1) in zip(pts, pts[1:]):
            if Y <= y1:
                ppe = g0 + (g1 - g0) * (Y - y0) / (y1 - y0)
                break
        if ppe is None:
            (ya, ga), (yb, gb) = pts[-2], pts[-1]
            ppe = gb + (gb - ga) / (yb - ya) * (Y - yb)
        return max(ppe, cap_guess(c, t, Y, last) or 0)
    g = cap_guess(c, t, Y, last)
    tg = TARGETS.get(c, {}).get(t)
    if g is not None and tg and Y > last:
        # never beyond the straight line from the last known year to the official target (then its slope)
        ty, tv = tg
        slope = (tv - cap(c, t, last)) / max(1, ty - last)
        g = min(g, cap(c, t, last) + slope * (Y - last))
    return g


# ── regional price model ─────────────────────────────────────────────────────
FLEX = {'on': False}
SOFT_LEVEL = {'on': False, 'band': 15.0, 'techs': ('w',)}   # price-level classes blended within ±band €/MWh of each
# threshold; on for the technologies in 'techs' (wind: lower error in scripts/ppa_level_soft_test.py, solar: higher)
# batteries added beyond the years the table was learnt on (they charge in the region's lowest residual hours and give
# back 85 % in the highest, each day): France, RTE Bilan prévisionnel 2025 (≈1 GW at end 2024, of which ~0.7 GW serves
# reserves; "socle" +0.3 GW a year to 2.8 GW in 2030, 2 h; central variant +5 GW more by 2035, 4 h); Germany, its
# battery fleet (Energy-Charts, data/history/capacity.json: 8.4 GW 2023, 12.7, 16.9, 22.0 GW 2026, then the pace of
# its last three years, +4.4 GW a year), counted at 50 % (mostly home
# batteries run for self-consumption, not for the market)
STORAGE = {'on': False, 'de_eff': 0.5, 'techs': ('w',)}   # on for 'techs' (scripts/ppa_storage_test.py: wind lower error,
# solar higher: the table already overvalues solar a little in the replay)




def _de_batt():
    try:
        c = json.load(open(os.path.join(ROOT, 'data', 'history', 'capacity.json')))['countries']['DE']
        return {y: v for y, v in zip(c['years'], c['types']['Battery storage (power)']) if v}
    except (OSError, KeyError):
        return {}


DE_BATT = _de_batt()


def fr_batteries(Y):
    """France's batteries beyond the reserves: [(GW, hours)], RTE socle (2 h) then the central variant (4 h)"""
    socle = min(2.8, 1.0 + 0.3 * (Y - 2024)) - 0.7
    extra = 5.0 * min(1.0, (Y - 2026) / (2035 - 2026)) if Y > 2026 else 0.0
    return [(max(0.0, socle), 2.0), (extra, 4.0)]


def de_batteries(Y):
    """Germany's battery power (GW): Energy-Charts, then its last three years' pace"""
    if not DE_BATT:
        return 0.0
    last = max(DE_BATT)
    if Y <= last:
        return DE_BATT.get(Y, DE_BATT[min(DE_BATT)])
    return DE_BATT[last] + (DE_BATT[last] - DE_BATT[last - 3]) / 3 * (Y - last)


def storage_added(Y, base):
    """the batteries of Y beyond those of the year the table was learnt on: [(MW, hours)]"""
    fy, fb = fr_batteries(Y), fr_batteries(base)
    out = [(max(0.0, a[0] - b[0]) * 1000, a[1]) for a, b in zip(fy, fb)]
    out.append((max(0.0, de_batteries(Y) - de_batteries(base)) * STORAGE['de_eff'] * 1000, 2.0))
    return [o for o in out if o[0] > 0]


def batteries_on(t, Y, demand_year, region, h, x):
    """the residual share x after the batteries added since demand_year, when STORAGE applies to technology t"""
    if not (STORAGE['on'] or t in STORAGE['techs']) or not region or Y <= demand_year:
        return x
    Lo = sum(h['l'][c] for c in ('FR',) + NEIGH)
    R2, L2 = with_batteries(x * Lo, Lo, storage_added(Y, demand_year))
    return R2 / L2


def with_batteries(R, Lo, tranches, eff=0.85):
    """residual load R and load Lo (D × 24, MW, the region summed) after daily cycles: each tranche charges where the
    residual load is lowest and gives back 85 % where it is highest"""
    R, Lo = R.copy(), Lo.copy()
    for p_mw, hours in tranches:
        e_max = p_mw * hours
        for d in range(R.shape[0]):
            order = np.argsort(R[d])
            stored = 0.0
            for h in order:
                if stored >= e_max:
                    break
                c = min(p_mw, e_max - stored)
                R[d, h] += c; Lo[d, h] += c; stored += c
            out = stored * eff
            for h in order[::-1]:
                if out <= 0:
                    break
                q = min(p_mw, out)
                R[d, h] -= q; out -= q
    return R, Lo
    order = np.argsort(R)
    e, stored = p_mw * hours, 0.0
    for h in order:
        if stored >= e:
            break
        c = min(p_mw, e - stored); R[h] += c; Lo[h] += c; stored += c
    out = stored * eff
    for h in order[::-1]:
        if out <= 0:
            break
        q = min(p_mw, out); R[h] -= q; out -= q
    return R, Lo


def residual_share(a, region=True, s=None, w=None, l=None, n=None, pump=None):
    """(load − solar − wind − nuclear) ÷ load, France alone or with the neighbours; with FLEX on, France's
    pumped-storage and battery charging counts as load (it absorbs the midday surplus)"""
    cs = ('FR',) + (NEIGH if region else ())
    if FLEX['on']:
        extra = pump if pump is not None else (a['fr_pump'] if a is not None else 0)
        l = dict(l) if l else {c: a[('fr_' if c == 'FR' else c + '_') + 'l'] for c in cs}
        l['FR'] = l['FR'] + extra
    L = sum(l[c] if l else a[('fr_' if c == 'FR' else c + '_') + 'l'] for c in cs)
    R = sum((l[c] if l else a[('fr_' if c == 'FR' else c + '_') + 'l'])
            - (s[c] if s else a[('fr_' if c == 'FR' else c + '_') + 's'])
            - (w[c] if w else a[('fr_' if c == 'FR' else c + '_') + 'w'])
            - (n[c] if n else a[('fr_' if c == 'FR' else c + '_') + 'n']) for c in cs)
    return R / L


def grp(month, hours=None):
    """season × time of day: 0–2 winter night/day/evening, 3–5 summer"""
    h = np.arange(24)[None, :] if hours is None else hours
    blk = np.where(h < 9, 0, np.where(h < 17, 1, 2))
    return ((month[:, None] >= 4) & (month[:, None] <= 9)).astype(int) * 3 + blk


class PriceModel:
    """price of the hour ÷ the month's average, given the residual share, by season × time of day"""

    def __init__(self, years, region=True, norm='mean', level=False):
        self.level = level
        xs, gs, rs = [], [], []
        for y in years:
            a = DATA[y]
            P = a['fr_p']
            x = residual_share(a, region)
            if norm == 'mean':
                lvl = {m: P[a['month'] == m].mean() for m in range(1, 13) if (a['month'] == m).any()}
            else:
                # the month's price level when the residual load is high (the price set by thermal plants)
                lvl = {}
                for m in range(1, 13):
                    k = a['month'] == m
                    if k.any():
                        xm, pm_ = x[k].ravel(), P[k].ravel()
                        lvl[m] = pm_[xm >= np.quantile(xm, 0.7)].mean()
            mavg = np.array([lvl[m] for m in a['month']])[:, None]
            ok = mavg[:, 0] > 5
            base = np.array([P[a['month'] == m].mean() for m in a['month']])
            g = grp(a['month']) + 6 * self.lclass(base)[:, None] * level
            xs.append(x[ok].ravel()); gs.append(g[ok].ravel()); rs.append((P / mavg)[ok].ravel())
        x, g, r = np.concatenate(xs), np.concatenate(gs), np.concatenate(rs)
        self.lo = int(math.floor(x.min() / BIN)) - 1
        self.nb = int(math.ceil(x.max() / BIN)) - self.lo + 2
        b = np.clip(np.round(x / BIN).astype(int) - self.lo, 0, self.nb - 1)
        self.lists = {}
        G = 18 if level else 6
        mean = np.full((G, self.nb), np.nan); mpos = mean.copy(); ppos = mean.copy()
        for gi in range(G):
            for bi in range(self.nb):
                k = (g == gi) & (b == bi)
                if k.sum() >= 15:
                    v = r[k]
                    self.lists[(gi, bi)] = v
                    mean[gi, bi], mpos[gi, bi], ppos[gi, bi] = v.mean(), (v * (v > 0)).mean(), (v > 0).mean()
        # empty bins take the nearest filled bin of the same season × time of day
        self.near = np.zeros((G, self.nb), int)
        for gi in range(G):
            filled = np.where(~np.isnan(mean[gi]))[0]
            if not len(filled) and gi >= 6:      # an empty price level borrows the nearest level
                for alt in (gi - 6, gi + 6, gi - 12):
                    if 0 <= alt < G and not np.isnan(mean[alt]).all():
                        mean[gi], mpos[gi], ppos[gi] = mean[alt], mpos[alt], ppos[alt]
                        self.lists.update({(gi, b): v for (g2, b), v in list(self.lists.items()) if g2 == alt})
                        break
                filled = np.where(~np.isnan(mean[gi]))[0]
            for bi in range(self.nb):
                self.near[gi, bi] = filled[np.abs(filled - bi).argmin()] if len(filled) else bi
            mean[gi] = mean[gi, self.near[gi]]; mpos[gi] = mpos[gi, self.near[gi]]; ppos[gi] = ppos[gi, self.near[gi]]
        self.mean, self.mpos, self.ppos = mean, mpos, ppos

    @staticmethod
    def lclass(base):
        """month's price level: 0 below 60 €/MWh, 1 up to 110, 2 above"""
        base = np.asarray(base, float)
        return np.where(base < 60, 0, np.where(base < 110, 1, 2))

    def bins(self, x):
        return np.clip(np.round(x / BIN).astype(int) - self.lo, 0, self.nb - 1)

    def expected(self, x, g):
        b = self.bins(x)
        return self.mean[g, b], self.mpos[g, b], self.ppos[g, b]

    def draw(self, x, g):
        b = self.near[g, self.bins(x)]
        out = np.empty(x.shape)
        key = g * 10000 + b
        for k in np.unique(key):
            idx = key == k
            v = self.lists.get((k // 10000, k % 10000))
            out[idx] = v[RNG.integers(0, len(v), idx.sum())] if v is not None else self.mean[k // 10000, k % 10000]
        return out


# ── a delivery year built from past data ─────────────────────────────────────
def calendar(Y):
    d0, out = date(Y, 1, 1), []
    while d0.year == Y:
        out.append(d0.isoformat()); d0 += timedelta(days=1)
    return out


_DI = {}


# demand (consumption, nuclear) taken from the same kind of day of the demand year: weekday, Saturday, Sunday or French
# public holiday (counted as a Sunday), the nearest such day within ±3 days of the same date; off = the same date
DEMAND_CAL = {'on': True}   # scripts/ppa_calendar_test.py: error over 1–3 yrs, curt, solar 2.55 → 2.49, wind equal


def _easter(y):
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    mo = (h + l_ - 7 * m + 114) // 31
    return date(y, mo, (h + l_ - 7 * m + 114) % 31 + 1)


def day_kind(d):
    """0 weekday, 1 Saturday, 2 Sunday or French public holiday"""
    dd = d if isinstance(d, date) else date.fromisoformat(str(d)[:10])
    e = _easter(dd.year)
    hol = {(1, 1), (5, 1), (5, 8), (7, 14), (8, 15), (11, 1), (11, 11), (12, 25)}
    if (dd.month, dd.day) in hol or dd in (e + timedelta(days=1), e + timedelta(days=39), e + timedelta(days=50)):
        return 2
    wd = dd.weekday()
    return 0 if wd < 5 else (1 if wd == 5 else 2)


def demand_row(dmd, di, d):
    """row of the demand year for day d of the delivery year"""
    k = di.get(doy(d))
    if not DEMAND_CAL['on'] or k is None:
        return k
    want = day_kind(d)
    for off in (0, -1, 1, -2, 2, -3, 3):
        j = di.get(doy(d) + off)
        if j is not None and day_kind(dmd['days'][j]) == want:
            return j
    return k


def by_doy(a, key=None):
    """{day of year: row} of a past year's array (cached)"""
    k = id(a)
    if k not in _DI:
        _DI[k] = {int(d): i for i, d in enumerate(a['doy'])}
    return _DI[k]


# the weather day's own demand deviation (Tom 29 Oct. 2026: windy winter days are mild, so demand is lower when the wind
# blows; taking demand from another year than the weather broke that link): each country's hourly load of the demand
# year × the weather day's daily load ÷ the mean of the weather year's days of the same month and day kind
WEATHER_DEMAND = {'on': False}
_DEV = {}


def demand_dev(wy, pre, j):
    """daily load of row j of weather year wy ÷ the mean of that year's days of the same month and day kind"""
    key = (wy, pre)
    if key not in _DEV:
        a = DATA[wy]
        daily = a[pre + 'l'].mean(axis=1)
        kinds = np.array([day_kind(d) for d in a['days']])
        ref = np.ones(len(daily))
        for m in range(1, 13):
            for kd in range(3):
                k = (a['month'] == m) & (kinds == kd)
                if k.any():
                    ref[k] = daily[k].mean()
        _DEV[key] = daily / ref
    return float(_DEV[key][j])


# installed capacity through the year (Tom 29 Oct. 2026): the published fleets are year-end values; a whole year at its
# year-end fleet overstated the delivery year by about half a year's growth (solar 2027: 42.3 GW against 39.4 on
# average) and understated the load factors of the early months of a past weather year. Day by day, linearly from the
# previous year-end to the year-end, for the weather years (their own fleets) and the delivery year (its projection)
FLEET_DAILY = {'on': True}


def _frac(d):
    dd = date.fromisoformat(str(d)[:10])
    return (dd.timetuple().tm_yday - 0.5) / (366 if dd.year % 4 == 0 else 365)


def _start_of(c, t, Y, end):
    """the fleet at the start of year Y: the observed year-end before it, else one year's growth back from 'end' along
    the path from the last observed year-end"""
    v = cap(c, t, Y - 1)
    if v:
        return v
    ys = [y for y in range(2010, Y) if cap(c, t, y)]
    if not ys or end is None:
        return end
    last = ys[-1]
    return end - (end - cap(c, t, last)) / max(1, Y - last)


def assemble(Y, days, weather_src, demand_year, capY):
    """hourly solar, wind, load and nuclear for the days of Y: weather (load factors) from
    weather_src[day index] (a past year), load and nuclear from demand_year (or the weather
    week rescaled to it), fleet of Y"""
    D = len(days)
    out = {k: {} for k in 'swln'}
    dmd = DATA[demand_year]
    di = by_doy(dmd, 'doy')
    for c in ('FR',) + NEIGH:
        pre = 'fr_' if c == 'FR' else c + '_'
        S = np.zeros((D, 24)); Wd = np.zeros((D, 24)); L = np.zeros((D, 24)); N = np.zeros((D, 24))
        if FLEET_DAILY['on']:
            y0 = {tt: _start_of(c, tt, Y, capY[c][tt]) for tt in 'sw'}
        for i, d in enumerate(days):
            wy, j = weather_src[i]
            a = DATA[wy]
            cs, cw = cap(c, 's', wy) or 1, cap(c, 'w', wy) or 1
            ys_, yw_ = capY[c]['s'], capY[c]['w']
            if FLEET_DAILY['on']:
                f, fw = _frac(d), _frac(a['days'][j])
                cs = (cap(c, 's', wy - 1) or cs) + (cs - (cap(c, 's', wy - 1) or cs)) * fw
                cw = (cap(c, 'w', wy - 1) or cw) + (cw - (cap(c, 'w', wy - 1) or cw)) * fw
                ys_ = y0['s'] + (capY[c]['s'] - y0['s']) * f
                yw_ = y0['w'] + (capY[c]['w'] - y0['w']) * f
            S[i] = a[pre + 's'][j] / (cs * 1000) * ys_ * 1000
            Wd[i] = a[pre + 'w'][j] / (cw * 1000) * yw_ * 1000
            k = demand_row(dmd, di, d)
            if k is None:
                k = min(di.values(), key=lambda q: abs(int(dmd['doy'][q]) - doy(d)))
            L[i] = dmd[pre + 'l'][k] * (demand_dev(wy, pre, j) if WEATHER_DEMAND['on'] else 1.0); N[i] = dmd[pre + 'n'][k]
        out['s'][c], out['w'][c], out['l'][c], out['n'][c] = S, Wd, L, N
    out['pump'] = np.array([dmd['fr_pump'][di.get(doy(d), 0)] for d in days])
    return out


def weather_index(Y, wy, days):
    a = DATA[wy]
    di = by_doy(a, 'doy')
    res = []
    for d in days:
        k = di.get(doy(d))
        if k is None:
            k = min(di.values(), key=lambda q: abs(int(a['doy'][q]) - doy(d)))
        res.append((wy, k))
    return res


def month_rates(month, v, r_mean, r_pos, p_pos, peak=None):
    """monthly capture rate in both conventions + paid share (+ the peak ÷ base price ratio, peak = weekdays
    08:00-20:00), from expected or drawn ratios"""
    out = {}
    for m in range(1, 13):
        k = month == m
        if not k.any():
            continue
        vv, base = v[k], r_mean[k].mean()
        den = vv.sum()
        if den <= 0 or base <= 0:
            continue
        paid = (vv * p_pos[k]).sum()
        out[m] = {'all': float((vv * r_mean[k]).sum() / den / base),
                  'curt': float((vv * r_pos[k]).sum() / paid / base) if paid > 0 else None,
                  'paid': float(paid / den), 'negH': float((1 - p_pos[k]).sum())}
        if peak is not None and (k[:, None] & peak).any():
            out[m]['peak'] = float(r_mean[k[:, None].repeat(24, 1) & peak].mean() / base)
    return out


def regional(t, Y, train_w, pm, demand_year, capY, sims=0, levels=None, region=True):
    """approach 4 (expected over every past weather year) and 5 (block bootstrap Monte Carlo)"""
    days = calendar(Y)
    month = np.array([int(d[5:7]) for d in days])
    g = grp(month)
    soft = None
    if pm.level:
        lv = np.array([(levels or {}).get(int(m), 50.0) for m in month])
        if SOFT_LEVEL['on'] or t in SOFT_LEVEL['techs']:
            # the class below and above, and the weight of the upper one within ±band of the 60 and 110 thresholds
            bd = SOFT_LEVEL['band']
            lo = np.where(lv < 60 + bd, 0, np.where(lv < 110 + bd, 1, 2))
            w = np.where(lo == 0, np.clip((lv - (60 - bd)) / (2 * bd), 0, 1), np.where(lo == 1, np.clip((lv - (110 - bd)) / (2 * bd), 0, 1), 0.0))
            hi = np.minimum(lo + 1, 2)
            soft = (g + 6 * lo[:, None], g + 6 * hi[:, None], w[:, None])
        g = g + 6 * pm.lclass(lv)[:, None]
    wkd = np.array([date.fromisoformat(d).weekday() < 5 for d in days])
    peak = wkd[:, None] & ((np.arange(24) >= 8) & (np.arange(24) < 20))[None, :]
    res4 = []
    for wy in train_w:
        src = weather_index(Y, wy, days)
        h = assemble(Y, days, src, demand_year, capY)
        x = residual_share(None, region, h['s'], h['w'], h['l'], h['n'], h['pump'])
        x = batteries_on(t, Y, demand_year, region, h, x)
        if soft is not None:
            a, b = pm.expected(x, soft[0]), pm.expected(x, soft[1])
            rm, rp, pp = [(1 - soft[2]) * u + soft[2] * v for u, v in zip(a, b)]
        else:
            rm, rp, pp = pm.expected(x, g)
        res4.append(month_rates(month, h[t]['FR'], rm, rp, pp, peak))
    m4 = {m: {k: float(np.mean([r[m][k] for r in res4 if m in r and r[m].get(k) is not None])) for k in ('all', 'curt', 'paid', 'negH', 'peak')} for m in range(1, 13)}
    m5, dist = None, None
    if sims:
        weeks = [(i // 7) for i in range(len(days))]
        allm = []
        for s in range(sims):
            pick = {wk: train_w[RNG.integers(0, len(train_w))] for wk in set(weeks)}
            src = []
            for i, d in enumerate(days):
                wy = pick[weeks[i]]
                src.append(weather_index(Y, wy, [d])[0])
            h = assemble(Y, days, src, demand_year, capY)
            x = residual_share(None, region, h['s'], h['w'], h['l'], h['n'], h['pump'])
            x = batteries_on(t, Y, demand_year, region, h, x)
            r = pm.draw(x, g)
            allm.append(month_rates(month, h[t]['FR'], r, r * (r > 0), (r > 0).astype(float)))
        m5 = {m: {k: float(np.mean([a[m][k] for a in allm if m in a and a[m][k] is not None])) for k in ('all', 'curt', 'paid', 'negH')} for m in range(1, 13)}
        dist = {m: {k: [float(np.percentile([a[m][k] for a in allm if m in a and a[m][k] is not None], q)) for q in (10, 50, 90)] for k in ('all', 'curt')} for m in range(1, 13)}
        # yearly value spread, production-weighted, for the band
        dist['year'] = allm
    return m4, m5, dist


# ── monthly price level known when pricing ──────────────────────────────────
def levels_for(Y, mode):
    """'forward': the month's level as the forward would give it (in the replay, the realised monthly
    baseload stands in for the forward: an optimistic stand-in, see the notes); 'lastyear': last
    complete year, same month; 'none': no level"""
    if mode == 'none':
        return None
    src = DATA.get(Y) if mode == 'forward' else DATA.get(max(y for y in DATA if y < Y and DATA[y]['complete']))
    if not src:
        return None
    return {m: float(src['fr_p'][src['month'] == m].mean()) for m in range(1, 13) if (src['month'] == m).any()}


def make_pm(Y, st):
    past = [y for y in DATA if y < Y and DATA[y]['complete']]
    tr = [y for y in past if st['with2022'] or y != 2022][-st['window']:]
    return PriceModel(tr, st['regional'], 'mean', st['level'] != 'none'), past


# ── actuals ──────────────────────────────────────────────────────────────────
def actual(t, Y):
    a = DATA[Y]
    P, V = a['fr_p'], a['fr_' + t]
    out = {}
    for m in range(1, 13):
        k = a['month'] == m
        if k.sum() < 20:
            continue
        Pm, Vm = P[k], V[k]
        base = Pm.mean()
        pos = Pm > 0
        out[m] = {'all': float((Vm * Pm).sum() / Vm.sum() / base), 'curt': float((Vm[pos] * Pm[pos]).sum() / Vm[pos].sum() / base) if Vm[pos].sum() > 0 else None,
                  'paid': float(Vm[pos].sum() / Vm.sum()), 'negH': int((Pm <= 0).sum()), 'base': float(base), 'mwh': float(Vm.sum()), 'days': int(k.sum())}
    return out


# ── the six approaches for one delivery year ─────────────────────────────────
def predict(t, Y, st, sims=0):
    past = [y for y in DATA if y < Y and DATA[y]['complete']]
    train = [y for y in past if y != 2022 and y >= 2016]
    last = max(past)
    V = B.S if t == 's' else B.W
    out = {}
    for conv in ('all', 'curt'):
        fy, fm, _ = BD.m_fpc(t, Y, train, V, conv)
        out[conv] = {'dashboard': {m: BD.m_dashboard(t, Y, train, V, conv) for m in range(1, 13)},
                     'step': {m: BD.m_step(t, Y, train, V, conv) for m in range(1, 13)},
                     'fpc': fm}
    pm, _ = make_pm(Y, st)
    capY = {c: {tt: cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + NEIGH}
    m4, m5, dist = regional(t, Y, past, pm, last, capY, sims, levels_for(Y, st['level']), st['regional'])
    for conv in ('all', 'curt'):
        out[conv]['regional'] = {m: m4[m][conv] for m in m4}
        if m5:
            out[conv]['regionalMC'] = {m: m5[m][conv] for m in m5}
    return out, m4, m5, dist


def fpc_sigma(t, Y, train, conv):
    """spread of the yearly cannibalisation around its log-capacity fit (approach 6's band)"""
    V = B.S if t == 's' else B.W
    co, _ = B.shape_coef(train)
    cs = []
    for y in train:
        i = B.yr == y
        pt = B.decorrelated(y, co)
        full = np.zeros_like(B.P); full[i] = pt
        cs.append(BD.rate(i, V, B.P, conv) - BD.rate(i, V, full, conv))
    x = np.log([B.CAP[t][y] for y in train])
    b = np.polyfit(x, cs, 1)
    return float(np.std(np.array(cs) - np.polyval(b, x), ddof=2)) if len(cs) > 2 else 0.03


# ── scoring ──────────────────────────────────────────────────────────────────
def score(pred, act, conv, months=None):
    """production-weighted error in €/MWh on the value of one MWh, and in capture points"""
    ms = [m for m in act if (months is None or m in months) and pred.get(m) is not None and act[m][conv] is not None]
    if not ms:
        return None
    w = np.array([act[m]['mwh'] * (act[m]['paid'] if conv == 'curt' else 1) for m in ms])
    e = np.array([(pred[m] - act[m][conv]) * act[m]['base'] for m in ms])
    ep = np.array([pred[m] - act[m][conv] for m in ms])
    return {'eur': float((w * e).sum() / w.sum()), 'pts': float((w * ep).sum() / w.sum() * 100), 'n': len(ms)}


def main():
    sims = int(sys.argv[sys.argv.index('--sims') + 1]) if '--sims' in sys.argv else 150
    targets = CAL + VERDICT + [2026]
    res = {'protocol': {'calibration': CAL, 'verdict': VERDICT + [2026], 'left_out': [2022],
                        'score': 'production-weighted error on the value of one MWh (€/MWh) = capture error × monthly baseload, months weighted by paid output'},
           'rows': []}
    # 1) settings chosen on the calibration years only
    choice = {}
    for t in 'sw':
        best = None
        for k in (2, 3, 5, 8):
            for region in (True, False):
                for level in ('none', 'lastyear', 'forward'):
                    for w22 in (False, True):
                        st = {'window': k, 'regional': region, 'level': level, 'with2022': w22}
                        errs = []
                        for Y in CAL:
                            pm, past = make_pm(Y, st)
                            last = max(past)
                            capY = {c: {tt: cap_guess(c, tt, Y, last) for tt in 'sw'} for c in ('FR',) + NEIGH}
                            m4, _, _ = regional(t, Y, past, pm, last, capY, 0, levels_for(Y, level), region)
                            act = actual(t, Y)
                            for conv in ('all', 'curt'):
                                errs.append(abs(score({m: m4[m][conv] for m in m4}, act, conv)['eur']))
                        e = float(np.mean(errs))
                        print(TECH[t], st, 'calibration error %.2f €/MWh' % e, flush=True)
                        if best is None or e < best[0]:
                            best = (e, st)
        choice[t] = dict(best[1], calError=best[0])
    res['settings'] = choice
    # 2) every approach on every target year
    for t in 'sw':
        for Y in targets:
            if Y not in DATA:
                continue
            past = [y for y in DATA if y < Y and DATA[y]['complete']]
            train = [y for y in past if y != 2022]
            preds, m4, m5, dist = predict(t, Y, choice[t], sims)
            _, wmc, _ = BD.m_weather(t, Y, train, B.S if t == 's' else B.W, 40)
            for conv in ('all', 'curt'):
                preds[conv]['weather'] = wmc[conv]
            act = actual(t, Y)
            row = {'tech': TECH[t], 'year': Y, 'set': 'calibration' if Y in CAL else 'verdict', 'actual': act, 'pred': preds,
                   'negH': {'actual': int(sum(v['negH'] for v in act.values())), 'regional': float(sum(m4[m]['negH'] for m in m4 if m in act)),
                            'regionalMC': float(sum(m5[m]['negH'] for m in m5 if m in act)) if m5 else None},
                   'paid': {'actual': {m: act[m]['paid'] for m in act}, 'regional': {m: m4[m]['paid'] for m in m4}, 'regionalMC': {m: m5[m]['paid'] for m in m5} if m5 else None},
                   'mcBand': {m: dist[m] for m in range(1, 13)} if dist else None}
            # approach 6: the FPC with its cannibalisation projection simulated → band around the FPC
            row['fpcSigma'] = {conv: fpc_sigma(t, Y, train, conv) for conv in ('all', 'curt')}
            for conv in ('all', 'curt'):
                preds[conv]['fpcMC'] = preds[conv]['fpc']
            # yearly value spread of the Monte Carlo (production-weighted capture value per MWh)
            if dist:
                yr_vals = {}
                for conv in ('all', 'curt'):
                    vals = []
                    for a in dist['year']:
                        ms = [m for m in act if m in a and a[m][conv] is not None]
                        w = np.array([act[m]['mwh'] * (a[m]['paid'] if conv == 'curt' else 1) for m in ms])
                        vals.append(float((w * np.array([a[m][conv] * act[m]['base'] for m in ms])).sum() / w.sum()))
                    yr_vals[conv] = [float(np.percentile(vals, q)) for q in (10, 50, 90)]
                row['mcYear'] = yr_vals
                row['mcBand'] = {m: dist[m] for m in range(1, 13)}
            # old weather Monte Carlo from the detailed replay (same years, national)
            res['rows'].append(row)
            sc = {conv: {k: score(v, act, conv) for k, v in preds[conv].items()} for conv in ('all', 'curt')}
            row['score'] = sc
            print(TECH[t], Y, ' | '.join(f"{k} {sc['curt'][k]['eur']:+.2f}" for k in sc['curt'] if sc['curt'][k]), flush=True)
    add_weather(res)
    hybrid(res)
    forecast(res, choice, sims)
    ensemble(res)
    for r in res['rows']:
        r.get('mcBand', None)
    with open(OUT, 'w') as f:
        json.dump(res, f, separators=(',', ':'), default=float)
    print('wrote', OUT)
    export(res)


def export(res):
    """the small file the pricer reads: monthly forecasts, the hybrid rule, the replay scores and the band"""
    out = {'asOf': res['forecast']['asOf'], 'protocol': res['protocol'], 'settings': res['settings'], 'forecast': res['forecast']['months'],
           'hybrid': {}, 'scores': {}, 'share': {}}
    # monthly share of the yearly output, national profile, complete years since 2016 except 2022
    for t in 'sw':
        sh = {m: [] for m in range(1, 13)}
        for y, a in DATA.items():
            if not a['complete'] or y == 2022:
                continue
            V = a['fr_' + t].sum(axis=1)
            tot = V.sum()
            for m in range(1, 13):
                sh[m].append(V[a['month'] == m].sum() / tot)
        out['share'][TECH[t]] = {m: float(np.mean(v)) for m, v in sh.items()}
    for tech in ('solar', 'wind'):
        for conv in ('all', 'curt'):
            h = res['hybrid'][tech][conv]
            rows = [r for r in res['rows'] if r['tech'] == tech]
            pts = {r['year']: {**{k: (r['score'][conv].get(k) or {}).get('pts') for k in METHODS + ('hybrid',)}, 'hybrid': (r['score'][conv].get('ensemble') or {}).get('pts'), 'protocolPick': (r['score'][conv].get('hybrid') or {}).get('pts')} for r in rows}
            eur = {r['year']: {**{k: (r['score'][conv].get(k) or {}).get('eur') for k in METHODS + ('hybrid',)}, 'hybrid': (r['score'][conv].get('ensemble') or {}).get('eur'), 'protocolPick': (r['score'][conv].get('hybrid') or {}).get('eur')} for r in rows}
            # band of the hybrid in capture points: ± t × root-mean-square error of the replay years (recent ones weigh
            # more, 0.7 per year back), centred on the price: too few years to estimate a bias and a spread apart
            def rms_band(errs, ys, ref):
                errs = np.array(errs); w = np.array([0.7 ** (ref - y) for y in ys])
                rms = math.sqrt((w * errs ** 2).sum() / w.sum())
                tq = {3: 1.638, 4: 1.533, 5: 1.476, 6: 1.440, 7: 1.415}.get(len(errs) - 1, 1.4)
                return tq * rms * math.sqrt(1 + 1 / len(errs))
            ys = [y for y in sorted(pts) if pts[y]['hybrid'] is not None and y < date.today().year]
            half = rms_band([pts[y]['hybrid'] for y in ys], ys, max(ys))
            out['hybrid'].setdefault(tech, {})[conv] = {k: h[k] for k in ('pick', 'ranking', 'summerBest', 'winterBest', 'bias')}
            out['hybrid'][tech][conv]['used'] = h.get('used', h['pick'])
            out['hybrid'][tech][conv]['members'] = list(ENSEMBLE)
            hits = []
            for y in (2024, 2025, 2026):
                pr = [x for x in sorted(pts) if x < y and pts[x]['hybrid'] is not None]
                if len(pr) < 3 or pts.get(y, {}).get('hybrid') is None:
                    continue
                hw = rms_band([pts[x]['hybrid'] for x in pr], pr, y - 1)
                hits.append(abs(pts[y]['hybrid']) <= hw)
            out['hybrid'][tech][conv]['bandPts'] = {'lo': -half, 'hi': half, 'n': len(ys), 'hitRate': float(np.mean(hits)) if hits else None, 'checks': len(hits)}
            out['scores'].setdefault(tech, {})[conv] = {'pts': pts, 'eur': eur, 'calibration': h['calibration']}
    with open(os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'), default=float)
    print('wrote ppa_forecast.json')


def regional_fr_only(t, Y, train_w, pm, demand_year, capY):
    """approach 4 with France's own residual load only (the setting it is compared with)"""
    days = calendar(Y)
    month = np.array([int(d[5:7]) for d in days])
    g = grp(month)
    res4 = []
    for wy in train_w:
        h = assemble(Y, days, weather_index(Y, wy, days), demand_year, capY)
        x = residual_share(None, False, h['s'], h['w'], h['l'], h['n'], h['pump'])
        rm, rp, pp = pm.expected(x, g)
        res4.append(month_rates(month, h[t]['FR'], rm, rp, pp))
    m4 = {m: {k: float(np.mean([r[m][k] for r in res4 if m in r and r[m][k] is not None])) for k in ('all', 'curt', 'paid', 'negH')} for m in range(1, 13)}
    return m4, None, None


def add_weather(res):
    """the current pricer's weather Monte Carlo, months from ppa_backtest_detail.json"""
    try:
        det = json.load(open(os.path.join(ROOT, 'data', 'history', 'ppa_backtest_detail.json')))
    except OSError:
        return
    for row in res['rows']:
        for conv in ('all', 'curt'):
            d = next((r for r in det['rows'] if r['tech'] == row['tech'] and r['year'] == row['year'] and r['conv'] == conv), None)
            if d and not row['pred'][conv].get('weather'):
                row['pred'][conv]['weather'] = {mm['m']: mm['pred']['weather'] for mm in d['months'] if mm['pred']['weather'] is not None}
                row['score'][conv]['weather'] = score(row['pred'][conv]['weather'], row['actual'], conv)


METHODS = ('dashboard', 'step', 'fpc', 'weather', 'regional', 'regionalMC')


def hybrid(res):
    """candidates chosen on the calibration years only, then judged on the verdict years"""
    out = {}
    for tech in ('solar', 'wind'):
        for conv in ('all', 'curt'):
            rows = [r for r in res['rows'] if r['tech'] == tech]
            cal = [r for r in rows if r['set'] == 'calibration']
            def err(rs, fn, months=None):
                v = [score(fn(r), r['actual'], conv, months) for r in rs]
                v = [x['eur'] for x in v if x]
                return float(np.mean(np.abs(v))) if v else None
            single = {k: err(cal, lambda r, k=k: r['pred'][conv].get(k, {})) for k in METHODS}
            single = {k: v for k, v in single.items() if v is not None}
            rank = sorted(single, key=single.get)
            def P(r, k):
                return r['pred'][conv].get(k) or r['pred'][conv]['fpc']
            cands = {'best': lambda r, a=rank[0]: P(r, a),
                     'avg2': lambda r, a=rank[0], b=rank[1]: {m: (P(r, a)[m] + P(r, b)[m]) / 2 for m in P(r, a) if m in P(r, b)}}
            # seasonal switch: best in summer + best in winter
            summer, winter = list(range(4, 10)), [1, 2, 3, 10, 11, 12]
            bs = min(single, key=lambda k: err(cal, lambda r, k=k: r['pred'][conv].get(k, {}), summer) or 9e9)
            bw = min(single, key=lambda k: err(cal, lambda r, k=k: r['pred'][conv].get(k, {}), winter) or 9e9)
            cands['season'] = lambda r, s=bs, w=bw: {m: P(r, s if m in summer else w)[m] for m in range(1, 13) if m in P(r, s if m in summer else w)}
            # bias correction: the calibration years' mean capture error of the best single, removed
            biases = []
            for r in cal:
                s = score(P(r, rank[0]), r['actual'], conv)
                if s:
                    biases.append(s['pts'] / 100)
            bias = float(np.mean(biases)) if biases else 0.0
            cands['bestDebiased'] = lambda r, a=rank[0], b=bias: {m: v - b for m, v in P(r, a).items()}
            # leave-one-calibration-year-out for the candidates that learn something
            cal_err = {k: err(cal, f) for k, f in cands.items()}
            pick = min(cal_err, key=cal_err.get)
            ver = [r for r in rows if r['set'] == 'verdict']
            out.setdefault(tech, {})[conv] = {
                'calibration': {**{k: round(v, 3) for k, v in single.items()}, **{'hybrid:' + k: round(v, 3) for k, v in cal_err.items()}},
                'ranking': rank, 'summerBest': bs, 'winterBest': bw, 'bias': bias, 'pick': pick,
                'verdict': {**{k: {r['year']: (score(r['pred'][conv].get(k, {}), r['actual'], conv) or {}).get('eur') for r in ver} for k in single},
                            'hybrid': {r['year']: (score(cands[pick](r), r['actual'], conv) or {}).get('eur') for r in ver}},
                'verdictPts': {**{k: {r['year']: (score(r['pred'][conv].get(k, {}), r['actual'], conv) or {}).get('pts') for r in ver} for k in single},
                               'hybrid': {r['year']: (score(cands[pick](r), r['actual'], conv) or {}).get('pts') for r in ver}},
            }
            # the hybrid's predictions stored on each row
            for r in rows:
                r['pred'][conv]['hybrid'] = cands[pick](r)
                r['score'][conv]['hybrid'] = score(r['pred'][conv]['hybrid'], r['actual'], conv)
            # band: yearly € errors of the hybrid on every past year (recent ones weigh more), checked on the verdict years
            out[tech][conv]['band'] = band(rows, conv)
    res['hybrid'] = out


def band(rows, conv):
    """80 % band of the yearly value error, from the years before each verdict year (expanding), and its hit rate"""
    hits, bands = [], {}
    for r in rows:
        if r['set'] != 'verdict':
            continue
        prior = [x for x in rows if x['year'] < r['year'] and x['score'][conv].get('hybrid')]
        if len(prior) < 3:
            continue
        e = np.array([x['score'][conv]['hybrid']['eur'] for x in prior])
        w = np.array([0.7 ** (r['year'] - x['year']) for x in prior])
        mu = float((w * e).sum() / w.sum())
        sd = float(math.sqrt((w * (e - mu) ** 2).sum() / w.sum()) * math.sqrt(len(e) / max(1, len(e) - 1)))
        tq = {3: 1.638, 4: 1.533, 5: 1.476, 6: 1.440, 7: 1.415}.get(len(e) - 1, 1.4)
        half = tq * sd * math.sqrt(1 + 1 / len(e))
        lo, hi = -mu - half, -mu + half      # actual value − predicted value lies in [lo, hi]
        got = r['score'][conv]['hybrid']
        if got:
            miss = -got['eur']
            hits.append(lo <= miss <= hi)
        bands[r['year']] = {'lo': lo, 'hi': hi, 'actualMinusPred': -got['eur'] if got else None}
    return {'byYear': bands, 'hitRate': float(np.mean(hits)) if hits else None, 'n': len(hits)}


def season_coefs():
    """month ÷ year and month ÷ quarter baseload ratios, complete years since 2016 except 2022"""
    ys = [y for y in DATA if DATA[y]['complete'] and y != 2022]
    cm, cq = {m: [] for m in range(1, 13)}, {m: [] for m in range(1, 13)}
    for y in ys:
        a = DATA[y]
        base = {m: a['fr_p'][a['month'] == m].mean() for m in range(1, 13)}
        yb = np.mean(list(base.values()))
        for m in range(1, 13):
            q = [(m - 1) // 3 * 3 + i for i in (1, 2, 3)]
            cm[m].append(base[m] / yb); cq[m].append(base[m] / np.mean([base[i] for i in q]))
    return {m: float(np.mean(v)) for m, v in cm.items()}, {m: float(np.mean(v)) for m, v in cq.items()}


MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def forward_levels(Y):
    """monthly forward level of France for year Y: the site's monthly forward curve (data/history/
    fr_forward_monthly.json: the month contract when listed, else the quarter shaped by month ÷ quarter ratios,
    else the Cal shaped by the last quarter-quoted year's shape blended with history), as the pricer reads it;
    without that file, the contracts directly"""
    try:
        fm = json.load(open(os.path.join(ROOT, 'data', 'history', 'fr_forward_monthly.json')))['months']
        out = {m: fm[f'{Y}-{m:02d}']['value'] for m in range(1, 13) if f'{Y}-{m:02d}' in fm}
        if len(out) == 12:
            return out
    except (OSError, KeyError, ValueError):
        pass
    try:
        ct = json.load(open(os.path.join(ROOT, 'data', 'history', 'fr_market_contracts.json')))['FR']
    except OSError:
        return None
    ct = {k: v for k, v in ct.items() if not k.endswith('Peak')}      # base contracts only
    lastv = {k: v['points'][max(v['points'])] for k, v in ct.items() if v.get('points')}
    newest = max(max(v['points']) for v in ct.values() if v.get('points'))
    live = {k: lastv[k] for k, v in ct.items() if v.get('points') and max(v['points']) >= newest}
    cm, cq = season_coefs()
    out = {}
    for m in range(1, 13):
        q = (m - 1) // 3 + 1
        if f'{MON[m - 1]}{Y}' in live:
            out[m] = live[f'{MON[m - 1]}{Y}']
        elif f'Q{q}{Y}' in live:
            out[m] = live[f'Q{q}{Y}'] * cq[m]
        elif f'Cal{Y}' in live:
            out[m] = live[f'Cal{Y}'] * cm[m]
    return out or None


ENSEMBLE = ('step', 'fpc', 'regional', 'weather')


def ensemble(res):
    """equal-weight average of four different families: a trend on capacity (Step by step), the forward-curve
    shape (FPC), the regional hourly price model and the Monte Carlo on simulated weather. The walk-forward
    test (scripts/ppa_walkforward.py: each year 2020-2026 scored with choices made on the years before) showed
    that a fixed average beats picking the best method so far, and that this one is the best or close to it
    every year. Used by the pricer."""
    for r in res['rows']:
        for conv in ('all', 'curt'):
            P = r['pred'][conv]
            mem = [e for e in ENSEMBLE if P.get(e)]
            ks = [k for k in P[mem[0]] if all(k in P[e] and P[e][k] is not None for e in mem)]
            P['ensemble'] = {k: float(np.mean([P[e][k] for e in mem])) for k in ks}
            r['score'][conv]['ensemble'] = score({int(k): v for k, v in P['ensemble'].items()}, {int(k): v for k, v in r['actual'].items()}, conv)
    for tech in ('solar', 'wind'):
        for conv in ('all', 'curt'):
            h = res['hybrid'][tech][conv]
            rows = [r for r in res['rows'] if r['tech'] == tech]
            h['used'] = 'ensemble'
            h['ensemble'] = {r['year']: r['score'][conv]['ensemble'] for r in rows}
    for tech, d in res['forecast']['months'].items():
        for conv, ms in d.items():
            for e in ms.values():
                e['protocolPick'] = e.get('hybrid')
                e['hybrid'] = float(np.mean([e[k] for k in ENSEMBLE if e.get(k) is not None]))


def forecast(res, choice, sims):
    """monthly capture rates for the pricer: every month from next month to the end of 2030, both conventions"""
    this = date.today()
    past = [y for y in DATA if DATA[y]['complete']]
    last = max(past)
    out = {'asOf': this.isoformat(), 'lastYear': last, 'months': {}}
    for t in 'sw':
        tech = TECH[t]
        st = choice[t]
        pm = PriceModel([y for y in past if st['with2022'] or y != 2022][-st['window']:], st['regional'], 'mean', st['level'] != 'none')
        train = [y for y in past if y != 2022]
        V = B.S if t == 's' else B.W
        for Y in range(this.year, 2031):
            capY = {c: {tt: cap_future(c, tt, Y) for tt in 'sw'} for c in ('FR',) + NEIGH}
            lv = forward_levels(Y) if st['level'] == 'forward' else levels_for(last + 1, 'lastyear') if st['level'] == 'lastyear' else None
            m4, m5, dist = regional(t, Y, past, pm, last, capY, max(60, sims // 2), lv, st['regional'])
            for conv in ('all', 'curt'):
                fy, fm, _ = BD.m_fpc(t, Y, train, V, conv)
                dash, stp = BD.m_dashboard(t, Y, train, V, conv), BD.m_step(t, Y, train, V, conv)
                if conv == 'all':
                    _, wfc, _ = BD.m_weather(t, Y, train, V, 40)
                for m in range(1, 13):
                    if date(Y, m, 1) <= date(this.year, this.month, 1):
                        continue
                    k = f'{Y}-{m:02d}'
                    e = out['months'].setdefault(tech, {}).setdefault(conv, {}).setdefault(k, {})
                    e.update({'peakRatio': m4[m].get('peak'), 'weather': wfc[conv].get(m), 'dashboard': dash, 'step': stp, 'fpc': fm[m], 'regional': m4[m][conv], 'regionalMC': m5[m][conv], 'p10': dist[m][conv][0], 'p90': dist[m][conv][2],
                              'paid': m4[m]['paid'], 'negH': m4[m]['negH'], 'capGW': capY['FR'][t]})
            print('forecast', tech, Y, flush=True)
    # the hybrid rule chosen on the calibration years, applied to the forecasts
    for tech in ('solar', 'wind'):
        for conv in ('all', 'curt'):
            h = res['hybrid'][tech][conv]
            for k, e in out['months'][tech][conv].items():
                m = int(k[5:7])
                if h['pick'] == 'season':
                    src = h['summerBest'] if 4 <= m <= 9 else h['winterBest']
                    e['hybrid'] = e.get(src)
                elif h['pick'] == 'bestDebiased':
                    e['hybrid'] = e.get(h['ranking'][0]) - h['bias'] if e.get(h['ranking'][0]) is not None else None
                elif h['pick'] == 'avg2':
                    a, b = e.get(h['ranking'][0]), e.get(h['ranking'][1])
                    e['hybrid'] = (a + b) / 2 if a is not None and b is not None else a
                else:
                    e['hybrid'] = e.get(h['ranking'][0])
    res['forecast'] = out


if __name__ == '__main__':
    main()
