"""Are the day-ahead prices of the main zones in for the delivery day that should have them?
Before 11:00 UTC: today; after: tomorrow (EPEX results ~12:45 CET). Prints the missing zones
and writes run=true|false to $GITHUB_OUTPUT, so the frequent retry slots of fetch.yml only
fetch when something is missing."""
import json, os
from datetime import datetime, timedelta, timezone

KEY = ['FR', 'DE_LU', 'BE', 'NL', 'ES', 'IT_NORD', 'CH', 'AT']
now = datetime.now(timezone.utc)
day = (now + timedelta(days=1 if now.hour >= 11 else 0)).date().isoformat()
path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'history', 'daily', f'{day}.json')
try:
    zones = json.load(open(path)).get('zones', {})
except Exception:
    zones = {}
missing = [z for z in KEY if not (isinstance(zones.get(z), dict) and zones[z].get('avg') is not None)]
print(f'{day}: missing {missing}' if missing else f'{day}: complete')
with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as f:
    f.write(f"run={'true' if missing else 'false'}\n")
