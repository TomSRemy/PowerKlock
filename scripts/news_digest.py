"""
The News digest: on weekdays "L'essentiel du jour" (4 to 5 lines from the stories of the last 36 hours), and on Monday
"La semaine en 5 sujets" (the week before) with the posts the team voted most useful.

The stories come from data/news.json (scripts/fetch_news.py: grouped by event, with their outlets). The site's AI proxy
(the same one as scripts/market_digest.py, a free Workers AI model) rewrites each chosen story in one sentence; every
line keeps the id of its story, so the page and the e-mail link it to its sources and nothing can be added that is not
in the collected articles. Lines whose id is not a story given to the model are dropped.

Out  data/news_digest.json  {"daily": {"date", "updated", "engine", "items": [{id, text, text_en, title, link, sources}]},
                             "weekly": {"week", "updated", "engine", "items": [...], "posts": [...]}}
Run by .github/workflows/morning_mail.yml before the morning e-mail; does nothing when today's edition already exists.
    python scripts/news_digest.py [--force]
"""
import json, math, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEWS = os.path.join(ROOT, "data", "news.json")
OUT = os.path.join(ROOT, "data", "news_digest.json")
PROXY = "https://powerklock-ai.tom-s-remy.workers.dev"
PARIS = ZoneInfo("Europe/Paris")

SYSTEM = """Tu es l'éditeur de la veille énergie de PowerKlock. Tes lecteurs : des juristes et des chargés d'affaires publiques
du secteur de l'électricité, et des curieux qui veulent comprendre l'actualité. Tu reçois une liste de sujets (id, titre,
médias qui en parlent, extrait, catégories).

Écris {n} lignes, une par sujet choisi, les plus importants d'abord. Choisis les sujets qui comptent le plus pour le marché
de l'électricité en France et en Europe : régulation et textes officiels, prix et marchés, réseau et nucléaire, grands
projets et contrats. Écarte les sujets anecdotiques.

Chaque ligne : une phrase de 30 mots au plus, en français, en deux temps séparés par « : » : d'abord le fait, puis ce que
cela change concrètement pour un acteur du marché (producteur, fournisseur, acheteur d'électricité, gestionnaire de
réseau, juriste). Exemple : « La CRE ouvre une consultation sur l'accès au réseau des batteries : les règles fixeront le
coût de raccordement et donc la rentabilité des projets de stockage. » Puis la même phrase en anglais.
N'invente rien : seulement ce que disent le titre et l'extrait, et ce qui en découle directement. Pas de chiffre qui n'y
figure pas. Ne cite pas de média.

Réponds en JSON seulement : {{"items": [{{"id": "<id du sujet>", "text": "<français>", "text_en": "<anglais>"}}]}}"""


def load(path, default=None):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return default


NOISE = re.compile(r"\b(black friday|cyber monday|code promo|promo\w*|bon plan|soldes|accessoires|portraits?|bénévole|webinaire|webinar|offre spéciale|meilleur prix|comparatif)\b")


def energy(i):
    """an article about energy by its own words (title and extract), not by the tags of the outlet that published it:
    a Watts Else article on a Russian polypropylene plant carried « power » from its feed (17 Nov. 2026)"""
    from fetch_news import KEYWORDS
    if "official" in (i.get("tags") or []):
        return True
    b = (i.get("title", "") + " " + (i.get("snippet") or "")).lower()
    return any(re.search(KEYWORDS[k], b) for k in ("power", "renewables", "gas", "carbon"))


def focus(i):
    """the digest and the newsletter are about the French power market first: France +1.5, elsewhere −2.5, and a
    geopolitical story that does not name electricity, renewables or gas −1.5; consumer offers and portraits −4"""
    from fetch_news import COUNTRIES, KEYWORDS
    b = (i.get("title", "") + " " + (i.get("snippet") or "")).lower()
    fr = "FR" in (i.get("countries") or []) and re.search(COUNTRIES["FR"], b)
    s = 1.5 if fr else -2.5
    if NOISE.search(b):
        s -= 4                                      # consumer deals and portraits: not market news
    if "geopolitics" in (i.get("tags") or []) and not any(re.search(KEYWORDS[k], b) for k in ("power", "renewables")):
        s -= 1.5
    return s


def stories(items, now, hours):
    """The candidate stories of the last `hours`, ranked like the News page: relevance, more outlets, fresher, varied."""
    keep = []
    for i in items:
        try:
            age = (now - datetime.fromisoformat(i["date"])).total_seconds() / 3600
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= age <= hours and energy(i):
            n = 1 + len(i.get("other_sources") or [])
            keep.append(((i.get("impact") or 0) + focus(i) + 0.5 * math.log2(n) - 0.3 * age / 24, n, i))
    keep.sort(key=lambda x: -x[0])
    out, per, chosen = [], {}, []
    for _, n, i in keep:
        if per.get(i["source"], 0) >= 2 or any(similar(i["title"], t) for t in chosen):   # one outlet, or one event, cannot fill the digest
            continue
        chosen.append(i["title"])
        per[i["source"]] = per.get(i["source"], 0) + 1
        out.append(i)
    return out


COMMON = set("les des une pour sur avec son ses aux par dans the and for with from that this cre électricité electricity énergie energy "
              "prix price france french marché market réseau grid europe european nouvelle nouvelles new".split())


def similar(a, b):
    """two titles about the same event, looser than the grouping in fetch_news.py: close character 4–5-grams, or two
    distinctive words in common (« PPE3 » and « Neutre » in two differently worded titles)"""
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    if cosine_similarity(TfidfVectorizer(analyzer="char_wb", ngram_range=(4, 5)).fit_transform([a.lower(), b.lower()]))[0, 1] >= 0.3:
        return True
    w = lambda t: {x for x in re.findall(r"[a-z0-9à-ÿ]+", t.lower()) if len(x) > 2 and x not in COMMON}
    return len(w(a) & w(b)) >= 2


def sid(i):
    return re.sub(r"[^a-z0-9]", "", i["link"].lower())[-24:]


def ask(cands, n):
    payload = [{"id": sid(i), "title": i["title"], "outlets": [i["source"]] + [o["source"] for o in i.get("other_sources") or []],
                "extract": (i.get("snippet") or "")[:280], "categories": i.get("tags") or []} for i in cands]
    msg = {"max_tokens": 1200, "system": SYSTEM.format(n=n), "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]}
    req = urllib.request.Request(PROXY, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json", "User-Agent": "PowerKlock-news-digest"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    parts = [b.get("text") for b in r.get("content", []) if b.get("type") == "text"]
    out = next((x for x in parts if isinstance(x, dict)), None)   # the proxy sometimes hands back the JSON already parsed
    if out is None:
        m = re.search(r"\{.*\}", "".join(x for x in parts if isinstance(x, str)), re.S)
        if not m:
            raise ValueError("no JSON in the answer")
        out = json.loads(m.group(0))
    by = {sid(i): i for i in cands}
    lines, seen = [], set()
    for x in out.get("items") or []:
        i = by.get(str(x.get("id")))
        text = str(x.get("text") or "").strip()
        if not i or not text or x["id"] in seen:     # a line that does not belong to a story given to the model is dropped
            continue
        seen.add(x["id"])
        lines.append({"id": x["id"], "text": text, "text_en": str(x.get("text_en") or "").strip() or None, "title": i["title"], "link": i["link"],
                      "sources": [i["source"]] + [o["source"] for o in i.get("other_sources") or []]})
    if len(lines) < 2:
        raise ValueError(f"only {len(lines)} usable line(s)")
    return lines[:n]


def top_posts(since):
    """The pasted LinkedIn posts the team found most useful this week (public.news_post, votes in public.news_vote)."""
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        return []
    try:
        import psycopg
        with psycopg.connect(db, connect_timeout=15) as conn, conn.cursor() as cur:
            cur.execute("""select p.url, p.author, p.note, coalesce(sum(v.vote), 0) as score from public.news_post p
                           left join public.news_vote v on v.link = p.url where p.created_at >= %s
                           group by p.url, p.author, p.note having coalesce(sum(v.vote), 0) > 0 order by score desc limit 3""", (since,))
            return [{"url": u, "author": a, "note": n, "score": int(s)} for u, a, n, s in cur.fetchall()]
    except Exception as e:      # the digest must not depend on the database
        print("  posts not read:", str(e)[:160])
        return []


def main():
    force = "--force" in sys.argv
    now = datetime.now(timezone.utc)
    today = now.astimezone(PARIS).date()
    items = [i for i in (load(NEWS, {}) or {}).get("items") or [] if not i.get("noai")]   # AleaSoft refuses AI use
    out = load(OUT, {}) or {}
    changed = False
    if today.weekday() < 5 and (force or (out.get("daily") or {}).get("date") != today.isoformat()):
        cands = stories(items, now, 36)[:14]
        try:
            out["daily"] = {"date": today.isoformat(), "updated": now.isoformat(timespec="seconds"), "engine": "proxy", "items": ask(cands, 5)}
            changed = True
            print(f"daily: {len(out['daily']['items'])} lines from {len(cands)} stories")
        except Exception as e:
            print("daily digest not written:", str(e)[:200])
    week = (today - timedelta(days=today.weekday())).isoformat()   # Monday of this week: the edition covers the week before
    if today.weekday() == 0 and (force or (out.get("weekly") or {}).get("week") != week):
        cands = stories(items, now, 7 * 24 + 12)[:25]
        try:
            out["weekly"] = {"week": week, "updated": now.isoformat(timespec="seconds"), "engine": "proxy", "items": ask(cands, 5),
                             "posts": top_posts(now - timedelta(days=7))}
            changed = True
            print(f"weekly: {len(out['weekly']['items'])} lines from {len(cands)} stories")
        except Exception as e:
            print("weekly digest not written:", str(e)[:200])
    if changed:
        json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
