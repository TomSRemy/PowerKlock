#!/usr/bin/env python3
"""Coal price before the SEFE series (data/history/commodities_series.json 'coal', API2 Cal+1, from January 2022):
the World Bank's monthly coal prices (Commodity Markets, "Pink Sheet", CMO-Historical-Data-Monthly.xlsx), South
African coal (Richards Bay, the closest to the ARA price paid in north-west Europe), $/t, 2015-01 to 2021-12.

Run once (history only: the World Bank republishes the file each month at a new address, so no daily job reads it);
the merit order of the PPA scenario generator takes it for the years before 2022.

Writes data/history/coal_monthly.json {"source", "unit", "months": {"2019-01": 91.29, ...}}
    python scripts/backfill_coal_history.py [URL of the monthly xlsx]
"""
import io
import json
import sys
from pathlib import Path

import openpyxl
import requests

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/related/CMO-Historical-Data-Monthly.xlsx'
OUT = Path('data/history/coal_monthly.json')


def main():
    r = requests.get(URL, timeout=120, headers={'User-Agent': 'PowerKlock (github.com/TomSRemy/PowerKlock)'})
    r.raise_for_status()
    ws = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True, data_only=True)['Monthly Prices']
    rows = list(ws.iter_rows(values_only=True))
    head = next(row for row in rows if row and 'Coal, South African **' in row)
    col = head.index('Coal, South African **')
    months = {}
    for row in rows:
        k = row[0]
        if isinstance(k, str) and len(k) == 7 and k[4] == 'M' and '2015' <= k[:4] <= '2021':
            v = row[col]
            if isinstance(v, (int, float)):
                months[f'{k[:4]}-{k[5:]}'] = round(float(v), 2)
    OUT.write_text(json.dumps({'source': 'World Bank, Commodity Markets (Pink Sheet), monthly prices: Coal, South African (Richards Bay), '
                                         'nominal $/t; history before the SEFE API2 series (2022)', 'unit': '$/t', 'months': months}, indent=0))
    print(len(months), 'months', min(months), max(months))


if __name__ == '__main__':
    main()
