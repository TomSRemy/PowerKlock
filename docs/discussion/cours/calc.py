"""Chiffres du cours, recalculés depuis data/history (lancer depuis la racine du dépôt). Écrit docs/discussion/cours/calc.json."""
import json, os, glob
import numpy as np

R = 'data/history'
out = {}

def hourly(y):
    d = json.load(open(f'{R}/fr_hourly/{y}.json'))['days']
    days = sorted(d)
    A = {k: np.array([[np.nan if v is None else v for v in d[x][k]][:24] + [np.nan] * (24 - len(d[x][k][:24])) for x in days], float) for k in 'pswln'}
    A['month'] = np.array([int(x[5:7]) for x in days])
    A['days'] = days
    return A

# 1. Capture (production payée seulement aux prix > 0), janvier–octobre, éolien et solaire
cap = {}
for y in range(2020, 2027):
    A = hourly(y); k = A['month'] <= 10
    p = A['p'][k]; ok = np.isfinite(p)
    base = np.nanmean(p)
    r = {'base': round(float(base), 1)}
    for t in 'ws':
        g = np.where(ok, A[t][k], 0)
        pv = np.sum(g * np.where(p > 0, p, 0)) / np.sum(g)        # valeur d'un MWh, non payé aux prix <= 0
        pa = np.sum(g * np.nan_to_num(p)) / np.sum(g)             # valeur brute
        r[t] = {'value': round(float(pv), 2), 'capture_paid': round(float(pv / base), 3),
                'capture_all': round(float(pa / base), 3)}
        if t == 'w':
            q1 = A['month'][k] <= 3
            r[t]['share_jan_mar'] = round(float(np.sum(g[q1]) / np.sum(g)), 3)
    # heures à prix nul ou négatif (année complète disponible)
    pp = A['p']; r['h_le0'] = int(np.sum(pp <= 0)); r['h_lt0'] = int(np.sum(pp < 0)); r['n_hours'] = int(np.isfinite(pp).sum())
    cap[y] = r
out['capture_jan_oct'] = cap

# 2. Coût d'une centrale à gaz = TTF / 0,55 + 0,37 × EUA (moyenne janvier–octobre)
c = json.load(open(f'{R}/commodities_series.json'))['series']
ttf = dict(c['ttf']['points']); eua = dict(c['eua']['points'])
gas = {}
for y in range(2020, 2027):
    v = [ttf[d] / 0.55 + 0.37 * eua[d] for d in ttf if d.startswith(str(y)) and d in eua and int(d[5:7]) <= 10]
    gas[y] = round(float(np.mean(v)), 1)
out['gas_plant_cost_jan_oct'] = gas

# 3. Réservoirs (ENTSO-E) et vent : écart à la moyenne, par année
hy = json.load(open(f'{R}/hydro_reservoirs.json'))['countries']['FR']['weeks']
res = {}
for d, v in hy:
    res.setdefault(int(d[:4]), []).append(v)
wind = {}
for f in sorted(glob.glob(f'{R}/fr_hourly/*.json')):
    y = int(os.path.basename(f)[:4]); A = hourly(y)
    wind[y] = float(np.nanmean(A['w']))
out['res_mean_mwh'] = {y: round(float(np.mean(v))) for y, v in res.items()}
out['wind_mean_mw'] = {y: round(v) for y, v in wind.items()}

# 4. Prix moyens France / Allemagne et heures d'écart < 1 €
fd = {}
for y in range(2020, 2027):
    fr, de = [], []
    for f in sorted(glob.glob(f'{R}/daily/{y}-*.json')):
        z = json.load(open(f)).get('zones', {})
        a, b = (z.get('FR') or {}).get('hourly'), (z.get('DE_LU') or {}).get('hourly')
        if a and b and len(a) == len(b) and len(a) in (24, 96):
            a = np.array([np.nan if v is None else v for v in a], float); b = np.array([np.nan if v is None else v for v in b], float)
            if len(a) == 96: a, b = a.reshape(24, 4).mean(1), b.reshape(24, 4).mean(1)
            fr.append(a); de.append(b)
    fr, de = np.concatenate(fr), np.concatenate(de); ok = np.isfinite(fr) & np.isfinite(de)
    fr, de = fr[ok], de[ok]
    fd[y] = {'fr': round(float(fr.mean()), 1), 'de': round(float(de.mean()), 1),
             'share_gap_lt1': round(float(np.mean(np.abs(fr - de) < 1)), 3),
             'share_fr_cheaper_5': round(float(np.mean(de - fr >= 5)), 3)}
out['fr_de'] = fd

json.dump(out, open('docs/discussion/cours/calc.json', 'w'), indent=1)
print(json.dumps(out, indent=1))
