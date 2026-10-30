#!/usr/bin/env python3
"""Headline numbers of the deck, per year (model.py and states.py first). Shortage hours of the island (where France
alone could not have met its load) are counted apart: their price is the market ceiling, a convention rather than an
estimate, and they would swamp the rest. Output: summary.json"""
import json
import numpy as np
D = dict(np.load('/tmp/coupl/hourly.npz')); C = dict(np.load('/tmp/coupl/cf.npz'))
R = json.load(open('model_results.json')); RC = json.load(open('/tmp/coupl/model_results_cut.json'))
ST = json.load(open('states.json'))['years']; S1 = json.load(open('/tmp/coupl/states_1.0.json'))['years']
days = D['days']; yr = np.array([int(x[:4]) for x in days])[:, None].repeat(24, 1)
P, L = D['p_FR'], D['e_load']; pi = C['p_iso']; ens = C['ens']
ok = np.isfinite(P) & np.isfinite(pi) & np.isfinite(L)
out = {}
for y in range(2020, 2027):
    m = ok & (yr == y); n = m & (ens == 0)
    r = R['years'][str(y)]; s = ST[str(y)]['states']
    out[y] = dict(
        label=f'{y}' if y < 2026 else '2026 (janv.–oct.)',
        hours=r['hours'],
        shares={k: v['share'] for k, v in s.items()}, shares_1eur={k: v['share'] for k, v in S1[str(y)]['states'].items()},
        state_prices={k: v['price'] for k, v in s.items()},
        state_nx={k: v['net_export_gw'] for k, v in s.items()},
        borders=ST[str(y)]['borders'], partial_with=ST[str(y)]['partial_with'],
        real=round(float(P[n].mean()), 1), iso=round(float(pi[n].mean()), 1),
        real_all=r['price_real'], iso_all=r['price_iso'],
        iso_deep=round(float(C['p_iso_deep'][n].mean()), 1), iso_delta=round(float(C['p_iso_delta'][n].mean()), 1), iso_cut_variant=RC['years'][str(y)]['price_iso_no_ens'],
        gap=round(float((P[n] - pi[n]).mean()), 1),
        consumers=r['consumers_bn_no_ens'], producers=r['producers_bn_no_ens'],
        consumers_cut_variant=RC['years'][str(y)]['consumers_bn_no_ens'],
        consumers_deep=round(float(np.sum((L * (P - C['p_iso_deep']))[n]) / 1e9), 2),
        consumers_delta=round(float(np.sum((L * (P - C['p_iso_delta']))[n]) / 1e9), 2),
        rent=r['rent_total_bn'], rent_by_border={b: v['total'] for b, v in r['rent'].items()},
        exports_by_border={b: v['export_twh'] for b, v in r['rent'].items()},
        export_value_fr=r['export_revenue_bn'], export_value_nb=round(sum(v['value_at_nb'] for v in r['rent'].values()), 2),
        nx_twh=r['nx_twh'], load_twh=r['load_twh'],
        france_net=round(r['producers_bn_no_ens'] - r['consumers_bn_no_ens'] + r['rent_total_bn'] / 2, 2),
        shortage_hours=r['ens_hours'], shortage_gwh=round(r['ens_twh'] * 1000), shortage_max_gw=round(float(ens[m].max() / 1e3), 1),
        curtail_twh=r['curtail_twh'], out_of_support=r['out_of_support'],
        validation=R['validation'][str(y)])
    o = out[y]
    print(y, f"real {o['real']} iso {o['iso']} gap {o['gap']} | cons {o['consumers']} prod {o['producers']} rent {o['rent']} net {o['france_net']} | short {o['shortage_hours']} h {o['shortage_gwh']} GWh")
json.dump(out, open('summary.json', 'w'), indent=1)
