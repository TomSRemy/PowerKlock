#!/usr/bin/env python3
"""The morning e-mail: Today's quick look in an inbox, every weekday.

France spot today and tomorrow (or the PowerKlock forecast until the auction), the key prices with their
move on the day (Cal+1 France, TTF, EUA, Brent), the PPA benchmark, the hours at 0 € or below expected
tomorrow, three market-moving headlines, and a link to the site. Everything comes from the repository's
data files: no call to any service except the mail server.

Environment (GitHub secrets)
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_FROM   the same mail server as the alerts
  MORNING_TO        no longer used: only the readers who asked for it in the site get the newsletter
  MORNING_DRY_RUN=1 print the mail, send nothing

    python scripts/morning_mail.py
"""
import json
import re
import os
import smtplib
import sys
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data')
SITE = 'https://powerklock.com/'
PARIS = ZoneInfo('Europe/Paris')
DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']


def load(*p):
    try:
        with open(os.path.join(D, *p)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def n(v, d=1):
    return '–' if v is None else f'{v:,.{d}f}'.replace(',', ' ').replace('.', ',')


def s(v, d=1):
    return '–' if v is None else ('+' if v >= 0 else '−') + n(abs(v), d)


def frday(d):
    return f'{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]}'


def spot(d):
    j = load('history', 'daily', d.isoformat() + '.json')
    h = (((j or {}).get('zones') or {}).get('FR') or {}).get('hourly')
    if not isinstance(h, list) or not h:
        return None
    v = [x for x in h if x is not None]
    k = max(1, len(h) // 24)
    hourly = [sum(x for x in h[i * k:(i + 1) * k] if x is not None) / max(1, len([x for x in h[i * k:(i + 1) * k] if x is not None])) for i in range(24)]
    return {'base': sum(v) / len(v), 'peak': sum(hourly[8:20]) / 12, 'min': min(v), 'max': max(v), 'neg': sum(1 for x in hourly if x <= 0)}


def last_two(points):
    p = [x for x in points if x[1] is not None]
    return (p[-1], p[-2]) if len(p) >= 2 else (None, None)


def build():
    today = datetime.now(PARIS).date()
    rows, lines = [], []
    t, tm = spot(today), spot(today + timedelta(days=1))
    if t:
        rows.append(('Spot France aujourd’hui', f'{n(t["base"])} €/MWh', f'pointe {n(t["peak"])} · min {n(t["min"])} · max {n(t["max"])}' + (f' · {t["neg"]} h à 0 € ou moins' if t['neg'] else '')))
    if tm:
        rows.append(('Spot France demain', f'{n(tm["base"])} €/MWh', (s(tm['base'] - t['base']) + ' € vs aujourd’hui') if t else ''))
    else:   # no forecast figure: only published prices are announced
        rows.append(('Spot France demain', 'publié vers 13 h', ''))
    ch = load('history', 'fr_market_calchain.json') or {}
    y1 = str(today.year + 1)
    cy = ((ch.get('FR') or {}).get('years') or {}).get(y1)
    if cy:
        a, b = last_two(list(zip(cy['dates'], cy['values'])))
        if a:
            rows.append((f'Cal {y1[2:]} France', f'{n(a[1])} €/MWh', f'{s(a[1] - b[1])} € sur la séance'))
    cs = (load('history', 'commodities_series.json') or {}).get('series') or {}
    for k, name, u in (('ttf', 'Gaz TTF', '€/MWh'), ('eua', 'CO₂ EUA', '€/t'), ('brent', 'Brent', '$/b')):
        if k in cs:
            a, b = last_two(cs[k]['points'])
            if a:
                rows.append((name, f'{n(a[1])} {u}', f'{s((a[1] / b[1] - 1) * 100)} %'))
    bm = (load('history', 'ppa_benchmark.json') or {}).get('days') or {}
    if bm:
        ks = sorted(bm)
        last, prev = bm[ks[-1]], bm[[k for k in ks if k <= (date.fromisoformat(ks[-1]) - timedelta(days=7)).isoformat()][-1]] if len(ks) > 5 else None
        for tch, name in (('solar', 'PPA solaire'), ('wind', 'PPA éolien')):
            if last.get(tch):
                rows.append((name + ' (benchmark)', f'{n(last[tch]["ppa"], 2)} €/MWh', (s(last[tch]['ppa'] - prev[tch]['ppa'], 2) + ' € sur 7 jours') if prev and prev.get(tch) else ''))
    # the day's essentials from scripts/news_digest.py (on Monday, the week before); else the three most relevant articles
    dg = load('news_digest.json') or {}
    ed = dg.get('weekly') if today.weekday() == 0 and (dg.get('weekly') or {}).get('week') == (today - timedelta(days=today.weekday())).isoformat() else None
    heading = 'La semaine en 5 sujets' if ed else 'L’essentiel'
    ed = ed or (dg.get('daily') if (dg.get('daily') or {}).get('date') == today.isoformat() else None)
    if ed:
        for x in ed.get('items') or []:
            lines.append((x.get('text') or x.get('title') or '', x.get('link') or SITE, ' · '.join((x.get('sources') or [])[:2])))
        for p in ed.get('posts') or []:
            lines.append(('LinkedIn · ' + (p.get('author') or '') + (' : ' + p['note'] if p.get('note') else ''), p.get('url') or SITE, 'post'))
    else:
        heading = 'Dans l’actualité'
        news = sorted([i for i in ((load('news.json') or {}).get('items') or []) if (i.get('impact') or 0) >= 3], key=lambda i: -(i.get('impact') or 0))[:3]
        for i in news:
            lines.append((i.get('title') or '', i.get('link') or SITE, i.get('source') or ''))
    return today, rows, lines, heading


def render(today, rows, lines, heading='Dans l’actualité'):
    subject = f'PowerKlock · {frday(today)}' + (f' · spot {rows[0][1]}' if rows else '')
    text = '\n'.join(f'{a} : {b}  {c}' for a, b, c in rows) + '\n\n' + '\n'.join(f'• {t} ({src}) {u}' for t, u, src in lines) + f'\n\n{SITE}#today\n'
    tr = ''.join(f'<tr><td style="padding:7px 10px;color:#5F738A">{a}</td><td style="padding:7px 10px;font-weight:700;color:#13202E;white-space:nowrap">{b}</td>'
                 f'<td style="padding:7px 10px;color:#5F738A;font-size:13px">{c}</td></tr>' for a, b, c in rows)
    li = ''.join(f'<li style="margin:0 0 6px"><a href="{u}" style="color:#0E9E7E;text-decoration:none">{t}</a> <span style="color:#8DA3BA;font-size:12px">{src}</span></li>' for t, u, src in lines)
    html = (f'<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#13202E">'
            f'<p style="font-size:20px;font-weight:700;margin:0 0 2px">Power<span style="color:#0E9E7E">.Klock</span></p>'
            f'<p style="color:#5F738A;margin:0 0 14px">Le point du matin · {frday(today)}</p>'
            f'<table style="border-collapse:collapse;width:100%;font-size:14px;border-top:1px solid #E6ECF2">{tr}</table>'
            + (f'<p style="font-weight:600;margin:18px 0 6px">{heading}</p><ul style="padding-left:18px;margin:0">{li}</ul>' if li else '')
            + f'<p style="margin:20px 0 0"><a href="{SITE}#today" style="background:#0E9E7E;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Ouvrir Aujourd’hui</a></p>'
            f'<p style="color:#8DA3BA;font-size:11px;margin:18px 0 0">Sources : ENTSO-E, RTE, données de marché, PowerKlock. Prix forward = dernière cotation.</p></div>')
    return subject, text, html


def esc(t):
    return str(t or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


# 7 O'Klock every weekday at 7:00; PowerBrunch on Monday at 10:00, larger, on the week before
TITLE = {False: '7 O’Klock', True: 'PowerBrunch'}
SUB = {False: 'Marchés, régulation, énergie : l’essentiel à 7 h', True: 'La semaine servie à point : ce qu’il fallait retenir, à lire au calme'}
SEC = {'markets': 'Marchés en 30 secondes', 'digest': 'L’essentiel', 'top': 'Les articles principaux', 'stories': 'Les sujets du jour', 'official': 'Textes officiels', 'cons': 'Consultations : à vos réponses',
       'pubs': 'Publications et rapports', 'agenda': 'Agenda', 'post': 'À lire : le post de la semaine'}


def tailor(E, pids, interests, france, n):
    """a reader's own stories from every profile's (each already written by the AI): their profiles' stories first, then
    +2 per ticked subject and +2 for France when they asked France first (−1.5 elsewhere); n stories, each once"""
    pool, seen = [], set()
    for p in list(pids) + [p for p in E['profiles'] if p not in pids]:
        for k, st in enumerate(E['profiles'][p].get('stories') or []):
            if st['link'] in seen:
                continue
            seen.add(st['link'])
            tags = set(st.get('tags') or [])
            sc = (3 if p in pids else 0) - 0.3 * k + 2 * len(tags & set(interests))
            if france:
                sc += 2 if 'fr' in tags else -1.5
            pool.append((sc, dict(st, short=E['profiles'][p]['short'][0])))
    return [st for _, st in sorted(pool, key=lambda x: -x[0])[:n]]


# the subject of an article, shown in a pill at its right: the most specific of its categories (scripts/fetch_news.py)
THEMES = [('renewables', 'Renouvelables', '#0F2A23', '#14D3A9'), ('gas', 'Gaz', '#2D2213', '#E8A33D'), ('carbon', 'Carbone', '#1B2430', '#9FB0C0'),
          ('deal', 'Transactions', '#231C36', '#B48CF2'), ('build', 'Projets', '#13243A', '#6CB4F5'), ('regulation', 'Régulation', '#331A1C', '#ED6965'),
          ('markets', 'Marchés', '#13243A', '#6CB4F5'), ('power', 'Électricité', '#0F2A23', '#14D3A9'), ('geopolitics', 'Géopolitique', '#2A2418', '#D9B26A')]
CONS_T = {'cee': 'Efficacité énergétique', 'tariffs': 'Tarifs', 'grid': 'Réseau', 'market': 'Marché', 'renewables': 'Renouvelables', 'gas': 'Gaz', 'other': 'Autre'}


def pill(label, bg='#1B2430', fg='#9FB0C0'):
    return (f'<span style="font-family:Inter,Arial,sans-serif;display:inline-block;font-size:11px;font-weight:600;line-height:1;'
            f'padding:4px 8px;border-radius:999px;background:{bg};color:{fg};white-space:nowrap">{esc(label)}</span>') if label else ''


def theme_pill(tags, official=False):
    tags = tags or []
    if official:    # a text: its energy, else regulation (« financement » in a decree is not a deal)
        tags = [t for t in tags if t in ('renewables', 'gas', 'carbon')] or ['regulation']
    for k, lab, bg, fg in THEMES:
        if k in tags:
            return pill(lab, bg, fg)
    return ''


def render_letter(today, E, pid, mine=None, exclude=(), interests=(), france=False):
    """The newsletter (scripts/news_letter.py) for one or several reading profiles, as an e-mail: inline styles and
    tables, which every mail client shows the same way. Rising prices in red, falling in green, as on the site.
    Several profiles: the stories of each, once each, in the order of the first profile's sections."""
    pids = [p for p in ([pid] if isinstance(pid, str) else pid) if p in E['profiles']] or [next(iter(E['profiles']))]
    ed = dict(E['profiles'][pids[0]])
    wk = bool(E.get('weekly'))
    stories, seen = [], set()
    for p in pids:
        for st in E['profiles'][p].get('stories') or []:
            if st['link'] not in seen:
                seen.add(st['link'])
                stories.append(dict(st, short=E['profiles'][p]['short'][0]))
    ed['stories'] = stories
    if interests or france:     # ticked subjects or France first: the reader's own choice among every profile's stories
        ed['stories'] = tailor(E, pids, interests, france, len(stories) or (5 if E.get('weekly') else 3))
        seen = {st['link'] for st in ed['stories']}
    if len(pids) > 1:
        ed['name'] = [' + '.join(E['profiles'][p]['name'][0] for p in pids)] * 2
    # an article shown once: the main articles leave out the stories and the essentials already in the e-mail
    shown = seen | {x.get('link') for x in ((E.get('digest') or {}).get('items') or [])}
    E = dict(E, top=[o for o in E.get('top') or [] if o['link'] not in shown])
    # a reader's words to leave out (public.news_profile.exclude): stories and articles that contain one are dropped
    if exclude:
        rx = re.compile('|'.join(r'\b' + re.escape(w) + r'\b' for w in exclude), re.I)
        keep = lambda o: not rx.search(o.get('title') or '')  # noqa: E731
        ed['stories'] = [st for st in ed.get('stories') or [] if keep(st)]
        E = dict(E, top=[o for o in E.get('top') or [] if keep(o)], pubs=[o for o in E.get('pubs') or [] if keep(o)])
    return journal(today, E, ed, wk, mine)


# theme of a story: its most specific category, as a coloured word above the title
TH = [('renewables', 'Renouvelables', '#14D3A9'), ('gas', 'Gaz', '#E8A33D'), ('carbon', 'Carbone', '#9FB0C0'), ('deal', 'Transactions', '#B48CF2'),
      ('build', 'Projets', '#6CB4F5'), ('regulation', 'Régulation', '#ED6965'), ('markets', 'Marchés', '#6CB4F5'), ('power', 'Électricité', '#14D3A9'),
      ('geopolitics', 'Géopolitique', '#D9B26A')]


def theme_of(tags):
    for k, lab, col in TH:
        if k in (tags or []):
            return lab, col
    return '', '#6B6B6B'


WEATHER_ICON = {'sun': 'icon_sun.png', 'cloud': 'icon_cloud.png', 'storm': 'icon_storm.png'}


# the newsletter on the site's dark background (the owner's choice, 24 Nov. 2026): the light palette of journal() mapped
# to the site's colours, the price tiles one step lighter than the page
DARK = [('background:#0a0e13;border-radius:10px', 'background:#151c24;border:1px solid #243447;border-radius:10px'),
        ('background:#F1F1EF', 'background:#05080b;color:#E8EEF4'), ('background:#FFFFFF', 'background:#0a0e13;color:#E8EEF4'),
        ('color:#121212', 'color:#E8EEF4'), ('color:#383838', 'color:#C9D5E0'), ('color:#6B6B6B', 'color:#9FB0C0'),
        ('color:#8A8A8A', 'color:#7A93AB'), ('#0B7A62', '#14D3A9'), ('#B8322D', '#ED6965'), ('#1F5C99', '#6CB4F5'),
        ('#EBEBEB', '#1e2d3d'), ('#F2F2F2', '#1a2532'), ('#F7F7F5', '#151c24')]


def dark(html):
    for a, b in DARK:
        html = html.replace(a, b)
    # mail clients do not pass the text colour into tables: give every cell the light default, its own colour still wins
    return html.replace('<td style="', '<td style="color:#E8EEF4;').replace('<td>', '<td style="color:#E8EEF4">')


def journal(today, E, ed, wk, mine):
    """7 O'Klock and PowerBrunch « façon journal » (approved 19 Nov. 2026), on the site's dark background (24 Nov.), the price tiles, the lead
    story with its chart, the figure of the day (or the week's chart on Monday), the other stories, in brief, the days
    ahead. Images are attached to the mail (cid:), so they show without loading anything from the web."""
    f = 'font-family:Inter,Arial,Helvetica,sans-serif'
    serif = "font-family:Georgia,'Times New Roman',serif"
    mono = 'font-family:Menlo,Consolas,monospace'
    kick = lambda t, col='#6B6B6B': f'<p style="{f};font-size:11px;font-weight:700;letter-spacing:1px;color:{col};margin:0 0 6px;text-transform:uppercase">{t}</p>'  # noqa: E731
    row = lambda inner, bg='#FFFFFF': f'<tr><td style="padding:18px 22px;border-bottom:1px solid #EBEBEB;background:{bg}">{inner}</td></tr>'  # noqa: E731
    a = lambda u, t, st='': f'<a href="{esc(u)}" style="color:#121212;text-decoration:none;{st}">{esc(t)}</a>'  # noqa: E731
    green = 'color:#0B7A62'
    short = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
    jours = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
    ddm = lambda d: f'{int(str(d)[8:10])} {short[int(str(d)[5:7]) - 1]}'  # noqa: E731
    imgs = []

    def img(rel, alt, width=636):
        name = os.path.basename(rel)
        imgs.append(rel)
        return f'<img src="cid:{esc(name)}" alt="{esc(alt)}" width="{width}" style="display:block;width:100%;max-width:{width}px;height:auto;border:0">'

    # ── header: brand, date, listen, title, weather, tiles ──
    w = E.get('weather') or {}
    wx = (f'<td style="text-align:right;vertical-align:bottom;white-space:nowrap">{img("newsletter_img/" + WEATHER_ICON[w["kind"]], w["label"][0], 30).replace("display:block;width:100%;max-width:30px", "display:inline-block;width:30px;vertical-align:middle")}'
          f'<span style="{f};display:inline-block;vertical-align:middle;font-size:12px;line-height:1.3;text-align:left;margin-left:6px"><b>{esc(w["label"][0])}</b><br><span style="color:#6B6B6B">{esc(w["sub"][0])}</span></span></td>') if w.get('kind') in WEATHER_ICON else '<td></td>'
    cells = []
    for r in E.get('markets') or []:
        c = r.get('chg') or 0
        up = (c < 0) if r.get('hours') else (c > 0)
        col = '#9FB0C0' if not c else '#ED6965' if up else '#14D3A9'
        if r.get('hours'):
            ch = '' if r.get('chg') is None else 'stable' if not c else ('▲ +' if c > 0 else '▼ −') + n(abs(c), 0) + ' h'
        elif r.get('show') == 'abs':
            ch = '' if r.get('chg') is None else ('▲ +' if c > 0 else '▼ −') + n(abs(c), 1) + ' €'
        else:
            ch = '' if r.get('pct') is None else ('▲ +' if c > 0 else '▼ −' if c < 0 else '') + n(abs(r['pct']), 1) + ' %'
        val = n(r['value'], 0 if r.get('hours') and float(r['value']).is_integer() else 1 if r.get('hours') else 2) + (' h' if r.get('hours') else '')
        sub = esc(r['sub'][0]) if r.get('sub') else '' if r.get('hours') else esc(r['unit'])
        cells.append(f'<td width="33%" style="padding:3px;vertical-align:top"><a href="{SITE}#{esc(r.get("page") or "today")}" style="display:block;text-decoration:none;background:#0a0e13;border-radius:10px;padding:9px 11px;height:{84 if any(x.get("sub") for x in E["markets"]) else 70}px;overflow:hidden">'
                     f'<span style="{f};display:block;font-size:11.5px;color:#B8C9D9;white-space:nowrap;overflow:hidden">{esc(r["label"][0])}</span>'
                     f'<span style="{mono};display:block;font-size:18px;font-weight:700;color:#FFFFFF;margin:2px 0">{val}</span>'
                     f'<span style="{f};font-size:11px;color:#7A93AB">{sub}</span> <span style="{mono};font-size:11.5px;color:{col};white-space:nowrap">{ch}</span></a></td>')
    tiles = ''.join('<tr>' + ''.join(cells[i:i + 3]) + '<td></td>' * (3 - len(cells[i:i + 3])) + '</tr>' for i in range(0, len(cells), 3))
    srcs = ', '.join(sorted({r.get('src') for r in E.get('markets') or [] if r.get('src')}))
    head = (f'<tr><td style="padding:18px 22px 16px;border-bottom:1px solid #EBEBEB">'
            f'<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td style="{f};font-size:13px;color:#6B6B6B;vertical-align:middle"><a href="{SITE}" style="text-decoration:none">{img("../assets/logo-header.png", "PowerKlock", 150).replace("display:block;width:100%;max-width:150px", "display:inline-block;width:150px;vertical-align:middle")}</a><span style="vertical-align:middle;margin-left:10px">{frday(today)}</span></td>'
            f'<td style="{f};font-size:13px;text-align:right"><a href="{SITE}#intel/news" style="{green};font-weight:600;text-decoration:none">▶ Écouter</a></td></tr></table>'
            f'<table role="presentation" width="100%" style="border-collapse:collapse;margin:8px 0 12px"><tr><td style="vertical-align:bottom"><p style="{serif};margin:0;font-size:32px;font-weight:700;color:#121212">{TITLE[wk]}</p>'
            f'<p style="{f};margin:3px 0 0;font-size:13.5px;color:#6B6B6B">{SUB[wk]}{" · semaine du " + frday(today - timedelta(days=7)) if wk else ""}</p></td>{wx}</tr></table>'
            f'<table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed">{tiles}</table>'
            f'<p style="{f};font-size:11px;color:#8A8A8A;margin:6px 0 0">Sources : {esc(srcs)}. {"Variation sur la semaine" if wk else "Variation sur la séance précédente"}. Chaque tuile ouvre sa page sur le site.</p></td></tr>')
    body = []
    # ── PowerBrunch: the week's chart first ──
    wc = None   # no chart any more (the owner's choice, 23 Nov. 2026)
    if wk and wc:
        pct = wc.get('pct')
        ttl = f'Spot France : {"−" if (pct or 0) < 0 else "+"}{abs(pct or 0):.0f} % sur la semaine' + (f', {len(wc["marks"])} événement{"s" if len(wc["marks"]) > 1 else ""} repéré{"s" if len(wc["marks"]) > 1 else ""}' if wc.get('marks') else '')
        legend = ''.join(f'<p style="{f};margin:4px 0 0;font-size:14px"><b style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:9px;background:#B8322D;color:#fff;text-align:center;font-size:11px">{m["n"]}</b> <b>{jours[date.fromisoformat(m["date"]).weekday()]} {ddm(m["date"])}</b> · {esc(m["title"])}</p>' for m in wc.get('marks') or [])
        body.append(row(kick('Le graphique de la semaine') + f'<p style="{f};margin:0 0 10px;font-size:18px;font-weight:600;color:#121212">{esc(ttl)}</p>' + img(wc['img'], ttl) + legend +
                        f'<p style="{f};margin:8px 0 0;font-size:12.5px;color:#6B6B6B">Moyennes journalières publiées, jours de livraison (ENTSO-E).' + (" Les repères situent les événements de la semaine ; ils n'expliquent pas à eux seuls le prix." if wc.get('marks') else '') + f' <a href="{SITE}#markets/spot" style="{green}">Voir sur PowerKlock</a></p>'))
    # ── the lead story with its chart ──
    def free(h):   # a paid outlet's story: the same at outlets free to read
        return (f'<p style="{f};margin:4px 0 0;font-size:12.5px;color:#6B6B6B">Aussi en accès libre : ' +
                ' · '.join(f'<a href="{esc(o["link"])}" style="{green}">{esc(o["source"])}</a>' for o in h["free"]) + '</p>') if h.get('free') else ''
    st = list(ed.get('stories') or [])
    if st:
        h = st[0]
        lab, col = theme_of(h.get('tags'))
        ch = None   # no chart any more (the owner's choice, 23 Nov. 2026)
        chart = (f'<div style="margin:12px 0;padding:10px;border:1px solid #EBEBEB;border-radius:10px"><p style="{f};margin:0 0 6px;font-size:12.5px;font-weight:600;color:#383838">{esc(ch["title"])}</p>{img(ch["img"], ch["title"])}'
                 f'<p style="{f};margin:6px 0 0;font-size:11.5px;color:#6B6B6B">Source : {esc(ch["src"])} · <a href="{SITE}#{esc(ch["page"])}" style="{green}">voir sur PowerKlock</a></p></div>') if ch else ''
        body.append(row(kick(('Le sujet de la semaine' if wk else 'À la une') + (f' · <span style="color:{col}">{lab}</span>' if lab else '')) +
                        f'<p style="{serif};margin:0 0 8px;font-size:25px;line-height:1.22;font-weight:700">{a(h["link"], h["title"])}</p>' +
                        (f'<p style="{f};margin:0;font-size:16px;line-height:1.55;color:#383838">{esc(h["what"])}</p>' if h.get('what') else '') + chart +
                        (f'<p style="{f};margin:{0 if chart else 12}px 0 0;font-size:15.5px;line-height:1.5;color:#121212;border-left:3px solid #0B7A62;padding-left:12px"><b style="{green}">À retenir.</b> {esc(h["for_you"])}</p>' if h.get('for_you') else '') +
                        f'<p style="{f};margin:10px 0 0;font-size:12.5px;color:#6B6B6B">{esc(" · ".join(h["sources"][:3]))} · <a href="{esc(h["link"])}" style="{green};font-weight:600">Lire l\'article</a></p>' + free(h)))
    # ── the figure of the day ──
    fig = E.get('figure')
    if fig and not wk:
        body.append(row(f'<table role="presentation" style="border-collapse:collapse"><tr><td style="{mono};font-size:34px;font-weight:700;color:{"#0B7A62" if fig["dir"] == "dn" else "#B8322D"};padding-right:16px;white-space:nowrap;vertical-align:middle">{esc(fig["value"])}</td>'
                        f'<td style="vertical-align:middle">{kick("Le chiffre du jour")}<p style="{f};margin:0;font-size:15px;line-height:1.45">{esc(fig["text"])}</p></td></tr></table>'))
    # ── the other stories ──
    for h in st[1:]:
        lab, col = theme_of(h.get('tags'))
        body.append(row((f'<p style="{f};margin:0 0 4px;font-size:12px;font-weight:700;color:{col}">{lab}</p>' if lab else '') +
                        f'<p style="{serif};margin:0 0 6px;font-size:19px;line-height:1.28;font-weight:700">{a(h["link"], h["title"])}</p>' +
                        (f'<p style="{f};margin:0 0 6px;font-size:14.5px;line-height:1.5;color:#383838"><b style="{green}">À retenir.</b> {esc(h["for_you"])}</p>' if h.get('for_you') else '') +
                        f'<p style="{f};margin:0;font-size:12.5px;color:#6B6B6B">{esc(" · ".join(h["sources"][:3]))}</p>' + free(h)))
    # ── your keywords ──
    if mine:
        body.append(row(kick('Vos mots-clés') + ''.join(f'<p style="{f};margin:0;padding:7px 0;border-bottom:1px solid #F2F2F2;font-size:14.5px;line-height:1.4">{a(o["link"], o["title"])} <span style="color:#6B6B6B;font-size:12px">· {esc(o["source"])}</span></p>' for o in mine)))
    # ── in brief ──
    shown = {h['link'] for h in st}
    brief = [o for o in E.get('top') or [] if o['link'] not in shown][:6 if wk else 4]
    if brief:
        def bl(o):
            lab, col = theme_of(o.get('tags'))
            return f'<p style="{f};margin:0;padding:8px 0;border-bottom:1px solid #F2F2F2;font-size:15px;line-height:1.4">' + (f'<b style="color:{col}">{lab} ·</b> ' if lab else '') + a(o['link'], o['title']) + f' <span style="color:#8A8A8A;font-size:12px">{esc(o["source"])}</span></p>'
        body.append(row(kick('La semaine en bref' if wk else 'En bref') + ''.join(bl(o) for o in brief)))
    # ── the days ahead ──
    wa = E.get('week_ahead') or []
    if wa:
        def wl(x):
            dd = date.fromisoformat(x['date'])
            left = (dd - today).days
            colr = '#B8322D' if x['kind'] == 'cons' and left <= 2 else '#0B7A62' if x['kind'] == 'event' else '#121212'
            label = ('Fin de consultation : ' if x['kind'] == 'cons' else '') + x['title']
            t_ = a(x['link'], label) if x.get('link') else esc(label)
            return f'<tr><td style="{f};padding:5px 12px 5px 0;font-size:14px;font-weight:700;color:{colr};white-space:nowrap;vertical-align:top">{jours[dd.weekday()]} {dd.day}</td><td style="{f};padding:5px 0;font-size:14.5px;line-height:1.4">{t_}</td></tr>'
        body.append(row(kick('La semaine qui vient' if wk else 'Cette semaine') + '<table role="presentation" style="border-collapse:collapse">' + ''.join(wl(x) for x in wa) + '</table>', '#F7F7F5'))
    # ── PowerBrunch: this day in past years ──
    od = E.get('on_this_day')
    if wk and od and od.get('past'):
        seq = ' · '.join(f'{x["year"]} : <b>{n(x["value"], 0)} €</b>' for x in sorted(od['past'], key=lambda x: x['year']))
        now_ = f' · cette année : <b>{n(od["today"], 0)} €</b>' if od.get('today') is not None else ''
        body.append(row(kick('Ce jour-là') + f'<p style="{f};margin:0;font-size:15px;line-height:1.5">Le spot France le {today.day} {MONTHS[today.month - 1]}, année après année : {seq}{now_} (€/MWh, moyenne du jour).</p>'))
    foot = (f'<tr><td style="padding:16px 22px 22px;background:#FFFFFF"><p style="{f};font-size:12px;color:#6B6B6B;line-height:1.6;margin:0;text-align:center">'
            f'Sujets choisis pour votre profil · résumés écrits automatiquement à partir des titres et extraits.<br>'
            f'<a href="{SITE}#intel/news" style="{green}">Voir en ligne</a> · <a href="{SITE}#intel/news" style="{green}">Changer de profil</a> · <a href="{SITE}#intel/news" style="{green}">Se désabonner</a></p></td></tr>')
    html = ('<div style="background:#F1F1EF;padding:16px 6px"><table role="presentation" width="100%" style="max-width:680px;margin:0 auto;border-collapse:collapse;table-layout:fixed;word-wrap:break-word;overflow-wrap:anywhere;background:#FFFFFF;border-radius:12px">'
            + head + ''.join(body) + foot + '</table></div>')
    text = f'{TITLE[wk]} · {frday(today)}\n\n' + '\n'.join(f'{r["label"][0]} : {n(r["value"])} {r["unit"]}' for r in E.get('markets') or []) + '\n\n' + \
        '\n'.join(f'• {h["title"]}\n  {h.get("what") or ""}\n  {h["link"]}' for h in st) + f'\n\n{SITE}#intel/news\n'
    subject = f'{TITLE[wk]} · {frday(today)}' if not wk else f'PowerBrunch · la semaine du {frday(today - timedelta(days=7))}'
    return subject, text, dark(html) + ''.join(f'<!--img:{x}-->' for x in dict.fromkeys(imgs))


def readers(today, weekly=False):
    """The readers who chose to receive the newsletter (public.news_profile, warehouse migration 024): their address
    (the one they chose, else their account's), profile, words to leave out and own keywords. Daily on weekdays, or
    Monday only. Nothing without SUPABASE_DB_URL; the newsletter must not depend on the database."""
    db = os.environ.get('SUPABASE_DB_URL')
    if not db:
        return []
    try:
        import psycopg
        with psycopg.connect(db, connect_timeout=15, prepare_threshold=None) as conn, conn.cursor() as cur:
            cur.execute("""select coalesce(p.email_to, u.email), p.profiles, p.exclude, p.daily, p.weekly, p.interests, p.france,
                                  coalesce((select array_agg(k.keyword) from public.news_keyword k where k.user_id = p.user_id), '{}')
                           from public.news_profile p join auth.users u on u.id = p.user_id
                           left join public.user_access a on a.user_id = p.user_id
                           where (p.daily or p.weekly) and coalesce(a.status, 'approved') = 'approved'""")
            rows = cur.fetchall()
    except Exception as e:
        print('  readers not read:', str(e)[:160])
        return []
    return [{'to': to, 'profiles': list(pr or []), 'exclude': list(ex or []), 'keywords': list(kw or []), 'interests': list(it or []), 'france': bool(fr)}
            for to, pr, ex, dy, wy, it, fr, kw in rows
            if to and (wy if weekly else dy)]


def mine_for(kw, exclude, monday):
    """the articles of the last 24 hours (72 on Monday) whose title or extract contains one of the reader's keywords"""
    if not kw:
        return []
    items = (load('news.json') or {}).get('items') or []
    since = (datetime.now(PARIS) - timedelta(hours=72 if monday else 24)).isoformat()
    import unicodedata
    plain = lambda t: unicodedata.normalize('NFKD', (t or '').lower()).encode('ascii', 'ignore').decode()  # noqa: E731   accents left out: « echelonnement » finds « échelonnement »
    has = lambda i, ws: any(re.search(r'\b' + re.escape(plain(w)) + r'\b', plain(i.get('title', '') + ' ' + (i.get('snippet') or ''))) or (i.get('query') or '').lower() == w.lower() for w in ws)  # noqa: E731
    out = [i for i in items if (i.get('date') or '') >= since and has(i, kw) and not has(i, exclude)]
    return sorted(out, key=lambda i: -(i.get('impact') or 0))[:6]


def send(mails):
    """mails: [(to list, subject, text, html)], one SMTP session"""
    with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT') or 587), timeout=60) as srv:
        srv.starttls()
        srv.login(os.environ['SMTP_USER'], os.environ['SMTP_PASS'])
        for to, subject, text, html in mails:
            msg = EmailMessage()
            msg['Subject'] = subject
            msg['From'] = os.environ.get('ALERT_FROM') or os.environ['SMTP_USER']
            msg['To'] = ', '.join(to)
            msg.set_content(text)
            msg.add_alternative(html, subtype='html')
            part = msg.get_payload()[-1]
            for rel in re.findall(r'<!--img:([^>]+)-->', html):   # images shown in the mail (cid:), attached to it
                try:
                    with open(os.path.join(D, rel), 'rb') as fh:
                        part.add_related(fh.read(), 'image', 'png', cid='<' + os.path.basename(rel) + '>')
                except OSError:
                    pass
            srv.send_message(msg)


def admins():
    """the admins' addresses (public.news_admin): a preview goes to them only"""
    db = os.environ.get('SUPABASE_DB_URL')
    if not db:
        return []
    try:
        import psycopg
        with psycopg.connect(db, connect_timeout=15, prepare_threshold=None) as conn, conn.cursor() as cur:
            cur.execute('select email from public.news_admin')
            return [r[0] for r in cur.fetchall() if r[0]]
    except Exception as e:
        print('  admins not read:', str(e)[:160])
        return []


def main():
    today, rows, lines, heading = build()
    subject, text, html = render(today, rows, lines, heading)
    # the newsletter when today's edition exists (scripts/news_letter.py), for the profile MORNING_PROFILE (default: origination)
    weekly = '--weekly' in sys.argv   # PowerBrunch (Monday at 10:00) instead of 7 O'Klock
    E = load('newsletter_week.json' if weekly else 'newsletter.json') or {}
    has_letter = E.get('date') == today.isoformat() and bool(E.get('profiles'))
    pid = os.environ.get('MORNING_PROFILE') or 'origination'
    if has_letter and pid in E['profiles']:
        subject, text, html = render_letter(today, E, pid)
    # each reader who asked for it in the site gets the edition of their profile(s); nobody else
    personal = []
    if has_letter:
        for r in readers(today, weekly):
            ps = [p for p in r['profiles'] if p in E['profiles']] or [pid]
            mine = [o for o in mine_for(r['keywords'], r['exclude'], today.weekday() == 0)
                    if all(o['link'] not in {st['link'] for st in E['profiles'][p].get('stories') or []} for p in ps)]
            personal.append(([r['to']], *render_letter(today, E, ps, mine, r['exclude'], r['interests'], r['france'])))
    if os.environ.get('MORNING_PREVIEW') == '1':
        # a preview on demand (Actions › Morning e-mail › Run workflow › preview): every profile's edition to the admins only
        to = admins()
        ps = list((E.get('profiles') or {}))
        if not has_letter or not to:
            print('preview not sent:', 'no edition today' if not has_letter else 'no admin address')
            return 0
        mails = [(to, f'[Aperçu] {s}', t, h) for s, t, h in [render_letter(today, E, ps)]]
        if all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')):
            send(mails)
            print('preview sent to', len(to), 'admin(s)')
        else:
            print('::warning::preview not sent: the SMTP_HOST, SMTP_USER and SMTP_PASS secrets are not set')
        return 0
    # only the readers who asked for it in the site (public.news_profile): no list, no automatic sending (the owner, 23 Nov. 2026)
    to = []
    mails = personal
    ready = all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')) and mails
    if os.environ.get('MORNING_DRY_RUN') == '1' or not ready:
        print(subject + '\n\n' + text + ('' if ready else '\n(not sent: SMTP_* or recipients missing)'))
        if not all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')):
            print('::warning::nothing sent: the SMTP_HOST, SMTP_USER and SMTP_PASS secrets are not set')
        print(f'{len(personal)} personal edition(s) prepared')
        return 0
    send(mails)
    print('sent:', len(personal), 'edition(s), to the readers who asked for it')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
