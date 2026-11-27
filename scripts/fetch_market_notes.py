#!/usr/bin/env python3
"""Market notes received by e-mail → public.market_note (Supabase), for signed-in users only.

ENGIE "Energy Market News" (engie@e-news.engie.be): each note has a date, a subject and sections
(Global context, Oil, Gas, Electricity, CO2…), each with a headline and a few points. The note is read
from the team mailbox over IMAP, with the same app password as the GO prices (scripts/fetch_go_prices.py),
parsed into sections and upserted.
Opéra Énergie « Notes d'analyse » (weekly, free on opera-energie.com): the note's page is found in the media sitemap
(robots.txt allows it), its PDF is read (pdfplumber) and cut into the same sections (Contexte, électricité, gaz,
carbone, pétrole). Third-party text: it stays in the database, readable by signed-in
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
# PowerKlock's daily commentaries come from its public cockpit with the forwards (scripts/fetch_fr_market.py keeps only their tone score, marketInsightsTone)
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
        crit = f'(FROM "{src["from"]}" SUBJECT "{src["subject"]}")' if src["subject"] else f'(FROM "{src["from"]}")'
        st, data = imap.search(None, crit)
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


# ── Opéra Énergie: the weekly note's PDF, cut into sections ──
OPERA_SECTION = re.compile(r"^(Contexte|March[ée] d[eu] (?:l[’']|la |du )?\s*(?:[ée]lectricit[ée]|gaz|carbone|p[ée]trole|CO2|CO₂))\s*$", re.I)
# chart labels, captions and figures of the right-hand column, cut from the text
OPERA_NOISE = re.compile(r"-LAC$|^[)(]|^(Évolution|Evolution) des prix|^CAL Y\+|^Attention|^Contact|^Période du|^\(Sources|^XEE|^secruoS|^erbm|^\(évolution", re.I)
OPERA_TAIL = re.compile(r"\s*(?:[-+]?\d[\d\s]*,\d+\s*(?:%|€/MWh|€/t)?|CAL-\d+|€/t|€/MWh|\$/baril)\s*$")
MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def opera_parse(text):
    """[{name, headline, points}] from the PDF's text: a section label, a headline (its first line and the lines that
    continue it in lower case), then the commentary up to the first chart label"""
    out, cur, body, state = [], None, [], None
    def close():
        if cur:
            t = re.sub(r"\s+", " ", " ".join(body)).strip()
            cur["points"] = [x.strip()[:600] for x in re.split(r"(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý«])", t) if len(x.strip()) > 25][:6]
            if cur["headline"] or cur["points"]:
                out.append(cur)
    for raw in text.split("\n"):
        ln = raw.strip()
        while True:
            n = OPERA_TAIL.sub("", ln).strip()
            if n == ln:
                break
            ln = n
        if not ln:
            continue
        m = OPERA_SECTION.match(ln)
        if m:
            close()
            cur, body, state = {"name": m.group(1)[0].upper() + m.group(1)[1:], "headline": "", "points": []}, [], "head"
            continue
        if not cur or state == "done" or OPERA_NOISE.search(ln):
            if cur and state == "body" and OPERA_NOISE.search(ln):
                state = "done"
            continue
        if state == "head":
            if not cur["headline"] or ln[0].islower():
                cur["headline"] = (cur["headline"] + " " + ln).strip()
                continue
            state = "body"
        body.append(ln)
    close()
    return out


def from_opera(days=21):
    import requests
    import pdfplumber
    import io
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch_news import opera_notes, BROWSER_UA
    notes = []
    for mod, loc in opera_notes(days):  # read again each run: a note corrected later replaces the stored one
        try:
            page = requests.get(loc, headers=BROWSER_UA, timeout=30).text
            title = html.unescape((re.search(r'og:title" content="([^"]+)"', page) or [None, ""])[1]).split(" - Opéra")[0].strip()
            pdf = (re.search(r'href="(https://opera-energie\.com/wp-content/uploads/(\d{4})/\d{2}/[^"]+?(\d{2})(\d{2})\.pdf)"', page))
            if not pdf:
                print("no PDF on", loc); continue
            day = f"{pdf.group(2)}-{pdf.group(4)}-{pdf.group(3)}"   # OE_NA_A4_2311.pdf in uploads/2026/11 → 2026-11-23
            with pdfplumber.open(io.BytesIO(requests.get(pdf.group(1), headers=BROWSER_UA, timeout=60).content)) as d:
                text = "\n".join(p.extract_text() or "" for p in d.pages)
            notes.append({"source": "Opéra Énergie Notes d’analyse", "note_date": day, "subject": title or "Notes d’analyse", "received_at": mod, "sections": opera_parse(text)})
        except Exception as e:
            print("Opéra note failed:", loc, str(e)[:120])
    return notes


def main():
    if os.environ.get("NOTES_FILE"):
        raw = open(os.environ["NOTES_FILE"], "rb").read()
        lines = body_of(email_lib.message_from_bytes(raw)) if raw[:200].lower().find(b"content-type") >= 0 else html_to_lines(raw.decode("utf-8", "replace"))
        notes = [{"source": SOURCES[0]["name"], "note_date": "test", "subject": "test", "received_at": None, "sections": parse(lines, "test")}]
    else:
        notes = from_imap() if not os.environ.get("NOTES_WEB_ONLY") else []
        try:
            notes += from_opera()
        except Exception as e:
            print("Opéra notes failed:", str(e)[:160])
        notes.sort(key=lambda n: n["note_date"])
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
          "notes": [{"source": n["source"], "date": n["note_date"], "sections": [x["name"] for x in n["sections"]]} for n in notes if n["sections"]][-16:],
          "unparsed": {name: sum(1 for n in notes if n["source"] == name and not n["sections"]) for name in [x["name"] for x in SOURCES] + ["Opéra Énergie Notes d’analyse"]}}
    open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "market_notes_status.json"), "w").write(json.dumps(st, ensure_ascii=False))
    print("written")
    # the week's context in French, centred on France, written from these notes (own words, no source named)
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import market_digest
        market_digest.run([n for n in notes if n["sections"]])
    except Exception as e:
        print("digest failed:", e)


if __name__ == "__main__":
    main()
