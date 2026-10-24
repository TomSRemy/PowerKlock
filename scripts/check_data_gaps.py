"""
Holes in PowerKlock's histories: what is missing where it should be, since when, and whether it
came back. The freshness of each source (is the last update recent?) is on the Data status page;
this is the other half: a day, a zone or a slot missing inside a series, which silently biases
every average, capture rate and chart built on it.

Checks (each issue has a stable id, so it is followed run after run):
  prices      day-ahead daily files, last 400 days: file missing, or a main zone without prices
              (today after 01:00 UTC, tomorrow after 13:30 UTC)
  generation  France production arrays in the daily files, last 60 days (< 88 of 96 quarter-hours)
  rte         RTE éCO2mix month files, from the 1st of last month to yesterday: day missing or
              production / load incomplete
  commodities Brent, TTF, EUA, API2 coal, EU storage: two business days or more missing in a row
              (last 120 days), or the last close older than 4 business days
  forwards    France Cal+1 settlement older than 4 business days
  cr          ODRÉ output of the parks under complément de rémunération: months up to M-2
  activation  mFRR activation prices, last 60 days
  pricecheck  days whose day-ahead average differs from Energy-Charts by more than 0.5 €/MWh

Repairs: prices and generation are fetched again by scripts/heal_price_gaps.py and the retry
slots of the data fetch; the others are flagged here until their job brings them back.

Out  data/data_gaps.json  {"updated", "open": [...], "resolved": [...last 30 days]}
     issue = {id, dataset, what, since (first seen), lastSeen, repair}
"""
import json, os
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'data_gaps.json')
KEY = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'PT', 'IT_NORD', 'CH', 'AT']
NOW = datetime.now(timezone.utc)
TODAY = NOW.date()


def load(rel):
    try:
        return json.load(open(os.path.join(ROOT, rel)))
    except Exception:
        return None


def bdays_between(a, b):
    """business days strictly after a, up to and including b"""
    n, d = 0, a + timedelta(days=1)
    while d <= b:
        n += d.weekday() < 5
        d += timedelta(days=1)
    return n


def checks():
    out = []
    add = lambda dataset, key, what, repair: out.append({'id': f'{dataset}:{key}', 'dataset': dataset, 'what': what, 'repair': repair})
    # prices and generation, daily files
    last_day = TODAY + timedelta(days=1) if NOW.hour * 60 + NOW.minute >= 13 * 60 + 30 else TODAY
    for k in range(-1, 400):
        d = last_day - timedelta(days=k + 1) if k >= 0 else last_day
        if d > last_day:
            continue
        j = load(f'data/history/daily/{d.isoformat()}.json')
        if j is None:
            if d >= date(2020, 1, 1):
                add('prices', d.isoformat(), f'{d.isoformat()}: no day-ahead file', 'auto: next fetch')
            continue
        z = j.get('zones') or {}
        miss = [c for c in KEY if not (isinstance(z.get(c), dict) and z[c].get('avg') is not None)]
        if miss:
            add('prices', d.isoformat(), f'{d.isoformat()}: no day-ahead price for {", ".join(miss)}', 'auto: retried every 20-30 min, then the history repair')
        if (TODAY - d).days in range(1, 61):
            fr = z.get('FR') if isinstance(z.get('FR'), dict) else {}
            nuc = fr.get('nuclear')
            n = sum(1 for v in nuc if v is not None) if isinstance(nuc, list) else 0
            size = len(nuc) if isinstance(nuc, list) and len(nuc) in (24, 96) else 96   # hourly files (Energy-Charts history) hold 24 values
            if n < size * 0.92:
                add('generation', d.isoformat(), f'{d.isoformat()}: France production by source {n}/{size} {"hours" if size == 24 else "quarter-hours"}', 'auto: the next day’s finalisation')
    # RTE éCO2mix
    first = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=1)
    d = first
    while d < TODAY:
        m = load(f'data/history/rte/{d.strftime("%Y-%m")}.json')
        day = ((m or {}).get('days') or {}).get(d.isoformat())
        if not day:
            add('rte', d.isoformat(), f'{d.isoformat()}: no RTE éCO2mix day', 'flagged: RTE job (3 runs a day)')
        else:
            bad = [f for f in ('nuclear', 'wind', 'solar', 'load') if sum(1 for v in (day.get(f) or []) if v is not None) < 88]
            if bad:
                add('rte', d.isoformat(), f'{d.isoformat()}: RTE éCO2mix incomplete ({", ".join(bad)})', 'flagged: RTE job (3 runs a day)')
        d += timedelta(days=1)
    # commodities
    cs = (load('data/history/commodities_series.json') or {}).get('series') or {}
    for k, lab in (('brent', 'Brent'), ('ttf', 'TTF day-ahead'), ('eua', 'EUA'), ('coal', 'API2 coal'), ('agsi', 'EU gas storage')):
        pts = [p[0] for p in (cs.get(k) or {}).get('points') or []]
        if not pts:
            add('commodities', k, f'{lab}: no series', 'flagged: market job'); continue
        lastd = date.fromisoformat(pts[-1])
        if bdays_between(lastd, TODAY) > 4:
            add('commodities', k + ':stale', f'{lab}: last close {pts[-1]}', 'flagged: market job (daily)')
        recent = [date.fromisoformat(p) for p in pts if p >= (TODAY - timedelta(days=120)).isoformat()]
        for a, b in zip(recent, recent[1:]):
            if bdays_between(a, b) - 1 >= 2:
                add('commodities', f'{k}:{a.isoformat()}', f'{lab}: {bdays_between(a, b) - 1} business days missing after {a.isoformat()}', 'flagged: not refetched (source keeps its history)')
    # forwards
    ch = ((load('data/history/fr_market_calchain.json') or {}).get('FR') or {}).get('years') or {}
    if ch:
        y = sorted(ch)[0]
        lastd = date.fromisoformat(ch[y]['dates'][-1])
        if bdays_between(lastd, TODAY) > 4:
            add('forwards', 'cal1', f'France Cal {y}: last settlement {lastd.isoformat()}', 'flagged: market job (daily)')
    else:
        add('forwards', 'cal1', 'France calendar forwards: no file', 'flagged: market job (daily)')
    # CR parks' output (ODRÉ, monthly, about six weeks late)
    cr = (load('data/history/cr_production.json') or {}).get('days') or {}
    m2 = (TODAY.replace(day=1) - timedelta(days=40)).replace(day=1)
    months = {k[:7] for k in cr}
    if cr and m2.strftime('%Y-%m') not in months and TODAY.day > 20:
        add('cr', m2.strftime('%Y-%m'), f'Parks under complément de rémunération: {m2.strftime("%Y-%m")} not published or not read', 'flagged: RTE job (ODRÉ monthly)')
    # second source: days whose average differs from Energy-Charts (scripts/verify_prices.py)
    pc = load('data/history/price_check.json') or {}
    # the check itself must keep running: a second source not consulted for 2 days is a hole too
    try:
        age = (NOW - datetime.fromisoformat(pc['updated'])).total_seconds() / 3600
    except Exception:
        age = 999
    if age > 48:
        add('pricecheck', 'stale', f'Second source (Energy-Charts) not consulted for {int(age)} h', 'flagged: holes job, once a day')
    for z, info in (pc.get('zones') or {}).items():
        for row in info.get('days') or []:
            add('pricecheck', f"{row['day']}:{z}", f"{row['day']}: {z} day-ahead {row['ours']} €/MWh here, {row['ec']} at Energy-Charts", 'auto: asked again to ENTSO-E (last 30 days)')
    # activation prices
    act = (load('data/history/fr_activation.json') or {}).get('days') or {}
    if act:
        for k in range(2, 61):
            d = (TODAY - timedelta(days=k)).isoformat()
            if d >= min(act) and not (act.get(d) or {}).get('mfrr'):
                add('activation', d, f'{d}: no mFRR activation price', 'auto: the daily job refetches 14 days')
    return out


def main():
    prev = load('data/data_gaps.json') or {}
    known = {i['id']: i for i in prev.get('open', [])}
    now = NOW.isoformat(timespec='seconds')
    open_ = []
    for i in checks():
        p = known.pop(i['id'], None)
        i['since'] = p['since'] if p else now
        i['lastSeen'] = now
        open_.append(i)
    resolved = [dict(i, resolvedAt=now) for i in known.values()] + [r for r in prev.get('resolved', []) if r.get('resolvedAt', '') >= (NOW - timedelta(days=30)).isoformat()]
    open_.sort(key=lambda i: (i['dataset'], i['id']), reverse=False)
    json.dump({'updated': now, 'open': open_, 'resolved': sorted(resolved, key=lambda r: r['resolvedAt'], reverse=True)[:300]},
              open(OUT, 'w'), ensure_ascii=False, indent=0)
    print(f'{len(open_)} open, {len(resolved)} resolved (30 days)')
    for i in open_[:40]:
        print(' ', i['dataset'], '·', i['what'])


if __name__ == '__main__':
    main()
