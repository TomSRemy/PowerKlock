#!/usr/bin/env python3
"""Price of an isolated France, hour by hour, and who gains / who loses from coupling (build_data.py, states.py first).

1. French merit order learnt from observed data. In every hour the French day-ahead price sits on France's own supply
   curve at the volume France produces: P_FR = f(RD), with RD = load + net exports − wind − solar − run-of-river −
   bioenergy (what nuclear, reservoirs, pumped storage, gas, coal and oil supply; RTE éCO2mix). This holds in coupled
   hours too (each zone's curves cross at the zone price and its net position); in cut-off hours it is all that sets
   the price. f is a gradient-boosted tree model, non-decreasing in RD and in fuel costs, non-increasing in available
   nuclear, with month, hour, weekend, wind + solar and year as context.
   Inputs: RD (GW), available nuclear (ENTSO-E), gas-plant cost (TTF ÷ 0.55 + 0.37 × EUA), coal-plant cost.
2. Physical bounds the trees cannot see, applied after them:
   - nuclear minimum: available nuclear × the lowest use seen in the year (1st percentile of output ÷ available),
     plus must-run gas (5th percentile of gas output). If RD falls below it, the surplus is curtailed (wind, solar,
     or nuclear units stopped) and the price is the year's median negative price (curtailment bids);
   - scarcity: if RD exceeds available nuclear + the year's highest reservoir + pumped-storage, gas, coal + oil
     output, the missing energy is not served and the price is the harmonised day-ahead ceiling.
3. Validation: 12-fold cross-validation by blocks of whole months; error reported on cut-off hours (France's price
   different from every coupled neighbour), where the observed price is France's own merit order at an export fixed
   by the grid limit.
4. Scenarios: 'iso' net exports = 0 (France an island); 'lim' net exports = France's Core export limit (JAO maxNetPos)
   + the hour's commercial exchanges with Spain, Italy, Switzerland and Britain (France always cut off as an exporter;
   from 2023, the first full JAO year).
5. Welfare per year (bn€), real against island, demand unchanged:
   consumers  = Σ load × (P_real − P_iso)                               (+ = coupling costs them)
   producers  = Σ [P_real × (load + NX) − P_iso × load − ∫_{RD_iso}^{RD_real} f]   (+ = coupling earns them)
   congestion rent on each border = Σ (P_neighbour − P_FR) × commercial export to it (Energy-Charts cbet, ENTSO-E
   scheduled commercial exchanges), shared between the two TSOs.
Output: model_results.json, /tmp/coupl/cf.npz."""
import json, datetime, warnings, os
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
warnings.filterwarnings('ignore')

D = dict(np.load('/tmp/coupl/hourly.npz')); g = lambda k: D[k]
days = D['days']; nd = len(days)
state = np.load('/tmp/coupl/states.npz')['state'].reshape(nd, 24, 4)
yr = np.array([int(x[:4]) for x in days])[:, None].repeat(24, 1)
mo = np.array([int(x[5:7]) for x in days])[:, None].repeat(24, 1)
wd = np.array([datetime.date.fromisoformat(x).weekday() for x in days])[:, None].repeat(24, 1)
hr = np.arange(24)[None, :].repeat(nd, 0)
L, W, S, ROR, BIO, EX = g('e_load'), g('e_wind'), g('e_solar'), g('e_hydroRoR'), g('e_bio'), g('e_exchanges')
NX = -EX                                                     # net exports, MW (éCO2mix, physical)
RD = L + NX - W - S - ROR - BIO
A = g('avail'); P = g('p_FR')
CC = g('ccgt')[:, None].repeat(24, 1); CO = g('coal')[:, None].repeat(24, 1)
ok = np.isfinite(P) & np.isfinite(RD) & np.isfinite(A) & np.isfinite(CC) & np.isfinite(CO)
st1 = state[:, :, 0]
cut = np.isin(st1, ['cut_exp', 'cut_imp', 'cut_mid'])

def X(rd):
    return np.stack([rd / 1e3, A / 1e3, CC, CO, np.sin(2 * np.pi * mo / 12), np.cos(2 * np.pi * mo / 12), hr, (wd >= 5) * 1.,
                     (W + S) / 1e3, yr * 1.], -1)
MONO = [1, -1, 1, 1, 0, 0, 0, 0, 0, 0]
hgb = lambda: HGB(max_iter=600, learning_rate=0.05, monotonic_cst=MONO, l2_regularization=1.0, random_state=0)

# ── physical bounds, per year ────────────────────────────────────────────────
B = {}
for y in range(2020, 2027):
    m = (yr == y) & ok
    neg = m & (P < 0)
    B[y] = dict(kmin=float(np.nanpercentile((g('e_nuclear') / A)[m], 1)), gas_mr=float(np.nanpercentile(g('e_gas')[m], 5)),
                floor=float(np.nanmedian(P[neg])) if neg.sum() > 20 else 0.0,
                floor_deep=float(np.nanpercentile(P[neg], 10)) if neg.sum() > 20 else 0.0,
                flex=float(np.nanmax((g('e_hydroLake') + g('e_hydroPS'))[m]) + np.nanmax(g('e_gas')[m]) + np.nanmax((g('e_coal') + g('e_oil'))[m])))
def cap_price(day):
    # harmonised maximum clearing price of the single day-ahead coupling: 3 000 €/MWh, 4 000 from 10 May 2022
    return 3000.0 if day < '2022-05-10' else 4000.0
CAP = np.array([cap_price(d) for d in days])[:, None].repeat(24, 1)
KMIN = np.vectorize(lambda y: B[y]['kmin'])(yr); GMR = np.vectorize(lambda y: B[y]['gas_mr'])(yr)
FLOOR = np.vectorize(lambda y: B[y]['floor'])(yr); FLEX = np.vectorize(lambda y: B[y]['flex'])(yr)
LOW = KMIN * A + GMR                                          # lowest the dispatchable fleet can go without curtailing
HIGH = A + FLEX                                               # most it can give

def bounded(f, rd, floor=None):
    p = np.where(rd < LOW, FLOOR if floor is None else floor, f)
    return np.where(rd > HIGH, CAP, p)

# ── validation: block cross-validation by months ─────────────────────────────
fold = ((yr - 2020) * 12 + mo - 1) % 12
Xr = X(RD); cv = np.full(P.shape, np.nan)
for k in range(12):
    tr, te = ok & (fold != k), ok & (fold == k)
    cv[te] = hgb().fit(Xr[tr], P[tr]).predict(Xr[te])
val = {}
for y in range(2020, 2027):
    r = {}
    for name, sel in (('all', ok & (yr == y)), ('cut', ok & (yr == y) & cut), ('cut_exp', ok & (yr == y) & (st1 == 'cut_exp')),
                      ('coupled', ok & (yr == y) & ~cut)):
        e = cv[sel] - P[sel]
        r[name] = dict(n=int(sel.sum()), mae=round(float(np.mean(np.abs(e))), 1) if sel.any() else None,
                       bias=round(float(np.mean(e)), 1) if sel.any() else None,
                       real=round(float(np.mean(P[sel])), 1) if sel.any() else None)
    val[y] = r
    print('validation', y, {k: (v['n'], v['mae'], v['bias']) for k, v in r.items()})

# ── final model, scenarios ───────────────────────────────────────────────────
VARIANT = os.environ.get('PK_TRAIN', 'all')            # 'cut': learn only on cut-off hours (robustness)
model = hgb().fit(Xr[ok & (cut if VARIANT == 'cut' else True)], P[ok & (cut if VARIANT == 'cut' else True)])
f = lambda rd: model.predict(X(rd).reshape(-1, 10)).reshape(rd.shape)
f_real = f(RD)
RD_iso = RD - NX
p_iso_raw = f(RD_iso)
p_iso = bounded(p_iso_raw, RD_iso)
p_iso_deep = bounded(p_iso_raw, RD_iso, np.vectorize(lambda y: B[y]['floor_deep'])(yr))
p_iso_delta = bounded(P + p_iso_raw - f_real, RD_iso)        # sensitivity: keep the hour's own residual
curtail = np.maximum(LOW - RD_iso, 0)                       # MW to curtail in the island
ens = np.maximum(RD_iso - HIGH, 0)                          # MW not served in the island
# exports at the limit
comm = {b: g(f'comm_{b}') for b in ('BE', 'DE', 'ES', 'IT', 'CH', 'GB')}
noncore_x = -(comm['ES'] + comm['IT'] + comm['CH'] + comm['GB'])
NX_lim = g('jmax') + noncore_x
RD_lim = RD - NX + NX_lim
p_lim = bounded(f(RD_lim), RD_lim)
lim_ok = np.isfinite(NX_lim) & (yr >= 2023)

# lowest dispatchable volume seen in each month (support of the data)
mi = (yr - 2020) * 12 + mo - 1
RDMIN = np.full(P.shape, np.nan)
for k in np.unique(mi):
    RDMIN[mi == k] = np.nanmin(np.where(ok, RD, np.nan)[mi == k])

# area under the modelled curve between the island volume and the real volume (cost of producing the exports)
K = 8
area = np.zeros(P.shape)
prev = p_iso
for k in range(1, K + 1):
    q = RD_iso + (RD - RD_iso) * k / K
    cur = bounded(f(q), q)
    area += (prev + cur) / 2 * (RD - RD_iso) / K
    prev = cur

np.savez_compressed('/tmp/coupl/cf.npz' if VARIANT == 'all' else f'/tmp/coupl/cf_{VARIANT}.npz', p_iso=p_iso, p_iso_deep=p_iso_deep, p_iso_delta=p_iso_delta, p_lim=p_lim, f_real=f_real, cv=cv,
                    curtail=curtail, ens=ens, area=area, NX=NX, NX_lim=NX_lim, RD=RD, RD_iso=RD_iso, LOW=LOW, HIGH=HIGH)

# ── welfare per year ─────────────────────────────────────────────────────────
Q = dict(np.load('/tmp/coupl/qh.npz'))
PQ = {b: Q[f'p_{z}'] for b, z in (('FR', 'FR'), ('BE', 'BE'), ('DE', 'DE_LU'), ('ES', 'ES'), ('IT', 'IT_NORD'), ('CH', 'CH'), ('GB', 'GB'))}
yq = yr.repeat(4, 1)
out = {'bounds': B, 'validation': val, 'years': {}}
bn = 1e9
for y in range(2020, 2027):
    m = ok & (yr == y)
    c_cons = np.sum(L[m] * (P[m] - p_iso[m])) / bn
    c_cons_deep = np.sum(L[m] * (P[m] - p_iso_deep[m])) / bn
    c_cons_delta = np.sum(L[m] * (P[m] - p_iso_delta[m])) / bn
    prod = np.sum(P[m] * (L[m] + NX[m]) - p_iso[m] * L[m] - area[m]) / bn
    exp_rev = np.sum(NX[m] * P[m]) / bn
    rent = {}
    for b in ('BE', 'DE', 'ES', 'IT', 'CH', 'GB'):
        e = -Q[f'comm_{b}']                                   # commercial export from France to b, MW, per quarter-hour
        v = (yq == y) & np.isfinite(e) & np.isfinite(PQ[b]) & np.isfinite(PQ['FR'])
        rent[b] = dict(total=round(float(np.sum((PQ[b][v] - PQ['FR'][v]) * e[v]) / 4 / bn), 3),
                       export_twh=round(float(np.sum(e[v]) / 4 / 1e6), 1),
                       value_at_nb=round(float(np.sum(PQ[b][v] * e[v]) / 4 / bn), 2),
                       coverage=round(float(v.sum() / max(((yq == y) & np.isfinite(PQ['FR'])).sum(), 1)), 3))
    rent_tot = sum(r['total'] for r in rent.values())
    out['years'][y] = dict(
        hours=int(m.sum()),
        price_real=round(float(np.mean(P[m])), 1), price_iso=round(float(np.mean(p_iso[m])), 1),
        price_iso_deep=round(float(np.mean(p_iso_deep[m])), 1), price_iso_delta=round(float(np.mean(p_iso_delta[m])), 1),
        price_real_loadw=round(float(np.sum(P[m] * L[m]) / np.sum(L[m])), 1), price_iso_loadw=round(float(np.sum(p_iso[m] * L[m]) / np.sum(L[m])), 1),
        price_iso_no_ens=round(float(np.mean(p_iso[m & (ens == 0)])), 1),
        consumers_bn_no_ens=round(float(np.sum((L * (P - p_iso))[m & (ens == 0)]) / bn), 2),
        producers_bn_no_ens=round(float(np.sum((P * (L + NX) - p_iso * L - area)[m & (ens == 0)]) / bn), 2),
        ens_value_bn=round(float(np.sum((L * p_iso)[m & (ens > 0)]) / bn), 2),
        # where France is cut off as an exporter, does it export its whole Core limit? (exports ÷ limit)
        cut_exp_nx_over_lim=round(float(np.nanmedian((NX / NX_lim)[m & (st1 == 'cut_exp') & lim_ok])), 2) if (m & (st1 == 'cut_exp') & lim_ok).any() else None,
        # share of island hours below the lowest dispatchable volume seen in the same month (outside the data)
        out_of_support=round(float(np.mean((RD_iso < RDMIN)[m])), 3),
        gap_exporting=round(float(np.mean((P - p_iso)[m & (NX > 0)])), 1), gap_importing=round(float(np.mean((P - p_iso)[m & (NX <= 0)])), 1) if (m & (NX <= 0)).any() else None,
        share_iso_below=round(float(np.mean(p_iso[m] < P[m])), 3),
        nx_twh=round(float(np.sum(NX[m]) / 1e6), 1), load_twh=round(float(np.sum(L[m]) / 1e6), 1),
        export_hours=int((m & (NX > 0)).sum()),
        curtail_twh=round(float(np.sum(curtail[m]) / 1e6), 1), curtail_hours=int((m & (curtail > 0)).sum()),
        ens_twh=round(float(np.sum(ens[m]) / 1e6), 2), ens_hours=int((m & (ens > 0)).sum()),
        consumers_bn=round(c_cons, 2), consumers_bn_deepfloor=round(c_cons_deep, 2), consumers_bn_delta=round(c_cons_delta, 2),
        producers_bn=round(prod, 2), export_revenue_bn=round(exp_rev, 2),
        rent=rent, rent_total_bn=round(rent_tot, 2),
        # France's welfare gain from trade: producers − consumers' extra cost + half the rent on its borders
        france_net_bn=round(prod - c_cons + rent_tot / 2, 2),
        by_state={s: dict(hours=int((m & (st1 == s)).sum()), real=round(float(np.mean(P[m & (st1 == s)])), 1) if (m & (st1 == s)).any() else None,
                          iso=round(float(np.mean(p_iso[m & (st1 == s)])), 1) if (m & (st1 == s)).any() else None,
                          nx_gw=round(float(np.mean(NX[m & (st1 == s)]) / 1e3), 1) if (m & (st1 == s)).any() else None,
                          cons_bn=round(float(np.sum((L * (P - p_iso))[m & (st1 == s)]) / bn), 2))
                  for s in ('core', 'partial', 'cut_exp', 'cut_mid', 'cut_imp')})
    r = out['years'][y]
    print(y, 'real %.1f iso %.1f (deep %.1f, delta %.1f) cutexp nx/lim %s | cons %+.2f prod %+.2f rent %.2f net %+.2f | NX %.1f TWh exp rev %.2f | curtail %.1f TWh ens %.2f TWh (%d h)'
          % (r['price_real'], r['price_iso'], r['price_iso_deep'], r['price_iso_delta'], r['cut_exp_nx_over_lim'], r['consumers_bn'], r['producers_bn'],
             r['rent_total_bn'], r['france_net_bn'], r['nx_twh'], r['export_revenue_bn'], r['curtail_twh'], r['ens_twh'], r['ens_hours']))
# validation by depth of surplus: cut-off hours split by RD ÷ available nuclear
vb = {}
u = RD / A
for lo, hi in ((0, .6), (.6, .7), (.7, .8), (.8, .9), (.9, 1.0), (1.0, 9)):
    sel = ok & cut & (u >= lo) & (u < hi) & (yr >= 2023)
    if sel.any():
        e = cv[sel] - P[sel]
        vb[f'{lo}-{hi}'] = dict(n=int(sel.sum()), mae=round(float(np.mean(np.abs(e))), 1), bias=round(float(np.mean(e)), 1), real=round(float(np.mean(P[sel])), 1))
out['validation_by_depth'] = vb
print('validation by depth', vb)
# island volume ÷ available nuclear, share of hours per band (where the island sits)
out['iso_depth'] = {y: {f'{lo}-{hi}': round(float(np.mean(((RD_iso / A) >= lo) & ((RD_iso / A) < hi) & ok & (yr == y)) / np.mean(ok & (yr == y))), 3)
                        for lo, hi in ((-9, .6), (.6, .7), (.7, .8), (.8, .9), (.9, 1.0), (1.0, 9))} for y in range(2020, 2027)}
# monthly means for the charts
ms = sorted(set(zip(yr[:, 0], mo[:, 0])))
out['monthly'] = [dict(m=f'{a}-{b:02d}', real=round(float(np.mean(P[ok & (yr == a) & (mo == b)])), 1), iso=round(float(np.mean(p_iso[ok & (yr == a) & (mo == b)])), 1),
                       de=round(float(np.nanmean(g('p_DE_LU')[ok & (yr == a) & (mo == b)])), 1), nx=round(float(np.mean(NX[ok & (yr == a) & (mo == b)]) / 1e3), 2))
                  for a, b in ms if (ok & (yr == a) & (mo == b)).any()]
json.dump(out, open('model_results.json' if VARIANT == 'all' else f'/tmp/coupl/model_results_{VARIANT}.json', 'w'), indent=1, default=float)
