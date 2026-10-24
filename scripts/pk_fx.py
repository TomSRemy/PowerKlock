"""Day-ahead prices in euros whatever currency ENTSO-E sends them in.
Some zones were published in their own currency for a while (Bulgaria in BGN until early 2022,
Romania in RON until mid-2021, as A44 currency_Unit.name says): stored as such they were 2 to 5
times too high. BGN has a fixed rate; the others take the ECB reference rate of the day (free
ECB data API, read once per run and cached in memory)."""
import csv, io, urllib.request
from datetime import date, timedelta

FIXED = {'EUR': 1.0, 'BGN': 1.95583}
_cache = {}


def _ecb(cur):
    if cur not in _cache:
        rates = {}
        try:
            url = f'https://data-api.ecb.europa.eu/service/data/EXR/D.{cur}.EUR.SP00.A?format=csvdata&startPeriod=2014-01-01'
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'PowerKlock'}), timeout=60).read().decode()
            for r in csv.DictReader(io.StringIO(raw)):
                try:
                    rates[r['TIME_PERIOD']] = float(r['OBS_VALUE'])
                except (ValueError, KeyError):
                    pass
        except Exception as e:
            print(f'  ECB rate {cur} not read: {e}')
        _cache[cur] = rates
    return _cache[cur]


def per_eur(cur, day):
    """units of `cur` for one euro on `day` (the last ECB rate on or before it); None if unknown"""
    cur = (cur or 'EUR').upper()
    if cur in FIXED:
        return FIXED[cur]
    rates = _ecb(cur)
    d = date.fromisoformat(day) if isinstance(day, str) else day
    for k in range(10):
        r = rates.get((d - timedelta(days=k)).isoformat())
        if r:
            return r
    return None


def to_eur(values, cur, day):
    """values in `cur` → euros; unchanged for EUR; None values kept; None list if the rate is unknown"""
    r = per_eur(cur, day)
    if r is None:
        return None
    if r == 1.0:
        return values
    return [None if v is None else round(v / r, 4) for v in values]
