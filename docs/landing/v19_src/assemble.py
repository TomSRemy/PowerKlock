import re,subprocess,sys
R='/home/user/PowerKlock/'; S='/tmp/claude-0/-home-user-PowerKlock/7aef6827-b401-57d3-afb3-3a6d64007378/scratchpad/'
subprocess.run(['python3',S+'build/data.py',S+'build/pk.json'],check=True,stderr=subprocess.DEVNULL)
v4=open(R+'docs/landing/maquette_v4.html').read(); L=v4.split('\n')
imgs=re.findall(r'src="(data:image/png;base64,[^"]+)"',v4)
t=open(S+'build/tpl.html').read()
rep={'@@LOGO@@':imgs[0],'@@MARK@@':imgs[1],'@@NUMBERFLOW@@':L[396]+'\n'+L[397],'@@OGL@@':open(S+'lib/bg.min.js').read(),'@@PK@@':open(S+'build/pk.json').read(),'@@GEO@@':L[403],'@@APP@@':open(S+'build/app.js').read()}
assert L[396].startswith('<script>') and L[403].startswith('<script>window.PKGEO2')
for k,v in rep.items(): t=t.replace(k,v)
open(S+'powerklock-landing.html','w').write(t); print(len(t))
