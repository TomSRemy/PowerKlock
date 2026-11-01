"""
Watchdog on the CRE tender results (data/cre_tenders.json, refreshed three times a day by fetch_cre_tenders.py
inside the RTE job, where a failure is only a warning). Fails (and the workflow e-mails) when a new result
could be missed:
  · the file has not been refreshed for 3 days (the CRE open data file could not be read);
  · it holds fewer periods than the last check (rows lost);
  · no tender has had a result for 9 months (the PPE2 tenders give one every few months: the open data file
    has probably stopped being updated, or its format changed).
Out  data/cre_tenders_check.json  {"checked", "rows", "latest_result"} (the count the next check compares with)
"""
import json, os, sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA, MEMO = os.path.join(ROOT, 'data', 'cre_tenders.json'), os.path.join(ROOT, 'data', 'cre_tenders_check.json')


def main():
    now = datetime.now(timezone.utc)
    j = json.load(open(DATA))
    rows = j.get('rows') or []
    upd = datetime.strptime(j['updated'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    latest = max((r['result'] for r in rows if r.get('result')), default=None)
    prev = json.load(open(MEMO)) if os.path.exists(MEMO) else {}
    errors = []
    if now - upd > timedelta(days=3):
        errors.append(f'not refreshed since {j["updated"]} (the CRE open data file could not be read)')
    if len(rows) < prev.get('rows', 0):
        errors.append(f'{len(rows)} periods against {prev["rows"]} at the last check')
    if not latest or latest < (now - timedelta(days=270)).strftime('%Y-%m-%d'):
        errors.append(f'no tender result since {latest}: the CRE open data file may have stopped or changed format')
    for e in errors:
        print('::error::CRE tenders: ' + e)
    if errors:
        sys.exit(1)
    json.dump({'checked': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'rows': len(rows), 'latest_result': latest}, open(MEMO, 'w'), indent=1)
    print(f'CRE tenders OK: {len(rows)} periods, latest result {latest}, refreshed {j["updated"]}')


if __name__ == '__main__':
    main()
