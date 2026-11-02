"""Charts of part 2 (the supplier) for the training deck, in the deck's colours. Real data: monthly French day-ahead 2025
(PowerKlock bilan), Cal 2025 traded in 2024 (Y+1 forward, PowerKlock warehouse), load-weighted price 2025 (RTE load × day-ahead)."""
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
INK='#2b2f36'; TEAL='#179C9B'; BLUE='#3B6FB6'; LBLUE='#7FB3E0'; RED='#C8463C'; GREY='#9AA3AE'; NAVY='#24387A'; AMBER='#E0A030'
plt.rcParams.update({'font.size':12,'axes.edgecolor':'#b9bcc2','axes.labelcolor':INK,'xtick.color':INK,'ytick.color':INK,'font.family':'DejaVu Sans'})
O='/tmp/coupl/p2/'
def clean(ax):
    for s in ('top','right'): ax.spines[s].set_visible(False)
# 1 · fixed price vs monthly spot, 2025
spot={'janv.':102.27,'févr.':122.66,'mars':76.8,'avr.':42.21,'mai':19.38,'juin':40.74,'juil.':57.98,'août':54.44,'sept.':34.81,'oct.':57.53,'nov.':59.13,'déc.':68.73}
FIX=63.77
f,ax=plt.subplots(figsize=(8.4,5.6))
ks=list(spot); v=list(spot.values())
ax.bar(ks,v,.66,color=[RED if x>FIX else LBLUE for x in v])
for i,x in enumerate(v): ax.text(i,x+2,f'{x:.0f}',ha='center',fontsize=10.5,color=INK)
ax.axhline(FIX,color=NAVY,lw=2.2,ls='--'); ax.text(7.5,92,f'prix fixe : Cal 2025\nacheté en 2024, {FIX:.1f} €'.replace('.',','),ha='center',fontsize=11.5,color=NAVY,fontweight='bold'); ax.annotate('',xy=(7.5,FIX+1.5),xytext=(7.5,86),arrowprops=dict(arrowstyle='->',color=NAVY,lw=1.3))
ax.set_ylabel('€/MWh'); ax.set_ylim(0,135); clean(ax); ax.yaxis.grid(True,color='#ececef'); ax.set_axisbelow(True)
plt.tight_layout(); plt.savefig(O+'c_fixed.png',dpi=180,facecolor='white'); plt.close()
# 2 · shaping waterfall, 2025
def waterfall(steps, total_lab, fn, unit='€/MWh', ylim=None, w=8.4, h=5.4, note=None):
    f,ax=plt.subplots(figsize=(w,h)); x=0; cum=0; labs=[]
    for i,(lab,val,kind) in enumerate(steps):
        if kind=='base':
            ax.bar(i,val,.6,color=NAVY); cum=val; ax.text(i,val+1,f'{val:.2f}'.replace('.',','),ha='center',fontsize=12,fontweight='bold')
        elif kind=='step':
            ax.bar(i,val,.6,bottom=cum,color=RED if val>0 else TEAL); ax.text(i,cum+val+1,('+' if val>0 else '')+f'{val:.2f}'.replace('.',','),ha='center',fontsize=12,color=RED if val>0 else TEAL,fontweight='bold')
            ax.plot([i-1+.3,i-.3],[cum,cum],color=GREY,lw=1,ls=':'); cum+=val
        elif kind=='ill':
            ax.bar(i,val,.6,bottom=cum,color='white',edgecolor=GREY,hatch='///',lw=1); ax.text(i,cum+val+1,'+ '+lab.split('\n')[1] if '\n' in lab else '',ha='center',fontsize=10,color=GREY)
            ax.plot([i-1+.3,i-.3],[cum,cum],color=GREY,lw=1,ls=':'); cum+=val
        else:
            ax.bar(i,cum,.6,color=TEAL); ax.text(i,cum+1,f'{cum:.2f}'.replace('.',','),ha='center',fontsize=12,fontweight='bold',color=TEAL)
            ax.plot([i-1+.3,i-.3],[cum,cum],color=GREY,lw=1,ls=':')
        labs.append(lab)
    ax.set_xticks(range(len(steps))); ax.set_xticklabels(labs,fontsize=10.5); ax.set_ylabel(unit)
    if ylim: ax.set_ylim(*ylim); ax.text(.99,.99,f'axe à partir de {ylim[0]} €',transform=ax.transAxes,ha='right',va='top',fontsize=9.5,color=GREY)
    clean(ax); ax.yaxis.grid(True,color='#ececef'); ax.set_axisbelow(True)
    plt.tight_layout(); plt.savefig(O+fn,dpi=180,facecolor='white'); plt.close()
waterfall([('Prix base\n(spot moyen)',61.08,'base'),('Forme\nsaisonnière',3.88,'step'),('Forme\ninfra-mensuelle',1.77,'step'),('Prix payé par\nle profil',0,'tot')],'', 'c_shape.png', ylim=(55,69))
# 3 · the energy part of a fixed price, real 2025 figures
waterfall([('Commodité base\n(Cal 2025)',63.77,'base'),('Coût de forme\n(profil France)',5.65,'step'),('Coût énergie\ndu profil',0,'tot')],'', 'c_stack.png', ylim=(55,73), w=7.0, h=5.6)
# 4 · ABC indexed products, drawn as timelines (not to scale)
f,ax=plt.subplots(figsize=(8.6,4.8))
rows=[('101',[('achat','mois M-1',0,4,LBLUE),('livraison','mois M',4,8,NAVY)]),('103',[('achat','mois M-1',0,4,LBLUE),('livraison','trimestre suivant',4,12,NAVY)]),
      ('12012',[('achat','12 mois',0,8,LBLUE),('livraison','12 mois suivants',8,16,NAVY)])]
for r,(code,segs) in enumerate(rows):
    y=2-r
    ax.text(-.5,y,code,ha='right',va='center',fontsize=16,fontweight='bold',color=TEAL)
    for lab,sub,a,b,c in segs:
        ax.add_patch(FancyBboxPatch((a+.08,y-.32),b-a-.16,.64,boxstyle='round,pad=0,rounding_size=.18',fc=c,ec='none'))
        ax.text((a+b)/2,y+.08,lab,ha='center',va='bottom',fontsize=11,fontweight='bold',color='white' if c==NAVY else INK)
        ax.text((a+b)/2,y-.04,sub,ha='center',va='top',fontsize=10,color='white' if c==NAVY else INK)
ax.set_xlim(-2.6,16.2); ax.set_ylim(-.75,2.5); ax.axis('off')
ax.text(-2.6,-.7,'Code A·B·C : A = mois d’achat · B = mois d’écart · C = mois de livraison (schéma non à l’échelle)',fontsize=10.5,color='#5d636d')
plt.tight_layout(); plt.savefig(O+'c_abc.png',dpi=180,facecolor='white'); plt.close()
print('ok')
