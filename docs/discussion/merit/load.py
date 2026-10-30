import json, glob, os
import numpy as np
ROOT = '/home/ubuntu/PowerKlock/.claude/worktrees/bridge-cse_019SBz1eD5ytFRZxqbyv9hcG'
FIELDS = ('nuclear', 'wind', 'solar', 'hydroRoR', 'hydroLake', 'hydroPS', 'pumping', 'gas', 'coal', 'oil', 'bio', 'load', 'exchanges', 'batteryCharge', 'batteryDischarge')
def eco(y):
    out = {k: [] for k in FIELDS}; days = []
    for f in sorted(glob.glob(f'{ROOT}/data/history/rte/{y}-*.json')):
        d = json.load(open(f))
        for day in sorted(d['days']):
            v = d['days'][day]
            if not v.get('load') or len(v['load']) != 96: continue
            days.append(day)
            for k in FIELDS:
                a = v.get(k)
                a = np.array([np.nan if x is None else x for x in a], float) if a else np.zeros(96)
                out[k].append(a.reshape(24, 4).mean(1))
    return days, {k: np.array(v) for k, v in out.items()}
def nuc_avail():
    s = json.load(open(f'{ROOT}/data/history/commodities_series.json'))['series']['fr_nuc_avail']['points']
    return dict(s)
