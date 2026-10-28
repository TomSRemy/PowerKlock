import json, math
CD=json.load(open('../chartdata.json'))
INK='#14212C'; MUT='#6B7C89'; GRID='#D6DEE4'; TEAL='#0E8F73'; SUN='#E3A008'; RED='#C2412D'; BLUE='#2E7FBF'; GREY='#9AA8B3'; PURP='#7B5EA7'
def fr(v,n=1): return f"{v:.{n}f}".replace('.',',')
class Chart:
    """pinned chart: area (x,y,w,h) in slide px; data coords mapped by sx, sy; layers carry build order"""
    def __init__(s,x,y,w,h,xmin,xmax,ymin,ymax,pad=(110,20,20,50)):
        s.x,s.y,s.w,s.h=x,y,w,h; s.xmin,s.xmax,s.ymin,s.ymax=xmin,xmax,ymin,ymax
        s.pl,s.pt,s.pr,s.pb=pad; s.layers={}; s.labels=[]
    def X(s,v): return s.pl+(v-s.xmin)/(s.xmax-s.xmin)*(s.w-s.pl-s.pr)
    def Y(s,v): return s.pt+(s.ymax-v)/(s.ymax-s.ymin)*(s.h-s.pt-s.pb)
    def add(s,order,el): s.layers.setdefault(order,[]).append(el)
    def lab(s,txt,x,y,w=200,align='left',color=MUT,order=0,size=24,weight=400):
        # x,y in chart-local px (y = top of text box)
        s.labels.append((order,f'<p style="position:absolute;left:{int(s.x+x)}px;top:{int(s.y+y)}px;width:{w}px;font-size:{size}px;line-height:1.15;color:{color};font-weight:{weight};text-align:{align}"{BI(order)}>{txt}</p>'))
    def grid(s,ys,fmt,order=0):
        for v in ys:
            yy=s.Y(v); s.add(order,f'<line x1="{s.pl}" y1="{yy:.1f}" x2="{s.w-s.pr}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="2"/>')
            s.lab(fmt(v),0,yy-14,s.pl-10,'right',order=order)
    def xticks(s,vals,fmt=str,order=0,every=1):
        for i,v in enumerate(vals):
            if i%every: continue
            s.lab(fmt(v),s.X(v)-50,s.h-s.pb+8,100,'center',order=order)
    def line(s,pts,color,order,width=5,dash=None,dots=True):
        d=' '.join(f"{'M' if i==0 else 'L'}{s.X(a):.1f},{s.Y(b):.1f}" for i,(a,b) in enumerate(pts))
        s.add(order,f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{f" stroke-dasharray=\"{dash}\"" if dash else ""}/>')
        if dots:
            for a,b in pts: s.add(order,f'<circle cx="{s.X(a):.1f}" cy="{s.Y(b):.1f}" r="7" fill="{color}"/>')
    def bar(s,xc,v0,v1,bw,color,order):
        y0,y1=s.Y(v0),s.Y(v1); s.add(order,f'<rect x="{xc-bw/2:.1f}" y="{min(y0,y1):.1f}" width="{bw:.1f}" height="{max(2,abs(y1-y0)):.1f}" rx="4" fill="{color}"/>')
    def html(s):
        out=''
        for o in sorted(s.layers):
            out+=f'<svg aria-label="graphique" width="{s.w}" height="{s.h}" viewBox="0 0 {s.w} {s.h}" style="position:absolute;left:{s.x}px;top:{s.y}px;width:{s.w}px;height:{s.h}px"{BI(o)}>'+''.join(s.layers[o])+'</svg>'
        out+=''.join(l for _,l in sorted(s.labels,key=lambda t:t[0]))
        return out
def BI(o): return f' data-build-in="fade {o}"' if o else ''
def head(id,eyebrow,title,dark=False):
    bg='#0E151C' if dark else '#F4F6F7'; fg='#E8EEF2' if dark else '#14212C'; ac='#14D3A9' if dark else '#0E8F73'
    return f'''<section id="{id}" data-transition="fade" style="background:{bg};color:{fg};font-family:'IBM Plex Sans', Arial, sans-serif;padding:120px 128px 160px;display:flex;flex-direction:column;gap:28px">
<p style="font-size:24px;letter-spacing:3px;text-transform:uppercase;color:{ac};font-weight:600">{eyebrow}</p>
<h2 style="font-family:'Space Grotesk', Arial, sans-serif;font-size:56px;font-weight:700;line-height:1.1;color:{fg}">{title}</h2>
'''
def side(x,y,w,items,order0=1,color='#4A5B69',size=26):
    out=''; yy=y
    for i,(t,o) in enumerate(items):
        out+=f'<p style="position:absolute;left:{x}px;top:{yy}px;width:{w}px;font-size:{size}px;line-height:1.35;color:{color}"{BI(o)}>{t}</p>'
        import math as _m
        n=len(t.replace("<b>","").replace("</b>",""))
        yy+= int(size*1.35*_m.ceil(n*0.56*size/w))+22
    return out
def tail(foot,notes):
    return f'<p style="position:absolute;left:128px;bottom:64px;font-size:22px;color:#6B7C89">{foot}</p>\n<aside>{notes}</aside>\n</section>\n'

C={}
# 1 cannibalisation : capture solaire toutes heures + GW
ys=[y for y in CD['years']]
c=Chart(128,330,1080,560,2015.5,2025.5,40,110)
c.grid([40,60,80,100],lambda v:f'{v} %'); c.xticks(ys,lambda v:str(v)[2:] if False else str(v),every=1)
pts=[(y,CD['capt_all_s'][str(y)]*100) for y in ys if y!=2022]
c.line(pts,SUN,1)
c.add(2,f'<circle cx="{c.X(2022):.1f}" cy="{c.Y(104.6):.1f}" r="9" fill="none" stroke="{GREY}" stroke-width="4"/>')
c.lab('2022 : crise',c.X(2022)-90,c.Y(104.6)-48,180,'center',GREY,2)
c.add(3,f'<rect x="{c.X(2023.5):.1f}" y="{c.pt}" width="{c.X(2025.5)-c.X(2023.5):.1f}" height="{c.h-c.pt-c.pb}" fill="{RED}" opacity="0.08"/>')
c.lab('56 %',c.X(2025)-60,c.Y(56)+14,120,'center',RED,3,28,600)
C['cannib']=head('cannib','Pourquoi la capture baisse','La cannibalisation : plus il y a de solaire, moins le solaire vaut')+c.html()+side(1270,340,520,[('Capture solaire, toutes heures, France',1),('Parc solaire : <b>9,4 GW</b> en 2019 → <b>28,3 GW</b> en 2025',1),('Capture : <b>95 %</b> → <b>56 %</b>',3),('Le prix de midi suit le solaire de toute la région couplée : France, Allemagne, Belgique, Espagne',3)])+tail('Production RTE éCO2mix × prix day-ahead ENTSO-E · capacité installée France','Regarde la courbe. De 2016 à 2021 la capture solaire reste autour de 90 à 100 pour cent : le parc est petit. 2022 est à part, c’est la crise. Puis tout bascule : 85 pour cent en 2023, 65 en 2024, 56 en 2025, pendant que le parc passe de 9 à 28 gigawatts. Et le prix de midi suit le solaire de toute la région couplée, pas seulement le parc français.')
# 2 negative hours bars
nh={**{y:CD['negH'][str(y)] for y in CD['years']},**{2019:28,2020:105,2021:66,2023:171,2024:542,2025:722,2026:681}}
c=Chart(128,330,1080,560,2015.4,2026.6,0,800)
c.grid([0,200,400,600,800],lambda v:str(v)); c.xticks(list(range(2016,2027)),str)
for y in range(2016,2027):
    o=1 if y<2024 else 2
    c.bar(c.X(y),0,nh[y],52,RED if y>=2024 else '#E59A8C',o)
    if y>=2023: c.lab(str(nh[y]),c.X(y)-50,c.Y(nh[y])-34,100,'center',INK,o,24,600)
C['negatifs']=head('negatifs','Prix négatifs','Les heures à prix ≤ 0 € ont été multipliées par 25 en six ans')+c.html()+side(1270,340,520,[('Heures à prix day-ahead ≤ 0 € par an, France (2026 : au 25 octobre)',1),('Avec arrêt, ces MWh ne sont <b>ni produits ni payés</b> : solaire 2025, <b>76 %</b> de la production payée',2),('Bonne convention : capture des heures payées ÷ baseload de <b>toutes</b> les heures',3),('L’ancienne retirait ces heures des deux côtés : ≈ <b>+7 €/MWh</b> de trop en solaire 2025',3)])+tail('ENTSO-E, day-ahead France, heures à prix ≤ 0 € · 2026 à date','Les heures à prix nul ou négatif : une poignée avant 2019, 171 en 2023, 542 en 2024, 722 en 2025, et déjà 681 cette année. Avec un contrat qui arrête le parc, ces heures ne sont ni produites ni payées. D’où la convention : on rapporte ce qu’on capte sur les heures payées au prix moyen de toutes les heures. L’ancienne convention rendait le solaire plus beau d’environ 7 euros.')
# 3 waterfall decompo
c=Chart(128,330,1100,560,0,6,0,90,pad=(110,20,20,60))
c.grid([0,30,60,90],lambda v:f'{v} €')
steps=[('Forward<br>Cal 27–29',0,84.05,'#5B6B78',1),('Non capté<br>(forme)',84.05,54.60,RED,2),('Valeur<br>captée',0,54.60,SUN,2),('Écarts',54.60,52.25,RED,3),('GO',52.25,54.09,TEAL,3),('PPA<br>publié',0,54.09,INK,4)]
for i,(n,a,b,col,o) in enumerate(steps):
    xc=c.X(i+0.5); c.bar(xc,a,b,110,col,o); c.lab(n,xc-90,c.h-c.pb+6,180,'center',MUT,o)
    v=b if a==0 else b-a; c.lab(('' if a==0 else ('+' if v>0 else '−'))+fr(abs(v),2),xc-90,c.Y(max(a,b))-36,180,'center',INK,o,24,600)
c.add(5,f'<line x1="{c.X(3.6):.1f}" y1="{c.Y(47.77):.1f}" x2="{c.X(6):.1f}" y2="{c.Y(47.77):.1f}" stroke="{BLUE}" stroke-width="4" stroke-dasharray="10 8"/>')
c.lab('moyenne des 3 : 47,77',c.X(3.6),c.Y(47.77)+8,280,'left',BLUE,5,24,600)
C['decompo']=head('decompo','Décomposer un prix','Le prix du PPA = forward × capture, puis les ajustements')+c.html()+side(1290,340,500,[('Solaire, PPA 2027–2029, benchmark du 25/10/2026, €/MWh',1),('Le solaire ne capte que <b>65 %</b> du forward : 29,45 € de valeur perdue à cause de sa forme',2),('Benchmark publié = <b>tendance de capacité</b>, méthode par défaut',4),('Avec la moyenne des 3 méthodes : <b>47,77 €</b>, 6 € de moins',5)])+tail('data/history/ppa_benchmark.json · profil national, arrêt aux prix ≤ 0','On part du forward, 84 euros, moyenne pondérée des Cal 27 à 29. La forme du solaire en fait perdre 29 : il ne capte que 65 pour cent. On retire 2,35 de coût des écarts, on ajoute 1,84 de garanties d’origine : 54,09. Mais ce prix publié est celui de la tendance de capacité seule. La moyenne des trois méthodes calculées chaque jour donne 47,77 : la ligne bleue, six euros plus bas.')
# 4 step scatter log GW
st=CD['step']; b=st['slope']; a=st['intercept']
lx=lambda g: math.log(g)
c=Chart(128,330,1080,560,lx(6.5),lx(55),55,105)
c.grid([60,70,80,90,100],lambda v:f'{v} %')
for g in (7,10,15,20,30,40,50): c.lab(f'{g} GW',c.X(lx(g))-60,c.h-c.pb+8,120,'center')
for y,g,r in zip(st['years'],st['gw'],st['capt']):
    c.add(1,f'<circle cx="{c.X(lx(g)):.1f}" cy="{c.Y(r*100):.1f}" r="9" fill="{SUN}"/>')
for y,g,r in zip(st['years'],st['gw'],st['capt']):
    if y in (2016,2021,2024,2025): c.lab(str(y),c.X(lx(g))-40,c.Y(r*100)+12,80,'center',MUT,1)
c.line([(lx(7),(a+b*lx(7))*100),(lx(55),(a+b*lx(55))*100)],GREY,2,4,'12 10',False)
r25=st['capt'][-1]; g25=st['gw'][-1]
proj=[(lx(g25),r25*100)]+[(lx(g),(r25+b*(lx(g)-lx(g25)))*100) for g in (39.0,48.0)]
c.line(proj,RED,3,5,None,True)
c.lab('2027 : 72,3 %',c.X(lx(39))-120,c.Y(proj[1][1])+14,240,'center',RED,3,26,600)
c.lab('48 GW (PPE3 2030)',c.X(lx(48))-110,c.Y(proj[2][1])+14,220,'center',RED,3)
C['m2a']=head('m2a','Méthode 2 · tendance de capacité · mécanique','La décote suit le logarithme des GW, ancrée sur la dernière année')+c.html()+side(1270,340,520,[('Capture solaire (convention arrêt) contre capacité installée, échelle log',1),('Pente ajustée : <b>−0,146</b> par unité de ln(GW) ≈ <b>−10 pts</b> par doublement du parc',2),('Projection ancrée sur 2025 (77,0 %), pas sur la droite',3),('77,0 % − 0,146 × ln(39,0 ÷ 28,3) = <b>72,3 %</b>',3)])+tail('2016–2025 hors 2022 · scripts/ppa_backtest_detail.py (m_step)','Chaque point est une année : la capacité solaire en abscisse, en logarithme, la capture en ordonnée. La droite grise est la pente ajustée : moins 0,146, environ dix points de capture par doublement du parc. Et voici le choix méthodologique clé : on ne prolonge pas la droite, on part du dernier point réel, 2025, et on n’applique que la pente. Résultat : 72,3 pour cent en 2027.')
# 5 FPC skeleton vs real
hrs=list(range(24))
c=Chart(128,330,1080,560,0,23,0,2.0)
c.grid([0,0.5,1.0,1.5,2.0],lambda v:f'{int(v*100)} %'); c.xticks([0,4,8,12,16,20,23],lambda h:f'{h} h')
pf=CD['solar_prof_summer']; m=max(pf)
area='M'+' L'.join(f'{c.X(h):.1f},{c.Y(pf[h]/m*0.6):.1f}' for h in hrs)+f' L{c.X(23):.1f},{c.Y(0):.1f} L{c.X(0):.1f},{c.Y(0):.1f} Z'
c.add(1,f'<path d="{area}" fill="{SUN}" opacity="0.18"/>')
c.lab('production solaire',c.X(12.5)-110,c.Y(0.32),220,'center','#B07C00',1)
c.line([(h,CD['skel_summer'][h]) for h in hrs],GREY,2,5,None,False)
c.lab('squelette FPC',c.X(19.3),c.Y(1.30),220,'left','#6F7E89',2,24,600)
c.line([(h,CD['real_summer_2025'][h]) for h in hrs],RED,3,5,None,False)
c.lab('réel été 2025',c.X(15)+10,c.Y(CD['real_summer_2025'][15])+6,220,'left',RED,3,24,600)
C['m3a']=head('m3a','Méthode 3 · forme forward · mécanique','Le squelette horaire moyen ne voit pas le trou de midi')+c.html()+side(1270,340,520,[('Prix de chaque heure ÷ prix moyen, été (avril–septembre)',1),('(1) squelette : moyenne des années d’apprentissage ; (2) profil du parc valorisé dessus ; (3) correction c de cannibalisation',2),('À 14 h : squelette <b>70 %</b>, réalité 2025 <b>6 %</b>',3),('Toute la différence retombe sur c, annuel et en retard : +0,09 avant 2020, −0,06 en 2025',3)])+tail('Été = avril à septembre · squelette appris sur 2016–2025 hors 2022 · prix day-ahead ENTSO-E','Voici la mécanique de la forme forward et son défaut, en une image. En jaune, quand le solaire produit. En gris, le squelette de prix que la méthode apprend : la moyenne de dix ans, qui creuse à peine à midi. En rouge, la réalité de l’été 2025 : le prix tombe à 6 pour cent de la moyenne à 14 heures. La méthode valorise le profil sur la courbe grise, puis compte sur un terme de correction annuel pour rattraper l’écart entre le gris et le rouge.')
# 6 Jensen histogram
j=CD['jensen']; H=CD['jensen_hist']; edges=list(range(-60,170,10))
c=Chart(128,330,1080,560,-60,160,0,300)
c.grid([0,100,200,300],lambda v:str(v)); c.xticks([-50,0,50,100,150],lambda v:f'{v} €')
for i,n in enumerate(H):
    lo=edges[i]; col=RED if lo<0 or (lo==0) else BLUE
    c.bar(c.X(lo+5),0,n,c.X(10)-c.X(0)-6,RED if lo<0 else BLUE,1)
c.add(2,f'<line x1="{c.X(j["mean"]):.1f}" y1="{c.pt}" x2="{c.X(j["mean"]):.1f}" y2="{c.h-c.pb}" stroke="{INK}" stroke-width="4" stroke-dasharray="10 8"/>')
c.lab(f'prix moyen {fr(j["mean"],1)} €',c.X(j['mean'])+10,c.pt+10,300,'left',INK,2,24,600)
c.add(3,f'<line x1="{c.X(j["meanpos"]):.1f}" y1="{c.pt+60}" x2="{c.X(j["meanpos"]):.1f}" y2="{c.h-c.pb}" stroke="{TEAL}" stroke-width="5"/>')
c.lab(f'payé avec arrêt {fr(j["meanpos"],1)} €',c.X(j['meanpos'])+10,c.pt+60,340,'left',TEAL,3,24,600)
C['m5h']=head('m5h','Méthodes 5 à 7 · le point méthodologique des simulations','Pourquoi une moyenne ne voit pas les prix négatifs')+c.html()+side(1270,340,520,[('Prix des heures 11 h–16 h, été 2025 (915 heures)',1),(f'<b>{int(round(j["shareNeg"]*100))} %</b> des heures à prix ≤ 0 € (en rouge)',1),('Avec arrêt, le parc touche max(prix, 0) : <b>11,4 €</b> en moyenne, pas 8,1 €',3),('E[max(prix, 0)] ≠ max(E[prix], 0) : une méthode qui lit un prix moyen rate l’arrêt (simulation météo) ; le modèle européen garde la partie positive et la probabilité',3)])+tail('Prix day-ahead France, été 2025, heures 11 h à 16 h · inégalité de Jensen','Voici la distribution réelle des prix l’été 2025 entre 11 heures et 16 heures. Plus de la moitié des heures sont à zéro ou en dessous, en rouge. Le prix moyen est de 8 euros. Mais avec un arrêt, le parc touche le maximum entre le prix et zéro : en moyenne 11,4 euros. C’est l’inégalité de Jensen : la moyenne d’un maximum n’est pas le maximum de la moyenne. Une méthode qui raisonne sur un prix moyen rate cet effet.')
json.dump(C,open('charts_out.json','w'),ensure_ascii=False)
print(list(C))
# 7 ecarts : realised curt capture then forecasts by method
real={y:CD['capt_curt_s'][str(y)]*100 for y in CD['years'] if y!=2022}; real[2026]=73.9
F={'Décote passée':([88.4,88.4,88.4],GREY),'Forme forward':([81.3,81.1,79.7],BLUE),'Tendance de capacité':([72.3,70.4,68.7],SUN),'Simulation météo':([61.3,62.2,62.8],PURP),'Modèle européen':([65.4,50.9,48.7],RED)}
c=Chart(128,330,1080,560,2018.6,2029.4,40,105,pad=(110,20,270,50))
c.grid([40,60,80,100],lambda v:f'{v} %'); c.xticks(list(range(2019,2030)),str)
c.line([(y,real[y]) for y in sorted(real) if y>=2019],INK,1,5)
c.lab('réalisé',c.X(2019)-10,c.Y(real[2019])+14,140,'left',INK,1,24,600)
o=2
for n,(v,col) in F.items():
    c.line([(2026,real[2026])]+list(zip([2027,2028,2029],v)),col,o,4,'10 8')
    LY={'Décote passée':88.4,'Forme forward':79.7,'Tendance de capacité':70.5,'Simulation météo':59.8,'Modèle européen':48.7}[n]
    c.lab(n,c.X(2029)+16,c.Y(LY)-15,240,'left',col,o,24,600); o+=1
avg=[70.1,66.1,65.0]
c.line([(2026,real[2026])]+list(zip([2027,2028,2029],avg)),TEAL,o,8)
c.lab('moyenne : 65 %',c.X(2029)+16,c.Y(65.6)-15,250,'left',TEAL,o,24,600)
C['ecarts']=head('ecarts','Pourquoi elles divergent pour 2027–2029','Jusqu’à 40 points d’écart en solaire en 2029',True).replace('#0E151C','#F4F6F7').replace('color:#E8EEF2','color:#14212C').replace('#14D3A9','#0E8F73')+c.html()+side(1270,340,520,[('Capture solaire des heures payées (convention arrêt), pondérée par la production',1),('La décote passée reste figée : elle ne voit pas la tendance',2),('Le modèle européen voit le solaire allemand et espagnol s’ajouter',6),('40 points de capture ≈ <b>30 €/MWh</b> sur un forward à 84 €',7)])+tail('Réalisé 2019–2026 (2022 omise) puis prévision au 25/10/2026 · ppa_forecast.json','En noir, le réalisé en convention arrêt, jusqu’à 2026. Puis chaque méthode prolonge à sa façon. La décote passée remonte à 88 et reste plate : elle ne voit pas de tendance. La forme forward reste haute, son squelette est trop plat. La tendance de capacité descend doucement. La simulation météo et le modèle européen descendent fort, le second parce qu’il voit le solaire des voisins. En vert épais, la moyenne : 65 pour cent en 2029.')
# 8 annees : walk-forward error per year, solar curt
W=json.load(open('/home/ubuntu/PowerKlock/data/history/ppa_walkforward.json'))['fixed']['solar']['curt']
yrs=[2019,2020,2021,2023,2024,2025,2026]; xs={y:i for i,y in enumerate(yrs)}
c=Chart(128,330,1080,560,-0.4,6.4,0,16)
c.grid([0,4,8,12,16],lambda v:f'{v} €')
for y in yrs: c.lab(str(y),c.X(xs[y])-50,c.h-c.pb+8,100,'center')
ser=[('dashboard','Décote passée',GREY),('step','Tendance de capacité',SUN),('fpc','Forme forward',BLUE),('regional','Modèle européen',RED),('weather','Simulation météo',PURP)]
for n,(k,lab,col) in enumerate(ser):
    c.line([(xs[y],W[k][str(y)]) for y in yrs],col,1,3,None,True)
c.line([(xs[y],W['avg4'][str(y)]) for y in yrs],TEAL,2,8,None,True)
c.lab('moyenne des 4',c.X(6)-200,c.Y(W['avg4']['2026'])+10,200,'right',TEAL,2,26,600)
for k,lab,col in ser:
    best=[y for y in yrs if min(W[m][str(y)] for m,_,_ in ser)==W[k][str(y)]]
C['annees']=head('annees','Aucune méthode ne gagne tous les ans','Année par année, la gagnante change ; la moyenne gagne 4 années sur 7')+c.html()+side(1270,340,520,[('Erreur de chaque année au walk-forward, solaire, €/MWh',1),('Méthode seule la meilleure : européen (2019), forme forward (2020), météo (2021, 2024), européen (2023, 2025), capacité (2026)',1),('La moyenne des 4 bat toutes les méthodes seules en 2023, 2024, 2025 et 2026, et reste proche du meilleur avant',2),('Moyenne 2020–2026 : <b>3,5 €</b> contre 4,9 pour la meilleure méthode seule',2)])+tail('ppa_walkforward.json · convention arrêt · 2022 exclue','Voici chaque méthode, année par année. Les lignes fines se croisent sans arrêt : la meilleure change presque tous les ans. La ligne verte épaisse, la moyenne des quatre, bat toutes les méthodes seules de 2023 à 2026, justement les années où le solaire a changé le plus vite, et reste proche du meilleur avant. Sur la durée, c’est elle qui se trompe le moins.')
# 9 signes : signed errors 2024-2026 solar curt
L=json.load(open('/home/ubuntu/PowerKlock/data/history/ppa_lab.json'))['hybrid']['solar']['curt']
V=L['verdict']; E=L['ensemble']
meth=[('step','Capacité',SUN),('fpc','Forme fwd',BLUE),('regional','Européen',RED),('weather','Météo',PURP)]
c=Chart(128,330,1080,560,-0.5,2.5,-15,10)
c.grid([-15,-10,-5,0,5,10],lambda v:f'{"+" if v>0 else ""}{v} €')
for gi,y in enumerate(['2024','2025','2026']):
    c.lab(y,c.X(gi)-60,c.h-c.pb+8,120,'center',INK,0,26,600)
    for mi,(k,n,col) in enumerate(meth):
        xc=c.X(gi)+(mi-2)*46+23; c.bar(xc,0,V[k][y],38,col,1)
    xc=c.X(gi)+2*46+23+10; c.bar(xc,0,E[y]['eur'] if abs(E[y]['eur'])>0.15 else (0.15 if E[y]['eur']>=0 else -0.15),44,TEAL,2)
c.lab('↑ trop optimiste',c.w-c.pr-300,c.pt,300,'right',MUT,1); c.lab('↓ trop pessimiste',c.w-c.pr-300,c.Y(-12.5),300,'right',MUT,1)
legend=' · '.join(f'<span style="color:{col}">■</span> {n}' for _,n,col in meth)
C['signes']=head('signes','Pourquoi la moyenne marche','Les méthodes se trompent dans des sens opposés')+c.html()+f'<p style="position:absolute;left:198px;top:900px;width:1000px;font-size:24px;color:#4A5B69"{BI(1)}>{legend} · <span style="color:{TEAL}">■</span> moyenne des 4</p>'+side(1270,340,520,[('Erreur signée prévu − réalisé, solaire, années de verdict, €/MWh',1),('2026 : forme forward <b>+8,8</b>, simulation météo <b>−13,2</b>',1),('La moyenne des 4 : <b>−0,4</b>, <b>−0,1</b>, <b>−0,1</b> € : les erreurs s’annulent',2)])+tail('ppa_lab.json · verdict 2024–2026 · convention arrêt','Voilà le mécanisme de la moyenne. Pour chaque année de verdict, l’erreur signée de chaque méthode : au-dessus de zéro, trop optimiste ; en dessous, trop pessimiste. En 2026, la forme forward est trop optimiste de près de 9 euros, la simulation météo trop pessimiste de 13. La barre verte, la moyenne : quasiment zéro les trois années. Les erreurs se compensent parce que les méthodes viennent de familles différentes.')
# 10 fourchette band (ensemble, capture points)
BP=json.load(open('../bandpts.json'))
c=Chart(128,330,1080,560,-0.5,5.5,-6,6)
c.grid([-6,-3,0,3,6],lambda v:f'{"+" if v>0 else ""}{v} pts')
k=0
for tech,col in (('solar',SUN),('wind',BLUE)):
    for y in ('2024','2025','2026'):
        hw,e,ok=BP[tech][y]; d=-e
        xc=c.X(k); c.add(1,f'<rect x="{xc-40:.1f}" y="{c.Y(hw):.1f}" width="80" height="{c.Y(-hw)-c.Y(hw):.1f}" rx="6" fill="{col}" opacity="0.25"/>')
        c.add(2,f'<circle cx="{xc:.1f}" cy="{c.Y(d):.1f}" r="12" fill="{TEAL if ok else RED}"/>')
        c.lab(y,xc-50,c.h-c.pb+8,100,'center'); k+=1
c.lab('Solaire',c.X(1)-100,c.pt-4,200,'center',SUN,1,26,600); c.lab('Éolien',c.X(4)-100,c.pt-4,200,'center',BLUE,1,26,600)
C['fourchette']=head('fourchette','La fourchette','La fourchette de la moyenne a tenu 2 années sur 3 : trop étroite')+c.html()+side(1270,340,520,[('Bande à 80 % de la moyenne des 4, annoncée avant chaque année, et écart réalisé − prévu, en points de capture',1),('Vert : dans la bande ; rouge : dehors',2),('Solaire 2026 et éolien 2025 hors bande : à 80 %, on en attendrait 1 sur 5',2),('La méthode choisie par le protocole faisait pire : éolien <b>0 sur 3</b>',2),('L’erreur mensuelle a triplé depuis 2023 : caler la bande sur les erreurs récentes',2)])+tail('ppa_forecast.json (bande de la moyenne) · ppa_lab.json · convention arrêt','La fourchette, testée. Chaque barre est la bande à 80 pour cent de la moyenne des quatre, telle qu’on l’aurait annoncée avant l’année ; chaque point, l’écart réellement constaté. Deux années sur trois dedans, en solaire comme en éolien. À 80 pour cent on devrait rater une fois sur cinq, on rate une fois sur trois : sur trois années c’est fragile, mais ça va dans le sens d’une bande trop étroite, calée sur des années calmes.')
json.dump(C,open('charts_out.json','w'),ensure_ascii=False)
print(list(C))
