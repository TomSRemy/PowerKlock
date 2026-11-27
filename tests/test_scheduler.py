"""The PowerKlock scheduler (workers/scheduler): its schedule matches the workflows, and it starts the right jobs.

- every job in schedule.json exists, can be started from outside (workflow_dispatch), and gets only inputs it defines;
- no job keeps a GitHub schedule of its own (it would run twice), except the safety net in 'github_fallback';
- a job that reads its slot (github.event.schedule) gets it from the scheduler as inputs.cron;
- every cron expression is valid;
- the Worker's own cron matching (index.js, run with node) gives exactly the jobs an independent implementation
  here gives, minute by minute, over weeks in winter, in summer and around the changes of time.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.path.join(ROOT, '.github', 'workflows')
S = json.load(open(os.path.join(ROOT, 'workers', 'scheduler', 'schedule.json')))
PARIS = ZoneInfo('Europe/Paris')
errors = []
BOUNDS = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]


def check(ok, msg):
    if not ok:
        errors.append(msg)


def part(spec, v, lo, hi):
    def one(x):
        for s in spec.split(','):
            rng, _, step = s.partition('/')
            if rng == '*':
                a, b = lo, hi
            elif '-' in rng:
                a, b = map(int, rng.split('-'))
            else:
                a = int(rng)
                b = hi if step else a
            if a <= x <= b and (x - a) % int(step or 1) == 0:
                return True
        return False
    return one(v) or (hi == 7 and v == 0 and one(7))


def matches(cron, t):
    mi, h, dom, mon, dow = cron.split()
    f = [t.minute, t.hour, t.day, t.month, (t.weekday() + 1) % 7]
    d1, d2 = part(dom, f[2], 1, 31), part(dow, f[4], 0, 7)
    day = (d1 and d2) if '*' in (dom, dow) else (d1 or d2)
    return part(mi, f[0], 0, 59) and part(h, f[1], 0, 23) and part(mon, f[3], 1, 12) and day


def valid(cron):
    fs = cron.split()
    if len(fs) != 5:
        return False
    for spec, (lo, hi) in zip(fs, BOUNDS):
        for s in spec.split(','):
            rng, _, step = s.partition('/')
            if step and (not step.isdigit() or int(step) < 1):
                return False
            if rng == '*':
                continue
            for x in rng.split('-'):
                if not x.isdigit() or not lo <= int(x) <= hi:
                    return False
    return True


def due(t):
    out = []
    for j in S['jobs']:
        for zone, tt in (('utc', t), ('paris', t.astimezone(PARIS))):
            if any(matches(c, tt) for c in j.get(zone, [])) and j['workflow'] not in out:
                out.append(j['workflow'])
    return out


# ── the schedule against the workflows ──
names = [j['workflow'] for j in S['jobs']]
check(len(names) == len(set(names)), 'a workflow is listed twice in schedule.json')
for j in S['jobs']:
    w = j['workflow']
    p = os.path.join(WF, w)
    if not os.path.exists(p):
        check(False, f'{w}: no such workflow')
        continue
    t = open(p).read()
    check('workflow_dispatch:' in t, f'{w}: cannot be started by the scheduler (no workflow_dispatch)')
    check(j.get('utc') or j.get('paris'), f'{w}: no time given')
    for c in j.get('utc', []) + j.get('paris', []):
        check(valid(c), f'{w}: invalid cron "{c}"')
    m = re.search(r'\n  workflow_dispatch:[^\n]*\n((?:    .*\n|\s*\n)*)', t)
    block = m.group(1) if m else ''
    defined = set(re.findall(r'\n      (\w+):\n', '\n' + block))
    for name, body in re.findall(r'\n      (\w+):\n((?:        .*\n)+)', '\n' + block):
        check(not (re.search(r'required:\s*true', body) and 'default:' not in body), f'{w}: input "{name}" is required without a default')
    given = set(j.get('inputs', {})) | ({'cron'} if j.get('pass_cron') else set())
    check(given <= defined, f'{w}: the scheduler gives inputs the workflow does not define: {sorted(given - defined)}')
    has_sched = re.search(r'\n  schedule:\s*\n', t) is not None
    check(has_sched == (w in S['github_fallback']),
          f'{w}: ' + ('keeps its own GitHub schedule: it would run twice' if has_sched else 'is a fallback but has no GitHub schedule'))
    if 'github.event.schedule' in t:
        check(j.get('pass_cron') and 'inputs.cron' in t, f'{w}: reads github.event.schedule but does not get inputs.cron')
for f in sorted(os.listdir(WF)):
    if f.endswith('.yml') and re.search(r'\n  schedule:\s*\n', open(os.path.join(WF, f)).read()):
        check(f in names, f'{f}: scheduled on GitHub only (add it to workers/scheduler/schedule.json)')

# ── a few slots that must hold ──
def at(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


for when, job, expected in [
    ('2026-11-24T06:00', 'morning_mail.yml', True),    # 07:00 Paris in winter, Tuesday
    ('2026-07-07T05:00', 'morning_mail.yml', True),    # 07:00 Paris in summer
    ('2026-07-07T06:00', 'morning_mail.yml', True),    # 08:00 Paris: the retry
    ('2026-11-28T06:00', 'morning_mail.yml', False),   # Saturday
    ('2026-11-23T07:00', 'morning_mail.yml', True),    # Monday 08:00 Paris: PowerBrunch (the owner, 25 Nov. 2026)
    ('2026-11-30T06:00', 'morning_mail.yml', True),    # Monday 07:00: 7 O'Klock too (the owner, 27 Nov. 2026)
    ('2026-11-30T08:00', 'morning_mail.yml', True),    # Monday 09:00: PowerBrunch's retry
    ('2026-11-24T09:00', 'morning_mail.yml', False),   # Tuesday 10:00: no PowerBrunch
    ('2026-11-24T07:00', 'reel.yml', True),            # 08:00 Paris in winter
    ('2026-07-07T06:00', 'reel.yml', True),            # 08:00 Paris in summer
    ('2026-07-07T07:00', 'reel.yml', False),
    ('2026-11-24T05:40', 'fetch_news.yml', True),      # 06:40 Paris
    ('2026-11-24T20:40', 'fetch_news.yml', False),     # 21:40 Paris
    ('2026-11-28T08:40', 'fetch_news.yml', True),      # Saturday 09:40 Paris
    ('2026-11-28T09:40', 'fetch_news.yml', False),
    ('2026-11-24T12:47', 'fetch_jao.yml', True),
    ('2026-11-24T12:47', 'fetch.yml', True),
    ('2026-12-01T08:00', 'refresh_meta_token.yml', True),
    ('2026-12-02T08:00', 'refresh_meta_token.yml', False),
    ('2026-11-29T04:20', 'ppa_lab.yml', True),         # Sunday
]:
    check((job in due(at(when))) == expected, f'{job} at {when} UTC: expected {"a start" if expected else "nothing"}')

# ── the Worker's own matching, minute by minute, against this one ──
minutes = []
for start, days in (('2026-11-23T00:00', 7), ('2026-03-28T00:00', 2), ('2026-10-24T00:00', 2), ('2026-06-29T00:00', 7), ('2026-12-01T00:00', 1)):
    t0 = at(start)
    minutes += [t0 + timedelta(minutes=m) for m in range(days * 1440)]
NODE = """
const m = await import(process.argv[1]);
const ts = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(JSON.stringify(ts.map((t) => m.due(new Date(t)).map(([w]) => w))));
"""
try:
    r = subprocess.run(['node', '--input-type=commonjs', '-e', f'(async()=>{{{NODE}}})()', 'file://' + os.path.join(ROOT, 'workers', 'scheduler', 'index.js')],
                       input=json.dumps([t.isoformat() for t in minutes]), capture_output=True, text=True, timeout=120)
    js = json.loads(r.stdout) if r.returncode == 0 else None
    check(js is not None, f'the Worker could not be run with node: {r.stderr[-400:]}')
except FileNotFoundError:
    js = None
    print('node not found: the Worker itself not checked')
if js:
    bad = [(t, a, sorted(b)) for t, a, b in zip(minutes, (due(t) for t in minutes), js) if sorted(a) != sorted(b)]
    for t, a, b in bad[:5]:
        check(False, f'{t:%Y-%m-%d %H:%M} UTC: the Worker starts {b}, expected {sorted(a)}')
    starts = sum(len(x) for x in js)
    print(f'{len(minutes)} minutes compared, {starts} job starts, {len(bad)} differences')

# every workflow file is valid YAML: GitHub runs none of a file it cannot read, without an error anywhere but the
# Actions tab (an apostrophe inside a '…' description broke the newsletter for a morning, 25 Nov. 2026)
import yaml  # noqa: E402
for f in sorted(os.listdir(WF)):
    if f.endswith(('.yml', '.yaml')):
        try:
            yaml.safe_load(open(os.path.join(WF, f), encoding='utf-8'))
        except yaml.YAMLError as e:
            check(False, f'{f} is not valid YAML: {str(e).splitlines()[-1].strip()}')

if errors:
    print('\n'.join('✗ ' + e for e in errors))
    sys.exit(1)
print(f'✓ scheduler: {len(S["jobs"])} jobs, schedule and Worker agree')
