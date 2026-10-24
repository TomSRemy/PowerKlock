#!/usr/bin/env python3
"""Notes taken on the site (public.site_note, js/notes.js) ⇄ the repository, for Claude.

1. Applies Claude's replies from config/note_replies.json to the database:
   {"<note id>": {"status": "done" | "wontfix" | "open", "reply": "what was changed"}}
   A reply is written only when it differs, so the file can stay as it is.
2. Writes data/site_notes.json: the open notes and those closed in the last 60 days, with their
   page, tab, address, settings and element. Authors appear by first name only (public repository).

Env  SUPABASE_DB_URL (database). Without it the script says so and stops (exit 0).
"""
import datetime as dt
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "site_notes.json"
REPLIES = ROOT / "config" / "note_replies.json"
STATUSES = {"open", "done", "wontfix"}


def first_name(email):
    if not email:
        return None
    return email.split("@")[0].replace("_", ".").split(".")[0].capitalize() or None


def load_replies(path=REPLIES):
    """{id: {status, reply}} with the ids as ints; bad entries are skipped with a message."""
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for k, v in raw.items():
        if not str(k).isdigit() or not isinstance(v, dict):
            print(f"note_replies: entry {k!r} skipped (id must be a number, value an object)")
            continue
        st = v.get("status", "done")
        if st not in STATUSES:
            print(f"note_replies: entry {k}: unknown status {st!r}, skipped")
            continue
        out[int(k)] = {"status": st, "reply": (v.get("reply") or None)}
    return out


def export_rows(rows, now):
    """rows: dicts from the table → the file's content (open notes first, then recently closed)"""
    keep, cutoff = [], now - dt.timedelta(days=60)
    for r in rows:
        if r["status"] != "open" and r.get("done_at") and r["done_at"] < cutoff:
            continue
        keep.append({
            "id": r["id"], "status": r["status"], "created_at": r["created_at"].isoformat(timespec="minutes"),
            "author": first_name(r.get("author_email")), "route": r.get("route"), "page": r.get("page"),
            "tab": r.get("tab"), "target_id": r.get("target_id"), "target_label": r.get("target_label"),
            "settings": r.get("settings") or {}, "body": r["body"], "reply": r.get("reply"),
            "done_at": r["done_at"].isoformat(timespec="minutes") if r.get("done_at") else None,
        })
    keep.sort(key=lambda n: (n["status"] != "open", n["created_at"]))
    return {"open": sum(n["status"] == "open" for n in keep), "notes": keep}


def main():
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        print("SUPABASE_DB_URL is not set: notes not synced.")
        return 0
    import psycopg
    from psycopg.rows import dict_row
    replies = load_replies()
    with psycopg.connect(db, connect_timeout=20, row_factory=dict_row) as conn, conn.cursor() as cur:
        for nid, r in replies.items():
            cur.execute(
                "update public.site_note set status = %s, reply = %s,"
                " done_at = case when %s = 'open' then null else coalesce(done_at, now()) end"
                " where id = %s and (status is distinct from %s or reply is distinct from %s)",
                (r["status"], r["reply"], r["status"], nid, r["status"], r["reply"]))
            if cur.rowcount:
                print(f"note {nid}: {r['status']}")
        cur.execute("select * from public.site_note order by created_at")
        rows = cur.fetchall()
    data = export_rows(rows, dt.datetime.now(dt.timezone.utc))
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
        OUT.write_text(text, encoding="utf-8")
    print(f"{len(data['notes'])} notes written, {data['open']} open")
    return 0


if __name__ == "__main__":
    sys.exit(main())
