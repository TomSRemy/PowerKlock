import sys, json, time, numpy as np
from scipy.optimize import minimize
sys.path.insert(0, '/tmp/fd'); import fdisp as FD
G, L = FD.G, FD.L
KEYS = ['kappa', 'mfrac', 'ufrac', 'ctop', 'btop', 'cbot', 'bbot', 'kramp', 'must', 'hyd_e', 'xo', 'xs']
LO = np.array([0, .35, .5, -20, 0, -30, 0, 0, 0, .1, 0, .5]); HI = np.array([60, .9, .98, 80, 1.2, 60, 1.0, 30, 15000, .7, 16000, 1.6])
def th_of(z):
    v = LO + (HI - LO) / (1 + np.exp(-np.asarray(z)))
    th = dict(FD.P0); th.update(dict(zip(KEYS, v))); return th
def z_of(th):
    v = np.array([th.get(k, 0.0) for k in KEYS], float); v = np.clip((v - LO) / (HI - LO), 1e-3, 1 - 1e-3); return np.log(v / (1 - v))
def score(p, I):
    P = I['P']; k = np.isfinite(p) & np.isfinite(P); e = np.abs(p - P)
    S, W = I['S'], I['W']
    return dict(base=float(e[k].mean()), wind=float((W * e)[k].sum() / W[k].sum()), solar=float((S * e)[k].sum() / S[k].sum()),
                bias_w=float((W * (p - P))[k].sum() / W[k].sum() - (p - P)[k].mean()), bias_s=float((S * (p - P))[k].sum() / S[k].sum() - (p - P)[k].mean()))
def obj_years(ys):
    Is = [FD.year_inputs(y) for y in ys]
    def f(z):
        th = th_of(z); s = [score(FD.year_prices(I, th), I) for I in Is]
        return float(np.mean([x['base'] + x['wind'] + x['solar'] for x in s]))
    return f, Is
if __name__ == '__main__':
    tr = [int(y) for y in sys.argv[1].split(',')]; te = int(sys.argv[2]); tag = sys.argv[3]
    f, Is = obj_years(tr)
    th0 = dict(FD.P0, btop=0.0, bbot=0.0)
    z = z_of(th0); t0 = time.time(); best = [1e9, None]
    def cb(zz):
        pass
    r = minimize(f, z, method='Nelder-Mead', options=dict(maxfev=int(sys.argv[4]) if len(sys.argv) > 4 else 500, xatol=1e-3, fatol=1e-3, adaptive=True))
    th = th_of(r.x)
    It = FD.year_inputs(te)
    out = dict(train=tr, test=te, fun=r.fun, nfev=r.nfev, secs=time.time() - t0, theta={k: round(float(th[k]), 3) for k in KEYS},
               train_score=[score(FD.year_prices(I, th), I) for I in Is], test_score=score(FD.year_prices(It, th), It))
    json.dump(out, open(f'/tmp/fd/fit_{tag}.json', 'w'), indent=1); print(json.dumps(out, indent=1))
