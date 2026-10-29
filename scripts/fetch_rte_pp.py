#!/usr/bin/env python3
"""PP1 / PP2 peak-period days (French capacity mechanism) from RTE's Signal API.

RTE signals PP1 days the day before at about 09:30 and PP2-only days at
about 19:00 (Paris), November to March. The API needs a free RTE Data
Portal account (data.rte-france.com) subscribed to the "Signal" API; its
client id and secret go in the GitHub secrets RTE_CLIENT_ID and
RTE_CLIENT_SECRET. Without them the script does nothing.

Writes data/rte_pp.json:
  {"updated", "source", "days": {"YYYY-MM-DD": {"pp1": bool, "pp2": bool}}}
The raw API answer of the last call is kept in data/rte_pp_raw.json so the
parser can be checked against the live format.
"""
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'rte_pp.json')
RAW = os.path.join(ROOT, 'data', 'rte_pp_raw.json')
TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/'
SIGNAL_URL = os.environ.get('RTE_PP_URL', 'https://digital.iservices.rte-france.com/open_api/signal/v1/signals')


LAST_ERROR = []


def note(msg):
    """Shown in the GitHub run summary (annotations are public, logs are not), and kept for rte_pp.json."""
    print('::warning::' + msg)
    LAST_ERROR.append(msg[:160])


def record_failure():
    """A failed call keeps the signalled days and says why, so the Data status page shows it (no secret in it)."""
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    old.update({'checked': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'error': ' · '.join(LAST_ERROR)[:300]})
    old.setdefault('days', {})
    with open(OUT, 'w') as f:
        json.dump(old, f, separators=(',', ':'))


def http(req):
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def token(cid, secret):
    req = urllib.request.Request(TOKEN_URL, data=b'', method='POST', headers={
        'Authorization': 'Basic ' + base64.b64encode(f'{cid}:{secret}'.encode()).decode(),
        'Content-Type': 'application/x-www-form-urlencoded'})
    code, body = http(req)
    if code != 200:
        note(f'RTE token: HTTP {code} {body[:200]}')
        return None
    return json.loads(body)['access_token']


def call(tok, start, end):
    """Try the documented resource with and without a date window, v1 then v2."""
    fmt = lambda d: d.strftime('%Y-%m-%dT00:00:00+01:00')
    q = '?' + urllib.parse.urlencode({'start_date': fmt(start), 'end_date': fmt(end)})
    urls = [SIGNAL_URL + q, SIGNAL_URL, SIGNAL_URL.replace('/v1/', '/v2/') + q, SIGNAL_URL.replace('/v1/', '/v2/')]
    for url in urls:
        code, body = http(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok, 'Accept': 'application/json'}))
        path = url.split('open_api')[-1].split('?')[0] + (' (dates)' if '?' in url else '')
        if code == 200:
            print(f'RTE Signal API OK: {path}')
            return json.loads(body) if body.strip() else {}
        note(f'RTE Signal {path}: HTTP {code} {body[:200]}')
    return None


def parse(obj, days):
    """Walk the answer: any object carrying a date and a PP1/PP2 indication."""
    if isinstance(obj, list):
        for x in obj:
            parse(x, days)
        return
    if not isinstance(obj, dict):
        return
    text = json.dumps(obj).upper()
    d = None
    for k, v in obj.items():
        if isinstance(v, str) and re.match(r'^\d{4}-\d{2}-\d{2}', v) and any(t in k.lower() for t in ('date', 'day', 'jour', 'start')):
            d = v[:10]
            break
    flat = {k.lower(): v for k, v in obj.items() if not isinstance(v, (dict, list))}
    if d:
        pp1 = bool(flat.get('pp1')) or 'PP1' in str(flat.get('signal_type', '')).upper() or '"PP1"' in text
        pp2 = bool(flat.get('pp2')) or 'PP2' in str(flat.get('signal_type', '')).upper() or '"PP2"' in text or pp1
        if pp1 or pp2:
            e = days.setdefault(d, {'pp1': False, 'pp2': False})
            e['pp1'] |= pp1
            e['pp2'] |= pp2
    for v in obj.values():
        if isinstance(v, (dict, list)):
            parse(v, days)


def main():
    cid, secret = os.environ.get('RTE_CLIENT_ID'), os.environ.get('RTE_CLIENT_SECRET')
    if not cid or not secret:
        print('RTE_CLIENT_ID / RTE_CLIENT_SECRET not set: PP signals skipped.')
        return 0
    today = date.today()
    start, end = today - timedelta(days=30), today + timedelta(days=2)
    tok = token(cid, secret)
    ans = call(tok, start, end) if tok else None
    if ans is None:
        record_failure()
        return 1
    with open(RAW, 'w') as f:
        json.dump(ans, f, indent=1)
    old = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            old = json.load(f).get('days', {})
    days = {}
    parse(ans, days)
    old.update(days)
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'checked': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'RTE Data Portal, Signal API (PP1 / PP2 peak-period days)',
                   'days': dict(sorted(old.items()))}, f, separators=(',', ':'))
    print(f'rte_pp.json: {len(days)} signalled days in the last call, {len(old)} in total')
    return 0


if __name__ == '__main__':
    sys.exit(main())
