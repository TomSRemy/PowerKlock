import json,subprocess
subprocess.run(['python3','gen3.py'],check=True,capture_output=True)
subprocess.run(['python3','charts.py'],check=True,capture_output=True)
C=json.load(open('charts_out.json'))
for k,v in C.items(): open(f'project/slides/{k}.html','w').write(v)
d=json.load(open('project/deck.json')); o=d['order']
if 'annees' not in o: o.insert(o.index('comparaison')+1,'annees')
if 'signes' not in o: o.insert(o.index('ensemble_th'),'signes')
d['order']=o; json.dump(d,open('project/deck.json','w'),ensure_ascii=False)
print(len(o))
