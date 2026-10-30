#!/usr/bin/env python3
"""Coupling state of France, quarter-hour by quarter-hour, 2020 – Oct. 2026 (build_data.py first).

A border is "coupled" in a quarter-hour when |price FR − price neighbour| < 0.01 €/MWh (TOL: equal prices, as the CRE counts convergence; 1 € as a sensitivity). Before 1 Oct. 2025 the
day-ahead is hourly and each hour is four identical quarter-hours; from 1 Oct. 2025 (15-minute day-ahead) each
quarter-hour is its own auction. Every quarter-hour counts 0.25 h, so the counts stay in hours.

States (SDAC neighbours: Belgium, Germany, Spain, North Italy; Britain in 2020 only, Switzerland never):
  core     coupled with Belgium AND Germany (Core neighbours)
  partial  coupled with at least one SDAC neighbour, not both Core neighbours
  cut_exp  coupled with none, France cheaper than every SDAC neighbour (it exports at its limits)
  cut_imp  coupled with none, France dearer than every SDAC neighbour (it imports at its limits)
  cut_mid  coupled with none, France between its neighbours' prices
Output: states.json (yearly table) and /tmp/coupl/states.npz (state of each quarter-hour)."""
import json, sys
import numpy as np

TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.01
Q = np.load('/tmp/coupl/qh.npz')
days = Q['days']; nd = len(days)
P = {z: Q[f'p_{z}'] for z in ('FR', 'DE_LU', 'BE', 'NL', 'ES', 'IT_NORD', 'CH', 'GB')}
year = np.array([int(d[:4]) for d in days])[:, None].repeat(96, 1)
fr = P['FR']
NB = {'BE': 'BE', 'DE': 'DE_LU', 'ES': 'ES', 'IT': 'IT_NORD', 'CH': 'CH', 'GB': 'GB'}
eq = {b: np.abs(fr - P[z]) < TOL for b, z in NB.items()}
below = {b: fr <= P[z] - TOL for b, z in NB.items()}
above = {b: fr >= P[z] + TOL for b, z in NB.items()}
ok = np.isfinite(fr) & np.isfinite(P['DE_LU']) & np.isfinite(P['BE']) & np.isfinite(P['ES']) & np.isfinite(P['IT_NORD'])

sdac = ['BE', 'DE', 'ES', 'IT']
gb_in = year == 2020                              # Britain left the single day-ahead coupling on 1 Jan. 2021
any_eq = eq['BE'] | eq['DE'] | eq['ES'] | eq['IT'] | (gb_in & eq['GB'])
all_below = below['BE'] & below['DE'] & below['ES'] & below['IT'] & (~gb_in | below['GB'] | ~np.isfinite(P['GB']))
all_above = above['BE'] & above['DE'] & above['ES'] & above['IT'] & (~gb_in | above['GB'] | ~np.isfinite(P['GB']))
state = np.full(fr.shape, '', dtype='<U8')
state[ok & eq['BE'] & eq['DE']] = 'core'
state[ok & any_eq & ~(eq['BE'] & eq['DE'])] = 'partial'
state[ok & ~any_eq & all_below] = 'cut_exp'
state[ok & ~any_eq & all_above] = 'cut_imp'
state[ok & ~any_eq & ~all_below & ~all_above] = 'cut_mid'
np.savez_compressed('/tmp/coupl/states.npz', state=state, days=days)

S = ('core', 'partial', 'cut_exp', 'cut_imp', 'cut_mid')
NXc = -sum(Q[f'comm_{b}'] for b in NB)                          # France's net commercial exports, MW (+ export)
out = {'tol': TOL, 'years': {}}
for y in range(2020, 2027):
    m = (year == y) & ok
    n = m.sum() / 4
    r = {'hours': round(float(n)), 'states': {}, 'borders': {}}
    for s in S:
        k = m & (state == s)
        r['states'][s] = {'hours': round(float(k.sum() / 4)), 'share': round(float(k.sum() / max(m.sum(), 1)), 4),
                          'price': {z: (round(float(np.nanmean(P[z][k])), 1) if k.any() and np.isfinite(P[z][k]).any() else None)
                                    for z in ('FR', 'DE_LU', 'BE', 'ES', 'IT_NORD', 'CH', 'GB')}}
    for b, z in NB.items():
        v = m & np.isfinite(P[z])
        r['borders'][b] = {'coupled': round(float((v & eq[b]).sum() / max(v.sum(), 1)), 4),
                           'fr_cheaper': round(float((v & below[b]).sum() / max(v.sum(), 1)), 4),
                           'fr_dearer': round(float((v & above[b]).sum() / max(v.sum(), 1)), 4),
                           'fr': round(float(np.nanmean(fr[v])), 1), 'nb': round(float(np.nanmean(P[z][v])), 1)}
    r['fr_mean'] = round(float(np.nanmean(fr[m])), 1)
    # partial coupling: with which SDAC neighbours
    combos = {}
    k = m & (state == 'partial')
    for i in np.flatnonzero(k.ravel()):
        key = '+'.join(b for b in sdac if eq[b].ravel()[i]) or ('GB' if gb_in.ravel()[i] else '?')
        combos[key] = combos.get(key, 0) + 0.25
    r['partial_with'] = {c: round(h) for c, h in sorted(combos.items(), key=lambda x: -x[1])}
    # net commercial position of France in each state (+ export), GW, and the share of exporting quarter-hours
    for s in S:
        k = m & (state == s) & np.isfinite(NXc)
        r['states'][s]['net_export_gw'] = round(float(np.mean(NXc[k]) / 1e3), 1) if k.any() else None
        r['states'][s]['share_exporting'] = round(float(np.mean(NXc[k] > 0)), 3) if k.any() else None
    out['years'][y] = r
json.dump(out, open('states.json' if TOL == 0.01 else f'/tmp/coupl/states_{TOL}.json', 'w'), indent=1)
for y, r in out['years'].items():
    print(y, r['hours'], ' '.join(f"{s}:{r['states'][s]['share']:.0%}({r['states'][s]['price']['FR']})" for s in S),
          '| DE coupled', f"{r['borders']['DE']['coupled']:.0%}", 'BE', f"{r['borders']['BE']['coupled']:.0%}",
          'ES', f"{r['borders']['ES']['coupled']:.0%}", 'IT', f"{r['borders']['IT']['coupled']:.0%}", 'CH', f"{r['borders']['CH']['coupled']:.0%}", 'GB', f"{r['borders']['GB']['coupled']:.0%}")
