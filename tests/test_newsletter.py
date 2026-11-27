"""The morning newsletter's own rules (python3 tests/test_newsletter.py), scripts/news_letter.py and
scripts/morning_mail.py: what is never a story, when an article repeats an earlier edition, what « À retenir » may say,
the checks of a generated brief, the units, and the spot tile on the 25-hour day. Each case is a line that reached a
reader, or would have, in the editions of 16 to 27 Nov. 2026 (docs/newsletter_audit.md).
Needs scikit-learn and matplotlib, as the newsletter itself (.github/workflows/morning_mail.yml)."""
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
os.chdir(ROOT)
import morning_mail as mm   # noqa: E402
import news_letter as nl    # noqa: E402

# ── a job advert is never a story (26 Nov. 2026: two in the edition) ──
for t in ('Ingénieur Etudes Confirmé en Ventilation Nucléaire F/H ORANO Montigny-le-Bretonneux',
          'Chef de Projet nucléaire H/F ASSYSTEM Tours, Centre-Val de Loire, France CDI',
          'Analyste marchés de l’électricité (H/F)', 'Project engineer offshore wind (m/w/d)'):
    assert nl.JOB_AD.search(t), t
for t in ('Après l’Arenh, EDF multiplie les contrats d’accès à son nucléaire', 'France triples planned renewable energy auction volume to 1.5 GW',
          'Statkraft acquires 225MW Clash Gour wind farm', 'S06-S10 : le gouvernement dépose son amendement au Sénat'):
    assert not nl.JOB_AD.search(t), t
now = nl.datetime(2026, 11, 26, 6, 0, tzinfo=nl.timezone.utc)
prof = {'weights': {'power': 3, 'markets': 3}, 'keywords': ['nucléaire'], 'france': 2}
ad = {'title': 'Chef de Projet nucléaire H/F ASSYSTEM Tours, Centre-Val de Loire, France CDI', 'source': "L'Usine Nouvelle", 'link': 'a',
      'date': '2026-11-25T20:00:00+00:00', 'tags': ['fr', 'power'], 'topics': ['power'], 'snippet': 'électricité nucléaire'}
real = dict(ad, title='Nucléaire : EDF abaisse sa prévision de production pour 2027', source='AFP', link='b')
assert [i['link'] for i in nl.pick([ad, real], prof, now, 36)] == ['b'], 'a job advert was picked as a story'
print('ok job adverts are never stories')

# ── « never the same article twice »: a repeat is left out, a fresh article is not (27 Nov. 2026: 44 of 124 were) ──
FRESH = [('Statkraft acquires 225MW Clash Gour wind farm', 'Nala inaugurates 99MW Romanian wind farm'),
         ('S06-S10 : le gouvernement dépose son amendement au Sénat, plus de 222 000 contrats photovoltaïques concernés',
          '109 000 coupures de gaz en 2025, en hausse de 4 % : pourquoi le gaz se coupe plus de 2,5 fois plus que l’électricité'),
         ('Qair fournira 18 GWh solaires par an à Holcim Polska pendant 10 ans', 'Grenergy conclut au Pérou un macro PPA renouvelable de 900 GWh par an pendant 15 ans'),
         ('Flamanville 3 : l’ASNR donne une nouvelle autorisation à EDF, mais pas celle de redémarrer',
          'L’ASNR n’est toujours pas convaincue par la solution d’EDF pour renforcer les piscines'),
         ('Le stockage par batteries génère des revenus exceptionnels [La Plateforme Verte]', 'NW investit 200 M€ dans 400 batteries de stockage, dont 300 en France'),
         ("Arrêté du 20 novembre 2026 portant modification de fiches d'opérations standardisées",
          'Contribution de l’UFE relative à l’étude d’une solution pérenne alternative aux échelonnements de l’arrêté du 16 avril 2026')]
REPEAT = [('Prix du gaz : le marché parie sur la détente, ce que les cours de 2027 et 2028 racontent ce 27 novembre',
           'Prix du gaz : le marché parie sur la détente, ce que les cours de 2027 et 2028 racontent ce 24 novembre'),
          ('RTE : la CRE réduit de près de 4 millions d’euros le budget de résilience du réseau', 'Réseau électrique : la CRE encadre à 129,8 millions d’euros la résilience de RTE'),
          ("Romania hosts Nala Renewables' 99.2 MW wind farm supplying Apple", 'Nala inaugurates 99MW Romanian wind farm'),
          ('Tarification dynamique : la CRE précise les offres et prolonge le régime transitoire', 'Prix de l’électricité : la CRE redéfinit les offres à tarification dynamique')]
for a, b in FRESH:
    assert not nl.already_told(a, b), f'fresh article left out:\n  {a}\n  {b}'
for a, b in REPEAT:
    assert nl.already_told(a, b), f'repeat not seen:\n  {a}\n  {b}'
assert not nl.already_told('', 'x') and not nl.already_told('x', '')
print('ok an earlier edition holds back its repeats only')

# ── « À retenir »: a fact of the article, never a generic line nor an instruction to the reader (19 Nov. 2026) ──
title, what = 'Vattenfall signs 56MW German battery deal', 'Vattenfall signe un accord pour un projet de stockage allemand'
for t in ('Suggérez à vos clients d’opter pour des contrats à long terme pour sécuriser des tarifs plus stables.',
          "Adaptez vos positions en fonction de l'incertitude liée aux réformes du marché carbone.",
          "Surveillez les disponibilités nucléaires et les flux d'interconnexions pour évaluer les risques de pénurie.",
          'Informez vos clients de ce changement et orientez-les vers les dispositifs CEE pour leurs projets.',
          'Track renewable projects in emerging markets for potential long-term investment opportunities.',
          'Impact sur les prix des contrats', 'Intérêt pour les PPA', 'Nouvelle opportunité de stockage', 'Prévoir une hausse des coûts.', 'Aucune information disponible'):
    assert nl.takeaway(t, title, what) is None, t
fact = '56 MW pour Vattenfall en Allemagne, mise en service fin 2027'
assert nl.takeaway(fact, title, what) == fact
print('ok « À retenir » is a fact, not advice')

# ── a headline that names nothing is not shown ──
for h in ('Nouvelles du jour en énergie', 'Actualité des contrats et du stockage', "Prix de l'énergie en hausse", 'Prix énergétiques sous tension'):
    assert nl.HOLLOW_HEAD.search(h), h
for h in ('La CRE approuve le cahier des charges de PPE3 Neutre', "Nouvelles règles pour l'appel d'offres PPE3 Neutre"):
    assert not nl.HOLLOW_HEAD.search(h), h
print('ok hollow headlines are dropped')

# ── a summary that only says the title again adds nothing ──
assert nl.adds_nothing('EEX ajuste le calendrier des enchères EUA', 'EEX Customer Information - Adjustment of the EU EUA Auction Calendar') is False   # another language: kept
assert nl.adds_nothing('Vattenfall signs 56MW German battery deal.', 'Vattenfall signs 56MW German battery deal')
assert nl.adds_nothing('', 'x')

# ── the checks of a generated brief: no figure that was not given, no market said to move the wrong way ──
given = [299.05, 3.3, 114.53, -2.1, 2.1, 46.1]
assert nl.numbers_ok('Le spot atteint 299 €/MWh (+3 %), le Cal 27 cède 2 % à 115 €/MWh.', given + [27])
assert not nl.numbers_ok('Le spot atteint 310 €/MWh.', given)
M = [{'label': ['Spot France aujourd’hui', 'France spot today'], 'pct': 3.3, 'show': 'pct'},
     {'label': ['Cal 27 France', 'Cal 27 France'], 'pct': -2.1, 'show': 'pct'}]
assert nl.direction_ok('Le spot français progresse encore. Le Cal 27 recule.', M)
assert not nl.direction_ok('Le spot français recule nettement.', M)
assert not nl.direction_ok('Le spot monte. Le Cal 27 grimpe de 2 %.', M)
print('ok brief checks: figures and directions')

# ── every power or gas price carries €/MWh, carbon €/t, an amount stays an amount ──
assert nl.fix_units('Le Cal 27 termine à 114 €.') == 'Le Cal 27 termine à 114 €/MWh.'
assert nl.fix_units('Le quota de CO₂ remonte à 84 €.') == 'Le quota de CO₂ remonte à 84 €/t.'
assert nl.fix_units('Le spot vaut 299 €/MWh.') == 'Le spot vaut 299 €/MWh.'
assert nl.fix_units('Une amende de 29 000 €.') == 'Une amende de 29 000 €.'
assert nl.fr_num(1234.5) == '1 234,5' and nl.fr_num(299.05, 0) == '299'
print('ok units and French numbers')

# ── the spot tile is the published daily average, also on the 25-hour day (CLAUDE.md › Data) ──
for d in (date(2026, 10, 25), date(2026, 10, 26), date(2026, 11, 27)):
    z = mm.load('history', 'daily', d.isoformat() + '.json')['zones']['FR']
    s = mm.spot(d)
    assert abs(s['base'] - z['avg']) < 1e-9, (d, s['base'], z['avg'])
    assert abs(s['peak'] - z['peakAvg']) < 0.05, (d, s['peak'], z['peakAvg'])
tiles = nl.markets(date(2026, 10, 26))
sp = next(r for r in tiles if r['label'][1] == 'France spot today')
a = mm.load('history', 'daily', '2026-10-26.json')['zones']['FR']['avg']
b = mm.load('history', 'daily', '2026-10-25.json')['zones']['FR']['avg']
assert sp['value'] == round(a, 2) and sp['pct'] == round((a / b - 1) * 100, 1), (sp, a, b)
assert sp['d'] == '2026-10-26' and sp['ref_d'] == '2026-10-25'
for r in tiles:     # a tile that shows a change says the two dates it compares
    assert r['chg'] is None or (r['d'] and r['ref_d'] and r['ref_d'] < r['d']), r
print('ok spot tile = published average, tiles dated')

# ── the week of PowerBrunch: Monday to Sunday before a Monday edition ──
assert nl._week_bounds(date(2026, 11, 30)) == (date(2026, 11, 23), date(2026, 11, 29))
assert nl._week_bounds(date(2026, 11, 27)) == (date(2026, 11, 23), date(2026, 11, 26))
print('ok newsletter rules')
