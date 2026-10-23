"""
fetch_fr_market.py — Power market data for FR/UK/DE/NL from the SEFE Energy
"Market Insights" daily cockpit (cockpit.energymarketprice.com), via its
public JSON API.

No credentials needed: the cockpit is published on a public link ("daily"), and
PublicAuthorization hands out a reusable Bearer token to anyone who asks.

Usage:
  python scripts/fetch_fr_market.py            # daily run: today's snapshot + append to history
  python scripts/fetch_fr_market.py --backfill  # one-time: seed history from each series' own lookback

Historical note: this script originally covered France only (hence the
filename and the top-level spot/forwardCurve/... keys in data/fr_market.json,
which stay FR-specific for backward compatibility with the France Cockpit
page). UK/DE/NL were added later under the "countries" key, where FR is
mirrored too so the Prices > Forward page can treat all four uniformly.
"""
import sys
import re
import html
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


def _fwd(market_id, code, name, period, row_id, country, currency):
    return (code, period.lower(), {
        "marketId": market_id, "marketCode": code, "marketName": name,
        "marketNameCode": f"{name} {code}", "commodity": "Power", "countryName": country,
        "resourcesCode": None, "periodName": period, "typeName": "Base", "absolut": "Absolute",
        "currencyCode": currency, "unitNameCode": "MWh", "isLive": False, "rowId": row_id,
    })


def _mix(market_id, name, country):
    return {
        "marketId": market_id, "marketCode": "", "marketName": name, "marketNameCode": name + " ",
        "commodity": "Power", "countryName": country, "resourcesCode": "Generation Mix",
        "periodName": None, "typeName": None, "absolut": None, "currencyCode": None,
        "unitNameCode": "GW", "isLive": False, "rowId": None,
    }


# Fixed template market IDs for each country's power forward curve, as published in
# the cockpit (these are stable "base" markets — the API resolves them to whichever
# contract is currently front-month/quarter/season/year).
COUNTRIES = {
    "FR": {
        "label": "France",
        "spot": {"marketId": 334, "marketCode": "", "marketName": "FR spot base", "marketNameCode": "FR spot base ",
                 "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": "Spot",
                 "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh",
                 "isLive": False, "rowId": None},
        "forward": [
            _fwd(39645, "M+1", "FR Sep24 base", "Month", "a1f60b38-5f36-49c3-b4e6-156ce2230294", "France", "EUR"),
            _fwd(44258, "M+2", "FR Oct24 base", "Month", "61303e67-2e4d-4a59-b429-bf6b944edf20", "France", "EUR"),
            _fwd(39660, "M+3", "FR Nov24 base", "Month", "ab54f3c8-ecf4-4f9d-a0ad-627efde2f345", "France", "EUR"),
            _fwd(39735, "Q+1", "FR Q4 24 base", "Quarter", "874da3c2-78b5-417a-95c6-f3945a8d0d2e", "France", "EUR"),
            _fwd(39691, "Q+2", "FR Q1 25 base", "Quarter", "afffde1f-e3d6-4a73-8c80-7333122816d2", "France", "EUR"),
            _fwd(39706, "Q+3", "FR Q2 25 base", "Quarter", "32bbaa8c-6a3b-41d9-bcb0-090e6f6a08e3", "France", "EUR"),
            _fwd(69271, "S+1", "FR Win2024 base", "Season", "efa88e3c-f1ef-4c44-b8f4-2d8793cce5fe", "France", "EUR"),
            _fwd(69273, "S+2", "FR Sum2025 base", "Season", "7a860f06-1a7b-455c-bd4e-bbc64f8d4e90", "France", "EUR"),
            _fwd(37682, "Y+1", "FR Cal2025 base", "Year", "47a30947-4c3d-4ba7-9d74-8a5180dab993", "France", "EUR"),
            _fwd(69248, "Y+2", "FR Cal2026 base", "Year", "1613a30d-c8e7-4f99-a767-6454990720ab", "France", "EUR"),
            _fwd(69249, "Y+3", "FR Cal2027 base", "Year", "6f1786e9-22cc-4777-8988-35f664acff63", "France", "EUR"),
        ],
        "genmix": {
            "gas": _mix(212234, "FR Generation Gas", "France"),
            "wind": _mix(212237, "FR Generation Wind", "France"),
            "solar": _mix(212238, "FR Generation Solar", "France"),
            "nuclear": _mix(212233, "FR Generation Nuclear", "France"),
            "hydro": _mix(212232, "FR Generation Hydro", "France"),
            "other": _mix(212239, "FR Generation Other", "France"),
        },
        "nuclear": [
            {"marketId": 256447, "marketCode": "", "marketName": "FR Nuclear Capacity Actual", "marketNameCode": "FR Nuclear Capacity Actual ", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "MW", "isLive": False, "rowId": None},
            {"marketId": 256448, "marketCode": "", "marketName": "FR Nuclear Capacity Forecast", "marketNameCode": "FR Nuclear Capacity Forecast ", "commodity": "Power", "countryName": "France", "resourcesCode": None, "periodName": None, "typeName": None, "absolut": None, "currencyCode": None, "unitNameCode": "MW", "isLive": False, "rowId": None},
        ],
    },
    "UK": {
        "label": "United Kingdom",
        "spot": {"marketId": 96, "marketCode": "", "marketName": "UK spot base", "marketNameCode": "UK spot base ",
                 "commodity": "Power", "countryName": "United Kingdom", "resourcesCode": None, "periodName": "Spot",
                 "typeName": "Base", "absolut": "Absolute", "currencyCode": "GBP", "unitNameCode": "MWh",
                 "isLive": False, "rowId": None},
        "forward": [
            _fwd(25034, "M+1", "UK Sep24 base", "Month", "a7d3961e-f136-4689-aff1-dea68e055f67", "United Kingdom", "GBP"),
            _fwd(25035, "M+2", "UK Oct24 base", "Month", "492f0371-45b0-41bb-b9c9-99b2813a5cab", "United Kingdom", "GBP"),
            _fwd(25036, "M+3", "UK Nov24 base", "Month", "48bd1484-85e3-4ad4-a6fa-4e9979d4cfe3", "United Kingdom", "GBP"),
            _fwd(42152, "Q+1", "UK Q4 24 base", "Quarter", "3bc3310b-8427-433c-acc8-40e4e2e61724", "United Kingdom", "GBP"),
            _fwd(42114, "Q+2", "UK Q1 25 base", "Quarter", "13a37a23-451a-46ba-8291-6504a8b0a555", "United Kingdom", "GBP"),
            _fwd(42127, "Q+3", "UK Q2 25 base", "Quarter", "b6f76713-bac3-43cc-bc2d-365042f14fb4", "United Kingdom", "GBP"),
            _fwd(42198, "S+1", "UK Win24 base", "Season", "5801fb18-763e-444b-b8b3-284734ec5b27", "United Kingdom", "GBP"),
            _fwd(42181, "S+2", "UK Sum25 base", "Season", "6b6e3c35-617f-4459-b8ac-83c0f89ef89b", "United Kingdom", "GBP"),
            _fwd(42166, "Y+1", "UK Cal 2025 base", "Year", "75200b18-208e-4a5a-8da4-5d1d376a738b", "United Kingdom", "GBP"),
            _fwd(189461, "Y+2", "UK Cal 2026 base", "Year", "20626688-0b3c-4eaf-9ec9-5406c7b2066a", "United Kingdom", "GBP"),
            _fwd(189470, "Y+3", "UK Cal 2027 base", "Year", "676cfd25-0d25-4c9d-9223-7975151c84f0", "United Kingdom", "GBP"),
        ],
        "genmix": {
            "gas": _mix(53355, "UK mix CCGT", "United Kingdom"),
            "wind": _mix(53350, "UK mix Wind", "United Kingdom"),
            "solar": _mix(53354, "UK mix Solar", "United Kingdom"),
            "nuclear": _mix(53356, "UK mix Nuclear", "United Kingdom"),
            "hydro": _mix(53352, "UK mix Hydro", "United Kingdom"),
            "biomass": _mix(53353, "UK mix Biomass", "United Kingdom"),
            "other": _mix(53493, "UK mix Other", "United Kingdom"),
        },
        "nuclear": None,
    },
    "DE": {
        "label": "Germany",
        "spot": {"marketId": 94, "marketCode": "", "marketName": "GE spot base", "marketNameCode": "GE spot base ",
                 "commodity": "Power", "countryName": "Germany", "resourcesCode": None, "periodName": "Spot",
                 "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh",
                 "isLive": False, "rowId": None},
        "forward": [
            _fwd(39886, "M+1", "GE Sep24 base", "Month", "e640668b-08e2-4ccb-a43a-e1035c777d2a", "Germany", "EUR"),
            _fwd(39901, "M+2", "GE Oct24 base", "Month", "2018f858-2360-468e-8823-22ba8ac8b656", "Germany", "EUR"),
            _fwd(39916, "M+3", "GE Nov24 base", "Month", "9a877842-3517-4b7b-9f79-bc4ecf7838ab", "Germany", "EUR"),
            _fwd(39991, "Q+1", "GE Q4 24 base", "Quarter", "09efd20c-d140-44e1-8fe7-11ded9453e09", "Germany", "EUR"),
            _fwd(39947, "Q+2", "GE Q1 25 base", "Quarter", "419f2efe-994d-412a-b824-df9bc450b2da", "Germany", "EUR"),
            _fwd(39962, "Q+3", "GE Q2 25 base", "Quarter", "3ec2972c-daeb-4905-b9bc-f894d7c6e144", "Germany", "EUR"),
            _fwd(70422, "S+1", "GE Win2024 base", "Season", "a9117119-42ac-4942-b0b7-c69354d8623a", "Germany", "EUR"),
            _fwd(70423, "S+2", "GE Sum2025 base", "Season", "7a9498a9-b9e3-406f-b58e-e6258bb9313a", "Germany", "EUR"),
            _fwd(55575, "Y+1", "GE Cal2025 base", "Year", "f93781f6-4650-4e82-a0df-0eeca15aa625", "Germany", "EUR"),
            _fwd(55787, "Y+2", "GE Cal2026 base", "Year", "473afe0f-9478-44ee-bc71-87966240d003", "Germany", "EUR"),
            _fwd(55788, "Y+3", "GE Cal2027 base", "Year", "868fc7c2-228f-48ed-987a-405522ac72b0", "Germany", "EUR"),
        ],
        "genmix": {
            "gas": _mix(212214, "DE Generation Gas", "Germany"),
            "wind": _mix(212218, "DE Generation Wind", "Germany"),
            "solar": _mix(212219, "DE Generation Solar", "Germany"),
            "nuclear": _mix(212212, "DE Generation Nuclear", "Germany"),
            "coal": _mix(212213, "DE Generation Coal", "Germany"),
            "hydro": _mix(212217, "DE Generation Hydro", "Germany"),
            "other": _mix(212221, "DE Generation Other", "Germany"),
        },
        "nuclear": None,
    },
    "NL": {
        "label": "Netherlands",
        "spot": {"marketId": 102, "marketCode": "", "marketName": "NL spot base", "marketNameCode": "NL spot base ",
                 "commodity": "Power", "countryName": "Netherlands", "resourcesCode": None, "periodName": "Spot",
                 "typeName": "Base", "absolut": "Absolute", "currencyCode": "EUR", "unitNameCode": "MWh",
                 "isLive": False, "rowId": None},
        "forward": [
            _fwd(37802, "M+1", "NL Sep24 base", "Month", "77d0944b-0185-4877-b5fa-000f4708b1d5", "Netherlands", "EUR"),
            _fwd(37807, "M+2", "NL Oct24 base", "Month", "2022b51a-beb6-4458-b24a-394286e2d55a", "Netherlands", "EUR"),
            _fwd(37813, "M+3", "NL Nov24 base", "Month", "56cafbc2-3452-4471-a1fb-e7564ba6de7b", "Netherlands", "EUR"),
            _fwd(38076, "Q+1", "NL Q4 24 base", "Quarter", "040dd7ed-31f6-4e4d-8413-fbd1484c3113", "Netherlands", "EUR"),
            _fwd(38029, "Q+2", "NL Q1 25 base", "Quarter", "f870f1b8-1922-43b2-a8fa-45669d35b1eb", "Netherlands", "EUR"),
            _fwd(38053, "Q+3", "NL Q2 25 base", "Quarter", "3436ae0c-df96-4bb9-84f9-fce4d88dbd2b", "Netherlands", "EUR"),
            _fwd(73866, "S+1", "NL Win2024 base", "Season", "243e3ca4-0ba2-4019-b7cd-b15f519166af", "Netherlands", "EUR"),
            _fwd(73867, "S+2", "NL Sum2025 base", "Season", "ecda18bc-ec7b-4c58-a783-6c980116482a", "Netherlands", "EUR"),
            _fwd(37738, "Y+1", "NL Cal2025 base", "Year", "c7cb70c4-6ac6-48d4-a48d-3acb99e0958d", "Netherlands", "EUR"),
            _fwd(73881, "Y+2", "NL Cal2026 base", "Year", "f26efffd-3cc6-4d88-bce0-08a35aead4c9", "Netherlands", "EUR"),
            _fwd(73882, "Y+3", "NL Cal2027 base", "Year", "86b75366-9cdf-421f-9833-f594f84c0e1f", "Netherlands", "EUR"),
        ],
        "genmix": {
            "gas": _mix(211344, "NL Generation Gas", "Netherlands"),
            "wind": _mix(283246, "NL Generation Wind", "Netherlands"),
            "solar": _mix(211347, "NL Generation Solar", "Netherlands"),
            "nuclear": _mix(211343, "NL Generation Nuclear", "Netherlands"),
            "coal": _mix(211345, "NL Generation Coal", "Netherlands"),
            "other": _mix(211350, "NL Generation Other", "Netherlands"),
        },
        "nuclear": None,
    },
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


def resolve_forward_markets(h, forward_template):
    """POST /MultipleChart/UpdatedMarkets — roll each template market to its current contract."""
    grouped = {"spot": [], "month": [], "quarter": [], "season": [], "year": []}
    for tenor, group, market in forward_template:
        grouped[group].append(market)
    r = requests.post(f"{API}/MultipleChart/UpdatedMarkets", headers=h, json=grouped, timeout=30)
    r.raise_for_status()
    resolved = r.json()
    by_base_id = {}
    for group in ("month", "quarter", "season", "year"):
        for base, resolved_m in zip(grouped[group], resolved.get(group, [])):
            by_base_id[base["marketId"]] = resolved_m
    out = []
    for tenor, group, market in forward_template:
        resolved_m = by_base_id.get(market["marketId"])
        if resolved_m:
            out.append((tenor, resolved_m))
    return out


def fetch_forward_snapshot(h, forward_template, resolved):
    """POST /StatisticTable/Table — takes the ORIGINAL (unresolved) template markets,
    the server rolls them to the live contract itself, keyed back by base marketId
    via the "marketInfo": "<baseId>|<code>" field in the response."""
    body = {
        "fullMarketsInfo": [m for _, _, m in forward_template],
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
        base_id = next(bm["marketId"] for t, g, bm in forward_template if t == tenor)
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
                if seen_insights_title:
                    break
        elif w.get("type") == "text" and in_electricity and seen_insights_title:
            return w.get("content", "")
    return None


FRANCE_KEYWORDS = re.compile(r"\bFrance\b|\bFrench\b", re.IGNORECASE)
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


def fetch_market_insights_all(h):
    """Both daily commentaries of the cockpit, in full (English): Natural Gas and Electricity → {"gas": html, "power": html}"""
    r = requests.get(f"{API}/Cockpits/{COCKPIT_GUID}", params={"isTemplate": "false"}, headers=h, timeout=30)
    r.raise_for_status()
    content = json.loads(r.json()["content"])
    out, section, armed = {}, None, False
    for w in content:
        if w.get("type") == "title":
            t = (w.get("titleText") or "").strip()
            if t in ("Natural Gas", "Electricity"):
                section, armed = ("gas" if t == "Natural Gas" else "power"), False
            elif t == "Market Insights":
                armed = section is not None
            else:
                armed = False
        elif w.get("type") == "text" and armed and section and (w.get("content") or "").strip():
            out[section] = w["content"]; armed = False
    return out


def translate_to_fr(text):
    if not text.strip():
        return text
    r = requests.get(
        "https://translate.googleapis.com/translate_a/single",
        params={"client": "gtx", "sl": "en", "tl": "fr", "dt": "t", "q": text},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    return "".join(seg[0] for seg in data[0] if seg[0])


def france_focus_french(raw_html):
    """Keep only France-related sentences from the (English, multi-country) narrative,
    translate them to French. Falls back to the France-filtered English text if
    translation is unavailable."""
    if not raw_html:
        return None
    paragraphs = re.findall(r"<p>(.*?)</p>", raw_html, re.DOTALL)
    kept_paragraphs = []
    for p in paragraphs:
        plain = html.unescape(re.sub(r"<[^>]+>", "", p)).strip()
        sentences = SENTENCE_SPLIT.split(plain)
        france_sentences = [s for s in sentences if FRANCE_KEYWORDS.search(s)]
        if france_sentences:
            kept_paragraphs.append(" ".join(france_sentences))
    if not kept_paragraphs:
        return None
    try:
        fr_paragraphs = [translate_to_fr(p) for p in kept_paragraphs]
    except Exception as e:
        print(f"  [warn] translation failed ({e}), keeping English France-focused text")
        fr_paragraphs = kept_paragraphs
    return "".join(f"<p>{p}</p>" for p in fr_paragraphs)


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


def _last_point(series_item):
    """Return (date, value) of the most recent point, or (None, None)."""
    pts = series_item.get("value") if series_item else None
    if not pts:
        return None, None
    last = pts[-1]
    return ms_to_date(last["milisec"]), last["value"]


def backfill():
    token = get_token()
    h = auth_headers(token)
    by_date = {}

    for cc, cfg in COUNTRIES.items():
        print(f"=== {cc} ({cfg['label']}) ===")
        print("Resolving forward curve contracts...")
        resolved = resolve_forward_markets(h, cfg["forward"])
        for tenor, m in resolved:
            print(f"  {tenor}: {m['marketName']} (id={m['marketId']})")

        print(f"Fetching forward curve history (up to {BACKFILL_DAYS} days back)...")
        fwd_hist = fetch_forward_history(h, resolved, BACKFILL_DAYS)
        for tenor, pts in fwd_hist.items():
            print(f"  {tenor}: {len(pts)} points")

        print("Fetching spot price history...")
        spot_hist = fetch_chart_series(h, [cfg["spot"]], BACKFILL_DAYS)
        spot_pts = spot_hist[0]["value"] if spot_hist else []
        print(f"  spot: {len(spot_pts)} points")

        nuc_by_name = {}
        if cfg["nuclear"]:
            print("Fetching nuclear capacity history...")
            nuc_hist = fetch_chart_series(h, cfg["nuclear"], BACKFILL_DAYS)
            nuc_by_name = {d["marketName"]: d["value"] for d in nuc_hist}

        print("Fetching generation mix history...")
        mix_hist = fetch_chart_series(h, list(cfg["genmix"].values()), BACKFILL_DAYS)
        mix_by_id = {d["marketID"]: d["value"] for d in mix_hist}

        for tenor, pts in fwd_hist.items():
            for pt in pts:
                d = ms_to_date(pt["milisec"])
                by_date.setdefault(d, {}).setdefault("countries", {}).setdefault(cc, {}).setdefault("forwardCurve", {})[tenor] = pt["value"]

        for pt in spot_pts:
            d = ms_to_date(pt["milisec"])
            by_date.setdefault(d, {}).setdefault("countries", {}).setdefault(cc, {})["spot"] = pt["value"]

        for name, pts in nuc_by_name.items():
            key = "actualMW" if "Actual" in name else "forecastMW"
            for pt in pts:
                d = ms_to_date(pt["milisec"])
                by_date.setdefault(d, {}).setdefault("countries", {}).setdefault(cc, {}).setdefault("nuclearCapacity", {})[key] = pt["value"]

        for fuel, market in cfg["genmix"].items():
            pts = mix_by_id.get(market["marketId"], [])
            for pt in pts:
                d = ms_to_date(pt["milisec"])
                by_date.setdefault(d, {}).setdefault("countries", {}).setdefault(cc, {}).setdefault("generationMix", {})[fuel] = pt["value"]

    print(f"Writing {len(by_date)} daily history files...")
    for d, data in sorted(by_date.items()):
        existing = load_hist_day(d)
        existing.setdefault("countries", {})
        for cc, cdata in data.get("countries", {}).items():
            existing["countries"].setdefault(cc, {}).update(cdata)
        existing["date"] = d
        save_hist_day(d, existing)

    print(f"Backfill done: {len(by_date)} days written to {OUT_HIST_DIR}/")


def _fetch_country_snapshot(h, cc, cfg, today):
    print(f"=== {cc} ({cfg['label']}) ===")

    print("Resolving forward curve contracts...")
    resolved = resolve_forward_markets(h, cfg["forward"])

    print("Fetching forward curve snapshot (D-1 / VAR%)...")
    forward_curve = fetch_forward_snapshot(h, cfg["forward"], resolved)
    for row in forward_curve:
        print(f"  {row['tenor']} {row['contract']}: {row['value']} (D-1 {row['varD1Pct']}%, W-1 {row['varW1Pct']}%)")
    fwd_date = next((row["date"] for row in forward_curve if row.get("date")), None)

    print("Fetching spot price...")
    spot_hist = fetch_chart_series(h, [cfg["spot"]], 3)
    spot_date, spot_val = _last_point(spot_hist[0] if spot_hist else None)
    print(f"  spot [{spot_date}]: {spot_val} {cfg['spot']['currencyCode']}/MWh")

    nuc, nuc_date = None, None
    if cfg["nuclear"]:
        print("Fetching nuclear capacity...")
        nuc_hist = fetch_chart_series(h, cfg["nuclear"], 3)
        nuc = {}
        for d in nuc_hist:
            key = "actualMW" if "Actual" in d["marketName"] else "forecastMW"
            pt_date, val = _last_point(d)
            nuc[key] = val
            if key == "actualMW":
                nuc_date = pt_date
        print(f"  [{nuc_date}] actual={nuc.get('actualMW')} MW, forecast={nuc.get('forecastMW')} MW")

    print("Fetching generation mix...")
    mix_hist = fetch_chart_series(h, list(cfg["genmix"].values()), 3)
    mix_by_id = {d["marketID"]: _last_point(d) for d in mix_hist}
    genmix = {fuel: mix_by_id.get(m["marketId"], (None, None))[1] for fuel, m in cfg["genmix"].items()}
    mix_date = next((v[0] for v in mix_by_id.values() if v[0]), None)
    print(f"  [{mix_date}] {genmix}")

    return {
        "label": cfg["label"],
        "currency": cfg["spot"]["currencyCode"],
        "spot": {"value": spot_val, "unit": cfg["spot"]["currencyCode"] + "/MWh", "date": spot_date},
        "forwardCurve": forward_curve,
        "forwardCurveDate": fwd_date,
        "nuclearCapacity": nuc,
        "nuclearCapacityDate": nuc_date,
        "generationMix": genmix,
        "generationMixDate": mix_date,
    }, {"spot": spot_date, "forwardCurve": fwd_date, "nuclearCapacity": nuc_date, "generationMix": mix_date}


def daily_run():
    token = get_token()
    h = auth_headers(token)
    today = date.today().isoformat()

    countries_out = {}
    countries_dates = {}
    for cc, cfg in COUNTRIES.items():
        snap, dates = _fetch_country_snapshot(h, cc, cfg, today)
        countries_out[cc] = snap
        countries_dates[cc] = dates

    print("Fetching market insights narrative...")
    raw_insights_html = fetch_market_insights_text(h)
    insights_html = france_focus_french(raw_insights_html)
    try:
        insights_all = fetch_market_insights_all(h)   # gas and power commentaries in full, for the market brief
    except Exception as e:
        print("  all insights not read:", e); insights_all = {}

    fr = countries_out["FR"]
    snapshot = {
        "lastUpdate": datetime.now(timezone.utc).isoformat(),
        # FR fields kept at top level for backward compatibility with the France Cockpit page.
        "spot": fr["spot"],
        "forwardCurve": fr["forwardCurve"],
        "forwardCurveDate": fr["forwardCurveDate"],
        "nuclearCapacity": fr["nuclearCapacity"],
        "nuclearCapacityDate": fr["nuclearCapacityDate"],
        "generationMix": fr["generationMix"],
        "generationMixDate": fr["generationMixDate"],
        "marketInsightsHtml": insights_html,
        "marketInsights": insights_all,
        "marketInsightsDate": today,
        "countries": countries_out,
    }
    OUT_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    OUT_SNAPSHOT.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False))
    print(f"Wrote {OUT_SNAPSHOT}")

    # Each series lands in the history file for its own actual date, not blindly "today" —
    # genmix in particular lags ~2 days behind spot/nuclear.
    touched_dates = set()
    for cc, cfg in COUNTRIES.items():
        snap = countries_out[cc]
        dates = countries_dates[cc]
        if dates["spot"]:
            day = load_hist_day(dates["spot"])
            day.setdefault("countries", {}).setdefault(cc, {})["spot"] = snap["spot"]["value"]
            save_hist_day(dates["spot"], day)
            touched_dates.add(dates["spot"])
        if dates["forwardCurve"]:
            day = load_hist_day(dates["forwardCurve"])
            day.setdefault("countries", {}).setdefault(cc, {}).setdefault("forwardCurve", {}).update(
                {row["tenor"]: row["value"] for row in snap["forwardCurve"]})
            save_hist_day(dates["forwardCurve"], day)
            touched_dates.add(dates["forwardCurve"])
        if dates["nuclearCapacity"]:
            day = load_hist_day(dates["nuclearCapacity"])
            day.setdefault("countries", {}).setdefault(cc, {})["nuclearCapacity"] = snap["nuclearCapacity"]
            save_hist_day(dates["nuclearCapacity"], day)
            touched_dates.add(dates["nuclearCapacity"])
        if dates["generationMix"]:
            day = load_hist_day(dates["generationMix"])
            day.setdefault("countries", {}).setdefault(cc, {})["generationMix"] = snap["generationMix"]
            save_hist_day(dates["generationMix"], day)
            touched_dates.add(dates["generationMix"])

    # Market insights narrative only exists for "today" — no historical lookup for it.
    day = load_hist_day(today)
    day["marketInsightsHtml"] = insights_html
    day["marketInsights"] = insights_all
    save_hist_day(today, day)
    touched_dates.add(today)
    print(f"Updated history for {sorted(touched_dates)}")


def rebuild_series_summary():
    """Collapse every data/history/fr_market/<date>.json into one array-oriented
    file the UI can fetch in a single request, instead of hundreds of per-day files."""
    files = sorted(OUT_HIST_DIR.glob("*.json"))
    dates = [f.stem for f in files]

    countries_series = {}
    for cc, cfg in COUNTRIES.items():
        countries_series[cc] = {
            "spot": [],
            "forwardCurve": {t: [] for t in FORWARD_TENORS},
            "nuclearCapacity": {"actual": [], "forecast": []} if cfg["nuclear"] else None,
            "generationMix": {fuel: [] for fuel in cfg["genmix"]},
        }

    for f in files:
        day = json.loads(f.read_text())
        day_countries = day.get("countries") or {}
        for cc, cfg in COUNTRIES.items():
            cdata = day_countries.get(cc) or {}
            cs = countries_series[cc]
            cs["spot"].append(cdata.get("spot"))
            fwd = cdata.get("forwardCurve") or {}
            for t in FORWARD_TENORS:
                cs["forwardCurve"][t].append(fwd.get(t))
            if cs["nuclearCapacity"] is not None:
                nuc = cdata.get("nuclearCapacity") or {}
                cs["nuclearCapacity"]["actual"].append(nuc.get("actualMW"))
                cs["nuclearCapacity"]["forecast"].append(nuc.get("forecastMW"))
            mix = cdata.get("generationMix") or {}
            for fuel in cfg["genmix"]:
                cs["generationMix"][fuel].append(mix.get(fuel))

    series = {
        "dates": dates,
        # FR mirrored at top level for backward compatibility with the France Cockpit page.
        "spot": countries_series["FR"]["spot"],
        "forwardCurve": countries_series["FR"]["forwardCurve"],
        "nuclearCapacity": countries_series["FR"]["nuclearCapacity"],
        "generationMix": countries_series["FR"]["generationMix"],
        "countries": countries_series,
    }
    OUT_SERIES.write_text(json.dumps(series, ensure_ascii=False))
    print(f"Wrote {OUT_SERIES} ({len(dates)} days)")


OUT_CALCHAIN = Path("data/history/fr_market_calchain.json")
CAL_YEAR_RE = re.compile(r"Cal\s*(\d{4})", re.IGNORECASE)


def _cal_year(market_name):
    m = CAL_YEAR_RE.search(market_name)
    return int(m.group(1)) if m else None


def fetch_country_cal_years(h, cfg, days):
    """Every distinct Cal-year contract this cockpit still exposes for a country —
    the union of the template's fixed "year" anchors and whatever is currently
    resolved as Y+1/Y+2/Y+3. Each contract's OWN full life, keyed by its delivery year."""
    template_years = [m for code, group, m in cfg["forward"] if group == "year"]
    resolved = resolve_forward_markets(h, cfg["forward"])
    resolved_years = [m for t, m in resolved if t in ("Y+1", "Y+2", "Y+3")]
    combined = {}
    for m in template_years + resolved_years:
        combined[m["marketId"]] = m
    hist = fetch_chart_series(h, list(combined.values()), days)
    years = {}
    for item in hist:
        yr = _cal_year(item["marketName"])
        if yr is None:
            continue
        pts = item.get("value") or []
        years[yr] = {
            "marketId": item["marketID"],
            "marketName": item["marketName"],
            "dates": [ms_to_date(p["milisec"]) for p in pts],
            "values": [p["value"] for p in pts],
        }
    return years


def build_rolling_cal_series(years_data, offset):
    """Stitch a continuous "Cal+offset" series: on any date d, the front-year
    convention is delivery-year = year(d) + offset (the roll happens at each
    calendar year boundary), so we just pick each date's value from whichever
    Cal-year contract that maps to."""
    by_date = {}
    for yr, series in years_data.items():
        target_year = yr - offset  # this contract IS "Cal+offset" during calendar year (yr - offset)
        for d, v in zip(series["dates"], series["values"]):
            if int(d[:4]) == target_year and v is not None:
                by_date[d] = v
    dates = sorted(by_date)
    return {"dates": dates, "values": [by_date[d] for d in dates]}


def write_cal_chain():
    token = get_token()
    h = auth_headers(token)
    out = {}
    for cc, cfg in COUNTRIES.items():
        print(f"Fetching Cal-year chain for {cc}...")
        years_data = fetch_country_cal_years(h, cfg, BACKFILL_DAYS)
        for yr, s in sorted(years_data.items()):
            print(f"  Cal{yr}: {s['marketName']} — {len(s['dates'])} points")
        rolling = {}
        for offset, label in ((1, "Cal+1"), (2, "Cal+2"), (3, "Cal+3")):
            rolling[label] = build_rolling_cal_series(years_data, offset)
            print(f"  {label} (rolling): {len(rolling[label]['dates'])} points")
        out[cc] = {
            "years": {str(yr): {"marketName": s["marketName"], "dates": s["dates"], "values": s["values"]}
                      for yr, s in years_data.items()},
            "rolling": rolling,
        }
    OUT_CALCHAIN.parent.mkdir(parents=True, exist_ok=True)
    OUT_CALCHAIN.write_text(json.dumps(out, ensure_ascii=False))
    print(f"Wrote {OUT_CALCHAIN}")


# ── Dated contracts: every month, quarter, season and year the cockpit exposes ──
# The cockpit only answers by tenor code (M+1 … M+12, Q+1 … Q+8, S+1 … S+6,
# Y+1 … Y+6) and always resolves a code to the contract it designates TODAY,
# with that contract's whole life. Asking for every code each day and keeping
# what we get, contract by contract, builds dated histories that survive the
# roll: a contract that enters delivery is no longer quoted, but stays here.
OUT_CONTRACTS = Path("data/history/fr_market_contracts.json")
_MON = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def contract_label(name):
    """'FR Dec26 base' → ('Dec2026', 'month', '2026-12-01', '2026-12-31'), 'FR Q4 26 base' → Q42026,
    'FR Sum2027 base' / 'Sum27' → Sum2027 (Apr–Sep), Win2027 (Oct 2027–Mar 2028), 'Cal 2027' → Cal2027."""
    import calendar
    n = re.sub(r"^(FR|GE|DE|NL|UK)\s+", "", name.strip(), flags=re.I)
    n = re.sub(r"\s+(base|baseload)$", "", n, flags=re.I).strip()
    y4 = lambda t: int(t) + 2000 if len(t) == 2 else int(t)
    m = re.match(r"^([A-Za-z]{3})\s?(\d{4}|\d{2})$", n)
    if m and m.group(1).lower() in _MON:
        y, mo = y4(m.group(2)), _MON[m.group(1).lower()]
        return f"{m.group(1).title()}{y}", "month", f"{y}-{mo:02d}-01", f"{y}-{mo:02d}-{calendar.monthrange(y, mo)[1]:02d}"
    m = re.match(r"^Q([1-4])\s?(\d{4}|\d{2})$", n)
    if m:
        y, q = y4(m.group(2)), int(m.group(1))
        return f"Q{q}{y}", "quarter", f"{y}-{3 * q - 2:02d}-01", f"{y}-{3 * q:02d}-{calendar.monthrange(y, 3 * q)[1]:02d}"
    m = re.match(r"^(Sum|Win)\s?(\d{4}|\d{2})\b", n, re.I)
    if m:
        y = y4(m.group(2))
        if m.group(1).lower() == "sum":
            return f"Sum{y}", "season", f"{y}-04-01", f"{y}-09-30"
        return f"Win{y}", "season", f"{y}-10-01", f"{y + 1}-03-31"
    m = re.match(r"^Cal\s?(\d{4})$", n, re.I)
    if m:
        y = int(m.group(1))
        return f"Cal{y}", "year", f"{y}-01-01", f"{y}-12-31"
    return None


RESOURCE = {"FR": "France", "DE": "Germany", "NL": "Netherlands", "UK": "United Kingdom"}
OUT_ROLLING = Path("data/history/fr_market_rolling.json")
_MON_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def market_list(h, resource, period, absolut):
    """The cockpit's own market filter (the Month / Quarter / Season / Year drop-downs)."""
    r = requests.get(f"{API}/MarketFilter", headers=h, timeout=40, params={
        "Commodity": "Power", "ResourcesCode": resource, "PeriodName": period, "TypeName": "Base",
        "Absolut": absolut, "IsLive": "false", "AccountId": "0"})
    return r.json() if r.ok else []


def rolling_series(h, cc):
    """The cockpit's true rolling series ("FR M+1 base" … "FR Q+4 base", type Relative): on each day,
    M+k is the contract of calendar month (today + k), until that contract stops trading."""
    out = {}
    for period, pref in (("Month", "M"), ("Quarter", "Q")):
        ms = [m for m in market_list(h, RESOURCE[cc], period, "Relative")
              if re.match(rf"^(FR|GE|NL|UK) {pref}\+(\d+) base$", m.get("marketName") or "")]
        if not ms:
            continue
        for item in fetch_chart_series(h, ms, BACKFILL_DAYS):
            k = int(re.search(r"\+(\d+)", item["marketName"]).group(1))
            out[f"{pref}+{k}"] = {ms_to_date(p["milisec"]): p["value"] for p in item.get("value") or [] if p.get("value") is not None}
    return out


def rebuild_from_rolling(roll):
    """Dated month and quarter closes rebuilt from the rolling series: on day d, M+k is month(d)+k and
    Q+k is quarter(d)+k. When a contract no longer trades (expiry, or a quarter cascaded into its months)
    the cockpit shows the next contract in its place: the day is skipped when M+k equals M+(k+1).
    Checked against the contracts still quoted: identical on 99 % of the days."""
    import calendar
    out = {}
    for pref, per_year in (("M", 12), ("Q", 4)):
        for k in range(1, 30):
            s = roll.get(f"{pref}+{k}")
            if not s:
                continue
            nxt = roll.get(f"{pref}+{k + 1}") or {}
            for d, v in s.items():
                y, m = int(d[:4]), int(d[5:7])
                idx = (y * 12 + m - 1 if pref == "M" else y * 4 + (m - 1) // 3) + k
                if d in nxt and nxt[d] == v:
                    continue
                if pref == "M":
                    yy, mm = divmod(idx, 12); mm += 1
                    label, kind = f"{_MON_NAMES[mm - 1]}{yy}", "month"
                    a, b = f"{yy}-{mm:02d}-01", f"{yy}-{mm:02d}-{calendar.monthrange(yy, mm)[1]:02d}"
                else:
                    yy, q = divmod(idx, 4); q += 1
                    label, kind = f"Q{q}{yy}", "quarter"
                    a, b = f"{yy}-{3 * q - 2:02d}-01", f"{yy}-{3 * q:02d}-{calendar.monthrange(yy, 3 * q)[1]:02d}"
                c = out.setdefault(label, {"kind": kind, "deliveryStart": a, "deliveryEnd": b, "points": {}, "tenors": set()})
                c["points"][d] = v
                c["tenors"].add(f"{pref}+{k}")
    return out


def write_peak():
    """France peak contracts (EEX, weekdays 08:00-20:00): months, quarters, seasons and Cal, a year of
    daily closes, kept in fr_market_contracts.json as <label>Peak (Nov2026Peak, Q12027Peak, Cal2027Peak …)
    next to the base contracts, so the warehouse and the pricer read them the same way."""
    h = auth_headers(get_token())
    out = json.loads(OUT_CONTRACTS.read_text()) if OUT_CONTRACTS.exists() else {}
    got = []
    for period in ("Month", "Quarter", "Season", "Year"):
        try:
            r = requests.get(f"{API}/MarketFilter", headers=h, timeout=40, params={
                "Commodity": "Power", "ResourcesCode": "France", "PeriodName": period, "TypeName": "Peak",
                "Absolut": "Absolute", "IsLive": "false", "AccountId": "0"})
            ms = [m for m in (r.json() if r.ok else []) if not (m.get("marketName") or "").startswith("FR I ")]
        except requests.RequestException:
            continue
        for m in ms:
            try:
                series = fetch_chart_series(h, [m], 400)
            except requests.RequestException:
                continue
            if not series:
                continue
            item = series[0]
            lab = contract_label((item.get("marketName") or "").replace(" peak", " base"))
            if not lab:
                continue
            label, kind, a, b = lab
            c = out.setdefault("FR", {}).setdefault(label + "Peak", {"marketName": item["marketName"], "kind": kind, "type": "peak", "deliveryStart": a,
                                                                      "deliveryEnd": b, "currency": "EUR", "points": {}})
            for p in item.get("value") or []:
                if p.get("value") is not None:
                    c["points"][ms_to_date(p["milisec"])] = p["value"]
            c["lastSeen"] = date.today().isoformat()
            got.append(label)
    OUT_CONTRACTS.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  FR peak: {len(got)} contracts ({', '.join(got[:8])}…)")


def write_contracts():
    token = get_token()
    h = auth_headers(token)
    out = json.loads(OUT_CONTRACTS.read_text()) if OUT_CONTRACTS.exists() else {}
    rolling_out = {}
    codes = {"M+1": ("M", 12), "Q+1": ("Q", 8), "S+1": ("S", 6), "Y+1": ("Y", 6)}
    for cc, cfg in COUNTRIES.items():
        resolved = dict(resolve_forward_markets(h, cfg["forward"]))
        currency = "GBP" if cc == "UK" else "EUR"
        got = []
        for base_code, (pref, top) in codes.items():
            if base_code not in resolved:
                continue
            for k in range(1, top + 1):
                code = f"{pref}+{k}"
                m = dict(resolved[base_code])
                m.update({"marketCode": code, "marketNameCode": m["marketName"] + " " + code})
                try:
                    series = fetch_chart_series(h, [m], BACKFILL_DAYS)
                except requests.RequestException:
                    series = []
                if not series:
                    break
                item = series[0]
                lab = contract_label(item.get("marketName") or "")
                if not lab:
                    continue
                label, kind, a, b = lab
                c = out.setdefault(cc, {}).setdefault(label, {"marketName": item["marketName"], "kind": kind, "deliveryStart": a, "deliveryEnd": b,
                                                              "currency": currency, "points": {}})
                own = set(c.get("ownDates") or [])
                for p in item.get("value") or []:
                    if p.get("value") is not None:
                        d = ms_to_date(p["milisec"])
                        c["points"][d] = p["value"]
                        own.add(d)
                c["ownDates"] = sorted(own)
                c["lastCode"] = code
                c["lastSeen"] = date.today().isoformat()
                got.append(label)
        print(f"  {cc}: {len(got)} contracts quoted today ({', '.join(got[:6])}…)")
        # contracts no longer quoted (in delivery, expired), and the days before a contract's own series:
        # rebuilt from the rolling series; a contract's own closes always win
        try:
            roll = rolling_series(h, cc)
        except requests.RequestException as e:
            roll = {}
            print(f"  {cc}: rolling series failed ({e})")
        rolling_out.setdefault(cc, {})
        for tenor, pts in roll.items():
            rolling_out[cc][tenor] = dict(sorted(pts.items()))
        n_new = 0
        for label, rb in rebuild_from_rolling(roll).items():
            c = out.setdefault(cc, {}).get(label)
            if c is None:
                c = out[cc][label] = {"marketName": f"{cc} {label} base (rebuilt from rolling series)", "kind": rb["kind"],
                                      "deliveryStart": rb["deliveryStart"], "deliveryEnd": rb["deliveryEnd"], "currency": currency, "points": {}}
                n_new += 1
            own_set = set(c.get("ownDates") or [])
            added = [d for d in rb["points"] if d not in own_set]
            for d in added:
                c["points"][d] = rb["points"][d]
            c["rebuiltDates"] = sorted((set(c.get("rebuiltDates", [])) | set(added)) - own_set)
            c["rebuiltFrom"] = sorted(rb["tenors"], key=lambda t: int(t[2:]))
        print(f"  {cc}: {len(roll)} rolling series, {n_new} contracts rebuilt that the cockpit no longer quotes")
    # dates sorted, compact
    for cc in out:
        for label, c in out[cc].items():
            c["points"] = dict(sorted(c["points"].items()))
    OUT_CONTRACTS.parent.mkdir(parents=True, exist_ok=True)
    OUT_CONTRACTS.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT_CONTRACTS}: " + ", ".join(f"{cc} {len(v)}" for cc, v in out.items()))
    OUT_ROLLING.write_text(json.dumps({"note": "Rolling series of the cockpit (type Relative): on day d, M+k = calendar month(d)+k, Q+k = quarter(d)+k; when that contract no longer trades the value is the next contract's.",
                                       "series": rolling_out}, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT_ROLLING}")


if __name__ == "__main__":
    if "--contracts" in sys.argv:
        write_contracts()
        write_peak()
        sys.exit(0)
    if "--peak" in sys.argv:
        write_peak()
        sys.exit(0)
    if "--backfill" in sys.argv:
        backfill()
    else:
        daily_run()
    rebuild_series_summary()
    write_cal_chain()
    try:
        write_contracts()
    except Exception as e:   # never block the daily run
        print(f"Dated contracts failed: {e}")
    try:
        write_peak()
    except Exception as e:
        print(f"Peak contracts failed: {e}")
    print("Done.")
