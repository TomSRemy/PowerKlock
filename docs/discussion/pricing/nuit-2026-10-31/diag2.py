import sys, warnings, numpy as np
sys.path.insert(0, 'scripts'); sys.argv = ['x']; warnings.simplefilter('ignore')
import ppa_lab as L, ppa_scenarios as G
F_ = G.fuel_cost()
for A in (2024, 2025):
    fy = [A - 1, A, A]
    pm = G.RegimeRule(fy, True, True)
    a = L.DATA[A]; mo = a['month']
    c = np.array([F_.get(str(d)[:10], np.nan) for d in a['days']])[:, None]; c = np.where(np.isfinite(c), c, np.nanmean(c))
    g = G.PriceModelFuel.groups(mo, [L.day_kind(d) for d in a['days']])
    xf = G.year_share(A, False)
    d1, _, _ = pm.dec.phi(xf, g, None, c)
    P = a['fr_p']; de = G.de_prices(A); cut = np.isfinite(de) & (P < de - 5)
    w, s_ = a['fr_w'], a['fr_s']; ok = np.isfinite(P) & cut
    print(f'== {A} cut-off hours only, the France-only rule alone (price, €/MWh)')
    sh = w / (w + s_ + 1)
    for nm, k in (('all cut', ok), ('surplus mostly solar (wind < 30% of RES)', ok & (sh < .3)), ('mixed', ok & (sh >= .3) & (sh < .7)), ('surplus mostly wind (> 70%)', ok & (sh >= .7))):
        print(f'{nm:42s} hours {k.sum():5d}  real {np.nanmean(P[k]):6.1f}  rule {np.nanmean((d1*c)[k]):6.1f}  gap {np.nanmean((d1*c-P)[k]):+5.1f}  | wind-weighted gap {np.nansum((w*(d1*c-P))[k])/np.nansum(w[k]):+5.1f}')
    # the same French share bin: is the price lower when wind drives it?
    b = np.round(xf / 0.1)
    rows = []
    for bb in np.unique(b[ok]):
        k = ok & (b == bb)
        if k.sum() < 200: continue
        hi, lo = k & (sh >= .7), k & (sh < .3)
        if hi.sum() > 30 and lo.sum() > 30:
            print(f'   share bin {bb/10:+.1f}: wind-led real {np.nanmean(P[hi]):6.1f} (n {hi.sum()}), solar-led real {np.nanmean(P[lo]):6.1f} (n {lo.sum()})')
