#!/usr/bin/env python3
"""What coupling does to the French price, from observed prices only (no model). build_data.py, states.py first.

Coupled hours (France at the Core price: Belgium and Germany) and cut-off hours (France's price different from every
neighbour) are compared at the same French situation: same year, same quarter, same time of day (night 0–7 h, day
8–17 h, evening 18–23 h) and same French surplus at full nuclear (available nuclear + wind + solar + run-of-river +
bio − load, bins of 2 GW). In each cell: mean French price when coupled, when cut off, and Germany's price; cells need
≥ 10 hours of each. The gap is weighted by the cut-off hours of each cell: "what France would have paid in its cut-off
hours if the line had had room", read on hours where it had.
Output: observed.json"""
import json
import numpy as np
D = dict(np.load('/tmp/coupl/hourly.npz'))
days = D['days']; nd = len(days)
st = np.load('/tmp/coupl/states.npz')['state'].reshape(nd, 24, 4)[:, :, 0]
yr = np.array([int(d[:4]) for d in days])[:, None].repeat(24, 1)
qt = ((np.array([int(d[5:7]) for d in days]) - 1) // 3)[:, None].repeat(24, 1)
hr = np.arange(24)[None, :].repeat(nd, 0); tod = np.where(hr < 8, 0, np.where(hr < 18, 1, 2))
P, DE = D['p_FR'], D['p_DE_LU']
sur = (D['avail'] + D['e_wind'] + D['e_solar'] + D['e_hydroRoR'] + D['e_bio'] - D['e_load']) / 1e3
sb = np.floor(sur / 2)
ok = np.isfinite(P) & np.isfinite(DE) & np.isfinite(sur)
cpl = ok & (st == 'core'); cut = ok & np.isin(st, ['cut_exp', 'cut_mid'])
out = {}
for y in range(2020, 2027):
    num = den = de_c = 0.0; cov = 0; tot = int((cut & (yr == y)).sum()); rows = []
    for q in range(4):
        for t in range(3):
            base = (yr == y) & (qt == q) & (tod == t)
            for b in np.unique(sb[base & ok]):
                c = base & (sb == b)
                a, k = cpl & c, cut & c
                if a.sum() >= 10 and k.sum() >= 10:
                    g = P[a].mean() - P[k].mean()
                    num += g * k.sum(); den += k.sum(); cov += int(k.sum())
                    de_c += (DE[k].mean() - P[k].mean()) * k.sum()
                    rows.append((q, t, int(b), int(a.sum()), int(k.sum()), round(float(P[a].mean()), 1), round(float(P[k].mean()), 1)))
    m = ok & (yr == y)
    out[y] = dict(coupled_hours=int((cpl & (yr == y)).sum()), cut_hours=tot, matched_cut_hours=cov,
                  coverage=round(cov / tot, 3) if tot else None,
                  gap_coupled_minus_cut=round(num / den, 1) if den else None,
                  de_minus_fr_in_cut=round(de_c / den, 1) if den else None,
                  raw_coupled=round(float(P[cpl & (yr == y)].mean()), 1) if (cpl & (yr == y)).any() else None,
                  raw_cut=round(float(P[cut & (yr == y)].mean()), 1) if (cut & (yr == y)).any() else None,
                  raw_de_in_cut=round(float(DE[cut & (yr == y)].mean()), 1) if (cut & (yr == y)).any() else None,
                  fr_year=round(float(P[m].mean()), 1), de_year=round(float(DE[m].mean()), 1),
                  # spot value of French consumption in cut-off hours had they been at the coupled price of similar hours
                  cells=len(rows))
    print(y, out[y])
json.dump(out, open('observed.json', 'w'), indent=1)
