import json,glob,re,sys,os
R='/home/user/PowerKlock/'
v4=open(R+'docs/landing/maquette_v4.html').read().split('\n')
PK=json.loads(v4[402][len('<script>window.PK='):].split('</script>')[0].rstrip(';'))
days=sorted(glob.glob(R+'data/history/daily/2026-*.json'))
last=json.load(open(days[-1])); prev=json.load(open(days[-2]))
fr=last['zones']['FR']
PK['tom']=dict(date=last['date'],avg=fr['avg'],min=fr['min'],max=fr['max'],h=fr['hourly'],peak=fr.get('peakAvg'),off=fr.get('offAvg'))
ph=prev['zones']['FR']['hourly']; PK['prev_h']=[ph[int(i*len(ph)/96)] for i in range(96)]
PK['tod_avg']=prev['zones']['FR']['avg']; PK['prev_date']=prev['date']
old={e[0]:e for e in PK['eu']}
h24=lambda h:[round(sum(h[int(i*len(h)/24):int((i+1)*len(h)/24)])/max(1,len(h[int(i*len(h)/24):int((i+1)*len(h)/24)]))) for i in range(24)]
PK['eu']=sorted([[k,old[k][1],z['avg'],z.get('min'),z.get('max'),round(z['avg']-prev['zones'][k]['avg'],2) if prev['zones'].get(k,{}).get('avg') is not None else None, h24(z['hourly'])] for k,z in last['zones'].items() if z.get('avg') is not None],key=lambda e:-e[2])
nd=[]
for f in days:
    d=json.load(open(f)); z=d['zones'].get('FR') or {}
    nd.append([d['date'],z.get('negH') or 0, z.get('avg')])
PK['negD']=nd
tot=round(sum(x[1] for x in nd),1); assert abs(tot-PK['negYTD'])<0.2,(tot,PK['negYTD']); PK['negYTD']=tot
PK['negDays']=sum(1 for x in nd if x[1]>0)
m=json.load(open(R+'data/m0.json'))['months'][-13:]
PK['m0']=[[x['month'],x['base'],x['solarM0'],x['windM0'],x.get('complete',True)] for x in m]
c=json.load(open(R+'data/commodities.json'))['series']
PK['ttf']=[[p[0],p[1]] if isinstance(p,list) else [p['date'],p['value']] for p in c['ttf']['points'][-60:]]
p=c['eua']['points'][-1]; PK['eua']=p if isinstance(p,list) else [p['date'],p['value']]
n=json.load(open(R+'data/news.json'))
PK['news']=[[i['source'],i['title'],i['date'][:10]] for i in n['items'][:8]]
PK['newsN']=len(n['items']); PK['srcN']=len(n['sources'])
hist=[]
for f in days[-28:]:
    d=json.load(open(f)); h=(d['zones'].get('FR') or {}).get('hourly') or []
    if len(h)<24: continue
    hist.append([round(h[int(i*len(h)/96)]) for i in range(96)])
PK['hist']=hist[::-1]
pb=json.load(open(R+'data/history/ppa_benchmark.json'))['days']; pk=sorted(pb)[-183:]
PK['ppa']=dict(tenor=pb[pk[-1]].get('tenor'),days=[[k,(pb[k].get('solar') or {}).get('ppa'),(pb[k].get('wind') or {}).get('ppa'),1 if pb[k].get('rebuilt') else 0] for k in pk])
nav=open(R+'js/nav-v2.js').read()
blk=nav[nav.index('const R = {'):]; blk=blk[:blk.index('\n  };')]
routes=re.findall(r"^\s+'([a-z0-9/_-]+)':",blk,re.M)
PK['pagesN']=len([r for r in routes if 'forward' not in r])
print({k:(len(v) if isinstance(v,(list,dict)) else v) for k,v in PK.items()}, file=sys.stderr)
print(PK['eu'][:2],PK['m0'][-1],PK['ttf'][-1],PK['eua'],routes[:50],file=sys.stderr)
json.dump(PK,open(sys.argv[1],'w'),ensure_ascii=False,separators=(',',':'))
