# Great Britain as a fourth neighbour, its fleet growing: its size each year read on its own output (the 99.5th
# percentile of the hour, NESO), the delivery year's at the trend of the last three known years
exec(open('/tmp/patch_gb.py').read())
import numpy as _np2, json as _j2
_GBC = {}
for _yy in range(2016, 2031):
    try:
        _dd = _j2.load(open(f'data/history/gb_hourly/{_yy}.json'))['days']
    except OSError:
        continue
    for _k in 'sw':
        _arr = _np2.array([v for d_ in _dd.values() for v in (d_.get(_k) or []) if v is not None], float)
        if len(_arr) > 5000:
            _GBC[(_k, _yy)] = float(_np2.percentile(_arr, 99.5)) / 1000


def _gb_cap(t, y):
    return _GBC.get((t, y))


def _gb_guess(t, Y, last):
    ys = [y for y in range(last - 2, last + 1) if (t, y) in _GBC]
    if not ys:
        return 1.0
    if len(ys) == 1 or Y <= last:
        return _GBC[(t, min(Y, ys[-1]))] if (t, min(Y, ys[-1])) in _GBC else _GBC[(t, ys[-1])]
    b = _np2.polyfit(ys, [_GBC[(t, y)] for y in ys], 1)[0]
    return _GBC[(t, ys[-1])] + max(b, 0) * (Y - ys[-1])


L.cap = lambda c, t, y: (_gb_cap(t, y) or 1.0) if c == 'GB' else _cap0(c, t, y)
L.cap_guess = lambda c, t, Y, last: _gb_guess(t, Y, last) if c == 'GB' else _cg0(c, t, Y, last)
