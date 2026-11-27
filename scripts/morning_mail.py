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
        news = sorted([i for i in ((load('news.json') or {}).get('items') or []) if (i.get('impact') or 0) >= 3 and not i.get('noai')], key=lambda i: -(i.get('impact') or 0))[:3]
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


# 7 O'Klock Tuesday to Friday at 7:00; PowerBrunch on Monday at 8:00 instead, on the week before
TITLE = {False: '7 O’Klock', True: 'PowerBrunch'}
SUB = {False: 'Marchés, régulation, énergie : l’essentiel à 7 h', True: 'La semaine servie à point : ce qu’il fallait retenir, à lire au calme'}
SEC = {'markets': 'Marchés en 30 secondes', 'digest': 'L’essentiel', 'top': 'Les articles principaux', 'stories': 'Les sujets du jour', 'official': 'Textes officiels', 'cons': 'Consultations : à vos réponses',
       'pubs': 'Publications et rapports', 'agenda': 'Agenda', 'post': 'À lire : le post de la semaine'}


def tailor(E, pids, interests, france, n):
    """a reader's own stories, chosen among every profile's (each already written by the AI) by the subjects they ticked
    (public.news_profile.interests, the owner's choice of 24 Nov. 2026: interests, not profiles): +3 per ticked subject,
    the profile's own rank as a tie-break, +2 for France when they asked France first (−1.5 elsewhere); n stories, each once.
    pids (the older profile choice) only breaks ties now."""
    pool, seen = [], set()
    for p in list(pids) + [p for p in E['profiles'] if p not in pids]:
        for k, st in enumerate(E['profiles'][p].get('stories') or []):
            if st['link'] in seen:
                continue
            seen.add(st['link'])
            tags = set(st.get('tags') or [])
            sc = 3 * len(tags & set(interests)) - 0.3 * k + (0.5 if p in pids else 0)
            if france:
                sc += 2 if 'fr' in tags else -1.5
            if st['link'] == E.get('pinned'):
                sc += 100       # the admin's pinned story leads every edition
            pool.append((sc, dict(st, short=E['profiles'][p]['short'][0])))
    return [st for _, st in sorted(pool, key=lambda x: -x[0])[:n]]


# the subject of an article, shown in a pill at its right: the most specific of its categories (scripts/fetch_news.py)
THEMES = [('support', 'Soutien EnR', '#FBF3DC', '#7A5B00'), ('renewables', 'Renouvelables', '#E3F4EC', '#0B6B4F'), ('gas', 'Gaz', '#FCEFE0', '#9A5B12'), ('carbon', 'Carbone', '#ECEFF3', '#3F5468'),
          ('deal', 'Transactions', '#EEE9F8', '#5B3FA0'), ('build', 'Projets', '#E6F0FA', '#1F5C99'), ('regulation', 'Régulation', '#FDECEC', '#A23B36'),
          ('markets', 'Marchés', '#E6F0FA', '#1F5C99'), ('power', 'Électricité', '#E8F6F3', '#0B7A62'), ('geopolitics', 'Géopolitique', '#F3EEE6', '#6B5530')]
CONS_T = {'cee': 'Efficacité énergétique', 'tariffs': 'Tarifs', 'grid': 'Réseau', 'market': 'Marché', 'renewables': 'Renouvelables', 'gas': 'Gaz', 'other': 'Autre'}


def pill(label, bg='#ECEFF3', fg='#3F5468'):
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
    # every edition chooses among every profile's stories: the reader's ticked subjects and France first rank them, and an
    # edition without either (the general one, the site's Newsletter tab) still gets 10, not one profile's 2 or 3
    # (the owner, 25 Nov. 2026: « deux articles c'est trop peu »)
    ed['stories'] = tailor(E, pids, interests, france, 14 if E.get('weekly') else 10)
    seen = {st['link'] for st in ed['stories']}
    if interests or len(pids) > 1:
        ed['name'] = ['Vos sujets', 'Your subjects']
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
TH = [('support', 'Soutien EnR', '#7A5B00'), ('renewables', 'Renouvelables', '#0B6B4F'), ('gas', 'Gaz', '#9A5B12'), ('carbon', 'Carbone', '#3F5468'), ('deal', 'Transactions', '#5B3FA0'),
      ('build', 'Projets', '#1F5C99'), ('regulation', 'Régulation', '#B8322D'), ('markets', 'Marchés', '#1F5C99'), ('power', 'Électricité', '#0B7A62'),
      ('geopolitics', 'Géopolitique', '#6B5530')]


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


GENERIC = re.compile(r"(?i)^\s*(l.|un |une |des |les |le |la )?(impacts?|int[ée]r[êe]ts?|enjeux?|opportunit[ée]s?|cons[ée]quences?|effets?|nouvel(le)?s?|"
                     r"analyser|[ée]tudier|pr[ée]voir|surveiller|suivre|[àa] suivre|anticiper|v[ée]rifier|implications?|potentiel)\b")

def dark(html):
    for a, b in DARK:
        html = html.replace(a, b)
    # mail clients do not pass the text colour into tables: give every cell the light default, its own colour still wins
    return html.replace('<td style="', '<td style="color:#E8EEF4;').replace('<td>', '<td style="color:#E8EEF4">')


BG = re.compile(r'<(td|table)\b((?:(?!bgcolor)[^>])*?)style="([^"]*?)background:(#[0-9A-Fa-f]{6})')


def outlook(html):
    """Outlook (and a mail forwarded from Gmail to Outlook) keeps a cell's colour only from the old bgcolor attribute:
    every cell or table with a background in its style gets the same colour as bgcolor"""
    return BG.sub(lambda m: f'<{m[1]} bgcolor="{m[4]}"{m[2]}style="{m[3]}background:{m[4]}', html)


def tile_label(t):
    """a tile's label on one line in every mail client (the owner, 25 Nov. 2026: tiles of unequal sizes): short words,
    the same meaning (« Spot France aujourd'hui » → « Spot France auj. », « Garanties d'origine 2027 » → « GO 2027 »)"""
    for a, b in (("aujourd'hui", "auj."), ("aujourd’hui", "auj."), ("Garanties d'origine", "GO"), ("Garanties d’origine", "GO"),
                 ("Pointe − base", "Pointe−base")):
        t = t.replace(a, b)
    return t[:22]


def journal(today, E, ed, wk, mine):
    """7 O'Klock and PowerBrunch « façon journal » (approved 19 Nov. 2026), a black band at the top and the stories on white (24 Nov.), the price tiles, the lead
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

    # ── header: brand, date, title, weather, tiles ──
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
        # against what (the owner, 26 Nov. 2026: « augmentation : dire vs quoi »): the day before for the day's prices, the
        # previous session for the forwards and gas, the previous quote for the guarantees of origin, the week on Monday
        lab0 = r['label'][0]
        vs = ('sur 7 j' if wk else 'vs veille' if r.get('hours') or re.search(r"aujourd|Spot|Pointe", lab0) else
              'vs cotation préc.' if re.search(r"Garanties|GO ", lab0) else 'vs séance préc.')
        if ch:     # on its own line in every tile, so the six tiles keep the same layout
            ch += f'<br><span style="color:#7A93AB;font-size:10.5px">{vs}</span>'
        sub = esc(r['sub'][0]) if r.get('sub') else '' if r.get('hours') else esc(r['unit'])
        # Outlook (Word) ignores display:block, padding and background on a link: the tile is a cell of its own, its
        # background given twice (bgcolor for Outlook, style for the others), each line its own link
        href = f'{SITE}#{esc(r.get("page") or "today")}'
        h = 98 if any(x.get("sub") for x in E["markets"]) else 86
        cells.append(f'<td width="33%" style="padding:3px;vertical-align:top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>'
                     f'<td height="{h}" style="background:#0a0e13;border-radius:10px;padding:9px 11px;vertical-align:top">'
                     f'<div style="{f};font-size:11.5px;line-height:15px;color:#B8C9D9;white-space:nowrap;overflow:hidden"><a href="{href}" style="color:#B8C9D9;text-decoration:none">{esc(tile_label(r["label"][0]))}</a></div>'
                     f'<div style="{mono};font-size:18px;line-height:24px;font-weight:700;color:#FFFFFF;margin:2px 0"><a href="{href}" style="color:#FFFFFF;text-decoration:none">{val}</a></div>'
                     f'<div style="{f};font-size:11px;line-height:15px;color:#7A93AB">{sub} <span style="{mono};font-size:11.5px;color:{col};white-space:nowrap">{ch}</span></div></td></tr></table></td>')
    tiles = ''.join('<tr>' + ''.join(cells[i:i + 3]) + '<td></td>' * (3 - len(cells[i:i + 3])) + '</tr>' for i in range(0, len(cells), 3))
    srcs = ', '.join(sorted({r.get('src') for r in E.get('markets') or [] if r.get('src')}))
    brief_sep = f'</p><p style="{f};margin:10px 0 0;font-size:15.5px;line-height:1.6;color:#121212">'   # the brief's second paragraph
    head = (f'<tr><td style="padding:18px 22px 16px;background:#0a0e13;border-radius:12px 12px 0 0">'
            f'<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td style="{f};font-size:13px;color:#6B6B6B;vertical-align:middle"><a href="{SITE}" style="text-decoration:none">{img("../assets/logo-header.png", "PowerKlock", 150).replace("display:block;width:100%;max-width:150px", "display:inline-block;width:150px;vertical-align:middle")}</a><span style="vertical-align:middle;margin-left:10px">{frday(today)}</span></td>'
            f'</tr></table>'
            f'<table role="presentation" width="100%" style="border-collapse:collapse;margin:8px 0 12px"><tr><td style="vertical-align:bottom"><p style="{serif};margin:0;font-size:32px;font-weight:700;color:#121212">{TITLE[wk]}</p>'
            f'<p style="{f};margin:3px 0 0;font-size:13.5px;color:#6B6B6B">{SUB[wk]}{" · semaine du " + frday(today - timedelta(days=7)) if wk else ""}</p></td>{wx}</tr></table>'
            f'<table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed">{tiles}</table>'
            f'<p style="{f};font-size:11px;color:#8A8A8A;margin:6px 0 0">Sources : {esc(srcs)}. {"Variation sur la semaine" if wk else "Variation indiquée dans chaque tuile"}. Chaque tuile ouvre sa page sur le site.</p>'
            + (f'<p style="{f};margin:14px 0 0;font-size:15.5px;line-height:1.6;color:#121212"><b style="{green}">Le point du matin.</b> {brief_sep.join(re.sub(r"^([A-ZÀ-Ü][^:.]{1,28}) :", r"<b>\1 :</b>", esc(x)) for x in re.split(r"\n\s*\n", E["brief"]))} <a href="{SITE}#today" style="{green};font-size:13.5px;white-space:nowrap">Le détail par marché →</a></p>'
               + (f'<p style="{f};margin:6px 0 0;font-size:12.5px;color:#6B6B6B">À lire : ' + ' · '.join(f'<a href="{esc(x["link"])}" style="color:#6B6B6B">{esc(x["source"])}</a>' for x in E.get('brief_links') or []) + '</p>' if E.get('brief_links') else '')
               if E.get('brief') else '')
            + '</td></tr>')
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

    def keep(h):     # « À retenir »: the story's summary, then its concrete fact when it adds one
        w, y = (h.get('what') or '').strip(), (h.get('for_you') or '').strip()
        if h.get('section'):
            return w        # chosen by Claude: the short description alone (no « Impact » line: the owner, 25 Nov. 2026)
        if GENERIC.search(y) or len(y.split()) < 4 or y.lower()[:40] in w.lower():
            y = ''     # a generic line (« Intérêt pour les PPA ») adds nothing
        return (w + ((' ' if w[-1:] in '.!?…' else '. ') + y if y else '')) if w else y

    def report(h):   # a major publication: the report itself, on the publisher's site
        return (f'<p style="{f};margin:4px 0 0;font-size:12.5px;color:#6B6B6B">Le rapport : <a href="{esc(h["report_link"])}" style="{green};font-weight:600">'
                f'{esc(h.get("report_name") or "sur le site de l’éditeur")} ↗</a></p>') if h.get('report_link') else ''
    st = list(ed.get('stories') or [])
    if wk:     # PowerBrunch has its own layout (the owner's mockup v4, 25 Nov. 2026)
        return brunch(today, E, st, mine, keep, report, free, img, imgs)
    if st:
        h = st[0]
        lab, col = theme_of(h.get('tags'))
        ch = None   # no chart any more (the owner's choice, 23 Nov. 2026)
        chart = (f'<div style="margin:12px 0;padding:10px;border:1px solid #EBEBEB;border-radius:10px"><p style="{f};margin:0 0 6px;font-size:12.5px;font-weight:600;color:#383838">{esc(ch["title"])}</p>{img(ch["img"], ch["title"])}'
                 f'<p style="{f};margin:6px 0 0;font-size:11.5px;color:#6B6B6B">Source : {esc(ch["src"])} · <a href="{SITE}#{esc(ch["page"])}" style="{green}">voir sur PowerKlock</a></p></div>') if ch else ''
        # as Veille › Top stories on the site (a large title, the kicker in the subject's colour) on a pale green band, « À
        # retenir » in a white framed box (the owner, 25 Nov. 2026)
        body.append(row(kick(('Le sujet de la semaine' if wk else 'À la une') + (f' · {lab}' if lab else ''), col or '#0B7A62') +
                        f'<p style="{serif};margin:0 0 10px;font-size:32px;line-height:1.16;font-weight:700">{a(h["link"], h["title"])}</p>' +
                        chart + (f'<table role="presentation" width="100%" style="border-collapse:collapse;margin:{12 if chart else 6}px 0 0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-left:4px solid #0B7A62;border-radius:0 8px 8px 0;padding:12px 14px"><p style="{f};margin:0;font-size:16.5px;line-height:1.55;color:#121212"><b style="{green}">À retenir.</b> {esc(keep(h))}</p></td></tr></table>' if keep(h) else '') +
                        f'<p style="{f};margin:10px 0 0;font-size:12.5px;color:#6B6B6B">{esc(" · ".join(h["sources"][:3]))} · <a href="{esc(h["link"])}" style="{green};font-weight:600">Lire l\'article</a></p>' + report(h) + free(h), '#EEF7F3'))
    # ── the figure of the day ──
    fig = E.get('figure')
    if fig and not wk:
        body.append(row(f'<table role="presentation" style="border-collapse:collapse"><tr><td style="{mono};font-size:34px;font-weight:700;color:{"#0B7A62" if fig["dir"] == "dn" else "#B8322D"};padding-right:16px;white-space:nowrap;vertical-align:middle">{esc(fig["value"])}</td>'
                        f'<td style="vertical-align:middle">{kick("Le chiffre du jour")}<p style="{f};margin:0;font-size:15px;line-height:1.45">{esc(fig["text"])}</p></td></tr></table>'))
    # ── the other stories ──
    # the other stories by section (the owner, 25 Nov. 2026), the sections in the order of the reader's subjects (the
    # stories come sorted by them): a section heading, then its articles
    SEC = {'regulation': 'Régulation et appels d’offres', 'markets': 'Marchés, gaz et géopolitique', 'nuclear_grid': 'Nucléaire et réseau',
           'deals': 'Transactions et contrats', 'projects': 'Projets et nouvelles capacités', 'supply': 'Fourniture et consommation'}
    def sec_of(h):
        if h.get('section') in SEC:
            return h['section']
        t = set(h.get('tags') or [])
        return ('regulation' if t & {'regulation', 'support', 'official'} else 'deals' if 'deal' in t else 'projects' if t & {'build', 'renewables'}
                else 'markets' if t & {'gas', 'markets', 'geopolitics', 'carbon'} else 'supply')
    order = []
    for h in st[1:]:
        if sec_of(h) not in order:
            order.append(sec_of(h))
    rest = [h for k in order for h in st[1:] if sec_of(h) == k]
    for j, h in enumerate(rest):
        # the section's name once, as the site's headings (small capitals, a thin rule), and one subject pill by the outlet
        # instead of a second coloured label above the title (the owner, 25 Nov. 2026: two labels read badly)
        sec_head = (f'<p style="{f};margin:{0 if j == 0 else 6}px 0 12px;padding-bottom:6px;border-bottom:1px solid #D9D9D9;font-size:12px;font-weight:700;letter-spacing:1.2px;'
                    f'text-transform:uppercase;color:#383838">{SEC[sec_of(h)]}</p>') if j == 0 or sec_of(rest[j - 1]) != sec_of(h) else ''
        body.append(row(sec_head +
                        f'<p style="{serif};margin:0 0 6px;font-size:19px;line-height:1.28;font-weight:700">{a(h["link"], h["title"])}</p>' +
                        (f'<p style="{f};margin:0 0 8px;font-size:15px;line-height:1.5;color:#383838"><b style="{green}">À retenir.</b> {esc(keep(h))}</p>' if keep(h) else '') +
                        f'<p style="{f};margin:0;font-size:12.5px;color:#6B6B6B">{theme_pill(h.get("tags"))}{" " if theme_pill(h.get("tags")) else ""}{esc(" · ".join(h["sources"][:3]))}</p>' + report(h) + free(h)))
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
            why = f'<br><span style="font-size:13px;color:#6B6B6B">{esc(x["text"])}</span>' if x.get('text') else ''   # what it means, for a reader who does not follow it
            return f'<tr><td style="{f};padding:5px 12px 5px 0;font-size:14px;font-weight:700;color:{colr};white-space:nowrap;vertical-align:top">{jours[dd.weekday()]} {dd.day}</td><td style="{f};padding:5px 0;font-size:14.5px;line-height:1.4">{t_}{why}</td></tr>'
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
    # tables only for the frame (Outlook drops a div's background and max-width): the grey page, then the 680 px column,
    # held at 680 in Outlook by its own table (the comments are invisible elsewhere)
    html = outlook('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EF;border-collapse:collapse"><tr><td align="center" style="padding:16px 6px">'
                   '<!--[if mso]><table role="presentation" width="680" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->'
                   '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;border-collapse:collapse;table-layout:fixed;word-wrap:break-word;overflow-wrap:anywhere;background:#FFFFFF;border-radius:12px">'
                   + dark(head) + ''.join(body) + foot + '</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table>')
    text = f'{TITLE[wk]} · {frday(today)}\n\n' + '\n'.join(f'{r["label"][0]} : {n(r["value"])} {r["unit"]}' for r in E.get('markets') or []) + '\n\n' + \
        '\n'.join(f'• {h["title"]}\n  {h.get("what") or ""}\n  {h["link"]}' for h in st) + f'\n\n{SITE}#intel/news\n'
    subject = f'{TITLE[wk]} · {frday(today)}' if not wk else f'PowerBrunch · la semaine du {frday(today - timedelta(days=7))}'
    return subject, text, html + ''.join(f'<!--img:{x}-->' for x in dict.fromkeys(imgs))


# ── PowerBrunch, the Monday edition (the owner's mockup v4, 25 Nov. 2026): a dark band in the site's colours, the week
# in one sentence, the three things to remember, the figure of the week, the week in figures, the week ahead, then one
# block per theme, the analysis first and its articles below ──
BRUNCH_SEC = [('prices', 'Prix et forwards'), ('gas', 'Gaz et géopolitique'), ('regulation', 'Régulation et appels d’offres'),
              ('nuclear_grid', 'Nucléaire et réseau'), ('deals', 'Transactions et contrats'), ('projects', 'Projets et nouvelles capacités'),
              ('supply', 'Fourniture et consommation')]
# the brief's topics (« Prix : … ») go to the theme whose words they use
BRUNCH_TOPIC = [('gas', r'gaz|ttf|peg|gnl|g[ée]opoli|p[ée]trole|brent|carbone|co2|eua'), ('nuclear_grid', r'nucl[ée]|edf|r[ée]seau|rte|hydro'),
                ('regulation', r'r[ée]gul|cre|appel|arr[êe]t[ée]|d[ée]cret|bruxelles|soutien|loi'), ('deals', r'ppa|contrat|transaction'),
                ('supply', r'fourni|tarif|consomm|client'), ('projects', r'projet|capacit|stockage|batter'), ('prices', r'.')]


def brunch_sec(h):
    """an article's theme in PowerBrunch: the newsletter's sections, markets split into prices and gas/geopolitics"""
    t = set(h.get('tags') or [])
    sec = h.get('section')
    if sec == 'markets':
        return 'gas' if t & {'gas', 'geopolitics', 'carbon'} else 'prices'
    if sec in ('regulation', 'nuclear_grid', 'deals', 'projects', 'supply'):
        return sec
    # no section from Claude: the most specific subject first (a PPA is a deal before it is a market story)
    return ('regulation' if t & {'regulation', 'support', 'official'} else 'deals' if 'deal' in t else 'projects' if t & {'build', 'renewables'}
            else 'gas' if t & {'gas', 'geopolitics', 'carbon'} else 'prices' if t & {'markets', 'power'} else 'supply')


def spot_weeks(today):
    """the French spot's average over the last full week (Monday to Sunday before today) and the week before, published
    daily averages (data/history/summary_fr.json › avg), or None"""
    try:
        rows = {r['d']: r['avg'] for r in load('history', 'summary_fr.json')['zones']['FR'] if r.get('avg') is not None}
    except (TypeError, KeyError):
        return None
    end = today - timedelta(days=today.weekday() + 1)      # last Sunday
    wk = lambda e: [rows[str(e - timedelta(days=k))] for k in range(7) if str(e - timedelta(days=k)) in rows]  # noqa: E731
    a, b = wk(end), wk(end - timedelta(days=7))
    if len(a) < 5 or len(b) < 5:
        return None
    return sum(a) / len(a), sum(b) / len(b), end


def brunch(today, E, st, mine, keep, report, free, img, imgs):
    f = 'font-family:Inter,Arial,Helvetica,sans-serif'
    serif = "font-family:Georgia,'Times New Roman',serif"
    mono = 'font-family:Menlo,Consolas,monospace'
    green = '#0B7A62'
    jours = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
    kick = lambda t: f'<p style="{f};font-size:11px;font-weight:700;letter-spacing:1px;color:#383838;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #D9D9D9;text-transform:uppercase">{t}</p>'  # noqa: E731
    row = lambda inner, bg='#FFFFFF': f'<tr><td style="padding:18px 22px;border-bottom:1px solid #EBEBEB;background:{bg}">{inner}</td></tr>'  # noqa: E731
    a = lambda u, t: f'<a href="{esc(u)}" style="color:#121212;text-decoration:none">{esc(t)}</a>'  # noqa: E731
    sw = spot_weeks(today)
    end = sw[2] if sw else today - timedelta(days=today.weekday() + 1)
    start = end - timedelta(days=6)
    span = f'semaine du {start.day}{"" if start.month == end.month else " " + MONTHS[start.month - 1]} au {end.day} {MONTHS[end.month - 1]}'
    # ── the dark band: brand, date, title in two colours ──
    head = (f'<tr><td bgcolor="#0a0e13" style="padding:18px 22px 16px;background:#0a0e13;background-image:linear-gradient(135deg,#0a0e13 55%,#0d3b32);border-radius:12px 12px 0 0;border-bottom:3px solid #14D3A9">'
            f'<p style="{f};margin:0;font-size:13px;color:#9FB0C0"><a href="{SITE}" style="text-decoration:none">{img("../assets/logo-header.png", "PowerKlock", 130).replace("display:block;width:100%;max-width:130px", "display:inline-block;width:130px;vertical-align:middle")}</a>'
            f'<span style="vertical-align:middle;margin-left:8px">· {frday(today)}</span></p>'
            f'<p style="{serif};margin:12px 0 0;font-size:34px;line-height:1.1;font-weight:700;color:#FFFFFF">Power<span style="color:#14D3A9">Brunch</span></p>'
            f'<p style="{f};margin:4px 0 0;font-size:13.5px;color:#9FB0C0">La semaine servie à point · {span}</p></td></tr>')
    body = []
    # the brief's paragraphs « Topic : text » (scripts/news_letter.py › claude_brief, weekly)
    paras = []
    for x in re.split(r'\n\s*\n', E.get('brief') or ''):
        m = re.match(r'^([A-ZÀ-Ü][^:.]{1,40}) : (.+)$', x.strip(), re.S)
        paras.append((m[1], m[2].strip()) if m else ('', x.strip()))
    paras = [p_ for p_ in paras if p_[1]]
    first = lambda t: (re.match(r'(.+?[.!?])(\s|$)', t) or [None, t])[1]  # noqa: E731
    # ── the week in one sentence: Claude's (newsletter_brief.json › week_title, week_text), else the spot's week ──
    wl = E.get('week_line') or {}
    if not wl.get('title') and sw:
        pct = (sw[0] / sw[1] - 1) * 100
        wl = {'title': f'Le spot France {"recule" if pct < 0 else "monte"} de {abs(pct):.0f} % sur la semaine',
              'text': first(paras[0][1]) if paras else f'{n(sw[1], 0)} € la semaine d’avant, {n(sw[0], 0)} € en moyenne cette semaine.'}
    if wl.get('title'):
        body.append(row(f'<p style="{f};font-size:11px;font-weight:700;letter-spacing:1px;color:{green};margin:0 0 6px;text-transform:uppercase">La semaine en une phrase</p>'
                        f'<p style="{serif};margin:0;font-size:26px;line-height:1.2;font-weight:700;color:#121212">{esc(wl["title"])}</p>'
                        + (f'<p style="{f};margin:8px 0 0;font-size:15.5px;line-height:1.55;color:#383838">{esc(wl["text"])}</p>' if wl.get('text') else '')))
    # ── the three things to remember: Claude's (week_keys), else the first sentence of the brief's first topics ──
    keys = [k for k in E.get('week_keys') or [] if k.get('text')][:3] or [{'bold': t, 'text': first(x)} for t, x in paras[:3]]
    if keys:
        li = ''.join(f'<tr><td style="{serif};font-size:26px;font-weight:700;color:{green};padding:4px 14px 8px 0;vertical-align:top;width:20px">{k_ + 1}</td>'
                     f'<td style="{f};font-size:15px;line-height:1.5;color:#383838;padding:6px 0 8px">' + (f'<b style="color:#121212">{esc(k["bold"])}</b> : ' if k.get('bold') else '') + f'{esc(k["text"])}</td></tr>'
                     for k_, k in enumerate(keys))
        body.append(row(kick('Les 3 choses à retenir') + f'<table role="presentation" style="border-collapse:collapse">{li}</table>'))
    # ── the figure of the week (the spot's weekly average), on the dark tile ──
    if sw:
        pct = (sw[0] / sw[1] - 1) * 100
        col = '#ED6965' if pct > 0 else '#14D3A9'
        body.append(row(f'<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td bgcolor="#0a0e13" style="background:#0a0e13;border-radius:10px;padding:16px 18px">'
                        f'<table role="presentation" style="border-collapse:collapse"><tr><td style="{mono};font-size:36px;font-weight:700;color:{col};padding-right:18px;white-space:nowrap;vertical-align:middle">{"+" if pct > 0 else "−"}{abs(pct):.0f} %</td>'
                        f'<td style="{f};font-size:14.5px;line-height:1.5;color:#E8EEF4;vertical-align:middle"><b>Le chiffre de la semaine.</b> La {"hausse" if pct > 0 else "baisse"} du spot France sur la semaine, de {n(sw[1], 0)} € à {n(sw[0], 0)} € en moyenne.</td></tr></table></td></tr></table>'))
    # ── the week in figures (the edition's tiles: the change is over the week) ──
    mk = E.get('markets') or []
    if mk:
        def chg(r):
            c = r.get('chg') or 0
            up = (c < 0) if r.get('hours') else (c > 0)
            colr = '#6B6B6B' if not c else '#B8322D' if up else green
            if r.get('hours'):
                t = 'stable' if not c else ('▲ +' if c > 0 else '▼ −') + n(abs(c), 0) + ' h'
            elif r.get('show') == 'abs' or r.get('pct') is None:
                t = ('▲ +' if c > 0 else '▼ −' if c < 0 else '') + n(abs(c), 1) + ' €'
            else:
                t = ('▲ +' if c > 0 else '▼ −' if c < 0 else '') + n(abs(r['pct']), 1) + ' %'
            return f'<span style="color:{colr}">{t}</span>'
        trs = ''.join(f'<tr><td style="{f};padding:7px 8px 7px 0;border-bottom:1px solid #F2F2F2;font-size:14px;color:#121212"><a href="{SITE}#{esc(r.get("page") or "today")}" style="color:#121212;text-decoration:none">{esc(r["label"][0])}</a></td>'
                      f'<td style="{mono};padding:7px 8px;border-bottom:1px solid #F2F2F2;font-size:13.5px;text-align:right;white-space:nowrap">{n(r["value"], 0 if r.get("hours") else 2)} {esc(r.get("unit") or ("h" if r.get("hours") else ""))}</td>'
                      f'<td style="{mono};padding:7px 0 7px 8px;border-bottom:1px solid #F2F2F2;font-size:13px;text-align:right;white-space:nowrap">{chg(r)}</td></tr>' for r in mk)
        srcs = ', '.join(sorted({r.get('src') for r in mk if r.get('src')}))
        body.append(row(kick('La semaine en chiffres') + f'<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td style="{f};font-size:11px;color:#8A8A8A;padding-bottom:4px">Marché</td><td style="{f};font-size:11px;color:#8A8A8A;text-align:right;padding-bottom:4px">Valeur</td><td style="{f};font-size:11px;color:#8A8A8A;text-align:right;padding-bottom:4px">Sur la semaine</td></tr>{trs}</table>'
                        f'<p style="{f};font-size:11px;color:#8A8A8A;margin:6px 0 0">Sources : {esc(srcs)}. Chaque ligne ouvre sa page sur le site.</p>'))
    # ── the week ahead ──
    wa = [x for x in E.get('week_ahead') or [] if x.get('date', '') >= str(today)]   # what is still ahead on the day it is read
    if wa:
        def wl_(x):
            dd = date.fromisoformat(x['date'])
            label = ('Fin de consultation : ' if x['kind'] == 'cons' else '') + x['title']
            return (f'<tr><td style="{f};padding:6px 12px 6px 0;border-bottom:1px solid #F2F2F2;font-size:14px;font-weight:700;color:#B8322D;white-space:nowrap;vertical-align:top">{jours[dd.weekday()]} {dd.day}</td>'
                    f'<td style="{f};padding:6px 0;border-bottom:1px solid #F2F2F2;font-size:14.5px;line-height:1.4">{a(x["link"], label) if x.get("link") else esc(label)}'
                    + (f'<br><span style="font-size:13px;color:#6B6B6B">{esc(x["text"])}</span>' if x.get('text') else '') + '</td></tr>')
        body.append(row(kick('La semaine à venir') + '<table role="presentation" width="100%" style="border-collapse:collapse">' + ''.join(wl_(x) for x in wa) + '</table>'))
    # ── one block per theme: the brief's analysis, then its articles ──
    ana = {}
    for t, x in paras:
        for k, rx in BRUNCH_TOPIC:
            if re.search(rx, t, re.I):
                ana.setdefault(k, []).append(x)
                break
    arts = {}
    for h in st:
        arts.setdefault(brunch_sec(h), []).append(h)
    for k, name in BRUNCH_SEC:
        if not ana.get(k) and not arts.get(k):
            continue
        inner = kick(name) + ''.join(f'<p style="{f};margin:0 0 12px;font-size:15.5px;line-height:1.6;color:#121212">{esc(x)}</p>' for x in ana.get(k) or [])
        for h in arts.get(k) or []:
            kp = keep(h)
            inner += (f'<div style="margin:6px 0 14px"><p style="{serif};margin:0 0 6px;font-size:19px;line-height:1.28;font-weight:700">{a(h["link"], h["title"])}</p>'
                      + (f'<p style="{f};margin:0 0 6px;font-size:15px;line-height:1.5;color:#383838"><b style="color:{green}">À retenir.</b> {esc(kp)}</p>' if kp else '')
                      + f'<p style="{f};margin:0;font-size:12.5px;color:#6B6B6B">{theme_pill(h.get("tags"))}{" " if theme_pill(h.get("tags")) else ""}{esc(" · ".join(h["sources"][:3]))}</p>' + report(h) + free(h) + '</div>')
        body.append(row(inner))
    if mine:
        body.append(row(kick('Vos mots-clés') + ''.join(f'<p style="{f};margin:0;padding:7px 0;border-bottom:1px solid #F2F2F2;font-size:14.5px;line-height:1.4">{a(o["link"], o["title"])} <span style="color:#6B6B6B;font-size:12px">· {esc(o["source"])}</span></p>' for o in mine)))
    # ── in brief ──
    shown = {h['link'] for h in st}
    br = [o for o in E.get('top') or [] if o['link'] not in shown][:6]
    if br:
        body.append(row(kick('La semaine en bref') + ''.join(f'<p style="{f};margin:0;padding:8px 0;border-bottom:1px solid #F2F2F2;font-size:15px;line-height:1.4">{theme_pill(o.get("tags"))} {a(o["link"], o["title"])} <span style="color:#8A8A8A;font-size:12px">{esc(o["source"])}</span></p>' for o in br)))
    foot = (f'<tr><td style="padding:16px 22px 22px;background:#FFFFFF"><p style="{f};font-size:12px;color:#6B6B6B;line-height:1.6;margin:0;text-align:center">'
            f'Sujets choisis pour vous · résumés écrits à partir des titres et extraits publics.<br>'
            f'<a href="{SITE}#intel/news" style="color:{green}">Voir en ligne</a> · <a href="{SITE}#intel/news" style="color:{green}">Changer mes sujets</a> · <a href="{SITE}#intel/news" style="color:{green}">Se désabonner</a></p></td></tr>')
    html = outlook('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EF;border-collapse:collapse"><tr><td align="center" style="padding:16px 6px">'
                   '<!--[if mso]><table role="presentation" width="680" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->'
                   '<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;border-collapse:collapse;table-layout:fixed;word-wrap:break-word;overflow-wrap:anywhere;background:#FFFFFF;border-radius:12px">'
                   + head + ''.join(body) + foot + '</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table>')
    text = f'PowerBrunch · {span}\n\n' + (f'{wl.get("title")}\n{wl.get("text") or ""}\n\n' if wl.get('title') else '') + \
        '\n'.join(f'• {h["title"]}\n  {h.get("what") or ""}\n  {h["link"]}' for h in st) + f'\n\n{SITE}#intel/news\n'
    return f'PowerBrunch · la {span}', text, html + ''.join(f'<!--img:{x}-->' for x in dict.fromkeys(imgs))


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
    items = [i for i in (load('news.json') or {}).get('items') or [] if not i.get('noai')]   # AleaSoft refuses AI use
    since = (datetime.now(PARIS) - timedelta(hours=72 if monday else 24)).isoformat()
    import unicodedata
    plain = lambda t: unicodedata.normalize('NFKD', (t or '').lower()).encode('ascii', 'ignore').decode()  # noqa: E731   accents left out: « echelonnement » finds « échelonnement »
    has = lambda i, ws: any(re.search(r'\b' + re.escape(plain(w)) + r'\b', plain(i.get('title', '') + ' ' + (i.get('snippet') or ''))) or (i.get('query') or '').lower() == w.lower() for w in ws)  # noqa: E731
    out = [i for i in items if (i.get('date') or '') >= since and has(i, kw) and not has(i, exclude)]
    return sorted(out, key=lambda i: -(i.get('impact') or 0))[:6]


LIGHT_ONLY = re.compile(r'background:(#[0-9A-Fa-f]{6})(?!;background-image)')


def light_only(html):
    """the mail as a whole document that asks to stay in its own colours (the owner, 25 Nov. 2026: a reader in dark mode
    saw the colours inverted): Apple Mail, iOS Mail and Outlook read the color-scheme meta; the Gmail apps do not, but
    they leave a background-image alone, so every coloured background is given again as a plain gradient"""
    html = LIGHT_ONLY.sub(lambda m: f'background:{m[1]};background-image:linear-gradient({m[1]},{m[1]})', html)
    return ('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">'
            '<style>:root{color-scheme:light only;supported-color-schemes:light only}</style></head>'
            f'<body style="margin:0;padding:0;background:#F1F1EF">{html}</body></html>')


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
            msg.add_alternative(light_only(html), subtype='html')
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


def web_copy(html):
    """the e-mail as a web page (Veille › Newsletter on the site, the admin's only): the attached images (cid:) pointed at
    the site's own files, so the page is the e-mail exactly (the owner, 25 Nov. 2026)"""
    for rel in re.findall(r'<!--img:([^>]+)-->', html):
        web = os.path.normpath(os.path.join('data', rel)).replace(os.sep, '/')
        html = html.replace(f'src="cid:{esc(os.path.basename(rel))}"', f'src="{web}"')
    return re.sub(r'<!--img:[^>]+-->', '', html)


def html_only(today, weekly):
    """--html-only: write the edition as the admin receives it (their subjects, else the general edition) to
    data/newsletter_mail.html (7 O'Klock) or data/newsletter_week_mail.html (PowerBrunch), for the site; nothing sent"""
    E = load('newsletter_week.json' if weekly else 'newsletter.json') or {}
    if not E.get('profiles'):
        print('no edition: nothing written'); return 0
    pid = os.environ.get('MORNING_PROFILE') or 'origination'
    pid = pid if pid in E['profiles'] else next(iter(E['profiles']))
    adm = set(a.lower() for a in admins())
    me = next((r for r in readers(today, weekly) if (r['to'] or '').lower() in adm), None) if adm else None
    day = date.fromisoformat(E['date']) if E.get('date') else today
    if me:
        ps = [p for p in me['profiles'] if p in E['profiles']] or list(E['profiles'])
        _, _, html = render_letter(day, E, ps, [], me['exclude'], me['interests'], me['france'])
    else:
        _, _, html = render_letter(day, E, pid)
    out = os.path.join(D, 'newsletter_week_mail.html' if weekly else 'newsletter_mail.html')
    with open(out, 'w') as f:
        f.write(web_copy(html))
    print('written', out, '(the admin\'s edition)' if me else '(general edition)')
    return 0


def main():
    if '--html-only' in sys.argv:
        return html_only(datetime.now(PARIS).date(), '--weekly' in sys.argv)
    today, rows, lines, heading = build()
    subject, text, html = render(today, rows, lines, heading)
    # the newsletter when today's edition exists (scripts/news_letter.py), for the profile MORNING_PROFILE (default: origination)
    weekly = '--weekly' in sys.argv   # PowerBrunch (Monday at 08:00) instead of 7 O'Klock
    E = load('newsletter_week.json' if weekly else 'newsletter.json') or {}
    has_letter = E.get('date') == today.isoformat() and bool(E.get('profiles'))
    pid = os.environ.get('MORNING_PROFILE') or 'origination'
    if has_letter and pid in E['profiles']:
        subject, text, html = render_letter(today, E, pid)
    # each reader who asked for it in the site gets the edition of their profile(s); nobody else
    personal = []
    if has_letter:
        for r in readers(today, weekly):
            ps = [p for p in r['profiles'] if p in E['profiles']] or ([] if r['interests'] else [pid])   # interests: every profile's stories, the reader's subjects first
            ps = ps or list(E['profiles'])
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
