#!/usr/bin/env python3
"""
Fetch gas, carbon, coal and oil market data (plus FR nuclear availability)
from SEFE Energy's public "daily" cockpit — the same source and public link
as fetch_fr_market.py, whose API helpers are reused here.

Writes data/commodities.json:
  {
    "updated": ISO-8601 UTC,
    "source":  "...",
    "series": { key: {"name", "unit", "points": [["YYYY-MM-DD", value], ...]} },
    "curves": { "eua": [row...], "ttf": [row...] }     # row = tenor, contract, value, date, varD1Pct, varW1Pct
  }

Series are daily closes as published by the cockpit, trimmed to HISTORY_START.
No credentials needed.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from fetch_fr_market import (
    get_token, auth_headers, fetch_chart_series, resolve_forward_markets,
    fetch_forward_snapshot, ms_to_date,
)

OUT = Path("data/commodities.json")                       # light: last RECENT_DAYS, loaded on every page
OUT_HIST = Path("data/history/commodities_series.json")   # full history, loaded on demand
RECENT_DAYS = 400
HISTORY_START = "2019-01-01"
HISTORY_DAYS = 8 * 366


def _m(market_id, name, commodity, resource, period, currency, unit, code="", absolut="Absolute"):
    return {
        "marketId": market_id, "marketCode": code, "marketName": name,
        "marketNameCode": f"{name} {code}", "commodity": commodity, "countryName": None,
        "resourcesCode": resource, "periodName": period, "typeName": None, "absolut": absolut,
        "currencyCode": currency, "unitNameCode": unit, "isLive": False, "rowId": None,
    }


# Plain daily series. Contract-type markets (EUA, coal, Brent, JKM) are
# rolled server-side to the current front contract, so their history is a
# continuous front series.
SERIES = {
    "ttf":   (_m(99, "TTF spot", "Natural gas", "TTF", "Spot", "EUR", "MWh"), "TTF day-ahead", "€/MWh"),
    "peg":   (_m(48830, "PEG spot", "Natural gas", "FR-PEG", "Spot", "EUR", "MWh"), "PEG day-ahead", "€/MWh"),
    "the":   (_m(204241, "GE THE spot", "Natural gas", "THE", "Spot", "EUR", "MWh"), "THE day-ahead", "€/MWh"),
    "nbp":   (_m(485, "NBP spot", "Natural gas", "NBP", "Spot", "GBpence", "therm"), "NBP day-ahead", "p/therm"),
    "jkm":   (_m(53411, "LNG Asia JKM M+1", "Natural gas", "LNG", "Month", "USD", "MMBtu", "M+1", "Relative"), "JKM front-month", "$/MMBtu"),
    # The server rolls on marketCode: this cockpit's "M+5" EUA template always
    # resolves to the front December contract.
    "eua":   (_m(13324, "CO2 EUA Dec 2025", "Green", "CO2 EUA", "Month", "EUR", "tonne", "M+5"), "EUA front-December", "€/t"),
    "coal":  (_m(38766, "Coal ARA CIF Cal2025", "Coal", "Coal ARA CIF", "Year", "USD", "tonne", "Y+1"), "API2 coal Cal+1", "$/t"),
    "brent": (_m(9422, "Brent M+1", "Oil", "Brent", "Month", "USD", "bbl", "M+1", "Relative"), "Brent front-month", "$/bbl"),
    "eurusd": (_m(629, "Rate EUR/USD", "Rates", "Rate", "Spot", "EUR", "USD"), "EUR/USD", "USD per EUR"),
    "gbpusd": (_m(630, "Rate GBP/USD", "Rates", "Rate", "Spot", "GBP", "USD"), "GBP/USD", "USD per GBP"),
    "agsi":  (_m(81916, "GIE AGSI Gas Storage Total Daily", "Natural gas", "Gas Storage", "Spot", None, "%"), "EU gas storage (AGSI)", "% full"),
}

NUCLEAR = {
    "fr_nuc_avail": ({"marketId": 256447, "marketCode": "", "marketName": "FR Nuclear Capacity Actual",
                      "marketNameCode": "FR Nuclear Capacity Actual ", "commodity": "Power", "countryName": "France",
                      "resourcesCode": None, "periodName": None, "typeName": None, "absolut": None,
                      "currencyCode": None, "unitNameCode": "MW", "isLive": False, "rowId": None},
                     "FR nuclear available capacity", "MW"),
    "fr_nuc_avail_fc": ({"marketId": 256448, "marketCode": "", "marketName": "FR Nuclear Capacity Forecast",
                         "marketNameCode": "FR Nuclear Capacity Forecast ", "commodity": "Power", "countryName": "France",
                         "resourcesCode": None, "periodName": None, "typeName": None, "absolut": None,
                         "currencyCode": None, "unitNameCode": "MW", "isLive": False, "rowId": None},
                        "FR nuclear available capacity (forecast)", "MW"),
}


def _fwd(market_id, tenor, name, period, commodity, resource, currency, unit):
    return (tenor, period.lower(), _m(market_id, name, commodity, resource, period, currency, unit, tenor))


# Forward curve templates — base contracts the server rolls to the live ones.
CURVES = {
    "eua": [
        _fwd(13324, "M+5", "CO2 EUA Dec 2025", "Month", "Green", "CO2 EUA", "EUR", "tonne"),
        _fwd(13325, "M+17", "CO2 EUA Dec 2026", "Month", "Green", "CO2 EUA", "EUR", "tonne"),
        _fwd(13326, "M+29", "CO2 EUA Dec 2027", "Month", "Green", "CO2 EUA", "EUR", "tonne"),
    ],
    "ttf": [
        _fwd(24954, "M+1", "TTF Sep24", "Month", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(24955, "M+2", "TTF Oct24", "Month", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(24956, "M+3", "TTF Nov24", "Month", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(24985, "Q+1", "TTF Q4 24", "Quarter", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(24986, "Q+2", "TTF Q1 25", "Quarter", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(24987, "Q+3", "TTF Q2 25", "Quarter", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(43085, "S+1", "TTF Win2024", "Season", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(43081, "S+2", "TTF Sum2025", "Season", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(24909, "Y+1", "TTF Cal2025", "Year", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(57784, "Y+2", "TTF Cal2026", "Year", "Natural gas", "TTF", "EUR", "MWh"),
        _fwd(57785, "Y+3", "TTF Cal2027", "Year", "Natural gas", "TTF", "EUR", "MWh"),
    ],
}


def _points(item):
    out = {}
    for p in item.get("value") or []:
        if p.get("value") is None or p.get("milisec") is None:
            continue
        d = ms_to_date(p["milisec"])
        if d >= HISTORY_START:
            out[d] = round(float(p["value"]), 4)   # one close per day (last wins)
    return [[d, out[d]] for d in sorted(out)]


def fetch_series(h, table):
    markets = [m for m, _, _ in table.values()]
    items = fetch_chart_series(h, markets, HISTORY_DAYS)
    by_id = {it["marketID"]: it for it in items}
    out = {}
    for key, (m, name, unit) in table.items():
        it = by_id.get(m["marketId"])
        # Rolled contracts come back under the live contract's id; fall back
        # to matching on the order of the request.
        if it is None:
            idx = markets.index(m)
            it = items[idx] if idx < len(items) else None
        pts = _points(it) if it else []
        out[key] = {"name": name, "unit": unit, "contract": it.get("marketName") if it else None, "points": pts}
        last = pts[-1] if pts else None
        print(f"  {key:14s} {len(pts):5d} pts  last={last}  ({out[key]['contract']})")
    return out


def _contract_label(name):
    """'CO2 EUA Dec 2026' -> 'Dec-26', 'TTF Nov26' -> 'Nov-26', 'TTF Q1 27' -> 'Q1-27',
    'TTF Sum2027' -> 'Sum-27', 'TTF Cal2028' -> 'Cal-28'."""
    import re
    m = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?(\d{2,4})$", name)
    if m:
        return f"{m.group(1)}-{m.group(2)[-2:]}"
    m = re.search(r"(Q[1-4])\s(\d{2})$", name)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = re.search(r"(Sum|Win|Cal)(\d{4})$", name)
    if m:
        return f"{m.group(1)}-{m.group(2)[-2:]}"
    return name


def fetch_curve(h, template, use_contract_label=False):
    resolved = resolve_forward_markets(h, template)
    rows = [r for r in fetch_forward_snapshot(h, template, resolved) if r.get("value") is not None]
    for r in rows:
        r["label"] = _contract_label(r["contract"])
        if use_contract_label:
            r["tenor"] = r["label"]
    for r in rows:
        print(f"  {r['tenor']:5s} {r['contract']:22s} {r['value']} ({r['date']})")
    return rows


def main():
    h = auth_headers(get_token())
    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "SEFE Energy market cockpit (cockpit.energymarketprice.com), public daily link",
        "series": {},
        "curves": {},
    }
    print("Fetching commodity series...")
    out["series"].update(fetch_series(h, SERIES))
    print("Fetching FR nuclear availability...")
    try:
        out["series"].update(fetch_series(h, NUCLEAR))
    except Exception as e:
        print(f"  nuclear availability skipped: {e}")
    for name, template in CURVES.items():
        print(f"Fetching {name.upper()} forward curve...")
        try:
            out["curves"][name] = fetch_curve(h, template, use_contract_label=(name == "eua"))
        except Exception as e:
            print(f"  {name} curve skipped: {e}")

    # Never overwrite a good file with an empty fetch.
    if not any(s["points"] for s in out["series"].values()):
        raise SystemExit("No commodity data returned — keeping the previous file.")
    OUT_HIST.parent.mkdir(parents=True, exist_ok=True)
    OUT_HIST.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT_HIST} ({OUT_HIST.stat().st_size // 1024} KB)")

    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    light = dict(out, series={k: dict(v, points=[p for p in v["points"] if p[0] >= cutoff])
                              for k, v in out["series"].items()})
    OUT.write_text(json.dumps(light, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
