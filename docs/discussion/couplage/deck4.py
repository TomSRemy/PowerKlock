#!/usr/bin/env python3
"""Short deck, 5 slides: the five cases drawn on a simplified merit order (exporter / importer × line saturated or not,
and cut off; three slides, schema5.py, cases5.py), is it dearer for the consumer (yes and no), the gains (RTE and CRE figures). Needs charts.py, states.py, summary.py, observed.py first."""
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

C5 = json.load(open('cases5.json'))
c = C5['2025']; c22 = C5['2022']
def block(rows):
    return '<table class="kv">' + ''.join(f'<tr><th>{k}</th><td>{v}</td></tr>' for k, v in rows) + '</table>'
def case(fn, rows):
    return f'<div><img src="{img(fn)}">{block(rows)}</div>'
bn = lambda m: n(m / 1000, 1) + ' Md€' if m >= 950 else n(m) + ' M€'
NOTE = 'Merit order simplifié : parc et prix illustratifs, pas des données. Point rouge : prix de la France, lu sur la production française ; point blanc : prix qu’elle aurait sans aucun échange. Ligne saturée = prix France différent de celui de la Belgique et de l’Allemagne (au centime) ; exportatrice / importatrice = signe des échanges commerciaux. Chiffres : moyennes des quarts d’heure de chaque cas (ENTSO-E, Energy-Charts ; calcul PowerKlock).'
sl('France exportatrice : ligne pas saturée, ligne saturée', '<div class="pair">' +
   case('c5_1.png', [('Prix', f"<b>monte jusqu’au prix des voisins</b> : France = Allemagne = {n(c['exp_free']['fr'])} €/MWh"),
                     ('Fréquence', f"{pc(c['exp_free']['share'])} du temps en 2025 ({pc(C5['2020']['exp_free']['share'])} en 2020)"),
                     ('Sécurité', f"aucune tension en France ; elle aide ses voisins ({n(c['exp_free']['nx_gw'], 1)} GW exportés en moyenne)"),
                     ('Réseau', f"peu de rente : prix égaux avec la Belgique et l’Allemagne ; {bn(c['exp_free']['rent_m'])} en 2025 sur les autres frontières")]) +
   case('c5_2.png', [('Prix', f"<b>monte un peu</b> (exports à la limite), <b>reste sous les voisins</b> : France {n(c['exp_sat']['fr'])} €, Allemagne {n(c['exp_sat']['de'])} €"),
                     ('Fréquence', f"<b>{pc(c['exp_sat']['share'])} du temps en 2025</b> ({pc(C5['2020']['exp_sat']['share'])} en 2020)"),
                     ('Sécurité', f"aucune tension ; {n(c['exp_sat']['nx_gw'], 1)} GW exportés en moyenne, un surplus que la France seule devrait écrêter"),
                     ('Réseau', f"l’écart de prix sur la ligne pleine devient rente : <b>{bn(c['exp_sat']['rent_m'])}</b> en 2025 (deux côtés), moitié RTE en principe, excédent déduit du TURPE")]) +
   f'</div><p class="note">{NOTE}</p>', '1 · Les cas')
sl('France importatrice : ligne pas saturée, ligne saturée', '<div class="pair">' +
   case('c5_3.png', [('Prix', "<b>baisse jusqu’au prix des voisins</b> : les imports remplacent les centrales françaises les plus chères"),
                     ('Fréquence', f"{pc(c['imp_free']['share'])} du temps en 2025 ; {pc(c22['imp_free']['share'])} en 2022 (France = Allemagne = {n(c22['imp_free']['fr'])} €)"),
                     ('Sécurité', f"pas de tension : la ligne suffit ({n(-c22['imp_free']['nx_gw'], 1)} GW importés en moyenne en 2022)"),
                     ('Réseau', f"rente faible sur Belgique et Allemagne (prix égaux) ; {bn(c22['imp_free']['rent_m'])} en 2022 sur les autres frontières")]) +
   case('c5_4.png', [('Prix', f"<b>baisse, mais reste au-dessus des voisins</b> : France {n(c22['imp_sat']['fr'])} €, Allemagne {n(c22['imp_sat']['de'])} € (2022)"),
                     ('Fréquence', f"{pc(c['imp_sat']['share'])} du temps en 2025 ; <b>{pc(c22['imp_sat']['share'])} en 2022</b>"),
                     ('Sécurité', f"<b>tension</b> : imports au maximum ({n(-c22['imp_sat']['nx_gw'], 1)} GW en moyenne en 2022) ; seule, la France aurait manqué d’énergie {U['2022']['shortage_hours']} heures en 2022 (jusqu’à {n(U['2022']['shortage_max_gw'], 1)} GW, modèle)"),
                     ('Réseau', f"forte rente : <b>{bn(c22['imp_sat']['rent_m'])}</b> en 2022 ; la CRE a fait reverser 1,94 Md€ aux utilisateurs du réseau au titre de 2022")]) +
   f'</div><p class="note">{NOTE}</p>', '1 · Les cas')
yy = ('2020', '2022', '2023', '2024', '2025', '2026')
tr = ''.join(f"<tr><td>{U[y]['label']}</td><td>{pc(C5[y]['exp_free']['share'])}</td><td>{pc(C5[y]['exp_sat']['share'])}</td><td>{pc(C5[y]['imp_free']['share'])}</td><td>{pc(C5[y]['imp_sat']['share'])}</td><td>0 %</td></tr>" for y in yy)
sl('France coupée, et la part de chaque cas', f'''<div class="two"><div><img src="{img('c5_5.png')}">
{block([('Prix', f"se lit à la consommation ; <b>jamais observé</b>, estimé par un modèle à environ {n(u['iso'])} €/MWh en 2025 (± 15–20 € sur une heure)"),
        ('Fréquence', 'jamais'),
        ('Sécurité', f"personne pour aider : {U['2023']['shortage_hours']} à {U['2022']['shortage_hours']} heures de pénurie par an en 2021–2023 (modèle) ; en été, {n(u['curtail_twh'], 1)} TWh de surplus à écrêter en 2025"),
        ('Réseau', 'aucune rente, aucun échange')])}</div><div>
<table class="num sm"><tr><th>Part du temps</th><th>Exportatrice,<br>pas saturée</th><th>Exportatrice,<br>saturée</th><th>Importatrice,<br>pas saturée</th><th>Importatrice,<br>saturée</th><th>Coupée</th></tr>{tr}</table>
<ul class="sm" style="margin-top:12px"><li>Depuis 2024, la France est <b>exportatrice avec une ligne saturée près de 9 heures sur 10</b>.</li>
<li>2022 est l’exception : nucléaire à l’arrêt, la France importe deux tiers du temps.</li></ul>
<p class="note">Comptage au quart d’heure (un prix par quart d’heure depuis le 1er octobre 2025). 2026 : janvier–octobre. Sources : ENTSO-E, Energy-Charts ; calcul PowerKlock (cases5.py).</p></div></div>''', '1 · Les cas')

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
<p class="note">€/MWh. Le prix à terme français, sur lequel se construisent les contrats, a intégré année après année le découplage avec l’Allemagne : il anticipe le spot couplé. L’effet du couplage sur la facture passe par là, avec un à deux ans de décalage ; il n’est pas chiffrable directement. 2026 : spot de janvier à octobre. Sources : SEFE (base PowerKlock), ENTSO-E ; CRE, délibération TRVE 2026-06 ; RTE, Bilan électrique 2024.</p></div></div>''', '2 · Plus cher ?')

sl('Les gains, avec les chiffres de RTE et de la CRE', '''<div class="tiles">
<div class="t"><div class="v">92,3 TWh</div><div class="l">exportés en net en 2025, un record ; la France exportatrice 99 % du temps (RTE)</div></div>
<div class="t"><div class="v">5,4 Md€</div><div class="l">valeur nette des exports en 2025 au prix français ; de l’ordre de 9 Md€ au prix des pays acheteurs (RTE)</div></div>
<div class="t"><div class="v">2,05 Md€</div><div class="l">recettes d’interconnexion de RTE en 2025 (frontières UE, brut) ; 459,7 M€ d’excédent déduits du TURPE (CRE)</div></div>
<div class="t"><div class="v">1,94 Md€</div><div class="l">versés en plus aux utilisateurs du réseau au titre de 2022, grâce aux recettes d’interconnexion (CRE)</div></div></div>
<ul class="sm" style="margin-top:20px"><li><b>Où va l’argent des exports</b> : surtout à EDF, détenue à 100 % par l’État depuis juin 2023, donc en partie au contribuable. Un prix de marché plus haut réduit aussi ce que l’État verse aux éoliennes et panneaux sous contrat de soutien (6,2 Md€ en 2025, CRE).</li>
<li><b>Sécurité d’approvisionnement</b> : en 2022, avec la moitié du nucléaire à l’arrêt, la France a importé ; la CRE juge que « la France bénéficie largement de cette intégration européenne ».</li>
<li><b>Europe</b> : environ 34 Md€ de gains des échanges transfrontaliers en 2021, comparé à un monde sans interconnexions (ACER).</li>
<li><b>En résumé</b> : le spot est plus haut qu’en autarcie, mais une bonne part de cette valeur revient en France, par EDF (l’État), par le TURPE et par le soutien public évité.</li></ul>
<p class="note">Sources : RTE, Bilan électrique 2025 (pp. 14–16) ; CRE, Utilisation des recettes de congestion 2025 ; CRE, versement exceptionnel de RTE au titre de 2022 ; CRE, charges de service public 2025 (délibération 2026-149) ; EDF, communiqué du 9 juin 2023 ; CRE, surveillance des marchés de gros 2025 ; ACER, Final Assessment of the EU Wholesale Electricity Market Design (2022). Liens : sources.md.</p>''', '3 · Les gains')

css = open('deck.py').read().split("css = '''")[1].split("'''")[0]
css += '''.yes{color:#c8453a;font-size:18px;margin:0 0 6px}.no{color:#3b6fb6;font-size:18px;margin:14px 0 6px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.t{background:#f5f3fb;border-radius:10px;padding:16px 16px 14px}
pair{} .pair{display:grid;grid-template-columns:1fr 1fr;gap:26px}.pair img{width:100%;border:1px solid #eee;border-radius:8px}.cap{margin:6px 0 0;line-height:1.35}
.kv{margin-top:8px}.kv th,.kv td{font-size:13.5px;padding:4px 7px;line-height:1.3;border-bottom:1px solid #ececf0}.kv th{width:22%;background:#f5f3fb;color:#7a5cc7;text-align:left}
.t .v{font-size:30px;font-weight:700;color:#7a5cc7}.t .l{font-size:14px;line-height:1.35;margin-top:6px}'''
html = f'<!doctype html><html lang="fr"><meta charset="utf-8"><title>Couplage européen, 4 diapos</title><style>{css}</style><body>{"".join(slides)}</body></html>'
open('/tmp/coupl/deck4.html', 'w').write(html)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.goto('file:///tmp/coupl/deck4.html'); pg.wait_for_timeout(500)
    over = pg.evaluate("""[...document.querySelectorAll('section')].map((s,i)=>{const b=s.getBoundingClientRect();let m=0;s.querySelectorAll('*').forEach(e=>{if(e.closest('.f'))return;const r=e.getBoundingClientRect();m=Math.max(m,r.bottom-b.top)});return [i+1,Math.round(m)]}).filter(x=>x[1]>690)""")
    pg.pdf(path='couplage_4_diapos.pdf', width='1280px', height='720px', print_background=True)
    for i in range(4):
        pg.locator('section').nth(i).screenshot(path=f'/tmp/coupl/d4_{i + 1}.png')
    b.close()
print(len(slides), 'slides; overflowing:', over)
