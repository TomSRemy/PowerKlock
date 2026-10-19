#!/usr/bin/env python3
"""
PowerKlock warehouse sync — data files (GitHub repo) → PostgreSQL (Supabase).

The repository stays the source of truth; the database is a mirror that can
be rebuilt at any time:

    WAREHOUSE_DB_URL=postgresql://… python warehouse/sync.py           # incremental
    WAREHOUSE_DB_URL=postgresql://… python warehouse/sync.py --full    # reload everything

Steps
  1. apply warehouse/migrations/*.sql not applied yet (ops.schema_migrations)
  2. load the source files whose content changed since the last run
     (sha256 in ops.file_state); every write is an upsert, so re-running
     never duplicates anything
  3. run ops.run_quality_checks() and record the run in ops.sync_run

Conventions match the website:
  * day-ahead prices are on the Paris delivery day (96 quarter-hours);
  * generation / load arrays written with a UTC window are realigned to the
    Paris clock exactly like js/gen-align.js (shift by the UTC offset, first
    slots from the previous day, all-zero slots = unpublished → null);
  * a delivery day at exactly 0.00 in every slot while every coupled
    neighbour averages above 20 EUR/MWh is kept but flagged (excluded from
    the analytics views), as on the site (js/data.js pkSanitizeZones).
"""
import argparse
import csv
import glob
import hashlib
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
MIGRATIONS = os.path.join(ROOT, 'warehouse', 'migrations')
PARIS = ZoneInfo('Europe/Paris')

GEN_KEYS = {  # daily-file key → warehouse fuel
    'nuclear': 'nuclear', 'hydro': 'hydro', 'wind': 'wind', 'windOnshore': 'wind_onshore',
    'windOffshore': 'wind_offshore', 'solar': 'solar', 'fossil': 'fossil', 'biomass': 'biomass', 'other': 'other',
}
GEN_MAPS = ['byCodeActual', 'byCode']
LOAD_KEYS = ['load', 'loadForecast']
COUPLED = {'EE': ['FI', 'LV'], 'LV': ['EE', 'LT'], 'LT': ['LV', 'PL'], 'FI': ['EE', 'SE'],
           'SE': ['FI', 'NO_1'], 'ES': ['PT'], 'PT': ['ES']}


def log(*a):
    print(*a, flush=True)


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ── Migrations ────────────────────────────────────────────────────────
def migrate(conn):
    with conn.cursor() as cur:
        cur.execute("create schema if not exists ops")
        cur.execute("""create table if not exists ops.schema_migrations (
            version text primary key, checksum text not null, applied_at timestamptz not null default now())""")
        cur.execute("select version, checksum from ops.schema_migrations")
        done = dict(cur.fetchall())
    conn.commit()
    for path in sorted(glob.glob(os.path.join(MIGRATIONS, '*.sql'))):
        version = os.path.basename(path)
        body = open(path).read()
        chk = hashlib.sha256(body.encode()).hexdigest()
        if version in done:
            if done[version] != chk:
                log(f"  ! {version} changed after being applied — add a new migration instead of editing it")
            continue
        if body.startswith('-- requires: auth'):
            with conn.cursor() as cur:
                cur.execute("select exists (select 1 from pg_namespace where nspname = 'auth')")
                has_auth = cur.fetchone()[0]
            if not has_auth:
                log(f"  skipping {version}: needs Supabase's auth schema")
                continue
        log(f"  applying {version}")
        with conn.cursor() as cur:
            cur.execute(body)
            cur.execute("insert into ops.schema_migrations (version, checksum) values (%s, %s)", (version, chk))
        conn.commit()


# ── Helpers ───────────────────────────────────────────────────────────
def paris_offset_hours(d):
    noon = datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc)
    return int(noon.astimezone(PARIS).utcoffset().total_seconds() // 3600)


def shift(arr, prev, off_h, prev_ok=True):
    """out[i] = arr[i - k]; the first k slots come from the previous UTC day (gen-align.js).
    prev_ok=False when the caller knows that tail was not published."""
    if not isinstance(arr, list) or not arr:
        return arr
    n = len(arr)
    k = round(off_h * n / 24)
    prev_ok = prev_ok and isinstance(prev, list) and len(prev) == n
    out = []
    for i in range(n):
        if i >= k:
            out.append(arr[i - k])
        else:
            out.append(prev[n - k + i] if prev_ok else None)
    return out


def num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None   # drop NaN


def price_row(code, d, z, flag):
    h = [num(v) for v in (z.get('hourly') or [])]
    if not h or all(v is None for v in h):
        return None
    if len(h) == 24:
        h = [v for v in h for _ in range(4)]
        res = 60
    elif len(h) == 96:
        res = 60 if all(h[i] == h[i + 1] == h[i + 2] == h[i + 3] for i in range(0, 96, 4)) else 15
    else:
        return None
    vals = [v for v in h if v is not None]
    peak = [v for i, v in enumerate(h) if v is not None and 32 <= i < 80]
    off = [v for i, v in enumerate(h) if v is not None and not (32 <= i < 80)]
    mean = lambda a: sum(a) / len(a) if a else None
    avg = num(z.get('avg')) if z.get('avg') is not None else mean(vals)
    neg = num(z.get('negH'))
    if neg is None:
        neg = sum(1 for v in vals if v < 0) / 4
    return (code, d, res, h, avg, min(vals), max(vals),
            num(z.get('peakAvg')) if z.get('peakAvg') is not None else mean(peak),
            num(z.get('offAvg')) if z.get('offAvg') is not None else mean(off),
            neg, flag)


def flat_zero_flags(zones):
    """Codes whose whole day is 0.00 while every coupled neighbour averages > 20 EUR/MWh."""
    avg = {c: num(z.get('avg')) for c, z in zones.items() if z}
    out = set()
    for c, z in zones.items():
        h = [v for v in (z or {}).get('hourly') or [] if v is not None]
        nb = [avg.get(n) for n in COUPLED.get(c, []) if avg.get(n) is not None]
        if h and all(v == 0 for v in h) and nb and all(v > 20 for v in nb):
            out.add(c)
    return out


def generation_rows(code, d, z, pz, aligned):
    """Rows (zone, day, fuel, slots, mw[]) with the Paris-clock realignment of gen-align.js."""
    off = paris_offset_hours(d)
    series = {}
    for key, fuel in GEN_KEYS.items():
        a = z.get(key)
        if isinstance(a, list) and a:
            series[fuel] = [num(v) for v in (a if aligned else shift(a, (pz or {}).get(key), off))]
    m = next((z.get(k) for k in GEN_MAPS if isinstance(z.get(k), dict) and z.get(k)), None)
    mk = next((k for k in GEN_MAPS if isinstance(z.get(k), dict) and z.get(k)), None)
    if m:
        # Per-type breakdown of the previous file: unpublished tail when every
        # type is 0 there (one type at 0, e.g. solar at night, is real).
        pm = ((pz or {}).get(mk) or {}) if pz else {}
        def tail_nonzero(a):
            n_ = len(a); k_ = round(off * n_ / 24)
            return any(v not in (None, 0) for v in a[n_ - k_:])
        map_ok = any(isinstance(a, list) and a and tail_nonzero(a) for a in pm.values())
        for psr, a in m.items():
            if isinstance(a, list) and a:
                series['psr:' + psr] = [num(v) for v in (a if aligned else shift(a, pm.get(psr), off, map_ok))]
    if not series:
        return []
    # A slot where no aggregate fuel reported anything above 0 is unpublished.
    agg = [s for f, s in series.items() if not f.startswith('psr:')]
    if agg:
        n = len(agg[0])
        for i in range(n):
            vals = [s[i] for s in agg if len(s) == n]
            if vals and all(v is None or v == 0 for v in vals) and any(v is not None for v in vals):
                for s in series.values():
                    if len(s) == n:
                        s[i] = None
        # The per-type breakdown can lag behind the aggregates (zero-filled
        # tail never refreshed): every type at 0 while aggregates produce
        # means unpublished for the types.
        psr = [s for f, s in series.items() if f.startswith('psr:') and len(s) == n]
        for i in range(n):
            if psr and all(not s[i] for s in psr) and any((s[i] or 0) > 0 for s in agg if len(s) == n):
                for s in psr:
                    s[i] = None
    rows = []
    for fuel, s in series.items():
        if len(s) not in (24, 96) or all(v is None for v in s):
            continue
        rows.append((code, d, fuel, len(s), s))
    return rows


def load_row(code, d, z, pz, aligned):
    off = paris_offset_hours(d)
    out = {}
    for key in LOAD_KEYS:
        a = z.get(key)
        if isinstance(a, list) and a:
            s = a if aligned else shift(a, (pz or {}).get(key), off)
            out[key] = [None if num(v) in (None, 0) else num(v) for v in s]
    if not out:
        return None
    n = len(next(iter(out.values())))
    if n not in (24, 96):
        return None
    return (code, d, n, out.get('load'), out.get('loadForecast'))


# ── Loaders ───────────────────────────────────────────────────────────
UPSERT_PRICE = """insert into market.da_price_day
  (zone, delivery_date, resolution_min, prices, avg, min, max, peak_avg, offpeak_avg, neg_hours, flag)
  values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
  on conflict (zone, delivery_date) do update set resolution_min = excluded.resolution_min, prices = excluded.prices,
    avg = excluded.avg, min = excluded.min, max = excluded.max, peak_avg = excluded.peak_avg,
    offpeak_avg = excluded.offpeak_avg, neg_hours = excluded.neg_hours, flag = excluded.flag, loaded_at = now()"""
UPSERT_GEN = """insert into market.generation_day (zone, delivery_date, fuel, slots, mw) values (%s,%s,%s,%s,%s)
  on conflict (zone, delivery_date, fuel) do update set slots = excluded.slots, mw = excluded.mw, loaded_at = now()"""
UPSERT_GEN_TYPE = """insert into market.generation_type_daily (zone, delivery_date, production_type, avg_mw, max_mw, published_slots, slots)
  values (%s,%s,%s,%s,%s,%s,%s)
  on conflict (zone, delivery_date, production_type) do update set avg_mw = excluded.avg_mw, max_mw = excluded.max_mw,
    published_slots = excluded.published_slots, slots = excluded.slots"""
UPSERT_LOAD = """insert into market.load_day (zone, delivery_date, slots, actual_mw, forecast_mw) values (%s,%s,%s,%s,%s)
  on conflict (zone, delivery_date) do update set slots = excluded.slots, actual_mw = excluded.actual_mw,
    forecast_mw = excluded.forecast_mw, loaded_at = now()"""


def ensure_zones(cur, codes):
    cur.executemany("insert into meta.zone (zone, name) values (%s, %s) on conflict do nothing", [(c, c) for c in codes])


def ensure_fuels(cur, fuels):
    cur.executemany("insert into meta.fuel (fuel, label, family) values (%s, %s, 'other') on conflict do nothing",
                    [(f, f) for f in fuels])


def load_daily(conn, paths):
    """paths: daily files to (re)load. Returns rows written."""
    rows = 0
    batch_p, batch_g, batch_l = [], [], []
    for path in paths:
        ds = os.path.basename(path)[:10]
        d = date.fromisoformat(ds)
        j = read_json(path)
        if not j or not isinstance(j.get('zones'), dict):
            continue
        zones = {c: z for c, z in j['zones'].items() if isinstance(z, dict)}
        prev = read_json(os.path.join(DATA, 'history', 'daily', (d - timedelta(days=1)).isoformat() + '.json')) or {}
        pzs = prev.get('zones') if isinstance(prev.get('zones'), dict) else {}
        aligned = j.get('slotTz') == 'Europe/Paris'
        flagged = flat_zero_flags(zones)
        for code, z in zones.items():
            pr = price_row(code, d, z, 'flat_zero_feed' if code in flagged else None)
            if pr:
                batch_p.append(pr)
            pz = pzs.get(code) if isinstance(pzs, dict) else None
            batch_g.extend(generation_rows(code, d, z, pz, aligned))
            lr = load_row(code, d, z, pz, aligned)
            if lr:
                batch_l.append(lr)
        if len(batch_p) + len(batch_g) > 4000:
            rows += flush_daily(conn, batch_p, batch_g, batch_l)
            batch_p, batch_g, batch_l = [], [], []
    rows += flush_daily(conn, batch_p, batch_g, batch_l)
    return rows


def flush_daily(conn, bp, bg, bl):
    if not (bp or bg or bl):
        return 0
    # ENTSO-E production types (psr:*) are stored as daily statistics (migration 008).
    agg = [r for r in bg if not r[2].startswith('psr:')]
    typ = []
    for z, d, f, n, arr in bg:
        if f.startswith('psr:'):
            v = [x for x in arr if x is not None]
            if v:
                typ.append((z, d, f, sum(v) / len(v), max(v), len(v), n))
    with conn.cursor() as cur:
        ensure_zones(cur, {r[0] for r in bp} | {r[0] for r in bg} | {r[0] for r in bl})
        ensure_fuels(cur, {r[2] for r in bg})
        if bp:
            cur.executemany(UPSERT_PRICE, bp)
        if agg:
            cur.executemany(UPSERT_GEN, agg)
        if typ:
            cur.executemany(UPSERT_GEN_TYPE, typ)
        if bl:
            cur.executemany(UPSERT_LOAD, bl)
    conn.commit()
    return len(bp) + len(bg) + len(bl)


def load_commodities(conn):
    meta, pts = {}, {}
    for path in (os.path.join(DATA, 'history', 'commodities_series.json'), os.path.join(DATA, 'commodities.json')):
        j = read_json(path) or {}
        for key, s in (j.get('series') or {}).items():
            if not isinstance(s, dict):
                continue
            meta[key] = (s.get('name') or key, s.get('unit'), s.get('contract'))
            for p in s.get('points') or []:
                if isinstance(p, (list, tuple)) and len(p) >= 2 and num(p[1]) is not None:
                    pts[(key, p[0])] = num(p[1])
    with conn.cursor() as cur:
        cur.executemany("""insert into market.commodity (key, name, unit, contract) values (%s,%s,%s,%s)
            on conflict (key) do update set name = excluded.name, unit = excluded.unit, contract = excluded.contract""",
                        [(k,) + v for k, v in meta.items()])
        cur.executemany("""insert into market.commodity_close (key, trade_date, value) values (%s,%s,%s)
            on conflict (key, trade_date) do update set value = excluded.value""",
                        [(k, d, v) for (k, d), v in pts.items()])
    conn.commit()
    return len(meta) + len(pts)


def load_forwards(conn):
    series = read_json(os.path.join(DATA, 'history', 'fr_market_series.json')) or {}
    snap = read_json(os.path.join(DATA, 'fr_market.json')) or {}
    chain = read_json(os.path.join(DATA, 'history', 'fr_market_calchain.json')) or {}
    cur_of = {c: ((snap.get('countries') or {}).get(c) or {}).get('currency') or ('GBP' if c == 'UK' else 'EUR')
              for c in set((series.get('countries') or {}).keys()) | set(chain.keys())}
    dates = series.get('dates') or []
    fwd, spot, cal = [], [], []
    for c, cs in (series.get('countries') or {}).items():
        for tenor, vals in (cs.get('forwardCurve') or {}).items():
            for d, v in zip(dates, vals or []):
                if num(v) is not None:
                    fwd.append((c, d, tenor, num(v), cur_of[c]))
        for d, v in zip(dates, cs.get('spot') or []):
            if num(v) is not None:
                spot.append((c, d, num(v), cur_of[c]))
    for c, ch in chain.items():
        for yr, s in ((ch or {}).get('years') or {}).items():
            for d, v in zip(s.get('dates') or [], s.get('values') or []):
                if num(v) is not None:
                    cal.append((c, 'Cal' + str(yr), d, num(v), cur_of.get(c, 'EUR')))
    with conn.cursor() as cur:
        cur.executemany("""insert into market.forward_settlement (market, trade_date, tenor, value, currency) values (%s,%s,%s,%s,%s)
            on conflict (market, trade_date, tenor) do update set value = excluded.value, currency = excluded.currency""", fwd)
        cur.executemany("""insert into market.spot_reference (market, trade_date, value, currency) values (%s,%s,%s,%s)
            on conflict (market, trade_date) do update set value = excluded.value""", spot)
        cur.executemany("""insert into market.forward_contract_close (market, contract, trade_date, value, currency) values (%s,%s,%s,%s,%s)
            on conflict (market, contract, trade_date) do update set value = excluded.value""", cal)
    conn.commit()
    return len(fwd) + len(spot) + len(cal)


def load_capacity(conn):
    j = read_json(os.path.join(DATA, 'history', 'capacity.json')) or {}
    rows = []
    for c, d in (j.get('countries') or {}).items():
        years = d.get('years') or []
        for t, vals in (d.get('types') or {}).items():
            for y, v in zip(years, vals):
                if num(v) is not None:
                    rows.append((c, int(y), t, num(v)))
    with conn.cursor() as cur:
        cur.executemany("""insert into market.installed_capacity (country, year, production_type, gw) values (%s,%s,%s,%s)
            on conflict (country, year, production_type) do update set gw = excluded.gw""", rows)
    conn.commit()
    return len(rows)


def load_flows(conn, paths):
    rows = 0
    for path in paths:
        m = read_json(path) or {}
        batch = []
        for ds, by_c in (m.get('days') or {}).items():
            for c, by_n in by_c.items():
                for nb, arr in by_n.items():
                    if isinstance(arr, list) and len(arr) == 24 and any(v is not None for v in arr):
                        batch.append((c, nb, ds, [num(v) for v in arr]))
        with conn.cursor() as cur:
            cur.executemany("""insert into market.crossborder_flow_day (country, neighbour, delivery_date, mw) values (%s,%s,%s,%s)
                on conflict (country, neighbour, delivery_date) do update set mw = excluded.mw""", batch)
        conn.commit()
        rows += len(batch)
    return rows


# ── France national generation (RTE éCO2mix files) and M0 ──
ECO2MIX_FIELDS = [('nuclear', 'nuclear_mw'), ('wind', 'wind_mw'), ('windOnshore', 'wind_onshore_mw'), ('windOffshore', 'wind_offshore_mw'),
                  ('solar', 'solar_mw'), ('hydro', 'hydro_mw'), ('hydroPS', 'hydro_ps_mw'), ('pumping', 'pumping_mw'), ('gas', 'gas_mw'),
                  ('coal', 'coal_mw'), ('oil', 'oil_mw'), ('bio', 'bio_mw'), ('load', 'load_mw'), ('exchanges', 'exchanges_mw'), ('co2', 'co2_g_kwh')]


def load_fr_eco2mix(conn, paths):
    cols = [c for _, c in ECO2MIX_FIELDS] + ['battery_net_mw']
    sql = (f"insert into market.fr_eco2mix_day (delivery_date, dataset, resolution_min, {', '.join(cols)}) "
           f"values ({', '.join(['%s'] * (3 + len(cols)))}) on conflict (delivery_date) do update set "
           + ', '.join(f'{c} = excluded.{c}' for c in ['dataset', 'resolution_min'] + cols) + ', loaded_at = now()')
    rows = 0
    for path in paths:
        days = (read_json(path) or {}).get('days') or {}
        batch = []
        for d, v in days.items():
            nuc = v.get('nuclear')
            if not isinstance(nuc, list) or not any(x is not None for x in nuc):
                continue
            arr = lambda k: [num(x) for x in v[k]] if isinstance(v.get(k), list) and any(x is not None for x in v[k]) else None
            ch, dis = arr('batteryCharge'), arr('batteryDischarge')
            bat = [None if a is None and b is None else (a or 0) + (b or 0) for a, b in zip(ch, dis)] if ch and dis else None
            batch.append([d, 'consolidated' if v.get('ds') == 'def' else 'real-time', v.get('res') or 15]
                         + [arr(k) for k, _ in ECO2MIX_FIELDS] + [bat])
        with conn.cursor() as cur:
            cur.executemany(sql, batch)
        conn.commit()
        rows += len(batch)
    return rows


def load_m0(conn):
    m = read_json(os.path.join(DATA, 'm0.json')) or {}
    batch = [(r['month'] + '-01', r.get('base'), r.get('windM0'), r.get('solarM0'), r.get('windAvgMW'), r.get('solarAvgMW'),
              r.get('windNegShare'), r.get('solarNegShare'), bool(r.get('complete'))) for r in m.get('months') or [] if r.get('base') is not None]
    with conn.cursor() as cur:
        cur.executemany("""insert into market.fr_m0_month (month, base_eur_mwh, wind_m0_eur_mwh, solar_m0_eur_mwh, wind_avg_mw, solar_avg_mw,
              wind_neg_share, solar_neg_share, complete) values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (month) do update set base_eur_mwh = excluded.base_eur_mwh, wind_m0_eur_mwh = excluded.wind_m0_eur_mwh,
              solar_m0_eur_mwh = excluded.solar_m0_eur_mwh, wind_avg_mw = excluded.wind_avg_mw, solar_avg_mw = excluded.solar_avg_mw,
              wind_neg_share = excluded.wind_neg_share, solar_neg_share = excluded.solar_neg_share, complete = excluded.complete,
              loaded_at = now()""", batch)
    conn.commit()
    return len(batch)


# ── French regions (ODRÉ, read from the provider, not from the repo) ──
ODRE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/'
REGION_FIELDS = [('consommation', 'consumption_mw'), ('nucleaire', 'nuclear_mw'), ('eolien', 'wind_mw'), ('solaire', 'solar_mw'),
                 ('hydraulique', 'hydro_mw'), ('thermique', 'thermal_mw'), ('bioenergies', 'bio_mw'), ('ech_physiques', 'exchanges_mw'),
                 ('tch_eolien', 'wind_lf_pct'), ('tch_solaire', 'solar_lf_pct')]


def _odre_export(ds, d_from, d_to):
    import urllib.parse, urllib.request
    q = urllib.parse.urlencode({'select': 'libelle_region,date_heure,' + ','.join(f for f, _ in REGION_FIELDS),
                                'where': f'date_heure >= "{d_from}" and date_heure < "{d_to}"'})
    with urllib.request.urlopen(ODRE + ds + '/exports/json?' + q, timeout=600) as r:
        return json.load(r)


def load_fr_regions(conn, full):
    """Consolidated history (from 2013 on a full load, else the last 75 days) then
    the real-time weeks not consolidated yet. Hourly averages on the Paris clock."""
    with conn.cursor() as cur:
        cur.execute("select max(delivery_date) from market.fr_region_day where dataset = 'consolidated'")
        last = cur.fetchone()[0]
    start = date(2013, 1, 1) if (full or last is None) else last - timedelta(days=75)
    today = datetime.now(PARIS).date()
    rows = 0
    chunks = []
    a = start
    while a < today:
        b = min(today + timedelta(days=1), date(a.year + 1, 1, 1))
        chunks.append(('eco2mix-regional-cons-def', 'consolidated', a, b))
        a = b
    chunks.append(('eco2mix-regional-tr', 'real-time', today - timedelta(days=70), today + timedelta(days=1)))
    for ds, label, a, b in chunks:
        recs = _odre_export(ds, a.isoformat(), b.isoformat())
        acc = {}
        for r in recs:
            reg, t = r.get('libelle_region'), r.get('date_heure')
            if not reg or not t or r.get('consommation') in (None, ''):
                continue
            loc = datetime.fromisoformat(t).astimezone(PARIS)
            day = acc.setdefault((reg, loc.date()), {})
            for f, _ in REGION_FIELDS:
                v = num(r.get(f))
                if v is not None:
                    s_, n_ = day.setdefault((f, loc.hour), (0.0, 0))
                    day[(f, loc.hour)] = (s_ + v, n_ + 1)
        batch = []
        for (reg, d), vals in acc.items():
            arrs = {}
            for f, col in REGION_FIELDS:
                arr = [None] * 24
                for h in range(24):
                    if (f, h) in vals:
                        s_, n_ = vals[(f, h)]
                        arr[h] = round(s_ / n_, 2)
                arrs[col] = arr if any(v is not None for v in arr) else None
            if arrs['consumption_mw'] is None:
                continue
            batch.append((reg, d, label) + tuple(arrs[col] for _, col in REGION_FIELDS))
        cols = ', '.join(col for _, col in REGION_FIELDS)
        upd = ', '.join(f'{col} = excluded.{col}' for _, col in REGION_FIELDS)
        # Real-time rows never overwrite consolidated ones.
        sql = (f"insert into market.fr_region_day (region, delivery_date, dataset, {cols}) values ({', '.join(['%s'] * (3 + len(REGION_FIELDS)))}) "
               f"on conflict (region, delivery_date) do update set dataset = excluded.dataset, {upd}, loaded_at = now()"
               + (" where market.fr_region_day.dataset <> 'consolidated'" if label == 'real-time' else ''))
        with conn.cursor() as cur:
            cur.executemany(sql, batch)
        conn.commit()
        rows += len(batch)
        log(f'  fr_regions {label} {a} → {b}: {len(batch)} region-days')
    return rows


def load_go(conn):
    quotes = {}
    path = os.path.join(DATA, 'go_prices.csv')
    if os.path.exists(path):
        with open(path, newline='') as f:
            for r in csv.DictReader(f):
                try:
                    qd, yr = r.get('mail_date') or r.get('parsed_date'), int(float(r.get('year') or 0))
                except ValueError:
                    continue
                if not qd or not yr:
                    continue
                quotes[(qd, r.get('product') or '', yr)] = (r.get('term'), num(r.get('bid')), num(r.get('ask')), r.get('source') or 'Commerg')
    auctions = []
    a = read_json(os.path.join(DATA, 'go_auctions.json')) or {}
    for au in a.get('auctions') or []:
        m = au.get('auction_month')
        for t in au.get('by_technology') or []:
            if m and t.get('technology'):
                auctions.append((m + '-01', t['technology'], num(t.get('offered_mwh')), num(t.get('allocated_mwh')), num(t.get('price_eur_mwh'))))
    with conn.cursor() as cur:
        cur.executemany("""insert into market.go_quote (quote_date, product, production_year, term, bid, ask, source) values (%s,%s,%s,%s,%s,%s,%s)
            on conflict (quote_date, product, production_year) do update set term = excluded.term, bid = excluded.bid, ask = excluded.ask""",
                        [k + v for k, v in quotes.items()])
        cur.executemany("""insert into market.go_auction (auction_month, technology, offered_mwh, allocated_mwh, price_eur_mwh) values (%s,%s,%s,%s,%s)
            on conflict (auction_month, technology) do update set offered_mwh = excluded.offered_mwh,
              allocated_mwh = excluded.allocated_mwh, price_eur_mwh = excluded.price_eur_mwh""", auctions)
    conn.commit()
    return len(quotes) + len(auctions)


# ── Orchestration ─────────────────────────────────────────────────────
def changed(conn, paths, full):
    if full:
        return list(paths)
    with conn.cursor() as cur:
        cur.execute("select path, sha256 from ops.file_state")
        known = dict(cur.fetchall())
    return [p for p in paths if known.get(os.path.relpath(p, ROOT)) != sha(p)]


def mark_loaded(conn, paths):
    with conn.cursor() as cur:
        cur.executemany("""insert into ops.file_state (path, sha256) values (%s,%s)
            on conflict (path) do update set sha256 = excluded.sha256, loaded_at = now()""",
                        [(os.path.relpath(p, ROOT), sha(p)) for p in paths])
    conn.commit()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--full', action='store_true', help='reload every source file')
    ap.add_argument('--db', default=os.environ.get('WAREHOUSE_DB_URL') or os.environ.get('SUPABASE_DB_URL'))
    args = ap.parse_args()
    if not args.db:
        log('No database URL (WAREHOUSE_DB_URL / SUPABASE_DB_URL): nothing to do.')
        return 0
    try:
        commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        commit = None

    with psycopg.connect(args.db, autocommit=False, prepare_threshold=None) as conn:
        log('Migrations')
        migrate(conn)
        with conn.cursor() as cur:
            cur.execute("insert into ops.sync_run (mode, git_commit) values (%s, %s) returning run_id",
                        ('full' if args.full else 'incremental', commit))
            run_id = cur.fetchone()[0]
        conn.commit()
        files_read = rows = 0
        try:
            daily = sorted(glob.glob(os.path.join(DATA, 'history', 'daily', '*.json')))
            todo = changed(conn, daily, args.full)
            # The day after a changed file is realigned with it: reload it too.
            names = {os.path.basename(p) for p in todo}
            for p in list(todo):
                nxt = (date.fromisoformat(os.path.basename(p)[:10]) + timedelta(days=1)).isoformat() + '.json'
                q = os.path.join(DATA, 'history', 'daily', nxt)
                if nxt not in names and os.path.exists(q):
                    todo.append(q); names.add(nxt)
            todo.sort()
            log(f'Daily files: {len(todo)} to load of {len(daily)}')
            rows += load_daily(conn, todo)
            mark_loaded(conn, todo)
            files_read += len(todo)

            groups = [
                ([os.path.join(DATA, 'history', 'commodities_series.json'), os.path.join(DATA, 'commodities.json')], load_commodities),
                ([os.path.join(DATA, 'history', 'fr_market_series.json'), os.path.join(DATA, 'history', 'fr_market_calchain.json'),
                  os.path.join(DATA, 'fr_market.json')], load_forwards),
                ([os.path.join(DATA, 'go_prices.csv'), os.path.join(DATA, 'go_auctions.json')], load_go),
                ([os.path.join(DATA, 'm0.json')], load_m0),
            ]
            # Energy-Charts: installed capacity, monthly flow files
            cap = [os.path.join(DATA, 'history', 'capacity.json')]
            cap = [p for p in cap if os.path.exists(p)]
            if cap and changed(conn, cap, args.full):
                n = load_capacity(conn); log(f'load_capacity: {n} rows'); rows += n
                mark_loaded(conn, cap); files_read += len(cap)
            flows = sorted(glob.glob(os.path.join(DATA, 'history', 'flows', '*.json')))
            ftodo = changed(conn, flows, args.full)
            if ftodo:
                n = load_flows(conn, ftodo); log(f'load_flows: {n} rows from {len(ftodo)} files'); rows += n
                mark_loaded(conn, ftodo); files_read += len(ftodo)

            # France national generation (RTE éCO2mix monthly files)
            e2m = sorted(glob.glob(os.path.join(DATA, 'history', 'rte', '[0-9]*.json')))
            etodo = changed(conn, e2m, args.full)
            if etodo:
                n = load_fr_eco2mix(conn, etodo); log(f'load_fr_eco2mix: {n} days from {len(etodo)} files'); rows += n
                mark_loaded(conn, etodo); files_read += len(etodo)

            # French regions straight from ODRÉ (a network failure is logged, not fatal)
            try:
                n = load_fr_regions(conn, args.full); log(f'load_fr_regions: {n} rows'); rows += n
            except Exception as e:
                conn.rollback(); log(f'  ! fr_regions skipped: {e}')

            for paths, fn in groups:
                paths = [p for p in paths if os.path.exists(p)]
                if changed(conn, paths, args.full):
                    n = fn(conn)
                    log(f'{fn.__name__}: {n} rows')
                    rows += n
                    mark_loaded(conn, paths)
                    files_read += len(paths)

            with conn.cursor() as cur:
                cur.execute("select ops.run_quality_checks()")
                issues = cur.fetchone()[0]
                cur.execute("select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c "
                            "join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('market','meta','ops') and c.relkind = 'r'")
                size = cur.fetchone()[0]
                cur.execute("update ops.sync_run set finished_at = now(), status = 'ok', files_read = %s, rows_written = %s, message = %s where run_id = %s",
                            (files_read, rows, f'{issues} open quality issues · warehouse size {size}', run_id))
            conn.commit()
            log(f'OK · {files_read} files · {rows} rows · {issues} open quality issues · size {size}')
        except Exception as e:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("update ops.sync_run set finished_at = now(), status = 'failed', message = %s where run_id = %s",
                            (str(e)[:2000], run_id))
            conn.commit()
            raise
    return 0


if __name__ == '__main__':
    sys.exit(main())
