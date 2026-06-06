#!/usr/bin/env python3
"""
fetch_go_auctions.py — PowerKlock
---------------------------------
Scrapes the EEX "French Auctions for Power Guarantees of Origin" results page
(public, official) and appends the latest monthly auction into
data/go_auctions.json (append-only history, keyed by auction month).

Source : https://www.eex.com/en/markets/energy-certificates/french-auctions-power
This is the FR primary auction (State = sole seller, subsidised GOs, spot,
one production period at a time). Public data, no "internal-use" clause.

Run in CI monthly (see .github/workflows/fetch_go_auctions.yml).
Local test:  python scripts/fetch_go_auctions.py
"""

import io
import json
import re
import time
import sys
import datetime as dt
from pathlib import Path

import requests
import pandas as pd

URL = "https://www.eex.com/en/markets/energy-certificates/french-auctions-power"
OUT = Path(__file__).resolve().parent.parent / "data" / "go_auctions.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    "Accept-Encoding": "gzip, deflate",   # no brotli: requests may not decode it
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}
MARKERS = ("Weighted Average Price", "Volume Offered")


def fetch_html(url):
    """Session + browser headers + retry (BIG-IP sets a persistence cookie on
    the first hit, content arrives on the retry). Returns (html, status)."""
    sess = requests.Session()
    sess.headers.update(HEADERS)
    html, status = "", None
    for attempt in range(3):
        r = sess.get(url, timeout=60)
        status = r.status_code
        html = r.text
        if any(m in html for m in MARKERS):
            return html, status
        time.sleep(3)
    return html, status

MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"], start=1)}


# ── number parsing ─────────────────────────────────────────────────────────
def parse_volume(v):
    """'1.099.020' -> 1099020 ; dots/spaces = thousands separators."""
    if v is None:
        return None
    s = re.sub(r"[^\d]", "", str(v))
    return int(s) if s else None


def parse_price(v):
    """'€ 2.02' -> 2.02 ; '0,15 €/MWh' -> 0.15 ; tolerant to , or . decimals."""
    if v is None:
        return None
    s = re.sub(r"[^\d.,]", "", str(v))
    if not s:
        return None
    if "," in s and "." in s:                 # last separator is decimal
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:                            # comma decimal (e.g. 0,15)
        s = s.replace(",", ".")
    try:
        return round(float(s), 4)
    except ValueError:
        return None


# ── parsing ─────────────────────────────────────────────────────────────────
def extract_auction_month(html):
    """Auction month from the XLSX results link filename, e.g.
       '..._February_2026_..._detailedresults.xlsx' -> '2026-02'.
       Fallback: first 'Month YYYY' found near the Results section."""
    m = re.search(r"_([A-Z][a-z]+)_(\d{4})_\d+_GLOBAL_Results", html)
    if not m:
        m = re.search(r"(January|February|March|April|May|June|July|August|"
                      r"September|October|November|December)[_ ](\d{4})", html)
    if m:
        mon = MONTHS.get(m.group(1).lower())
        if mon:
            return f"{m.group(2)}-{mon:02d}"
    return None


def extract_reserve(html):
    m = re.search(r"reserve price[^:]*:\s*([\d.,]+)", html, re.I)
    return parse_price(m.group(1)) if m else None


TECHS = {"wind", "hydro", "solar", "thermal", "nuclear", "biomass", "renewable"}
REGION_HINTS = ["rhône", "rhone", "grand est", "france", "loire", "aquitaine",
                "occitanie", "bretagne", "normandie", "provence", "bourgogne",
                "centre-val", "île", "ile-de", "hauts-de", "haut-de", "corse",
                "azur", "franche"]


def _looks_region(s):
    s = s.lower()
    return any(h in s for h in REGION_HINTS)


def _find_label(cells):
    """Return (index, kind, clean_name) of the first cell that is a known
    technology or French region, scanning the whole row (handles leading
    empty/index columns)."""
    for i, c in enumerate(cells):
        cl = re.sub(r"\s+", " ", c).strip().lower()
        if not cl:
            continue
        if cl in TECHS:
            return i, "technology", re.sub(r"\s+", " ", c).strip()
        if _looks_region(cl):
            return i, "region", re.sub(r"\s+", " ", c).strip()
    return None


def parse_results_tables(html):
    """Row-centric, header-agnostic. For every row of every table, find a
    technology/region label anywhere in the row and take the numeric cells
    that follow it (offered, allocated, price)."""
    try:
        tables = pd.read_html(io.StringIO(html))
    except Exception:
        return [], []
    by_tech, by_region = [], []
    seen_t, seen_r = set(), set()
    for df in tables:
        rows = df.astype(object).where(pd.notna(df), None).values.tolist()
        for r in rows:
            if not r:
                continue
            cells = [("" if c is None else str(c)).strip() for c in r]
            found = _find_label(cells)
            if not found:
                continue
            li, kind, name = found
            after = cells[li + 1:]
            numcells = [c for c in after if any(ch.isdigit() for ch in c)]
            if not numcells:
                continue
            price = parse_price(numcells[-1])
            off = parse_volume(numcells[0]) if len(numcells) >= 2 else None
            alloc = parse_volume(numcells[1]) if len(numcells) >= 3 else None
            if price is None and off is None:
                continue
            nl = name.lower()
            if kind == "technology" and nl not in seen_t:
                seen_t.add(nl)
                by_tech.append({"technology": name, "offered_mwh": off,
                                "allocated_mwh": alloc, "price_eur_mwh": price})
            elif kind == "region" and nl not in seen_r:
                seen_r.add(nl)
                by_region.append({"region": name, "offered_mwh": off,
                                  "allocated_mwh": alloc, "price_eur_mwh": price})
    return by_tech, by_region


# ── main ─────────────────────────────────────────────────────────────────────
def load_existing():
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated": None, "source": "EEX French Auctions for Power Guarantees of Origin",
            "url": URL, "reserve_eur_mwh": None, "auctions": []}


def diagnose(html, status):
    print("---- DIAGNOSTIC ----")
    print("HTTP status:", status, "| HTML length:", len(html))
    try:
        tbls = pd.read_html(io.StringIO(html))
    except Exception as e:
        print("read_html error:", type(e).__name__, e)
        print("--------------------")
        return
    print("pandas tables:", len(tbls))
    KW = ("Weighted", "Volume", "Wind", "Hydro", "Solar", "Thermal",
          "Region", "Grand Est", "Aquitaine", "Auvergne", "Occitanie")
    for i, df in enumerate(tbls):
        rows = df.astype(object).where(pd.notna(df), None).values.tolist()
        flat = " ".join(str(c) for r in rows[:8] for c in (r or []))
        if not any(k in flat for k in KW):
            print(f"[T{i}] shape={df.shape}  (skip)")
            continue
        print(f"[T{i}] shape={df.shape}  columns={list(df.columns)}")
        for r in rows[:5]:
            print("     ", [None if c is None else str(c)[:26] for c in r])
    print("--------------------")


def main():
    print("[fetch_go_auctions] build 2026-06d · table dump")
    html, status = fetch_html(URL)

    auction_month = extract_auction_month(html)
    reserve = extract_reserve(html)
    by_tech, by_region = parse_results_tables(html)

    if not by_tech and not by_region:
        print("WARN: no result tables parsed; aborting without write.")
        diagnose(html, status)
        return 1
    if not auction_month:
        print("WARN: could not determine auction month; aborting without write.")
        diagnose(html, status)
        return 1

    record = {
        "auction_month": auction_month,
        "reserve_eur_mwh": reserve,
        "by_technology": by_tech,
        "by_region": by_region,
    }

    data = load_existing()
    data["reserve_eur_mwh"] = reserve
    data["updated"] = dt.date.today().isoformat()
    data["auctions"] = [a for a in data.get("auctions", []) if a.get("auction_month") != auction_month]
    data["auctions"].append(record)
    data["auctions"].sort(key=lambda a: a.get("auction_month", ""))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {auction_month} -> {len(by_tech)} techno rows, {len(by_region)} region rows, "
          f"reserve {reserve} €/MWh. Total auctions: {len(data['auctions'])}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
