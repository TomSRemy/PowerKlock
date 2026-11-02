import copy, json
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
SRC='/home/ubuntu/.claude/uploads/38a705c5-a051-501d-9e6a-01b67940131d/1cc9a126-2026.10_Formation_Power_1_Fondamentaux_du_march_.pptx'
p=Presentation(SRC); ref=p.slides[8]   # "Bilan 2025" slide: title, subtitle box, KPI boxes, take-away, source, footers
L={l.name:l for l in p.slide_layouts}
def shp(sl,name): return next(s for s in sl.shapes if s.name==name)
def clone(dst, s): el=copy.deepcopy(s._element); dst.shapes._spTree.append(el); return dst.shapes[-1]
def set_text(shape, lines):
    """keep the first run's formatting of each paragraph; extra lines copy the last paragraph"""
    tf=shape.text_frame; ps=tf.paragraphs
    while len(ps)<len(lines):
        tf._txBody.append(copy.deepcopy(ps[-1]._p)); ps=tf.paragraphs
    for p_,t in zip(ps,lines):
        rs=p_.runs
        if not rs: p_.add_run()
        rs=p_.runs; rs[0].text=t
        for r in rs[1:]: r._r.getparent().remove(r._r)
    for p_ in list(tf.paragraphs)[len(lines):]: p_._p.getparent().remove(p_._p)
X0, W = 1207008, 10268712
def base(title, sub, source):
    s=p.slides.add_slide(L['Titre et contenu'])
    for ph in list(s.placeholders):
        if ph.placeholder_format.idx!=0: ph._element.getparent().remove(ph._element)
    s.shapes.title.text=title
    for nm in ('Espace réservé de la date 2','Espace réservé du pied de page 3','Espace réservé du numéro de diapositive 4'):
        pass
    for sh in ref.shapes:
        if sh.is_placeholder and sh.placeholder_format.idx in (10,11,12): clone(s,sh)
    set_text(clone(s,shp(ref,'TextBox 12')),[sub])
    if source:
        sb=clone(s,shp(ref,'TextBox 13')); sb.width=5600000; set_text(sb,[source])
    return s
def kpi(s, x, w, lines):
    b=clone(s,shp(ref,'Rectangle 15')); b.left=x; b.width=w; set_text(b,lines); return b
def takeaway(s, y, h, head, lines):
    # a light panel behind the take-away fills the slide down to the sources, in the deck's KPI grey
    from pptx.enum.shapes import MSO_SHAPE
    k=shp(ref,'Rectangle 15'); fill=k.fill.fore_color.rgb if k.fill.type==1 else RGBColor(0xF2,0xF2,0xF4)
    pn=s.shapes.add_shape(MSO_SHAPE.RECTANGLE, X0, y-120000, W, 6000000-y+120000); pn.fill.solid(); pn.fill.fore_color.rgb=fill; pn.line.fill.background(); pn.shadow.inherit=False
    t=clone(s,shp(ref,'TextBox 20')); t.left=X0+150000; t.width=W-300000; t.top=y; t.height=h; set_text(t,[head]+lines); return t
# 1 · section divider: a copy of the deck's own section slide (gradient, big number, logo), think-cell object left out
def dup(src):
    d=p.slides.add_slide(src.slide_layout)
    for ph in list(d.placeholders): ph._element.getparent().remove(ph._element)
    remap={}
    for rId, rel in src.part.rels.items():
        if 'image' in rel.reltype: remap[rId]=d.part.relate_to(rel.target_part, rel.reltype)
    for sh in src.shapes:
        if sh.shape_type==7: continue
        el=copy.deepcopy(sh._element)
        for node in el.iter():
            for att in list(node.attrib):
                if att.endswith('}embed') or att.endswith('}link'):
                    if node.attrib[att] in remap: node.attrib[att]=remap[node.attrib[att]]
        d.shapes._spTree.append(el)
    return d
sec=dup(p.slides[2])
from pptx.enum.text import PP_ALIGN
P2='/tmp/coupl/p2/'
def boxes(s, items, y=1926551, h=1737360, vsize=None):
    n=len(items); gap=182880; bw=(W-(n-1)*gap)//n; out=[]
    for i,lines in enumerate(items):
        b=kpi(s, X0+i*(bw+gap), bw, lines); b.top=y; b.height=h
        if vsize: b.text_frame.paragraphs[0].runs[0].font.size=Pt(vsize)
        out.append(b)
    return out
def chart_slide(title, sub, img, head, bullets, source, cw=6600000):
    s=base(title, sub, source)
    s.shapes.add_picture(img, X0-60000, 1330000, width=Emu(cw))
    tb=clone(s,shp(ref,'TextBox 20')); tb.left=X0+cw+150000; tb.top=1400000; tb.width=W-cw-150000; tb.height=4300000
    set_text(tb,[head]+bullets)
    for p_ in tb.text_frame.paragraphs:
        for r in p_.runs: r.font.size=Pt(13)
    return s
def table_slide(title, sub, rows, source, widths=None):
    s=base(title, sub, source)
    t=clone(s,shp(p.slides[31],'Table 15')); tbl=t.table
    trs=tbl._tbl.tr_lst
    while len(trs)<len(rows): tbl._tbl.append(copy.deepcopy(trs[-1])); trs=tbl._tbl.tr_lst
    while len(trs)>len(rows): tbl._tbl.remove(trs[-1]); trs=tbl._tbl.tr_lst
    for r,row in enumerate(rows):
        for c,val in enumerate(row):
            cell=tbl.cell(r,c); set_text(cell, [val]) if False else None
            tf=cell.text_frame; ps=tf.paragraphs
            runs=ps[0].runs
            if not runs: ps[0].add_run(); runs=ps[0].runs
            runs[0].text=val
            for x in runs[1:]: x._r.getparent().remove(x._r)
            for x in ps[1:]: x._p.getparent().remove(x._p)
    if widths:
        for c,w_ in enumerate(widths): tbl.columns[c].width=Emu(w_)
    return s
SRC_EM='Source : formation Energy Management (T. Remy, 2024), mise à jour 2026'
# 0 · section
sec=dup(p.slides[2])
for sh in sec.shapes:
    if sh.name=='Textfeld 5': set_text(sh,['04'])
    if sh.name=='Textfeld 6': set_text(sh,['Le rôle du fournisseur','et ses produits'])
# 1 · the job
s=base('Le métier du fournisseur','Trois rôles, souvent réunis dans la même entreprise', SRC_EM)
boxes(s,[['Fournisseur','face au client','Contrat, changement de fournisseur, facturation de tous les coûts du client.'],
         ['Responsable d’équilibre','face à RTE','Équilibre son périmètre au quart d’heure et paie les écarts.'],
         ['Accès au marché','face à la bourse','Achète et vend l’énergie : bourse (EEX, EPEX SPOT) et gré à gré.']], vsize=20)
takeaway(s, 3983951, 1500000, 'Un métier à haut risque et faible marge', ['La marge brute du fournisseur représente environ 5 à 10 % de la facture du client.',
    'Si l’énergie coûte 10 % de plus que prévu, la marge disparaît.', 'D’où deux réflexes : couvrir chaque vente aussitôt (« back-to-back ») et facturer des primes de risque.'])
# 2 · products table
table_slide('Les produits proposés aux clients','Qui porte le risque de prix : le client ou le fournisseur ?',[
    ['Produit','Prix payé par le client','Risque client','Risque fournisseur','Pour qui ?','Contrainte'],
    ['Prix fixe','Un prix connu à la signature, pour toute la durée','Aucun','Élevé','Tous les segments','Primes de risque plus élevées'],
    ['Indexé spot','Moyenne mensuelle ou trimestrielle du day-ahead','Moyen','Moyen','B2B','Prix connu après la livraison'],
    ['Indexé forward','Moyenne des cotations à terme avant la livraison (101, 103…)','Moyen','Moyen','B2B','Prix connu avant la livraison'],
    ['Dynamique','Le day-ahead, quart d’heure par quart d’heure','Élevé','Faible','Clients flexibles','Compteur communicant'],
    ['Click volume','Des blocs (MW) fixés quand le client veut, le reste au spot','Moyen à élevé','Faible','Grands clients','Suivre le marché'],
    ['Click %','Une part de la consommation fixée par étapes, le reste au spot','Faible à moyen','Élevé','Grands clients','Suivre le marché']],
    SRC_EM)
# 3 · fixed vs spot 2025
chart_slide('Prix fixe ou prix spot ? L’exemple de 2025','Le prix spot mensuel en France, face à un prix fixé à l’avance', P2+'c_fixed.png',
    'À retenir', ['Un client au prix fixe paie le même prix toute l’année : ici le Cal 2025, acheté pendant 2024 à 63,8 €/MWh en moyenne (hors forme et frais).',
    'Au spot, il aurait payé 102 € en janvier, 123 € en février, mais 19 € en mai.', 'Sur l’année, le spot moyen a été de 61,1 € : le fixe a coûté un peu plus, en échange d’aucune surprise.'],
    'Prix day-ahead France (ENTSO-E) ; Cal 2025 base, moyenne des clôtures de 2024 (EEX) ; calcul PowerKlock')
# 4 · ABC
chart_slide('Les produits indexés sur le marché à terme','Le code A·B·C dit quand on achète et quand on livre', P2+'c_abc.png',
    'Comment ça marche', ['Le prix est la moyenne des cotations à terme pendant la période d’achat.',
    'Le fournisseur achète 1/X du volume chaque jour de bourse : 1/21 par jour pour un 101 livré en octobre, s’il y a 21 jours de bourse en septembre.',
    'Le client porte le prix du marché ; le fournisseur garde les risques de volume et de forme.'], SRC_EM, cw=6900000)
# 5 · dynamic and click
s=base('Prix dynamique et « click »','Le client choisit quand et combien il fixe', SRC_EM)
boxes(s,[['Dynamique','le spot, au quart d’heure','Le client paie le day-ahead de chaque quart d’heure. Il faut un compteur communicant ; le fournisseur se concentre sur les écarts.'],
         ['Click volume','des blocs en MW','Le client « clique » des blocs à terme quand il le veut ; tout le reste est payé au spot.'],
         ['Click %','une part de la consommation','Chaque click fixe une part de la consommation, avec sa forme ; le reste est payé au spot.']], vsize=20)
takeaway(s, 3983951, 1500000, 'Le bon produit dépend du client', ['Un client qui ne veut aucune surprise : prix fixe.', 'Un client qui suit les marchés : click ou indexé.',
    'Un client capable de déplacer sa consommation : dynamique, pour profiter des heures à prix bas ou négatifs.'])
# 6 · hedging step by step
s=base('La couverture, pas à pas','Chaque vente à prix fixe est couverte aussitôt, puis affinée jusqu’à la livraison', SRC_EM)
boxes(s,[['Signature','Cal base','On achète l’année en ruban (baseload).'],['Y-1','trimestres','On ajuste par trimestre.'],['Q-1','mois','On ajuste par mois.'],
         ['J-1, 12 h','day-ahead','On ajuste au quart d’heure.'],['Jour J','intraday','On corrige les prévisions.'],['Après','écarts','RTE facture ce qui reste.']], vsize=17)
takeaway(s, 3983951, 1500000, 'La position ouverte', ['Position ouverte = achats + production − consommation.',
    'Négative : le fournisseur est « court » (short), il doit acheter. Positive : il est « long », il doit revendre. Nulle : il est « plat » (flat).',
    'À chaque étape, l’objectif est de ramener la position à zéro au meilleur prix.'])
# 7 · price stack
chart_slide('Construire un prix fixe','Prix = A × prix de référence + B', P2+'c_stack.png',
    'Les étages du prix', ['Commodité base : le Cal acheté à la signature (63,8 € pour 2025).',
    'Coût de forme : un client qui consomme surtout l’hiver et aux heures chères coûte plus que la base (+5,7 € pour la consommation française en 2025).',
    'Puis : primes de risque (volume, prix, écarts), certificats (garanties d’origine, CEE), capacité, frais et marge.',
    'A multiplie ce qui suit le prix (forme, équilibrage) ; B ajoute ce qui n’en dépend pas (certificats, frais, marge).'],
    'Cal 2025 : moyenne des clôtures de 2024 (EEX) ; forme : consommation RTE × prix day-ahead 2025 ; calcul PowerKlock', cw=6000000)
# 8 · shaping
chart_slide('Le coût de forme (shaping), pas à pas','France 2025 : ce que coûte le profil de consommation par rapport au prix base', P2+'c_shape.png',
    'Lecture', ['Coût de forme = prix pondéré par la consommation − prix base.',
    'Saisonnier (+3,9 €) : on consomme plus l’hiver, quand l’électricité est chère.',
    'Infra-mensuel (+1,8 €) : on consomme plus le matin et le soir qu’à midi, quand le solaire fait baisser les prix.',
    'Un profil de bureau, d’usine ou de logement donne un autre coût : c’est pour cela qu’on le calcule client par client.'],
    'Consommation RTE et prix day-ahead au quart d’heure, France, 2025 (35 036 quarts d’heure) ; calcul PowerKlock')
# 9 · risks
s=base('Les risques du fournisseur','Prix, volume, forme : à long terme sur les marchés à terme, à court terme sur le spot', SRC_EM)
boxes(s,[['Prix','le spot s’écarte du forward','(spot − forward) × forme réalisée'],['Volume','le client consomme plus ou moins','(forward − spot moyen) × (volume réel − volume prévu)'],
         ['Forme','le profil change','forward × (forme réelle − forme prévue)']], vsize=22)
takeaway(s, 3983951, 1500000, 'Ce qu’il faut retenir', ['Un contrat fixe porte le risque de volume sur toute sa durée ; un indexé 101, seulement sur un mois.',
    'Un produit dynamique n’a presque pas de risque à long terme.', 'Les trois risques se recoupent : on les évalue ensemble, on ne les additionne pas.'])
# 10 · imbalances
s=base('Les écarts : le dernier coût','Ce que la prévision n’a pas vu, RTE le facture au prix d’écart', SRC_EM+' ; CRE, règles RTE')
boxes(s,[['15 min','pas de règlement','En France depuis janvier 2025.'],['Volume d’écart','prévision − volume alloué','Mesuré au quart d’heure pour les compteurs communicants, profilé pour les autres.'],
         ['Coût','écart × (prix d’écart − day-ahead)','Ce que coûte l’erreur, par rapport à l’achat au day-ahead.']], vsize=20)
takeaway(s, 3983951, 1500000, 'Comment le réduire', ['Mieux prévoir (météo, historique du client), corriger en intraday jusqu’à la livraison.',
    'Regrouper des clients aux profils différents : les erreurs se compensent.', 'Facturer ce risque au client dans une prime d’écart, ou le lui laisser (option « pass-through »).'])
# 11 · what the client pays in 2026
s=base('Ce que paie un client en France en 2026','L’énergie n’est qu’une partie de la facture', 'Sources : CRE (TURPE 7), loi de finances (accise), RTE (mécanisme de capacité), DGEC (CEE)')
boxes(s,[['Énergie','marché + forme','Commodité, forme, primes de risque, marge.'],['Capacité','contribution RTE','Depuis le 1er novembre 2026, versée à RTE selon la consommation des jours de pointe.'],
         ['CEE','6e période','Depuis 2026 : obligation d’économies d’énergie.'],['Garanties d’origine','offres vertes','1 GO = 1 MWh renouvelable.'],
         ['Réseau et taxes','TURPE 7, accise, TVA','Fixés par la CRE et l’État ; le fournisseur les refacture.']], vsize=17)
takeaway(s, 3983951, 1500000, 'La fin de l’ARENH', ['Jusqu’au 31 décembre 2025, les fournisseurs achetaient une part du nucléaire d’EDF à 42 €/MWh (ARENH).',
    'Depuis 2026, ils achètent tout au prix de marché ; le versement nucléaire universel (VNU) reverse aux consommateurs une partie des revenus nucléaires d’EDF au-delà de seuils.'])
# 12 · take-aways
s=base('À retenir','Le rôle du fournisseur en cinq idées', None)
t=takeaway(s, 1500000, 4300000, 'Cinq idées', ['Le fournisseur vend à prix fixe ce qu’il achète à prix variable : son métier, c’est gérer ce risque.',
    'Il couvre chaque vente aussitôt : Cal, puis trimestres, mois, day-ahead, intraday.', 'Le prix d’un client = commodité base + coût de forme + risques + certificats + capacité + marge.',
    'Le coût de forme dépend du profil : +5,7 €/MWh pour la consommation française en 2025.', 'Les écarts, réglés au quart d’heure, sont le dernier coût : bien prévoir, c’est gagner de la marge.'])
for p_ in t.text_frame.paragraphs:
    for r in p_.runs: r.font.size=Pt(20)
    p_.space_after=Pt(14)
ids=p.slides._sldIdLst; n_new=13
for sld in list(ids)[:-n_new]:
    rid=sld.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'); p.part.drop_rel(rid); ids.remove(sld)
p.save(P2+'Formation_partie2_fournisseur.pptx'); print('saved')
