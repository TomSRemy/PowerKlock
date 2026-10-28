"""Update of the PPA methods deck after the 27 Oct. review and the night of 27-28 Oct.
Runs on project/ after gen4.py (or alone): rewrites some slides, adds new ones, updates deck.json.
Figures: pricer on the forwards of 27 Oct. (switch branch, quoted months), scripts/ppa_horizon_test.py,
ppa_storage_sensitivity.py, ppa_mc_stability.py, ppa_forward_shape_test.py, ppa_fpc_variants.py."""
import json, os, re
src = open('gen.py').read()
exec(src[:src.index('S={}')])          # helpers: sec, card, row, para, table, D, L
_table, _card = table, card
def table(*a, **k):
    return _table(*a, **k).replace('width:1664px', 'width:100%')
def card(*a, **k):
    return _card(*a, **k).replace('flex:1;', 'flex:1;min-width:0;')
P = 'project/slides/'
H = '/home/ubuntu/PowerKlock/.claude/worktrees/bridge-cse_019SBz1eD5ytFRZxqbyv9hcG/data/history/'
fr = lambda v, d=2: f'{v:,.{d}f}'.replace(',', ' ').replace('.', ',').replace('-', '−')
S = {}
G = '#0E8F73'; RD = '#ED6965'; AM = '#C98A12'; BL = '#2F6FB0'; MU = '#6B7C89'

# ── cover ────────────────────────────────────────────────────────────────
S['cover'] = f'''<section id="cover" data-transition="fade" style="background:{D};color:#E8EEF2;font-family:'IBM Plex Sans', Arial, sans-serif;padding:160px 128px;display:flex;flex-direction:column;justify-content:center;gap:40px">
<p style="font-size:26px;letter-spacing:4px;text-transform:uppercase;color:#14D3A9;font-weight:600">Pricing PPA · revue complète des méthodes</p>
<h1 style="font-family:'Space Grotesk', Arial, sans-serif;font-size:96px;font-weight:700;line-height:1.05;color:#F3F6F8">Comment on price un PPA solaire ou éolien, méthode par méthode</h1>
<p style="font-size:32px;color:#BFD0DB">Mise à jour du 28 octobre 2026 : les décisions de la séance du 27, les tests de la nuit, le niveau du forward lu au mois</p>
<aside>Version mise à jour après notre séance du 27 octobre. Les diapos marquées « nouveau » ou « mis à jour » reprennent vos décisions et les tests faits depuis ; le reste n’a pas bougé.</aside>
</section>
'''

# ── what changed since the 27th ──────────────────────────────────────────
ok, done, todo, wait = f'<b style="color:{G}">en ligne</b>', f'<b style="color:{G}">fait</b>', f'<b style="color:{AM}">à valider</b>', f'<b style="color:{BL}">décidé, à date</b>'
S['maj'] = sec('maj', False, 'Nouveau · depuis la séance du 27 octobre', 'Ce qui est fait, ce qui reste à trancher',
  table(['Sujet', 'Ce qui change', 'État'], [
    ['Prix publié (benchmark)', 'Moyenne des 4 méthodes, modèle européen compris ; historique recalculé et marqué', wait + ' ~15 nov.'],
    ['Décote P74', 'Gardée comme repère, « non utilisable pour pricer », hors de la moyenne', ok],
    ['Noms des méthodes', 'Décote P74 · tendance de capacité · forme forward · modèle européen · simulation météo', ok],
    ['Modèle européen', 'Visible dans le pricer, non coché jusqu’à la bascule ; ses valeurs sont enregistrées chaque jour', ok],
    ['Stress « crise du gaz 2022 »', 'Par technologie, tiré de l’historique : solaire −16 pts, éolien +9 pts (avant : −5 pour les deux)', ok],
    ['Niveau du forward', 'Lu mois par mois pour toutes les méthodes, comme le reste de l’outil (diapos 13–14)', todo],
    ['Monte Carlo', '300 tirages par mois au lieu de 100 : P10–P90 stables à ±0,5 € (6 min de calcul au lieu de 4,5)', done],
    ['Diapo 2022', 'Construite à partir de la maquette validée (diapo 9)', done],
  ], [24, 60, 16], size=24),
  'Détail des décisions : docs/discussion/decisions.md · tests : scripts/ppa_*.py',
  'Le tableau de bord de ce qui a bougé depuis la séance. En vert ce qui est déjà sur le site, en bleu ce qui est décidé et attend sa date, en orange ce que je vous propose et qui attend votre accord. Le point nouveau, c’est la ligne du niveau du forward : on y vient dans la partie 1.')

# ── the decomposition, on the forwards of 27 Oct. ────────────────────────
def waterfall(items, vmax, w=1100, h=560, x0=110):
    """items: (label, value, kind) kind = 'total' | 'delta'; returns an svg"""
    n = len(items); bw = (w - x0 - 20) / n * 0.62; gap = (w - x0 - 20) / n
    y = lambda v: 500 - v / vmax * 480
    out = [f'<svg aria-label="graphique" width="{w}" height="{h}" viewBox="0 0 {w} {h}" style="position:absolute;left:128px;top:330px;width:{w}px;height:{h}px">']
    for t in range(0, int(vmax) + 1, 30):
        out.append(f'<line x1="{x0}" y1="{y(t):.1f}" x2="{w - 20}" y2="{y(t):.1f}" stroke="#D6DEE4" stroke-width="2"/><text x="{x0 - 14}" y="{y(t) + 8:.1f}" font-size="22" text-anchor="end" fill="{MU}">{t} €</text>')
    run = 0
    for i, (lab, v, kind) in enumerate(items):
        xc = x0 + gap * i + gap / 2; xl = xc - bw / 2
        if kind == 'total':
            top, bot, col = v, 0, ('#5B6B78' if i == 0 else G); run = v
        else:
            top, bot = (run + v, run) if v > 0 else (run, run + v); col = BL if v > 0 else '#C2412D'; run += v
        out.append(f'<rect x="{xl:.1f}" y="{y(top):.1f}" width="{bw:.1f}" height="{max(2, y(bot) - y(top)):.1f}" rx="4" fill="{col}"/>')
        out.append(f'<text x="{xc:.1f}" y="{y(top) - 12:.1f}" font-size="24" font-weight="600" text-anchor="middle" fill="#14212C">{("+" if kind == "delta" and v > 0 else "") + fr(v)}</text>')
        for j, part in enumerate(lab.split('|')):
            out.append(f'<text x="{xc:.1f}" y="{530 + j * 24}" font-size="20" text-anchor="middle" fill="{MU}">{part}</text>')
    out.append('</svg>')
    return ''.join(out)

wf = waterfall([('Forward|Cal 27–29', 86.13, 'total'), ('Forme non|captée', 62.16 - 86.13, 'delta'), ('Valeur|captée', 62.16, 'total'),
                ('Prime de|risque', -5.10, 'delta'), ('Écarts', -2.38, 'delta'), ('GO', 1.84, 'delta'), ('Marge', -1.00, 'delta'), ('Tendance de|capacité', 55.52, 'total')], 95)
side = ('<div style="position:absolute;left:1290px;top:330px;width:500px;display:flex;flex-direction:column;gap:22px">'
        + para('Le forward est lu <b>mois par mois</b> : facteur des mois cotés k = 0,988 (2027), 1,026 (2028), 1 (2029, rien de coté sous le Cal).', 26)
        + para('Le solaire capte 72 % du forward : 23,97 € perdus à cause de sa forme.', 26)
        + para(f'<b>Prix publié à partir de la bascule</b> : moyenne des 4 méthodes, <b>47,45 €</b> (tendance 55,52 · forme forward 45,59 · météo 45,89 · européen 42,81).', 26)
        + para('Éolien : tendance 79,14 €, moyenne des 4 81,64 €.', 24, MU) + '</div>')
S['decompo'] = f'''<section id="decompo" data-transition="fade" style="background:{L};color:#14212C;font-family:'IBM Plex Sans', Arial, sans-serif;padding:120px 128px 160px;display:flex;flex-direction:column;gap:28px">
<p style="font-size:24px;letter-spacing:3px;text-transform:uppercase;color:{G};font-weight:600">Mis à jour · décomposer un prix</p>
<h2 style="font-family:'Space Grotesk', Arial, sans-serif;font-size:56px;font-weight:700;line-height:1.1;color:#14212C">Le prix du PPA = forward × capture, puis les ajustements</h2>
{wf}{side}
<p style="position:absolute;left:128px;bottom:64px;font-size:22px;color:{MU}">Solaire, PPA 2027–2029, forwards du 27/10/2026, pricer par défaut (arrêt aux prix ≤ 0), niveau au mois · €/MWh</p>
<aside>La même décomposition que la dernière fois, avec les forwards du 27 et le niveau lu au mois. On part du forward Cal pondéré par la production, 86 euros. Le solaire n’en capte que 72 % : 24 euros partent à cause de sa forme. On retire ensuite la prime de risque du Monte Carlo, 5 euros, les écarts, on ajoute la GO, on retire la marge : 55,52 pour la tendance de capacité seule. Le prix publié après la bascule sera la moyenne des quatre méthodes, 47,45 euros.</aside>
</section>
'''

# ── the level month by month ─────────────────────────────────────────────
pw = [['Solaire 2027', '120,30', '112,96 (0,94)', '114,74 (0,95)'], ['Solaire 2028', '70,72', '71,22 (1,01)', '69,97 (0,99)'],
      ['Éolien 2027', '120,30', '134,93 (1,12)', '128,83 (1,07)'], ['Éolien 2028', '70,72', '82,23 (1,16)', '75,76 (1,07)'],
      ['2029 (Cal seul coté)', '62,51', '= forme historique', '']]
S['niveau_mois'] = sec('niveau_mois', False, 'Nouveau · le cadre commun, appliqué partout', 'Le forward vu par un parc n’est pas le Cal',
  row(card('Forward pondéré par la production, €/MWh', [table(['', 'Cal', 'Mois cotés', 'Cal × forme historique'], pw, [30, 16, 28, 26], size=23)], top=BL),
      card('Ce qu’on a trouvé', ['Le cadre commun (diapo 11) dit : <b>niveau du mois × forme du mois</b>. Le reste de l’outil le fait : pricer court terme, éventail de capture, page du matin.',
                                 'Dans le pricer long terme, <b>forme forward</b> et <b>simulation météo</b> lisent les mois cotés ; <b>tendance de capacité</b> et <b>décote P74</b> prenaient le Cal plat ; le <b>modèle européen</b> le Cal × la forme historique.',
                                 'Le marché cote cet hiver une prime d’hiver 2027 très forte (janvier 210 €, mai 64 €) : l’éolien, qui produit l’hiver, vaut 12 % de plus que le Cal.'], top=AM)),
  'Mois cotés : SEFE, dernières clôtures (mois, sinon trimestre, saison, puis Cal découpé par l’historique) · data/history/fr_forward_monthly.json · scripts/ppa_forward_shape_test.py',
  'Votre remarque d’hier soir était juste. Notre cadre commun dit que le niveau se lit au mois, et c’est ce que fait le reste de l’outil. Mais dans le pricer, deux méthodes sur quatre prenaient le Cal plat. Or le marché cote 2027 avec une énorme prime d’hiver : un MWh éolien, qui tombe surtout l’hiver, vaut 12 % de plus que le Cal ; un MWh solaire 6 % de moins.')

bt = json.load(open(H + 'ppa_forward_shape_test.json'))['backtest']
btr = [[str(r['year']), fr(r['errHistorical'] * 100, 1), fr(r['errQuoted'] * 100, 1), fr(w['errHistorical'] * 100, 1), fr(w['errQuoted'] * 100, 1)]
       for r in bt if r['tech'] == 'solar' for w in bt if w['tech'] == 'wind' and w['year'] == r['year']]
mae = lambda t, k: sum(abs(r[k]) for r in bt if r['tech'] == t) / len([r for r in bt if r['tech'] == t]) * 100
btr.append(['Erreur moyenne', f'<b>{fr(mae("solar", "errHistorical"), 1)}</b>', fr(mae('solar', 'errQuoted'), 1), f'<b>{fr(mae("wind", "errHistorical"), 1)}</b>', fr(mae('wind', 'errQuoted'), 1)])
S['niveau_test'] = sec('niveau_test', True, 'Nouveau · mois cotés ou forme historique ?', 'Une prévision moins bonne, mais le prix auquel on se couvre',
  row(card('Comme prévision de la forme saisonnière', [table(['Année', 'Solaire hist.', 'Solaire cotés', 'Éolien hist.', 'Éolien cotés'], btr, [26, 18, 19, 18, 19], size=22),
                                                        'Erreur du facteur saisonnier, points (trimestres cotés au 4e trimestre de l’année d’avant) : l’historique prévoit mieux, surtout après la crise (2023).'], True, RD),
      card('Comme prix', ['Les mois cotés sont <b>ce qu’un acheteur peut verrouiller aujourd’hui</b> en se couvrant mois par mois : c’est la valeur de marché du profil.',
                          'Correction : facteur k par année = valeur sur les mois cotés ÷ valeur sur le Cal avec la forme historique (portée par la capture annuelle).',
                          'Effet aujourd’hui sur la moyenne des 4 : <b>solaire 47,34 → 47,45 €</b>, <b>éolien 80,36 → 81,64 €</b>.',
                          '<b>Proposition</b> : mois cotés partout, appliqués le jour de la bascule (une seule rupture de la série publiée). À valider.'], True, '#14D3A9')),
  'scripts/ppa_forward_shape_test.py (trimestres SEFE 2023–2026) · pricer, branche de bascule, forwards du 27/10',
  'J’ai testé les deux lectures. Comme prévision, les trimestres cotés font moins bien que l’historique : la prime de risque du marché se trompe, surtout en 2023. Mais un PPA est un prix de marché : ce qu’on peut verrouiller aujourd’hui, ce sont les mois cotés. Je propose donc de lire les mois cotés partout, et de le faire le même jour que la bascule vers la moyenne des quatre, pour que la série publiée ne saute qu’une fois. Les écarts sont faibles en solaire, d’un peu plus d’un euro en éolien.')

# ── 2022: correlation break ──────────────────────────────────────────────
Y = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
SEA = [0.927, 0.892, 0.994, 0.945, 0.932, 0.885, 1.080, 0.969, 0.878, 0.884]
HR = [1.031, 1.025, 1.022, 1.007, 1.000, 0.984, 0.969, 0.873, 0.739, 0.635]
def bars22():
    w, h, x0 = 1000, 470, 70; yv = lambda v: 420 - (v - 0.5) / 0.7 * 400
    o = [f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" style="width:{w}px;height:{h}px">']
    for t in (0.6, 0.8, 1.0, 1.2):
        o.append(f'<line x1="{x0}" y1="{yv(t):.1f}" x2="{w}" y2="{yv(t):.1f}" stroke="{"#9FB2C0" if t == 1.0 else "#D6DEE4"}" stroke-width="{3 if t == 1.0 else 2}"/><text x="{x0 - 10}" y="{yv(t) + 7:.1f}" font-size="20" text-anchor="end" fill="{MU}">{fr(t, 1)}</text>')
    gw = (w - x0) / len(Y)
    for i, yr in enumerate(Y):
        for j, (v, c) in enumerate(((SEA[i], AM), (HR[i], BL))):
            x = x0 + gw * i + 10 + j * (gw - 20) / 2; bw = (gw - 24) / 2
            top, bot = (yv(v), yv(1.0)) if v >= 1 else (yv(1.0), yv(v))
            o.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{bw:.1f}" height="{max(2, bot - top):.1f}" rx="3" fill="{c}" opacity="{1 if yr == 2022 else 0.75}"/>')
        o.append(f'<text x="{x0 + gw * i + gw / 2:.1f}" y="{452}" font-size="20" text-anchor="middle" fill="{"#14212C" if yr == 2022 else MU}" font-weight="{600 if yr == 2022 else 400}">{yr}</text>')
    o.append('</svg>')
    return ''.join(o)
def merit(title, sub, blocks, dem):
    tot = sum(v for _, v, _ in blocks); x = 0; seg = []
    for name, v, c in blocks:
        seg.append(f'<div style="width:{v / tot * 100:.1f}%;background:{c};color:#fff;font-size:17px;padding:6px 4px;text-align:center;white-space:nowrap;overflow:hidden">{name}</div>')
    return (f'<div style="display:flex;flex-direction:column;gap:8px"><p style="font-size:24px;font-weight:600">{title}</p><p style="font-size:19px;color:{MU}">{sub}</p>'
            f'<div style="position:relative;display:flex;border-radius:6px;overflow:hidden">{"".join(seg)}<div style="position:absolute;left:{dem:.0f}%;top:-6px;bottom:-6px;border-left:4px solid #14212C"></div></div></div>')
mo = (merit('Été 2025, midi', 'Beaucoup de solaire, nucléaire disponible : la demande est servie avant le gaz → prix ≈ 0, voire négatif',
            [('Solaire + éolien', 38, '#14A37F'), ('Nucléaire', 34, '#7A5FB0'), ('Hydro', 10, BL), ('Gaz', 18, '#C2412D')], 70)
      + merit('Été 2022, midi', 'Nucléaire au plus bas (corrosion), sécheresse, gaz très cher : même à midi il faut du gaz → prix fixé par le gaz',
              [('Solaire + éolien', 26, '#14A37F'), ('Nucléaire', 25, '#7A5FB0'), ('Hydro', 9, BL), ('Gaz', 40, '#C2412D')], 74))
S['crise2022'] = sec('crise2022', False, 'Nouveau · rupture de corrélation en crise', '2022 : l’année où le solaire a valu plus que la base',
  '<div style="display:flex;gap:48px">'
  + '<div style="display:flex;flex-direction:column;gap:10px">' + para('Capture solaire = <b style="color:' + AM + '">effet saison</b> × <b style="color:' + BL + '">effet heure</b> (1 = neutre)', 26) + bars22() + '</div>'
  + '<div style="flex:1;display:flex;flex-direction:column;gap:14px">'
  + para('<b>104,6 %</b> en 2022 (56,1 % en 2025) : le pic de prix de l’année est tombé en été (août : 492 € de base), quand le solaire produit le plus. Effet saison 1,080 × effet heure 0,969.', 22)
  + para('<b>Ordre de mérite</b> : les moyens sont appelés du moins cher au plus cher, le dernier fixe le prix de tous.', 22)
  + mo
  + para('Pour le pricing : un choc de <b>niveau saisonnier</b>, pas de la cannibalisation ; il reste un scénario de stress (règle 2022 unique). Corrélation production solaire / prix : +0,06 en 2022, −0,41 en 2025.', 21)
  + '</div></div>',
  'RTE éCO2mix (production horaire) · ENTSO-E (day-ahead France) · calcul PowerKlock, années complètes 2016–2025',
  'Pour quelqu’un qui découvre le sujet : en 2022, le solaire a capté plus que la moyenne du marché. Ce n’est pas parce que midi valait cher en soi : le pic de prix de l’année est tombé en été, quand le nucléaire était au plus bas et le gaz hors de prix. Il fallait du gaz même à midi, donc le gaz fixait le prix. On le décompose en deux effets : la saison a joué à plus 8 %, l’heure à moins 3 %. C’est un choc de niveau, pas de la cannibalisation, et c’est pour ça qu’on le garde en scénario de stress.')

# ── European model: what we learnt ───────────────────────────────────────
S['m4c'] = sec('m4c', False, 'Nouveau · méthode 4 · ce qu’on a appris depuis', 'Modèle européen : son bord plat n’est pas un bug, l’absence de stockage si',
  row(card('Le bord plat', ['Au-delà de la dernière tranche observée, la table garde la même valeur : elle lit le surplus <b>potentiel</b> (avant écrêtement) comme écrêté, ce qui est juste.',
                            'Toutes les queues testées perdent au walk-forward : queue bornée, solaire 2,35 → 2,97 € ; apprentissage France seule : 96 % des heures de surplus profond étaient des heures d’export à prix positif.'], top=G),
      card('La vraie limite : le stockage', [table(['Capture solaire, %', '0 GW', '10', '20', '40'], [['2026', '65,5', '67,4', '70,0', '77,4'], ['2028', '50,7', '52,5', '54,7', '60,6'], ['2030', '46,8', '48,5', '50,4', '55,2']], [36, 16, 16, 16, 16], size=23),
                                             'Batteries de 2 h ajoutées en France, Allemagne, Belgique, Espagne : +3 à +10 points ; éolien : moins de 2 points.'], top=AM),
      card('Ce que ça change', ['Pricée 1, 2 et 3 ans à l’avance, elle tient mieux que les méthodes de tendance à 3 ans (diapo 44).',
                                '<b>Proposé</b> : une trajectoire de stockage sourcée (RTE Bilan prévisionnel, NEP allemand) en <b>option</b>, pas par défaut.'], top=BL)),
  'scripts/ppa_tail_test.py, ppa_tail_walkforward.py, ppa_regional_clip_fix.py, ppa_storage_sensitivity.py',
  'Le 27, j’avais signalé un bug d’écrêtement dans le modèle européen. Après test, ce n’en est pas un : toutes les alternatives font moins bien. Sa vraie limite est ailleurs : il ne voit pas le stockage qui arrive. Avec 20 à 40 GW de batteries dans les quatre pays, la capture solaire de 2030 gagnerait 4 à 8 points. Ça vaut une trajectoire sourcée, en option.')

# ── horizon test ─────────────────────────────────────────────────────────
hs = [['Tendance de capacité', '0,99', '2,10', '4,69'], ['Forme forward', '5,30', '7,28', '9,54'], ['Simulation météo', '6,34', '4,49', '0,99'],
      ['Modèle européen', '2,35', '3,21', '2,93'], ['Moyenne des 3 (sans européen)', '0,85', '1,99', '4,37'], ['Moyenne des 4', '<b>0,31</b>', '<b>1,65</b>', '4,01']]
hw = [['Tendance de capacité', '2,64', '1,86', '4,16'], ['Forme forward', '2,80', '3,27', '3,35'], ['Simulation météo', '1,89', '2,71', '2,94'],
      ['Modèle européen', '6,71', '6,76', '3,82'], ['Moyenne des 3', '2,44', '2,02', '3,48'], ['Moyenne des 4', '2,19', '2,41', '2,59']]
S['horizon'] = sec('horizon', False, 'Nouveau · pricer 1, 2, 3 ans à l’avance', 'À l’horizon du benchmark, la moyenne des 4 tient le mieux',
  row(card('Solaire', [table(['Erreur, €/MWh', '1 an', '2 ans', '3 ans'], hs, [46, 18, 18, 18], hl=[5], size=23)], top=AM),
      card('Éolien', [table(['Erreur, €/MWh', '1 an', '2 ans', '3 ans'], hw, [46, 18, 18, 18], hl=[5], size=23)], top=BL))
  + para('Chaque année 2024–2026 pricée 1, 2 et 3 ans à l’avance avec les seules années connues alors (arrêt aux prix ≤ 0) : les tendances perdent en précision avec l’horizon, le modèle européen tient. Trois années seulement.', 23),
  'scripts/ppa_horizon_test.py · erreur absolue moyenne de la valeur du MWh, pondérée par la production',
  'C’est le test qui a fondé la décision du 27. Le benchmark couvre les trois années suivantes, donc il faut juger chaque méthode à un, deux et trois ans. En solaire, la moyenne des quatre est la meilleure à un et deux ans ; en éolien, elle reste à moins de 0,4 euro de la meilleure méthode seule. Ajouter le modèle européen améliore la moyenne partout en solaire.')

# ── decisions and next steps ─────────────────────────────────────────────
S['decisions'] = sec('decisions', False, 'Mis à jour · décisions', 'Ce qui est décidé, ce qui reste à trancher',
  table(['Sujet', 'Où on en est'], [
    ['1 · Prix de référence', 'Décidé : moyenne des 4 méthodes, partout le même jour, vers le 15 novembre (2 à 3 semaines d’historique de la moyenne des 4)'],
    ['2 · Décote P74', 'Décidé et en ligne : repère seulement'],
    ['3 · Règle 2022', 'Décidé : une seule règle, 2022 en stress ; l’éolien européen garde 2022'],
    ['<b>4 · Niveau au mois</b>', '<b>À trancher</b> : mois cotés pour toutes les méthodes, le jour de la bascule (proposé)'],
    ['<b>5 · Stockage</b>', '<b>À trancher</b> : quelle source pour la trajectoire (RTE Bilan prévisionnel, NEP) ; en option'],
    ['<b>6 · Prix à proposer</b>', '<b>À trancher</b> : P75 ou moyenne (solaire)'],
    ['7 · Arrêt aux prix négatifs', 'Décidé : paramètre de contrat à trois cas (total, partiel, aucun) ; « partiel » pas encore construit'],
  ], [26, 74], size=24),
  'docs/discussion/decisions.md',
  'Trois décisions sont prises et en place ou datées. Il en reste trois à trancher : le niveau au mois, que je viens de présenter, la source pour le stockage, et le prix à proposer en solaire, P75 ou moyenne, qui était déjà sur la table le 26.')

FPCRES = globals().get('FPCRES', 'Gain mesuré le 27 (−8 à −24 % d’erreur) ; test de confirmation en cours')
S['suite'] = sec('suite', True, 'Mis à jour · la suite', 'Les chantiers, par gain attendu',
  table(['#', 'Chantier', 'Où on en est'], [
    ['1', 'Forme forward : squelette récent et cannibalisation par saison', FPCRES],
    ['2', 'Niveau au mois pour toutes les méthodes', 'Prêt sur la branche de bascule ; à valider'],
    ['3', 'Trajectoire de stockage sourcée (option)', 'Effet mesuré : +3 à +10 pts de capture solaire ; source à choisir'],
    ['4', 'Arrêt partiel aux prix négatifs', 'Décidé ; à construire dans le pricer'],
    ['5', 'Monte Carlo unifié, module de sensibilité (tornade, Sobol)', 'Temps de calcul mesuré ; à construire'],
    ['6', 'Parc / régional / national, couche de risque', 'Attend les courbes de charge Selfee'],
  ], [6, 50, 44], size=24),
  'docs/discussion/pricer.md · backlog PowerKlock',
  'Le premier chantier est la forme forward : deux améliorations mesurées au walk-forward, je vous donne le résultat. Ensuite le niveau au mois, prêt, et le stockage. Le Monte Carlo unifié et la sensibilité complète sont les gros morceaux ; le parc et la couche de risque attendent les courbes Selfee.')

# write slides, small text edits, order
for k, v in S.items():
    open(P + k + '.html', 'w').write(v)
def edit(k, a, b):
    p = P + k + '.html'; s = open(p).read()
    if a in s: open(p, 'w').write(s.replace(a, b))
for k in ('m1a', 'm1h', 'm1b'):
    edit(k, 'Méthode 1 · « PPA Dashboard »', 'Méthode 1 · décote P74 (repère, pas pour pricer)')
    edit(k, '« PPA Dashboard »', 'décote P74')
edit('m5', '150 tirages → P10, P50, P90 par mois', '300 tirages suffisent : P10–P90 stables à ±0,5 € d’une graine à l’autre (27 ms par tirage) ; 20 000 ne servent qu’aux P1/P99')
d = json.load(open('project/deck.json')); o = d['order']
def put(k, after):
    if k in o: o.remove(k)
    o.insert(o.index(after) + 1, k)
put('maj', 'agenda'); put('crise2022', 'negatifs'); put('niveau_mois', 'decoupage'); put('niveau_test', 'niveau_mois')
put('m4c', 'm4b'); put('horizon', 'moyenne')
d['order'] = o; json.dump(d, open('project/deck.json', 'w'), ensure_ascii=False)
print(len(o), 'slides:', ' '.join(f'{i + 1}:{k}' for i, k in enumerate(o)))
