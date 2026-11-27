from playwright.sync_api import sync_playwright
B='/tmp/claude-0/-home-claude-powerklock/ac85222e-6d80-5747-b2cc-df2dfb29b18e/scratchpad/reel-v2/'
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w in (390,1280):
        p=b.new_page(viewport={'width':w,'height':900}); p.on('pageerror',lambda e: print('ERR',e))
        p.goto('file://'+B+'index.html'); p.wait_for_timeout(5000)
        print(w,'scrollW',p.evaluate('document.documentElement.scrollWidth'), 'frames', p.evaluate('[...document.querySelectorAll("iframe")].map(f=>!!f.contentWindow.REEL_MS)'))
        p.screenshot(path=B+f'shots/index_{w}.png',full_page=True)
    b.close()
