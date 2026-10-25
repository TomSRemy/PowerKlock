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
import os
import smtplib
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data')
SITE = 'https://powerklock.powerklock-tool.workers.dev/'
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
    news = sorted([i for i in ((load('news.json') or {}).get('items') or []) if (i.get('impact') or 0) >= 3], key=lambda i: -(i.get('impact') or 0))[:3]
    for i in news:
        lines.append((i.get('title') or '', i.get('link') or SITE, i.get('source') or ''))
    return today, rows, lines


def render(today, rows, lines):
    subject = f'PowerKlock · {frday(today)}' + (f' · spot {rows[0][1]}' if rows else '')
    text = '\n'.join(f'{a} : {b}  {c}' for a, b, c in rows) + '\n\n' + '\n'.join(f'• {t} ({src}) {u}' for t, u, src in lines) + f'\n\n{SITE}#today\n'
    tr = ''.join(f'<tr><td style="padding:7px 10px;color:#5F738A">{a}</td><td style="padding:7px 10px;font-weight:700;color:#13202E;white-space:nowrap">{b}</td>'
                 f'<td style="padding:7px 10px;color:#5F738A;font-size:13px">{c}</td></tr>' for a, b, c in rows)
    li = ''.join(f'<li style="margin:0 0 6px"><a href="{u}" style="color:#0E9E7E;text-decoration:none">{t}</a> <span style="color:#8DA3BA;font-size:12px">{src}</span></li>' for t, u, src in lines)
    html = (f'<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#13202E">'
            f'<p style="font-size:20px;font-weight:700;margin:0 0 2px">Power<span style="color:#0E9E7E">.Klock</span></p>'
            f'<p style="color:#5F738A;margin:0 0 14px">Le point du matin · {frday(today)}</p>'
            f'<table style="border-collapse:collapse;width:100%;font-size:14px;border-top:1px solid #E6ECF2">{tr}</table>'
            + (f'<p style="font-weight:600;margin:18px 0 6px">Dans l’actualité</p><ul style="padding-left:18px;margin:0">{li}</ul>' if li else '')
            + f'<p style="margin:20px 0 0"><a href="{SITE}#today" style="background:#0E9E7E;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Ouvrir Aujourd’hui</a></p>'
            f'<p style="color:#8DA3BA;font-size:11px;margin:18px 0 0">Sources : ENTSO-E, RTE, données de marché, PowerKlock. Prix forward = dernière cotation.</p></div>')
    return subject, text, html


def main():
    today, rows, lines = build()
    subject, text, html = render(today, rows, lines)
    to = [x.strip() for x in (os.environ.get('MORNING_TO') or '').split(',') if x.strip()]
    ready = all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')) and to
    if os.environ.get('MORNING_DRY_RUN') == '1' or not ready:
        print(subject + '\n\n' + text + ('' if ready else '\n(not sent: SMTP_* or MORNING_TO missing)'))
        return 0
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = os.environ.get('ALERT_FROM') or os.environ['SMTP_USER']
    msg['To'] = ', '.join(to)
    msg.set_content(text)
    msg.add_alternative(html, subtype='html')
    with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT') or 587), timeout=60) as srv:
        srv.starttls()
        srv.login(os.environ['SMTP_USER'], os.environ['SMTP_PASS'])
        srv.send_message(msg)
    print('sent to', len(to), 'recipient(s)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
