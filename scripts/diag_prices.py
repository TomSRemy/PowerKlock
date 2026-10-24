"""Diagnosis of a day-ahead document: every TimeSeries ENTSO-E sends for a zone and a day (business type,
auction, classification sequence, resolution, period, number of points, mean price), to see which one the
readers keep. Writes data/history/diag_prices.json.   ENTSOE_TOKEN=… python scripts/diag_prices.py"""
import json, os, re, sys, requests
from datetime import date, timedelta
CASES = [('DE_LU', '10Y1001A1001A82H', '2026-09-21'), ('DE_LU', '10Y1001A1001A82H', '2026-10-22'), ('NL', '10YNL----------L', '2026-10-10'), ('FR', '10YFR-RTE------C', '2026-09-21')]
out = []
for zone, eic, day in CASES:
    d = date.fromisoformat(day)
    p0, p1 = (d - timedelta(days=1)).strftime('%Y%m%d') + '2200', d.strftime('%Y%m%d') + '2200'
    r = requests.get('https://web-api.tp.entsoe.eu/api', params={'securityToken': os.environ['ENTSOE_TOKEN'], 'documentType': 'A44', 'in_Domain': eic, 'out_Domain': eic, 'periodStart': p0, 'periodEnd': p1}, timeout=60)
    x = r.text
    series = []
    for ts in re.findall(r'<TimeSeries>(.*?)</TimeSeries>', x, re.S):
        tag = lambda t: (re.search(rf'<{t}>([^<]*)</{t}>', ts) or [None, None])[1]
        prices = [float(v) for v in re.findall(r'<price.amount>([^<]+)</price.amount>', ts)]
        series.append({'businessType': tag('businessType'), 'auction.type': tag('auction.type'), 'contract': tag('contract_MarketAgreement.type'),
                       'classificationSequence': tag('classificationSequence_AttributeInstanceComponent.position'), 'curveType': tag('curveType'),
                       'resolution': tag('resolution'), 'start': tag('start'), 'end': tag('end'), 'points': len(prices),
                       'mean_of_points': round(sum(prices) / len(prices), 2) if prices else None})
    out.append({'zone': zone, 'day': day, 'status': r.status_code, 'n_series': len(series), 'series': series, 'head': x[:300]})
json.dump(out, open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'history', 'diag_prices.json'), 'w'), indent=1)
print(json.dumps(out, indent=1)[:4000])
