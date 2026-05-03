"""
PowerKlock — ENTSO-E Historical Backfill
Run once locally to populate data/history/ from 2015 to today.
Usage: ENTSOE_TOKEN=xxx python3 backfill.py [--start 2015-01-01] [--end 2026-05-03] [--zones FR,DE_LU,ES]
"""
import os, json, time, argparse, sys
from datetime import datetime, timedelta, date
from xml.etree import ElementTree as ET
import requests

TOKEN = os.environ.get('ENTSOE_TOKEN', '')
BASE  = 'https://web-api.tp.entsoe.eu/api'

ZONES = {
    'FR':'10YFR-RTE------C','DE_LU':'10Y1001A1001A82H','BE':'10YBE----------2',
    'NL':'10YNL----------L','ES':'10YES-REE------0','PT':'10YPT-REN------W',
    'IT_NORD':'10Y1001A1001A73I','IT_SICI':'10Y1001A1001A788',
    'AT':'10YAT-APG------L','CH':'10YCH-SWISSGRIDZ','CZ':'10YCZ-CEPS-----N',
    'SK':'10YSK-SEPS-----K','HU':'10YHU-MAVIR----U','RO':'10YRO-TEL------P',
    'HR':'10YHR-HEP------M','SI':'10YSI-ELES-----O','GR':'10YGR-HTSO-----Y',
    'BG':'10YCA-BULGARIA-R','DK_W':'10YDK-1--------W','DK_E':'10YDK-2--------M',
    'SE':'10Y1001A1001A44P','NO_1':'10YNO-1--------2','FI':'10YFI-1--------U',
    'LT':'10YLT-1001A0008Q','LV':'10YLV-1001A00074','EE':'10Y1001A1001A39I',
    'PL':'10YPL-AREA-----S','RS':'10YCS-SERBIATSOV','ME':'10YCS-CG-TSO---S',
    'MK':'10YMK-MEPSO----8',
}
ZONE_NAMES = {
    'FR':'France','DE_LU':'Germany','BE':'Belgium','NL':'Netherlands',
    'ES':'Spain','PT':'Portugal','IT_NORD':'Italy North','IT_SICI':'Italy South',
    'AT':'Austria','CH':'Switzerland','CZ':'Czechia','SK':'Slovakia',
    'HU':'Hungary','RO':'Romania','HR':'Croatia','SI':'Slovenia',
    'GR':'Greece','BG':'Bulgaria','DK_W':'Denmark West','DK_E':'Denmark East',
    'SE':'Sweden','NO_1':'Norway North','FI':'Finland','LT':'Lithuania',
    'LV':'Latvia','EE':'Estonia','PL':'Poland','RS':'Serbia',
    'ME':'Montenegro','MK':'N. Macedonia',
}

def fetch(params, retries=3):
    for attempt in range(retries):
        try:
            r = requests.get(BASE, params={'securityToken': TOKEN, **params}, timeout=30)
            if r.status_code == 429:
                wait = 60 * (attempt + 1)
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.text
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))

def strip_ns(tag):
    return tag.split('}')[-1] if '}' in tag else tag

def parse_dt(s):
    s = s.strip()
    for fmt in ('%Y%m%d%H%M', '%Y-%m-%dT%H:%MZ', '%Y-%m-%dT%H:%M%z'):
        try:
            from datetime import timezone
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None

def parse_prices_for_date(xml_text):
    """Returns list of 96 (or 24) prices, None for missing slots."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    doc_start_str = ''
    for el in root.iter():
        if strip_ns(el.tag) in ('start',) and el.text and len(el.text) >= 8:
            doc_start_str = el.text
            break

    doc_start = parse_dt(doc_start_str) if doc_start_str else None
    pos_buckets = {}
    is_15min = False

    for el in root.iter():
        if strip_ns(el.tag) != 'TimeSeries':
            continue
        ts = el
        period = None
        for child in ts:
            if strip_ns(child.tag) == 'Period':
                period = child
                break
        if period is None:
            continue

        res = 'PT60M'
        period_start_str = ''
        for child in period:
            t = strip_ns(child.tag)
            if t == 'resolution':
                res = child.text or 'PT60M'
            elif t == 'timeInterval':
                for sub in child:
                    if strip_ns(sub.tag) == 'start':
                        period_start_str = sub.text or ''

        if res == 'PT15M':
            is_15min = True
        res_minutes = 15 if res == 'PT15M' else 60

        period_start = parse_dt(period_start_str) if period_start_str else doc_start
        slot_offset = 0
        if period_start and doc_start:
            diff_min = int((period_start - doc_start).total_seconds() / 60)
            slot_offset = diff_min // res_minutes

        for child in period:
            if strip_ns(child.tag) != 'Point':
                continue
            pos = price = None
            for sub in child:
                t = strip_ns(sub.tag)
                if t == 'position':
                    pos = int(sub.text)
                elif t == 'price.amount':
                    price = float(sub.text)
            if pos is None or price is None:
                continue
            abs_slot = slot_offset + (pos - 1)
            if 0 <= abs_slot < 96:
                pos_buckets.setdefault(abs_slot, []).append(round(price, 2))

    if not pos_buckets:
        return None

    max_slot = max(pos_buckets.keys())
    n = 96 if (is_15min and max_slot > 23) else 24
    result = []
    for i in range(n):
        vals = pos_buckets.get(i)
        result.append(round(sum(vals)/len(vals), 2) if vals else None)
    return result

def summarise(hourly):
    """Compute daily summary from hourly list."""
    valid = [v for v in hourly if v is not None]
    if not valid:
        return None
    n = len(hourly)
    mins_per_slot = round(24*60/n)
    neg = [v for v in valid if v < 0]
    return {
        'avg': round(sum(valid)/len(valid), 2),
        'min': round(min(valid), 2),
        'max': round(max(valid), 2),
        'negH': round(len(neg) * mins_per_slot / 60, 1),
        'n': n,
    }

def date_range(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)

def fmt(d):
    return d.strftime('%Y%m%d') + '0000'


# ── PSR type mapping ──
PSR_WIND_ON  = 'B19'
PSR_WIND_OFF = 'B18'
PSR_SOLAR    = 'B16'

GEN_ZONES = {
    'FR':'10YFR-RTE------C','DE_LU':'10Y1001A1001A82H','BE':'10YBE----------2',
    'NL':'10YNL----------L','ES':'10YES-REE------0','PT':'10YPT-REN------W',
    'IT_NORD':'10Y1001A1001A73I','IT_SICI':'10Y1001A1001A788',
    'AT':'10YAT-APG------L','CH':'10YCH-SWISSGRIDZ','CZ':'10YCZ-CEPS-----N',
    'SK':'10YSK-SEPS-----K','HU':'10YHU-MAVIR----U','RO':'10YRO-TEL------P',
    'HR':'10YHR-HEP------M','SI':'10YSI-ELES-----O','GR':'10YGR-HTSO-----Y',
    'BG':'10YCA-BULGARIA-R','DK_W':'10YDK-1--------W','DK_E':'10YDK-2--------M',
    'SE':'10Y1001A1001A44P','NO_1':'10YNO-1--------2','FI':'10YFI-1--------U',
    'LT':'10YLT-1001A0008Q','LV':'10YLV-1001A00074','EE':'10Y1001A1001A39I',
    'PL':'10YPL-AREA-----S','RS':'10YCS-SERBIATSOV','ME':'10YCS-CG-TSO---S',
    'MK':'10YMK-MEPSO----8',
}

def parse_generation_for_date(xml_text, target_psrs=None):
    """
    Parse A75 generation XML.
    Returns dict: {psr_code: [24 hourly MW values]}
    target_psrs: set of PSR codes to keep (None = all)
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {}

    def sn(tag):
        return tag.split('}')[-1] if '}' in tag else tag

    # Collect per-PSR, per-hour data
    psr_hours = {}  # psr -> {hour -> [values]}

    for el in root.iter():
        if sn(el.tag) != 'TimeSeries':
            continue
        ts = el

        psr_type = ''
        period = None
        for child in ts:
            t = sn(child.tag)
            if t == 'psrType':
                psr_type = child.text or ''
            elif t == 'Period':
                period = child
            elif t == 'MktPSRType':
                for sub in child:
                    if sn(sub.tag) == 'psrType':
                        psr_type = sub.text or ''

        if not psr_type or period is None:
            continue
        if target_psrs and psr_type not in target_psrs:
            continue

        res = 'PT60M'
        for child in period:
            if sn(child.tag) == 'resolution':
                res = child.text or 'PT60M'
                break
        res_min = 15 if res == 'PT15M' else 60
        slots_per_hour = 60 // res_min

        if psr_type not in psr_hours:
            psr_hours[psr_type] = {}

        for child in period:
            if sn(child.tag) != 'Point':
                continue
            pos = qty = None
            for sub in child:
                t = sn(sub.tag)
                if t == 'position':
                    pos = int(sub.text)
                elif t == 'quantity':
                    qty = float(sub.text)
            if pos is None or qty is None:
                continue
            hour = (pos - 1) // slots_per_hour
            if 0 <= hour < 24:
                psr_hours[psr_type].setdefault(hour, []).append(qty)

    result = {}
    for psr, hours in psr_hours.items():
        result[psr] = [round(sum(hours.get(h, [0]))/max(1, len(hours.get(h, [0])))) for h in range(24)]
    return result

def fetch_generation_for_date(eic, d, d_next):
    """Fetch A75 actual generation for one zone and one day."""
    xml = fetch({
        'documentType': 'A75',
        'processType': 'A16',
        'in_Domain': eic,
        'periodStart': fmt(d),
        'periodEnd': fmt(d_next),
    })
    return parse_generation_for_date(xml, target_psrs={PSR_WIND_ON, PSR_WIND_OFF, PSR_SOLAR})

def aggregate_gen(gen_data):
    """Turn per-PSR hourly into wind_on, wind_off, solar arrays."""
    def get(psr):
        return gen_data.get(psr, [0]*24)
    return {
        'windOnshore':  get(PSR_WIND_ON),
        'windOffshore': get(PSR_WIND_OFF),
        'wind':         [a+b for a,b in zip(get(PSR_WIND_ON), get(PSR_WIND_OFF))],
        'solar':        get(PSR_SOLAR),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default='2015-01-01')
    parser.add_argument('--end',   default=date.today().isoformat())
    parser.add_argument('--zones', default=','.join(ZONES.keys()))
    parser.add_argument('--out',   default='data')
    parser.add_argument('--delay', type=float, default=0.3, help='Seconds between requests')
    parser.add_argument('--with-generation', action='store_true', help='Also fetch A75 generation (wind/solar)'
                        ' -- doubles request count')
    args = parser.parse_args()

    if not TOKEN:
        print("ERROR: set ENTSOE_TOKEN env variable")
        sys.exit(1)

    zones = [z.strip() for z in args.zones.split(',') if z.strip() in ZONES]
    start = date.fromisoformat(args.start)
    end   = date.fromisoformat(args.end)

    daily_dir   = os.path.join(args.out, 'history', 'daily')
    monthly_dir = os.path.join(args.out, 'history', 'monthly')
    os.makedirs(daily_dir, exist_ok=True)
    os.makedirs(monthly_dir, exist_ok=True)

    # Track monthly aggregates
    monthly = {}  # (YYYY-MM, zone) -> list of daily summaries

    total_days = (end - start).days + 1
    done = 0

    print(f"Backfilling {len(zones)} zones from {start} to {end} ({total_days} days)")
    print(f"Output: {args.out}/history/")
    print()

    for d in date_range(start, end):
        date_str = d.isoformat()
        daily_path = os.path.join(daily_dir, f'{date_str}.json')

        # Load existing if already fetched
        if os.path.exists(daily_path):
            with open(daily_path) as f:
                day_data = json.load(f)
        else:
            day_data = {'date': date_str, 'zones': {}}

        d_next = d + timedelta(days=1)
        updated = False

        for zone in zones:
            if zone in day_data['zones']:
                continue  # already have it

            eic = ZONES[zone]
            try:
                xml = fetch({
                    'documentType': 'A44',
                    'in_Domain': eic,
                    'out_Domain': eic,
                    'periodStart': fmt(d),
                    'periodEnd': fmt(d_next),
                })
                time.sleep(args.delay)

                hourly = parse_prices_for_date(xml)
                if hourly is None:
                    day_data['zones'][zone] = None
                else:
                    s = summarise(hourly)
                    entry = {
                        'avg': s['avg'] if s else None,
                        'min': s['min'] if s else None,
                        'max': s['max'] if s else None,
                        'negH': s['negH'] if s else 0,
                        'hourly': hourly,
                    }

                    # Fetch generation if requested and zone supports it
                    if args.with_generation and zone in GEN_ZONES:
                        try:
                            gen_xml = fetch({
                                'documentType': 'A75',
                                'processType': 'A16',
                                'in_Domain': eic,
                                'periodStart': fmt(d),
                                'periodEnd': fmt(d_next),
                            })
                            time.sleep(args.delay)
                            gen_data = parse_generation_for_date(
                                gen_xml,
                                target_psrs={PSR_WIND_ON, PSR_WIND_OFF, PSR_SOLAR}
                            )
                            agg = aggregate_gen(gen_data)
                            entry.update(agg)
                        except Exception as ge:
                            print(f"    {date_str} {zone} gen: {ge}")

                    day_data['zones'][zone] = entry
                    updated = True

            except Exception as e:
                print(f"  {date_str} {zone}: ERROR — {e}")
                day_data['zones'][zone] = None

        if updated or not os.path.exists(daily_path):
            with open(daily_path, 'w') as f:
                json.dump(day_data, f, separators=(',', ':'))

        done += 1
        if done % 50 == 0:
            pct = done / total_days * 100
            print(f"  Progress: {done}/{total_days} days ({pct:.0f}%) — last: {date_str}")

    # Build monthly summaries
    print("\nBuilding monthly summaries...")
    for d in date_range(start, end):
        date_str = d.isoformat()
        ym = date_str[:7]
        daily_path = os.path.join(daily_dir, f'{date_str}.json')
        if not os.path.exists(daily_path):
            continue
        with open(daily_path) as f:
            day_data = json.load(f)
        for zone, zd in day_data.get('zones', {}).items():
            if zd and zd.get('avg') is not None:
                key = (ym, zone)
                if key not in monthly:
                    monthly[key] = []
                monthly[key].append({
                    'd': date_str,
                    'avg': zd['avg'],
                    'min': zd['min'],
                    'max': zd['max'],
                    'negH': zd['negH'],
                })

    # Write monthly files: one per month, all zones
    by_month = {}
    for (ym, zone), days in monthly.items():
        if ym not in by_month:
            by_month[ym] = {}
        by_month[ym][zone] = days

    for ym, zones_data in by_month.items():
        path = os.path.join(monthly_dir, f'{ym}.json')
        with open(path, 'w') as f:
            json.dump({'month': ym, 'zones': zones_data}, f, separators=(',', ':'))

    # Build all-time summary (daily avg per zone, no hourly)
    print("Building all-time summary...")
    all_time = {}  # zone -> [{d, avg, min, max, negH}]
    for d in date_range(start, end):
        date_str = d.isoformat()
        daily_path = os.path.join(daily_dir, f'{date_str}.json')
        if not os.path.exists(daily_path):
            continue
        with open(daily_path) as f:
            day_data = json.load(f)
        for zone, zd in day_data.get('zones', {}).items():
            if zd and zd.get('avg') is not None:
                if zone not in all_time:
                    all_time[zone] = []
                all_time[zone].append({
                    'd': date_str,
                    'avg': zd['avg'],
                    'min': zd['min'],
                    'max': zd['max'],
                    'negH': zd['negH'],
                })

    summary_path = os.path.join(args.out, 'history', 'summary.json')
    with open(summary_path, 'w') as f:
        json.dump({'zones': all_time}, f, separators=(',', ':'))
    print(f"  Wrote {summary_path}")

    print(f"\nDone. {total_days} days processed.")
    print(f"  daily/  : {len(list(date_range(start, end)))} files")
    print(f"  monthly/: {len(by_month)} files")
    print(f"  summary : 1 file ({sum(len(v) for v in all_time.values())} zone-days)")

if __name__ == '__main__':
    main()
