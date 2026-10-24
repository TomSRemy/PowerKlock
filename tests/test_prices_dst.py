"""Day-ahead prices on the clock-change days (python3 tests/test_prices_dst.py).
Synthetic ENTSO-E A44 documents: a normal day, the 25-hour day (last Sunday of October)
and the 23-hour day (last Sunday of March), quarter-hourly and hourly, read by
scripts/fetch_data.parse_prices. Each price equals the local hour it belongs to, so a
misplaced hour shows at once."""
import os, sys
os.environ.setdefault('ENTSOE_TOKEN', 'test')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts'))
import importlib.util
spec = importlib.util.spec_from_file_location('fd', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts', 'fetch_data.py'))
fd = importlib.util.module_from_spec(spec); spec.loader.exec_module(fd)

NS = 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'


def doc(start, end, res, prices):
    pts = ''.join(f'<Point><position>{i + 1}</position><price.amount>{p}</price.amount></Point>' for i, p in enumerate(prices))
    return (f'<Publication_MarketDocument xmlns="{NS}"><TimeSeries><Period><timeInterval><start>{start}</start><end>{end}</end></timeInterval>'
            f'<resolution>{res}</resolution>{pts}</Period></TimeSeries></Publication_MarketDocument>')


def local_hours(rep, kind):
    """the local clock hour of each hour of the day: 0..23, with the changing hour (rep: 1 WET, 2 CET, 3 EET)
    twice (long day) or skipped (short day)"""
    if kind == 'long':
        return list(range(rep + 1)) + list(range(rep, 24))
    if kind == 'short':
        return list(range(rep)) + list(range(rep + 1, 24))
    return list(range(24))


def check(name, start, end, req0, req1, kind, res, rep=2):
    hours = local_hours(rep, kind)
    per = 4 if res == 'PT15M' else 1
    prices = [h for h in hours for _ in range(per)]
    pts = fd.parse_prices(doc(start, end, res, prices), req0, req1)
    assert len(pts) == 96, f'{name}: {len(pts)} slots'
    for p in pts:
        h = p['hour'] // 4
        if kind == 'short' and h == rep:
            assert p['price'] is None, f'{name}: skipped hour filled ({p})'
        else:
            assert p['price'] == h, f'{name}: slot {p["hour"]} holds hour {p["price"]}, expected {h}'
    print('ok', name)


# Paris zone (CET/CEST): local midnight = 22:00 or 23:00 UTC the day before
check('normal day, 15 min', '2026-10-23T22:00Z', '2026-10-24T22:00Z', '202610232200', '202610242200', 'normal', 'PT15M')
check('25-hour day, 15 min', '2026-10-24T22:00Z', '2026-10-25T23:00Z', '202610242200', '202610252300', 'long', 'PT15M')
check('25-hour day, hourly', '2026-10-24T22:00Z', '2026-10-25T23:00Z', '202610242200', '202610252300', 'long', 'PT60M')
check('23-hour day, 15 min', '2027-03-27T23:00Z', '2027-03-28T22:00Z', '202703272300', '202703282200', 'short', 'PT15M')
check('23-hour day, hourly', '2027-03-27T23:00Z', '2027-03-28T22:00Z', '202703272300', '202703282200', 'short', 'PT60M')
# Finland (EET/EEST) and Portugal (WET/WEST): the same rule
check('25-hour day, EET zone', '2026-10-24T21:00Z', '2026-10-25T22:00Z', '202610242100', '202610252200', 'long', 'PT15M', rep=3)
check('25-hour day, WET zone', '2026-10-24T23:00Z', '2026-10-26T00:00Z', '202610242300', '202610260000', 'long', 'PT15M', rep=1)
print('all clock-change tests passed')

# Germany-Luxembourg: two series for the same day, sequence 2 first in the document; sequence 1 (SDAC) must win
x = (f'<Publication_MarketDocument xmlns="{NS}">'
     '<TimeSeries><classificationSequence_AttributeInstanceComponent.position>2</classificationSequence_AttributeInstanceComponent.position>'
     '<Period><timeInterval><start>2026-09-20T22:00Z</start><end>2026-09-21T22:00Z</end></timeInterval><resolution>PT15M</resolution>'
     + ''.join(f'<Point><position>{i + 1}</position><price.amount>200</price.amount></Point>' for i in range(96)) + '</Period></TimeSeries>'
     '<TimeSeries><classificationSequence_AttributeInstanceComponent.position>1</classificationSequence_AttributeInstanceComponent.position>'
     '<Period><timeInterval><start>2026-09-20T22:00Z</start><end>2026-09-21T22:00Z</end></timeInterval><resolution>PT15M</resolution>'
     + ''.join(f'<Point><position>{i + 1}</position><price.amount>100</price.amount></Point>' for i in range(96)) + '</Period></TimeSeries></Publication_MarketDocument>')
pts = fd.parse_prices(x, '202609202200', '202609212200')
assert all(p['price'] == 100 for p in pts), 'sequence 2 kept instead of 1'
import enrich_summary as es
v = es._parse_prices_xml(x, es._parse_dt('202609202200'), es._parse_dt('202609212200'))
assert all(p == 100 for p in v), 'backfill reader: sequence 2 kept instead of 1'
print('ok two series: sequence 1 (SDAC) kept by both readers')
