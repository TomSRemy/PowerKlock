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
from datetime import date, datetime, timedelta, timezone
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
    for d in days:
        zones = day_file(d)
        for r in rules:
            kind = r['kind']
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
