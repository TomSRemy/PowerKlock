import json, base64
S = json.load(open('/tmp/schema/coupling_stats.json'))
img = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
n = lambda v: f"{v:,}".replace(',', ' ')
slides = []
def sl(title, body, kicker=''):
    slides.append(f'<section><div class="k">{kicker}</div><h1>{title}</h1><div class="b">{body}</div><div class="f">PowerKlock · couplage des marchés</div></section>')

slides.append('<section class="cover"><div class="k">PowerKlock</div><h1 class="big">Le couplage européen :<br>pourquoi le prix français suit (ou pas) l’Allemagne</h1><p class="sub">Comment se forme le prix, ce qu’est une ligne pleine, qui gagne et qui perd,<br>et ce que ça change pour la valeur du vent et du solaire</p><div class="f">PowerKlock · novembre 2026</div></section>')

sl('Le principe en trois règles', '''
<ol class="big3">
<li><b>Un prix par zone, le même pour tous.</b> Dans chaque pays, tous les MWh d’une heure sont payés au prix de la dernière centrale appelée (le merit order).</li>
<li><b>Une seule enchère pour toute l’Europe.</b> Chaque jour, l’enchère de la veille fait tourner ensemble le merit order de chaque pays et décide des échanges entre eux. C’est le couplage (France–Belgique–Pays-Bas depuis 2006, zone Core avec le calcul « flow-based » depuis juin 2022).</li>
<li><b>Les échanges sont limités par les lignes.</b> Tant qu’une ligne a de la place, l’électricité va du pays le moins cher vers le plus cher, jusqu’à égaliser les prix. Quand elle est pleine, les prix se séparent.</li>
</ol>''', 'Les bases')

sl('L’image : deux villages, un seul camion', '''
<div class="two"><div>
<p>Au <b>village A</b>, trop de pommes : elles valent <b>30 €</b>.<br>Au <b>village B</b>, il en manque : elles valent <b>60 €</b>.</p>
<p>Un seul camion relie les villages, il porte <b>5 caisses</b>.</p>
<ul><li>Il achète 5 caisses à A au prix de A : 30 €.</li><li>Il les revend à B au prix de B : 60 €.</li><li>Son propriétaire garde <b>30 € par caisse</b> : c’est la <b>rente de congestion</b>.</li></ul>
<p>Les agriculteurs de A ne touchent pas 60 € : ils voudraient tous vendre à B, mais il n’y a que 5 places. A reste à 30 €, B reste à 60 €.</p>
<p><b>Si le camion avait de la place</b>, A enverrait des pommes à B jusqu’à ce que les deux prix soient égaux : plus d’écart, plus de rente.</p>
</div><div><table class="map"><tr><th>Image</th><th>Réalité</th></tr>
<tr><td>Village A</td><td>la France</td></tr><tr><td>Village B</td><td>l’Allemagne</td></tr><tr><td>Les pommes</td><td>les MWh</td></tr>
<tr><td>Le camion</td><td>la ligne (limite d’export de la France)</td></tr><tr><td>Son propriétaire</td><td>RTE et les gestionnaires de réseau voisins</td></tr></table></div></div>''', 'Les bases')

sl('Ligne pas pleine : un seul prix', f'''<div class="two"><div><img src="{img('p1.png')}"></div><div>
<ul><li>La France a besoin de toutes ses centrales bon marché et un peu d’hydraulique.</li>
<li>Les voisins achètent l’électricité française tant qu’elle est moins chère que chez eux.</li>
<li>La France exporte 3 GW : la ligne (5 GW) suffit, les prix s’égalisent.</li>
<li><b>Prix France = prix de la zone = 80 €</b>, souvent fixé par une centrale à gaz allemande.</li>
<li>Un GW de vent français en plus part à l’export : <b>le prix bouge peu</b>.</li></ul>
<p class="note">Cas illustratif : parc et prix simplifiés.</p></div></div>''', 'Couplée')

sl('Ligne pleine : deux prix', f'''<div class="two"><div><img src="{img('p2.png')}"></div><div>
<ul><li>Avec 20 GW de vent et de solaire, la France voudrait exporter 18 GW. La ligne n’en passe que 5.</li>
<li>Le prix français se lit sur le <b>merit order français seul</b>, avec une demande = consommation + 5 GW : <b>32 €</b>, au milieu du nucléaire qui module.</li>
<li>L’Allemagne reste à 60 €.</li>
<li>Sur les 5 GW qui passent : le producteur français touche 32 €, le consommateur allemand paie 60 €. <b>28 € × 5 000 MWh = 140 000 € par heure</b> vont aux gestionnaires de la ligne.</li>
<li>Chaque GW de vent en plus fait <b>chuter le prix français</b>.</li></ul>
<p class="note">Cas illustratif : parc et prix simplifiés.</p></div></div>''', 'Coupée')

c = S
sl('Ce que montrent les données : la France se coupe de plus en plus', f'''<div class="two"><div><img src="{img('hours.png')}"></div><div>
<ul><li>Heures où la France est moins chère que l’Allemagne : <b>{n(c['2021']['cut'])} en 2021 → {n(c['2025']['cut'])} en 2025</b> (63 % de l’année).</li>
<li>En 2022, l’inverse : la moitié du nucléaire à l’arrêt, la France plus chère {n(c['2022']['above'])} heures, elle importe.</li>
<li>La limite d’export de la France dans la zone Core (JAO) baisse : <b>{c['2023']['jmax']} GW en 2023 → {c['2025']['jmax']} GW en 2025</b> en moyenne horaire.</li>
<li>Pourquoi : nucléaire revenu, consommation basse (électrification en retard), plus de solaire et d’éolien. La France est exportatrice nette 99 % du temps en 2025, record de 92,3 TWh (RTE).</li></ul>
<p class="note">Heure « coupée » = prix France au moins 5 € sous le prix allemand. Sources : ENTSO-E, JAO, calcul PowerKlock.</p></div></div>''', 'Les faits')

sl('Prix moyens : la France est passée sous l’Allemagne', f'''<div class="two"><div><img src="{img('prices.png')}"></div><div>
<ul><li>2020–2021 : prix proches, la France souvent un peu plus chère.</li>
<li>2022 : crise, la France <b>plus chère</b> ({c['2022']['fr']:.0f} contre {c['2022']['de']:.0f} €) : elle importe.</li>
<li>2024 : <b>{c['2024']['fr']:.0f} € contre {c['2024']['de']:.0f} €</b> ; 2025 : <b>{c['2025']['fr']:.0f} contre {c['2025']['de']:.0f} €</b>.</li>
<li>Pendant les heures coupées de 2025 : France {c['2025']['fr_cut']:.0f} €, Allemagne {c['2025']['de_cut']:.0f} €. <b>Près de 50 € d’écart.</b></li>
<li>RTE (bilan 2025) : prix français « largement découplés » de tous les voisins, sous l’Espagne pour la 2e année.</li></ul>
<p class="note">Prix spot moyens de la veille (heures avec un prix dans les deux pays). Sources : ENTSO-E, calcul PowerKlock.</p></div></div>''', 'Les faits')

sl('Qui gagne, qui perd ?', '''<table class="gw"><tr><th></th><th>Heures où la France exporte<br><span>(presque tout le temps aujourd’hui)</span></th><th>Heures où la France importe<br><span>(froid, nucléaire à l’arrêt, 2022)</span></th></tr>
<tr><td>Prix français</td><td class="up">plus haut qu’une France isolée</td><td class="dn">plus bas qu’une France isolée</td></tr>
<tr><td>Consommateurs français</td><td class="up">perdent</td><td class="dn">gagnent (et évitent des coupures)</td></tr>
<tr><td>Producteurs français</td><td class="dn">gagnent (exports : 5,4 Md€ net en 2025, RTE)</td><td class="up">perdent</td></tr>
<tr><td>Gestionnaires de réseau</td><td colspan="2">touchent la rente de congestion quand la ligne est pleine ; elle finance les interconnexions ou baisse le tarif de réseau (TURPE)</td></tr>
<tr><td>Europe dans son ensemble</td><td colspan="2">gagne : on fait tourner d’abord les centrales les moins chères de tout le continent</td></tr></table>''', 'Le bilan')

sl('Et si la France était coupée 100 % du temps ?', '''<ul class="lg">
<li><b>Quand elle a du surplus</b> (la grande majorité des heures aujourd’hui) : prix plus bas qu’aujourd’hui. Même plus bas que pendant nos heures « coupées », où elle exporte encore jusqu’à la limite de la ligne.</li>
<li><b>Quand elle manque</b> (vague de froid, nucléaire indisponible) : prix beaucoup plus hauts et risque de délestage. En 2022, avec la moitié du nucléaire à l’arrêt, les imports ont évité des coupures.</li>
<li><b>Les producteurs</b> (EDF, renouvelables) perdraient les revenus d’export, et le surplus serait perdu : nucléaire baissé, éolien et solaire arrêtés plus souvent.</li>
<li><b>Le prix d’une France isolée n’existe pas</b> : on ne peut que l’estimer avec un modèle (merit order français seul, heure par heure).</li></ul>''', 'L’hypothèse')

sl('« L’Europe a fait monter le prix de l’électricité en France » : vrai ?', '''<div class="verdict"><b>En partie.</b></div><ul class="lg">
<li><b>Vrai pendant les heures où la France exporte et où la ligne a de la place</b> : la France prend le prix de la zone, plus haut que son propre merit order.</li>
<li><b>Faux pendant les heures où elle importe</b> : le couplage fait alors baisser le prix et protège l’approvisionnement (2022).</li>
<li><b>De moins en moins vrai depuis 2023</b> : la ligne est pleine de plus en plus souvent, et le prix français redescend vers son merit order. La France est devenue l’un des pays les moins chers d’Europe.</li>
<li><b>La facture des ménages n’est pas le prix spot</b> : tarifs et contrats lissent les prix sur plusieurs années. Jusqu’à fin 2025, l’ARENH vendait une partie du nucléaire d’EDF aux fournisseurs à 42 €/MWh, pour rendre aux consommateurs une partie de l’avantage du nucléaire.</li></ul>''', 'La question')

sl('Ce que ça change pour le vent et le solaire', f'''<ul class="lg">
<li>Un MWh éolien vaut le prix de la zone quand la ligne a de la place, et <b>seulement le prix français quand elle est pleine</b>.</li>
<li>Part de la production éolienne française produite pendant les heures coupées : <b>{c['2021']['wind_cut']:.0%} en 2021 → {c['2024']['wind_cut']:.0%} en 2024 → {c['2025']['wind_cut']:.0%} en 2025</b>.</li>
<li>Le vent souffle souvent longtemps et sur toute l’Europe à la fois : c’est précisément quand il y a du vent que la ligne est pleine. <b>La valeur captée par l’éolien baisse.</b></li>
<li>Pour notre pricer : le modèle mélange deux régimes, couplé et coupé, avec une chance d’être coupé lue sur ce que la France doit exporter au-delà de sa limite JAO. Il paie encore trop le vent de 4 à 9 € par MWh pendant les heures venteuses ; c’est le travail en cours.</li>
<li>Si la limite d’export remonte (nouvelles lignes, moins de congestion en Allemagne), la valeur du vent français remonte aussi : <b>c’est un risque à suivre dans le prix PPA</b>.</li></ul>''', 'Pour le PPA')

sl('Sources', '''<ul class="src">
<li>Données PowerKlock : prix spot de la veille France et Allemagne (ENTSO-E), production éolienne et solaire (RTE), limites d’export Core (JAO, maxNetPos France).</li>
<li>RTE, Bilan électrique 2025, principaux résultats : exports nets 92,3 TWh, 5,4 Md€, exportatrice nette 99 % du temps, prix découplés des voisins.</li>
<li>CRE, Rapport de surveillance des marchés de gros 2024.</li>
<li>Couplage Core flow-based : lancement le 8 juin 2022 (Bundesnetzagentur, PSE).</li>
<li>Schémas des pages 4 et 5 : cas illustratifs (parc et prix simplifiés), pas des données.</li></ul>''', 'Annexe')

css = '''@page{size:1280px 720px;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Inter,Helvetica,Arial,sans-serif;color:#22252b}
section{width:1280px;height:720px;padding:46px 64px 40px;position:relative;page-break-after:always;background:#fff;overflow:hidden}
.k{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#7a5cc7;font-weight:700}
h1{font-size:34px;margin:8px 0 22px;line-height:1.15}h1.big{font-size:48px;margin-top:150px}
.cover{background:linear-gradient(135deg,#f3f0fb,#eef3fa)}.sub{font-size:21px;color:#555;line-height:1.5}
.b{font-size:19px;line-height:1.45}.two{display:grid;grid-template-columns:1.05fr 1fr;gap:34px;align-items:start}.two img{width:100%;border:1px solid #eee;border-radius:8px}
ul,ol{margin:0;padding-left:22px}li{margin:0 0 10px}.lg li{font-size:21px;margin-bottom:16px}.big3 li{font-size:22px;margin-bottom:22px}
.note{font-size:13px;color:#8a8f98;margin-top:14px}.f{position:absolute;bottom:18px;right:64px;font-size:12px;color:#aaa}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e6e6ea;padding:10px 12px;text-align:left;font-size:18px;vertical-align:top}
th{background:#f5f3fb}th span{font-weight:400;font-size:14px;color:#777}.map td:first-child{font-weight:700;color:#3b6fb6}
.gw td:first-child{font-weight:700;width:22%}.up{color:#c8453a}.dn{color:#3b6fb6}
.verdict{font-size:30px;color:#7a5cc7;margin-bottom:18px}.src li{font-size:17px}'''
open('deck.html', 'w').write(f'<!doctype html><html lang="fr"><meta charset="utf-8"><title>Couplage européen</title><style>{css}</style><body>{"".join(slides)}</body></html>')
print(len(slides), 'slides')
