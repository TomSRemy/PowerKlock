import json, html
D='#0E151C'; L='#F4F6F7'
def sec(id, dark, eyebrow, title, body, foot, notes):
    bg=D if dark else L; fg='#E8EEF2' if dark else '#14212C'; ac='#14D3A9' if dark else '#0E8F73'; ft='#7F96A8' if dark else '#6B7C89'; h2='#F3F6F8' if dark else '#14212C'
    return f'''<section id="{id}" data-transition="fade" style="background:{bg};color:{fg};font-family:'IBM Plex Sans', Arial, sans-serif;padding:120px 128px 160px;display:flex;flex-direction:column;gap:44px">
<p style="font-size:24px;letter-spacing:3px;text-transform:uppercase;color:{ac};font-weight:600">{eyebrow}</p>
<h2 style="font-family:'Space Grotesk', Arial, sans-serif;font-size:60px;font-weight:700;line-height:1.1;color:{h2}">{title}</h2>
{body}
<p style="position:absolute;left:128px;bottom:64px;font-size:22px;color:{ft}">{foot}</p>
<aside>{notes}</aside>
</section>
'''
def card(h, ps, dark=False, top=None):
    bg='#16212B' if dark else '#FFFFFF'; bd='' if dark else 'border:1px solid #D6DEE4;'; c='#BFD0DB' if dark else '#4A5B69'
    tb=f'border-top:6px solid {top};' if top else ''
    inner=''.join(f'<p style="font-size:26px;line-height:1.4;color:{c}">{p}</p>' for p in ps)
    return f'<div style="flex:1;display:flex;flex-direction:column;gap:12px;background:{bg};{bd}{tb}border-radius:14px;padding:32px"><h3 style="font-size:30px;font-weight:600">{h}</h3>{inner}</div>'
def row(*cards): return '<div style="display:flex;gap:24px">'+''.join(cards)+'</div>'
def para(t, size=30, color=None): return f'<p style="font-size:{size}px;line-height:1.4{";color:"+color if color else ""}">{t}</p>'
def table(head, rows, widths, hl=None, size=27):
    import re as _re
    def isnum(c): return bool(_re.fullmatch(r'[<>/b\s]*[−+\-–]?[\d ,.–%€/−+]+[\s€%]*[<>/b\s]*', c.replace('<b>','').replace('</b>','')))
    al=['left' if i==0 or not all(isnum(r[i]) for r in rows) else 'right' for i in range(len(head))]
    th=''.join(f'<th style="width:{w}%;text-align:{al[i]}">{h}</th>' for i,(h,w) in enumerate(zip(head,widths)))
    trs=''
    for ri,r in enumerate(rows):
        st=' style="background:#DDF3EC"' if hl is not None and ri in hl else ''
        trs+=f'<tr{st}>'+''.join(f'<td style="text-align:{al[i]}">{c}</td>' for i,c in enumerate(r))+'</tr>'
    return f'<table style="width:1664px;font-size:{size}px;font-variant-numeric:tabular-nums">{th and "<tr>"+th+"</tr>"}{trs}</table>'
def method(id, n, name, old, how, good, bad, sol, eol, verdict, notes):
    body=row(card('Comment ça marche', how), card('Ce qui marche', good, top='#0E8F73'), card('Ce qui coince', bad, top='#ED6965'))
    body+=f'<div style="display:flex;gap:48px;align-items:baseline"><p style="font-size:28px;color:#4A5B69">Erreur moyenne au rejeu 2020–2026</p><p style="font-family:\'Space Grotesk\', Arial, sans-serif;font-size:44px;font-weight:700">Solaire {sol} €</p><p style="font-family:\'Space Grotesk\', Arial, sans-serif;font-size:44px;font-weight:700">Éolien {eol} €</p></div>'
    body+=para(verdict, 30)
    return sec(id, False, f'Approche {n} · {old}', name, body, '€/MWh d’erreur sur la valeur du MWh, pondérée par la production · convention curtailment · ppa_walkforward.json', notes)

S={}
S['cover']=f'''<section id="cover" data-transition="fade" style="background:{D};color:#E8EEF2;font-family:'IBM Plex Sans', Arial, sans-serif;padding:160px 128px;display:flex;flex-direction:column;justify-content:center;gap:40px">
<p style="font-size:26px;letter-spacing:4px;text-transform:uppercase;color:#14D3A9;font-weight:600">Pricer PPA · revue des méthodes</p>
<h1 style="font-family:'Space Grotesk', Arial, sans-serif;font-size:96px;font-weight:700;line-height:1.05;color:#F3F6F8">Six approches au banc d’essai : ce qu’on a appris, ce qu’on décide</h1>
<p style="font-size:32px;color:#BFD0DB">Suite du brainstorm du 21 octobre · point du 26 octobre 2026</p>
<aside>Merci d’être là. L’objectif aujourd’hui : repasser chaque méthode en détail, comparer leurs résultats sur le même test, comprendre pourquoi la cannibalisation reste imprécise, puis décider comment on avance. Coupez-moi quand vous voulez.</aside>
</section>
'''
S['question']=sec('question',False,'Ce qu’on s’était demandé le 21/10','Pricer un PPA court à prix fixe, avec arrêt aux prix négatifs, sur n’importe quelle période',
 row(card('Le cas d’usage',['PPA à prix fixe, 1 à 3 ans','Arrêt de production aux heures ≤ 0 €','Périodes à cheval : avril 2027 → novembre 2028']),
     card('Les questions',['Faire mieux que la méthode utilisée jusqu’ici ?','Laquelle est la plus efficace ?','Pourquoi la cannibalisation est-elle encore imprécise ?']),
     card('Ce qu’on a construit',['Un banc d’essai commun aux 6 approches','Un rejeu année par année, sans tricher','Un test des facteurs d’erreur'])),
 'Source : synthèse du brainstorm du 21/10/2026','Rappel du cadre posé au brainstorm. Trois questions : est-ce qu’on bat la méthode historique, laquelle est la meilleure, et pourquoi la cannibalisation reste à côté. Pour y répondre on a construit un banc d’essai unique où toutes les approches passent le même examen.')
S['protocole']=sec('protocole',False,'Le protocole, fixé avant tout résultat','Chaque année est pricée avec les seules données d’avant',
 row(card('Années de réglage',['2019, 2020, 2021, 2023','Choisissent tous les paramètres']),
     card('Années de verdict',['2024, 2025, 2026 à date','Ne servent à rien choisir']),
     card('Année exclue',['2022 : crise du gaz','Hors cibles et hors apprentissage'])) +
 para('Score : erreur sur la <b>valeur d’un MWh</b> en €/MWh = erreur de capture × baseload du mois, mois pondérés par la production payée. En plus, un rejeu « walk-forward » : chaque année 2020–2026 testée à son tour avec les choix faits sur les années d’avant.',28),
 'scripts/ppa_lab.py et scripts/ppa_walkforward.py · relancés chaque semaine','Le point important : rien n’est réglé sur les années qu’on juge. Les années de réglage choisissent les paramètres ; 2024 à 2026 ne font que noter. Le walk-forward va plus loin : chaque année est testée comme si on était au 1er janvier de cette année-là.')
S['convention']=sec('convention',True,'Préalable n° 1 · convention curtailment','Corriger la convention avant de comparer les modèles',
 row(card('Avant',['Heures ≤ 0 € retirées du capture <b>et</b> du baseload (convention « PPA Dashboard »)','Sous-estime le prix d’environ 7 pts de capture en solaire 2025 (≈ 7 €/MWh à Cal 107)'],True,'#ED6965'),
     card('Maintenant',['Les heures arrêtées ne sont pas payées','Le capture des heures payées est rapporté au baseload de <b>toutes</b> les heures','Les deux conventions sont calculées partout : « curt » et « toutes heures »'],True,'#14D3A9')) +
 para('Solaire 2025 réalisé : 75,7 % de la production payée, 79,0 % de capture sur les heures payées (55,6 % en toutes heures).',28,'#BFD0DB'),
 'Chiffres réalisés : ppa_lab.json, profil national France','C’était la priorité du brainstorm : à lui seul, l’écart de convention valait environ 7 €/MWh en solaire. C’est corrigé et les deux conventions sont calculées côte à côte, donc tous les chiffres qui suivent sont en convention curtailment sauf mention contraire.')
S['hierarchie']=sec('hierarchie',False,'Préalable n° 2 · périodes quelconques','Une hiérarchie Cal → trimestre → mois, et la cannibalisation au même pas',
 row(card('Le prix de chaque mois',['Forward mensuel quand il est coté','Sinon trimestre, saison ou Cal, découpé par des coefficients appris sur l’historique (Cal → trimestre, trimestre → mois)']),
     card('La capture de chaque mois',['Chaque méthode produit une capture <b>mensuelle</b>, plus un chiffre annuel','Prix et cannibalisation restent cohérents mois par mois']),
     card('Le prix du contrat',['Σ production × part payée × forward × capture','÷ Σ production × part payée','− écarts + GO − marge'])) +
 para('Réponse à la question du 21/10 : oui, le pricer fait maintenant tourner les méthodes mois par mois sur une période à cheval sur plusieurs années (onglet court terme du pricer).',28),
 'js/ppa-st.js · data/history/fr_forward_monthly.json · ppa_forecast.json (mois jusqu’à fin 2030)','On avait demandé si le pricer savait pricer avril 2027 à novembre 2028. C’est construit : forward au mois quand il existe, sinon redescendu depuis le trimestre ou le Cal avec des coefficients historiques, et la capture est elle aussi mensuelle, pour ne pas mélanger un prix mensuel avec une décote annuelle.')
S['m1']=method('m1',1,'Décote passée','« PPA Dashboard », la méthode d’avant',['Un centile (P74) des décotes des années passées','Un seul chiffre annuel, sans saison'],['Simple, explicable','Bonne tant que le parc solaire grossit lentement (2019–2020 : moins de 3 €)'],['Ne voit pas la cannibalisation qui accélère','Trop optimiste de 14,5 € en 2026','Écarts saisonniers de −14 à +22 pts'],'6,8','5,3','Verdict : sortie des candidates, gardée comme repère de comparaison.','La méthode historique. Elle regarde le passé et prend un centile. Elle était bonne quand le parc solaire changeait peu ; depuis 2024 elle est systématiquement trop optimiste, jusqu’à 14,5 € en 2026 en solaire. On la garde affichée comme référence, pas comme prix.')
S['m2']=method('m2',2,'Tendance de capacité','« Step by step »',['Capture rate ajusté sur le logarithme de la capacité installée','Projeté avec la capacité PPE3 de l’année'],['Meilleure méthode seule en solaire sur 2024–2026 : biais −0,1 / −1,6 / +1,6 €','Suit l’accélération du parc'],['Un chiffre annuel, pas de saison propre','Réglée sur peu d’années : fragile si la relation casse'],'4,9','5,2','Verdict : candidate gardée, la plus sûre seule en solaire.','La tendance de capacité est le modèle le plus simple qui tienne : plus de panneaux, plus de décote, sur une échelle logarithmique. En solaire c’est la meilleure méthode seule sur les années de verdict, avec un biais quasi nul. Sa faiblesse : un seul chiffre par an.')
S['m3']=method('m3',3,'Forme forward','« FPC », asset-specific',['Profil attendu valorisé sur la forme de la courbe forward','Moins un pricing sans effet production = décote de cannibalisation, projetée par tendance'],['Excellente les années stables (2019–2020 : 0,8 €)','Cannibalisation isolée et pilotable'],['Le creux de midi solaire est raté : 78–97 % du prix moyen prévus entre 11 h et 15 h, 6–35 % réels en 2025','Trop optimiste en 2025–2026 (+5,3 et +8,8 €)'],'5,6','4,9','Verdict : candidate gardée ; corriger sa forme horaire.','La forme forward est la méthode la plus fine au niveau annuel les années calmes. Son problème est la forme horaire : elle prévoit encore 80 à 97 % du prix moyen à midi, alors qu’en 2025 on était entre 6 et 35 %. La cannibalisation y est une correction séparée, ce qui est voulu, mais elle a pris du retard sur la réalité.')
S['m4']=method('m4',4,'Modèle européen des prix','FPC avec cannibalisation dans la courbe horaire',['Prix horaire appris sur la demande résiduelle <b>régionale</b> (France + Allemagne + Belgique + Espagne)','Appliqué au parc de l’année sur toutes les années météo passées'],['La meilleure sur les années de réglage (0,7 €)','Seule à produire la cannibalisation heure par heure'],['Trop pessimiste en 2024 (−4,1 €)','Éolien : trop optimiste en 2025–2026 (+7,0 et +8,8 €)','Sensible au réglage (fenêtre, niveau)'],'5,4','5,8','Verdict : candidate gardée ; elle porte la forme horaire.','C’est l’approche 4 du brainstorm : intégrer la cannibalisation directement dans la courbe horaire. On l’a fait avec un modèle de prix sur la demande résiduelle de la région couplée, puisque le prix français aux heures solaires suit le solaire de toute la région. Brillante en réglage, moins stable ensuite.')
S['m5']=sec('m5',False,'Approches 5 et 6 · les Monte Carlo','Simuler donne la fourchette, pas un meilleur prix central',
 row(card('5 · Modèle européen simulé',['Semaines de météo, demande et nucléaire tirées par blocs (bootstrap par blocs)','Prix tirés dans la distribution du modèle : les prix négatifs apparaissent','Erreur : identique au modèle 4 (0,67 contre 0,68 € en réglage)']),
     card('6 · Forme forward simulée',['La projection de cannibalisation tirée en distribution, même médiane','Ne change pas le prix central par construction','Sert à la fourchette du prix']),
     card('Heures ≤ 0 € simulées',['2024 : 403 simulées / 542 réelles','2025 : 1 087 / 722','2026 : 672 / 681','Éolien 2023 : 9 / 171'],top='#E3A008')) +
 para('Les prix négatifs sont là, mais leur nombre n’est pas encore calé : trop peu avant 2024, trop en 2025.',30),
 'Heures à prix ≤ 0 € sur l’année, profil national · ppa_lab.json','Le Monte Carlo corrige le défaut signalé au brainstorm : il produit enfin des prix négatifs. Mais simuler ne rend pas le centre plus juste, il donne une distribution. Et le nombre d’heures négatives n’est pas calé : il en manque avant 2024, il y en a 50 % de trop en 2025.')
S['m7']=method('m7','+','Simulation météo','le Monte Carlo actuel du pricer',['Production et prix simulés ensemble sur des années météo','La cannibalisation émerge de la simulation'],['Meilleure méthode seule en éolien (4,1 €, et 3,3 € en 2026)','Donne naturellement une fourchette'],['Solaire : trop pessimiste en 2025–2026 (−5,1 et −13,2 €)','Presque pas de prix ≤ 0 dans son modèle de prix'],'5,7','4,1','Verdict : candidate gardée ; ses erreurs compensent celles des autres.','La simulation météo est le Monte Carlo qui existait déjà dans le pricer. En éolien c’est la meilleure seule. En solaire elle se trompe dans l’autre sens que les autres : trop pessimiste. C’est justement ce qui la rend utile dans une moyenne.')
cmp=[('Décote passée (repère)','6,8','9,4','5,3','6,5'),('Tendance de capacité','4,9','6,2','5,2','6,5'),('Forme forward','5,6','7,5','4,9','6,1'),('Modèle européen','5,4','7,9','5,8','8,1'),('Simulation météo','5,7','7,6','4,1','4,4'),('Choisir la meilleure jusque-là','5,0','—','4,7','—'),('<b>Moyenne des 4 (retenue)</b>','<b>3,5</b>','<b>4,6</b>','<b>3,9</b>','<b>4,2</b>')]
S['comparaison']=sec('comparaison',False,'Comparaison sur le même examen','La moyenne des quatre se trompe deux fois moins que la méthode d’avant',
 table(['Erreur moyenne, €/MWh','Solaire 2020–26','Solaire 2024–26','Éolien 2020–26','Éolien 2024–26'],cmp,[40,15,15,15,15],hl=[6]) +
 para('Moyenne des 4 = tendance de capacité, forme forward, modèle européen, simulation météo, à poids égaux.',26,'#4A5B69'),
 'Walk-forward, convention curtailment, 2022 exclue · ppa_walkforward.json','Le tableau central. Sur tous les tests, la moyenne des quatre fait 3,5 € en solaire contre 6,8 pour la méthode d’avant, et 3,9 contre 5,3 en éolien. Et sur les trois années récentes, plus dures, l’écart se creuse en solaire : 4,6 contre 9,4.')
S['moyenne']=sec('moyenne',True,'Pourquoi une moyenne plutôt qu’une gagnante','Aucune méthode ne gagne deux années de suite ; leurs erreurs se compensent',
 table(['Année','Choisie (meilleure avant)','Son erreur','Meilleure après coup','Moyenne des 4'],[('2020','Modèle européen','1,5','Forme forward','1,2'),('2021','Forme forward','4,1','Moy. 3','3,2'),('2023','Simulation météo','7,3','Modèle européen','2,9'),('2024','Modèle européen','5,7','Moyenne des 4','2,1'),('2025','Moyenne des 4','4,5','Moyenne des 4','4,2'),('2026','Moyenne des 4','6,7','Moy. 3','7,3')],[12,28,14,28,18],size=26).replace('#DDF3EC','#1C3A33') +
 para('En solaire, la tendance de capacité et la forme forward sont trop optimistes, la simulation météo trop pessimiste : la moyenne annule une bonne part de l’écart.',28,'#BFD0DB'),
 'Solaire, convention curtailment, €/MWh · le choix « hybride » du protocole donnait le même classement','On a testé la stratégie « prendre la meilleure méthode jusqu’ici ». Elle se trompe : la gagnante change chaque année. La moyenne fixe gagne parce que les méthodes se trompent dans des sens opposés. C’est pour ça que le pricer utilise la moyenne à poids égaux.')
S['cannib']=sec('cannib',False,'La question prioritaire','Pourquoi la cannibalisation reste imprécise : aucun facteur testé ne l’explique',
 row(card('Ce qu’on a testé',['Erreur mensuelle de capture contre 7 facteurs (variation sur un an) : nucléaire, hydraulique, demande, exports, pompage et batteries, solaire de la région, niveau des prix','82 mois, test en retirant une année à la fois']),
     card('Ce qu’on trouve',['Pouvoir explicatif négatif hors échantillon : R² −0,09 en solaire, −0,19 en éolien','Corrélations faibles : pompage −0,13 (solaire), solaire régional −0,24 (éolien)','Pente apprise sur plusieurs pays : pas de gain (8,0 contre 8,1)'],top='#ED6965'),
     card('Ce qu’on en conclut',['L’erreur est surtout un effet d’année entière (2026 : toutes les méthodes se trompent)','6 années de rejeu : trop peu pour séparer les causes','Piste la plus solide : le stockage et le solaire des voisins'])),
 'ppa_factors.json · erreur = capture prévue − réalisée (points)','C’était la question prioritaire. On a pris l’erreur mois par mois et on l’a confrontée à chaque facteur proposé au brainstorm. Résultat honnête : aucun n’explique l’erreur hors échantillon. Ça ne veut pas dire qu’ils ne jouent pas, mais qu’avec six années on ne peut pas les isoler.')
S['fourchette']=sec('fourchette',False,'La fourchette de prix','L’incertitude a triplé depuis 2023 ; la fourchette éolienne est trop étroite',
 row(card('Ce qui a changé',['Écart-type des erreurs mensuelles (forme forward, solaire) : 3,0 en 2019 → 10,9 en 2025','Une fourchette calée sur 2019–2021 serait deux à trois fois trop étroite']),
     card('Test de la fourchette à 80 %',['Solaire : réalisé dedans 2 années sur 3','Éolien : 0 sur 3 (2024, 2025, 2026 hors fourchette)'],top='#ED6965'),
     card('Ce qu’on propose',['Fourchette calée sur les erreurs mensuelles récentes, années récentes plus lourdes','Élargir l’éolien','Dire clairement que 6 années, c’est peu'])),
 'Fourchette = erreurs des années précédentes, élargie chaque année · ppa_lab.json','La fourchette est le point le plus faible aujourd’hui. En éolien, le réalisé est sorti de la fourchette à 80 % les trois années de verdict. Il faut l’élargir et la caler sur les erreurs récentes.')
S['ecarts']=sec('ecarts',True,'Ce que ça donne pour 2027–2029','Les méthodes divergent de 40 points en solaire : la moyenne n’est pas un détail',
 table(['Capture solaire, heures payées','2027','2028','2029'],[('Décote passée (repère)','88 %','88 %','88 %'),('Forme forward','81 %','81 %','80 %'),('Tendance de capacité','72 %','70 %','69 %'),('Modèle européen','65 %','51 %','49 %'),('Simulation météo','61 %','62 %','63 %'),('<b>Moyenne des 4</b>','<b>70 %</b>','<b>66 %</b>','<b>65 %</b>')],[40,20,20,20],size=27).replace('#DDF3EC','#1C3A33') +
 para('En éolien, les méthodes restent groupées (88–104 %) : le choix pèse surtout en solaire.',28,'#BFD0DB'),
 'Prévision mensuelle au 25/10/2026, pondérée par la production payée, convention curtailment · ppa_forecast.json','Pour 2029 en solaire, la méthode d’avant dit 88 %, le modèle européen 49 %. Quarante points d’écart : c’est là que le choix de méthode coûte de l’argent. La moyenne est à 65 %.')
S['decisions']=sec('decisions',False,'À décider aujourd’hui','Quatre décisions pour avancer',
 table(['Décision','Proposition'],[('1 · Prix central','Moyenne fixe des 4 méthodes comme prix de référence'),('2 · Décote passée','Retirée des candidates, gardée affichée comme repère'),('3 · Fourchette','Recalée sur les erreurs mensuelles récentes ; éolien élargi'),('4 · Prix à proposer','Solaire 2027–29 : P75 à 49,46 € ou moyenne ? Éolien ~70 € : écart à expliquer')],[30,70],size=28),
 'Décisions ouvertes dans le backlog : prix central, proposition de prix','On a besoin de trancher quatre choses. Les deux premières découlent directement des résultats. La troisième est un chantier court. La quatrième, le prix qu’on propose, c’est votre appel commercial : je vous montre les chiffres, vous décidez.')
S['suite']=sec('suite',True,'Ensuite','Les chantiers, par gain attendu',
 row(card('Court terme',['Caler le nombre d’heures ≤ 0 € du Monte Carlo','Corriger le creux de midi de la forme forward','Fourchette recalée'],True,'#14D3A9'),
     card('Moyen terme',['Courbes de charge des parcs Selfee','Registre ODRÉ des parcs > 5 MW et éCO2mix régional','Prime de risque de base par zone et techno'],True,'#F3C64A'),
     card('À discuter',['Calibration externe (LevelTen, Pexapark) : sources payantes, pas d’API ouverte','Régression quantile, GARCH : plus tard'],True)) +
 para('Je mets à jour le banc d’essai chaque semaine ; on refait ce point quand 2026 sera complète.',28,'#BFD0DB'),
 'Pistes issues du brainstorm du 21/10','Pour la suite, trois chantiers rapides et utiles, puis les données qu’on n’exploite pas encore. La calibration externe est intéressante mais les sources sont payantes et sans API, ce qui sort de notre règle de données. Je propose qu’on refasse ce point début 2027 avec l’année 2026 complète.')
order=['cover','question','protocole','convention','hierarchie','m1','m2','m3','m4','m5','m7','comparaison','moyenne','cannib','fourchette','ecarts','decisions','suite']
for k in order: open(f'project/slides/{k}.html','w').write(S[k])
deck={"v":4,"createdOnFiles":{"v":1,"at":"2026-10-26T18:00:00Z"},"lists":"css","title":"Pricer PPA · revue des méthodes","order":order,
 "sections":{"s1":{"description":"La question et le protocole","start":"cover"},"s2":{"description":"Les méthodes une par une","start":"m1"},"s3":{"description":"La comparaison","start":"comparaison"},"s4":{"description":"Décider et avancer","start":"decisions"}},
 "faces":{"space-grotesk":{"family":"Space Grotesk","href":"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap"},"ibm-plex-sans":{"family":"IBM Plex Sans","href":"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&display=swap"}},"designSystems":[]}
json.dump(deck,open('project/deck.json','w'),ensure_ascii=False)
print('ok')
