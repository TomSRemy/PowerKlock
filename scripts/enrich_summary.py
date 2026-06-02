#!/usr/bin/env python3
"""
PowerKlock — enrich / backfill summary.json

Two operating modes:

1. RECALC MODE (default — no flags):
   Reads all data/history/daily/*.json files and rebuilds
   data/history/summary.json from scratch, recomputing derived fields
   (peakAvg, offAvg, renPct, domFuel) wherever source data allows.
   Idempotent. Safe to re-run any time.

   Usage:
     python3 scripts/enrich_summary.py

2. HISTORICAL FETCH MODE (--fetch-historical):
   Queries ENTSO-E for past dates that are missing from data/history/daily/,
   writes one JSON per (date, zone), then runs the recalc pass.
   By default fetches 7 zones with genmix coverage: FR, DE_LU, ES, BE, NL, GB, PT.

   Usage examples:
     # Estimate calls and time without doing anything
     python3 scripts/enrich_summary.py --fetch-historical --year 2024 --dry-run

     # 1 year of data
     python3 scripts/enrich_summary.py --fetch-historical --year 2024

     # Custom date range
     python3 scripts/enrich_summary.py --fetch-historical \\
         --from 2023-01-01 --to 2024-12-31

     # Subset of zones
     python3 scripts/enrich_summary.py --fetch-historical \\
         --year 2024 --zones FR,DE_LU,ES

     # Include genmix (5x slower — adds renPct/domFuel)
     python3 scripts/enrich_summary.py --fetch-historical \\
         --year 2024 --with-genmix

     # Skip dates already in daily/ (resume after interruption)
     python3 scripts/enrich_summary.py --fetch-historical \\
         --year 2024 --resume

Environment variable required for --fetch-historical:
  ENTSOE_TOKEN  (same as the GitHub Actions workflow uses)
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from glob import glob
from xml.etree import ElementTree as ET


# ─────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────
DAILY_DIR    = 'data/history/daily'
SUMMARY_PATH = 'data/history/summary.json'

ENTSOE_BASE = 'https://web-api.tp.entsoe.eu/api'

# Zones with genmix coverage (kept in sync with fetch_data.py)
DEFAULT_HISTORICAL_ZONES = ['FR', 'DE_LU', 'ES', 'BE', 'NL', 'GB', 'PT']

ZONES_EIC = {
    'FR':     '10YFR-RTE------C',
    'DE_LU':  '10Y1001A1001A82H',
    'BE':     '10YBE----------2',
    'NL':     '10YNL----------L',
    'ES':     '10YES-REE------0',
    'PT':     '10YPT-REN------W',
    'IT_NORD':'10Y1001A1001A73I',
    'IT_SICI':'10Y1001A1001A788',
    'GB':     '10YGB----------A',
    'AT':     '10YAT-APG------L',
    'CH':     '10YCH-SWISSGRIDZ',
    'CZ':     '10YCZ-CEPS-----N',
    'SK':     '10YSK-SEPS-----K',
    'HU':     '10YHU-MAVIR----U',
    'RO':     '10YRO-TEL------P',
    'HR':     '10YHR-HEP------M',
    'SI':     '10YSI-ELES-----O',
    'RS':     '10YCS-SERBIATSOV',
    'GR':     '10YGR-HTSO-----Y',
    'BG':     '10YCA-BULGARIA-R',
    'DK_W':   '10YDK-1--------W',
    'DK_E':   '10YDK-2--------M',
    'SE':     '10Y1001A1001A44P',
    'NO_1':   '10YNO-1--------2',
    'FI':     '10YFI-1--------U',
    'LT':     '10YLT-1001A0008Q',
    'LV':     '10YLV-1001A00074',
    'EE':     '10Y1001A1001A39I',
    'PL':     '10YPL-AREA-----S',
    'ME':     '10YCS-CG-TSO---S',
    'MK':     '10YMK-MEPSO----8',
    'MT':     '10Y1001A1001A93C',
}

# PSR codes → fuel categories
PSR_TO_CATEGORY = {
    'B01': 'Biomass',
    'B02': 'Gas',
    'B04': 'Gas',
    'B05': 'Gas',
    'B06': 'Gas',
    'B14': 'Nuclear',
    'B16': 'Solar',
    'B18': 'Wind',
    'B19': 'Wind',
    'B10': 'Hydro',
    'B11': 'Hydro',
    'B12': 'Hydro',
}


# ─────────────────────────────────────────────
# CALCULATIONS
# ─────────────────────────────────────────────
def peak_offpeak_from_hourly(hourly96):
    if not hourly96 or len(hourly96) < 96:
        return None, None
    peak_slots = [v for v in hourly96[32:80] if v is not None]
    off_slots  = [v for i, v in enumerate(hourly96) if (i < 32 or i >= 80) and v is not None]
    peak_avg = round(sum(peak_slots) / len(peak_slots), 2) if peak_slots else None
    off_avg  = round(sum(off_slots)  / len(off_slots),  2) if off_slots  else None
    return peak_avg, off_avg


def ren_pct_and_dom_fuel(gm):
    if not gm:
        return None, None
    total = gm.get('total') or 0
    if total <= 0:
        return None, None
    ren_mw = (gm.get('wind') or 0) + (gm.get('solar') or 0) + (gm.get('hydro') or 0)
    ren_pct = round(100 * ren_mw / total, 1)
    categories = {
        'Nuclear': gm.get('nuclear') or 0,
        'Gas':     gm.get('fossil') or 0,
        'Wind':    gm.get('wind') or 0,
        'Solar':   gm.get('solar') or 0,
        'Hydro':   gm.get('hydro') or 0,
        'Biomass': gm.get('biomass') or 0,
    }
    dom = max(categories, key=categories.get) if max(categories.values()) > 0 else None
    return ren_pct, dom


def _avg_max_from_series(arr):
    """Return (avg, max) of a hourly/quarter-hourly array; None if empty/all zero."""
    if not arr:
        return None, None
    clean = [v for v in arr if v is not None]
    if not clean:
        return None, None
    avg = round(sum(clean) / len(clean))
    mx  = max(clean)
    if avg == 0 and mx == 0:
        return None, None
    return avg, mx


def _q_of_month(month):
    """Return the quarter (1..4) for a given month (1..12)."""
    return (month - 1) // 3 + 1


def _hourly_to_24h(hourly):
    """Reduce a 96-slot quarter-hourly array (or 24-slot hourly) into a 24-bucket
    hourly array. Returns list of 24 floats or None.

    Rejects partial-day data: if the source array has a long contiguous run of
    nulls at the start or end (>20% of the array), the day is considered
    incomplete and we return None. This prevents misleading 'half-day' profiles
    when scraping returned only the first N hours of the day.
    """
    if not hourly:
        return None
    n = len(hourly)
    # Reject partial-day data (long trailing or leading null run)
    valid_count = sum(1 for v in hourly if v is not None)
    if valid_count == 0:
        return None
    # Trailing null run
    trail = 0
    for v in reversed(hourly):
        if v is None:
            trail += 1
        else:
            break
    # Leading null run
    lead = 0
    for v in hourly:
        if v is None:
            lead += 1
        else:
            break
    threshold = int(n * 0.2)
    if trail > threshold or lead > threshold:
        return None  # incomplete day, do not contribute to averages
    if n == 24:
        return [v if v is not None else None for v in hourly]
    if n == 96:
        out = []
        for h in range(24):
            slots = hourly[h*4:(h+1)*4]
            valid = [v for v in slots if v is not None]
            out.append(sum(valid) / len(valid) if valid else None)
        return out
    # Generic resampler
    if n > 0:
        step = n / 24
        out = []
        for h in range(24):
            i0 = int(h * step)
            i1 = max(i0 + 1, int((h + 1) * step))
            slice_ = hourly[i0:i1]
            valid = [v for v in slice_ if v is not None]
            out.append(sum(valid) / len(valid) if valid else None)
        return out
    return None


def build_entry_from_daily(date_str, zone_data):
    entry = {
        'd':   date_str,
        'avg': zone_data.get('avg'),
        'min': zone_data.get('min'),
        'max': zone_data.get('max'),
        'negH': zone_data.get('negH', 0),
        'highH': zone_data.get('highH', 0),
    }
    pk, off = peak_offpeak_from_hourly(zone_data.get('hourly'))
    if pk is not None:  entry['peakAvg'] = pk
    if off is not None: entry['offAvg']  = off
    gm = zone_data.get('genmix')
    if gm:
        rp, dom = ren_pct_and_dom_fuel(gm)
        if rp is not None:  entry['renPct']  = rp
        if dom is not None: entry['domFuel'] = dom
    # NEW: per-fuel daily avg/max (MW) — from hourly arrays in the daily snapshot
    # These power Block 4 of the GenMix tab (Historical wind/solar trends)
    for fuel in ('wind', 'solar', 'nuclear', 'hydro', 'fossil', 'biomass'):
        avg, mx = _avg_max_from_series(zone_data.get(fuel))
        if avg is not None: entry[f'{fuel}Avg'] = avg
        if mx  is not None: entry[f'{fuel}Max'] = mx
    return entry


# ─────────────────────────────────────────────
# ENTSO-E FETCHING
# ─────────────────────────────────────────────
def _strip_ns(tag):
    return tag.split('}')[-1] if '}' in tag else tag


def _entsoe_fetch(token, params, max_retries=3):
    import requests
    last_exc = None
    for attempt in range(max_retries):
        try:
            r = requests.get(
                ENTSOE_BASE,
                params={'securityToken': token, **params},
                timeout=30,
            )
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.text
        except Exception as e:
            last_exc = e
            time.sleep(2 ** attempt)
    raise last_exc


def _parse_dt(s):
    s = s.strip()
    for fmt in ('%Y%m%d%H%M', '%Y-%m-%dT%H:%MZ', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%dT%H:%M%z'):
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def _parse_prices_xml(xml_text):
    ns = {'ns': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return [None] * 96

    doc_start_str = (
        root.findtext('.//ns:time_Period.timeInterval/ns:start', '', ns)
        or root.findtext('.//ns:timeInterval/ns:start', '', ns)
    )
    doc_start = _parse_dt(doc_start_str) if doc_start_str else None

    pos_buckets = {}
    native_15min = False

    for ts in root.findall('.//ns:TimeSeries', ns):
        period = ts.find('.//ns:Period', ns)
        if period is None:
            continue
        res = period.findtext('ns:resolution', 'PT60M', ns)
        is_15min = (res == 'PT15M')
        if is_15min:
            native_15min = True
        res_minutes = 15 if is_15min else 60

        period_start_str = period.findtext('ns:timeInterval/ns:start', '', ns)
        period_start = _parse_dt(period_start_str) if period_start_str else doc_start
        slot_offset = 0
        if period_start and doc_start:
            diff_minutes = int((period_start - doc_start).total_seconds() / 60)
            slot_offset = diff_minutes // res_minutes

        for pt in period.findall('ns:Point', ns):
            pos = int(pt.findtext('ns:position', '0', ns))
            price = pt.findtext('ns:price.amount', None, ns)
            if price is None:
                continue
            abs_slot = slot_offset + (pos - 1)
            if 0 <= abs_slot < 96:
                pos_buckets.setdefault(abs_slot, []).append(round(float(price), 2))

    if not pos_buckets:
        return [None] * 96

    max_slot = max(pos_buckets.keys())
    if max_slot > 23 or native_15min:
        return [
            round(sum(pos_buckets[s]) / len(pos_buckets[s]), 2) if s in pos_buckets else None
            for s in range(96)
        ]
    else:
        out = []
        for h in range(24):
            v = pos_buckets.get(h)
            price = round(sum(v) / len(v), 2) if v else None
            for _ in range(4):
                out.append(price)
        return out


def _parse_generation_xml(xml_text):
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {}

    cats = {'Nuclear': 0, 'Gas': 0, 'Wind': 0, 'Solar': 0, 'Hydro': 0, 'Biomass': 0}

    for ts in root.iter():
        if _strip_ns(ts.tag) != 'TimeSeries':
            continue
        psr_type = ''
        for c in ts.iter():
            if _strip_ns(c.tag) == 'psrType':
                psr_type = (c.text or '').strip()
                break
        if not psr_type:
            continue
        category = PSR_TO_CATEGORY.get(psr_type)
        if not category:
            continue

        values = []
        for pt in ts.iter():
            if _strip_ns(pt.tag) != 'Point':
                continue
            qty = None
            for sub in pt:
                if _strip_ns(sub.tag) == 'quantity':
                    try:
                        qty = float(sub.text)
                    except (TypeError, ValueError):
                        qty = None
            if qty is not None:
                values.append(qty)
        if values:
            cats[category] += sum(values) / len(values)

    return {k: round(v) for k, v in cats.items()}


# Category → daily-file fuel key (matches fetch_data.py / GenMix arrays)
_CAT_TO_FUEL = {'Nuclear': 'nuclear', 'Gas': 'fossil', 'Wind': 'wind',
                'Solar': 'solar', 'Hydro': 'hydro', 'Biomass': 'biomass'}

def _parse_generation_slots_xml(xml_text):
    """Per-fuel 96-slot arrays from A75 (aggregated hourly then expanded ×4,
    same approach as fetch_data.parse_generation). Returns {fuel: [96 ints]}."""
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return None
    fuels = ['nuclear', 'hydro', 'biomass', 'wind', 'solar', 'fossil', 'other']
    # hourly accumulators per fuel (+ wind split)
    hourly = {f: [0.0] * 24 for f in fuels}
    won = [0.0] * 24
    woff = [0.0] * 24
    for ts in root.iter():
        if _strip_ns(ts.tag) != 'TimeSeries':
            continue
        psr_type = ''
        for c in ts.iter():
            if _strip_ns(c.tag) == 'psrType':
                psr_type = (c.text or '').strip()
                break
        if not psr_type:
            continue
        cat = PSR_TO_CATEGORY.get(psr_type)
        fuel = _CAT_TO_FUEL.get(cat, 'other')
        res = 'PT60M'
        for c in ts.iter():
            if _strip_ns(c.tag) == 'resolution':
                res = c.text or 'PT60M'
                break
        slots_per_hour = 4 if res == 'PT15M' else 1
        buckets = {}
        for pt in ts.iter():
            if _strip_ns(pt.tag) != 'Point':
                continue
            pos = qty = None
            for sub in pt:
                t = _strip_ns(sub.tag)
                if t == 'position':
                    try: pos = int(sub.text)
                    except (TypeError, ValueError): pos = None
                elif t == 'quantity':
                    try: qty = float(sub.text)
                    except (TypeError, ValueError): qty = None
            if pos is not None and qty is not None:
                hour = (pos - 1) // slots_per_hour
                if 0 <= hour < 24:
                    buckets.setdefault(hour, []).append(qty)
        for hour, vals in buckets.items():
            avg = sum(vals) / len(vals)
            hourly[fuel][hour] += avg
            if psr_type == 'B19':   won[hour] += avg
            elif psr_type == 'B18': woff[hour] += avg
    if not any(sum(hourly[f]) for f in fuels):
        return None
    expand = lambda arr: [round(arr[h]) for h in range(24) for _ in range(4)]
    out = {f: expand(hourly[f]) for f in fuels}
    out['windOnshore'] = expand(won)
    out['windOffshore'] = expand(woff)
    return out


def fetch_prices_for_date(token, zone_code, date):
    eic = ZONES_EIC.get(zone_code)
    if not eic:
        return None
    start = date.strftime('%Y%m%d') + '0000'
    end = (date + timedelta(days=1)).strftime('%Y%m%d') + '0000'
    try:
        xml = _entsoe_fetch(token, {
            'documentType': 'A44',
            'in_Domain':    eic,
            'out_Domain':   eic,
            'periodStart':  start,
            'periodEnd':    end,
        })
        return _parse_prices_xml(xml)
    except Exception as e:
        print(f"  [{date}] {zone_code}: prices ERROR — {e}")
        return None


def fetch_genmix_for_date(token, zone_code, date):
    eic = ZONES_EIC.get(zone_code)
    if not eic:
        return None
    start = date.strftime('%Y%m%d') + '0000'
    end = (date + timedelta(days=1)).strftime('%Y%m%d') + '0000'
    try:
        xml = _entsoe_fetch(token, {
            'documentType': 'A75',
            'processType':  'A16',
            'in_Domain':    eic,
            'periodStart':  start,
            'periodEnd':    end,
        })
        cats = _parse_generation_xml(xml)
        if not cats or sum(cats.values()) == 0:
            return None
        total = sum(cats.values())
        gm = {
            'nuclear': cats.get('Nuclear', 0),
            'solar':   cats.get('Solar', 0),
            'wind':    cats.get('Wind', 0),
            'hydro':   cats.get('Hydro', 0),
            'fossil':  cats.get('Gas', 0),
            'biomass': cats.get('Biomass', 0),
            'other':   0,
            'total':   total,
        }
        arrays = _parse_generation_slots_xml(xml)
        if arrays:
            gm['_arrays'] = arrays
        return gm
    except Exception as e:
        print(f"  [{date}] {zone_code}: genmix ERROR — {e}")
        return None


def build_daily_snapshot(date_str, prices_per_zone, genmix_per_zone):
    snap = {'date': date_str, 'zones': {}}
    for code, hourly in prices_per_zone.items():
        if not hourly:
            continue
        valid = [p for p in hourly if p is not None]
        if not valid:
            continue
        n_slots = len(hourly)
        mins_per_slot = round(24 * 60 / n_slots) if n_slots > 0 else 15
        neg_h = round(sum(1 for p in valid if p < 0) * mins_per_slot / 60, 1)
        high_h = round(sum(1 for p in valid if p > 100) * mins_per_slot / 60, 1)
        zone_entry = {
            'avg':    round(sum(valid) / len(valid), 2),
            'min':    round(min(valid), 2),
            'max':    round(max(valid), 2),
            'negH':   neg_h,
            'highH':  high_h,
            'hourly': hourly,
        }
        pk, off = peak_offpeak_from_hourly(hourly)
        if pk is not None:  zone_entry['peakAvg'] = pk
        if off is not None: zone_entry['offAvg']  = off
        gm = genmix_per_zone.get(code) if genmix_per_zone else None
        if gm:
            arrays = gm.pop('_arrays', None)  # keep stored genmix scalar clean
            zone_entry['genmix'] = gm
            rp, dom = ren_pct_and_dom_fuel(gm)
            if rp is not None:  zone_entry['renPct']  = rp
            if dom is not None: zone_entry['domFuel'] = dom
            if arrays:
                for k, v in arrays.items():
                    zone_entry[k] = v  # nuclear/hydro/biomass/wind/solar/fossil/other + windOn/Offshore
        snap['zones'][code] = zone_entry
    return snap


# ─────────────────────────────────────────────
# RECALC PASS
# ─────────────────────────────────────────────
def recalc_summary_from_daily():
    if not os.path.isdir(DAILY_DIR):
        print(f"ERROR: {DAILY_DIR} not found. Run from repo root.", file=sys.stderr)
        sys.exit(1)
    files = sorted(glob(os.path.join(DAILY_DIR, '*.json')))
    if not files:
        print(f"ERROR: no daily files in {DAILY_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"Recalc: scanning {len(files)} daily files...")
    summary = {'zones': {}, 'intraday': {}}
    stats = {'files': 0, 'entries': 0, 'peak': 0, 'ren': 0, 'intraday': 0}

    # Accumulators for intraday profiles by zone × year × Q
    # Structure: { code: { year: { Q: [ [24h_profile_day1], [24h_profile_day2], ...] } } }
    # We accumulate raw 24h profiles per day, then average them at the end.
    intraday_accum = {}

    for fp in files:
        date_str = os.path.basename(fp).replace('.json', '')
        try:
            with open(fp) as f:
                daily = json.load(f)
        except Exception as e:
            print(f"  WARN skipping {fp}: {e}")
            continue
        # Parse date for intraday accumulator keys
        try:
            year_int = int(date_str[:4])
            month_int = int(date_str[5:7])
            q_int = _q_of_month(month_int)
        except Exception:
            year_int = None
            q_int = None
        for code, zdata in daily.get('zones', {}).items():
            if not zdata or zdata.get('avg') is None:
                continue
            entry = build_entry_from_daily(date_str, zdata)
            summary['zones'].setdefault(code, []).append(entry)
            stats['entries'] += 1
            if 'peakAvg' in entry: stats['peak'] += 1
            if 'renPct'  in entry: stats['ren']  += 1

            # Accumulate 24h intraday profile (for Hourly Quarter/YoY views)
            if year_int is not None and q_int is not None:
                hourly = zdata.get('hourly')
                profile = _hourly_to_24h(hourly)
                if profile:
                    intraday_accum.setdefault(code, {}).setdefault(year_int, {}).setdefault(q_int, []).append(profile)
                    stats['intraday'] += 1
        stats['files'] += 1

    for code in summary['zones']:
        summary['zones'][code].sort(key=lambda x: x['d'])

    # ── Pre-compute rolling averages (7D / 30D / 90D / 365D) per entry ──
    # Stored as keys: roll7, roll30, roll90, roll365 (None when insufficient data
    # for the window — e.g. fewer than 1 valid points in the trailing window).
    # The frontend reads these directly; no need to recompute client-side,
    # and a 365D rolling is correct even on a 7D visible window.
    def _rolling_avg(values, n):
        """For each index i, mean of the last n values (including i), ignoring
        Nones. Returns same-length list with None where window has no valid data."""
        out = []
        for i in range(len(values)):
            lo = max(0, i - n + 1)
            window = [v for v in values[lo:i+1] if v is not None]
            out.append(round(sum(window) / len(window), 2) if window else None)
        return out

    for code, entries in summary['zones'].items():
        avgs = [e.get('avg') for e in entries]
        spreads = [
            round(e['max'] - e['min'], 2) if (e.get('max') is not None and e.get('min') is not None) else None
            for e in entries
        ]
        r7    = _rolling_avg(avgs, 7)
        r30   = _rolling_avg(avgs, 30)
        r90   = _rolling_avg(avgs, 90)
        r365  = _rolling_avg(avgs, 365)
        sp30  = _rolling_avg(spreads, 30)
        for i, e in enumerate(entries):
            e['roll7']        = r7[i]
            e['roll30']       = r30[i]
            e['roll90']       = r90[i]
            e['roll365']      = r365[i]
            e['spread30']     = sp30[i]
    print(f"  Rolling 7/30/90/365D pre-computed for {len(summary['zones'])} zones")

    # ── Compute aggregated intraday profiles per zone × year × Q ──
    # For each (code, year, Q): average all 24h profiles of that period
    for code, years in intraday_accum.items():
        zone_intraday = {}
        for year, quarters in years.items():
            # Q1..Q4 individual profiles
            for q, profiles in quarters.items():
                avg_profile = []
                for h in range(24):
                    valid = [p[h] for p in profiles if p[h] is not None]
                    avg_profile.append(round(sum(valid) / len(valid), 2) if valid else None)
                zone_intraday.setdefault(str(year), {})[f'Q{q}'] = avg_profile
            # 'all' = average over the entire year
            all_profiles = [p for q_profiles in quarters.values() for p in q_profiles]
            if all_profiles:
                avg_all = []
                for h in range(24):
                    valid = [p[h] for p in all_profiles if p[h] is not None]
                    avg_all.append(round(sum(valid) / len(valid), 2) if valid else None)
                zone_intraday.setdefault(str(year), {})['all'] = avg_all
        summary['intraday'][code] = zone_intraday

    # ── Compute hourly HISTORICAL DISTRIBUTION per zone (used by Hourly YoY global) ──
    # For each zone, take every daily intraday profile from years OLDER than the
    # current year, group by hour, and compute P0/P5/P50/P95/P100. The frontend
    # plots these as enveloppes around the current/Y-1/Y-2 lines.
    #
    # Granularity: simple — pas de buckets par mois/quarter, c'est une distribution
    # 24h moyenne historique (toutes saisons confondues).
    #
    # Storage: summary['intradayDist'][zone] = {
    #   'p0': [24], 'p5': [24], 'p50': [24], 'p95': [24], 'p100': [24],
    #   'years': int (count of years contributing)
    # }
    summary.setdefault('intradayDist', {})
    for code, years in intraday_accum.items():
        if not years:
            continue
        current_year = max(years.keys())
        # Collect all daily profiles from years older than current
        hist_profiles = []
        contributing_years = set()
        for y, quarters in years.items():
            if y == current_year:
                continue
            for q_profiles in quarters.values():
                hist_profiles.extend(q_profiles)
                contributing_years.add(y)
        if not hist_profiles:
            continue
        # Per-hour distribution
        dist = {'p0': [], 'p5': [], 'p50': [], 'p95': [], 'p100': []}
        for h in range(24):
            vals = sorted(p[h] for p in hist_profiles if p[h] is not None)
            if not vals:
                for k in dist:
                    dist[k].append(None)
                continue
            n = len(vals)
            def pct(p):
                if n == 1:
                    return vals[0]
                idx = p * (n - 1)
                lo = int(idx)
                hi = min(lo + 1, n - 1)
                w = idx - lo
                return round(vals[lo] * (1 - w) + vals[hi] * w, 2)
            dist['p0'].append(round(vals[0], 2))
            dist['p5'].append(pct(0.05))
            dist['p50'].append(pct(0.50))
            dist['p95'].append(pct(0.95))
            dist['p100'].append(round(vals[-1], 2))
        dist['years'] = sorted(contributing_years)
        summary['intradayDist'][code] = dist
    print(f"  Hourly historical distribution pre-computed for {len(summary.get('intradayDist', {}))} zones")

    # ── Compute per-zone DISTRIBUTION THRESHOLDS on full historical series ──
    # These power the auto-calibrated coloured zones on the Distribution tab.
    # Each zone gets its own thresholds because price levels differ massively
    # (Nordic ~40 €/MWh vs HU/RO ~110 €/MWh on average).
    #
    # 4 business categories computed from historical daily averages:
    #   - Negative:  price < 0
    #   - Low:       0 <= price < P25
    #   - Normal:    P25 <= price < P75   (IQR — the typical 50% of days)
    #   - High:      P75 <= price < P95
    #   - Extreme:   price >= P95
    #
    # Storage: summary['distThresholds'][zone] = { p0, p10, p25, p50, p75, p95, p100, n }
    summary.setdefault('distThresholds', {})
    for code, entries in summary['zones'].items():
        vals = sorted(e['avg'] for e in entries if e.get('avg') is not None)
        if not vals:
            continue
        n = len(vals)
        def pct(p):
            if n == 1:
                return vals[0]
            idx = p * (n - 1)
            lo = int(idx)
            hi = min(lo + 1, n - 1)
            w = idx - lo
            return round(vals[lo] * (1 - w) + vals[hi] * w, 2)
        summary['distThresholds'][code] = {
            'p0':   round(vals[0], 2),
            'p10':  pct(0.10),
            'p25':  pct(0.25),
            'p50':  pct(0.50),
            'p75':  pct(0.75),
            'p95':  pct(0.95),
            'p100': round(vals[-1], 2),
            'n':    n,
        }
    print(f"  Distribution thresholds pre-computed for {len(summary.get('distThresholds', {}))} zones")

    os.makedirs(os.path.dirname(SUMMARY_PATH), exist_ok=True)
    with open(SUMMARY_PATH, 'w') as f:
        json.dump(summary, f, separators=(',', ':'))

    print(f"\nRecalc done:")
    print(f"  Files processed: {stats['files']}")
    print(f"  Entries written: {stats['entries']}")
    print(f"  Peak/off filled: {stats['peak']}")
    print(f"  Ren%/dom filled: {stats['ren']}")
    print(f"  Intraday samples:{stats['intraday']}")
    print(f"  Zones tracked:   {len(summary['zones'])}")
    print(f"  Intraday zones:  {len(summary['intraday'])}")
    print(f"  Output:          {SUMMARY_PATH}")


# ─────────────────────────────────────────────
# HISTORICAL FETCH PASS
# ─────────────────────────────────────────────
def daterange(start, end):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def fetch_historical(date_from, date_to, zones, with_genmix=False, resume=False, dry_run=False, repair_min_zones=0):
    token = os.environ.get('ENTSOE_TOKEN')
    if not token and not dry_run:
        print("ERROR: ENTSOE_TOKEN env var not set.", file=sys.stderr)
        print("       Get it from https://transparency.entsoe.eu/", file=sys.stderr)
        sys.exit(1)

    unknown = [z for z in zones if z not in ZONES_EIC]
    if unknown:
        print(f"ERROR: unknown zones: {unknown}", file=sys.stderr)
        print(f"       Known zones: {sorted(ZONES_EIC.keys())}", file=sys.stderr)
        sys.exit(1)

    all_dates = list(daterange(date_from, date_to))
    n_days = len(all_dates)

    # Repair mode: detect corrupt daily files (too few valid zones) and force-regenerate them.
    # A file is considered corrupt if it has fewer than `repair_min_zones` zones with valid avg.
    if repair_min_zones > 0:
        corrupt_dates = []
        for d in all_dates:
            fp = os.path.join(DAILY_DIR, d.strftime('%Y-%m-%d') + '.json')
            if not os.path.exists(fp):
                continue
            try:
                with open(fp) as f:
                    existing = json.load(f)
                zones_field = existing.get('zones', {})
                # Count zones with valid price data
                if isinstance(zones_field, dict):
                    valid_count = sum(
                        1 for zd in zones_field.values()
                        if zd is not None and (zd.get('avg') is not None or zd.get('today') is not None)
                    )
                elif isinstance(zones_field, list):
                    valid_count = sum(
                        1 for zd in zones_field
                        if zd is not None and (zd.get('avg') is not None or zd.get('today') is not None)
                    )
                else:
                    valid_count = 0
                if valid_count < repair_min_zones:
                    corrupt_dates.append((d, valid_count, fp))
            except Exception as e:
                print(f"  WARN: could not read {fp}: {e}")
                corrupt_dates.append((d, 0, fp))

        if corrupt_dates:
            print(f"\n--mode repair: detected {len(corrupt_dates)} corrupt files (< {repair_min_zones} valid zones):")
            for d, n, fp in corrupt_dates[:10]:
                print(f"  {d}: only {n} valid zones")
            if len(corrupt_dates) > 10:
                print(f"  ... and {len(corrupt_dates) - 10} more")
            # Delete the corrupt files so the fetch loop will recreate them from scratch.
            # We still need resume to skip the GOOD files.
            if not dry_run:
                for _, _, fp in corrupt_dates:
                    try:
                        os.remove(fp)
                    except OSError:
                        pass

    if resume:
        dates_todo = []
        for d in all_dates:
            fp = os.path.join(DAILY_DIR, d.strftime('%Y-%m-%d') + '.json')
            if os.path.exists(fp):
                continue
            dates_todo.append(d)
        skipped = n_days - len(dates_todo)
        if skipped > 0:
            print(f"--resume: skipping {skipped} dates already in {DAILY_DIR}/")
        all_dates = dates_todo

    n_days_active = len(all_dates)
    calls_per_day = len(zones) * (2 if with_genmix else 1)
    total_calls = n_days_active * calls_per_day
    eta_seconds = total_calls * 1.2

    print(f"\n=== Historical fetch plan ===")
    print(f"  Zones        : {', '.join(zones)} ({len(zones)})")
    print(f"  Date range   : {date_from} to {date_to} ({n_days} days)")
    if resume:
        print(f"  Active dates : {n_days_active} (after --resume skip)")
    print(f"  Genmix       : {'YES (renPct + domFuel)' if with_genmix else 'NO (prices only)'}")
    print(f"  API calls    : {total_calls}")
    print(f"  Est. time    : {eta_seconds/60:.0f} min ({eta_seconds/3600:.1f} h)")
    print(f"  Output       : {DAILY_DIR}/*.json")
    print()

    if dry_run:
        print("Dry run — exiting without fetching.")
        return

    if total_calls > 50_000:
        print("WARNING: this will make more than 50 000 API calls and may exceed", file=sys.stderr)
        print("         GitHub Actions' 6h timeout. Consider splitting the range.", file=sys.stderr)
        resp = input("Continue anyway? [y/N]: ").strip().lower()
        if resp != 'y':
            print("Aborted.")
            return

    t0 = time.time()
    n_ok = 0
    n_fail = 0
    for i, d in enumerate(all_dates):
        date_str = d.strftime('%Y-%m-%d')
        prices_per_zone = {}
        genmix_per_zone = {}

        for code in zones:
            hourly = fetch_prices_for_date(token, code, d)
            if hourly:
                prices_per_zone[code] = hourly
            if with_genmix:
                gm = fetch_genmix_for_date(token, code, d)
                if gm:
                    genmix_per_zone[code] = gm
            time.sleep(0.2)

        if not prices_per_zone:
            n_fail += 1
            continue

        snap = build_daily_snapshot(date_str, prices_per_zone, genmix_per_zone)
        fp = os.path.join(DAILY_DIR, date_str + '.json')
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp, 'w') as f:
            json.dump(snap, f, separators=(',', ':'))
        n_ok += 1

        if (i + 1) % 10 == 0 or i == len(all_dates) - 1:
            elapsed = time.time() - t0
            pct = (i + 1) / len(all_dates) * 100
            eta_left = (elapsed / (i + 1)) * (len(all_dates) - i - 1)
            print(f"  [{i+1}/{len(all_dates)}] {date_str}  {pct:.1f}%  "
                  f"elapsed {elapsed/60:.1f} min  ETA {eta_left/60:.1f} min  "
                  f"ok={n_ok} fail={n_fail}")

    elapsed = time.time() - t0
    print(f"\nHistorical fetch done in {elapsed/60:.1f} min: {n_ok} days OK, {n_fail} days failed.")
    print("Now running recalc pass to rebuild summary.json...\n")
    recalc_summary_from_daily()


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────
def parse_date(s):
    return datetime.strptime(s, '%Y-%m-%d').date()


def main():
    parser = argparse.ArgumentParser(
        description='Enrich / backfill PowerKlock summary.json',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        '--fetch-historical', action='store_true',
        help='Fetch missing historical dates from ENTSO-E (requires ENTSOE_TOKEN)'
    )
    parser.add_argument(
        '--from', dest='date_from', type=parse_date,
        help='Start date (YYYY-MM-DD)'
    )
    parser.add_argument(
        '--to', dest='date_to', type=parse_date,
        help='End date (YYYY-MM-DD), inclusive'
    )
    parser.add_argument(
        '--year', type=int,
        help='Shortcut: fetch full calendar year (e.g. --year 2024)'
    )
    parser.add_argument(
        '--zones', type=str, default=','.join(DEFAULT_HISTORICAL_ZONES),
        help=f'Comma-separated zones (default: {",".join(DEFAULT_HISTORICAL_ZONES)})'
    )
    parser.add_argument(
        '--with-genmix', action='store_true',
        help='Also fetch generation mix (5x slower, adds renPct + domFuel)'
    )
    parser.add_argument(
        '--resume', action='store_true',
        help='Skip dates already present in data/history/daily/'
    )
    parser.add_argument(
        '--mode', choices=['fill', 'repair', 'rebuild'], default=None,
        help='fill = only missing dates (= --resume) | repair = also regenerate corrupt files | rebuild = redo everything (no resume, overwrites). Overrides --resume.'
    )
    parser.add_argument(
        '--min-zones', type=int, default=10,
        help='Threshold for "corrupt" detection in --mode repair. Files with fewer valid zones get regenerated. Default: 10.'
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Print plan and exit without fetching'
    )
    args = parser.parse_args()

    if not args.fetch_historical:
        recalc_summary_from_daily()
        return

    if args.year:
        date_from = datetime(args.year, 1, 1).date()
        date_to   = datetime(args.year, 12, 31).date()
    elif args.date_from and args.date_to:
        date_from = args.date_from
        date_to   = args.date_to
    else:
        print("ERROR: --fetch-historical requires either --year OR (--from AND --to)", file=sys.stderr)
        sys.exit(1)

    if date_to < date_from:
        print(f"ERROR: --to ({date_to}) must be >= --from ({date_from})", file=sys.stderr)
        sys.exit(1)

    today = datetime.utcnow().date()
    if date_to >= today:
        print(f"WARNING: --to ({date_to}) is today or in the future. Capping to yesterday.", file=sys.stderr)
        date_to = today - timedelta(days=1)

    zones = [z.strip() for z in args.zones.split(',') if z.strip()]

    # Resolve --mode into the internal flags (resume, repair_min_zones).
    # --mode takes priority over --resume if both are given.
    if args.mode == 'fill':
        effective_resume = True
        effective_repair = 0
    elif args.mode == 'repair':
        effective_resume = True
        effective_repair = args.min_zones
    elif args.mode == 'rebuild':
        effective_resume = False
        effective_repair = 0
    else:
        # Backward-compatible behaviour: use --resume directly
        effective_resume = args.resume
        effective_repair = 0

    fetch_historical(
        date_from=date_from,
        date_to=date_to,
        zones=zones,
        with_genmix=args.with_genmix,
        resume=effective_resume,
        dry_run=args.dry_run,
        repair_min_zones=effective_repair,
    )


if __name__ == '__main__':
    main()
