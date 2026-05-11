#!/usr/bin/env python3
"""
Backfill / enrich summary.json with peakAvg, offAvg, renPct, domFuel.

Reads all data/history/daily/*.json files and rebuilds data/history/summary.json
from scratch, recomputing the new derived fields wherever the source data
allows (hourly slots for peak/off-peak, embedded genmix for ren%/dom fuel).

Run from repo root:
    python3 scripts/enrich_summary.py

Idempotent: can be run repeatedly. Will preserve existing entries that already
have the new fields (e.g. those written by a patched fetch_data.py).
"""
import json
import os
import sys
from glob import glob


DAILY_DIR    = 'data/history/daily'
SUMMARY_PATH = 'data/history/summary.json'


def peak_offpeak_from_hourly(hourly96):
    """Peak = slots 32..79 (08:00 to 20:00 CET). Off-peak = the rest."""
    if not hourly96 or len(hourly96) < 96:
        return None, None
    peak_slots = [v for v in hourly96[32:80] if v is not None]
    off_slots  = [v for i, v in enumerate(hourly96) if (i < 32 or i >= 80) and v is not None]
    peak_avg = round(sum(peak_slots) / len(peak_slots), 2) if peak_slots else None
    off_avg  = round(sum(off_slots)  / len(off_slots),  2) if off_slots  else None
    return peak_avg, off_avg


def ren_pct_and_dom_fuel(gm):
    """%REN = (wind + solar + hydro) / total. Dom fuel = max category."""
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


def build_entry_from_daily(date_str, zone_data):
    """Build a summary entry for one zone on one date from its daily snapshot."""
    entry = {
        'd':   date_str,
        'avg': zone_data.get('avg'),
        'min': zone_data.get('min'),
        'max': zone_data.get('max'),
        'negH': zone_data.get('negH', 0),
    }
    # Peak / off-peak from hourly slots
    pk, off = peak_offpeak_from_hourly(zone_data.get('hourly'))
    if pk is not None:  entry['peakAvg'] = pk
    if off is not None: entry['offAvg']  = off
    # %REN and dominant fuel from embedded genmix (only on dates written by patched fetch_data)
    gm = zone_data.get('genmix')
    if gm:
        rp, dom = ren_pct_and_dom_fuel(gm)
        if rp is not None:  entry['renPct']  = rp
        if dom is not None: entry['domFuel'] = dom
    return entry


def main():
    if not os.path.isdir(DAILY_DIR):
        print(f"ERROR: {DAILY_DIR} not found. Run from repo root.", file=sys.stderr)
        sys.exit(1)

    files = sorted(glob(os.path.join(DAILY_DIR, '*.json')))
    if not files:
        print(f"ERROR: no daily files in {DAILY_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"Backfill: scanning {len(files)} daily files...")

    summary = {'zones': {}}
    stats = {
        'files_processed': 0,
        'entries_added':   0,
        'peakAvg_filled':  0,
        'renPct_filled':   0,
    }

    for fp in files:
        date_str = os.path.basename(fp).replace('.json', '')
        try:
            with open(fp) as f:
                daily = json.load(f)
        except Exception as e:
            print(f"  WARN: skipping {fp}: {e}")
            continue

        zones = daily.get('zones', {})
        for code, zdata in zones.items():
            if not zdata or zdata.get('avg') is None:
                continue
            entry = build_entry_from_daily(date_str, zdata)
            summary['zones'].setdefault(code, []).append(entry)
            stats['entries_added'] += 1
            if 'peakAvg' in entry: stats['peakAvg_filled'] += 1
            if 'renPct'  in entry: stats['renPct_filled']  += 1
        stats['files_processed'] += 1

    # Sort each zone series by date
    for code in summary['zones']:
        summary['zones'][code].sort(key=lambda x: x['d'])

    # Write summary
    os.makedirs(os.path.dirname(SUMMARY_PATH), exist_ok=True)
    with open(SUMMARY_PATH, 'w') as f:
        json.dump(summary, f, separators=(',', ':'))

    print(f"\nDone:")
    print(f"  Files processed: {stats['files_processed']}")
    print(f"  Entries written: {stats['entries_added']}")
    print(f"  Peak/off filled: {stats['peakAvg_filled']}")
    print(f"  Ren%/dom filled: {stats['renPct_filled']}  (only on dates with genmix snapshot)")
    print(f"  Zones tracked:   {len(summary['zones'])}")
    print(f"  Output:          {SUMMARY_PATH}")


if __name__ == '__main__':
    main()
