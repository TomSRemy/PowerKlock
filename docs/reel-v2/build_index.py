import json
emb = lambda ks: ''.join('<script type="application/json" data-mock="%s">%s</script>\n' % (k, json.dumps(open(k + '.html').read()).replace('</', '<\\/')) for k in ks)
t = open('index.tpl').read().replace('__DUOCSS__', open('duo_css.txt').read()).replace('__DUO__', open('duo_html.txt').read()).replace('__PAGEJS__', open('page_js.txt').read())
open('index.html', 'w').write(t.replace('__MOCKS__', emb(['A', 'B', 'C', 'R1', 'R2'])))
# duo.html: the same head and styles, only the two linked reels
head, rest = t.split('<main>')[0], t.split('<main>')[1]
sec = rest[rest.index('<h2>4 · Deux reels liés</h2>'):rest.index('<h2>5 · Recommandation</h2>')].replace('<h2>4 · Deux reels liés</h2>', '<h2>La démonstration</h2>')
tail = rest[rest.index('<footer>'):]
main = '''<main>
<span class="eyebrow">Reel du matin · duo</span>
<h1>Deux reels, un seul mouvement.</h1>
<p class="lead">La courbe du jour se défait en 96 points, un par quart d'heure. Ils quittent le premier reel et entrent dans le second pour former l'horloge des prix. Données du vendredi 27 novembre 2026, zone France.</p>
'''
open('duo.html', 'w').write(head.replace('<title>Reel PowerKlock v2</title>', '<title>Reels liés PowerKlock</title>') + main + sec + tail.replace('__MOCKS__', emb(['R1', 'R2'])))
import os; print(os.path.getsize('index.html'), os.path.getsize('duo.html'))
