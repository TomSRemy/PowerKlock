#!/usr/bin/env python3
"""Deck 'les cas de couplage', case by case: the reference (France alone), then each case on the same merit order
(mechanism, then when it happens with a typical real hour), a recap, is it dearer (yes and no), the gains (RTE and
CRE). Needs schema6.py, cases5.py, cases_hist.py, case_profiles.py, summary.py, charts.py first."""
import json, base64, os, re
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
U = json.load(open('summary.json')); O = json.load(open('observed.json')); FW = json.load(open('forwards.json'))
R = json.load(open('model_results.json'))
img = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
n = lambda v, d=0: f"{v:,.{d}f}".replace(',', ' ').replace('.', ',')
pc = lambda v: f"{v * 100:.0f} %"
u = U['2025']; sp = u['state_prices']; sh = u['shares']; o = O['2025']
slides = []
def sl(title, body, kicker):
    slides.append(f'<section><div class="k">{kicker}</div><h1>{title}</h1><div class="b">{body}</div><div class="f"><span translate="no">PowerKlock</span> · couplage des marchés</div></section>')

C5 = json.load(open('cases5.json')); H = json.load(open('cases_hist.json')); PR = json.load(open('case_profiles.json')); MC = json.load(open('m_cases.json'))
c = C5['2025']; c22 = C5['2022']
def block(rows):
    return '<table class="kv">' + ''.join(f'<tr><th>{k}</th><td>{v}</td></tr>' for k, v in rows) + '</table>'
bn = lambda m: n(m / 1000, 1) + ' Md€' if m >= 950 else n(m) + ' M€'
HN = lambda h: f'{h} h'
NOTE = 'Merit order simplifié, identique sur tous les dessins : parc et prix illustratifs. Point rouge : prix de la France, lu sur la production française ; point blanc : prix de la France seule (50 €). Les vrais chiffres sont dans les tableaux (ENTSO-E, Energy-Charts, RTE ; calcul PowerKlock).'
DEF = 'Ligne pas saturée = prix France égal à ceux de la Belgique et de l’Allemagne (au centime) ; saturée = France moins chère (exportatrice) ou plus chère (importatrice) que les deux ; exportatrice / importatrice = signe des échanges commerciaux.'

def mech(i, title, how, rows):
    sl(title, f'''<div class="two"><div><img src="{img(f'm_{i}.png')}"></div><div>
<p class="sm"><b>Ce qui se passe.</b> {how}</p>{block(rows)}</div></div><p class="note">{NOTE} {DEF}</p>''', f'Cas {i} · le mécanisme')

def when(i, k, title, why):
    p = PR[k]; t = p['typical']; ya = p['year_avg']
    cond = [('Consommation française', f"{n(p['load_gw'], 1)} GW", f"{n(ya['load_gw'], 1)} GW"),
            ('Nucléaire produit', f"{n(p['nuclear_gw'], 1)} GW", f"{n(ya['nuclear_gw'], 1)} GW"),
            ('Éolien + solaire français', f"{n(p['wind_solar_gw'], 1)} GW", f"{n(ya['wind_solar_gw'], 1)} GW"),
            ('Exports nets', f"{n(p['nx_gw'], 1)} GW", f"{n(ya['nx_gw'], 1)} GW"),
            ('Éolien + solaire allemands / conso. allemande', pc(p['de_vre']), pc(ya['de_vre'])),
            ('Prix France / Allemagne', f"{n(p['fr'])} / {n(p['de'])} €", '')]
    ct = ''.join(f'<tr><td>{a}</td><td>{b}</td><td>{c_}</td></tr>' for a, b, c_ in cond)
    jour = __import__('datetime').date.fromisoformat(t['date'])
    JS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']; MS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
    typ = (f"<b>Heure typique : {JS[jour.weekday()]} {jour.day} {MS[jour.month - 1]} {jour.year}, {t['hour']} h–{t['hour'] + 1} h.</b> "
           f"France {n(t['fr'], 1)} €, Allemagne {n(t['de'], 1)} €, Belgique {n(t['be'], 1)} €, Italie {n(t['it'], 1)} €, Espagne {n(t['es'], 1)} €. "
           f"La France {'exporte' if t['nx_gw'] > 0 else 'importe'} {n(abs(t['nx_gw']), 1)} GW ; consommation {n(t['load_gw'], 1)} GW ; nucléaire {n(t['nuclear_gw'], 1)} GW (sur {n(t['avail_gw'], 1)} disponibles) ; "
           f"éolien {n(t['wind_gw'], 1)} GW, solaire {n(t['solar_gw'], 1)} GW ; en Allemagne, éolien + solaire = {pc(t['de_vre']) if t['de_vre'] is not None else '–'} de la consommation.")
    why = why.replace('..', '.')
    sl(title, f'''<div class="two"><div><img src="{img(f'heat_{k}.png')}"><img style="margin-top:6px" src="{img(f'hist_{k}.png')}"></div><div>
<p class="sm" style="margin:0 0 8px">{why}</p>
<table class="num sm"><tr><th>{p['year']}</th><th>Dans ce cas</th><th>Moyenne de l’année</th></tr>{ct}</table>
<div class="box" style="font-size:13px;margin-top:10px">{typ}</div></div></div>
<p class="note">Heure typique : l’heure de {p['year']} la plus proche des valeurs médianes du cas (prix France, prix Allemagne, exports). Heures en heure de Paris. Sources : ENTSO-E, RTE éCO2mix, Energy-Charts ; calcul PowerKlock (case_profiles.py).</p>''', f'Cas {i} · en vrai')

# 0 ── reference
sl('La référence : un seul merit order, une seule consommation', f'''<div class="two"><div><img src="{img('m_0.png')}"></div><div>
<ul class="sm"><li><b>La courbe</b> : toutes les centrales françaises rangées de la moins chère à la plus chère (éolien et solaire, nucléaire qui module, hydraulique, gaz).</li>
<li><b>La consommation</b> : ce que la France consomme dans l’heure (55 GW sur le dessin). Elle ne bouge presque pas avec le prix.</li>
<li><b>Seule</b>, la France produit exactement sa consommation : le prix se lit au croisement, <b>50 €</b> sur le dessin.</li>
<li>Dans tous les dessins qui suivent, <b>la courbe et la consommation ne bougent pas</b>. Seuls changent le prix des voisins et ce que la ligne laisse passer (± 10 GW sur le dessin).</li>
<li>Ce qui décide du cas : <b>le prix des voisins est-il au-dessus ou en dessous de 50 €, et de combien</b> ? Si l’écart est petit, la ligne suffit à l’effacer ; s’il est grand, la ligne sature.</li></ul>
{block([('Prix', 'se lit à la consommation française'), ('Fréquence', 'jamais : la France échange à chaque heure'), ('Sécurité', 'personne pour aider en cas de manque'), ('Réseau', 'aucune rente')])}
</div></div><p class="note">{NOTE}</p>''', 'Le point de départ')

mech(1, 'Cas 1 · Exportatrice, ligne pas saturée', 'Les voisins sont un peu plus chers (58 €) que la France seule (50 €). La France exporte jusqu’à ce que son prix rejoigne le leur : 5 GW suffisent, la ligne (10 GW) a de la place. <b>Un seul prix pour tous.</b>',
     [('Prix', f"<b>monte jusqu’au prix des voisins</b>. En 2025 : France = Allemagne = {n(c['exp_free']['fr'])} €/MWh"),
      ('Fréquence', f"{pc(c['exp_free']['share'])} du temps en 2025 ; 34 à 44 % de 2016 à 2021"),
      ('Sécurité', f"aucune tension en France ; elle aide ses voisins ({n(c['exp_free']['nx_gw'], 1)} GW exportés en moyenne en 2025)"),
      ('Réseau', f"peu de rente : pas d’écart de prix avec la Belgique et l’Allemagne ; {bn(c['exp_free']['rent_m'])} en 2025 sur les autres frontières")])
when(1, 'exp_free', 'Cas 1 · Exportatrice, ligne pas saturée : quand ça arrive', f"Surtout <b>en milieu de journée</b> ({', '.join(HN(h) for h in sorted(PR['exp_free']['top_hours']))}) et en {', '.join(PR['exp_free']['top_months'])} : le solaire allemand fait baisser le prix allemand jusqu’au niveau français. Le cas était courant jusqu’en 2021 ; il recule depuis que la France a plus à exporter que la ligne.")
mech(2, 'Cas 2 · Exportatrice, ligne saturée', 'Les voisins sont beaucoup plus chers (95 €). La France voudrait exporter 13 GW, la ligne n’en passe que 10. Son prix se lit sur sa propre courbe à « consommation + 10 GW » : <b>65 €</b>, bien sous les voisins.',
     [('Prix', f"<b>monte un peu</b> (les exports s’ajoutent à la consommation), <b>reste sous les voisins</b>. En 2025 : France {n(c['exp_sat']['fr'])} €, Allemagne {n(c['exp_sat']['de'])} €"),
      ('Fréquence', f"<b>{pc(c['exp_sat']['share'])} du temps en 2025</b> ; 1 à 16 % de 2015 à 2022"),
      ('Sécurité', f"aucune tension ; {n(c['exp_sat']['nx_gw'], 1)} GW exportés en moyenne, un surplus que la France seule devrait écrêter"),
      ('Réseau', f"l’écart de prix sur la ligne pleine devient rente : <b>{bn(c['exp_sat']['rent_m'])}</b> en 2025 (deux côtés), moitié RTE en principe, excédent déduit du TURPE")])
when(2, 'exp_sat', 'Cas 2 · Exportatrice, ligne saturée : quand ça arrive', f"Surtout <b>le soir et la nuit</b> ({', '.join(HN(h) for h in sorted(PR['exp_sat']['top_hours']))}), quand le solaire allemand s’arrête et que le gaz fixe le prix allemand, et en {', '.join(PR['exp_sat']['top_months'])}. Il domine depuis 2024 : nucléaire revenu, consommation basse, limite d’export Core plus basse (9,2 GW en 2023, 5,4 GW en 2025, JAO).")
mech(3, 'Cas 3 · Importatrice, ligne pas saturée', 'Les voisins sont un peu moins chers (45 €) que la France seule (50 €). La France importe jusqu’à ce que son prix rejoigne le leur : 5 GW suffisent. Les imports remplacent ses centrales les plus chères. <b>Un seul prix pour tous.</b>',
     [('Prix', f"<b>baisse jusqu’au prix des voisins</b>. En 2022 : France = Allemagne = {n(c22['imp_free']['fr'])} €/MWh"),
      ('Fréquence', f"{pc(c['imp_free']['share'])} du temps en 2025 ; {pc(c22['imp_free']['share'])} en 2022"),
      ('Sécurité', f"pas de tension : la ligne suffit ({n(-c22['imp_free']['nx_gw'], 1)} GW importés en moyenne en 2022)"),
      ('Réseau', f"peu de rente sur la Belgique et l’Allemagne ; {bn(c22['imp_free']['rent_m'])} en 2022 sur les autres frontières")])
when(3, 'imp_free', 'Cas 3 · Importatrice, ligne pas saturée : quand ça arrive (2022)', f"En 2022, surtout <b>l’été, la nuit et le matin</b> ({', '.join(HN(h) for h in sorted(PR['imp_free']['top_hours']))}) : nucléaire français à {n(PR['imp_free']['nuclear_gw'], 1)} GW seulement. Ce n’étaient pas les voisins qui étaient bas : c’est la France seule qui était haute. Presque absent depuis 2024.")
mech(4, 'Cas 4 · Importatrice, ligne saturée', 'Les voisins sont beaucoup moins chers (20 €). La France voudrait importer 30 GW, la ligne n’en passe que 10. Son prix se lit sur sa courbe à « consommation − 10 GW » : <b>40 €</b>, au-dessus des voisins.',
     [('Prix', f"<b>baisse, mais reste au-dessus des voisins</b>. En 2022 : France {n(c22['imp_sat']['fr'])} €, Allemagne {n(c22['imp_sat']['de'])} €"),
      ('Fréquence', f"{pc(c['imp_sat']['share'])} du temps en 2025 ; <b>{pc(c22['imp_sat']['share'])} en 2022</b>"),
      ('Sécurité', f"<b>tension</b> : imports au maximum ({n(-c22['imp_sat']['nx_gw'], 1)} GW en moyenne en 2022) ; seule, la France aurait manqué d’énergie {U['2022']['shortage_hours']} heures en 2022 (jusqu’à {n(U['2022']['shortage_max_gw'], 1)} GW, modèle)"),
      ('Réseau', f"forte rente : <b>{bn(c22['imp_sat']['rent_m'])}</b> en 2022 ; la CRE a fait reverser 1,94 Md€ aux utilisateurs du réseau au titre de 2022")])
when(4, 'imp_sat', 'Cas 4 · Importatrice, ligne saturée : quand ça arrive (2022)', f"En 2022, surtout <b>en milieu de journée</b>, notamment l’été ({', '.join(HN(h) for h in sorted(PR['imp_sat']['top_hours']))}) : le solaire allemand fait baisser le prix voisin pendant que le nucléaire français est à {n(PR['imp_sat']['nuclear_gw'], 1)} GW. Presque absent depuis 2024.")

# recap
rows = [('1. Export, ligne libre', 'monte jusqu’aux voisins', 'exp_free', 'aide les voisins', 'faible'),
        ('2. Export, ligne pleine', 'monte un peu, reste sous les voisins', 'exp_sat', 'aucune tension', '<b>forte</b> : 3,6 Md€ (2025)'),
        ('3. Import, ligne libre', 'baisse jusqu’aux voisins', 'imp_free', 'pas de tension', 'faible'),
        ('4. Import, ligne pleine', 'baisse, reste au-dessus des voisins', 'imp_sat', '<b>tension</b>', '<b>forte</b> : 3,5 Md€ (2022)')]
rt = ''.join(f"<tr><td>{a}</td><td>{d_}</td><td>{pc(H['2019'][k]['share'])}</td><td>{pc(H['2022'][k]['share'])}</td><td>{pc(H['2025'][k]['share'])}</td><td>{e}</td><td>{f}</td></tr>" for a, d_, k, e, f in rows)
oth = H['2025']['mix_dearer']['share'] + H['2025']['mixed']['share']
sl('Tous les cas sur un seul dessin', f'''<div class="recap"><div><img src="{img('m_all.png')}"></div><div>
<table class="rc"><tr><th>Cas</th><th>Prix français</th><th>2019</th><th>2022</th><th>2025</th><th>Sécurité</th><th>Rente</th></tr>{rt}
<tr><td>0. Seule</td><td>se lit à la consommation</td><td>0 %</td><td>0 %</td><td>0 %</td><td>personne pour aider</td><td>aucune</td></tr></table>
<p class="sm" style="margin-top:8px">Le reste du temps ({pc(oth)} en 2025) : prix français entre ceux de la Belgique et de l’Allemagne, ou plus cher que les deux en exportant vers l’Italie, la Suisse et la Grande-Bretagne (souvent un surplus de vent et de soleil en Allemagne).</p></div></div>
<p class="note">{NOTE} {DEF} Sources : ENTSO-E, Energy-Charts ; calcul PowerKlock (cases5.py, cases_hist.py).</p>''', 'Le récapitulatif')

fwr = ''.join(f"<tr><td>{y}</td><td>{n(FW['cal_y1']['FR'][y], 1)}</td><td>{n(FW['spot']['FR'][y], 1) if y in FW['spot']['FR'] else '–'}</td><td>{n(FW['cal_y1']['DE'][y], 1)}</td></tr>" for y in ('2024', '2025', '2026', '2027'))
sl('Le consommateur paie-t-il plus cher ? Oui et non', f'''<div class="two"><div>
<p class="yes"><b>Oui, pour le prix spot</b></p>
<ul class="sm"><li>Quand la France exporte (99 % du temps en 2025), ses acheteurs tirent le prix vers le leur. La CRE le dit à propos du mécanisme ibérique : un prix français plus bas « aurait conduit à des exports massifs vers les pays voisins ».</li>
<li>Le prix spot français est donc plus haut que celui d’une France qui garderait tout pour elle.</li></ul>
<p class="no"><b>Non, pour ce que paie le client</b></p>
<ul class="sm"><li><b>La France reste parmi les moins chères</b> : {n(u['real_all'])} € contre {n(O['2025']['de_year'])} € en Allemagne en 2025. RTE : « pour la première fois depuis 2011, le prix spot moyen a été plus faible en France qu’en Allemagne » (2024).</li>
<li><b>Le client ne paie pas le spot</b> : le tarif réglementé achète des produits annuels lissés sur deux ans (63,9 €/MWh pour 2026, CRE). Jusqu’en 2025, l’ARENH à 42 €/MWh couvrait 43,8 % de sa consommation.</li>
<li><b>Quand la France manque</b> (2022), les imports font baisser le prix et couvrent les pointes.</li></ul></div><div>
<table class="num sm"><tr><th>Livraison</th><th>Cal France<br><span>coté l’année d’avant</span></th><th>Spot France<br><span>réalisé</span></th><th>Cal Allemagne</th></tr>{fwr}</table>
<p class="note">€/MWh. Le prix à terme français, sur lequel se construisent les contrats, a intégré année après année le découplage avec l’Allemagne : il anticipe le spot couplé. L’effet du couplage sur la facture passe par là, avec un à deux ans de décalage ; il n’est pas chiffrable directement. 2026 : spot de janvier à octobre. Sources : SEFE (base PowerKlock), ENTSO-E ; CRE, délibération TRVE 2026-06 ; RTE, Bilan électrique 2024.</p></div></div>''', 'Plus cher ?')

sl('Les gains, avec les chiffres de RTE et de la CRE', '''<div class="tiles">
<div class="t"><div class="v">92,3 TWh</div><div class="l">exportés en net en 2025, un record ; la France exportatrice 99 % du temps (RTE)</div></div>
<div class="t"><div class="v">5,4 Md€</div><div class="l">valeur nette des exports en 2025 au prix français ; de l’ordre de 9 Md€ au prix des pays acheteurs (RTE)</div></div>
<div class="t"><div class="v">2,05 Md€</div><div class="l">recettes d’interconnexion de RTE en 2025 (frontières UE, brut) ; 459,7 M€ d’excédent déduits du TURPE (CRE)</div></div>
<div class="t"><div class="v">1,94 Md€</div><div class="l">versés en plus aux utilisateurs du réseau au titre de 2022, grâce aux recettes d’interconnexion (CRE)</div></div></div>
<ul class="sm" style="margin-top:20px"><li><b>Où va l’argent des exports</b> : surtout à EDF, détenue à 100 % par l’État depuis juin 2023, donc en partie au contribuable. Un prix de marché plus haut réduit aussi ce que l’État verse aux éoliennes et panneaux sous contrat de soutien (6,2 Md€ en 2025, CRE).</li>
<li><b>Sécurité d’approvisionnement</b> : en 2022, avec la moitié du nucléaire à l’arrêt, la France a importé ; la CRE juge que « la France bénéficie largement de cette intégration européenne ».</li>
<li><b>Europe</b> : environ 34 Md€ de gains des échanges transfrontaliers en 2021, comparé à un monde sans interconnexions (ACER).</li>
<li><b>En résumé</b> : le spot est plus haut qu’en autarcie, mais une bonne part de cette valeur revient en France, par EDF (l’État), par le TURPE et par le soutien public évité.</li></ul>
<p class="note">Sources : RTE, Bilan électrique 2025 (pp. 14–16) ; CRE, Utilisation des recettes de congestion 2025 ; CRE, versement exceptionnel de RTE au titre de 2022 ; CRE, charges de service public 2025 (délibération 2026-149) ; EDF, communiqué du 9 juin 2023 ; CRE, surveillance des marchés de gros 2025 ; ACER, Final Assessment of the EU Wholesale Electricity Market Design (2022). Liens : sources.md.</p>''', 'Les gains')

css = open('deck.py').read().split("css = '''")[1].split("'''")[0]
css += '''.yes{color:#c8453a;font-size:18px;margin:0 0 6px}.no{color:#3b6fb6;font-size:18px;margin:14px 0 6px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.t{background:#f5f3fb;border-radius:10px;padding:16px 16px 14px}
pair{} .pair{display:grid;grid-template-columns:1fr 1fr;gap:26px}.pair img{width:100%;border:1px solid #eee;border-radius:8px}.cap{margin:6px 0 0;line-height:1.35}
.kv{margin-top:8px}.kv th,.kv td{font-size:13.5px;padding:4px 7px;line-height:1.3;border-bottom:1px solid #ececf0}.kv th{width:22%;background:#f5f3fb;color:#7a5cc7;text-align:left}
.recap{display:grid;grid-template-columns:.95fr 1.05fr;gap:22px;align-items:start}.recap img{width:100%;border:1px solid #eee;border-radius:8px}
.rc th,.rc td{font-size:13px;padding:5px 6px;line-height:1.25}.rc td:nth-child(n+3):nth-child(-n+5),.rc th:nth-child(n+3):nth-child(-n+5){text-align:right;white-space:nowrap}
.t .v{font-size:30px;font-weight:700;color:#7a5cc7}.t .l{font-size:14px;line-height:1.35;margin-top:6px}'''
html = f'<!doctype html><html lang="fr"><meta charset="utf-8"><title>Couplage européen, cas par cas</title><style>{css}</style><body>{"".join(slides)}</body></html>'
open('/tmp/coupl/deck_cas.html', 'w').write(html)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.goto('file:///tmp/coupl/deck_cas.html'); pg.wait_for_timeout(500)
    over = pg.evaluate("""[...document.querySelectorAll('section')].map((s,i)=>{const b=s.getBoundingClientRect();let m=0;s.querySelectorAll('*').forEach(e=>{if(e.closest('.f'))return;const r=e.getBoundingClientRect();m=Math.max(m,r.bottom-b.top)});return [i+1,Math.round(m)]}).filter(x=>x[1]>690)""")
    pg.pdf(path='couplage_cas.pdf', width='1280px', height='720px', print_background=True)
    for i in range(len(slides)):
        pg.locator('section').nth(i).screenshot(path=f'/tmp/coupl/dc_{i + 1:02d}.png')
    b.close()
print(len(slides), 'slides; overflowing:', over)
