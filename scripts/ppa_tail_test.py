#!/usr/bin/env python3
"""Out-of-sample test of the regional price model beyond its trained edge, on real hours.

ppa_lab.PriceModel learns, by season × time of day, the hour's price ÷ the month's average as a
function of the regional residual share x. Below the lowest bin a group has seen, it repeats that
bin ('flat'). Tested here against a 'mixture' tail (TailPriceModel): an hour is paid (price > 0)
with probability p, else at the unpaid hours' price; below the edge p keeps falling at its slope
over the lowest bins, the paid hours' price keeps falling at its own relative slope, and the unpaid
hours' price is the 5 % trimmed mean of the lowest bins' non-positive hours (the edge bin alone is a
few dozen hours, pulled by rare -500 €/MWh spikes). Bounded: never below that unpaid price.

Folds (train window → test years): 2016-2020 → 2023-2025, 2017-2021 → 2023-2025,
2018-2021+2023 → 2024-2025; 2022 left out everywhere, as in the pricer. Scored on the hours of the
test years whose REAL residual share fell below the older model's edge.

Result: on those real hours the mixture tail is better (paid share, paid value per solar and wind
MWh, all-hours mean) — but the pricer's own walk-forward (scripts/ppa_tail_walkforward.py) says the
opposite, because the pricer feeds the model a POTENTIAL residual share (past weather × this year's
fleet, before any curtailment), much deeper than the real one (2025 summer midday: median -0.01
synthetic vs +0.09 real): real oversupply is clipped by curtailment, exports and storage, so 'flat'
(saturation at the deepest real oversupply ever seen) is the better reading of a potential share.
TailPriceModel stays here, out of the pricer.

Writes data/history/ppa_tail_test.json
    python scripts/ppa_tail_test.py
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

OUT = os.path.join(ROOT, 'data', 'history', 'ppa_tail_test.json')
FOLDS = [([2016, 2017, 2018, 2019, 2020], [2023, 2024, 2025]),
         ([2017, 2018, 2019, 2020, 2021], [2023, 2024, 2025]),
         ([2018, 2019, 2020, 2021, 2023], [2024, 2025])]
NAMES = ['winter night', 'winter day', 'winter evening', 'summer night', 'summer day', 'summer evening']
TAIL_BINS = 5
TAIL_TRIM = 0.05


class TailPriceModel(L.PriceModel):
    """ppa_lab.PriceModel with the 'mixture' tail below each group's lowest filled bin"""

    def __init__(self, *args, **kw):
        super().__init__(*args, **kw)
        self.tails = {}
        for gi in range(self.mean.shape[0]):
            low = sorted(b for (g, b) in self.lists if g == gi)[:TAIL_BINS]
            if not low:
                continue
            xs = np.array([(b + self.lo) * L.BIN for b in low])
            ns = np.array([len(self.lists[(gi, b)]) for b in low], float)

            def slope(ys):
                if len(low) < 3:
                    return 0.0
                xm, ym = np.average(xs, weights=ns), np.average(ys, weights=ns)
                den = (ns * (xs - xm) ** 2).sum()
                return max(0.0, float((ns * (xs - xm) * (ys - ym)).sum() / den)) if den > 0 else 0.0
            b0 = low[0]
            p0, mpos0 = float(self.ppos[gi, b0]), float(self.mpos[gi, b0])
            cm = np.array([self.mpos[gi, b] / max(self.ppos[gi, b], 1e-6) for b in low])
            pooled = np.concatenate([self.lists[(gi, b)] for b in low])
            neg = np.sort(pooled[pooled <= 0])
            cut = int(len(neg) * TAIL_TRIM)
            neg = neg[cut:len(neg) - cut] if len(neg) > 2 * cut else np.zeros(1)
            pos = pooled[pooled > 0] if (pooled > 0).any() else np.zeros(1)
            self.tails[gi] = {'x': float(xs[0]), 'p': p0, 'pslope': slope(np.array([(self.lists[(gi, b)] > 0).mean() for b in low])),
                              'mpaid': mpos0 / p0 if p0 > 0 else 0.0, 'cslope': slope(np.log(cm)) if (cm > 0).all() else 0.0,
                              'mu': float(neg.mean()), 'pos': pos, 'neg': neg}

    def tail_at(self, x, g):
        """{group: (mask, p, paid hours' price)} for the x's below each group's edge"""
        out = {}
        for gi, t in self.tails.items():
            k = (g == gi) & (x < t['x'])
            if k.any():
                dx = x[k] - t['x']
                out[gi] = (k, np.clip(t['p'] + t['pslope'] * dx, 0.0, t['p']), t['mpaid'] * np.exp(t['cslope'] * dx))
        return out

    def expected(self, x, g):
        rm, rp, pp = super().expected(x, g)
        for gi, (k, p, mp) in self.tail_at(x, g).items():
            pp[k], rp[k] = p, p * mp
            rm[k] = p * mp + (1 - p) * self.tails[gi]['mu']
        return rm, rp, pp

    def draw(self, x, g):
        out = super().draw(x, g)
        for gi, (k, p, mp) in self.tail_at(x, g).items():
            t, n = self.tails[gi], int(k.sum())
            paid = L.RNG.random(n) < p
            pos = t['pos'][L.RNG.integers(0, len(t['pos']), n)] * (mp / t['pos'].mean() if t['pos'].mean() > 0 else 0.0)
            out[k] = np.where(paid, pos, t['neg'][L.RNG.integers(0, len(t['neg']), n)])
        return out


def realised(years, region=True):
    """x, group, ratio to the month's average, solar and wind output, for every hour of those years"""
    X, G, R, S, W = [], [], [], [], []
    for y in years:
        a = L.DATA[y]
        P = a['fr_p']
        mavg = np.array([P[a['month'] == m].mean() for m in a['month']])[:, None]
        ok = mavg[:, 0] > 5
        X.append(L.residual_share(a, region)[ok].ravel()); G.append(L.grp(a['month'])[ok].ravel())
        R.append((P / mavg)[ok].ravel()); S.append(a['fr_s'][ok].ravel()); W.append(a['fr_w'][ok].ravel())
    return [np.concatenate(v) for v in (X, G, R, S, W)]


def main():
    out = {'folds': []}
    tot = {k: {'flat': [], 'mixture': []} for k in ('paidShare', 'paidValueSolar', 'paidValueWind', 'meanSolar', 'meanWind')}
    for train, test in FOLDS:
        pm = TailPriceModel(train, True, 'mean', False)
        x, g, r, s, w = realised(test)
        edge = np.array([pm.tails[int(gi)]['x'] if int(gi) in pm.tails else -9 for gi in g])
        b = x < edge
        xb, gb, rb, sb, wb = x[b], g[b], r[b], s[b] + 1e-9, w[b] + 1e-9
        fold = {'train': train, 'test': test, 'hoursBelowEdge': int(b.sum()), 'hours': int(len(x)), 'groups': {}}
        for name, (rm, rp, pp) in (('flat', L.PriceModel.expected(pm, xb, gb)), ('mixture', pm.expected(xb, gb))):
            e = {'paidShare': np.average(pp, weights=sb) - np.average(rb > 0, weights=sb),
                 'paidValueSolar': np.average(rp, weights=sb) - np.average(np.maximum(rb, 0), weights=sb),
                 'paidValueWind': np.average(rp, weights=wb) - np.average(np.maximum(rb, 0), weights=wb),
                 'meanSolar': np.average(rm, weights=sb) - np.average(rb, weights=sb),
                 'meanWind': np.average(rm, weights=wb) - np.average(rb, weights=wb)}
            fold[name] = {k: float(v) for k, v in e.items()}
            for k, v in e.items():
                tot[k][name].append(abs(float(v)))
            for gi in np.unique(gb):
                k = gb == gi
                if k.sum() >= 30:
                    d = fold['groups'].setdefault(NAMES[int(gi)], {'hours': int(k.sum()), 'actualPaidShare': float((rb[k] > 0).mean()),
                                                                    'actualPaidValue': float(np.maximum(rb[k], 0).mean())})
                    d[name + 'PaidShare'], d[name + 'PaidValue'] = float(pp[k].mean()), float(rp[k].mean())
        out['folds'].append(fold)
        print(train[0], '-', train[-1], '→', test, 'hours below edge', fold['hoursBelowEdge'], 'of', fold['hours'])
        for name in ('flat', 'mixture'):
            print('   %-8s' % name, ' '.join(f'{k} {v:+.3f}' for k, v in fold[name].items()))
    out['meanAbsError'] = {k: {n: float(np.mean(v)) for n, v in d.items()} for k, d in tot.items()}
    print(json.dumps(out['meanAbsError'], indent=1))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
