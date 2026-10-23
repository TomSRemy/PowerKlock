#!/usr/bin/env python3
"""Market notes received by e-mail → public.market_note (Supabase), for signed-in users only.

ENGIE "Energy Market News" (engie@e-news.engie.be): each note has a date, a subject and sections
(Global context, Oil, Gas, Electricity, CO2…), each with a headline and a few points. The note is read
from the team mailbox over IMAP, with the same app password as the GO prices (scripts/fetch_go_prices.py),
parsed into sections and upserted. Third-party text: it stays in the database, readable by signed-in
users, never in the public repository.

Env  GO_GMAIL_USER, GO_GMAIL_APP_PASSWORD (IMAP), SUPABASE_DB_URL (database)
     NOTES_DRY_RUN=1 prints instead of writing; NOTES_FILE=path parses a saved .eml/.html instead of IMAP
"""
import email as email_lib
import html
import imaplib
import json
import os
import re
import sys
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime

SOURCES = [{"name": "ENGIE Energy Market News", "from": "e-news.engie.be", "subject": "Energy Market News"}]
SECTIONS = ["Global context", "Oil", "Gas", "Electricity", "Power", "CO2", "CO₂", "Carbon", "Coal", "Renewables"]
END = re.compile(r"^(Follow the evolution|Do you find this e-mail|Register your colleagues|©)", re.I)


def html_to_lines(h):
    h = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h\d|td|table)>", "\n", h)
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    lines = [re.sub(r"\s+", " ", html.unescape(x)).strip() for x in h.split("\n")]
    return [x for x in lines if x and x not in ("‌", "\xa0")]


def parse(lines, subject):
    """sections: [{name, headline, points[]}]; the summary list at the top is skipped (it repeats the headlines)"""
    out, cur, seen = [], None, set()
    for i, ln in enumerate(lines):
        if out and END.search(ln):
            break
        name = next((s for s in SECTIONS if ln.strip().lower() == s.lower()), None)
        if name and i + 1 < len(lines):
            nxt = lines[i + 1]
            # a section block = its name, then its headline, then points; in the summary the next line is another name
            if not any(nxt.lower().startswith(s.lower()) for s in SECTIONS) or nxt.lower() == name.lower():
                key = name.lower()
                if key in seen and cur and cur["name"].lower() == key:
                    continue
                cur = {"name": "CO₂" if name in ("CO2", "CO₂", "Carbon") else name, "headline": nxt if nxt.lower() != name.lower() else "", "points": []}
                out.append(cur); seen.add(key)
                continue
        if cur is not None:
            pt = re.sub(r"^(V|•|-|•)\s+", "", ln).strip()
            if pt and pt != cur["headline"] and pt.lower() != cur["name"].lower() and len(pt) > 25:
                cur["points"].append(pt[:600])
    for s in out:
        s["points"] = s["points"][:6]
    return [s for s in out if s["headline"] or s["points"]]


def body_of(msg):
    if msg.is_multipart():
        parts = [p for p in msg.walk() if p.get_content_type() in ("text/html", "text/plain") and not p.get_filename()]
        parts.sort(key=lambda p: p.get_content_type() != "text/html")
        msg = parts[0] if parts else msg
    payload = msg.get_payload(decode=True) or b""
    text = payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
    return html_to_lines(text) if "<" in text else [x.strip() for x in text.splitlines() if x.strip()]


def from_imap():
    user, pw = os.environ.get("GO_GMAIL_USER"), os.environ.get("GO_GMAIL_APP_PASSWORD")
    if not user or not pw:
        sys.exit("GO_GMAIL_USER / GO_GMAIL_APP_PASSWORD missing")
    imap = imaplib.IMAP4_SSL("imap.gmail.com"); imap.login(user, pw); imap.select("INBOX", readonly=True)
    notes = []
    for src in SOURCES:
        st, data = imap.search(None, f'(FROM "{src["from"]}" SUBJECT "{src["subject"]}")')
        ids = data[0].split()[-15:] if st == "OK" and data and data[0] else []
        for mid in ids:
            st, d = imap.fetch(mid, "(RFC822)")
            if st != "OK":
                continue
            msg = email_lib.message_from_bytes(d[0][1])
            subject = str(make_header(decode_header(msg.get("Subject", ""))))
            when = parsedate_to_datetime(msg.get("Date"))
            m = re.search(r"(\d{2})/(\d{2})/(\d{4})", subject)
            ndate = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else when.date().isoformat()
            notes.append({"source": src["name"], "note_date": ndate, "subject": subject, "received_at": when.isoformat(), "sections": parse(body_of(msg), subject)})
    imap.logout()
    return notes


def main():
    if os.environ.get("NOTES_FILE"):
        raw = open(os.environ["NOTES_FILE"], "rb").read()
        lines = body_of(email_lib.message_from_bytes(raw)) if raw[:200].lower().find(b"content-type") >= 0 else html_to_lines(raw.decode("utf-8", "replace"))
        notes = [{"source": SOURCES[0]["name"], "note_date": "test", "subject": "test", "received_at": None, "sections": parse(lines, "test")}]
    else:
        notes = from_imap()
    print(f"{len(notes)} notes:", [(n["note_date"], len(n["sections"])) for n in notes])
    if os.environ.get("NOTES_DRY_RUN") or os.environ.get("NOTES_FILE"):
        print(json.dumps(notes[-1:], ensure_ascii=False, indent=1)[:3000]); return
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        sys.exit("SUPABASE_DB_URL missing")
    import psycopg
    with psycopg.connect(db, connect_timeout=20) as conn, conn.cursor() as cur:
        for n in notes:
            if not n["sections"]:
                continue
            cur.execute("""insert into public.market_note (source, note_date, subject, sections, received_at) values (%s, %s, %s, %s, %s)
                           on conflict (source, note_date, subject) do update set sections = excluded.sections""",
                        (n["source"], n["note_date"], n["subject"], json.dumps(n["sections"], ensure_ascii=False), n["received_at"]))
        conn.commit()
    # a public trace without any of the notes' text: dates and section counts, to check the run
    st = {"updated": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds"),
          "notes": [{"source": n["source"], "date": n["note_date"], "sections": [x["name"] for x in n["sections"]]} for n in notes[-10:]]}
    open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "market_notes_status.json"), "w").write(json.dumps(st, ensure_ascii=False))
    print("written")


if __name__ == "__main__":
    main()
