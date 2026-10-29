#!/usr/bin/env python3
"""Shared dated capacity hypothesis in three scenarios (brief 2.1 item 2): low, central, high,
meant to be the one capacity assumption every pricing method reads, instead of each method picking
its own.

France: PPE3 (decree of 12 February 2026, JORF 13 February 2026). 2030 is a single official figure
(no published bracket): solar 48 GW, onshore+offshore wind 31 GW. 2035 is a published low-high
bracket: solar 55-80 GW, wind 35-40 GW; 'central' here is that bracket's midpoint (67.5 / 37.5 —
what scripts/ppa_lab.py already hard-codes as its one path). Scenarios converge at 2030 (no official
split that early) and diverge to the 2035 bracket.

Neighbours (DE, BE, ES): no official low/high bracket found — all three scenarios use the same
last-observed-pace extrapolation (scripts/ppa_lab.cap_future's rule). This is a known gap, not a
judgement call to treat as settled: flagged in `LIMITATIONS` below.

Not wired into the live pricer or data/history/ppa_forecast.json — this module exists so every test
script can import the same three paths instead of redefining them; adopting it in the pricer's own
forecast is a separate, visible change to propose once the three scenarios have been checked.

    python scripts/ppa_capacity_scenarios.py   # prints the three paths through 2035
"""
LIMITATIONS = (
    "Neighbours (DE, BE, ES) have no official low/high bracket in this module — only France's path "
    "is scenario-dated. A low/central/high comparison that includes neighbours (brief 2.1 item 1) "
    "currently only varies France's capacity between scenarios."
)

# GW, by scenario, by horizon year (France only — PPE3)
PPE3 = {
    's': {'low': {2030: 48.0, 2035: 55.0}, 'central': {2030: 48.0, 2035: 67.5}, 'high': {2030: 48.0, 2035: 80.0}},
    'w': {'low': {2030: 31.0, 2035: 35.0}, 'central': {2030: 31.0, 2035: 37.5}, 'high': {2030: 31.0, 2035: 40.0}},
}


def fr_path(t, scenario, last_year, last_gw):
    """France's GW at year Y >= last_year, following PPE3's scenario from the last observed value"""
    pts = [(last_year, last_gw)] + [(y, g) for y, g in PPE3[t][scenario].items() if y > last_year]

    def at(Y):
        if Y <= last_year:
            return last_gw
        for (y0, g0), (y1, g1) in zip(pts, pts[1:]):
            if Y <= y1:
                return g0 + (g1 - g0) * (Y - y0) / (y1 - y0)
        (ya, ga), (yb, gb) = pts[-2], pts[-1]
        return gb + (gb - ga) / (yb - ya) * (Y - yb)
    return at


def main():
    import json
    import os
    cap = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                       'data', 'history', 'capacity.json')))['countries']['FR']
    last_year = max(cap['years'])
    last_gw = {'s': cap['types']['Solar AC'][-1],
               'w': (cap['types']['Wind onshore'][-1] or 0) + (cap['types']['Wind offshore'][-1] or 0)}
    for t in 's', 'w':
        print('solar' if t == 's' else 'wind', f'(last observed: {last_year} = {last_gw[t]:.1f} GW)')
        for scen in ('low', 'central', 'high'):
            path = fr_path(t, scen, last_year, last_gw[t])
            print(' ', scen, {Y: round(path(Y), 1) for Y in (2026, 2028, 2030, 2032, 2035)})
    print(LIMITATIONS)


if __name__ == '__main__':
    main()
