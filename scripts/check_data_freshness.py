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
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# path, "updated" field to read (dot path), max age in hours
WATCHED = [
    ('data/weather_outlook.json', 'updated', 30),
    ('data/news.json', 'updated', 8),
]


def age_hours(path: Path, field: str):
    j = json.loads(path.read_text(encoding='utf-8'))
    for key in field.split('.'):
        j = j[key]
    u = datetime.fromisoformat(str(j).replace('Z', '+00:00'))
    if u.tzinfo is None:
        u = u.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - u).total_seconds() / 3600


def main():
    stale = []
    for rel, field, max_age in WATCHED:
        path = ROOT / rel
        try:
            hrs = age_hours(path, field)
        except Exception as e:
            stale.append(f'{rel}: unreadable ({e})')
            continue
        if hrs > max_age:
            stale.append(f'{rel}: {hrs:.1f} h old (limit {max_age} h)')
        else:
            print(f'  {rel}: {hrs:.1f} h old, OK')

    if stale:
        print('STALE:')
        for s in stale:
            print('  -', s)
        sys.exit(1)
    print('All watched files are fresh.')


if __name__ == '__main__':
    main()
