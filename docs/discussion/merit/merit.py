"""Merit order for France + a 'rest' zone (DE, BE, NL, AT, CH, IT, ES), hourly, coupled through the French
interconnections. Experimental (test bench); see docs/discussion/merit-order-plan.md."""
import json, os, glob
from datetime import date
import numpy as np

ROOT = '/home/ubuntu/PowerKlock/.claude/worktrees/bridge-cse_019SBz1eD5ytFRZxqbyv9hcG'
REST = ('DE', 'BE', 'NL', 'AT', 'CH')
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

def full(c, y):
    f = f'/tmp/mo/full/{c}_{y}.json'
    return json.load(open(f)) if os.path.exists(f) else None

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
    R = {c: full(c, y) for c in REST}
    days = []
    for d in sorted(E):
        if d not in P:
            continue
        ok = True
        for c in REST:
            r = R[c]
            if not r or d not in (r.get('Load') or {}) or None in r['Load'][d]:
                ok = False; break
        if ok:
            days.append(d)
    g = lambda c, name: np.array([[x or 0.0 for x in (R[c].get(name, {}) or {}).get(d, [0] * 24)] for d in days], float)
    fr = {k: np.array([E[d][k] for d in days]) for k in E[days[0]]}
    rest = {}
    for c in REST:
        part = {'load': g(c, 'Load'), 'solar': g(c, 'Solar'), 'wind': g(c, 'Wind onshore') + g(c, 'Wind offshore'),
                'nuclear': g(c, 'Nuclear'), 'mr': g(c, 'Hydro Run-of-River') + g(c, 'Biomass') + g(c, 'Waste') + g(c, 'Geothermal') + g(c, 'Others') + g(c, 'Other renewables'),
                'lake': g(c, 'Hydro water reservoir'), 'lignite': g(c, 'Fossil brown coal / lignite'), 'coal': g(c, 'Fossil hard coal') + g(c, 'Fossil coal-derived gas'),
                'gas': g(c, 'Fossil gas'), 'oil': g(c, 'Fossil oil')}
        for k, v in part.items():
            rest[k] = rest.get(k, 0) + v
    # exogenous exchanges: France ↔ GB, and the rest zone ↔ countries outside the model (+ = import)
    def fl(c, b):
        return np.array([[x or 0.0 for x in (((FL.get(d) or {}).get(c) or {}).get(b) or [0] * 24)] for d in days], float)
    fr['gb'] = fl('FR', 'GB') + fl('FR', 'IT') + fl('FR', 'ES')   # exogenous: Britain, Italy, Spain
    ext = 0
    for c in REST:
        for b in set(b for d in days for b in ((FL.get(d) or {}).get(c) or {})):
            if b not in MOD:
                ext = ext + fl(c, b)
    rest['ext'] = ext
    # France ↔ modelled neighbours, for the interconnection room
    fr['link'] = sum(fl('FR', b) for b in REST if any(b in ((FL.get(d) or {}).get('FR') or {}) for d in days))
    fr['avail'] = np.repeat(daily('fr_nuc_avail', days)[:, None], 24, 1)
    month = np.array([int(d[5:7]) for d in days])
    return dict(y=y, days=days, month=month, fr=fr, rest=rest, price=np.array([P[d] for d in days]), de=de_prices(y, days))

# ── costs ────────────────────────────────────────────────────────────────────
def costs(days):
    ttf = daily('ttf', days); eua = daily('eua', days); usd = daily('eurusd', days)
    coal_usd = np.array([series()['coal'].get(d) for d in days], dtype=object)
    s = series()['coal']; ks = sorted(s); last = None; cu = []
    for d in days:
        last = s.get(d, last); cu.append(last if last is not None else 70.0)   # before 2022 (no quote here): 70 $/t
    coal = np.array(cu, float) / usd / 6.98                                        # €/MWh thermal (25.1 GJ/t)
    brent = daily('brent', days) / usd / 1.7
    return dict(ttf=ttf, eua=eua, coal=coal, oil=brent)

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
                kmin=mp(ratio, 2), xmax=float(np.percentile(-link, 99)), imax=float(np.percentile(link, 99)), **eff_room(Yp), **nuc_curve(Yp))

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

def eff_room(Yp):
    """the export (import) level at which France's price leaves Germany's, median over the hours it did (last year)"""
    P, DE, link = Yp['price'], Yp['de'], Yp['fr']['link']; ok = np.isfinite(DE)
    lo, hi = ok & (P < DE - 5), ok & (P > DE + 5)
    return dict(xeff=float(np.median(-link[lo])) if lo.sum() > 50 else float(np.percentile(-link, 90)),
                ieff=float(np.median(link[hi])) if hi.sum() > 50 else float(np.percentile(link, 90)))

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
    Sf = storage(nd_f - Hf, capacity('FR', 'Hydro pumped storage', y) * 1000 * prm['ps_use'], 6)
    gmr_f, cmr_f = pp['fr_gas'][mi][:, None] * np.ones((1, 24)), pp['fr_coal'][mi][:, None] * np.ones((1, 24))
    infl_f = fr['hydroRoR'] + fr['bio'] + (1 - rF) * vre_f + nmin + gmr_f + cmr_f
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
    spreads_f = [((rF * vre_f).ravel(), np.full(nD * 24, -10.0), np.zeros(nD * 24)),
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
    infl_r = rs['mr'] + rs['nuclear'] + (1 - rR) * vre_r + gmr_r + cmr_r + lmr_r
    capr = {k: sum(capacity(c, t, y) for c in REST) * 1000 for k, t in (('gas', 'Fossil gas'), ('coal', 'Fossil hard coal'), ('lignite', 'Fossil brown coal / lignite'), ('oil', 'Fossil oil'))}
    blocks_r = []
    for cap, bid in thermal_blocks(cst, capr):
        blocks_r.append((np.full((nD, 24), cap).ravel(), H24(bid).ravel()))
    blocks_r[0] = (np.maximum(blocks_r[0][0] - gmr_r.ravel(), 0), blocks_r[0][1])
    blocks_r[4] = (np.maximum(blocks_r[4][0] - cmr_r.ravel(), 0), blocks_r[4][1])
    blocks_r[6] = (np.maximum(blocks_r[6][0] - lmr_r.ravel(), 0), blocks_r[6][1])
    spreads_r = [((rR * vre_r).ravel(), np.full(nD * 24, -10.0), np.zeros(nD * 24))]
    Dr = (rs['load'] - rs['ext'] - Hr - Sr).ravel()
    Nr = supply(infl_r.ravel(), blocks_r, spreads_r, None, Dr)
    xmax = np.full(nD * 24, pp['xeff'] if prm.get('eff') else pp['xmax']); imax = np.full(nD * 24, pp['ieff'] if prm.get('eff') else pp['imax'])
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
    return out
