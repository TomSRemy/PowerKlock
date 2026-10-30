# the current rule (RegimeRule, as in the generator) on true data: train years → test year, same scores
import sys, json, numpy as np
sys.path.insert(0, '/tmp/fd'); import fdisp as FD; from fit import score
G, L = FD.G, FD.L
for tr, te in (([2023], 2024), ([2024], 2025), ([2025], 2026), ([2024, 2025], 2026)):
    fy = tr + tr[-1:]
    pm = G.RegimeRule(fy, True, True)
    for y in (te,) + tuple(tr):
        a = L.DATA[y]; I = FD.year_inputs(y); c = I['C']
        g = G.PriceModelFuel.groups(a['month'], [L.day_kind(d) for d in a['days']])
        x, xf = G.year_share(y, True), G.year_share(y, False)
        need = G.export_need(a['fr_s'], a['fr_w'], a['fr_l'], G.fr_avail(y)) - G.fr_jmax(y) / 1000
        f1, _, _ = pm.phi(x, g, xf, c, None, need, xf)
        print('rule train', tr, 'year', y, 'test' if y == te else 'train', {k: round(v, 2) for k, v in score(f1 * c, I).items()})
