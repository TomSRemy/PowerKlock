#!/usr/bin/env python3
"""Hydro reservoir filling (ENTSO-E A72, weekly stored energy) since 2015.

ENTSO-E "Aggregated filling rate of water reservoirs and hydro storage
plants" (documentType A72, processType A16): stored energy in MWh at the
end of each week, per country. Needs ENTSOE_TOKEN.

Writes data/history/hydro_reservoirs.json:
  {"updated", "source", "unit": "MWh",
   "countries": {"FR": {"name", "weeks": [["YYYY-MM-DD", MWh], …]}, …}}
The date is the start of the week the value refers to (UTC).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'hydro_reservoirs.json')
BASE = 'https://web-api.tp.entsoe.eu/api'
START_YEAR = 2015
AREAS = {
    'FR': ('France', '10YFR-RTE------C'), 'CH': ('Switzerland', '10YCH-SWISSGRIDZ'), 'ES': ('Spain', '10YES-REE------0'),
    'PT': ('Portugal', '10YPT-REN------W'), 'AT': ('Austria', '10YAT-APG------L'), 'IT': ('Italy', '10YIT-GRTN-----B'),
    'NO': ('Norway', '10YNO-0--------C'), 'SE': ('Sweden', '10YSE-1--------K'), 'FI': ('Finland', '10YFI-1--------U'),
}


def note(msg):
    print('::warning::' + msg)


def fetch(params):
    url = BASE + '?' + urllib.parse.urlencode(dict(params, securityToken=os.environ['ENTSOE_TOKEN']))
    for k in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')
            if e.code in (429, 503):
                time.sleep(20 * (k + 1))
                continue
            return body          # "no matching data" comes back as an error document
        except Exception:
            time.sleep(10 * (k + 1))
    return ''


def parse(xml_text):
    """→ {week start date: MWh}"""
    out = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    ns = {'ns': root.tag.split('}')[0].strip('{')} if root.tag.startswith('{') else {}
    p = (lambda t: 'ns:' + t) if ns else (lambda t: t)
    for ts in root.findall(p('TimeSeries'), ns):
        for per in ts.findall(p('Period'), ns):
            start = per.findtext(p('timeInterval') + '/' + p('start'), '', ns)
            res = per.findtext(p('resolution'), 'P7D', ns)
            if not start:
                continue
            t0 = datetime.fromisoformat(start.replace('Z', '+00:00'))
            step = timedelta(days=7) if res == 'P7D' else timedelta(days=1)
            for pt in per.findall(p('Point'), ns):
                pos = int(pt.findtext(p('position'), '1', ns))
                q = pt.findtext(p('quantity'), None, ns)
                if q is None:
                    continue
                d = (t0 + step * (pos - 1)).date().isoformat()
                out[d] = float(q)
    return out


def main():
    if not os.environ.get('ENTSOE_TOKEN'):
        print('ENTSOE_TOKEN not set: skipped.')
        return 0
    old = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            old = json.load(f).get('countries', {})
    today = date.today()
    out = {}
    for cc, (name, eic) in AREAS.items():
        weeks = {d: v for d, v in (old.get(cc, {}).get('weeks') or [])}
        # full history the first time (one request per year), then the last 6 weeks
        if weeks:
            windows = [(today - timedelta(days=45), today + timedelta(days=1))]
        else:
            windows = [(date(y, 1, 1), min(date(y + 1, 1, 1), today + timedelta(days=1))) for y in range(START_YEAR, today.year + 1)]
        for a, b in windows:
            xml = fetch({'documentType': 'A72', 'processType': 'A16', 'in_Domain': eic,
                         'periodStart': a.strftime('%Y%m%d0000'), 'periodEnd': b.strftime('%Y%m%d0000')})
            got = parse(xml)
            if not got and b > today - timedelta(days=30):
                try:
                    reason = ET.fromstring(xml).findtext('.//{*}text') if xml.strip().startswith('<') else xml[:120]
                except ET.ParseError:
                    reason = xml[:120]
                note(f'{cc} {a}…{b}: no reservoir data ({str(reason or "empty answer")[:120]})')
            weeks.update(got)
            time.sleep(1)
        if weeks:
            out[cc] = {'name': name, 'weeks': sorted([d, round(v)] for d, v in weeks.items())}
            print(f'{cc}: {len(weeks)} weeks, last {out[cc]["weeks"][-1]}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'ENTSO-E Transparency Platform, aggregated filling rate of water reservoirs and hydro storage plants (A72)',
                   'unit': 'MWh', 'countries': out}, f, separators=(',', ':'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
