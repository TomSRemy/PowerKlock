"""France weekly dispatch LP with learned costs (prototype). Price = dual of the balance."""
import sys, warnings, numpy as np
from scipy.optimize import linprog
from scipy.sparse import lil_matrix, csr_matrix
sys.path.insert(0, 'scripts'); _a, sys.argv = sys.argv, ['x']; warnings.simplefilter('ignore')
import ppa_lab as L, ppa_scenarios as G
sys.argv = _a

def year_inputs(y):
    a = L.DATA[y]; D = len(a['days'])
    F = G.fuel_cost()
    c = np.array([F.get(str(d)[:10], np.nan) for d in a['days']]); c = np.where(np.isfinite(c), c, np.nanmean(c))
    hd = G.hydro_daily(y)
    ror = np.repeat(np.asarray(hd['FR'], float)[:, None], 24, 1) if hd is not None else np.full((D, 24), 5000.)
    return dict(L=a['fr_l'].astype(float), S=np.nan_to_num(a['fr_s']).astype(float), W=np.nan_to_num(a['fr_w']).astype(float),
                A=G.fr_avail(y).astype(float), ROR=ror, PZ=G.de_prices(y), X=G.fr_jmax(y).astype(float), C=np.repeat(c[:, None], 24, 1),
                P=a['fr_p'].astype(float), month=a['month'], days=a['days'])

# parameters (MW, €/MWh): theta
P0 = dict(kappa=5.0,     # RES output stops below −kappa
          mfrac=0.62,    # nuclear minimum = mfrac × available
          ufrac=0.85,    # top tranche above ufrac × available
          ctop=25.0,     # price under which the top tranche modulates
          cbot=5.0,      # deep modulation
          kramp=4.0,     # € per MW of nuclear change (each direction)
          must=4000.,    # other must-run (bio, CHP, …) at −kappa
          hyd_cap=9000., hyd_e=0.35,   # reservoirs: capacity, weekly energy = hyd_e × cap × 168
          pump=4500., pump_e=60000., eta=0.75,
          gas_cap=12000., imp=9000., xs=1.0, xo=10000.)   # import limit, export limit scale (× JAO maxFR)

def solve_week(I, sl, th, pz=None):
    """I: inputs dict (days × 24), sl: slice of days; returns hourly price (dual), shape (n_days, 24)"""
    g = lambda k: I[k][sl].ravel()
    Lo, S, W, A, ROR, X, C = g('L'), g('S'), g('W'), g('A'), g('ROR'), g('X'), g('C')
    PZ = (pz[sl].ravel() if pz is not None else g('PZ')).copy()
    PZ = np.where(np.isfinite(PZ), PZ, np.nanmean(PZ) if np.isfinite(PZ).any() else 60.)
    T = len(Lo)
    # variables: r(RES) nt(top) nb(bottom) up dn h(hydro) pin pout lev gas imp exp
    names = ['r', 'nt', 'nb', 'up', 'dn', 'h', 'pin', 'pout', 'lev', 'gas', 'imp', 'exp']
    V = len(names); idx = {k: i * T for i, k in enumerate(names)}
    n = V * T
    cost = np.zeros(n); lb = np.zeros(n); ub = np.full(n, np.inf)
    s_ = lambda k: slice(idx[k], idx[k] + T)
    cost[s_('r')] = -th['kappa']; ub[s_('r')] = S + W + ROR + th['must']
    nmin = th['mfrac'] * A; ntop = (1 - th['ufrac']) * A; nbot = np.maximum(th['ufrac'] * A - nmin, 0)
    cost[s_('nt')] = th['ctop'] + th.get('btop', 0) * C; ub[s_('nt')] = ntop
    cost[s_('nb')] = th['cbot'] + th.get('bbot', 0) * C; ub[s_('nb')] = nbot
    cost[s_('up')] = th['kramp']; cost[s_('dn')] = th['kramp']
    cost[s_('h')] = 0.0; ub[s_('h')] = th['hyd_cap']
    cost[s_('pin')] = 0.01; ub[s_('pin')] = th['pump']; cost[s_('pout')] = 0.01; ub[s_('pout')] = th['pump']
    ub[s_('lev')] = th['pump_e']
    cost[s_('gas')] = C; ub[s_('gas')] = th['gas_cap']
    cost[s_('imp')] = PZ + 1.0; ub[s_('imp')] = th['imp']
    cost[s_('exp')] = -(PZ - 1.0); ub[s_('exp')] = np.maximum(th['xs'] * X, 0) + th['xo']
    # must-run: RES lower bound 0 (curtailable); the rest must-run is in r with the same bid (simplification)
    Aeq = lil_matrix((T + T + T, n)); beq = np.zeros(3 * T)
    for t in range(T):
        # balance: r + nmin + nt + nb + h + pout - pin + gas + imp - exp = L
        for k, sgn in (('r', 1), ('nt', 1), ('nb', 1), ('h', 1), ('pout', 1), ('pin', -1), ('gas', 1), ('imp', 1), ('exp', -1)):
            Aeq[t, idx[k] + t] = sgn
        beq[t] = Lo[t] - nmin[t]
        # ramp: (nt+nb)_t - (nt+nb)_{t-1} + nmin_t - nmin_{t-1} = up - dn
        r_ = T + t
        Aeq[r_, idx['nt'] + t] = 1; Aeq[r_, idx['nb'] + t] = 1; Aeq[r_, idx['up'] + t] = -1; Aeq[r_, idx['dn'] + t] = 1
        if t > 0:
            Aeq[r_, idx['nt'] + t - 1] = -1; Aeq[r_, idx['nb'] + t - 1] = -1
            beq[r_] = -(nmin[t] - nmin[t - 1])
        else:
            Aeq[r_, idx['up'] + t] = 0; Aeq[r_, idx['dn'] + t] = 0   # free start
        # storage: lev_t = lev_{t-1} + eta*pin - pout
        q = 2 * T + t
        Aeq[q, idx['lev'] + t] = 1; Aeq[q, idx['pin'] + t] = -th['eta']; Aeq[q, idx['pout'] + t] = 1
        if t > 0:
            Aeq[q, idx['lev'] + t - 1] = -1
        else:
            beq[q] = th['pump_e'] * 0.5
    # hydro weekly energy
    Aub = lil_matrix((2, n)); bub = np.zeros(2)
    Aub[0, s_('h')] = 1; bub[0] = th['hyd_e'] * th['hyd_cap'] * T
    Aub[1, idx['lev'] + T - 1] = -1; bub[1] = -th['pump_e'] * 0.5   # end level ≥ start
    res = linprog(cost, A_ub=csr_matrix(Aub), b_ub=bub, A_eq=csr_matrix(Aeq), b_eq=beq, bounds=list(zip(lb, ub)), method='highs')
    if res.status != 0:
        return np.full(T, np.nan)
    return res.eqlin.marginals[:T]

def year_prices(I, th, pz=None, weeks=None):
    D = len(I['L']); out = np.full((D, 24), np.nan)
    for w0 in range(0, D, 7):
        if weeks is not None and w0 // 7 not in weeks:
            continue
        sl = slice(w0, min(w0 + 7, D))
        out[sl] = solve_week(I, sl, th, pz).reshape(-1, 24)
    return out
