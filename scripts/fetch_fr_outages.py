#!/usr/bin/env python3
"""Unit-level outages of French power plants (REMIT), from the ENTSO-E Transparency Platform.

ENTSO-E A80 (unavailability of generation units) and A77 (production units): every outage message
published by the operators, with the unit, planned or forced, start, expected end, the capacity left
available and the reason. The latest revision of each message is kept; cancelled and withdrawn ones
are dropped. Window: the last 60 days and the next 300 (ENTSO-E answers at most one year per request).

Writes data/history/fr_outages.json:
  {"updated", "source", "diag": [...],
   "events": [{"id", "rev", "unit", "psr", "fuel", "type": "planned"|"forced", "start", "end",
               "nominal", "avail", "unavail", "reason", "published"}]}   (MW; times in UTC, ISO)

    ENTSOE_TOKEN=… python scripts/fetch_fr_outages.py
"""
import json
import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_fr_imbalance_cost import fetch, local, scrub, DIAG, FR, ROOT   # same ENTSO-E access (token, ZIP of XML, retries)

OUT = os.path.join(ROOT, 'data', 'history', 'fr_outages.json')
FUEL = {'B14': 'nuclear', 'B04': 'gas', 'B05': 'coal', 'B06': 'oil', 'B10': 'pumped storage', 'B11': 'hydro',
        'B12': 'hydro', 'B01': 'biomass', 'B16': 'solar', 'B18': 'wind', 'B19': 'wind', 'B20': 'other', 'B17': 'waste'}
TYPE = {'A53': 'planned', 'A54': 'forced'}
DEAD = {'A09', 'A13'}   # cancelled, withdrawn


def first(el, tag):
    for e in el.iter():
        if local(e.tag) == tag:
            return e
    return None


def txt(el, tag):
    e = first(el, tag)
    return (e.text or '').strip() if e is not None else ''


def when(d, t):
    """ENTSO-E date + time (UTC) → ISO string"""
    if not d:
        return None
    t = (t or '00:00:00Z').rstrip('Z')
    return f'{d}T{t[:5]}Z'


def parse(xml_text):
    out = []
    if not xml_text:
        return out
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        DIAG.append(f'parse error {e}')
        return out
    for doc in (e for e in root.iter() if local(e.tag) == 'Unavailability_MarketDocument'):
        mrid, rev = txt(doc, 'mRID'), txt(doc, 'revisionNumber')
        ds = first(doc, 'docStatus')
        status = txt(ds, 'value') if ds is not None else ''
        published = txt(doc, 'createdDateTime')
        reason = ' · '.join(x for x in (txt(r, 'text') for r in doc.iter() if local(r.tag) == 'Reason') if x)
        for ts in (e for e in doc.iter() if local(e.tag) == 'TimeSeries'):
            unit = txt(ts, 'production_RegisteredResource.pSRType.powerSystemResources.name') or txt(ts, 'production_RegisteredResource.name')
            psr = txt(ts, 'production_RegisteredResource.pSRType.psrType') or txt(ts, 'psrType')
            nominal = txt(ts, 'production_RegisteredResource.pSRType.powerSystemResources.nominalP')
            start = when(txt(ts, 'start_DateAndOrTime.date'), txt(ts, 'start_DateAndOrTime.time'))
            end = when(txt(ts, 'end_DateAndOrTime.date'), txt(ts, 'end_DateAndOrTime.time'))
            avail = [float(q.text) for q in ts.iter() if local(q.tag) == 'quantity' and q.text]
            try:
                nominal = float(nominal)
            except ValueError:
                nominal = None
            a = min(avail) if avail else None
            out.append({'id': mrid, 'rev': int(rev or 0), 'status': status, 'unit': unit.strip(), 'psr': psr,
                        'fuel': FUEL.get(psr, 'other'), 'type': TYPE.get(txt(ts, 'businessType'), 'other'),
                        'start': start, 'end': end, 'nominal': nominal, 'avail': a,
                        'unavail': round(nominal - a, 1) if nominal is not None and a is not None else None,
                        'reason': reason[:200], 'published': published})
    return out


def main():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    p0, p1 = now - timedelta(days=60), now + timedelta(days=300)
    rows = []
    for doc in ('A80', 'A77'):
        for bt in ('A53', 'A54'):
            for off in range(0, 4800, 200):   # ENTSO-E answers at most 200 messages per request
                try:
                    xml = fetch({'documentType': doc, 'businessType': bt, 'biddingZone_Domain': FR,
                                 'periodStart': p0.strftime('%Y%m%d%H%M'), 'periodEnd': p1.strftime('%Y%m%d%H%M'), 'offset': off})
                except Exception as e:   # one refused request must not lose the others; the reason is kept in diag
                    DIAG.append(f'{doc} {bt} offset {off}: {scrub(e)[:160]}')
                    break
                got = parse(xml)
                rows += got
                if len(set(r['id'] for r in got)) < 200:
                    break
    DIAG.append(f'{len(rows)} time series read')
    # the latest revision of each message; cancelled and withdrawn messages dropped
    best = {}
    for r in rows:
        k = (r['id'], r['unit'])
        if k not in best or r['rev'] > best[k]['rev']:
            best[k] = r
    ev = [r for r in best.values() if r['status'] not in DEAD and r['end'] and r['start']
          and r['end'] >= p0.strftime('%Y-%m-%dT%H:%MZ')]
    for r in ev:
        r.pop('status', None)
    ev.sort(key=lambda r: (r['start'], r['unit']))
    if not ev:
        DIAG.append('no outage kept')
        print('\n'.join(DIAG))
        if os.path.exists(OUT):   # keep the last good list, with today's diagnosis
            old = json.load(open(OUT))
            if old.get('events'):
                old['diag'] = DIAG[-40:]
                with open(OUT, 'w') as f:
                    json.dump(old, f, ensure_ascii=False, separators=(',', ':'))
                return
    out = {'updated': now.strftime('%Y-%m-%dT%H:%MZ'),
           'source': 'ENTSO-E Transparency Platform, unavailability of generation and production units (A80, A77), France',
           'diag': DIAG[-40:], 'events': ev}
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(ev)} outages, {sum(1 for r in ev if r["fuel"] == "nuclear")} nuclear')


if __name__ == '__main__':
    main()
