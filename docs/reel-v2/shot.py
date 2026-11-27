import sys
from playwright.sync_api import sync_playwright
from PIL import Image
B='/tmp/claude-0/-home-claude-powerklock/ac85222e-6d80-5747-b2cc-df2dfb29b18e/scratchpad/reel-v2/'
jobs={'R1':[0,5500,8500,9900,10900,11300],'R2':[700,1100,1900,3000,5600,8000,9700,10900,12000]}
if len(sys.argv)>2: jobs={sys.argv[1]:[int(x) for x in sys.argv[3:]]}
lang=sys.argv[2] if len(sys.argv)>2 else 'fr'
import os
DIR=os.environ.get('DIR','')
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':1080,'height':1920},device_scale_factor=1); p=ctx.new_page()
    p.on('console',lambda m: print('console',m.type,m.text) if m.type in('error','warning') else None); p.on('pageerror',lambda e: print('ERR',e))
    for k,ts in jobs.items():
        if k not in jobs: continue
        p.goto('file://'+B+k+'.html?safe'+DIR+('#en' if lang=='en' else '')); p.wait_for_function('window.REEL_MS'); p.wait_for_timeout(700)
        ims=[]
        for t in ts:
            p.evaluate(f'window.PK_FREEZE={t}'); p.wait_for_timeout(120)
            f=B+f'shots/{k}_{lang}_{t}.png'; p.screenshot(path=f); ims.append(Image.open(f).resize((540,960)))
        W=Image.new('RGB',(540*len(ims),960))
        for i,im in enumerate(ims): W.paste(im,(i*540,0))
        W.save(B+f'shots/{k}_{lang}_sheet.png')
        # anything outside the safe box?
        print(k, p.evaluate('''()=>{const s=document.getElementById("stage").getBoundingClientRect(),k=s.width/1080,o=[];document.querySelectorAll("#stage *:not(.safe):not(.safe i):not(script):not(style)").forEach(e=>{if(e.children.length&&e.tagName!=="text"&&!["B","SPAN","DIV"].includes(e.tagName))return;const r=e.getBoundingClientRect();if(!r.width||getComputedStyle(e).opacity==="0")return;const x0=(r.left-s.left)/k,x1=(r.right-s.left)/k,y0=(r.top-s.top)/k,y1=(r.bottom-s.top)/k;if(x1>951||y0<268||y1>1537||x0<40)o.push(e.tagName+"#"+e.id+" "+[x0,y0,x1,y1].map(Math.round))});return o.slice(0,12)}'''))
    b.close()
