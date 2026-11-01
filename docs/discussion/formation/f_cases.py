"""Training-deck versions of the coupling cases (one slide per case): same illustrative merit order as
docs/discussion/couplage/schema6.py, larger type, no title on the drawing (the slide carries it), labels that never
overlap, and a small bar chart of how often each case happened in France. Violet only for nuclear."""
import json, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
OUT='/tmp/coupl/form/'; SRC='/tmp/coupl/disc/docs/discussion/couplage/'
BLUE, VIOLET, AMBER, SAND, GREY, RED, INK = '#3b6fb6', '#7a5cc7', '#d99a1e', '#c9b48a', '#8a8f98', '#c8453a', '#22252b'
LOAD, LIM = 55, 10
def stack(res, nuc=45):
    x=0; out=[]
    for w,p0,p1,c,lab in ((res,-5,-5,BLUE,'Éolien + solaire'),(nuc,10,55,VIOLET,'Nucléaire'),(8,65,65,SAND,'Hydraulique'),(10,100,100,AMBER,'Gaz')):
        out.append((x,x+w,p0,p1,c,lab)); x+=w
    return out
ST=stack(15)
def price(q):
    for x0,x1,p0,p1,*_ in ST:
        if q<=x1: return p0+(p1-p0)*(q-x0)/max(x1-x0,1e-9)
    return 160.
P0=price(LOAD); NB={1:58,2:95,3:45,4:20}
def solve(pn):
    g=np.linspace(LOAD-LIM,LOAD+LIM,2001)
    if pn>=P0:
        w=[x for x in g if price(x)<=pn+1e-9]; q=max(w) if w else LOAD; return q,(pn if q<LOAD+LIM-1e-6 else price(q))
    w=[x for x in g if price(x)>=pn-1e-9]; q=min(w) if w else LOAD; return q,(pn if q>LOAD-LIM+1e-6 else price(q))
plt.rcParams.update({'font.size':12,'axes.edgecolor':'#b9bcc2','axes.labelcolor':INK,'xtick.color':INK,'ytick.color':INK})
BOX=dict(boxstyle='round,pad=.25',fc='white',ec='none',alpha=.9)
def fig(i):
    f,ax=plt.subplots(figsize=(8.2,5.0))
    for x0,x1,p0,p1,c,lab in ST:
        ax.fill_between([x0,x1],[-20,-20],[p0,p1],color=c,alpha=.85,lw=0,label=lab); ax.plot([x0,x1],[p0,p1],color=INK,lw=1.5)
    xe=ST[-1][1]; ax.plot([xe,xe,100],[100,160,160],color=INK,lw=1.4,ls=':')
    ax.axvline(LOAD,color=INK,lw=1.4); ax.text(LOAD+.8,158,'Consommation française',fontsize=11,color=INK,va='top',bbox=BOX)
    if i==0: q,p=LOAD,P0
    else:
        q,p=solve(NB[i]); pn=NB[i]
        ax.axhline(pn,color=GREY,lw=1.4,ls='--'); ax.text(99,pn+2.5,f'Prix des voisins : {pn} €',fontsize=11,color='#5d636d',ha='right',bbox=BOX)
        ax.axvspan(min(LOAD,q),max(LOAD,q),color=GREY,alpha=.15,lw=0)
        ax.axvline(q,color=RED,lw=1.3,ls='--'); ax.text(q+.8 if q>LOAD else q-.8,141,'Production française',fontsize=11,color=RED,ha='left' if q>LOAD else 'right',va='top',bbox=BOX)
        full=abs(abs(q-LOAD)-LIM)<1e-3
        ax.annotate('',xy=(q,-13),xytext=(LOAD,-13),arrowprops=dict(arrowstyle='->',color=INK,lw=1.6))
        lab=(f'export {q-LOAD:.0f} GW' if q>LOAD else f'import {LOAD-q:.0f} GW')+(' : lignes pleines' if full else f' (lignes : {LIM} GW)')
        ax.text(78 if q>LOAD else 22,-14,lab,fontsize=10.5,color=INK,ha='center',va='center',bbox=BOX)
        ax.plot([LOAD],[P0],'o',ms=10,mfc='white',mec=INK,mew=1.8,zorder=6)
        ax.text(LOAD+(1.2 if q<LOAD else -1.2),P0-9,f'seule : {P0:.0f} €',fontsize=10.5,color=INK,ha='left' if q<LOAD else 'right',bbox=BOX)
    ax.plot([q],[p],'o',ms=12,color=RED,mec='white',mew=2,zorder=7)
    up = i in (0,1,2)
    ax.text(q-1.5 if q<=LOAD else q-1.5, p+(9 if up else -14), f'prix France : {p:.0f} €',fontsize=13,color=RED,fontweight='bold',ha='right',bbox=BOX)
    ax.set_xlim(0,100); ax.set_ylim(-22,165)
    ax.set_xlabel('GW disponibles en France, rangés du moins cher au plus cher'); ax.set_ylabel('€/MWh')
    for s in ('top','right'): ax.spines[s].set_visible(False)
    h,l=ax.get_legend_handles_labels(); f.legend(h[:4],l[:4],loc='lower center',ncol=4,frameon=False,fontsize=11)
    plt.tight_layout(rect=(0,.06,1,1)); plt.savefig(OUT+f'fm_{i}.png',dpi=170,facecolor='white'); plt.close(); return q,p
RES={i:fig(i) for i in range(5)}
H=json.load(open(SRC+'cases_hist.json')); yh=sorted(H)
# drawn at their size on the slide (4.1 × 1.75 in) so the type keeps its real size
for k,c in (('exp_free','#3B6FB6'),('exp_sat','#7FB3E0'),('imp_free','#E0A030'),('imp_sat','#C8463C')):
    v=[H[y][k]['share']*100 for y in yh]
    f,ax=plt.subplots(figsize=(4.1,1.75)); ax.bar(range(len(yh)),v,.7,color=c)
    for i,x in enumerate(v):
        if x>=1: ax.text(i,x+max(v)*.04,f'{x:.0f}',ha='center',va='bottom',fontsize=10,color=INK,fontweight='bold' if x==max(v) else 'normal')
    ax.set_xticks(range(len(yh))); ax.set_xticklabels([("'"+y[2:]) if y!='2026' else "'26*" for y in yh],fontsize=9.5)
    ax.set_ylim(0,max(max(v)*1.3,10)); ax.set_yticks([]); ax.spines['left'].set_visible(False)
    ax.set_title('% du temps, chaque année', fontsize=10, loc='left', color='#5d636d')
    for s_ in ('top','right'): ax.spines[s_].set_visible(False)
    plt.tight_layout(pad=.3); plt.savefig(OUT+f'fh_{k}.png',dpi=220,facecolor='white'); plt.close()
json.dump({str(k):[round(v[0],1),round(v[1],1)] for k,v in RES.items()},open(OUT+'fm.json','w')); print(RES)
