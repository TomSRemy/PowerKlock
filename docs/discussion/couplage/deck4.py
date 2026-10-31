#!/usr/bin/env python3
"""Short deck, 4 slides: the four coupling cases drawn on a simplified merit order (two slides, schema4.py), is it
dearer for the consumer (yes and no), the gains (RTE and CRE figures). Needs charts.py, states.py, summary.py, observed.py first."""
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

imp22 = R['years']['2022']['by_state']['cut_imp']; s22 = U['2022']['state_prices']['cut_imp']
def case(fn, real, effect):
    return f'<div><img src="{img(fn)}"><p class="sm cap"><b>En vrai :</b> {real}</p><p class="sm cap"><b>Effet sur le prix français :</b> {effect}</p></div>'
sl('Les 4 cas sur le merit order (1/2) : la ligne a de la place, ou pas tout à fait', '<div class="pair">' +
   case('case1.png', f"{pc(sh['core'])} des heures en 2025 (contre {pc(U['2020']['shares']['core'])} en 2020). France = Allemagne = Belgique = {n(sp['core']['FR'])} €/MWh.",
        "il <b>monte jusqu’au prix des voisins</b> : les producteurs français vendent au prix de la zone.") +
   case('case2.png', f"{pc(sh['partial'])} des heures en 2025. France {n(sp['partial']['FR'])} €, Espagne {n(sp['partial']['ES'])} €, Allemagne {n(sp['partial']['DE_LU'])} €.",
        "il monte, mais <b>s’arrête sous l’Allemagne</b> : la ligne vers Core est pleine ; l’écart de prix sur cette ligne va aux gestionnaires de réseau (rente).") +
   '</div><p class="note">Merit order simplifié : parc et prix illustratifs, pas des données. Point rouge : prix de la France ; point blanc : prix qu’elle aurait seule, sans aucun échange. « En vrai » : moyennes 2025 des heures dans ce cas (ENTSO-E ; calcul PowerKlock). Couplée = prix égaux au centime (règle de la CRE).</p>', '1 · Les cas')
sl('Les 4 cas sur le merit order (2/2) : toutes les lignes pleines', '<div class="pair">' +
   case('case3.png', f"{pc(sh['cut_mid'] + sh['cut_exp'])} des heures en 2025. France {n(sp['cut_exp']['FR'])} à {n(sp['cut_mid']['FR'])} €, Allemagne {n(sp['cut_mid']['DE_LU'])} à {n(sp['cut_exp']['DE_LU'])} €. La France exporte 9 à 14 GW.",
        "il <b>monte un peu</b> (les exports s’ajoutent à la consommation) mais <b>reste bien sous les voisins</b> : il se lit sur le merit order français.") +
   case('case4.png', f"0 heure depuis 2024. En 2022 (nucléaire à l’arrêt) : {n(imp22['hours'])} heures, France {n(s22['FR'])} €, Allemagne {n(s22['DE_LU'])} €.",
        "il <b>baisse</b> : les imports remplacent les centrales françaises les plus chères et évitent la pénurie.") +
   '</div><p class="note">Merit order simplifié : parc et prix illustratifs, pas des données. En 2025, la France exporte dans 99 % des quarts d’heure : les cas 1 à 3 font presque toute l’année. Depuis le 1er octobre 2025, un prix par quart d’heure : les heures sont comptées au quart d’heure. Sources : ENTSO-E, Elexon, Energy-Charts ; calcul PowerKlock.</p>', '1 · Les cas')

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
