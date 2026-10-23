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
from urllib.parse import urljoin, urlparse
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
    # what moves prices or the renewable business (English and French)
    "geopolitics": r"\b(russia\w*|russie|ukrain\w*|gazprom|sanction\w*|iran\w*|israel\w*|middle east|moyen-orient|qatar\w*|strait|détroit|hormuz|ormuz|red sea|mer rouge|opec|opep|houthi\w*|war|guerre|conflict|conflit|attack\w*|attaque\w*|embargo|tariff war|trade war|blockade|blocus|geopolit\w*|géopolit\w*|norway outage|supply disruption|force majeure)\b",
    "deal": r"\b(acqui\w*|rachat|rachète|rachete|cède|cede|cession|cèdent|takeover|buys?|bought|sells?|sold|stake|participation|merger|fusion|divest\w*|portfolio sale|deal|transaction|refinanc\w*|financing|financement|lève|raises? \S+ (m|bn)|joint venture|coentreprise)\b",
    "build": r"\b(commission(ed|ing)|mise en service|mis en service|inaugur\w*|energi[sz]ed|connected to the grid|raccord\w*|groundbreaking|first stone|première pierre|construction start\w*|starts? construction|breaks ground|enters? (commercial )?operation|comes? online|COD\b|repowering|permis de construire|building permit|consent\w* granted|approved|autoris\w*)\b",

    "gas": r"\b(gas|lng|ttf|pipeline|regasification|storage level|nbp|peg)\b",
    "carbon": r"\b(carbon|co2|ets|eua|emission|decarboni[sz]|net[- ]zero|climate)\b",
    "regulation": r"\b(regulat\w*|réglement\w*|directive|commission|acer|cre|tariff|tarif\w*|law|loi|décret|decree|arrêté|bill|consultation|policy|ministry|ministère|government|gouvernement|auction design|appel d'offres|tender|ppe|arenh|vnu|turpe|accise|capacity mechanism|mécanisme de capacité|cfd|complément de rémunération)\b",
    "markets": r"\b(price[sd]?|market[s]?|trading|futures|forward|auction|spot|day-ahead|ppa|contract[s]?)\b",
    "power": r"\b(power|electricity|grid|solar|wind|nuclear|hydro|battery|batteries|renewable[s]?|tso)\b",
}


# which countries an article is about (title + summary)
COUNTRIES = {
    "FR": r"\b(france|french|français\w*|française\w*|edf|rte|cre|hexagon\w*|paris)\b",
    "DE": r"\b(german\w*|allemagne|allemand\w*|deutsch\w*|berlin|bundes\w*|rwe|eon|e\.on|enbw|uniper)\b",
    "ES": r"\b(spain|spanish|espagne|espagnol\w*|iberdrola|endesa|madrid)\b",
    "BE": r"\b(belgi\w*|elia|engie belgium|bruxelles|brussels)\b",
    "UK": r"\b(uk|britain|british|england|royaume-uni|ofgem|national grid)\b",
    "IT": r"\b(ital\w*|enel)\b",
    "NL": r"\b(netherlands|dutch|pays-bas|néerlandais\w*|tennet)\b",
    "EU": r"\b(eu|europe\w*|européen\w*|brussels|bruxelles|acer|entso-e|commission)\b",
}
# how much a category moves prices or the renewable business; readers' votes add to it (data/news_prefs.json)
CAT_W = {"geopolitics": 3.0, "regulation": 2.0, "deal": 2.0, "build": 1.5, "gas": 1.5, "markets": 1.0, "carbon": 1.0, "power": 0.5}
PREFS = Path(__file__).resolve().parent.parent / "data" / "news_prefs.json"
STOP = set("the a an of to in on for and with at by from is are was were be as its it this that new over after into more than les des une un du de la le et en au aux pour par sur dans avec est sont qui que plus son ses leur".split())


def words(t):
    return [w for w in re.findall(r"[a-zà-ÿ0-9]+", (t or "").lower()) if len(w) > 3 and w not in STOP]


def learn_prefs(cfg_db):
    """readers' votes (public.news_vote) → weights of sources, categories and title words (no reader identity kept)"""
    if not cfg_db:
        return None
    try:
        import psycopg
        with psycopg.connect(cfg_db, connect_timeout=15) as conn, conn.cursor() as cur:
            cur.execute("select title, source, tags, vote from public.news_vote")
            rows = cur.fetchall()
    except Exception as e:
        print("  votes not read:", str(e)[:160])
        return None
    agg = {"sources": {}, "cats": {}, "words": {}}
    for title, source, tags, vote in rows:
        for key, vals in (("sources", [source or ""]), ("cats", list(tags or [])), ("words", set(words(title)))):
            for v in vals:
                a = agg[key].setdefault(v, [0, 0]); a[0] += vote; a[1] += 1
    prefs = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "votes": len(rows),
             "method": "weight = sum of votes ÷ (votes + 3), per source, category and title word (words seen in 2 votes or more, strongest 80)"}
    for key in ("sources", "cats"):
        prefs[key] = {k: round(a[0] / (a[1] + 3), 3) for k, a in agg[key].items() if k}
    wl = [(k, a[0] / (a[1] + 3)) for k, a in agg["words"].items() if a[1] >= 2]
    prefs["words"] = {k: round(w, 3) for k, w in sorted(wl, key=lambda x: -abs(x[1]))[:80]}
    PREFS.write_text(json.dumps(prefs, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(rows)} reader votes learnt")
    return prefs


def load_prefs():
    try:
        return json.loads(PREFS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def impact(rec, prefs):
    """market impact score of an article: its categories, plus what readers liked or not"""
    tags = rec["tags"]
    ws = sorted((CAT_W[t] for t in tags if t in CAT_W), reverse=True)
    s = (ws[0] + 0.5 * sum(ws[1:])) if ws else 0.0          # the strongest category, the others at half weight
    if not any(t in tags for t in ("power", "gas", "carbon", "markets", "geopolitics")):
        s -= 1.5                                   # off-topic for an energy market reader
    cs = rec.get("countries", [])
    s += 1.5 if "FR" in cs else 1.0 if any(c in cs for c in ("EU", "DE", "BE", "ES", "NL", "IT", "UK")) else (0 if "geopolitics" in tags else -1.0)   # the European market first
    s += 2.0 * prefs.get("sources", {}).get(rec["source"], 0)
    s += sum(prefs.get("cats", {}).get(t, 0) for t in tags)
    s += max(-3.0, min(3.0, sum(prefs.get("words", {}).get(w, 0) for w in set(words(rec["title"])))))
    return round(s, 2)


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


BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8"}


def read_feed(url, r):
    """A feed; when the address gives a web page instead: the feed the page announces (<link rel="alternate">),
    else one more try as a browser (some sites serve a bot check to automated readers)."""
    try:
        return parse_feed(r.content)
    except ET.ParseError:
        page = r.content.decode("utf-8", "ignore")
        if "<html" not in page[:2000].lower():
            raise
    m = re.search(r'<link[^>]+type="application/(?:rss|atom)\+xml"[^>]*>', page, re.I)
    href = re.search(r'href="([^"]+)"', m.group(0)) if m else None
    if href:
        r2 = requests.get(urljoin(url, html.unescape(href.group(1))), headers=UA, timeout=25)
        r2.raise_for_status()
        return parse_feed(r2.content)
    r3 = requests.get(url, headers=BROWSER_UA, timeout=25)
    r3.raise_for_status()
    try:
        return parse_feed(r3.content)
    except ET.ParseError:
        raise ValueError("the address gives a web page, not a feed (or a bot check for automated readers)")


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
        # general-interest feeds ("require": a regex on the title, in config): keep only the energy-market articles
        if src.get("require") and not re.search(src["require"], it["title"].lower()):
            continue
        tags = list(dict.fromkeys(src.get("tags", []) + [t for t, rx in KEYWORDS.items() if re.search(rx, blob)]))
        countries = [c for c, rx in COUNTRIES.items() if re.search(rx, blob)]
        if "fr" in src.get("tags", []) and "FR" not in countries:
            countries.insert(0, "FR")
        rec = {"source": it.get("domain") or src["name"], "cls": src.get("cls", "search"), "title": it["title"], "link": it["link"],
               "snippet": it["snippet"], "date": it["date"].isoformat(timespec="seconds"), "tags": tags, "countries": countries}
        if extra:
            rec.update(extra)
        out.append(rec)
        seen.add(it["link"]); seen.add(it["title"].lower())
        kept += 1
    return kept


def main():
    now = datetime.now(timezone.utc)
    cfg = load_config()
    prefs = learn_prefs(os.environ.get("SUPABASE_DB_URL")) or load_prefs()
    out, status = [], []
    for src in cfg.get("feeds", []) + cfg.get("pages", []):
        try:
            r = requests.get(src["url"], headers=UA, timeout=25)
            r.raise_for_status()
            items = READERS[src["reader"]](r.content) if src.get("reader") else read_feed(src["url"], r)
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
    for rec in out:
        rec["impact"] = impact(rec, prefs)
    out.sort(key=lambda i: i["date"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "items": out[:MAX_ITEMS], "sources": status},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT}: {min(len(out), MAX_ITEMS)} items")


if __name__ == "__main__":
    main()
