#!/usr/bin/env python3
"""RTE's own estimate of the wind and solar output given up at negative prices, read from its yearly Bilan électrique
(Tom 2 Nov. 2026: no figure entered by hand; the Bilan is republished every year in the same form, so a job reads it).

The publications page of RTE's analysis site lists every yearly Bilan (/bilan-electrique-YYYY/synthese); each one links
its full report ("Rapport Complet", PDF). The report gives the year's estimate in a sentence of the price or production
chapter, worded a little differently each year, e.g.
    2024: "... a représenté environ 1,7 TWh (...) dont environ 0,9 TWh de production éolienne écrêtée et environ 0,8 TWh
           de production solaire."
    2025: "... ont conduit à renoncer à environ 3 TWh de production solaire et éolienne." and "1,3 TWh de production
           éolienne terrestre et 1,6 TWh de production solaire (estimation RTE)."
The total and the wind / solar split are read; the year is kept only when wind + solar matches the total (± 0.3 TWh)
or when only one of the two is found. A year already read is not read again; a report that no longer matches keeps the
previous file and fails the step (the workflow e-mails).

Compared on Prices › Negative prices with the energy PowerKlock computes (scripts/build_flex_share.py). RTE's figure is
an estimate against its own forecast of output without negative prices.

Out  data/history/rte_curtailment.json  {"updated", "source", "years": {YYYY: {total, wind, solar, report, quote}}}
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'rte_curtailment.json')
SITE = 'https://analysesetdonnees.rte-france.com'
NUM = r'(\d+(?:,\d+)?)'


def get(url, timeout=120):
    req = urllib.request.Request(urllib.parse.quote(url, safe=':/?=&%'), headers={'User-Agent': 'Mozilla/5.0 (PowerKlock data fetch)'})
    return urllib.request.urlopen(req, timeout=timeout).read()


def fl(s):
    return float(s.replace(',', '.'))


def parse(text):
    """total and split (TWh) from the report's text, with the sentence they come from. The PDF's text comes out with stray
    spaces inside words ("pr oduction", "T Wh"), so the search runs on the text without any space"""
    t = re.sub(r'\s+', '', text).replace('’', "'").replace('-', '')
    w = sol = None
    m = re.search(r"(\d+(?:,\d+)?)TWhdeproductionéolienne(?:terrestre)?(?:écrêtée)?,?(?:environ)?et(?:environ)?(\d+(?:,\d+)?)TWhdeproductionsolaire", t)
    if m:
        w, sol = fl(m.group(1)), fl(m.group(2))
    cands = []
    for m2 in re.finditer(r"[^.]{0,300}prix(?:spot)?n[ée]gatifs?[^.]{0,300}\.", t):
        sen = m2.group(0)
        if not re.search(r"écrêt|renonc|modul|arrêt", sen):
            continue
        for n in re.finditer(r"(?<![\d,])(\d+(?:,\d+)?)TWh", sen):
            v = fl(n.group(1))
            if 0 < v < 50:
                cands.append((v, sen))
    total = quote = None
    if cands:
        if w is not None and sol is not None:
            close = [c for c in cands if abs(c[0] - (w + sol)) <= 0.3]
            total, quote = close[0] if close else (None, None)
        else:
            total, quote = cands[0]
    if m:
        quote = (quote + ' … ' if quote else '') + m.group(0)
    # the year before, recalled in the same sentence ("contre 0,6 TWh en 2023")
    prev = {}
    for _, sen in cands:
        for p in re.finditer(r"contre(?:environ)?(\d+(?:,\d+)?)TWhen(\d{4})", sen):
            prev[p.group(2)] = fl(p.group(1))
    return total, w, sol, quote, prev


def main():
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    years = old.get('years', {})
    pub = get(SITE + '/publications', 60).decode('utf-8', 'ignore')
    found = sorted(set(re.findall(r'/bilan-electrique-(\d{4})/synthese', pub)))
    bad = []
    for y in found:
        if y in years:
            continue
        page = get(f'{SITE}/bilan-electrique-{y}/synthese', 60).decode('utf-8', 'ignore')
        pdfs = [u for u in re.findall(r'href="(https://assets\.rte-france\.com/[^"]+\.pdf)"', page) if re.search(r'(?i)rapport', u) and re.search(r'(?i)complet|rapport', u)]
        pdfs = sorted(set(pdfs), key=lambda u: ('complet' not in u.lower(), u))
        if not pdfs:
            bad.append(f'{y}: no full report linked'); continue
        try:
            from pypdf import PdfReader
            text = ''
            for pg in PdfReader(io.BytesIO(get(pdfs[0], 300))).pages:
                try:
                    text += ' ' + (pg.extract_text() or '')
                except Exception:   # a page with too many drawn objects: its text is skipped, not the report
                    pass
        except Exception as e:
            bad.append(f'{y}: report not read ({type(e).__name__})'); continue
        total, w, s, q, prev = parse(text)
        for py, pv in prev.items():   # a year whose own report words it otherwise: the figure recalled by the next one
            if py not in years and py != y:
                years[py] = {'total': pv, 'wind': None, 'solar': None, 'report': pdfs[0], 'quote': None, 'from': 'next report'}
                bad = [b for b in bad if not b.startswith(py + ':')]
        if total is None and w is not None and s is not None:
            total = round(w + s, 2)   # the split found, its total worded otherwise
        ok = total is not None and (w is None or s is None or abs(w + s - total) <= 0.3)
        if not ok:
            bad.append(f'{y}: figure not found or split ≠ total ({total}, {w}, {s})'); continue
        years[y] = {'total': total, 'wind': w, 'solar': s, 'report': pdfs[0], 'quote': q[:600] if q else None}
        print(f'{y}: {total} TWh (wind {w}, solar {s})')
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'RTE, Bilan électrique (full report, yearly), ' + SITE + '/publications',
                   'years': dict(sorted(years.items()))}, f, ensure_ascii=False, separators=(',', ':'))
    for b in bad:
        print('::warning::' + b)
    print(f'{len(years)} year(s): ' + ', '.join(f"{k} {v['total']}" for k, v in sorted(years.items())))
    return 1 if bad and not years else 0


if __name__ == '__main__':
    sys.exit(main())
