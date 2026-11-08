#!/usr/bin/env python3
"""Rebuild data/drivers/frames.json, the data of Markets › What drives the price (js/drivers.js).

Output, one object per maturity (spot, m1, q1, cal):
  w   weekly frames, oldest first: {d: last day of the week (YYYY-MM-DD, delivery day in Paris time for the spot,
      trading day for the forwards), p: price at the end of the week (€/MWh), r: price a week earlier,
      c: {driver: contribution over the week in €/MWh}, x: {driver: level at the end of the week}}
  s   daily price series [[date, €/MWh], ...] (spot: day-ahead base average `avg`; forwards: EEX settlement)
  i, r2, b: weight of each driver, explained share, pass-through of 1 €/MWh of gas. js/drivers.js reads them when
      present and otherwise uses the values of its SENS table (regressions of 8 Nov 2026).

Drivers: ttf (TTF day-ahead, €/MWh), eua (EUA front December, €/t), coal (API2, $/t), wind, sol, load, nuc (France
daily averages in GW from RTE éCO2mix; nuc = available nuclear capacity), de (German price of the same maturity,
kept as a level only: it is part of the unexplained share).

Method (the Method section of the page):
  1. Window: one year of daily data ending on the last forward settlement.
  2. Forwards (M+1, Q+1, Cal+1 France base, rolling front contracts): ordinary least squares of the daily change of
     the price on the daily changes of ttf, eua, coal and nuc. Spot: OLS of the daily level on the levels of ttf,
     wind, load, nuc and sol.
  3. Weight of a driver = its share of the explained variance (standardised coefficient × correlation, normalised)
     × R² of the regression; drivers under 1 % are dropped. b = coefficient of ttf (€/MWh of power per €/MWh of gas).
  4. Contribution of a driver over a week = coefficient × change of the driver over that week. The unexplained share
     of a week = price change − sum of the contributions (computed by the page, not stored).
  5. Frames are written for the last 52 weeks (fewer for a contract quoted for less time: M+1 since March 2026).

Warehouse tables (Supabase, see the powerklock-sql skill and warehouse/): day-ahead daily averages, forwards
settlements (EEX, France and Germany base), commodities (TTF, EUA, API2), RTE éCO2mix daily (wind, solar, load),
nuclear availability.

Usage:  python3 scripts/build_drivers.py   (the warehouse connection comes from the environment, as in the other
warehouse jobs: never a file — SUPABASE_DB_URL or WAREHOUSE_DB_URL)
"""
import json
import os
import sys
from datetime import date, timedelta

import numpy as np
import psycopg

OUT_PATH = 'data/drivers/frames.json'
WINDOW_DAYS = 365

# maturity → (forward tenor, drivers regressed on, level-or-diff)
FWD_TENORS = {'m1': 'M+1', 'q1': 'Q+1', 'cal': 'Y+1'}
FWD_DRIVERS = ['ttf', 'eua', 'coal', 'nuc']
SPOT_DRIVERS = ['ttf', 'wind', 'sol', 'load', 'nuc']
ALL_DRIVERS = ['ttf', 'eua', 'coal', 'wind', 'sol', 'load', 'nuc']   # union, for `x` (plus 'de' separately)


def fetch_series(cur, sql, params, key='v'):
    cur.execute(sql, params)
    return {row[0].isoformat(): row[1] for row in cur.fetchall() if row[1] is not None}


def fetch_daily_fuel_means(cur, since):
    """FR wind/solar/load GW daily means from RTE éCO2mix 15-min arrays; nuc from fr_nuc_avail (capacity, GW)."""
    cur.execute("""select delivery_date, wind_mw, solar_mw, load_mw from market.fr_eco2mix_day
                   where delivery_date >= %s order by delivery_date""", (since,))
    wind, sol, load = {}, {}, {}
    for d, w, s, l in cur.fetchall():
        iso = d.isoformat()
        if w: wind[iso] = sum(v for v in w if v is not None) / len([v for v in w if v is not None]) / 1000
        if s: sol[iso] = sum(v for v in s if v is not None) / len([v for v in s if v is not None]) / 1000
        if l: load[iso] = sum(v for v in l if v is not None) / len([v for v in l if v is not None]) / 1000
    return wind, sol, load


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


def weekly_frames(dates_sorted, price, drivers_levels, weights, raw_coef, driver_names, de_level):
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
        frames.append({'d': d1, 'p': round(price[d1], 2), 'r': round(price[d0], 2), 'c': c, 'x': x})
    return frames[-52:]


def build_maturity(cur, key, since):
    wind, sol, load = fetch_daily_fuel_means(cur, since)
    nuc = fetch_series(cur, """select trade_date, value from market.commodity_close
                               where key='fr_nuc_avail' and trade_date >= %s order by trade_date""", (since,))
    if key == 'spot':
        price = fetch_series(cur, """select delivery_date, avg from market.da_price_day
                                     where zone='FR' and delivery_date >= %s order by delivery_date""", (since,))
        ttf = fetch_series(cur, """select trade_date, value from market.commodity_close
                                   where key='ttf' and trade_date >= %s order by trade_date""", (since,))
        levels = {'ttf': ttf, 'wind': wind, 'sol': sol, 'load': load, 'nuc': nuc}
        dates = sorted(set(price) & set(ttf) & set(wind) & set(load) & set(nuc))
        if len(dates) < 30:
            return None
        y = np.array([price[d] for d in dates])
        X = np.array([[levels[n][d] for n in SPOT_DRIVERS] for d in dates])
        raw, r2, weight = ols(y, X)
        raw_coef = dict(zip(SPOT_DRIVERS, raw))
        weights = dict(zip(SPOT_DRIVERS, weight))
        s_series = [[d, round(price[d], 2)] for d in dates]
        frames = weekly_frames(dates, price, {**levels, 'eua': {}, 'coal': {}}, weights, raw_coef, SPOT_DRIVERS, None)
        i = {n: round(w, 2) for n, w in weights.items() if abs(w) >= 0.01}
        return {'w': frames, 's': s_series, 'i': i, 'r2': round(r2, 2), 'b': round(raw_coef.get('ttf', 0.0), 2)}

    tenor = FWD_TENORS[key]
    price = fetch_series(cur, """select trade_date, value from market.forward_settlement
                                 where market='FR' and tenor=%s and trade_date >= %s order by trade_date""", (tenor, since))
    de_price = fetch_series(cur, """select trade_date, value from market.forward_settlement
                                    where market='DE' and tenor=%s and trade_date >= %s order by trade_date""", (tenor, since))
    ttf = fetch_series(cur, """select trade_date, value from market.commodity_close
                               where key='ttf' and trade_date >= %s order by trade_date""", (since,))
    eua = fetch_series(cur, """select trade_date, value from market.commodity_close
                               where key='eua' and trade_date >= %s order by trade_date""", (since,))
    coal = fetch_series(cur, """select trade_date, value from market.commodity_close
                                where key='coal' and trade_date >= %s order by trade_date""", (since,))
    levels = {'ttf': ttf, 'eua': eua, 'coal': coal, 'nuc': nuc}
    dates = sorted(set(price) & set(ttf) & set(eua) & set(coal) & set(nuc))
    if len(dates) < 20:
        return None
    y = np.diff(np.array([price[d] for d in dates]))
    X = np.diff(np.array([[levels[n][d] for n in FWD_DRIVERS] for d in dates]), axis=0)
    raw, r2, weight = ols(y, X)
    raw_coef = dict(zip(FWD_DRIVERS, raw))
    weights = dict(zip(FWD_DRIVERS, weight))
    s_series = [[d, round(price[d], 2)] for d in dates]
    all_levels = {**levels, 'wind': wind, 'sol': sol, 'load': load}
    frames = weekly_frames(dates, price, all_levels, weights, raw_coef, FWD_DRIVERS, de_price)
    i = {n: round(w, 2) for n, w in weights.items() if abs(w) >= 0.01}
    return {'w': frames, 's': s_series, 'i': i, 'r2': round(r2, 2), 'b': round(raw_coef.get('ttf', 0.0), 2)}


def main() -> int:
    db = os.environ.get('SUPABASE_DB_URL') or os.environ.get('WAREHOUSE_DB_URL')
    if not db:
        print('No database URL: build_drivers skipped (data/drivers/frames.json left as is).')
        return 0
    since = (date.today() - timedelta(days=WINDOW_DAYS)).isoformat()
    out = {}
    with psycopg.connect(db, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            for key in ('spot', 'm1', 'q1', 'cal'):
                frame = build_maturity(cur, key, since)
                if frame:
                    out[key] = frame
                else:
                    print(f'{key}: not enough aligned data, kept out of the file (js/drivers.js falls back to SENS).')
    if not out:
        print('No maturity had enough data: frames.json left as is.')
        return 0
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'Wrote {OUT_PATH} ({", ".join(out)})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
