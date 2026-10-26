"""data/history/summary_fr.json: the France rows of summary.json with the price fields only (date, average, min, max,
negative hours, peak and off-peak). About 0.3 MB instead of 19: what Today needs on first load (spot of the last days,
week on week), so the home page no longer downloads the whole multi-zone history. Written next to summary.json by
every script that writes it; run alone to rebuild it:  python scripts/summary_lite.py"""
import json
import os

FIELDS = ('d', 'avg', 'min', 'max', 'negH', 'peakAvg', 'offAvg')


def write_lite(summary, path='data/history/summary_fr.json'):
    rows = (summary.get('zones') or {}).get('FR') or []
    lite = {'zones': {'FR': [{k: r[k] for k in FIELDS if k in r} for r in rows]}}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(lite, f, separators=(',', ':'))
    return path


if __name__ == '__main__':
    with open('data/history/summary.json') as f:
        print('Wrote', write_lite(json.load(f)))
