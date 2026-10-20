#!/usr/bin/env python3
"""PowerKlock data API index → data/api.json.

Lists the JSON files other applications can read directly from the site
(no key, CORS open on GitHub Pages), with what they hold, how often they
change and their source licence. Only open sources and PowerKlock's own
calculations are listed: third-party market data (forwards, commodity
cockpit, broker GO prices), weather forecasts and news are not.
"""
import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://tomsremy.github.io/PowerKlock/'
D = [
    # path, title, content, refresh, source / licence
    ('data/prices.json', 'Day-ahead prices · latest day', 'Every bidding zone: average, min, max, peak / off-peak, negative hours and the 96 quarter-hour prices of the latest delivery day.', 'twice a day', 'ENTSO-E Transparency Platform'),
    ('data/history/daily/{YYYY-MM-DD}.json', 'Day-ahead prices · one day', 'Same content for any delivery day since 2015 (France) / 2020 (other zones).', 'daily', 'ENTSO-E Transparency Platform'),
    ('data/history/monthly/{YYYY-MM}.json', 'Day-ahead prices · daily figures of a month', 'Per zone and day: average, min, max, negative hours.', 'daily', 'ENTSO-E Transparency Platform'),
    ('data/history/summary.json', 'Day-ahead prices · daily history', 'Per zone, every day: average, min, max, negative hours, peak / off-peak, rolling averages.', 'daily', 'ENTSO-E Transparency Platform'),
    ('data/history/fr_prices/{YYYY}.json', 'France day-ahead · quarter-hours of a year', '96 prices per day for a whole year.', 'daily', 'ENTSO-E Transparency Platform'),
    ('data/history/neg_profile.json', 'Negative prices by month × hour', 'Per zone and year: hours with a negative price for each month and hour of the day, and the days counted.', 'daily', 'PowerKlock, from ENTSO-E'),
    ('data/history/rte/{YYYY-MM}.json', 'France generation · quarter-hours of a month', 'Per day, 96 values (MW): nuclear, wind, solar, hydro (run-of-river, lakes, pumped storage), gas, coal, oil, bioenergy, consumption and its D-1 forecast, exchanges, CO₂ intensity.', 'every 3 hours (current month)', 'RTE éCO2mix — Licence Ouverte Etalab 2.0'),
    ('data/history/rte/fr_daily.json', 'France generation · daily statistics', 'Every day since 2015: average output by source, consumption min / max, CO₂, baseload and wind / solar / nuclear capture prices.', 'daily', 'RTE éCO2mix × ENTSO-E'),
    ('data/history/fr_capture.json', 'France solar and wind capture · daily sums', 'Per day: price sums and counts, solar and wind output and revenue, for all hours and for hours with a price > 0 — aggregate any window into capture prices and rates.', 'daily', 'PowerKlock, from RTE and ENTSO-E'),
    ('data/m0.json', 'France M0 wind and solar', 'Monthly reference market prices M0 for wind and solar since 2020.', 'daily', 'PowerKlock, from RTE and ENTSO-E'),
    ('data/history/hydro_reservoirs.json', 'Hydro reservoirs', 'Weekly stored energy (MWh) since 2015 for FR, CH, ES, PT, AT, IT, NO, SE, FI.', 'weekly', 'ENTSO-E Transparency Platform'),
    ('data/history/capacity.json', 'Installed capacity', 'Installed capacity by technology and year, per country.', 'monthly', 'Energy-Charts (Fraunhofer ISE) — CC BY 4.0'),
    ('data/map/{YYYY-MM-DD}.json', 'European power map', 'Generation mix, CO₂, renewable share and cross-border flows per country, every hour of a day (last 10 days).', 'every 3 hours', 'Energy-Charts (Fraunhofer ISE) — CC BY 4.0'),
    ('data/crossborder.json', 'Cross-border flows', 'Physical flows on French borders, latest days.', 'twice a day', 'ENTSO-E Transparency Platform'),
]


def main():
    ds = []
    for path, title, content, refresh, src in D:
        local = os.path.join(ROOT, path.replace('{YYYY-MM-DD}', '').replace('{YYYY-MM}', '').replace('{YYYY}', ''))
        example = None
        if '{' in path:
            folder = os.path.dirname(os.path.join(ROOT, path))
            files = sorted(f for f in os.listdir(folder) if f.endswith('.json') and f[:2] in ('19', '20')) if os.path.isdir(folder) else []
            example = BASE + os.path.relpath(os.path.join(folder, files[-1]), ROOT) if files else None
        size = os.path.getsize(local) if os.path.isfile(local) else None
        ds.append({'url': BASE + path, 'title': title, 'content': content, 'refresh': refresh, 'source': src,
                   **({'example': example} if example else {}), **({'sizeKB': size // 1024} if size else {})})
    out = {
        'name': 'PowerKlock data API', 'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'usage': 'Plain HTTPS GET, JSON, no key. Cite the source of each dataset. Times are Paris delivery days unless stated.',
        'datasets': ds,
        'charts': {
            'embed': BASE + 'index.html?embed={chart}&{param}={value}',
            'png': 'https://raw.githubusercontent.com/TomSRemy/PowerKlock/png/{chart}.png',
            'list': 'https://raw.githubusercontent.com/TomSRemy/PowerKlock/png/charts.json',
            'note': 'Every chart of the catalogue (☆ on the site) can be embedded in an iframe with its parameters; PNG images are refreshed twice a day with the default parameters.',
        },
    }
    with open(os.path.join(ROOT, 'data', 'api.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'{len(ds)} datasets')


if __name__ == '__main__':
    main()
