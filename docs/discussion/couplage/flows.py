#!/usr/bin/env python3
"""Hours by what coupling does to the French price, and where the money goes (model.py, states.py first).

Cases, hour by hour, Δ = real price − isolated price (model):
  up_coupled   Δ ≥ +5 €/MWh, France has the price of at least one neighbour (the rise goes to producers, little rent)
  up_cut       Δ ≥ +5 €/MWh, France cut off from every neighbour (part of the rise, plus rent at the border)
  flat         |Δ| < 5 €/MWh (no notable effect on the price; rent may still be earned)
  down         Δ ≤ −5 €/MWh (coupling lowers the price: France short or importing)
  shortage     France alone could not meet its load
5 €/MWh is a reading threshold, not a precision: one hour of the model can be off by 15–20 €/MWh.

Money, per year, real against island (same load):
  spot bill of French consumers: Σ load × (P_real − P_iso)
  French producers' market revenue: Σ P_real × output_real − P_iso × output_iso, by technology. Identity: = bill change
  + exports valued at the French price.
  foreign buyers pay exports at their own price = French producers' export revenue + congestion rent (both TSOs).
Island output by technology: wind, solar, run-of-river, bio as observed, minus the curtailment the island needs (taken
from wind and solar); the dispatchable fleet gives the island volume, the fall in output (exports) shared in
proportion to each dispatchable technology's output that hour; in import hours the extra comes from nuclear up to its
availability, then from reservoirs, pumped storage, gas, coal and oil in proportion to their room.
Output: flows.json"""
import json
import numpy as np
D = dict(np.load('/tmp/coupl/hourly.npz')); C = dict(np.load('/tmp/coupl/cf.npz')); Q = dict(np.load('/tmp/coupl/qh.npz'))
days = D['days']; nd = len(days)
st = np.load('/tmp/coupl/states.npz')['state'].reshape(nd, 24, 4)[:, :, 0]
yr = np.array([int(d[:4]) for d in days])[:, None].repeat(24, 1)
P, PI = D['p_FR'], C['p_iso']; L = D['e_load']; NX = C['NX']; ens = C['ens']; cur = C['curtail']
ok = np.isfinite(P) & np.isfinite(PI) & np.isfinite(L)
dP = P - PI

# hourly congestion rent on French borders (both sides), € per hour, from quarter-hours
rent_h = np.zeros((nd, 24))
for b, z in (('BE', 'BE'), ('DE', 'DE_LU'), ('ES', 'ES'), ('IT', 'IT_NORD'), ('CH', 'CH'), ('GB', 'GB')):
    e = -Q[f'comm_{b}']; r = (Q[f'p_{z}'] - Q['p_FR']) * e / 4
    rent_h += np.nansum(r.reshape(nd, 24, 4), 2)

cut = np.isin(st, ['cut_exp', 'cut_mid', 'cut_imp'])
case = np.full(P.shape, '', dtype='<U12')
case[ok & (dP >= 5) & ~cut] = 'up_coupled'
case[ok & (dP >= 5) & cut] = 'up_cut'
case[ok & (np.abs(dP) < 5)] = 'flat'
case[ok & (dP <= -5)] = 'down'
case[ok & (ens > 0)] = 'shortage'

# island output by technology
g = {k: np.nan_to_num(D[f'e_{k}']) for k in ('nuclear', 'hydroLake', 'hydroPS', 'gas', 'coal', 'oil', 'wind', 'solar', 'hydroRoR', 'bio')}
disp = ('nuclear', 'hydroLake', 'hydroPS', 'gas', 'coal', 'oil')
tot = sum(np.maximum(g[k], 0) for k in disp)
vre = g['wind'] + g['solar']
iso = {k: g[k].copy() for k in g}
for k in ('wind', 'solar'):
    iso[k] = g[k] - np.where(vre > 0, cur * g[k] / np.maximum(vre, 1), 0)
fall = np.maximum(NX - cur, 0)                                  # what the dispatchable fleet stops producing
for k in disp:
    iso[k] = iso[k] - np.where(tot > 0, fall * np.maximum(g[k], 0) / np.maximum(tot, 1), 0)
rise = np.maximum(-NX - ens, 0)                                 # what it must add when France no longer imports
room_n = np.maximum(D['avail'] - g['nuclear'], 0)
add_n = np.minimum(rise, room_n); iso['nuclear'] += add_n
rest = rise - add_n
other = ('hydroLake', 'hydroPS', 'gas', 'coal', 'oil')
room = {k: np.maximum(np.nanmax(g[k][None].reshape(-1)) - g[k], 0) for k in other}
rt = sum(room.values())
for k in other:
    iso[k] += np.where(rt > 0, rest * room[k] / np.maximum(rt, 1), 0)
TECH = {'Nucléaire': ('nuclear',), 'Hydraulique': ('hydroLake', 'hydroPS', 'hydroRoR'), 'Éolien et solaire': ('wind', 'solar'),
        'Gaz, charbon, fioul': ('gas', 'coal', 'oil'), 'Bioénergies': ('bio',)}

out = {}
bn = 1e9
for y in range(2020, 2027):
    m = ok & (yr == y)
    r = {'cases': {}}
    for c in ('up_coupled', 'up_cut', 'flat', 'down', 'shortage'):
        k = m & (case == c)
        r['cases'][c] = dict(hours=int(k.sum()), share=round(float(k.sum() / m.sum()), 3),
                             dp=round(float(dP[k].mean()), 1) if k.any() and c != 'shortage' else None,
                             real=round(float(P[k].mean()), 1) if k.any() else None,
                             iso=round(float(PI[k].mean()), 1) if k.any() and c != 'shortage' else None,
                             nx_gw=round(float(NX[k].mean() / 1e3), 1) if k.any() else None,
                             bill_bn=round(float(np.sum((L * dP)[k]) / bn), 2) if c != 'shortage' else None,
                             rent_bn=round(float(np.sum(rent_h[k]) / bn), 2),
                             rent_per_h_k=round(float(rent_h[k].mean() / 1e3)) if k.any() else None)
    n = m & (ens == 0)
    rev = {t: round(float(np.sum(sum(g[x] for x in ks)[n] * P[n] - sum(iso[x] for x in ks)[n] * PI[n]) / bn), 2) for t, ks in TECH.items()}
    r['bill_bn'] = round(float(np.sum((L * dP)[n]) / bn), 2)
    r['export_fr_bn'] = round(float(np.sum((NX * P)[n]) / bn), 2)
    r['revenue_by_tech_bn'] = rev
    r['revenue_total_bn'] = round(sum(rev.values()), 2)
    r['rent_bn'] = round(float(np.sum(rent_h[n]) / bn), 2)
    r['rent_hours_rent_but_no_rise'] = int((n & (np.abs(dP) < 5) & (rent_h > 0)).sum())
    out[y] = r
    print(y, {c: (v['hours'], v['dp'], v['bill_bn'], v['rent_bn']) for c, v in r['cases'].items()})
    print('   bill', r['bill_bn'], 'exports@FR', r['export_fr_bn'], 'revenue', r['revenue_total_bn'], rev, 'rent', r['rent_bn'])
json.dump(out, open('flows.json', 'w'), indent=1)
