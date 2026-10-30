import sys, warnings, json
import numpy as np
sys.path.insert(0, 'scripts'); sys.path.insert(0, '/tmp/mo'); sys.argv = ['x']; warnings.simplefilter('ignore')
import ppa_lab as L, ppa_scenarios as G
F = G.fuel_cost()
for Y in (2024, 2025):
    fy = [y for y in L.DATA if y < Y and L.DATA[y]['complete'] and y >= 2019][-2:]
    pm = G.PriceModelFuel(fy, True); pm.add_france(fy)
    a = L.DATA[Y]; mo = a['month']; days = [str(d)[:10] for d in a['days']]
    c = np.array([F.get(d, np.nan) for d in days])[:, None]
    f1, _, _ = pm.phi(G.year_share(Y, True), G.PriceModelFuel.groups(mo), G.year_share(Y, False), c)
    r = f1 * c - a['fr_p']
    de = []
    for d in days:
        z = json.load(open(f'data/history/daily/{d}.json'))['zones'].get('DE_LU', {}).get('hourly')
        de.append(np.array(z, float).reshape(24, -1).mean(1) if z and None not in z and len(z) % 24 == 0 else np.full(24, np.nan))
    de = np.array(de); P = a['fr_p']; W = a['fr_w']; ok = np.isfinite(de) & np.isfinite(r)
    for lab, s in (('FR cheaper than DE (decoupled)', ok & (P < de - 5)), ('coupled', ok & (np.abs(P - de) <= 5)), ('FR dearer', ok & (P > de + 5))):
        print(Y, '%-32s hours %5d  share of wind MWh %4.0f%%  rule − actual: plain %+6.1f €  wind-weighted %+6.1f €' % (lab, s.sum(), W[s].sum() / W[ok].sum() * 100, r[s].mean(), (r[s] * W[s]).sum() / W[s].sum()))
