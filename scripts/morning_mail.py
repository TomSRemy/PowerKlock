#!/usr/bin/env python3
"""The morning e-mail: Today's quick look in an inbox, every weekday.

France spot today and tomorrow (or the PowerKlock forecast until the auction), the key prices with their
move on the day (Cal+1 France, TTF, EUA, Brent), the PPA benchmark, the hours at 0 € or below expected
tomorrow, three market-moving headlines, and a link to the site. Everything comes from the repository's
data files: no call to any service except the mail server.

Environment (GitHub secrets)
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_FROM   the same mail server as the alerts
  MORNING_TO        recipients, comma-separated; without it (or without SMTP) the mail is only printed
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
    neg = (load('neg_forecast.json') or {}).get('days', {}).get((today + timedelta(days=1)).isoformat())
    if t:
        rows.append(('Spot France aujourd’hui', f'{n(t["base"])} €/MWh', f'pointe {n(t["peak"])} · min {n(t["min"])} · max {n(t["max"])}' + (f' · {t["neg"]} h à 0 € ou moins' if t['neg'] else '')))
    if tm:
        rows.append(('Spot France demain', f'{n(tm["base"])} €/MWh', (s(tm['base'] - t['base']) + ' € vs aujourd’hui') if t else ''))
    elif neg and neg.get('price'):
        pv = [x for x in neg['price'] if x is not None]
        rows.append(('Demain (prévision)', f'≈ {n(sum(pv) / len(pv), 0)} €/MWh', f'{n(neg.get("expected_hours"), 1)} h à 0 € ou moins attendues · prix publié vers 13 h'))
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
    f = 'font-family:Inter,Arial,sans-serif'
    serif = 'font-family:Georgia,\'Times New Roman\',serif'
    h2 = lambda t: f'<p style="{f};font-size:11px;font-weight:700;letter-spacing:1px;color:#5F738A;margin:0 0 10px;text-transform:uppercase">{t}</p>'  # noqa: E731
    box = lambda inner: f'<tr><td style="padding:18px 20px;border-bottom:1px solid #E6ECF2">{inner}</td></tr>'  # noqa: E731
    a = lambda u, t, st='': f'<a href="{esc(u)}" style="color:#13202E;text-decoration:none;{st}">{esc(t)}</a>'  # noqa: E731
    short = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
    ddm = lambda d: f'{int(str(d)[8:10])} {short[int(str(d)[5:7]) - 1]}'  # noqa: E731

    def num(v, d=2):
        return n(v, d)

    def markets():
        # the price tiles, three per row; each opens its page of the site
        rs = E.get('markets') or []
        if not rs:
            return ''
        cells = []
        for r in rs:
            c = r.get('chg') or 0
            up = c < 0 if r.get('hours') else c > 0      # more hours at 0 € or below: lower prices, in green
            col = '#5F738A' if not c else '#B8322D' if up else '#0E7A5F'
            if r.get('hours'):
                pct = '' if r.get('chg') is None else ('▲ +' if c > 0 else '▼ −' if c < 0 else '= ') + n(abs(c), 0) + ' h'
            elif r.get('show') == 'abs':
                pct = '' if r.get('chg') is None else ('▲ +' if c > 0 else '▼ −' if c < 0 else '= ') + n(abs(c), 1) + ' €'
            else:
                pct = '' if r.get('pct') is None else ('▲ +' if c > 0 else '▼ −' if c < 0 else '') + n(abs(r['pct']), 1) + ' %'
            cells.append(f'<td width="33%" style="padding:3px;vertical-align:top"><a href="{SITE}#{esc(r.get("page") or "today")}" style="display:block;text-decoration:none;border:1px solid #D5DEE8;border-radius:10px;padding:9px 10px;background:#F7F9FB">'
                         f'<span style="{f};display:block;font-size:12px;color:#5F738A">{esc(r["label"][0])}</span>'
                         f'<span style="font-family:Menlo,Consolas,monospace;display:block;font-size:17px;font-weight:700;color:#13202E;margin:4px 0 2px">{num(r["value"], 0 if r.get("hours") and float(r["value"]).is_integer() else 1 if r.get("hours") else 2)}</span>'
                         f'<span style="{f};font-size:11px;color:#62758B">{esc(r["unit"])}</span> <span style="font-family:Menlo,Consolas,monospace;font-size:12px;color:{col};white-space:nowrap">{pct}</span>'
                         + (f'<span style="{f};display:block;font-size:11px;color:#34485E;margin-top:4px">{esc(r["sub"][0])}</span>' if r.get('sub') else '') + '</a></td>')
        rows_ = ''.join('<tr>' + ''.join(cells[i:i + 3]) + ''.join('<td width="33%"></td>' for _ in range(3 - len(cells[i:i + 3]))) + '</tr>' for i in range(0, len(cells), 3))
        srcs = ', '.join(sorted({r.get('src') for r in rs if r.get('src')}))
        return box(h2(SEC['markets']) + f'<table role="presentation" width="100%" style="border-collapse:collapse;table-layout:fixed">{rows_}</table>'
                   f'<p style="{f};font-size:11px;color:#62758B;margin:8px 0 0">Sources : {esc(srcs)}. {"Variation sur la semaine" if wk else "Variation sur la séance précédente"}. Chaque tuile ouvre sa page sur le site.</p>')

    def digest():
        d = E.get('digest') or {}
        if not d.get('items'):
            return ''
        li = ''.join(f'<li style="margin:0 0 8px">{esc(x.get("text") or x.get("title"))} <a href="{esc(x.get("link") or SITE)}" style="color:#0B7A62;text-decoration:none;font-size:12px;white-space:nowrap">{esc(" · ".join((x.get("sources") or [])[:2]))} ↗</a></li>' for x in d['items'])
        return box(h2('La semaine en 5 sujets' if d.get('weekly') else SEC['digest']) + f'<ol style="{f};margin:0;padding-left:20px;font-size:15px;line-height:1.5;color:#13202E">{li}</ol>')

    def top():
        if not E.get('top'):
            return ''
        return box(h2('Les articles de la semaine' if wk else SEC['top']) + ul([f'{a(o["link"], o["title"])} <span style="color:#62758B;font-size:12px">· {esc(o["source"])}{" +" + str(o["n"] - 1) if (o.get("n") or 1) > 1 else ""}</span>' for o in E['top']]))

    def stories():
        if not ed.get('stories'):
            return ''
        out = ''
        for k, st in enumerate(ed['stories']):
            out += (f'<p style="{serif};font-size:19px;line-height:1.35;font-weight:600;margin:{0 if k == 0 else 18}px 0 6px">{k + 1}. {a(st["link"], st["title"])}</p>'
                    + (f'<p style="{f};font-size:15px;line-height:1.55;color:#34485E;margin:0 0 6px"><b style="color:#13202E">Ce qui s’est passé.</b> {esc(st["what"])}</p>' if st.get('what') else '')
                    + (f'<p style="{f};font-size:15px;line-height:1.55;color:#34485E;margin:0 0 6px;background:#EEF8F5;padding:10px 12px;border-radius:8px"><b style="color:#0B7A62">Pour vous, {esc((st.get("short") or ed["short"][0]).lower())}.</b> {esc(st["for_you"])}</p>' if st.get('for_you') else '')
                    + f'<p style="{f};font-size:12px;color:#62758B;margin:0">{esc(" · ".join(st["sources"][:4]))}</p>')
        return box(h2('Les sujets de la semaine' if wk else SEC['stories']) + out)

    def ul(rows):
        return f'<ul style="{f};margin:0;padding-left:18px;font-size:14px;line-height:1.5;color:#34485E">' + ''.join(f'<li style="margin:0 0 7px">{r}</li>' for r in rows) + '</ul>'

    def cons():
        if not E.get('cons'):
            return ''
        tr = ''
        for c in E['cons']:
            left = (date.fromisoformat(c['deadline']) - today).days if c.get('deadline') else None
            j = '' if left is None else 'auj.' if left == 0 else f'J-{left}'
            col = '#B8322D' if left is not None and left <= 7 else '#34485E'
            tr += (f'<tr><td style="font-family:Menlo,Consolas,monospace;padding:6px 12px 6px 0;color:{col};font-weight:600;white-space:nowrap;vertical-align:top;font-size:13px">{j}</td>'
                   f'<td style="{f};padding:6px 0;font-size:14px;line-height:1.4">{a(c["link"], c["title"])} <span style="color:#62758B;font-size:12px">· {esc(c["source"])}</span></td></tr>')
        return box(h2(SEC['cons']) + f'<table role="presentation" width="100%" style="border-collapse:collapse">{tr}</table>')

    secs = {
        'markets': markets, 'digest': digest, 'top': top, 'stories': stories, 'cons': cons,
        'official': lambda: box(h2(SEC['official']) + ul([f'{a(o["link"], o["title"])} <span style="color:#62758B;font-size:12px">· {esc(o["source"])}, {ddm(o["date"])}</span>' for o in E['official']])) if E.get('official') else '',
        'pubs': lambda: box(h2(SEC['pubs']) + ul([f'{a(o["link"], o["title"])} <span style="color:#62758B;font-size:12px">· {esc(o["source"])}</span>' for o in E['pubs']])) if E.get('pubs') else '',
        'agenda': lambda: box(h2(SEC['agenda']) + ul([f'<b>{ddm(e["date"])}</b> · {esc((e.get("title") or [""])[0])}' for e in E['agenda']])) if E.get('agenda') else '',
        'post': lambda: box(h2('Les posts de la semaine' if wk else SEC['post']) + ul([a(p_["url"], (p_.get("author") or "LinkedIn") + (" · " + p_["note"] if p_.get("note") else "")) for p_ in (E.get('posts') or [E['post']])])) if E.get('post') else '',
    }
    # the articles of the last day that match the reader's own keywords (public.news_keyword), after the stories
    secs['mine'] = lambda: box(h2('Vos mots-clés') + ul([f'{a(o["link"], o["title"])} <span style="color:#62758B;font-size:12px">· {esc(o["source"])}</span>' for o in mine])) if mine else ''
    order = list(ed.get('order') or secs)
    order.insert(order.index('stories') + 1 if 'stories' in order else len(order), 'mine')
    body = ''.join(secs[k]() for k in order if k in secs)
    one = box(h2('En une phrase') + f'<p style="{serif};font-size:19px;line-height:1.45;margin:0;color:#13202E">{esc(ed["headline"])}</p>') if ed.get('headline') else ''
    html = (f'<div style="background:#E9EEF3;padding:16px 6px"><table role="presentation" width="100%" style="max-width:680px;margin:0 auto;border-collapse:collapse;table-layout:fixed;word-wrap:break-word;overflow-wrap:anywhere;background:#FFFFFF;border:1px solid #D5DEE8;border-radius:12px">'
            f'<tr><td style="background:#0a0e13;padding:22px 28px;border-radius:12px 12px 0 0">'
            f'<p style="{f};margin:0;font-size:13px;color:#B8C9D9"><span style="font-weight:700;color:#14D3A9">PowerKlock</span> · {frday(today)}</p>'
            f'<p style="{serif};margin:8px 0 4px;font-size:30px;font-weight:600;color:#FFFFFF">{TITLE[wk]}</p>'
            f'<p style="{f};margin:0 0 4px;font-size:13px;color:#B8C9D9">{SUB[wk]}</p>'
            f'<p style="{f};margin:0;font-size:13px;color:#B8C9D9">Édition <b style="color:#FFFFFF">{esc(ed["name"][0])}</b>{" · semaine du " + frday(today - timedelta(days=7)) if wk else " · depuis vendredi" if E.get("monday") else ""}</p></td></tr>'
            + one + body +
            f'<tr><td style="padding:16px 28px;background:#F3F6F9;border-radius:0 0 12px 12px"><p style="{f};font-size:12px;color:#62758B;line-height:1.6;margin:0">'
            f'Sujets choisis pour le profil {esc(ed["name"][0])} ; résumés rédigés automatiquement à partir des titres et extraits, chaque sujet renvoie à ses articles.<br>'
            f'<a href="{SITE}#intel/news" style="color:#0B7A62">Voir en ligne et changer de profil</a></p></td></tr></table></div>')
    text = f'{TITLE[wk]} · {frday(today)} · édition {ed["name"][0]}\n\n' + (ed.get('headline') or '') + '\n\n' + \
        '\n'.join(f'{r["label"][0]} : {n(r["value"])} {r["unit"]}' for r in E.get('markets') or []) + '\n\n' + \
        '\n'.join(f'• {st["title"]}\n  {st.get("what") or ""}\n  {st["link"]}' for st in ed.get('stories') or []) + f'\n\n{SITE}#intel/news\n'
    subject = f'{TITLE[wk]} · {frday(today)}' if not wk else f'PowerBrunch · la semaine du {frday(today - timedelta(days=7))}'
    return subject, text, html


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
    has = lambda i, ws: any(re.search(r'\b' + re.escape(w.lower()) + r'\b', (i.get('title', '') + ' ' + (i.get('snippet') or '')).lower()) for w in ws)  # noqa: E731
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
    # each reader who chose it in the site gets the edition of their profile; the team list (MORNING_TO) the default one
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
    seen = {m[0][0].lower() for m in personal}
    to = [x.strip() for x in (os.environ.get('MORNING_TO') or '').split(',') if x.strip() and x.strip().lower() not in seen]
    mails = ([(to, subject, text, html)] if to else []) + personal
    ready = all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')) and mails
    if os.environ.get('MORNING_DRY_RUN') == '1' or not ready:
        print(subject + '\n\n' + text + ('' if ready else '\n(not sent: SMTP_* or recipients missing)'))
        if not all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')):
            print('::warning::nothing sent: the SMTP_HOST, SMTP_USER and SMTP_PASS secrets are not set')
        print(f'{len(personal)} personal edition(s) prepared')
        return 0
    send(mails)
    print('sent:', len(to), 'on the team list,', len(personal), 'personal edition(s)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
