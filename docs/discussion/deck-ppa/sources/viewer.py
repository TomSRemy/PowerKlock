"""Standalone deck viewer: every slide in one HTML file, 1920×1080 scaled to the window, ← → keys, N for notes."""
import json, re, sys
d = json.load(open('project/deck.json')); out = sys.argv[1] if len(sys.argv) > 1 else 'deck.html'
faces = ''.join(f'<link href="{f["href"]}" rel="stylesheet">' for f in d['faces'].values())
sl = []
for k in d['order']:
    h = open(f'project/slides/{k}.html').read()
    h = re.sub(r'data-build-in="[^"]*"', '', h)
    sl.append(h)
page = f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{d["title"]}</title>{faces}
<style>html,body{{margin:0;height:100%;background:#0A1016;overflow:hidden}}#wrap{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}}
#c{{position:relative;width:1920px;height:1080px;transform-origin:center}}#c section{{position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;box-sizing:border-box;display:none!important}}
#c section.on{{display:flex!important}}#c h1,#c h2,#c h3,#c p{{margin:0}}#c table{{border-collapse:collapse;color:inherit}}#c th,#c td{{padding:.35em .6em;border-bottom:1px solid rgba(127,150,168,.35);vertical-align:top}}#c th{{font-weight:600}}
aside{{display:none}}#n{{position:fixed;left:0;right:0;bottom:0;background:rgba(10,16,22,.92);color:#E8EEF2;font:16px/1.45 'IBM Plex Sans',Arial;padding:10px 18px;display:none}}
#k{{position:fixed;right:12px;bottom:8px;color:#7F96A8;font:14px 'IBM Plex Mono',monospace}}</style></head><body><div id="wrap"><div id="c">{"".join(sl)}</div></div><div id="n"></div><div id="k"></div>
<script>const S=[...document.querySelectorAll('#c section')];let i=Math.max(0,Math.min(S.length-1,(+location.hash.slice(1)||1)-1));
function fit(){{const s=Math.min(innerWidth/1920,innerHeight/1080);document.getElementById('c').style.transform='scale('+s+')'}}
function go(j){{i=Math.max(0,Math.min(S.length-1,j));S.forEach((x,k)=>x.classList.toggle('on',k===i));document.getElementById('k').textContent=(i+1)+' / '+S.length;const a=S[i].querySelector('aside');document.getElementById('n').textContent=a?a.textContent:'';history.replaceState(null,'','#'+(i+1))}}
addEventListener('keydown',e=>{{if(['ArrowRight','PageDown',' '].includes(e.key))go(i+1);if(['ArrowLeft','PageUp'].includes(e.key))go(i-1);if(e.key==='n'||e.key==='N'){{const n=document.getElementById('n');n.style.display=n.style.display==='block'?'none':'block'}}}});
addEventListener('click',e=>go(i+(e.clientX>innerWidth/2?1:-1)));addEventListener('resize',fit);fit();go(i);</script></body></html>'''
open(out, 'w').write(page); print(out, len(page), len(sl))
