"""
PowerDesk — ENTSO-E Data Fetcher
Runs daily via GitHub Actions. Writes JSON files to /data/
"""

import os, json, requests
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

TOKEN = os.environ['ENTSOE_TOKEN']
BASE  = 'https://web-api.tp.entsoe.eu/api'

ZONES = {
    'FR':     '10YFR-RTE------C',
    'DE_LU':  '10Y1001A1001A82H',
    'BE':     '10YBE----------2',
    'NL':     '10YNL----------L',
    'ES':     '10YES-REE------0',
    'PT':     '10YPT-REN------W',
    'IT_NORD':'10Y1001A1001A73I',
    'IT_SICI':'10Y1001A1001A788',
    'GB':     '10YGB----------A',
    'AT':     '10YAT-APG------L',
    'CH':     '10YCH-SWISSGRIDZ',
    'CZ':     '10YCZ-CEPS-----N',
    'SK':     '10YSK-SEPS-----K',
    'HU':     '10YHU-MAVIR----U',
    'RO':     '10YRO-TEL------P',
    'HR':     '10YHR-HEP------M',
    'SI':     '10YSI-ELES-----O',
    'RS':     '10YCS-SERBIATSOV',
    'GR':     '10YGR-HTSO-----Y',
    'BG':     '10YCA-BULGARIA-R',
    'DK_W':   '10YDK-1--------W',
    'DK_E':   '10YDK-2--------M',
    'SE':     '10Y1001A1001A44P',
    'NO_1':   '10YNO-1--------2',
    'FI':     '10YFI-1--------U',
    'LT':     '10YLT-1001A0008Q',
    'LV':     '10YLV-1001A00074',
    'EE':     '10Y1001A1001A39I',
    'PL':     '10YPL-AREA-----S',
    'ME':     '10YCS-CG-TSO---S',
    'MK':     '10YMK-MEPSO----8',
    'MT':     '10Y1001A1001A93C',
}

ZONE_NAMES = {
    'FR':'France','DE_LU':'Germany','BE':'Belgium','NL':'Netherlands',
    'ES':'Spain','PT':'Portugal','IT_NORD':'Italy North','IT_SICI':'Italy South',
    'GB':'Great Britain','AT':'Austria','CH':'Switzerland','CZ':'Czechia',
    'SK':'Slovakia','HU':'Hungary','RO':'Romania','HR':'Croatia',
    'SI':'Slovenia','RS':'Serbia','GR':'Greece','BG':'Bulgaria',
    'DK_W':'Denmark West','DK_E':'Denmark East','SE':'Sweden',
    'NO_1':'Norway North','FI':'Finland','LT':'Lithuania',
    'LV':'Latvia','EE':'Estonia','PL':'Poland','ME':'Montenegro',
    'MK':'N. Macedonia','MT':'Malta',
}

def date_str(offset=0):
    d = datetime.utcnow() + timedelta(days=offset)
    return d.strftime('%Y%m%d') + '0000'

def fetch(params):
    r = requests.get(BASE, params={'securityToken': TOKEN, **params}, timeout=30)
    r.raise_for_status()
    return r.text

def parse_prices(xml_text):
    ns = {'ns': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    points = []
    for ts in root.findall('.//ns:TimeSeries', ns):
        for pt in ts.findall('.//ns:Point', ns):
            pos  = int(pt.findtext('ns:position', '0', ns))
            price = pt.findtext('ns:price.amount', None, ns)
            if price:
                points.append({'hour': pos - 1, 'price': round(float(price), 2)})
    return points

def parse_generation(xml_text):
    ns = {'ns': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {}
    result = {}
    for ts in root.findall('.//ns:TimeSeries', ns):
        psr_type = ts.findtext('.//ns:MktPSRType/ns:psrType', '', ns)
        pts = []
        for pt in ts.findall('.//ns:Point', ns):
            qty = pt.findtext('ns:quantity', None, ns)
            if qty:
                pts.append(float(qty))
        if psr_type and pts:
            result[psr_type] = result.get(psr_type, [])
            result[psr_type].extend(pts)
    return result

PSR_MAP = {
    'B01':'Biomass','B02':'Fossil Brown coal','B03':'Fossil Coal-derived gas',
    'B04':'Fossil Gas','B05':'Fossil Hard coal','B06':'Fossil Oil',
    'B09':'Geothermal','B10':'Hydro Pumped Storage','B11':'Hydro Run-of-river',
    'B12':'Hydro Water Reservoir','B13':'Marine','B14':'Nuclear',
    'B15':'Other renewable','B16':'Solar','B17':'Waste','B18':'Wind Offshore',
    'B19':'Wind Onshore','B20':'Other',
}

def categorize(psr_map):
    cats = {'nuclear':0,'solar':0,'wind':0,'hydro':0,'fossil':0,'biomass':0,'other':0}
    for psr, vals in psr_map.items():
        avg = sum(vals)/len(vals) if vals else 0
        name = PSR_MAP.get(psr,'')
        if 'Nuclear' in name:           cats['nuclear'] += avg
        elif 'Solar' in name:           cats['solar']   += avg
        elif 'Wind' in name:            cats['wind']    += avg
        elif 'Hydro' in name:           cats['hydro']   += avg
        elif 'Fossil' in name:          cats['fossil']  += avg
        elif 'Biomass' in name or 'Waste' in name: cats['biomass'] += avg
        else:                           cats['other']   += avg
    return {k: round(v) for k,v in cats.items()}

# ─────────────────────────────────────────────
# FETCH PRICES
# ─────────────────────────────────────────────
def fetch_prices():
    print("Fetching prices...")
    today    = date_str(0)
    tomorrow = date_str(1)
    yesterday = date_str(-1)
    results  = []

    for code, eic in ZONES.items():
        try:
            # Today
            xml  = fetch({'documentType':'A44','in_Domain':eic,'out_Domain':eic,
                           'periodStart':today,'periodEnd':tomorrow})
            pts  = parse_prices(xml)
            if not pts:
                continue
            prices = [p['price'] for p in pts]
            avg    = round(sum(prices)/len(prices), 2)
            mn, mx = min(prices), max(prices)
            min_hr = next(p['hour'] for p in pts if p['price']==mn)
            max_hr = next(p['hour'] for p in pts if p['price']==mx)
            neg_hrs = sum(1 for p in prices if p < 0)

            # Yesterday for delta
            vs_yday = None
            try:
                xml_y = fetch({'documentType':'A44','in_Domain':eic,'out_Domain':eic,
                                'periodStart':yesterday,'periodEnd':today})
                pts_y = parse_prices(xml_y)
                if pts_y:
                    avg_y = sum(p['price'] for p in pts_y)/len(pts_y)
                    vs_yday = round(avg - avg_y, 2)
            except:
                pass

            # Clean spark spread (TTF D+1 ~45.14, EUA ~74.09)
            TTF, EUA, EFF, CO2 = 45.14, 74.09, 0.49, 0.365
            spark = round(avg - TTF/EFF - EUA*CO2, 2)

            results.append({
                'code': code,
                'name': ZONE_NAMES.get(code, code),
                'today': avg,
                'vsYday': vs_yday,
                'min': round(mn, 2),
                'minHour': min_hr,
                'max': round(mx, 2),
                'maxHour': max_hr,
                'negHours': neg_hrs,
                'spark': spark,
                'hourly': [p['price'] for p in sorted(pts, key=lambda x:x['hour'])],
            })
            print(f"  {code}: {avg} €/MWh")
        except Exception as e:
            print(f"  {code}: ERROR — {e}")

    results.sort(key=lambda x: x['today'], reverse=True)
    return results

# ─────────────────────────────────────────────
# FETCH GENERATION MIX
# ─────────────────────────────────────────────
def fetch_genmix():
    print("Fetching generation mix...")
    today, tomorrow = date_str(0), date_str(1)
    result = {}
    for code in ['FR','DE_LU','ES','BE','NL','GB','PT']:
        eic = ZONES.get(code)
        if not eic:
            continue
        try:
            xml = fetch({'documentType':'A75','processType':'A16',
                          'in_Domain':eic,'periodStart':today,'periodEnd':tomorrow})
            raw = parse_generation(xml)
            cats = categorize(raw)
            cats['total'] = sum(cats.values())
            result[code] = cats
            print(f"  {code}: {cats['total']} MW total")
        except Exception as e:
            print(f"  {code}: ERROR — {e}")
    return result

# ─────────────────────────────────────────────
# FETCH RENEWABLES + FORECAST
# ─────────────────────────────────────────────
def fetch_renewables():
    print("Fetching renewables + forecast...")
    today, tomorrow = date_str(0), date_str(1)
    day_after = date_str(2)
    result = {}

    for code in ['FR','DE_LU','ES','GB','BE']:
        eic = ZONES.get(code)
        if not eic:
            continue
        try:
            # Actual generation (wind + solar)
            xml_a = fetch({'documentType':'A75','processType':'A16',
                            'in_Domain':eic,'periodStart':today,'periodEnd':tomorrow})
            raw_a = parse_generation(xml_a)

            # Forecast (wind + solar)
            xml_f = fetch({'documentType':'A69','processType':'A01',
                            'in_Domain':eic,'periodStart':today,'periodEnd':day_after})
            raw_f = parse_generation(xml_f)

            def get_profile(raw, key):
                pts = []
                for psr, vals in raw.items():
                    name = PSR_MAP.get(psr,'')
                    if key=='wind' and 'Wind' in name:
                        pts.extend(vals)
                    elif key=='solar' and 'Solar' in name:
                        pts.extend(vals)
                return [round(v) for v in pts[:24]] if pts else [0]*24

            wind_act  = get_profile(raw_a,'wind')
            solar_act = get_profile(raw_a,'solar')
            wind_fc   = get_profile(raw_f,'wind')[:24]
            solar_fc  = get_profile(raw_f,'solar')[:24]

            # Forecast error
            wind_err  = [round(a-f) for a,f in zip(wind_act,wind_fc)]
            solar_err = [round(a-f) for a,f in zip(solar_act,solar_fc)]

            avg_we = sum(abs(e) for e in wind_err)/len(wind_err) if wind_err else 0
            avg_se = sum(abs(e) for e in solar_err)/len(solar_err) if solar_err else 0
            avg_wf = sum(wind_fc)/len(wind_fc) if wind_fc else 1
            avg_sf = sum(solar_fc)/len(solar_fc) if solar_fc else 1

            result[code] = {
                'windActual':   wind_act,
                'solarActual':  solar_act,
                'windForecast': wind_fc,
                'solarForecast':solar_fc,
                'windError':    wind_err,
                'solarError':   solar_err,
                'windErrorPct': round(avg_we/avg_wf*100,1) if avg_wf else 0,
                'solarErrorPct':round(avg_se/avg_sf*100,1) if avg_sf else 0,
            }
            print(f"  {code}: wind avg {round(sum(wind_act)/24)} MW")
        except Exception as e:
            print(f"  {code}: ERROR — {e}")
    return result

# ─────────────────────────────────────────────
# FETCH LOAD
# ─────────────────────────────────────────────
def fetch_load():
    print("Fetching load...")
    today, tomorrow = date_str(0), date_str(1)
    result = {}
    for code in ['FR','DE_LU','ES','BE']:
        eic = ZONES.get(code)
        if not eic:
            continue
        try:
            xml = fetch({'documentType':'A65','processType':'A16',
                          'outBiddingZone_Domain':eic,
                          'periodStart':today,'periodEnd':tomorrow})
            ns = {'ns':'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
            root = ET.fromstring(xml)
            pts = []
            for pt in root.findall('.//ns:Point', ns):
                qty = pt.findtext('ns:quantity',None,ns)
                if qty:
                    pts.append(round(float(qty)))
            if pts:
                result[code] = {
                    'actual': pts[:24],
                    'peak': max(pts),
                    'current': pts[min(datetime.utcnow().hour, len(pts)-1)],
                }
                print(f"  {code}: current {result[code]['current']} MW")
        except Exception as e:
            print(f"  {code}: ERROR — {e}")
    return result

# ─────────────────────────────────────────────
# FETCH CROSS-BORDER FLOWS
# ─────────────────────────────────────────────
def fetch_crossborder():
    print("Fetching cross-border flows...")
    today, tomorrow = date_str(0), date_str(1)
    PAIRS = {
        'FR':    ['DE_LU','BE','ES','IT_NORD','CH','GB'],
        'DE_LU': ['FR','NL','BE','AT','CH','CZ','PL','DK_W'],
        'BE':    ['FR','DE_LU','NL','GB'],
        'ES':    ['FR','PT'],
        'GB':    ['FR','BE','NL'],
    }
    result = {}
    for from_c, partners in PAIRS.items():
        flows = []
        from_eic = ZONES.get(from_c)
        if not from_eic:
            continue
        for to_c in partners:
            to_eic = ZONES.get(to_c)
            if not to_eic:
                continue
            try:
                # Exports from_c -> to_c
                xml_e = fetch({'documentType':'A11','in_Domain':to_eic,
                                'out_Domain':from_eic,'periodStart':today,'periodEnd':tomorrow})
                ns = {'ns':'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
                root = ET.fromstring(xml_e)
                exp_vals = [float(pt.findtext('ns:quantity','0',ns)) for pt in root.findall('.//ns:Point',ns)]
                avg_exp = round(sum(exp_vals)/len(exp_vals)) if exp_vals else 0
                # Imports to_c -> from_c
                xml_i = fetch({'documentType':'A11','in_Domain':from_eic,
                                'out_Domain':to_eic,'periodStart':today,'periodEnd':tomorrow})
                root2 = ET.fromstring(xml_i)
                imp_vals = [float(pt.findtext('ns:quantity','0',ns)) for pt in root2.findall('.//ns:Point',ns)]
                avg_imp = round(sum(imp_vals)/len(imp_vals)) if imp_vals else 0
                flows.append({
                    'partner': f"{to_c} · {ZONE_NAMES.get(to_c,to_c)}",
                    'imports': avg_imp,
                    'exports': avg_exp,
                    'net': avg_imp - avg_exp,
                })
            except Exception as e:
                print(f"    {from_c}->{to_c}: {e}")
        result[from_c] = flows
    return result

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path,'w') as f:
        json.dump(data, f, indent=2)
    print(f"  Wrote {path}")

if __name__ == '__main__':
    ts = datetime.utcnow().isoformat() + 'Z'
    print(f"\nPowerDesk fetch — {ts}\n")

    prices = fetch_prices()
    write_json('data/prices.json', {'updated': ts, 'zones': prices})

    genmix = fetch_genmix()
    write_json('data/genmix.json', {'updated': ts, 'countries': genmix})

    renewables = fetch_renewables()
    write_json('data/renewables.json', {'updated': ts, 'countries': renewables})

    load = fetch_load()
    write_json('data/load.json', {'updated': ts, 'countries': load})

    crossborder = fetch_crossborder()
    write_json('data/crossborder.json', {'updated': ts, 'countries': crossborder})

    print(f"\nDone. All data files written.")
