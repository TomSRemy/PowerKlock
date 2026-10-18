#!/usr/bin/env python3
"""
Fetch energy-market news from public RSS/Atom feeds and write data/news.json.

Runs server-side (GitHub Actions) so the site needs no CORS proxy. Items are
stored as plain text (tags stripped, entities decoded); the frontend escapes
them again before rendering. Only http(s) links are kept.
"""
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

OUT = Path("data/news.json")
PER_SOURCE = 15
MAX_ITEMS = 160
UA = {"User-Agent": "Mozilla/5.0 (PowerKlock news fetcher; +https://github.com/TomSRemy/PowerKlock)"}

SOURCES = [
    {"name": "Carbon Pulse", "cls": "carbonpulse", "url": "https://carbon-pulse.com/feed/", "tags": ["carbon"]},
    {"name": "Carbon Brief", "cls": "carbonbrief", "url": "https://www.carbonbrief.org/feed/", "tags": ["carbon"]},
    {"name": "Clean Energy Wire", "cls": "cew", "url": "https://www.cleanenergywire.org/rss.xml", "tags": ["power"]},
    {"name": "Energy Monitor", "cls": "energymonitor", "url": "https://www.energymonitor.ai/feed/", "tags": ["power"]},
    {"name": "pv magazine", "cls": "pvmag", "url": "https://www.pv-magazine.com/feed/", "tags": ["power"]},
    {"name": "Windpower Monthly", "cls": "windpower", "url": "https://www.windpowermonthly.com/rss/news", "tags": ["power"]},
    {"name": "Energy-Storage.news", "cls": "storage", "url": "https://www.energy-storage.news/feed/", "tags": ["power"]},
    {"name": "World Nuclear News", "cls": "wnn", "url": "https://www.world-nuclear-news.org/rss", "tags": ["power"]},
    {"name": "GIE", "cls": "gie", "url": "https://www.gie.eu/feed/", "tags": ["gas"]},
    {"name": "SMARD", "cls": "smard", "url": "https://www.smard.de/service/rss/en/feed.rss", "tags": ["power", "markets"]},
    {"name": "Connaissance des Énergies", "cls": "cde", "url": "https://www.connaissancedesenergies.org/rss.xml", "tags": ["fr"]},
]

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


def main():
    now = datetime.now(timezone.utc)
    out, report = [], []
    for src in SOURCES:
        try:
            r = requests.get(src["url"], headers=UA, timeout=25)
            r.raise_for_status()
            items = parse_feed(r.content)
        except Exception as e:
            report.append(f"  {src['name']:26s} ERROR {e}")
            continue
        kept = 0
        for it in sorted([i for i in items if i["title"] and i["link"].startswith(("http://", "https://")) and i["date"]],
                         key=lambda i: i["date"], reverse=True)[:PER_SOURCE]:
            if it["date"] > now:            # some feeds publish future-dated items
                it["date"] = now
            blob = (it["title"] + " " + it["snippet"]).lower()
            tags = list(dict.fromkeys(src["tags"] + [t for t, rx in KEYWORDS.items() if re.search(rx, blob)]))
            out.append({"source": src["name"], "cls": src["cls"], "title": it["title"], "link": it["link"],
                        "snippet": it["snippet"], "date": it["date"].isoformat(timespec="seconds"), "tags": tags})
            kept += 1
        report.append(f"  {src['name']:26s} {kept} items")
    print("\n".join(report))
    if not out:
        sys.exit("No news fetched — keeping the previous file.")
    out.sort(key=lambda i: i["date"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "items": out[:MAX_ITEMS]},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT}: {min(len(out), MAX_ITEMS)} items")


if __name__ == "__main__":
    main()
