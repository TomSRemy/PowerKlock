# Great Britain as a fourth neighbour of the regional share (test): its wind, solar, nuclear and demand from the drawn
# days, its fleet held at its observed output (no capacity series for GB in the site: no growth)
import json as _j, os as _o, numpy as _np
for _y, _a in L.DATA.items():
    _f = f'data/history/gb_hourly/{_y}.json'
    _d = _j.load(open(_f))['days'] if _o.path.exists(_f) else {}
    for _k, _src in (('s', 's'), ('w', 'w'), ('l', 'l'), ('n', 'n')):
        _a['GB_' + _k] = _np.array([[x or 0 for x in (_d.get(str(dd)[:10], {}).get(_src) or [0] * 24)] for dd in _a['days']], float)
    if not _d:
        _a['GB_l'] = _np.ones_like(_a['GB_l'])
_cap0, _cg0 = L.cap, L.cap_guess
L.cap = lambda c, t, y: 1.0 if c == 'GB' else _cap0(c, t, y)
L.cap_guess = lambda c, t, Y, last: 1.0 if c == 'GB' else _cg0(c, t, Y, last)
L.NEIGH = L.NEIGH + ('GB',)
G.CS = ('FR',) + L.NEIGH
G.PRE['GB'] = 'GB_'
