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
    """
    Parse DA prices. ENTSO-E may send multiple TimeSeries covering different
    sub-intervals of the day (e.g. two 48-slot series for a 96-slot day).
    
    Strategy: use Period/timeInterval/start to compute ABSOLUTE slot index,
    so positions from different TimeSeries don't collide.
    """
    ns  = {'ns': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
    ns2 = {'ns': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3',
           'es': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    # Get document-level date to compute midnight offset
    doc_start_str = root.findtext(
        './/ns:time_Period.timeInterval/ns:start', '', ns
    ) or root.findtext('.//ns:timeInterval/ns:start', '', ns)

    def parse_dt(s):
        """Parse ISO datetime string → datetime (UTC)."""
        from datetime import datetime, timezone
        s = s.strip()
        for fmt in ('%Y%m%d%H%M', '%Y-%m-%dT%H:%MZ', '%Y-%m-%dT%H:%M%z'):
            try:
                dt = datetime.strptime(s, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except ValueError:
                continue
        return None

    doc_start = parse_dt(doc_start_str) if doc_start_str else None

    # pos_buckets: absolute_slot → list of prices (for averaging true duplicates)
    pos_buckets = {}
    is_15min_global = False

    ts_list = root.findall('.//ns:TimeSeries', ns)
    debug = os.environ.get('DEBUG_ZONE','')
    for ts_idx, ts in enumerate(ts_list):
        period = ts.find('.//ns:Period', ns)
        if period is None:
            continue

        res = period.findtext('ns:resolution', 'PT60M', ns)
        is_15min = (res == 'PT15M')
        if is_15min:
            is_15min_global = True
        res_minutes = 15 if is_15min else 60

        # Get period start to compute offset from midnight
        period_start_str = period.findtext('ns:timeInterval/ns:start', '', ns)
        period_start = parse_dt(period_start_str) if period_start_str else doc_start

        # Offset in slots from midnight
        slot_offset = 0
        if period_start and doc_start:
            diff_minutes = int((period_start - doc_start).total_seconds() / 60)
            slot_offset = diff_minutes // res_minutes

        pts_in_ts = period.findall('ns:Point', ns)
        if debug:
            print(f"  TS[{ts_idx}] res={res} start={period_start_str!r} offset={slot_offset} npts={len(pts_in_ts)}")

        for pt in pts_in_ts:
            pos   = int(pt.findtext('ns:position', '0', ns))
            price = pt.findtext('ns:price.amount', None, ns)
            if price is None:
                continue
            abs_slot = slot_offset + (pos - 1)
            if abs_slot < 0 or abs_slot >= 96:
                if debug:
                    print(f"    SKIP slot {abs_slot} (pos={pos} offset={slot_offset})")
                continue
            pos_buckets.setdefault(abs_slot, []).append(round(float(price), 2))

    if not pos_buckets:
        return []

    # Determine native resolution: if any slot > 23 exists, it's truly 15min data
    max_slot = max(pos_buckets.keys()) if pos_buckets else 0
    if max_slot > 23:
        n_slots = 96
    elif is_15min_global and max_slot <= 23:
        # 15min flag but all slots fit in 24 → hourly data stored with PT15M resolution
        # Keep as 24-slot (e.g. RS, MK send PT60M values labelled PT15M in some TS)
        n_slots = 24
    else:
        n_slots = 24

    result = []
    for slot in range(n_slots):
        vals = pos_buckets.get(slot)
        if vals:
            result.append({'hour': slot, 'price': round(sum(vals) / len(vals), 2)})
        else:
            result.append({'hour': slot, 'price': None})
    return result

def parse_generation(xml_text):
    ns = {'ns': 'urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3'}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {}
    result = {}
    for ts in root.findall('.//ns:TimeSeries', ns):
        psr_type = ts.findtext('.//ns:MktPSRType/ns:psrType', '', ns)
        if not psr_type:
            continue
        # Build position-indexed dict for this TimeSeries
        ts_pts = {}
        for pt in ts.findall('.//ns:Point', ns):
            pos = int(pt.findtext('ns:position', '0', ns))
            qty = pt.findtext('ns:quantity', None, ns)
            if qty:
                ts_pts[pos - 1] = float(qty)  # 0-indexed hours
        if ts_pts:
            if psr_type not in result:
                result[psr_type] = {}
            # Sum across multiple TimeSeries for same PSR type
            for pos, val in ts_pts.items():
                result[psr_type][pos] = result[psr_type].get(pos, 0) + val
    # Convert to sorted list of 24 values
    final = {}
    for psr, pos_dict in result.items():
        n = max(pos_dict.keys()) + 1 if pos_dict else 24
        final[psr] = [pos_dict.get(i, 0) for i in range(max(24, n))]
    return final

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
        # vals is now a list of hourly values
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
            prices = [p['price'] for p in pts if p['price'] is not None]
            if not prices:
                continue
            avg    = round(sum(prices)/len(prices), 2)
            mn, mx = min(prices), max(prices)
            min_slot = next(p['hour'] for p in pts if p['price'] is not None and p['price']==mn)
            max_slot = next(p['hour'] for p in pts if p['price'] is not None and p['price']==mx)
            n_slots = len(pts)
            mins_per_slot = round(24*60/n_slots) if n_slots > 0 else 60
            def slot_to_hhmm(slot):
                total_min = slot * mins_per_slot
                h, m = divmod(total_min, 60)
                return f"{h:02d}:{m:02d}"
            min_hr = slot_to_hhmm(min_slot)
            max_hr = slot_to_hhmm(max_slot)
            neg_hrs = round(sum(1 for p in prices if p < 0) * (24*60/len(pts)) / 60, 1)

            # Yesterday for delta
            vs_yday = None
            try:
                xml_y = fetch({'documentType':'A44','in_Domain':eic,'out_Domain':eic,
                                'periodStart':yesterday,'periodEnd':today})
                pts_y = parse_prices(xml_y)
                if pts_y:
                    valid_y = [p['price'] for p in pts_y if p['price'] is not None]
                    avg_y = sum(valid_y)/len(valid_y) if valid_y else None
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
            # Actual generation — A75 processType A16
            xml_a = fetch({'documentType':'A75','processType':'A16',
                            'in_Domain':eic,'periodStart':today,'periodEnd':tomorrow})
            raw_a = parse_generation(xml_a)

            def get_profile_psr(raw, psr_codes):
                """Sum specific PSR types hour by hour."""
                hourly = {}
                for psr, vals in raw.items():
                    if psr in psr_codes:
                        for i, v in enumerate(vals[:24]):
                            hourly[i] = hourly.get(i, 0) + v
                if not hourly:
                    return [0]*24
                return [round(hourly.get(i, 0)) for i in range(24)]

            def get_profile(raw, key):
                """Sum all matching PSR types hour by hour."""
                hourly = {}
                for psr, vals in raw.items():
                    name = PSR_MAP.get(psr,'')
                    match = (key=='wind' and 'Wind' in name) or \
                            (key=='wind_onshore' and psr == 'B19') or \
                            (key=='wind_offshore' and psr == 'B18') or \
                            (key=='solar' and 'Solar' in name) or \
                            (key=='hydro' and 'Hydro' in name)
                    if match:
                        for i, v in enumerate(vals[:24]):
                            hourly[i] = hourly.get(i, 0) + v
                if not hourly:
                    return [0]*24
                return [round(hourly.get(i, 0)) for i in range(24)]

            wind_onshore_act  = get_profile(raw_a, 'wind_onshore')
            wind_offshore_act = get_profile(raw_a, 'wind_offshore')
            wind_act          = [a+b for a,b in zip(wind_onshore_act, wind_offshore_act)]
            solar_act         = get_profile(raw_a, 'solar')

            # Forecast — try A69 then A71
            wind_onshore_fc, wind_offshore_fc, solar_fc = [0]*24, [0]*24, [0]*24
            for doc_type in ['A69', 'A71']:
                try:
                    xml_f = fetch({'documentType': doc_type, 'processType':'A01',
                                    'in_Domain':eic,'periodStart':today,'periodEnd':tomorrow})
                    raw_f = parse_generation(xml_f)
                    won_f = get_profile(raw_f, 'wind_onshore')
                    woff_f = get_profile(raw_f, 'wind_offshore')
                    sf = get_profile(raw_f, 'solar')
                    wf_total = [a+b for a,b in zip(won_f, woff_f)]
                    if sum(wf_total) > 0:
                        wind_onshore_fc = won_f
                        wind_offshore_fc = woff_f
                    if sum(sf) > 0: solar_fc = sf
                    if sum(wf_total) > 0 or sum(sf) > 0:
                        break
                except Exception as fe:
                    print(f"    {code} {doc_type}: {fe}")
                    continue

            wind_fc = [a+b for a,b in zip(wind_onshore_fc, wind_offshore_fc)]

            # Fallback if forecast unavailable
            if sum(wind_onshore_fc) == 0: wind_onshore_fc = wind_onshore_act[:]
            if sum(wind_offshore_fc) == 0: wind_offshore_fc = wind_offshore_act[:]
            if sum(solar_fc) == 0: solar_fc = solar_act[:]
            if sum(wind_fc) == 0: wind_fc = wind_act[:]

            wind_err  = [round(a-f) for a,f in zip(wind_act, wind_fc)]
            solar_err = [round(a-f) for a,f in zip(solar_act, solar_fc)]

            avg_wf = max(1, sum(wind_fc)/24)
            avg_sf = max(1, sum(solar_fc)/24)

            import datetime as dt
            cur_hr = min(23, dt.datetime.utcnow().hour)

            result[code] = {
                'windActual':         wind_act,
                'windOnshoreActual':  wind_onshore_act,
                'windOffshoreActual': wind_offshore_act,
                'solarActual':        solar_act,
                'windForecast':       wind_fc,
                'windOnshoreForecast':  wind_onshore_fc,
                'windOffshoreForecast': wind_offshore_fc,
                'solarForecast':      solar_fc,
                'windError':          wind_err,
                'solarError':         solar_err,
                'windErrorPct':       round(sum(abs(e) for e in wind_err)/24/avg_wf*100, 1),
                'solarErrorPct':      round(sum(abs(e) for e in solar_err)/24/avg_sf*100, 1),
                'windNow':            wind_act[cur_hr],
                'windOnshoreNow':     wind_onshore_act[cur_hr],
                'windOffshoreNow':    wind_offshore_act[cur_hr],
                'solarNow':           solar_act[cur_hr],
            }
            print(f"  {code}: wind_on {round(sum(wind_onshore_act)/24)} MW · wind_off {round(sum(wind_offshore_act)/24)} MW · solar {round(sum(solar_act)/24)} MW")
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
