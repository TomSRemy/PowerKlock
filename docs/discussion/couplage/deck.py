#!/usr/bin/env python3
"""Deck 'Le couplage européen' (HTML → PDF with Playwright). Needs charts.py first (PNG) and the JSON results."""
import json, base64, os
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
S = json.load(open('coupling_stats.json')); U = json.load(open('summary.json')); DR = json.load(open('drivers.json'))
R = json.load(open('model_results.json'))
img = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
def n(v, d=0):
    """French number: thin space for thousands, comma for decimals"""
    s = f"{v:,.{d}f}".replace(',', ' ').replace('.', ',')
    return s
pc = lambda v: f"{v * 100:.0f} %"
u = U['2025']; u24 = U['2024']; u26 = U['2026']; u22 = U['2022']; u23 = U['2023']; d25 = DR['2025']
slides = []
def sl(title, body, kicker=''):
    slides.append(f'<section><div class="k">{kicker}</div><h1>{title}</h1><div class="b">{body}</div><div class="f">PowerKlock · couplage des marchés</div></section>')

# 1 ── cover
slides.append('<section class="cover"><div class="k" translate="no">PowerKlock</div><h1 class="big">Le couplage européen a-t-il fait monter<br>le prix de l’électricité en France ?</h1><p class="sub">Heures couplées et coupées, prix d’une France isolée, gagnants et perdants en euros, 2020 – octobre 2026</p><div class="f"><span translate="no">PowerKlock</span> · novembre 2026</div></section>')

# 2 ── the answer
ys = ['2020', '2021', '2022', '2023', '2024', '2025', '2026']
rows = ''.join(f"<tr><td>{U[y]['label']}</td><td>{n(U[y]['real'])}</td><td>{n(U[y]['iso'])}</td><td class=\"{'up' if U[y]['gap'] > 0 else 'dn2'}\">{U[y]['gap']:+.0f}</td>"
               f"<td>{n(-U[y]['consumers'], 1)}</td><td>{n(U[y]['producers'], 1)}</td><td>{n(U[y]['rent'], 1)}</td><td><b>{n(U[y]['france_net'], 1)}</b></td></tr>" for y in ys)
sl('La réponse en une page', f'''<div class="verdict">Oui : au prix spot, nettement depuis 2023. Mais la France y gagne.</div>
<table class="num"><tr><th>Année</th><th>Prix réel<br><span>€/MWh</span></th><th>France isolée<br><span>€/MWh, modèle</span></th><th>Écart<br><span>€/MWh</span></th>
<th>Consommateurs<br><span>Md€</span></th><th>Producteurs<br><span>Md€</span></th><th>Rente de congestion<br><span>Md€, deux côtés</span></th><th>France, net<br><span>Md€</span></th></tr>{rows}</table>
<p class="note">Couplage comparé à une France isolée, même parc et même consommation. Consommateurs : − = ils paient plus. France net = producteurs + consommateurs + la moitié de la rente.
Hors heures de pénurie de la France isolée (0 à 89 h par an, page 19). Prix isolé : estimation, jamais observé (pages 12–13). Sources : ENTSO-E, RTE éCO2mix, JAO, Energy-Charts ; calcul PowerKlock.</p>''', 'La réponse')

# 3–6 ── basics (kept)
sl('Le principe en trois règles', '''
<ol class="big3">
<li><b>Un prix par zone, le même pour tous.</b> Dans chaque pays, tous les MWh d’une heure sont payés au prix de la dernière centrale appelée (le merit order).</li>
<li><b>Une seule enchère pour toute l’Europe.</b> Chaque jour, l’enchère de la veille fait tourner ensemble le merit order de chaque pays et décide des échanges entre eux. C’est le couplage (France–Belgique–Pays-Bas depuis 2006, zone Core avec le calcul « flow-based » depuis le 8 juin 2022). La Suisse n’en fait pas partie ; la Grande-Bretagne en est sortie au 1er janvier 2021.</li>
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
<tr><td>Village A</td><td>la France</td></tr><tr><td>Village B</td><td>l’Allemagne, l’Italie…</td></tr><tr><td>Les pommes</td><td>les MWh</td></tr>
<tr><td>Le camion</td><td>la ligne (limite d’export de la France)</td></tr><tr><td>Son propriétaire</td><td>RTE et les gestionnaires de réseau voisins</td></tr>
<tr><td>Un village A sans camion</td><td>une France isolée : ses pommes en trop ne valent presque rien</td></tr></table></div></div>''', 'Les bases')

sl('Ligne pas pleine : un seul prix', f'''<div class="two"><div><img src="{img('p1.png')}"></div><div>
<ul><li>La France a besoin de toutes ses centrales bon marché et d’un peu d’hydraulique.</li>
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
<li>Même coupée, la France exporte encore 5 GW : <b>son prix reste au-dessus de celui d’une France isolée</b>, qui garderait ces 5 GW pour elle.</li></ul>
<p class="note">Cas illustratif : parc et prix simplifiés.</p></div></div>''', 'Coupée')

# 7–8 ── France vs Germany (kept, labels corrected)
c = S
sl('France et Allemagne : des prix de plus en plus séparés', f'''<div class="two"><div><img src="{img('hours.png')}"></div><div>
<ul><li>Heures où la France est moins chère que l’Allemagne d’au moins 5 € : <b>{n(c['2021']['cut'])} en 2021 → {n(c['2025']['cut'])} en 2025</b> (63 % de l’année).</li>
<li>En 2022, l’inverse : la moitié du nucléaire à l’arrêt, la France plus chère {n(c['2022']['above'])} heures, elle importe.</li>
<li><b>Attention</b> : en 2024–2025, les heures où la France est plus chère que l’Allemagne ne sont <b>pas</b> des heures où elle manque (page 16).</li>
<li>La limite d’export de la France dans Core (JAO) baisse : <b>9,2 GW en 2023 → 5,4 GW en 2025</b> en moyenne horaire.</li></ul>
<p class="note">Sources : ENTSO-E, JAO ; calcul PowerKlock.</p></div></div>''', 'Les faits')

sl('Prix moyens : la France est passée sous l’Allemagne', f'''<div class="two"><div><img src="{img('prices.png')}"></div><div>
<ul><li>2020–2021 : prix proches, la France souvent un peu plus chère.</li>
<li>2022 : crise, la France <b>plus chère</b> ({c['2022']['fr']:.0f} contre {c['2022']['de']:.0f} €) : elle importe.</li>
<li>2024 : <b>{c['2024']['fr']:.0f} € contre {c['2024']['de']:.0f} €</b> ; 2025 : <b>{c['2025']['fr']:.0f} contre {c['2025']['de']:.0f} €</b>.</li>
<li>RTE (bilan 2025) : prix français « largement découplés de ceux de l’ensemble des pays voisins », spot moyen 61 €/MWh.</li></ul>
<p class="note">Prix spot moyens de la veille. Sources : ENTSO-E, RTE ; calcul PowerKlock.</p></div></div>''', 'Les faits')

# 9 ── coupling states, all borders
sl('Toutes les frontières : dans quel état est la France ?', f'''<div class="two w"><div><img src="{img('states.png')}"></div><div>
<ul class="sm"><li>Une frontière est <b>couplée</b> quand les deux prix sont égaux au centime près (la règle de la CRE ; nos taux France–Allemagne retombent sur les siens : 29 % en 2023, 14 % en 2024, 10–11 % en 2025).</li>
<li>Couplée avec Core (Belgique et Allemagne) : <b>{pc(U['2021']['shares']['core'])} en 2021 → {pc(u['shares']['core'])} en 2025</b>.</li>
<li>Couplée avec une partie des voisins : depuis 2024, c’est presque toujours <b>l’Espagne seule</b> ({n(u['partial_with']['ES'])} h en 2025).</li>
<li>Coupée de tous : <b>{pc(u['shares']['cut_exp'] + u['shares']['cut_mid'])} des heures en 2025</b>, dont {pc(u['shares']['cut_exp'])} la moins chère de tous ses voisins. Coupée en importatrice : 0 h depuis 2024.</li>
<li>La France exporte dans <b>99 %</b> des quarts d’heure de 2025 (échanges commerciaux), quel que soit l’état.</li>
<li><b>Quarts d’heure</b> : depuis le 1er octobre 2025, l’enchère fixe un prix par quart d’heure. Tout est compté au quart d’heure (0,25 h chacun) ; avant, une heure = 4 quarts d’heure identiques.</li></ul>
<p class="note">Voisins du couplage : Belgique, Allemagne, Espagne, Italie Nord (Grande-Bretagne en 2020). La Suisse et la Grande-Bretagne n’ont presque jamais le prix français : elles sont hors du couplage. Avec une tolérance de 1 € au lieu d’1 centime, « couplée avec Core » passe à {pc(u['shares_1eur']['core'])} en 2025. Sources : ENTSO-E, Elexon, Energy-Charts ; calcul PowerKlock.</p></div></div>''', 'Les états de couplage')

# 10 ── by border
b = u['borders']
sl('Frontière par frontière', f'''<div class="two"><div><img src="{img('borders.png')}"></div><div>
<table class="num sm"><tr><th>2025</th><th>Même prix</th><th>France moins chère</th><th>France plus chère</th><th>Prix voisin moyen</th></tr>
{''.join(f"<tr><td>{lab}</td><td>{pc(b[k]['coupled'])}</td><td>{pc(b[k]['fr_cheaper'])}</td><td>{pc(b[k]['fr_dearer'])}</td><td>{n(b[k]['nb'])} €</td></tr>" for k, lab in (('DE', 'Allemagne'), ('BE', 'Belgique'), ('ES', 'Espagne'), ('IT', 'Italie Nord'), ('CH', 'Suisse'), ('GB', 'Grande-Bretagne')))}
</table>
<ul class="sm"><li>Prix français moyen 2025 : {n(u['real_all'])} €/MWh.</li>
<li>L’Espagne est la seule voisine encore souvent au même prix : France et péninsule Ibérique forment un même bloc exportateur, coupé du reste.</li>
<li>CRE (surveillance 2025) : France égale à l’Espagne « environ 33 % du temps, 10 % pour la Belgique et l’Allemagne et 4 % pour l’Italie ».</li></ul>
<p class="note">Sources : ENTSO-E, Elexon ; CRE, rapport de surveillance 2025 ; calcul PowerKlock.</p></div></div>''', 'Les états de couplage')

# 11 ── prices by state
st = [('core', 'Couplée avec Core'), ('partial', 'Couplée avec une partie (Espagne)'), ('cut_mid', 'Coupée, entre ses voisins'), ('cut_exp', 'Coupée, la moins chère')]
by = R['years']['2025']['by_state']; sp = u['state_prices']
sl('2025 : combien d’heures, à quel prix, dans chaque état', f'''<table class="num"><tr><th>État (2025)</th><th>Heures</th><th>Export net</th><th>Prix France réel</th><th>Allemagne</th><th>Italie Nord</th><th>Espagne</th><th>France isolée (modèle)</th></tr>
{''.join(f"<tr><td>{lab}</td><td>{n(U['2025']['shares'][k] * 8759)}</td><td>{n(u['state_nx'][k], 1)} GW</td><td><b>{n(sp[k]['FR'])} €</b></td><td>{n(sp[k]['DE_LU'])} €</td><td>{n(sp[k]['IT_NORD'])} €</td><td>{n(sp[k]['ES'])} €</td><td>{n(by[k]['iso'])} €</td></tr>" for k, lab in st)}
</table>
<ul class="sm" style="margin-top:22px"><li>Plus la France est coupée, plus son prix est bas : {n(sp['core']['FR'])} € couplée, <b>{n(sp['cut_exp']['FR'])} €</b> quand elle est la moins chère de tous (l’Allemagne est alors à {n(sp['cut_exp']['DE_LU'])} €).</li>
<li>Mais même là, elle exporte <b>{n(u['state_nx']['cut_exp'], 1)} GW</b> en moyenne : sans ces exports, son prix serait de l’ordre de {n(by['cut_exp']['iso'])} € (modèle).</li>
<li>Les états sont comptés au quart d’heure ; le prix « France isolée » est horaire (page 12).</li></ul>
<p class="note">Export net : échanges commerciaux programmés (ENTSO-E via Energy-Charts). Sources : ENTSO-E, Elexon ; calcul PowerKlock.</p>''', 'Les états de couplage')

# 12 ── method
sl('Comment estimer le prix d’une France isolée', '''<div class="two"><div>
<ol class="sm"><li><b>À chaque heure, le prix français est sur la courbe d’offre française</b>, au volume que la France produit. C’est la règle de l’enchère, couplée ou non.</li>
<li>Volume demandé aux centrales pilotables (nucléaire, lacs, STEP, gaz, charbon, fioul) :<br><b>consommation + exports nets − éolien − solaire − fil de l’eau − bioénergies</b> (RTE éCO2mix).</li>
<li>On apprend cette courbe sur 60 000 heures (2020–2026) : le prix monte avec ce volume et avec le prix du gaz et du CO2, il baisse quand plus de nucléaire est disponible. Le mois, l’heure, le week-end et l’année servent de contexte.</li>
<li><b>France isolée</b> : même heure, mêmes centrales disponibles, mêmes vent et soleil, mais <b>exports nets = 0</b>. On relit la courbe à ce volume.</li></ol></div><div>
<ul class="sm"><li><b>Minimum nucléaire</b> : sous le plus bas niveau vu dans l’année (63 % du nucléaire disponible en 2024–2025), le surplus est écrêté (éolien, solaire, tranches arrêtées) ; prix = prix négatif médian de l’année (≈ 0 €).</li>
<li><b>Pénurie</b> : au-delà du nucléaire disponible + le record de l’année en hydraulique, gaz, charbon et fioul, il manque de l’énergie ; prix = plafond du marché (3 000 puis 4 000 €/MWh). Ces heures sont comptées à part.</li>
<li><b>Exports fixés à la limite JAO</b> : calculé puis écarté. Là où la ligne avait de la place, forcer plus d’exports pousserait le prix français au-dessus de celui des voisins, et personne n’achèterait. Le prix des heures coupées, lui, est réel.</li>
<li><b>Ce prix n’est jamais observé : c’est une estimation de modèle.</b></li></ul></div></div>''', 'Le contrefactuel')

# 13 ── validation
vv = ''.join(f"<tr><td>{U[y]['label']}</td><td>{n(U[y]['validation']['cut']['n'])}</td><td>{n(U[y]['validation']['cut']['real'])} €</td><td>{n(U[y]['validation']['cut']['mae'], 1)} €</td><td>{U[y]['validation']['cut']['bias']:+.1f} €</td></tr>".replace('.', ',').replace('janv,–oct,', 'janv.–oct.') for y in ys)
sl('Validation : le modèle retrouve-t-il le prix des heures coupées ?', f'''<div class="two"><div><img src="{img('validation.png')}"></div><div>
<p class="sm">Heures coupées : le prix réel <b>est</b> le merit order français seul, avec un export fixé par la limite du réseau (la France exporte en médiane 92 % de sa limite en 2025). Chaque heure est prédite par un modèle qui ne l’a jamais vue (12 blocs de mois entiers).</p>
<table class="num sm"><tr><th>Année</th><th>Heures coupées</th><th>Prix réel</th><th>Écart moyen absolu</th><th>Biais</th></tr>{vv}</table>
<ul class="sm"><li>Une heure seule : ± 15 à 20 €. La moyenne d’une année : biais de +1 € en 2024–2025.</li>
<li>Le biais est positif chaque année : le prix isolé est plutôt <b>surestimé</b>, donc l’effet du couplage plutôt sous-estimé (surtout 2026 : +8 €).</li></ul></div></div>''', 'Le contrefactuel')

# 14 ── result
sl('Résultat : le prix réel contre celui d’une France isolée', f'''<div class="two"><div><img src="{img('real_vs_iso.png')}"></div><div>
<ul><li>2020–2021 : le couplage ajoute <b>14 puis 29 €/MWh</b> au prix français.</li>
<li>2022 : l’inverse, <b>−22 €/MWh</b> : la France importe, les voisins font baisser son prix (et couvrent {u22['shortage_hours']} heures où elle aurait manqué d’énergie).</li>
<li>2024–2025 : <b>+39 et +38 €/MWh</b>. Une France isolée aurait eu {n(u24['iso'])} et {n(u['iso'])} €/MWh : avec 90 TWh de trop, son nucléaire aurait modulé en permanence et elle aurait écrêté {n(u24['curtail_twh'], 1)} et {n(u['curtail_twh'], 1)} TWh.</li>
<li>2026 (janv.–oct.) : <b>+51 €/MWh</b> : le gaz est cher chez les voisins, la France exporte toujours ~11 GW.</li>
<li><b>Le paradoxe</b> : la France est de plus en plus coupée de l’Allemagne, mais l’écart avec une France isolée grandit, car elle a de plus en plus à exporter.</li></ul>
<p class="note">Moyenne horaire hors heures de pénurie de la France isolée. Robustesse 2025 : 17 à 25 €/MWh selon le plancher d’écrêtement et le jeu d’apprentissage (page 25). Calcul PowerKlock.</p></div></div>''', 'Le résultat')

# 15 ── monthly
sl('Mois par mois, 2023 – octobre 2026', f'''<img class="wide" src="{img('monthly.png')}">
<ul class="sm"><li>Le prix réel français reste collé à l’Allemagne en hiver, quand la France a moins de surplus. Il s’en éloigne au printemps et en été, quand le surplus déborde la ligne.</li>
<li>La France isolée tombe entre −5 et +12 €/MWh d’avril à septembre 2024 et 2025 : le nucléaire module jusqu’à son minimum et l’éolien et le solaire sont écrêtés.</li>
<li>Pic de janvier 2026 : vague de froid, une France isolée aurait été chère (et a manqué d’énergie 15 heures les 5 et 6 janvier).</li></ul>
<p class="note">Sources : ENTSO-E, RTE éCO2mix ; modèle PowerKlock.</p>''', 'Le résultat')

# 16 ── who gains who loses (corrected)
sl('Qui gagne, qui perd ?', f'''<table class="gw"><tr><th></th><th>Heures où la France exporte<br><span>99 % du temps en 2025 (RTE)</span></th><th>Heures où la France importe<br><span>froid, nucléaire à l’arrêt (2022)</span></th></tr>
<tr><td>Prix français</td><td class="up">plus haut qu’une France isolée : +{n(u['gap'])} €/MWh en 2025</td><td class="dn2">plus bas : −22 €/MWh en moyenne 2022</td></tr>
<tr><td>Consommateurs français</td><td class="up">paient plus : {n(u['consumers'], 1)} Md€ en 2025 (au prix spot)</td><td class="dn">paient moins : {n(-u22['consumers'], 1)} Md€ en 2022, et des heures de pénurie évitées</td></tr>
<tr><td>Producteurs français</td><td class="dn">gagnent : {n(u['producers'], 1)} Md€ en 2025</td><td class="up">perdent : {n(-u22['producers'], 1)} Md€ en 2022</td></tr>
<tr><td>Gestionnaires de réseau</td><td colspan="2">rente de congestion sur les frontières françaises : {n(u['rent'], 1)} Md€ en 2025, partagée en principe 50/50 avec le voisin ; elle finance les lignes ou baisse le TURPE</td></tr>
<tr><td>Voisins</td><td colspan="2">achètent moins cher que chez eux ; gain non chiffré ici (il faudrait leurs courbes d’offre)</td></tr></table>
<div class="box"><b>Correction de la version précédente.</b> En 2024–2025, les heures où la France est plus chère que l’Allemagne ({n(d25['fr_dearer_h'])} h en 2025) ne sont pas des heures où elle manque : elle exporte dans {pc(d25['fr_dearer_share_exporting'])} d’entre elles ({n(d25['fr_dearer_nx_gw'], 1)} GW en moyenne). C’est l’Allemagne qui déborde de vent et de soleil : l’éolien et le solaire y couvrent {pc(d25['fr_dearer_de_vre'])} de sa consommation dans ces heures (contre {pc(d25['fr_cheaper_de_vre'])} quand la France est moins chère), et son prix est négatif dans {pc(d25['fr_dearer_neg_de'])} de ces heures.</div>''', 'Le bilan')

# 17 ── welfare chart
sl('Gagnants et perdants, en milliards d’euros par an', f'''<div class="two w"><div><img src="{img('welfare.png')}"></div><div>
<ul class="sm"><li>Depuis 2023, le couplage coûte <b>12 à 18 Md€ par an</b> aux consommateurs français au prix spot, et rapporte <b>14 à 20 Md€</b> aux producteurs.</li>
<li>Les producteurs gagnent plus que ce que les consommateurs perdent : la différence, ce sont les exports vendus au-dessus de leur coût.</li>
<li>Bilan pour la France (producteurs − consommateurs + la moitié de la rente) : <b>+{n(U['2023']['france_net'], 1)} à +{n(max(U[y]['france_net'] for y in ys), 1)} Md€ par an</b> depuis 2023, et +{n(u22['france_net'], 1)} Md€ en 2022, quand elle importait.</li>
<li>Dans tous les cas, l’économie française dans son ensemble gagne au couplage. Ce qui change chaque année, c’est <b>qui</b> gagne.</li></ul>
<p class="note">Producteurs : surplus au prix des offres (comme l’ACER), pas un résultat comptable. Hors heures de pénurie. Calcul PowerKlock.</p></div></div>''', 'Le bilan')

# 18 ── congestion rent by border + checks
rb = u['rent_by_border']; eb = u['exports_by_border']
sl('Rente de congestion et contrôles avec RTE et la CRE', f'''<div class="two"><div>
<table class="num sm"><tr><th>2025</th><th>Export net commercial</th><th>RTE (bilan 2025)</th><th>Rente day-ahead (deux côtés)</th></tr>
{''.join(f"<tr><td>{lab}</td><td>{n(eb[k1] + (eb[k2] if k2 else 0), 1)} TWh</td><td>{rte} TWh</td><td>{n((rb[k1] + (rb[k2] if k2 else 0)) * 1000)} M€</td></tr>" for lab, k1, k2, rte in (('Italie', 'IT', None, '26,2'), ('Grande-Bretagne', 'GB', None, '22,6'), ('Suisse', 'CH', None, '20,1'), ('Belgique + Allemagne', 'BE', 'DE', '23,1'), ('Espagne', 'ES', None, '0,2')))}
<tr><td><b>Total</b></td><td><b>{n(sum(eb.values()), 1)} TWh</b></td><td><b>92,3 TWh</b></td><td><b>{n(u['rent'] * 1000)} M€</b></td></tr></table></div><div>
<ul class="sm"><li>Rente = écart de prix × échange <b>commercial</b> programmé (ENTSO-E), au quart d’heure. On n’utilise pas les flux physiques, qui comptent des transits en boucle.</li>
<li>Valeur des exports 2025 au prix français : <b>{n(u['export_value_fr'], 2)} Md€</b> (RTE : 5,4 Md€) ; au prix des pays acheteurs : {n(u['export_value_nb'], 1)} Md€ (RTE : « de l’ordre de 9 Md€ »).</li>
<li>CRE : recettes brutes de RTE sur les frontières UE 2025 = 2,05 Md€, enchères de long terme comprises, dont 0,80 Md€ reversés aux détenteurs de droits. Notre part française sur les mêmes frontières, day-ahead seul : {n((rb['BE'] + rb['DE'] + rb['ES'] + rb['IT']) / 2, 2)} Md€. Même ordre de grandeur, périmètres différents.</li>
<li>Italie, Suisse et Grande-Bretagne font l’essentiel de la rente : de grands écarts de prix avec la France presque toute l’année.</li></ul>
<p class="note">Sources : RTE, Bilan électrique 2025 ; CRE, rapport sur l’utilisation des recettes de congestion 2025 ; Energy-Charts (ENTSO-E) ; calcul PowerKlock.</p></div></div>''', 'Le bilan')

# 19 ── shortage & surplus
sh = ''.join(f"<tr><td>{U[y]['label']}</td><td>{n(U[y]['shortage_hours'])}</td><td>{n(U[y]['shortage_gwh'])} GWh</td><td>{n(U[y]['shortage_max_gw'], 1)} GW</td><td>{n(U[y]['curtail_twh'], 1)} TWh</td></tr>" for y in ys)
sl('Ce que les échanges évitent : pénuries l’hiver, écrêtement l’été', f'''<div class="two"><div>
<table class="num sm"><tr><th>France isolée</th><th>Heures de pénurie</th><th>Énergie manquante</th><th>Manque maximal</th><th>Surplus à écrêter</th></tr>{sh}</table></div><div>
<ul class="sm"><li><b>Pénurie</b> : heures où le nucléaire disponible, l’hydraulique, le gaz, le charbon et le fioul (à leurs records de l’année) n’auraient pas suffi. Ce sont des vagues de froid : janvier et fin 2021, 4 avril 2022, décembre 2022, début 2023, 5–6 janvier 2026.</li>
<li>Dans ces heures, les imports ont comblé le manque. Le modèle ne compte pas les moyens d’urgence de RTE (interruptibilité, baisse de tension) : on ne peut pas en conclure qu’il y aurait eu ces coupures.</li>
<li>Ces heures sont <b>sorties des moyennes</b> : leur prix (le plafond, 4 000 €/MWh) est une convention, et elles pèseraient plus que tout le reste de l’année.</li>
<li><b>Écrêtement</b> : en 2025, une France isolée aurait eu {n(u['curtail_twh'], 1)} TWh de surplus sous son minimum nucléaire observé, à écrêter (éolien, solaire) ou à couper (tranches nucléaires arrêtées).</li></ul>
<p class="note">Calcul PowerKlock (RTE éCO2mix, ENTSO-E).</p></div></div>''', 'Le bilan')

# 20 ── drivers
sl('Pourquoi la France s’est coupée de plus en plus', f'''<div class="two"><div><img src="{img('drivers.png')}"></div><div>
<ul class="sm"><li><b>Plus de surplus</b> : nucléaire disponible {n(DR['2022']['nuclear_avail_gw'], 1)} GW en 2022 → {n(d25['nuclear_avail_gw'], 1)} GW en 2025 ; éolien + solaire {n(DR['2022']['wind_solar_gw'], 1)} → {n(d25['wind_solar_gw'], 1)} GW en moyenne ; consommation basse ({n(d25['load_gw'], 1)} GW en moyenne en 2025), « en retrait par rapport aux niveaux d’avant-crise » (RTE).</li>
<li><b>Moins de place sur les lignes Core</b> : la limite d’export de la France (JAO maxNetPos) passe de 9,2 GW (2023) à 7,7 (2024) puis 5,4 (2025). Elle sort du calcul flow-based (en place depuis le 8 juin 2022), qui tient compte des lignes les plus chargées de toute la zone.</li>
<li><b>Des lignes Core sous-utilisées</b> : selon l’ACER, les gestionnaires de Core n’ont offert en 2024 que 54 % de la capacité de leurs lignes les plus congestionnées, contre 70 % exigés par le droit européen ; atteindre 70 % aurait rapporté au moins 580 M€.</li>
<li><b>Le vent et le soleil allemands</b> : quand ils débordent, c’est l’Allemagne qui passe sous la France (page 16).</li>
<li>RTE : exports « dans la limite des capacités d’interconnexion et des capacités de transit des réseaux nationaux ».</li></ul>
<p class="note">Nous n’avons pas trouvé de source publique qui chiffre la part de chaque cause dans la baisse de la limite JAO. Sources : RTE, Bilan électrique 2025 ; ACER, communiqué du 5 septembre 2025 ; JAO ; ENTSO-E ; calcul PowerKlock.</p></div></div>''', 'Les causes')

# 21 ── cut-off 100 % of the time
sl('Et si la France était coupée 100 % du temps ?', f'''<ul class="lg">
<li><b>Prix spot</b> : {n(u['iso'])} €/MWh au lieu de {n(u['real'])} en 2025, {n(u24['iso'])} au lieu de {n(u24['real'])} en 2024 (modèle). Bien plus bas que pendant nos heures « coupées » ({n(sp['cut_exp']['FR'])} €), où la France exporte encore à pleine ligne.</li>
<li><b>Quand elle manque</b> (froid, nucléaire indisponible) : prix beaucoup plus hauts, +22 €/MWh en moyenne en 2022, et des heures de pénurie (89 h en 2022).</li>
<li><b>Les producteurs</b> perdraient 19 Md€ en 2025 ; le surplus serait perdu : nucléaire au minimum, et {n(u['curtail_twh'], 1)} TWh écrêtés.</li>
<li><b>À long terme, ce monde serait différent</b> : EDF planifierait autrement ses arrêts, on investirait autrement. Notre calcul garde le parc réel : c’est un « isolement pour une heure », pas un autre système électrique.</li></ul>''', 'L’hypothèse')

# 22 ── retail bill
sl('La facture des ménages n’est pas le prix spot', '''<ul class="lg">
<li><b>Jusqu’à fin 2025 : l’ARENH.</b> « En 2025, l’ARENH couvrait 43,8 % de la consommation d’un consommateur aux TRVE au prix de 42 €/MWh inchangé depuis 2012 » (CRE). Cette part de la facture ne dépendait pas du marché.</li>
<li><b>Depuis le 1er janvier 2026</b>, l’ARENH a pris fin. Le tarif réglementé (TRVE) achète toute son énergie sur le marché, « lissé de manière régulière sur deux ans » en produits annuels base et pointe : 63,9 €/MWh en moyenne pour 2026, contre 103,0 pour 2025 (CRE).</li>
<li><b>Le versement nucléaire universel (VNU)</b> remplace l’ARENH : l’État taxe les revenus nucléaires d’EDF au-dessus de 78 €/MWh, plus fortement au-dessus de 110 €/MWh, et reverse aux consommateurs. En 2026, le revenu estimé est de 66,08 €/MWh : <b>rien à reverser</b> (CRE).</li>
<li>Donc le couplage atteint la facture <b>avec deux ans de lissage</b>, via les prix à terme. Les chiffres de ce dossier sont des <b>équivalents au prix spot</b>, pas des factures.</li></ul>
<p class="note">Sources : CRE, délibération TRVE 2026-06 du 14 janvier 2026 ; CRE, délibération 2026-52 (VNU) ; loi de finances 2025, art. 17. La part de l’énergie dans la facture d’un ménage : pas de chiffre officiel trouvé.</p>''', 'La facture')

# 23 ── verdict
sl('« L’Europe a fait monter le prix de l’électricité en France » : vrai ?', f'''<div class="verdict">Vrai pour le prix spot. Faux pour la France dans son ensemble.</div><ul class="lg">
<li><b>Vrai</b> : sans échanges, le prix spot français aurait été bien plus bas en 2020–2021 et depuis 2023 : <b>−38 €/MWh en 2025</b>. Le couplage le fait monter parce que la France exporte presque tout le temps.</li>
<li><b>Faux en 2022</b> : la France importait, le couplage a fait baisser son prix de 22 €/MWh et couvert des heures de pénurie.</li>
<li><b>La France y gagne chaque année</b> (+0,8 Md€ net en 2020, +2,4 à +4,6 Md€ depuis 2021) : ce que paient les consommateurs, les producteurs le gagnent, et plus encore.</li>
<li><b>Ce n’est pas « de moins en moins vrai »</b> (version précédente, corrigée) : la France est plus souvent coupée de l’Allemagne, mais elle exporte plus que jamais, donc son prix reste loin au-dessus de celui d’une France isolée.</li>
<li>Pour la facture, tout dépend de la redistribution : ARENH jusqu’en 2025, VNU ensuite.</li></ul>''', 'La question')

# 24 ── PPA (kept)
sl('Ce que ça change pour le vent et le solaire', f'''<ul class="lg">
<li>Un MWh éolien vaut le prix de la zone quand la ligne a de la place, et <b>seulement le prix français quand elle est pleine</b>.</li>
<li>Part de la production éolienne française produite pendant les heures où la France est au moins 5 € sous l’Allemagne : <b>{c['2021']['wind_cut']:.0%} en 2021 → {c['2024']['wind_cut']:.0%} en 2024 → {c['2025']['wind_cut']:.0%} en 2025</b>.</li>
<li>Le vent souffle souvent longtemps et sur toute l’Europe à la fois : c’est précisément quand il y a du vent que la ligne est pleine. <b>La valeur captée par l’éolien baisse.</b></li>
<li>Si la limite d’export remonte (nouvelles lignes, moins de congestion en Allemagne), la valeur du vent français remonte aussi : <b>c’est un risque à suivre dans le prix PPA</b>.</li></ul>'''.replace('%', ' %'), 'Pour le PPA')

# 25 ── limits
rb_ = ''.join(f"<tr><td>{U[y]['label']}</td><td>{n(U[y]['iso'], 1)}</td><td>{n(U[y]['iso_deep'], 1)}</td><td>{n(U[y]['iso_delta'], 1)}</td><td>{n(U[y]['iso_cut_variant'], 1)}</td></tr>" for y in ('2024', '2025', '2026'))
sl('Limites : ce qu’il faut garder en tête', f'''<div class="two"><div><ul class="sm">
<li>Le prix d’une France isolée <b>n’est jamais observé</b> : une heure seule peut être fausse de 15–20 €, une année de quelques €, 2022 beaucoup plus (50 € par heure).</li>
<li>En 2024–2025, 12–13 % des heures isolées sont plus bas en volume que tout ce qu’on a vu dans le mois (26 % en 2026) : leur prix vient du plancher d’écrêtement.</li>
<li><b>Court terme</b> : parc, disponibilité nucléaire et eau des barrages restent ceux observés. Les offres contiennent des coûts d’opportunité européens (valeur de l’eau, du combustible) : isolés, ils seraient plus bas, et le prix isolé aussi.</li>
<li>Demande fixe. Heures de pénurie mises à part.</li>
<li>Rente : day-ahead seulement, partage 50/50 par défaut ; sur la Suisse et la Grande-Bretagne (enchères explicites), une partie va à des tiers.</li>
<li>Gain des voisins non chiffré.</li></ul></div><div>
<p class="sm"><b>Robustesse du prix isolé</b> (€/MWh, hors pénurie)</p>
<table class="num sm"><tr><th>Année</th><th>Principal</th><th>Plancher bas<br><span>prix négatifs profonds</span></th><th>Garde l’erreur de l’heure</th><th>Appris sur les heures coupées</th></tr>{rb_}</table>
<p class="note">Détails et formules : methodologie.md.</p></div></div>''', 'Annexe')

# 26 ── sources
sl('Sources', '''<ul class="src">
<li>Données PowerKlock : prix day-ahead (ENTSO-E ; Grande-Bretagne : Elexon), production et échanges de la France (RTE éCO2mix), nucléaire disponible (ENTSO-E), limites d’export Core (JAO, maxNetPos), échanges commerciaux par frontière (ENTSO-E via Energy-Charts, CC BY 4.0), gaz et CO2 (TTF, EUA).</li>
<li>RTE, Bilan électrique 2025, principaux résultats (février 2026) : assets.rte-france.com/prod/public/2026-02/Bilan-electrique-2025-principaux-resultats.pdf ; Bilan 2024.</li>
<li>CRE, Rapport de surveillance des marchés de gros 2025 (n° 2026-07) ; rapports 2023 et 2024.</li>
<li>CRE, Utilisation des recettes de congestion 2023, 2024, 2025 ; délibérations TURPE 2022-157 et 2023-136.</li>
<li>CRE, délibération 2026-06 (TRVE 2026) ; délibération 2026-52 (VNU).</li>
<li>ACER, Cross-zonal electricity trade 2025 (communiqué du 5 septembre 2025) ; décision 16/2023 (partage de la rente) ; règlement (UE) 2019/943, art. 19.</li>
<li>Core flow-based, démarrage le 8 juin 2022 (JAO, SDAC) ; pas de 15 minutes dès la livraison du 1er octobre 2025 (NEMO Committee) ; plafond 4 000 €/MWh dès le 10 mai 2022 (EPEX SPOT).</li>
<li>Liens complets : sources.md. Pages 5 et 6 : cas illustratifs, pas des données.</li></ul>''', 'Annexe')

css = '''@page{size:1280px 720px;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Inter,Helvetica,Arial,sans-serif;color:#22252b}
section{width:1280px;height:720px;padding:40px 60px 36px;position:relative;page-break-after:always;background:#fff;overflow:hidden}
.k{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#7a5cc7;font-weight:700}
h1{font-size:31px;margin:6px 0 18px;line-height:1.15}h1.big{font-size:46px;margin-top:150px}
.cover{background:linear-gradient(135deg,#f3f0fb,#eef3fa)}.sub{font-size:21px;color:#555;line-height:1.5}
.b{font-size:18px;line-height:1.42}.two{display:grid;grid-template-columns:1.05fr 1fr;gap:30px;align-items:start}.two.w{grid-template-columns:1.25fr 1fr}
.two img{width:100%;border:1px solid #eee;border-radius:8px}img.wide{width:100%;border:1px solid #eee;border-radius:8px;margin-bottom:10px}
ul,ol{margin:0;padding-left:22px}li{margin:0 0 9px}.lg li{font-size:20px;margin-bottom:15px}.big3 li{font-size:22px;margin-bottom:22px}
.sm,.sm li{font-size:15.5px}.sm li{margin-bottom:7px}
.note{font-size:12.5px;color:#8a8f98;margin-top:12px;line-height:1.35}.f{position:absolute;bottom:16px;right:60px;font-size:12px;color:#aaa}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e6e6ea;padding:8px 10px;text-align:left;font-size:17px;vertical-align:top}
th{background:#f5f3fb;font-size:15px}th span{font-weight:400;font-size:12.5px;color:#777}.map td:first-child{font-weight:700;color:#3b6fb6}
table.num td,table.num th{text-align:right}table.num td:first-child,table.num th:first-child{text-align:left}
table.sm td,table.sm th{font-size:14.5px;padding:6px 8px}
.gw td{font-size:16px;padding:8px 10px}.gw td:first-child{font-weight:700;width:20%}.up{color:#c8453a}.dn{color:#3b6fb6}.dn2{color:#3f8f5a}
.box{margin-top:14px;padding:10px 14px;border-left:4px solid #d99a1e;background:#fbf6ea;font-size:15px;line-height:1.4}
.verdict{font-size:26px;color:#7a5cc7;margin-bottom:16px;font-weight:600}.src li{font-size:15.5px}'''
html = f'<!doctype html><html lang="fr"><meta charset="utf-8"><title>Couplage européen</title><style>{css}</style><body>{"".join(slides)}</body></html>'
open('/tmp/coupl/deck.html', 'w').write(html)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.goto('file:///tmp/coupl/deck.html'); pg.wait_for_timeout(500)
    # any slide whose content overflows its 720 px box
    over = pg.evaluate("""[...document.querySelectorAll('section')].map((s,i)=>{const b=s.getBoundingClientRect();let m=0;s.querySelectorAll('*').forEach(e=>{if(e.classList.contains('f'))return;const r=e.getBoundingClientRect();m=Math.max(m,r.bottom-b.top)});return [i+1,Math.round(m)]}).filter(x=>x[1]>700)""")
    pg.pdf(path='couplage_europeen.pdf', width='1280px', height='720px', print_background=True)
    b.close()
print(len(slides), 'slides; overflowing:', over)
