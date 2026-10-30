import sys, warnings, numpy as np
sys.path.insert(0, 'scripts'); sys.argv = ['x']; warnings.simplefilter('ignore')
import ppa_lab as L, ppa_scenarios as G
F_ = G.fuel_cost()
for A in (2024, 2025):
    fy = [A - 1, A, A] if A - 1 != 2022 else [2021, A, A]
    pm = G.RegimeRule(fy, True, True)
    a = L.DATA[A]; mo = a['month']
    c = np.array([F_.get(str(d)[:10], np.nan) for d in a['days']])[:, None]; c = np.where(np.isfinite(c), c, np.nanmean(c))
    g = G.PriceModelFuel.groups(mo, [L.day_kind(d) for d in a['days']])
    x, xf = G.year_share(A, True), G.year_share(A, False)
    need = G.export_need(a['fr_s'], a['fr_w'], a['fr_l'], G.fr_avail(A)) - G.fr_jmax(A) / 1000
    f1, fp, fq = pm.phi(x, g, xf, c, None, need, xf)
    pi = pm.pdec(g, need)
    P = a['fr_p']; de = G.de_prices(A); cut = np.isfinite(de) & (P < de - 5)
    w = a['fr_w']; ok = np.isfinite(P)
    wsh = w / a['fr_l']
    def cap(price, sel):   # wind value per MWh in the selection, paid hours (price > 0)
        return np.nansum((w * np.maximum(price, 0))[sel]) / np.nansum(w[sel])
    print(f'== {A}: wind value €/MWh, realised vs rule (rule fq/fp expected); wind MWh share')
    tot = np.nansum(w[ok])
    rows = [('all', ok), ('cut off (real)', ok & cut), ('coupled (real)', ok & ~cut)]
    q = np.nanpercentile(wsh[ok], [33, 66])
    rows += [('wind low', ok & (wsh < q[0])), ('wind mid', ok & (wsh >= q[0]) & (wsh < q[1])), ('wind high', ok & (wsh >= q[1]))]
    rows += [('wind high & cut', ok & (wsh >= q[1]) & cut), ('wind high & coupled', ok & (wsh >= q[1]) & ~cut)]
    for nm, s in rows:
        r = np.nansum((w * np.maximum(P, 0))[s]) / np.nansum(w[s]); m = np.nansum((w * fp * c)[s]) / np.nansum(w[s])
        print(f'{nm:22s} share {np.nansum(w[s])/tot:5.1%}  real {r:6.1f}  rule {m:6.1f}  gap {m-r:+5.1f}   cut-off real {cut[s].mean():.0%} rule {pi[s].mean():.0%}')
    base_r = np.nanmean(np.maximum(P, 0)[ok]); base_m = np.nanmean((fp * c)[ok])
    print(f'all hours (base, paid part): real {base_r:.1f} rule {base_m:.1f} gap {base_m-base_r:+.1f}')
    # persistence: within the cut-off hours, by the day's mean French surplus share vs the hour's
    dm = np.repeat(np.nanmean(xf, 1, keepdims=True), 24, 1)
    sc = ok & cut
    for nm, s in (('solar-led surplus (midday, low wind)', sc & (wsh < q[0])), ('wind-led surplus', sc & (wsh >= q[1]))):
        print(f'{nm:38s} hours {s.sum():5d}  real {np.nanmean(P[s]):6.1f}  rule {np.nanmean((f1*c)[s]):6.1f}  gap {np.nanmean((f1*c)[s]-P[s]):+5.1f}   hour share {np.nanmean(xf[s]):.2f}  day share {np.nanmean(dm[s]):.2f}')
    for lo, hi in ((0, .33), (.33, .66), (.66, 1.01)):
        qq = np.nanquantile(dm[sc], [lo, min(hi, 1)])
        s = sc & (dm >= qq[0]) & (dm <= qq[1])
        print(f'  cut-off hours, day-mean surplus tercile {lo:.2f}-{hi:.2f}: gap {np.nanmean((f1*c)[s]-P[s]):+5.1f} €  (wind-weighted {np.nansum((w*(f1*c-P))[s])/np.nansum(w[s]):+5.1f})')
