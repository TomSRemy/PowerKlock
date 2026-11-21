#!/usr/bin/env python3
"""Rebuild data/drivers/frames.json, the data of Markets › What drives the price (js/drivers.js).

Output, one object per maturity (spot, m1, q1, cal):
  w   weekly frames, oldest first: {d: last day of the week (YYYY-MM-DD, delivery day in Paris time for the spot,
      trading day for the forwards), p: price at the end of the week (€/MWh), r: price a week earlier,
      c: {driver: contribution over the week in €/MWh}, x: {driver: level at the end of the week},
      pv (spot only, when present): the drivers of day d that are still provisional (see below)}
  s   daily price series [[date, €/MWh], ...] (spot: day-ahead base average `avg`; forwards: EEX settlement)
  i, r2, b: weight of each driver, explained share, pass-through of 1 €/MWh of gas. js/drivers.js reads them when
      present and otherwise uses the values of its SENS table (regressions of 8 Nov 2026).
  spot only: firm = last delivery day whose inputs are all final; pv = {day: [provisional drivers]} for the days after.
Plus `updated` at the top (UTC time of the last run that changed a figure): scripts/check_data_freshness.py
watches it, and scripts/check_data_gaps.py flags a last firm spot day that falls behind.

Drivers: ttf (TTF day-ahead, €/MWh), eua (EUA front December, €/t), coal (API2, $/t), wind, sol, load, nuc (France
daily averages in GW from RTE éCO2mix; nuc = available nuclear capacity, in GW: the feed is in MW and revises
its last two or three days, so the nuclear contribution of the latest week can still move), de (German price of
the same maturity, kept as a level only: it is part of the unexplained share).

Firm and provisional days (spot):
  A delivery day is firm once RTE has published at least 88 of its 96 quarter-hours and the TTF close and the
  nuclear availability of that day are published. Only firm days enter the regression.
  The days after the last firm one, up to tomorrow once its day-ahead auction (about 12:45 Paris) is out, are
  shown as provisional frames, with the published day-ahead average and, for what is missing:
    wind, sol, load  RTE quarter-hours already published, the rest from the day-ahead forecasts the site shows
                     (data/fr_fc_combined.json for wind and solar, data/forecast.json, the TSO forecasts, for load
                     and as a fallback)
    nuc              the nuclear availability of the feed as soon as its first value is out (revised values replace
                     it at the next run); before that, an estimate: the fleet capacity seen over the last 7
                     published days (published availability + REMIT unavailability, data/history/fr_outages.json)
                     minus the REMIT unavailability of the day
    ttf              the last TTF close
  Each such frame carries pv; the next runs replace the estimates by the actual figures.

Method (the Method section of the page):
  1. Window: one year of daily data ending on the last forward settlement.
  2. Forwards (M+1, Q+1, Cal+1 France base, rolling front contracts): ordinary least squares of the daily change of
     the price on the daily changes of ttf, eua, coal and nuc. Spot: OLS of the daily level on the levels of ttf,
     wind, load, nuc and sol (firm days only).
  3. Weight of a driver = its share of the explained variance (standardised coefficient × correlation, normalised)
     × R² of the regression; drivers under 1 % are dropped. b = coefficient of ttf (€/MWh of power per €/MWh of gas).
  4. Contribution of a driver over a week = coefficient × change of the driver over that week. The unexplained share
     of a week = price change − sum of the contributions (computed by the page, not stored).
  5. Frames are written for the last 52 weeks (fewer for a contract quoted for less time: M+1 since March 2026).
     The page reads the maturities side by side, counting the weeks from the end: every maturity therefore stops
     at the same week, the last one all of them have reached.

Sources: the warehouse (Supabase, see the powerklock-sql skill and warehouse/) and the repository's own data files,
which the warehouse mirrors. The files are read with the rules of warehouse/sync.py (same averages, same days) and
win over the warehouse, so a day the warehouse has not loaded yet still counts:
  day-ahead       data/history/daily/<D>.json, zone FR, published `avg` (a 25-hour day keeps its published avg)
  RTE éCO2mix     data/history/rte/YYYY-MM.json (wind, solar, load quarter-hours, Paris clock)
  TTF, EUA, API2, nuclear availability   data/history/commodities_series.json then data/commodities.json
  forwards        data/history/fr_market_series.json (FR and DE base M+1, Q+1, Y+1)

Usage:  python3 scripts/build_drivers.py   (the warehouse connection, when there is one, comes from the environment
as in the other warehouse jobs: never a file — SUPABASE_DB_URL or WAREHOUSE_DB_URL; without it the files alone)
Run by .github/workflows/warehouse-sync.yml right after each sync.
"""
import glob
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from statistics import mean
from zoneinfo import ZoneInfo

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT_PATH = os.path.join(DATA, 'drivers', 'frames.json')
PARIS = ZoneInfo('Europe/Paris')
WINDOW_DAYS = 365
MIN_SLOTS = 88   # quarter-hours RTE must have published for a day to count (same limit as scripts/check_data_gaps.py)
NUC_FLEET_DAYS = 7   # published days used to estimate the fleet capacity behind a provisional nuclear availability

# maturity → (forward tenor, drivers regressed on, level-or-diff)
FWD_TENORS = {'m1': 'M+1', 'q1': 'Q+1', 'cal': 'Y+1'}
FWD_DRIVERS = ['ttf', 'eua', 'coal', 'nuc']
SPOT_DRIVERS = ['ttf', 'wind', 'sol', 'load', 'nuc']
ALL_DRIVERS = ['ttf', 'eua', 'coal', 'wind', 'sol', 'load', 'nuc']   # union, for `x` (plus 'de' separately)
COMMODITIES = ('ttf', 'eua', 'coal', 'fr_nuc_avail')


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def num(v):
    """warehouse/sync.py num(): a float, None for anything else or NaN"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def gw_mean(arr):
    """daily mean in GW of a quarter-hour MW array, None while fewer than MIN_SLOTS quarter-hours are published"""
    vals = [v for v in (arr or []) if v is not None]
    return sum(vals) / len(vals) / 1000 if len(vals) >= MIN_SLOTS else None


# ── the warehouse ─────────────────────────────────────────────────────
def db_series(db, since):
    """Same series as files_series(), from the warehouse."""
    import psycopg
    S = {'price': {}, 'wind': {}, 'sol': {}, 'load': {}, 'fwd': {}}
    with psycopg.connect(db, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            def q(sql, params):
                cur.execute(sql, params)
                return {row[0].isoformat(): row[1] for row in cur.fetchall() if row[1] is not None}
            S['price'] = q("""select delivery_date, avg from market.da_price_day
                              where zone='FR' and delivery_date >= %s order by delivery_date""", (since,))
            for key in COMMODITIES:
                S[key] = q("""select trade_date, value from market.commodity_close
                              where key=%s and trade_date >= %s order by trade_date""", (key, since))
            cur.execute("""select delivery_date, wind_mw, solar_mw, load_mw from market.fr_eco2mix_day
                           where delivery_date >= %s order by delivery_date""", (since,))
            for d, w, s, ld in cur.fetchall():
                for arr, k in ((w, 'wind'), (s, 'sol'), (ld, 'load')):
                    v = gw_mean(arr)   # a day still being published (today) would give the mean of its first hours
                    if v is not None:
                        S[k][d.isoformat()] = v
            for mkt in ('FR', 'DE'):
                for tenor in FWD_TENORS.values():
                    S['fwd'][(mkt, tenor)] = q("""select trade_date, value from market.forward_settlement
                                                  where market=%s and tenor=%s and trade_date >= %s order by trade_date""",
                                               (mkt, tenor, since))
    return S


# ── the repository's files (what warehouse/sync.py loads) ─────────────
def files_series(since):
    S = {'price': {}, 'wind': {}, 'sol': {}, 'load': {}, 'fwd': {}}
    # day-ahead: price_row() of warehouse/sync.py, zone FR (the published avg, else the mean of the published slots)
    for path in sorted(glob.glob(os.path.join(DATA, 'history', 'daily', '*.json'))):
        d = os.path.basename(path)[:10]
        if d < since:
            continue
        z = ((read_json(path) or {}).get('zones') or {}).get('FR')
        if not isinstance(z, dict):
            continue
        h = [num(v) for v in (z.get('hourly') or [])]
        if len(h) not in (24, 96) or all(v is None for v in h):
            continue
        vals = [v for v in h if v is not None]
        avg = num(z.get('avg')) if z.get('avg') is not None else sum(vals) / len(vals)
        if avg is not None:
            S['price'][d] = avg
    # commodities: load_commodities() reads the long series, then the recent file (the last one wins)
    for key in COMMODITIES:
        S[key] = {}
    for path in (os.path.join(DATA, 'history', 'commodities_series.json'), os.path.join(DATA, 'commodities.json')):
        for key, s in ((read_json(path) or {}).get('series') or {}).items():
            if key not in COMMODITIES or not isinstance(s, dict):
                continue
            for p in s.get('points') or []:
                if isinstance(p, (list, tuple)) and len(p) >= 2 and num(p[1]) is not None and p[0] >= since:
                    S[key][p[0]] = num(p[1])
    # RTE éCO2mix: load_fr_eco2mix() keeps the days whose nuclear series has a value
    for path in sorted(glob.glob(os.path.join(DATA, 'history', 'rte', '[0-9]*.json'))):
        if os.path.basename(path)[:7] < since[:7]:
            continue
        for d, v in ((read_json(path) or {}).get('days') or {}).items():
            nuc = v.get('nuclear')
            if d < since or not isinstance(nuc, list) or not any(x is not None for x in nuc):
                continue
            for src, k in (('wind', 'wind'), ('solar', 'sol'), ('load', 'load')):
                g = gw_mean([num(x) for x in v.get(src) or []])
                if g is not None:
                    S[k][d] = g
    # forwards: load_forwards(), the rolling front contracts of fr_market_series.json
    series = read_json(os.path.join(DATA, 'history', 'fr_market_series.json')) or {}
    dates = series.get('dates') or []
    for mkt in ('FR', 'DE'):
        curve = (((series.get('countries') or {}).get(mkt) or {}).get('forwardCurve')) or {}
        for tenor in FWD_TENORS.values():
            S['fwd'][(mkt, tenor)] = {d: num(v) for d, v in zip(dates, curve.get(tenor) or [])
                                      if d >= since and num(v) is not None}
    return S


def merge(a, b):
    """b (the files) over a (the warehouse)"""
    out = {}
    for k in set(a) | set(b):
        if k == 'fwd':
            out[k] = {t: {**a.get(k, {}).get(t, {}), **b.get(k, {}).get(t, {})} for t in set(a.get(k, {})) | set(b.get(k, {}))}
        else:
            out[k] = {**a.get(k, {}), **b.get(k, {})}
    return out


# ── provisional spot days ─────────────────────────────────────────────
def paris_day_bounds(d):
    s = datetime(d.year, d.month, d.day, tzinfo=PARIS)
    return s.astimezone(timezone.utc), (s + timedelta(days=1)).astimezone(timezone.utc)


def remit_unavailable():
    """function day → mean nuclear MW unavailable over the Paris day, from the REMIT messages of ENTSO-E
    (per unit and hour the largest unavailability among its messages, so that overlapping messages count once)"""
    j = read_json(os.path.join(DATA, 'history', 'fr_outages.json')) or {}
    pa = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
    ev = []
    for e in j.get('events') or []:
        if e.get('fuel') != 'nuclear' or not e.get('start') or not e.get('end') or num(e.get('unavail')) is None:
            continue
        try:
            ev.append((e.get('unit'), pa(e['start']), pa(e['end']), num(e['unavail']), num(e.get('nominal'))))
        except ValueError:
            continue
    if not ev:
        return None
    first = min(e[1] for e in ev)

    def U(day):
        d = date.fromisoformat(day)
        s, e = paris_day_bounds(d)
        if s < first:
            return None   # before the window the outage file covers
        hours = int((e - s).total_seconds() // 3600)
        tot = 0.0
        for h in range(hours):
            t = s + timedelta(hours=h, minutes=30)
            per = {}
            for unit, a, b, x, nom in ev:
                if a <= t < b:
                    per[unit] = min(max(per.get(unit, 0.0), x), nom) if nom else max(per.get(unit, 0.0), x)
            tot += sum(per.values())
        return tot / hours
    return U


def qh(arr, n):
    """an hourly or quarter-hour forecast array as n quarter-hours"""
    if not isinstance(arr, list) or not arr:
        return None
    a = [num(v) for v in arr]
    if len(a) == n:
        return a
    if len(a) * 4 == n:
        return [v for v in a for _ in range(4)]
    return None


def forecast_day(day, n):
    """day-ahead forecasts of the day as n quarter-hours: {'wind': [...], 'sol': [...], 'load': [...]}"""
    out = {}
    comb = ((read_json(os.path.join(DATA, 'fr_fc_combined.json')) or {}).get('days') or {}).get(day) or {}
    tso = (((read_json(os.path.join(DATA, 'forecast.json')) or {}).get('zones') or {}).get('FR') or {}).get('days', {}).get(day) or {}
    hist = (((read_json(os.path.join(DATA, 'history', 'forecast', day[:7] + '.json')) or {}).get('days') or {}).get(day) or {}).get('FR') or {}
    for k, src in (('wind', 'wind'), ('sol', 'solar'), ('load', 'load')):
        for cand in ((comb.get(src) or {}).get('mid') if k != 'load' else None, tso.get(src), (hist.get(src) or {}).get('fc')):
            a = qh(cand, n)
            if a and sum(v is not None for v in a) >= n * MIN_SLOTS / 96:
                out[k] = a
                break
    return out


def rte_day(day):
    v = ((read_json(os.path.join(DATA, 'history', 'rte', day[:7] + '.json')) or {}).get('days') or {}).get(day) or {}
    return {k: [num(x) for x in v.get(src) or []] for src, k in (('wind', 'wind'), ('solar', 'sol'), ('load', 'load'))}


def provisional_days(S, firm_last, today):
    """Levels of the days after the last firm one (up to tomorrow) whose day-ahead price is out: {day: {driver: level}},
    {day: [provisional drivers]}"""
    U = remit_unavailable()
    nuc_days = sorted(S['nuc'])
    levels, pv = {}, {}
    d = date.fromisoformat(firm_last) + timedelta(days=1)
    while d <= today + timedelta(days=1):
        day = d.isoformat()
        d += timedelta(days=1)
        if day not in S['price']:
            continue
        lv, est = {}, []
        # wind, solar, load: RTE when complete, else its published quarter-hours completed with the forecasts
        rte = rte_day(day)
        n = max([len(a) for a in rte.values() if a] + [96])
        fc = None
        for k in ('wind', 'sol', 'load'):
            if day in S[k]:
                lv[k] = S[k][day]
                continue
            fc = fc if fc is not None else forecast_day(day, n)
            act = rte.get(k) if rte.get(k) and len(rte[k]) == n else [None] * n
            f = fc.get(k)
            if not f:
                break
            lv[k] = gw_mean([a if a is not None else b for a, b in zip(act, f)])
            est.append(k)
            if lv[k] is None:
                break
        if any(lv.get(k) is None for k in ('wind', 'sol', 'load')):
            continue
        # TTF: the close of the day, else the last one
        if day in S['ttf']:
            lv['ttf'] = S['ttf'][day]
        else:
            last = [x for x in sorted(S['ttf']) if x < day]
            if not last:
                continue
            lv['ttf'] = S['ttf'][last[-1]]
            est.append('ttf')
        # nuclear availability: the feed's first value, else fleet capacity − REMIT unavailability of the day
        if day in S['nuc']:
            lv['nuc'] = S['nuc'][day]
        else:
            prev = [x for x in nuc_days if x < day]
            if not prev:
                continue
            est.append('nuc')
            lv['nuc'] = S['nuc'][prev[-1]]
            u = U(day) if U else None
            if u is not None:
                fleet = [S['nuc'][p] + U(p) / 1000 for p in prev[-NUC_FLEET_DAYS:] if U(p) is not None]
                if fleet:
                    lv['nuc'] = mean(fleet) - u / 1000
        levels[day] = lv
        pv[day] = sorted(est)
    return levels, pv


# ── regressions and frames ────────────────────────────────────────────
def ols(y, X):
    """y: (n,) ; X: (n,k) raw predictors. Returns raw coefs (k,), intercept, r2, and standardised-coef*corr weights."""
    n, k = X.shape
    Xd = np.column_stack([np.ones(n), X])
    coef, *_ = np.linalg.lstsq(Xd, y, rcond=None)
    raw = coef[1:]
    pred = Xd @ coef
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    sx, sy = X.std(axis=0, ddof=0), y.std(ddof=0)
    std_coef = raw * np.where(sx > 0, sx, 1) / (sy if sy > 0 else 1)
    corr = np.array([np.corrcoef(X[:, i], y)[0, 1] if sx[i] > 0 else 0.0 for i in range(k)])
    weight = std_coef * corr
    s = weight.sum()
    if s != 0 and r2 > 0:
        weight = weight * (r2 / s)
    return raw, r2, weight


def weekly_frames(dates_sorted, price, drivers_levels, weights, raw_coef, driver_names, de_level, pv=None):
    """One point per ISO week (last date of each week present in `dates_sorted`); c/x per spec."""
    by_week = {}
    for d in dates_sorted:
        wk = date.fromisoformat(d).isocalendar()[:2]
        by_week[wk] = d   # last date wins (dates_sorted is ascending)
    week_ends = [by_week[k] for k in sorted(by_week)]
    kept = [n for n in driver_names if abs(weights.get(n, 0)) >= 0.01]
    frames = []
    for i in range(1, len(week_ends)):
        d1, d0 = week_ends[i], week_ends[i - 1]
        if d1 not in price or d0 not in price:
            continue
        c = {}
        for n in kept:
            lv1, lv0 = drivers_levels[n].get(d1), drivers_levels[n].get(d0)
            if lv1 is None or lv0 is None:
                continue
            c[n] = round(raw_coef[n] * (lv1 - lv0), 2)
        x = {n: (round(drivers_levels[n][d1], 2) if drivers_levels[n].get(d1) is not None else None) for n in ALL_DRIVERS}
        x['de'] = round(de_level[d1], 2) if de_level and de_level.get(d1) is not None else None
        if de_level:
            lv1, lv0 = de_level.get(d1), de_level.get(d0)
            if lv1 is not None and lv0 is not None:
                c['de'] = round(lv1 - lv0, 2)
        f = {'d': d1, 'p': round(price[d1], 2), 'r': round(price[d0], 2), 'c': c, 'x': x}
        if pv and d1 in pv:
            f['pv'] = pv[d1]
        frames.append(f)
    return frames[-52:]


def build_spot(S, today):
    price = S['price']
    levels = {'ttf': S['ttf'], 'wind': S['wind'], 'sol': S['sol'], 'load': S['load'], 'nuc': S['nuc']}
    dates = sorted(set(price) & set(S['ttf']) & set(S['wind']) & set(S['sol']) & set(S['load']) & set(S['nuc']))
    dates = [d for d in dates if d <= today.isoformat()]
    if len(dates) < 30:
        return None
    y = np.array([price[d] for d in dates])
    X = np.array([[levels[n][d] for n in SPOT_DRIVERS] for d in dates])
    raw, r2, weight = ols(y, X)
    raw_coef = dict(zip(SPOT_DRIVERS, raw))
    weights = dict(zip(SPOT_DRIVERS, weight))
    prov, pv = provisional_days(S, dates[-1], today)
    levels = {n: {**levels[n], **{d: lv[n] for d, lv in prov.items()}} for n in SPOT_DRIVERS}
    all_dates = dates + sorted(prov)
    s_series = [[d, round(price[d], 2)] for d in all_dates]
    frames = weekly_frames(all_dates, price, {**levels, 'eua': {}, 'coal': {}}, weights, raw_coef, SPOT_DRIVERS, None, pv)
    i = {n: round(w, 2) for n, w in weights.items() if abs(w) >= 0.01}
    out = {'w': frames, 's': s_series, 'i': i, 'r2': round(r2, 2), 'b': round(raw_coef.get('ttf', 0.0), 2), 'firm': dates[-1]}
    if pv:
        out['pv'] = pv
    return out


def build_forward(S, key):
    tenor = FWD_TENORS[key]
    price, de_price = S['fwd'].get(('FR', tenor), {}), S['fwd'].get(('DE', tenor), {})
    levels = {'ttf': S['ttf'], 'eua': S['eua'], 'coal': S['coal'], 'nuc': S['nuc']}
    dates = sorted(set(price) & set(S['ttf']) & set(S['eua']) & set(S['coal']) & set(S['nuc']))
    if len(dates) < 20:
        return None
    y = np.diff(np.array([price[d] for d in dates]))
    X = np.diff(np.array([[levels[n][d] for n in FWD_DRIVERS] for d in dates]), axis=0)
    raw, r2, weight = ols(y, X)
    raw_coef = dict(zip(FWD_DRIVERS, raw))
    weights = dict(zip(FWD_DRIVERS, weight))
    s_series = [[d, round(price[d], 2)] for d in dates]
    all_levels = {**levels, 'wind': S['wind'], 'sol': S['sol'], 'load': S['load']}
    frames = weekly_frames(dates, price, all_levels, weights, raw_coef, FWD_DRIVERS, de_price)
    i = {n: round(w, 2) for n, w in weights.items() if abs(w) >= 0.01}
    return {'w': frames, 's': s_series, 'i': i, 'r2': round(r2, 2), 'b': round(raw_coef.get('ttf', 0.0), 2)}


def align_last_week(out):
    """js/drivers.js pairs the maturities by counting the frames from the end. When one maturity has entered a new
    week before the others (Monday's spot inputs before Monday's settlements, or the reverse), its extra frame
    would shift all its weeks by one against the others: every maturity stops at the last week they all have."""
    week = lambda f: date.fromisoformat(f['d']).isocalendar()[:2]
    lasts = [week(m['w'][-1]) for m in out.values() if m['w']]
    if not lasts:
        return
    common = min(lasts)
    for m in out.values():
        m['w'] = [f for f in m['w'] if week(f) <= common]
    sp = out.get('spot')
    if sp and sp.get('pv'):   # provisional days of a week cut here wait for the forwards
        shown = {f['d'] for f in sp['w']}
        sp['pv'] = {d: v for d, v in sp['pv'].items() if d <= max(shown)}
        if not sp['pv']:
            del sp['pv']


def main() -> int:
    today = datetime.now(PARIS).date()
    since = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    S = files_series(since)
    db = os.environ.get('SUPABASE_DB_URL') or os.environ.get('WAREHOUSE_DB_URL')
    if db:
        S = merge(db_series(db, since), S)
    else:
        print('No database URL: built from the data files alone.')
    S['nuc'] = {d: v / 1000 for d, v in S.pop('fr_nuc_avail').items()}   # the feed is in MW, the page shows GW
    out = {}
    for key in ('spot', 'm1', 'q1', 'cal'):
        frame = build_spot(S, today) if key == 'spot' else build_forward(S, key)
        if frame:
            out[key] = frame
        else:
            print(f'{key}: not enough aligned data, kept out of the file (js/drivers.js falls back to SENS).')
    if not out:
        print('No maturity had enough data: frames.json left as is.')
        return 0
    align_last_week(out)
    old = read_json(OUT_PATH) or {}
    if {k: v for k, v in old.items() if k != 'updated'} == json.loads(json.dumps(out)):
        print(f'{OUT_PATH}: no figure changed, left as is (updated {old.get("updated")}).')
        return 0
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), **out}
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    sp = out.get('spot') or {}
    print(f'Wrote {OUT_PATH} (' + ', '.join(f"{k} to {v['w'][-1]['d']}" for k, v in out.items() if k != 'updated' and v['w'])
          + f"; spot firm to {sp.get('firm')}, provisional: {sp.get('pv') or 'none'})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
