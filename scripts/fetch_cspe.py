"""
Public cost of the support to renewables, by technology (CRE deliberation on the charges de service
public de l'énergie, each July). The annexes' Table 1 gives, in M€, the support to renewable power by
technology: forecast for next year (one annex) and the charges actually observed for last year (another).

The deliberation page follows the same address every year; its annexes are read (pypdf) and recognised
by their Table 1 title, not their number. If the format changes, the run fails loudly (::error) and the
previous file is kept.

Out  data/cspe.json  {"updated", "source", "years": {"2025": {"observed": {tech: M€}, "observedSrc"}, "2027": {"forecast": {...}}}}
"""
import io, json, os, re, sys, urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'cspe.json')
PAGE = ('https://www.cre.fr/documents/deliberations/evaluation-des-charges-de-service-public-de-lenergie-a-compenser-en-{n}'
        '-et-a-la-reevaluation-des-charges-de-service-public-de-lenergie-a-compenser-en-{y}.html')
TECH = {'Eolien terrestre': 'onshore', 'Eolien en mer': 'offshore', 'Photovoltaïque': 'solar', 'Bio-énergies': 'bio',
        'Autres énergies': 'other', 'Injection biométhane': 'biomethane'}
NUM = re.compile(r'-?\d{1,3}(?:[  ]\d{3})*,\d+')
UA = {'User-Agent': 'Mozilla/5.0 (PowerKlock data fetch)'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()


def fnum(s):
    return float(s.replace(' ', '').replace(' ', '').replace(',', '.'))


def table1(pdf_bytes):
    """(kind, year, {tech: M€, 'total_enr': M€}) from the annex's Table 1, or None"""
    import pypdf
    r = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    text = '\n'.join((p.extract_text() or '') for p in r.pages[:6])
    m = re.search(r'Tableau 1\s*:\s*(Prévision des charges|Charges)[^\n]*?au titre de\s*(\d)\s*(\d)\s*(\d)\s*(\d)', text)
    if not m:
        return None
    kind = 'forecast' if m.group(1).startswith('Prévision') else 'observed' if 'constatées' in text[m.start():m.start() + 200] else None
    if not kind:
        return None
    year = ''.join(m.group(i) for i in range(2, 6))
    out = {}
    for line in text[m.end():].split('\n'):
        name = re.sub(r'\s+', ' ', NUM.split(line)[0]).strip()
        vals = NUM.findall(line)
        if name in TECH and vals:
            out.setdefault(TECH[name], fnum(vals[-1]))
    elec = [out.get(k) for k in ('onshore', 'offshore', 'solar', 'bio', 'other')]
    if all(v is not None for v in elec):
        out['total_power'] = round(sum(elec), 1)   # renewable power, mainland (biomethane apart)
    return kind, year, out


def main():
    old = json.load(open(OUT)) if os.path.exists(OUT) else {'years': {}}
    years = old.get('years', {})
    found = 0
    if str(date.today().year + 1) in years and 'forecast' in years[str(date.today().year + 1)]:
        print('this year\'s deliberation already read: nothing to do until next July'); return
    for y in range(date.today().year - 1, date.today().year + 1):   # this year's deliberation, and last year's
        url = PAGE.format(n=y + 1, y=y)
        try:
            html = get(url).decode('utf-8', 'replace')
        except Exception as e:
            print(f'{y}: no deliberation page yet ({e})')
            continue
        links = sorted(set(re.findall(r'href="([^"]*[Aa]nnexe_\d+\.pdf)"', html)))
        for href in links:
            u = href if href.startswith('http') else 'https://www.cre.fr' + href
            try:
                res = table1(get(u))
            except Exception as e:
                print(f'  {u}: not read ({e})'); continue
            if not res:
                continue
            kind, yr, vals = res
            if len(vals) < 5:
                print(f'::error::CSPE {kind} {yr}: Table 1 found but only {len(vals)} rows read ({u}): format changed?')
                continue
            years.setdefault(yr, {})[kind] = vals
            years[yr][kind + 'Src'] = u
            found += 1
            print(f'  {kind} {yr}: {vals}')
    if not found:
        sys.exit('::error::no CSPE table read: previous file kept')
    json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
               'source': 'CRE — délibération annuelle sur les charges de service public de l’énergie, annexes (Tableau 1), M€',
               'years': dict(sorted(years.items()))}, open(OUT, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
