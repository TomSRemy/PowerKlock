#!/usr/bin/env python3
"""Imbalance cost of French solar and wind, national, month by month.

A basic estimate for the PPA pricer (Tools › PPA pricer, imbalance cost):
what a balancing party would have paid if it had sold the day-ahead forecast
of national solar / wind production on the spot market and settled the
forecast error at the imbalance price.

  error_q = actual_q − forecast_q                     (MW, quarter-hour q)
  cost    = − Σ_q error_q × (imbalance price_q − spot_q) × 0.25 h
  €/MWh   = cost ÷ Σ_q actual_q × 0.25 h

A surplus (error > 0) is sold at the imbalance price instead of the spot, a
shortfall bought back at it; when the imbalance price differs by direction,
the price of the side the error falls on is used.

Data
  actual production  RTE éCO2mix, data/history/rte/YYYY-MM.json (15 min)
  day-ahead spot     data/history/daily/YYYY-MM-DD.json (zones.FR.hourly)
  forecast           ENTSO-E, generation forecast wind and solar, day-ahead (A69)
  imbalance prices   ENTSO-E, imbalance prices France (A85)

Writes data/history/fr_imbalance_cost.json:
  {"updated", "source", "method", "months": {"2026-09": {"solar": {"eurMWh", "costEur",
   "mwh", "errPct", "slots"}, "wind": {…}}, …}}

    ENTSOE_TOKEN=… python scripts/fetch_fr_imbalance_cost.py              # last 2 months (24 if no file yet)
    ENTSOE_TOKEN=… python scripts/fetch_fr_imbalance_cost.py --months 24
    ENTSOE_TOKEN=… python scripts/fetch_fr_imbalance_cost.py --prices 4      # only the imbalance prices of the last 4 days

Also keeps the imbalance prices themselves (Paris days, 96 quarter-hours, €/MWh) in
data/history/fr_imbalance_price/YYYY-MM.json: {"days": {"2026-10-24": {"long": [96], "short": [96]}}}
(long = price for an excess, short = for a deficit; the same values under a single price).
"""
import io
import json
import os
import zipfile
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'fr_imbalance_cost.json')
BASE = 'https://web-api.tp.entsoe.eu/api'
FR = '10YFR-RTE------C'
PARIS = ZoneInfo('Europe/Paris')
Q = timedelta(minutes=15)
DIAG = []   # written into the output: what ENTSO-E answered (no access to the Actions logs from the site)


def local(tag):
    return tag.split('}')[-1]


def scrub(text):
    """An error message without the API token (requests puts the whole URL in its errors; diag lands in public files)."""
    return re.sub(r'securityToken=[^&\s\'"]+', 'securityToken=***', str(text))


def fetch(params, tries=3):
    for k in range(tries):
        r = requests.get(BASE, params={'securityToken': os.environ['ENTSOE_TOKEN'], **params}, timeout=60)
        if r.status_code == 200:
            # balancing documents (A85) come as a ZIP of XML files
            if r.content[:2] == b'PK':
                with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                    parts = [z.read(n).decode('utf-8', 'replace') for n in z.namelist() if n.lower().endswith('.xml')]
                DIAG.append(f"{params.get('documentType')} {params.get('periodStart')}: zip, {len(parts)} xml")
                return '<root>' + ''.join(re.sub(r'<\?xml[^>]*\?>', '', x) for x in parts) + '</root>'
            if params.get('documentType') == 'A85':
                DIAG.append(f"{params.get('documentType')} {params.get('periodStart')}: {r.text[:200]!r}")
            return r.text
        if r.status_code in (429, 503) and k < tries - 1:
            time.sleep(10 * (k + 1))
            continue
        # "No matching data found" comes back as an acknowledgement document
        if 'No matching data' in r.text:
            DIAG.append(f"{params.get('documentType')} {params.get('periodStart')}: no matching data")
            return ''
        DIAG.append(f"{params.get('documentType')} {params.get('periodStart')}: HTTP {r.status_code} {r.text[:160]!r}")
        why = re.search(r'<text>(.*?)</text>', r.text, re.S)                 # the reason of an acknowledgement document
        raise RuntimeError(f"ENTSO-E HTTP {r.status_code} for {params.get('documentType')}: {(why.group(1) if why else r.text)[:240]}")
    return ''


def minutes(res):
    m = re.match(r'PT(\d+)M', res or '')
    if m:
        return int(m.group(1))
    return 60 if res == 'PT1H' or (res or '').startswith('PT60') else 15


def series(xml_text, value_tag, key_of):
    """→ {key: {utc quarter-hour: value}}; key_of(timeseries element) names the series (None = skip).
    Hourly or half-hourly points are spread over their quarter-hours."""
    out = {}
    if not xml_text:
        return out
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for ts in (e for e in root.iter() if local(e.tag) == 'TimeSeries'):
        key = key_of(ts)
        if key is None:
            continue
        for per in (e for e in ts.iter() if local(e.tag) == 'Period'):
            start, res = None, None
            for e in per.iter():
                t = local(e.tag)
                if t == 'start' and start is None:
                    start = datetime.strptime(e.text.strip(), '%Y-%m-%dT%H:%MZ').replace(tzinfo=timezone.utc)
                elif t == 'resolution':
                    res = e.text.strip()
            if start is None:
                continue
            step = minutes(res)
            for pt in (e for e in per if local(e.tag) == 'Point'):
                pos = val = None
                for c in pt:
                    t = local(c.tag)
                    if t == 'position':
                        pos = int(c.text)
                    elif t == value_tag:
                        val = float(c.text)
                if pos is None or val is None:
                    continue
                t0 = start + timedelta(minutes=step * (pos - 1))
                for k in range(max(1, step // 15)):
                    d = out.setdefault(key, {})
                    d[t0 + Q * k] = d.get(t0 + Q * k, 0.0) + val if key[0] == 'fc' else val
    return out


def text_in(ts, tag):
    for e in ts.iter():
        if local(e.tag) == tag:
            return (e.text or '').strip()
    return ''


def forecast(p0, p1):
    """Day-ahead forecast, MW: solar and wind (onshore + offshore)."""
    xml = fetch({'documentType': 'A69', 'processType': 'A01', 'in_Domain': FR, 'periodStart': p0, 'periodEnd': p1})

    def key(ts):
        psr = text_in(ts, 'psrType')
        return ('fc', 'solar') if psr == 'B16' else ('fc', 'wind') if psr in ('B18', 'B19') else None
    s = series(xml, 'quantity', key)
    return s.get(('fc', 'solar'), {}), s.get(('fc', 'wind'), {})


def imbalance(p0, p1):
    """Imbalance prices, €/MWh: {'long': {...}, 'short': {...}} (the same series twice under a single price)."""
    xml = fetch({'documentType': 'A85', 'controlArea_Domain': FR, 'periodStart': p0, 'periodEnd': p1})
    cats = {}
    if not xml:
        return {}, {}
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return {}, {}
    # the category sits on each Point (imbalance_Price.category): A04 excess (long), A05 deficit (short)
    long_, short_, single = {}, {}, {}
    for ts in (e for e in root.iter() if local(e.tag) == 'TimeSeries'):
        for per in (e for e in ts.iter() if local(e.tag) == 'Period'):
            start = res = None
            for e in per.iter():
                t = local(e.tag)
                if t == 'start' and start is None:
                    start = datetime.strptime(e.text.strip(), '%Y-%m-%dT%H:%MZ').replace(tzinfo=timezone.utc)
                elif t == 'resolution':
                    res = e.text.strip()
            if start is None:
                continue
            step = minutes(res)
            for pt in (e for e in per if local(e.tag) == 'Point'):
                pos, prices = None, []
                for c in pt:
                    if local(c.tag) == 'position':
                        pos = int(c.text)
                for c in pt.iter():
                    if local(c.tag) == 'imbalance_Price.amount':
                        prices.append([float(c.text), None])
                    elif local(c.tag) == 'imbalance_Price.category' and prices:
                        prices[-1][1] = (c.text or '').strip()
                if pos is None or not prices:
                    continue
                t0 = start + timedelta(minutes=step * (pos - 1))
                for k in range(max(1, step // 15)):
                    t = t0 + Q * k
                    for v, cat in prices:
                        cats[cat] = cats.get(cat, 0) + 1
                        (long_ if cat == 'A04' else short_ if cat == 'A05' else single)[t] = v
    if single:
        long_ = {**single, **long_}
        short_ = {**single, **short_}
    return long_, short_


PRICE_DIR = os.path.join(ROOT, 'data', 'history', 'fr_imbalance_price')


def save_prices(lg, sh):
    """merge quarter-hour prices into the monthly files, by Paris day"""
    days = {}
    for side, ser in (('long', lg), ('short', sh)):
        for t, v in ser.items():
            loc = t.astimezone(PARIS)
            d = loc.date().isoformat()
            i = loc.hour * 4 + loc.minute // 15
            day = days.setdefault(d, {'long': [None] * 96, 'short': [None] * 96})
            if i < 96:
                day[side][i] = round(v, 2)
    by_month = {}
    for d, v in days.items():
        if sum(x is not None for x in v['long']) >= 80:   # a full day only (DST days keep 92 or 100 slots folded on 96)
            by_month.setdefault(d[:7], {})[d] = v
    os.makedirs(PRICE_DIR, exist_ok=True)
    for m, dd in by_month.items():
        path = os.path.join(PRICE_DIR, m + '.json')
        j = load(path) or {'days': {}}
        j['days'].update(dd)
        j['days'] = dict(sorted(j['days'].items()))
        j['source'] = 'ENTSO-E imbalance prices France (A85), Paris time, 15 min, EUR/MWh'
        with open(path, 'w') as f:
            json.dump(j, f, separators=(',', ':'))
    return sum(len(v) for v in by_month.values())


def recent_prices(n):
    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = datetime.combine(date.today() - timedelta(days=n), datetime.min.time(), PARIS).astimezone(timezone.utc)
    lg, sh = imbalance(start.strftime('%Y%m%d%H%M'), end.strftime('%Y%m%d%H%M'))
    print(f'imbalance prices: {save_prices(lg, sh)} days written')


def months_back(n):
    d = date.today().replace(day=1)
    out = []
    for _ in range(n):
        d = (d - timedelta(days=1)).replace(day=1)
        out.append(d)
    return sorted(out) + [date.today().replace(day=1)]


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def month_cost(m):
    nxt = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
    a = datetime(m.year, m.month, 1, tzinfo=PARIS).astimezone(timezone.utc)
    b = datetime(nxt.year, nxt.month, 1, tzinfo=PARIS).astimezone(timezone.utc)
    p0, p1 = a.strftime('%Y%m%d%H%M'), b.strftime('%Y%m%d%H%M')
    fc_s, fc_w = forecast(p0, p1)
    lg, sh = imbalance(p0, p1)
    save_prices(lg, sh)
    rte = load(os.path.join(ROOT, 'data', 'history', 'rte', m.strftime('%Y-%m') + '.json')) or {}
    acc = {k: {'cost': 0.0, 'mwh': 0.0, 'err': 0.0, 'n': 0} for k in ('solar', 'wind')}
    d = m
    while d < nxt:
        day = (rte.get('days') or {}).get(d.isoformat())
        daily = load(os.path.join(ROOT, 'data', 'history', 'daily', d.isoformat() + '.json'))
        spot = (((daily or {}).get('zones') or {}).get('FR') or {}).get('hourly')
        if day and isinstance(spot, list) and len(spot) in (24, 96):
            per = len(spot) // 24
            t_mid = datetime(d.year, d.month, d.day, tzinfo=PARIS).astimezone(timezone.utc)
            for i in range(96):
                t = t_mid + Q * i
                s = spot[i // (4 // per)] if per < 4 else spot[i]
                if s is None:
                    continue
                for k, fc in (('solar', fc_s), ('wind', fc_w)):
                    arr = day.get(k)
                    if not isinstance(arr, list) or i >= len(arr) or arr[i] is None or t not in fc:
                        continue
                    err = arr[i] - fc[t]
                    p = (lg if err > 0 else sh).get(t)
                    if p is None:
                        continue
                    a_ = acc[k]
                    a_['cost'] += -err * (p - s) * 0.25
                    a_['mwh'] += arr[i] * 0.25
                    a_['err'] += abs(err) * 0.25
                    a_['n'] += 1
        d += timedelta(days=1)
    out = {}
    for k, a_ in acc.items():
        if a_['n'] >= 96 * 5 and a_['mwh'] > 0:
            out[k] = {'eurMWh': round(a_['cost'] / a_['mwh'], 3), 'costEur': round(a_['cost']), 'mwh': round(a_['mwh']),
                      'errPct': round(a_['err'] / a_['mwh'] * 100, 1), 'slots': a_['n']}
    rte_days = len((rte.get('days') or {}))
    return out, {'forecastSlots': len(fc_s) + len(fc_w), 'priceSlots': len(lg) + len(sh), 'rteDays': rte_days, 'matched': {k: a_['n'] for k, a_ in acc.items()},
                 'fcFirst': str(min(fc_s)) if fc_s else None, 'priceFirst': str(min(lg)) if lg else None}


def main():
    if not os.environ.get('ENTSOE_TOKEN'):
        sys.exit('ENTSOE_TOKEN is not set.')
    if '--prices' in sys.argv:
        recent_prices(int(sys.argv[sys.argv.index('--prices') + 1]))
        return
    prev = load(OUT) or {'months': {}}
    n = int(sys.argv[sys.argv.index('--months') + 1]) if '--months' in sys.argv else (2 if prev['months'] else 24)
    prev['diag'] = {}
    for m in months_back(n):
        try:
            res, info = month_cost(m)
        except Exception as e:
            print(f'  {m:%Y-%m} ERROR {e}')
            prev.setdefault('diag', {})[m.strftime('%Y-%m')] = {'error': scrub(e)[:200]}
            continue
        prev.setdefault('diag', {})[m.strftime('%Y-%m')] = info
        print(f'  {m:%Y-%m} ' + ', '.join(f'{k} {v["eurMWh"]:+.2f} €/MWh ({v["errPct"]} % error)' for k, v in res.items()) + f'  {info}')
        if res:
            prev['months'][m.strftime('%Y-%m')] = res
    prev.update({'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                 'source': 'ENTSO-E (day-ahead wind and solar forecast A69, imbalance prices A85) · RTE éCO2mix (actual) · ENTSO-E day-ahead (spot)',
                 'method': 'cost = −Σ (actual − forecast) × (imbalance price − spot) × 0.25 h, per MWh produced; national, basic'})
    prev['months'] = dict(sorted(prev['months'].items()))
    prev['answers'] = DIAG[-40:]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(prev, f, separators=(',', ':'))
    print(f'Wrote {OUT}: {len(prev["months"])} months')


if __name__ == '__main__':
    main()
