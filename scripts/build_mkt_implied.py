#!/usr/bin/env python3
"""What the forward market implies for the capture rate of French solar and wind (PPA pricer, in observation).

For each delivery year quoted, the value of one MWh of the national profile on today's France forwards split between
peak hours (Monday–Friday 08:00–20:00, the EEX French peak product) and off-peak hours:
    off-peak price = (base × hours − peak × peak hours) ÷ off-peak hours, by quarter when its base and peak are quoted,
                     else by year (Cal base and Cal peak)
    value          = Σ (share of the output in peak × peak + share off-peak × off-peak), output-weighted
    capture        = value ÷ Cal base
The output's split between peak and off-peak hours comes from the national profile (RTE éCO2mix, the last three
complete years, 2022 left out). Inside the peak and off-peak blocks the market gives no shape, and the midday dip of
solar within the peak block grows with the fleet: the same formula on realised prices overstated solar capture by a
factor that went from 1/0.90 (2016) to 1/0.64 (2025). So the implied capture is the formula × that ratio of the last
complete year (the shape inside the blocks held at its latest level). Capture over all hours (the convention of a
plain baseload comparison). A reference only, not in the average of methods; kept every day so it can be compared
with what is realised as months and quarters deliver.

Reads data/history/fr_market_contracts_FR.json, data/history/fr_hourly/YYYY.json
Writes data/history/mkt_implied.json  {"note", "latest", "days": {"2026-10-28": {"2027": {"solar", "wind", "pbRatio"}, …}}}
    python scripts/build_mkt_implied.py
"""
import calendar
import json
import os
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'mkt_implied.json')


def last(C, k):
    p = (C.get(k) or {}).get('points') or {}
    return (max(p), p[max(p)]) if p else (None, None)


def hours(y, months):
    """all hours and peak hours (Mon–Fri 08–20) of the months of year y"""
    a = pk = 0
    for m in months:
        for d in range(1, calendar.monthrange(y, m)[1] + 1):
            a += 24
            if date(y, m, d).weekday() < 5:
                pk += 12
    return a, pk


def profile():
    """share of the national solar / wind output in peak hours, by quarter, and quarterly output shares"""
    ys = []
    for f in sorted(os.listdir(os.path.join(H, 'fr_hourly'))):
        y = int(f[:4])
        if y != 2022 and y < date.today().year:
            ys.append(y)
    ys = ys[-3:]
    acc = {t: {q: [0.0, 0.0] for q in (1, 2, 3, 4)} for t in 'sw'}
    for y in ys:
        days = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
        for d, v in days.items():
            dd = date.fromisoformat(d)
            q = (dd.month - 1) // 3 + 1
            for t in 'sw':
                a = v.get(t)
                if not a or None in a:
                    continue
                for h in range(24):
                    acc[t][q][1] += a[h]
                    if dd.weekday() < 5 and 8 <= h < 20:
                        acc[t][q][0] += a[h]
    out = {}
    for t, name in (('s', 'solar'), ('w', 'wind')):
        tot = sum(acc[t][q][1] for q in acc[t])
        out[name] = {q: {'pk': acc[t][q][0] / acc[t][q][1], 'share': acc[t][q][1] / tot} for q in acc[t]}
    return out, ys


def inside_ratio(y):
    """realised capture ÷ the peak/off-peak formula on realised prices, year y (solar, wind): the shape inside the blocks"""
    days = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
    Q = {q: {'P': [0.0, 0], 'pk': [0.0, 0], 's': [0.0, 0.0, 0.0], 'w': [0.0, 0.0, 0.0]} for q in (1, 2, 3, 4)}
    for d, v in days.items():
        if not v.get('p') or None in v['p'] or any(not v.get(t) or None in v[t] for t in 'sw'):
            continue
        dd = date.fromisoformat(d)
        q = (dd.month - 1) // 3 + 1
        for h in range(24):
            p, pk = v['p'][h], dd.weekday() < 5 and 8 <= h < 20
            Q[q]['P'][0] += p; Q[q]['P'][1] += 1
            if pk:
                Q[q]['pk'][0] += p; Q[q]['pk'][1] += 1
            for t in 'sw':
                Q[q][t][0] += v[t][h]; Q[q][t][1] += v[t][h] * pk; Q[q][t][2] += v[t][h] * p
    out = {}
    for t, name in (('s', 'solar'), ('w', 'wind')):
        tot = sum(Q[q][t][0] for q in Q)
        val = 0.0
        for q in Q:
            n, npk = Q[q]['P'][1], Q[q]['pk'][1]
            b, p = Q[q]['P'][0] / n, Q[q]['pk'][0] / npk
            op = (b * n - p * npk) / (n - npk)
            spk = Q[q][t][1] / Q[q][t][0]
            val += Q[q][t][0] / tot * (spk * p + (1 - spk) * op)
        out[name] = (sum(Q[q][t][2] for q in Q) / tot) / val
    return out


def realised(y):
    """capture over all hours of the last complete year, for reference"""
    days = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
    acc = {'p': [0.0, 0], 's': [0.0, 0.0], 'w': [0.0, 0.0]}
    for v in days.values():
        if not v.get('p') or None in v['p'] or any(not v.get(t) or None in v[t] for t in 'sw'):
            continue
        for h in range(24):
            acc['p'][0] += v['p'][h]; acc['p'][1] += 1
            for t in 'sw':
                acc[t][0] += v[t][h] * v['p'][h]; acc[t][1] += v[t][h]
    base = acc['p'][0] / acc['p'][1]
    return {'year': y, 'solar': round(acc['s'][0] / acc['s'][1] / base, 4), 'wind': round(acc['w'][0] / acc['w'][1] / base, 4)}


def main():
    C = json.load(open(os.path.join(H, 'fr_market_contracts_FR.json')))['FR']
    prof, ys = profile()
    ratio = inside_ratio(ys[-1])
    today = None
    row = {}
    for y in range(date.today().year + 1, date.today().year + 6):
        dc, cal = last(C, f'Cal{y}')
        _, calpk = last(C, f'Cal{y}Peak')
        if cal is None or calpk is None:
            continue
        today = max(today or dc, dc)
        A, PK = hours(y, range(1, 13))
        cal_op = (cal * A - calpk * PK) / (A - PK)
        res = {'pbRatio': round(calpk / cal, 4), 'quarters': sum(1 for q in (1, 2, 3, 4) if last(C, f'Q{q}{y}')[1] is not None and last(C, f'Q{q}{y}Peak')[1] is not None)}
        for name in ('solar', 'wind'):
            v = 0.0
            for q in (1, 2, 3, 4):
                ms = range(3 * q - 2, 3 * q + 1)
                _, b = last(C, f'Q{q}{y}')
                _, p = last(C, f'Q{q}{y}Peak')
                if b is not None and p is not None:   # the quarter's own base and peak
                    a, pk = hours(y, ms)
                    op = (b * a - p * pk) / (a - pk)
                else:                                  # else the year's peak and off-peak, flat over the year
                    p, op = calpk, cal_op
                s = prof[name][q]
                v += s['share'] * (s['pk'] * p + (1 - s['pk']) * op)
            res[name + 'Raw'] = round(v / cal, 4)
            res[name] = round(v / cal * ratio[name], 4)
        row[str(y)] = res
    j = json.load(open(OUT)) if os.path.exists(OUT) else {'days': {}}
    j['note'] = ('capture (all hours) implied by today\'s France forwards split peak / off-peak (by quarter when quoted), '
                 f'national profile {ys[0]}–{ys[-1]} (2022 out), × the shape inside the blocks of {ys[-1]}')
    j['ratio'] = {'year': ys[-1], **{k: round(v, 4) for k, v in ratio.items()}}
    j['realised'] = realised(ys[-1])
    if today:
        j['days'][today] = row
        j['latest'] = today
    with open(OUT, 'w') as f:
        json.dump(j, f, separators=(',', ':'))
    print(today, row)


if __name__ == '__main__':
    main()
