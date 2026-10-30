# the Core neighbours the Netherlands and Austria added to the regional share (data/history/region_hourly, capacity.json)
import json as _j, os as _o, numpy as _np
for _y, _a in L.DATA.items():
    _f = f'data/history/region_hourly/{_y}.json'
    _rg = _j.load(open(_f))['countries'] if _o.path.exists(_f) else {}
    for _c in ('NL', 'AT'):
        for _k in 'swln':
            _src = (_rg.get(_c) or {}).get(_k) or {}
            _a[f'{_c}_{_k}'] = _np.array([[x or 0 for x in (_src.get(str(dd)[:10]) or [0] * 24)] for dd in _a['days']], float)
        if not _rg.get(_c):
            _a[f'{_c}_l'] = _np.ones_like(_a[f'{_c}_l'])
L.NEIGH = L.NEIGH + ('NL', 'AT')
G.CS = ('FR',) + L.NEIGH
G.PRE.update({'NL': 'NL_', 'AT': 'AT_'})
