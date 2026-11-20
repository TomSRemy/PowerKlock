"""
The morning newsletter, one edition per reading profile (config/news_profiles.json): regulatory, origination, market
expert, sales. Same facts for everyone, chosen and ordered for each reader:

  markets   France spot today and tomorrow, Cal+1 France, PEG, TTF, EUA, with their move (the repository's data files)
  stories   the 3 stories of the last 36 hours (84 on Monday) that matter most to this reader: categories weighted by the
            profile, its keywords, the number of outlets, freshness; one event once, one outlet once
            « Ce qui s'est passé » and « Pour vous » are written by the site's free AI proxy from the titles and extracts
            only; a story the model does not return keeps its extract and no « Pour vous »
  official  texts of the Journal officiel, EUR-Lex and the CRE of the last days
  cons      consultations closing within 14 days, or opened in the last 3
  pubs      RTE, EEX publications and published reports of the last days
  agenda    dated events of the next 14 days (data/events.json)
  post      the LinkedIn post the team voted most useful this week (public.news_post, public.news_vote)

Out  data/newsletter.json   read by the News page (tab Newsletter) and scripts/morning_mail.py
Run by .github/workflows/morning_mail.yml on weekdays; does nothing when today's edition exists.
    python scripts/news_letter.py [--force] [--no-ai]
"""
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from morning_mail import load as dload, spot   # noqa: E402
from news_digest import PARIS, PROXY, energy, focus, sid, similar, top_posts   # noqa: E402
import news_charts   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "newsletter.json")             # 7 O'Klock, every weekday at 7:00
OUT_WEEK = os.path.join(ROOT, "data", "newsletter_week.json")   # PowerBrunch, Monday at 10:00: the week before
PROFILES = os.path.join(ROOT, "config", "news_profiles.json")
MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"
MIN_SCORE = 3.0     # a story below this is off the reader's subjects (e.g. an offshore-wind contract for a lawyer)
EMPTY = re.compile(r"(?i)(aucune information|pas d.information|non (précisé|indiqué|disponible)|sans (détail|précision)s? supplémentaire)")

SYSTEM = """Tu écris la newsletter du matin de PowerKlock pour ce lecteur : {reader}.
Tu reçois les sujets du jour (id, titre, médias, extrait) et les textes officiels récents.

Réponds en JSON seulement :
{{"headline": "<la journée en une phrase de 35 mots au plus>", "headline_en": "<la même en anglais>",
  "items": [{{"id": "<id du sujet>", "what": "<ce qui s'est passé, 2 phrases, 45 mots au plus>", "what_en": "<anglais>",
             "for_you": "<pour ce lecteur, ce que cela change ou ce qu'il peut en faire, 1 phrase de 30 mots au plus>", "for_you_en": "<anglais>"}}]}}

Un élément par sujet reçu, dans l'ordre reçu. N'invente rien : seulement ce que disent les titres et extraits, et ce qui en
découle directement. Aucun chiffre absent des extraits. Ne cite pas de média. Si l'extrait ne permet pas de dire ce que cela
change pour ce lecteur, laisse "for_you" vide plutôt que d'inventer."""


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def age_h(i, now):
    try:
        return (now - datetime.fromisoformat(i["date"])).total_seconds() / 3600
    except (KeyError, TypeError, ValueError):
        return None


def kw_hits(i, prof):
    text = (i.get("title", "") + " " + (i.get("snippet") or "")).lower()
    return sum(1 for k in prof.get("keywords", []) if re.search(r"\b" + re.escape(k.lower()) + r"\b", text))


def score(i, prof, now):
    """how much a story matters to this reader: categories weighted by the profile (the strongest in full, the others at
    half), the profile's keywords, France first, more outlets, fresher"""
    tags = i.get("tags") or []
    ws = sorted((prof["weights"].get(t, 0) for t in tags), reverse=True)
    s = (ws[0] + 0.5 * sum(ws[1:])) if ws else 0.0
    if "official" in tags:
        s += prof.get("official", 1)
    s += 1.5 * min(2, kw_hits(i, prof))
    fr = "fr" in tags or "FR" in (i.get("countries") or [])
    s += prof.get("france", 1.0) if fr else -prof.get("foreign", 0.0)     # France first, as much as the profile asks
    s += 0.5 * math.log2(1 + len(i.get("other_sources") or []))
    s -= 0.3 * (age_h(i, now) or 0) / 24
    return s


def pick(items, prof, now, hours, n=3):
    cands = [i for i in items if (age_h(i, now) or 1e9) <= hours and "official" not in (i.get("tags") or []) and energy(i)]   # texts have their own section
    cands.sort(key=lambda i: -score(i, prof, now))
    out, seen_src = [], set()
    for i in cands:
        if score(i, prof, now) < MIN_SCORE:
            break                                       # nothing else that matters to this reader: fewer stories, not filler
        if prof.get("require_keyword") and not kw_hits(i, prof):
            continue
        if i["source"] in seen_src or any(similar(i["title"], o["title"]) for o in out):
            continue
        out.append(i)
        seen_src.add(i["source"])
        if len(out) == n:
            break
    return out


def ask(prof, stories, official, model=None):
    payload = {"sujets": [{"id": sid(i), "titre": i["title"], "medias": [i["source"]] + [o["source"] for o in i.get("other_sources") or []],
                           "extrait": (i.get("snippet") or "")[:320]} for i in stories],
               "textes_officiels": [o["title"] for o in official[:5]]}
    msg = {"max_tokens": 2000, "system": SYSTEM.format(reader=prof["reader"]),
           "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]}
    # a model of the proxy's list (Worker powerklock-ai). Qwen3 30B wrote the most useful « Pour vous » in a comparison
    # of the free models on the same stories (16 Nov. 2026); NEWS_MODEL overrides it
    msg["model"] = model or os.environ.get("NEWS_MODEL") or MODEL
    req = urllib.request.Request(PROXY, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json", "User-Agent": "PowerKlock-newsletter"})
    r = json.load(urllib.request.urlopen(req, timeout=150))
    parts = [b.get("text") for b in r.get("content", []) if b.get("type") == "text"]
    out = next((x for x in parts if isinstance(x, dict)), None)
    if out is None:
        m = re.search(r"\{.*\}", "".join(x for x in parts if isinstance(x, str)), re.S)
        if not m:
            raise ValueError("no JSON in the answer")
        out = json.loads(m.group(0))
    return out


def clip(s, n):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


def back(points, days):
    """the last point, and the one `days` before it (1: the previous session; 7: a week before)"""
    p = [x for x in points if x[1] is not None]
    if len(p) < 2:
        return None, None
    if days <= 1:
        return p[-1], p[-2]
    lim = (date.fromisoformat(str(p[-1][0])[:10]) - timedelta(days=days)).isoformat()
    old = [x for x in p if str(x[0])[:10] <= lim]
    return p[-1], (old[-1] if old else p[0])


def go_y1():
    """guarantees of origin, renewable, next calendar year: the latest weekly broker quote (data/go_prices.csv, the
    site's Markets › Guarantees of origin), mid of bid and ask, and the quote before it"""
    import csv
    try:
        with open(os.path.join(ROOT, "data", "go_prices.csv")) as f:
            rows = [r for r in csv.DictReader(f) if r.get("term", "").replace(" ", "") == "Y+1" and r.get("bid")]
    except OSError:
        return None
    rows.sort(key=lambda r: r["mail_date"])
    mid = lambda r: (float(r["bid"]) + float(r["ask"])) / 2 if r.get("ask") else float(r["bid"])  # noqa: E731
    if not rows:
        return None
    prev = [r for r in rows if r["mail_date"] < rows[-1]["mail_date"]]
    return mid(rows[-1]), (mid(prev[-1]) if prev else None), rows[-1]["year"]


MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def month_avg(first, last):
    """mean of the published daily averages (data/history/daily/<D>.json, FR avg) from first to last, the days present"""
    v, d = [], first
    while d <= last:
        a = (((dload("history", "daily", d.isoformat() + ".json") or {}).get("zones") or {}).get("FR") or {}).get("avg")
        if a is not None:
            v.append(a)
        d += timedelta(days=1)
    return sum(v) / len(v) if v else None


def markets(today, days=1):
    """the six price tiles, French first (chosen by the owner, 17 Nov. 2026): France spot today, peak minus base, hours at
    0 € or below tomorrow (published at about 13:00, before that PowerKlock's forecast), Cal+1 France, PEG,
    guarantees of origin for next year. Change on the day before (the spot), on the previous session (Cal, PEG), on the
    previous quote (GO). PowerBrunch: France spot of the month so far (against last month), Cal+1 France, solar and wind
    PPA benchmarks (over the week), the CRE's latest solar M0 (against the month before), guarantees of origin."""
    rows = []

    def row(fr, en, value, unit, ref=None, src="", page="markets/spot", show="pct"):
        # show: pct = change in %; abs = change in the unit (a spread); h = change in hours (more hours at 0 € or below
        # is lower prices, shown green like a fall)
        rows.append({"label": [fr, en], "value": round(value, 1 if show == "h" else 2), "unit": unit, "page": page, "src": src,
                     "show": show, "hours": show == "h", "chg": None if ref is None else round(value - ref, 2),
                     "pct": None if (not ref or show != "pct") else round((value / ref - 1) * 100, 1)})
    sp = {k: spot(today - timedelta(days=k)) for k in range(-1, 14)}   # -1 = tomorrow
    if days > 1:
        # PowerBrunch (chosen by the owner, 17 Nov. 2026): spot of the month so far, Cal+1, solar and wind PPAs, the
        # CRE's latest solar M0, guarantees of origin
        cur = month_avg(today.replace(day=1), today)
        prev_end = today.replace(day=1) - timedelta(days=1)
        prv = month_avg(prev_end.replace(day=1), prev_end)
        if cur:
            row(f"Spot France, moyenne {MOIS[today.month - 1]}", f"France spot, {today:%B} average", cur, "€/MWh", prv, "ENTSO-E", "markets/spot/overview")
    else:
        t, y, tm = sp.get(0), sp.get(1), sp.get(-1)
        fc = ((dload("neg_forecast.json") or {}).get("days") or {}).get((today + timedelta(days=1)).isoformat()) or {}
        if t:
            row("Spot France aujourd'hui", "France spot today", t["base"], "€/MWh", y["base"] if y else None, "ENTSO-E")
        if t:
            row("Pointe − base aujourd'hui", "Peak − base today", t["peak"] - t["base"], "€/MWh", (y["peak"] - y["base"]) if y else None, "ENTSO-E", show="abs")
        if tm:
            row("Heures ≤ 0 € demain", "Hours ≤ 0 € tomorrow", tm["neg"], "h", t["neg"] if t else None, "ENTSO-E", "markets/spot/negative", show="h")
        elif fc.get("expected_hours") is not None:
            row("Heures ≤ 0 € demain (prévision)", "Hours ≤ 0 € tomorrow (forecast)", fc["expected_hours"], "h", t["neg"] if t else None, "PowerKlock", "markets/spot/negative", show="h")
        elif t:
            row("Heures ≤ 0 € aujourd'hui", "Hours ≤ 0 € today", t["neg"], "h", y["neg"] if y else None, "ENTSO-E", "markets/spot/negative", show="h")
    ch = dload("history", "fr_market_calchain.json") or {}
    y1 = str(today.year + 1)
    cy = ((ch.get("FR") or {}).get("years") or {}).get(y1)
    if cy:
        a, b = back(list(zip(cy["dates"], cy["values"])), days)
        if a:
            row(f"Cal {y1[2:]} France", f"Cal {y1[2:]} France", a[1], "€/MWh", b[1], "EEX", "markets/forwards")
    cs = (dload("history", "commodities_series.json") or {}).get("series") or (dload("commodities.json") or {}).get("series") or {}
    if "peg" in cs:
        a, b = back(cs["peg"]["points"], days)
        if a:
            row("Gaz PEG", "PEG gas", a[1], "€/MWh", b[1], "SEFE", "markets/fuels")
    if days > 1:
        # one tile per technology: the PPA benchmark (change over the week)
        bm = (dload("history", "ppa_benchmark.json") or {}).get("days") or {}
        # under it, the forecast M0 of next month (PowerKlock: the CRE's method on the month's forward, data/cre_m0.json)
        fc = next((x for x in ((dload("cre_m0.json") or {}).get("forecast") or []) if x.get("month", "") > today.strftime("%Y-%m")), None)
        for tech, fr, en in (("solar", "Solaire", "Solar"), ("wind", "Éolien", "Wind")):
            a, b = back([(d, (bm[d].get(tech) or {}).get("ppa")) for d in sorted(bm)], 7)
            if not a:
                continue
            row(f"{fr} · PPA France", f"{en} · France PPA", a[1], "€/MWh", b[1], "PowerKlock", "tools/ppa")
            if fc and fc.get(tech) is not None:
                mo = fc["month"]
                rows[-1]["sub"] = [f"M0 prévu {MOIS[int(mo[5:]) - 1]} : {fc[tech]:.2f} €".replace(".", ","), f"Forecast M0 {mo}: €{fc[tech]:.2f}"]
    go = go_y1()
    if go:
        row("Garanties d'origine " + go[2], "Guarantees of origin " + go[2], go[0], "€/MWh", go[1], "Commerg", "markets/go")
    return rows


def pinned(now):
    """the story the admin put at the top in the last 36 hours (public.news_pin, warehouse migration 027), or None"""
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        return None
    try:
        import psycopg
        with psycopg.connect(db, connect_timeout=15, prepare_threshold=None) as conn, conn.cursor() as cur:
            cur.execute("select link from public.news_pin where pinned_at >= %s order by pinned_at desc limit 1", (now - timedelta(hours=36),))
            r = cur.fetchone()
            return r[0] if r else None
    except Exception as e:      # the newsletter must not depend on the database
        print("  pin not read:", str(e)[:160])
        return None


def figure_of_day(today):
    """the figure of the day: the spot's move on the day before when it is large (15 % or more), with how long since a
    larger one; else the hours at 0 € or below of the day; else none"""
    t, y = news_charts.day_avg(today), news_charts.day_avg(today - timedelta(days=1))
    if t is not None and y:
        pct = (t / y - 1) * 100
        if abs(pct) >= 15:
            k, since = 2, None
            while k <= 365:
                a, b = news_charts.day_avg(today - timedelta(days=k - 1)), news_charts.day_avg(today - timedelta(days=k))
                if a is not None and b and abs(a / b - 1) * 100 >= abs(pct) and (a / b - 1) * pct > 0:
                    since = k - 1
                    break
                k += 1
            word = "baisse" if pct < 0 else "hausse"
            when = (f"la plus forte {word} depuis {since} jours" if since and since > 7 else f"la plus forte {word} de la semaine" if since else f"la plus forte {word} depuis un an")
            when_en = (f"the largest {'fall' if pct < 0 else 'rise'} in {since} days" if since and since > 7 else f"the largest {'fall' if pct < 0 else 'rise'} of the week" if since else f"the largest {'fall' if pct < 0 else 'rise'} in a year")
            v = f"{'−' if pct < 0 else '+'}{abs(pct):.0f} %"
            return {"value": v, "dir": "dn" if pct < 0 else "up",
                    "text": f"Le spot France passe de {y:.0f} € à {t:.0f} € le MWh en 24 h : {when}.",
                    "text_en": f"France spot moves from €{y:.0f} to €{t:.0f} per MWh in 24 h: {when_en}.", "src": "ENTSO-E", "page": "markets/spot"}
    n = news_charts.day_neg(today)
    if n:
        return {"value": f"{n:.0f} h", "dir": "dn", "text": f"{n:.0f} heures à 0 € ou moins aujourd'hui en France.", "text_en": f"{n:.0f} hours at €0 or below today in France.",
                "src": "ENTSO-E", "page": "markets/spot/negative"}
    return None


def weather(today):
    """the market's weather, from the spot's move on the day before: clearing (prices down 10 % or more), storm (up 20 %
    or more), cloudy otherwise"""
    t, y = news_charts.day_avg(today), news_charts.day_avg(today - timedelta(days=1))
    if t is None or not y:
        return None
    pct = (t / y - 1) * 100
    if pct <= -10:
        return {"kind": "sun", "label": ["Éclaircie", "Clearing"], "sub": ["prix en baisse", "prices down"]}
    if pct >= 20:
        return {"kind": "storm", "label": ["Orage", "Storm"], "sub": ["prix en forte hausse", "prices up sharply"]}
    return {"kind": "cloud", "label": ["Nuageux", "Cloudy"], "sub": ["prix stables" if abs(pct) < 5 else "prix en hausse" if pct > 0 else "prix en baisse", "prices steady" if abs(pct) < 5 else "prices up" if pct > 0 else "prices down"]}


def prune_images(keep_days=21):
    """the images of past editions are kept three weeks (the site shows the latest edition only)"""
    lim = (date.today() - timedelta(days=keep_days)).isoformat()
    try:
        for f in os.listdir(news_charts.IMG):
            if f[:10] < lim:
                os.remove(os.path.join(news_charts.IMG, f))
    except OSError:
        pass


def main():
    force, use_ai, weekly = "--force" in sys.argv, "--no-ai" not in sys.argv, "--weekly" in sys.argv
    out_path = OUT_WEEK if weekly else OUT
    now = datetime.now(timezone.utc)
    today = now.astimezone(PARIS).date()
    old = load(out_path, {}) or {}
    if (today.weekday() >= 5 or (weekly and today.weekday() != 0)) and not force:
        print("no edition today")
        return 0
    if old.get("date") == today.isoformat() and not force:
        print("today's edition exists")
        return 0
    profiles = (load(PROFILES, {}) or {}).get("profiles") or {}
    items = (load(os.path.join(ROOT, "data", "news.json"), {}) or {}).get("items") or []
    cons = (load(os.path.join(ROOT, "data", "consultations.json"), {}) or {}).get("items") or []
    events = (load(os.path.join(ROOT, "data", "events.json"), {}) or {}).get("items") or []
    monday = today.weekday() == 0
    # 7 O'Klock: the last 36 hours (84 on Monday); PowerBrunch: the week before, larger
    hours = 7 * 24 + 12 if weekly else 84 if monday else 36
    days = 7 if weekly else 4 if monday else 2
    ahead = 21 if weekly else 14
    iso = lambda d: d.isoformat()   # noqa: E731
    recent = [i for i in items if (age_h(i, now) or 1e9) <= days * 24 + 12]
    official = sorted([i for i in recent if "official" in (i.get("tags") or [])], key=lambda i: i["date"], reverse=True)[:12 if weekly else 6]
    pubs = sorted([i for i in recent if "official" not in (i.get("tags") or []) and ("report" in (i.get("tags") or []) or re.match(r"^(RTE|EEX)\b", i.get("source", "")))],
                  key=lambda i: i["date"], reverse=True)[:10 if weekly else 5]
    t = iso(today)
    c_soon = [c for c in cons if c.get("deadline") and t <= c["deadline"] <= iso(today + timedelta(days=ahead))]
    c_new = [c for c in cons if c.get("opened") and c["opened"] >= iso(today - timedelta(days=days)) and (not c.get("deadline") or c["deadline"] >= t)]
    cs = sorted({c["link"]: c for c in c_soon + c_new}.values(), key=lambda c: c.get("deadline") or "9999")[:10 if weekly else 6]
    agenda = sorted([{"date": e["date"], "title": e.get("title"), "text": e.get("text"), "kind": e.get("kind")} for e in events
                     if t <= (e.get("date") or "") <= iso(today + timedelta(days=ahead))], key=lambda e: e["date"])[:8 if weekly else 5]
    posts = top_posts(now - timedelta(days=7))
    # the day's essentials (scripts/news_digest.py, run just before): today's, or on Monday the week before
    dg = load(os.path.join(ROOT, "data", "news_digest.json"), {}) or {}
    week = iso(today - timedelta(days=today.weekday()))
    de = (dg.get("weekly") if (dg.get("weekly") or {}).get("week") == week else None) if weekly else dg.get("daily") if (dg.get("daily") or {}).get("date") == t else None
    digest = {"weekly": de is dg.get("weekly"), "items": [{k: x.get(k) for k in ("text", "text_en", "title", "link", "sources")} for x in (de or {}).get("items") or []]} if de else None
    # the main articles: the highest impact of the last 24 hours (72 on Monday), one per outlet, one per event
    top, srcs = [], set()
    for i in sorted([i for i in items if (age_h(i, now) or 1e9) <= (7 * 24 if weekly else 72 if monday else 24) and "official" not in (i.get("tags") or []) and energy(i)],
                    key=lambda i: -((i.get("impact") or 0) + focus(i))):
        if i["source"] in srcs or any(similar(i["title"], o["title"]) for o in top):
            continue
        top.append(i)
        srcs.add(i["source"])
        if len(top) == (12 if weekly else 6):
            break
    edition = {"date": t, "updated": now.isoformat(timespec="seconds"), "engine": "proxy" if use_ai else "none", "monday": monday,
               "weekly": weekly, "markets": markets(today, 7 if weekly else 1),
               "official": [{"title": i["title"], "link": i["link"], "source": i["source"], "date": i["date"], "tags": i.get("tags") or []} for i in official],
               "pubs": [{"title": i["title"], "link": i["link"], "source": i["source"], "date": i["date"], "tags": i.get("tags") or []} for i in pubs],
               "cons": [{k: c.get(k) for k in ("title", "link", "source", "deadline", "opened", "theme")} for c in cs],
               "agenda": agenda, "post": posts[0] if posts else None, "posts": posts if weekly else [], "digest": digest,
               "top": [{"title": i["title"], "link": i["link"], "source": i["source"], "date": i["date"], "n": 1 + len(i.get("other_sources") or []), "tags": i.get("tags") or []} for i in top],
               "profiles": {}}
    edition["figure"] = None if weekly else figure_of_day(today)
    edition["weather"] = weather(today)
    soon = sorted([{"date": c["deadline"], "kind": "cons", "title": c["title"], "link": c["link"], "source": c.get("source")} for c in cons
                   if c.get("deadline") and t <= c["deadline"] <= iso(today + timedelta(days=7 if not weekly else 14))]
                  + [{"date": e["date"], "kind": "event", "title": (e.get("title") or [""])[0], "title_en": (e.get("title") or ["", ""])[-1], "link": None, "source": None}
                     for e in events if t <= (e.get("date") or "") <= iso(today + timedelta(days=14 if not weekly else 21))], key=lambda x: x["date"])[:6]
    edition["week_ahead"] = soon
    prune_images()
    if weekly:
        # « Ce jour-là »: the spot the same day in past years (published daily averages)
        past = []
        for k in range(1, 6):
            try:
                d0 = today.replace(year=today.year - k)
            except ValueError:
                continue
            v = news_charts.day_avg(d0)
            if v is not None:
                past.append({"year": d0.year, "value": round(v, 2)})
        edition["on_this_day"] = {"today": news_charts.day_avg(today), "past": past} if past else None
        w, marks = news_charts.week_chart(today, os.path.join(news_charts.IMG, f"{t}_week.png"))
        edition["week_chart"] = dict(w, img=f"newsletter_img/{t}_week.png", path=None, marks=marks) if w else None
    charts = {}
    pin_link = pinned(now)
    pin = next((i for i in items if i.get("link") == pin_link), None) if pin_link else None
    edition["pinned"] = pin_link if pin else None
    for pid, prof in profiles.items():
        stories = pick(items, prof, now, hours, 5 if weekly else 3)
        if pin:     # the admin's pinned story leads every profile's edition
            stories = [pin] + [i for i in stories if i.get("link") != pin["link"]][:len(stories) - 1 if stories else 0]
        gen = {}
        if use_ai and stories:
            for attempt in (1, 2):      # the free model sometimes answers without JSON: once more
                try:
                    # the second try on the proxy's default model (Llama 3.3 70B), when Qwen3 is down or answers badly
                    gen = ask(prof, stories, official, None if attempt == 1 else "@cf/meta/llama-3.3-70b-instruct-fp8-fast")
                    break
                except Exception as e:  # the edition still goes out, with the extracts
                    print(f"{pid}: AI text not written, attempt {attempt} ({str(e)[:160]})")
        by = {str(x.get("id")): x for x in (gen.get("items") or []) if isinstance(x, dict)}
        out = []
        for i in stories:
            g = by.get(sid(i), {})
            what = g.get("what") or i.get("snippet")
            if what and similar(what, i["title"]) and i.get("snippet") and not similar(i["snippet"], i["title"]):
                what = i["snippet"]                     # the model only repeated the title: the outlet's own extract says more
            if what and EMPTY.search(what):
                what = None                             # the model saying it has nothing to say
            if what and similar(what, i["title"]):
                what = None                             # nothing beyond the title (press searches give titles only)
            out.append({"id": sid(i), "title": i["title"], "link": i["link"], "tags": (i.get("tags") or []) + (["fr"] if "FR" in (i.get("countries") or []) and "fr" not in (i.get("tags") or []) else []),
                        "sources": [i["source"]] + [o["source"] for o in i.get("other_sources") or []],
                        "what": clip(what, 360) or None, "what_en": (clip(g.get("what_en"), 360) or None) if what and what == g.get("what") else None,
                        "for_you": (clip(g.get("for_you"), 260) or None) if not EMPTY.search(g.get("for_you") or "") else None, "for_you_en": clip(g.get("for_you_en"), 260) or None})
        # the lead story's chart, chosen by its own words; one image per chart shared by the profiles
        hero = None
        if out:
            spec = news_charts.pick(out[0]["title"] + " " + (out[0].get("what") or "") + " " + " ".join(i.get("snippet") or "" for i in stories[:1]), today)
            if spec:
                key = re.sub(r"[^a-z0-9]+", "-", spec["title"].lower())[:40]
                if key not in charts:
                    news_charts.draw(spec, os.path.join(news_charts.IMG, f"{t}_{key}.png"))
                    charts[key] = {"img": f"newsletter_img/{t}_{key}.png", "title": spec["title"], "src": spec["src"], "page": spec["page"]}
                hero = charts[key]
        edition["profiles"][pid] = {"hero_chart": hero, "name": prof["name"], "short": prof["short"], "order": prof["order"], "headline": clip(gen.get("headline"), 300) or None, "headline_en": clip(gen.get("headline_en"), 300) or None,
                                    "stories": out, "ai": bool(by)}
        print(f"{pid}: {len(out)} stories, AI text for {len(by)}")
    with open(out_path, "w") as f:
        json.dump(edition, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
