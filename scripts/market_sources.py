#!/usr/bin/env python3
"""Free market commentaries published on the web in the same form every week or month, found without a feed.

Each finder returns the recent issues [{"date": "YYYY-MM-DD", "url": page or PDF, "title": …, "pdf": PDF url or None}];
scripts/fetch_news.py puts their title and link in the feed, scripts/fetch_market_notes.py reads their text into the
market notes (signed-in users only, never in the public files). Every site here allows scripts on these pages in its
robots.txt (checked 27 Nov. 2026).

  TotalEnergies Entreprises « Point Marché Hebdo » (Market Access team): a PDF each week, at a dated address
      (fileadmin/Digital/Entreprises/Flash_info_hebdo/YYMMDD-flash-info-hebdo.pdf); no listing page, so the dates of
      the last weeks are tried (an issue not out yet answers 404)
  ElCom (Swiss regulator) « Rapport de marché »: a PDF each week, linked from its reports page
  Axpo « European Energy Markets Monthly »: an article each month in its magazine, found in the sitemap
"""
import html
import re
from datetime import date, datetime, timedelta, timezone

import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def _fr_day(d):
    d = date.fromisoformat(d)
    return f"{d.day} {MOIS[d.month - 1]} {d.year}"


TE_URL = "https://www.totalenergies.fr/fileadmin/Digital/Entreprises/Flash_info_hebdo/{}-flash-info-hebdo.pdf"


def totalenergies_issues(days=21):
    today, out = datetime.now(timezone.utc).date(), []
    for k in range(days + 1):
        d = today - timedelta(days=k)
        if d.weekday() > 2:            # issues are dated Monday to Wednesday (Tuesday so far)
            continue
        u = TE_URL.format(d.strftime("%y%m%d"))
        try:
            r = requests.head(u, headers=UA, timeout=20, allow_redirects=True)
        except requests.RequestException:
            continue
        if r.status_code == 200 and "pdf" in r.headers.get("Content-Type", "pdf"):
            out.append({"date": d.isoformat(), "url": u, "pdf": u, "title": f"Point Marché Hebdo du {_fr_day(d.isoformat())}"})
    return out


ELCOM_PAGE = "https://www.elcom.admin.ch/fr/rapports-sur-le-marche"


def _elcom_date(u):
    s = requests.utils.unquote(u)
    for rx, order in ((r"(\d{2})[-.](\d{2})[-.](\d{4})", "dmy"), (r"(\d{4})_(\d{2})_(\d{2})", "ymd"), (r"(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)", "dmy")):
        m = re.search(rx, s)
        if m:
            a, b, c = m.groups()
            y, mo, d = (c, b, a) if order == "dmy" else (a, b, c)
            try:
                return date(int(y), int(mo), int(d)).isoformat()
            except ValueError:
                continue
    return None


def elcom_issues(n=3):
    page = requests.get(ELCOM_PAGE, headers=UA, timeout=30)
    page.raise_for_status()
    out, seen = [], set()
    # the files are named « Marktbericht vom 24-11-2026 », « Rapport de marché du 17-11-2026 », « 2026_10_13_Marktbericht »…
    for u in re.findall(r'href="(https://www\.elcom\.admin\.ch/dam/fr/sd-web/[^"]+\.pdf)"', page.text):
        d = _elcom_date(u)
        if d and d not in seen:
            seen.add(d)
            out.append({"date": d, "url": u, "pdf": u, "title": f"Rapport de marché du {_fr_day(d)}"})
    return sorted(out, key=lambda x: x["date"], reverse=True)[:n]


AXPO_SITEMAP = "https://www.axpo.com/se/en.sitemap.xml"


def _meta(page, prop):
    m = re.search(rf'<meta property="{prop}" content="([^"]*)"', page)
    return html.unescape(m.group(1)).strip() if m else ""


def axpo_issues(days=45):
    sm = requests.get(AXPO_SITEMAP, headers=UA, timeout=30)
    sm.raise_for_status()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    out = []
    for loc, mod in re.findall(r"<loc>(https://www\.axpo\.com/se/en/newsroom/magazine/energy-market/[^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", sm.text):
        if mod[:10] < since:
            continue
        page = requests.get(loc, headers=UA, timeout=30).text
        if "Markets Monthly" not in _meta(page, "og:description"):
            continue
        d = re.search(r"(\d{2})\.(\d{2})\.(\d{4})\s*\|\s*European Energy Markets Monthly", page)
        out.append({"date": f"{d.group(3)}-{d.group(2)}-{d.group(1)}" if d else mod[:10], "url": loc, "pdf": None,
                    "title": _meta(page, "og:title"), "page": page})
    return sorted(out, key=lambda x: x["date"], reverse=True)
