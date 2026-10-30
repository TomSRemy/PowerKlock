import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
for y in (2023, 2024, 2025):
    Yd = YS[y]; P = Yd['price']; DE = Yd['de']; ok = np.isfinite(DE); ex = -Yd['fr']['link']; rs = Yd['rest']; fr = Yd['fr']
    dec = ok & (P < DE - 5)
    X = np.column_stack([np.ones(dec.sum()), rs['wind'][dec] / 1e3, rs['solar'][dec] / 1e3, rs['load'][dec] / 1e3, fr['load'][dec] / 1e3, fr['wind'][dec] / 1e3, fr['solar'][dec] / 1e3])
    b, *_ = np.linalg.lstsq(X, ex[dec] / 1e3, rcond=None)
    pred = X @ b; r2 = 1 - ((ex[dec] / 1e3 - pred) ** 2).sum() / ((ex[dec] / 1e3 - ex[dec].mean() / 1e3) ** 2).sum()
    print(y, 'export at cut-off (GW) = %.1f %+.3f·CWE wind %+.3f·CWE solar %+.3f·CWE load %+.3f·FR load %+.3f·FR wind %+.3f·FR solar  R² %.2f' % (*b, r2))
    m = Yd['month']
    print('    median by month', [round(float(np.median(ex[dec & (m == k)[:, None]])) / 1e3, 1) if (dec & (m == k)[:, None]).sum() > 30 else None for k in range(1, 13)])
