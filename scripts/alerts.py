#!/usr/bin/env python3
"""Evaluate the site users' alert rules and e-mail the new alerts.

Rules live in Supabase (public.alert_rule, written by the site, js/alerts.js).
Run by GitHub Actions after each data fetch: for today and tomorrow (Paris)
it checks every active rule against the repository's data files, records
each triggered alert once in public.alert_event and e-mails it.

Rule kinds
  neg_price   at least `min_hours` (default 1) hours of negative day-ahead
              price in one of `zones`
  base_above  daily baseload above `threshold` €/MWh
  base_below  daily baseload below `threshold` €/MWh
  pp1, pp2    RTE signals a PP1 / PP2 peak-period day (France, data/rte_pp.json)
  ppa_move    the PPA benchmark (solar or wind) moved by `threshold` €/MWh or more over 7 days
              (data/history/ppa_benchmark.json)
  corr_break  a watched pair's correlation moved by `threshold` or more between the last year and
              the last 60 days (data/corr_watch.json, scripts/corr_watch.py)
  fwd_fr      the France-specific part of the day's French Cal+1 move (the part
              gas and CO₂ do not explain, as on Prices › Forward) above
              `threshold` €/MWh in absolute value

Environment
  SUPABASE_DB_URL (or WAREHOUSE_DB_URL)   database (owner role)
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_FROM
      mail server; without it alerts are recorded (sent_at null), not sent.
  ALERTS_DRY_RUN=1   evaluate and print, write nothing.
  ALERTS_DAYS=2026-10-17,2026-10-18   evaluate these days instead (tests).
"""
import json
import os
import smtplib
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

import psycopg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'data', 'history', 'daily')
PARIS = ZoneInfo('Europe/Paris')
SITE = 'https://tomsremy.github.io/PowerKlock/'


def day_file(d):
    try:
        with open(os.path.join(DAILY, d.isoformat() + '.json')) as f:
            return json.load(f).get('zones') or {}
    except (OSError, ValueError):
        return None


def pp_days():
    try:
        with open(os.path.join(ROOT, 'data', 'rte_pp.json')) as f:
            return json.load(f).get('days') or {}
    except (OSError, ValueError):
        return {}


def _load(path):
    try:
        with open(os.path.join(ROOT, 'data', *path.split('/'))) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def fwd_fr_move():
    """Last daily move of the French Cal+1 split into gas and CO₂ (6-month
    pass-through of the gas plant cost of the same delivery year, clean-spark
    convention: TTF ÷ 49.13 % + EUA × 0.202 ÷ 0.4913) and the France-specific
    rest. Same method as js/forward-read.js."""
    chain, cs = _load('history/fr_market_calchain.json'), _load('history/commodities_series.json')
    if not chain or not cs or 'FR' not in chain:
        return None
    y0 = datetime.now(PARIS).year
    yrs = sorted(int(y) for y in chain['FR']['years'])
    k = next((y for y in yrs if y > y0), yrs[0])
    fr = chain['FR']['years'][str(k)]
    gy = (cs.get('calYears') or {}).get('ttf', {}).get(str(k))
    gas = list(zip(gy['dates'], gy['values'])) if gy else (cs['series']['ttf']['points'])
    eua = cs['series']['eua']['points']

    def as_of(pts, d):
        v = None
        for x, y in pts:
            if x > d:
                break
            if y is not None:
                v = y
        return v
    rows = []
    for d, p in zip(fr['dates'], fr['values']):
        g, e = as_of(gas, d), as_of(eua, d)
        if p is not None:
            rows.append((d, p, g / 0.4913 + e * 0.202 / 0.4913 if g is not None and e is not None else None))
    if len(rows) < 30:
        return None
    pairs = [(b[2] - a[2], b[1] - a[1]) for a, b in zip(rows[-127:-1], rows[-126:]) if a[2] is not None and b[2] is not None]
    if len(pairs) < 10:
        return None
    mx = sum(x for x, _ in pairs) / len(pairs)
    my = sum(y for _, y in pairs) / len(pairs)
    sxx = sum((x - mx) ** 2 for x, _ in pairs)
    beta = max(0.0, min(1.2, sum((x - mx) * (y - my) for x, y in pairs) / sxx)) if sxx else 0.0
    (_, p0, c0), (d1, p1, c1) = rows[-2], rows[-1]
    if c0 is None or c1 is None:
        return None
    fc = beta * (c1 - c0)
    return {'day': date.fromisoformat(d1), 'k': k, 'p': p1, 'dp': p1 - p0, 'fc': fc, 'resid': p1 - p0 - fc, 'beta': beta}


def fmt_day(d):
    return d.strftime('%a %d %b')


def zone_stats(zones, z):
    h = (zones or {}).get(z, {}).get('hourly')
    if not isinstance(h, list) or not h:
        return None
    v = [x for x in h if x is not None]
    if not v or all(x == 0 for x in v):      # unpublished or broken (flat 0.00) feed
        return None
    per = len(h) / 24
    neg = [i for i, x in enumerate(h) if x is not None and x < 0]
    span = ''
    if neg:
        a, b = neg[0] / per, (neg[-1] + 1) / per
        span = f'{int(a):02d}:{int(a % 1 * 60):02d}–{int(b):02d}:{int(b % 1 * 60):02d}'
    return {'base': sum(v) / len(v), 'min': min(v), 'negH': len(neg) / per, 'span': span}


def evaluate(rules, days):
    """→ list of (rule, day, zone, detail)."""
    out = []
    pp = pp_days()
    fw = fwd_fr_move() if any(r['kind'] == 'fwd_fr' for r in rules) else None
    if fw and fw['day'] >= min(days) - timedelta(days=3):     # the latest session, not an old one
        for r in rules:
            if r['kind'] == 'fwd_fr' and r['threshold'] is not None and abs(fw['resid']) >= r['threshold']:
                out.append((r, fw['day'], 'FR', f'Cal {fw["k"]} France {fw["dp"]:+.2f} € on {fmt_day(fw["day"])} to {fw["p"]:.2f} €/MWh: '
                                             f'{fw["resid"]:+.2f} € France-specific, gas and CO₂ explain {fw["fc"]:+.2f} € (pass-through {fw["beta"] * 100:.0f} %).'))
    # PPA benchmark: the latest run against the one 7 days before
    if any(r['kind'] == 'ppa_move' for r in rules):
        b = (_load('history/ppa_benchmark.json') or {}).get('days') or {}
        ks = sorted(b)
        if ks and date.fromisoformat(ks[-1]) >= min(days) - timedelta(days=3):
            last = ks[-1]
            prev = [k for k in ks if k <= (date.fromisoformat(last) - timedelta(days=7)).isoformat()]
            if prev:
                for r in rules:
                    if r['kind'] != 'ppa_move' or r['threshold'] is None:
                        continue
                    for t, name in (('solar', 'solar'), ('wind', 'wind')):
                        a, c = (b[prev[-1]].get(t) or {}).get('ppa'), (b[last].get(t) or {}).get('ppa')
                        if a is not None and c is not None and abs(c - a) >= r['threshold']:
                            out.append((r, date.fromisoformat(last), 'FR', f'PPA benchmark {name} {c:.2f} €/MWh on {fmt_day(date.fromisoformat(last))}, '
                                                                         f'{c - a:+.2f} € over 7 days (from {a:.2f}).'))
    # correlation breaks of the watched pairs
    if any(r['kind'] == 'corr_break' for r in rules):
        w = _load('corr_watch.json') or {}
        wd = (w.get('updated') or '')[:10]
        if wd and date.fromisoformat(wd) >= min(days) - timedelta(days=3):
            for r in rules:
                if r['kind'] != 'corr_break':
                    continue
                thr = r['threshold'] if r['threshold'] is not None else 0.3
                for p in w.get('pairs') or []:
                    if abs(p['delta']) >= thr:
                        out.append((r, date.fromisoformat(wd), p['a'] + '/' + p['b'], f'Correlation {p["a"]} / {p["b"]}: {p["c365"]:+.2f} over a year, '
                                                                                f'{p["c60"]:+.2f} over 60 days ({"tightening" if p["delta"] > 0 else "breaking"}).'))
    for d in days:
        zones = day_file(d)
        for r in rules:
            kind = r['kind']
            if kind in ('fwd_fr', 'ppa_move', 'corr_break'):
                continue
            if kind in ('pp1', 'pp2'):
                e = pp.get(d.isoformat())
                if e and e.get(kind):
                    label = 'PP1' if kind == 'pp1' else 'PP2'
                    out.append((r, d, 'FR', f'{fmt_day(d)} is a {label} day (RTE peak-period signal).'))
                continue
            for z in r['zones'] or []:
                st = zone_stats(zones, z)
                if not st:
                    continue
                if kind == 'neg_price' and st['negH'] >= (r['min_hours'] or 1):
                    out.append((r, d, z, f'{z}: {st["negH"]:g} h of negative day-ahead prices on {fmt_day(d)} '
                                         f'(between {st["span"].replace("–", " and ")}, lowest {st["min"]:.2f} €/MWh).'))
                elif kind == 'base_above' and r['threshold'] is not None and st['base'] > r['threshold']:
                    out.append((r, d, z, f'{z}: baseload {st["base"]:.2f} €/MWh on {fmt_day(d)}, above {r["threshold"]:g}.'))
                elif kind == 'base_below' and r['threshold'] is not None and st['base'] < r['threshold']:
                    out.append((r, d, z, f'{z}: baseload {st["base"]:.2f} €/MWh on {fmt_day(d)}, below {r["threshold"]:g}.'))
    return out


def smtp_ready():
    return all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'))


def send(to, items):
    msg = EmailMessage()
    msg['Subject'] = 'PowerKlock alert: ' + (items[0] if len(items) == 1 else f'{len(items)} alerts')[:120]
    msg['From'] = os.environ.get('ALERT_FROM') or os.environ['SMTP_USER']
    msg['To'] = to
    body = '\n'.join('• ' + x for x in items)
    msg.set_content(f'{body}\n\nPowerKlock · {SITE}\nManage your alerts on the site (bell icon in the top bar).\n')
    with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT') or 587), timeout=60) as s:
        s.starttls()
        s.login(os.environ['SMTP_USER'], os.environ['SMTP_PASS'])
        s.send_message(msg)


def main():
    db = os.environ.get('SUPABASE_DB_URL') or os.environ.get('WAREHOUSE_DB_URL')
    if not db:
        print('No database URL: alerts skipped.')
        return 0
    dry = os.environ.get('ALERTS_DRY_RUN') == '1'
    today = datetime.now(PARIS).date()
    days = [today, today + timedelta(days=1)]
    if os.environ.get('ALERTS_DAYS'):   # testing: comma-separated ISO days
        days = [date.fromisoformat(x) for x in os.environ['ALERTS_DAYS'].split(',')]
    with psycopg.connect(db, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            cur.execute("select to_regclass('public.alert_rule') is not null")
            if not cur.fetchone()[0]:
                print('public.alert_rule does not exist yet (run the warehouse sync once).')
                return 0
            cur.execute("""select r.id, r.user_id, r.kind, r.zones, r.min_hours, r.threshold, r.email, u.email
                           from public.alert_rule r join auth.users u on u.id = r.user_id where r.active""")
            cols = ['id', 'user_id', 'kind', 'zones', 'min_hours', 'threshold', 'want_email', 'address']
            rules = [dict(zip(cols, row)) for row in cur.fetchall()]
        hits = evaluate(rules, days)
        print(f'{len(rules)} active rules, {len(hits)} conditions met for {days[0]} and {days[1]}')
        if dry:
            for r, d, z, detail in hits:
                print('  ', r['address'], '·', detail)
            return 0
        new = []
        with conn.cursor() as cur:
            for r, d, z, detail in hits:
                cur.execute("""insert into public.alert_event (rule_id, user_id, day, zone, detail) values (%s, %s, %s, %s, %s)
                               on conflict (rule_id, day, zone) do nothing returning id""", (r['id'], r['user_id'], d, z, detail))
                row = cur.fetchone()
                if row:
                    new.append((row[0], r, detail))
        conn.commit()
        print(f'{len(new)} new alerts')
        if not new:
            return 0
        if not smtp_ready():
            print('SMTP not configured: alerts recorded, not e-mailed.')
            return 0
        by_user = defaultdict(list)
        for eid, r, detail in new:
            if r['want_email'] and r['address']:
                by_user[r['address']].append((eid, detail))
        for addr, items in by_user.items():
            try:
                send(addr, [x for _, x in items])
                with conn.cursor() as cur:
                    cur.execute('update public.alert_event set sent_at = now() where id = any(%s)', ([e for e, _ in items],))
                conn.commit()
                print(f'  sent {len(items)} to {addr.split("@")[0][:2]}…@{addr.split("@")[-1]}')
            except Exception as e:
                print(f'  ! mail to {addr.split("@")[-1]} failed: {e}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
