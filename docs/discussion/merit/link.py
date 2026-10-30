import sys
sys.path.insert(0, '/tmp/mo')
from try1 import *
for y in (2021, 2023, 2024, 2025):
    Yd = YS[y]; P = Yd['price']; DE = Yd['de']; ex = -Yd['fr']['link']; ok = np.isfinite(DE)
    lo = ok & (P < DE - 5); hi = ok & (P > DE + 5); eq = ok & (np.abs(P - DE) <= 5)
    print(y, 'hours FR cheaper %d, dearer %d, equal %d | FR→CWE export when FR cheaper: p10/50/90 %s | when equal p50/p90 %s | p99 all %.0f' % (
        lo.sum(), hi.sum(), eq.sum(), np.percentile(ex[lo], [10, 50, 90]).round(), np.percentile(ex[eq], [50, 90]).round(), np.percentile(ex[ok], 99)))
