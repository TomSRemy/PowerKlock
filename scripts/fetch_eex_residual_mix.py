"""data/residual_mix.json: the French production, supplier and residual mixes published every June by EEX (keeper of
the French guarantee-of-origin registry), 2017 → last year, with the guarantee-of-origin volumes of the year
(issued, expired, cancelled) and EEX's production total.

Source: the yearly files linked on https://www.eex.com/en/markets/energy-certificates/french-power-gos (one zip
per year: an xlsx with the three mixes and the CO₂ / radioactive-waste content, and the press release PDF with the
volumes). The page is read for its links, so next June's file is picked up without a change here.
Run:  python scripts/fetch_eex_residual_mix.py      (pip install openpyxl pypdf requests)"""
import io
import json
import os
import re
import zipfile
from datetime import datetime, timezone

import requests

PAGE = 'https://www.eex.com/en/markets/energy-certificates/french-power-gos'
BASE = 'https://www.eex.com'
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'residual_mix.json')
UA = {'User-Agent': 'Mozilla/5.0 (PowerKlock data fetch)'}
KEYS = {'Nucléaire': 'nuclear', 'Hydraulique': 'hydro', 'Eolien': 'wind', 'Solaire': 'solar', 'Biomasse': 'bio', 'Géothermie': 'geo', 'Autres Renouvelables': 'other_ren',
        'Gaz': 'gas', 'Charbon': 'coal', 'Pétrole': 'oil', 'Autres Fossiles': 'other_fossil', 'Total renouvelable': 'renewable', 'Total Fossile': 'fossil',
        'CO2': 'co2_g_kwh', 'Déchets radioactifs': 'waste_mg_kwh'}


def num(s):
    return float(s.replace(' ', '').replace(' ', '').replace(',', '.')) if s else None


def read_xlsx(data):
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(data), data_only=True).worksheets[0]
    mixes = {'production': {}, 'supplier': {}, 'residual': {}}
    for row in ws.iter_rows(values_only=True):
        cells = [c for c in row if c is not None]
        labels = [c for c in cells if isinstance(c, str) and c.strip() not in ('%', 'gCO2/kWh', 'mg/kWh')]
        nums = [c for c in cells if isinstance(c, (int, float))]
        if len(nums) >= 3 and labels and labels[-1].strip() in KEYS:
            k = KEYS[labels[-1].strip()]
            if k in mixes['production']:
                continue   # the English table repeats the French one
            for m, v in zip(('production', 'supplier', 'residual'), nums[-3:]):
                mixes[m][k] = round(v * (1 if k in ('co2_g_kwh', 'waste_mg_kwh') else 100), 3)
    return mixes


def read_pdf(data):
    from pypdf import PdfReader
    t = re.sub(r'\s+', ' ', ' '.join(p.extract_text() or '' for p in PdfReader(io.BytesIO(data)).pages[:2]))
    t = re.sub(r'(\d) (\d)(?=[\d,]* ?TWh)', r'\1\2', t)   # "1 8,6 TWh" in some PDFs
    g = lambda pat: num((re.search(pat, t) or [None, None])[1])   # noqa: E731
    out = {'production_twh': g(r'Sur les ([\d,.]+) ?TWh'), 'renewable_twh': g(r'produite en France en \d{3} ?\d, ([\d,.]+) ?TWh'),
           'go_issued_twh': g(r'certifié ([\d,.]+) ?TWh') or g(r'([\d,.]+) TWh d.électricité renouvelable produite'),
           'go_expired_twh': g(r'([\d,.]+) ?TWh ont expiré'), 'go_cancelled_twh': g(r'([\d,.]+) ?TWh ont été annulé') or g(r'En \d{4}, ([\d,.]+) ?TWh d.électricité consommée'),
           'period': (re.search(r'données du ([^.]{5,40}?) au ([^.]{5,40}?)\.', t) or [None])[0]}
    return {k: v for k, v in out.items() if v is not None}


def main():
    html = requests.get(PAGE, headers=UA, timeout=60).text
    links = sorted(set(re.findall(r'href="(/fileadmin/[^"]*(?:[Rr]esidual)[^"]*\.zip)"', html)))
    try:
        old = json.load(open(OUT))
    except Exception:   # noqa: BLE001
        old = {'years': {}}
    if old.get('files') == links and old.get('years'):
        print('no new EEX file: nothing to do'); return   # read once a year, checked every day
    years = old.get('years', {})
    for link in links:
        z = zipfile.ZipFile(io.BytesIO(requests.get(BASE + link, headers=UA, timeout=120).content))
        pdfs = {}
        for name in z.namelist():
            m = re.search(r'(20\d\d)', name.split('/')[-1])
            if name.endswith('.xlsx') and m:
                y = m.group(1)
                years.setdefault(y, {}).update(read_xlsx(z.read(name)))
                years[y]['file'] = BASE + link
            elif name.endswith('.pdf'):
                pdfs[name] = z.read(name)
        for name, data in pdfs.items():
            info = read_pdf(data)
            y = (re.search(r'(?:pour|for) (20\d\d)', name) or re.search(r'mix_for_(20\d\d)', name) or [None, None])[1]
            if y and y in years:
                years[y]['eex'] = info
        print('read', link.split('/')[-1])
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='minutes'), 'source': 'EEX, French guarantees of origin registry', 'page': PAGE, 'files': links,
           'note': 'Mixes in % (CO₂ in g/kWh, radioactive waste in mg/kWh). Production mix: RTE data, hydro excluding pumped storage. Supplier mix: production mix corrected for physical exchanges outside the AIB area and for guarantees of origin issued, expired and cancelled. Residual mix: supplier mix minus the guarantees of origin cancelled in France for green offers; computed on 1 April → 31 March.',
           'years': dict(sorted(years.items()))}
    json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('Wrote', OUT, 'years', list(out['years']))


if __name__ == '__main__':
    main()
