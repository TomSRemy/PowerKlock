#!/usr/bin/env python3
"""
fetch_go_auctions.py — PowerKlock  (build 2026-06f · dedicated XLSX parser)
---------------------------------------------------------------------------
EEX French GO auction RESULTS are JS-injected (empty in static HTML), so we
download the official EXCEL results files (static, public) linked on the page
and parse the Region x Technology matrix they contain.

Model: data/go_auctions.json is APPEND-ONLY, keyed by auction month. The stored
history (built once from the annual GLOBAL Results ZIPs) is preserved; each run
adds/refreshes the months found in the freshly downloaded file(s). Same parser
is used for backfill and monthly runs => identical schema.

Source : https://www.eex.com/en/markets/energy-certificates/french-auctions-power
CI deps : pip install requests pandas lxml openpyxl
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
TECH_FR2EN = {
    "eolien onshore": "Wind", "eolien offshore": "Wind Offshore", "eolien": "Wind",
    "hydraulique": "Hydro", "solaire": "Solar", "thermique": "Thermal",
    "biomasse": "Biomass", "nucleaire": "Nuclear", "nucléaire": "Nuclear",
}


# ── parsing helpers ──────────────────────────────────────────────────────────
def tech_en(s):
    s = str(s).strip().lower()
    for k, v in TECH_FR2EN.items():
        if s.startswith(k):
            return v
    return s.title()


def num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = re.sub(r"[^\d]", "", str(v))
    return int(s) if s else None


def price(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
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


def month_from_name(fn):
    m = re.search(r"_([A-Z][a-z]+)_(\d{4})_", fn)
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}"
    return None


def parse_sheet(df):
    """Parse one detailed-results sheet (Region x Technology matrix).
    Returns (by_technology, by_region, matrix), prices volume-weighted by sold."""
    rows = df.astype(object).where(pd.notna(df), None).values.tolist()
    hdr = None
    for i, r in enumerate(rows):
        cl = " ".join(str(c).lower() for c in r if c is not None)
        if "region" in cl and ("weighted" in cl or "price" in cl):
            hdr = i
            break
    if hdr is None:
        return [], [], []
    H = [str(c).lower() if c is not None else "" for c in rows[hdr]]

    def col(*kw, default=None):
        for j, h in enumerate(H):
            if all(k in h for k in kw):
                return j
        return default

    ci_reg = col("region", default=0)
    ci_tech = col("technolog", default=1)
    ci_off = col("auction", default=2)
    ci_sold = col("sold", default=3)
    ci_pr = col("weighted") or col("price") or 4

    matrix = []
    for r in rows[hdr + 1:]:
        if not r or ci_reg >= len(r) or r[ci_reg] is None:
            continue
        reg = str(r[ci_reg]).strip()
        if not reg or reg.lower().startswith("total") or "region" in reg.lower():
            continue
        techfr = str(r[ci_tech]).strip() if ci_tech < len(r) and r[ci_tech] is not None else ""
        if not techfr:
            continue
        off = num(r[ci_off]) if ci_off < len(r) else None
        sold = num(r[ci_sold]) if ci_sold < len(r) else None
        pr = price(r[ci_pr]) if ci_pr < len(r) else None
        if pr is None and sold is None:
            continue
        matrix.append({"region": reg, "technology": tech_en(techfr),
                       "offered_mwh": off, "allocated_mwh": sold, "price_eur_mwh": pr})

    def agg(key):
        out = {}
        for m in matrix:
            o = out.setdefault(m[key], {"off": 0, "sold": 0, "pw": 0.0, "w": 0})
            if m["offered_mwh"]:
                o["off"] += m["offered_mwh"]
            if m["allocated_mwh"]:
                o["sold"] += m["allocated_mwh"]
            if m["price_eur_mwh"] is not None and m["allocated_mwh"]:
                o["pw"] += m["price_eur_mwh"] * m["allocated_mwh"]
                o["w"] += m["allocated_mwh"]
        res = [{key: k, "offered_mwh": o["off"] or None, "allocated_mwh": o["sold"] or None,
                "price_eur_mwh": round(o["pw"] / o["w"], 4) if o["w"] else None}
               for k, o in out.items()]
        res.sort(key=lambda x: -(x["allocated_mwh"] or 0))
        return res

    return agg("technology"), agg("region"), matrix


def auctions_from_xlsx(content, fname):
    """One xlsx file = one auction (one sheet). Returns list of auction dicts."""
    out = []
    try:
        xl = pd.ExcelFile(io.BytesIO(content), engine="openpyxl")
    except Exception as e:
        print("  excel error:", type(e).__name__, e)
        return out
    for sh in xl.sheet_names:
        df = pd.read_excel(io.BytesIO(content), sheet_name=sh, header=None, engine="openpyxl")
        bt, br, matrix = parse_sheet(df)
        if not bt and not br:
            continue
        out.append({"auction_month": month_from_name(fname) or month_from_name(sh),
                    "source_file": fname, "by_technology": bt, "by_region": br, "matrix": matrix})
    return out


def auctions_from_download(content, url):
    if url.lower().endswith(".zip"):
        out = []
        zf = zipfile.ZipFile(io.BytesIO(content))
        for nm in zf.namelist():
            if nm.lower().endswith(".xlsx"):
                out += auctions_from_xlsx(zf.read(nm), nm)
        return out
    return auctions_from_xlsx(content, url.split("/")[-1])


# ── page / links ─────────────────────────────────────────────────────────────
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
    def score(u):
        ul = u.lower()
        s = 0
        if "detailedresults" in ul: s += 100
        if "global_results" in ul: s += 50
        if "result" in ul: s += 20
        if ul.endswith(".xlsx"): s += 10
        m = re.search(r"/(\d{8})_", u)
        if m: s += int(m.group(1)) / 1e9
        return s
    cand = [u for u in links if "result" in u.lower() or "global" in u.lower()] or links
    return sorted(cand, key=score, reverse=True)


def extract_reserve(html):
    m = re.search(r"reserve price[^:]*:\s*([\d.,]+)", html, re.I)
    return price(m.group(1)) if m else None


# ── store ────────────────────────────────────────────────────────────────────
def load_existing():
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated": None, "source": "EEX French Auctions for Power Guarantees of Origin",
            "url": URL, "reserve_eur_mwh": None, "auctions": []}


def merge(data, new_auctions):
    by_month = {a.get("auction_month"): a for a in data.get("auctions", []) if a.get("auction_month")}
    added = 0
    for a in new_auctions:
        if a.get("auction_month"):
            by_month[a["auction_month"]] = a   # add or refresh
            added += 1
    data["auctions"] = sorted(by_month.values(), key=lambda a: a["auction_month"])
    return added


def main():
    print("[fetch_go_auctions] build 2026-06f · dedicated XLSX parser")
    sess = requests.Session()
    sess.headers.update(HEADERS)
    html, status = fetch_html(URL, sess)
    reserve = extract_reserve(html)
    links = rank_links(find_download_links(html))
    print(f"HTTP {status} · HTML {len(html)} · {len(links)} result link(s)")
    for u in links[:6]:
        print("   link:", u)
    if not links:
        print("WARN: no Excel/ZIP result link found in page; aborting.")
        return 1

    new = []
    for u in links[:4]:
        try:
            resp = sess.get(u, timeout=180)
            if not resp.ok:
                print(f"   download {resp.status_code}: {u}")
                continue
            got = auctions_from_download(resp.content, u)
            print(f"   parsed {len(got)} auction(s) from {u.split('/')[-1]}")
            new += got
            if got:
                break
        except Exception as e:
            print(f"   error on {u}: {type(e).__name__} {e}")

    if not new:
        print("WARN: downloaded file(s) but parsed no auctions; aborting.")
        return 1

    data = load_existing()
    if reserve is not None:
        data["reserve_eur_mwh"] = reserve
    added = merge(data, new)
    data["updated"] = dt.date.today().isoformat()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    months = ", ".join(a["auction_month"] for a in new if a.get("auction_month"))
    print(f"OK: merged {added} auction(s) [{months}]. Total stored: {len(data['auctions'])}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
