#!/usr/bin/env python3
"""One scenario generator for the physical methods (Tom 29 Oct. 2026: build the scenarios with every variable correlated).

A scenario is a delivery year made of real past weeks, chained:
  1. weeks   for each week of the delivery year, a real 7-day block of a past complete year (2022 left out) that starts
             on the same weekday within ±7 days of the same date (±14: wind 2.57 → 2.41 €/MWh with ±7, solar 0.84 → 0.86;
             one-day blocks instead of weeks: wind 3.44, solar 1.09, so weeks); among those, the next block is drawn closer to how
             the previous one ended (French wind load factor and demand deviation of its last day), so a storm does
             not stop at the seam
  2. same day, everything   each day brings, for France, Germany, Belgium and Spain together: solar and wind load
             factors hour by hour (output ÷ that day's fleet, interpolated through its year), demand and nuclear as a
             deviation from that year's mean for the month and day kind, and the day's own price surprise (below)
  3. the delivery year's fleets and levels   load factors × each country's fleet on that day of the delivery year
             (linear from the previous year-end to the year-end); demand and nuclear deviations × the last complete
             year's means for the month and day kind
  4. amplified (option)   each block's deviations from the month's normal (wind, sun, demand) × one common factor
             (lognormal, mean 1, spread `amp`), so years can be more extreme than any past one with every variable
             moving together
  5. prices  one rule for all: price ÷ the month's average as a function of the region's residual share
             (scripts/ppa_lab.py PriceModel, season × time of day × price level of the month's forward), plus the
             historical day's own surprise in €/MWh (its realised price − the rule's price for that day), ÷ the delivery
             month's level, hour by hour, so the price shock follows the weather that caused it
  6. capture month by month in both conventions (output stopped at prices <= 0 in 'curt'), and the paid share

    import ppa_scenarios as G
    m, dist = G.simulate('w', 2027, known, settings, last, capY, levels, n=60)
"""
import os
import sys
from datetime import date, timedelta

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L                  # noqa: E402
sys.argv = _argv

CS = ('FR',) + L.NEIGH
PRE = {c: ('fr_' if c == 'FR' else c + '_') for c in CS}
_YEAR = {}
FLEET_STOP = os.environ.get('PK_FLEET_STOP') == '1'   # part of the French fleet stops when the price is ≤ 0 (23 % of
# wind and 17 % of solar in 2024, 30 % and 17 % in 2025), in the simulation, with the stops added back to the weather
# weeks of those years: generator replay 2020–2025 wind 2.22 → 2.19, solar 0.90 → 0.95 €/MWh, both 1.56 → 1.57; 2027 wind
# capture 1.070 → 1.063; off (31 Oct. 2026)
# French solar and wind stopped during negative prices, TWh (RTE, Bilan électrique, published each spring): estimated by
# RTE as the day-ahead forecast without stops minus the output during those hours
CURT_RTE = {2024: {'w': 0.9, 's': 0.8}, 2025: {'w': 1.3, 's': 1.6}}


def _addback(y, t):
    """France's output of technology t in year y with the stops at negative prices added back (what the weather gave),
    spread over the negative hours in proportion to the output"""
    a = L.DATA[y]
    v = a['fr_' + t].astype(float).copy()
    if FLEET_STOP and y in CURT_RTE:
        n = a['fr_p'] <= 0
        if v[n].sum() > 0:
            v[n] *= 1 + CURT_RTE[y][t] * 1e6 / v[n].sum()
    return v


CF_LEVEL = os.environ.get('PK_CF_LEVEL', 'trend') or None   # each drawn week's output per installed GW brought to the
# level of the last complete year (its weather variation kept): output per GW fell in 2019–2025 (stops at negative
# prices, self-consumption, Spanish curtailment: Spain solar 21.8 % → 17.1 %, Germany solar 10.7 % → 8.0 %, Germany wind
# 23.5 % → 19.7 %), so old weather on today's fleet made far more surplus than the market sees. 'trend': ratio of a
# straight line through the years (keeps a windy year windy); 'year': ratio of yearly means. Generator replay 2020–2025:
# solar 0.90 → 0.59, wind 2.22 → 2.07, both 1.56 → 1.33 €/MWh ('year' 0.58 / 2.11); with NUC_AV, FR_LIN or both on top,
# worse; adopted 31 Oct. 2026


def cf_scale(c, t, y, ref, pool):
    """multiplier for country c, technology t, weather year y, so its output per GW matches year ref's level"""
    lv = {yy: float(_year(yy)[f'{c}_{t}'].mean()) for yy in sorted(set(pool) | {ref}) if yy in L.DATA and L.DATA[yy]['complete'] and yy != 2022}
    if y not in lv or ref not in lv or lv[y] <= 0:
        return 1.0
    if CF_LEVEL == 'trend' and len(lv) >= 3:
        ys = np.array(sorted(lv)); a, b = np.polyfit(ys, [lv[k] for k in ys], 1)
        fy, fr = a * y + b, a * ref + b
        return float(fr / fy) if fy > 0 else 1.0
    return lv[ref] / lv[y]


def stop_share(t, Y):
    """the share of France's technology t that stops at prices ≤ 0, from the last year RTE measured before Y (stopped
    ÷ stopped + produced during those hours); none before 2024"""
    ys = [y for y in CURT_RTE if y < Y and y in L.DATA]
    if not FLEET_STOP or not ys:
        return 0.0
    y = max(ys); a = L.DATA[y]; n = a['fr_p'] <= 0
    c = CURT_RTE[y][t] * 1e6
    return c / (c + a['fr_' + t][n].sum())


def _year(y):
    """per-day arrays of a past year: load factors, demand / nuclear deviations, price ratio, its rule residual"""
    if y in _YEAR:
        return _YEAR[y]
    a = L.DATA[y]
    days = [date.fromisoformat(str(d)[:10]) for d in a['days']]
    frac = np.array([(d.timetuple().tm_yday - 0.5) / (366 if d.year % 4 == 0 else 365) for d in days])
    kinds = np.array([L.day_kind(d) for d in days])
    out = {'days': days, 'doy': np.array([d.timetuple().tm_yday for d in days]), 'wd': np.array([d.weekday() for d in days]),
           'month': a['month'], 'kind': kinds}
    for c in CS:
        p = PRE[c]
        for t in 'sw':
            c1 = L.cap(c, t, y) or 1.0
            c0 = L.cap(c, t, y - 1) or c1
            gw = (c0 + (c1 - c0) * frac)[:, None] * 1000
            out[f'{c}_{t}'] = np.clip((_addback(y, t) if c == 'FR' else a[p + t]) / gw, 0, 1.2)
        for v in 'ln':
            arr = a[p + v]
            ref = np.ones(len(days))
            for m in range(1, 13):
                for k in range(3):
                    sel = (a['month'] == m) & (kinds == k)
                    if sel.any():
                        ref[sel] = arr[sel].mean()
            out[f'{c}_{v}dev'] = np.divide(arr, ref[:, None], out=np.ones_like(arr, dtype=float), where=ref[:, None] > 1)
    P = a['fr_p']
    mavg = np.array([P[a['month'] == m].mean() for m in a['month']])[:, None]
    out['mavg'] = mavg
    out['ratio'] = P / np.where(np.abs(mavg) > 1, mavg, 1)
    _YEAR[y] = out
    return out


def _means(y):
    """demand and nuclear means of year y by country, month and day kind (MW, per hour)"""
    a, d = L.DATA[y], _year(y)
    out = {}
    for c in CS:
        for v in 'ln':
            arr = a[PRE[c] + v]
            for m in range(1, 13):
                for k in range(3):
                    sel = (a['month'] == m) & (d['kind'] == k)
                    if sel.any():
                        out[(c, v, m, k)] = float(arr[sel].mean())
                    elif (a['month'] == m).any():
                        out[(c, v, m, k)] = float(arr[a['month'] == m].mean())
    return out


class PriceModel2:
    """price ÷ the month's average as a function of two residual shares: the region's (France and its neighbours) and
    France's own, by season × time of day × price level. When the interconnectors are full, France's own surplus
    lowers its price beyond what the region's says (winter: at a given regional share, corr(price ratio, France's
    share) 0.27–0.38 in 2025). Cells with too few hours take the 1-D rule (ppa_lab.PriceModel) of the same group."""
    BR, BF = 0.05, 0.10

    def __init__(self, years, level=True):
        self.one = L.PriceModel(years, True, 'mean', level)
        self.level = level
        xs, fs, gs, rs = [], [], [], []
        for y in years:
            a = L.DATA[y]
            P = a['fr_p']
            mavg = np.array([P[a['month'] == m].mean() for m in a['month']])[:, None]
            ok = mavg[:, 0] > 5
            g = L.grp(a['month']) + 6 * self.one.lclass(mavg[:, 0])[:, None] * level
            xs.append(L.residual_share(a, True)[ok].ravel()); fs.append(L.residual_share(a, False)[ok].ravel())
            gs.append(g[ok].ravel()); rs.append((P / mavg)[ok].ravel())
        x, f, g, r = (np.concatenate(v) for v in (xs, fs, gs, rs))
        bx, bf = np.round(x / self.BR).astype(int), np.round(f / self.BF).astype(int)
        self.tab = {}
        key = (g * 1000 + (bx + 100)) * 1000 + (bf + 100)
        for k in np.unique(key):
            sel = key == k
            if sel.sum() >= 20:
                v = r[sel]
                self.tab[int(k)] = (v.mean(), (v * (v > 0)).mean(), (v > 0).mean())
        self.lclass = self.one.lclass

    def expected(self, x, f, g):
        r1 = self.one.expected(x, g)
        bx, bf = np.round(x / self.BR).astype(int), np.round(f / self.BF).astype(int)
        key = (g * 1000 + (bx + 100)) * 1000 + (bf + 100)
        out = [a.copy() for a in r1]
        flat = key.ravel()
        for k in np.unique(flat):
            v = self.tab.get(int(k))
            if v is not None:
                sel = key == k
                for i in range(3):
                    out[i][sel] = v[i]
        return tuple(out)


_FUEL = None
_HYD = {}
GM_ZONE = {'FR': 'FR', 'DE': 'DE_LU', 'BE': 'BE', 'ES': 'ES'}


_ROR = None


def hydro_daily(y):
    """{country: daily run-of-river output (MW) aligned on the lab's days of year y} (data/history/run_of_river_daily.
    json, Energy-Charts, 2020 on); None when the year is not covered. Run-of-river only: it follows the rain, while the
    reservoirs produce when power is dear (taking them off the residual load made wind look better than it is: on the
    true weather of 2023–2025, wind 1.69 → 2.29 €/MWh with all hydro, 1.65 with run-of-river; solar 1.94 → 1.56)"""
    global _ROR
    if y in _HYD:
        return _HYD[y]
    if _ROR is None:
        import json
        try:
            _ROR = json.load(open(os.environ.get('PK_ROR', os.path.join(ROOT, 'data', 'history', 'run_of_river_daily.json'))))['countries']
        except (OSError, ValueError, KeyError):
            _ROR = {}
    days = [str(d)[:10] for d in L.DATA[y]['days']]
    if not _ROR.get('FR') or sum(1 for d in days if d in _ROR['FR']) < 0.9 * len(days):
        _HYD[y] = None
        return None
    _HYD[y] = {c: np.array([float(_ROR.get(c, {}).get(d, 0.0)) for d in days]) for c in CS}
    return _HYD[y]


def share(S, W, Lo, N, H=None, region=True):
    """(load − solar − wind − nuclear − hydro) ÷ load, the region summed or France alone; H daily MW per country"""
    cs = CS if region else ('FR',)
    tot = sum(Lo[c] for c in cs)
    res = sum(Lo[c] - S[c] - W[c] - N[c] - (H[c][:, None] if H is not None else 0) for c in cs)
    return res / tot


NUC_AVAIL = {'on': False}   # nuclear as the day's maximum output (≈ available) instead of the hour's output: worse on
# the true weather of 2021–2025 (both technologies 1.47 → 1.69 €/MWh), so off


def nuc(arr):
    """the nuclear the rule sees: the hour's output, or (NUC_AVAIL) the day's maximum, since plants modulate down when
    prices are low (windy nights) and the output then understates what could run"""
    return np.repeat(arr.max(axis=1, keepdims=True), arr.shape[1], axis=1) if NUC_AVAIL['on'] else arr


DAYX = os.environ.get('PK_DAYX') or None   # the rule's second input = the day's mean residual share ('fr' or 'reg'), since
# windy days are cheaper all day than their hours say (2025: +6 € calm days → −12 € very windy ones at the same hourly
# wind): on the true weather of 2023–2025 'fr' solar 1.97 → 1.78 but wind 1.68 → 1.81, 'reg' worse for both; off


EXPCAP = {'on': os.environ.get('PK_EXPCAP') == '1', 'Y': None}   # France's input = its surplus beyond its export room
# (99th percentile of net physical exports: 14.8 GW in 2023, 16.7 in 2024, 18.2 in 2025): on the true weather of
# 2023–2025 worse for both (wind 1.68 → 1.96, solar 1.97 → 2.10 €/MWh), off (30 Oct. 2026)
_EXP = None


def export_room(y):
    """France's export room in a year, MW: the 99th percentile of its hourly net physical exports (data/history/flows,
    Energy-Charts); years before the data take the first year's"""
    global _EXP
    if _EXP is None:
        import glob
        import json
        by = {}
        for f in glob.glob(os.path.join(ROOT, 'data', 'history', 'flows', '*.json')):
            for d, v in json.load(open(f))['days'].items():
                fr = v.get('FR')
                if fr and all(len(x) == 24 for x in fr.values()):
                    by.setdefault(int(d[:4]), []).append(-np.sum([np.array(x, float) for x in fr.values()], axis=0))
        _EXP = {k: float(np.nanpercentile(np.concatenate(v), 99)) for k, v in by.items() if len(v) > 300}
    ks = sorted(_EXP)
    return _EXP.get(y, _EXP[ks[0]] if y < ks[0] else _EXP[ks[-1]])


def beyond_room(res_mw, y):
    """what France must absorb beyond its export room, GW (residual load + export room; below 0 = saturated)"""
    return (res_mw + export_room(y)) / 1000


def day_mean(a):
    return np.repeat(a.mean(axis=1, keepdims=True), a.shape[1], axis=1)


FR_GW = {'on': False}   # the France input in GW of residual load (bins of 2 GW) instead of a share of its load:
# worse on the true weather of 2023–2025 (both technologies 1.55 → 1.91 €/MWh), off


def fr_gw(S, W, Lo, N, H=None):
    """France's residual load in GW (negative = surplus to export)"""
    return (Lo['FR'] - S['FR'] - W['FR'] - N['FR'] - (H['FR'][:, None] if H is not None else 0)) / 1000


NUC_AV = os.environ.get('PK_NUC_AV') == '1'   # France's nuclear as its available capacity (ENTSO-E, day by day), not its
# output: the output falls when prices fall (the fleet modulates on windy nights), which hid part of the surplus. On the
# true weather of 2023–2025, all hours paid: wind 2.31 → 1.84, solar 3.18 → 2.10 €/MWh, output stopped at ≤ 0 unchanged;
# generator replay 2020–2025 wind 2.22 → 2.26, solar 0.90 → 0.91; off (31 Oct. 2026)
_AV = None


def fr_avail(y):
    """France's available nuclear capacity, MW, days × 24 of year y (data/history/commodities_series.json
    fr_nuc_avail, ENTSO-E); days without it keep the output"""
    global _AV
    if _AV is None:
        import json
        _AV = dict(json.load(open(os.path.join(ROOT, 'data', 'history', 'commodities_series.json')))['series']['fr_nuc_avail']['points'])
    a = L.DATA[y]
    out = a['fr_n'].astype(float).copy()
    for i, d in enumerate(a['days']):
        v = _AV.get(str(d)[:10])
        if v:
            out[i, :] = v
    return out


def fr_nuc(y):
    return fr_avail(y) if NUC_AV else nuc(L.DATA[y]['fr_n'])


def year_fr_gw(y, hydro=False):
    a = L.DATA[y]
    h = hydro_daily(y) if hydro else None
    return (a['fr_l'] - a['fr_s'] - a['fr_w'] - fr_nuc(y) - (h['FR'][:, None] if h is not None else 0)) / 1000


def year_share(y, region=True, hydro=False):
    a = L.DATA[y]
    S = {c: a[PRE[c] + 's'] for c in CS}; W = {c: a[PRE[c] + 'w'] for c in CS}
    Lo = {c: a[PRE[c] + 'l'] for c in CS}; N = {c: nuc(a[PRE[c] + 'n']) for c in CS}
    if NUC_AV:
        N['FR'] = fr_avail(y)
    return share(S, W, Lo, N, hydro_daily(y) if hydro else None, region)


def fuel_cost():
    """{date: €/MWh} short-run cost of a gas plant: TTF day-ahead ÷ 0.55 + 0.37 t/MWh × EUA (data/history/
    commodities_series.json, SEFE daily; EUA before its first point takes its first value), days without a quote carry
    the last one"""
    global _FUEL
    if _FUEL is None:
        import json
        s = json.load(open(os.path.join(ROOT, 'data', 'history', 'commodities_series.json')))['series']
        ttf, eua = dict(s['ttf']['points']), dict(s['eua']['points'])
        first_eua = eua[min(eua)]
        out, lt, le = {}, None, first_eua
        d, end = date(2019, 1, 1), date.today()
        while d <= end:
            k = d.isoformat()
            lt = ttf.get(k, lt); le = eua.get(k, le)
            if lt is not None:
                out[k] = lt / 0.55 + 0.37 * le
            d += timedelta(days=1)
        _FUEL = out
    return _FUEL


class PriceModelFuel:
    """price of the hour in €/MWh = the day's gas-plant cost × φ(residual share of the region), by season × time of
    day; φ is learnt as price ÷ that day's cost on the years given. When much is left to produce, the gas plant sets
    the price (φ ≈ 1, and spikes when it is scarce); when little is left, φ falls towards the floor the recent years
    show, with today's stops at negative prices and flexibility in it. Expressed in € through the fuel cost, the rule
    keeps a crisis month's spikes and a sunny month's floor apart, which a ratio to the month's average mixed up."""

    BLOCKS = 3      # times of day per season: 3 (night 0–9, day 9–17, evening 17–24), 6 (4-hour blocks) or 24

    DAYKIND = False   # a separate cell for weekends and public holidays: on deliveries 2023–2025, worse (solar
    # 0.92 → 1.13, wind 2.99 → 3.00 €/MWh); kept for a few hours on a test biased by the 2021 deliveries (30 Oct. 2026)

    @classmethod
    def groups(cls, month, kinds=None):
        summer = ((month[:, None] >= 4) & (month[:, None] <= 9)).astype(int)
        h = np.arange(24)[None, :]
        g = L.grp(month) if cls.BLOCKS == 3 else summer * cls.BLOCKS + h // (24 // cls.BLOCKS)
        if cls.DAYKIND and kinds is not None:
            g = g + 2 * cls.BLOCKS * (np.asarray(kinds)[:, None] > 0)
        return g

    EXTRAP = False  # below the deepest surplus seen, keep falling (slope of the lowest cells) down to the observed floor
    AFFINE = False  # price = a + b × fuel cost per cell: worse on the true weather of 2023–2025 (1.60 → 1.73 €/MWh), off
    HYDRO = False   # run-of-river off the residual load: on deliveries 2023–2025 with the same learning years for
    # every version, worse for both (solar 0.92 → 1.76, wind 2.99 → 3.64 €/MWh); an earlier test including 2021
    # deliveries (one learning year only once run-of-river is required) had wrongly kept it (30 Oct. 2026)

    FR_LIN = os.environ.get('PK_FR_LIN') == '1'   # within each cell, the price follows a straight line in France's residual
    # load (GW): in 2025 the price still moved ≈ 1.5 € per GW of French wind inside a cell 6 GW wide. True weather
    # 2023–2025: wind 1.68 → 1.46, solar 1.97 → 1.80 €/MWh (with NUC_AV 1.39 and 1.80); generator replay 2020–2025 wind
    # 2.22 → 2.25, solar 0.90 → 1.10 (with NUC_AV 2.25 and 1.01); off (31 Oct. 2026)
    INTERP = os.environ.get('PK_INTERP') == '1'   # straight lines between the 2-D cells' centres: on the true weather of
    # 2023–2025 a little better (wind 1.68 → 1.62, solar 1.97 → 1.72 €/MWh), in the generator replay 2020–2025 worse for
    # both together (1.56 → 1.60), off (30 Oct. 2026)
    NEG_EUR = os.environ.get('PK_NEG_EUR', '1') == '1'   # the negative part of the price learnt in € per cell, not as a
    # multiple of the gas cost: negative prices come from renewables that keep producing and from stops, not from gas
    # (a dear-gas year made them deeper: −12 to −17 €/MWh simulated vs −2 to −7 realised in 2025). Replay 2020–2025:
    # wind 2.49 → 2.22, solar 0.85 → 0.90, both 1.67 → 1.56 €/MWh; adopted 30 Oct. 2026

    MO_EUR = os.environ.get('PK_MO_EUR') == '1'   # a cell follows gas only where gas set its price in the learning years;
    # elsewhere (nuclear, hydro, exports at the margin) its price is learnt in €. Chosen per cell, no setting: the form that
    # better predicts each learning year from the other. On the true weather of 2023–2025: wind 1.68 → 1.62, solar 1.97 →
    # 2.28 €/MWh; 2025 unchanged (2023 and 2024 had the same gas level, nothing to choose on), off (30 Oct. 2026)

    @staticmethod
    def _pick(p, c, yr):
        """(learnt in €?, mean €, mean of the positive part €) for one cell's hours: price p €, gas cost c, year yr"""
        ys = [y for y in np.unique(yr) if (yr == y).sum() >= 5]
        use = False
        if len(ys) >= 2:
            er = ee = 0.0
            for y in ys:
                k, o = yr == y, yr != y
                er += ((p[k] - (p[o] / c[o]).mean() * c[k]) ** 2).sum()
                ee += ((p[k] - p[o].mean()) ** 2).sum()
            use = ee < er
        return use, float(p.mean()), float(np.maximum(p, 0).mean())

    def __init__(self, years, region=True, mask=None):
        F = fuel_cost()
        self.region = region
        self.mask = mask
        years = [y for y in years if not self.HYDRO or hydro_daily(y) is not None]
        self._costs = []
        self.G = 2 * self.BLOCKS * (2 if self.DAYKIND else 1)
        xs, gs, rs, es, ps, cs, yrs, ms = [], [], [], [], [], [], [], []
        for y in years:
            a = L.DATA[y]
            c = np.array([F.get(str(d)[:10], np.nan) for d in a['days']])
            ok = np.isfinite(c) & (c > 5)
            x = year_share(y, region, self.HYDRO)
            g = self.groups(a['month'], [L.day_kind(d) for d in a['days']])
            xs.append(x[ok].ravel()); gs.append(g[ok].ravel()); rs.append((a['fr_p'][ok] / c[ok, None]).ravel()); es.append(np.minimum(a['fr_p'][ok], 0).ravel())
            self._costs.append(np.repeat(c[ok], 24))
            ps.append(a['fr_p'][ok].ravel()); cs.append(np.repeat(c[ok], 24)); yrs.append(np.full(ok.sum() * 24, y))
            ms.append(mask[y][ok].ravel() if mask is not None else np.ones(ok.sum() * 24, bool))
        x, g, r = (np.concatenate(v) for v in (xs, gs, rs))
        e = np.concatenate(es); pe_, ce_, ye_ = np.concatenate(ps), np.concatenate(cs), np.concatenate(yrs)
        mk = np.concatenate(ms)
        x, g, r, e, pe_, ce_, ye_ = (v[mk] for v in (x, g, r, e, pe_, ce_, ye_))
        self._costs = [np.concatenate(self._costs)[mk]]
        self.lo = int(np.floor(x.min() / L.BIN)) - 1
        self.nb = int(np.ceil(x.max() / L.BIN)) - self.lo + 2
        b = np.clip(np.round(x / L.BIN).astype(int) - self.lo, 0, self.nb - 1)
        mean = np.full((self.G, self.nb), np.nan); mpos = mean.copy(); ppos = mean.copy(); neg = mean.copy()
        eur = np.zeros((self.G, self.nb), bool); me = mean.copy(); mpe = mean.copy()
        # AFFINE: in each cell, price = a + b × fuel cost (a fixed part in €, b the gas-following part), fitted on the
        # cell's hours; φ = a ÷ cost + b. French hours are often set by nuclear or hydro at a level that does not
        # follow gas, which a pure ratio to the gas cost mixes up between dear-gas and cheap-gas years
        A_ = np.full((self.G, self.nb), np.nan); B_ = A_.copy()
        self._floor = {}
        self._lowbin = {gi: int(min([bi for bi in range(self.nb) if ((g == gi) & (b == bi)).sum() >= 15] or [0])) for gi in range(self.G)}
        cc = np.concatenate(self._costs) if self.AFFINE else None
        for gi in range(self.G):
            for bi in range(self.nb):
                k = (g == gi) & (b == bi)
                if k.sum() >= 15:
                    v = r[k]
                    mean[gi, bi], mpos[gi, bi], ppos[gi, bi] = v.mean(), (v * (v > 0)).mean(), (v > 0).mean()
                    neg[gi, bi] = e[k].mean()
                    if self.MO_EUR:
                        eur[gi, bi], me[gi, bi], mpe[gi, bi] = self._pick(pe_[k], ce_[k], ye_[k])
                    if bi <= self._lowbin.get(gi, 10 ** 6) + 2:
                        self._floor[gi] = min(self._floor.get(gi, 9.9), float(np.percentile(v, 5)))
                    if self.AFFINE and k.sum() >= 40 and np.ptp(cc[k]) > 10:
                        pe = v * cc[k]
                        B_[gi, bi], A_[gi, bi] = np.polyfit(cc[k], pe, 1)
            if self.AFFINE:
                fa = np.where(~np.isnan(A_[gi]))[0]
                if len(fa):
                    near_a = np.array([fa[np.abs(fa - bi).argmin()] for bi in range(self.nb)])
                    A_[gi], B_[gi] = A_[gi, near_a], B_[gi, near_a]
            filled = np.where(~np.isnan(mean[gi]))[0]
            if not len(filled):
                continue   # a group without hours (a regime seldom seen): filled from the others below
            near = np.array([filled[np.abs(filled - bi).argmin()] for bi in range(self.nb)])
            low = filled.min() if len(filled) else 0
            m0 = mean[gi].copy()
            mean[gi], mpos[gi], ppos[gi], neg[gi] = mean[gi, near], mpos[gi, near], ppos[gi, near], neg[gi, near]
            eur[gi], me[gi], mpe[gi] = eur[gi, near], me[gi, near], mpe[gi, near]
            winter = (gi % (2 * self.BLOCKS)) < self.BLOCKS
            if self.EXTRAP and len(filled) >= 3 and (self.EXTRAP is True or (self.EXTRAP == 'winter') == winter):  # off: in the
                # generator replay 2021–2025, winter only: 2.50 → 2.81 €/MWh (both), all year neutral on the true weather
                # below the deepest surplus seen: keep the slope of the three lowest filled cells, never under the floor
                # (the 5th percentile of the price ÷ cost in those cells: today's stops, batteries and flexibility)
                k3 = filled[:3]
                sl = np.polyfit(k3, m0[k3], 1)[0]
                floor = self._floor.get(gi, m0[low])
                for bi in range(low):
                    v = m0[low] + sl * (bi - low)
                    mean[gi, bi] = max(min(v, m0[low]), floor)
                    ppos[gi, bi] = ppos[gi, low] if mean[gi, bi] > 0 else min(ppos[gi, low], 0.5)
                    mpos[gi, bi] = max(mean[gi, bi], 0) if mean[gi, bi] > 0 else mpos[gi, low] * 0.5
        empty = [gi for gi in range(self.G) if np.isnan(mean[gi]).all()]
        full_ = [gi for gi in range(self.G) if gi not in empty]
        for gi in empty:
            for arr in (mean, mpos, ppos, neg, me, mpe):
                arr[gi] = np.nanmean(arr[full_], axis=0)
            eur[gi] = False
        self.mean, self.mpos, self.ppos, self.neg = mean, mpos, ppos, neg
        self.eur, self.me, self.mpe = eur, me, mpe
        self.A, self.B = A_, B_

    def phi(self, x, g, xf=None, cost=None, z=None):
        b = np.clip(np.round(x / L.BIN).astype(int) - self.lo, 0, self.nb - 1)
        out = [self.mean[g, b].copy(), self.mpos[g, b].copy(), self.ppos[g, b].copy()]
        ng = self.neg[g, b].copy()
        if self.MO_EUR and cost is not None:
            cb = np.maximum(cost, 1.0) * np.ones_like(out[0])
            fe = self.eur[g, b]
            out[0] = np.where(fe, self.me[g, b] / cb, out[0]); out[1] = np.where(fe, self.mpe[g, b] / cb, out[1])
        if self.AFFINE and cost is not None:
            a_, b_ = self.A[g, b], self.B[g, b]
            ok = np.isfinite(a_) & np.isfinite(b_)
            aff = np.where(ok, a_ / np.maximum(cost, 1.0) + b_, out[0])
            out[1] = np.where(ok, np.where(aff > 0, out[1] * aff / np.where(out[0] != 0, out[0], 1), 0), out[1])
            out[0] = aff
        if xf is not None and getattr(self, 'tab2', None) and self.INTERP:
            # straight lines between the cells' centres (bilinear in the region's and France's shares), so that within a
            # cell more wind still means a lower price; corners without data drop out, none at all keeps the 1-D rule
            fx, ff = x / 0.05, xf / self.fbin()
            i0, j0 = np.floor(fx).astype(int), np.floor(ff).astype(int)
            wx, wf = fx - i0, ff - j0
            acc = [np.zeros(x.shape) for _ in range(4)]; wsum = np.zeros(x.shape)
            for di, dj, w in ((0, 0, (1 - wx) * (1 - wf)), (1, 0, wx * (1 - wf)), (0, 1, (1 - wx) * wf), (1, 1, wx * wf)):
                k = (g * 1000 + (i0 + di + 100)) * 1000 + (j0 + dj + 100)
                for kk in np.unique(k):
                    v = self.tab2.get(int(kk))
                    if v is None:
                        continue
                    sel = k == kk
                    for i in range(4):
                        acc[i][sel] += w[sel] * v[i]
                    wsum[sel] += w[sel]
            ok = wsum > 1e-9
            for i in range(3):
                out[i][ok] = acc[i][ok] / wsum[ok]
            ng[ok] = acc[3][ok] / wsum[ok]
        elif xf is not None and getattr(self, 'tab2', None):
            k = (g * 1000 + (np.round(x / 0.05).astype(int) + 100)) * 1000 + (np.round(xf / self.fbin()).astype(int) + 100)
            for kk in np.unique(k):
                v = self.tab2.get(int(kk))
                if v is not None:
                    sel = k == kk
                    for i in range(3):
                        out[i][sel] = v[i]
                    ng[sel] = v[3]
                    if self.MO_EUR and cost is not None and v[4]:
                        out[0][sel] = v[5] / cb[sel]; out[1][sel] = v[6] / cb[sel]
        if self.FR_LIN and z is not None and getattr(self, 'lin', None) is not None and xf is not None:
            kc = (g * 1000 + (np.round(x / 0.05).astype(int) + 100)) * 1000 + (np.round(xf / self.fbin()).astype(int) + 100)
            beta, zbar = np.zeros(x.shape), np.zeros(x.shape)
            for kk in np.unique(kc):
                v = self.lin.get(int(kk))
                if v is not None:
                    sel = kc == kk; beta[sel], zbar[sel] = v
            d = beta * (z - zbar)
            out[1] = np.maximum(out[1] + d * out[2], 0)
            if not (self.NEG_EUR and cost is not None):
                out[0] = out[0] + d
        if self.NEG_EUR and cost is not None:
            out[0] = out[1] + ng / np.maximum(cost, 1.0)
        return tuple(out)

    @staticmethod
    def fbin():
        return 2.0 if FR_GW['on'] or EXPCAP['on'] else 0.10

    def add_france(self, years, mask=None):
        mask = mask if mask is not None else getattr(self, 'mask', None)
        """a second input: France's own residual share, in cells of 0.05 (region) × 0.10 (France), 20 hours or more"""
        F = fuel_cost()
        ks, rs, es, ps, cs, yrs, zs, gg, mm = [], [], [], [], [], [], [], [], []
        for y in years:
            a = L.DATA[y]
            c = np.array([F.get(str(d)[:10], np.nan) for d in a['days']])
            ok = np.isfinite(c) & (c > 5)
            x, g = year_share(y, self.region, self.HYDRO), self.groups(a['month'], [L.day_kind(d) for d in a['days']])
            xf = year_fr_gw(y, self.HYDRO) if FR_GW['on'] else year_share(y, False, self.HYDRO)
            if DAYX:
                xf = day_mean(year_share(y, DAYX == 'reg', self.HYDRO))
            if EXPCAP['on']:
                xf = beyond_room(year_fr_gw(y, self.HYDRO) * 1000, y)
            k = (g * 1000 + (np.round(x / 0.05).astype(int) + 100)) * 1000 + (np.round(xf / self.fbin()).astype(int) + 100)
            ks.append(k[ok].ravel()); rs.append((a['fr_p'][ok] / c[ok, None]).ravel()); es.append(np.minimum(a['fr_p'][ok], 0).ravel())
            ps.append(a['fr_p'][ok].ravel()); cs.append(np.repeat(c[ok], 24)); yrs.append(np.full(ok.sum() * 24, y))
            zs.append(year_fr_gw(y, self.HYDRO)[ok].ravel()); gg.append(g[ok].ravel())
            mm.append(mask[y][ok].ravel() if mask is not None else np.ones(ok.sum() * 24, bool))
        k, r, e = np.concatenate(ks), np.concatenate(rs), np.concatenate(es)
        z_, g_ = np.concatenate(zs), np.concatenate(gg)
        pe_, ce_, ye_ = np.concatenate(ps), np.concatenate(cs), np.concatenate(yrs)
        mk = np.concatenate(mm)
        k, r, e, z_, g_, pe_, ce_, ye_ = (v[mk] for v in (k, r, e, z_, g_, pe_, ce_, ye_))
        self.tab2 = {}
        for kk in np.unique(k):
            sel = k == kk
            if sel.sum() >= 20:
                v = r[sel]
                self.tab2[int(kk)] = (v.mean(), (v * (v > 0)).mean(), (v > 0).mean(), e[sel].mean()) + \
                    (self._pick(pe_[sel], ce_[sel], ye_[sel]) if self.MO_EUR else (False, 0.0, 0.0))
        if self.FR_LIN:
            # the slope of price ÷ cost per GW of French residual load, by season × time of day (one line per group, so
            # each slope rests on thousands of hours), applied around each cell's own mean residual load
            gs_ = {}
            for gi in np.unique(g_):
                sel = g_ == gi
                kk_ = k[sel]; zz, rr = z_[sel], r[sel]
                zc, rc = zz.copy(), rr.copy()
                for kk in np.unique(kk_):
                    m = kk_ == kk
                    zc[m] -= zz[m].mean(); rc[m] -= rr[m].mean()
                gs_[int(gi)] = float(np.dot(zc, rc) / np.dot(zc, zc)) if np.dot(zc, zc) > 0 else 0.0
            self.lin = {}
            for kk in np.unique(k):
                sel = k == kk
                if sel.sum() >= 20:
                    self.lin[int(kk)] = (gs_[int(kk // 1000000)], float(z_[sel].mean()))
        return self


REGIME = os.environ.get('PK_REGIME', '1') == '1'   # two regimes, France coupled to its neighbours or cut off by its export
# limits (its price 5 € or more under Germany's: 629 h in 2021, 1,496 in 2023, 4,374 in 2024, 5,460 in 2025, with 67 % of
# French wind MWh in 2025; the current rule is +6.9 € too high in those hours and −6.4 € too low in coupled ones); the
# chance of each read from what France must export (available nuclear + wind + solar − load). True weather 2023–2025 and
# generator replay (solar 0.59 → 0.98, wind 2.07 → 2.34 €/MWh) worse with that chance alone. With the chance read on
# France's Core export limit of the hour (REGIME_JAO, JAO): adopted 31 Oct. 2026, see REGIME_JAO
_DE = {}


def de_prices(y):
    """Germany's day-ahead, hourly, on the days of L.DATA[y] (data/history/daily, zones DE_LU); NaN where missing"""
    if y not in _DE:
        import json
        out = []
        for d in L.DATA[y]['days']:
            try:
                z = json.load(open(os.path.join(ROOT, 'data', 'history', 'daily', f'{str(d)[:10]}.json')))['zones'].get('DE_LU', {}).get('hourly')
            except (OSError, ValueError):
                z = None
            out.append(np.array(z, float).reshape(24, -1).mean(1) if z and None not in z and len(z) % 24 == 0 else np.full(24, np.nan))
        _DE[y] = np.array(out)
    return _DE[y]


REGIME_JAO = os.environ.get('PK_REGIME_JAO', '1') == '1'   # the cut-off chance read on what France must export beyond
# its Core export limit of the hour (JAO, data/history/jao_core; drawn days at the last known year's level), not on what
# it must export alone. Deliveries 2023–2026 (2026: complete months), 1–3 years ahead, error on the value of one MWh:
# solar 1.19 → 1.07, wind 3.08 → 2.42 €/MWh (2026 one year ahead: solar −7.62 → +1.65, wind +7.17 → +2.19); still too high
# on average (wind +2.4, solar +0.9): the model risk the pricer takes off (scripts/ppa_model_risk.py). Adopted 31 Oct. 2026
_JM = {}


def fr_jmax(y):
    """France's Core export limit (JAO), MW, days × 24 of L.DATA[y]; hours without it: the year's mean, else 8 GW"""
    if y not in _JM:
        import json
        try:
            d = json.load(open(os.path.join(ROOT, 'data', 'history', 'jao_core', f'{y}.json')))['days']
        except (OSError, ValueError):
            d = {}
        a = np.array([d.get(str(x)[:10], {}).get('maxFR') or [np.nan] * 24 for x in L.DATA[y]['days']], float)
        fill = np.nanmean(a) if np.isfinite(a).any() else 8000.0
        _JM[y] = np.where(np.isfinite(a), a, fill)
    return _JM[y]


def export_need(S, W, Lo, A):
    """what France must export at full nuclear, GW: available nuclear + solar + wind − load"""
    return (A + S + W - Lo) / 1000


class RegimeRule:
    """France's price as the mix of two rules weighted by the chance France is cut off from Germany (its price 5 € or
    more below): cut off, a France-only rule learnt on those hours; coupled, the regional rule learnt on the others"""
    NB = 1.0   # GW bins of export need

    def __init__(self, years, region=True, france=True):
        dec, need = {}, {}
        for y in years:
            a = L.DATA[y]; de = de_prices(y)
            dec[y] = np.isfinite(de) & (a['fr_p'] < de - 5)
            need[y] = export_need(a['fr_s'], a['fr_w'], a['fr_l'], fr_avail(y)) - (fr_jmax(y) / 1000 if REGIME_JAO else 0)
        nd_ = sum(int(dec[y].sum()) for y in years)
        # too few hours cut off (the years before 2023): that regime keeps the whole-year rule
        self.dec = PriceModelFuel(years, False, mask=dec if nd_ >= 500 else None)
        self.cpl = PriceModelFuel(years, region, mask={y: ~dec[y] for y in years})
        if france:
            self.cpl.add_france(years)
        g = np.concatenate([PriceModelFuel.groups(L.DATA[y]['month'], [L.day_kind(d) for d in L.DATA[y]['days']]).ravel() for y in years])
        nb = np.concatenate([np.round(need[y] / self.NB).astype(int).ravel() for y in years])
        dd = np.concatenate([dec[y].ravel() for y in years]).astype(float)
        self.pd = {}
        for gi in np.unique(g):
            for b in np.unique(nb[g == gi]):
                k = (g == gi) & (nb == b)
                if k.sum() >= 30:
                    self.pd[(int(gi), int(b))] = float(dd[k].mean())

    def pdec(self, g, need):
        nb = np.round(need / self.NB).astype(int); out = np.zeros(g.shape)
        for gi in np.unique(g):
            ks = sorted(b for (gg, b) in self.pd if gg == gi)
            if not ks:
                continue
            sel = g == gi
            bb = np.clip(nb[sel], ks[0], ks[-1])
            out[sel] = [self.pd.get((int(gi), int(b)), self.pd[(int(gi), min(ks, key=lambda k: abs(k - b)))]) for b in bb]
        return out

    def phi(self, x, g, xf=None, cost=None, z=None, need=None, xfr=None):
        a = self.dec.phi(xfr, g, None, cost)
        b = self.cpl.phi(x, g, xf, cost)
        w = self.pdec(g, need)
        return tuple(w * u + (1 - w) * v for u, v in zip(a, b))


class TrendRule:
    """the fuel rule with a trend: the rule learnt on the last year alone, plus (TREND ×) the change of each cell
    between the year before and the last year, carried one year ahead and no further, never under the floor seen in
    the last year's cell (stops at negative prices, batteries, flexibility). The market has moved the same way every
    year since 2023 (France's surplus hours 2,571 → 4,440 → 5,618), so a rule averaged on past years lags it."""
    TREND = 1.0

    def __init__(self, years, region=True, france=True):
        last, prev = years[-1], years[-2] if len(years) > 1 else years[-1]
        self.a = PriceModelFuel([prev], region)
        self.b = PriceModelFuel([last], region)
        if france:
            self.a.add_france([prev]); self.b.add_france([last])

    def phi(self, x, g, xf=None, cost=None):
        pa, pb = self.a.phi(x, g, xf, cost), self.b.phi(x, g, xf, cost)
        m = pb[0] + self.TREND * (pb[0] - pa[0])
        floor = np.minimum(pb[0], self.b.mean[g, 0] if self.b.mean.shape[1] else pb[0])
        m = np.maximum(m, np.minimum(floor, pb[0]))
        mp = np.where(m > 0, np.maximum(pb[1] + self.TREND * (pb[1] - pa[1]), 0), 0)
        pp = np.clip(pb[2] + self.TREND * (pb[2] - pa[2]), 0, 1)
        return m, mp, pp


def guard_floor(t, years, q=10, width=0.02):
    """the observed floor of a day's capture by daily penetration (Tom, 29 Oct. 2026: a simulated day may not capture
    less than days at the same penetration really did): over the years given, each day's capture of technology t
    (paid hours, ÷ its month's mean price) by its penetration (its output ÷ France's load); per bin of `width`, the q-th
    percentile (q = 10: 90 % of the observed days did better). Beyond the highest bin seen, that bin's floor, flat."""
    pen, cap = [], []
    for y in years:
        a = L.DATA[y]
        P, V, Lo, mo = a['fr_p'], a['fr_' + t], a['fr_l'], a['month']
        mm = {m: P[mo == m].mean() for m in np.unique(mo)}
        for i in range(len(P)):
            pos = P[i] > 0
            if V[i][pos].sum() <= 0 or mm[mo[i]] <= 1:
                continue
            pen.append(V[i].sum() / Lo[i].sum())
            cap.append((V[i][pos] * P[i][pos]).sum() / V[i][pos].sum() / mm[mo[i]])
    pen, cap = np.array(pen), np.array(cap)
    b = (pen / width).astype(int)
    floor = {int(k): float(np.percentile(cap[b == k], q)) for k in np.unique(b) if (b == k).sum() >= 10}
    return floor, width


def below_floor(v, price, floor, width, load, month):
    """(days whose capture is under the observed floor of their penetration, days counted)"""
    if not floor:
        return 0, 0
    top, n, k_ = max(floor), 0, 0
    base = {m: price[month == m].mean() for m in np.unique(month)}
    for i in range(len(v)):
        pos = price[i] > 0
        vp = v[i][pos].sum()
        if vp <= 0 or base[month[i]] <= 0:
            continue
        c = (v[i][pos] * price[i][pos]).sum() / vp / base[month[i]]
        bi = min(int(v[i].sum() / load[i].sum() / width), top)
        f = floor.get(bi)
        if f is None:
            f = floor[min(floor, key=lambda x: abs(x - bi))]
        n += 1; k_ += c < f
    return k_, n


def apply_guard(month, v, price, floor, width, load):
    """monthly capture rates (curt) with each day's capture raised to the observed floor of its penetration"""
    out = {}
    top = max(floor) if floor else None
    for m in range(1, 13):
        k = np.where(month == m)[0]
        if not len(k):
            continue
        P, V, Lo = price[k], v[k], load[k]
        base = P.mean()
        if base <= 0:
            continue
        num = den = 0.0
        for i in range(len(k)):
            pos = P[i] > 0
            vp = V[i][pos].sum()
            if vp <= 0:
                continue
            c = (V[i][pos] * P[i][pos]).sum() / vp / base
            if floor:
                bi = min(int(V[i].sum() / Lo[i].sum() / width), top)
                f = floor.get(bi)
                if f is None:
                    f = floor[min(floor, key=lambda x: abs(x - bi))]
                c = max(c, f)
            num += c * vp; den += vp
        out[m] = num / den if den else None
    return out


def _residuals(y, pm, region):
    """the historical day's price surprise against this price rule: realised ratio − the rule's ratio (ratio units)"""
    d = _year(y)
    key = ('surprise', id(pm))
    if key not in d:
        a = L.DATA[y]
        x = L.residual_share(a, region)
        base = np.array([a['fr_p'][a['month'] == m].mean() for m in a['month']])
        g = L.grp(a['month']) + 6 * pm.lclass(base)[:, None] * pm.level
        rm, _, _ = pm.expected(x, g)
        d[key] = d['ratio'] - rm
    return d[key]


def simulate(t, Y, known, st, demand_year, capY, levels, n=60, amp=0.0, seed=None, weeks=7, surprise='none', rule='fuel', cost=None, fuel_window=2,
             batteries='both', pool_from=2019, fuel_dev=True, france=True, window=7, same_month=False, train=None, trend=False, guard=False):
    """monthly capture rates ('all', 'curt', 'paid') averaged over n chained-week scenarios, and their P10/P90"""
    rng = np.random.default_rng(seed if seed is not None else Y)
    pool = [y for y in known if y != 2022 and L.DATA[y]['complete'] and (pool_from is None or y >= pool_from)
            and (not PriceModelFuel.HYDRO or rule != 'fuel' or hydro_daily(y) is not None)]
    if not pool:
        pool = [y for y in known if y != 2022 and L.DATA[y]['complete']][-1:]
    tr = [y for y in known if st['with2022'] or y != 2022][-st['window']:]
    pm = L.PriceModel(tr, st['regional'], 'mean', st['level'] != 'none')
    pm2 = PriceModel2(tr, st['level'] != 'none') if rule == '2d' else None
    pmf = None
    if rule == 'fuel':
        fy = train or [y for y in known if L.DATA[y]['complete'] and y >= 2019][-fuel_window:]
        if trend:
            pmf = TrendRule(fy, st['regional'], france)
        else:
            if REGIME:
                pmf = RegimeRule(fy, st['regional'], france)
            else:
                pmf = PriceModelFuel(fy, st['regional'])
                if france:
                    pmf.add_france(fy)
    SUR = {y: _residuals(y, pm, st['regional']) for y in pool}
    GF = guard_floor(t, [y for y in known if L.DATA[y]['complete'] and y != 2022][-2:]) if guard else None
    BELOW = [0, 0]
    HN = {}
    if rule == 'fuel' and PriceModelFuel.HYDRO:
        for c in CS:
            HN[c] = {m: float(np.mean([hydro_daily(y)[c][_year(y)['month'] == m].mean() for y in pool])) for m in range(1, 13)}
    if surprise == 'eur':
        SUR = {y: v * _year(y)['mavg'] for y, v in SUR.items()}
    elif surprise == 'recent':
        SUR = {y: (v if y in tr else np.zeros_like(v)) for y, v in SUR.items()}
    elif surprise == 'none':
        SUR = {y: np.zeros_like(v) for y, v in SUR.items()}
    M = _means(demand_year)
    RS = {tt: stop_share(tt, Y) for tt in 'sw'}
    if REGIME:
        _av, _dm = fr_avail(demand_year), L.DATA[demand_year]['month']
        AVR = np.array([_av[_dm == m].mean() for m in range(1, 13)])
    CFS = {(c, tt, y): cf_scale(c, tt, y, demand_year, pool) for c in CS for tt in 'sw' for y in pool} if CF_LEVEL else {}
    if NUC_AV:
        # France's available nuclear: the last complete year's monthly means (planned outages and their season), the
        # availability of the delivery year being unknown when pricing
        _av, _dm = fr_avail(demand_year), L.DATA[demand_year]['month']
        AVM = np.array([_av[_dm == m].mean() for m in range(1, 13)])
    days = [date(Y, 1, 1) + timedelta(days=i) for i in range((date(Y + 1, 1, 1) - date(Y, 1, 1)).days)]
    D = len(days)
    month = np.array([d.month for d in days])
    kind = np.array([L.day_kind(d) for d in days])
    frac = np.array([(d.timetuple().tm_yday - 0.5) / D for d in days])
    fleet = {}
    for c in CS:
        for tt in 'sw':
            g1 = capY[c][tt]
            g0 = L._start_of(c, tt, Y, g1) if L.FLEET_DAILY['on'] else g1
            fleet[(c, tt)] = ((g0 + (g1 - g0) * frac) * 1000)[:, None]
    dmd = L.DATA[demand_year]
    own = {m: float(dmd['fr_p'][dmd['month'] == m].mean()) for m in range(1, 13) if (dmd['month'] == m).any()}
    lv = np.array([(levels or own).get(int(m), own.get(int(m), 50.0)) for m in month])
    lvl_eur = np.maximum(lv, 5.0)[:, None]
    g = L.grp(month) + 6 * pm.lclass(lv)[:, None] * pm.level
    # candidate blocks: (year, start row) for every start
    starts = {y: _year(y) for y in pool}
    sd = {y: (np.std(starts[y]['FR_w'].mean(1)) or 1, np.std(starts[y]['FR_ldev'].mean(1)) or 1) for y in pool}
    res = []
    for _ in range(n):
        src = []                     # (year, row) per delivery day
        prev = None
        i = 0
        while i < D:
            d0 = days[i]
            cand = []
            for y in pool:
                Yd = starts[y]
                dy = np.abs(Yd['doy'] - d0.timetuple().tm_yday)
                ok = np.where((np.minimum(dy, 365 - dy) <= window) & (Yd['wd'] == d0.weekday())
                              & ((Yd['month'] == d0.month) if same_month else True))[0]
                ok = ok[ok + weeks <= len(Yd['days'])]
                cand += [(y, int(r)) for r in ok]
            if not cand:          # the year's edges: widen the window
                for y in pool:
                    Yd = starts[y]
                    dy = np.abs(Yd['doy'] - d0.timetuple().tm_yday)
                    ok = np.where((np.minimum(dy, 365 - dy) <= 14) & (Yd['wd'] == d0.weekday()))[0]
                    cand += [(y, int(r)) for r in ok[ok + weeks <= len(Yd['days'])]]
            if prev is not None:
                pw, pl = prev
                w = np.array([np.exp(-0.5 * (((starts[y]['FR_w'][r].mean() - pw) / sd[y][0]) ** 2 + ((starts[y]['FR_ldev'][r].mean() - pl) / sd[y][1]) ** 2))
                              for y, r in cand])
                w = w / w.sum() if w.sum() > 0 else None
            else:
                w = None
            y, r = cand[rng.choice(len(cand), p=w)]
            a_f = float(np.exp(rng.normal(-0.5 * amp ** 2, amp))) if amp > 0 else 1.0
            for k in range(min(weeks, D - i)):
                src.append((y, r + k, a_f))
            last = (y, r + min(weeks, D - i) - 1)
            prev = (starts[last[0]]['FR_w'][last[1]].mean(), starts[last[0]]['FR_ldev'][last[1]].mean())
            i += weeks
        S, W, Lo, N = {}, {}, {}, {}
        for c in CS:
            sv = np.stack([starts[y][f'{c}_s'][r] for y, r, _ in src])
            wv = np.stack([starts[y][f'{c}_w'][r] for y, r, _ in src])
            ld = np.stack([starts[y][f'{c}_ldev'][r] for y, r, _ in src])
            nd = np.stack([starts[y][f'{c}_ndev'][r] for y, r, _ in src])
            if amp > 0:
                af = np.array([f for _, _, f in src])[:, None]
                for arr in (sv, wv):
                    mm = np.stack([arr[month == m].mean(0) if (month == m).any() else arr.mean(0) for m in range(1, 13)])
                    clim = mm[month - 1]
                    arr[:] = np.clip(clim + af * (arr - clim), 0, 1.2)
                ld = 1 + af * (ld - 1)
            if CF_LEVEL:
                sv = sv * np.array([CFS[(c, 's', y)] for y, _, _ in src])[:, None]
                wv = wv * np.array([CFS[(c, 'w', y)] for y, _, _ in src])[:, None]
            S[c] = sv * fleet[(c, 's')]
            W[c] = wv * fleet[(c, 'w')]
            Lo[c] = ld * np.array([M.get((c, 'l', int(m), int(k)), 0.0) for m, k in zip(month, kind)])[:, None]
            N[c] = nd * np.array([M.get((c, 'n', int(m), int(k)), 0.0) for m, k in zip(month, kind)])[:, None]
        if NUC_AV:
            N['FR'] = AVM[month - 1][:, None] * np.ones((1, 24))
        H = None
        if rule == 'fuel' and PriceModelFuel.HYDRO:
            # the weather day's run-of-river as a deviation from its own year's month mean × the month's normal level
            # (mean of the pool years): a week of the very wet spring 2024 brings its wetness, not 2024's whole level
            H = {}
            for c in CS:
                dev = []
                for y, r, _ in src:
                    hd, mo = hydro_daily(y)[c], starts[y]['month']
                    mm = hd[mo == mo[r]].mean()
                    dev.append(hd[r] / mm if mm > 1 else 1.0)
                H[c] = np.array(dev) * np.array([HN[c][int(m)] for m in month])
        x = share(S, W, Lo, N, H, st['regional'])
        use_b = batteries == 'both' or (batteries == 'tech' and (L.STORAGE['on'] or t in L.STORAGE['techs']))
        if st['regional'] and use_b and Y > demand_year:
            Ltot = sum(Lo[c] for c in (CS if st['regional'] else ('FR',)))
            R2, L2 = L.with_batteries(x * Ltot, Ltot, L.storage_added(Y, demand_year))
            x = R2 / L2
        if pmf is not None:
            gg = PriceModelFuel.groups(month, kind)
            cday = np.array([cost(d) for d in days])[:, None]
            if fuel_dev:
                # the weather day's own fuel-cost deviation from its month's mean (cold calm days are dear gas days):
                # the delivery year's month cost × that deviation, so the price shock comes with the weather
                Fc = fuel_cost()
                dev = []
                for y, r, _ in src:
                    dd = starts[y]['days'][r]
                    mk = [Fc.get(x.isoformat()) for x in starts[y]['days'] if x.month == dd.month]
                    mk = [v for v in mk if v]
                    dev.append(Fc.get(dd.isoformat(), np.nan) / np.mean(mk) if mk and Fc.get(dd.isoformat()) else 1.0)
                mc = np.array([np.nanmean(cday[month == m]) for m in range(1, 13)])
                cday = (mc[month - 1] * np.array(dev))[:, None]
            xfr = (fr_gw(S, W, Lo, N, H) if FR_GW['on'] else share(S, W, Lo, N, H, False)) if france else None
            if DAYX and france:
                xfr = day_mean(x if DAYX == 'reg' else share(S, W, Lo, N, H, False))
            if EXPCAP['on'] and france:
                xfr = beyond_room(fr_gw(S, W, Lo, N, H) * 1000, EXPCAP['Y'] or max(known))
            if REGIME:
                need = export_need(S['FR'], W['FR'], Lo['FR'], AVR[month - 1][:, None] * np.ones((1, 24)))
                if REGIME_JAO:
                    # the drawn day's Core export limit (its grid situation) at the last known year's level
                    ref = float(np.mean(fr_jmax(demand_year)))
                    need = need - np.stack([fr_jmax(y)[r] * ref / float(np.mean(fr_jmax(y))) for y, r, _ in src]) / 1000
                f1, fp, fq = pmf.phi(x, gg, xfr, cday, None, need, share(S, W, Lo, N, H, False))
            else:
                f1, fp, fq = pmf.phi(x, gg, xfr, cday, fr_gw(S, W, Lo, N, H) if PriceModelFuel.FR_LIN else None)
            if FLEET_STOP and (RS['s'] > 0 or RS['w'] > 0):
                # the French parks that stop at prices ≤ 0 (the measured share, × the chance the hour is ≤ 0): their
                # output leaves the surplus the price is read on, as it left the realised output the rule learnt on
                dR = (1 - fq) * (RS['s'] * S['FR'] + RS['w'] * W['FR'])
                Ltot = sum(Lo[c] for c in (CS if st['regional'] else ('FR',)))
                x2 = x + dR / Ltot
                xfr2 = None if xfr is None else (xfr + dR / 1000 if FR_GW['on'] else xfr + dR / Lo['FR'])
                f1, fp, fq = pmf.phi(x2, gg, xfr2, cday, None)
            v = S['FR'] if t == 's' else W['FR']
            mr = L.month_rates(month, v, f1 * cday, fp * cday, fq)
            if guard == 'measure':
                kb, nb = below_floor(v, f1 * cday, GF[0], GF[1], Lo['FR'], month)
                BELOW[0] += kb; BELOW[1] += nb
            elif guard:
                # only the days the floor lifts: the month's capture × (with floors ÷ without), both on the same days
                gc = apply_guard(month, v, f1 * cday, GF[0], GF[1], Lo['FR'])
                g0 = apply_guard(month, v, f1 * cday, {}, GF[1], Lo['FR'])
                for m_, c_ in gc.items():
                    if m_ in mr and c_ and g0.get(m_) and mr[m_].get('curt') is not None:
                        mr[m_]['curt'] *= c_ / g0[m_]
            res.append(mr)
            continue
        if pm2 is not None:
            xf = L.residual_share(None, False, S, W, Lo, N, None)
            rm, _, _ = pm2.expected(x, xf, g)
        else:
            rm, _, _ = pm.expected(x, g)
        sur = np.stack([SUR[y][r] for y, r, _ in src])
        ratio = rm + (sur / lvl_eur if surprise == 'eur' else sur)
        v = S['FR'] if t == 's' else W['FR']
        res.append(L.month_rates(month, v, ratio, ratio * (ratio > 0), (ratio > 0).astype(float)))
    out = {m: {k: float(np.nanmean([r[m][k] for r in res if m in r and r[m].get(k) is not None])) for k in ('all', 'curt', 'paid')} for m in range(1, 13)}
    dist = {m: {k: [float(np.nanpercentile([r[m][k] for r in res if m in r and r[m].get(k) is not None], q)) for q in (10, 90)] for k in ('all', 'curt')} for m in range(1, 13)}
    if guard == 'measure':
        dist['belowFloor'] = BELOW[0] / BELOW[1] if BELOW[1] else None
    return out, dist
