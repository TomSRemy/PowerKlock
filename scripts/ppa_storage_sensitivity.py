#!/usr/bin/env python3
"""How much the European price model's outlook depends on storage it does not model.

The model (ppa_lab.PriceModel, live settings) saturates at midday from about 2028: the neighbours'
fleets grow at their recent pace while no storage or flexible demand is added. Here batteries are
added across France, Germany, Belgium and Spain together (illustrative totals, not a forecast: 0, 10,
20 and 40 GW, 2 hours, 85 % round trip), each day charging in the hours of lowest residual load and
discharging in the highest, and the capture of a French solar (and wind) MWh is recomputed over every
past weather year, central capacity path. Charging counts as load, as the pricer's FLEX option does
for pumped storage.

Result (solar capture, curtailed convention, 0 / 10 / 20 / 40 GW): 2026 0.655 / 0.674 / 0.700 / 0.774,
2028 0.507 / 0.525 / 0.547 / 0.606, 2030 0.468 / 0.485 / 0.504 / 0.552. Wind moves by under 2 points.
So 20-40 GW of batteries across the four countries (a plausible order for 2030 given Spain's and
Germany's plans) lifts the model's solar capture by 3 to 10 points: worth a sourced storage path,
not enough to change which methods hold. The all-hours solar ratio barely moves (the midday hours
stay saturated while storage lowers the month's average through the evening discharge).

Writes data/history/ppa_storage_sensitivity.json
    python scripts/ppa_storage_sensitivity.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
_argv, sys.argv = sys.argv, ['x']
import ppa_lab as L   # noqa: E402
sys.argv = _argv

H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_storage_sensitivity.json')
POWERS_GW = (0, 10, 20, 40)
HOURS, EFF = 2.0, 0.85
YEARS = (2026, 2028, 2030)


def with_storage(R, Lo, p_mw):
    """residual load R and load Lo (D × 24, MW, the region summed) after daily battery cycles"""
    if p_mw <= 0:
        return R, Lo
    R, Lo = R.copy(), Lo.copy()
    e_max = p_mw * HOURS
    for d in range(R.shape[0]):
        order = np.argsort(R[d])
        stored = 0.0
        for h in order:                       # charge where the residual load is lowest
            if stored >= e_max:
                break
            c = min(p_mw, e_max - stored)
            R[d, h] += c; Lo[d, h] += c; stored += c
        out = stored * EFF
        for h in order[::-1]:                 # give it back where it is highest
            if out <= 0:
                break
            q = min(p_mw, out)
            R[d, h] -= q; out -= q
    return R, Lo


def main():
    settings = json.load(open(os.path.join(H, 'ppa_forecast.json')))['settings']
    past = [y for y in L.DATA if L.DATA[y]['complete']]
    last = max(past)
    out = {'powersGW': POWERS_GW, 'hours': HOURS, 'efficiency': EFF, 'rows': []}
    for t, tech in (('s', 'solar'), ('w', 'wind')):
        st = settings[t]
        pm = L.PriceModel([y for y in past if st['with2022'] or y != 2022][-st['window']:], st['regional'], 'mean', st['level'] != 'none')
        for Y in YEARS:
            capY = {c: {tt: L.cap_future(c, tt, Y) for tt in 'sw'} for c in ('FR',) + L.NEIGH}
            lv = L.forward_levels(Y) if st['level'] == 'forward' else L.levels_for(last + 1, 'lastyear') if st['level'] == 'lastyear' else None
            days = L.calendar(Y)
            month = np.array([int(d[5:7]) for d in days])
            g = L.grp(month)
            if pm.level:
                g = g + 6 * pm.lclass(np.array([(lv or {}).get(int(m), 50.0) for m in month]))[:, None]
            res = {P: [] for P in POWERS_GW}
            for wy in past:
                h = L.assemble(Y, days, L.weather_index(Y, wy, days), last, capY)
                cs = ('FR',) + L.NEIGH
                Lo = sum(h['l'][c] for c in cs)
                R = sum(h['l'][c] - h['s'][c] - h['w'][c] - h['n'][c] for c in cs)
                for P in POWERS_GW:
                    R2, L2 = with_storage(R, Lo, P * 1000)
                    rm, rp, pp = pm.expected(R2 / L2, g)
                    res[P].append(L.month_rates(month, h[t]['FR'], rm, rp, pp))
            row = {'tech': tech, 'year': Y}
            v = h[t]['FR']
            share = np.array([v[month == m].sum() for m in range(1, 13)]); share = share / share.sum()
            for P in POWERS_GW:
                mm = {m: {k: float(np.mean([r[m][k] for r in res[P] if m in r and r[m].get(k) is not None])) for k in ('curt', 'paid', 'all')} for m in range(1, 13)}
                curt = float(sum(share[m - 1] * mm[m]['paid'] * mm[m]['curt'] for m in range(1, 13)) / sum(share[m - 1] * mm[m]['paid'] for m in range(1, 13)))
                paid = float(sum(share[m - 1] * mm[m]['paid'] for m in range(1, 13)))
                row[str(P)] = {'captureCurt': curt, 'paidShare': paid, 'valuePerMwhProduced': curt * paid,
                               'captureAll': float(sum(share[m - 1] * mm[m]['all'] for m in range(1, 13)))}
            out['rows'].append(row)
            print(tech, Y, ' | '.join(f"{P} GW: value {row[str(P)]['valuePerMwhProduced']:.3f} (capture {row[str(P)]['captureCurt']:.3f} × paid {row[str(P)]['paidShare']:.3f}), all-hours {row[str(P)]['captureAll']:.3f}" for P in POWERS_GW), flush=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
