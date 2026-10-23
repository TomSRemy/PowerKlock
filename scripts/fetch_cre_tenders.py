"""
Results of the CRE renewable tenders (CRE open data, Synthese_AO.csv, updated at each result):
for every period of every tender, the volume offered and kept and the average price kept.

Out  data/cre_tenders.json  {"updated", "source", "rows": [{tech, ao, period, deposit, result, kept_n, kept_mw, offered_mw, price, cspe_contract, years}]}
"""
import csv, io, json, os, sys, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://www.cre.fr/fileadmin/Documents/Open_data/Transition_energetique_et_appels_d_offres/Synthese_AO.csv'
OUT = os.path.join(ROOT, 'data', 'cre_tenders.json')


def num(v):
    try:
        return float(str(v).replace('\xa0', '').replace(' ', '').replace(',', '.'))
    except ValueError:
        return None


def iso(d):
    try:
        return datetime.strptime(d.strip(), '%d/%m/%Y').strftime('%Y-%m-%d')
    except ValueError:
        return None


def main():
    raw = urllib.request.urlopen(urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 (PowerKlock data fetch)'}), timeout=60).read()
    for enc in ('utf-8-sig', 'cp1252'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    rows = list(csv.DictReader(io.StringIO(text), delimiter=';'))
    out = []
    for r in rows:
        price = num(r.get('PRIX_MOYEN_DOSSIERS_A_RETENIR'))
        if price is None:
            continue
        out.append({'tech': r['FILIERE'].strip(), 'ao': r['AO'].strip(), 'period': r['PERIODE'].strip(),
                    'deposit': iso(r['DATE_DEPOT_OFFRES']), 'result': iso(r['DATE_DELIBERATION_INSTRUCTION']),
                    'kept_n': num(r['NB_DOSSIERS_A_RETENIR']), 'kept_mw': num(r['P_CUMULEE_DOSSIERS_A_RETENIR']),
                    'offered_mw': num(r['P_CUMULEE_DOSSIERS_DEPOSES']), 'price': price,
                    'cspe_contract': num(r['CSPE_CONTRAT']), 'years': num(r['DUREE_CONTRAT'])})
    if len(out) < 50:
        sys.exit(f'only {len(out)} rows: previous file kept')
    out.sort(key=lambda x: (x['deposit'] or '', x['tech']))
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'CRE — open data, données sur les appels d’offres relatifs aux énergies renouvelables (' + URL + ')',
                   'rows': out}, f, ensure_ascii=False, separators=(',', ':'))
    print(len(out), 'periods, last', out[-1])


if __name__ == '__main__':
    main()
