#!/usr/bin/env python3
"""The news watch's archive in the warehouse (news.article, warehouse migration 035).

Each hourly run of fetch_news.yml upserts the articles of data/news.json: title, outlet, date, link, subjects, theme
and the outlet's public summary (300 characters), never an article's text. --backfill takes back every version of
data/news.json in the git history (the workflow checks out the whole history for it), so the archive starts with
everything ever collected.

Env  SUPABASE_DB_URL (without it, nothing is written)
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, "data", "news.json")

UPSERT = """
insert into news.article (link, title, source, published, kind, tags, topics, theme, countries, summary, n_outlets, first_seen)
select x.link, x.title, x.source, x.published, x.kind, coalesce(x.tags, '{}'), coalesce(x.topics, '{}'), x.theme,
       coalesce(x.countries, '{}'), x.summary, coalesce(x.n_outlets, 1), coalesce(x.published, now())
from jsonb_to_recordset(%s::jsonb) as x(link text, title text, source text, published timestamptz, kind text, tags text[],
     topics text[], theme text, countries text[], summary text, n_outlets int)
on conflict (link) do update set title = excluded.title, tags = excluded.tags, topics = excluded.topics,
  theme = coalesce(excluded.theme, news.article.theme), countries = excluded.countries,
  summary = coalesce(excluded.summary, news.article.summary), n_outlets = greatest(excluded.n_outlets, news.article.n_outlets)
"""


def kind(tags):
    return "official" if "official" in tags else "research" if "research" in tags else "report" if "report" in tags else "article"


def rows(items):
    out = {}
    for i in items:
        if not isinstance(i, dict) or not i.get("link") or not i.get("title") or not str(i["link"]).startswith("http"):
            continue
        tags = i.get("tags") or []
        out[i["link"]] = {"link": i["link"][:2000], "title": i["title"][:500], "source": i.get("source"), "published": i.get("date"),
                          "kind": kind(tags), "tags": tags, "topics": i.get("topics") or [], "theme": i.get("theme"),
                          "countries": i.get("countries") or [], "summary": (i.get("snippet") or "")[:300] or None,
                          "n_outlets": 1 + len(i.get("other_sources") or [])}
    return out


def history():
    """every article of every version of data/news.json, oldest first (a later version refines its subjects)"""
    shas = subprocess.run(["git", "log", "--format=%H", "--", "data/news.json"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    seen = {}
    for h in reversed(shas):
        try:
            d = json.loads(subprocess.run(["git", "show", f"{h}:data/news.json"], cwd=ROOT, capture_output=True, text=True).stdout)
        except ValueError:
            continue
        for link, r in rows(d["items"] if isinstance(d, dict) else d).items():
            if link in seen and not r["summary"]:
                r["summary"] = seen[link]["summary"]
            seen[link] = r
    print(f"history: {len(shas)} versions, {len(seen)} articles")
    return seen


def main():
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        print("No database URL: archive skipped.")
        return 0
    recs = history() if "--backfill" in sys.argv else rows((json.load(open(FILE)) or {}).get("items") or [])
    import psycopg
    vals = list(recs.values())
    with psycopg.connect(db, connect_timeout=20, prepare_threshold=None) as conn, conn.cursor() as cur:
        cur.execute("select to_regclass('news.article') is not null")
        if not cur.fetchone()[0]:
            print("news.article does not exist yet (warehouse migration 035).")
            return 0
        for k in range(0, len(vals), 500):
            cur.execute(UPSERT, (json.dumps(vals[k:k + 500], ensure_ascii=False),))
        cur.execute("select count(*) from news.article")
        print(f"archive: {len(vals)} upserted, {cur.fetchone()[0]} in news.article")
    return 0


if __name__ == "__main__":
    sys.exit(main())
