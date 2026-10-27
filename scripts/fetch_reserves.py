#!/usr/bin/env python3
"""What a battery is paid for holding reserve in France, and the cost of money, day by day.

  * FCR: the common European auction (regelleistung.net results export, one file per delivery day): the French
    settlement capacity price of each 4-hour block, EUR per MW per block; a day's value = the sum of its 6 blocks.
  * aFRR: price of reserved balancing capacity in France on the ENTSO-E Transparency Platform (A89, processType
    A51), when RTE publishes it (needs ENTSOE_TOKEN; the answer is kept in diag either way).
  * Euro area 10-year AAA spot rate (ECB data API), the base of a battery's debt rate.

Writes data/history/reserves_fr.json:
  {"updated", "source", "diag", "fcr": {"YYYY-MM-DD": EUR/MW/day}, "afrr": {"YYYY-MM-DD": {"up", "down"}},
   "rate10y": {"YYYY-MM-DD": percent}}

    python scripts/fetch_reserves.py                 # the last 21 days (the whole history if no file yet)
    python scripts/fetch_reserves.py --since 2022-01-01
"""
import io
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'reserves_fr.json')
FCR_URL = 'https://www.regelleistung.net/apps/cpp-publisher/api/v1/download/tenders/resultsoverview'
ECB_URL = 'https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y'
DIAG = []


def fcr_day(d):
    """EUR per MW for the whole delivery day in France (sum of the 4-hour blocks), or None."""
    import openpyxl
    for k in range(3):
        try:
            r = requests.get(FCR_URL, params={'date': d.isoformat(), 'exportFormat': 'xlsx', 'market': 'CAPACITY', 'productTypes': 'FCR'}, timeout=40)
        except requests.RequestException as e:
            DIAG.append(f'FCR {d}: {str(e)[:80]}')
            time.sleep(3 * (k + 1))
            continue
        if r.status_code != 200 or r.content[:2] != b'PK':
            if r.status_code in (429, 500, 502, 503) and k < 2:
                time.sleep(5 * (k + 1))
                continue
            DIAG.append(f'FCR {d}: HTTP {r.status_code}')
            return None
        rows = list(openpyxl.load_workbook(io.BytesIO(r.content), read_only=True).active.iter_rows(values_only=True))
        if len(rows) < 2:
            return None
        h = list(rows[0])
        try:
            j = h.index('FRANCE_SETTLEMENTCAPACITY_PRICE_[EUR/MW]')
        except ValueError:
            DIAG.append(f'FCR {d}: no French price column')
            return None
        v = [r[j] for r in rows[1:] if r[j] is not None]
        if not v:
            return None
        dm = h.index('FRANCE_DEMAND_[MW]') if 'FRANCE_DEMAND_[MW]' in h else None
        mw = [r[dm] for r in rows[1:] if dm is not None and r[dm] is not None]
        # blocks of 4 hours: 6 a day; a day with fewer blocks published is scaled to 24 h
        return round(sum(v) * 6 / len(v), 2), (round(sum(mw) / len(mw)) if mw else None)
    return None


def afrr(p0, p1):
    """French aFRR reserved capacity prices (ENTSO-E A89), EUR/MW/h averaged per day and direction."""
    if not os.environ.get('ENTSOE_TOKEN'):
        DIAG.append('aFRR: no ENTSOE_TOKEN here')
        return {}
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch_fr_imbalance_cost import fetch, series, text_in, FR, PARIS
    out = {}
    try:
        xml = fetch({'documentType': 'A89', 'processType': 'A51', 'type_MarketAgreement.Type': 'A01', 'controlArea_Domain': FR,
                     'periodStart': p0.strftime('%Y%m%d0000'), 'periodEnd': p1.strftime('%Y%m%d0000')})
    except Exception as e:
        DIAG.append(f'aFRR A89: {str(e)[:160]}')
        return {}
    if not xml:
        DIAG.append('aFRR A89: empty answer')
        return {}

    def key(ts):
        dr = text_in(ts, 'flowDirection.direction')
        return 'up' if dr == 'A01' else 'down' if dr == 'A02' else 'sym'
    for k, pts in series(xml, 'procurement_Price.amount', key).items():
        by = {}
        for t, v in pts.items():
            day = t.astimezone(PARIS).date().isoformat() if hasattr(t, 'astimezone') else str(t)[:10]
            by.setdefault(day, []).append(v)
        for day, vs in by.items():
            out.setdefault(day, {})[k] = round(sum(vs) / len(vs), 2)
    DIAG.append(f'aFRR A89: {len(out)} days')
    return out


def rate10y(start):
    try:
        r = requests.get(ECB_URL, params={'format': 'csvdata', 'startPeriod': start}, timeout=40)
        r.raise_for_status()
    except requests.RequestException as e:
        DIAG.append(f'ECB: {str(e)[:120]}')
        return {}
    lines = r.text.strip().split('\n')
    h = lines[0].split(',')
    i, j = h.index('TIME_PERIOD'), h.index('OBS_VALUE')
    out = {}
    for ln in lines[1:]:
        c = ln.split(',')
        try:
            out[c[i]] = round(float(c[j]), 3)
        except (ValueError, IndexError):
            pass
    return out


def main():
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    fcr, af, rt, dem = old.get('fcr', {}), old.get('afrr', {}), old.get('rate10y', {}), old.get('fcr_mw', {})
    today = datetime.now(timezone.utc).date()
    if '--since' in sys.argv:
        d0 = date.fromisoformat(sys.argv[sys.argv.index('--since') + 1])
    else:
        d0 = today - timedelta(days=21) if fcr else date(2026, 1, 1)   # the public export starts in January 2026
    d = d0
    while d <= today + timedelta(days=1):        # the next day's auction is held the day before
        v = fcr_day(d)
        if v is not None:
            fcr[d.isoformat()] = v[0]
            if v[1] is not None:
                dem[d.isoformat()] = v[1]
        d += timedelta(days=1)
    for k, v in afrr(max(d0, today - timedelta(days=360)), today + timedelta(days=1)).items():
        af[k] = v
    rt.update(rate10y((d0 - timedelta(days=7)).isoformat()))
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
           'source': 'regelleistung.net (FCR common auction, French settlement price) · ENTSO-E Transparency (aFRR A89, France) · ECB data API (euro area AAA 10-year spot rate)',
           'unit': 'fcr: EUR per MW per delivery day · fcr_mw: French FCR need, MW · afrr: EUR per MW per hour · rate10y: percent',
           'diag': DIAG[-30:], 'fcr': dict(sorted(fcr.items())), 'fcr_mw': dict(sorted(dem.items())), 'afrr': dict(sorted(af.items())), 'rate10y': dict(sorted(rt.items()))}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    last = sorted(fcr)[-365:]
    print(f'FCR {len(fcr)} days, last 365 days {sum(fcr[k] for k in last) / 1000:.1f} kEUR/MW · aFRR {len(af)} days · rate {len(rt)} days')
    print('\n'.join(DIAG[-8:]))


if __name__ == '__main__':
    main()
