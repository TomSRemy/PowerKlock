#!/usr/bin/env python3
"""Which forward view should the long-term PPA pricer use: the flat Cal with the day-ahead's historical
seasonal shape, or the quoted months / quarters (as the short-term pricer, the capture fan and the morning
page do, data/history/fr_forward_monthly.json)?

Two parts.
1. Today's gap, per delivery year: value of one MWh of national solar / wind
       quoted months   Σ w_m × F_m × c_m ÷ Σ w_m
       flat Cal        Cal × Σ w_m × r_m × c_m ÷ Σ w_m
   w_m = national monthly output share × paid share, c_m = monthly capture rate of a method
   (data/history/ppa_forecast.json), F_m = monthly forward, r_m = historical month ÷ year day-ahead ratio.
2. Backtest 2023-2025: in the last quarter of Y−1, the four quoted quarters of Y (SEFE closes,
   data/history/fr_market_contracts_FR.json) against the realised seasonal factor of Y,
       Σ_q E_q × baseload_q ÷ (E_year × baseload_year)
   and against the historical quarter ratios known at the time (complete years since 2016, 2022 left out).

Result (27 Oct. 2026 data):
  gap, capacity trend, €/MWh (quoted − flat): solar 2027 −2.0, 2028 +0.8, 2029 −0.3;
  wind 2027 +4.7, 2028 +6.1, 2029 −0.5 (2029 has no month quoted: both sides are Cal × ratios).
  backtest, error of the seasonal factor (forecast − realised):
             solar hist / quoted       wind hist / quoted
      2023   −0.034 / −0.079           +0.019 / +0.083
      2024   +0.043 / +0.060           −0.016 / −0.020
      2025   +0.052 / +0.044           −0.019 / −0.002
  As a forecast the quoted shape does not beat history (2023: the post-crisis winter premium).
  Its value is elsewhere: it is the price a hedge locks today, the market value of the profile.

Writes data/history/ppa_forward_shape_test.json
    python scripts/ppa_forward_shape_test.py
"""
import calendar
import json
import os
import statistics as stt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
OUT = os.path.join(H, 'ppa_forward_shape_test.json')
METHODS = ('hybrid', 'regional', 'step')


def load(name):
    with open(os.path.join(H, name)) as f:
        return json.load(f)


def todays_gap(FW, FC, cal):
    R = FW['ratios']['year']
    rows = []
    for tech in ('solar', 'wind'):
        s, f = FC['share'][tech], FC['forecast'][tech]['curt']
        for Y in sorted(cal):
            key = lambda m: f'{Y}-{m:02d}'
            if not all(key(m) in f and key(m) in FW['months'] for m in range(1, 13)):
                continue
            hrs = {m: calendar.monthrange(Y, m)[1] * 24 for m in range(1, 13)}
            rn = sum(R[str(m)] * hrs[m] for m in hrs) / sum(hrs.values())
            w = {m: s[str(m)] * f[key(m)]['paid'] for m in hrs}
            W = sum(w.values())
            row = {'tech': tech, 'year': Y, 'cal': cal[Y]}
            for meth in METHODS:
                c = {m: f[key(m)][meth] for m in hrs}
                quoted = sum(w[m] * FW['months'][key(m)]['value'] * c[m] for m in hrs) / W
                flat = cal[Y] * sum(w[m] * R[str(m)] / rn * c[m] for m in hrs) / W
                row[meth] = {'quoted': round(quoted, 2), 'flat': round(flat, 2), 'gap': round(quoted - flat, 2)}
            rows.append(row)
    return rows


def backtest(C, cap):
    ix = {f: i + 1 for i, f in enumerate(cap['fields'])}
    agg = {}
    for r in cap['days']:
        y, q = int(r[0][:4]), (int(r[0][5:7]) - 1) // 3 + 1
        a = agg.setdefault((y, q), dict(P=0, N=0, sE=0, wE=0))
        a['P'] += r[ix['pSum']]; a['N'] += r[ix['pN']]
        a['sE'] += r[ix['sE']]; a['wE'] += r[ix['wE']]
    full = lambda y: all((y, q) in agg for q in (1, 2, 3, 4))
    base = lambda y, q: agg[(y, q)]['P'] / agg[(y, q)]['N']
    year_base = lambda y: sum(agg[(y, q)]['P'] for q in range(1, 5)) / sum(agg[(y, q)]['N'] for q in range(1, 5))
    rows = []
    for Y in range(2023, 2030):
        keys = [f'Q{q}{Y}' for q in (1, 2, 3, 4)]
        if not full(Y) or not all(k in C for k in keys):
            continue
        hy = [y for y in range(2016, Y - 1) if y != 2022 and full(y)]
        rh = {q: stt.mean(base(y, q) / year_base(y) for y in hy) for q in (1, 2, 3, 4)}
        dates = sorted(set.intersection(*[set(C[k]['points']) for k in keys]))
        dates = [d for d in dates if d.startswith(str(Y - 1)) and d[5:7] in ('10', '11', '12')]
        if not dates:
            continue
        hrs = {q: sum(calendar.monthrange(Y, m)[1] for m in range(3 * q - 2, 3 * q + 1)) for q in (1, 2, 3, 4)}
        for t, tech in (('s', 'solar'), ('w', 'wind')):
            E = {q: agg[(Y, q)][t + 'E'] for q in (1, 2, 3, 4)}
            real = sum(E[q] * base(Y, q) for q in E) / (sum(E.values()) * year_base(Y))
            sh = {q: stt.mean(agg[(y, q)][t + 'E'] / sum(agg[(y, k)][t + 'E'] for k in range(1, 5)) for y in hy) for q in E}
            hist = sum(sh[q] * rh[q] for q in sh)
            quoted = []
            for d in dates:
                Qv = {q: C[f'Q{q}{Y}']['points'][d] for q in (1, 2, 3, 4)}
                calv = sum(Qv[q] * hrs[q] for q in Qv) / sum(hrs.values())
                quoted.append(sum(sh[q] * Qv[q] / calv for q in sh))
            qv = stt.mean(quoted)
            rows.append({'year': Y, 'tech': tech, 'realised': round(real, 4), 'historical': round(hist, 4), 'quoted': round(qv, 4),
                         'errHistorical': round(hist - real, 4), 'errQuoted': round(qv - real, 4), 'quoteDays': len(dates),
                         'historyYears': [hy[0], hy[-1]]})
    return rows


def main():
    FW, FC = load('fr_forward_monthly.json'), load('ppa_forecast.json')
    C, cap = load('fr_market_contracts_FR.json')['FR'], load('fr_capture.json')
    cal = {int(k[3:]): v['points'][max(v['points'])] for k, v in C.items() if k.startswith('Cal') and not k.endswith('Peak') and v.get('points')}
    out = {'asOf': FW['asOf'], 'gap': todays_gap(FW, FC, cal), 'backtest': backtest(C, cap)}
    for r in out['gap']:
        print(r['tech'], r['year'], 'Cal', r['cal'], ' | '.join(f"{m} quoted {r[m]['quoted']} flat {r[m]['flat']} gap {r[m]['gap']:+}" for m in METHODS))
    for r in out['backtest']:
        print(r['year'], r['tech'], 'realised', r['realised'], 'hist err', f"{r['errHistorical']:+.3f}", 'quoted err', f"{r['errQuoted']:+.3f}")
    for tech in ('solar', 'wind'):
        b = [r for r in out['backtest'] if r['tech'] == tech]
        if b:
            print(tech, 'mean abs error: historical', round(stt.mean(abs(r['errHistorical']) for r in b), 3), 'quoted', round(stt.mean(abs(r['errQuoted']) for r in b), 3))
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
