#!/usr/bin/env python3
"""For each coupled case (cases5.py rules): when it happens (month × hour of the reference year), in which conditions
(French nuclear, wind + solar, load, exports; German wind + solar share; prices) and one typical real hour (the hour
of the reference year closest to the case's median French price, German price and net exports).
Reference year: 2025 for the export cases, 2022 for the import cases. Hourly: first quarter-hour of each hour
(identical to the hour before 1 Oct. 2025). Output: case_profiles.json, heat_<case>.png"""
import json, os
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = dict(np.load('/tmp/coupl/hourly.npz')); Q = dict(np.load('/tmp/coupl/qh.npz'))
days = D['days']; nd = len(days)
yr = np.array([int(d[:4]) for d in days])[:, None].repeat(24, 1); mo = np.array([int(d[5:7]) for d in days])[:, None].repeat(24, 1)
hr = np.arange(24)[None, :].repeat(nd, 0)
q = lambda a: a.reshape(nd, 24, 4)[:, :, 0]
fr, de, be = q(Q['p_FR']), q(Q['p_DE_LU']), q(Q['p_BE'])
es, it = q(Q['p_ES']), q(Q['p_IT_NORD'])
nx = q(-sum(Q[f'comm_{b}'] for b in ('BE', 'DE', 'ES', 'IT', 'CH', 'GB')))
core = (np.abs(fr - be) < 0.01) & (np.abs(fr - de) < 0.01)
cheaper = fr < np.fmin(be, de) - 0.005; dearer = fr > np.fmax(be, de) + 0.005
C = {'exp_free': core & (nx > 0), 'exp_sat': cheaper & (nx > 0), 'imp_free': core & (nx <= 0), 'imp_sat': dearer & (nx <= 0)}
REF = {'exp_free': 2025, 'exp_sat': 2025, 'imp_free': 2022, 'imp_sat': 2022}
RG = {y: json.load(open(f'{ROOT}/data/history/region_hourly/{y}.json'))['countries']['DE'] for y in range(2020, 2027)}
def deg(k):
    out = np.full((nd, 24), np.nan)
    for i, d in enumerate(days):
        a = (RG[int(d[:4])].get(k) or {}).get(d)
        if a and len(a) == 24:
            out[i] = [np.nan if x is None else x for x in a]
    return out
de_vre = (deg('w') + deg('s')) / deg('l')
ok = np.isfinite(fr) & np.isfinite(de) & np.isfinite(be) & np.isfinite(nx) & np.isfinite(D['e_load'])
MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
cmap = LinearSegmentedColormap.from_list('v', ['#f3f0fb', '#7a5cc7', '#3b2a6b'])
out = {}
for k, c in C.items():
    y = REF[k]; m = ok & (yr == y)
    sel = m & c
    heat = np.array([[np.mean(sel[(mo == a) & (hr == h) & m]) if ((mo == a) & (hr == h) & m).any() else np.nan for h in range(24)] for a in range(1, 13)])
    fig, ax = plt.subplots(figsize=(6.4, 2.9))
    im = ax.imshow(heat * 100, cmap=cmap, vmin=0, vmax=100, aspect='auto')
    ax.set_yticks(range(12)); ax.set_yticklabels(MOIS, fontsize=7.5); ax.set_xticks(range(0, 24, 3)); ax.set_xticklabels([f'{h} h' for h in range(0, 24, 3)], fontsize=7.5)
    ax.set_title(f'Part du temps dans ce cas, {y}, par mois et heure', fontsize=9, loc='left')
    cb = plt.colorbar(im, ax=ax, fraction=.04, pad=.02); cb.ax.tick_params(labelsize=7); cb.set_label('%', fontsize=8)
    plt.tight_layout(); plt.savefig(f'heat_{k}.png', dpi=160, facecolor='white'); plt.close()
    g = lambda a: round(float(np.nanmean(a[sel])), 1)
    gw = lambda a: round(float(np.nanmean(a[sel]) / 1e3), 1)
    gw_all = lambda a: round(float(np.nanmean(a[m]) / 1e3), 1)
    # typical hour: closest to the case's median French price, German price and exports (scaled)
    med = np.array([np.median(fr[sel]), np.median(de[sel]), np.median(nx[sel])])
    sc = np.array([np.std(fr[sel]) or 1, np.std(de[sel]) or 1, np.std(nx[sel]) or 1])
    idx = np.argwhere(sel)
    dist = [np.sum(((np.array([fr[i, h], de[i, h], nx[i, h]]) - med) / sc) ** 2) for i, h in idx]
    i, h = idx[int(np.argmin(dist))]
    typ = dict(date=str(days[i]), hour=int(h), fr=round(float(fr[i, h]), 1), de=round(float(de[i, h]), 1), be=round(float(be[i, h]), 1),
               es=round(float(es[i, h]), 1), it=round(float(it[i, h]), 1), nx_gw=round(float(nx[i, h] / 1e3), 1),
               load_gw=round(float(D['e_load'][i, h] / 1e3), 1), nuclear_gw=round(float(D['e_nuclear'][i, h] / 1e3), 1),
               avail_gw=round(float(D['avail'][i, h] / 1e3), 1), wind_gw=round(float(D['e_wind'][i, h] / 1e3), 1),
               solar_gw=round(float(D['e_solar'][i, h] / 1e3), 1), gas_gw=round(float(D['e_gas'][i, h] / 1e3), 1),
               de_vre=round(float(de_vre[i, h]), 2) if np.isfinite(de_vre[i, h]) else None)
    months = np.array([np.mean(sel[(mo == a) & m]) for a in range(1, 13)])
    hours = np.array([np.mean(sel[(hr == b) & m]) for b in range(24)])
    out[k] = dict(year=y, share=round(float(sel.sum() / m.sum()), 3), hours=int(sel.sum()),
                  top_months=[MOIS[a] for a in np.argsort(-months)[:3]], low_months=[MOIS[a] for a in np.argsort(months)[:3]],
                  top_hours=[int(b) for b in np.argsort(-hours)[:4]], weekend_share=round(float(np.mean([s for s in sel[m] if True])), 3),
                  fr=g(fr), de=g(de), nx_gw=gw(nx), load_gw=gw(D['e_load']), nuclear_gw=gw(D['e_nuclear']), avail_gw=gw(D['avail']),
                  wind_solar_gw=gw(D['e_wind'] + D['e_solar']), de_vre=round(float(np.nanmean(de_vre[sel])), 2),
                  year_avg=dict(load_gw=gw_all(D['e_load']), nuclear_gw=gw_all(D['e_nuclear']), wind_solar_gw=gw_all(D['e_wind'] + D['e_solar']),
                                nx_gw=gw_all(nx), de_vre=round(float(np.nanmean(de_vre[m])), 2)),
                  typical=typ)
    print(k, {a: b for a, b in out[k].items() if a != 'typical'}); print('   typical', typ)
json.dump(out, open('case_profiles.json', 'w'), indent=1, default=float)
