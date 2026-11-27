import json
H = '''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>PowerKlock · reel %s</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700;800&family=Inter:wght@500;600;800&display=swap" rel="stylesheet">
<style>
%s</style>
</head>
<body>
<script id="data" type="application/json">%s</script>
<div id="stage">
%s
</div>
</body>
</html>
'''
css, js, data = open('common.css').read(), open('common.js').read(), open('data.json').read()
duo = open('duo_common.js').read()
for k in ['A', 'B', 'C', 'R1', 'R2']:
    body = open(k + '.body').read()
    # the styles go to the head, the scenes and the script stay in the stage (the script after it would be cleaner, but the stage only reads its children by id)
    html = H % (k, css, data, body.replace('__COMMON__', js).replace('__DUO__', duo))
    open(k + '.html', 'w').write(html)
    print(k, len(html))
