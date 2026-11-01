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
for sh in sec.shapes:
    if sh.name=='Textfeld 5': set_text(sh,['04'])
    if sh.name=='Textfeld 6': set_text(sh,['Le couplage européen','de l’électricité'])
# 2 · what coupling is
s=base('Le couplage européen : une seule enchère pour toute l’Europe','Chaque jour à 12 h, le day-ahead de 27 pays est calculé en une seule fois (SDAC)',
       'Sources : ENTSO-E et NEMO Committee (SDAC) ; JAO (Core flow-based) ; EPEX SPOT')
bw=(W-3*182880)//4
for i,(a,b_,c) in enumerate([('1 enchère','par jour, à 12 h','offres de toute l’Europe dans un seul calcul (algorithme Euphemia)'),
                             ('27 pays','dans le couplage day-ahead','la Suisse et la Grande-Bretagne n’en font pas partie'),
                             ('Juin 2022','calcul « flow-based »','capacités d’échange calculées sur le réseau réel (zone Core)'),
                             ('Oct. 2025','pas de 15 minutes','96 prix par jour au lieu de 24')]):
    kpi(s, X0+i*(bw+182880), bw, [a,b_,c])
takeaway(s, 3983951, 1500000, 'Le principe', ['Le calcul envoie l’électricité de la zone la moins chère vers la plus chère, tant que les lignes d’interconnexion ont de la place.',
    'Lignes libres : les prix des deux zones deviennent égaux. Lignes pleines : un écart de prix reste entre les zones.',
    'Cet écart × le flux = la « rente de congestion », encaissée par les gestionnaires de réseau (RTE pour la France).'])
# 3 · the reference, then one slide per case (merit order large, what happens on the right, how often below)
H=json.load(open('/tmp/coupl/disc/docs/discussion/couplage/cases_hist.json'))
CW=6400000   # chart width
def case_slide(title, sub, img, head, bullets, hist=None, when=None):
    s=base(title, sub, 'Illustration PowerKlock : parc et prix indicatifs, lignes de 10 GW' + (' ; fréquences : ENTSO-E, Energy-Charts' if hist else ''))
    s.shapes.add_picture(img, X0-60000, 1300000, width=Emu(CW))
    col=X0+CW+100000; cw=W-CW-100000
    def para(t, size): 
        for p_ in t.text_frame.paragraphs:
            for r in p_.runs: r.font.size=Pt(size)
    tb=clone(s,shp(ref,'TextBox 20')); tb.left=col; tb.top=1330000; tb.width=cw; tb.height=2300000
    set_text(tb,[head]+bullets); para(tb,12.5)
    if hist:
        t2=clone(s,shp(ref,'TextBox 20')); t2.left=col; t2.top=3700000; t2.width=cw; t2.height=800000
        set_text(t2,['Quand ?', when]); para(t2,12.5)
        s.shapes.add_picture(hist, col, 4520000, width=Emu(cw))
    return s
case_slide('La référence : la France seule', 'Le prix est fixé par la dernière centrale appelée pour couvrir la consommation', '/tmp/coupl/form/fm_0.png',
    'Comment lire le dessin', ['Les moyens de production sont rangés du moins cher au plus cher : éolien et solaire, nucléaire, hydraulique, gaz.',
    'La consommation (55 GW) coupe la courbe : le prix est de 50 €/MWh.', 'Dans les quatre cas qui suivent, rien ne change en France : seul le prix des voisins varie.'])
case_slide('Cas 1 · Exportatrice, lignes libres', 'Les voisins paient 58 € : la France produit plus et leur vend', '/tmp/coupl/form/fm_1.png',
    'Ce qui se passe', ['La France produit 5 GW de plus que sa consommation et les exporte.', 'Son prix monte de 50 à 58 € : le même prix que les voisins.',
    'Les lignes ont encore de la place : les prix sont égaux, on dit que les marchés sont « couplés ».'],
    '/tmp/coupl/form/fh_exp_free.png', 'Le cas le plus courant jusqu’en 2021 (35 à 44 % du temps), rare depuis 2024.')
case_slide('Cas 2 · Exportatrice, lignes pleines', 'Les voisins paient 95 € : la France exporte au maximum', '/tmp/coupl/form/fm_2.png',
    'Ce qui se passe', ['Les lignes sont pleines à 10 GW : impossible d’exporter plus.', 'Le prix français monte à 65 €, mais reste loin des 95 € des voisins.',
    'L’écart de 30 € × 10 GW est la rente de congestion, encaissée par les gestionnaires de réseau.'],
    '/tmp/coupl/form/fh_exp_sat.png', 'Majoritaire : 66 % du temps en 2025, France à 57,5 €/MWh, Allemagne à 102,4 €.')
case_slide('Cas 3 · Importatrice, lignes libres', 'Les voisins vendent à 45 € : la France achète chez eux', '/tmp/coupl/form/fm_3.png',
    'Ce qui se passe', ['La France produit 5 GW de moins et les importe.', 'Son prix baisse de 50 à 45 €, le prix des voisins.',
    'Ses centrales les plus chères s’arrêtent : importer coûte moins cher qu’elles.'],
    '/tmp/coupl/form/fh_imp_free.png', 'Rare, sauf en 2022 (19 % du temps), quand le nucléaire manquait.')
case_slide('Cas 4 · Importatrice, lignes pleines', 'Les voisins vendent à 20 € : la France importe au maximum', '/tmp/coupl/form/fm_4.png',
    'Ce qui se passe', ['Les lignes sont pleines à 10 GW : impossible d’importer plus.', 'Le prix français baisse à 40 €, sans rejoindre les 20 € des voisins : la France reste plus chère.',
    'C’est la situation des crises d’approvisionnement en France.'],
    '/tmp/coupl/form/fh_imp_sat.png', '40 % du temps en 2022 (nucléaire à l’arrêt), presque jamais depuis 2024.')
# 4 · how often, in France
s=base('Ce qui se passe vraiment en France','Part du temps passée dans chaque situation face à la Belgique et l’Allemagne, 2015 – oct. 2026',
       'Source : PowerKlock, prix ENTSO-E et échanges Energy-Charts ; même prix = écart < 1 centime ; * janv.–oct.')
s.shapes.add_picture('/tmp/coupl/form/f_hist.png', X0, 1330000, height=Emu(4250000))
tb=clone(s,shp(ref,'TextBox 20')); tb.left=X0+7600000; tb.top=1400000; tb.width=2700000; tb.height=4300000
set_text(tb,['À retenir','Jusqu’en 2021 : la France exporte souvent au même prix que ses voisins (cas 1).',
    '2022 : nucléaire à l’arrêt, la France importe 59 % du temps, souvent plus chère que ses voisins (cas 3 et 4).',
    '2025 : nucléaire revenu, export record ; les lignes sont pleines 66 % du temps (cas 2). La France est alors moins chère : 57,5 €/MWh contre 102,4 € en Allemagne en moyenne sur ces heures.'])
# 5 · effects
s=base('Les effets du couplage','Prix, sécurité d’approvisionnement, réseau : qui y gagne quoi','Sources : RTE, CRE (rapports sur les interconnexions et la rente de congestion), étude PowerKlock couplage')
bw=(W-3*182880)//4
for i,lines in enumerate([['Prix','les prix convergent','Le prix français monte quand la France exporte, baisse quand elle importe. Les heures extrêmes sont adoucies des deux côtés.'],
                          ['Sécurité','on s’entraide','En 2022, les importations ont couvert le manque de nucléaire. Les voisins profitent des exports français le reste du temps.'],
                          ['Réseau','une rente','Quand les lignes sont pleines, l’écart de prix rémunère RTE ; cette rente finance le réseau et allège le tarif d’acheminement (TURPE).'],
                          ['Renouvelables','moins de gâchis','Le surplus de vent ou de soleil part chez les voisins au lieu d’être écrêté ou vendu à prix négatif.']]):
    b=kpi(s, X0+i*(bw+182880), bw, lines)
    if len(lines[0])>10: b.text_frame.paragraphs[0].runs[0].font.size=Pt(21)
takeaway(s, 3983951, 1550000, 'Qui gagne, qui paie ?', ['Aux heures d’export, les producteurs français vendent plus cher et la France encaisse les ventes ; au spot, l’acheteur paie ces heures plus cher.',
    'Mais la plupart des clients n’achètent pas au spot : ils sont couverts par des contrats à terme (forwards) ou des prix fixes.',
    'Au total, le couplage crée de la valeur pour l’Europe : chaque MWh est produit là où il coûte le moins.'])
# keep only the new slides
ids=p.slides._sldIdLst; n_new=9
for sld in list(ids)[:-n_new]:
    rid=sld.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'); p.part.drop_rel(rid); ids.remove(sld)
p.save('/tmp/coupl/form/Formation_couplage_europeen.pptx'); print('saved')
