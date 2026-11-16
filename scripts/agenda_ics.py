"""
The PowerKlock calendar as a subscribable .ics file (Outlook, Google Calendar, Apple Calendar):

  - each open consultation's deadline to reply (data/consultations.json: CRE, RTE, ministry), all-day, with its link
  - the dated events of data/events.json from 30 days ago onwards (regulation, market, grid…), all-day, with their source

Out  data/agenda.ics, served at https://powerklock.com/data/agenda.ics. A calendar subscribed to this address refreshes
by itself (every few hours in Google, Outlook). Run after scripts/fetch_news.py (.github/workflows/fetch_news.yml).
    python scripts/agenda_ics.py
"""
import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "agenda.ics")
SITE = "https://powerklock.com/"


def load(name):
    try:
        with open(os.path.join(ROOT, "data", name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def esc(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def fold(line):
    """RFC 5545: lines of 75 octets at most, continued with a space"""
    b, out = line.encode(), []
    while len(b) > 75:
        k = 75
        while (b[k] & 0xC0) == 0x80:     # never cut inside a UTF-8 character
            k -= 1
        out.append(b[:k].decode())
        b = b" " + b[k:]
    out.append(b.decode())
    return "\r\n".join(out)


def event(uid, day, summary, desc, url, stamp):
    d = date.fromisoformat(day)
    return ["BEGIN:VEVENT", f"UID:{uid}@powerklock.com", f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{d:%Y%m%d}",
            f"DTEND;VALUE=DATE:{d + timedelta(days=1):%Y%m%d}", f"SUMMARY:{esc(summary)}", f"DESCRIPTION:{esc(desc)}",
            *([f"URL:{url}"] if url else []), "TRANSP:TRANSPARENT", "END:VEVENT"]


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    since = (date.today() - timedelta(days=30)).isoformat()
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PowerKlock//Agenda//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:PowerKlock · énergie", "X-WR-TIMEZONE:Europe/Paris", "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
             "X-PUBLISHED-TTL:PT6H"]
    n = 0
    for c in (load("consultations.json").get("items") or []):
        if not c.get("deadline") or c["deadline"] < since:
            continue
        uid = "cons-" + hashlib.sha1(c["link"].encode()).hexdigest()[:16]
        lines += event(uid, c["deadline"], f"Fin de consultation · {c.get('source', '')} · {c['title'][:120]}",
                       f"{c['title']}\nDate limite de réponse. Source : {c.get('source', '')}\n{c['link']}", c["link"], stamp)
        n += 1
    for e in (load("events.json").get("items") or []):
        day = e.get("date") or ""
        if len(day) != 10 or day < since:
            continue
        title = (e.get("title") or [""])[0]
        text = (e.get("text") or [""])[0]
        src = e.get("source") or ["", ""]
        url = src[1] if len(src) > 1 and str(src[1]).startswith("http") else None
        lines += event("ev-" + str(e.get("id") or hashlib.sha1(title.encode()).hexdigest()[:12]), day, title,
                       f"{text}\nSource : {src[0]}" + (f"\n{url}" if url else "") + f"\n{SITE}#intel/regulation", url, stamp)
        n += 1
    lines.append("END:VCALENDAR")
    with open(OUT, "w", newline="") as f:
        f.write("\r\n".join(fold(x) for x in lines) + "\r\n")
    print(f"agenda.ics: {n} events")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
