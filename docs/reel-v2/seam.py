# the junction: at the same moment of the passage, a dot leaving reel 1 must be exactly one frame further than in reel 2
import sys
from playwright.sync_api import sync_playwright
from PIL import Image
B='/tmp/claude-0/-home-claude-powerklock/ac85222e-6d80-5747-b2cc-df2dfb29b18e/scratchpad/reel-v2/'
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':1080,'height':1920}); p1=ctx.new_page(); p2=ctx.new_page()
    for d,(ox,oy) in (('right',(1080,0)),('down',(0,1920))):
        q='?dir=down' if d=='down' else ''
        p1.goto('file://'+B+'R1.html'+q); p2.goto('file://'+B+'R2.html'+q)
        for p in (p1,p2): p.wait_for_function('window.REEL_MS'); p.wait_for_timeout(500)
        worst=0
        for tau in range(0,1601,50):
            a=p1.evaluate(f'PK_DOTS(PK_TX+{tau})'); c=p2.evaluate(f'PK_DOTS({tau})')
            worst=max(worst,max(max(abs(x[0]-ox-y[0]),abs(x[1]-oy-y[1]),abs(x[2]-y[2])) for x,y in zip(a,c)))
        e=p1.evaluate('PK_DOTS(REEL_MS)'); s=p2.evaluate('PK_DOTS(0)'); z=p2.evaluate('PK_DOTS(REEL_MS)')
        inside=lambda L: sum(1 for x in L if -14<x[0]<1094 and -14<x[1]<1934)
        print(d,'max gap px',round(worst,6),'| dots still in frame: end R1',inside(e),'start R2',inside(s),'end R2',inside(z))
        tau=700
        p1.evaluate(f'window.PK_FREEZE=PK_TX+{tau}'); p2.evaluate(f'window.PK_FREEZE={tau}'); p1.wait_for_timeout(150); p2.wait_for_timeout(150)
        p1.screenshot(path=B+'shots/seam1.png'); p2.screenshot(path=B+'shots/seam2.png')
        i1,i2=Image.open(B+'shots/seam1.png'),Image.open(B+'shots/seam2.png')
        W=Image.new('RGB',(2160,1920) if d=='right' else (1080,3840)); W.paste(i1,(0,0)); W.paste(i2,(1080,0) if d=='right' else (0,1920))
        W.resize((W.width//2,W.height//2) if d=='right' else (W.width//3,W.height//3)).save(B+f'shots/seam_{d}.png')
    b.close()
