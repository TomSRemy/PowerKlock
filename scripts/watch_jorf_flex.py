#!/usr/bin/env python3
"""Watch the Journal officiel for texts that change the obligations to stop at negative prices (Tom 2 Nov. 2026: no
data entered by hand, even once a year; the stop obligations come from legal texts, so a job finds them).

Reads the DILA open data of the Journal officiel (one archive per issue, https://echanges.dila.gouv.fr/OPENDATA/JORF/,
no key), every issue since the last one read, and keeps the new texts (published in the last 45 days: an issue also
carries the old texts it amends) whose title or articles speak of negative prices, cite article 175 of the Finance law
for 2025 (the stop orders), or speak of purchase obligation / complément de rémunération together with stopping,
modulation or the balancing mechanism.
Each text found is marked 'taken' once config/flex_rules.json cites it (its JORFTEXT id in a rule's 'jorf'), else
'to review': the stop-obligation table of Prices › Negative prices lists both, and the weekly job e-mails when a new
one appears.

Out  data/history/flex_watch.json  {"updated", "source", "last", "texts": {cid: {date, title, nature, keys, url, status}}}
    python scripts/watch_jorf_flex.py            (exit 0; prints NEW=<n> for the workflow)
"""
import io
import json
import os
import re
import sys
import tarfile
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'history', 'flex_watch.json')
RULES = os.path.join(ROOT, 'config', 'flex_rules.json')
BASE = 'https://echanges.dila.gouv.fr/OPENDATA/JORF/'
MAX_FILES = 40          # a run reads at most this many issues (about three weeks); the next run goes on from there
FIRST_DAYS = 21         # the first run looks back this far

STRONG = ['prix negatif', 'prix negatifs', 'prix spot negatif', 'prix de marche negatif', 'prix de l electricite negatif',
          'periodes de prix negatifs', 'episodes de prix negatifs', 'heures a prix negatifs']
SUPPORT = ['obligation d achat', 'complement de remuneration']
ACTION = ['arret', 'modulation', 'mecanisme d ajustement', 'effacement', 'suspension de la production']
# the founding text of the stop orders: an order that changes them may only cite it (the order of 20 July 2026 does)
CITES = ['article 175 de la loi n 2025 127', '175 de la loi n 2025 127', '175 de la loi de finances pour 2025']
FRESH = 45              # a text counts when published in the issue's last 45 days (an issue also carries old texts it amends)


def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s)


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={'User-Agent': 'PowerKlock data fetch'})
    return urllib.request.urlopen(req, timeout=timeout).read()


def issues(since):
    html = get(BASE, 60).decode('utf-8', 'ignore')
    names = sorted(set(re.findall(r'JORF_(\d{8})-(\d{6})\.tar\.gz', html)))
    return [f'JORF_{d}-{t}.tar.gz' for d, t in names if f'{d}-{t}' > since][:MAX_FILES]


def scan(name):
    """the texts of one issue: cid → {title, nature, date, text}"""
    tx = {}
    with tarfile.open(fileobj=io.BytesIO(get(BASE + name)), mode='r:gz') as tf:
        for m in tf:
            if not m.isfile() or not m.name.endswith('.xml') or '/article/' not in m.name:
                continue
            x = tf.extractfile(m).read().decode('utf-8', 'ignore')
            c = re.search(r'<TEXTE cid="(JORFTEXT\d+)" date_publi="([\d-]+)"[^>]*nature="([^"]*)"', x)
            if not c:
                continue
            t = re.search(r'<TITRE_TXT[^>]*>(.*?)</TITRE_TXT>', x, re.S)
            body = re.sub(r'<[^>]+>', ' ', (re.search(r'<BLOC_TEXTUEL>(.*?)</BLOC_TEXTUEL>', x, re.S) or [None, ''])[1])
            e = tx.setdefault(c.group(1), {'date': c.group(2), 'nature': c.group(3), 'title': re.sub(r'\s+', ' ', t.group(1)).strip() if t else '', 'text': ''})
            e['text'] += ' ' + body
    return tx


def keys(e):
    s = norm(e['title'] + ' ' + e['text'])
    k = [w for w in STRONG if f' {w} ' in f' {s} '] + [w for w in CITES if w in s][:1]
    if not k and any(f' {w} ' in f' {s} ' for w in SUPPORT) and any(f' {w}' in f' {s}' for w in ACTION) and ('electricite' in s or 'energie' in s):
        k = [w for w in SUPPORT + ACTION if f' {w}' in f' {s}']
    return k


def main():
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    texts = old.get('texts', {})
    since = old.get('last') or (date.today() - timedelta(days=FIRST_DAYS)).strftime('%Y%m%d-000000')
    try:
        todo = issues(since)
    except Exception as e:   # the DILA site down: keep the file, say so
        print(f'Journal officiel index not read ({type(e).__name__}): previous file kept')
        print('NEW=0')
        return 0
    rules = open(RULES).read()
    new = 0
    last = since
    for name in todo:
        try:
            tx = scan(name)
        except Exception as e:
            print(f'{name}: not read ({type(e).__name__}), next run will retry')
            break
        day = date(int(name[5:9]), int(name[9:11]), int(name[11:13]))
        for cid, e in tx.items():
            try:
                fresh = (day - date.fromisoformat(e['date'])).days <= FRESH
            except ValueError:
                fresh = False
            k = keys(e) if fresh else []
            if k and cid not in texts:
                texts[cid] = {'date': e['date'], 'title': e['title'], 'nature': e['nature'], 'keys': k,
                              'url': f'https://www.legifrance.gouv.fr/jorf/id/{cid}'}
                new += 1
                print('found', e['date'], cid, e['title'][:120])
        last = name[5:20]
    for cid, e in texts.items():
        e['status'] = 'taken' if cid in rules else 'review'
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'source': 'DILA — Journal officiel open data (JORF), ' + BASE, 'last': last,
                   'texts': dict(sorted(texts.items(), key=lambda kv: kv[1]['date'], reverse=True))}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(todo)} issues read up to {last}; {new} new text(s), {sum(1 for e in texts.values() if e["status"] == "review")} to review')
    print(f'NEW={new}')
    if os.environ.get('GITHUB_ENV') and new:
        with open(os.environ['GITHUB_ENV'], 'a') as f:
            f.write(f'JORF_NEW={new}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
