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


CELL_W = float(os.environ.get('PK_CELL_W', '0'))   # test: French wind share as a third input of the coupled cells
CELL_MIN = int(os.environ.get('PK_CELL_MIN', '30'))
WTECH = {'t': None}   # test (Qorbanian, Löhndorf & Wozabal 2024, arXiv 2403.08846: the model fitted with each hour weighed by
# the output of the technology priced): the rule's cells learnt as output-weighted means of the technology simulated
# (PK_WTECH=1), so a cell's price is the price when that technology produces; a floor weight keeps hours without output.
# The month's base price comes from the unweighted rule (WTECH_BASE), else the ratio cancels. Replay 2023–2026, 9 cases:
# wind 2.20 not anchored (bias +2.62 → +1.37), anchored season 0.71 (seed 7), 0.70 (60 draws), 0.48 (seed 11) against
# 0.84 / 0.83 for the current rule; solar 1.41 not anchored against 0.76. The last known year's wind value is found
# again (factor 0.99–1.00 learnt on 2023 or 2024). Candidate for wind, decision pending (31 Oct. 2026)


WTECH_BASE = os.environ.get('PK_WTECH_BASE', '1') == '1'


def _wt(a):
    t = WTECH['t']
    if not t:
        return np.ones_like(a['fr_p'])
    v = np.nan_to_num(a['fr_' + t]); return v + 0.05 * max(float(v.mean()), 1e-9)


def _wm(v, w):
    v = np.asarray(v, float); return float((v * w).sum() / w.sum())


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
    AFFINE = os.environ.get('PK_AFFINE') == 'all'  # (31 Oct. 2026, true data learnt 2025 → 2026, the gas-crisis year: hourly
    # error 33.1 → 48.0 'all', 45.8 cut-off rule only; worse again) price = a + b × fuel cost per cell: worse on the true weather of 2023–2025 (1.60 → 1.73 €/MWh), off
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
        xs, gs, rs, es, ps, cs, yrs, ms, wws = [], [], [], [], [], [], [], [], []
        for y in years:
            a = L.DATA[y]
            c = np.array([F.get(str(d)[:10], np.nan) for d in a['days']])
            ok = np.isfinite(c) & (c > 5)
            wws.append(_wt(a)[ok].ravel())
            x = year_share(y, region, self.HYDRO)
            g = self.groups(a['month'], [L.day_kind(d) for d in a['days']])
            xs.append(x[ok].ravel()); gs.append(g[ok].ravel()); rs.append((a['fr_p'][ok] / c[ok, None]).ravel()); es.append(np.minimum(a['fr_p'][ok], 0).ravel())
            self._costs.append(np.repeat(c[ok], 24))
            ps.append(a['fr_p'][ok].ravel()); cs.append(np.repeat(c[ok], 24)); yrs.append(np.full(ok.sum() * 24, y))
            ms.append(mask[y][ok].ravel() if mask is not None else np.ones(ok.sum() * 24, bool))
        x, g, r = (np.concatenate(v) for v in (xs, gs, rs))
        e = np.concatenate(es); pe_, ce_, ye_ = np.concatenate(ps), np.concatenate(cs), np.concatenate(yrs)
        mk = np.concatenate(ms); wv = np.concatenate(wws)
        x, g, r, e, pe_, ce_, ye_, wv = (v[mk] for v in (x, g, r, e, pe_, ce_, ye_, wv))
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
                    v = r[k]; ww = wv[k]
                    mean[gi, bi], mpos[gi, bi], ppos[gi, bi] = _wm(v, ww), _wm(v * (v > 0), ww), _wm(v > 0, ww)
                    neg[gi, bi] = _wm(e[k], ww)
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
        if CELL_W and xf is not None and getattr(self, 'tab3', None) and getattr(self, '_wsh', None) is not None:
            k3 = ((g * 1000 + (np.round(x / 0.05).astype(int) + 100)) * 1000 + (np.round(xf / self.fbin()).astype(int) + 100)) * 100 \
                + np.clip(np.round(self._wsh / CELL_W).astype(int), 0, 99)
            for kk in np.unique(k3):
                v = self.tab3.get(int(kk))
                if v is not None:
                    sel = k3 == kk
                    for i in range(3):
                        out[i][sel] = v[i]
                    ng[sel] = v[3]
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
        ks, rs, es, ps, cs, yrs, zs, gg, mm, wws = [], [], [], [], [], [], [], [], [], []
        for y in years:
            a = L.DATA[y]
            c = np.array([F.get(str(d)[:10], np.nan) for d in a['days']])
            ok = np.isfinite(c) & (c > 5)
            wws.append(_wt(a)[ok].ravel())
            x, g = year_share(y, self.region, self.HYDRO), self.groups(a['month'], [L.day_kind(d) for d in a['days']])
            xf = year_fr_gw(y, self.HYDRO) if FR_GW['on'] else year_share(y, False, self.HYDRO)
            if DAYX:
                xf = day_mean(year_share(y, DAYX == 'reg', self.HYDRO))
            if getattr(self, 'DAY2', False):
                xf = day_mean(year_share(y, False, self.HYDRO)) if DEC2 == '1' else a['fr_w'] / a['fr_l']
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
        mk = np.concatenate(mm); wv = np.concatenate(wws)
        k, r, e, z_, g_, pe_, ce_, ye_, wv = (v[mk] for v in (k, r, e, z_, g_, pe_, ce_, ye_, wv))
        self.tab2 = {}
        for kk in np.unique(k):
            sel = k == kk
            if sel.sum() >= 20:
                v = r[sel]; ww = wv[sel]
                self.tab2[int(kk)] = (_wm(v, ww), _wm(v * (v > 0), ww), _wm(v > 0, ww), _wm(e[sel], ww)) + \
                    (self._pick(pe_[sel], ce_[sel], ye_[sel]) if self.MO_EUR else (False, 0.0, 0.0))
        if CELL_W and not getattr(self, 'DAY2', False):
            # test: the French wind share as a third input of the cells (bins of CELL_W), where a cell has CELL_MIN hours
            wsh_ = np.concatenate([(L.DATA[y]['fr_w'] / L.DATA[y]['fr_l'])[np.isfinite(np.array([F.get(str(d)[:10], np.nan) for d in L.DATA[y]['days']])) & (np.array([F.get(str(d)[:10], np.nan) for d in L.DATA[y]['days']]) > 5)].ravel() for y in years])
            wsh_ = wsh_[mk]
            k3 = k * 100 + np.clip(np.round(wsh_ / CELL_W).astype(int), 0, 99)
            self.tab3 = {}
            for kk in np.unique(k3):
                sel = k3 == kk
                if sel.sum() >= CELL_MIN:
                    v = r[sel]
                    self.tab3[int(kk)] = (v.mean(), (v * (v > 0)).mean(), (v > 0).mean(), e[sel].mean())
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


NUC_Y = os.environ.get('PK_NUC_Y') or None   # test: France's nuclear for the delivery year ('oracle' = its real availability)
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


JAO_Y = os.environ.get('PK_JAO_Y') or None   # test: France's Core export limit for the delivery year: None = the last
# known year's level; 'oracle' = the delivery year's real level (not knowable, to measure what it explains); 'trend' =
# the last two known years' change carried on (never below 2 GW). Replay not anchored: oracle wind 2.59, solar 0.93;
# trend wind 2.70, solar 0.92 (current 2.62 / 0.76): the export limit's level does not explain the wind error (31 Oct.
# 2026)


def jao_level(Y, A, known):
    m = lambda y: float(np.mean(fr_jmax(y)))
    if JAO_Y == 'oracle' and Y in L.DATA:
        return m(Y)
    if JAO_Y == 'trend':
        ys = [y for y in known if y >= 2022 and L.DATA[y]['complete']][-2:]
        if len(ys) == 2:
            return max(m(ys[1]) + (m(ys[1]) - m(ys[0])) * (Y - ys[1]), 2000.0)
    return m(A)


def export_need(S, W, Lo, A):
    """what France must export at full nuclear, GW: available nuclear + solar + wind − load"""
    return (A + S + W - Lo) / 1000


REGIME_EXTRAP = os.environ.get('PK_REGIME_EXTRAP', '1') == '1'   # in the cut-off regime, beyond the deepest surplus seen,
# the price keeps falling (slope of the lowest cells) down to the observed floor, so more solar keeps lowering the capture
# instead of stalling at the last cell. Anchored solar hourly capture 2027 / 2028 / 2029: 0.713 / 0.700 / 0.692 without,
# 0.695 / 0.668 / 0.648 with. Replay 2023–2026 (anchored): solar 1.33 → 1.32 €/MWh (bias +0.96 → +0.08), wind 0.99 → 1.13:
# the replay never left the surplus range already seen, 2028–2029 will; taken for the principle that the method must
# be able to show cannibalisation rising (Tom, 31 Oct. 2026)


class _PMExtrap(PriceModelFuel):
    EXTRAP = True
    AFFINE = os.environ.get('PK_AFFINE') in ('all', 'dec')


DEC_REG = os.environ.get('PK_DEC_REG') == '1'   # test: the cut-off rule also reads the region's share (see RegimeRule).
# Cut off, France's price still follows Germany's (2025, cut-off hours: 67.5 € vs 123 € when German wind is low, 42.4
# vs 82 when high, France exporting the same 4.5 GW to Core). True data, learnt 2024 → 2025, hourly error 20.3 → 18.5
# €/MWh, wind-weighted overvaluation +4.4 → +3.2 €, solar +6.5 → +1.7. But the generator replay does not follow: solar
# 2.46, wind 2.56 not anchored (with WTECH 2.32 / 2.36); anchored season wind 0.97: not taken (31 Oct. 2026)
DEC2 = os.environ.get('PK_DEC2') or None   # test: France cut off, its price read on the hour's French surplus × the day's
# mean surplus (a windy day's surplus lasts the whole day, storage and exports cannot absorb it as at midday);
# 'wind': × the hour's French wind share. True weather 2024–2025: no change ('1'); replay 'wind' solar 0.93, wind 2.31
# (bias +1.89) not anchored: not taken (31 Oct. 2026)


MC_FULL = os.environ.get('PK_MC_FULL') == '1'   # test: each scenario draws its fleet growth, nuclear and export limit
MC_FLEET = float(os.environ.get('PK_MC_FLEET', '0.4'))   # growth beyond the last known year × U(1 − x, 1 + x)
MC_NUC = float(os.environ.get('PK_MC_NUC', '0.04'))      # nuclear × lognormal(0, x) (EDF's yearly range 350–370 TWh ≈ ±3 %)
MC_JAO = float(os.environ.get('PK_MC_JAO', '0.2'))
MC_CRISIS = float(os.environ.get('PK_MC_CRISIS', '0.05'))   # chance of a 2022-like nuclear year
MC_LOAD = float(os.environ.get('PK_MC_LOAD', '0.02'))       # load level × lognormal(0, x) (electrification pace)       # Core export limit × lognormal(0, x √years) (5.4–9.2 GW 2023–2026)
POOL_HALF = float(os.environ.get('PK_POOL_HALF', '0'))   # test: weather weeks drawn with weight halving every N years back
KNN = int(os.environ.get('PK_KNN', '0'))   # test (31 Oct. 2026): the price of a simulated hour = the mean of the K most
# similar learnt hours (analogues) on: the region's and France's shares, what France must export beyond its Core limit,
# France's wind and solar shares, the hour and the season, instead of the rule's cells; one rule for both technologies


KNN_SPR = float(os.environ.get('PK_KNN_SPR', '0'))   # weight of the DE ÷ FR price ratio as an analogue feature
KNN_SCF = os.environ.get('PK_KNN_SCF') == '1'   # France's solar and wind as load factors (weather), not shares of load
_FWR = {}


def fwd_ratio(A, Y):
    """Germany's ÷ France's calendar forward for year Y, as quoted in December of year A (data/history/fr_market)"""
    if (A, Y) not in _FWR:
        import glob, json
        k = f'Y+{Y - A}'; r = []
        for f in sorted(glob.glob(os.path.join(ROOT, 'data', 'history', 'fr_market', f'{A}-12-*.json'))):
            c = json.load(open(f)).get('countries', {})
            a, b = c.get('FR', {}).get('forwardCurve', {}).get(k), c.get('DE', {}).get('forwardCurve', {}).get(k)
            if a and b:
                r.append(b / a)
        _FWR[(A, Y)] = float(np.mean(r)) if r else None
    return _FWR[(A, Y)]


def month_ratio(y):
    """days × 24: Germany's ÷ France's mean day-ahead price of each month of year y"""
    a = L.DATA[y]; de = de_prices(y); out = np.ones(a['fr_p'].shape)
    for m in range(1, 13):
        k = a['month'] == m
        if k.any():
            fm, dm = np.nanmean(a['fr_p'][k]), np.nanmean(de[k])
            out[k] = dm / fm if fm > 5 and np.isfinite(dm) else 1.0
    return out


KNN_DRAW = os.environ.get('PK_KNN_DRAW') or None
KNN_HYB = float(os.environ.get('PK_KNN_HYB', '0'))
KNN_AUTO = os.environ.get('PK_KNN_AUTO') == '1'   # the hybrid's correction only outside the known (analogues far away)
KNN_LL = float(os.environ.get('PK_KNN_LL', '0'))
KNN_F2 = os.environ.get('PK_KNN_F2') == '1'   # local-linear analogues (ridge on the slopes)   # hybrid: × the rule's difference (simulated hour − analogue hours)   # 'week' / 'day': draw one analogue per hour, rank shared by the block


class KNNRule:
    W_ = np.array([float(v) for v in os.environ.get('PK_KNN_W', '1,1,1,1,1,0.7,0.7').split(',')]
                  + ([0.7, 0.7] if os.environ.get('PK_KNN_F2') == '1' and len(os.environ.get('PK_KNN_W', '1,1,1,1,1,0.7,0.7').split(',')) == 7 else [])
                  + ([float(os.environ.get('PK_KNN_SPR', '0'))] if float(os.environ.get('PK_KNN_SPR', '0')) > 0 else []))

    def __init__(self, years):
        from scipy.spatial import cKDTree
        if os.environ.get('PK_KNN_LAST') == '1':
            years = [max(years)]
        if os.environ.get('PK_KNN_EX22') == '1' and any(y != 2022 for y in years):
            # the 2022 crisis left out of the analogues (as of the weather pool): the year before takes its place
            ys = [y for y in years if y != 2022]
            years = ys if len(set(ys)) > 1 or 2021 not in L.DATA else sorted(set([2021] + ys)) + ys[-1:]
        F = fuel_cost(); X, R, RP, PP, NG, RH = [], [], [], [], [], []
        self.rule = RegimeRule(years, True, True) if KNN_HYB else None
        for y in years:
            a = L.DATA[y]
            c = np.array([F.get(str(d)[:10], np.nan) for d in a['days']])[:, None] * np.ones((1, 24))
            need = export_need(a['fr_s'], a['fr_w'], a['fr_l'], fr_avail(y)) - fr_jmax(y) / 1000
            x_, xf_ = year_share(y, True), year_share(y, False)
            wsh_, ssh_ = (a['fr_w'] / 1000 / L.cap('FR', 'w', y), a['fr_s'] / 1000 / L.cap('FR', 's', y)) if KNN_SCF else (a['fr_w'] / a['fr_l'], a['fr_s'] / a['fr_l'])
            f = self.feats(x_, xf_, need, wsh_, ssh_, a['month'], month_ratio(y) if KNN_SPR else None)
            ok = np.isfinite(c) & (c > 5) & np.isfinite(a['fr_p']) & np.isfinite(f).all(-1)
            r = a['fr_p'] / c
            X.append(f[ok]); R.append(r[ok]); RP.append(np.maximum(r, 0)[ok]); PP.append((r > 0)[ok].astype(float)); NG.append(np.minimum(a['fr_p'], 0)[ok])
            if self.rule is not None:
                g_ = PriceModelFuel.groups(a['month'], [L.day_kind(d) for d in a['days']])
                cc_ = np.where(np.isfinite(c), c, np.nanmean(c))
                RH.append(self.rule.phi(x_, g_, xf_, cc_, None, need, xf_)[0][ok])
        X = np.concatenate(X); self.mu, self.sd = X.mean(0), X.std(0) + 1e-9
        Z = (X - self.mu) / self.sd * self.W_
        self.tree = cKDTree(Z)
        self.Z = Z
        if KNN_AUTO:
            # the typical distance to the K analogues for a learnt hour (a sample), the yardstick of "outside the known"
            smp = Z[np.random.default_rng(1).choice(len(Z), min(3000, len(Z)), replace=False)]
            self.dref = float(np.median(self.tree.query(smp, k=KNN, workers=-1)[0].mean(1)))
        self.R, self.RP, self.PP, self.NG = (np.concatenate(v) for v in (R, RP, PP, NG))
        self.RH = np.concatenate(RH) if RH else None

    @staticmethod
    def feats(x, xf, need, wsh, ssh, month, spr=None):
        h = np.arange(24)[None, :] * np.ones_like(x)
        m = (np.asarray(month)[:, None] * np.ones((1, 24)))
        f = [x, xf, need / 10.0, wsh, ssh, np.sin(2 * np.pi * h / 24) + 0 * x, np.cos(2 * np.pi * (m - 1) / 12)]
        if KNN_F2:
            # the hour and the month as full circles (sine alone confuses 03:00 with 09:00, April with October)
            f += [np.cos(2 * np.pi * h / 24) + 0 * x, np.sin(2 * np.pi * (m - 1) / 12) + 0 * x]
        if spr is not None:
            f += [spr + 0 * x]
        return np.stack(f, -1)

    def phi(self, x, g, xf=None, cost=None, z=None, need=None, xfr=None):
        spr = None
        if KNN_SPR:
            v_ = self._spr if getattr(self, '_spr', None) else 1.0
            spr = np.full(x.shape, v_)
        f = self.feats(x, xfr, need, self._wsh, self._ssh, self._month, spr)
        q = (f.reshape(-1, f.shape[-1]) - self.mu) / self.sd * self.W_
        dd, ii = self.tree.query(q, k=KNN, workers=-1)
        sh = x.shape
        if KNN_DRAW and KNN_LL:
            if not hasattr(self, '_rng'):
                self._rng = np.random.default_rng(int(os.environ.get('PK_KNN_SEED', 5)))
            D = sh[0]; blk = 7 if KNN_DRAW == 'week' else 1
            u = np.repeat(self._rng.random((D + blk - 1) // blk), blk)[:D]
            u = np.repeat(u[:, None], sh[1], 1).ravel()
            order = np.argsort(self.R[ii], axis=1)
            pick = ii[np.arange(len(ii)), order[np.arange(len(ii)), np.minimum((u * KNN).astype(int), KNN - 1)]]
            Zn = self.Z[ii]; zq = q[:, None, :]
            Xd = np.concatenate([np.ones(Zn.shape[:2] + (1,)), Zn - zq], -1)
            A_ = np.einsum('nki,nkj->nij', Xd, Xd) + KNN_LL * np.diag([0] + [1] * Zn.shape[2])[None]
            outs = []
            for v in (self.R, self.RP, self.PP, self.NG):
                b_ = np.linalg.solve(A_, np.einsum('nki,nk->ni', Xd, v[ii])[..., None])[:, 0, 0]
                lo, hi = v[ii].min(1), v[ii].max(1); span = hi - lo
                b_ = np.clip(b_, lo - span, hi + span)
                outs.append((b_ + v[pick] - v[ii].mean(1)).reshape(sh))
            r, rp, pp, ng = outs
            rp = np.maximum(rp, 0); pp = np.clip(pp, 0, 1); ng = np.minimum(ng, 0)
            rh = None
        elif KNN_DRAW:
            # one analogue per hour instead of their mean: each week (or day) of the scenario draws a rank in the
            # analogues' price distribution, shared by its hours (a dear or cheap week: outages, fuel, behaviour last),
            # so the scenarios spread like real months while their mean stays the analogues' mean
            if not hasattr(self, '_rng'):
                self._rng = np.random.default_rng(int(os.environ.get('PK_KNN_SEED', 5)))
            D = sh[0]; blk = 7 if KNN_DRAW == 'week' else 1
            u = np.repeat(self._rng.random((D + blk - 1) // blk), blk)[:D]
            u = np.repeat(u[:, None], sh[1], 1).ravel()
            order = np.argsort(self.R[ii], axis=1)
            pick = ii[np.arange(len(ii)), order[np.arange(len(ii)), np.minimum((u * KNN).astype(int), KNN - 1)]]
            r, rp, pp, ng = (v[pick].reshape(sh) for v in (self.R, self.RP, self.PP, self.NG))
            rh = self.RH[pick].reshape(sh) if self.RH is not None else None
        elif KNN_LL:
            # local linear: in each hour's analogues, a straight line of the price on the features, read at the hour
            Zn = self.Z[ii]; zq = q[:, None, :]
            Xd = np.concatenate([np.ones(Zn.shape[:2] + (1,)), Zn - zq], -1)
            A_ = np.einsum('nki,nkj->nij', Xd, Xd) + KNN_LL * np.diag([0] + [1] * Zn.shape[2])[None]
            outs = []
            for v in (self.R, self.RP, self.PP, self.NG):
                b_ = np.linalg.solve(A_, np.einsum('nki,nk->ni', Xd, v[ii])[..., None])[:, 0, 0]
                lo, hi = v[ii].min(1), v[ii].max(1)
                span = hi - lo
                outs.append(np.clip(b_, lo - span, hi + span).reshape(sh))
            r, rp, pp, ng = outs
            rp = np.maximum(rp, 0); pp = np.clip(pp, 0, 1); ng = np.minimum(ng, 0)
            rh = None
        else:
            r, rp, pp, ng = (v[ii].mean(1).reshape(sh) for v in (self.R, self.RP, self.PP, self.NG))
            rh = self.RH[ii].mean(1).reshape(sh) if self.RH is not None else None
        if rh is not None:
            # hybrid: the analogues moved by the rule's difference between the simulated hour and the analogues' own hours
            # (none where the future looks like the past; the rule extrapolates where it does not, e.g. more solar)
            rs = self.rule.phi(x, g, xfr, cost, None, need, xfr)[0]
            dlt = KNN_HYB * (rs - rh)
            if KNN_AUTO:
                # only as far as the hour lies outside the known: 0 at the typical distance, full at twice it
                wgt = np.clip(dd.mean(1).reshape(sh) / self.dref - 1.0, 0, 1)
                dlt = dlt * wgt
            rp = np.maximum(rp + dlt * pp, 0)
        cb = np.maximum(cost, 1.0) * np.ones(sh)
        return rp + ng / cb, rp, pp

    def pdec(self, g, need):
        return np.zeros(g.shape)


KNN_MC = os.environ.get('PK_KNN_MC') or None   # test (Tom, 31 Oct. 2026: learn from markets ahead of France): analogue hours
# from France and the zones listed (e.g. 'FR,DE,ES'), described in shares of each zone's own load (solar, wind, solar + wind
# + nuclear) and the clock; the target is the hour's price ÷ its month's mean (the shape, comparable across zones)


class MCKNNRule:
    ZONE = {'FR': 'FR', 'DE': 'DE_LU', 'ES': 'ES', 'NL': 'NL', 'BE': 'BE', 'AT': 'AT'}
    W_ = np.array([float(v) for v in os.environ.get('PK_MC_W', '2,2,1.5,0.7,0.7,0.5,0.5').split(',')])

    @staticmethod
    def feats(s, w, n, l, month):
        h = np.arange(24)[None, :] * np.ones_like(l); m = np.asarray(month)[:, None] * np.ones((1, 24))
        return np.stack([s / l, w / l, (s + w + n) / l, np.sin(2 * np.pi * h / 24), np.cos(2 * np.pi * h / 24),
                         np.cos(2 * np.pi * (m - 1) / 12), np.sin(2 * np.pi * (m - 1) / 12)], -1)

    def zone(self, c, y):
        import glob, json
        P = {}
        for f in sorted(glob.glob(os.path.join(ROOT, 'data', 'history', 'daily', f'{y}-*.json'))):
            hh = (json.load(open(f)).get('zones', {}).get(self.ZONE[c]) or {}).get('hourly')
            if hh and len(hh) in (24, 96):
                a = np.array([np.nan if v is None else v for v in hh], float); P[f[-15:-5]] = a if len(a) == 24 else a.reshape(24, 4).mean(1)
        if c == 'FR':
            a = L.DATA[y]; G = {str(d)[:10]: (a['fr_s'][i], a['fr_w'][i], a['fr_n'][i], a['fr_l'][i]) for i, d in enumerate(a['days'])}
        else:
            r = json.load(open(os.path.join(ROOT, 'data', 'history', 'region_hourly', f'{y}.json')))['countries'][c]
            G = {d: tuple(np.array([np.nan if v is None else v for v in (r[k].get(d) or [np.nan] * 24)], float) for k in ('s', 'w', 'n', 'l')) for d in r['l']}
        days = sorted(set(P) & set(G)); mo = {}
        for d in days:
            mo.setdefault(d[:7], []).append(P[d])
        mm = {k: np.nanmean(np.concatenate(v)) for k, v in mo.items()}
        X, R = [], []
        for d in days:
            s_, w_, n_, l_ = (np.nan_to_num(np.asarray(x, float)) for x in G[d]); p = P[d]
            if mm[d[:7]] <= 5 or (l_ <= 0).any():
                continue
            f = self.feats(s_[None], w_[None], n_[None], l_[None], [int(d[5:7])])[0]
            ok = np.isfinite(p) & np.isfinite(f).all(-1)
            X.append(f[ok]); R.append((p / mm[d[:7]])[ok])
        return (np.concatenate(X), np.concatenate(R)) if X else (np.zeros((0, 7)), np.zeros(0))

    def __init__(self, years):
        from scipy.spatial import cKDTree
        ys = [y for y in years if y != 2022] or list(years)
        X, R = [], []
        for c in KNN_MC.split(','):
            for y in ys:
                x_, r_ = self.zone(c, y); X.append(x_); R.append(r_)
        X = np.concatenate(X); self.R = np.concatenate(R)
        self.mu, self.sd = X.mean(0), X.std(0) + 1e-9
        self.tree = cKDTree((X - self.mu) / self.sd * self.W_)

    def phi(self, x, g, xf=None, cost=None, z=None, need=None, xfr=None):
        f = self.feats(self._S, self._W, self._N, self._L, self._month)
        _, ii = self.tree.query(((f.reshape(-1, f.shape[-1]) - self.mu) / self.sd * self.W_), k=KNN, workers=-1)
        R = self.R[ii]; sh = x.shape
        rp, pp, rm = np.maximum(R, 0).mean(1).reshape(sh), (R > 0).mean(1).reshape(sh), R.mean(1).reshape(sh)
        return rm, rp, pp   # shapes (÷ the month's mean): the capture is a ratio, the level cancels

    def pdec(self, g, need):
        return np.zeros(g.shape)


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
        if DEC_REG:
            # cut off, France's price still moves with its neighbours' (through its other borders): the cut-off rule on
            # the region's share × France's own, as the coupled one
            self.dec = (_PMExtrap if REGIME_EXTRAP else PriceModelFuel)(years, region, mask=dec if nd_ >= 500 else None)
            self.dec.add_france(years, mask=dec if nd_ >= 500 else None)
        else:
            self.dec = (_PMExtrap if REGIME_EXTRAP else PriceModelFuel)(years, False, mask=dec if nd_ >= 500 else None)
        if DEC2:
            self.dec.DAY2 = True
            self.dec.add_france(years, mask=dec if nd_ >= 500 else None)
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
        self.cpl._wsh = getattr(self, '_wsh', None)
        if DEC_REG:
            a = self.dec.phi(x, g, xf, cost)
        else:
            a = self.dec.phi(xfr, g, (day_mean(xfr) if DEC2 == '1' else getattr(self, '_wsh', None)) if DEC2 else None, cost)
        b = self.cpl.phi(x, g, xf, cost)
        w = self.pdec(g, need)
        return tuple(w * u + (1 - w) * v for u, v in zip(a, b))


STATE_CORR = os.environ.get('PK_STATE_CORR') == '1'   # test: the price rule's error by situation, measured on the last
# complete year (season × time of day × French wind share × cut-off chance), added to each simulated hour in that
# situation (windy days, cut-off hours: where the rule misses). Replay 2023–2026, 9 cases, €/MWh (none / year / season
# anchor): one year solar 2.81 / 2.11 / –, wind 2.02 / 0.90 / –; two years solar 2.57 / 2.16 / 2.07, wind 1.73 / 0.79 /
# 0.72, but unanchored 2026 errs by −4 to −8 €: unstable, the anchor only hides it. Not taken (31 Oct. 2026)
WBIN, PBIN = 0.05, 0.34


def state_key(g, wsh, pi):
    return (g * 100 + np.clip(np.round(wsh / WBIN).astype(int), 0, 20)) * 10 + np.clip((pi / PBIN).astype(int), 0, 2)


def state_table(pmf, A):
    """{state: mean of (realised price − the rule's expected price) in €} over year A (STATE_YEARS = 2: also the
    complete year before, 2022 left out, A weighing double), each on its own weather and data"""
    ys = [A] + ([y for y in sorted(L.DATA, reverse=True) if y < A and y != 2022 and L.DATA[y]['complete']][:1] if STATE_YEARS == 2 else [])
    acc = {}
    for y, wy in zip(ys, (2.0, 1.0)):
        for kk, (sm, n) in _state_sums(pmf, y).items():
            a_ = acc.setdefault(kk, [0.0, 0.0]); a_[0] += wy * sm; a_[1] += wy * n
    return {kk: v[0] / v[1] for kk, v in acc.items() if v[1] >= 30}


STATE_YEARS = int(os.environ.get('PK_STATE_YEARS', 1))


def _state_sums(pmf, A):
    a = L.DATA[A]; F_ = fuel_cost(); mo = a['month']
    c = np.array([F_.get(str(d)[:10], np.nan) for d in a['days']])[:, None]
    g = PriceModelFuel.groups(mo)
    x, xf = year_share(A, True), year_share(A, False)
    if isinstance(pmf, RegimeRule):
        need = export_need(a['fr_s'], a['fr_w'], a['fr_l'], fr_avail(A)) - (fr_jmax(A) / 1000 if REGIME_JAO else 0)
        f1, _, _ = pmf.phi(x, g, xf, c, None, need, xf); pi = pmf.pdec(g, need)
    else:
        f1, _, _ = pmf.phi(x, g, xf, c); pi = np.zeros_like(x)
    r = a['fr_p'] - f1 * c
    k = state_key(g, a['fr_w'] / a['fr_l'], pi)
    ok = np.isfinite(r)
    return {int(kk): (float(r[ok & (k == kk)].sum()), int((ok & (k == kk)).sum())) for kk in np.unique(k[ok])}


WIND_LIN = os.environ.get('PK_WIND_LIN') == '1'   # test: within each cell of the rule, the price still falls with French
# wind (≈ 1.5 € per GW in 2025): a slope of price ÷ cost on the French wind share, per season × time of day, learnt on
# the learning years around each cell's mean (the rule's own residuals), added to the simulated hours. Replay 2023–2026,
# 9 cases: solar 1.48 / 1.15 (none / year anchor), wind 1.96 / 0.96; with PEN_CURVE wind: solar 2.54 / 1.14 / 1.23
# (season), wind 2.59 / 1.05 / 0.84, 2026 unanchored −7 to −8 €. Not taken (31 Oct. 2026)


def wind_slopes(pmf, years):
    """{group: (slope of the rule's residual (price ÷ cost) per unit of French wind share, {cell: mean wind share})}"""
    F_ = fuel_cost(); R, Wv, K, Gv = [], [], [], []
    for y in years:
        a = L.DATA[y]; mo = a['month']
        c = np.array([F_.get(str(d)[:10], np.nan) for d in a['days']])[:, None]
        g = PriceModelFuel.groups(mo); x, xf = year_share(y, True), year_share(y, False)
        need = export_need(a['fr_s'], a['fr_w'], a['fr_l'], fr_avail(y)) - (fr_jmax(y) / 1000 if REGIME_JAO else 0)
        f1, _, _ = pmf.phi(x, g, xf, c, None, need, xf) if isinstance(pmf, RegimeRule) else pmf.phi(x, g, xf, c)
        ok = np.isfinite(c[:, 0]) & (c[:, 0] > 5)
        R.append((a['fr_p'] / c - f1)[ok].ravel()); Wv.append((a['fr_w'] / a['fr_l'])[ok].ravel())
        K.append(((g * 1000 + np.round(x / 0.05).astype(int)) * 1000 + np.round(xf / 0.1).astype(int))[ok].ravel()); Gv.append(g[ok].ravel())
    r, w, k, gg = (np.concatenate(v) for v in (R, Wv, K, Gv))
    out = {}
    for gi in np.unique(gg):
        sel = gg == gi; kk, rr, ww = k[sel], r[sel], w[sel]
        wc, rc, means = ww.copy(), rr.copy(), {}
        for cell in np.unique(kk):
            m_ = kk == cell; means[int(cell)] = float(ww[m_].mean())
            wc[m_] -= ww[m_].mean(); rc[m_] -= rr[m_].mean()
        b = float(np.dot(wc, rc) / np.dot(wc, wc)) if np.dot(wc, wc) > 0 else 0.0
        out[int(gi)] = (b, means)
    return out


WIND_DEC = os.environ.get('PK_WIND_DEC') == '1'   # test: when France is cut off, within a cell of its own rule the
# price still falls with French wind (wind-weighted the rule is +4.5 to +7 € too high on those hours of 2024–2025 while
# right on their mean): a slope of price ÷ cost on the French wind share, per season × time of day, learnt on the cut-off
# hours of the learning years around each cell's mean, applied × the hour's chance of being cut off. Replay: solar 1.66,
# wind 2.38 (bias +1.11, 2026 −3.7 €) not anchored; anchored season wind 0.89: not taken (31 Oct. 2026)


def wind_slopes_dec(pmf, years):
    """{group: (slope, {cell: mean wind share})} of the France-only rule's residual on the real cut-off hours"""
    F_ = fuel_cost(); R, Wv, K, Gv = [], [], [], []
    for y in years:
        a = L.DATA[y]; de = de_prices(y)
        c = np.array([F_.get(str(d)[:10], np.nan) for d in a['days']])[:, None]
        g = PriceModelFuel.groups(a['month'], [L.day_kind(d) for d in a['days']]); xf = year_share(y, False)
        d1, _, _ = pmf.dec.phi(xf, g, None, c)
        ok = (np.isfinite(c) & (c > 5)) & np.isfinite(de) & (a['fr_p'] < de - 5)
        R.append((a['fr_p'] / c - d1)[ok]); Wv.append((a['fr_w'] / a['fr_l'])[ok])
        K.append((g * 1000 + np.round(xf / L.BIN).astype(int) + 500)[ok]); Gv.append(g[ok])
    r, w, k, gg = (np.concatenate(v) for v in (R, Wv, K, Gv))
    out = {}
    for gi in np.unique(gg):
        sel = gg == gi; kk, rr, ww = k[sel], r[sel], w[sel]
        wc, rc, means = ww.copy(), rr.copy(), {}
        for cell in np.unique(kk):
            m_ = kk == cell; means[int(cell)] = float(ww[m_].mean())
            wc[m_] -= ww[m_].mean(); rc[m_] -= rr[m_].mean()
        out[int(gi)] = (float(np.dot(wc, rc) / np.dot(wc, wc)) if np.dot(wc, wc) > 0 else 0.0, means)
    return out


PEN_CURVE = os.environ.get('PK_PEN_CURVE') == '1'   # test (Tom, 31 Oct. 2026): the price within the month as a function
# of the hour's renewable penetration ((solar + wind) ÷ load, France): realised curve − the rule's curve on the last
# complete year, by bins of 5 % and season, added to each simulated hour then centred month by month (the month's mean
# price unchanged); the curve measured again every year
PBIN_W = 0.05
PEN_WIND = os.environ.get('PK_PEN_WIND') == '1'   # the curve on wind penetration alone (wind ÷ load)
# Replay 2023–2026, 9 cases (none / year / season anchor): total penetration solar 6.31 / – / –, wind 1.77; wind
# penetration solar 1.63 / 1.01 / 1.14, wind 2.39 (bias +0.05) / 1.03 / 0.83. Other tests of the same night: Great
# Britain as a fourth neighbour, its fleet frozen (no GB capacity by year yet), wind 2.49 / 0.92 / 0.65, solar 2.27 /
# 1.81 / 1.95; the Netherlands and Austria added: worse (solar 2.20+, wind 1.29+); all combined wind 0.61 at best but
# −11 € on 2026 unanchored; 60 draws instead of 30 moves the replay by ≤ 0.03 €; 3-day blocks wind 0.76 (season),
# solar 0.86; draw window ±14 days: no gain. Not taken (31 Oct. 2026)


def pen_curve(pmf, A):
    """{(season, bin): realised − rule price ÷ month mean} on year A (its own weather and data)"""
    a = L.DATA[A]; F_ = fuel_cost(); mo = a['month']
    c = np.array([F_.get(str(d)[:10], np.nan) for d in a['days']])[:, None]
    g = PriceModelFuel.groups(mo); x, xf = year_share(A, True), year_share(A, False)
    if isinstance(pmf, RegimeRule):
        need = export_need(a['fr_s'], a['fr_w'], a['fr_l'], fr_avail(A)) - (fr_jmax(A) / 1000 if REGIME_JAO else 0)
        f1, _, _ = pmf.phi(x, g, xf, c, None, need, xf)
    else:
        f1, _, _ = pmf.phi(x, g, xf, c)
    ph, pa = f1 * c, a['fr_p'].astype(float)
    rel = lambda p: p / np.array([np.nanmean(p[mo == m]) for m in mo])[:, None]
    d = rel(pa) - rel(ph)
    pen = (a['fr_w'] if PEN_WIND else a['fr_s'] + a['fr_w']) / a['fr_l']; sea = ((mo >= 4) & (mo <= 9)).astype(int)[:, None] * np.ones((1, 24), int)
    b = np.clip(np.round(pen / PBIN_W).astype(int), 0, 30)
    out = {}
    for se in (0, 1):
        for bi in np.unique(b[sea == se]):
            k = (sea == se) & (b == bi) & np.isfinite(d)
            if k.sum() >= 30:
                out[(se, int(bi))] = float(d[k].mean())
    return out


RECENT_W = os.environ.get('PK_RECENT_W', '1') == '1'   # the price rule's last learning year weighs twice the one before
# (Tom, 31 Oct. 2026: recent data weigh more). Replay 2023–2026 anchored, 9 cases: solar 1.32 → 1.18, wind 1.13 → 0.96
# €/MWh; priced at the end of October (6 cases): solar 1.63 → 1.10, wind 1.83 → 1.47. Adopted 31 Oct. 2026. Anchoring on
# the last 12 complete months instead of the last calendar year, with it: solar 1.10 → 1.08, wind 1.47 → 1.67: not taken
ANCHOR = os.environ.get('PK_ANCHOR', '1') == '1'   # the capture anchored on the last complete year (Tom, 31 Oct. 2026):
# generator(delivery year) × realised(last year) ÷ generator(last year), one factor per technology and convention, so
# the model's level error cancels and it only gives the change (fleet, batteries, regimes). Deliveries 2023–2026, 1–3
# years ahead (9 cases each): wind 2.14 → 0.99 €/MWh (bias +2.14 → −0.13), solar 1.18 → 1.33 (its level was already
# right; its error is the slope), both 1.66 → 1.16. Adopted 31 Oct. 2026


RESID = os.environ.get('PK_RESID') or None   # test (Tom, 31 Oct. 2026: a method without anchoring): each simulated hour
# gets the drawn day's own surprise against the rule (its realised price − the rule's price on that day's real data),
# so the link between the wind of that day and its price, which a cell's mean loses, comes back with the weather.
# 'ratio': the surprise ÷ that day's fuel cost × the delivery year's; 'eur': in €; 'centre': ratio, centred on zero
# in each (year, month) so the month's level stays the rule's and only the shape inside the month comes back
RESID_K = float(os.environ.get('PK_RESID_K', 1.0))
RESID_RECENT = os.environ.get('PK_RESID_RECENT') == '1'   # only the learning years' days carry their surprise
# Replay 2023–2026, 9 cases, €/MWh, not anchored (current 0.76 solar / 2.62 wind): ratio 2.99 / 3.38, eur 1.88 / 2.28,
# centred 3.13 / 4.35, half 2.30 / 2.09; learning years only 3.72 / 2.14 (eur 3.98 / 2.12); with draws from 2023 only
# 2.58 / 4.26. The last known year is then priced right (wind factor 1.00 instead of 0.97) but the delivery years are
# not: not taken (31 Oct. 2026)
_RS = {}


def rule_resid(pmf, y, mode):
    """days × 24 of year y: (realised price − the rule's price on y's own data), ÷ the day's fuel cost unless 'eur'"""
    key = (id(pmf), y, mode)
    if key not in _RS:
        a = L.DATA[y]; F_ = fuel_cost(); mo = a['month']
        c = np.array([F_.get(str(d)[:10], np.nan) for d in a['days']])[:, None]
        c = np.where(np.isfinite(c), c, np.nanmean(c))
        g = PriceModelFuel.groups(mo, [L.day_kind(d) for d in a['days']])
        x, xf = year_share(y, True), year_share(y, False)
        if isinstance(pmf, RegimeRule):
            need = export_need(a['fr_s'], a['fr_w'], a['fr_l'], fr_avail(y)) - (fr_jmax(y) / 1000 if REGIME_JAO else 0)
            f1, _, _ = pmf.phi(x, g, xf, c, None, need, xf)
        else:
            f1, _, _ = pmf.phi(x, g, xf, c)
        r = a['fr_p'] - f1 * c
        r = np.where(np.isfinite(r), r, 0.0)
        if mode != 'eur':
            r = r / c
        if mode == 'centre':
            for m in range(1, 13):
                k = mo == m
                if k.any():
                    r[k] = r[k] - r[k].mean()
        _RS[key] = r
    return _RS[key]


# Which anchoring, per technology (Tom, 31 Oct. 2026): the same rule for both, an anchoring is kept only where it lowers
# that technology's replay error (scripts/ppa_model_risk.py, measured again every week, writes 'anchorMode'). Modes:
# 'none', 'year' (one factor on the 12 months), 'season' (one factor for October–March, one for April–September).
# Replay 2023–2026, 9 cases, €/MWh: solar none 0.76, year 1.18, season 1.22; wind none 2.62, year 0.96, season 0.84.
# Tested and left out: anchors by month or quarter (solar 2.14 / 2.09, wind 1.69 / 1.52), on the last year's own weather
# rather than drawn weeks (solar 1.95, wind 1.42), half the yearly factor (solar 0.96, wind 1.51)
ANCHOR_MODES = ('none', 'year', 'season')
WINTER = (1, 2, 3, 10, 11, 12)


def anchor_factors(t, A, known, st, cost, n=30, seed=7):
    """{mode: {'curt': {month: k}, 'all': {month: k}}}: the realised capture of year A ÷ the generator's capture of
    year A (its fleet, its data, the same rule and draws), production-weighted (× the paid share for 'curt'), over the
    12 months ('year') or within each half-year ('season'); 'none' = 1"""
    capA = {c: {tt: (L.cap(c, tt, A) or L.cap_guess(c, tt, A, A)) for tt in 'sw'} for c in CS}
    gA, _ = simulate(t, A, known, st, A, capA, None, n=n, rule='fuel', cost=cost, batteries='both', pool_from=2019,
                     fuel_dev=True, france=True, seed=seed)
    aA = L.actual(t, A)
    out = {'none': {c: {m: 1.0 for m in range(1, 13)} for c in ('curt', 'all')}, 'year': {}, 'season': {}}
    for conv in ('curt', 'all'):
        w = {m: aA[m]['mwh'] * (aA[m]['paid'] if conv == 'curt' else 1) for m in aA
             if m in gA and gA[m][conv] == gA[m][conv] and aA[m][conv] is not None}

        def k(ms):
            den = sum(w[m] * gA[m][conv] for m in w if m in ms)
            return float(sum(w[m] * aA[m][conv] for m in w if m in ms) / den) if den > 0 else 1.0
        ky, kw, ks = k(range(1, 13)), k(WINTER), k([m for m in range(1, 13) if m not in WINTER])
        out['year'][conv] = {m: ky for m in range(1, 13)}
        out['season'][conv] = {m: kw if m in WINTER else ks for m in range(1, 13)}
    return out


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
    pmf = pmf_b = None
    WTECH['t'] = t if os.environ.get('PK_WTECH') == '1' else None
    if rule == 'fuel':
        fy = train or [y for y in known if L.DATA[y]['complete'] and y >= 2019][-fuel_window:]
        if trend:
            pmf = TrendRule(fy, st['regional'], france)
        else:
            if RECENT_W:
                fy = fy + fy[-1:]   # the last learning year counted twice (weighs 2 against 1)
            if KNN and KNN_MC:
                pmf = MCKNNRule(fy)
            elif KNN:
                pmf = KNNRule(fy)
            elif REGIME:
                pmf = RegimeRule(fy, st['regional'], france)
                if WTECH['t'] and WTECH_BASE:
                    # the month's base price from the rule learnt on every hour alike, the technology's value from the
                    # output-weighted one (a capture rate is a ratio: weighting both would cancel)
                    _t = WTECH['t']; WTECH['t'] = None
                    pmf_b = RegimeRule(fy, st['regional'], france)
                    WTECH['t'] = _t
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
    ST_TAB = None
    WL_TAB = None
    WD_TAB = None
    PC_TAB = None
    if REGIME:
        _av, _dm = fr_avail(demand_year), L.DATA[demand_year]['month']
        AVR = np.array([_av[_dm == m].mean() for m in range(1, 13)])
        NUCF = np.ones(12)
        if NUC_Y == 'oracle' and Y in L.DATA:
            # test: the delivery year's real available nuclear (not knowable when pricing) for its months seen
            _ay, _my = fr_avail(Y), L.DATA[Y]['month']
            for m_ in range(1, 13):
                if (_my == m_).sum() >= 20:
                    v_ = float(_ay[_my == m_].mean()); NUCF[m_ - 1] = v_ / AVR[m_ - 1]; AVR[m_ - 1] = v_
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
        if MC_FULL:
            # this scenario's own world (Tom, 31 Oct. 2026: a Monte Carlo that takes more into account): the fleets grow
            # faster or slower than the trend, France's nuclear and Core export limit move around their last known level
            g_fleet = float(rng.uniform(1 - MC_FLEET, 1 + MC_FLEET))
            g_nuc = float(np.exp(rng.normal(0, MC_NUC)))
            if rng.random() < MC_CRISIS:
                g_nuc *= 0.8   # a 2022-like year (corrosion, strikes): France's nuclear 20 % lower
            g_load = float(np.exp(rng.normal(0, MC_LOAD)))
            g_jao = float(np.exp(rng.normal(0, MC_JAO * np.sqrt(max(1, Y - demand_year)))))
        else:
            g_fleet = g_nuc = g_jao = g_load = 1.0
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
            if POOL_HALF > 0:
                ag = np.array([0.5 ** ((max(pool) - y_) / POOL_HALF) for y_, _ in cand])
            else:
                ag = None
            if prev is not None:
                pw, pl = prev
                w = np.array([np.exp(-0.5 * (((starts[y]['FR_w'][r].mean() - pw) / sd[y][0]) ** 2 + ((starts[y]['FR_ldev'][r].mean() - pl) / sd[y][1]) ** 2))
                              for y, r in cand])
                w = w / w.sum() if w.sum() > 0 else None
            else:
                w = None
            if ag is not None:
                w = ag / ag.sum() if w is None else (w * ag) / (w * ag).sum()
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
            if MC_FULL and g_fleet != 1.0:
                # growth beyond the last known year scaled by g_fleet
                capA_ = {tt: (L.cap(c, tt, demand_year) or capY[c][tt]) * 1000 for tt in 'sw'}
                S[c] = sv * (capA_['s'] + g_fleet * (fleet[(c, 's')] - capA_['s']))
                W[c] = wv * (capA_['w'] + g_fleet * (fleet[(c, 'w')] - capA_['w']))
            else:
                S[c] = sv * fleet[(c, 's')]
                W[c] = wv * fleet[(c, 'w')]
            Lo[c] = ld * np.array([M.get((c, 'l', int(m), int(k)), 0.0) for m, k in zip(month, kind)])[:, None]
            N[c] = nd * np.array([M.get((c, 'n', int(m), int(k)), 0.0) for m, k in zip(month, kind)])[:, None]
        if NUC_AV:
            N['FR'] = AVM[month - 1][:, None] * np.ones((1, 24))
        if REGIME and NUC_Y:
            N['FR'] = N['FR'] * NUCF[month - 1][:, None]
        if MC_FULL:
            # the drawn days' own nuclear availability against their month's (heat waves, droughts, strikes come with
            # the weather of the same week), × this scenario's level
            dv = []
            for y_, r_, _ in src:
                av_ = fr_avail(y_); mo_ = starts[y_]['month']
                mm_ = av_[mo_ == mo_[r_]].mean()
                dv.append(av_[r_].mean() / mm_ if mm_ > 0 else 1.0)
            NDEV = np.array(dv)[:, None] * g_nuc
            N['FR'] = N['FR'] * g_nuc   # the drawn day's output deviation is already in N (FR_ndev)
            for c in CS:
                Lo[c] = Lo[c] * g_load
        else:
            NDEV = 1.0
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
                need = export_need(S['FR'], W['FR'], Lo['FR'], NDEV * AVR[month - 1][:, None] * np.ones((1, 24)))
                if REGIME_JAO:
                    # the drawn day's Core export limit (its grid situation) at the last known year's level
                    ref = jao_level(Y, demand_year, known) * g_jao
                    need = need - np.stack([fr_jmax(y)[r] * ref / float(np.mean(fr_jmax(y))) for y, r, _ in src]) / 1000
                pmf._wsh = W['FR'] / Lo['FR']   # DEC2 = 'wind': the cut-off rule's second input
                pmf._ssh, pmf._month = S['FR'] / Lo['FR'], month
                pmf._S, pmf._W, pmf._N, pmf._L = S['FR'], W['FR'], N['FR'], Lo['FR']
                if KNN_SCF:
                    pmf._wsh, pmf._ssh = W['FR'] / fleet[('FR', 'w')], S['FR'] / fleet[('FR', 's')]
                if KNN_SPR:
                    pmf._spr = fwd_ratio(demand_year, Y)
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
            if WIND_LIN:
                if WL_TAB is None:
                    WL_TAB = wind_slopes(pmf, fy)
                cellk = (gg * 1000 + np.round(x / 0.05).astype(int)) * 1000 + np.round(xfr / 0.1).astype(int)
                wsh = W['FR'] / Lo['FR']
                adj = np.zeros(x.shape)
                for gi, (b, means) in WL_TAB.items():
                    sel = gg == gi
                    if not sel.any():
                        continue
                    mw = np.vectorize(lambda z: means.get(int(z), np.nan))(cellk[sel])
                    adj[sel] = np.where(np.isfinite(mw), b * (wsh[sel] - mw), 0.0)
                f1 = f1 + adj; fp = np.maximum(fp + adj * fq, 0)
            if WIND_DEC and REGIME:
                if WD_TAB is None:
                    WD_TAB = wind_slopes_dec(pmf, sorted(set(fy)))
                xfr_ = share(S, W, Lo, N, H, False)
                cellk = gg * 1000 + np.round(xfr_ / L.BIN).astype(int) + 500
                wsh = W['FR'] / Lo['FR']; pi_ = pmf.pdec(gg, need)
                adj = np.zeros(x.shape)
                for gi, (b, means) in WD_TAB.items():
                    sel = gg == gi
                    if sel.any():
                        mw = np.vectorize(lambda z: means.get(int(z), np.nan))(cellk[sel])
                        adj[sel] = np.where(np.isfinite(mw), b * (wsh[sel] - mw), 0.0) * pi_[sel]
                f1 = f1 + adj; fp = np.maximum(fp + adj * fq, 0)
            if PEN_CURVE:
                if PC_TAB is None:
                    PC_TAB = pen_curve(pmf, demand_year)
                pen = (W['FR'] if PEN_WIND else S['FR'] + W['FR']) / Lo['FR']; sea = ((month >= 4) & (month <= 9)).astype(int)[:, None] * np.ones((1, 24), int)
                b = np.clip(np.round(pen / PBIN_W).astype(int), 0, 30)
                dr = np.zeros(pen.shape)
                for (se, bi), v in PC_TAB.items():
                    dr[(sea == se) & (b == bi)] = v
                # beyond the bins seen: the nearest bin of the season
                for se in (0, 1):
                    ks = sorted(bi for (s_, bi) in PC_TAB if s_ == se)
                    if ks:
                        hi_, lo_ = (sea == se) & (b > ks[-1]), (sea == se) & (b < ks[0])
                        dr[hi_] = PC_TAB[(se, ks[-1])]; dr[lo_] = PC_TAB[(se, ks[0])]
                pm_ = np.array([np.mean((f1 * cday)[month == m]) for m in range(1, 13)])[month - 1][:, None]
                adj = dr * pm_
                adj = adj - np.array([adj[month == m].mean() for m in range(1, 13)])[month - 1][:, None]   # month mean unchanged
                f1 = f1 + adj / cday; fp = np.maximum(fp + adj * fq / cday, 0)
            if STATE_CORR and REGIME:
                # the rule's error in this situation on the last complete year, in € (the positive part moves with the
                # chance the hour is paid)
                if ST_TAB is None:
                    ST_TAB = state_table(pmf, demand_year)
                pi_ = pmf.pdec(gg, need)
                kk_ = state_key(gg, W['FR'] / Lo['FR'], pi_)
                dlt = np.vectorize(lambda z: ST_TAB.get(int(z), 0.0))(kk_)
                f1 = f1 + dlt / cday; fp = np.maximum(fp + dlt * fq / cday, 0)
            if RESID:
                ry = set(fy) if RESID_RECENT else None
                rr = np.stack([rule_resid(pmf, y, RESID)[r] if ry is None or y in ry else np.zeros(24) for y, r, _ in src]) * RESID_K
                P = f1 * cday + (rr if RESID == 'eur' else rr * cday)
                f1, fp, fq = P / cday, np.maximum(P, 0) / cday, (P > 0).astype(float)
            v = S['FR'] if t == 's' else W['FR']
            mr = L.month_rates(month, v, f1 * cday, fp * cday, fq)
            if pmf_b is not None:
                fb, _, _ = pmf_b.phi(x, gg, xfr, cday, None, need, share(S, W, Lo, N, H, False))
                for m_, e_ in mr.items():
                    k_ = month == m_
                    bw, bb = float((f1 * cday)[k_].mean()), float((fb * cday)[k_].mean())
                    if bb > 0:
                        for cv in ('all', 'curt'):
                            if e_.get(cv) is not None:
                                e_[cv] *= bw / bb
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
    dist['scenarios'] = res   # each scenario's monthly rates (for annual percentiles)
    return out, dist
