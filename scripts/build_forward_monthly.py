#!/usr/bin/env python3
"""France baseload forward for every month of the quoted horizon, for the PPA pricer's
monthly periods (a contract that is not a calendar year: April 2027 → November 2028).

For each month, the finest listed liquid contract (last SEFE close; liquid = months M+1 to M+3, quarters Q+1 to Q+4,
Cals; seasons and further months or quarters are quoted but thinly traded and left out):
  month contract                       → its price
  else quarter                         → quarter × (month ÷ quarter ratio)
  else season (Sum = Apr–Sep, Win = Oct–Mar) → season × (month ÷ season ratio)
  else Cal                             → Cal × (month ÷ year ratio)
The ratios are the day-ahead baseload's own, averaged over the complete years since 2016
(2022 left out). Then every listed contract is matched again: the months it covers are
scaled so that their average equals its price (quarters inside a Cal, months inside a
quarter), finest last, so a listed contract always wins.

Writes data/history/fr_forward_monthly.json
    {"asOf", "months": {"2027-04": {"value", "from": "Q22027"}}, "ratios": {...}}
"""
import json
import os
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, 'data', 'history')
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def ratios():
    """month ÷ year, month ÷ quarter, month ÷ season baseload ratios"""
    by = {}
    for y in range(2016, date.today().year):
        if y == 2022:
            continue
        try:
            days = json.load(open(os.path.join(H, 'fr_hourly', f'{y}.json')))['days']
        except OSError:
            continue
        s = {m: [] for m in range(1, 13)}
        for d, v in days.items():
            p = [x for x in (v.get('p') or []) if x is not None]
            if p:
                s[int(d[5:7])].append(sum(p) / len(p))
        if all(s.values()):
            by[y] = {m: sum(v) / len(v) for m, v in s.items()}
    def avg(f):
        return {m: sum(f(b, m) for b in by.values()) / len(by) for m in range(1, 13)}
    yr = avg(lambda b, m: b[m] / (sum(b.values()) / 12))
    q = avg(lambda b, m: b[m] / (sum(b[i] for i in range((m - 1) // 3 * 3 + 1, (m - 1) // 3 * 3 + 4)) / 3))
    summer = list(range(4, 10))
    se = avg(lambda b, m: b[m] / (sum(b[i] for i in (summer if m in summer else [10, 11, 12, 1, 2, 3])) / 6))
    return {'year': yr, 'quarter': q, 'season': se, 'years': sorted(by)}


def main():
    ct = json.load(open(os.path.join(H, 'fr_market_contracts.json')))['FR']
    newest = max(max(v['points']) for k, v in ct.items() if v.get('points') and not k.endswith('Peak'))
    live = {k: v['points'][max(v['points'])] for k, v in ct.items() if v.get('points') and max(v['points']) >= newest and not k.endswith('Peak')}
    # liquid products only for the shape (Tom 29 Oct. 2026): the next three months, the next four quarters; seasons
    # left out; every Cal kept for the level. A contract outside that window (a month M+9, a quarter of Y+2) is
    # quoted but thinly traded: it does not shape the months
    d0 = date.fromisoformat(newest)
    def liquid(k):
        if k.startswith('Cal'):
            return True
        if k[:3] in MON:
            y, m = int(k[3:]), MON.index(k[:3]) + 1
            ahead = (y - d0.year) * 12 + m - d0.month
            return 1 <= ahead <= 3
        if k.startswith('Q'):
            q, y = int(k[1]), int(k[2:])
            ahead = (y - d0.year) * 4 + q - ((d0.month - 1) // 3 + 1)
            return 1 <= ahead <= 4
        return False
    shaping = {k for k in live if not k.startswith('Cal')}
    dropped = sorted(k for k in shaping if not liquid(k))
    live = {k: v for k, v in live.items() if liquid(k)}
    print('illiquid, not used for the shape:', ', '.join(dropped))
    R = ratios()
    today = date.today()
    first = (today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1)
    last_cal = max(int(k[3:]) for k in live if k.startswith('Cal'))
    months = {}
    y, m = first
    while y <= last_cal:
        q = (m - 1) // 3 + 1
        sea = f'Sum{y}' if 4 <= m <= 9 else (f'Win{y}' if m >= 10 else f'Win{y - 1}')
        if f'{MON[m - 1]}{y}' in live:
            v, src = live[f'{MON[m - 1]}{y}'], f'{MON[m - 1]}{y}'
        elif f'Q{q}{y}' in live:
            v, src = live[f'Q{q}{y}'] * R['quarter'][m], f'Q{q}{y}'
        elif sea in live:
            v, src = live[sea] * R['season'][m], sea
        elif f'Cal{y}' in live:
            v, src = live[f'Cal{y}'] * R['year'][m], f'Cal{y}'
        else:
            v, src = None, None
        if v is not None:
            months[f'{y}-{m:02d}'] = {'value': v, 'from': src}
        m += 1
        if m > 12:
            y, m = y + 1, 1

    # a year whose months all come from its Cal: its seasonal shape leans on the last year quoted by liquid quarters or finer
    # (Tom 29 Oct. 2026: the historical shape should take the forward quotes' shape into account), the weight halving
    # every year further: shape = w × that year's month ÷ year ratios + (1 − w) × the day-ahead's historical ratios,
    # w = 0.5 ^ (years after it). Before, such a year took the history alone and its value jumped from the quoted year's
    # (solar k 1.033 in 2028, 1.000 in 2029)
    def year_of(k):
        return int(k[:4])
    full = {}
    for yy in sorted({year_of(k) for k in months}):
        ks = [f'{yy}-{i:02d}' for i in range(1, 13)]
        if all(k in months and not months[k]['from'].startswith(('Cal', 'Sum', 'Win')) for k in ks):
            mean = sum(months[k]['value'] for k in ks) / 12
            full[yy] = {i: months[f'{yy}-{i:02d}']['value'] / mean for i in range(1, 13)}
    for yy in sorted({year_of(k) for k in months}):
        ks = [f'{yy}-{i:02d}' for i in range(1, 13)]
        prev = [q for q in full if q < yy]
        if not prev or not all(k in months and months[k]['from'] == f'Cal{yy}' for k in ks):
            continue
        q = max(prev)
        w = 0.5 ** (yy - q)
        for i in range(1, 13):
            months[f'{yy}-{i:02d}']['value'] = live[f'Cal{yy}'] * (w * full[q][i] + (1 - w) * R['year'][i])
            months[f'{yy}-{i:02d}']['shape'] = f'{round(w * 100)} % Q{q}, {round((1 - w) * 100)} % history'

    # listed contracts matched again, finest first: a quarter rescales its free months, then seasons, then the
    # Cal rescales what is left free, so every listed contract's average is its price (months are taken as they are)
    def cover(k):
        if k.startswith('Cal'):
            yy = int(k[3:]); return [f'{yy}-{i:02d}' for i in range(1, 13)]
        if k.startswith('Q'):
            qq, yy = int(k[1]), int(k[2:]); return [f'{yy}-{i:02d}' for i in range(qq * 3 - 2, qq * 3 + 1)]
        if k.startswith('Sum'):
            yy = int(k[3:]); return [f'{yy}-{i:02d}' for i in range(4, 10)]
        if k.startswith('Win'):
            yy = int(k[3:]); return [f'{yy}-{i:02d}' for i in (10, 11, 12)] + [f'{yy + 1}-{i:02d}' for i in (1, 2, 3)]
        return []
    fixed = {k for k, v in months.items() if v['from'][:3] in MON}
    for prefix in ('Q', 'Sum', 'Win', 'Cal'):
        done = set()
        for k, price in live.items():
            if not k.startswith(prefix):
                continue
            ks = [x for x in cover(k) if x in months]
            if len(ks) < len(cover(k)):
                continue          # partly delivered: not rescaled
            free = [x for x in ks if x not in fixed]
            if not free:
                continue
            target = price * len(ks) - sum(months[x]['value'] for x in ks if x in fixed)
            cur = sum(months[x]['value'] for x in free)
            if cur > 0 and target > 0:
                f = target / cur
                for x in free:
                    months[x]['value'] *= f
                done |= set(ks)
        fixed |= done
    # the market's peak ÷ base ratio of each month (weekdays 08:00-20:00): finest peak contract listed with its base
    pk = {k[:-4]: v['points'][max(v['points'])] for k, v in ct.items() if k.endswith('Peak') and v.get('points') and max(v['points']) >= newest}
    for k, v in months.items():
        y, m = int(k[:4]), int(k[5:7])
        q = (m - 1) // 3 + 1
        for lab in (f'{MON[m - 1]}{y}', f'Q{q}{y}', f'Cal{y}'):
            if lab in pk and lab in live:
                v['peakRatio'] = round(pk[lab] / live[lab], 3)
                v['peakFrom'] = lab
                break
    for v in months.values():
        v['value'] = round(v['value'], 2)
    out = {'asOf': newest, 'source': 'SEFE Energy Market Insights, last closes, liquid products only (months M+1 to M+3, quarters Q+1 to Q+4, Cals); day-ahead ratios (complete years, 2022 left out)',
           'illiquidLeftOut': dropped,
           'ratios': {k: {str(m): round(x, 4) for m, x in v.items()} if isinstance(v, dict) else v for k, v in R.items()}, 'months': months}
    with open(os.path.join(H, 'fr_forward_monthly.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(len(months), 'months', min(months), '→', max(months))


if __name__ == '__main__':
    main()
