"""Extracts the figures the three mockups need from data/history/daily into data.json (FR zone)."""
import json, glob, os, sys
ROOT = '/home/claude/powerklock/data/history/daily/'
D = sys.argv[1] if len(sys.argv) > 1 else '2026-11-27'
fs = sorted(f for f in glob.glob(ROOT + '*.json') if os.path.basename(f)[:-5] <= D)
def fr(f):
    z = json.load(open(f))['zones'].get('FR') or {}
    h = z.get('hourly') or []
    if len(h) == 24: h = [v for v in h for _ in range(4)]
    return {'d': os.path.basename(f)[:-5], 'avg': z.get('avg'), 'min': z.get('min'), 'max': z.get('max'), 'negH': z.get('negH'), 'q': h}
days = [x for x in (fr(f) for f in fs[-400:]) if x['avg'] is not None]
t, y = days[-1], days[-2]
assert t['d'] == D and len(t['q']) == 96
prev30 = days[-31:-1]
# how long since a higher quarter-hour / a higher daily average
def since(key):
    n = 0
    for x in reversed(days[:-1]):
        if x[key] is not None and x[key] >= t[key]: return n, x['d']
        n += 1
    return n, None
streak = 0
for a, b in zip(reversed(days[:-1]), reversed(days[1:])):
    if b['avg'] > a['avg']: streak += 1
    else: break
out = {'d': D, 'avg': t['avg'], 'min': t['min'], 'max': t['max'], 'negH': t['negH'], 'q': t['q'],
       'y': {'d': y['d'], 'avg': y['avg'], 'q': y['q'] if len(y['q']) == 96 else None},
       'avg30': round(sum(x['avg'] for x in prev30) / len(prev30), 2),
       'd30': [{'d': x['d'], 'avg': x['avg']} for x in prev30],
       'q30': [[round(v, 1) for v in x['q']] for x in prev30 if len(x['q']) == 96],
       'sinceMax': since('max'), 'sinceAvg': since('avg'), 'streak': streak, 'streakFrom': days[-1 - streak]['avg']}
json.dump(out, open('data.json', 'w'), separators=(',', ':'))
print({k: v for k, v in out.items() if k not in ('q', 'q30', 'd30', 'y')}, len(out['q30']), os.path.getsize('data.json'))
print('min at', t['q'].index(min(t['q'])), 'max at', t['q'].index(max(t['q'])), [x['avg'] for x in prev30])
