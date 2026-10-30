#!/usr/bin/env python3
"""Why France decoupled: yearly drivers and the 'France dearer than Germany' hours (build_data.py first).
Output: drivers.json"""
import json, glob, os
import numpy as np
D = dict(np.load('/tmp/coupl/hourly.npz')); g = lambda k: D[k]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
days = D['days']; yr = np.array([int(x[:4]) for x in days])[:, None].repeat(24, 1)
P, DE = g('p_FR'), g('p_DE_LU'); NX = -g('e_exchanges')
RG = {y: json.load(open(f'{ROOT}/data/history/region_hourly/{y}.json'))['countries']['DE'] for y in range(2020, 2027)}
def de(k):
    out = np.full(P.shape, np.nan)
    for i, d in enumerate(days):
        a = (RG[int(d[:4])].get(k) or {}).get(d)
        if a and len(a) == 24:
            out[i] = [np.nan if x is None else x for x in a]
    return out
dw, ds, dl = de('w'), de('s'), de('l')
dvre = (dw + ds) / dl
out = {}
for y in range(2020, 2027):
    m = (yr == y) & np.isfinite(P) & np.isfinite(DE)
    up = m & (P > DE + 0.01); dn = m & (P < DE - 0.01)
    out[y] = dict(
        nuclear_out_gw=round(float(np.nanmean(g('e_nuclear')[m]) / 1e3), 1), nuclear_avail_gw=round(float(np.nanmean(g('avail')[m]) / 1e3), 1),
        load_gw=round(float(np.nanmean(g('e_load')[m]) / 1e3), 1), wind_solar_gw=round(float(np.nanmean((g('e_wind') + g('e_solar'))[m]) / 1e3), 1),
        hydro_gw=round(float(np.nanmean((g('e_hydroRoR') + g('e_hydroLake') + g('e_hydroPS'))[m]) / 1e3), 1),
        nx_gw=round(float(np.nanmean(NX[m]) / 1e3), 1),
        jao_max_gw=round(float(np.nanmean(g('jmax')[m]) / 1e3), 1) if np.isfinite(g('jmax')[m]).any() else None,
        surplus_full_nuclear_gw=round(float(np.nanmean((g('avail') + g('e_wind') + g('e_solar') + g('e_hydroRoR') + g('e_bio') - g('e_load'))[m]) / 1e3), 1),
        fr_dearer_h=int(up.sum()), fr_dearer_share_exporting=round(float(np.mean(NX[up] > 0)), 3) if up.any() else None,
        fr_dearer_de_vre=round(float(np.nanmean(dvre[up])), 2) if up.any() else None, fr_cheaper_de_vre=round(float(np.nanmean(dvre[dn])), 2) if dn.any() else None,
        fr_dearer_de_price=round(float(np.nanmean(DE[up])), 1) if up.any() else None, fr_dearer_fr_price=round(float(np.nanmean(P[up])), 1) if up.any() else None,
        fr_dearer_neg_de=round(float(np.mean(DE[up] < 0)), 3) if up.any() else None, fr_dearer_nx_gw=round(float(np.mean(NX[up]) / 1e3), 1) if up.any() else None,
        de_vre_all=round(float(np.nanmean(dvre[m])), 2))
    print(y, out[y])
json.dump(out, open('drivers.json', 'w'), indent=1)
