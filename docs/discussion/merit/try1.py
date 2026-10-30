import sys, json, itertools
sys.path.insert(0, '/tmp/mo')
import merit as M
import numpy as np
YS = {y: M.year(y) for y in range(2019, 2026)}
def go(prm, years=(2020, 2021), verbose=False):
    res = {}
    for y in years:
        pp = M.prev_params(YS[y - 1] if y - 1 != 2022 else YS[2021])
        p = dict(prm); p['rF'] = {2025: 0.2}.get(y, prm.get('rF', 0.0))
        pf, pc = M.run(YS[y], pp, p)
        res[y] = M.score(YS[y], pf)
        if verbose:
            s = res[y]; print(y, 'MAE %.1f bias %+.1f | solar all %+.2f curt %+.2f | wind all %+.2f curt %+.2f' % (s['mae'], s['bias'], *s['solar'], *s['wind']), flush=True)
    return res
if __name__ == '__main__':
    prm = dict(rR=0.5, b_lo=0.0, b_hi=0.8, ps_use=0.7)
    go(prm, (2020, 2021, 2023, 2024, 2025), True)
