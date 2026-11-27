import functools, http.server, threading, json, sys
from playwright.sync_api import sync_playwright
ROOT='/home/claude/powerklock'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':1080,'height':1920},device_scale_factor=1); p=ctx.new_page()
    p.goto(f'http://127.0.0.1:{srv.server_port}/reel.html?once&r=jour&d=2026-11-27')
    p.wait_for_function('window.REEL_MS',timeout=30000)
    import time; t0=time.time()
    n,ms=p.evaluate('[window.REEL_SCENES, window.REEL_MS]'); print('scenes',n,'ms',ms)
    p.screenshot(path='shots/audit_00.png')
    info=p.evaluate('''()=>[...document.querySelectorAll("#scenes .scene")].map(s=>{const c=s.cloneNode(true);c.querySelectorAll("svg").forEach(n=>n.remove());return c.textContent.replace(/\\s+/g," ").trim().slice(0,260)})''')
    for i,t in enumerate(info): print(i,len(t.split()),t)
    marks=[0.5,1,2.5,5]+[ms/1000*f for f in (0.2,0.35,0.5,0.65,0.8,0.95)]
    for i,m in enumerate(marks):
        d=m-(time.time()-t0)
        if d>0: p.wait_for_timeout(d*1000)
        p.screenshot(path=f'shots/audit_{i+1:02d}_{m:.1f}s.png')
    b.close()
