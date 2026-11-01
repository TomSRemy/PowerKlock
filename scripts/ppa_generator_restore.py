#!/usr/bin/env python3
"""Put back the scenario generator's last good results when this week's run failed twice (Tom 1 Nov. 2026: on
1 Nov. a missing library made the generator fail and scripts/ppa_lab.py, which rewrites data/history/ppa_forecast.json,
left the file without it, so the site fell back silently to the old method for a few hours).

Copies from the previous file (saved before scripts/ppa_lab.py ran) the 'generator' block and each month's
'generator', 'generatorPaid', 'generatorP10' and 'generatorP90' into the new file, and marks the block
'restored' with today's date so the pricer can say so. Exits 1 when there is nothing to restore.
    python scripts/ppa_generator_restore.py /tmp/ppa_forecast_prev.json
"""
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F_PATH = os.path.join(ROOT, 'data', 'history', 'ppa_forecast.json')
KEYS = ('generator', 'generatorPaid', 'generatorP10', 'generatorP90')


def main():
    prev = json.load(open(sys.argv[1]))
    cur = json.load(open(F_PATH))
    if not prev.get('generator'):
        print('no previous generator results to restore')
        return 1
    n = 0
    for tech, convs in prev.get('forecast', {}).items():
        for conv, months in convs.items():
            for ym, e in months.items():
                c = cur.get('forecast', {}).get(tech, {}).get(conv, {}).get(ym)
                if c is None:
                    continue
                for k in KEYS:
                    if e.get(k) is not None:
                        c[k] = e[k]
                        n += 1
    cur['generator'] = dict(prev['generator'], restored=date.today().isoformat())
    with open(F_PATH, 'w') as f:
        json.dump(cur, f, separators=(',', ':'))
    print(f'restored the generator of {prev["generator"].get("asOf")}: {n} monthly values')
    return 0


if __name__ == '__main__':
    sys.exit(main())
