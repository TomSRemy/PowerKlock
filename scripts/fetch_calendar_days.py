#!/usr/bin/env python3
"""French public holidays and school-holiday zones A/B/C, day by day, for the PPA pricer's calendar
skeleton (brief 2.2 item 5: a coefficient per real day type — weekday, Saturday, Sunday, public
holiday, bridge day, in-zone-X-school-holiday — matched against the same day type in past years).

Sources (both auto-updated open data, no scraping, no key):
  jours fériés        https://calendrier.api.gouv.fr/jours-feries/metropole.json (DINUM/Etalab),
                       one call, 2006-2031
  vacances scolaires  https://data.education.gouv.fr/api/explore/v2.0/.../fr-en-calendrier-scolaire
                       (Ministère de l'Éducation nationale), paginated, zones A/B/C date ranges

Writes data/history/calendar_days.json
    {"updated", "holidays": {"YYYY-MM-DD": "name"}, "vacations": {"A": [["start","end"], ...], "B": [...], "C": [...]}}
    start/end are Europe/Paris calendar dates, half-open [start, end): the night before the return to
    school rolls over to midnight Paris time, so `end` is the first school day back, not the last day off.
    python scripts/fetch_calendar_days.py
"""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

PARIS = ZoneInfo('Europe/Paris')

OUT = Path('data/history/calendar_days.json')
HOLIDAYS_URL = 'https://calendrier.api.gouv.fr/jours-feries/metropole.json'
VACATIONS_URL = 'https://data.education.gouv.fr/api/explore/v2.0/catalog/datasets/fr-en-calendrier-scolaire/records'
UA = {'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'}
FIRST = '2016-01-01'


def fetch_holidays():
    r = requests.get(HOLIDAYS_URL, headers=UA, timeout=60)
    r.raise_for_status()
    return {d: name for d, name in r.json().items() if d >= FIRST}


def fetch_vacations():
    zones = {'A': set(), 'B': set(), 'C': set()}
    offset, limit = 0, 100
    while True:
        r = requests.get(VACATIONS_URL, headers=UA, timeout=60, params={
            'where': f'start_date >= date\'{FIRST}\'',
            'limit': limit, 'offset': offset})
        r.raise_for_status()
        js = r.json()
        rows = js.get('records', [])
        if not rows:
            break
        for rec in rows:
            row = rec['record']['fields']
            z = row.get('zones') or ''
            start, end = to_paris_date(row.get('start_date')), to_paris_date(row.get('end_date'))
            if not start or not end:
                continue
            for letter in ('A', 'B', 'C'):
                if f'Zone {letter}' in z:
                    zones[letter].add((start, end))
        offset += limit
        if offset >= js.get('total_count', 0):
            break
    return {k: sorted(v) for k, v in zones.items()}


def to_paris_date(iso_ts):
    """an ISO timestamp (UTC, as the API gives it) to its Europe/Paris calendar date"""
    if not iso_ts:
        return None
    return datetime.fromisoformat(iso_ts).astimezone(PARIS).date().isoformat()


def main():
    out = {'holidays': fetch_holidays(), 'vacations': fetch_vacations()}
    out['updated'] = __import__('datetime').date.today().isoformat()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT, len(out['holidays']), 'holidays,',
          {k: len(v) for k, v in out['vacations'].items()}, 'vacation periods')


if __name__ == '__main__':
    main()
