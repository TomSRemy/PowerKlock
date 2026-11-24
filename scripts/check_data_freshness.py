#!/usr/bin/env python3
"""Watchdog for data a fetch job silently stops refreshing (e.g. an external API's quota runs out and the
job starts failing every run without anyone noticing, as happened to data/weather_outlook.json for 11 days
in November 2026 — see .github/workflows/fetch_weather_outlook.yml).

Checked independently of the fetch jobs themselves, and independently of Site tests (which data-only
commits do not trigger): a job can keep failing for days without a human in the loop otherwise.

Exit 1 (so the run shows red in Actions) and e-mail (scripts/notify_failure.py) when any watched file is
older than its threshold. Never touches the data itself.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# path, "updated" field to read (dot path), max age in hours
WATCHED = [
    ('data/weather_outlook.json', 'updated', 30),
    ('data/news.json', 'updated', 8),
    ('data/prices.json', 'updated', 14),
    ('data/genmix.json', 'updated', 14),
    ('data/renewables.json', 'updated', 14),
    ('data/load.json', 'updated', 14),
    ('data/crossborder.json', 'updated', 14),
    ('data/m0.json', 'updated', 72),
    # RTE Data Portal needs its own OAuth client (RTE_CLIENT_ID/SECRET): the fetch step is
    # `|| echo "::warning..."`, so an expired/revoked token fails forever without failing the
    # job or sending the e-mail — found stale 23 days (HTTP 401) on 2026-11-18.
    ('data/rte_pp.json', 'updated', 30),
    # Markets › What drives the price: scripts/build_drivers.py was run by no workflow and the page stayed
    # at 7 Nov 2026 for 13 days. Rebuilt after every warehouse sync and rewritten when a figure changes
    # (a new delivery day every day): 3 days leave room for a late feed, not for a job that stopped.
    ('data/drivers/frames.json', 'updated', 72),
]
# files whose own "error" field means broken regardless of age (set when the fetch itself failed
# but something — e.g. an older successful payload — was still written or kept)
ERROR_FIELD = {
    'data/rte_pp.json': 'error',
}


def read(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def age_hours(j, field: str):
    for key in field.split('.'):
        j = j[key]
    u = datetime.fromisoformat(str(j).replace('Z', '+00:00'))
    if u.tzinfo is None:
        u = u.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - u).total_seconds() / 3600


DB_LIMIT_MB = 500   # Supabase free plan


def main():
    stale = []
    for rel, field, max_age in WATCHED:
        path = ROOT / rel
        try:
            j = read(path)
            hrs = age_hours(j, field)
        except Exception as e:
            stale.append(f'{rel}: unreadable ({e})')
            continue
        err = j.get(ERROR_FIELD[rel]) if rel in ERROR_FIELD else None
        if err:
            stale.append(f'{rel}: {err}'[:200])
        elif hrs > max_age:
            stale.append(f'{rel}: {hrs:.1f} h old (limit {max_age} h)')
        else:
            print(f'  {rel}: {hrs:.1f} h old, OK')

    # the warehouse's size: Supabase's free plan stops at 500 MB; a warning at 85 % leaves time to make room
    # (public.db_size_mb(), warehouse migration 035; skipped without SUPABASE_DB_URL)
    db = os.environ.get('SUPABASE_DB_URL')
    if db:
        try:
            import psycopg
            with psycopg.connect(db, connect_timeout=15, prepare_threshold=None) as conn, conn.cursor() as cur:
                cur.execute('select public.db_size_mb()')
                mb = float(cur.fetchone()[0])
            if mb > DB_LIMIT_MB * 0.85:
                stale.append(f'warehouse: {mb:.0f} MB of {DB_LIMIT_MB} MB ({mb / DB_LIMIT_MB:.0%}), make room (oldest quarter-hours to hourly)')
            else:
                print(f'  warehouse: {mb:.0f} MB of {DB_LIMIT_MB} MB ({mb / DB_LIMIT_MB:.0%}), OK')
        except Exception as e:
            print(f'  warehouse size not read: {str(e)[:120]}')

    if stale:
        print('STALE:')
        for s in stale:
            print('  -', s)
        sys.exit(1)
    print('All watched files are fresh.')


if __name__ == '__main__':
    main()
