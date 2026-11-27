from playwright.sync_api import sync_playwright
from PIL import Image
B='/tmp/claude-0/-home-claude-powerklock/ac85222e-6d80-5747-b2cc-df2dfb29b18e/scratchpad/reel-v2/'
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w in (390,1280):
        p=b.new_page(viewport={'width':w,'height':1100}); p.on('pageerror',lambda e: print('ERR',e))
        p.goto('file://'+B+'duo.html'); p.wait_for_timeout(1500)
        print(w,'scrollW',p.evaluate('document.documentElement.scrollWidth'))
        if w==1280:
            ims=[]
            for M in (6000,10900,11200,14000,19000):
                p.evaluate(f'm0=performance.now()-{M}'); p.wait_for_timeout(250); f=B+f'shots/duo_{M}.png'; p.screenshot(path=f); ims.append(Image.open(f).resize((640,550)))
            W=Image.new('RGB',(640*3,1100));[W.paste(im,((i%3)*640,(i//3)*550)) for i,im in enumerate(ims)]; W.save(B+'shots/duo_sheet.png')
            p.click('[data-act="dir-right"]'); p.wait_for_timeout(900); p.evaluate('m0=performance.now()-10950'); p.wait_for_timeout(200); p.screenshot(path=B+'shots/duo_right.png')
        else: p.screenshot(path=B+'shots/duo_390.png',full_page=True)
    p=b.new_page(viewport={'width':1280,'height':900}); p.on('pageerror',lambda e: print('ERR',e)); p.goto('file://'+B+'index.html'); p.wait_for_timeout(3000)
    print('index scrollW',p.evaluate('document.documentElement.scrollWidth'),p.evaluate('[...document.querySelectorAll("iframe")].map(f=>!!f.contentWindow.REEL_MS)'))
    p.set_viewport_size({'width':390,'height':800}); p.wait_for_timeout(500); print('index 390',p.evaluate('document.documentElement.scrollWidth'))
    b.close()
