#!/usr/bin/env python3
"""Hourly table for the coupling study, 1 Jan 2020 – last complete day, delivery days in Paris time.

Sources (all already in the repo, except the commercial exchanges fetched by fetch_cbet.py):
- day-ahead prices: data/history/daily/<D>.json (ENTSO-E; 96 quarter-hours, repeated by 4 before 1 Oct 2025),
  zones FR, DE_LU, BE, NL, ES, IT_NORD, CH; GB from the daily file in 2020 (still coupled), then
  data/history/gb_hourly (Elexon market index, € at the day's rate)
- French output by fuel, load, exchanges: data/history/rte (RTE éCO2mix, 30 min → hourly mean)
- French available nuclear: data/history/commodities_series.json fr_nuc_avail (ENTSO-E, daily)
- France's Core limits: data/history/jao_core (JAO maxNetPos / minNetPos, from 8 June 2022)
- physical flows by border: data/history/flows (Energy-Charts cbpf, hourly)
- scheduled commercial exchanges by border: Energy-Charts cbet (15 min), /tmp/coupl/cbet_<month>.json
- fuels: TTF, EUA, API2 coal (commodities_series.json; World Bank monthly coal before 2022)
Output: /tmp/coupl/hourly.npz (days × 24 arrays) and /tmp/coupl/qh.npz (prices days × 96)."""
import json, os, glob, sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import ppa_merit as M

H = f'{ROOT}/data/history'
PAR = ZoneInfo('Europe/Paris')
ZONES = ('FR', 'DE_LU', 'BE', 'NL', 'ES', 'IT_NORD', 'CH', 'GB')
BORDERS = {'BE': 'Belgium', 'DE': 'Germany', 'ES': 'Spain', 'IT': 'Italy', 'CH': 'Switzerland', 'GB': 'United Kingdom'}

start, end = date(2020, 1, 1), date(2026, 10, 29)
days = []
d = start
while d <= end:
    days.append(d.isoformat()); d += timedelta(days=1)
nd = len(days)

# ── prices, 96 quarter-hours ────────────────────────────────────────────────
qh = {z: np.full((nd, 96), np.nan) for z in ZONES}
gb = {}
for f in glob.glob(f'{H}/gb_hourly/*.json'):
    gb.update(json.load(open(f))['days'])
for i, d in enumerate(days):
    try:
        zs = json.load(open(f'{H}/daily/{d}.json'))['zones']
    except OSError:
        continue
    for z in ZONES:
        a = (zs.get(z) or {}).get('hourly')
        if a and len(a) == 96:
            qh[z][i] = [np.nan if x is None else x for x in a]
    if d >= '2021-01-01' or not np.isfinite(qh['GB'][i]).any():
        p = (gb.get(d) or {}).get('p')
        qh['GB'][i] = np.repeat([np.nan if x is None else x for x in p], 4) if p and len(p) == 24 else np.nan
hp = {z: np.nanmean(qh[z].reshape(nd, 24, 4), 2) for z in ZONES}

# ── RTE éCO2mix hourly ──────────────────────────────────────────────────────
F = ('nuclear', 'wind', 'solar', 'hydroRoR', 'hydroLake', 'hydroPS', 'pumping', 'gas', 'coal', 'oil', 'bio', 'load', 'exchanges',
     'batteryCharge', 'batteryDischarge')
eco = {k: np.full((nd, 24), np.nan) for k in F}
idx = {d: i for i, d in enumerate(days)}
for f in sorted(glob.glob(f'{H}/rte/20*.json')):
    if os.path.basename(f) < '2020-01':
        continue
    for d, v in json.load(open(f))['days'].items():
        if d not in idx or not v.get('load'):
            continue
        n = len(v['load'])
        if n not in (48, 96):
            continue
        for k in F:
            a = v.get(k)
            a = np.array([np.nan if x is None else x for x in a], float) if a else np.zeros(n)
            if len(a) == n:
                eco[k][idx[d]] = a.reshape(24, -1).mean(1)

# ── nuclear availability, JAO, fuels ────────────────────────────────────────
avail = np.repeat(M.daily('fr_nuc_avail', days)[:, None], 24, 1)
cst = M.costs(days)
ccgt = (cst['ttf'] / 0.55 + 0.37 * cst['eua'])                   # gas plant short-run cost, €/MWh (same as ppa_scenarios.fuel_cost)
coal = (cst['coal'] / 0.38 + 0.90 * cst['eua'])                 # hard-coal plant, 38 % efficiency, 0.90 t/MWh
jmax = np.full((nd, 24), np.nan); jmin = np.full((nd, 24), np.nan)
for f in glob.glob(f'{H}/jao_core/*.json'):
    for d, v in json.load(open(f))['days'].items():
        if d in idx and v.get('maxFR') and len(v['maxFR']) == 24:
            jmax[idx[d]] = [np.nan if x is None else x for x in v['maxFR']]
            jmin[idx[d]] = [np.nan if x is None else x for x in v['minFR']]

# ── physical flows (+ import into France) ───────────────────────────────────
phys = {b: np.full((nd, 24), np.nan) for b in BORDERS}
for f in glob.glob(f'{H}/flows/*.json'):
    for d, v in json.load(open(f))['days'].items():
        fr = (v or {}).get('FR') or {}
        if d in idx:
            for b in BORDERS:
                a = fr.get(b)
                if a and len(a) == 24:
                    phys[b][idx[d]] = [np.nan if x is None else x for x in a]

# ── scheduled commercial exchanges, 15 min, GW in the file (+ import into France) → MW, Paris quarter-hour ──
comm = {b: np.full((nd, 96), np.nan) for b in BORDERS}
cnt = {b: np.zeros((nd, 96)) for b in BORDERS}
for f in sorted(glob.glob('/tmp/coupl/cbet_*.json')):
    j = json.load(open(f))
    ts = j['unix_seconds']
    loc = [datetime.fromtimestamp(t, timezone.utc).astimezone(PAR) for t in ts]
    for c in j['countries']:
        b = next((k for k, v in BORDERS.items() if v == c['name']), None)
        if not b:
            continue
        for t, x in zip(loc, c['data']):
            i = idx.get(t.date().isoformat())
            if i is None or x is None:
                continue
            s = t.hour * 4 + t.minute // 15
            comm[b][i, s] = (0 if cnt[b][i, s] == 0 else comm[b][i, s]) + x * 1000
            cnt[b][i, s] += 1
for b in BORDERS:
    comm[b] = np.where(cnt[b] > 0, comm[b] / np.maximum(cnt[b], 1), np.nan)   # the repeated hour in October: mean
commh = {b: np.nanmean(comm[b].reshape(nd, 24, 4), 2) for b in BORDERS}

np.savez_compressed('/tmp/coupl/hourly.npz', days=np.array(days), avail=avail, ccgt=ccgt, coal=coal, ttf=cst['ttf'], eua=cst['eua'],
                    jmax=jmax, jmin=jmin, **{f'p_{z}': hp[z] for z in ZONES}, **{f'e_{k}': eco[k] for k in F},
                    **{f'phys_{b}': phys[b] for b in BORDERS}, **{f'comm_{b}': commh[b] for b in BORDERS})
np.savez_compressed('/tmp/coupl/qh.npz', days=np.array(days), **{f'p_{z}': qh[z] for z in ZONES}, **{f'comm_{b}': comm[b] for b in BORDERS})
print(nd, 'days; FR price hours', int(np.isfinite(hp['FR']).sum()), '; éCO2mix hours', int(np.isfinite(eco['load']).sum()),
      '; commercial hours', {b: int(np.isfinite(commh[b]).sum()) for b in BORDERS})
