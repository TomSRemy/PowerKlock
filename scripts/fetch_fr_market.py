"""
fetch_fr_market.py — French power market data from the SEFE Energy "Market Insights"
daily cockpit (cockpit.energymarketprice.com), via its public JSON API.

No credentials needed: the cockpit is published on a public link ("daily"), and
PublicAuthorization hands out a reusable Bearer token to anyone who asks.

Usage:
  python scripts/fetch_fr_market.py            # daily run: today's snapshot + append to history
  python scripts/fetch_fr_market.py --backfill  # one-time: seed history from each series' own lookback
"""
import sys
import json
from datetime import datetime, timezone, date
from pathlib import Path

import requests

API = "https://cockpit.energymarketprice.com/api"
PUBLIC_LINK = "daily"
COCKPIT_GUID = "169b4b92-d10a-41b1-b018-898c8b78ee06"

OUT_SNAPSHOT = Path("data/fr_market.json")
OUT_HIST_DIR = Path("data/history/fr_market")
OUT_SERIES = Path("data/history/fr_market_series.json")
FORWARD_TENORS = ["M+1", "M+2", "M+3", "Q+1", "Q+2", "Q+3", "S+1", "S+2", "Y+1", "Y+2", "Y+3"]

SPOT_MARKET = {
    "marketId": 334, "marketCode": "", "marketName": "FR spot base", "marketNameCode": "FR spot base ",
    "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Spot",
    "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh",
    "isLive": False, "rowId": None,
}

# Fixed template market IDs for the FR power forward curve, as published in the cockpit
# (these are stable "base" markets — the API resolves them to whichever contract is
# currently front-month/quarter/season/year).
FORWARD_TEMPLATE = [
    ("M+1", "month",   {"marketId": 39645, "marketCode": "M+1", "marketName": "FR Sep24 base", "marketNameCode": "FR Sep24 base M+1", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Month", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "a1f60b38-5f36-49c3-b4e6-156ce2230294"}),
    ("M+2", "month",   {"marketId": 44258, "marketCode": "M+2", "marketName": "FR Oct24 base", "marketNameCode": "FR Oct24 base M+2", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Month", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "61303e67-2e4d-4a59-b429-bf6b944edf20"}),
    ("M+3", "month",   {"marketId": 39660, "marketCode": "M+3", "marketName": "FR Nov24 base", "marketNameCode": "FR Nov24 base M+3", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Month", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "ab54f3c8-ecf4-4f9d-a0ad-627efde2f345"}),
    ("Q+1", "quarter", {"marketId": 39735, "marketCode": "Q+1", "marketName": "FR Q4 24 base", "marketNameCode": "FR Q4 24 base Q+1", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Quarter", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "874da3c2-78b5-417a-95c6-f3945a8d0d2e"}),
    ("Q+2", "quarter", {"marketId": 39691, "marketCode": "Q+2", "marketName": "FR Q1 25 base", "marketNameCode": "FR Q1 25 base Q+2", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Quarter", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "afffde1f-e3d6-4a73-8c80-7333122816d2"}),
    ("Q+3", "quarter", {"marketId": 39706, "marketCode": "Q+3", "marketName": "FR Q2 25 base", "marketNameCode": "FR Q2 25 base Q+3", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Quarter", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "32bbaa8c-6a3b-41d9-bcb0-090e6f6a08e3"}),
    ("S+1", "season",  {"marketId": 69271, "marketCode": "S+1", "marketName": "FR Win2024 base", "marketNameCode": "FR Win2024 base S+1", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Season", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "efa88e3c-f1ef-4c44-b8f4-2d8793cce5fe"}),
    ("S+2", "season",  {"marketId": 69273, "marketCode": "S+2", "marketName": "FR Sum2025 base", "marketNameCode": "FR Sum2025 base S+2", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Season", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "7a860f06-1a7b-455c-bd4e-bbc64f8d4e90"}),
    ("Y+1", "year",    {"marketId": 37682, "marketCode": "Y+1", "marketName": "FR Cal2025 base", "marketNameCode": "FR Cal2025 base Y+1", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Year", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "47a30947-4c3d-4ba7-9d74-8a5180dab993"}),
    ("Y+2", "year",    {"marketId": 69248, "marketCode": "Y+2", "marketName": "FR Cal2026 base", "marketNameCode": "FR Cal2026 base Y+2", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Year", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "1613a30d-c8e7-4f99-a767-6454990720ab"}),
    ("Y+3", "year",    {"marketId": 69249, "marketCode": "Y+3", "marketName": "FR Cal2027 base", "marketNameCode": "FR Cal2027 base Y+3", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Year", "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh", "isLive": False, "rowId": "6f1786e9-22cc-4777-8988-35f664acff63"}),
]

NUCLEAR_MARKETS = [
    {"marketId": 256447, "marketCode": "", "marketName": "FR Nuclear Capacity Actual", "marketNameCode": "FR Nuclear Capacity Actual ", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "MW", "isLive": False, "rowId": None},
    {"marketId": 256448, "marketCode": "", "marketName": "FR Nuclear Capacity Forecast", "marketNameCode": "FR Nuclear Capacity Forecast ", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "MW", "isLive": False, "rowId": None},
]

GENMIX_MARKETS = {
    "gas":     {"marketId": 212234, "marketCode": "", "marketName": "FR Generation Gas", "marketNameCode": "FR Generation Gas ", "commodity": "Power", "countryName": "France", "resourcesCode": "Generation Mix", "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "GW", "isLive": False, "rowId": None},
    "wind":    {"marketId": 212237, "marketCode": "", "marketName": "FR Generation Wind", "marketNameCode": "FR Generation Wind ", "commodity": "Power", "countryName": "France", "resourcesCode": "Generation Mix", "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "GW", "isLive": False, "rowId": None},
    "solar":   {"marketId": 212238, "marketCode": "", "marketName": "FR Generation Solar", "marketNameCode": "FR Generation Solar ", "commodity": "Power", "countryName": "France", "resourcesCode": "Generation Mix", "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "GW", "isLive": False, "rowId": None},
    "nuclear": {"marketId": 212233, "marketCode": "", "marketName": "FR Generation Nuclear", "marketNameCode": "FR Generation Nuclear ", "commodity": "Power", "countryName": "France", "resourcesCode": "Generation Mix", "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "GW", "isLive": False, "rowId": None},
    "hydro":   {"marketId": 212232, "marketCode": "", "marketName": "FR Generation Hydro", "marketNameCode": "FR Generation Hydro ", "commodity": "Power", "countryName": "France", "resourcesCode": "Generation Mix", "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "GW", "isLive": False, "rowId": None},
    "other":   {"marketId": 212239, "marketCode": "", "marketName": "FR Generation Other", "marketNameCode": "FR Generation Other ", "commodity": "Power", "countryName": "France", "resourcesCode": "Generation Mix", "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "GW", "isLive": False, "rowId": None},
}

BACKFILL_DAYS = 1500  # comfortably covers the FR spot series back to 2022-09; longer than any series' actual life


def get_token():
    r = requests.get(f"{API}/Auth/PublicAuthorization", params={"customLink": PUBLIC_LINK}, timeout=20)
    r.raise_for_status()
    return r.json()["auth"]["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def fetch_chart_series(h, markets, days):
    """POST /Chart/Chart — plain lookback series, no roll resolution needed."""
    body = {"fullMarketsInfoDTO": markets, "customMarkets": [], "days": days, "pastDays": 0, "addAvg": False}
    r = requests.post(f"{API}/Chart/Chart", headers=h, json=body, timeout=30)
    r.raise_for_status()
    return r.json()


def resolve_forward_markets(h):
    """POST /MultipleChart/UpdatedMarkets — roll each template market to its current contract."""
    grouped = {"spot": [], "month": [], "quarter": [], "season": [], "year": []}
    for tenor, group, market in FORWARD_TEMPLATE:
        grouped[group].append(market)
    r = requests.post(f"{API}/MultipleChart/UpdatedMarkets", headers=h, json=grouped, timeout=30)
    r.raise_for_status()
    resolved = r.json()
    # Re-flatten in the original tenor order, matching by base marketId
    by_base_id = {}
    for group in ("month", "quarter", "season", "year"):
        for base, resolved_m in zip(grouped[group], resolved.get(group, [])):
            by_base_id[base["marketId"]] = resolved_m
    out = []
    for tenor, group, market in FORWARD_TEMPLATE:
        resolved_m = by_base_id.get(market["marketId"])
        if resolved_m:
            out.append((tenor, resolved_m))
    return out


def fetch_forward_snapshot(h, resolved):
    """POST /StatisticTable/Table — takes the ORIGINAL (unresolved) template markets,
    the server rolls them to the live contract itself, keyed back by base marketId
    via the "marketInfo": "<baseId>|<code>" field in the response."""
    body = {
        "fullMarketsInfo": [m for _, _, m in FORWARD_TEMPLATE],
        "formulas": ["D-1", "Last", "VAR D-1, %", "VAR W-1, %"],
        "excludeWeekends": True,
        "excludeHolidays": True,
        "cockpitGuid": COCKPIT_GUID,
    }
    r = requests.post(f"{API}/StatisticTable/Table", headers=h, json=body, timeout=30)
    r.raise_for_status()
    rows_by_base = {}
    for row in r.json().get("data", []):
        base_id = int(row["marketInfo"].split("|")[0])
        rows_by_base[base_id] = row
    out = []
    for tenor, m in resolved:
        base_id = next(bm["marketId"] for t, g, bm in FORWARD_TEMPLATE if t == tenor)
        row = rows_by_base.get(base_id)
        stat = {s["paramName"]: s for s in row["statisticalData"]} if row else {}
        d1 = next((s for k, s in stat.items() if k not in ("Last", "VAR D-1, %", "VAR W-1, %")), None)
        out.append({
            "tenor": tenor,
            "contract": m["marketName"],
            "marketId": m["marketId"],
            "unit": m.get("unitNameCode") and (m.get("currencyCode", "") + "/" + m["unitNameCode"]) or None,
            "value": d1["value"] if d1 else None,
            "date": ms_to_date(d1["milisec"]) if d1 and d1.get("milisec") else None,
            "varD1Pct": stat.get("VAR D-1, %", {}).get("value"),
            "varW1Pct": stat.get("VAR W-1, %", {}).get("value"),
        })
    return out


def fetch_forward_history(h, resolved, days):
    """POST /MultipleChart for the full available history of each resolved contract."""
    grouped = {}
    tenor_by_market_id = {}
    for tenor, m in resolved:
        grouped.setdefault(m.get("periodName", "Month").lower(), []).append(m)
        tenor_by_market_id[m["marketId"]] = tenor
    dto = [{"type": t, "fullMarketsInfoDTO": ms} for t, ms in grouped.items()]
    body = {"days": days, "fullMultipleInfoDTO": dto}
    r = requests.post(f"{API}/MultipleChart", headers=h, json=body, timeout=30)
    r.raise_for_status()
    series = {}
    for item in r.json():
        tenor = tenor_by_market_id.get(item["marketID"])
        if tenor:
            series[tenor] = item.get("value", [])
    return series


def fetch_market_insights_text(h):
    """Pull the Electricity-section narrative from today's cockpit layout."""
    r = requests.get(f"{API}/Cockpits/{COCKPIT_GUID}", params={"isTemplate": "false"}, headers=h, timeout=30)
    r.raise_for_status()
    content = json.loads(r.json()["content"])
    in_electricity = False
    seen_insights_title = False
    for w in content:
        if w.get("type") == "title":
            t = (w.get("titleText") or "").strip()
            if t == "Electricity":
                in_electricity = True
            elif t == "Market Insights" and in_electricity:
                seen_insights_title = True
            elif in_electricity and t and t != "Market Insights":
                # left the Market Insights block without finding text (shouldn't happen)
                if seen_insights_title:
                    break
        elif w.get("type") == "text" and in_electricity and seen_insights_title:
            return w.get("content", "")
    return None


def ms_to_date(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat()


def load_hist_day(d):
    p = OUT_HIST_DIR / f"{d}.json"
    if p.exists():
        return json.loads(p.read_text())
    return {"date": d}


def save_hist_day(d, data):
    OUT_HIST_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_HIST_DIR / f"{d}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))


def backfill():
    token = get_token()
    h = auth_headers(token)

    print("Resolving FR forward curve contracts...")
    resolved = resolve_forward_markets(h)
    for tenor, m in resolved:
        print(f"  {tenor}: {m['marketName']} (id={m['marketId']})")

    print(f"Fetching forward curve history (up to {BACKFILL_DAYS} days back)...")
    fwd_hist = fetch_forward_history(h, resolved, BACKFILL_DAYS)
    for tenor, pts in fwd_hist.items():
        print(f"  {tenor}: {len(pts)} points")

    print("Fetching FR spot price history...")
    spot_hist = fetch_chart_series(h, [SPOT_MARKET], BACKFILL_DAYS)
    spot_pts = spot_hist[0]["value"] if spot_hist else []
    print(f"  spot: {len(spot_pts)} points")

    print("Fetching nuclear capacity history...")
    nuc_hist = fetch_chart_series(h, NUCLEAR_MARKETS, BACKFILL_DAYS)
    nuc_by_name = {d["marketName"]: d["value"] for d in nuc_hist}

    print("Fetching generation mix history...")
    mix_hist = fetch_chart_series(h, list(GENMIX_MARKETS.values()), BACKFILL_DAYS)
    mix_by_id = {d["marketID"]: d["value"] for d in mix_hist}

    by_date = {}

    for tenor, pts in fwd_hist.items():
        for pt in pts:
            d = ms_to_date(pt["milisec"])
            by_date.setdefault(d, {}).setdefault("forwardCurve", {})[tenor] = pt["value"]

    for pt in spot_pts:
        d = ms_to_date(pt["milisec"])
        by_date.setdefault(d, {})["spot"] = pt["value"]

    for name, pts in nuc_by_name.items():
        key = "actualMW" if "Actual" in name else "forecastMW"
        for pt in pts:
            d = ms_to_date(pt["milisec"])
            by_date.setdefault(d, {}).setdefault("nuclearCapacity", {})[key] = pt["value"]

    for fuel, market in GENMIX_MARKETS.items():
        pts = mix_by_id.get(market["marketId"], [])
        for pt in pts:
            d = ms_to_date(pt["milisec"])
            by_date.setdefault(d, {}).setdefault("generationMix", {})[fuel] = pt["value"]

    print(f"Writing {len(by_date)} daily history files...")
    for d, data in sorted(by_date.items()):
        existing = load_hist_day(d)
        existing.update(data)
        existing["date"] = d
        save_hist_day(d, existing)

    print(f"Backfill done: {len(by_date)} days written to {OUT_HIST_DIR}/")


def _last_point(series_item):
    """Return (date, value) of the most recent point, or (None, None)."""
    pts = series_item.get("value") if series_item else None
    if not pts:
        return None, None
    last = pts[-1]
    return ms_to_date(last["milisec"]), last["value"]


def daily_run():
    token = get_token()
    h = auth_headers(token)
    today = date.today().isoformat()

    print("Resolving FR forward curve contracts...")
    resolved = resolve_forward_markets(h)

    print("Fetching forward curve snapshot (D-1 / VAR%)...")
    forward_curve = fetch_forward_snapshot(h, resolved)
    for row in forward_curve:
        print(f"  {row['tenor']} {row['contract']}: {row['value']} (D-1 {row['varD1Pct']}%, W-1 {row['varW1Pct']}%)")
    fwd_date = next((row["date"] for row in forward_curve if row.get("date")), None)

    print("Fetching FR spot price...")
    spot_hist = fetch_chart_series(h, [SPOT_MARKET], 3)
    spot_date, spot_val = _last_point(spot_hist[0] if spot_hist else None)
    print(f"  spot [{spot_date}]: {spot_val} EUR/MWh")

    print("Fetching nuclear capacity...")
    nuc_hist = fetch_chart_series(h, NUCLEAR_MARKETS, 3)
    nuc = {}
    nuc_date = None
    for d in nuc_hist:
        key = "actualMW" if "Actual" in d["marketName"] else "forecastMW"
        pt_date, val = _last_point(d)
        nuc[key] = val
        if key == "actualMW":
            nuc_date = pt_date
    print(f"  [{nuc_date}] actual={nuc.get('actualMW')} MW, forecast={nuc.get('forecastMW')} MW")

    print("Fetching generation mix...")
    mix_hist = fetch_chart_series(h, list(GENMIX_MARKETS.values()), 3)
    mix_by_id = {d["marketID"]: _last_point(d) for d in mix_hist}
    genmix = {fuel: mix_by_id.get(m["marketId"], (None, None))[1] for fuel, m in GENMIX_MARKETS.items()}
    mix_date = next((v[0] for v in mix_by_id.values() if v[0]), None)
    print(f"  [{mix_date}] {genmix}")

    print("Fetching market insights narrative...")
    insights_html = fetch_market_insights_text(h)

    snapshot = {
        "lastUpdate": datetime.now(timezone.utc).isoformat(),
        "spot": {"value": spot_val, "unit": "EUR/MWh", "date": spot_date},
        "forwardCurve": forward_curve,
        "forwardCurveDate": fwd_date,
        "nuclearCapacity": nuc,
        "nuclearCapacityDate": nuc_date,
        "generationMix": genmix,
        "generationMixDate": mix_date,
        "marketInsightsHtml": insights_html,
        "marketInsightsDate": today,
    }
    OUT_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    OUT_SNAPSHOT.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False))
    print(f"Wrote {OUT_SNAPSHOT}")

    # Each series lands in the history file for its own actual date, not blindly "today" —
    # genmix in particular lags ~2 days behind spot/nuclear.
    if spot_date:
        day = load_hist_day(spot_date)
        day["spot"] = spot_val
        save_hist_day(spot_date, day)
    if fwd_date:
        day = load_hist_day(fwd_date)
        day.setdefault("forwardCurve", {}).update({row["tenor"]: row["value"] for row in forward_curve})
        save_hist_day(fwd_date, day)
    if nuc_date:
        day = load_hist_day(nuc_date)
        day["nuclearCapacity"] = nuc
        save_hist_day(nuc_date, day)
    if mix_date:
        day = load_hist_day(mix_date)
        day["generationMix"] = genmix
        save_hist_day(mix_date, day)
    # Market insights narrative only exists for "today" — no historical lookup for it.
    day = load_hist_day(today)
    day["marketInsightsHtml"] = insights_html
    save_hist_day(today, day)
    print(f"Updated history for {sorted({d for d in (spot_date, fwd_date, nuc_date, mix_date, today) if d})}")


def rebuild_series_summary():
    """Collapse every data/history/fr_market/<date>.json into one array-oriented
    file the UI can fetch in a single request, instead of hundreds of per-day files."""
    files = sorted(OUT_HIST_DIR.glob("*.json"))
    dates = [f.stem for f in files]
    spot, nuc_actual, nuc_forecast = [], [], []
    forward = {t: [] for t in FORWARD_TENORS}
    genmix = {fuel: [] for fuel in GENMIX_MARKETS}

    for f in files:
        day = json.loads(f.read_text())
        spot.append(day.get("spot"))
        nuc = day.get("nuclearCapacity") or {}
        nuc_actual.append(nuc.get("actualMW"))
        nuc_forecast.append(nuc.get("forecastMW"))
        fwd = day.get("forwardCurve") or {}
        for t in FORWARD_TENORS:
            forward[t].append(fwd.get(t))
        mix = day.get("generationMix") or {}
        for fuel in GENMIX_MARKETS:
            genmix[fuel].append(mix.get(fuel))

    series = {
        "dates": dates,
        "spot": spot,
        "forwardCurve": forward,
        "nuclearCapacity": {"actual": nuc_actual, "forecast": nuc_forecast},
        "generationMix": genmix,
    }
    OUT_SERIES.write_text(json.dumps(series, ensure_ascii=False))
    print(f"Wrote {OUT_SERIES} ({len(dates)} days)")


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill()
    else:
        daily_run()
    rebuild_series_summary()
    print("Done.")
