#!/usr/bin/env python3
"""Merit order of the PPA scenario generator (experimental, not in the published price): France and its Core neighbours
(Germany, Belgium, the Netherlands, Austria) cleared hour by hour on stacked offers, coupled up to France's flow-based
export / import limit of the hour (JAO); Britain, Switzerland, Italy and Spain enter as the day's exchanges.
See docs/discussion/merit-order-plan.md and docs/discussion/merit/README.md (results).

Status (31 Oct. 2026): not in the published price. Tested by quarter on 2023–2026 (true weather, output stopped at ≤ 0):
solar 4.83 €/MWh against 3.01 for the current rule, wind 3.69 against 3.72; in the generator replay by quarter, one
year ahead, solar 4.30 against 2.51, wind 3.87 against 5.01 (better in 12 quarters of 15), two years ahead worse for
both. Its gap: midday in spring and summer, where far more thermal output stays on at negative prices (started for the
evening, heat, reserves) than the years before show; options tried and left off: 'commit' (± W hours or 40 % of the
day's peak), 'th_tod' (offer curves by time of day), 'mr_tod' (always-running thermal by month and time of day),
'th_markup' (markup over the cost-based stack): none better on the quarterly test.

Offers: run-of-river, biomass, nuclear minimum and must-run thermal always; solar and wind (a share stops around 0 €,
the rest at last year's observed negative depth); French nuclear above its minimum at last year's observed offer
curve (price ÷ CCGT cost by use of the available fleet); the neighbours' thermal fleet at last year's observed offer
curve (Germany's price ÷ CCGT cost by use of the fleet, winter and summer); reservoirs on the week's energy, pumped
storage on the day's spread. Data: éCO2mix (France), Energy-Charts (neighbours, data/history/region_hourly), JAO
(data/history/jao_core), flows (data/history/flows), SEFE and the World Bank (fuels)."""
import json, os, glob
from datetime import date
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REST = ('DE', 'BE', 'NL', 'AT')
MOD = ('FR',) + REST
GRID = np.arange(-150.0, 601.0, 1.0)

# ── data ─────────────────────────────────────────────────────────────────────
_S = None
def series():
    global _S
    if _S is None:
        s = json.load(open(f'{ROOT}/data/history/commodities_series.json'))['series']
        _S = {k: dict(s[k]['points']) for k in ('ttf', 'eua', 'coal', 'brent', 'eurusd', 'fr_nuc_avail')}
    return _S

def daily(k, days, fill=None):
    s = series()[k]; ks = sorted(s); out = []; last = fill if fill is not None else s[ks[0]]
    for d in days:
        last = s.get(d, last); out.append(last)
    return np.array(out, float)

_CAP = None
def capacity(c, t, y):
    global _CAP
    if _CAP is None:
        _CAP = json.load(open(f'{ROOT}/data/history/capacity.json'))['countries']
    v = _CAP.get(c)
    if not v or t not in v['types']:
        return 0.0
    ys = v['years']; xs = v['types'][t]
    best = None
    for yy, x in zip(ys, xs):
        if x is not None and yy <= y:
            best = x
    return float(best or 0.0)

def eco(y):
    F = ('nuclear', 'wind', 'solar', 'hydroRoR', 'hydroLake', 'hydroPS', 'pumping', 'gas', 'coal', 'oil', 'bio', 'load', 'exchanges')
    out = {}
    for f in sorted(glob.glob(f'{ROOT}/data/history/rte/{y}-*.json')):
        for day, v in json.load(open(f))['days'].items():
            if not v.get('load') or len(v['load']) != 96:
                continue
            row = {}
            for k in F:
                a = v.get(k)
                a = np.array([np.nan if x is None else x for x in a], float) if a else np.zeros(96)
                row[k] = a.reshape(24, 4).mean(1)
            if all(np.isfinite(row[k]).all() for k in ('load', 'solar', 'wind', 'nuclear')):
                out[day] = row
    return out

_RH = {}
def region(y):
    if y not in _RH:
        f = f'{ROOT}/data/history/region_hourly/{y}.json'
        _RH[y] = json.load(open(f))['countries'] if os.path.exists(f) else {}
    return _RH[y]

_JAO = {}
def jao(y):
    if y not in _JAO:
        f = f'{ROOT}/data/history/jao_core/{y}.json'
        _JAO[y] = json.load(open(f))['days'] if os.path.exists(f) else {}
    return _JAO[y]

_FLOWS = {}
def flows(y):
    if y not in _FLOWS:
        d = {}
        for f in sorted(glob.glob(f'{ROOT}/data/history/flows/{y}-*.json')):
            d.update(json.load(open(f))['days'])
        _FLOWS[y] = d
    return _FLOWS[y]

def fr_prices(y):
    out = {}
    for f in sorted(glob.glob(f'{ROOT}/data/history/fr_hourly/{y}.json')):
        for d, v in json.load(open(f))['days'].items():
            if v.get('p') and None not in v['p'] and len(v['p']) == 24:
                out[d] = np.array(v['p'], float)
    return out

def de_prices(y, days):
    out = []
    for d in days:
        try:
            z = json.load(open(f'{ROOT}/data/history/daily/{d}.json'))['zones'].get('DE_LU', {}).get('hourly')
        except OSError:
            z = None
        if not z or None in z:
            out.append(np.full(24, np.nan)); continue
        a = np.array(z, float)
        out.append(a.reshape(24, -1).mean(1) if len(a) % 24 == 0 else np.full(24, np.nan))
    return np.array(out)

def year(y):
    """aligned hourly arrays (days × 24) for France and the rest zone"""
    E = eco(y); P = fr_prices(y); FL = flows(y)
    RG = region(y); R = {c: RG.get(c) for c in REST}
    days = []
    for d in sorted(E):
        if d not in P:
            continue
        ok = True
        for c in REST:
            r = R[c]
            if not r or 'gas' not in r or d not in (r.get('l') or {}) or None in r['l'][d]:
                ok = False; break
        if ok:
            days.append(d)
    g = lambda c, name: np.array([[x or 0.0 for x in (R[c].get(name, {}) or {}).get(d, [0] * 24)] for d in days], float)
    fr = {k: np.array([E[d][k] for d in days]) for k in E[days[0]]}
    rest = {}
    for c in REST:
        part = {'load': g(c, 'l'), 'solar': g(c, 's'), 'wind': g(c, 'w'), 'nuclear': g(c, 'n'),
                'mr': g(c, 'ror') + g(c, 'bio') + g(c, 'oth'), 'lake': g(c, 'lake'), 'lignite': g(c, 'lig'), 'coal': g(c, 'coal'),
                'gas': g(c, 'gas'), 'oil': g(c, 'oil')}
        for k, v in part.items():
            rest[k] = rest.get(k, 0) + v
    # exogenous exchanges: France ↔ GB, and the rest zone ↔ countries outside the model (+ = import)
    def fl(c, b):
        return np.array([[x or 0.0 for x in (((FL.get(d) or {}).get(c) or {}).get(b) or [0] * 24)] for d in days], float)
    fr['gb'] = fl('FR', 'GB') + fl('FR', 'IT') + fl('FR', 'ES') + fl('FR', 'CH')   # exogenous: Britain, Italy, Spain, Switzerland
    ext = 0
    for c in REST:
        for b in set(b for d in days for b in ((FL.get(d) or {}).get(c) or {})):
            if b not in MOD:
                ext = ext + fl(c, b)
    rest['ext'] = ext
    # France ↔ modelled neighbours, for the interconnection room
    fr['link'] = sum(fl('FR', b) for b in REST if any(b in ((FL.get(d) or {}).get('FR') or {}) for d in days))
    fr['avail'] = np.repeat(daily('fr_nuc_avail', days)[:, None], 24, 1)
    J = jao(y)
    fr['jmax'] = np.array([J.get(d, {}).get('maxFR') or [np.nan] * 24 for d in days], float)
    fr['jmin'] = np.array([J.get(d, {}).get('minFR') or [np.nan] * 24 for d in days], float)
    month = np.array([int(d[5:7]) for d in days])
    return dict(y=y, days=days, month=month, fr=fr, rest=rest, price=np.array([P[d] for d in days]), de=de_prices(y, days))

# ── costs ────────────────────────────────────────────────────────────────────
def costs(days):
    ttf = daily('ttf', days); eua = daily('eua', days); usd = daily('eurusd', days)
    s = series()['coal']; last = None; cu = []
    wb = coal_monthly()
    for d in days:
        last = s.get(d, last)
        # before the SEFE quotes (2022): the World Bank's monthly South African coal (data/history/coal_monthly.json)
        cu.append(last if last is not None else wb.get(d[:7], 70.0))
    coal = np.array(cu, float) / usd / 6.98                                        # €/MWh thermal (25.1 GJ/t)
    brent = daily('brent', days) / usd / 1.7
    return dict(ttf=ttf, eua=eua, coal=coal, oil=brent)

_WB = None
def coal_monthly():
    global _WB
    if _WB is None:
        f = f'{ROOT}/data/history/coal_monthly.json'
        _WB = json.load(open(f))['months'] if os.path.exists(f) else {}
    return _WB

GAS_TIERS = ((0.25, 0.58), (0.30, 0.54), (0.25, 0.48), (0.20, 0.38))
COAL_TIERS = ((0.5, 0.43), (0.5, 0.37))
LIG_TIERS = ((0.5, 0.40), (0.5, 0.35))

def thermal_blocks(cst, caps, avail=0.9):
    """[(MW per day, € per day)] for the thermal fleet of one zone"""
    out = []
    for share, eta in GAS_TIERS:
        out.append((caps['gas'] * share * avail, (cst['ttf'] + 0.202 * cst['eua']) / eta + 3))
    for share, eta in COAL_TIERS:
        out.append((caps['coal'] * share * avail, (cst['coal'] + 0.341 * cst['eua']) / eta + 4))
    for share, eta in LIG_TIERS:
        out.append((caps['lignite'] * share * avail, (4.0 + 0.40 * cst['eua']) / eta + 4))
    out.append((caps['oil'] * avail, (cst['oil'] + 0.28 * cst['eua']) / 0.35 + 5))
    return out

# ── dispatch helpers ─────────────────────────────────────────────────────────
def hydro_shave(nd, energy_week, pmax, week):
    """reservoir output: peak-shaving of net demand within each week, total = the week's energy"""
    H = np.zeros_like(nd)
    for w in np.unique(week):
        k = week == w
        E = energy_week[w]
        if E <= 0:
            continue
        x = nd[k]
        lo, hi = x.min() - pmax, x.max()
        for _ in range(50):
            th = (lo + hi) / 2
            if np.clip(x - th, 0, pmax).sum() > E:
                lo = th
            else:
                hi = th
        H[k] = np.clip(x - th, 0, pmax)
    return H

def storage(nd, P, hours, eta=0.78):
    """daily arbitrage: charge at the lowest net-demand hours, give back η × that at the highest"""
    if P <= 0:
        return np.zeros_like(nd)
    out = np.zeros_like(nd)
    for i in range(nd.shape[0]):
        x = nd[i]; o = np.argsort(x)
        lo, hi = o[:hours], o[::-1][:hours]
        if x[hi].mean() - x[lo].mean() <= 0:
            continue
        out[i, lo] -= P
        out[i, hi] += P * eta
    return out

# ── clearing ─────────────────────────────────────────────────────────────────
def supply(inflex, blocks, spreads, H, D):
    """net position on the price grid: hours × grid (MW)"""
    S = np.repeat(inflex.reshape(-1, 1), len(GRID), 1)
    for cap, bid in blocks:   # cap, bid: hours arrays
        S += cap.reshape(-1, 1) * (bid.reshape(-1, 1) <= GRID[None, :])
    for cap, a, b in spreads:
        S += cap.reshape(-1, 1) * np.clip((GRID[None, :] - a.reshape(-1, 1)) / np.maximum(b - a, 1e-6).reshape(-1, 1), 0, 1)
    return S - D.reshape(-1, 1)

def first_at_least(N, level):
    """price index where the net position first reaches level (hours,) → grid price"""
    ok = N >= level.reshape(-1, 1)
    idx = np.where(ok.any(1), ok.argmax(1), len(GRID) - 1)
    return GRID[idx], idx

def clear(Nf, Nr, xmax, imax):
    p, i = first_at_least(Nf + Nr, np.zeros(Nf.shape[0]))
    f = Nf[np.arange(len(i)), i]
    pf = p.copy()
    ex = f > xmax
    if ex.any():
        pf[ex] = first_at_least(Nf[ex], xmax[ex])[0]
    im = f < -imax
    if im.any():
        pf[im] = first_at_least(Nf[im], -imax[im])[0]
    return pf, p

# ── the model ────────────────────────────────────────────────────────────────
def prev_params(Yp):
    """what the year before shows (known when pricing): must-run thermal, nuclear minimum, interconnection room"""
    m = Yp['month']; fr, rs = Yp['fr'], Yp['rest']
    mp = lambda a, q: np.array([np.percentile(a[m == k], q) if (m == k).any() else np.percentile(a, q) for k in range(1, 13)])
    ratio = fr['nuclear'] / np.maximum(fr['avail'], 1)
    link = fr['link']
    return dict(fr_gas=mp(fr['gas'], 5), fr_coal=mp(fr['coal'], 5), r_gas=mp(rs['gas'], 5), r_coal=mp(rs['coal'], 5), r_lig=mp(rs['lignite'], 5),
                neg5=float(np.percentile(Yp['price'][Yp['price'] <= 0], 5)) if (Yp['price'] <= 0).sum() > 20 else -10.0, kmin=mp(ratio, 2), xmax=float(np.percentile(-link, 99)), imax=float(np.percentile(link, 99)), **eff_room(Yp), **nuc_curve(Yp), **th_curve(Yp), **th_curves_season(Yp), mrtod=mr_tod(Yp))

def nuc_curve(Yp):
    """France's nuclear offer, from last year: in the hours France's price was its own (cheaper than Germany's), the price
    ÷ that day's CCGT cost at each use of the available fleet (output ÷ available, bins of 0.02), made non-decreasing"""
    cst = costs(Yp['days']); cc = np.repeat(((cst['ttf'] + 0.202 * cst['eua']) / 0.54 + 3)[:, None], 24, 1)
    P, DE = Yp['price'], Yp['de']; u = Yp['fr']['nuclear'] / np.maximum(Yp['fr']['avail'], 1)
    ok = np.isfinite(DE) & (P < DE - 5)
    if ok.sum() < 200:
        ok = np.isfinite(P)
    edges = np.arange(0.4, 1.06, 0.02); mid = (edges[:-1] + edges[1:]) / 2; r = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        k = ok & (u >= lo) & (u < hi)
        r.append(np.median(P[k] / cc[k]) if k.sum() >= 20 else np.nan)
    r = np.array(r); f = np.isfinite(r)
    r = np.interp(mid, mid[f], r[f]) if f.any() else np.full(len(mid), 0.3)
    return dict(nc_u=mid, nc_r=np.maximum.accumulate(r))

def th_curve(Yp, sel=None):
    """the central-western thermal offer, from last year: Germany's price ÷ CCGT cost at each use of the thermal fleet
    (lignite + coal + gas + oil output ÷ capacity, bins of 0.02), non-decreasing"""
    y = Yp['y']; rs = Yp['rest']
    cap = sum(M_cap(c, t, y) for c in REST for t in ('Fossil gas', 'Fossil hard coal', 'Fossil brown coal / lignite', 'Fossil oil')) * 1000
    cst = costs(Yp['days']); cc = np.repeat(((cst['ttf'] + 0.202 * cst['eua']) / 0.54 + 3)[:, None], 24, 1)
    u = (rs['gas'] + rs['coal'] + rs['lignite'] + rs['oil']) / cap; DE = Yp['de']; ok = np.isfinite(DE)
    if sel is not None:
        ok = ok & sel
    edges = np.arange(0.0, 1.02, 0.02); mid = (edges[:-1] + edges[1:]) / 2; r = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        k = ok & (u >= lo) & (u < hi)
        r.append(np.median(DE[k] / cc[k]) if k.sum() >= 20 else np.nan)
    r = np.array(r); f = np.isfinite(r)
    r = np.interp(mid, mid[f], r[f])
    # above the highest use seen: the last ratio rises to 2 × at full use (scarcity), straight line
    top = mid[f].max()
    r = np.where(mid > top, r[f][-1] + (2.0 - r[f][-1]) * (mid - top) / max(1 - top, 1e-6), r)
    return dict(tc_u=mid, tc_r=np.maximum.accumulate(r), tc_cap=cap)

def stack_cost(cst, y, mids):
    """the cost-based marginal cost of the central-western thermal fleet at each use (days × bins): lignite, coal, gas
    tiers, oil sorted by each day's cost"""
    caps = {k: sum(capacity(c, t, y) for c in REST) for k, t in (('gas', 'Fossil gas'), ('coal', 'Fossil hard coal'), ('lignite', 'Fossil brown coal / lignite'), ('oil', 'Fossil oil'))}
    tiers = thermal_blocks(cst, caps, avail=1.0)          # [(GW, € per day)]
    tot = sum(c for c, _ in tiers)
    caps_ = np.array([c / tot for c, _ in tiers]); costs_ = np.array([b for _, b in tiers])   # tiers × days
    out = np.zeros((costs_.shape[1], len(mids)))
    for d in range(costs_.shape[1]):
        o = np.argsort(costs_[:, d]); cum = np.cumsum(caps_[o])
        idx = np.searchsorted(cum, np.clip(mids, 0, 0.999))
        out[d] = costs_[o, d][np.minimum(idx, len(o) - 1)]
    return out

def th_markup(Yp, sel):
    """Germany's price ÷ the cost-based marginal cost at the observed use (bins of 0.02), non-decreasing"""
    y = Yp['y']; rs = Yp['rest']
    cap = sum(capacity(c, t, y) for c in REST for t in ('Fossil gas', 'Fossil hard coal', 'Fossil brown coal / lignite', 'Fossil oil')) * 1000
    u = (rs['gas'] + rs['coal'] + rs['lignite'] + rs['oil']) / cap; DE = Yp['de']
    edges = np.arange(0.0, 1.02, 0.02); mid = (edges[:-1] + edges[1:]) / 2
    sc = stack_cost(costs(Yp['days']), y, mid)                     # days × bins
    b = np.clip((u / 0.02).astype(int), 0, len(mid) - 1)
    mc = np.take_along_axis(np.repeat(sc[:, None, :], 24, 1), b[..., None], 2)[..., 0]
    ok = np.isfinite(DE) & sel; r = []
    for i in range(len(mid)):
        k = ok & (b == i)
        r.append(np.median(DE[k] / mc[k]) if k.sum() >= 20 else np.nan)
    r = np.array(r); f = np.isfinite(r)
    r = np.interp(mid, mid[f], r[f]) if f.any() else np.ones(len(mid))
    top = mid[f].max() if f.any() else 1.0
    r = np.where(mid > top, r[f][-1] + (1.5 - r[f][-1]) * (mid - top) / max(1 - top, 1e-6), r) if f.any() else r
    return np.maximum.accumulate(r)

TOD = ((0, 9), (9, 17), (17, 24))   # night, day, evening


def th_curves_season(Yp):
    w = np.isin(Yp['month'], (1, 2, 3, 10, 11, 12))[:, None] * np.ones((1, 24), bool)
    hh = np.ones((len(Yp['days']), 1)) * np.arange(24)[None, :]
    tod = {}
    for si, se in ((0, w), (1, ~w)):
        for ti, (a, b) in enumerate(TOD):
            sel = se & (hh >= a) & (hh < b)
            tod[(si, ti)] = th_curve(Yp, sel)['tc_r'] if sel.sum() > 500 else th_curve(Yp, se)['tc_r']
    return dict(tc_w=th_curve(Yp, w)['tc_r'], tc_s=th_curve(Yp, ~w)['tc_r'], mk_w=th_markup(Yp, w), mk_s=th_markup(Yp, ~w), tc_tod=tod)

def M_cap(c, t, y):
    return capacity(c, t, y)

def mr_tod(Yp, q=10):
    """the neighbours' thermal output that always ran: by month and time of day, its q-th percentile (MW)"""
    rs = Yp['rest']; T = rs['gas'] + rs['coal'] + rs['lignite'] + rs['oil']; m = Yp['month']
    out = np.zeros((12, 3))
    for k in range(1, 13):
        for ti, (a, b) in enumerate(TOD):
            x = T[m == k][:, a:b]
            out[k - 1, ti] = np.percentile(x, q) if x.size else np.percentile(T, q)
    return out


def eff_room(Yp):
    """the export (import) level at which France's price leaves Germany's, median over the hours it did (last year)"""
    P, DE, link = Yp['price'], Yp['de'], Yp['fr']['link']; ok = np.isfinite(DE)
    lo, hi = ok & (P < DE - 5), ok & (P > DE + 5)
    m = Yp['month'][:, None] * np.ones((1, 24), int); ex = -link
    allm = float(np.median(ex[lo])) if lo.sum() > 50 else float(np.percentile(ex, 90))
    xm = np.array([float(np.median(ex[lo & (m == k)])) if (lo & (m == k)).sum() > 30 else allm for k in range(1, 13)])
    # the CWE solar effect on the room at cut-off (flow-based: German midday solar takes room on the lines)
    if lo.sum() > 200:
        sol = Yp['rest']['solar'][lo] / 1e3; X = np.column_stack([np.ones(lo.sum()), sol, (m[lo] >= 4) & (m[lo] <= 9)])
        bs = float(np.linalg.lstsq(X, ex[lo] / 1e3, rcond=None)[0][1]); sm = float(sol.mean())
    else:
        bs, sm = 0.0, 0.0
    J = Yp['fr'].get('jmax'); okj = lo & np.isfinite(J) if J is not None else None
    jk = float(np.median(ex[okj] / J[okj])) if okj is not None and okj.sum() > 200 else None
    return dict(jk=jk, xm=xm, xsol=bs, xsolm=sm, xeff=allm if lo.sum() > 50 else float(np.percentile(-link, 90)),
                ieff=float(np.median(link[hi])) if hi.sum() > 50 else float(np.percentile(link, 90)))

def merge(Ya, Yb):
    """two years as one (for curves learnt on both)"""
    out = dict(y=Yb['y'], days=Ya['days'] + Yb['days'], month=np.concatenate([Ya['month'], Yb['month']]),
               price=np.concatenate([Ya['price'], Yb['price']]), de=np.concatenate([Ya['de'], Yb['de']]))
    for z in ('fr', 'rest'):
        out[z] = {k: np.concatenate([Ya[z][k], Yb[z][k]]) for k in Ya[z] if k in Yb[z]}
    return out

def kmin_all(Ys, y):
    """the nuclear minimum (output ÷ available, monthly 2nd percentile) over every complete year before y"""
    ks = []
    for yy in Ys:
        if yy < y and yy != 2022:
            Yp = Ys[yy]; m = Yp['month']; ratio = Yp['fr']['nuclear'] / np.maximum(Yp['fr']['avail'], 1)
            ks.append([np.percentile(ratio[m == k], 2) if (m == k).any() else np.percentile(ratio, 2) for k in range(1, 13)])
    return np.min(np.array(ks), axis=0) if ks else None

def run(Yd, pp, prm):
    y = Yd['y']; days = Yd['days']; m = Yd['month']; mi = m - 1
    nD = len(days); H24 = lambda a: np.repeat(np.asarray(a, float).reshape(-1, 1), 24, 1)
    cst = costs(days); fr, rs = Yd['fr'], Yd['rest']
    ccgt = H24((cst['ttf'] + 0.202 * cst['eua']) / 0.54 + 3)
    week = np.repeat(np.array([date.fromisoformat(d).isocalendar()[1] + 100 * (date.fromisoformat(d).month == 12 and date.fromisoformat(d).isocalendar()[1] == 1) for d in days])[:, None], 24, 1)
    # France
    vre_f = fr['solar'] + fr['wind']; rF = prm['rF']
    nmin = pp['kmin'][mi][:, None] * fr['avail']
    nd_f = fr['load'] - fr['gb'] - fr['hydroRoR'] - fr['bio'] - vre_f
    wk_e = {w: fr['hydroLake'][week == w].sum() for w in np.unique(week)}
    Hf = hydro_shave(nd_f, wk_e, capacity('FR', 'Hydro water reservoir', y) * 1000, week)
    Sf = storage(nd_f - Hf, capacity('FR', 'Hydro pumped storage', y) * 1000 * prm.get('ps_fr', prm['ps_use']), 6)
    gmr_f, cmr_f = pp['fr_gas'][mi][:, None] * np.ones((1, 24)), pp['fr_coal'][mi][:, None] * np.ones((1, 24))
    infl_f = fr['hydroRoR'] + fr['bio'] + nmin + gmr_f + cmr_f + (0 if prm.get('neg_obs') else (1 - rF) * vre_f)
    capf = {'gas': capacity('FR', 'Fossil gas', y) * 1000, 'coal': capacity('FR', 'Fossil hard coal', y) * 1000, 'lignite': 0.0, 'oil': capacity('FR', 'Fossil oil', y) * 1000}
    blocks_f = []
    for cap, bid in thermal_blocks(cst, capf):
        blocks_f.append((np.full((nD, 24), cap).ravel(), H24(bid).ravel()))
    # the must-run part comes off the cheapest gas / coal blocks (approximation: off the total)
    blocks_f[0] = (np.maximum(blocks_f[0][0] - gmr_f.ravel(), 0), blocks_f[0][1])
    if prm.get('nuc_curve'):
        # the nuclear offer as last year's curve: between the minimum and the available capacity, in bins of use
        A = fr['avail']; du = 0.02
        for u0, rr in zip(pp['nc_u'], pp['nc_r']):
            cap = np.clip(np.minimum(A * (u0 + du / 2), A) - np.maximum(A * (u0 - du / 2), nmin), 0, None)
            blocks_f.append((cap.ravel(), (rr * ccgt).ravel()))
    if prm.get('neg_obs'):
        spreads_f_extra = [(((1 - rF) * vre_f).ravel(), np.full(nD * 24, pp['neg5']), np.full(nD * 24, -0.5))]
    else:
        spreads_f_extra = []
    rb = prm.get('resp_bid', (-10.0, 0.0))
    spreads_f = spreads_f_extra + [((rF * vre_f).ravel(), np.full(nD * 24, rb[0]), np.full(nD * 24, rb[1])),
                 ] + ([] if prm.get('nuc_curve') else [((fr['avail'] - nmin).clip(0).ravel(), *((np.full(nD * 24, prm['b_lo']), np.full(nD * 24, prm['b_hi'])) if prm.get('nuc_eur') else ((prm['b_lo'] * ccgt).ravel(), (prm['b_hi'] * ccgt).ravel())))])
    Df = (fr['load'] - fr['gb'] - Hf - Sf).ravel()
    Nf = supply(infl_f.ravel(), blocks_f, spreads_f, None, Df)
    # rest zone
    vre_r = rs['solar'] + rs['wind']; rR = prm['rR']
    nd_r = rs['load'] - rs['ext'] - rs['mr'] - rs['nuclear'] - vre_r
    wk_r = {w: rs['lake'][week == w].sum() for w in np.unique(week)}
    Hr = hydro_shave(nd_r, wk_r, sum(capacity(c, 'Hydro water reservoir', y) for c in REST) * 1000, week)
    ps_r = sum(capacity(c, 'Hydro pumped storage', y) for c in REST) * 1000 * prm['ps_use']
    Sr = storage(nd_r - Hr, ps_r, 6) + storage(nd_r - Hr, capacity('DE', 'Battery storage (power)', y) * 1000 * prm['ps_use'], 2)
    gmr_r, cmr_r, lmr_r = (pp[k][mi][:, None] * np.ones((1, 24)) for k in ('r_gas', 'r_coal', 'r_lig'))
    infl_r = rs['mr'] + rs['nuclear'] + gmr_r + cmr_r + lmr_r + (0 if prm.get('neg_obs') else (1 - rR) * vre_r)
    capr = {k: sum(capacity(c, t, y) for c in REST) * 1000 for k, t in (('gas', 'Fossil gas'), ('coal', 'Fossil hard coal'), ('lignite', 'Fossil brown coal / lignite'), ('oil', 'Fossil oil'))}
    blocks_r = []
    for cap, bid in thermal_blocks(cst, capr):
        blocks_r.append((np.full((nD, 24), cap).ravel(), H24(bid).ravel()))
    blocks_r[0] = (np.maximum(blocks_r[0][0] - gmr_r.ravel(), 0), blocks_r[0][1])
    blocks_r[4] = (np.maximum(blocks_r[4][0] - cmr_r.ravel(), 0), blocks_r[4][1])
    blocks_r[6] = (np.maximum(blocks_r[6][0] - lmr_r.ravel(), 0), blocks_r[6][1])
    if prm.get('th_curve'):
        # the thermal fleet as last year's offer curve (from zero use: its must-run part is in the curve's low end)
        infl_r = rs['mr'] + rs['nuclear'] + (0 if prm.get('neg_obs') else (1 - rR) * vre_r)
        capT = sum(capacity(c, t, y) for c in REST for t in ('Fossil gas', 'Fossil hard coal', 'Fossil brown coal / lignite', 'Fossil oil')) * 1000
        if prm.get('th_tod'):
            # the offer curve by season and time of day: units started for the evening run through midday and offer
            # low then (commitment), which one yearly curve mixed up with the nights
            win = np.isin(m, (1, 2, 3, 10, 11, 12))[:, None] * np.ones((1, 24), bool)
            hh = np.ones((nD, 1)) * np.arange(24)[None, :]
            blocks_r = []
            u_mr = np.zeros(nD * 24)
            if prm.get('mr_tod'):
                mrh = np.zeros((nD, 24))
                for ti, (a_, b_) in enumerate(TOD):
                    mrh[:, a_:b_] = pp['mrtod'][mi, ti][:, None]
                infl_r = infl_r + mrh; u_mr = (mrh / capT).ravel()
            for i in range(len(pp['tc_u'])):
                bid = np.zeros((nD, 24))
                for (si, ti), rr in pp['tc_tod'].items():
                    a_, b_ = TOD[ti]
                    sel = (win if si == 0 else ~win) & (hh >= a_) & (hh < b_)
                    bid[sel] = rr[i]
                lo_, hi_ = i * 0.02, (i + 1) * 0.02
                blocks_r.append((capT * np.clip(hi_ - np.maximum(lo_, u_mr), 0, 0.02), (bid * ccgt).ravel()))
        elif prm.get('th_markup'):
            win = np.isin(m, (1, 2, 3, 10, 11, 12))[:, None] * np.ones((1, 24), bool)
            mids = pp['tc_u']; sc = stack_cost(cst, y, mids)          # days × bins
            blocks_r = [(np.full(nD * 24, capT * 0.02), (np.where(win, pp['mk_w'][i], pp['mk_s'][i]) * sc[:, i][:, None]).ravel()) for i in range(len(mids))]
        elif prm.get('th_season'):
            win = np.isin(m, (1, 2, 3, 10, 11, 12))[:, None] * np.ones((1, 24), bool)
            if prm.get('th_mr'):
                # the thermal output that always runs (last year's monthly 5th percentile: CHP, minimum loads) is
                # inflexible; the observed offer curve applies above it, from that use on
                mr_ = (pp['r_gas'] + pp['r_coal'] + pp['r_lig'])[mi][:, None] * np.ones((1, 24))
                infl_r = infl_r + mr_
                u_mr = (mr_ / capT).ravel()
                blocks_r = []
                for i, (rw, rsu) in enumerate(zip(pp['tc_w'], pp['tc_s'])):
                    lo, hi = i * 0.02, (i + 1) * 0.02
                    cap_i = capT * np.clip(hi - np.maximum(lo, u_mr), 0, 0.02)
                    blocks_r.append((cap_i, (np.where(win, rw, rsu) * ccgt).ravel()))
            else:
                blocks_r = [(np.full(nD * 24, capT * 0.02), (np.where(win, rw, rsu) * ccgt).ravel()) for rw, rsu in zip(pp['tc_w'], pp['tc_s'])]
        else:
            blocks_r = [(np.full(nD * 24, capT * 0.02), (rr * ccgt).ravel()) for rr in pp['tc_r']]
    rb = prm.get('resp_bid', (-10.0, 0.0))
    spreads_r = [((rR * vre_r).ravel(), np.full(nD * 24, rb[0]), np.full(nD * 24, rb[1]))]
    if prm.get('neg_obs'):
        spreads_r.append((((1 - rR) * vre_r).ravel(), np.full(nD * 24, pp['neg5']), np.full(nD * 24, -0.5)))
    Dr = (rs['load'] - rs['ext'] - Hr - Sr).ravel()
    Nr = supply(infl_r.ravel(), blocks_r, spreads_r, None, Dr)
    xmax = np.full(nD * 24, pp['xeff'] if prm.get('eff') else pp['xmax']); imax = np.full(nD * 24, pp['ieff'] if prm.get('eff') else pp['imax'])
    if prm.get('eff') == 'jao_k':
        # the physical export at which France was cut off, as a share of JAO's commercial limit (last years' median)
        k = pp['jk'] if pp.get('jk') else 0.75
        xm = pp['xm'][mi][:, None] * np.ones((1, 24))
        xmax = np.where(np.isfinite(fr['jmax']), k * fr['jmax'], xm).ravel()
        imax = np.where(np.isfinite(fr['jmin']), -k * fr['jmin'], pp['imax']).ravel()
    elif prm.get('eff') == 'jao':
        # France's flow-based export / import limit of the hour in the Core coupling (JAO); hours without it: the month's room
        xm = pp['xm'][mi][:, None] * np.ones((1, 24))
        xmax = np.where(np.isfinite(fr['jmax']), fr['jmax'], xm).ravel()
        imax = np.where(np.isfinite(fr['jmin']), -fr['jmin'], pp['imax']).ravel()
    elif prm.get('eff') in ('month', 'msol'):
        xm = pp['xm'][mi][:, None] * np.ones((1, 24))
        if prm['eff'] == 'msol':
            xm = xm + pp['xsol'] * 1000 * (rs['solar'] / 1e3 - pp['xsolm'])
        xmax = np.maximum(xm, 1000).ravel(); imax = np.full(nD * 24, pp['imax'])
    pf, pc = clear(Nf, Nr, xmax, imax)
    if prm.get('commit') and prm.get('th_curve'):
        # unit commitment, simply: the neighbours' thermal output that the hours around still need (its minimum over
        # ± W hours of the first clearing) stays on and offers low (it would not stop for a few hours and restart);
        # the observed offer curve applies above it. Cleared again.
        W = int(prm['commit'])
        T = sum(cap.reshape(nD, 24) * (bid.reshape(nD, 24) <= pc.reshape(nD, 24)) for cap, bid in blocks_r)
        if prm.get('commit_mode') == 'peak':
            # the plants started for the day's peak run at least at their minimum stable load (≈ 40 % for gas and
            # coal units) through the day: that share of the day's highest thermal output is committed
            C = (prm.get('min_load', 0.4) * T.max(axis=1, keepdims=True) * np.ones((1, 24))).ravel()
        else:
            Tf = T.ravel(); C = np.empty_like(Tf)
            for i in range(len(Tf)):
                C[i] = Tf[max(0, i - W):i + W + 1].min()
        low = prm.get('commit_bid', 0.1) * ccgt.ravel()
        new_blocks, left = [], C.copy()
        for cap, bid in blocks_r:   # the committed MW come off the cheapest blocks first
            take = np.minimum(cap, left); left = left - take
            new_blocks.append((cap - take, bid))
        new_blocks.append((C, low))
        Nr = supply(infl_r.ravel(), new_blocks, spreads_r, None, Dr)
        pf, pc = clear(Nf, Nr, xmax, imax)
    return pf.reshape(nD, 24), pc.reshape(nD, 24)

def score(Yd, ph):
    """monthly capture errors (€/MWh), both conventions, for French solar and wind; hourly MAE"""
    P = Yd['price']; m = Yd['month']; out = {}
    for t in ('solar', 'wind'):
        v = Yd['fr'][t]; e_all = e_curt = 0.0; w_all = w_curt = 0.0
        for k in range(1, 13):
            s = m == k
            if not s.any(): continue
            base = P[s].mean(); bh = ph[s].mean()
            ca = (v[s] * P[s]).sum() / v[s].sum() / base; cp = (v[s] * ph[s]).sum() / v[s].sum() / bh
            pos, posh = P[s] > 0, ph[s] > 0
            cua = (v[s][pos] * P[s][pos]).sum() / max(v[s][pos].sum(), 1) / base
            cuh = (v[s][posh] * ph[s][posh]).sum() / max(v[s][posh].sum(), 1) / bh
            w = v[s].sum(); wp = v[s][pos].sum()
            e_all += (cp - ca) * base * w; w_all += w; e_curt += (cuh - cua) * base * wp; w_curt += wp
        out[t] = (e_all / w_all, e_curt / w_curt)
    out['mae'] = float(np.abs(ph - P).mean()); out['bias'] = float((ph - P).mean())
    # revenue per produced MWh with output stopped at ≤ 0 (no ratio, so no blow-up when a month's mean is near 0),
    # as an error relative to the year's baseload: (model − actual) ÷ actual baseload × 100 (% points of capture)
    for t in ('solar', 'wind'):
        v = Yd['fr'][t]
        out[t + '_rev'] = float(((v * np.maximum(ph, 0)).sum() - (v * np.maximum(P, 0)).sum()) / v.sum())
    return out
