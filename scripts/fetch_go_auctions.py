#!/usr/bin/env python3
"""
fetch_go_auctions.py — PowerKlock  (build 2026-06e · XLSX download)
-------------------------------------------------------------------
The EEX French GO auction RESULTS TABLES are injected by JavaScript, so the
rendered HTML retrieved by `requests` only contains empty table shells.
=> We instead download the official EXCEL results files (static, public) linked
on the page and parse them with a header-agnostic row parser.

Source page : https://www.eex.com/en/markets/energy-certificates/french-auctions-power
Output      : data/go_auctions.json  (append-only, keyed by auction month)
CI deps     : pip install requests pandas lxml openpyxl   <-- openpyxl REQUIRED
"""

import io
import re
import sys
import json
import time
import zipfile
import datetime as dt
from pathlib import Path

import requests
import pandas as pd

BASE = "https://www.eex.com"
URL = BASE + "/en/markets/energy-certificates/french-auctions-power"
OUT = Path(__file__).resolve().parent.parent / "data" / "go_auctions.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}
MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"], start=1)}

TECHS = {"wind", "hydro", "solar", "thermal", "nuclear", "biomass", "renewable",
         "eolien", "hydraulique", "solaire", "thermique", "biomasse"}
REGION_HINTS = ["rhône", "rhone", "grand est", "france", "loire", "aquitaine",
                "occitanie", "bretagne", "normandie", "provence", "bourgogne",
                "centre-val", "île", "ile-de", "hauts-de", "haut-de", "corse",
                "azur", "franche", "alpes", "pays de la loire"]


# ── parsing helpers ──────────────────────────────────────────────────────────
def parse_volume(v):
    if v is None:
        return None
    s = re.sub(r"[^\d]", "", str(v))
    return int(s) if s else None


def parse_price(v):
    if v is None:
        return None
    s = re.sub(r"[^\d.,]", "", str(v))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return round(float(s), 4)
    except ValueError:
        return None


def _looks_region(s):
    s = s.lower()
    return any(h in s for h in REGION_HINTS)


def _find_label(cells):
    for i, c in enumerate(cells):
        cl = re.sub(r"\s+", " ", str(c)).strip().lower()
        if not cl:
            continue
        if cl in TECHS:
            return i, "technology", re.sub(r"\s+", " ", str(c)).strip()
        if _looks_region(cl):
            return i, "region", re.sub(r"\s+", " ", str(c)).strip()
    return None


def extract_from_rows(rows, by_tech, by_region, seen_t, seen_r):
    for r in rows:
        if not r:
            continue
        cells = [("" if c is None else str(c)).strip() for c in r]
        found = _find_label(cells)
        if not found:
            continue
        li, kind, name = found
        numcells = [c for c in cells[li + 1:] if any(ch.isdigit() for ch in c)]
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


def parse_excel_bytes(content):
    """Read all sheets of an .xlsx and extract tech/region rows."""
    by_tech, by_region, seen_t, seen_r = [], [], set(), set()
    try:
        sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None, engine="openpyxl")
    except Exception as e:
        print("  excel read error:", type(e).__name__, e)
        return by_tech, by_region
    for name, df in sheets.items():
        extract_from_rows(df.astype(object).where(pd.notna(df), None).values.tolist(),
                          by_tech, by_region, seen_t, seen_r)
    return by_tech, by_region


# ── fetch / links ────────────────────────────────────────────────────────────
def fetch_html(url, sess):
    for _ in range(3):
        r = sess.get(url, timeout=60)
        if r.ok and len(r.text) > 5000:
            return r.text, r.status_code
        time.sleep(2)
    return r.text, r.status_code


def find_download_links(html):
    raw = re.findall(r'href=["\']([^"\']+\.(?:xlsx|zip))["\']', html, re.I)
    out, seen = [], set()
    for l in raw:
        u = l if l.startswith("http") else (BASE + l if l.startswith("/") else None)
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def rank_links(links):
    """Prefer the latest monthly detailed results .xlsx, then any results xlsx,
    then GLOBAL Results zip."""
    def score(u):
        ul = u.lower()
        s = 0
        if "detailedresults" in ul: s += 100
        if "global_results" in ul: s += 50
        if "result" in ul: s += 20
        if ul.endswith(".xlsx"): s += 10
        m = re.search(r"/(\d{8})_", u)         # date prefix -> recency
        if m: s += int(m.group(1)) % 1000000 / 1e7
        return s
    return sorted([u for u in links if "result" in u.lower() or "global" in u.lower()] or links,
                  key=score, reverse=True)


def month_from_url(u):
    m = re.search(r"_([A-Z][a-z]+)_(\d{4})_", u)
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}"
    m = re.search(r"/(\d{4})(\d{2})\d{2}_", u)   # 20260520_ -> use as fallback YYYY-MM
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return None


def extract_reserve(html):
    m = re.search(r"reserve price[^:]*:\s*([\d.,]+)", html, re.I)
    return parse_price(m.group(1)) if m else None


# ── main ─────────────────────────────────────────────────────────────────────
def load_existing():
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated": None, "source": "EEX French Auctions for Power Guarantees of Origin",
            "url": URL, "reserve_eur_mwh": None, "auctions": []}


def main():
    print("[fetch_go_auctions] build 2026-06e · XLSX download")
    sess = requests.Session()
    sess.headers.update(HEADERS)
    html, status = fetch_html(URL, sess)
    reserve = extract_reserve(html)

    links = rank_links(find_download_links(html))
    print(f"HTTP {status} · HTML {len(html)} · {len(links)} result file link(s)")
    for u in links[:6]:
        print("   link:", u)
    if not links:
        print("WARN: no Excel/ZIP result link found in page; aborting.")
        return 1

    by_tech, by_region, used = [], [], None
    for u in links[:4]:
        try:
            resp = sess.get(u, timeout=120)
            if not resp.ok:
                print(f"   download {resp.status_code}: {u}")
                continue
            data_bytes = resp.content
            if u.lower().endswith(".zip"):
                zf = zipfile.ZipFile(io.BytesIO(data_bytes))
                for nm in zf.namelist():
                    if nm.lower().endswith(".xlsx"):
                        bt, br = parse_excel_bytes(zf.read(nm))
                        by_tech += [x for x in bt if x["technology"] not in {y["technology"] for y in by_tech}]
                        by_region += [x for x in br if x["region"] not in {y["region"] for y in by_region}]
            else:
                bt, br = parse_excel_bytes(data_bytes)
                by_tech += [x for x in bt if x["technology"] not in {y["technology"] for y in by_tech}]
                by_region += [x for x in br if x["region"] not in {y["region"] for y in by_region}]
            if by_tech or by_region:
                used = u
                break
        except Exception as e:
            print(f"   error on {u}: {type(e).__name__} {e}")

    if not by_tech and not by_region:
        print("WARN: downloaded file(s) but parsed no tech/region rows; aborting.")
        return 1

    auction_month = month_from_url(used) or month_from_url(links[0])
    if not auction_month:
        print("WARN: could not determine auction month from file name; aborting.")
        return 1

    record = {"auction_month": auction_month, "reserve_eur_mwh": reserve,
              "source_file": used, "by_technology": by_tech, "by_region": by_region}
    data = load_existing()
    data["reserve_eur_mwh"] = reserve
    data["updated"] = dt.date.today().isoformat()
    data["auctions"] = [a for a in data.get("auctions", []) if a.get("auction_month") != auction_month]
    data["auctions"].append(record)
    data["auctions"].sort(key=lambda a: a.get("auction_month", ""))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {auction_month} -> {len(by_tech)} techno, {len(by_region)} region, "
          f"reserve {reserve}. file: {used}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
