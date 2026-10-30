import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
prm = {'rR': 0.9, 'ps_use': 0.1, 'eff': False, 'nuc_curve': True}
for y in (2023, 2024, 2025):
    Yd = YS[y]; pp = M.prev_params(YS[y - 1] if y - 1 != 2022 else YS[2021]); p = dict(prm); p['rF'] = {2025: 0.2}.get(y, 0.0)
    pf, pc = M.run(Yd, pp, p); P = Yd['price']; DE = Yd['de']; ok = np.isfinite(DE)
    dec_a = ok & (P < DE - 5); dec_m = pf < pc - 5
    print(y, 'CWE vs DE: MAE %.1f bias %+.1f | FR MAE %.1f | decoupled hours actual %d model %d, both %d' % (
        np.abs(pc - DE)[ok].mean(), (pc - DE)[ok].mean(), np.abs(pf - P).mean(), dec_a.sum(), dec_m.sum(), (dec_a & dec_m).sum()))
    for lab, s in (('actual decoupled', dec_a), ('actual coupled', ok & ~dec_a)):
        print('    %-18s FR actual %6.1f model %6.1f | DE actual %6.1f CWE model %6.1f' % (lab, P[s].mean(), pf[s].mean(), DE[s].mean(), pc[s].mean()))
