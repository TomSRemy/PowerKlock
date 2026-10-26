"""Live-site monitor: every hour (.github/workflows/monitor.yml) the published site is checked the way a visitor
would see it, and an e-mail goes out when something breaks or comes back (not every hour while it stays broken).

Checks
  1. the site answers (Cloudflare address; GitHub Pages if Cloudflare is down or behind a login)
  2. data on time, with the hour it is expected (Paris):
       today's day-ahead prices · tomorrow's after 13:30 · the PowerKlock forecast for tomorrow from 10:00 ·
       news within 12 h · market closes within 4 days · RTE French system within 2 days · TSO forecasts within 12 h
  3. in a browser: Today and Day-ahead open without a script error and show prices
State (problems already reported) lives in monitor_state.json, kept between runs by the workflow's cache.
Exit code 0 always: the e-mail is the alert; the run's summary lists every check.
Run locally:  python scripts/monitor_live.py [base_url]"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

PARIS = ZoneInfo('Europe/Paris')
BASES = [sys.argv[1]] if len(sys.argv) > 1 else ['https://powerklock.powerklock-tool.workers.dev/', 'https://tomsremy.github.io/PowerKlock/']
STATE = os.environ.get('MONITOR_STATE', 'monitor_state.json')
now = datetime.now(timezone.utc)
paris = now.astimezone(PARIS)
today, tomorrow = paris.date().isoformat(), (paris.date() + timedelta(days=1)).isoformat()


def get(base, path, as_json=True):
    try:
        r = requests.get(base + path, timeout=30, headers={'Cache-Control': 'no-cache'}, allow_redirects=False)
        if r.status_code != 200:
            return None, r.status_code
        return (r.json() if as_json else r.text), 200
    except Exception as e:   # noqa: BLE001 — any failure is a finding
        return None, str(e)[:80]


def age_h(iso):
    try:
        t = datetime.fromisoformat(str(iso).replace('Z', '+00:00'))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (now - t).total_seconds() / 3600
    except Exception:   # noqa: BLE001
        return None


def pick_base():
    for b in BASES:
        txt, code = get(b, '', as_json=False)
        if txt and 'PowerKlock' in txt:
            return b, None
    return None, 'site injoignable sur ' + ' et '.join(BASES)


problems, ok = {}, []
base, err = pick_base()
if err:
    problems['site'] = err
else:
    ok.append(f'site : {base}')
    j, _ = get(base, f'data/history/daily/{today}.json')
    if not (j and (j.get('zones') or {}).get('FR', {}).get('avg') is not None):
        problems['prix-jour'] = f'prix day-ahead du {today} absents'
    else:
        ok.append(f'prix du jour : FR {j["zones"]["FR"]["avg"]} €/MWh')
    if paris.hour * 60 + paris.minute >= 13 * 60 + 30:
        j, _ = get(base, f'data/history/daily/{tomorrow}.json')
        if not (j and (j.get('zones') or {}).get('FR', {}).get('avg') is not None):
            problems['prix-demain'] = f'prix day-ahead du {tomorrow} absents à {paris:%H:%M} (publiés vers 13 h)'
        else:
            ok.append('prix de demain publiés')
    if paris.hour >= 10:
        j, _ = get(base, 'data/neg_forecast.json')
        if not (j and tomorrow in (j.get('days') or {})):
            upd = j and j.get('updated')
            problems['prevision'] = f'prévision PowerKlock du {tomorrow} absente à {paris:%H:%M} (dernière mise à jour {upd or "inconnue"})'
        else:
            ok.append('prévision de demain présente')
    for path, key, hours, label in [('data/news.json', 'updated', 12, 'actualités'), ('data/commodities.json', 'updated', 96, 'clôtures de marché'),
                                    ('data/forecast.json', 'updated', 12, 'prévisions des gestionnaires de réseau'), ('data/history/rte/fr_daily.json', 'updated', 48, 'système français (RTE)')]:
        j, code = get(base, path)
        a = age_h(j.get(key)) if isinstance(j, dict) else None
        if a is None:
            problems['donnees-' + label] = f'{label} illisibles ({path}, {code})'
        elif a > hours:
            problems['donnees-' + label] = f'{label} en retard : dernière mise à jour il y a {a:.0f} h (attendu < {hours} h)'
        else:
            ok.append(f'{label} : il y a {a:.0f} h')
    # in a browser, as a visitor
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.add_init_script("localStorage.setItem('pk-lang','fr');localStorage.setItem('pk-first-done','1');sessionStorage.setItem('pk-view-morning','2')")
            pg.goto(base + '#today', wait_until='domcontentloaded', timeout=60000)
            pg.wait_for_timeout(9000)
            cards = pg.evaluate("[...document.querySelectorAll('#mrn2 .mrn-3d .mu-day-avg')].map(e=>e.textContent.trim())")
            if not cards:
                problems['page-today'] = 'Aujourd’hui : aucune carte de prix spot affichée'
            else:
                ok.append('Aujourd’hui : ' + ' / '.join(cards))
            pg.goto(base + '#markets/spot', wait_until='domcontentloaded', timeout=60000)
            pg.wait_for_timeout(7000)
            rows = pg.evaluate("document.querySelectorAll('#prices-tbody tr.zone-row').length")
            if rows < 5:   # 7 zones by default (the zone choice)
                problems['page-spot'] = f'Day-ahead : {rows} zones affichées'
            else:
                ok.append(f'Day-ahead : {rows} zones')
            if errs:
                problems['js'] = 'erreurs de script : ' + ' | '.join(sorted(set(errs))[:3])
            b.close()
    except Exception as e:   # noqa: BLE001
        problems['navigateur'] = f'contrôle navigateur impossible : {str(e)[:100]}'

# what changed since the last run: new problems and those solved
try:
    before = json.load(open(STATE))
except Exception:   # noqa: BLE001
    before = {}
heal_at = before.pop('_heal', {}) if isinstance(before.get('_heal'), dict) else {}
new = {k: v for k, v in problems.items() if k not in before}
solved = [k for k in before if k not in problems]
# self-repair: a late file relaunches the job that writes it (GitHub's scheduler skips runs on busy days),
# at most once every 90 minutes per job; the workflow runs them with `gh workflow run`
JOB = {'prevision': 'fetch_forecast.yml', 'donnees-prévisions des gestionnaires de réseau': 'fetch_forecast.yml', 'prix-jour': 'fetch.yml',
       'prix-demain': 'fetch.yml', 'donnees-clôtures de marché': 'fetch_fr_market.yml', 'donnees-actualités': 'fetch_news.yml', 'donnees-système français (RTE)': 'fetch_rte.yml'}
heal = []
for k in problems:
    job = JOB.get(k)
    if job and job not in heal and (now.timestamp() - heal_at.get(job, 0)) > 90 * 60:
        heal.append(job); heal_at[job] = now.timestamp()
json.dump(dict(problems, _heal=heal_at), open(STATE, 'w'), ensure_ascii=False)
if heal:
    ok.append('relancé : ' + ', '.join(heal))
    if os.environ.get('GITHUB_ENV'):
        with open(os.environ['GITHUB_ENV'], 'a') as f:
            f.write('HEAL=' + ' '.join(heal) + '\n')

lines = [f'Contrôle du site en ligne · {paris:%d/%m/%Y %H:%M} (Paris)', '']
lines += ['À CORRIGER'] + [f'  ✗ {v}' for v in problems.values()] + [''] if problems else ['Tout fonctionne.', '']
lines += ['OK'] + [f'  ✓ {x}' for x in ok]
report = '\n'.join(lines)
print(report)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
        f.write('```\n' + report + '\n```\n')
if os.environ.get('GITHUB_ENV') and (new or solved):
    subj = (f'PowerKlock · {len(new)} problème(s) sur le site en ligne' if new else 'PowerKlock · site rétabli')
    body = (('Nouveau :\n' + '\n'.join(f'  ✗ {v}' for v in new.values()) + '\n\n') if new else '') + \
           (('Réglé depuis le dernier contrôle : ' + ', '.join(solved) + '\n\n') if solved else '') + report + \
           '\n\nUn seul e-mail par changement : tant que rien ne change, pas de nouveau message.\n— PowerKlock'
    with open(os.environ['GITHUB_ENV'], 'a') as f:
        f.write(f'MONITOR_ALERT=1\nSUBJECT={subj}\nBODY<<PKEOF\n{body}\nPKEOF\n')
