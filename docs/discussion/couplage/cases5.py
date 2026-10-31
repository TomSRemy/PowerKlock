#!/usr/bin/env python3
"""Hours and prices of the five cases of the short deck, quarter-hour by quarter-hour (states.py first):
France exporter or importer (sign of its net commercial exchanges, ENTSO-E via Energy-Charts); line not saturated =
France at Belgium's and Germany's price to the cent; exporter with saturated line = France cheaper than both;
importer with saturated line = France dearer than both; 'mixed' = every other quarter-hour (France between Belgium and
Germany, or exporting south while dearer than Germany, typically a German wind and solar surplus). The fifth case, France cut off
(no exchange at all), never happens: its price is only a model estimate. Output: cases5.json"""
import json
import numpy as np
Q = dict(np.load('/tmp/coupl/qh.npz')); st = np.load('/tmp/coupl/states.npz')['state']
days = Q['days']; yr = np.array([int(d[:4]) for d in days])[:, None].repeat(96, 1)
fr, de = Q['p_FR'], Q['p_DE_LU']
nx = -sum(Q[f'comm_{b}'] for b in ('BE', 'DE', 'ES', 'IT', 'CH', 'GB'))
ok = np.isfinite(fr) & np.isfinite(de) & np.isfinite(Q['p_BE']) & np.isfinite(nx)
be = Q['p_BE']
core = (np.abs(fr - be) < 0.01) & (np.abs(fr - de) < 0.01)
cheaper = fr < np.fmin(be, de) - 0.005; dearer = fr > np.fmax(be, de) + 0.005
C = {'exp_free': core & (nx > 0), 'exp_sat': cheaper & (nx > 0), 'imp_free': core & (nx <= 0), 'imp_sat': dearer & (nx <= 0)}
C['mix_dearer'] = dearer & (nx > 0)                        # exports south while dearer than Belgium and Germany
C['mixed'] = ~(C['exp_free'] | C['exp_sat'] | C['imp_free'] | C['imp_sat'] | C['mix_dearer'])   # between Belgium and Germany, or rare
PZ = {'BE': 'BE', 'DE': 'DE_LU', 'ES': 'ES', 'IT': 'IT_NORD', 'CH': 'CH', 'GB': 'GB'}
rent = np.zeros(fr.shape)                                   # congestion rent on France's borders, both sides, € per quarter-hour
for b, z in PZ.items():
    r = (Q[f'p_{z}'] - fr) * (-Q[f'comm_{b}']) / 4
    rent += np.nan_to_num(r)
out = {}
for y in range(2020, 2027):
    m = ok & (yr == y)
    out[y] = {k: dict(hours=round(float((m & c).sum() / 4)), share=round(float((m & c).sum() / m.sum()), 3),
                      fr=round(float(fr[m & c].mean()), 1) if (m & c).any() else None,
                      de=round(float(de[m & c].mean()), 1) if (m & c).any() else None,
                      nx_gw=round(float(nx[m & c].mean() / 1e3), 1) if (m & c).any() else None,
                      rent_m=round(float(rent[m & c].sum() / 1e6)),
                      nx_max_gw=round(float(np.abs(nx[m & c]).max() / 1e3), 1) if (m & c).any() else None) for k, c in C.items()}
    print(y, {k: (v['share'], v['fr'], v['de'], v['nx_gw'], v['rent_m']) for k, v in out[y].items()})
json.dump(out, open('cases5.json', 'w'), indent=1)
