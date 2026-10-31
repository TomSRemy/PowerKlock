#!/usr/bin/env python3
"""Short deck, 4 slides: the coupling cases, the impact on the price (observed prices only), is it dearer for the
consumer (yes and no), the gains (RTE and CRE figures). Needs charts.py, states.py, summary.py, observed.py first."""
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

imp22 = R['years']['2022']['by_state']['cut_imp']['hours']
sl('Quatre situations possibles pour la France', f'''<div class="two"><div><img src="{img('states.png')}"></div><div>
<ol class="sm"><li><b>Couplée avec la Belgique et l’Allemagne</b> : même prix au centime. {pc(sh['core'])} des heures en 2025, contre {pc(U['2020']['shares']['core'])} en 2020. Prix 2025 : {n(sp['core']['FR'])} €/MWh.</li>
<li><b>Couplée avec une partie des voisins</b>, presque toujours l’Espagne seule : {pc(sh['partial'])} des heures. France {n(sp['partial']['FR'])} €, Allemagne {n(sp['partial']['DE_LU'])} €.</li>
<li><b>Coupée de tous, exportatrice</b> : les lignes sont pleines dans toutes les directions, la France exporte au maximum (9 à 14 GW) : {pc(sh['cut_mid'] + sh['cut_exp'])} des heures. France {n(sp['cut_exp']['FR'])} à {n(sp['cut_mid']['FR'])} €, Allemagne {n(sp['cut_mid']['DE_LU'])} à {n(sp['cut_exp']['DE_LU'])} €.</li>
<li><b>Coupée de tous, importatrice</b> : la France est la plus chère et importe au maximum. 0 heure depuis 2024 ; {n(imp22)} heures en 2022 (nucléaire à l’arrêt).</li></ol>
<p class="note">Couplée = prix égaux au centime, la règle de la CRE (France–Allemagne : 10 % du temps en 2025 selon la CRE, 11 % ici). Depuis le 1er octobre 2025, un prix par quart d’heure : tout est compté au quart d’heure. La France exporte dans 99 % des quarts d’heure de 2025. Sources : ENTSO-E, Elexon, Energy-Charts ; CRE, surveillance des marchés de gros 2025 ; calcul PowerKlock.</p></div></div>''', '1 · Les cas')

sl('Impact sur le prix : ce que montrent les prix observés', f'''<div class="two"><div><img src="{img('state_prices.png')}"></div><div>
<ul class="sm"><li><b>Ligne avec de la place</b> : la France prend le prix de ses voisins. <b>Ligne pleine</b> : son prix redescend vers son propre parc (nucléaire qui module, éolien, solaire).</li>
<li>2025 : France <b>{n(u['real_all'])} €/MWh</b>, Allemagne {n(O['2025']['de_year'])} €. Dans les heures où la France est coupée : {n(o['raw_cut'])} € contre {n(o['raw_de_in_cut'])} € en Allemagne. <b>Les limites des lignes gardent le prix français environ 30 € sous l’Allemagne</b> ces heures-là.</li>
<li><b>À situation française égale</b> (même surplus, même saison, même moment de la journée), être couplée ou coupée change peu le prix : de {O['2025']['gap_coupled_minus_cut']:+.0f} à {O['2023']['gap_coupled_minus_cut']:+.0f} €/MWh en 2023–2025. Le prix français dépend d’abord de son surplus.</li>
<li><b>Impact potentiel</b> : plus de lignes tireraient le prix français vers celui des voisins (au plus l’écart actuel, +{n(O['2025']['de_year'] - u['real_all'])} € face à l’Allemagne en 2025) ; une France sans échanges aurait un prix plus bas, que l’on ne peut qu’estimer (modèle, annexe du dossier complet).</li></ul>
<p class="note">Comparaison à situation égale faite sur {pc(O['2025']['coverage'])} (2025) à {pc(O['2023']['coverage'])} (2023) des heures coupées, celles qui ont des heures couplées comparables. Sources : ENTSO-E, RTE éCO2mix ; calcul PowerKlock.</p></div></div>''', '2 · L’impact potentiel')

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
<p class="note">€/MWh. Le prix à terme français, sur lequel se construisent les contrats, a intégré année après année le découplage avec l’Allemagne : il anticipe le spot couplé. L’effet du couplage sur la facture passe par là, avec un à deux ans de décalage ; il n’est pas chiffrable directement. 2026 : spot de janvier à octobre. Sources : SEFE (base PowerKlock), ENTSO-E ; CRE, délibération TRVE 2026-06 ; RTE, Bilan électrique 2024.</p></div></div>''', '3 · Plus cher ?')

sl('Les gains, avec les chiffres de RTE et de la CRE', '''<div class="tiles">
<div class="t"><div class="v">92,3 TWh</div><div class="l">exportés en net en 2025, un record ; la France exportatrice 99 % du temps (RTE)</div></div>
<div class="t"><div class="v">5,4 Md€</div><div class="l">valeur nette des exports en 2025 au prix français ; de l’ordre de 9 Md€ au prix des pays acheteurs (RTE)</div></div>
<div class="t"><div class="v">2,05 Md€</div><div class="l">recettes d’interconnexion de RTE en 2025 (frontières UE, brut) ; 459,7 M€ d’excédent déduits du TURPE (CRE)</div></div>
<div class="t"><div class="v">1,94 Md€</div><div class="l">versés en plus aux utilisateurs du réseau au titre de 2022, grâce aux recettes d’interconnexion (CRE)</div></div></div>
<ul class="sm" style="margin-top:20px"><li><b>Où va l’argent des exports</b> : surtout à EDF, détenue à 100 % par l’État depuis juin 2023, donc en partie au contribuable. Un prix de marché plus haut réduit aussi ce que l’État verse aux éoliennes et panneaux sous contrat de soutien (6,2 Md€ en 2025, CRE).</li>
<li><b>Sécurité d’approvisionnement</b> : en 2022, avec la moitié du nucléaire à l’arrêt, la France a importé ; la CRE juge que « la France bénéficie largement de cette intégration européenne ».</li>
<li><b>Europe</b> : environ 34 Md€ de gains des échanges transfrontaliers en 2021, comparé à un monde sans interconnexions (ACER).</li>
<li><b>En résumé</b> : le spot est plus haut qu’en autarcie, mais une bonne part de cette valeur revient en France, par EDF (l’État), par le TURPE et par le soutien public évité.</li></ul>
<p class="note">Sources : RTE, Bilan électrique 2025 (pp. 14–16) ; CRE, Utilisation des recettes de congestion 2025 ; CRE, versement exceptionnel de RTE au titre de 2022 ; CRE, charges de service public 2025 (délibération 2026-149) ; EDF, communiqué du 9 juin 2023 ; CRE, surveillance des marchés de gros 2025 ; ACER, Final Assessment of the EU Wholesale Electricity Market Design (2022). Liens : sources.md.</p>''', '4 · Les gains')

css = open('deck.py').read().split("css = '''")[1].split("'''")[0]
css += '''.yes{color:#c8453a;font-size:18px;margin:0 0 6px}.no{color:#3b6fb6;font-size:18px;margin:14px 0 6px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.t{background:#f5f3fb;border-radius:10px;padding:16px 16px 14px}
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
