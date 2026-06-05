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


def parse_results_tables(html):
    """Return (by_technology, by_region). Robust to header/no-header tables
    and month-spanned header rows."""
    try:
        tables = pd.read_html(io.StringIO(html))
    except Exception:
        return [], []
    by_tech, by_region = [], []
    for df in tables:
        rows = df.astype(object).where(pd.notna(df), None).values.tolist()
        if not rows:
            continue
        ncol = max(len(r) for r in rows)
        if ncol < 4:
            continue

        # locate an in-table header row (when <th> was absent)
        hdr_idx = -1
        for i, r in enumerate(rows[:3]):
            j = " ".join(str(c).lower() for c in r if c is not None)
            if "offered" in j or "weighted" in j or ("price" in j and "volume" in j):
                hdr_idx = i
                break

        off_i = alloc_i = price_i = None
        if hdr_idx >= 0:
            hdr = [str(c).lower() if c is not None else "" for c in rows[hdr_idx]]
            for i, h in enumerate(hdr):
                if "offered" in h:
                    off_i = i
                elif "allocated" in h:
                    alloc_i = i
                elif "price" in h or "weighted" in h:
                    price_i = i
            data = rows[hdr_idx + 1:]
        else:
            data = rows

        # positional fallback (label, offered, allocated, price)
        if price_i is None:
            price_i = ncol - 1
        if alloc_i is None:
            alloc_i = ncol - 2
        if off_i is None:
            off_i = ncol - 3

        # classify by first-column labels of the data rows
        labels = [str(r[0]).strip().lower() for r in data if r and r[0] is not None]
        t = sum(1 for v in labels if v in TECHS)
        rg = sum(1 for v in labels if _looks_region(v))
        if t >= 1 and t >= rg:
            kind = "technology"
        elif rg >= 1:
            kind = "region"
        else:
            continue

        def cell(r, i):
            return r[i] if (i is not None and i < len(r)) else None

        for r in data:
            if not r or r[0] is None:
                continue
            name = str(r[0]).strip()
            nl = name.lower()
            if not name or nl in ("region", "technology", "nan") or "volume" in nl or "price" in nl:
                continue
            price = parse_price(cell(r, price_i))
            off = parse_volume(cell(r, off_i))
            alloc = parse_volume(cell(r, alloc_i))
            if price is None and off is None:
                continue
            rec = {("technology" if kind == "technology" else "region"): name,
                   "offered_mwh": off, "allocated_mwh": alloc, "price_eur_mwh": price}
            (by_tech if kind == "technology" else by_region).append(rec)
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
    print("HTTP status     :", status)
    print("HTML length     :", len(html))
    for m in ("Results", "Weighted Average Price", "Volume Offered", "reserve price",
              "Just a moment", "captcha", "Access Denied", "cookie"):
        print(f"  contains {m!r:34}: {m in html}")
    try:
        import pandas as _pd
        n = len(_pd.read_html(io.StringIO(html)))
    except Exception as e:
        n = f"read_html error: {type(e).__name__}"
    print("pandas tables   :", n)
    print("--------------------")


def main():
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
