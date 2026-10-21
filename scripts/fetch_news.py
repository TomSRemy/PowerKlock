#!/usr/bin/env python3
"""
Fetch energy-market news from public RSS/Atom feeds and write data/news.json.

Runs server-side (GitHub Actions) so the site needs no CORS proxy. Items are
stored as plain text (tags stripped, entities decoded); the frontend escapes
them again before rendering. Only http(s) links are kept.
"""
import html
import json
import os
import re
import sys
import time
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

OUT = Path("data/news.json")
PER_SOURCE = 15
MAX_ITEMS = 220
UA = {"User-Agent": "Mozilla/5.0 (PowerKlock news fetcher; +https://github.com/TomSRemy/PowerKlock)"}

CONFIG = Path("config/news_sources.json")
GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
PER_SEARCH = 8


def load_config():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    # sources added from the site (public.news_source, warehouse migration 012), when the database is reachable
    db = os.environ.get("SUPABASE_DB_URL")
    if db:
        try:
            import psycopg
            with psycopg.connect(db, connect_timeout=15) as conn, conn.cursor() as cur:
                cur.execute("select kind, name, url, query, tags from public.news_source where active order by created_at")
                rows = cur.fetchall()
            known = {f["url"] for f in cfg.get("feeds", [])} | {x["q"] for x in cfg.get("searches", [])}
            for kind, name, url, query, tags in rows:
                if (url if kind == "feed" else query) in known:
                    continue
                if kind == "feed":
                    cfg.setdefault("feeds", []).append({"name": name, "cls": "added", "url": url, "tags": list(tags or []), "added": True})
                else:
                    cfg.setdefault("searches", []).append({"q": query, "tags": list(tags or []), "added": True})
            print(f"  {len(rows)} source(s) added from the site")
        except Exception as e:   # the news must not depend on the database
            print("  site sources not read:", str(e)[:160])
    return cfg


# Keyword tagging on title + summary (word-ish boundaries, case-insensitive).
KEYWORDS = {
    "gas": r"\b(gas|lng|ttf|pipeline|regasification|storage level|nbp|peg)\b",
    "carbon": r"\b(carbon|co2|ets|eua|emission|decarboni[sz]|net[- ]zero|climate)\b",
    "regulation": r"\b(regulat\w*|directive|commission|acer|cre|tariff|law|bill|consultation|policy|ministry|government|auction design)\b",
    "markets": r"\b(price[sd]?|market[s]?|trading|futures|forward|auction|spot|day-ahead|ppa|contract[s]?)\b",
    "power": r"\b(power|electricity|grid|solar|wind|nuclear|hydro|battery|batteries|renewable[s]?|tso)\b",
}


def text_of(el):
    return "".join(el.itertext()).strip() if el is not None else ""


def clean(s, limit=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    if limit and len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_feed(xml_bytes):
    root = ET.fromstring(xml_bytes)
    items = []
    for el in root.iter():
        name = local(el.tag)
        if name not in ("item", "entry"):
            continue
        f = {local(c.tag): c for c in el}
        link = ""
        if "link" in f:
            link = f["link"].get("href") or text_of(f["link"])
        for c in el:
            if local(c.tag) == "link" and c.get("rel", "alternate") == "alternate" and c.get("href"):
                link = c.get("href")
                break
        date = None
        for k in ("pubDate", "published", "updated", "date"):
            if k in f:
                date = parse_date(text_of(f[k]))
                if date:
                    break
        summary = text_of(f.get("description")) or text_of(f.get("summary")) or text_of(f.get("encoded"))
        items.append({"title": clean(text_of(f.get("title")), 220), "link": link.strip(),
                      "date": date, "snippet": clean(summary, 240)})
    return items


def read_cre(content):
    """CRE news listing (no RSS): title, link and publication time of each card."""
    s = content.decode("utf-8", "ignore")
    out = []
    for url, title, when in re.findall(r'data-document-url="([^"]+)".*?<h3[^>]*>\s*<a[^>]*>(.*?)</a>.*?<time datetime="([^"]+)"', s, re.S):
        out.append({"title": clean(title, 220), "link": "https://www.cre.fr" + url if url.startswith("/") else url,
                    "date": parse_date(when), "snippet": ""})
    return out


READERS = {"cre": read_cre}


def gdelt(q):
    """World press search (GDELT DOC API, last 7 days)."""
    for wait in (0, 12, 30):          # GDELT throttles to one request every 5 s per address
        time.sleep(wait)
        r = requests.get(GDELT, params={"query": q, "mode": "artlist", "format": "json", "maxrecords": 25, "timespan": "7d", "sort": "datedesc"},
                         headers=UA, timeout=30)
        if r.status_code != 429:
            break
    r.raise_for_status()
    if not r.text.strip().startswith("{"):
        raise ValueError(r.text.strip()[:80])
    items = []
    for a in r.json().get("articles", []):
        d = a.get("seendate", "")
        try:
            dt = datetime.strptime(d, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        items.append({"title": clean(a.get("title"), 220), "link": a.get("url", ""), "date": dt, "snippet": "",
                      "domain": a.get("domain") or urlparse(a.get("url", "")).netloc})
    return items


def add_items(out, items, src, now, limit, extra=None):
    kept = 0
    seen = {i["link"] for i in out} | {i["title"].lower() for i in out}
    for it in sorted([i for i in items if i["title"] and i["link"].startswith(("http://", "https://")) and i["date"]],
                     key=lambda i: i["date"], reverse=True):
        if kept >= limit:
            break
        if it["link"] in seen or it["title"].lower() in seen:
            continue
        if it["date"] > now:            # some feeds publish future-dated items
            it["date"] = now
        blob = (it["title"] + " " + it["snippet"]).lower()
        tags = list(dict.fromkeys(src.get("tags", []) + [t for t, rx in KEYWORDS.items() if re.search(rx, blob)]))
        rec = {"source": it.get("domain") or src["name"], "cls": src.get("cls", "search"), "title": it["title"], "link": it["link"],
               "snippet": it["snippet"], "date": it["date"].isoformat(timespec="seconds"), "tags": tags}
        if extra:
            rec.update(extra)
        out.append(rec)
        seen.add(it["link"]); seen.add(it["title"].lower())
        kept += 1
    return kept


def main():
    now = datetime.now(timezone.utc)
    cfg = load_config()
    out, status = [], []
    for src in cfg.get("feeds", []) + cfg.get("pages", []):
        try:
            r = requests.get(src["url"], headers=UA, timeout=25)
            r.raise_for_status()
            items = READERS[src["reader"]](r.content) if src.get("reader") else parse_feed(r.content)
            n = add_items(out, items, src, now, PER_SOURCE)
            status.append({"name": src["name"], "kind": "page" if src.get("reader") else "feed", "url": src["url"], "ok": True, "n": n, "added": bool(src.get("added"))})
        except Exception as e:
            status.append({"name": src["name"], "kind": "page" if src.get("reader") else "feed", "url": src["url"], "ok": False, "error": str(e)[:120], "added": bool(src.get("added"))})
    for k, s in enumerate(cfg.get("searches", [])):
        if k:
            time.sleep(6)               # GDELT: one request every 5 seconds
        try:
            n = add_items(out, gdelt(s["q"]), {"name": "Search", "cls": "search", "tags": s.get("tags", []) + ["watch"]}, now, PER_SEARCH, {"query": s["q"]})
            status.append({"name": s["q"], "kind": "search", "ok": True, "n": n, "added": bool(s.get("added"))})
        except Exception as e:
            status.append({"name": s["q"], "kind": "search", "ok": False, "error": str(e)[:120], "added": bool(s.get("added"))})
    for st in status:
        print(f"  {st['kind']:6s} {st['name'][:40]:40s} " + (f"{st['n']} items" if st["ok"] else "ERROR " + st["error"]))
    if not out:
        sys.exit("No news fetched — keeping the previous file.")
    out.sort(key=lambda i: i["date"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "items": out[:MAX_ITEMS], "sources": status},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT}: {min(len(out), MAX_ITEMS)} items")


if __name__ == "__main__":
    main()
